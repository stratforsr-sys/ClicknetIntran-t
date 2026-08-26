import "server-only";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { lagenPerPerson, type Handelse, type Konsekvensregel, type Konsekvenslage } from "@/lib/konsekvens";

/**
 * Hamtningarna for konsekvenssystemet (0037).
 *
 * ===========================================================================
 * FILEN BAR INGET `"use server"`, och det ar med flit.
 *
 * Allt som exporteras ur en `"use server"`-fil far ett id och tar emot anrop
 * fran webblasaren. Det har gatt fel TRE ganger i det har repot — `skrivFel`
 * 22 augusti, `sattKvitto` natten till 24 augusti och `registreraVisning` den
 * 26:e. Hjalpare hor hemma har, i `src/lib/`, och handlingar i sidans
 * `actions.ts`.
 * ===========================================================================
 *
 * Lasningarna gar med ANVANDARENS EGEN TOKEN. RLS i 0037 avgor vad som syns:
 * den beromda ser bara det som BESLUTATS, chefen ser kon. Skriv inget
 * rollfilter har — det hade varit ett andra svar pa samma fraga.
 */

/** Trappan. Oppen for alla inloggade: den som varnas ska kunna lasa vad som galler. */
export async function hamtaRegler(): Promise<Konsekvensregel[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("consequence_rule")
    .select("id, ordning, antal_handelser, periodlangd_manader, atgard, omfattning, notifiera")
    .order("ordning");

  return (data ?? []) as Konsekvensregel[];
}

const HANDELSEFALT =
  "id, employee_id, occurred_on, minutes, status, ordningsnummer, atgard, period_month";

/** Handelserna anvandaren far se. RLS avgor vilka. */
export async function hamtaHandelser(): Promise<Handelse[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("attendance_incident")
    .select(HANDELSEFALT)
    .order("occurred_on", { ascending: false });

  return normalisera(data);
}

/** En persons egna handelser. Anvands av saljarens provisionsvy. */
export async function hamtaMinaHandelser(employee_id: string): Promise<Handelse[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("attendance_incident")
    .select(HANDELSEFALT)
    .eq("employee_id", employee_id)
    .order("occurred_on", { ascending: false });

  return normalisera(data);
}

/**
 * Manadens konsekvenslage per person, som periodstangningen behover det.
 *
 * LASES MED SERVICE ROLE, av samma skal som `hamtaAllaOrder` i `stangning.ts`:
 * bokforingen maste vara fullstandig. En RLS-vy som av nagot skal saknar en rad
 * hade gett en person for MYCKET betalt utan att nagot sag fel ut — och till
 * skillnad fran en utebliven order gar den sortens fel inte att upptacka genom
 * att nagon saknar sina pengar.
 */
export async function hamtaKonsekvensPerPerson(
  manad: string,
): Promise<Map<string, Konsekvenslage>> {
  return lagenPerPerson(await hamtaGodkandaFran(manad), manad);
}

/**
 * Alla godkanda handelser fran och med en manad, i EN fraga.
 *
 * Chefens vy visar tre manader bredvid varandra. Tre fragor hade varit tre
 * turer till databasen for material som lika garna hamtas pa en gang — och den
 * har vyn ligger i den blockerande vagen, till skillnad fran notisklockan.
 * `lagenPerPerson` delar upp resultatet per manad utan att fraga igen.
 */
export async function hamtaGodkandaFran(franManad: string): Promise<Handelse[]> {
  const { data } = await supabaseAdmin()
    .from("attendance_incident")
    .select(HANDELSEFALT)
    .eq("status", "godkand")
    .gte("period_month", franManad);

  return normalisera(data);
}

/** Datum kommer tillbaka som "2026-08-01T00:00:00" ur PostgREST i vissa former. */
function normalisera(data: unknown[] | null): Handelse[] {
  return ((data ?? []) as Record<string, unknown>[]).map((h) => ({
    id: String(h.id),
    employee_id: String(h.employee_id),
    occurred_on: String(h.occurred_on).slice(0, 10),
    minutes: Number(h.minutes),
    status: h.status as Handelse["status"],
    ordningsnummer: h.ordningsnummer === null ? null : Number(h.ordningsnummer),
    atgard: (h.atgard ?? null) as Handelse["atgard"],
    period_month: h.period_month === null ? null : String(h.period_month).slice(0, 10),
  }));
}
