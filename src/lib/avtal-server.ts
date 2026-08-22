import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import { EMPLOYMENT_TYPE_LABEL } from "@/lib/roles";

/**
 * E9.1. Vardena som hamtas ur personalregistret i stallet for att skrivas in.
 *
 * Bara uppgifter som redan STAR i `employee`. Ingenting harifran gar till
 * `salary_basis` eller nagon annanstans i E15 — se rubriken i 0028 om varfor
 * lonen ar det enda talet som skrivs for hand.
 *
 * Ett tomt varde lamnas tomt och fylls inte i med en gissning. Renderingen
 * faller pa det, vilket ar meningen: ett avtal med fel startdatum ar varre an
 * ett avtal som inte gick att skapa.
 */
export async function automatiskaVarden(employeeId: string): Promise<Record<string, string>> {
  const db = supabaseAdmin();

  const { data: e } = await db
    .from("employee")
    .select("first_name, last_name, employee_number, start_date, employment_type, company_id")
    .eq("id", employeeId)
    .maybeSingle();

  if (!e) return {};

  let bolag = "";
  if (e.company_id) {
    const { data: c } = await db.from("company").select("name").eq("id", e.company_id).maybeSingle();
    bolag = c?.name ?? "";
  }

  return {
    fornamn: e.first_name ?? "",
    efternamn: e.last_name ?? "",
    anstallningsnummer: e.employee_number ?? "",
    bolag,
    startdatum: e.start_date ?? "",
    anstallningsform: EMPLOYMENT_TYPE_LABEL[e.employment_type] ?? e.employment_type ?? "",
  };
}
