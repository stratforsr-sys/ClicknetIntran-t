import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import { epostArKonfigurerad, skickaEpost, type Bilaga } from "@/lib/epost";
import { inbjudan } from "@/lib/ical";

/**
 * Nav 2.0: mejlen till kandidaterna (0110 `candidate_message`), genom Resend.
 *
 * ===========================================================================
 * BARA MEJL (beställaren 2026-10-18). Utkastets SMS-påminnelser går som mejl.
 * Rutten /nav2/rekrytering skriver raden och skickar det som ska gå nu. En
 * påminnelse före intervjun står som `vantar` i databasen tills dess tid kommer,
 * och utkorgsjobbet (`/api/jobb/utkorg`, varje minut) skickar den då. En
 * avbokning sätter raden till `avbruten`. Inget schemaläggs hos Resend: nyckeln
 * får bara skicka, så ett schemalagt brev går inte att avbryta (S14, 2026-10-23).
 *
 * FÖRHANDSVISNINGEN MEJLAR ALDRIG EN KANDIDAT. Den delar databas med
 * produktionen, så rutten skriver en rad i förhandsvisningen som `fel` med
 * orsaken redan när den läggs in, och här blir den `fel` om den ändå kommer
 * hit. Annars hade produktionens jobb skickat den senare.
 *
 * EN GÅNG (granskningen F1-7): en rad tas med vantar → skickar innan den
 * skickas, så att rutten och minutjobbet aldrig skickar samma rad. Samma regel som utkorgens
 * `kundmejlTillatet`: bara produktionen, eller en adress på resend.dev.
 *
 * En mall utan text skickas inte: rutten skriver ingen rad.
 * ===========================================================================
 */

/** Hur långt fram en rad får ligga och ändå tas nu: minutjobbet går varje minut. */
const NU_MARGINAL_MS = 60_000;

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

export type Utskicksutfall = { skickade: number; kvar: number; fel: string[] };

