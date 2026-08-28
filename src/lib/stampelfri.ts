/**
 * Vilka roller som inte stämplar.
 *
 * ===========================================================================
 * DET HÄR ÄR EN REGEL OM SKYLDIGHET, INTE OM BEHÖRIGHET.
 *
 * Resten av navet frågar `hasRole()` om vem som får SE eller GÖRA något. Den
 * här listan svarar på en annan fråga: vem navet får kräva en stämpling av.
 * VD, säljchef, ekonomi och projektledare har inte en arbetstid som mäts in
 * och ut, och för dem är varje sak navet bygger på stämplingen fel:
 *
 *   - en påminnelse om "oregistrerad frånvaro" varje schemalagd dag
 *     (`jobb/franvaro.ts` steg 3),
 *   - ett förslag om OGILTIG FRÅNVARO i chefens kö, som är första steget i
 *     konsekvenstrappan och till slut rör pengar (`jobb/konsekvenser.ts`),
 *   - en sen ankomst bokförd mot ett schema de inte arbetar efter.
 *
 * Det första är brus. Det andra är en anklagelse. Båda uppstod ur att navet
 * inte kunde skilja "stämplade inte" från "ska inte stämpla" — och den enda
 * som vet skillnaden är den som satt rollen.
 * ===========================================================================
 *
 * LISTAN ÄR EN ROLLFRÅGA OCH LÄSES LIVE. Den som blir befordrad till säljchef
 * slutar stämpla samma dag rollen sätts, och den som lämnar rollen börjar
 * igen. Ingen kolumn att glömma uppdatera, ingen flagga per person som glider
 * isär från rollen.
 *
 * ATT LÄGGA TILL ELLER TA BORT EN ROLL: ändra `STAMPELFRIA_ROLLER` och kör
 * `npm run test:stampelfri`. Ingenting annat behöver röras — varje ställe som
 * bryr sig frågar den här filen.
 *
 * Filen har inga andra importer än rolltypen och går att prova utan att starta
 * något. Serversidan — vilka ANSTÄLLDA som är stämpelfria — ligger i
 * `stampelfri-server.ts`, som behöver databasen.
 */

import type { Role } from "./roles.ts";

/**
 * Beställarens besked 2026-08-28: VD, säljchef, ekonomi och projektledare
 * stämplar inte.
 *
 * Teamledaren står INTE här, och det är ett val och inte ett förbiseende. Hen
 * arbetar samma pass som sitt team och är den enda chefsrollen vars arbetstid
 * faktiskt mäts. `admin` står inte heller här: det är en systemroll som ofta
 * bärs vid sidan av en anställning, och den som är säljare och admin ska
 * stämpla som säljare.
 */
export const STAMPELFRIA_ROLLER: Role[] = [
  "ceo",
  "sales_manager",
  "finance",
  "project_manager",
];

/**
 * Är den här uppsättningen roller stämpelfri?
 *
 * EN STÄMPELFRI ROLL RÄCKER. Den som är både projektledare och säljare
 * stämplar inte — samma linje som allt annat rollstyrt i navet, där en roll
 * ger och ingen roll tar ifrån. Är det fel för en enskild person är svaret att
 * ta bort rollen, inte att göra regeln villkorad.
 *
 * Tar emot `string[]` och inte bara `Role[]` med flit: serversidan läser
 * rollerna ur databasen, och en rad därifrån är en sträng tills något
 * kontrollerat den.
 */
export function stampelfri(roller: readonly string[] | null | undefined): boolean {
  if (!roller) return false;
  return roller.some((r) => (STAMPELFRIA_ROLLER as string[]).includes(r));
}

/** Texten som ersätter stämpelknapparna. Samma ordval på båda ställena. */
export const STAMPELFRI_FORKLARING =
  "Din roll stämplar inte in och ut. Ledighet och sjukfrånvaro registrerar du som vanligt.";
