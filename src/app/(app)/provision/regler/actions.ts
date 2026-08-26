"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";
import { kronor, manadFore, manadsnyckel } from "@/lib/provision";
import { BONUSENHETER, type Bonusenhet } from "@/lib/provision-motor";
import { ATGARDER, type Atgard } from "@/lib/konsekvens";

export type ReglerState = { fel?: string; ok?: string };

/**
 * E13 steg 3: volymtrappan som konfiguration.
 *
 * ===========================================================================
 * AC-10.1: PROVISIONSREGLERNA AR DATA, INTE KOD.
 *
 * Ingen troskel och inget belopp star i en `.ts`-fil. Skalet ar praktiskt: en
 * sats i koden gar varken att andra utan deploy eller att visa for den som ska
 * tjana pengarna. Samma linje som `cost_rate` i 0025 och `commission_rate` i
 * 0034 redan drog.
 * ===========================================================================
 *
 * Vem som far andra: SALJCHEF OCH VD. Ekonomi ser men andrar inte
 * (PROVISION_SPEC.md avsnitt 2). Den som betalar ut ska inte ocksa vara den som
 * bestammer vad som ska betalas ut.
 */
async function kravRegelagare() {
  const user = await getCurrentUser();
  if (!hasRole(user, "sales_manager", "ceo") || !user?.employee) {
    throw new Error("Bara saljchef och VD far andra provisionsreglerna.");
  }
  return user;
}

/**
 * Bestallarens tre val vid varje andring (avsnitt 8.1), oversatta till ett
 * `valid_from`.
 *
 * Trappan slas upp pa MANADENS FORSTA DAG — se `gallandeNivaer` i
 * `provision-motor.ts` — sa datumet nedan avgor vilken manad andringen traffar:
 *
 *   denna_manad  manadens 1:a   -> innevarande manad raknas om
 *   nu           dagens datum   -> slar igenom nasta manad
 *   nasta_manad  nasta 1:a      -> slar igenom nasta manad
 *
 * De tva sista sammanfaller mitt i en manad och skiljer sig den 1:a, vilket ar
 * ratt: den som andrar trappan pa forsta dagen menar den manaden.
 *
 * STANGDA PERIODER RORS ALDRIG, oavsett val. Det ar inte konfigurerbart, och
 * det behover inte kontrolleras har: en stangd manad ar bokford i
 * `commission_entry` och laser inte trappan langre.
 */
const VERKAN = ["denna_manad", "nu", "nasta_manad"] as const;
type Verkan = (typeof VERKAN)[number];

function galleFran(verkan: Verkan): string {
  const idag = svensktDatum(new Date());
  switch (verkan) {
    case "denna_manad":
      return manadsnyckel(idag);
    case "nu":
      return idag;
    case "nasta_manad":
      return manadFore(manadsnyckel(idag), -1);
  }
}

function tolkaVerkan(form: FormData): Verkan | null {
  const v = String(form.get("verkan") ?? "");
  return (VERKAN as readonly string[]).includes(v) ? (v as Verkan) : null;
}

type Oppen = { id: string; valid_from: string };

/** Den gallande raden for en troskel, om det finns en. */
async function oppenRad(threshold: number): Promise<Oppen | null> {
  const { data } = await supabaseAdmin()
    .from("commission_bonus_level")
    .select("id, valid_from")
    .eq("threshold", threshold)
    .is("valid_to", null)
    .maybeSingle();

  return (data as Oppen | null) ?? null;
}

/**
 * Stanger den gallande raden per `datum`, eller tar bort den.
 *
 * EN RAD SOM ALDRIG HANN GALLA AR INTE HISTORIK, DEN AR ETT SKRIVFEL. Satter
 * nagon niva 10 till 5 000 kr och rattar det till 5 500 samma dag ar `valid_to`
 * = `valid_from`, alltsa noll dagars giltighet — och det nekas dessutom av
 * villkoret `commission_bonus_level_period`. Raden tas darfor bort i stallet.
 *
 * Alla andra rader star kvar for alltid. Fragan "vilken trappa gallde i juni"
 * ar precis den som stalls nar en utbetalning ifragasatts.
 */
async function stangEllerTaBort(rad: Oppen, datum: string): Promise<string | null> {
  const db = supabaseAdmin();

  if (rad.valid_from > datum) {
    return "En senare andring ligger redan inne. Ta bort den forst.";
  }

  const { error } =
    rad.valid_from === datum
      ? await db.from("commission_bonus_level").delete().eq("id", rad.id)
      : await db.from("commission_bonus_level").update({ valid_to: datum }).eq("id", rad.id);

  return error ? error.message : null;
}

