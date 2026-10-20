import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { svenskDygnsstart, svensktDatum } from "@/lib/klocka";
import { rodaDagar } from "@/lib/saljtakt";
import { notifiera } from "@/lib/notishandelse-server";
import { pushaTill } from "./push";
import { ledigaDen } from "./hem-kvall";
import { SKRIVLAGE } from "./skrivlage";

/**
 * Nav 2.0 (0098), Utbildning: påminnelserna och teamets veckomål.
 *
 * ===========================================================================
 * REPETITIONEN (beslut.md punkt 4). En påminnelse klockan man valt
 * (`nav_preference` `utb.reptid`, annars 08:15), på arbetsdagar, bara om man
 * har frågor som förfaller och inte redan svarat på någon i dag, och inte om
 * man är ledig eller sjuk. Den står i klockan (`utbildning-repetition`) och
 * går som Web Push till de enheter man slagit på, som startsidans kvällsnotis
 * (`push.ts`). En gång per person och dag (`push_sent` `utb-rep`, raden först).
 *
 * CERTIFIKATEN. En månad innan ett certifikat går ut, en gång per certifikat
 * (`certification.reminded_at`), om `utb.certpam` inte är avstängt. Notis i
 * klockan och mejl via Resend (`utbildning-certifikat` står i MEJLKALLOR).
 * Ett förnyat certifikat är en ny rad, så nästa påminnelse kommer av sig själv.
 *
 * Körs av dagtidsjobbet (pg_cron var kvart, vardagar 05–19 UTC), och bara när
 * `SKRIVLAGE.utbildning` är på. pg_cron ringer produktionen, så på grenen
 * körs det här aldrig av sig självt.
 * ===========================================================================
 */

const AKTIV = ["active", "onboarding"];
const MAN = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const REDAKTOR = ["sales_manager", "admin", "ceo"];
/** Dagens repetition tar högst tre frågor (ndutb.js), så en vecka är högst femton. */
export const VECKOTAK = 15;

export type Repfraga = { id: string; due: string | null; team: boolean };

/**
 * Varje persons frågor i repetitionen, som `byggUtbildning` räknar dem: frågor
 * med facit ur prov personen klarat (alla publicerade för den som får redigera
 * kurserna), och teamets. `due` är nästa gång enligt senaste svaret före
 * `fore`, null om frågan aldrig besvarats.
 */
export async function repetitionsfragor(db: SupabaseClient, ids: string[], fore: string): Promise<Map<string, Repfraga[]>> {
  const ut = new Map<string, Repfraga[]>(ids.map((id) => [id, []]));
  if (!ids.length) return ut;
  const dag = svensktDatum(fore);
  const [{ data: kurser }, { data: forsok }, { data: roller }, { data: svar }, { data: team }] = await Promise.all([
    db.from("course").select("id").eq("status", "published"),
    db.from("course_attempt").select("employee_id, module_id").in("employee_id", ids).eq("passed", true).lt("created_at", fore),
    db.from("employee_role").select("employee_id, role").in("employee_id", ids).in("role", REDAKTOR),
    db.from("learning_answer").select("employee_id, question_id, next_due, answered_at").in("employee_id", ids).lt("answered_at", fore).order("answered_at", { ascending: false }).limit(20000),
    db.from("team_repetition").select("question_id").lt("added_at", fore).gte("until", dag),
  ]);
  const kursIds = ((kurser ?? []) as { id: string }[]).map((k) => k.id);
  if (!kursIds.length) return ut;
  const { data: moduler } = await db.from("course_module").select("id").in("course_id", kursIds);
  const modIds = ((moduler ?? []) as { id: string }[]).map((m) => m.id);
  const { data: fragor } = modIds.length ? await db.from("quiz_question").select("id, module_id, quiz_option(is_correct)").in("module_id", modIds) : { data: [] };
  const medFacit = ((fragor ?? []) as unknown as { id: string; module_id: string; quiz_option: { is_correct: boolean }[] }[]).filter((f) => f.quiz_option.some((o) => o.is_correct));
  const redaktor = new Set(((roller ?? []) as { employee_id: string }[]).map((r) => r.employee_id));
  const klarade = new Map<string, Set<string>>();
  for (const f of (forsok ?? []) as { employee_id: string; module_id: string }[]) klarade.set(f.employee_id, (klarade.get(f.employee_id) ?? new Set<string>()).add(f.module_id));
  const senast = new Map<string, string>();
  for (const s of (svar ?? []) as { employee_id: string; question_id: string; next_due: string }[]) {
    const k = `${s.employee_id}:${s.question_id}`;
    if (!senast.has(k)) senast.set(k, s.next_due);
  }
  const teamSet = new Set(((team ?? []) as { question_id: string }[]).map((t) => t.question_id));
  for (const id of ids) {
    const mina = klarade.get(id);
    ut.set(id, medFacit.filter((f) => redaktor.has(id) || mina?.has(f.module_id)).map((f) => ({ id: f.id, due: senast.get(`${id}:${f.id}`) ?? null, team: teamSet.has(f.id) })));
  }
  return ut;
}

