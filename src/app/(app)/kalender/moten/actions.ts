"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  fornamn,
  hamtaEnskilt,
  hamtaHandelsedetalj,
  hamtaKund,
  hamtaLeveransdetalj,
  lk,
  upptagetFor,
  type Enskilt,
  type Handelsedetalj,
  type Kokund,
  type Leveransdetalj,
} from "@/lib/leveranskalender-server";
import { HORISONT_DAGAR, forekomster } from "@/lib/upprepning";
import { svensktDatum } from "@/lib/klocka";
import { skapaSamtal } from "../../coachning/actions";
import { tomEfterFonstret } from "@/lib/utkorg-server";
import {
  arDatum,
  dagarMellan,
  dayLabel,
  hm,
  kvittoFlyttad,
  kvittoForslag,
  kvittoInbjudan,
  kvittoInstallt,
  kvittoKopierad,
  kvittoLangd,
  FORINSTALLNINGAR,
  KVITTO_TREDJE_FORSOKET,
  arSteg,
  kvittoForsok,
  kvittoKickoff,
  kvittoValkomst,
  paminnelsetext,
  kvittoSerieFlyttad,
  kvittoSerieInbjudan,
  kvittoSvar,
  minuter,
  plus,
  regeltext,
  serieregel,
  UPPREPA,
  WDL,
  wd,
  type Upprepa,
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

/** "ons 30 sep". */
const dayLabelKort = (d: string) => dayLabel(d);

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

    // En förekomst i en serie svarar för hela serien — utom när förekomsten
    // flyttats för sig och har egna svar. Det avgör databasen (0070).
    const r = await lk<{ organizer_id: string; undo_id: string; hela_serien: boolean }>("lk_svara", {
      p_aktor: user.employee!.id,
      p_event: eventId,
      p_svar: svar,
      p_note: note ?? null,
      p_hela_serien: true,
    });
    if (!r.ok) return { fel: r.fel };

    const namn = await fornamn([r.data.organizer_id]);
    const { data: e } = await supabaseAdmin().from("calendar_event").select("dag, series_id").eq("id", eventId).maybeSingle();
    const forekomst = e?.series_id && !r.data.hela_serien ? (e.dag as string) : null;
    efterat();
    return {
      ok: true,
      kvitto: kvittoSvar(svar, namn.get(r.data.organizer_id) ?? "", forekomst),
      angra: r.data.undo_id,
      eventId,
    };
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
    const { count: pam } = await supabaseAdmin()
      .from("calendar_reminder")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId)
      .eq("channel", "mejl")
      .in("status", ["vantar", "schemalagd"]);
    efterat();
    return {
      ok: true,
      kvitto:
        kvittoFlyttad(dag, start, r.data.svara_igen.map((id) => namn.get(id) ?? "")) +
        ((pam ?? 0) > 0 ? ` Mejlpåminnelsen flyttas till kl ${hm(Math.max(0, start - 30))}.` : ""),
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

    const r = await lk<{ undo_id: string; mottagare: string[]; paminnelse: boolean }>("lk_stall_in", {
      p_aktor: user.employee!.id,
      p_event: eventId,
    });
    if (!r.ok) return { fel: r.fel };

    const namn = await fornamn(r.data.mottagare);
    efterat();
    return {
      ok: true,
      kvitto:
        kvittoInstallt(r.data.mottagare.map((id) => namn.get(id) ?? "")) +
        (r.data.paminnelse ? " Den som skulle få mejlpåminnelsen får ett mejl om att mötet är avbokat." : ""),
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
// Serier och 1:1 (pass 2)
// -----------------------------------------------------------------------------

/**
 * 1:1 eller återkommande möte. Datumen räknas här, av `forekomster()` i
 * `upprepning.ts`, och föds i samma transaktion som serien (0070).
 */
export async function skapaSerie(indata: {
  typ: "mote" | "enskilt";
  rubrik: string;
  med: string[];
  dag: string;
  start: number;
  minuter: number;
  upprepa: Upprepa;
  agenda?: string | null;
  plats?: string | null;
  visaSom?: string;
  paminnelse?: number;
}): Promise<Resultat> {
  try {
    const user = await aktor();
    const mig = user.employee!.id;
    if (indata.typ !== "mote" && indata.typ !== "enskilt") return { fel: "Välj Möte eller 1:1." };
    if (indata.typ === "mote" && !indata.rubrik?.trim()) return { fel: "Skriv en rubrik först." };
    if (!arDatum(indata.dag)) return { fel: "Välj ett datum." };
    if (!arMinut(indata.start, 0, 1439) || indata.start % 5 !== 0) return { fel: "Välj en starttid." };
    if (!arMinut(indata.minuter, 15, 480)) return { fel: "Ett möte är mellan 15 minuter och 8 timmar." };
    if (!(UPPREPA as readonly string[]).includes(indata.upprepa)) return { fel: "Välj hur det ska upprepas." };
    if (!Array.isArray(indata.med) || !indata.med.every(arUuid)) return { fel: "Deltagarlistan stämmer inte." };
    if (indata.typ === "enskilt" && indata.med.length !== 1) return { fel: "Välj vem 1:1:an är med." };
    const paminnelse = indata.paminnelse ?? 10;
    if (!arMinut(paminnelse, 0, 1440)) return { fel: "Påminnelsen stämmer inte." };
    const visaSom = indata.visaSom ?? "upptagen";
    if (!["upptagen", "preliminar", "ledig", "borta"].includes(visaSom)) return { fel: "Välj hur tiden ska visas." };

    const regel = serieregel(indata.upprepa, indata.dag);
    const dagar = forekomster(
      { monster: regel.monster, veckodagar: regel.monster === "veckovis" ? [regel.veckodag] : [], starts_on: regel.starts_on, ends_on: regel.ends_on, intervall: regel.intervall },
      indata.dag,
      plus(svensktDatum(), HORISONT_DAGAR),
    );
    const text = regeltext(regel);

    const r = await lk<{ series_id: string; event_id: string; undo_id: string; deltagare: string[] }>("lk_skapa_serie", {
      p_aktor: mig,
      p_kind: indata.typ,
      p_organizer: mig,
      p_title: indata.typ === "enskilt" ? "1:1" : indata.rubrik.trim().slice(0, 200),
      p_tid: tid(indata.start),
      p_minuter: indata.minuter,
      p_monster: regel.monster,
      p_intervall: regel.intervall,
      p_veckodag: regel.veckodag,
      p_starts_on: regel.starts_on,
      p_ends_on: regel.ends_on,
      p_deltagare: indata.med,
      p_dagar: dagar,
      p_agenda: (indata.agenda ?? "").slice(0, 600),
      p_reminder_min: paminnelse,
      p_regeltext: text,
    });
    if (!r.ok) return { fel: r.fel };

    // Plats och "visa som" gäller förekomsterna och lämnar ingenting i
    // utkorgen. De förekomster som föds senare får seriens standard.
    if (visaSom !== "upptagen" || indata.plats) {
      await supabaseAdmin()
        .from("calendar_event")
        .update({ show_as: visaSom, plats: indata.plats?.slice(0, 200) ?? null })
        .eq("series_id", r.data.series_id);
    }

    const namn = await fornamn(r.data.deltagare);
    efterat();
    return {
      ok: true,
      kvitto: kvittoSerieInbjudan(r.data.deltagare.map((id) => namn.get(id) ?? ""), text),
      angra: r.data.undo_id,
      eventId: r.data.event_id,
      dag: indata.dag,
    };
  } catch (e) {
    return fel(e);
  }
}

/** Hela serien till en ny veckodag och tid. Förekomsterna räknas om. */
export async function flyttaSerie(eventId: string, dag: string, start: number): Promise<Resultat> {
  try {
    const user = await aktor();
    if (!arUuid(eventId)) return { fel: "Händelsen finns inte längre." };
    if (!arDatum(dag)) return { fel: "Välj ett datum." };
    if (!arMinut(start, 0, 1439) || start % 5 !== 0) return { fel: "Välj en starttid." };

    const db = supabaseAdmin();
    const { data: e } = await db.from("calendar_event").select("dag, series_id").eq("id", eventId).maybeSingle();
    if (!e?.series_id) return { fel: "Händelsen är inte en del av en serie." };
    const { data: s } = await db
      .from("calendar_series")
      .select("monster, intervall, starts_on, ends_on")
      .eq("id", e.series_id)
      .maybeSingle();
    if (!s) return { fel: "Serien finns inte längre." };

    const fran = [e.dag as string, dag].sort()[0] < svensktDatum() ? svensktDatum() : [e.dag as string, dag].sort()[0];
    const dagar = forekomster(
      {
        monster: s.monster as "vardagar" | "veckovis",
        veckodagar: s.monster === "veckovis" ? [wd(dag)] : [],
        starts_on: s.starts_on as string,
        ends_on: s.ends_on as string | null,
        intervall: s.intervall === 2 ? 2 : 1,
      },
      fran,
      plus(svensktDatum(), HORISONT_DAGAR),
    );
    const vardagar = s.monster === "vardagar";
    const text = vardagar ? "varje vardag" : `${s.intervall === 2 ? "varannan " : ""}${WDL[wd(dag)].toLowerCase()}${s.intervall === 2 ? "" : "ar"}`;

    const r = await lk<{ undo_id: string; svara_igen: string[]; event_id: string }>("lk_flytta_serie", {
      p_aktor: user.employee!.id,
      p_event: eventId,
      p_dag: dag,
      p_tid: tid(start),
      p_dagar: dagar,
      p_regeltext: text,
    });
    if (!r.ok) return { fel: r.fel };

    const namn = await fornamn(r.data.svara_igen);
    efterat();
    return {
      ok: true,
      kvitto: kvittoSerieFlyttad(dag, start, vardagar, r.data.svara_igen.map((id) => namn.get(id) ?? "")),
      angra: r.data.undo_id,
      eventId: r.data.event_id,
      dag,
    };
  } catch (e) {
    return fel(e);
  }
}

/** En punkt på 1:1-agendan, eller en åtgärd. Den andra får en notis — en per dag. */
export async function laggTillPunkt(
  seriesId: string,
  kind: "agenda" | "atgard",
  text: string,
  forDag: string | null,
  agare: string | null,
): Promise<Resultat> {
  try {
    const user = await aktor();
    if (!arUuid(seriesId)) return { fel: "Serien finns inte längre." };
    if (kind !== "agenda" && kind !== "atgard") return { fel: "Välj agenda eller åtgärd." };
    const t = String(text ?? "").trim();
    if (!t) return { fel: "Skriv något först." };
    if (t.length > 300) return { fel: "En punkt får vara högst 300 tecken." };
    if (forDag !== null && !arDatum(forDag)) return { fel: "Datumet stämmer inte." };
    if (agare !== null && !arUuid(agare)) return { fel: "Välj vem som ska göra det." };

    const r = await lk<{ item_id: string; undo_id: string }>("lk_ny_punkt", {
      p_aktor: user.employee!.id,
      p_series: seriesId,
      p_kind: kind,
      p_text: t,
      p_for_dag: forDag,
      p_owner: agare,
    });
    if (!r.ok) return { fel: r.fel };
    efterat();
    return { ok: true, kvitto: kind === "agenda" ? "Punkten är tillagd. Den andra ser den." : "Åtgärden är tillagd.", angra: r.data.undo_id };
  } catch (e) {
    return fel(e);
  }
}

export async function bockaAv(itemId: string, klar: boolean): Promise<Resultat> {
  try {
    const user = await aktor();
    if (!arUuid(itemId)) return { fel: "Punkten finns inte längre." };
    const r = await lk<{ undo_id: string }>("lk_bocka", { p_aktor: user.employee!.id, p_item: itemId, p_klar: !!klar });
    if (!r.ok) return { fel: r.fel };
    efterat();
    return { ok: true, kvitto: klar ? "Avbockad." : "Öppen igen.", angra: r.data.undo_id };
  } catch (e) {
    return fel(e);
  }
}

/**
 * En åtgärd blir en uppgift på den som äger den, på dagen och tiden
 * klienten föreslår (första lediga tiden, som prototypen). Utan tid blir det
 * en uppgift utan klockslag.
 */
export async function punktTillUppgift(itemId: string, dag: string | null, start: number | null): Promise<Resultat> {
  try {
    const user = await aktor();
    if (!arUuid(itemId)) return { fel: "Punkten finns inte längre." };
    if (dag !== null && !arDatum(dag)) return { fel: "Datumet stämmer inte." };
    if (start !== null && !arMinut(start, 0, 1439)) return { fel: "Tiden stämmer inte." };
    const r = await lk<{ task_id: string; agare: string; undo_id: string }>("lk_punkt_till_uppgift", {
      p_aktor: user.employee!.id,
      p_item: itemId,
      p_dag: dag,
      p_tid: dag && start !== null ? tid(start) : null,
    });
    if (!r.ok) return { fel: r.fel };
    const namn = await fornamn([r.data.agare]);
    revalidatePath("/uppgifter");
    efterat();
    return {
      ok: true,
      kvitto: `Uppgift skapad åt ${namn.get(r.data.agare) ?? ""}${dag && start !== null ? `, ${dayLabelKort(dag)} ${hm(start)}` : ""}.`,
      angra: r.data.undo_id,
    };
  } catch (e) {
    return fel(e);
  }
}

export async function beOmForberedelse(eventId: string): Promise<Resultat> {
  try {
    const user = await aktor();
    if (!arUuid(eventId)) return { fel: "Händelsen finns inte längre." };
    const r = await lk<{ till: string }>("lk_be_om_forberedelse", { p_aktor: user.employee!.id, p_event: eventId });
    if (!r.ok) return { fel: r.fel };
    const namn = await fornamn([r.data.till]);
    efterat();
    return { ok: true, kvitto: `${namn.get(r.data.till) ?? ""} får en notis att fylla på agendan.` };
  } catch (e) {
    return fel(e);
  }
}

/**
 * Anteckningarna som coachningssamtal (0043). Samtalet skrivs av
 * coachningsmodulens egen `skapaSamtal` — samma behörighet (chefen för
 * säljaren), samma notis och samma läskrets — och kopplas sedan till
 * förekomsten.
 */
export async function sparaSomSamtal(
  eventId: string,
  falt: { goal: string; reality: string; options: string; will: string },
): Promise<Resultat> {
  try {
    const user = await aktor();
    if (!arUuid(eventId)) return { fel: "Händelsen finns inte längre." };
    const e = await hamtaHandelsedetalj(user, eventId);
    if (!e || e.slag !== "enskilt") return { fel: "Händelsen är inte en 1:1." };
    if (e.organisator !== user.employee!.id) return { fel: "Den som håller samtalet sparar det." };
    if (e.coachningssamtal) return { fel: "Samtalet är redan sparat." };
    const saljare = e.deltagare[0]?.id;
    if (!saljare) return { fel: "1:1:an saknar säljare." };

    const f = new FormData();
    f.set("employee_id", saljare);
    f.set("held_on", e.dag);
    f.set("goal_md", String(falt.goal ?? "").slice(0, 4000));
    f.set("reality_md", String(falt.reality ?? "").slice(0, 4000));
    f.set("options_md", String(falt.options ?? "").slice(0, 4000));
    f.set("will_md", String(falt.will ?? "").slice(0, 4000));
    const svar = await skapaSamtal({}, f);
    if (svar.fel) return { fel: svar.fel };

    const { data: sess } = await supabaseAdmin()
      .from("coaching_session")
      .select("id")
      .eq("employee_id", saljare)
      .eq("coach_id", user.employee!.id)
      .eq("held_on", e.dag)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sess) return { fel: "Samtalet sparades men gick inte att koppla." };

    const k = await lk<null>("lk_koppla_samtal", { p_aktor: user.employee!.id, p_event: eventId, p_session: sess.id });
    if (!k.ok) return { fel: k.fel };
    efterat();
    return { ok: true, kvitto: "Sparat som coachningssamtal.", eventId };
  } catch (e) {
    return fel(e);
  }
}

// -----------------------------------------------------------------------------
// Leverans (pass 3)
// -----------------------------------------------------------------------------

/**
 * En kund ur kön till en tid (`bookWelcome()`). Två kan aldrig ta samma kund:
 * `lk_ta_kund` läser raden med `for update skip locked`.
 */
export async function taKund(orderId: string, agare: string, dag: string, start: number, langd: number): Promise<Resultat> {
  try {
    const user = await aktor();
    if (!arUuid(orderId) || !arUuid(agare)) return { fel: "Kunden finns inte längre i kön." };
    if (!arDatum(dag)) return { fel: "Välj ett datum." };
    if (!arMinut(start, 0, 1439) || start % 5 !== 0) return { fel: "Välj en starttid." };
    if (!arMinut(langd, 15, 120)) return { fel: "Välj en längd." };

    const r = await lk<{ event_id: string; saljare: string; undo_id: string }>("lk_ta_kund", {
      p_aktor: user.employee!.id,
      p_order: orderId,
      p_owner: agare,
      p_dag: dag,
      p_tid: tid(start),
      p_minuter: langd,
    });
    if (!r.ok) return { fel: r.fel.includes("tagen") ? "Någon annan tog kunden precis. Välj nästa i kön." : r.fel };

    const [namn, kund] = await Promise.all([fornamn([agare, r.data.saljare]), supabaseAdmin().from("sales_order").select("company_name").eq("id", orderId).maybeSingle()]);
    efterat();
    return {
      ok: true,
      kvitto: kvittoValkomst(
        (kund.data?.company_name as string) ?? "kunden",
        dag,
        start,
        namn.get(agare) ?? "",
        r.data.saljare !== user.employee!.id ? (namn.get(r.data.saljare) ?? "") : "",
      ),
      angra: r.data.undo_id,
      eventId: r.data.event_id,
      dag,
    };
  } catch (e) {
    return fel(e);
  }
}

/** En av de sex förinställningarna, på en kund som redan har en ansvarig. */
export async function skapaLeverans(indata: {
  orderId: string;
  steg: string;
  dag: string;
  start: number;
  minuter: number;
  deltagare: string[];
  remMig: boolean;
  remKund: boolean;
}): Promise<Resultat> {
  try {
    const user = await aktor();
    const mig = user.employee!.id;
    if (!arUuid(indata.orderId)) return { fel: "Välj en kund." };
    if (!arSteg(indata.steg)) return { fel: "Välj en förinställning." };
    if (!arDatum(indata.dag)) return { fel: "Välj ett datum." };
    if (!arMinut(indata.start, 0, 1439) || indata.start % 5 !== 0) return { fel: "Välj en starttid." };
    if (!arMinut(indata.minuter, 15, 480)) return { fel: "Välj en längd." };
    if (!Array.isArray(indata.deltagare) || !indata.deltagare.every(arUuid)) return { fel: "Deltagarlistan stämmer inte." };

    const r = await lk<{ event_id: string; undo_id: string }>("lk_skapa_leverans", {
      p_aktor: mig,
      p_organizer: mig,
      p_order: indata.orderId,
      p_step: indata.steg,
      p_dag: indata.dag,
      p_tid: tid(indata.start),
      p_minuter: indata.minuter,
      p_deltagare: indata.deltagare,
      p_rem_mig: !!indata.remMig,
      p_rem_kund: !!indata.remKund,
    });
    if (!r.ok) return { fel: r.fel };

    const { data: o } = await supabaseAdmin().from("sales_order").select("company_name, contact_name").eq("id", indata.orderId).maybeSingle();
    const p = FORINSTALLNINGAR[indata.steg];
    const till = [indata.remMig ? "dig" : null, indata.remKund && o?.contact_name ? (o.contact_name as string) : null].filter(Boolean);
    efterat();
    return {
      ok: true,
      kvitto:
        `${p.lab} med ${(o?.company_name as string) ?? "kunden"} bokad${p.kund && o?.contact_name ? `, inbjudan till ${o.contact_name}` : ""}.` +
        (till.length ? ` Mejlpåminnelse till ${till.join(" och ")} ${paminnelsetext(indata.dag, indata.start)}.` : ""),
      angra: r.data.undo_id,
      eventId: r.data.event_id,
      dag: indata.dag,
    };
  } catch (e) {
    return fel(e);
  }
}

/**
 * Utfallet: Nådd eller Ej svar. BARA en människa sätter det, med knapparna i
 * panelen — ingenting i navet markerar ett samtal som genomfört av sig självt.
 *
 * Ej svar tar emot nästa försöks tid, som klienten räknat fram med samma
 * `autopick()` som allt annat (minst 3 h senare, inom 5 dagar).
 */
export async function sattUtfall(
  eventId: string,
  utfall: "genomford" | "ej_svar",
  nasta: { dag: string; start: number } | null,
): Promise<Resultat> {
  try {
    const user = await aktor();
    if (!arUuid(eventId)) return { fel: "Händelsen finns inte längre." };
    if (utfall !== "genomford" && utfall !== "ej_svar") return { fel: "Välj Nådd eller Ej svar." };
    if (nasta && (!arDatum(nasta.dag) || !arMinut(nasta.start, 0, 1439))) return { fel: "Nästa försök har en ogiltig tid." };

    const r = await lk<{ undo_id?: string; nasta?: string | null; forsok?: number }>("lk_satt_utfall", {
      p_aktor: user.employee!.id,
      p_event: eventId,
      p_utfall: utfall,
      p_nasta_dag: nasta?.dag ?? null,
      p_nasta_tid: nasta ? tid(nasta.start) : null,
    });
    if (!r.ok) return { fel: r.fel };
    efterat();

    if (utfall === "genomford") {
      const { data: e } = await supabaseAdmin().from("calendar_event").select("step").eq("id", eventId).maybeSingle();
      return {
        ok: true,
        kvitto: e?.step === "valkomstsamtal" ? "Genomfört. Boka kickoff härnäst." : "Markerad som klar.",
        angra: r.data.undo_id,
        eventId,
      };
    }
    if (!r.data.nasta || !nasta) {
      return { ok: true, kvitto: (r.data.forsok ?? 1) > 3 ? KVITTO_TREDJE_FORSOKET : "Ej svar. Ingen ledig tid för nästa försök — boka det för hand." };
    }
    return { ok: true, kvitto: kvittoForsok(r.data.forsok ?? 2, nasta.dag, nasta.start), eventId: r.data.nasta, dag: nasta.dag };
  } catch (e) {
    return fel(e);
  }
}

/** Kickoff inom fem arbetsdagar, med kunden inbjuden och påminnelse till båda. */
export async function bokaKickoff(orderId: string, dag: string, start: number): Promise<Resultat> {
  const r = await skapaLeverans({ orderId, steg: "kickoff", dag, start, minuter: 60, deltagare: [], remMig: true, remKund: true });
  if (!r.ok) return r;
  const { data: o } = await supabaseAdmin().from("sales_order").select("contact_name").eq("id", orderId).maybeSingle();
  return { ...r, kvitto: kvittoKickoff(dag, start, (o?.contact_name as string | null) ?? null) };
}

/** Be säljaren komplettera överlämningen. Notis och mejl till säljaren. */
export async function begarKomplettering(orderId: string, saknas: string[]): Promise<Resultat> {
  try {
    const user = await aktor();
    if (!arUuid(orderId)) return { fel: "Kunden finns inte längre." };
    const r = await lk<{ saljare: string }>("lk_begar_komplettering", {
      p_aktor: user.employee!.id,
      p_order: orderId,
      p_saknas: (Array.isArray(saknas) ? saknas : []).map(String).join(", ").slice(0, 200),
    });
    if (!r.ok) return { fel: r.fel };
    const namn = await fornamn([r.data.saljare]);
    efterat();
    return { ok: true, kvitto: `${namn.get(r.data.saljare) ?? "Säljaren"} får en notis och ett mejl om vad som saknas.` };
  } catch (e) {
    return fel(e);
  }
}

/** Den manuella CRM-adaptern: kund-ID:t klistras in. */
export async function kopplaCrm(orderId: string, externtId: string): Promise<Resultat> {
  try {
    const user = await aktor();
    if (!arUuid(orderId)) return { fel: "Kunden finns inte längre." };
    const id = String(externtId ?? "").trim();
    if (!id) return { fel: "Klistra in kund-ID:t först." };
    const r = await lk<{ undo_id: string }>("lk_koppla_crm", { p_aktor: user.employee!.id, p_order: orderId, p_externt: id });
    if (!r.ok) return { fel: r.fel };
    const { data: o } = await supabaseAdmin().from("sales_order").select("company_name").eq("id", orderId).maybeSingle();
    efterat();
    return { ok: true, kvitto: `${(o?.company_name as string) ?? "Kunden"} är kopplad till ${id} i leverans-CRM:et.`, angra: r.data.undo_id };
  } catch (e) {
    return fel(e);
  }
}

/** Säljarens överlämning: mål, löfte, bästa tid och risker. */
export async function sparaOverlamning(
  orderId: string,
  falt: { mal: string; lovat: string; bastaTid: string; risker: string },
): Promise<Resultat> {
  try {
    const user = await aktor();
    if (!arUuid(orderId)) return { fel: "Ordern finns inte." };
    const r = await lk<null>("lk_spara_overlamning", {
      p_aktor: user.employee!.id,
      p_order: orderId,
      p_mal: String(falt.mal ?? "").slice(0, 600),
      p_lovat: String(falt.lovat ?? "").slice(0, 600),
      p_basta: String(falt.bastaTid ?? "").slice(0, 120),
      p_risker: String(falt.risker ?? "").slice(0, 600),
    });
    if (!r.ok) return { fel: r.fel };
    revalidatePath(`/kalender/overlamning/${orderId}`);
    revalidatePath("/kalender");
    return { ok: true, kvitto: "Överlämningen är sparad. Leveransen ser den direkt." };
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

/** 1:1-panelens innehåll: punkterna, säljarens siffror och vad läsaren får göra. */
export async function hamtaEnskiltInnehall(eventId: string): Promise<Enskilt | null> {
  const user = await getCurrentUser();
  if (!user?.employee || !arUuid(eventId)) return null;
  const e = await hamtaHandelsedetalj(user, eventId);
  return e ? hamtaEnskilt(user, e) : null;
}

/** Leveranspostens panel: kunden, påminnelserna och planen. */
export async function hamtaLeverans(eventId: string): Promise<Leveransdetalj | null> {
  const user = await getCurrentUser();
  if (!user?.employee || !arUuid(eventId)) return null;
  const e = await hamtaHandelsedetalj(user, eventId);
  return e ? hamtaLeveransdetalj(user, e) : null;
}

/** En kund i kön, för kökortet. `leverans_kunder()` avgör vem som får se. */
export async function hamtaKokund(orderId: string): Promise<Kokund | null> {
  const user = await getCurrentUser();
  if (!user?.employee || !arUuid(orderId)) return null;
  return hamtaKund(orderId);
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
