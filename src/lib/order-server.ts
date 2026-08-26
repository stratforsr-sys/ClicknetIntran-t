import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import type { Order, Paket, Sats } from "@/lib/order";

/**
 * Hamtningarna for kundordern. Laser med ANVANDARENS EGEN TOKEN — RLS i 0034
 * avgor vad som syns: saljaren ser sina egna order, saljchef, VD och ekonomi
 * ser alla.
 *
 * Skriv inget rollfilter har. Samma regel som provisionen, sokningen och
 * adoptionen foljer: ett filter i koden som upprepar policyn hinner glida isar
 * fran den, och da ar det koden man tror pa medan databasen sager nagot annat.
 */

export type Orderrad = Order & {
  company_name: string;
  org_number: string;
  contact_name: string;
  contact_phone: string;
  commission_source: string | null;
  note: string | null;
  created_at: string;
  approved_at: string | null;
  cancelled_on: string | null;
  cancel_reason: string | null;
};

const FALT =
  "id, company_name, org_number, contact_name, contact_phone, package_id, term_months," +
  " salesperson_id, signed_on, period_month, status, is_addon, commission_amount," +
  " commission_source, note, created_at, approved_at, cancelled_on, cancel_reason," +
  " cancel_period_month";

/**
 * numeric kommer tillbaka som STRANG ur PostgREST. Utan Number() blir
 * summeringen en strangkonkatenering, och 1500 + 2500 blir "15002500". Samma
 * falla som `provision-server.ts` redan gatt i.
 */
function tolka(rader: unknown[]): Orderrad[] {
  return (rader as Record<string, unknown>[]).map((r) => ({
    ...r,
    commission_amount: r.commission_amount === null ? null : Number(r.commission_amount),
  })) as unknown as Orderrad[];
}

/** Order fran och med en manad. RLS avgor vems. */
export async function hamtaOrder(franOchMed: string): Promise<Orderrad[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("sales_order")
    .select(FALT)
    .gte("period_month", franOchMed)
    .order("signed_on", { ascending: false })
    .order("created_at", { ascending: false });

  return tolka(data ?? []);
}

/** En enskild persons order. Anvands av progressvyn i steg 4. */
export async function hamtaOrderFor(employeeId: string, franOchMed: string): Promise<Orderrad[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("sales_order")
    .select(FALT)
    .eq("salesperson_id", employeeId)
    .gte("period_month", franOchMed)
    .order("signed_on", { ascending: false });

  return tolka(data ?? []);
}

/**
 * Kon: det som vantar pa godkannande.
 *
 * Ingen rollkontroll har heller. RLS ger noll rader at den som inte far se
 * andras order, och en tom ko ar ratt svar da.
 */
export async function hamtaKo(): Promise<Orderrad[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("sales_order")
    .select(FALT)
    .eq("status", "inskickad")
    .order("created_at", { ascending: true });

  return tolka(data ?? []);
}

export async function hamtaPaket(): Promise<Paket[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("sales_package")
    .select("id, label, list_price, sort, active")
    .eq("active", true)
    .order("sort");

  return (data ?? []).map((p) => ({ ...p, list_price: Number(p.list_price) })) as Paket[];
}

/**
 * Satserna. HELA historiken hamtas, inte bara de oppna raderna.
 *
 * Skalet: uppslaget sker pa orderns SIGNERINGSDATUM, inte pa dagens datum. En
 * order som lades in i efterhand ska fa den sats som gallde da, och da maste
 * de stangda raderna finnas med i materialet motorn far.
 */
export async function hamtaSatser(): Promise<Sats[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("commission_rate")
    .select("id, package_id, term_months, amount, valid_from, valid_to")
    .order("valid_from", { ascending: false });

  return (data ?? []).map((s) => ({ ...s, amount: Number(s.amount) })) as Sats[];
}

/**
 * Bilagorna per order (E13 steg 9, migration 0039).
 *
 * Lases med ANVANDARENS EGEN TOKEN. `file_object_read` i 0039 later bilagan
 * arva ORDERNS behorighet — grenen ar en `exists` mot `sales_order` och inget
 * eget rollvillkor. Skriv inget filter har: det hade varit ett andra svar pa
 * samma fraga.
 *
 * `removed_at is null`: en fil vars innehall tagits bort ur bucketen har kvar
 * sin rad och sin oppningslogg (0022), men den ska inte erbjudas att oppnas.
 */
export async function hamtaOrderbilagor(
  orderIds: string[],
): Promise<Map<string, { id: string; filename: string | null; uploaded_at: string }[]>> {
  const ut = new Map<string, { id: string; filename: string | null; uploaded_at: string }[]>();
  if (orderIds.length === 0) return ut;

  const rls = await supabaseServer();
  const { data } = await rls
    .from("file_object")
    .select("id, filename, uploaded_at, sales_order_id")
    .eq("purpose", "sales_order")
    .is("removed_at", null)
    .in("sales_order_id", orderIds)
    .order("uploaded_at", { ascending: false });

  for (const f of data ?? []) {
    const nyckel = String(f.sales_order_id);
    ut.set(nyckel, [
      ...(ut.get(nyckel) ?? []),
      {
        id: String(f.id),
        filename: (f.filename as string | null) ?? null,
        uploaded_at: String(f.uploaded_at),
      },
    ]);
  }

  return ut;
}
