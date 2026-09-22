import "server-only";

import { supabaseServer } from "@/lib/supabase/server";
import type { CurrentUser } from "@/lib/auth";

/**
 * Veckogenomgångens enda databasfråga.
 *
 * =============================================================================
 * FILEN ÄR MED FLIT LITEN, OCH DET ÄR FÖR ATT UNDVIKA EN CIRKEL
 *
 * Genomgången läser uppgifter, projekt och namn — men allt det hämtas redan av
 * `hamtaUppgiftsbild()` i uppgifter-server.ts, och stegen är rena filter över
 * den bilden (`lib/genomgang.ts`). Det enda som inte går att räkna fram ur
 * uppgifterna är om jag har betat av veckan, och det är det som ligger här.
 *
 * Hade funktionerna nedan bott i uppgifter-server.ts vore det en fil mindre.
 * Men klockans post om veckogenomgången byggs i `uppgiftsnotiser()`, som bor
 * där — och en `hamtaGenomgang()` i samma fil hade importerat den fil som
 * importerar den. En cirkel mellan två servermoduler i Next går igenom i
 * utvecklingsläget och faller i bygget, vilket är den dyraste sortens fel när
 * bygget är den enda verifieringen som finns.
 * =============================================================================
 */

/**
 * Måndagen i den senast avbetade veckan, eller null.
 *
 * LÄSES MED ANVÄNDARENS EGEN TOKEN, som allt annat i modulen. `weekly_review`
 * har en policy som bara släpper fram den egna raden (0066), och ett
 * `.eq("employee_id", mig)` här hade varit ett andra svar på samma fråga.
 *
 * `week_start` OCH INTE `completed_at`. Se rubriken vid `genomgangslage()` i
 * lib/genomgang.ts: den som gör förra veckans genomgång på en måndag har betat
 * av den FÖRRA veckan, och ett svar räknat på klickdagen hade tystat
 * påminnelsen för fel vecka.
 */
export async function senasteGenomgang(user: CurrentUser): Promise<string | null> {
  if (!user.employee) return null;

  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("weekly_review")
    .select("week_start")
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as { week_start?: string } | null)?.week_start ?? null;
}

export type Genomgangskvitto = { week_start: string; completed_at: string; remaining: number };

/** De senaste kvittona — raden "Senast gjord" och inget mer. */
export async function senasteKvitton(user: CurrentUser, antal = 4): Promise<Genomgangskvitto[]> {
  if (!user.employee) return [];

  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("weekly_review")
    .select("week_start, completed_at, remaining")
    .order("week_start", { ascending: false })
    .limit(antal);

  return (data ?? []) as Genomgangskvitto[];
}
