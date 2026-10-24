/**
 * Nycklarna i säljtavlans ögonblicksbild: ett id in, tolv hextecken ut.
 *
 * Bilden går till en TV på en vägg och till webbläsarens utvecklarverktyg, och
 * där har ett employee-id eller ett order-id inget att göra (se `typer.ts`).
 * Tavlan behöver ändå känna igen en person och en order mellan två bilder, så
 * varje id byts mot en stabil hash: samma id ger alltid samma nyckel.
 *
 * Prefixet "tavla:" gör nycklarna till tavlans egna. Samma id hashat någon
 * annanstans i Nav ger inte samma tolv tecken.
 *
 * Tolv tecken är 48 bitar. Det räcker gott för några hundra order och några
 * tiotal säljare, och nyckeln är inget skydd: den gör bara att id:t inte står
 * i klartext. Den som har databasen kan hasha varje id och jämföra, och det
 * får hen göra.
 *
 * SERVERKOD, som `parning.ts`: hashen kommer ur `node:crypto`. Filen bär inte
 * `import "server-only"` för att proven ska kunna köra den med node, men den
 * får aldrig importeras av en klientkomponent. Klienten får nycklarna färdiga.
 */

import { hasha } from "./parning.ts";

/** Nyckeln för ett id: de första tolv hextecknen av sha256("tavla:" + id). */
export function nyckelFor(id: string): string {
  return hasha(`tavla:${id}`).slice(0, 12);
}
