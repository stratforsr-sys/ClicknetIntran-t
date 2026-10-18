import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { fullName, getCurrentUser } from "@/lib/auth";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { svensktDatum } from "@/lib/klocka";
import { STEG_ETIKETT, nastaSteg, type Steg } from "@/lib/rekrytering";
import { notifieraFlera, rekryteringskretsen } from "@/lib/notishandelse-server";
import { laggUppAnstalld } from "@/lib/anstallning-server";
import { checklista } from "@/lib/onboarding";
import { ROLES, type Role } from "@/lib/roles";
import { signeraLank } from "@/lib/lagring-server";
import { skapaMote, stallIn } from "@/app/(app)/kalender/moten/actions";
import { farRekrytera } from "@/lib/nav2/rekrytering";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0: allt som ändrar Rekrytering, i en rutt.
 *
 * ===========================================================================
 * REPOTS REGLER. Stegen byts med en update som triggern `candidate_stegbyte`
 * (0030) prövar: bara framåt, avslag från varje öppet steg, inget erbjudande
 * utan scorecard och anställd bara med en employee-rad. Notiserna är repots
 * (`rekrytering-ny`, `-steg`, `-noshow`, `-anstalld`) till samma krets.
 * Anställningen gör samma sak som `anstallKandidat`: `laggUppAnstalld`,
 * kopplingen och steget i en skrivning, checklistan, loggen och notisen.
 * Intervjuerna blir möten i kalendern med repots `skapaMote`, och en avbokning
 * ställer in mötet med `stallIn`.
 *
 * DET NYA (0110): tjänster, tider, bokningar, bokningslänken, anteckningar,
 * scorecardens kriterier och screeningens svar, erbjudandet, talangpoolens
 * fråga, begäran om meriter, mallarnas texter, Så är jobbet, gallringsfristen
 * och tipsen från laget.
 *
 * KANDIDATEN FÅR INGENTING HÄRIFRÅN. Det som ska till kandidaten läggs i
 * `candidate_message` som `vantar`, och ingenting tömmer den tabellen. Svaren
 * säger det.
 * ===========================================================================
 *
 * LÄSLÄGE: står `SKRIVLAGE.rekrytering` på false svarar rutten 423 innan något
 * skrivs. Undantaget är att öppna ett CV, som är en läsning.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const PNR = /\d{6}[-+]?\d{4}/;
const BOKNAMN: Record<string, string> = { tel: "Telefonscreening", int1: "Intervju 1", int2: "Intervju 2" };
const BOKSTEG: Record<string, Steg> = { tel: "screening", int1: "interview_1", int2: "interview_2" };
const KALLOR = ["ansokningssida", "platsbanken", "linkedin", "tips", "spontan", "annat"];
const SKAL = ["Passade inte kraven", "Vi gick vidare med en annan kandidat", "Tackade nej", "Kom inte till intervjun", "Annat"];
const MALLAR = ["bekr", "lank", "bokad", "sms24", "sms2", "avslag1", "avslag2", "erbj", "pool"];
const REK: Record<string, string> = { ja: "yes", tveksam: "maybe", nej: "no" };
const KRIT = ["driv", "lyssna", "nej", "rost", "palitlig"];
const SCREEN = ["varfor", "ringt", "heltid", "start", "lon"];
const UTSKICK = "Navet skickar inte till kandidater än, så det ligger och väntar.";

