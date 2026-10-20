import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fullName, hasRole, type CurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { svensktDatum, svenskKlocka } from "@/lib/klocka";
import { rodaDagar } from "@/lib/saljtakt";
import { forfallodag } from "@/lib/utbildning";
import { MINSTA_SVAR, provlage, type Provlage } from "@/lib/prov";
import { minuterFor, modulTillSteg, svit, type NdFraga, type NdSkriftFraga, type NdSteg } from "./utbildningforma";
import { veckan } from "./utbildning-paminnelser";
import { SKRIVLAGE } from "./skrivlage";

/**
 * Nav 2.0: Utbildning, med samma kurser och behörighet som /utbildning.
 *
 * Kurserna läses med RLS (publicerade i målgruppen). Modulerna blir utkastets
 * lektionssteg (`utbildningforma.ts`). Facit följer bara med för prov som
 * personen redan klarat, som i repot.
 *
 * Det nya (0097): svaren i repetitionen och lektionerna (kunskapskartan,
 * repetition i rad, nästa gång en fråga kommer tillbaka), regelboken,
 * anteckningarna, lektionsbetygen, självskattningen av rollspel, teamets
 * repetition och föreläsningarna.
 *
 * Steg 2 (0098, beställaren 2026-10-20): en fråga räknas till provmodulens
 * färdighet (`learning_meta.moduler`), med kursens första som reserv. Sviten
 * har frysdagar (`svit` i utbildningforma.ts), och teamets veckomål räknas
 * själv (`veckan` i utbildning-paminnelser.ts), bara för säljarna.
 *
 * Skriftliga prov (beställaren 2026-10-20, svar 8; tabellerna från 0067): en
 * fritextmodul har sina frågor som steg och personens senaste försök i
 * `skriftligt` (svaren, läget, returen och betyget). Frågorna läses med service
 * role, eftersom `essay_question` är stängd för klienten: rättarstödet följer
 * bara med i Teamets kö (`team.prov`), som byggs för dem som får rätta.
 */

const FARDIGHETER = ["oppning", "behov", "invand", "avslut", "efter", "produkt", "regler"] as const;
const KIND: Record<string, "las" | "quiz" | "ovn" | "rollspel"> = { reading: "las", ovning: "ovn", quiz: "quiz", roleplay: "rollspel", fritext: "quiz" };

export type NdKurs = {
  id: string;
  dokId: string;
  t: string;
  typ: string;
  min: number;
  dagar: number | null;
  skills: string[];
  resa: number | null;
  rutin: string | null;
  moduler: [string, string, number, string][];
  klara: number;
  frist: string | null;
  obl: boolean;
  cert: number | null;
  certTill: string | null;
  certUtfardat: string | null;
  agare: string;
  besk: string;
  ny: boolean;
  grans: number;
  /** Timmar till nästa försök efter ett underkänt prov. */
  vanta: number;
  /** Rekommenderad för hela teamet av chefen (nav_setting utb.rekommenderad). */
  rek: boolean;
  sparr: Record<string, string>;
  forsok: Record<string, { poang: number; godkant: boolean }>;
};

/** Mitt senaste skriftliga prov i en modul. */
export type NdSkriftligt = {
  lage: Provlage;
  grans: number;
  minsta: number;
  svar: Record<string, string>;
  poang: Record<string, number | null>;
  kommentar: Record<string, string>;
  retur: { note: string; datum: string } | null;
  resultat: { poang: number; godkant: boolean; aterkoppling: string | null; rattad: string } | null;
};

/** Ett inlämnat skriftligt prov i Teamets kö, med rättarstödet. */
export type NdProvRattning = {
  id: string;
  namn: string;
  /** Den inloggades eget prov: visas, men rättas av någon annan i säljledningen. */
  egen: boolean;
  modul: string;
  kurs: string;
  grans: number;
  inlamnad: string;
  returer: number;
  fragor: { id: string; nr: number; q: string; stod: string | null; max: number; svar: string; kommentar: string | null }[];
};

export type NdRepFraga = { id: string; skill: string | null; kalla: string; kurs: string; q: string; alt: string[]; oids: string[]; ratt: number; team: boolean };

