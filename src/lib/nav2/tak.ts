import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Nav 2.0: en spärr mot översvämning som fungerar serverlöst (granskningen F2-18).
 *
 * Palettens obesvarade frågor (`nav_question_miss`, 0125) och Rutiners
 * sökningar utan träff (`document_search_miss`, 0096) sparas medvetet UTAN
 * person: ingen kolumn för den, så att en fråga med ett namn i inte går att
 * peka ut. Därför går det inte att räkna "den här personens rader". I stället
 * ett globalt tak, räknat i databasen: en lambdas minne delas inte mellan
 * anrop, men tabellen gör det.
 *
 * DE TVÅ TABELLERNA RÄKNAS OLIKA, för att de har olika tid:
 *   - `document_search_miss` har `searched_at`: nya rader den senaste minuten.
 *   - `nav_question_miss` har bara `dag` och `week` (en rad per fråga och
 *     vecka, och `dag` flyttas fram när frågan ställs igen). Den räknas per
 *     dag: frågor som ställts i dag. Att upprepa samma fråga skapar ingen ny
 *     rad, så det är antalet olika frågor som hejdas.
 *
 * Räkningen misslyckas hellre stängt: det är statistik, och en tappad rad
 * kostar mindre än en tabell som fylls.
 */

export const FRAGOR_PER_DAG = 1000;
export const SOKMISSAR_PER_MINUT = 60;

type Tak =
  | { tabell: "nav_question_miss"; kolumn: "dag"; fran: string }
  | { tabell: "document_search_miss"; kolumn: "searched_at"; fran: string };

/** Sant om en rad till får skrivas: färre än `tak` rader från och med `fran`. */
export async function underTak(db: SupabaseClient, { tabell, kolumn, fran }: Tak, tak: number): Promise<boolean> {
  const { count, error } = await db.from(tabell).select(kolumn, { count: "exact", head: true }).gte(kolumn, fran);
  if (error || count == null) return false;
  return count < tak;
}

/** Fönstret för Rutiners sökmissar: den senaste minuten. */
export const senasteMinuten = (nu: Date = new Date()) => new Date(nu.getTime() - 60_000).toISOString();
