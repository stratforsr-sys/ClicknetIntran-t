import "server-only";

import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { svensktDatum, svenskVeckodag } from "@/lib/klocka";
import { gallandeSchema } from "@/lib/raster";
import type { CurrentUser } from "@/lib/auth";
import { hasRole } from "@/lib/auth";
import {
  dagarna,
  type Attestniva,
  type Bemanningstak,
  type Franvarotyp,
  type Provunderlag,
  type Regelverk,
  type Saldo,
  type Sparrperiod,
} from "@/lib/franvaro";

/**
 * Frånvaromodulens serversida. Allt som rör läsning ur databasen, ingen regel.
 *
 * Reglerna bor i `src/lib/franvaro.ts` och bedömer det som skickas in. Den här
 * filen hämtar det som ska skickas in — och gör ingenting annat, så att
 * regelmotorn går att prova utan databas.
 */

/**
 * Faltlistorna star som EN strangliteral var, inte som hopslagna delar.
 *
 * Supabase harleder radens typ ur select-strangen. En konkatenering — eller ett
 * `const` utan `as const` — vidgas till `string`, och da faller hela
 * typhardledningen tillbaka pa `GenericStringError`. Raderna blir langa; det
 * ar priset for att kompilatorn ska kunna se vad de innehaller.
 */
export const TYPFALT =
  "id, label, sort, notice_days, max_consecutive_days, waiting_days, approval_level, uses_balance, counts_in_staffing, allows_part_day, requestable, active" as const;

export const REGELFALT =
  "vacation_year_start_month, vacation_year_start_day, main_vacation_start_month, main_vacation_start_day, main_vacation_end_month, main_vacation_end_day, main_vacation_notice_days, saved_days_max_years, balance_stale_days, sick_certificate_day, sick_fk_day, sick_return_plan_day, sick_confirm_hours, relapse_days, repeat_sick_count, repeat_sick_months, unregistered_reminder_hours" as const;

/**
 * Reglerna som gäller nu.
 *
 * Läses med användarens egen token: `absence_type_read` och
 * `absence_policy_read` släpper in varje inloggad utom den som måste byta
 * lösenord (0017, 0019). AC-3.13 kräver att den anställda ser reglerna innan
 * hen skickar in, så det finns ingenting här att dölja.
 */
export async function hamtaRegelverk(): Promise<{ regler: Regelverk; typer: Franvarotyp[] } | null> {
  const supabase = await supabaseServer();

  const [{ data: policy }, { data: typer }] = await Promise.all([
    supabase.from("absence_policy").select(REGELFALT).maybeSingle(),
    supabase.from("absence_type").select(TYPFALT).eq("active", true).order("sort"),
  ]);

  if (!policy) return null;
  return { regler: policy as Regelverk, typer: (typer ?? []) as Franvarotyp[] };
}

/**
 * Allt regelmotorn behöver för att bedöma en ansökan från en viss person.
 *
 * Läses med SERVICE ROLE, och det är inte en genväg. Bemanningsräkningen i
 * E7.2 behöver veta hur många i teamet som är borta en viss dag — men den som
 * ansöker ska inte kunna läsa vilka de är. Med användarens egen token hade
 * frågan gett noll rader för en säljare, och varningen hade tyst blivit
 * "ingen är borta". Därför räknas antalet på servern och bara antalet lämnar
 * den. Se `varstaBemanningsdag`, som får perioderna men vars svar bara bär ett
 * datum och en siffra.
 */
export async function hamtaProvunderlag(
  employeeId: string,
  teamId: string | null,
  typ: Franvarotyp,
  regler: Regelverk,
  fran: string,
  till: string,
): Promise<Provunderlag> {
  const db = supabaseAdmin();

  const [{ data: sparrar }, { data: tak }, { data: saldon }, { data: egna }, { data: andras }, { data: typer }] =
    await Promise.all([
      db.from("absence_blackout").select("id, label, starts_on, ends_on, type_ids, team_ids").lte("starts_on", till).gte("ends_on", fran),
      db.from("staffing_cap").select("team_id, max_absent"),
      db.from("absence_balance").select("type_id, days, as_of, earned_year").eq("employee_id", employeeId),
      db
        .from("absence_request")
        .select("employee_id, type_id, starts_on, ends_on, part_day_minutes")
        .eq("employee_id", employeeId)
        .in("status", ["submitted", "approved"]),
      db
        .from("absence_request")
        .select("employee_id, type_id, starts_on, ends_on, part_day_minutes, employee!inner(team_id)")
        .eq("status", "approved")
        .lte("starts_on", till)
        .gte("ends_on", fran),
      db.from("absence_type").select("id, counts_in_staffing"),
    ]);

  // Teamets eget tak går före bolagets. Saknar teamet ett gäller bolagets, och
  // saknas båda finns inget tak att varna mot.
  const taken = (tak ?? []) as Bemanningstak[];
  const mitt = taken.find((t) => t.team_id !== null && t.team_id === teamId) ?? null;
  const bolag = taken.find((t) => t.team_id === null) ?? null;

  return {
    typ,
    regler,
    idag: svensktDatum(),
    sparrperioder: (sparrar ?? []) as Sparrperiod[],
    teamId,
    saldon: ((saldon ?? []) as { type_id: string; days: string | number; as_of: string; earned_year: number | null }[]).map(
      (s): Saldo => ({ ...s, days: Number(s.days) }),
    ),
    egnaPerioder: egna ?? [],
    andrasPerioder: ((andras ?? []) as unknown as {
      employee_id: string;
      type_id: string;
      starts_on: string;
      ends_on: string;
      part_day_minutes: number | null;
      employee: { team_id: string | null } | null;
    }[]).map((p) => ({
      employee_id: p.employee_id,
      type_id: p.type_id,
      starts_on: p.starts_on,
      ends_on: p.ends_on,
      part_day_minutes: p.part_day_minutes,
      team_id: p.employee?.team_id ?? null,
    })),
    tak: mitt ?? bolag,
    raknasIBemanning: new Set(
      ((typer ?? []) as { id: string; counts_in_staffing: boolean }[])
        .filter((t) => t.counts_in_staffing)
        .map((t) => t.id),
    ),
  };
}

