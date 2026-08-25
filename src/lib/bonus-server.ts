import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import type { Bonusniva } from "@/lib/provision-motor";

/**
 * Hamtningarna for volymtrappan och periodstangningen (0035).
 *
 * Laser med ANVANDARENS EGEN TOKEN. Bada tabellerna ar oppna for alla inloggade
 * — trappan for att en progressvy som sager "3 order kvar till nasta niva" utan
 * att visa vad nivan ar vard ar en sifferlek, och perioderna for att "manaden ar
 * stangd" ar svaret pa "varfor andrar sig inte min siffra langre".
 *
 * Skriv inget rollfilter har. Samma regel som resten av navet foljer.
 */

export type Period = {
  period_month: string;
  status: "faststalld" | "utbetald";
  closed_at: string;
  paid_at: string | null;
};

/**
 * HELA trappans historik, inte bara de oppna raderna.
 *
 * Skalet ar detsamma som for `hamtaSatser` i `order-server.ts`: uppslaget sker
 * pa den manad som visas, inte pa dagens datum. En stangd rad ar svaret pa
 * vilken trappa som gallde i juni.
 */
export async function hamtaNivaer(): Promise<Bonusniva[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("commission_bonus_level")
    .select("id, threshold, amount, unit, valid_from, valid_to")
    .order("threshold");

  // numeric kommer tillbaka som STRANG ur PostgREST. Utan Number() blir en
  // procentsats en strang och multiplikationen NaN. Samma falla som
  // `order-server.ts` och `provision-server.ts` redan gatt i.
  return (data ?? []).map((n) => ({ ...n, amount: Number(n.amount) })) as Bonusniva[];
}

/** Stangda perioder fran och med en manad. En manad UTAN rad ar oppen. */
export async function hamtaPerioder(franOchMed: string): Promise<Period[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("commission_period")
    .select("period_month, status, closed_at, paid_at")
    .gte("period_month", franOchMed)
    .order("period_month", { ascending: false });

  return (data ?? []) as Period[];
}
