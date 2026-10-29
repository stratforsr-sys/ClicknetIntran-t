import "server-only";

import { kallanMejlas } from "@/lib/epost-notis";
import { PUSHKALLOR } from "@/lib/nav2/kalender-push";
import type { Kanal } from "@/lib/utskick";

/**
 * Standardläget per kanal och sort: det som gäller när varken superadmin eller
 * personen ställt in något (utskicken, 0255). Det är exakt vad navet gjorde
 * före inställningen, så att ingen märker den förrän någon ändrar något.
 *
 *   klocka  allt
 *   mejl    `MEJLKALLOR`
 *   push    `PUSHKALLOR` (kalendern), kvällsnotisen och dagens repetition
 *   morgon  alla avsnitt
 */
export const EGEN_PUSH = new Set(["kvallsnotis", "utbildning-repetition"]);

export function standardFor(kanal: Kanal, kalla: string): boolean {
  if (kanal === "mejl") return kallanMejlas(kalla);
  if (kanal === "push") return PUSHKALLOR.has(kalla) || EGEN_PUSH.has(kalla);
  return true;
}
