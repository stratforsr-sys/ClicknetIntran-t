import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import type { Saljmal } from "@/lib/saljtakt";

/**
 * Hamtningarna for manadsmalen (0049).
 *
 * Laser med ANVANDARENS EGEN TOKEN. RLS avgor vad som syns: saljaren ser sitt
 * eget mal, saljchef, VD och ekonomi ser allas.
 *
 * Skriv inget rollfilter har. Samma regel som provisionen, ordern och
 * konsekvenserna foljer: ett filter i koden som upprepar policyn hinner glida
 * isar fran den, och da ar det koden man tror pa medan databasen sager nagot
 * annat.
 *
 * FILEN BAR INGET `"use server"`. Allt som exporteras ur en sadan fil far ett
 * id och tar emot anrop fran webblasaren, och det har gatt fel tre ganger i det
 * har repot. Hjalpare hor hemma har, handlingar i sidans `actions.ts`.
 */

/**
 * Malen fran och med en manad.
 *
 * numeric kommer tillbaka som STRANG ur PostgREST. Utan Number() blir
 * `target_amount` en strang, och jamforelsen mot utfallet blir en
 * strangjamforelse: "9000" < "850" ar sant. Samma falla som `order-server.ts`,
 * `provision-server.ts` och `bonus-server.ts` alla gatt i.
 */
export async function hamtaMal(franOchMed: string): Promise<Saljmal[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("sales_target")
    .select("employee_id, period_month, target_orders, target_amount")
    .gte("period_month", franOchMed);

  return ((data ?? []) as Record<string, unknown>[]).map((m) => ({
    employee_id: String(m.employee_id),
    // Datum kommer tillbaka som "2026-09-01T00:00:00" ur PostgREST i vissa
    // former, och nyckeln jamfors med `manadsnyckel()` som ar tio tecken.
    period_month: String(m.period_month).slice(0, 10),
    mal_order: m.target_orders === null ? null : Number(m.target_orders),
    mal_kronor: m.target_amount === null ? null : Number(m.target_amount),
  }));
}