/** Frågor som förfaller senast `dag`: aldrig besvarade, förfallna, och teamets. */
export const forfallerSenast = (fragor: Repfraga[], dag: string) => fragor.filter((f) => f.due === null || f.due <= dag || f.team).length;

/**
 * Teamets veckomål (beställaren 2026-10-20, U2): alla frågor som förfaller
 * under veckan för var och en, högst femton per person, räknat som det såg ut
 * på måndagen. Målet står alltså still hela veckan, växer när fler prov klaras
 * och går alltid att nå. Inget sätts för hand.
 */
export async function veckomal(db: SupabaseClient, mandag: string): Promise<number> {
  const { data: pers } = await db.from("employee").select("id").in("status", AKTIV);
  const ids = ((pers ?? []) as { id: string }[]).map((p) => p.id);
  const fredag = new Date(Date.parse(`${mandag}T12:00:00Z`) + 4 * 86400000).toISOString().slice(0, 10);
  const fragor = await repetitionsfragor(db, ids, svenskDygnsstart(new Date(`${mandag}T12:00:00Z`)));
  let mal = 0;
  for (const f of fragor.values()) mal += Math.min(VECKOTAK, forfallerSenast(f, fredag));
  return mal;
}

/** Notisens text, för klockan och för enhetens service worker. */
export function repText(antal: number): { titel: string; text: string } {
  const n = Math.min(3, antal);
  return { titel: `Dagens repetition: ${n} ${n === 1 ? "fråga" : "frågor"}`, text: "En minut eller två. Tryck för att börja." };
}

function klockan(nu: Date): { dag: string; min: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(nu).map((x) => [x.type, x.value]));
  return { dag: svensktDatum(nu), min: +p.hour * 60 + +p.minute };
}
const arbetsdag = (d: string) => { const v = new Date(`${d}T12:00:00Z`).getUTCDay(); return v !== 0 && v !== 6 && !rodaDagar(+d.slice(0, 4)).has(d); };
const minuter = (t: unknown) => (typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? +t.slice(0, 2) * 60 + +t.slice(3) : 8 * 60 + 15);
/** Påminnelsen går från klockslaget och två timmar framåt, så att ett missat jobbvarv inte tappar den. */
const FONSTER = 120;

export type Utbkvitto = {
  rep: { kandidater: number; lediga: number; skickade: number; enheter: number; fel: string[] };
  cert: { paminda: number; fel: string | null };
};

/** Dagtidsjobbets steg. Bakom `SKRIVLAGE.utbildning`. */
export async function korUtbildningsPaminnelser(db: SupabaseClient, nu: Date = new Date()): Promise<Utbkvitto | null> {
  if (!SKRIVLAGE.utbildning) return null;
  return { rep: await repetitionen(db, nu), cert: await certifikaten(db, nu) };
}

