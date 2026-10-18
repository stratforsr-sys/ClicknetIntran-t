import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import { avbrytSchemalagt, epostArKonfigurerad, skickaEpost, type Bilaga } from "@/lib/epost";
import { inbjudan } from "@/lib/ical";

/**
 * Nav 2.0: mejlen till kandidaterna (0110 `candidate_message`), genom Resend.
 *
 * ===========================================================================
 * BARA MEJL (beställaren 2026-10-18). Utkastets SMS-påminnelser går som mejl.
 * Rutten /nav2/rekrytering skriver raden och skickar direkt. En påminnelse
 * före intervjun schemaläggs hos Resend (`scheduled_at`), och en avbokning
 * avbryter den där. Resend håller ett brev i högst 30 dagar, så det som ligger
 * längre fram står som `vantar` tills utkorgsjobbet (`/api/jobb/utkorg`, varje
 * minut) schemalägger det.
 *
 * FÖRHANDSVISNINGEN MEJLAR ALDRIG EN KANDIDAT. Den delar databas med
 * produktionen, så en rad som skrivs där blir `fel` med orsaken direkt. Annars
 * hade produktionens jobb skickat den senare. Samma regel som utkorgens
 * `kundmejlTillatet`: bara produktionen, eller en adress på resend.dev.
 *
 * En mall utan text skickas inte: rutten skriver ingen rad.
 * ===========================================================================
 */

/** Resend tar emot ett schemalagt brev upp till 30 dagar fram. En dags marginal. */
export const RESEND_DAGAR = 29;

const AMNE: Record<string, string> = {
  bekr: "Tack för din ansökan till Clicknet",
  bokad: "Din intervju hos Clicknet",
  sms24: "Påminnelse: din intervju hos Clicknet i morgon",
  sms2: "Påminnelse: din intervju hos Clicknet i dag",
  avslag1: "Din ansökan till Clicknet",
  avslag2: "Din ansökan till Clicknet",
  erbj: "Erbjudande från Clicknet",
  pool: "Får vi höra av oss igen?",
  ringt: "Vi försökte nå dig",
  pamin: "Påminnelse om erbjudandet från Clicknet",
  avbokad: "Din intervju hos Clicknet är avbokad",
  merit: "Svar på din begäran om meriter",
};

const BOKNAMN: Record<string, string> = { tel: "Telefonsamtal", int1: "Intervju", int2: "Andra intervjun" };

export const kandidatmejlTillatet = (adress?: string | null) =>
  process.env.VERCEL_ENV === "production" || /@resend\.dev$/i.test(adress?.trim() ?? "");

