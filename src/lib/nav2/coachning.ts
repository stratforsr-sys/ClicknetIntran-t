import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fullName, type CurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { svensktDatum } from "@/lib/klocka";
import { dagarSedanCoachning, type Uppgiftslage } from "@/lib/coachning";
import { farCoacha, hamtaLag, namnkarta, uppgifterFor, type Uppgiftsrad } from "@/lib/coachning-server";

/**
 * Nav 2.0: Coachning i utkastets former.
 *
 * ===========================================================================
 * REPOTS LÄGEN. Överenskommelsernas läge (ej påbörjad … klar, avbruten) och
 * "senast coachad" räknas av repot: `hamtaLag()` för chefen och
 * `uppgifterFor()` för säljaren, med `lageFor()` och de självsanna källorna
 * (certifikat, bedömning, kvittens). En uppgift som inte står bland lagets
 * öppna är klar eller avbruten, och `cancelled_at` säger vilket.
 *
 * DET NYA (0100): övningen och dess svar, vanorna och deras kontroller, chefens
 * rader, personens fokusområde, "Be om en 1:1" och flyttade datum. Punkterna
 * till 1:1 är Tids tabell (0094), och målen från Utbildning är `learning_note`
 * `mal:<modul>` med "coach":true (0097). Är 0100 inte körd står de tomma, och
 * `utan0100` säger varför.
 * ===========================================================================
 *
 * RLS avgör allt som läses: chefen ser sitt lag, säljaren sig själv. Service
 * role används bara för namn som RLS inte släpper fram (den som lade upp en
 * uppgift, en motpart i ett annat team), som i data.ts.
 */

export type CnOmr = "intro" | "behov" | "roi" | "avslut" | "kvalitet" | "avtal";
const OMR: Record<string, CnOmr> = {
  Intro: "intro",
  Behovsanalys: "behov",
  ROI: "roi",
  Avslut: "avslut",
  "Kvalitet på samtalet": "kvalitet",
  "Korrekt avtalshantering": "avtal",
};

export type NdCnSvar = { v: "ja" | "delvis" | "inget" | "nej"; tid: string; txt: string; sam: string; skal: string };
export type NdCnOvning = {
  id: string;
  vem: string;
  omr: CnOmr | "";
  nar: string;
  da: string;
  r: string | null;
  start: string;
  n: number;
  status: "aktiv" | "vana" | "avslutad";
  av: string;
  vanaFran: string | null;
  svar: Record<string, NdCnSvar>;
  kollar: Record<string, "ja" | "ibland" | "nej">;
};
export type NdCnAvtal = {
  id: string;
  vem: string;
  typ: string;
  t: string;
  besk: string;
  due: string | null;
  st: Uppgiftslage;
  ver: string;
  bevis: string;
  mot: string | null;
  ref: string | null;
  skapad: string;
  inl: string | null;
  klarD: string | null;
  kom: [string, string, string][];
  av: string;
  kurs: { klara: number; moduler: number } | null;
};
export type NdCnLogg = { vem: string; d: string; typ: "1:1" | "rollspel" | "medlyssning" | "aterkoppling" | "vana"; t: string; txt: string };
export type NdCnMedd = { id: string; vem: string; fran: string; franId: string; d: string; tid: string; txt: string };
export type NdCnPunkt = { id: string; vem: string; text: string; kalla: string; av: string | null };
export type NdCnMal = { vem: string; text: string; modul: string; datum: string };

export type NdCoachning = {
  utan0100: boolean;
  chef: boolean;
  fokus: { id: string; omr: CnOmr }[];
  personer: { id: string; namn: string; omr: CnOmr | ""; senast: string | null; kv: [number, number] | null }[];
  ovningar: NdCnOvning[];
  avtal: NdCnAvtal[];
  logg: NdCnLogg[];
  medd: NdCnMedd[];
  punkter: NdCnPunkt[];
  mal: NdCnMal[];
  forfr: Record<string, string>;
  namn: Record<string, string>;
  val: { kurser: [string, string][]; rollspel: [string, string][]; rutiner: [string, string][] } | null;
  utkast: Record<string, unknown>;
};