/**
 * Får den här personen besluta om den här ansökan?
 *
 * `approval_level` per typ (E7.15) sätter GOLVET, inte taket: säljchefen och VD
 * får alltid besluta. Skälet är AC-3.18:s chefsfallback — en säljare vars
 * teamledare är sjuk ska inte få vänta på semesterbesked till hen är tillbaka.
 */
export function farBesluta(
  user: CurrentUser | null,
  niva: Attestniva,
  ledare: boolean,
): boolean {
  if (!user?.employee) return false;
  if (hasRole(user, "sales_manager", "ceo")) return true;
  if (niva === "manager") return ledare;
  return false;
}

/** Leder den inloggade den här personen? Samma fråga som `leads_employee()` i SQL. */
export async function lederPersonen(user: CurrentUser | null, employeeId: string): Promise<boolean> {
  if (!user?.employee) return false;
  if (user.employee.id === employeeId) return false;

  const db = supabaseAdmin();
  const [{ data: person }, { data: team }] = await Promise.all([
    db.from("employee").select("manager_id, team_id").eq("id", employeeId).maybeSingle(),
    db.from("team").select("id").eq("lead_id", user.employee.id),
  ]);

  if (!person) return false;
  if (person.manager_id === user.employee.id) return true;
  return Boolean(person.team_id && (team ?? []).some((t) => t.id === person.team_id));
}

/**
 * Schemalagda minuter per person och dag.
 *
 * En dag utan schema ger noll. Det är samma hållning som `oppnaDagar()` i
 * lönerapporten: navet gissar inte en åttatimmarsdag åt någon vars schema det
 * inte känner. Följden är att frånvaro för den utan schema inte ger några
 * minuter i löneunderlaget — vilket är rätt sorts fel, eftersom det syns som
 * en nolla någon kan fråga om i stället för som en siffra ingen kan förklara.
 */
export async function schemaminuter(): Promise<(employeeId: string, datum: string) => number> {
  const db = supabaseAdmin();

  const [{ data: personal }, { data: scheman }] = await Promise.all([
    db.from("employee").select("id, team_id"),
    db.from("work_schedule").select("id, scope, employee_id, team_id, weekday, start_time, end_time, valid_from"),
  ]);

  const team = new Map((personal ?? []).map((p) => [p.id, p.team_id]));

  return (employeeId, datum) => {
    const veckodag = svenskVeckodag(`${datum}T12:00:00.000Z`);
    const rad = gallandeSchema(
      (scheman ?? []).filter((s) => s.weekday === veckodag),
      employeeId,
      team.get(employeeId) ?? null,
      datum,
    )[0];

    if (!rad) return 0;

    const min = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
    return Math.max(0, min(rad.end_time) - min(rad.start_time));
  };
}

/** Antal kalenderdagar frånvaro per typ inom ett spann — för saldovyn. */
export function dagarPerTyp(
  perioder: { type_id: string; starts_on: string; ends_on: string; part_day_minutes: number | null }[],
  fran: string,
  till: string,
): Record<string, number> {
  const ut: Record<string, number> = {};
  for (const p of perioder) {
    // Del av dag räknas inte som en hel semesterdag i saldot. Att räkna två
    // timmar som en dag hade fått saldot att sjunka fortare än verkligheten.
    if (p.part_day_minutes !== null) continue;
    const dagar = dagarna(p.starts_on, p.ends_on).filter((d) => d >= fran && d <= till).length;
    if (dagar > 0) ut[p.type_id] = (ut[p.type_id] ?? 0) + dagar;
  }
  return ut;
}
