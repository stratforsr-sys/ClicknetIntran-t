import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import type { Order, Paket, Sats } from "@/lib/order";
import type { Chefssats } from "@/lib/chefsprovision";
import type { Chefspost } from "@/lib/provision-motor";

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
  order_value_source: string | null;
  note: string | null;
  created_at: string;
  approved_at: string | null;
  cancelled_on: string | null;
  cancel_reason: string | null;
};

const FALT =
  "id, company_name, org_number, contact_name, contact_phone, package_id, term_months," +
  " salesperson_id, signed_on, period_month, status, is_addon, commission_amount," +
  " commission_source, order_value, order_value_source, note, created_at, approved_at," +
  " cancelled_on, cancel_reason, cancel_period_month";

/**
 * numeric kommer tillbaka som STRANG ur PostgREST. Utan Number() blir
 * summeringen en strangkonkatenering, och 1500 + 2500 blir "15002500". Samma
 * falla som `provision-server.ts` redan gatt i.
 *
 * ORDERVARDET AR EN NUMERIC TILL, och den ar den dyraste att glomma: talen ar
 * femsiffriga, sa "11940" + "23880" blir "1194023880" — ett ordervarde pa en
 * miljard som ser ut som ett riktigt tal i en vy som inte forvantar sig
 * strangar. `null` far forbli null; se `ordervarde()` i `order.ts` for varfor de
 * raknas i stallet for att bli nollor.
 */
function tolka(rader: unknown[]): Orderrad[] {
  return (rader as Record<string, unknown>[]).map((r) => ({
    ...r,
    commission_amount: r.commission_amount === null ? null : Number(r.commission_amount),
    order_value: r.order_value === null || r.order_value === undefined ? null : Number(r.order_value),
  })) as unknown as Orderrad[];
}

/**
 * Villkoret for "ror den har manaden eller senare".
 *
 * ===========================================================================
 * EN MAKULERING HAR SIN EGEN MANAD, OCH `period_month` HITTAR DEN INTE.
 *
 * Rattat 2026-09-07. Fram till dess filtrerade bada hamtningarna nedan pa bara
 * `period_month >= x`, och det tappar en hel sorts rad: en order signerad i
 * mars som makuleras i september har `period_month = 2026-03-01` och
 * `cancel_period_month = 2026-09-01`.
 *
 * Foljden var att septembers avdrag inte kom med i vyn. `stangning.ts` hamtade
 * REDAN pa bada kolumnerna, sa bokforingen var korrekt hela tiden — det var
 * bara den siffra chefen laste FORE att hon tryckte Faststall som var for hog.
 * Precis den avvikelse mellan live och bokfort som kommentaren i `page.tsx`
 * sager aldrig far uppsta.
 *
 * Villkoret star som en funktion och inte som en strang pa tva stallen, sa att
 * de tva hamtningarna inte kan glida isar.
 * ===========================================================================
 */
function ror(franOchMed: string): string {
  return `period_month.gte.${franOchMed},cancel_period_month.gte.${franOchMed}`;
}

/** Order som ror en manad eller senare — signerade dar eller makulerade dar. */
export async function hamtaOrder(franOchMed: string): Promise<Orderrad[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("sales_order")
    .select(FALT)
    .or(ror(franOchMed))
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
    .or(ror(franOchMed))
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
 * Saljchefens satser. HELA historiken, av samma skal som `hamtaSatser`.
 *
 * Uppslaget sker pa orderns SIGNERINGSDATUM — se `gallandeChefssats` i
 * `chefsprovision.ts` for varfor det skiljer sig fran volymtrappan — och da
 * maste de stangda raderna finnas med i materialet.
 *
 * LASES MED ANVANDARENS EGEN TOKEN. `manager_commission_rate_read` i 0050
 * slapper bara in den krets som ser provision, sa en saljare far en TOM lista.
 * Det ar ratt svar: satserna ar villkoren for nagon annans ersattning, och
 * saljarens vy blir inte en siffra fattigare av att de ar stangda. Skriv inget
 * rollfilter har — samma regel som resten av filen foljer.
 */
export async function hamtaChefssatser(): Promise<Chefssats[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("manager_commission_rate")
    .select("id, employee_id, override_percent, own_sale_percent, valid_from, valid_to")
    .order("valid_from", { ascending: false });

  return (data ?? []).map((s) => ({
    ...s,
    override_percent: Number(s.override_percent),
    own_sale_percent: Number(s.own_sale_percent),
  })) as Chefssats[];
}

/**
 * Overtacken som ror en manad eller senare.
 *
 * ===========================================================================
 * MANADEN KOMMER UR ORDERN, SA FRAGAN MASTE GA GENOM ORDERN.
 *
 * `order_manager_commission` har med flit ingen egen manadskolumn — overtacket
 * foljer sin order och bokfors i dess `period_month`, dras tillbaka i dess
 * `cancel_period_month`. Det gor uppslaget till en join, och den maste bara
 * SAMMA villkor som `ror()` ovan: bade signeringsmanaden och
 * makuleringsmanaden.
 *
 * Missas den andra halvan uteblir avdraget for en order som makuleras i en
 * senare manad — exakt det fel som rattades i `hamtaOrder` 2026-09-08, och det
 * gar at det hall dar ingen saknar sina pengar.
 * ===========================================================================
 *
 * PostgREST filtrerar pa den inbaddade tabellen med `sales_order.<kolumn>`, och
 * `!inner` kravs for att villkoret ska GALLRA rader i stallet for att bara nolla
 * den inbaddade delen. Utan det kommer varje overtack tillbaka med `sales_order:
 * null` och faller sedan bort tyst i tolkningen nedan.
 */
export async function hamtaChefsposter(franOchMed: string): Promise<Chefspost[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("order_manager_commission")
    .select(
      "order_id, manager_id, amount, percent," +
        " sales_order!inner(period_month, cancel_period_month, signed_on, company_name, status)",
    )
    .or(ror(franOchMed), { referencedTable: "sales_order" });

  return (data ?? []).flatMap((r) => {
    const o = (r as unknown as { sales_order: Record<string, unknown> | null }).sales_order;
    if (!o) return [];

    return [
      {
        order_id: String(r.order_id),
        manager_id: String(r.manager_id),
        amount: Number(r.amount),
        percent: Number(r.percent),
        period_month: String(o.period_month),
        cancel_period_month: o.cancel_period_month === null ? null : String(o.cancel_period_month),
        signed_on: String(o.signed_on),
        company_name: String(o.company_name),
        makulerad: o.status === "makulerad",
      } satisfies Chefspost,
    ];
  });
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
