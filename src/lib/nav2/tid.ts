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
import { dagarBakat, svensktDatum, svenskaMinuter, svenskKlocka, svenskDygnsstart } from "@/lib/klocka";

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
  };

  if (!canManageEmployees(user)) return ut;

  // Chefens halva. Samma kallor som /tid, /tid/ogiltig-franvaro, /tid/lonerapport och startsidans dagsbild.
  const manadStart = idag.slice(0, 8) + "01";
  const [dagsbild, { data: personal }, { data: idagAlla }, { data: vantande }, { data: ogiltig }, { data: sena30 }, { data: perioder }, { data: trappa }, { data: manaden }, { data: teamRader }] =
    await Promise.all([
      hamtaDagsbild(supabase, nu, sparr.stampling),
      supabase.from("employee").select("id, first_name, last_name, team_id, employee_number, status"),
      supabase.from("time_event").select(STAMPELKOLUMNER + ", employee_id").gte("occurred_at", svenskDygnsstart(nu)).in("kind", ["in", "out"]).order("occurred_at"),
      supabase.from("time_event").select(STAMPELKOLUMNER + ", employee_id").eq("correction_state", "pending").order("created_at"),
      supabase.from("attendance_incident").select("id, employee_id, occurred_on, minutes, status, ordningsnummer, atgard, decided_at, decision_note").or(`status.eq.foreslagen,decided_at.gte.${dagarBakat(idag, 60)}`).order("occurred_on", { ascending: false }),
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
  };
  return ut;
}
