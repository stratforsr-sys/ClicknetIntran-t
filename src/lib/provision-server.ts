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

/**
 * numeric kommer tillbaka som STRANG ur PostgREST. Utan Number() blir
 * summeringen en strangkonkatenering, och 12000 + 3000 blir "120003000".
 *
 * ===========================================================================
 * CASTEN BEHOVS FOR ATT SELECT-STRANGEN INTE AR EN LITERAL.
 *
 * Supabase harleder radens typ ur select-strangen, och den harledningen kraver
 * en STRANGLITERAL. Den har hamtningen listar elva kolumner; radbryts listan med
 * `+` blir typen `GenericStringError` — en typ utan nagon av kolumnerna — och
 * bygget faller pa `...r` med "Spread types may only be created from object
 * types".
 *
 * Det ar samma rotorsak som fallde `hamtaChefsposter` 2026-09-09, dar den sags
 * som ett problem med `!inner`. Den verkliga regeln ar enklare: EN LITERAL
 * FUNGERAR, EN SAMMANSATT STRANG GOR DET INTE.
 *
 * Tva vagar: hall strangen som en enda literal (gjort ovan, aven om raden blir
 * lang), och casta anda — for att en framtida kolumn annars frestar nagon att
 * radbryta med `+`.
 * ===========================================================================
 */
function tolka(data: unknown): Post[] {
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    ...r,
    amount: Number(r.amount),
  })) as unknown as Post[];
}

/** Ett kalenderar bakat. Startsidans kort behover bara innevarande manad, men
 *  jamforelsen med forra manaden och arssumman kommer ur samma svar. */
export async function hamtaProvision(employeeId: string, franOchMed: string): Promise<Post[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("commission_entry")
    .select("id, employee_id, period_month, amount, deals, source, external_ref, kind, sales_order_id, note, entered_at")
    .eq("employee_id", employeeId)
    .gte("period_month", franOchMed)
    .order("period_month", { ascending: false })
    .order("entered_at", { ascending: false });

  return tolka(data);
}

/**
 * Alla poster, for den som far se andras. Ingen rollkontroll har heller — RLS
 * ger noll rader at den som inte far, och en tom lista ar ratt svar da.
 */
export async function hamtaAllProvision(franOchMed: string): Promise<Post[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("commission_entry")
    .select("id, employee_id, period_month, amount, deals, source, external_ref, kind, sales_order_id, note, entered_at")
    .gte("period_month", franOchMed)
    .order("period_month", { ascending: false })
    .order("entered_at", { ascending: false });

  return tolka(data);
}