async function repetitionen(db: SupabaseClient, nu: Date): Promise<Utbkvitto["rep"]> {
  const ut: Utbkvitto["rep"] = { kandidater: 0, lediga: 0, skickade: 0, enheter: 0, fel: [] };
  const k = klockan(nu);
  if (!arbetsdag(k.dag)) return ut;
  const [{ data: pers }, { data: tider }, { data: skickat }, { data: idag }] = await Promise.all([
    db.from("employee").select("id").in("status", AKTIV),
    db.from("nav_preference").select("employee_id, value").eq("key", "utb.reptid"),
    db.from("push_sent").select("employee_id").eq("kind", "utb-rep").eq("day", k.dag),
    db.from("learning_answer").select("employee_id").gte("answered_at", svenskDygnsstart(nu)),
  ]);
  const tid = new Map(((tider ?? []) as { employee_id: string; value: unknown }[]).map((t): [string, number] => [t.employee_id, minuter(t.value)]));
  const klara = new Set([...((skickat ?? []) as { employee_id: string }[]), ...((idag ?? []) as { employee_id: string }[])].map((x) => x.employee_id));
  const ids = ((pers ?? []) as { id: string }[]).map((p) => p.id).filter((id) => {
    const t = tid.get(id) ?? minuter(null);
    return !klara.has(id) && k.min >= t && k.min < t + FONSTER;
  });
  if (!ids.length) return ut;
  const fragor = await repetitionsfragor(db, ids, nu.toISOString());
  const kandidater = ids.filter((id) => forfallerSenast(fragor.get(id) ?? [], k.dag) > 0);
  const lediga = await ledigaDen(db, kandidater, k.dag);
  ut.kandidater = kandidater.length;
  ut.lediga = lediga.size;
  for (const id of kandidater.filter((x) => !lediga.has(x))) {
    // Raden först: hellre en missad påminnelse än två samma dag om jobbet körs två gånger samtidigt.
    const { error } = await db.from("push_sent").insert({ employee_id: id, kind: "utb-rep", day: k.dag });
    if (error) { ut.fel.push(error.message); continue; }
    const t = repText(forfallerSenast(fragor.get(id) ?? [], k.dag));
    await notifiera({ till: id, av: null, kalla: "utbildning-repetition", typ: "kurs", rubrik: t.titel, detalj: t.text, href: "/utbildning" });
    const p = await pushaTill(db, id);
    if (p.enheter) await db.from("push_sent").update({ devices: p.ok }).eq("employee_id", id).eq("kind", "utb-rep").eq("day", k.dag);
    ut.skickade++;
    ut.enheter += p.ok;
    ut.fel.push(...p.fel);
  }
  return ut;
}

async function certifikaten(db: SupabaseClient, nu: Date): Promise<Utbkvitto["cert"]> {
  const om = new Date(nu);
  om.setUTCMonth(om.getUTCMonth() + 1);
  const { data, error } = await db.from("certification").select("id, employee_id, course_id, issued_at, expires_at").is("reminded_at", null).not("expires_at", "is", null).gt("expires_at", nu.toISOString()).lte("expires_at", om.toISOString());
  if (error) return { paminda: 0, fel: error.message };
  const rader = (data ?? []) as { id: string; employee_id: string; course_id: string; issued_at: string; expires_at: string }[];
  if (!rader.length) return { paminda: 0, fel: null };
  const pids = [...new Set(rader.map((r) => r.employee_id))], kids = [...new Set(rader.map((r) => r.course_id))];
  const [{ data: pers }, { data: av }, { data: kurser }, { data: alla }] = await Promise.all([
    db.from("employee").select("id").in("id", pids).in("status", AKTIV),
    db.from("nav_preference").select("employee_id, value").eq("key", "utb.certpam").in("employee_id", pids),
    db.from("course").select("id, slug, title").in("id", kids),
    db.from("certification").select("employee_id, course_id, issued_at").in("employee_id", pids).in("course_id", kids),
  ]);
  const aktiva = new Set(((pers ?? []) as { id: string }[]).map((p) => p.id));
  const avstangd = new Set(((av ?? []) as { employee_id: string; value: unknown }[]).filter((p) => p.value === false).map((p) => p.employee_id));
  const kurs = new Map(((kurser ?? []) as { id: string; slug: string; title: string }[]).map((k) => [k.id, k]));
  const certs = (alla ?? []) as { employee_id: string; course_id: string; issued_at: string }[];
  let paminda = 0;
  for (const r of rader) {
    const k = kurs.get(r.course_id);
    if (!k || !aktiva.has(r.employee_id) || avstangd.has(r.employee_id)) continue;
    // Ett nyare certifikat i samma kurs har redan ersatt det här.
    if (certs.some((c) => c.employee_id === r.employee_id && c.course_id === r.course_id && c.issued_at > r.issued_at)) continue;
    // Markeringen först, och bara den som får raden skickar: en gång per certifikat.
    const { data: tagen } = await db.from("certification").update({ reminded_at: nu.toISOString() }).eq("id", r.id).is("reminded_at", null).select("id");
    if (!tagen?.length) continue;
    const d = svensktDatum(r.expires_at);
    await notifiera({ till: r.employee_id, av: null, kalla: "utbildning-certifikat", typ: "kurs", rubrik: `Certifikatet i ${k.title} går ut ${+d.slice(8)} ${MAN[+d.slice(5, 7) - 1]}`, detalj: "Förnya det med fem frågor i Utbildning.", href: `/utbildning/${k.slug}`, objekt: { typ: "certification", id: r.id } });
    paminda++;
  }
  return { paminda, fel: null };
}
