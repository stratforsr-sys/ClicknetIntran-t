import "server-only";

import { headers } from "next/headers";
import type { CurrentUser } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";
import { supabaseAdmin } from "@/lib/supabase/server";
import { rodaDagar } from "@/lib/saljtakt";
import { LJUD_LICENS } from "@/app/salesboard/ljud";
import { normalisera } from "@/lib/salesboard/installningar";
import { lasSaljareOchTroskel, lasSkarmar, loggaSaknad } from "@/lib/salesboard/installningsdata";
import { KODALFABET, KODLANGD, KOD_GILTIG_MS } from "@/lib/salesboard/parning";
import { MINSTA_UNDERLAG } from "@/lib/salesboard/regler";
import { FEL, GRANSER, NAMN_MAX, farAndraTavlan, installationslage, type Saljare, type Skarm, type Troskel } from "@/lib/salesboard/skrivning";
import { byggTavlan } from "@/lib/salesboard/tavlan";
import type { TavleManad, TavlansInstallningar } from "@/lib/salesboard/typer";
import { nivaFor } from "./forma";
import { SKRIVLAGE } from "./skrivlage";

/**
 * Nav 2.0: Inställningar → Säljtavlan (`ND.saljtavlan`), bara för superadmin.
 *
 * ===========================================================================
 * ALLT SOM GAMLA /salesboard/installningar VISADE, LÄST PÅ SAMMA SÄTT.
 * Inställningarna, lagen, skärmarna som inte kopplats bort, alla som tavlan kan
 * visa i sitt lag med sina val, och tröskeln för stor affär som tavlan räknar den
 * just nu (`installningsdata.ts`, samma läsningar som skrivrutten). Ur tavlans
 * egen bild (`byggTavlan`): förra månaden, rekordmånaden och de senaste två
 * veckornas orderbelopp, som korten jämför med.
 * ===========================================================================
 *
 * NULL för alla utom superadmin (`farAndraTavlan`), innan något läses. Service
 * role, och därför bara efter den kontrollen.
 *
 * 0250 BEHÖVER INTE VARA KÖRD. Inställningarna ligger i `nav_setting`, som
 * finns, så målet, visningen, firandet och ljudet går att ändra ändå. Skärmarna,
 * säljarnas val och testet kräver 0250:s tabeller (`installerad` falskt), och
 * deras kort säger då att de väntar på installationen. Svarar en av tabellerna
 * och inte den andra är det ett fel (`installationslage`).
 *
 * ETT FEL STÄLLER INTE NAVET. Går något som sektionen inte klarar sig utan att
 * läsa står `fel` med en rad, och resten av Nav 2.0 ritas som vanligt.
 */

export type NdSaljtavlanFacit = {
  forra: TavleManad | null;
  rekord: TavleManad | null;
  belopp: number[];
  /** Tävlingen just nu: de två främsta på ordervärde, och allas värden, högst först. Utan dolda, som på tavlan. */
  topp: { namn: string; varde: number }[];
  varden: number[];
};

export type NdSaljtavlan =
  | { fel: string }
  | {
      fel: null;
      /** SKRIVLAGE.salesboard. Annars svarar /nav2/salesboard 423. */
      skriv: boolean;
      installningar: TavlansInstallningar;
      lagen: { id: string; namn: string }[];
      /** Finns 0250:s tabeller? Utan dem väntar skärmarna, säljarnas val och testet. */
      installerad: boolean;
      skarmar: Skarm[];
      personer: Saljare[];
      troskel: Troskel | null;
      facit: NdSaljtavlanFacit | null;
      serverNu: string;
      granser: typeof GRANSER & { namn: number; kod: { alfabet: string; langd: number; giltigMs: number } };
      minstaUnderlag: number;
      /** "clicknet-nav.vercel.app/salesboard" */
      adress: string;
      /** Röda dagar i år och nästa år, som tavlans kalender (`rodaDagar`): ljudtiden och arbetsdagen räknas med dem. */
      roda: string[];
      licens: string;
    };

