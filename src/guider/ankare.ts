/**
 * Ankarnamn som byggs i stället för att skrivas ut.
 *
 * ===========================================================================
 * DEN HÄR FILEN FINNS FÖR PROVETS SKULL.
 *
 * `npm run test:guider` letar efter varje ankare som en LITERAL i källkoden:
 * står `topp.sok` i en guide måste `data-guide="topp.sok"` finnas någonstans i
 * en .tsx-fil. Det är en trubbig kontroll, och den är trubbig med flit — den
 * kan inte luras av att attributet flyttas, bara av att det försvinner.
 *
 * Sidopanelens poster går inte att skriva ut så. Menyn byggs av `navFor()` och
 * ser olika ut för varje roll, så attributet måste sättas av en funktion. Utan
 * den här filen hade provet antingen fått ett undantag utan botten ("allt som
 * börjar på nav.lank. är okej") eller tvingat fram sjutton hårdkodade rader i
 * Sidebar.tsx.
 *
 * Med den kan provet i stället kontrollera två konkreta saker: att Sidebar
 * anropar `navAnkare()`, och att adressen guiden pekar på faktiskt finns i
 * `nav-items.ts`. Ett ankare mot `/order` i en guide för ekonomi ska failas,
 * och det gör det.
 * ===========================================================================
 */

/** Prefixet. Provet känner igen ankare på det. */
export const NAV_PREFIX = "nav.lank.";

/**
 * Ankaret för en post i sidopanelen. Adressen är nyckeln och inte etiketten:
 * `/avtal` heter "Avtal" för chefen och "Mitt avtal" för alla andra, och ett
 * ankare som bytte namn med rollen hade varit omöjligt att peka på.
 */
export function navAnkare(href: string): string {
  return NAV_PREFIX + href;
}