/** Skicka de rader som väntar och vars tid har kommit. Kastar aldrig. */
export async function skickaKandidatmejl(ids: number[]): Promise<Utskicksutfall> {
  const ut: Utskicksutfall = { skickade: 0, kvar: 0, fel: [] };
  if (!ids.length) return ut;
  const db = supabaseAdmin();
  // Raderna tas med en villkorad uppdatering, vantar → skickar (0228, granskningen
  // F1-7). Rutten och minutjobbet kan gå samtidigt, men bara den som flyttade
  // raden skickar den. En rad vars tid inte kommit tas inte: den väntar här,
  // inte hos Resend (S14: nyckeln får bara skicka, så ett schemalagt brev går
  // inte att avbryta).
  const { data, error } = await db
    .from("candidate_message")
    .update({ status: "skickar" })
    .in("id", ids)
    .eq("status", "vantar")
    .lte("send_after", new Date(Date.now() + NU_MARGINAL_MS).toISOString())
    .select("*");
  if (error) {
    ut.fel.push(`Raderna kunde inte tas: ${error.message}`);
    return ut;
  }
  const rader = (data ?? []) as unknown as Rad[];
  const { count: kvar } = await db.from("candidate_message").select("id", { count: "exact", head: true }).in("id", ids).eq("status", "vantar");
  ut.kvar = kvar ?? 0;
  if (!rader.length) return ut;

  const kandIds = [...new Set(rader.map((r) => r.candidate_id))];
  const avsIds = [...new Set(rader.map((r) => r.created_by).filter((v): v is string => !!v))];
  const bokIds = [...new Set(rader.map((r) => r.booking_id).filter((v): v is string => !!v))];
  const [{ data: kand, error: kandFel }, { data: avs }, { data: bok }] = await Promise.all([
    db.from("candidate").select("id, first_name, last_name, email").in("id", kandIds),
    avsIds.length ? db.from("employee").select("id, first_name, last_name, email").in("id", avsIds) : Promise.resolve({ data: [] }),
    bokIds.length ? db.from("candidate_booking").select("id, kind, day, start_min, end_min, place").in("id", bokIds) : Promise.resolve({ data: [] }),
  ]);
  const kandidat = new Map(((kand ?? []) as { id: string; first_name: string; last_name: string; email: string | null }[]).map((k): [string, typeof k] => [k.id, k]));
  const avsandare = new Map(((avs ?? []) as { id: string; first_name: string; last_name: string; email: string | null }[]).map((p): [string, typeof p] => [p.id, p]));
  const bokning = new Map(((bok ?? []) as Bokning[]).map((b): [string, Bokning] => [b.id, b]));

  const fel = async (r: Rad, orsak: string) => {
    await db.from("candidate_message").update({ status: "fel", error: orsak.slice(0, 500) }).eq("id", r.id).eq("status", "skickar");
    ut.fel.push(orsak);
  };
  // Det som tagits men inte provats lämnas tillbaka (ett tillfälligt fel eller ett undantag), så att nästa körning tar det.
  const klara = new Set<number>();
  const lamnaTillbaka = async () => {
    const kvarIds = rader.map((r) => r.id).filter((id) => !klara.has(id));
    if (kvarIds.length) await db.from("candidate_message").update({ status: "vantar" }).in("id", kvarIds).eq("status", "skickar");
  };
  if (kandFel) {
    ut.fel.push(`Kandidaterna kunde inte läsas: ${kandFel.message}`);
    await lamnaTillbaka();
    return ut;
  }

  try {
  for (const r of rader) {
    klara.add(r.id);
    const k = kandidat.get(r.candidate_id);
    if (!k) { await fel(r, "Kandidaten finns inte längre."); continue; }
    if (!k.email) { await fel(r, "Kandidaten har ingen e-postadress."); continue; }
    if (!kandidatmejlTillatet(k.email)) { await fel(r, "Förhandsvisningen mejlar inte kandidater."); continue; }
    if (!epostArKonfigurerad()) { await fel(r, "Utskicket är inte konfigurerat (RESEND_API_KEY eller EMAIL_FROM saknas)."); continue; }

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

    const u = await skickaEpost({ till: k.email, amne, text: r.body, svaraTill: fran?.email ?? undefined, bilagor });
    if (!u.skickat) { await fel(r, u.orsak); continue; }
    const { error: efter } = await db.from("candidate_message").update({ status: "skickad", resend_id: u.id || null, sent_at: new Date().toISOString(), error: null }).eq("id", r.id);
    // Mejlet har gått. Raden står kvar som `skickar` och skickas aldrig igen; felet syns i svaret.
    if (efter) ut.fel.push(`Mejlet gick ut, men raden kunde inte uppdateras: ${efter.message}`);
    ut.skickade++;
  }
  } catch (e) {
    // Raden som kastade räknas som provad (den kan ha gått ut); resten lämnas tillbaka.
    ut.fel.push(e instanceof Error ? e.message : "Utskicket avbröts.");
  } finally {
    await lamnaTillbaka();
  }
  return ut;
}

/**
 * Avbryt det som inte gått ut: för en bokning, eller allt för en kandidat.
 * Bara rader som väntar, med en villkorad uppdatering: en rad som minutjobbet
 * just tagit (`skickar`) är redan på väg och rörs inte. Inget går till Resend,
 * eftersom inget schemaläggs där.
 */
export async function avbrytKandidatmejl(filter: { bokning?: string; kandidat?: string; mallar?: string[] }): Promise<number> {
  const db = supabaseAdmin();
  let q = db.from("candidate_message").update({ status: "avbruten" }).eq("status", "vantar");
  if (filter.bokning) q = q.eq("booking_id", filter.bokning);
  if (filter.kandidat) q = q.eq("candidate_id", filter.kandidat);
  if (filter.mallar?.length) q = q.in("template", filter.mallar);
  const { data } = await q.select("id");
  return (data ?? []).length;
}

/** Utkorgsjobbet, varje minut: det som väntat på sin tid (påminnelserna före intervjun). */
export async function tomKandidatko(antal = 50): Promise<Utskicksutfall> {
  const { data } = await supabaseAdmin()
    .from("candidate_message")
    .select("id")
    .eq("status", "vantar")
    .lte("send_after", new Date(Date.now() + NU_MARGINAL_MS).toISOString())
    .order("send_after")
    .limit(antal);
  return skickaKandidatmejl(((data ?? []) as { id: number }[]).map((r) => r.id));
}
