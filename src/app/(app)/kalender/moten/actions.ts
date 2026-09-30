"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  fornamn,
  hamtaHandelsedetalj,
  lk,
  upptagetFor,
  type Handelsedetalj,
} from "@/lib/leveranskalender-server";
import { tomEfterFonstret } from "@/lib/utkorg-server";
import {
  arDatum,
  dagarMellan,
  hm,
  kvittoFlyttad,
  kvittoForslag,
  kvittoInbjudan,
  kvittoInstallt,
  kvittoKopierad,
  kvittoLangd,
  kvittoSvar,
  minuter,
  type Upptaget,
} from "@/lib/leveranskalender";

/**
 * Leveranskalenderns handlingar (0069), pass 1: möten.
 *
 * =============================================================================
 * VARJE HANDLING ÄR ETT ANROP TILL EN FUNKTION I DATABASEN
 *
 * Ändringen, svaren, utkorgens rader och läget för Ångra skrivs i en
 * transaktion av `lk_*` — se rubriken i 0069. Här valideras indata, aktören
 * sätts till den inloggade (den kommer ALDRIG från klienten), och sedan töms
 * utkorgen i `after()` när ångerfönstret gått ut.
 *
 * BEHÖRIGHETEN AVGÖRS AV FUNKTIONEN, med aktören satt här. Organisatören, och
 * den som har "kan planera om" eller "delegat" i hennes kalender, flyttar och
 * ställer in; deltagarna svarar och föreslår. Att samma regel står i en
 * if-sats här hade gett två svar på samma fråga, och det är funktionen som
 * ser raden låst inuti transaktionen.
 *
 * INGEN HANDLING HÄR ANROPAR `notifiera()` SJÄLV. Allt går genom utkorgen,
 * så att Ångra hinner ta bort det. Därför står de bokförda som "notifierar
 * via utkorgen" i tests/notiser-tackning.mjs.
 * =============================================================================
 */

