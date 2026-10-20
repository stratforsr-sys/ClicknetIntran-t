import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Kroken mellan supabaseServer()/supabaseAdmin() och Nav 2.0:s Postgres-läsning.
 *
 * Utan beroenden med flit: `src/lib/supabase/server.ts` importeras också av
 * instrumentation.ts, som byggs för edge, där `pg` inte finns. Kroken sätts av
 * `pgrest.ts` när den laddas, och det gör bara /nav2-rutten. Överallt annars
 * är den tom och klienterna är de vanliga.
 */
type Krok = (vem: "server" | "admin") => SupabaseClient | null;
let krok: Krok | null = null;

export function sattPgKrok(k: Krok) {
  krok = k;
}

/** Under Nav 2.0:s bygge: klienten som läser direkt i Postgres. Annars null. */
export function pgKlient(vem: "server" | "admin"): SupabaseClient | null {
  return krok ? krok(vem) : null;
}
