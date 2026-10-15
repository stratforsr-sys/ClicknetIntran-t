import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { canManageEmployees, fullName, type CurrentUser } from "@/lib/auth";
import { gallande, lageNu, type Handelse } from "@/lib/tid";
import { gallandeSchema } from "@/lib/raster";
import { hamtaLage } from "@/lib/sparrar";
import { stampelfri } from "@/lib/stampelfri";
import { hamtaDagsbild } from "@/lib/dagslage-server";
import type { Dagsrad } from "@/lib/dagslage";
import { oppnaDagar } from "@/lib/lonerapport";
import { dagarBakat, svensktDatum, svenskaMinuter, svenskKlocka, svenskDygnsstart, svenskTidpunkt, svenskVeckodag } from "@/lib/klocka";
import { supabaseAdmin } from "@/lib/supabase/server";
import { utanforSchemat } from "@/lib/nav2/utanfor";
import { PAMINN_STANDARD, SCHEMA_KVITTENS_FRAN, type Paminn } from "@/lib/nav2/tidregler";

/**
 * Nav 2.0: Tid, med samma funktioner som /tid, /tid/ogiltig-franvaro,
 * /tid/lonerapport och startsidans dagsbild.
 *
 * Allt lases med den inloggades token. Stamplingarna ar aldrig nagon annans
 * for en saljare (RLS), och chefens halva hamtas bara for den som far hantera
 * personal — samma `canManageEmployees` som /tid anvander.
 *
 * Tiderna skickas som ISO och som svenska klockslag. Klienten raknar inte om
 * tidszoner; den far "08:02" fardigt, precis som /tid visar det.
 */

export type NdStampel = {
  id: string;
  kind: string;
  at: string;
  dag: string;
  kl: string;
  min: number;
  source: string;
  korr: string | null;
  ersatter: string | null;
  note: string | null;
  begard: string | null;
};

export type NdSchemadag = { veckodag: number; start: string; slut: string; tol: number; niva: string; fran: string };

export type NdTid = {
  modulPa: boolean;
  rastPa: boolean;
  /** Den inloggade stamplar sjalv (modulen pa och rollen inte stampelfri). */
  stamplar: boolean;
  lage: "ute" | "inne" | "rast";
  /** Egna stamplingar, de senaste 35 dagarna, ra (med rattelser). */
  egna: NdStampel[];
  /** Gallande schema for den inloggade, veckodag 1-5 (och helg om det finns). */
  schema: NdSchemadag[];
  /** Scheman som borjar galla senare, for den inloggade. */
  kommande: NdSchemadag[];
  sena: { id: string; dag: string; min: number; schemalagd: string; ankom: string; kommentar: string | null; gallras: number }[];
  ledigt: { typ: string; fran: string; till: string; delDag: boolean }[];
  /** 0094: per egen rättelse — stödet, avslagets skäl och om avslaget setts. */
  extra: Record<string, { stod: string | null; skal: string | null; sett: boolean }>;
  /** 0094: dagar navet stängde som personen sagt stämmer. */
  autoOk: string[];
  /** 0094: nya scheman (från SCHEMA_KVITTENS_FRAN) och om de setts. */
  schemaKvittens: { fran: string; sett: boolean }[];
  /** 0094: veckokollen, nyast först. `vecka` är måndagen. */
  veckokoll: { vecka: string; ok: boolean; nar: string }[];
  paminn: Paminn;
  /** 0094: vem som öppnat dina sena dagar, och vem som tagit med dig i en lönerapport. */
  tittat: { vem: string; vad: string; nar: string }[];
  /** K14: informationen om tidsregistreringen, och när du kvitterade den. */
  info: null | { titel: string; href: string; kvitterad: string | null };
  /** Sista samtalet i dialern per dag, som stöd för en rättelse av utstämplingen. */
  sistaSamtal: Record<string, string>;
  chef: null | {
    dagsbild: Dagsrad[];
    bedomda: number;
    paPlats: { id: string; namn: string; sedan: string }[];
    rattelser: { id: string; pid: string; namn: string; kind: string; fran: string | null; till: string; dag: string; note: string | null; begard: string; timmar: number }[];
    ogiltig: { id: string; pid: string; namn: string; dag: string; min: number; status: string; ordning: number | null; atgard: string | null; beslutad: string | null; not: string | null }[];
    sena30: { pid: string; namn: string; dagar: { dag: string; min: number }[]; kommentar: string | null }[];
    oppna: { pid: string; namn: string; dag: string }[];
    perioder: { id: string; start: string; slut: string; status: string; skriven: boolean; attesterad: string | null }[];
    underlag: null | { periodId: string; rader: { pid: string; namn: string; nr: string; arbetad: number; justering: number; stangda: number; franvaro: Record<string, number> }[] };
    scheman: (NdSchemadag & { vem: string })[];
    trappa: { ordning: number; antal: number; manader: number; atgard: string; omfattning: string | null }[];
    /** 0094 */
    stod: Record<string, string>;
    schemaSett: { fran: string; vem: string; sett: number; av: number; saknas: string[] }[];
    beslut48: { inom: number; av: number };
    klaraIdag: number;
    senast: { nar: string | null; iso: string | null; nya: number };
    morgonnotis: string;
    logg: { namn: string; vad: string; nar: string }[];
    nastaVecka: { dag: string; rader: { namn: string; typ: string; vantar: boolean }[] }[];
    ankomster: { start: string; min: number }[];
    kolumner: { id: string; header: string; field: string; active: boolean }[];
    steg: Record<string, { granskad: string | null; nedladdad: string | null; skickad: string | null }>;
    lopande: null | { start: string; slut: string; rader: { pid: string; namn: string; nr: string; arbetad: number; justering: number; stangda: number; utanfor: number; forklaring: string | null; avvik: boolean }[] };
    punkter: string[];
    personIds: Record<string, string>;
    harEgetSchema: string[];
    tolerans: null | { scope: string; scopeId: string | null; namn: string; tol: number };
  };
};