/** En läsning som sektionen inte klarar sig utan gick fel. */
function las(vad: string, fel: { code?: string; message?: string } | null | undefined): never {
  throw new Error(`Säljtavlans inställningar: ${vad} gick inte att läsa: ${fel?.code ?? ""} ${fel?.message ?? "okänt fel"}`);
}

async function lasAllt() {
  const db = supabaseAdmin();
  const [installningSvar, lagSvar, skarmar] = await Promise.all([
    db.from("nav_setting").select("value").eq("key", "salesboard").maybeSingle(),
    db.from("team").select("id, name").order("name"),
    lasSkarmar(db),
  ]);
  if (installningSvar.error) las("inställningarna", installningSvar.error);
  if (lagSvar.error) las("lagen", lagSvar.error);

  const installningar = normalisera((installningSvar.data as { value?: unknown } | null)?.value);
  const lagen = ((lagSvar.data ?? []) as { id: string; name: string }[]).map((l) => ({ id: l.id, namn: l.name }));

  // Laget tavlan faktiskt visar: ett lag som inte finns längre räknas som alla, som i `byggTavlan`.
  const lag = installningar.lag !== null && lagen.some((l) => l.id === installningar.lag) ? installningar.lag : null;
  const saljare = await lasSaljareOchTroskel(db, lag, [skarmar.lasning]);

  const lage = installationslage(skarmar.lasning, saljare.val, saljare.statistik);
  if (lage === "fel") las("säljtavlans tabeller (någon saknas fast resten av 0250 svarar)", skarmar.fel);
  if (saljare.personer === null) las("säljarna", null);
  if (lage === "ej") loggaSaknad("salesboard_screen");

  return {
    installningar,
    lagen,
    installerad: lage === "installerad",
    skarmar: lage === "installerad" ? skarmar.skarmar : [],
    personer: saljare.personer,
    troskel: saljare.troskel,
  };
}

/** Förra månaden, rekordmånaden och de senaste order, ur tavlans bild. Null när bilden inte går att bygga; inställningarna fungerar ändå. */
async function lasFacit(): Promise<NdSaljtavlanFacit | null> {
  try {
    const b = await byggTavlan(null);
    const forra = b.historik.at(-1) ?? null;
    const rekord = b.historik.reduce<TavleManad | null>((r, m) => (m.varde > (r?.varde ?? 0) ? m : r), null);
    const rader = [...b.saljare].sort((x, y) => y.varde - x.varde);
    return {
      forra,
      rekord,
      belopp: b.order.map((o) => o.belopp ?? 0).filter((x) => x > 0),
      topp: rader.filter((x) => x.varde > 0).slice(0, 2).map((x) => ({ namn: b.personer[x.person]?.namn ?? "En säljare", varde: x.varde })),
      varden: rader.map((x) => x.varde),
    };
  } catch (e) {
    console.error("Säljtavlans inställningar: tavlans bild:", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function byggSaljtavlan(user: CurrentUser): Promise<NdSaljtavlan | null> {
  if (!user.employee || !farAndraTavlan(nivaFor(user.roles))) return null;

  const facit = lasFacit();
  let data: Awaited<ReturnType<typeof lasAllt>>;
  try {
    data = await lasAllt();
  } catch (e) {
    console.error("Säljtavlans inställningar:", e instanceof Error ? e.message : e);
    await facit;
    return { fel: FEL.svararInte };
  }

  const h = await headers();
  const vard = h.get("x-forwarded-host") ?? h.get("host") ?? "clicknet-nav.vercel.app";
  const ar = Number(svensktDatum(new Date()).slice(0, 4));
  return {
    fel: null,
    skriv: SKRIVLAGE.salesboard,
    ...data,
    facit: await facit,
    serverNu: new Date().toISOString(),
    granser: { ...GRANSER, namn: NAMN_MAX, kod: { alfabet: KODALFABET, langd: KODLANGD, giltigMs: KOD_GILTIG_MS } },
    minstaUnderlag: MINSTA_UNDERLAG,
    adress: `${vard}/salesboard`,
    roda: [...rodaDagar(ar), ...rodaDagar(ar + 1)].sort(),
    licens: LJUD_LICENS,
  };
}
