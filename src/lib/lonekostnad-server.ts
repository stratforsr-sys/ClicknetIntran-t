import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CurrentUser } from "@/lib/auth";
import type { Satser } from "@/lib/lonekostnad";

/**
 * E15: hamtningen av satser och underlag.
 *
 * ===========================================================================
 * K26 / AC-13.1: BEHORIGHETEN AR `payroll_cost_viewer`, INTE EN ROLL.
 *
 * Rollen `finance` racker inte, och det ar hela skalet att behorigheten ligger
 * i en egen tabell sedan 0001: kretsen som ser vad folk KOSTAR ar mindre an
 * den som skoter loner. Policyerna i 0025 ger noll rader utan den, sa en vy
 * som glommer kontrollera far ingenting att rita — men handlingar som skriver
 * gar med service role, och de maste fraga sjalva.
 * ===========================================================================
 *
 * ===========================================================================
 * AC-3.26 / E7.14: FRANVARON KOMMER UR `payroll_row.absence_minutes`.
 *
 * Aldrig genom att joina `sick_report`. Den tabellen ger noll rader for
 * `payroll_cost_viewer` (0020), sa en vy som forsokte hade fatt TYST FEL DATA
 * i stallet for ett felmeddelande — noll sjukminuter ser ut som en frisk
 * saljare.
 *
 * Att berakningen hanger pa en LONEPERIOD och inte pa ett datumintervall ar
 * vad som gor den kopplingen strukturell: minuterna finns bara i `payroll_row`,
 * och `payroll_row` finns bara for en period.
 * ===========================================================================
 */

export function farSeLonekostnad(user: CurrentUser | null): boolean {
  return Boolean(user?.permissions.includes("payroll_cost_viewer"));
}

/**
 * Satserna som gallde vid ett givet datum.
 *
 * Den senaste raden med `valid_from <= datum` och som inte gatt ut. En sats
 * som andras i november far inte andra oktobers berakning — den ar redan
 * gjord och bevarad i `rates_used`, men en OMRAKNING ska anda utga fran vad
 * som gallde da.
 */
export async function hamtaSatser(db: SupabaseClient, datum: string): Promise<Satser> {
  const { data } = await db
    .from("cost_rate")
    .select("kind, applies_to, unit, value, valid_from, valid_to")
    .lte("valid_from", datum)
    .order("valid_from", { ascending: false });

  const rader = (data ?? []).filter((r) => !r.valid_to || r.valid_to >= datum);

  // Forsta traffen per nyckel vinner, och listan ar sorterad med senaste
  // `valid_from` forst.
  const forst = (kind: string, appliesTo: string | null = null): number | null => {
    const rad = rader.find((r) => r.kind === kind && (r.applies_to ?? null) === appliesTo);
    return rad ? Number(rad.value) : null;
  };

  const franvarofaktor: Record<string, number> = {};
  for (const r of rader) {
    if (r.kind !== "absence_cost_factor" || !r.applies_to) continue;
    if (!(r.applies_to in franvarofaktor)) franvarofaktor[r.applies_to] = Number(r.value);
  }

  /**
   * Saknas en sats faller den tillbaka pa noll — och det ar med flit inte ett
   * "rimligt standardvarde". En arbetsgivaravgift pa noll ser fel ut direkt i
   * vyn; ett dolt standardvarde pa 31,42 hade sett ratt ut och tyst gjort
   * `cost_rate` overflodig, vilket ar precis vad E15.2 forbjuder.
   */
  return {
    standard: forst("employer_fee_standard") ?? 0,
    reducerad: forst("employer_fee_reduced") ?? 0,
    reduceradTak: forst("employer_fee_reduced_cap") ?? 0,
    ungMin: forst("young_age_min") ?? 0,
    ungMax: forst("young_age_max") ?? 0,
    seniorMin: forst("senior_age_min") ?? 0,
    tackningsgrad: forst("contribution_margin"),
    franvarofaktor,
  };
}

/** Manadslonen som gallde vid periodens borjan. */
export async function hamtaLon(
  db: SupabaseClient,
  employeeId: string,
  datum: string,
): Promise<number | null> {
  const { data } = await db
    .from("salary_basis")
    .select("monthly_salary")
    .eq("employee_id", employeeId)
    .lte("valid_from", datum)
    .order("valid_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ? Number(data.monthly_salary) : null;
}

/**
 * Samma fraga som `hamtaLon`, men for hela perioden i ETT anrop.
 *
 * `raknaPeriod` fragade tidigare en gang per anstalld inuti loopen. Det ar en
 * tur till databasen per person, och de gick efter varandra — tjugofem
 * anstallda blev tjugofem vantetider i rad.
 *
 * Regeln ar oforandrad: den senaste raden vars `valid_from` inte ligger efter
 * periodens start galler. Raderna kommer sorterade aldst forst, sa den sista
 * skrivningen per person vinner.
 */
export async function hamtaLonerFor(
  db: SupabaseClient,
  employeeIds: string[],
  datum: string,
): Promise<Map<string, number>> {
  const per = new Map<string, number>();
  if (employeeIds.length === 0) return per;

  const { data } = await db
    .from("salary_basis")
    .select("employee_id, monthly_salary, valid_from")
    .in("employee_id", employeeIds)
    .lte("valid_from", datum)
    .order("valid_from", { ascending: true });

  for (const rad of data ?? []) per.set(rad.employee_id, Number(rad.monthly_salary));
  return per;
}