type Svar = { ok?: string; fel?: string; [k: string]: unknown };
const svar = (data: Svar, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const tmin = (s: string) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const epostOk = (s: string) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s);
const fornamn = (n: string) => n.split(" ")[0] || n;
const plusDagar = (d: string, n: number) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
/** En svensk väggklocka som ISO, för `send_after` (sommartid och vintertid). */
function svIso(d: string, min: number): string {
  const gissning = new Date(`${d}T${hm(min)}:00Z`);
  const off = new Date(gissning.toLocaleString("en-US", { timeZone: "Europe/Stockholm" })).getTime() - new Date(gissning.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  return new Date(gissning.getTime() - off).toISOString();
}
/** Databasens nej i klartext. Triggern och K27 säger exakt vad som var fel. */
function dbFel(e: { message?: string } | null, annars: string): string {
  const m = e?.message ?? "";
  if (/personnummer/i.test(m)) return "Det ser ut som ett personnummer. Navet sparar inga (K27), så ta bort det.";
  if (/AC-7\.6/.test(m)) return "Ett erbjudande kräver minst en ifylld scorecard.";
  if (/AC-7\.3/.test(m)) return "Det steget går inte att nå härifrån. Stegen går bara framåt.";
  if (/duplicate key|unique/i.test(m)) return "Det finns redan.";
  return annars;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return svar({ fel: "Du måste vara inloggad." }, 401);
  if (!sammaUrsprung(request)) return svar({ fel: "Fel ursprung." }, 403);
  const mig = user.employee.id;
  const jagNamn = fullName(user.employee);

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return svar({ fel: "Ogiltig begäran." }, 400);
  }
  const handling = String(b.handling ?? "");
  const id = String(b.id ?? "");
  const far = farRekrytera(user);
  if (handling !== "tips" && !far) return svar({ fel: "Rekrytering är öppen för säljchef, VD, administratör och den som har behörigheten Rekryterare." }, 403);
  if (id && !UUID.test(id)) return svar({ fel: "Kandidaten finns inte." }, 404);
  const db = supabaseAdmin();

  // Kandidaten som den inloggade ser den (RLS), med det 0110 lade till.
  const kandidaten = async () => {
    if (!id) return null;
    const { data } = await (await supabaseServer()).from("candidate").select("*").eq("id", id).maybeSingle();
    return data as null | { id: string; first_name: string; last_name: string; email: string; phone: string | null; stage: Steg; role_title: string; position_id: string | null; no_show_count: number; source_slug: string; talent_pool: boolean };
  };

  // CV:t visas alltid: det är en läsning. Att det lästes loggas bara när vyn får spara.
  if (handling === "cv") {
    const k = await kandidaten();
    if (!k) return svar({ fel: "Kandidaten finns inte." }, 404);
    const { data: rad } = await db.from("candidate").select("cv_file_id").eq("id", k.id).maybeSingle();
    if (!rad?.cv_file_id) return svar({ fel: "Det finns inget CV." }, 404);
    const { data: fil } = await db.from("file_object").select("store, bucket, path").eq("id", rad.cv_file_id).is("removed_at", null).maybeSingle();
    if (!fil) return svar({ fel: "CV:t finns inte längre." }, 404);
    const l = await signeraLank({ lager: fil.store, bucket: fil.bucket, path: fil.path, sekunder: 60, laddaNedSom: null });
    if (SKRIVLAGE.rekrytering && "url" in l) await db.from("candidate_note").insert({ candidate_id: k.id, kind: "cv", by_employee: mig });
    return "url" in l ? svar({ url: l.url }) : svar({ fel: l.fel }, 500);
  }

  if (!SKRIVLAGE.rekrytering) return svar({ fel: LASLAGE_TEXT, laslage: true }, 423);

  const namnPa = (k: { first_name: string; last_name: string }) => `${k.first_name} ${k.last_name}`.trim();
  const klart = (ok: string, extra: Record<string, unknown> = {}) => {
    revalidatePath("/rekrytering");
    if (id) revalidatePath(`/rekrytering/${id}`);
    return svar({ ok, ...extra });
  };
  const meddela = async (cid: string, template: string, channel: string, body: string, opt: { booking?: string; efter?: string } = {}) => {
    if (!body.trim()) return;
    await db.from("candidate_message").insert({ candidate_id: cid, template, channel, body: body.slice(0, 4000), booking_id: opt.booking ?? null, send_after: opt.efter ?? new Date().toISOString(), created_by: mig });
  };
  const stegNotis = async (cid: string, k: { first_name: string; last_name: string; role_title: string }, fran: Steg, till: Steg, skal?: string | null) =>
    notifieraFlera(await rekryteringskretsen(), {
      av: mig,
      kalla: "rekrytering-steg",
      typ: "rekrytering",
      rubrik: `${namnPa(k)} → ${STEG_ETIKETT[till] ?? till}`,
      detalj: till === "rejected" ? `Tackade nej eller nekades · ${skal || "inget skäl angivet"}` : `${k.role_title} · flyttad från ${STEG_ETIKETT[fran] ?? fran}`,
      href: `/rekrytering/${cid}`,
      objekt: { typ: "candidate", id: cid },
    });
  /** Ett steg framåt, med triggern som domare. */
  const flytta = async (k: { id: string; first_name: string; last_name: string; role_title: string; stage: Steg }, till: Steg, extra: Record<string, unknown> = {}) => {
    if (!nastaSteg(k.stage).includes(till)) return `Från ${STEG_ETIKETT[k.stage].toLowerCase()} går det inte till ${STEG_ETIKETT[till].toLowerCase()}.`;
    const { error } = await db.from("candidate").update({ stage: till, ...extra }).eq("id", k.id);
    if (error) return dbFel(error, "Steget kunde inte sparas.");
    await stegNotis(k.id, k, k.stage, till, (extra.rejected_reason as string | undefined) ?? null);
    k.stage = till;
    return null;
  };
  /** Stegen följer bokningen: en bokad intervju 1 betyder att kandidaten är på intervju 1. */
  const stegTill = async (k: { id: string; first_name: string; last_name: string; role_title: string; stage: Steg }, mal: Steg) => {
    const ordning: Steg[] = ["new", "screening", "interview_1", "interview_2"];
    while (ordning.indexOf(k.stage) >= 0 && ordning.indexOf(k.stage) < ordning.indexOf(mal)) {
      const nasta = ordning[ordning.indexOf(k.stage) + 1];
      const f = await flytta(k, nasta);
      if (f) return f;
    }
    return null;
  };
  const avbokaKommande = async (cid: string) => {
    const { data } = await db.from("candidate_booking").select("id, calendar_event_id, day, start_min").eq("candidate_id", cid).eq("status", "bokad").gte("day", svensktDatum());
    for (const x of (data ?? []) as { id: string; calendar_event_id: string | null }[]) {
      await db.from("candidate_booking").update({ status: "avbokad", cancelled_at: new Date().toISOString() }).eq("id", x.id);
      if (x.calendar_event_id) await stallIn(x.calendar_event_id);
      await db.from("candidate_message").update({ status: "avbruten" }).eq("booking_id", x.id).eq("status", "vantar");
    }
    await db.from("candidate_booking_link").update({ cancelled_at: new Date().toISOString() }).eq("candidate_id", cid).is("used_at", null).is("cancelled_at", null);
    return (data ?? []).length;
  };
  const texter = (b.texter && typeof b.texter === "object" ? b.texter : {}) as Record<string, unknown>;
  const text = (k: string) => str(texter[k], 4000);

  try {
    switch (handling) {
      // ---------------------------------------------------------------- Kandidaten
      case "ny": {
        const namn = str(b.namn, 160).replace(/\s+/g, " ");
        const [fn, ...rest] = namn.split(" ");
        const epost = str(b.epost, 200).toLowerCase();
        const kalla = str(b.kalla, 40);
        const notText = str(b.not);
        if (!fn || !rest.length) return svar({ fel: "Skriv för- och efternamn." }, 400);
        if (!epostOk(epost)) return svar({ fel: "Skriv en e-postadress, till exempel namn@exempel.se." }, 400);
        if (!KALLOR.includes(kalla)) return svar({ fel: "Välj varifrån ansökan kom." }, 400);
        if (PNR.test(notText)) return svar({ fel: "Det ser ut som ett personnummer. Navet sparar inga, så ta bort det." }, 400);
        const tj = UUID.test(String(b.tj ?? "")) ? String(b.tj) : null;
        const { data: pos } = tj ? await db.from("recruitment_position").select("id, title").eq("id", tj).maybeSingle() : { data: null };
        const { data: ny, error } = await db.from("candidate").insert({
          first_name: fn, last_name: rest.join(" "), email: epost, phone: str(b.tel, 40) || null, source_slug: kalla,
          role_title: pos?.title ?? "Säljare", position_id: pos?.id ?? null, notes: notText || null, created_by: mig,
        }).select("id").single();
        if (error || !ny) return svar({ fel: dbFel(error, "Kandidaten kunde inte sparas. Försök igen.") }, 400);
        await meddela(ny.id, "bekr", "mejl", text("bekr"));
        await notifieraFlera(await rekryteringskretsen(), {
          av: mig, kalla: "rekrytering-ny", typ: "rekrytering", rubrik: `Ny kandidat: ${namn}`, detalj: `${pos?.title ?? "Säljare"} · via ${kalla}`,
          href: `/rekrytering/${ny.id}`, objekt: { typ: "candidate", id: ny.id },
        });
        return klart(`${namn} är upplagd. Tackmejlet väntar på utskick: ${UTSKICK}`, { id: ny.id });
      }

      case "steg": {
        const k = await kandidaten();
        if (!k) return svar({ fel: "Kandidaten finns inte." }, 404);
        const till = String(b.till ?? "") as Steg;
        if (till !== "screening") return svar({ fel: "Det steget har ett eget formulär." }, 400);
        const f = await flytta(k, "screening");
        return f ? svar({ fel: f }, 400) : klart(`${fornamn(namnPa(k))} är på screening.`);
      }

      // ---------------------------------------------------------------- Bedömningar
      case "screening":
      case "scorecard": {
        const k = await kandidaten();
        if (!k) return svar({ fel: "Kandidaten finns inte." }, 404);
        const rek = REK[String(b.rek ?? "")];
        if (!rek) return svar({ fel: "Välj Ja, Tveksam eller Nej." }, 400);
        const steg = handling === "screening" ? "screening" : String(b.steg ?? "");
        if (!["screening", "interview_1", "interview_2"].includes(steg)) return svar({ fel: "Det steget bedöms inte." }, 400);
        const kalla = (b.svar && typeof b.svar === "object" ? b.svar : {}) as Record<string, unknown>;
        const krit = (b.krit && typeof b.krit === "object" ? b.krit : {}) as Record<string, unknown>;
        const screening = handling === "screening" ? Object.fromEntries(SCREEN.map((q) => [q, str(kalla[q], 500)]).filter(([, v]) => v)) : null;
        const criteria = handling === "scorecard" ? Object.fromEntries(KRIT.map((q) => [q, String(krit[q] ?? "")]).filter(([, v]) => ["ja", "oklart", "nej"].includes(v))) : null;
        const styrkor = handling === "screening" ? str(kalla.not) : str(b.styrkor);
        const tveks = handling === "screening" ? "" : str(b.tveks);
        if ([styrkor, tveks, ...Object.values(screening ?? {})].some((v) => PNR.test(String(v)))) return svar({ fel: "Det ser ut som ett personnummer. Navet sparar inga, så ta bort det." }, 400);
        const { error } = await db.from("interview_scorecard").upsert(
          { candidate_id: k.id, stage: steg, interviewer_id: mig, recommendation: rek, strengths: styrkor || null, concerns: tveks || null, screening, criteria },
          { onConflict: "candidate_id,stage,interviewer_id" },
        );
        if (error) return svar({ fel: dbFel(error, "Bedömningen kunde inte sparas. Försök igen.") }, 400);
        if (handling === "screening" && k.stage === "new") {
          const f = await flytta(k, "screening");
          if (f) return svar({ fel: f }, 400);
        }
        const typ = steg === "screening" ? "tel" : steg === "interview_2" ? "int2" : "int1";
        await db.from("candidate_booking").update({ status: "klar" }).eq("candidate_id", k.id).eq("kind", typ).eq("status", "bokad").lte("day", svensktDatum());
        return klart(handling === "screening" ? "Screeningen är sparad." : "Scorecarden är sparad.");
      }

      case "uteblev": {
        const k = await kandidaten();
        if (!k) return svar({ fel: "Kandidaten finns inte." }, 404);
        const { data: bok } = await db.from("candidate_booking").select("id").eq("candidate_id", k.id).eq("status", "bokad").lte("day", svensktDatum()).order("day", { ascending: false }).limit(1);
        const antal = (k.no_show_count ?? 0) + 1;
        const { error } = await db.from("candidate").update({ no_show_count: antal }).eq("id", k.id);
        if (error) return svar({ fel: "Det kunde inte sparas." }, 400);
        if (bok && bok[0]) await db.from("candidate_booking").update({ status: "uteblev" }).eq("id", bok[0].id);
        await notifieraFlera(await rekryteringskretsen(), {
          av: mig, kalla: "rekrytering-noshow", typ: "rekrytering", rubrik: `${namnPa(k)} kom inte till intervjun`,
          detalj: antal === 1 ? `Första gången · källa ${k.source_slug}` : `${antal} gånger · källa ${k.source_slug}`, href: `/rekrytering/${k.id}`, objekt: { typ: "candidate", id: k.id },
        });
        return klart(`Registrerat. ${antal === 1 ? "Första gången." : antal + " gånger."} Boka en ny tid eller ge avslag.`);
      }

      // ---------------------------------------------------------------- Bokningar
      case "boka": {
        const k = await kandidaten();
        if (!k) return svar({ fel: "Kandidaten finns inte." }, 404);
        const btyp = String(b.btyp ?? "");
        if (!BOKNAMN[btyp]) return svar({ fel: "Välj vilken intervju." }, 400);
        const slotId = String(b.slot ?? "");
        if (!UUID.test(slotId)) return svar({ fel: "Välj en tid." }, 400);
        const med = (Array.isArray(b.med) ? b.med : []).map(String).filter((x) => UUID.test(x) && x !== mig).slice(0, 10);
        const { data: slot } = await db.from("interview_slot").select("id, day, start_min, end_min, place").eq("id", slotId).maybeSingle();
        if (!slot) return svar({ fel: "Tiden finns inte längre." }, 404);
        const f = await stegTill(k, BOKSTEG[btyp]);
        if (f) return svar({ fel: f }, 400);
        await avbokaKommande(k.id);
        const mote = await skapaMote({
          rubrik: `${BOKNAMN[btyp]} · ${namnPa(k)}`, dag: slot.day, start: slot.start_min, minuter: slot.end_min - slot.start_min, deltagare: med, plats: slot.place,
          agenda: btyp === "tel" ? "Fem frågor och Så är jobbet. Manuset finns i Rekrytering." : "Fem frågor, ett rollspel och Så är jobbet. Guiden finns i Rekrytering.",
        });
        const { data: bok, error } = await db.from("candidate_booking").insert({
          candidate_id: k.id, slot_id: slot.id, kind: btyp, day: slot.day, start_min: slot.start_min, end_min: slot.end_min, place: slot.place,
          attendees: [mig, ...med], calendar_event_id: mote.eventId ?? null, created_by: mig,
        }).select("id").single();
        if (error || !bok) {
          if (mote.eventId) await stallIn(mote.eventId);
          return svar({ fel: dbFel(error, "Tiden kunde inte bokas.") === "Det finns redan." ? "Tiden hann bokas av någon annan. Välj en annan." : dbFel(error, "Tiden kunde inte bokas.") }, 409);
        }
        await meddela(k.id, "bokad", "mejl_ics", text("bokad"), { booking: bok.id });
        if (btyp !== "tel") {
          await meddela(k.id, "sms24", "sms", text("sms24"), { booking: bok.id, efter: svIso(plusDagar(slot.day, -1), slot.start_min) });
          await meddela(k.id, "sms2", "sms", text("sms2"), { booking: bok.id, efter: svIso(slot.day, Math.max(0, slot.start_min - 120)) });
        }
        return klart(`Bokat ${slot.day} kl. ${hm(slot.start_min)}, och mötet ligger i kalendern.${mote.fel ? ` Kalendermötet skapades inte: ${mote.fel}` : ""} Bekräftelsen och påminnelserna väntar på utskick: ${UTSKICK}`);
      }

      case "lank": {
        const k = await kandidaten();
        if (!k) return svar({ fel: "Kandidaten finns inte." }, 404);
        const btyp = String(b.btyp ?? "");
        if (!BOKNAMN[btyp]) return svar({ fel: "Välj vilken intervju." }, 400);
        if (!["new", "screening", "interview_1", "interview_2"].includes(k.stage)) return svar({ fel: "Bokningslänken gäller kandidater som inte kommit till erbjudandet." }, 400);
        const med = (Array.isArray(b.med) ? b.med : []).map(String).filter((x) => UUID.test(x) && x !== mig).slice(0, 10);
        const f = await stegTill(k, BOKSTEG[btyp]);
        if (f) return svar({ fel: f }, 400);
        await avbokaKommande(k.id);
        const { error } = await db.from("candidate_booking_link").insert({ candidate_id: k.id, kind: btyp, attendees: [mig, ...med], token: randomBytes(18).toString("base64url"), created_by: mig });
        if (error) return svar({ fel: "Länken kunde inte skapas." }, 400);
        await meddela(k.id, "lank", "mejl_sms", text("lank"));
        return klart(`Bokningslänken är skapad. Den väntar på utskick, och sidan där ${fornamn(namnPa(k))} väljer tid finns inte än.`);
      }

      case "avboka": {
        const bid = String(b.bokning ?? "");
        if (!UUID.test(bid)) return svar({ fel: "Bokningen finns inte." }, 404);
        const { data: bok } = await db.from("candidate_booking").select("id, candidate_id, kind, day, start_min, calendar_event_id, status").eq("id", bid).maybeSingle();
        if (!bok || bok.status !== "bokad") return svar({ fel: "Bokningen finns inte längre." }, 404);
        await db.from("candidate_booking").update({ status: "avbokad", cancelled_at: new Date().toISOString() }).eq("id", bok.id);
        if (bok.calendar_event_id) await stallIn(bok.calendar_event_id);
        await db.from("candidate_message").update({ status: "avbruten" }).eq("booking_id", bok.id).eq("status", "vantar");
        const { data: k } = await db.from("candidate").select("first_name").eq("id", bok.candidate_id).maybeSingle();
        await meddela(bok.candidate_id, "avbokad", "mejl", `Hej ${k?.first_name ?? ""}! ${BOKNAMN[bok.kind]} ${bok.day} kl. ${hm(bok.start_min)} är avbokad. Vi hör av oss om en ny tid.`);
        return klart(`${BOKNAMN[bok.kind]} är avbokad, mötet är inställt och tiden är ledig igen.`);
      }

      // ---------------------------------------------------------------- Beslut
      case "avslag": {
        const k = await kandidaten();
        if (!k) return svar({ fel: "Kandidaten finns inte." }, 404);
        const skal = str(b.skal, 120);
        if (!SKAL.includes(skal)) return svar({ fel: "Välj ett skäl. Det syns bara här, men tratten behöver det." }, 400);
        const notText = str(b.not);
        if (PNR.test(notText)) return svar({ fel: "Det ser ut som ett personnummer. Navet sparar inga, så ta bort det." }, 400);
        await avbokaKommande(k.id);
        const f = await flytta(k, "rejected", { rejected_reason: skal });
        if (f) return svar({ fel: f }, 400);
        if (notText) await db.from("candidate_note").insert({ candidate_id: k.id, kind: "not", body: notText, by_employee: mig });
        const mall = String(b.mall ?? "");
        if (b.mejl === true && ["avslag1", "avslag2"].includes(mall)) await meddela(k.id, mall, "mejl", text(mall));
        if (b.pool === true) {
          await db.from("candidate").update({ pool_asked_at: new Date().toISOString() }).eq("id", k.id);
          await meddela(k.id, "pool", "mejl", text("pool"));
        }
        return klart(`${fornamn(namnPa(k))} har fått avslag.${b.mejl === true || b.pool === true ? ` Mejlet väntar på utskick: ${UTSKICK}` : ""}`);
      }

      case "erbjudande": {
        const k = await kandidaten();
        if (!k) return svar({ fel: "Kandidaten finns inte." }, 404);
        const start = String(b.start ?? ""), senast = String(b.senast ?? ""), form = String(b.form ?? "");
        const idag = svensktDatum();
        if (!DATUM.test(start) || start < idag) return svar({ fel: "Startdagen kan inte ligga bakåt i tiden." }, 400);
        if (!DATUM.test(senast) || senast < idag || senast >= start) return svar({ fel: "Svar senast ska vara i dag eller senare, och före startdagen." }, 400);
        if (!["probation", "permanent"].includes(form)) return svar({ fel: "Välj anställningsform." }, 400);
        const f = await flytta(k, "offer", { offer_start: start, offer_reply_by: senast, offer_form: form, offer_sent_at: new Date().toISOString() });
        if (f) return svar({ fel: f }, 400);
        await meddela(k.id, "erbj", "mejl", text("erbj"));
        return klart(`Erbjudandet är sparat. ${fornamn(namnPa(k))} svarar senast ${senast}. Mejlet väntar på utskick: ${UTSKICK}`);
      }

      case "pamin": {
        const k = await kandidaten();
        if (!k || k.stage !== "offer") return svar({ fel: "Kandidaten har inget erbjudande." }, 400);
        await meddela(k.id, "pamin", "sms", text("pamin"));
        return klart(`Påminnelsen väntar på utskick: ${UTSKICK}`);
      }

      case "anstall": {
        // Samma ordning som repots anstallKandidat: personen, sedan kopplingen och steget i EN skrivning, sedan resten.
        const k = await kandidaten();
        if (!k) return svar({ fel: "Kandidaten finns inte." }, 404);
        const { data: rad } = await db.from("candidate").select("hired_employee_id, stage").eq("id", k.id).maybeSingle();
        if (rad?.hired_employee_id) return svar({ fel: "Kandidaten är redan anställd. Ett dubbelklick skapar ingen andra person." }, 409);
        if (rad?.stage !== "offer") return svar({ fel: "Bara en kandidat som fått ett erbjudande kan anställas." }, 400);
        const f = (b.f && typeof b.f === "object" ? b.f : {}) as Record<string, unknown>;
        const roll = String(f.roll ?? "salesperson") as Role;
        if (!ROLES.includes(roll)) return svar({ fel: "Okänd roll." }, 400);
        const uppg = {
          epost: str(f.epost, 200).toLowerCase(), fornamn: str(f.fornamn, 80) || k.first_name, efternamn: str(f.efternamn, 80) || k.last_name, roll,
          anstallningsform: String(f.form ?? "permanent"), startdatum: DATUM.test(String(f.start ?? "")) ? String(f.start) : null,
          anstallningsnummer: str(f.nummer, 40) || null, teamId: UUID.test(String(f.team ?? "")) ? String(f.team) : null,
        };
        if (!epostOk(uppg.epost)) return svar({ fel: "Skriv jobbmejlet. Det blir inloggningen i navet." }, 400);
        const s = await laggUppAnstalld(uppg, mig);
        if ("fel" in s) return svar({ fel: s.fel }, 400);
        const { error: stegfel } = await db.from("candidate").update({ hired_employee_id: s.employeeId, stage: "hired" }).eq("id", k.id);
        if (stegfel) return svar({ halvvags: true, anstalldId: s.employeeId, losenord: s.losenord, fel: `${namnPa(k)} är upplagd som anställd, men kandidaten står kvar på erbjudande: ${stegfel.message}. Lösenordet gäller — skriv ner det nu, det visas inte igen.` }, 500);
        const nu = new Date().toISOString();
        await db.from("onboarding_task").insert(checklista(false, s.kurser.length).map((p, i) => ({ employee_id: s.employeeId, label: p.label, sort: i, state: p.automatisk ? "done" : "open", handled_by: p.automatisk ? mig : null, handled_at: p.automatisk ? nu : null })));
        await db.from("audit_log").insert({ actor_id: mig, action: "candidate.hired", object_type: "candidate", object_id: k.id, meta: { employee_id: s.employeeId, roll, avtal: null, rutiner: s.rutiner.length, kurser: s.kurser.length } });
        await notifieraFlera(await rekryteringskretsen(), {
          av: mig, kalla: "rekrytering-anstalld", typ: "rekrytering", rubrik: `${namnPa(k)} är anställd`, detalj: `${roll} · ${s.rutiner.length} rutiner och ${s.kurser.length} kurser tilldelade`,
          href: `/personal/${s.employeeId}`, objekt: { typ: "candidate", id: k.id },
        });
        revalidatePath("/personal");
        return klart(`${namnPa(k)} är anställd och upplagd i navet.`, { anstalldId: s.employeeId, losenord: s.losenord });
      }

      // ---------------------------------------------------------------- Kontakt och historik
      case "anteckning":
      case "ring":
      case "ej-svar": {
        const k = await kandidaten();
        if (!k) return svar({ fel: "Kandidaten finns inte." }, 404);
        const body = handling === "anteckning" ? str(b.text) : null;
        if (handling === "anteckning" && !body) return svar({ fel: "Skriv något först." }, 400);
        if (body && PNR.test(body)) return svar({ fel: "Det ser ut som ett personnummer. Navet sparar inga, så ta bort det." }, 400);
        const { error } = await db.from("candidate_note").insert({ candidate_id: k.id, kind: handling === "anteckning" ? "not" : handling === "ring" ? "ring" : "ej_svar", body, by_employee: mig });
        if (error) return svar({ fel: dbFel(error, "Det kunde inte sparas.") }, 400);
        if (handling === "ej-svar") await meddela(k.id, "ringt", "sms", text("ringt"));
        return klart(handling === "anteckning" ? "Anteckningen är sparad." : handling === "ring" ? "" : `Samtalet är sparat. SMS:et väntar på utskick: ${UTSKICK}`);
      }

      case "pool-fraga": {
        const k = await kandidaten();
        if (!k) return svar({ fel: "Kandidaten finns inte." }, 404);
        await db.from("candidate").update({ pool_asked_at: new Date().toISOString() }).eq("id", k.id);
        await meddela(k.id, "pool", "mejl", text("pool"));
        return klart(`Frågan väntar på utskick: ${UTSKICK} Ansökan sparas i talangpoolen först när ${fornamn(namnPa(k))} svarat ja.`);
      }
      case "pool-in":
      case "pool-ut": {
        // Repots sattTalangpool: samtycket får sitt datum i samma skrivning som flaggan.
        const k = await kandidaten();
        if (!k) return svar({ fel: "Kandidaten finns inte." }, 404);
        const pa = handling === "pool-in";
        const { error } = await db.from("candidate").update({ talent_pool: pa, talent_pool_consent: pa ? new Date().toISOString() : null }).eq("id", k.id);
        if (error) return svar({ fel: "Det kunde inte sparas." }, 400);
        return klart(pa ? `${fornamn(namnPa(k))} är i talangpoolen, med samtycke från i dag.` : `${fornamn(namnPa(k))} är inte längre i talangpoolen.`);
      }

      case "merit-ny": {
        const k = await kandidaten();
        if (!k) return svar({ fel: "Kandidaten finns inte." }, 404);
        const { error } = await db.from("candidate_merit_request").insert({ candidate_id: k.id, registered_by: mig });
        if (error) return svar({ fel: dbFel(error, "Begäran kunde inte sparas.") === "Det finns redan." ? "Det finns redan en obesvarad begäran." : "Begäran kunde inte sparas." }, 400);
        return klart("Begäran är registrerad.");
      }
      case "merit-svar": {
        const k = await kandidaten();
        if (!k) return svar({ fel: "Kandidaten finns inte." }, 404);
        const t = str(b.text, 4000);
        if (!t) return svar({ fel: "Skriv svaret." }, 400);
        const { data: oppen } = await db.from("candidate_merit_request").select("id").eq("candidate_id", k.id).is("answered_at", null).maybeSingle();
        if (!oppen) return svar({ fel: "Det finns ingen obesvarad begäran." }, 404);
        const { error } = await db.from("candidate_merit_request").update({ answered_at: new Date().toISOString(), answer_text: t, answered_by: mig }).eq("id", oppen.id);
        if (error) return svar({ fel: dbFel(error, "Svaret kunde inte sparas.") }, 400);
        await meddela(k.id, "merit", "mejl", t);
        return klart(`Svaret är sparat och väntar på utskick: ${UTSKICK}`);
      }

      // ---------------------------------------------------------------- Tider
      case "tider": {
        const d = String(b.d ?? "");
        if (!DATUM.test(d) || d < svensktDatum()) return svar({ fel: "Välj en dag från i dag och framåt." }, 400);
        const plats = str(b.plats, 120) || "Kontoret";
        const lista = (Array.isArray(b.lista) ? b.lista : []).map((x) => x as { s?: string; e?: string }).filter((x) => HM.test(String(x.s)) && HM.test(String(x.e)) && tmin(String(x.e)) > tmin(String(x.s))).slice(0, 40);
        if (!lista.length) return svar({ fel: "Inga tider att lägga till." }, 400);
        const { data: fanns } = await db.from("interview_slot").select("start_min, end_min").eq("day", d);
        const krock = lista.filter((x) => ((fanns ?? []) as { start_min: number; end_min: number }[]).some((y) => y.start_min < tmin(String(x.e)) && tmin(String(x.s)) < y.end_min));
        if (krock.length) return svar({ fel: `${krock.length === 1 ? "En tid krockar" : krock.length + " tider krockar"} med tider som redan finns den dagen.` }, 409);
        const { error } = await db.from("interview_slot").insert(lista.map((x) => ({ day: d, start_min: tmin(String(x.s)), end_min: tmin(String(x.e)), place: plats, created_by: mig })));
        if (error) return svar({ fel: dbFel(error, "Tiderna kunde inte sparas.") }, 400);
        return klart(`${lista.length} tider ${d} är lediga att boka.`);
      }
      case "tider-bort": {
        const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).filter((x) => UUID.test(x)).slice(0, 100);
        if (!ids.length) return svar({ fel: "Inga tider valda." }, 400);
        const { data: bokade } = await db.from("candidate_booking").select("slot_id").in("slot_id", ids).neq("status", "avbokad");
        const upptagna = new Set(((bokade ?? []) as { slot_id: string }[]).map((x) => x.slot_id));
        const bort = ids.filter((x) => !upptagna.has(x));
        if (bort.length) await db.from("interview_slot").delete().in("id", bort);
        return klart(`${bort.length === 1 ? "Tiden är borttagen" : bort.length + " lediga tider är borttagna"}.${upptagna.size ? " De bokade står kvar." : ""}`);
      }

      // ---------------------------------------------------------------- Tjänster och annonser
      case "tjanst": {
        const titel = str(b.titel, 120), antal = Number(b.antal), start = String(b.start ?? "");
        if (!titel) return svar({ fel: "Skriv en titel, till exempel Säljare, Halmstad." }, 400);
        if (!(Number.isInteger(antal) && antal >= 1 && antal <= 20)) return svar({ fel: "Antal ska vara mellan 1 och 20." }, 400);
        if (!DATUM.test(start) || start <= svensktDatum()) return svar({ fel: "Startdagen ska ligga framåt i tiden." }, 400);
        const kort = (titel.split(",")[1] || titel).trim().slice(0, 60);
        const bas = kort.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "tjanst";
        const { data: tagna } = await db.from("recruitment_position").select("slug").like("slug", `${bas}%`);
        const har = new Set(((tagna ?? []) as { slug: string }[]).map((x) => x.slug));
        let slug = bas.length >= 2 ? bas : `${bas}-1`;
        for (let i = 2; har.has(slug); i++) slug = `${bas}-${i}`;
        const { error } = await db.from("recruitment_position").insert({ slug, title: titel, short_title: kort, headcount: antal, start_date: start, created_by: mig });
        if (error) return svar({ fel: dbFel(error, "Tjänsten kunde inte sparas.") }, 400);
        return klart(`${titel} är öppen. Navet publicerar inga annonser, så anteckna var annonsen ligger när den är ute.`);
      }
      case "annons": {
        const tj = String(b.tj ?? ""), kanal = String(b.kanal ?? "");
        if (!UUID.test(tj)) return svar({ fel: "Tjänsten finns inte." }, 404);
        const falt: Record<string, unknown> = {};
        if (kanal === "stang") Object.assign(falt, { platsbanken_until: null, linkedin_until: null, page_open: false });
        else if (kanal === "sida") falt.page_open = b.pa === true;
        else if (kanal === "platsbanken" || kanal === "linkedin") {
          const till = String(b.till ?? "");
          if (!DATUM.test(till) || till < svensktDatum()) return svar({ fel: "Välj ett datum framåt i tiden." }, 400);
          falt[`${kanal}_until`] = till;
        } else return svar({ fel: "Okänd kanal." }, 400);
        const { error } = await db.from("recruitment_position").update(falt).eq("id", tj);
        if (error) return svar({ fel: "Det kunde inte sparas." }, 400);
        return klart(kanal === "stang" ? "Annonserna är antecknade som stängda, och ansökningssidan är stängd. De som redan sökt finns kvar." : kanal === "sida" ? (b.pa === true ? "Ansökningssidan är antecknad som öppen." : "Ansökningssidan är stängd.") : `Antecknat: annonsen på ${kanal === "platsbanken" ? "Platsbanken" : "LinkedIn"} gäller till ${falt[`${kanal}_until`]}. Navet publicerar den inte självt.`);
      }

      // ---------------------------------------------------------------- Texter och val
      case "mall": {
        const slug = String(b.slug ?? "");
        if (!MALLAR.includes(slug)) return svar({ fel: "Mallen finns inte." }, 404);
        if (b.aterstall === true) {
          await db.from("recruitment_template").delete().eq("slug", slug);
          return klart("Texten är återställd.");
        }
        const t = str(b.text, 4000);
        if (!t) return svar({ fel: "Mallen kan inte vara tom." }, 400);
        const { error } = await db.from("recruitment_template").upsert({ slug, body: t, updated_by: mig, updated_at: new Date().toISOString() });
        return error ? svar({ fel: "Texten kunde inte sparas." }, 400) : klart("");
      }
      case "jobbet": {
        const t = str(b.text, 4000);
        const { error } = await db.from("recruitment_policy").update({ job_text: t || null, updated_at: new Date().toISOString(), updated_by: mig }).eq("id", true);
        return error ? svar({ fel: "Texten kunde inte sparas." }, 400) : klart("");
      }
      case "gallring": {
        const m = Number(b.manader);
        if (![0, 12, 24].includes(m)) return svar({ fel: "Välj 12 eller 24 månader." }, 400);
        const dagar = m === 24 ? 730 : m === 12 ? 365 : null;
        const { error } = await db.from("recruitment_policy").update({ purge_after_days: dagar, updated_at: new Date().toISOString(), updated_by: mig }).eq("id", true);
        if (error) return svar({ fel: "Beslutet kunde inte sparas." }, 400);
        return klart(dagar ? `Beslutat: ${m} månader efter avslutad rekrytering. Det gäller processer som avslutas från i dag, och talangpoolen undantas.` : "Gallringsfristen är borttagen. Ingenting raderas förrän en ny är beslutad.");
      }
      case "be-om-tips": {
        const { data: salj } = await db.from("employee_role").select("employee_id, employee:employee_id(status)").eq("role", "salesperson");
        const till = ((salj ?? []) as unknown as { employee_id: string; employee: { status: string } | null }[]).filter((x) => x.employee && x.employee.status !== "offboarded").map((x) => x.employee_id);
        const n = await notifieraFlera(till, { av: mig, kalla: "rekrytering-tips-be", typ: "rekrytering", rubrik: "Känner du någon som skulle passa som säljare?", detalj: `${fornamn(jagNamn)} vill gärna ha tips. De hamnar i Rekrytering med källan Tips från anställd.`, href: "/rekrytering" });
        await db.from("recruitment_policy").update({ tips_asked_at: new Date().toISOString(), tips_asked_by: mig }).eq("id", true);
        return klart(`${n} säljare fick en notis: tipsa om någon som skulle passa.`);
      }
      case "tips": {
        // Alla inloggade får tipsa. Tipset blir en kandidat med källan tips (0030) och den som tipsat (0110).
        const namn = str(b.namn, 160).replace(/\s+/g, " ");
        const [fn, ...rest] = namn.split(" ");
        const kontakt = str(b.kontakt, 200), varfor = str(b.varfor);
        if (!fn || !rest.length) return svar({ fel: "Skriv för- och efternamn." }, 400);
        if (varfor.length < 10) return svar({ fel: "Skriv ett par meningar om varför." }, 400);
        if (PNR.test(varfor)) return svar({ fel: "Det ser ut som ett personnummer. Navet sparar inga, så ta bort det." }, 400);
        if (b.vet !== true) return svar({ fel: "Fråga hen först. Ingen ska bli uppringd utan att veta varför." }, 400);
        const epost = epostOk(kontakt) ? kontakt.toLowerCase() : str(b.epost, 200).toLowerCase();
        if (!epostOk(epost)) return svar({ fel: "Navet behöver en e-postadress till den du tipsar om. Skriv mejlet, och numret om du har det." }, 400);
        const tel = epostOk(kontakt) ? str(b.tel, 40) || null : kontakt.replace(/\D/g, "").length >= 8 ? kontakt : null;
        const { data: forsta } = await db.from("recruitment_position").select("id, title").is("closed_at", null).order("opened_at").limit(1);
        const pos = (forsta ?? [])[0] as { id: string; title: string } | undefined;
        const { data: ny, error } = await db.from("candidate").insert({
          first_name: fn, last_name: rest.join(" "), email: epost, phone: tel, source_slug: "tips", role_title: pos?.title ?? "Säljare", position_id: pos?.id ?? null,
          tipped_by: mig, tip_text: varfor, tip_consent_at: new Date().toISOString(), created_by: mig,
        }).select("id").single();
        if (error || !ny) return svar({ fel: dbFel(error, "Tipset kunde inte sparas. Försök igen.") }, 400);
        await notifieraFlera(await rekryteringskretsen(), {
          av: mig, kalla: "rekrytering-tips", typ: "rekrytering", rubrik: `Tips från ${fornamn(jagNamn)}: ${namn}`, detalj: varfor.slice(0, 120),
          href: `/rekrytering/${ny.id}`, objekt: { typ: "candidate", id: ny.id },
        });
        return klart(`Tack. Rekryteringen hör av sig till ${fornamn(namn)} inom två arbetsdagar.`);
      }

      default:
        return svar({ fel: "Okänd handling." }, 400);
    }
  } catch (e) {
    return svar({ fel: e instanceof Error ? e.message : "Något gick fel." }, 500);
  }
}
