import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import type { Provisionspost } from "@/lib/provision";

/**
 * Hamtningen av provisionsposter. Laser med ANVANDARENS EGEN TOKEN — RLS i
 * 0031 avgor vad som syns: sin egen rad ser alla, andras ser ekonomi och VD.
 *
 * Skriv inget rollfilter har. Samma regel som sokningen och adoptionen foljer:
 * ett filter i koden som upprepar policyn hinner glida isar fran den, och da
 * ar det koden man tror pa medan databasen sager nagot annat.
 */

export type Post = Provisionspost & {
  id: string;
  employee_id: string;
  source: string;
  /** `<manad>:<person>:<slag>` for motorns poster, null for handinmatade. */
  external_ref: string | null;
  /**
   * Vad posten ar, sedan 0051. NULL for varje post som bokfordes fore den —
   * `slagetFor()` laser dem ur `external_ref` som forut. Se den funktionen for
   * varfor kolumnen kom och varfor ingen bakatfyllning gjordes.
   */
  kind: string | null;
  /** Affaren posten hor till, nar den hor till en. Null for manadsposter. */
  sales_order_id: string | null;
  note: string | null;
  entered_at: string;
};

/** Ett kalenderar bakat. Startsidans kort behover bara innevarande manad, men
 *  jamforelsen med forra manaden och arssumman kommer ur samma svar. */
export async function hamtaProvision(employeeId: string, franOchMed: string): Promise<Post[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("commission_entry")
    .select("id, employee_id, period_month, amount, deals, source, external_ref, kind," +
      " sales_order_id, note, entered_at")
    .eq("employee_id", employeeId)
    .gte("period_month", franOchMed)
    .order("period_month", { ascending: false })
    .order("entered_at", { ascending: false });

  // numeric kommer tillbaka som strang ur PostgREST. Utan Number() blir
  // summeringen en strangkonkatenering, och 12000 + 3000 blir "120003000".
  return (data ?? []).map((r) => ({ ...r, amount: Number(r.amount) }));
}

/**
 * Alla poster, for den som far se andras. Ingen rollkontroll har heller — RLS
 * ger noll rader at den som inte far, och en tom lista ar ratt svar da.
 */
export async function hamtaAllProvision(franOchMed: string): Promise<Post[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("commission_entry")
    .select("id, employee_id, period_month, amount, deals, source, external_ref, kind," +
      " sales_order_id, note, entered_at")
    .gte("period_month", franOchMed)
    .order("period_month", { ascending: false })
    .order("entered_at", { ascending: false });

  return (data ?? []).map((r) => ({ ...r, amount: Number(r.amount) }));
}