const STAMPELKOLUMNER = "id, kind, occurred_at, source, supersedes_id, correction_state, note, created_at";

function stampel(h: { id: string; kind: string; occurred_at: string; source: string; supersedes_id: string | null; correction_state: string | null; note: string | null; created_at: string }): NdStampel {
  return {
    id: h.id,
    kind: h.kind,
    at: h.occurred_at,
    dag: svensktDatum(h.occurred_at),
    kl: svenskKlocka(h.occurred_at),
    min: svenskaMinuter(h.occurred_at),
    source: h.source,
    korr: h.correction_state,
    ersatter: h.supersedes_id,
    note: h.note,
    begard: h.correction_state ? h.created_at : null,
  };
}

const kl = (t: string | null | undefined) => (t ?? "").slice(0, 5);

export async function byggTid(supabase: SupabaseClient, user: CurrentUser): Promise<NdTid> {
  const mig = user.employee!.id;
  const nu = new Date();
  const idag = svensktDatum(nu);
  const sparr = await hamtaLage();

  const [{ data: egna }, { data: scheman }, { data: sena }, { data: ledigt }, { data: typer }, { data: jag }] = await Promise.all([
    supabase.from("time_event").select(STAMPELKOLUMNER).eq("employee_id", mig).gte("occurred_at", new Date(Date.parse(svenskDygnsstart(nu)) - 35 * 86400000).toISOString()).order("occurred_at"),
    supabase.from("work_schedule").select("id, scope, employee_id, team_id, weekday, start_time, end_time, tol_late, valid_from").order("valid_from"),
    supabase.from("late_arrival").select("id, work_date, minutes_late, scheduled_start, arrived_at, employee_comment").eq("employee_id", mig).gte("work_date", dagarBakat(idag, 90)).order("work_date", { ascending: false }),
    supabase.from("absence_request").select("type_id, starts_on, ends_on, part_day_minutes").eq("employee_id", mig).eq("status", "approved").gte("ends_on", idag).lte("starts_on", dagarBakat(idag, -60)).order("starts_on"),
    supabase.from("absence_type").select("id, label"),
    supabase.from("employee").select("team_id").eq("id", mig).maybeSingle(),
  ]);

  const typnamn = new Map((typer ?? []).map((t) => [t.id as string, t.label as string]));
  const teamId = (jag?.team_id as string | null) ?? null;
  const egnaStamplar = (egna ?? []).map(stampel);

  // Ett schema per veckodag, med samma regel som narvaro och nattjobbet.
  const rader = (scheman ?? []) as { id: string; scope: string; employee_id: string | null; team_id: string | null; weekday: number; start_time: string; end_time: string; tol_late: number; valid_from: string }[];
  const schemaFor = (pid: string, team: string | null, datum: string, veckodag: number) =>
    gallandeSchema(rader.filter((r) => r.weekday === veckodag), pid, team, datum)[0] ?? null;
  const schema: NdSchemadag[] = [];
  for (let v = 1; v <= 7; v++) {
    const r = schemaFor(mig, teamId, idag, v);
    if (r) schema.push({ veckodag: v, start: kl(r.start_time), slut: kl(r.end_time), tol: r.tol_late ?? 1, niva: r.scope, fran: r.valid_from });
  }
  const kommande: NdSchemadag[] = rader
    .filter((r) => r.valid_from > idag && (r.scope === "company" || (r.scope === "team" && r.team_id === teamId) || (r.scope === "employee" && r.employee_id === mig)))
    .map((r) => ({ veckodag: r.weekday, start: kl(r.start_time), slut: kl(r.end_time), tol: r.tol_late ?? 1, niva: r.scope, fran: r.valid_from }));

  const handelser = (egna ?? []) as unknown as Handelse[];
  const idagsHandelser = handelser.filter((h) => svensktDatum(h.occurred_at) === idag);

  const ut: NdTid = {
    modulPa: sparr.stampling,
    rastPa: sparr.rast,
    stamplar: sparr.stampling && !stampelfri(user.roles),
    lage: lageNu(idagsHandelser),
    egna: egnaStamplar,
    schema,
    kommande,
    sena: (sena ?? []).map((s) => ({
      id: s.id,
      dag: s.work_date,
      min: s.minutes_late,
      schemalagd: kl(s.scheduled_start),
      ankom: s.arrived_at ? svenskKlocka(s.arrived_at) : "",
      kommentar: s.employee_comment ?? null,
      // Detaljerna gallras efter 90 dagar (0014).
      gallras: Math.max(0, 90 - Math.round((Date.parse(idag) - Date.parse(s.work_date)) / 86400000)),
    })),
    ledigt: (ledigt ?? []).map((l) => ({ typ: typnamn.get(l.type_id) ?? "Ledigt", fran: l.starts_on, till: l.ends_on, delDag: l.part_day_minutes !== null })),
    chef: null,
    extra: {},
    autoOk: [],
    schemaKvittens: [],
    veckokoll: [],
    paminn: PAMINN_STANDARD,
    tittat: [],
    info: null,
    sistaSamtal: {},
  };

  // 0094: det utkastet har och navet saknade.
  const admin = supabaseAdmin();
  const egnaKorr = egnaStamplar.filter((h) => h.korr).map((h) => h.id);
  const fyrtio = new Date(Date.parse(svenskDygnsstart(nu)) - 35 * 86400000).toISOString();
  const [{ data: extra }, { data: autoOk }, { data: sett }, { data: veckor }, { data: pref }, { data: tittat }, { data: grind }, { data: samtal }, { data: exporter }] = await Promise.all([
    egnaKorr.length ? supabase.from("time_correction_extra").select("time_event_id, support, reject_reason, rejection_seen_at").in("time_event_id", egnaKorr) : Promise.resolve({ data: [] as { time_event_id: string; support: string | null; reject_reason: string | null; rejection_seen_at: string | null }[] }),
    supabase.from("time_day_ack").select("work_date").eq("employee_id", mig).eq("kind", "auto_close_ok"),
    supabase.from("work_schedule_seen").select("valid_from").eq("employee_id", mig),
    supabase.from("time_week_check").select("week_start, ok, checked_at").eq("employee_id", mig).order("week_start", { ascending: false }).limit(26),
    supabase.from("nav_preference").select("value").eq("employee_id", mig).eq("key", "tid.paminn").maybeSingle(),
    supabase.from("tid_view_log").select("viewer_id, what, viewed_at").eq("employee_id", mig).gte("viewed_at", new Date(Date.parse(svenskDygnsstart(nu)) - 90 * 86400000).toISOString()).order("viewed_at", { ascending: false }).limit(30),
    admin.from("compliance_gate").select("staff_information_id").eq("key", "stampling").maybeSingle(),
    supabase.from("phone_call").select("ended_at").eq("employee_id", mig).gte("started_at", fyrtio).not("ended_at", "is", null).order("ended_at", { ascending: false }).limit(1000),
    // Lönerapportens uttag syns för den som finns i den. Läses med service role och bara för de egna perioderna.
    admin.from("audit_log").select("actor_id, object_id, created_at").eq("action", "payroll.exported").gte("created_at", new Date(Date.parse(svenskDygnsstart(nu)) - 90 * 86400000).toISOString()).order("created_at", { ascending: false }).limit(50),
  ]);
  for (const x of extra ?? []) ut.extra[x.time_event_id] = { stod: x.support, skal: x.reject_reason, sett: !!x.rejection_seen_at };
  ut.autoOk = (autoOk ?? []).map((a) => String(a.work_date));
  const settSet = new Set((sett ?? []).map((s) => String(s.valid_from)));
  ut.schemaKvittens = [...new Set([...rader.filter((r) => r.valid_from >= SCHEMA_KVITTENS_FRAN && (r.scope === "company" || (r.scope === "team" && r.team_id === teamId) || (r.scope === "employee" && r.employee_id === mig))).map((r) => r.valid_from)])]
    .filter((f) => f >= dagarBakat(idag, 30))
    .sort()
    .map((fran) => ({ fran, sett: settSet.has(fran) }));
  ut.veckokoll = (veckor ?? []).map((v) => ({ vecka: String(v.week_start), ok: !!v.ok, nar: `${svensktDatum(v.checked_at)} ${svenskKlocka(v.checked_at)}` }));
  if (pref?.value) {
    const v = pref.value as Partial<Paminn>;
    ut.paminn = { in: { ...PAMINN_STANDARD.in, ...(v.in ?? {}) }, ut: { ...PAMINN_STANDARD.ut, ...(v.ut ?? {}) } };
  }
  for (const s of samtal ?? []) {
    const d = svensktDatum(s.ended_at as string);
    if (!ut.sistaSamtal[d]) ut.sistaSamtal[d] = svenskKlocka(s.ended_at as string);
  }
  // Vem har tittat: öppnade sena dagar, och uttag av lönerapporter där du finns med.
  const exp = (exporter ?? []) as { actor_id: string | null; object_id: string; created_at: string }[];
  const { data: minaPerioder } = exp.length ? await supabase.from("payroll_row").select("period_id").eq("employee_id", mig).in("period_id", [...new Set(exp.map((e) => e.object_id))]) : { data: [] as { period_id: string }[] };
  const mina = new Set((minaPerioder ?? []).map((r) => r.period_id as string));
  const tittare = [...new Set([...(tittat ?? []).map((t) => t.viewer_id as string), ...exp.map((e) => e.actor_id).filter((x): x is string => !!x)])];
  const { data: tittarNamn } = tittare.length ? await admin.from("employee").select("id, first_name, last_name").in("id", tittare) : { data: [] as { id: string; first_name: string; last_name: string }[] };
  const tn = new Map((tittarNamn ?? []).map((p) => [p.id as string, fullName(p)]));
  ut.tittat = [
    ...(tittat ?? []).map((t) => ({ vem: tn.get(t.viewer_id as string) ?? "Okänd", vad: "öppnade dina sena dagar", at: t.viewed_at as string })),
    ...exp.filter((e) => mina.has(e.object_id) && e.actor_id).map((e) => ({ vem: tn.get(e.actor_id!) ?? "Okänd", vad: "tog med dig i lönerapporten", at: e.created_at })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 20)
    .map((t) => ({ vem: t.vem, vad: t.vad, nar: `${svensktDatum(t.at)} ${svenskKlocka(t.at)}` }));
  // K14: informationen till personalen, om den är kopplad.
  if (grind?.staff_information_id) {
    const { data: dok } = await supabase.from("document").select("id, title, slug, version").eq("id", grind.staff_information_id).maybeSingle();
    if (dok) {
      const { data: kv } = await supabase.from("document_ack").select("acked_at").eq("document_id", dok.id).eq("employee_id", mig).eq("version", dok.version).maybeSingle();
      ut.info = { titel: dok.title as string, href: `/rutiner/${dok.slug}`, kvitterad: kv?.acked_at ? svensktDatum(kv.acked_at as string) : null };
    }
  }

  if (!canManageEmployees(user)) return ut;

  // Chefens halva. Samma kallor som /tid, /tid/ogiltig-franvaro, /tid/lonerapport och startsidans dagsbild.
  const manadStart = idag.slice(0, 8) + "01";
  const [dagsbild, { data: personal }, { data: idagAlla }, { data: vantande }, { data: ogiltig }, { data: sena30 }, { data: perioder }, { data: trappa }, { data: manaden }, { data: teamRader }] =
    await Promise.all([
      hamtaDagsbild(supabase, nu, sparr.stampling),
      supabase.from("employee").select("id, first_name, last_name, team_id, employee_number, status"),
      supabase.from("time_event").select(STAMPELKOLUMNER + ", employee_id").gte("occurred_at", svenskDygnsstart(nu)).in("kind", ["in", "out"]).order("occurred_at"),
      supabase.from("time_event").select(STAMPELKOLUMNER + ", employee_id").eq("correction_state", "pending").order("created_at"),
      supabase.from("attendance_incident").select("id, employee_id, occurred_on, minutes, status, ordningsnummer, atgard, decided_at, decision_note").or(`status.eq.foreslagen,decided_at.gte.${dagarBakat(idag, 366)}`).order("occurred_on", { ascending: false }),
      supabase.from("late_arrival").select("employee_id, work_date, minutes_late, employee_comment").gte("work_date", dagarBakat(idag, 30)).order("work_date", { ascending: false }),
      supabase.from("payroll_period").select("id, period_start, period_end, status, generated_at, attested_at").order("period_start", { ascending: false }),
      supabase.from("consequence_rule").select("ordning, antal_handelser, periodlangd_manader, atgard, omfattning").order("ordning"),
      supabase.from("time_event").select(STAMPELKOLUMNER + ", employee_id").gte("occurred_at", new Date(`${manadStart}T00:00:00Z`).toISOString()).order("occurred_at"),
      supabase.from("team").select("id, name"),
    ]);

  // Namnen ur hela registret, ocksa for den som slutat: en gammal rad ska saga vem, inte "Okand".
  const alla = (personal ?? []) as { id: string; first_name: string; last_name: string; team_id: string | null; employee_number: string | number | null; status: string }[];
  const namn = new Map(alla.map((p) => [p.id, fullName(p)]));
  const pers = alla.filter((p) => p.status !== "offboarded");
  const teamNamn = new Map(((teamRader ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));

  // Pa plats: senaste gallande stampling ar "in". Samma regel som /tid.
  const perPerson = new Map<string, Handelse[]>();
  for (const h of (idagAlla ?? []) as unknown as (Handelse & { employee_id: string })[]) perPerson.set(h.employee_id, [...(perPerson.get(h.employee_id) ?? []), h]);
  const paPlats = pers
    .map((p) => {
      const g = gallande(perPerson.get(p.id) ?? []);
      const s = g[g.length - 1];
      return s?.kind === "in" ? { id: p.id, namn: namn.get(p.id)!, sedan: svenskKlocka(g.find((x) => x.kind === "in")!.occurred_at) } : null;
    })
    .filter((x): x is { id: string; namn: string; sedan: string } => x !== null)
    .sort((a, b) => a.sedan.localeCompare(b.sedan));

  // Rattelser som vantar: den nya tiden, och den den ersatter om det finns en.
  const vant = (vantande ?? []) as unknown as (Handelse & { employee_id: string; note: string | null; created_at: string })[];
  const ersattaIds = vant.map((v) => v.supersedes_id).filter((x): x is string => !!x);
  const { data: ersatta } = ersattaIds.length ? await supabase.from("time_event").select("id, occurred_at").in("id", ersattaIds) : { data: [] as { id: string; occurred_at: string }[] };
  const ersattTid = new Map((ersatta ?? []).map((e) => [e.id, e.occurred_at]));

  // Oppna dagar i manaden: sista gallande stamplingen ar inte "out" (lonerapport.ts), och inte i dag.
  const manPer = new Map<string, Handelse[]>();
  for (const h of (manaden ?? []) as unknown as (Handelse & { employee_id: string })[]) manPer.set(h.employee_id, [...(manPer.get(h.employee_id) ?? []), h]);
  const oppna: { pid: string; namn: string; dag: string }[] = [];
  for (const [pid, hs] of manPer) for (const d of oppnaDagar(gallande(hs))) if (d < idag) oppna.push({ pid, namn: namn.get(pid) ?? "Okänd", dag: d });

  // Senaste skrivna perioden: underlaget rad for rad, som /tid/lonerapport/[id].
  const pl = (perioder ?? []) as { id: string; period_start: string; period_end: string; status: string; generated_at: string | null; attested_at: string | null }[];
  const skriven = pl.find((p) => p.generated_at);
  let underlag: NonNullable<NdTid["chef"]>["underlag"] = null;
  if (skriven) {
    const [{ data: lonrader }, { data: just }] = await Promise.all([
      supabase.from("payroll_row").select("employee_id, worked_minutes, auto_closed_days, absence_minutes").eq("period_id", skriven.id),
      supabase.from("payroll_adjustment").select("employee_id, minutes").eq("period_id", skriven.id),
    ]);
    const j = new Map<string, number>();
    for (const x of just ?? []) j.set(x.employee_id, (j.get(x.employee_id) ?? 0) + x.minutes);
    underlag = {
      periodId: skriven.id,
      rader: (lonrader ?? [])
        .map((r) => ({
          pid: r.employee_id,
          namn: namn.get(r.employee_id) ?? "Okänd",
          nr: String(alla.find((p) => p.id === r.employee_id)?.employee_number ?? ""),
          arbetad: r.worked_minutes,
          justering: j.get(r.employee_id) ?? 0,
          stangda: r.auto_closed_days,
          franvaro: (r.absence_minutes ?? {}) as Record<string, number>,
        }))
        .sort((a, b) => a.namn.localeCompare(b.namn, "sv")),
    };
  }

  const senaPer = new Map<string, { dagar: { dag: string; min: number }[]; kommentar: string | null }>();
  for (const s of sena30 ?? []) {
    const x = senaPer.get(s.employee_id) ?? { dagar: [], kommentar: null };
    x.dagar.push({ dag: s.work_date, min: s.minutes_late });
    if (!x.kommentar && s.employee_comment) x.kommentar = s.employee_comment;
    senaPer.set(s.employee_id, x);
  }

  // 0094: det chefens Tid i Nav 2.0 har utöver repot.
  const vecka = (d: string) => dagarBakat(d, svenskVeckodag(svenskTidpunkt(d, "12:00")) - 1);
  const nastaMandag = dagarBakat(vecka(idag), -7);
  const nastaFredag = dagarBakat(nastaMandag, -4);
  const veckaStart = new Date(Date.parse(svenskTidpunkt(vecka(idag), "00:00").toISOString())).toISOString();
  const [{ data: stodRader }, { data: settAlla }, { data: beslutade }, { data: minaRattBeslut }, { data: minaOgiltigBeslut }, { data: chefPref }, { data: minLogg }, { data: franvaroNasta }, { data: sjukNasta }, { data: kolumner }, { data: skickade }, { data: uttag }, { data: punkter }] = await Promise.all([
    vant.length ? supabase.from("time_correction_extra").select("time_event_id, support").in("time_event_id", vant.map((v) => v.id)) : Promise.resolve({ data: [] as { time_event_id: string; support: string | null }[] }),
    supabase.from("work_schedule_seen").select("employee_id, valid_from").gte("valid_from", SCHEMA_KVITTENS_FRAN),
    supabase.from("time_event").select("created_at, decided_at").not("decided_at", "is", null).not("correction_state", "is", null).order("decided_at", { ascending: false }).limit(10),
    supabase.from("time_event").select("id", { count: "exact", head: false }).eq("decided_by", mig).gte("decided_at", svenskDygnsstart(nu)),
    supabase.from("attendance_incident").select("id").eq("decided_by", mig).gte("decided_at", svenskDygnsstart(nu)),
    supabase.from("nav_preference").select("key, value").eq("employee_id", mig).in("key", ["tid.senast", "tid.morgonnotis"]),
    supabase.from("tid_view_log").select("employee_id, what, viewed_at").eq("viewer_id", mig).gte("viewed_at", veckaStart).order("viewed_at", { ascending: false }).limit(20),
    supabase.from("absence_request").select("employee_id, type_id, starts_on, ends_on, status").in("status", ["approved", "submitted"]).lte("starts_on", nastaFredag).gte("ends_on", nastaMandag),
    supabase.from("sick_report").select("employee_id, first_sick_day, last_sick_day").is("cancelled_at", null).lte("first_sick_day", nastaFredag),
    supabase.from("payroll_export_column").select("id, header, field, active, sort").order("sort"),
    supabase.from("payroll_period_sent").select("period_id, sent_at"),
    supabase.from("audit_log").select("object_id, created_at").eq("action", "payroll.exported").order("created_at", { ascending: false }).limit(200),
    supabase.from("one_on_one_point").select("employee_id").eq("source", "tid-sen").is("handled_at", null),
  ]);
  const { data: allaTyper } = await supabase.from("absence_type").select("id, label");
  const typNamn = new Map((allaTyper ?? []).map((t) => [t.id as string, t.label as string]));

  // Nya scheman: vilka de gäller, hur många som sett dem, och vilka som saknas.
  const settPar = new Set((settAlla ?? []).map((s) => `${s.employee_id}|${s.valid_from}`));
  const nyaScheman = new Map<string, { fran: string; scope: string; id: string | null }>();
  for (const r of rader) if (r.valid_from >= SCHEMA_KVITTENS_FRAN && r.valid_from >= dagarBakat(idag, 30)) nyaScheman.set(`${r.valid_from}|${r.scope}|${r.team_id ?? r.employee_id ?? ""}`, { fran: r.valid_from, scope: r.scope, id: r.team_id ?? r.employee_id });
  const schemaSett = [...nyaScheman.values()].map((s) => {
    const berorda = pers.filter((p) => s.scope === "company" || (s.scope === "team" && p.team_id === s.id) || (s.scope === "employee" && p.id === s.id));
    const saknas = berorda.filter((p) => !settPar.has(`${p.id}|${s.fran}`));
    return { fran: s.fran, vem: s.scope === "company" ? "Hela bolaget" : s.scope === "team" ? (teamNamn.get(s.id ?? "") ?? "Ett team") : (namn.get(s.id ?? "") ?? "En person"), sett: berorda.length - saknas.length, av: berorda.length, saknas: saknas.map((p) => namn.get(p.id)!) };
  });

  const beslutRader = (beslutade ?? []) as { created_at: string; decided_at: string }[];
  const prefMap = new Map((chefPref ?? []).map((r) => [r.key as string, r.value]));
  const senastIso = typeof prefMap.get("tid.senast") === "string" ? (prefMap.get("tid.senast") as string) : null;

  // Nästa vecka: anmäld eller sökt frånvaro, dag för dag.
  const nastaVecka = [0, 1, 2, 3, 4].map((i) => {
    const dag = dagarBakat(nastaMandag, -i);
    const r = [
      ...((franvaroNasta ?? []) as { employee_id: string; type_id: string; starts_on: string; ends_on: string; status: string }[])
        .filter((a) => a.starts_on <= dag && a.ends_on >= dag)
        .map((a) => ({ namn: namn.get(a.employee_id) ?? "Okänd", typ: typNamn.get(a.type_id) ?? "Ledigt", vantar: a.status === "submitted" })),
      ...((sjukNasta ?? []) as { employee_id: string; first_sick_day: string; last_sick_day: string | null }[])
        .filter((s) => s.first_sick_day <= dag && (s.last_sick_day === null || s.last_sick_day >= dag))
        .map((s) => ({ namn: namn.get(s.employee_id) ?? "Okänd", typ: "Sjuk", vantar: false })),
    ];
    return { dag, rader: r };
  });

  // Toleranssimuleringen: dagens första instämpling mot schemats start, utan namn.
  const ankomster: { start: string; min: number }[] = [];
  const idagVeckodag = svenskVeckodag(nu);
  for (const p of pers) {
    const g = gallande(perPerson.get(p.id) ?? []);
    const forst = g.find((x) => x.kind === "in");
    const s = schemaFor(p.id, p.team_id, idag, idagVeckodag);
    if (forst && s) ankomster.push({ start: kl(s.start_time), min: svenskaMinuter(forst.occurred_at) });
  }

  // Lönerapportens steg: granskad = attesterad, nedladdad = senaste uttaget, skickad = 0094.
  const skickadMap = new Map((skickade ?? []).map((s) => [s.period_id as string, svensktDatum(s.sent_at as string)]));
  const uttagMap = new Map<string, string>();
  for (const u of uttag ?? []) if (!uttagMap.has(u.object_id as string)) uttagMap.set(u.object_id as string, svensktDatum(u.created_at as string));
  const steg: Record<string, { granskad: string | null; nedladdad: string | null; skickad: string | null }> = {};
  for (const p of pl) steg[p.id] = { granskad: p.attested_at ? svensktDatum(p.attested_at) : null, nedladdad: uttagMap.get(p.id) ?? null, skickad: skickadMap.get(p.id) ?? null };

  // Löpande underlag för perioden som pågår: journalen hittills, rättelserna, de stängda dagarna och tiden utanför schemat.
  const pagar = pl.find((p) => p.period_start <= idag && p.period_end >= idag);
  const lopStart = pagar?.period_start ?? manadStart;
  const lopSlut = pagar?.period_end ?? dagarBakat(dagarBakat(manadStart, -32).slice(0, 8) + "01", 1);
  const [{ data: journal }, utanfor, { data: lopJust }, { data: lopFranvaro }, { data: lopSjuk }] = await Promise.all([
    admin.from("work_time_journal").select("employee_id, work_date, worked_minutes, auto_closed").gte("work_date", lopStart).lte("work_date", lopSlut),
    utanforSchemat(admin, lopStart, idag < lopSlut ? idag : lopSlut),
    pagar ? supabase.from("payroll_adjustment").select("employee_id, minutes").eq("period_id", pagar.id) : Promise.resolve({ data: [] as { employee_id: string; minutes: number }[] }),
    supabase.from("absence_request").select("employee_id, type_id, starts_on, ends_on").eq("status", "approved").lte("starts_on", lopSlut).gte("ends_on", lopStart),
    supabase.from("sick_report").select("employee_id, first_sick_day, last_sick_day").is("cancelled_at", null).lte("first_sick_day", lopSlut),
  ]);
  const jsum = new Map<string, { arbetad: number; stangda: number; dagar: number }>();
  for (const j of (journal ?? []) as { employee_id: string; worked_minutes: number; auto_closed: boolean }[]) {
    const x = jsum.get(j.employee_id) ?? { arbetad: 0, stangda: 0, dagar: 0 };
    x.arbetad += j.worked_minutes;
    x.dagar += 1;
    if (j.auto_closed) x.stangda += 1;
    jsum.set(j.employee_id, x);
  }
  const ljust = new Map<string, number>();
  for (const j of lopJust ?? []) ljust.set(j.employee_id, (ljust.get(j.employee_id) ?? 0) + j.minutes);
  const kort = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
  const forklaring = new Map<string, string>();
  for (const a of (lopFranvaro ?? []) as { employee_id: string; type_id: string; starts_on: string; ends_on: string }[]) if (!forklaring.has(a.employee_id)) forklaring.set(a.employee_id, `${typNamn.get(a.type_id) ?? "Ledigt"} ${kort(a.starts_on)}–${kort(a.ends_on)}`);
  for (const s of (lopSjuk ?? []) as { employee_id: string; first_sick_day: string; last_sick_day: string | null }[]) if ((s.last_sick_day ?? lopSlut) >= lopStart && !forklaring.has(s.employee_id)) forklaring.set(s.employee_id, s.last_sick_day ? `Sjuk ${kort(s.first_sick_day)}–${kort(s.last_sick_day)}` : `Sjuk sedan ${kort(s.first_sick_day)}`);
  // Avvikelse: arbetad tid mot schemats minuter för de avslutade dagarna, mer än tio procent åt något håll.
  const schemaMin = (pid: string, team: string | null) => {
    let m = 0;
    for (let d = lopStart; d < idag && d <= lopSlut; d = dagarBakat(d, -1)) {
      const s = schemaFor(pid, team, d, svenskVeckodag(svenskTidpunkt(d, "12:00")));
      if (s) m += Math.max(0, svenskaMinuter(svenskTidpunkt(d, kl(s.end_time)).toISOString()) - svenskaMinuter(svenskTidpunkt(d, kl(s.start_time)).toISOString()));
    }
    return m;
  };
  const lopande = {
    start: lopStart,
    slut: lopSlut,
    rader: pers
      .filter((p) => jsum.has(p.id) || forklaring.has(p.id))
      .map((p) => {
        const j = jsum.get(p.id) ?? { arbetad: 0, stangda: 0, dagar: 0 };
        const plan = schemaMin(p.id, p.team_id);
        const arbetad = j.arbetad + (ljust.get(p.id) ?? 0);
        return {
          pid: p.id,
          namn: namn.get(p.id)!,
          nr: String(p.employee_number ?? ""),
          arbetad: j.arbetad,
          justering: ljust.get(p.id) ?? 0,
          stangda: j.stangda,
          utanfor: utanfor.get(p.id) ?? 0,
          forklaring: forklaring.get(p.id) ?? null,
          avvik: plan > 0 && !forklaring.has(p.id) && Math.abs(arbetad - plan) / plan > 0.1,
        };
      })
      .sort((a, b) => a.namn.localeCompare(b.namn, "sv")),
  };

  // Toleransen: chefens eget team om det har ett schema, annars bolagets.
  const minTeam = alla.find((p) => p.id === mig)?.team_id ?? null;
  const tolRad = (minTeam && rader.filter((r) => r.scope === "team" && r.team_id === minTeam && r.valid_from <= idag).sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0]) || rader.filter((r) => r.scope === "company" && r.valid_from <= idag).sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0];

  ut.chef = {
    dagsbild: dagsbild.rader,
    bedomda: dagsbild.bedomda,
    paPlats,
    rattelser: vant.map((v) => ({
      id: v.id,
      pid: v.employee_id,
      namn: namn.get(v.employee_id) ?? "Okänd",
      kind: v.kind,
      fran: v.supersedes_id ? (ersattTid.has(v.supersedes_id) ? svenskKlocka(ersattTid.get(v.supersedes_id)!) : null) : null,
      till: svenskKlocka(v.occurred_at),
      dag: svensktDatum(v.occurred_at),
      note: v.note,
      begard: v.created_at,
      timmar: Math.floor((nu.getTime() - Date.parse(v.created_at)) / 3600000),
    })),
    ogiltig: ((ogiltig ?? []) as { id: string; employee_id: string; occurred_on: string; minutes: number; status: string; ordningsnummer: number | null; atgard: string | null; decided_at: string | null; decision_note: string | null }[]).map((o) => ({
      id: o.id,
      pid: o.employee_id,
      namn: namn.get(o.employee_id) ?? "Okänd",
      dag: o.occurred_on,
      min: o.minutes,
      status: o.status,
      ordning: o.ordningsnummer,
      atgard: o.atgard,
      beslutad: o.decided_at ? svensktDatum(o.decided_at) : null,
      not: o.decision_note,
    })),
    sena30: [...senaPer].map(([pid, x]) => ({ pid, namn: namn.get(pid) ?? "Okänd", ...x })).sort((a, b) => b.dagar.length - a.dagar.length || a.namn.localeCompare(b.namn, "sv")),
    oppna: oppna.sort((a, b) => a.dag.localeCompare(b.dag)),
    perioder: pl.map((p) => ({ id: p.id, start: p.period_start, slut: p.period_end, status: p.status, skriven: !!p.generated_at, attesterad: p.attested_at ? svensktDatum(p.attested_at) : null })),
    underlag,
    scheman: rader.map((r) => ({
        veckodag: r.weekday,
        start: kl(r.start_time),
        slut: kl(r.end_time),
        tol: r.tol_late ?? 1,
        niva: r.scope,
        fran: r.valid_from,
        vem: r.scope === "company" ? "Hela bolaget" : r.scope === "team" ? (teamNamn.get(r.team_id ?? "") ?? "Ett team") : (namn.get(r.employee_id ?? "") ?? "En person"),
      })),
    trappa: (trappa ?? []).map((t) => ({ ordning: t.ordning, antal: t.antal_handelser, manader: t.periodlangd_manader, atgard: t.atgard, omfattning: t.omfattning })),
    stod: Object.fromEntries((stodRader ?? []).filter((s) => s.support).map((s) => [s.time_event_id, s.support as string])),
    schemaSett,
    beslut48: { inom: beslutRader.filter((b) => Date.parse(b.decided_at) - Date.parse(b.created_at) <= 48 * 3600000).length, av: beslutRader.length },
    klaraIdag: (minaRattBeslut ?? []).length + (minaOgiltigBeslut ?? []).length,
    senast: { nar: senastIso ? svenskKlocka(senastIso) : null, iso: senastIso, nya: senastIso ? vant.filter((v) => v.created_at > senastIso).length : 0 },
    morgonnotis: typeof prefMap.get("tid.morgonnotis") === "string" ? (prefMap.get("tid.morgonnotis") as string) : "08:15",
    logg: (minLogg ?? []).map((l) => ({ namn: namn.get(l.employee_id as string) ?? "Okänd", vad: "sena dagar", nar: `${svensktDatum(l.viewed_at as string)} ${svenskKlocka(l.viewed_at as string)}` })),
    nastaVecka,
    ankomster,
    kolumner: (kolumner ?? []).map((k) => ({ id: k.id as string, header: k.header as string, field: k.field as string, active: !!k.active })),
    steg,
    lopande,
    punkter: [...new Set((punkter ?? []).map((p) => p.employee_id as string))],
    personIds: Object.fromEntries(pers.map((p) => [namn.get(p.id)!, p.id])),
    harEgetSchema: [...new Set(rader.filter((r) => r.scope === "employee" && r.employee_id).map((r) => r.employee_id as string))],
    tolerans: tolRad ? { scope: tolRad.scope, scopeId: tolRad.scope === "team" ? tolRad.team_id : null, namn: tolRad.scope === "team" ? (teamNamn.get(tolRad.team_id ?? "") ?? "Teamet") : "Hela bolaget", tol: tolRad.tol_late ?? 1 } : null,
  };
  return ut;
}