export type NdUtbildning = {
  /** SKRIVLAGE.utbildning: false = läsläge, knapparna säger att inget sparas. */
  skriv: boolean;
  kurser: NdKurs[];
  lektioner: Record<string, { kurs: string; modul: number; titel: string; steg: NdSteg[]; skriftligt?: NdSkriftligt }>;
  repetition: NdRepFraga[];
  forfallna: string[];
  /** Nästa dag en fråga kommer tillbaka, när inget är förfallet i dag. */
  nastaDag: string | null;
  kunskap: Record<string, [number | null, string]>;
  forraVeckan: Record<string, number | null>;
  streak: number;
  bast: number;
  /** Sparade frysdagar, högst två. */
  frys: number;
  heat: number[];
  repIdag: boolean;
  repTid: string;
  dolda: string[];
  certPam: boolean;
  regelbok: [string, string][];
  anteckningar: Record<string, string>;
  betyg: Record<string, number>;
  rollspel: {
    id: string;
    kurs: string;
    t: string;
    kund: string;
    skill: string | null;
    kriterier: [string, number, string, number][];
    status: "ny" | "inlamnad" | "bedomt";
    datum: string | null;
    bedomare: string | null;
    kommentar: string | null;
    /** Modulens text (uppgiften) och kundens repliker ur dess citat. */
    md: string;
    repliker: string[];
    sjalv: Record<string, number>;
    poang: Record<string, number>;
  }[];
  forelasningar: {
    id: string;
    t: string;
    nar: string;
    startar: string;
    langd: string;
    vem: string;
    vemId: string | null;
    var: string;
    forberedelse: string;
    nyckel: string[];
    skill: string | null;
    kommande: boolean;
    anmald: boolean;
    uppfoljning: [string, string, string][];
    fragaSkickad: boolean;
    delat: boolean;
    insikter: { vem: string; text: string }[];
    inspelning: string | null;
  }[];
  teamVecka: { gjort: number; mal: number | null; egna: number };
  team: null | {
    personer: { id: string; namn: string; kurser: Record<string, [number, number]> }[];
    obligatoriska: { id: string; t: string }[];
    attBedoma: { id: string; namn: string; modul: string; kurs: string; inlamnad: string; fil: string | null; kriterier: { id: string; t: string; max: number }[] }[];
    prov: NdProvRattning[];
    missade: [string, string, number, string][];
    karta: [string, number | null][];
    onskemal: [string, number][];
  };
};