/** Satter eller andrar en niva i trappan. */
export async function sparaNiva(_prev: ReglerState, form: FormData): Promise<ReglerState> {
  try {
    const user = await kravRegelagare();

    const troskel = Number(String(form.get("threshold") ?? "").trim());
    const belopp = Number(String(form.get("amount") ?? "").replace(/[\s ]/g, "").replace(",", "."));
    const enhet = String(form.get("unit") ?? "") as Bonusenhet;
    const verkan = tolkaVerkan(form);

    if (!Number.isInteger(troskel) || troskel < 1) {
      return { fel: "Trosklen ska vara ett heltal storre an noll." };
    }
    if (!Number.isFinite(belopp) || belopp < 0) {
      return { fel: "Beloppet gick inte att tolka." };
    }
    if (!BONUSENHETER.includes(enhet)) return { fel: "Valj en form for bonusen." };
    if (!verkan) return { fel: "Valj fran nar andringen ska galla." };

    // En procentsats over 100 ar inte en regel utan ett skrivfel — och den
    // skulle betala ut mer i bonus an hela manadens grundprovision.
    if (enhet === "percent" && belopp > 100) {
      return { fel: "En procentsats over 100 % ar inte rimlig. Menade du kronor?" };
    }

    const franDatum = galleFran(verkan);
    const db = supabaseAdmin();

    const gammal = await oppenRad(troskel);
    if (gammal) {
      const fel = await stangEllerTaBort(gammal, franDatum);
      if (fel) return { fel: `Den gamla raden gick inte att stanga: ${fel}` };
    }

    const { data: ny, error } = await db
      .from("commission_bonus_level")
      .insert({
        threshold: troskel,
        amount: belopp,
        unit: enhet,
        valid_from: franDatum,
        set_by: user.employee!.id,
      })
      .select("id")
      .single();

    if (error || !ny) return { fel: `Nivan sparades inte: ${error?.message ?? "okant fel"}` };

    await db.from("audit_log").insert({
      actor_id: user.employee!.id,
      action: "commission_bonus_level.set",
      object_type: "commission_bonus_level",
      object_id: ny.id,
      meta: { threshold: troskel, amount: belopp, unit: enhet, valid_from: franDatum },
    });

    revalidatePath("/provision/regler");
    revalidatePath("/provision");
    revalidatePath("/order");

    return {
      ok: `Nivå ${troskel} order ger ${
        enhet === "percent" ? `${belopp} %` : kronor(belopp)
      }${enhet === "amount_per_order" ? " per order" : ""} från ${franDatum}.`,
    };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Nagot gick fel." };
  }
}

/** Tar bort en niva ur trappan fran och med ett datum. */
export async function stangNiva(_prev: ReglerState, form: FormData): Promise<ReglerState> {
  try {
    const user = await kravRegelagare();

    const troskel = Number(String(form.get("threshold") ?? "").trim());
    const verkan = tolkaVerkan(form);

    if (!Number.isInteger(troskel)) return { fel: "Trosklen gick inte att tolka." };
    if (!verkan) return { fel: "Valj fran nar andringen ska galla." };

    const gammal = await oppenRad(troskel);
    if (!gammal) return { fel: `Niva ${troskel} finns inte i trappan.` };

    const franDatum = galleFran(verkan);
    const fel = await stangEllerTaBort(gammal, franDatum);
    if (fel) return { fel: `Nivan togs inte bort: ${fel}` };

    await supabaseAdmin().from("audit_log").insert({
      actor_id: user.employee!.id,
      action: "commission_bonus_level.closed",
      object_type: "commission_bonus_level",
      object_id: gammal.id,
      meta: { threshold: troskel, valid_to: franDatum },
    });

    revalidatePath("/provision/regler");
    revalidatePath("/provision");
    revalidatePath("/order");

    return { ok: `Nivå ${troskel} gäller inte längre från ${franDatum}.` };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Nagot gick fel." };
  }
}

// -----------------------------------------------------------------------------
// E13 steg 6: konsekvenstrappan
//
// ===========================================================================
// DEN HAR TRAPPAN AR INTE VERSIONERAD, och det ar en avsiktlig skillnad mot
// volymtrappan ovan.
//
// `commission_bonus_level` bar `valid_from`/`valid_to` for att fragan "vilken
// trappa gallde i juni" maste ga att besvara i november — bonusen raknas om
// varje gang nagon tittar pa en oppen manad.
//
// `consequence_rule` behover det inte, for FRYSNINGEN SKER PA HANDELSEN i
// stallet. `attendance_incident` kopierar in `rule_id`, `ordningsnummer` och
// `atgard` i det ogonblick chefen godkanner, och laser dem aldrig om (0037).
// En handelse fran juni bar alltsa juni-trappans svar for evigt, oavsett hur
// raderna nedan ser ut i dag.
//
// Foljden ar att en andring har BARA galler framat, av sig sjalv. Det behover
// ingen kolumn och ingen kontroll — men det behover sta utskrivet, for det ser
// ut som en slarvig tabell tills man vet varfor.
// ===========================================================================
// -----------------------------------------------------------------------------

