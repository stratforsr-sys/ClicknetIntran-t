import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";
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

  const { data: employee } = await supabase
    .from("employee")
    .select("id, first_name, last_name, email, status, team_id, employment_type, start_date")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!employee) {
    return { authUserId: user.id, email: user.email ?? "", employee: null, roles: [], permissions: [] };
  }

  const [{ data: roleRows }, { data: permRows }] = await Promise.all([
    supabase.from("employee_role").select("role").eq("employee_id", employee.id),
    supabase.from("employee_permission").select("permission").eq("employee_id", employee.id),
  ]);

  return {
    authUserId: user.id,
    email: user.email ?? employee.email,
    employee,
    roles: (roleRows ?? []).map((r) => r.role as Role),
    permissions: (permRows ?? []).map((p) => p.permission as Permission),
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
