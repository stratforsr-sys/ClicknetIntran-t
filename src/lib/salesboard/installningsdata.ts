import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import { lasStatistik, tavlansFonster } from "@/lib/salesboard/forma";
import { lasningen, varnaEnGang, type Lasning } from "@/lib/salesboard/saknas";
import {
  ANSTALLDKOLUMNER,
  SALJORDERKOLUMNER,
  SKARMKOLUMNER,
  formaSaljare,
  formaSkarmar,
  saljarutfall,
  troskelNu,
  type RaAnstalld,
  type RaPersonval,
  type RaSaljorder,
  type RaSkarm,
  type Saljare,
  type Skarm,
  type Troskel,
} from "@/lib/salesboard/skrivning";

/**
 * Säljtavlans inställningar: läsningarna som sidan och skrivrutten delar.
 *
 * Inställningssidan och `/salesboard/skriv` läser samma sak: skärmarna, de som
 * tavlan kan visa med sina val, och tröskeln för stor affär. Frågorna står här en
 * gång, och vad svaren betyder står i `skrivning.ts` (`saljarutfall`,
 * `installationslage`), som är provat.
 *
 * ===========================================================================
 * REGELN OM SÄLJARNAS VAL FINNS PÅ ETT STÄLLE.
 *
 * Saknas tabellen med valen fast något annat ur 0250 svarar är det ett fel, och
 * då ges ingen lista alls. En lista utan valen hade visat en säljare som valt att
 * vara dold med "Namn", och en admin hade kunnat tro att valet försvunnit.
 * ===========================================================================
 *
 * Service role, och därför bara efter `tavlansAdmin`.
 */

type Db = ReturnType<typeof supabaseAdmin>;

/** Ett fel från en läsning, så som PostgREST ger det. */
export type Dbfel = { code?: string; message?: string };

/** Säger en gång per process i loggen att ett objekt ur 0250 inte finns än. */
export function loggaSaknad(objekt: string): void {
  varnaEnGang(`saknas ${objekt}`, `Säljtavlan: ${objekt} finns inte än (0250 är inte körd). Inställningarna går vidare utan.`);
}

/** Skärmarna som inte kopplats bort, på namn. `lasning` säger om tabellen svarade, saknas eller felade. */
export async function lasSkarmar(db: Db): Promise<{ lasning: Lasning; skarmar: Skarm[]; fel: Dbfel | null }> {
  const { data, error } = await db.from("salesboard_screen").select(SKARMKOLUMNER).is("revoked_at", null).order("name");
  return {
    lasning: lasningen(error),
    skarmar: error ? [] : formaSkarmar((data ?? []) as unknown as RaSkarm[]),
    fel: (error as Dbfel | null) ?? null,
  };
}

/**
 * Alla som tavlan kan visa i laget, med sina val (`formaSaljare`), och tröskeln
 * för stor affär i läget auto, som tavlan räknar dem just nu.
 *
 * `ovriga` är det som redan lästs ur 0250 (sidans skärmar). Statistiken läses här
 * och räknas med, så att ett "saknas" på valen bara gäller när inget ur 0250
 * svarar.
 *
 * `personer` är null när listan inte går att lita på (`saljarutfall` "fel"), och
 * `troskel` null när den inte gick att räkna. Kastar aldrig.
 */
export async function lasSaljareOchTroskel(
  db: Db,
  lag: string | null,
  ovriga: readonly Lasning[],
): Promise<{ personer: Saljare[] | null; troskel: Troskel | null; val: Lasning; statistik: Lasning }> {
  const fonster = tavlansFonster(new Date());
  const anstallda = db.from("employee").select(ANSTALLDKOLUMNER);

  // Orderna som tavlan läser: månadens och orderlistans fjorton dagar (`tavlan.ts`).
  // Några tiotal rader, långt under de tusen som API:t kapar vid.
  const [anstalldSvar, valSvar, manadSvar, senasteSvar, statistikSvar] = await Promise.all([
    lag !== null ? anstallda.eq("team_id", lag) : anstallda,
    db.from("salesboard_person").select("employee_id, display"),
    db.from("sales_order").select(SALJORDERKOLUMNER).or(`period_month.eq.${fonster.manad},cancel_period_month.eq.${fonster.manad}`),
    db.from("sales_order").select(SALJORDERKOLUMNER).in("status", ["signerad", "betald"]).gte("approved_at", fonster.senasteFran),
    db.rpc("salesboard_statistik", { p_dag: fonster.idag, p_lag: lag }),
  ]);

  const statistik = lasningen(statistikSvar.error);
  let troskel: Troskel | null = null;
  if (statistik === "svar") {
    const tal = lasStatistik(statistikSvar.data);
    troskel = tal ? troskelNu(tal) : null;
  } else if (statistik === "saknas") {
    loggaSaknad("salesboard_statistik");
    troskel = troskelNu(null);
  } else {
    // Tröskeln är en upplysning bredvid valet. Den får inte stänga något.
    console.error("Säljtavlans inställningar: statistiken:", statistikSvar.error?.message);
  }

  const val = lasningen(valSvar.error);
  const utfall = saljarutfall({
    anstallda: lasningen(anstalldSvar.error),
    order: lasningen(manadSvar.error ?? senasteSvar.error),
    val,
    ovriga: [...ovriga, statistik],
  });
  if (utfall === "fel") {
    const fel = (anstalldSvar.error ?? manadSvar.error ?? senasteSvar.error ?? valSvar.error) as Dbfel | null;
    console.error("Säljtavlans inställningar: säljarna:", fel?.code ?? "", fel?.message ?? "valen saknas fast 0250 svarar");
    return { personer: null, troskel, val, statistik };
  }
  if (utfall === "inga-val") loggaSaknad("salesboard_person");

  const personer = formaSaljare(
    (anstalldSvar.data ?? []) as unknown as RaAnstalld[],
    (utfall === "rader" ? (valSvar.data ?? []) : []) as unknown as RaPersonval[],
    lag,
    [...((manadSvar.data ?? []) as unknown as RaSaljorder[]), ...((senasteSvar.data ?? []) as unknown as RaSaljorder[])],
    fonster,
  );
  return { personer, troskel, val, statistik };
}