/**
 * Satter ett steg i konsekvenstrappan.
 *
 * `ordning` ar unik i 0037, sa upsert pa den kolumnen andrar ett befintligt steg
 * i stallet for att lagga ett andra pa samma plats. Tva regler pa samma steg
 * hade latit sorteringsordningen avgora vad nagon drabbas av.
 */
export async function sparaKonsekvenssteg(
  _prev: ReglerState,
  form: FormData,
): Promise<ReglerState> {
  try {
    const user = await kravRegelagare();

    const ordning = Number(String(form.get("ordning") ?? "").trim());
    const antal = Number(String(form.get("antal_handelser") ?? "").trim());
    const manader = Number(String(form.get("periodlangd_manader") ?? "").trim());
    const atgard = String(form.get("atgard") ?? "").trim();
    const notifiera = form.get("notifiera") === "on";

    if (!Number.isInteger(ordning) || ordning < 1) return { fel: "Steget maste vara 1 eller hogre." };
    if (!Number.isInteger(antal) || antal < 1) return { fel: "Antalet handelser maste vara minst 1." };
    if (!Number.isInteger(manader) || manader < 1) return { fel: "Periodlangden maste vara minst 1 manad." };
    if (!ATGARDER.includes(atgard as Atgard)) return { fel: "Atgarden gick inte att tolka." };

    // O8: overrig bonus faller INTE. `omfattning` kan darfor bara vara
    // `innevarande_manad`, och bara for en bonusforlust — check-villkoret i 0037
    // nekar allt annat. Raden nedan ar inte en gissning, den ar det enda
    // villkoret slapper igenom.
    const omfattning = atgard === "bonusforlust" ? "innevarande_manad" : null;

    const { error } = await supabaseAdmin()
      .from("consequence_rule")
      .upsert(
        {
          ordning,
          antal_handelser: antal,
          periodlangd_manader: manader,
          atgard,
          omfattning,
          notifiera,
          set_by: user.employee!.id,
          set_at: new Date().toISOString(),
        },
        { onConflict: "ordning" },
      );

    if (error) return { fel: `Steget sparades inte: ${error.message}` };

    await supabaseAdmin().from("audit_log").insert({
      actor_id: user.employee!.id,
      action: "consequence_rule.set",
      object_type: "consequence_rule",
      object_id: String(ordning),
      meta: { ordning, antal_handelser: antal, periodlangd_manader: manader, atgard, notifiera },
    });

    revalidatePath("/provision/regler");
    revalidatePath("/tid/ogiltig-franvaro");

    return { ok: `Steg ${ordning} gäller: ${antal} händelser inom ${manader} månader.` };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Nagot gick fel." };
  }
}

/**
 * Tar bort ett steg ur trappan.
 *
 * REDAN BESLUTADE HANDELSER ROSS INTE. De bar sitt trappsteg pa raden, och
 * `attendance_incident.rule_id` ar `references consequence_rule(id)` UTAN
 * kaskad — databasen nekar darfor raderingen sa lange nagon handelse pekar pa
 * regeln, och det ar ratt: en trappa som gar att radera bakat gor varje beslut
 * omojligt att forklara i efterhand.
 */
export async function taBortKonsekvenssteg(
  _prev: ReglerState,
  form: FormData,
): Promise<ReglerState> {
  try {
    const user = await kravRegelagare();
    const ordning = Number(String(form.get("ordning") ?? "").trim());
    if (!Number.isInteger(ordning)) return { fel: "Steget gick inte att tolka." };

    const { error } = await supabaseAdmin()
      .from("consequence_rule")
      .delete()
      .eq("ordning", ordning);

    // 23503 = foreign_key_violation. Regeln bar redan ett beslut.
    if (error?.code === "23503") {
      return {
        fel:
          `Steg ${ordning} går inte att ta bort — en beslutad händelse pekar på det.` +
          " Ändra steget i stället; redan beslutade händelser behåller ändå sin åtgärd.",
      };
    }
    if (error) return { fel: `Steget togs inte bort: ${error.message}` };

    await supabaseAdmin().from("audit_log").insert({
      actor_id: user.employee!.id,
      action: "consequence_rule.removed",
      object_type: "consequence_rule",
      object_id: String(ordning),
      meta: { ordning },
    });

    revalidatePath("/provision/regler");
    revalidatePath("/tid/ogiltig-franvaro");

    return { ok: `Steg ${ordning} är borta ur trappan.` };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Nagot gick fel." };
  }
}