/** Vad vyn ska säga om utskicket. */
export type Utskickslage = "pa" | "forhandsvisning" | "av";
export function utskickslage(): Utskickslage {
  if (!epostArKonfigurerad()) return "av";
  return process.env.VERCEL_ENV === "production" ? "pa" : "forhandsvisning";
}

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
/** En svensk väggklocka som tidpunkt (sommartid och vintertid). */
export function svIso(d: string, min: number): string {
  const gissning = new Date(`${d}T${hm(min)}:00Z`);
  const off = new Date(gissning.toLocaleString("en-US", { timeZone: "Europe/Stockholm" })).getTime() - new Date(gissning.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  return new Date(gissning.getTime() - off).toISOString();
}

type Rad = {
  id: number; candidate_id: string; booking_id: string | null; template: string; channel: string; body: string; status: string;
  send_after: string; resend_id: string | null; created_by: string | null;
};
type Bokning = { id: string; kind: string; day: string; start_min: number; end_min: number; place: string };

export type Utskicksutfall = { skickade: number; schemalagda: number; kvar: number; fel: string[] };

/** Skicka (eller schemalägg) raderna som väntar. Kastar aldrig. */
export async function skickaKandidatmejl(ids: number[]): Promise<Utskicksutfall> {
  const ut: Utskicksutfall = { skickade: 0, schemalagda: 0, kvar: 0, fel: [] };
  if (!ids.length) return ut;
  const db = supabaseAdmin();
  const { data } = await db.from("candidate_message").select("*").in("id", ids).eq("status", "vantar");
  const rader = (data ?? []) as unknown as Rad[];
  if (!rader.length) return ut;

  const kandIds = [...new Set(rader.map((r) => r.candidate_id))];
  const avsIds = [...new Set(rader.map((r) => r.created_by).filter((v): v is string => !!v))];
  const bokIds = [...new Set(rader.map((r) => r.booking_id).filter((v): v is string => !!v))];
  const [{ data: kand }, { data: avs }, { data: bok }] = await Promise.all([
    db.from("candidate").select("id, first_name, last_name, email").in("id", kandIds),
    avsIds.length ? db.from("employee").select("id, first_name, last_name, email").in("id", avsIds) : Promise.resolve({ data: [] }),
    bokIds.length ? db.from("candidate_booking").select("id, kind, day, start_min, end_min, place").in("id", bokIds) : Promise.resolve({ data: [] }),
  ]);
  const kandidat = new Map(((kand ?? []) as { id: string; first_name: string; last_name: string; email: string | null }[]).map((k): [string, typeof k] => [k.id, k]));
  const avsandare = new Map(((avs ?? []) as { id: string; first_name: string; last_name: string; email: string | null }[]).map((p): [string, typeof p] => [p.id, p]));
  const bokning = new Map(((bok ?? []) as Bokning[]).map((b): [string, Bokning] => [b.id, b]));

  const fel = async (r: Rad, orsak: string) => {
    await db.from("candidate_message").update({ status: "fel", error: orsak.slice(0, 500) }).eq("id", r.id);
    ut.fel.push(orsak);
  };
  const grans = Date.now() + RESEND_DAGAR * 864e5;

  for (const r of rader) {
    const k = kandidat.get(r.candidate_id);
    if (!k) continue;
    if (!k.email) { await fel(r, "Kandidaten har ingen e-postadress."); continue; }
    if (!kandidatmejlTillatet(k.email)) { await fel(r, "Förhandsvisningen mejlar inte kandidater."); continue; }
    if (!epostArKonfigurerad()) { await fel(r, "Utskicket är inte konfigurerat (RESEND_API_KEY eller EMAIL_FROM saknas)."); continue; }
    const nar = Date.parse(r.send_after);
    if (nar > grans) { ut.kvar++; continue; }
    const schemalagt = nar > Date.now() + 60_000 ? new Date(nar).toISOString() : undefined;

    const fran = r.created_by ? avsandare.get(r.created_by) : undefined;
    const b = r.booking_id ? bokning.get(r.booking_id) : undefined;
    let bilagor: Bilaga[] | undefined;
    if (r.channel === "mejl_ics" && b && fran?.email) {
      const metod = r.template === "avbokad" ? "CANCEL" : "REQUEST";
      const ics = inbjudan(
        { id: `rekrytering-${b.id}`, sekvens: metod === "CANCEL" ? 1 : 0, rubrik: `${BOKNAMN[b.kind] ?? "Intervju"} hos Clicknet`, start: new Date(svIso(b.day, b.start_min)), minuter: b.end_min - b.start_min, plats: b.place },
        metod,
        { namn: `${fran.first_name} ${fran.last_name}`.trim(), epost: fran.email },
        { namn: `${k.first_name} ${k.last_name}`.trim(), epost: k.email, svara: true },
      );
      bilagor = [{ filnamn: "intervju.ics", innehall: ics, typ: `text/calendar; method=${metod}` }];
    }
    const amne = r.template === "bokad" && b ? `${AMNE.bokad} ${b.day} kl. ${hm(b.start_min)}` : AMNE[r.template] ?? "Från Clicknet";

    const u = await skickaEpost({ till: k.email, amne, text: r.body, svaraTill: fran?.email ?? undefined, schemalagtVid: schemalagt, bilagor });
    if (!u.skickat) { await fel(r, u.orsak); continue; }
    await db.from("candidate_message").update({ status: schemalagt ? "schemalagd" : "skickad", resend_id: u.id || null, sent_at: schemalagt ? null : new Date().toISOString(), error: null }).eq("id", r.id);
    if (schemalagt) ut.schemalagda++;
    else ut.skickade++;
  }
  return ut;
}

/** Avbryt det som inte gått ut: för en bokning, eller allt för en kandidat. */
export async function avbrytKandidatmejl(filter: { bokning?: string; kandidat?: string; mallar?: string[] }): Promise<number> {
  const db = supabaseAdmin();
  let q = db.from("candidate_message").select("id, status, resend_id").in("status", ["vantar", "schemalagd"]);
  if (filter.bokning) q = q.eq("booking_id", filter.bokning);
  if (filter.kandidat) q = q.eq("candidate_id", filter.kandidat);
  if (filter.mallar?.length) q = q.in("template", filter.mallar);
  const { data } = await q;
  let n = 0;
  for (const r of (data ?? []) as { id: number; status: string; resend_id: string | null }[]) {
    if (r.status === "schemalagd" && r.resend_id) {
      const u = await avbrytSchemalagt(r.resend_id);
      if (!u.skickat) {
        await db.from("candidate_message").update({ error: `Kunde inte avbrytas hos Resend: ${u.orsak}`.slice(0, 500) }).eq("id", r.id);
        continue;
      }
    }
    await db.from("candidate_message").update({ status: "avbruten" }).eq("id", r.id);
    n++;
  }
  return n;
}

/** Utkorgsjobbet: det som väntat för att det låg för långt fram. */
export async function tomKandidatko(antal = 50): Promise<Utskicksutfall> {
  const { data } = await supabaseAdmin()
    .from("candidate_message")
    .select("id")
    .eq("status", "vantar")
    .lte("send_after", new Date(Date.now() + RESEND_DAGAR * 864e5).toISOString())
    .order("send_after")
    .limit(antal);
  return skickaKandidatmejl(((data ?? []) as { id: number }[]).map((r) => r.id));
}