export type Resultat = {
  ok?: boolean;
  fel?: string;
  kvitto?: string;
  /** Raden i `calendar_undo`. Kvittot skickar den till `angra()`. */
  angra?: string;
  eventId?: string;
  dag?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const arUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const arMinut = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

async function aktor() {
  const user = await getCurrentUser();
  if (!user?.employee) throw new Error("Du måste vara inloggad.");
  return user;
}

/** Efter varje lyckad skrivning: rita om och töm utkorgen när fönstret gått ut. */
function efterat() {
  revalidatePath("/kalender");
  try {
    after(tomEfterFonstret);
  } catch {
    // Ingen begäran att haka i. Jobbet tar raderna inom en minut.
  }
}

function fel(e: unknown): Resultat {
  return { fel: e instanceof Error ? e.message : "Något gick fel." };
}

/** Tidssträngen databasen tar emot. */
const tid = (m: number) => `${hm(m)}:00`;

// -----------------------------------------------------------------------------
// Skapa
// -----------------------------------------------------------------------------

export async function skapaMote(indata: {
  organisator?: string | null;
  rubrik: string;
  dag: string;
  start: number;
  minuter: number;
  deltagare: string[];
  plats?: string | null;
  agenda?: string | null;
  paminnelse?: number;
  visaSom?: string;
}): Promise<Resultat> {
  try {
    const user = await aktor();
    const mig = user.employee!.id;
    const organisator = indata.organisator ?? mig;

    if (!arUuid(organisator)) return { fel: "Okänd organisatör." };
    if (typeof indata.rubrik !== "string" || !indata.rubrik.trim()) return { fel: "Skriv en rubrik först." };
    if (indata.rubrik.length > 200) return { fel: "Rubriken får vara högst 200 tecken." };
    if (!arDatum(indata.dag)) return { fel: "Välj ett datum." };
    if (!arMinut(indata.start, 0, 1439) || indata.start % 5 !== 0) return { fel: "Välj en starttid." };
    if (!arMinut(indata.minuter, 15, 480)) return { fel: "Ett möte är mellan 15 minuter och 8 timmar." };
    if (!Array.isArray(indata.deltagare) || !indata.deltagare.every(arUuid) || indata.deltagare.length > 50) {
      return { fel: "Deltagarlistan stämmer inte." };
    }
    const paminnelse = indata.paminnelse ?? 10;
    if (!arMinut(paminnelse, 0, 1440)) return { fel: "Påminnelsen stämmer inte." };
    const visaSom = indata.visaSom ?? "upptagen";
    if (!["upptagen", "preliminar", "ledig", "borta"].includes(visaSom)) return { fel: "Välj hur tiden ska visas." };

    const svar = await lk<{ event_id: string; undo_id: string; deltagare: string[] }>("lk_skapa_mote", {
      p_aktor: mig,
      p_organizer: organisator,
      p_title: indata.rubrik.trim(),
      p_dag: indata.dag,
      p_tid: tid(indata.start),
      p_minuter: indata.minuter,
      p_deltagare: indata.deltagare,
      p_plats: indata.plats?.slice(0, 200) ?? null,
      p_online_url: null,
      p_agenda: (indata.agenda ?? "").slice(0, 4000),
      p_reminder_min: paminnelse,
    });
    if (!svar.ok) return { fel: svar.fel };

    // "Visa som" är en egenskap hos händelsen och lämnar ingenting i utkorgen,
    // så den skrivs efter funktionen utan att transaktionsregeln bryts. Ångras
    // mötet tas raden bort, och värdet med den.
    if (visaSom !== "upptagen") {
      await supabaseAdmin().from("calendar_event").update({ show_as: visaSom }).eq("id", svar.data.event_id);
    }

    const namn = await fornamn(svar.data.deltagare);
    efterat();
    return {
      ok: true,
      kvitto: kvittoInbjudan(svar.data.deltagare.map((id) => namn.get(id) ?? "")),
      angra: svar.data.undo_id,
      eventId: svar.data.event_id,
      dag: indata.dag,
    };
  } catch (e) {
    return fel(e);
  }
}

// -----------------------------------------------------------------------------
// Svar och förslag
// -----------------------------------------------------------------------------

export async function svara(eventId: string, svar: "ja" | "kanske" | "nej", note?: string | null): Promise<Resultat> {
  try {
    const user = await aktor();
    if (!arUuid(eventId)) return { fel: "Händelsen finns inte längre." };
    if (!["ja", "kanske", "nej"].includes(svar)) return { fel: "Välj Ja, Kanske eller Nej." };
    if (note && note.length > 300) return { fel: "Meddelandet får vara högst 300 tecken." };

    const r = await lk<{ organizer_id: string; undo_id: string }>("lk_svara", {
      p_aktor: user.employee!.id,
      p_event: eventId,
      p_svar: svar,
      p_note: note ?? null,
      p_hela_serien: false,
    });
    if (!r.ok) return { fel: r.fel };

    const namn = await fornamn([r.data.organizer_id]);
    efterat();
    return { ok: true, kvitto: kvittoSvar(svar, namn.get(r.data.organizer_id) ?? ""), angra: r.data.undo_id, eventId };
  } catch (e) {
    return fel(e);
  }
}

export async function foreslaTid(
  eventId: string,
  dag: string,
  start: number,
  langd: number,
  note: string | null,
  svar: "kanske" | "nej",
): Promise<Resultat> {
  try {
    const user = await aktor();
    if (!arUuid(eventId)) return { fel: "Händelsen finns inte längre." };
    if (!arDatum(dag)) return { fel: "Välj ett datum." };
    if (!arMinut(start, 0, 1439) || start % 5 !== 0) return { fel: "Välj en starttid." };
    if (!arMinut(langd, 15, 480)) return { fel: "Välj en längd mellan 15 minuter och 8 timmar." };
    if (note && note.length > 300) return { fel: "Meddelandet får vara högst 300 tecken." };
    if (!["kanske", "nej"].includes(svar)) return { fel: "Välj ditt svar." };

    const r = await lk<{ organizer_id: string; undo_id: string }>("lk_foresla", {
      p_aktor: user.employee!.id,
      p_event: eventId,
      p_dag: dag,
      p_tid: tid(start),
      p_minuter: langd,
      p_note: note?.trim() || null,
      p_svar: svar,
    });
    if (!r.ok) return { fel: r.fel };

    const namn = await fornamn([r.data.organizer_id]);
    efterat();
    return {
      ok: true,
      kvitto: kvittoForslag(namn.get(r.data.organizer_id) ?? "", dag, start, langd),
      angra: r.data.undo_id,
      eventId,
    };
  } catch (e) {
    return fel(e);
  }
}

async function besluta(eventId: string, forslagsstallare: string, godkann: boolean): Promise<Resultat> {
  const user = await aktor();
  if (!arUuid(eventId) || !arUuid(forslagsstallare)) return { fel: "Förslaget finns inte längre." };

  const r = await lk<{ undo_id: string; svara_igen: string[] }>("lk_besluta_forslag", {
    p_aktor: user.employee!.id,
    p_event: eventId,
    p_forslagsstallare: forslagsstallare,
    p_godkann: godkann,
  });
  if (!r.ok) return { fel: r.fel };

  const namn = await fornamn([forslagsstallare, ...r.data.svara_igen]);
  efterat();

  if (!godkann) {
    return { ok: true, kvitto: `${namn.get(forslagsstallare) ?? ""} får veta att tiden ligger kvar.`, angra: r.data.undo_id, eventId };
  }
  const { data: e } = await supabaseAdmin().from("calendar_event").select("dag, tid").eq("id", eventId).maybeSingle();
  return {
    ok: true,
    kvitto: kvittoFlyttad(
      e?.dag as string,
      minuter(e?.tid as string) ?? 0,
      r.data.svara_igen.map((id) => namn.get(id) ?? ""),
    ),
    angra: r.data.undo_id,
    eventId,
    dag: e?.dag as string,
  };
}

export async function godkannForslag(eventId: string, forslagsstallare: string): Promise<Resultat> {
  try {
    return await besluta(eventId, forslagsstallare, true);
  } catch (e) {
    return fel(e);
  }
}

export async function behallTid(eventId: string, forslagsstallare: string): Promise<Resultat> {
  try {
    return await besluta(eventId, forslagsstallare, false);
  } catch (e) {
    return fel(e);
  }
}

// -----------------------------------------------------------------------------
// Flytta, ändra längd, ställ in, kopiera
// -----------------------------------------------------------------------------

export async function flytta(eventId: string, dag: string, start: number): Promise<Resultat> {
  try {
    const user = await aktor();
    if (!arUuid(eventId)) return { fel: "Händelsen finns inte längre." };
    if (!arDatum(dag)) return { fel: "Välj ett datum." };
    if (!arMinut(start, 0, 1439) || start % 5 !== 0) return { fel: "Välj en starttid." };

    const r = await lk<{ undo_id: string; svara_igen: string[] }>("lk_flytta", {
      p_aktor: user.employee!.id,
      p_event: eventId,
      p_dag: dag,
      p_tid: tid(start),
      p_minuter: null,
    });
    if (!r.ok) return { fel: r.fel };

    const namn = await fornamn(r.data.svara_igen);
    efterat();
    return {
      ok: true,
      kvitto: kvittoFlyttad(dag, start, r.data.svara_igen.map((id) => namn.get(id) ?? "")),
      angra: r.data.undo_id,
      eventId,
      dag,
    };
  } catch (e) {
    return fel(e);
  }
}

export async function andraLangd(eventId: string, langd: number): Promise<Resultat> {
  try {
    const user = await aktor();
    if (!arUuid(eventId)) return { fel: "Händelsen finns inte längre." };
    if (!arMinut(langd, 15, 480) || langd % 15 !== 0) return { fel: "Längden är 15 minuter till 8 timmar, i kvartar." };

    const { data: e } = await supabaseAdmin().from("calendar_event").select("dag, tid").eq("id", eventId).maybeSingle();
    if (!e?.tid) return { fel: "Händelsen finns inte längre." };
    const start = minuter(e.tid as string)!;

    const r = await lk<{ undo_id: string; svara_igen: string[] }>("lk_flytta", {
      p_aktor: user.employee!.id,
      p_event: eventId,
      p_dag: e.dag,
      p_tid: tid(start),
      p_minuter: langd,
    });
    if (!r.ok) return { fel: r.fel };

    const namn = await fornamn(r.data.svara_igen);
    efterat();
    return {
      ok: true,
      kvitto: kvittoLangd(start, start + langd, r.data.svara_igen.map((id) => namn.get(id) ?? "")),
      angra: r.data.undo_id,
      eventId,
    };
  } catch (e) {
    return fel(e);
  }
}

export async function stallIn(eventId: string): Promise<Resultat> {
  try {
    const user = await aktor();
    if (!arUuid(eventId)) return { fel: "Händelsen finns inte längre." };

    const r = await lk<{ undo_id: string; mottagare: string[] }>("lk_stall_in", {
      p_aktor: user.employee!.id,
      p_event: eventId,
    });
    if (!r.ok) return { fel: r.fel };

    const namn = await fornamn(r.data.mottagare);
    efterat();
    return {
      ok: true,
      kvitto: kvittoInstallt(r.data.mottagare.map((id) => namn.get(id) ?? "")),
      angra: r.data.undo_id,
      eventId,
    };
  } catch (e) {
    return fel(e);
  }
}

export async function kopiera(eventId: string): Promise<Resultat> {
  try {
    const user = await aktor();
    if (!arUuid(eventId)) return { fel: "Händelsen finns inte längre." };

    const r = await lk<{ event_id: string; undo_id: string }>("lk_kopiera", {
      p_aktor: user.employee!.id,
      p_event: eventId,
    });
    if (!r.ok) return { fel: r.fel };

    const db = supabaseAdmin();
    const [{ data: e }, { count }] = await Promise.all([
      db.from("calendar_event").select("dag, tid").eq("id", r.data.event_id).maybeSingle(),
      db.from("calendar_attendee").select("id", { count: "exact", head: true }).eq("event_id", r.data.event_id),
    ]);
    efterat();
    return {
      ok: true,
      kvitto: kvittoKopierad(e?.dag as string, minuter(e?.tid as string) ?? 0, (count ?? 0) > 0),
      angra: r.data.undo_id,
      eventId: r.data.event_id,
      dag: e?.dag as string,
    };
  } catch (e) {
    return fel(e);
  }
}

// -----------------------------------------------------------------------------
// Läsningar för klienten. Skriver ingenting.
// -----------------------------------------------------------------------------

/** Upptagen tid för assistenten och "Föreslå tid". Högst 15 dagar i taget. */
export async function hamtaUpptaget(personer: string[], fran: string, till: string): Promise<Upptaget> {
  const user = await getCurrentUser();
  if (!user?.employee) return {};
  if (!Array.isArray(personer) || !personer.every(arUuid) || !arDatum(fran) || !arDatum(till)) return {};
  if (dagarMellan(fran, till) < 0 || dagarMellan(fran, till) > 15) return {};
  return upptagetFor(user, personer, fran, till);
}

/** Panelens innehåll. Med läsarens egen token — RLS avgör. */
export async function hamtaHandelse(eventId: string): Promise<Handelsedetalj | null> {
  const user = await getCurrentUser();
  if (!user?.employee || !arUuid(eventId)) return null;
  return hamtaHandelsedetalj(user, eventId);
}

/**
 * Gick ångringen igenom? `angra()` svarar inte — den är ett formuläranrop och
 * returnerar inget — så kvittot frågar efteråt. Bara om den egna raden.
 */
export async function angringsLage(undoId: string): Promise<"angrad" | "for_sent"> {
  const user = await getCurrentUser();
  if (!user?.employee || !arUuid(undoId)) return "for_sent";
  const { data } = await supabaseAdmin()
    .from("calendar_undo")
    .select("used_at, created_by")
    .eq("id", undoId)
    .maybeSingle();
  // En ångrad "skapa" har tagit sin egen rad med sig (cascade). Då finns den inte.
  if (!data) return "angrad";
  if (data.created_by !== user.employee.id) return "for_sent";
  return data.used_at ? "angrad" : "for_sent";
}
