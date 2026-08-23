import { cache } from "react";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { kraverByte } from "@/lib/losenordsbyte";
import type { Permission, Role } from "@/lib/roles";

export type CurrentUser = {
  authUserId: string;
  email: string;
  employee: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    status: string;
    team_id: string | null;
    employment_type: string;
    start_date: string | null;
  } | null;
  roles: Role[];
  permissions: Permission[];
};

/**
 * AC-1.2: en anvandare utan employee-rad kan logga in men ser endast
 * "vantar pa aktivering". Darfor returneras employee: null i stallet for null
 * pa hela objektet.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  /**
   * Migration 0017 stanger API:t for den som inte bytt sitt tillfalliga
   * losenord: med anvandarens egen token ger varje tabell noll rader.
   *
   * Servern behover anda veta vem personen ar. Tva stallen kraver det medan
   * tvanget star kvar: /byt-losenord nekar ett losenord som innehaller det
   * egna namnet, och steg tva maste kunna se rollen for att fa komma FORE
   * bytet. Utan den har raden hade ett flaggat chefskonto sett ut som ett
   * konto helt utan roller — och sluppit bekrafta enheten.
   *
   * Granserna ar alltsa olika med flit: flaggan stanger API:t, inte servern.
   * Service role lamnar aldrig servern, och mellanvaran har redan skickat
   * kontot till /byt-losenord fran varje annan adress.
   */
  const las = kraverByte(user.app_metadata) ? supabaseAdmin() : supabase;

  /**
   * EN fraga, inte tre.
   *
   * Rollerna och rattigheterna hamtas som inbaddade relationer i stallet for
   * som tva foljdfragor efter att employee-raden kommit tillbaka. Skillnaden ar
   * inte kosmetisk: varje sida i navet borjar med det har anropet, sa de tva
   * sparade turerna betalas tillbaka en gang per sidvisning.
   *
   * RLS galler oforandrat. PostgREST tillampar policyn pa varje inbaddad tabell
   * for sig, precis som pa en fristaende fraga — mellanvaran har last rollerna
   * pa exakt det har sattet sedan AC-1.1 byggdes.
   *
   * ROR INTE `!employee_role_employee_id_fkey`. Bada tabellerna pekar TVA
   * ganger pa employee: en gang pa den som HAR rollen (employee_id) och en
   * gang pa den som DELADE UT den (granted_by). Utan namngiven nyckel vet
   * PostgREST inte vilken som menas och avvisar hela fragan med PGRST201 —
   * `employee` blir null och varje inloggad ser "vantar pa aktivering".
   * Typecheck sager ingenting om detta; det syns forst mot databasen.
   */
  const { data: employee } = await las
    .from("employee")
    .select(
      "id, first_name, last_name, email, status, team_id, employment_type, start_date," +
        " employee_role!employee_role_employee_id_fkey(role)," +
        " employee_permission!employee_permission_employee_id_fkey(permission)",
    )
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!employee) {
    return {
      authUserId: user.id,
      email: user.email ?? "",
      employee: null,
      roles: [],
      permissions: [],
    };
  }

  const rad = employee as unknown as NonNullable<CurrentUser["employee"]> & {
    employee_role: { role: string }[] | null;
    employee_permission: { permission: string }[] | null;
  };

  return {
    authUserId: user.id,
    email: user.email ?? rad.email,
    employee: {
      id: rad.id,
      first_name: rad.first_name,
      last_name: rad.last_name,
      email: rad.email,
      status: rad.status,
      team_id: rad.team_id,
      employment_type: rad.employment_type,
      start_date: rad.start_date,
    },
    roles: (rad.employee_role ?? []).map((r) => r.role as Role),
    permissions: (rad.employee_permission ?? []).map((p) => p.permission as Permission),
  };
});

export function hasRole(user: CurrentUser | null, ...roles: Role[]): boolean {
  return Boolean(user && roles.some((r) => user.roles.includes(r)));
}

/** Ser hela personalregistret. PRD §5.2. */
export function canReadAllEmployees(user: CurrentUser | null): boolean {
  return hasRole(user, "sales_manager", "ceo", "admin");
}

/** Far lagga upp och avsluta anstallda. US-1.2, US-1.3. */
export function canManageEmployees(user: CurrentUser | null): boolean {
  return hasRole(user, "sales_manager", "admin");
}

export function fullName(e: { first_name: string; last_name: string }): string {
  return `${e.first_name} ${e.last_name}`.trim();
}

export function initials(e: { first_name: string; last_name: string }): string {
  return `${e.first_name.charAt(0)}${e.last_name.charAt(0)}`.toUpperCase();
}