const saknas = (e: { message?: string } | null | undefined) => !!e && /does not exist|schema cache|could not find|finns inte/i.test(e.message ?? "");

// Tidpunkter i Stockholm: datumet och klockslaget.
const TZ = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function stockholm(iso: string): { dag: string; kl: string } {
  const p = Object.fromEntries(TZ.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { dag: `${p.year}-${p.month}-${p.day}`, kl: `${p.hour}:${p.minute}` };
}
const MAN = ["", "jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const kortDag = (dag: string) => `${+dag.slice(8, 10)} ${MAN[+dag.slice(5, 7)]}`;
const minusDagar = (dag: string, n: number) => new Date(Date.parse(dag + "T12:00:00Z") - n * 864e5).toISOString().slice(0, 10);

type TaskRad = {
  id: string;
  title: string;
  description_md: string;
  kind: string;
  assignee_id: string;
  partner_id: string | null;
  created_by: string;
  verify_by: string;
  evidence: string;
  due_date: string | null;
  cancelled_at: string | null;
  course_id: string | null;
  module_id: string | null;
  document_id: string | null;
  created_at: string;
  nav2_kind?: string | null;
};
type HandRad = { task_id: string; type: string; at: string; by_employee_id: string; note: string | null; file_id: string | null };

/** Startad innan den väntas in: ett fel kommer fram där den väntas in, inte som ett ohanterat avslag medan något annat väntas in. */
function tidig<T>(p: Promise<T>): Promise<T> {
  p.catch(() => {});
  return p;
}

/**
 * Fart (2026-10-20): det som bara beror på vilka personerna är läses i samma
 * omgång som överenskommelserna, och K&V, övningarnas svar och namnen i
 * omgången efter. Förut väntade nio omgångar på varandra för chefen, nu sju
 * (tre av dem är lagets, i repots `hamtaLag`). Samma frågor och samma svar.
 */
export async function byggCoachning(supabase: SupabaseClient, user: CurrentUser): Promise<NdCoachning> {
  const mig = user.employee?.id ?? "";
  const chef = farCoacha(user);
  const idag = svensktDatum();
  const nu = new Date();
  const tom: NdCoachning = { utan0100: false, chef, fokus: [], personer: [], ovningar: [], avtal: [], logg: [], medd: [], punkter: [], mal: [], forfr: {}, namn: {}, val: null, utkast: {} };
  if (!mig) return tom;

  // Laget och lägena, med repots egna funktioner.
  let personer: { id: string; namn: string; senast: string | null }[] = [];
  const lage = new Map<string, Uppgiftslage>();
  if (chef) {
    const lag = (await hamtaLag(nu, mig)).filter((p) => p.employee_id !== mig);
    personer = lag.map((p) => ({ id: p.employee_id, namn: p.namn, senast: p.dagarSedan === null ? null : minusDagar(idag, p.dagarSedan) }));
    for (const p of lag) for (const u of p.uppgifter) lage.set(u.id, u.lage);
  } else {
    const [egna, { data: sess }]: [Uppgiftsrad[], { data: { held_on: string }[] | null }] = await Promise.all([
      uppgifterFor(mig, nu),
      supabase.from("coaching_session").select("held_on").eq("employee_id", mig),
    ]);
    for (const u of egna) lage.set(u.id, u.lage);
    const rorelser = [
      ...egna.flatMap((u) => u.handelser.filter((h) => ["kvitterad", "underkand", "inlamnad"].includes(h.type)).map((h) => ({ at: h.at }))),
      ...((sess ?? []) as { held_on: string }[]).map((s) => ({ at: `${s.held_on}T12:00:00Z` })),
    ];
    const d = dagarSedanCoachning(rorelser, nu);
    personer = [{ id: mig, namn: fullName(user.employee!), senast: d === null ? null : minusDagar(idag, d) }];
  }
  const ids = personer.map((p) => p.id);
  if (ids.length === 0) return tom;
  const ivem = new Set(ids);

  // Det som bara beror på personerna, samtidigt med överenskommelserna.
  const idsP = tidig(Promise.all([
    supabase.from("coaching_session").select("id, employee_id, coach_id, held_on, goal_md, reality_md, will_md, previous_goal_met, focus_id").in("employee_id", ids).order("held_on"),
    supabase.from("coaching_drill").select("id, employee_id, focus_id, when_text, then_text, routine_slug, days, starts_on, status, habit_since, created_by").in("employee_id", ids).order("starts_on"),
    supabase.from("coaching_focus").select("id, label, kv_criterion_id").eq("active", true).order("sort"),
    supabase.from("coaching_person_focus").select("employee_id, focus_id").in("employee_id", ids),
    supabase.from("coaching_message").select("id, employee_id, from_id, text, created_at").in("employee_id", ids).order("created_at"),
    supabase.from("coaching_meeting_request").select("employee_id, requested_at").in("employee_id", ids).is("handled_at", null),
    supabase.from("one_on_one_point").select("id, employee_id, text, source, added_by, removed_at").in("employee_id", ids).is("handled_at", null).is("removed_at", null).order("created_at"),
    supabase.from("learning_note").select("employee_id, key, text").in("employee_id", ids).like("key", "mal:%"),
    supabase.from("course").select("id, slug, title, status").order("title"),
    supabase.from("document").select("id, slug, title, status").order("title"),
    supabase.from("course_module").select("id, course_id, title, kind").eq("kind", "roleplay"),
    supabase.from("nav_preference").select("key, value").eq("employee_id", mig).like("key", "coachning.utkast.%"),
    // K&V för fokusområdet och bedömda rollspel (används längre ner).
    supabase.from("kv_call").select("id, employee_id, call_date").in("employee_id", ids),
    supabase.from("roleplay_submission").select("employee_id, module_id, graded_at, graded_by").in("employee_id", ids).not("graded_at", "is", null),
  ]));

  // Överenskommelserna. nav2_kind finns först med 0100.
  const medKind = await supabase
    .from("coaching_task")
    .select("id, title, description_md, kind, assignee_id, partner_id, created_by, verify_by, evidence, due_date, cancelled_at, course_id, module_id, document_id, created_at, nav2_kind")
    .in("assignee_id", ids);
  let utan0100 = saknas(medKind.error);
  let taskRader = (medKind.data ?? []) as unknown as TaskRad[];
  if (utan0100) {
    const { data } = await supabase
      .from("coaching_task")
      .select("id, title, description_md, kind, assignee_id, partner_id, created_by, verify_by, evidence, due_date, cancelled_at, course_id, module_id, document_id, created_at")
      .in("assignee_id", ids);
    taskRader = (data ?? []) as unknown as TaskRad[];
  }
  const rader = taskRader.filter((t) => ivem.has(t.assignee_id));
  const taskIds = rader.map((t) => t.id);

  // Kursernas framsteg för överenskommelser om en kurs: beror bara på överenskommelserna.
  const kursIds = [...new Set(rader.filter((t) => t.kind === "kurs" && t.course_id).map((t) => t.course_id!))];
  const kursP = tidig(
    kursIds.length
      ? (async () => {
          const { data: mods } = await supabase.from("course_module").select("id, course_id").in("course_id", kursIds);
          const modRader = (mods ?? []) as { id: string; course_id: string }[];
          const { data: prog } = await supabase.from("module_progress").select("employee_id, module_id, completed_at").in("module_id", modRader.map((m) => m.id)).in("employee_id", ids);
          return { modRader, prog };
        })()
      : Promise.resolve(null),
  );

  const [[hand, noter], [sess, ovn, fokus, pfok, medd, forfr, punkter, malRader, kurser, dok, rollspel, utkast, kvQ, rsQ]] = await Promise.all([
    Promise.all([
      supabase.from("coaching_task_event").select("task_id, type, at, by_employee_id, note, file_id").in("task_id", taskIds).order("at"),
      supabase.from("coaching_task_note").select("task_id, by_employee_id, text, created_at").in("task_id", taskIds).order("created_at"),
    ]),
    idsP,
  ]);
  if ([noter, ovn, pfok, medd, forfr].some((r) => saknas(r.error))) utan0100 = true;

  // Punkterna utan 0100 saknar removed_at: läs om utan den.
  let punktRader = (punkter.data ?? []) as { id: string; employee_id: string; text: string; source: string; added_by: string | null }[];
  if (saknas(punkter.error)) {
    const { data } = await supabase.from("one_on_one_point").select("id, employee_id, text, source, added_by").in("employee_id", ids).is("handled_at", null).order("created_at");
    punktRader = (data ?? []) as typeof punktRader;
  }

  const handRader = (hand.data ?? []) as HandRad[];
  type SessRad = { id: string; employee_id: string; coach_id: string; held_on: string; goal_md: string; reality_md: string; will_md: string; previous_goal_met?: string | null; focus_id?: string | null };
  let sessRader = (sess.data ?? []) as SessRad[];
  if (saknas(sess.error)) {
    utan0100 = true;
    const { data } = await supabase.from("coaching_session").select("id, employee_id, coach_id, held_on, goal_md, reality_md, will_md").in("employee_id", ids).order("held_on");
    sessRader = (data ?? []) as SessRad[];
  }
  const ovnRader = (ovn.data ?? []) as { id: string; employee_id: string; focus_id: string | null; when_text: string; then_text: string; routine_slug: string | null; days: number; starts_on: string; status: "aktiv" | "vana" | "avslutad"; habit_since: string | null; created_by: string }[];
  const fokusRader = (fokus.data ?? []) as { id: string; label: string; kv_criterion_id: string | null }[];
  const meddRader = (medd.data ?? []) as { id: string; employee_id: string; from_id: string; text: string; created_at: string }[];
  const kursRader = (kurser.data ?? []) as { id: string; slug: string; title: string; status: string }[];
  const dokRader = (dok.data ?? []) as { id: string; slug: string; title: string; status: string }[];
  const rsRader = (rollspel.data ?? []) as { id: string; course_id: string; title: string; kind: string }[];

  const omrFor = new Map<string, CnOmr>();
  for (const f of fokusRader) if (OMR[f.label]) omrFor.set(f.id, OMR[f.label]);

  // Svaren och vanornas kontroller hör till övningarna. I samma omgång: K&V-poängen och namnen.
  const ovnIds = ovnRader.map((o) => o.id);
  const kvRader = (kvQ.data ?? []) as { id: string; employee_id: string; call_date: string }[];
  // Namnen: det RLS ger, och resten (skapare, motpart) med service role.
  const namnIds = [
    ...rader.flatMap((t) => [t.assignee_id, t.partner_id, t.created_by]),
    ...handRader.map((h) => h.by_employee_id),
    ...sessRader.map((s) => s.coach_id),
    ...meddRader.map((m) => m.from_id),
    ...ovnRader.map((o) => o.created_by),
  ].filter((x): x is string => !!x);
  const [[svarQ, kollQ], poangQ, namn, { data: allaNamn }] = await Promise.all([
    ovnIds.length
      ? Promise.all([
          supabase.from("coaching_drill_answer").select("drill_id, day, answer, note, reason, call_label, answered_at").in("drill_id", ovnIds),
          supabase.from("coaching_habit_check").select("drill_id, due_on, answer").in("drill_id", ovnIds),
        ])
      : Promise.resolve([{ data: [] }, { data: [] }]),
    kvRader.length ? supabase.from("kv_score").select("call_id, criterion_id, points").in("call_id", kvRader.map((k) => k.id)) : Promise.resolve(null),
    namnkarta(namnIds),
    namnIds.length ? supabaseAdmin().from("employee").select("id, first_name, last_name").in("id", [...new Set(namnIds)]) : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string }[] }),
  ]);
  for (const p of personer) namn.set(p.id, p.namn);
  const fattas = new Set([...new Set(namnIds)].filter((x) => !namn.has(x)));
  for (const e of (allaNamn ?? []) as { id: string; first_name: string; last_name: string }[]) if (fattas.has(e.id)) namn.set(e.id, fullName(e));
  const n = (id: string | null | undefined) => (id ? namn.get(id) ?? "" : "");

  // Kursernas framsteg för överenskommelser om en kurs (lästa ovan).
  const kursFramsteg = new Map<string, { klara: number; moduler: number }>();
  const kursLas = await kursP;
  if (kursLas) {
    const { modRader, prog } = kursLas;
    const klara = new Set(((prog ?? []) as { employee_id: string; module_id: string; completed_at: string | null }[]).filter((p) => p.completed_at).map((p) => `${p.employee_id}:${p.module_id}`));
    for (const t of rader.filter((x) => x.kind === "kurs" && x.course_id)) {
      const m = modRader.filter((x) => x.course_id === t.course_id);
      kursFramsteg.set(t.id, { moduler: m.length, klara: m.filter((x) => klara.has(`${t.assignee_id}:${x.id}`)).length });
    }
  }
  const kursSlug = new Map(kursRader.map((k) => [k.id, k.slug]));
  const dokSlug = new Map(dokRader.map((d) => [d.id, d.slug]));

  const avtal: NdCnAvtal[] = rader.map((t) => {
    const h = handRader.filter((x) => x.task_id === t.id);
    const st: Uppgiftslage = lage.get(t.id) ?? (t.cancelled_at ? "avbruten" : "klar");
    const kom: [string, string, string][] = [];
    const trad: { at: string; rad: [string, string, string] }[] = [];
    for (const x of h) {
      const text = x.note?.trim() || (x.file_id ? "Bifogade en fil." : x.type === "kvitterad" && x.by_employee_id !== t.assignee_id ? "Kvitterad." : "");
      if (text && ["inlamnad", "kvitterad", "underkand"].includes(x.type)) trad.push({ at: x.at, rad: [n(x.by_employee_id), text, kortDag(stockholm(x.at).dag)] });
    }
    for (const x of (noter.data ?? []) as { task_id: string; by_employee_id: string; text: string; created_at: string }[])
      if (x.task_id === t.id) trad.push({ at: x.created_at, rad: [n(x.by_employee_id), x.text, kortDag(stockholm(x.created_at).dag)] });
    trad.sort((a, b) => a.at.localeCompare(b.at)).forEach((x) => kom.push(x.rad));
    const senast = (typ: string) => {
      const l = h.filter((x) => x.type === typ).pop();
      return l ? stockholm(l.at).dag : null;
    };
    const ref = t.kind === "kurs" ? kursSlug.get(t.course_id ?? "") ?? null : t.kind === "rollspel_inspelat" ? t.module_id : t.kind === "lasning" ? dokSlug.get(t.document_id ?? "") ?? null : null;
    return {
      id: t.id,
      vem: t.assignee_id,
      typ: t.nav2_kind === "rollspel_live" ? "rollspel_live" : t.kind,
      t: t.title,
      besk: t.description_md ?? "",
      due: t.due_date,
      st,
      ver: t.verify_by,
      bevis: t.evidence,
      mot: t.partner_id,
      ref,
      skapad: stockholm(t.created_at).dag,
      inl: senast("inlamnad"),
      klarD: st === "klar" ? senast("kvitterad") : null,
      kom,
      av: t.created_by,
      kurs: kursFramsteg.get(t.id) ?? null,
    };
  });

  // Övningarna med svar och kontroller.
  const svarPer = new Map<string, Record<string, NdCnSvar>>();
  for (const s of (svarQ.data ?? []) as { drill_id: string; day: string; answer: NdCnSvar["v"]; note: string | null; reason: string | null; call_label: string | null; answered_at: string }[]) {
    const r = svarPer.get(s.drill_id) ?? {};
    r[s.day] = { v: s.answer, tid: stockholm(s.answered_at).kl, txt: s.note ?? "", sam: s.call_label ?? "", skal: s.reason ?? "" };
    svarPer.set(s.drill_id, r);
  }
  const kollPer = new Map<string, Record<string, "ja" | "ibland" | "nej">>();
  for (const k of (kollQ.data ?? []) as { drill_id: string; due_on: string; answer: "ja" | "ibland" | "nej" }[]) {
    const r = kollPer.get(k.drill_id) ?? {};
    r[k.due_on] = k.answer;
    kollPer.set(k.drill_id, r);
  }
  const ovningar: NdCnOvning[] = ovnRader.map((o) => ({
    id: o.id,
    vem: o.employee_id,
    omr: (o.focus_id && omrFor.get(o.focus_id)) || "",
    nar: o.when_text,
    da: o.then_text,
    r: o.routine_slug,
    start: o.starts_on,
    n: o.days,
    status: o.status,
    av: o.created_by,
    vanaFran: o.habit_since,
    svar: svarPer.get(o.id) ?? {},
    kollar: kollPer.get(o.id) ?? {},
  }));

  // Fokusområdet: personens val, annars den aktiva övningens, annars senaste samtalets.
  const valt = new Map(((pfok.data ?? []) as { employee_id: string; focus_id: string }[]).map((f) => [f.employee_id, f.focus_id]));
  const omrForPerson = (id: string): CnOmr | "" => {
    const f = valt.get(id);
    if (f && omrFor.get(f)) return omrFor.get(f)!;
    const ov = ovningar.filter((o) => o.vem === id && o.status === "aktiv" && o.omr).pop();
    if (ov) return ov.omr;
    const s = sessRader.filter((x) => x.employee_id === id && x.focus_id).pop();
    return (s?.focus_id && omrFor.get(s.focus_id)) || "";
  };

  // K&V för fokusområdet: snittet före övningens start och sedan dess. RLS (0036)
  // släpper bara fram K&V för personen själv och för dem som hanterar provisionen.
  const kvPer = new Map<string, [number, number]>();
  if (kvRader.length && poangQ) {
    const poangRader = (poangQ.data ?? []) as { call_id: string; criterion_id: string; points: number | string }[];
    for (const p of personer) {
      const omr = omrForPerson(p.id);
      const kriterium = fokusRader.find((f) => OMR[f.label] === omr)?.kv_criterion_id;
      const start = ovningar.find((o) => o.vem === p.id && o.status === "aktiv")?.start;
      if (!kriterium || !start) continue;
      const snitt = (fore: boolean) => {
        const samtal = new Set(kvRader.filter((k) => k.employee_id === p.id && (fore ? k.call_date < start : k.call_date >= start)).map((k) => k.id));
        const v = poangRader.filter((x) => samtal.has(x.call_id) && x.criterion_id === kriterium).map((x) => Number(x.points));
        return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
      };
      const [a, b] = [snitt(true), snitt(false)];
      if (a !== null && b !== null) kvPer.set(p.id, [a, b]);
    }
  }

  // Historiken: samtalen, kvitteringarna och återkopplingen, bedömda rollspel och vanorna.
  const logg: NdCnLogg[] = [];
  const forraMalet: Record<string, string> = { ja: "Förra målet nåddes.", delvis: "Förra målet nåddes delvis.", nej: "Förra målet är inte nått än." };
  for (const s of sessRader)
    logg.push({
      vem: s.employee_id,
      d: s.held_on,
      typ: "1:1",
      t: `1:1 med ${n(s.coach_id) || "chefen"}`,
      txt: [s.previous_goal_met ? forraMalet[s.previous_goal_met] : "", s.goal_md?.trim() ? `Mål: ${s.goal_md.trim()}` : "", s.reality_md?.trim(), s.will_md?.trim() ? `Nästa steg: ${s.will_md.trim()}` : ""].filter(Boolean).join(" ").slice(0, 600),
    });
  for (const t of rader) {
    for (const x of handRader.filter((h) => h.task_id === t.id && ["kvitterad", "underkand"].includes(h.type) && h.by_employee_id !== t.assignee_id)) {
      const typ: NdCnLogg["typ"] = t.kind === "medlyssning" ? "medlyssning" : t.kind === "rollspel_live" || t.nav2_kind === "rollspel_live" ? "rollspel" : "aterkoppling";
      logg.push({ vem: t.assignee_id, d: stockholm(x.at).dag, typ, t: x.type === "kvitterad" ? `${n(x.by_employee_id)} kvitterade: ${t.title}` : `${n(x.by_employee_id)} gav återkoppling: ${t.title}`, txt: x.note ?? "" });
    }
  }
  const rsInl = rsQ.data;
  const rsTitel = new Map(rsRader.map((m) => [m.id, m.title]));
  for (const r of (rsInl ?? []) as { employee_id: string; module_id: string; graded_at: string; graded_by: string | null }[])
    logg.push({ vem: r.employee_id, d: stockholm(r.graded_at).dag, typ: "rollspel", t: `Rollspel bedömt: ${rsTitel.get(r.module_id) ?? "rollspel"}`, txt: "" });
  for (const o of ovningar.filter((x) => x.status === "vana" && x.vanaFran))
    logg.push({ vem: o.vem, d: o.vanaFran!, typ: "vana", t: `Ny vana: när ${o.nar}`, txt: "Det blev en vana." });

  // Målen från Utbildning, de som kom efter det senaste 1:1:et.
  const mal: NdCnMal[] = [];
  for (const r of (malRader.data ?? []) as { employee_id: string; key: string; text: string }[]) {
    let m: { text?: string; coach?: boolean; modul?: string; datum?: string } = {};
    try {
      m = JSON.parse(r.text);
    } catch {
      continue;
    }
    if (!m.coach || !m.text) continue;
    const forra = sessRader.filter((s) => s.employee_id === r.employee_id).pop();
    if (forra && m.datum && m.datum <= forra.held_on) continue;
    mal.push({ vem: r.employee_id, text: String(m.text).slice(0, 300), modul: String(m.modul ?? ""), datum: String(m.datum ?? "") });
  }

  const utkastMap: Record<string, unknown> = {};
  for (const u of (utkast.data ?? []) as { key: string; value: unknown }[]) utkastMap[u.key.slice("coachning.utkast.".length)] = u.value;

  return {
    utan0100,
    chef,
    fokus: fokusRader.filter((f) => OMR[f.label]).map((f) => ({ id: f.id, omr: OMR[f.label] })),
    personer: personer.map((p) => ({ ...p, omr: omrForPerson(p.id), kv: kvPer.get(p.id) ?? null })),
    ovningar,
    avtal,
    logg,
    medd: meddRader.map((m) => {
      const s = stockholm(m.created_at);
      return { id: m.id, vem: m.employee_id, fran: n(m.from_id), franId: m.from_id, d: s.dag, tid: s.kl, txt: m.text };
    }),
    punkter: punktRader.map((p) => ({ id: p.id, vem: p.employee_id, text: p.text, kalla: p.source, av: p.added_by })),
    mal,
    forfr: Object.fromEntries(((forfr.data ?? []) as { employee_id: string; requested_at: string }[]).map((f) => [f.employee_id, stockholm(f.requested_at).dag])),
    namn: Object.fromEntries(namn),
    val: chef
      ? {
          kurser: kursRader.filter((k) => k.status === "published").map((k): [string, string] => [k.slug, k.title]),
          rollspel: rsRader.filter((m) => kursRader.some((k) => k.id === m.course_id && k.status === "published")).map((m): [string, string] => [m.id, m.title]),
          rutiner: dokRader.filter((d) => d.status === "published").map((d): [string, string] => [d.slug, d.title]),
        }
      : null,
    utkast: utkastMap,
  };
}