const VECKODAG = ["sön", "mån", "tis", "ons", "tor", "fre", "lör"];
const MAN = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const dagKort = (iso: string) => {
  const d = svensktDatum(iso);
  const dt = new Date(`${d}T12:00:00Z`);
  return `${VECKODAG[dt.getUTCDay()]} ${Number(d.slice(8, 10))} ${MAN[Number(d.slice(5, 7)) - 1]}`;
};
const plusDagar = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
// Första stycket som inte är en rubrik.
const forsta = (md: string) => (md ?? "").replace(/\r\n/g, "\n").split(/\n\s*\n/).filter((s) => !/^\s*#/.test(s)).map((s) => s.replace(/[#>*_`]/g, "").replace(/\s+/g, " ").trim()).find((s) => s.length > 0) ?? "";
// Kundens repliker i ett rollspel: modulens första citat, delat vid " · ". Senare citat är exempel, inte kunden.
const repliker = (md: string) => {
  const rader = (md ?? "").split("\n").map((r) => r.trim());
  const start = rader.findIndex((r) => r.startsWith(">"));
  if (start < 0) return [];
  const block: string[] = [];
  for (let i = start; i < rader.length && rader[i].startsWith(">"); i++) block.push(rader[i].replace(/^>\s*/, ""));
  return block.join(" ").split(/\s+·\s+|\s+·$/).map((x) => x.replace(/[*_`"”“]/g, "").trim()).filter((x) => x.length > 1 && x.length <= 200);
};
const sedan = (iso: string | null, idag: string) => {
  if (!iso) return "inga svar än";
  const d = Math.round((Date.parse(idag) - Date.parse(svensktDatum(iso))) / 86400000);
  return d <= 0 ? "i dag" : d === 1 ? "i går" : `${d} dagar sedan`;
};

export async function byggUtbildning(supabase: SupabaseClient, user: CurrentUser): Promise<NdUtbildning> {
  const mig = user.employee!.id;
  const admin = supabaseAdmin();
  const idag = svensktDatum();
  const chef = hasRole(user, "sales_manager", "admin", "ceo", "team_lead");
  const redaktor = hasRole(user, "sales_manager", "admin", "ceo");

  const [{ data: kursRader }, { data: progress }, { data: certs }, { data: forsok }, { data: svar }, { data: regler }, { data: noter }, { data: betyg }, { data: sjalv }, { data: teamRep }, { data: forel }, { data: prefs }, { data: teammal }, { data: personal }, { data: ledigt }, { data: sjukt }] =
    await Promise.all([
      supabase.from("course").select("id, slug, title, description_md, status, valid_months, due_days, pass_threshold, retry_wait_hours, owner_id, published_at, audience_roles, learning_meta").eq("status", "published").order("title"),
      supabase.from("module_progress").select("module_id, completed_at").eq("employee_id", mig),
      supabase.from("certification").select("course_id, issued_at, expires_at").eq("employee_id", mig).order("issued_at", { ascending: false }),
      supabase.from("course_attempt").select("id, module_id, score, passed, created_at, note, graded_by").eq("employee_id", mig).order("created_at", { ascending: false }),
      supabase.from("learning_answer").select("question_id, correct, confidence, answered_at, next_due").eq("employee_id", mig).order("answered_at", { ascending: false }).limit(2000),
      supabase.from("learning_rule").select("text, course_id").eq("employee_id", mig).order("created_at"),
      supabase.from("learning_note").select("key, text").eq("employee_id", mig),
      supabase.from("module_rating").select("module_id, stars").eq("employee_id", mig),
      supabase.from("roleplay_self").select("module_id, criterion_id, points").eq("employee_id", mig),
      supabase.from("team_repetition").select("question_id, until").gte("until", idag),
      supabase.from("lecture").select("id, title, starts_at, length_min, presenter_id, location, prep, key_points, skill, recording_url").order("starts_at", { ascending: false }).limit(20),
      supabase.from("nav_preference").select("key, value").eq("employee_id", mig).in("key", ["utb.reptid", "utb.dolda", "utb.certpam"]),
      supabase.from("nav_setting").select("key, value").in("key", ["utb.teammal", "utb.rekommenderad"]),
      admin.from("employee").select("id, first_name, last_name, team_id, status, start_date, manager_id"),
      // Sviten: dagar man är ledig eller sjuk varken räknas eller bryter.
      supabase.from("absence_request").select("starts_on, ends_on").eq("employee_id", mig).eq("status", "approved").is("part_day_minutes", null).gte("ends_on", plusDagar(idag, -800)),
      supabase.from("sick_report").select("first_sick_day, last_sick_day").eq("employee_id", mig).is("cancelled_at", null).gte("first_sick_day", plusDagar(idag, -800)),
    ]);

  const pers = (personal ?? []) as { id: string; first_name: string; last_name: string; team_id: string | null; status: string; start_date: string | null; manager_id: string | null }[];
  const namn = new Map(pers.map((p): [string, string] => [p.id, fullName(p)]));
  const kurser = (kursRader ?? []) as { id: string; slug: string; title: string; description_md: string; valid_months: number | null; due_days: number | null; pass_threshold: number; retry_wait_hours: number; owner_id: string | null; published_at: string | null; audience_roles: string[]; learning_meta: Record<string, unknown> | null }[];
  const kursIds = kurser.map((k) => k.id);

  const [{ data: modRader }, { data: kriterier }, { data: inlamningar }] = kursIds.length
    ? await Promise.all([
        supabase.from("course_module").select("id, course_id, sort, title, body_md, kind").in("course_id", kursIds).order("sort"),
        supabase.from("roleplay_criterion").select("id, module_id, sort, label, guidance, max_points").order("sort"),
        supabase.from("roleplay_submission").select("id, module_id, course_id, employee_id, file_id, submitted_at, graded_by, graded_at, attempt_id").order("submitted_at", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const moduler = (modRader ?? []) as { id: string; course_id: string; sort: number; title: string; body_md: string; kind: string }[];
  const modIds = moduler.map((m) => m.id);
  const { data: fragRader } = modIds.length ? await admin.from("quiz_question").select("id, module_id, sort, prompt, quiz_option(id, sort, label, is_correct)").in("module_id", modIds).order("sort") : { data: [] };

  // Skriftliga prov: frågorna utan rättarstöd (service role) och mina försök, senaste först.
  type InlRad = { id: string; module_id: string; status: string; created_at: string; graded_at: string | null; attempt_id: string | null };
  type SvarRad = { submission_id: string; question_id: string; body: string; points: number | null; comment: string | null };
  type ReturRad = { submission_id: string; note: string; returned_at: string };
  const fritextIds = moduler.filter((m) => m.kind === "fritext").map((m) => m.id);
  const [skriftSvar, minaInlSvar] = fritextIds.length
    ? await Promise.all([
        admin.from("essay_question").select("id, module_id, sort, prompt, max_points").in("module_id", fritextIds).order("sort"),
        supabase.from("essay_submission").select("id, module_id, status, created_at, graded_at, attempt_id").eq("employee_id", mig).in("module_id", fritextIds).order("created_at", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }];
  const skriftPer = new Map<string, NdSkriftFraga[]>();
  for (const f of (skriftSvar.data ?? []) as (NdSkriftFraga & { module_id: string })[]) skriftPer.set(f.module_id, [...(skriftPer.get(f.module_id) ?? []), { id: f.id, sort: f.sort, prompt: f.prompt, max_points: f.max_points }]);
  const senasteInl = new Map<string, InlRad>();
  for (const r of (minaInlSvar.data ?? []) as InlRad[]) if (!senasteInl.has(r.module_id)) senasteInl.set(r.module_id, r);
  const inlIds = [...senasteInl.values()].map((r) => r.id);
  const [provSvarSvar, provReturSvar] = inlIds.length
    ? await Promise.all([
        supabase.from("essay_answer").select("submission_id, question_id, body, points, comment").in("submission_id", inlIds),
        supabase.from("essay_return").select("submission_id, note, returned_at").in("submission_id", inlIds).order("returned_at", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }];
  const provSvar = (provSvarSvar.data ?? []) as SvarRad[];
  const provReturer = (provReturSvar.data ?? []) as ReturRad[];
  const mittForsok = (forsok ?? []) as { id: string; module_id: string; score: number; passed: boolean; created_at: string; note: string | null }[];
  const skriftligt = (modId: string, grans: number): NdSkriftligt => {
    const inl = senasteInl.get(modId) ?? null;
    const forsoket = inl?.attempt_id ? mittForsok.find((f) => f.id === inl.attempt_id) ?? null : null;
    const lage: Provlage = inl ? provlage([{ status: inl.status, passed: forsoket ? forsoket.passed : null, created_at: inl.created_at }]) : "ej_paborjat";
    const svar: Record<string, string> = {};
    const poang: Record<string, number | null> = {};
    const kommentar: Record<string, string> = {};
    for (const a of provSvar) {
      if (!inl || a.submission_id !== inl.id) continue;
      svar[a.question_id] = a.body;
      poang[a.question_id] = a.points;
      if (a.comment) kommentar[a.question_id] = a.comment;
    }
    const retur = inl ? provReturer.find((x) => x.submission_id === inl.id) ?? null : null;
    return {
      lage,
      grans,
      minsta: MINSTA_SVAR,
      svar,
      poang,
      kommentar,
      retur: retur ? { note: retur.note, datum: svensktDatum(retur.returned_at) } : null,
      resultat: forsoket && inl ? { poang: forsoket.score, godkant: forsoket.passed, aterkoppling: forsoket.note, rattad: svensktDatum(inl.graded_at ?? forsoket.created_at) } : null,
    };
  };

  const klaraSet = new Set((progress ?? []).map((p) => p.module_id as string));
  const godkandaProv = new Set(((forsok ?? []) as { module_id: string; passed: boolean }[]).filter((f) => f.passed).map((f) => f.module_id));
  const fragorPer = new Map<string, NdFraga[]>();
  for (const f of (fragRader ?? []) as { id: string; module_id: string; prompt: string; quiz_option: { id: string; sort: number; label: string; is_correct: boolean }[] }[]) {
    const facit = redaktor || godkandaProv.has(f.module_id);
    const alt = [...f.quiz_option].sort((a, b) => a.sort - b.sort).map((o) => ({ id: o.id, label: o.label, ratt: facit ? o.is_correct : null }));
    fragorPer.set(f.module_id, [...(fragorPer.get(f.module_id) ?? []), { id: f.id, prompt: f.prompt, alternativ: alt }]);
  }

  // Kurserna och lektionerna.
  const lektioner: NdUtbildning["lektioner"] = {};
  const certPer = new Map<string, { issued_at: string; expires_at: string | null }>();
  for (const c of certs ?? []) if (!certPer.has(c.course_id as string)) certPer.set(c.course_id as string, c as { issued_at: string; expires_at: string | null });
  const egen = pers.find((p) => p.id === mig);
  const installning = new Map(((teammal ?? []) as { key: string; value: unknown }[]).map((x): [string, unknown] => [x.key, x.value]));
  const rekommenderade = ((installning.get("utb.rekommenderad") as { kurser?: string[] } | undefined)?.kurser ?? []).filter((x) => typeof x === "string");
  // Provmodulens färdighet (learning_meta.moduler), annars kursens första.
  const modulSkill = new Map<string, string>();
  for (const k of kurser) for (const [mod, sk] of Object.entries(((k.learning_meta ?? {}) as { moduler?: Record<string, unknown> }).moduler ?? {})) if (typeof sk === "string" && (FARDIGHETER as readonly string[]).includes(sk)) modulSkill.set(mod, sk);
  const NdKurser: NdKurs[] = kurser.map((k) => {
    const meta = (k.learning_meta ?? {}) as { typ?: string; skills?: string[]; dagar?: number; resa?: number; rutin?: string };
    const mods = moduler.filter((m) => m.course_id === k.id);
    const rader = mods.map((m): [string, string, number, string] => [m.title, KIND[m.kind] ?? "las", minuterFor(m.kind, m.body_md, (fragorPer.get(m.id) ?? []).length), m.id]);
    // Klara i ordning, som repot öppnar modulerna: den första som inte är klar är nästa.
    let klara = 0;
    while (klara < mods.length && klaraSet.has(mods[klara].id)) klara++;
    mods.forEach((m, i) => {
      // Facit i spelaren bara för ett prov personen klarat, även för den som får redigera kursen (repots regel i lamnaQuiz).
      const fragor = (fragorPer.get(m.id) ?? []).map((f) => (godkandaProv.has(m.id) ? f : { ...f, alternativ: f.alternativ.map((a) => ({ ...a, ratt: null })) }));
      lektioner[m.id] = { kurs: k.slug, modul: i + 1, titel: m.title, steg: modulTillSteg(m, fragor, skriftPer.get(m.id) ?? []), ...(m.kind === "fritext" ? { skriftligt: skriftligt(m.id, k.pass_threshold) } : {}) };
    });
    const c = certPer.get(k.id);
    const frist = forfallodag(egen?.start_date ?? null, k.due_days);
    const sparr: Record<string, string> = {};
    const forsokPer: NdKurs["forsok"] = {};
    for (const m of mods) {
      const s = ((forsok ?? []) as { module_id: string; score: number; passed: boolean; created_at: string }[]).find((f) => f.module_id === m.id);
      if (!s) continue;
      forsokPer[m.id] = { poang: s.score, godkant: s.passed };
      if (!s.passed && k.retry_wait_hours) {
        const tid = new Date(Date.parse(s.created_at) + k.retry_wait_hours * 3600000);
        if (tid > new Date()) sparr[m.id] = `${dagKort(tid.toISOString())} ${svenskKlocka(tid)}`;
      }
    }
    return {
      id: k.slug,
      dokId: k.id,
      t: k.title,
      typ: meta.typ ?? (mods.length <= 2 && rader.reduce((s, r) => s + r[2], 0) <= 10 ? "kort" : "kurs"),
      min: rader.reduce((s, r) => s + r[2], 0),
      dagar: meta.dagar ?? null,
      skills: (meta.skills ?? []).filter((s) => (FARDIGHETER as readonly string[]).includes(s)),
      resa: meta.resa ?? null,
      rutin: meta.rutin ?? null,
      moduler: rader,
      klara,
      frist: frist ? svensktDatum(frist) : null,
      obl: k.due_days !== null || (k.audience_roles ?? []).length > 0,
      cert: k.valid_months,
      certTill: c ? (c.expires_at ? svensktDatum(c.expires_at) : "gäller tills vidare") : null,
      certUtfardat: c ? svensktDatum(c.issued_at) : null,
      agare: namn.get(k.owner_id ?? "") ?? "Ledningen",
      besk: forsta(k.description_md),
      ny: !!k.published_at && Date.now() - Date.parse(k.published_at) < 30 * 86400000,
      grans: k.pass_threshold,
      vanta: k.retry_wait_hours,
      rek: rekommenderade.includes(k.slug),
      sparr,
      forsok: forsokPer,
    };
  });

  // Repetitionen: frågor ur prov personen klarat (facit är då redan visat), och teamets.
  const kursFor = new Map(moduler.map((m): [string, NdKurs] => [m.id, NdKurser.find((k) => k.dokId === m.course_id)!]));
  const teamSet = new Set((teamRep ?? []).map((t) => t.question_id as string));
  const repetition: NdRepFraga[] = [];
  for (const [modId, fs] of fragorPer) {
    const k = kursFor.get(modId);
    if (!k) continue;
    for (const f of fs) {
      const ratt = f.alternativ.findIndex((a) => a.ratt === true);
      if (ratt < 0) continue;
      repetition.push({ id: f.id, skill: modulSkill.get(modId) ?? k.skills[0] ?? null, kalla: k.t, kurs: k.id, q: f.prompt, alt: f.alternativ.map((a) => a.label), oids: f.alternativ.map((a) => a.id), ratt, team: teamSet.has(f.id) });
    }
  }
  const svarRader = (svar ?? []) as { question_id: string; correct: boolean; confidence: string; answered_at: string; next_due: string }[];
  const senastePer = new Map<string, { next_due: string }>();
  for (const s of svarRader) if (!senastePer.has(s.question_id)) senastePer.set(s.question_id, s);
  const forfallna = repetition.filter((q) => { const s = senastePer.get(q.id); return !s || s.next_due <= idag || q.team; }).map((q) => q.id);
  const kommande = repetition.map((q) => senastePer.get(q.id)?.next_due).filter((d): d is string => !!d && d > idag).sort();

  // Kunskapskartan: andelen rätt per färdighet de senaste 60 dagarna, och samma sak för en vecka sedan.
  const skillFor = new Map(repetition.map((q): [string, string | null] => [q.id, q.skill]));
  const karta = (fore: string) => {
    const ut: Record<string, number | null> = {};
    for (const s of FARDIGHETER) {
      const r = svarRader.filter((x) => skillFor.get(x.question_id) === s && svensktDatum(x.answered_at) <= fore && svensktDatum(x.answered_at) >= plusDagar(fore, -60));
      ut[s] = r.length ? Math.round((r.filter((x) => x.correct).length / r.length) * 100) : null;
    }
    return ut;
  };
  const nu = karta(idag);
  const kunskap: NdUtbildning["kunskap"] = {};
  for (const s of FARDIGHETER) kunskap[s] = [nu[s], sedan(svarRader.find((x) => skillFor.get(x.question_id) === s)?.answered_at ?? null, idag)];

  // Repetition i rad, med frysdagar. Helger, röda dagar, ledighet och sjukdom varken räknas eller bryter.
  const dagar = new Set(svarRader.map((s) => svensktDatum(s.answered_at)));
  const borta = new Set<string>();
  const spann = (fran: string, till: string) => { for (let d = fran < plusDagar(idag, -800) ? plusDagar(idag, -800) : fran, n = 0; d <= till && d <= idag && n < 900; d = plusDagar(d, 1), n++) borta.add(d); };
  for (const a of (ledigt ?? []) as { starts_on: string; ends_on: string }[]) spann(a.starts_on, a.ends_on);
  for (const s of (sjukt ?? []) as { first_sick_day: string; last_sick_day: string | null }[]) spann(s.first_sick_day, s.last_sick_day ?? idag);
  const roda = new Map<number, Set<string>>();
  const ledig = (d: string) => {
    const v = new Date(`${d}T12:00:00Z`).getUTCDay(), ar = +d.slice(0, 4);
    if (!roda.has(ar)) roda.set(ar, rodaDagar(ar));
    return v === 0 || v === 6 || roda.get(ar)!.has(d) || borta.has(d);
  };
  const { streak, bast, frys } = svit(dagar, idag, ledig);
  // Fyra veckor bakåt, måndag till söndag.
  const mandag = (() => { const d = new Date(`${idag}T12:00:00Z`); const v = d.getUTCDay() || 7; return plusDagar(idag, -(v - 1) - 21); })();
  const heat = Array.from({ length: 28 }, (_, i) => (dagar.has(plusDagar(mandag, i)) ? 1 : 0));

  const pref = new Map((prefs ?? []).map((p): [string, unknown] => [p.key as string, p.value]));
  const doldaPref = (pref.get("utb.dolda") ?? {}) as Record<string, string>;

  // Rollspel ur rollspelsmodulerna, med mina inlämningar och bedömningar.
  const krit = (kriterier ?? []) as { id: string; module_id: string; label: string; guidance: string | null; max_points: number }[];
  const inl = (inlamningar ?? []) as { id: string; module_id: string; course_id: string; employee_id: string; file_id: string | null; submitted_at: string; graded_by: string | null; graded_at: string | null; attempt_id: string | null }[];
  const subIds = inl.map((s) => s.id);
  const { data: poangRader } = subIds.length ? await supabase.from("roleplay_score").select("submission_id, criterion_id, points").in("submission_id", subIds) : { data: [] };
  const rollspel: NdUtbildning["rollspel"] = moduler
    .filter((m) => m.kind === "roleplay")
    .map((m): NdUtbildning["rollspel"][number] => {
      const mina = inl.filter((s) => s.module_id === m.id && s.employee_id === mig);
      const bedomd = mina.find((s) => s.graded_at);
      const forsoket = bedomd ? ((forsok ?? []) as { module_id: string; note: string | null; created_at: string }[]).find((f) => f.module_id === m.id && f.note) : null;
      const k = kursFor.get(m.id)!;
      return {
        id: m.id,
        kurs: k.id,
        t: m.title,
        kund: forsta(m.body_md),
        skill: modulSkill.get(m.id) ?? k.skills[0] ?? null,
        kriterier: krit.filter((c) => c.module_id === m.id).map((c): [string, number, string, number] => [c.label, c.max_points, c.id, 0]),
        status: bedomd ? "bedomt" : mina.length ? "inlamnad" : "ny",
        datum: bedomd ? dagKort(bedomd.graded_at!) : mina[0] ? dagKort(mina[0].submitted_at) : null,
        bedomare: bedomd ? namn.get(bedomd.graded_by ?? "") ?? null : null,
        kommentar: forsoket?.note ?? null,
        md: m.body_md ?? "",
        repliker: repliker(m.body_md),
        sjalv: Object.fromEntries(((sjalv ?? []) as { module_id: string; criterion_id: string; points: number }[]).filter((x) => x.module_id === m.id).map((x) => [x.criterion_id, x.points])),
        poang: bedomd ? Object.fromEntries(((poangRader ?? []) as { submission_id: string; criterion_id: string; points: number }[]).filter((p) => p.submission_id === bedomd.id).map((p) => [p.criterion_id, p.points])) : {},
      };
    });

  // Föreläsningarna.
  const forelRader = (forel ?? []) as { id: string; title: string; starts_at: string; length_min: number; presenter_id: string | null; location: string | null; prep: string | null; key_points: string[]; skill: string | null; recording_url: string | null }[];
  const fIds = forelRader.map((f) => f.id);
  const [{ data: anm }, { data: fupp }, { data: fq }] = fIds.length
    ? await Promise.all([
        supabase.from("lecture_signup").select("lecture_id").eq("employee_id", mig).in("lecture_id", fIds),
        supabase.from("lecture_followup").select("lecture_id, step").eq("employee_id", mig).in("lecture_id", fIds),
        supabase.from("lecture_question").select("lecture_id, employee_id, text, kind, created_at").in("lecture_id", fIds).order("created_at", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const STEG: [string, string, string, number][] = [["dag1", "Dag 1", "Sammanfattning och tre frågor", 1], ["dag3", "Dag 3", "Prova i ett riktigt samtal", 3], ["dag7", "Dag 7", "Tre frågor igen", 7], ["dag30", "Dag 30", "Rollspel och 1:1", 30]];
  const forelasningar: NdUtbildning["forelasningar"] = forelRader.map((f): NdUtbildning["forelasningar"][number] => {
    const dag = svensktDatum(f.starts_at);
    const gjorda = new Set(((fupp ?? []) as { lecture_id: string; step: string }[]).filter((x) => x.lecture_id === f.id).map((x) => x.step));
    const fragor = ((fq ?? []) as { lecture_id: string; employee_id: string; text: string; kind: string }[]).filter((x) => x.lecture_id === f.id);
    return {
      id: f.id,
      t: f.title,
      nar: `${dagKort(f.starts_at)} ${svenskKlocka(f.starts_at)}`,
      startar: f.starts_at,
      langd: `${f.length_min} min`,
      vem: namn.get(f.presenter_id ?? "") ?? "",
      vemId: f.presenter_id,
      var: f.location ?? "",
      forberedelse: f.prep ?? "",
      nyckel: f.key_points ?? [],
      skill: f.skill,
      kommande: Date.parse(f.starts_at) > Date.now(),
      anmald: ((anm ?? []) as { lecture_id: string }[]).some((a) => a.lecture_id === f.id),
      uppfoljning: STEG.map(([k, l, vad, n]): [string, string, string] => {
        const nar = plusDagar(dag, n);
        return [l, vad, gjorda.has(k) ? "klar" : nar === idag ? "idag" : nar < idag ? "idag" : dagKort(`${nar}T12:00:00Z`)];
      }),
      fragaSkickad: fragor.some((x) => x.employee_id === mig && x.kind === "fraga"),
      delat: fragor.some((x) => x.employee_id === mig && x.kind === "insikt"),
      insikter: fragor.filter((x) => x.kind === "insikt").slice(0, 5).map((x) => ({ vem: namn.get(x.employee_id) ?? "", text: x.text })),
      inspelning: f.recording_url && /^https:\/\//.test(f.recording_url) ? f.recording_url : null,
    };
  });

  // Teamets vecka: säljarnas repeterade frågor sedan måndag och veckomålet. Målet räknas själv
  // (U2, beställaren 2026-10-20: bara säljarna); ett fast tal i nav_setting utb.teammal går före om det sätts.
  const veckaStart = plusDagar(idag, -((new Date(`${idag}T12:00:00Z`).getUTCDay() || 7) - 1));
  const malV = installning.get("utb.teammal") as { mal?: number } | undefined;
  const vecka = await veckan(admin, veckaStart);
  const gjortVecka = vecka.gjort;
  const mal = typeof malV?.mal === "number" ? malV.mal : vecka.mal;

  const ut: NdUtbildning = {
    skriv: SKRIVLAGE.utbildning,
    kurser: NdKurser,
    lektioner,
    repetition,
    forfallna,
    nastaDag: forfallna.length ? null : kommande[0] ?? null,
    kunskap,
    forraVeckan: karta(plusDagar(idag, -7)),
    streak,
    bast: Math.max(bast, streak),
    frys,
    heat,
    repIdag: dagar.has(idag),
    repTid: typeof pref.get("utb.reptid") === "string" ? (pref.get("utb.reptid") as string) : "08:15",
    dolda: Object.entries(doldaPref).filter(([, till]) => till >= idag).map(([id]) => id),
    certPam: pref.get("utb.certpam") !== false,
    regelbok: ((regler ?? []) as { text: string; course_id: string | null }[]).map((r): [string, string] => [r.text, NdKurser.find((k) => k.dokId === r.course_id)?.t ?? ""]),
    anteckningar: Object.fromEntries((noter ?? []).map((n) => [n.key as string, n.text as string])),
    betyg: Object.fromEntries((betyg ?? []).map((b) => [b.module_id as string, b.stars as number])),
    rollspel,
    forelasningar,
    teamVecka: { gjort: gjortVecka ?? 0, mal: mal || null, egna: svarRader.filter((s) => svensktDatum(s.answered_at) >= veckaStart).length },
    team: null,
  };
  if (!chef) return ut;

  // Teamet: obligatoriska kurser per person, rollspel att bedöma, frågor som missas, teamets karta.
  const aktiva = pers.filter((p) => p.status !== "offboarded" && p.id !== mig);
  const [{ data: allaKlara }, { data: allaSvar }, { data: allaForsok }, { data: onsk }, { data: provKo }] = await Promise.all([
    supabase.from("module_progress").select("employee_id, module_id").in("module_id", modIds.length ? modIds : ["00000000-0000-0000-0000-000000000000"]),
    admin.from("learning_answer").select("question_id, correct").gte("answered_at", new Date(Date.now() - 60 * 86400000).toISOString()).limit(20000),
    supabase.from("course_attempt").select("employee_id, module_id, answers").not("answers", "is", null).limit(5000),
    redaktor ? admin.from("course_wish").select("query").gte("created_at", new Date(Date.now() - 90 * 86400000).toISOString()) : Promise.resolve({ data: [] as { query: string }[] }),
    // Inlämnade skriftliga prov. Alla chefer ser alla (policyn essay_submission_read), som i repots kö.
    supabase.from("essay_submission").select("id, module_id, course_id, employee_id, submitted_at, updated_at").eq("status", "inlamnad").order("submitted_at"),
  ]);
  const prov = await provko(admin, supabase, (provKo ?? []) as KoRad[], mig, namn);
  const obligatoriska = NdKurser.filter((k) => k.obl);
  const klaraPer = new Map<string, Set<string>>();
  for (const r of (allaKlara ?? []) as { employee_id: string; module_id: string }[]) klaraPer.set(r.employee_id, new Set([...(klaraPer.get(r.employee_id) ?? []), r.module_id]));
  const personer = aktiva
    .filter((p) => klaraPer.has(p.id) || p.status === "active")
    .map((p) => ({ id: p.id, namn: namn.get(p.id)!, kurser: Object.fromEntries(obligatoriska.map((k): [string, [number, number]] => [k.id, [k.moduler.filter((m) => klaraPer.get(p.id)?.has(m[3])).length, k.moduler.length]])) }))
    .sort((a, b) => a.namn.localeCompare(b.namn, "sv"));
  // Frågor som missas: provens svar (alternativets id per fråga) och repetitionens svar.
  const fel = new Map<string, [number, number]>();
  const facitFor = new Map<string, string>();
  for (const fs of fragorPer.values()) for (const f of fs) { const a = f.alternativ.find((x) => x.ratt === true); if (a) facitFor.set(f.id, a.id); }
  const { data: allaAlt } = fragRader && (fragRader as unknown[]).length ? { data: fragRader as { id: string; quiz_option: { id: string; is_correct: boolean }[] }[] } : { data: [] as { id: string; quiz_option: { id: string; is_correct: boolean }[] }[] };
  for (const f of allaAlt ?? []) { const a = f.quiz_option.find((o) => o.is_correct); if (a) facitFor.set(f.id, a.id); }
  for (const a of (allaForsok ?? []) as { answers: Record<string, string> | null }[]) for (const [q, val] of Object.entries(a.answers ?? {})) { if (!facitFor.has(q)) continue; const x = fel.get(q) ?? ([0, 0] as [number, number]); x[1]++; if (val !== facitFor.get(q)) x[0]++; fel.set(q, x); }
  for (const s of (allaSvar ?? []) as { question_id: string; correct: boolean }[]) { const x = fel.get(s.question_id) ?? ([0, 0] as [number, number]); x[1]++; if (!s.correct) x[0]++; fel.set(s.question_id, x); }
  const promptFor = new Map<string, { q: string; kurs: string }>();
  for (const [modId, fs] of fragorPer) for (const f of fs) promptFor.set(f.id, { q: f.prompt, kurs: kursFor.get(modId)?.t ?? "" });
  const missade = [...fel.entries()].filter(([, [f, n]]) => n >= 3 && f > 0).sort((a, b) => b[1][0] / b[1][1] - a[1][0] / a[1][1]).slice(0, 5)
    .map(([q, [f, n]]): [string, string, number, string] => [`${promptFor.get(q)?.kurs ?? ""}: ${promptFor.get(q)?.q ?? ""}`, q, Math.round((f / n) * 100), `${f} av ${n} svar var fel.`]);
  const teamSkill = new Map<string, [number, number]>();
  for (const s of (allaSvar ?? []) as { question_id: string; correct: boolean }[]) { const sk = skillFor.get(s.question_id); if (!sk) continue; const x = teamSkill.get(sk) ?? ([0, 0] as [number, number]); x[1]++; if (s.correct) x[0]++; teamSkill.set(sk, x); }
  const onskemal = new Map<string, number>();
  for (const o of (onsk ?? []) as { query: string }[]) onskemal.set(o.query.trim().toLowerCase(), (onskemal.get(o.query.trim().toLowerCase()) ?? 0) + 1);
  ut.team = {
    personer,
    obligatoriska: obligatoriska.map((k) => ({ id: k.id, t: k.t })),
    attBedoma: inl
      .filter((s) => !s.graded_at && s.employee_id !== mig)
      .map((s) => ({
        id: s.id,
        namn: namn.get(s.employee_id) ?? "Okänd",
        modul: moduler.find((m) => m.id === s.module_id)?.title ?? "",
        kurs: kursFor.get(s.module_id)?.t ?? "",
        inlamnad: dagKort(s.submitted_at),
        fil: s.file_id,
        kriterier: krit.filter((c) => c.module_id === s.module_id).map((c) => ({ id: c.id, t: c.label, max: c.max_points })),
      })),
    prov,
    missade,
    karta: FARDIGHETER.map((s): [string, number | null] => { const x = teamSkill.get(s); return [s, x && x[1] >= 5 ? Math.round((x[0] / x[1]) * 100) : null]; }),
    onskemal: [...onskemal.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
  };
  return ut;
}

type KoRad = { id: string; module_id: string; course_id: string; employee_id: string; submitted_at: string | null; updated_at: string };

/**
 * Teamets kö av skriftliga prov, med rättarstödet (`essay_question.guidance`,
 * service role). Byggs bara för den som får rätta: Teamet finns bara för
 * chefsrollerna, samma krets som repots `farRatta` och policyn.
 */
async function provko(admin: SupabaseClient, supabase: SupabaseClient, ko: KoRad[], mig: string, namn: Map<string, string>): Promise<NdProvRattning[]> {
  if (!ko.length) return [];
  const modIds = [...new Set(ko.map((r) => r.module_id))];
  const kursIds = [...new Set(ko.map((r) => r.course_id))];
  const [{ data: fragor }, { data: svar }, { data: returer }, { data: mods }, { data: kurser }] = await Promise.all([
    admin.from("essay_question").select("id, module_id, sort, prompt, guidance, max_points").in("module_id", modIds).order("sort"),
    supabase.from("essay_answer").select("submission_id, question_id, body, comment").in("submission_id", ko.map((r) => r.id)),
    supabase.from("essay_return").select("submission_id").in("submission_id", ko.map((r) => r.id)),
    admin.from("course_module").select("id, title").in("id", modIds),
    admin.from("course").select("id, title, pass_threshold").in("id", kursIds),
  ]);
  const fr = (fragor ?? []) as { id: string; module_id: string; sort: number; prompt: string; guidance: string | null; max_points: number }[];
  const sv = (svar ?? []) as { submission_id: string; question_id: string; body: string; comment: string | null }[];
  const re = (returer ?? []) as { submission_id: string }[];
  const modNamn = new Map(((mods ?? []) as { id: string; title: string }[]).map((m): [string, string] => [m.id, m.title]));
  const kursRad = new Map(((kurser ?? []) as { id: string; title: string; pass_threshold: number }[]).map((k): [string, { title: string; pass_threshold: number }] => [k.id, k]));
  return ko.map((r): NdProvRattning => {
    const k = kursRad.get(r.course_id);
    return {
      id: r.id,
      namn: namn.get(r.employee_id) ?? "Okänd",
      egen: r.employee_id === mig,
      modul: modNamn.get(r.module_id) ?? "",
      kurs: k?.title ?? "",
      grans: k?.pass_threshold ?? 80,
      inlamnad: dagKort(r.submitted_at ?? r.updated_at),
      returer: re.filter((x) => x.submission_id === r.id).length,
      fragor: fr.filter((f) => f.module_id === r.module_id).map((f) => {
        const a = sv.find((x) => x.submission_id === r.id && x.question_id === f.id);
        return { id: f.id, nr: f.sort, q: f.prompt, stod: f.guidance, max: f.max_points, svar: a?.body ?? "", kommentar: a?.comment ?? null };
      }),
    };
  });
}
