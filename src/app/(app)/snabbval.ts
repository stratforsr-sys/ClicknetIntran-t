import type { CurrentUser } from "@/lib/auth";
import { canManageEmployees, hasRole } from "@/lib/auth";

export type Snabbval = { href: string; text: string; ikon: string };

/**
 * Snabbvalen pa startsidan. Samma linje som `nav-items.ts`: listan bar bara
 * det som finns, och den ar rollstyrd.
 *
 * ===========================================================================
 * TRE REGLER, OCH DE HAR ALLA KOSTAT NAGOT ATT LARA.
 *
 * 1. INGEN POST SOM INTE GAR ATT UTFORA. En knapp till en modul som ar
 *    avstangd larr anvandaren att granssnittet ljuger, och da slutar hen lita
 *    pa resten ocksa. Samma skal som stampelposten i sidopanelen har.
 *
 * 2. VARJE POST AR EN HANDLING, INTE EN VY. "Nytt arende", inte "Arenden".
 *    Raden ska spara ett steg for nagot man gor, och listorna nas anda genom
 *    sidopanelen. Chefsposterna ar undantaget: hens handling ar att BESLUTA,
 *    och besluten ligger i en ko.
 *
 * 3. ORDNINGEN AR ROLLSTYRD, precis som kortordningen i E5.4. Chefen ser sina
 *    koer forst — det ar hens arende med sidan. Saljaren ser sina egna
 *    handlingar forst, for hen har inga koer.
 * ===========================================================================
 *
 * Stamplingen star INTE i listan. Den ar inte en lank utan tva knappar som
 * skickar en server action, och den ritas separat i sidan — bland annat for
 * att den bar en ko for stamplingar gjorda utan natverk (AC-2.2).
 */
export function snabbvalFor(user: CurrentUser | null, stamplingPa: boolean): Snabbval[] {
  if (!user?.employee) return [];

  const chefsposter: Snabbval[] = [];
  const egna: Snabbval[] = [];

  if (hasRole(user, "sales_manager", "ceo")) {
    chefsposter.push({ href: "/arenden", text: "Ärendekön", ikon: "meny" });
  }
  if (canManageEmployees(user)) {
    chefsposter.push({ href: "/franvaro/attest", text: "Attestera ledighet", ikon: "kontroll" });
  }
  // Bara den som bokfor provision har nagot att gora har. Ovriga ser sin egen
  // provision pa kortet, och behover ingen genvag till en inmatning de inte
  // far anvanda.
  if (hasRole(user, "finance", "ceo")) {
    chefsposter.push({ href: "/provision", text: "Bokför provision", ikon: "kontroll" });
  }

  egna.push({ href: "/arenden/nytt", text: "Nytt ärende", ikon: "plus" });
  egna.push({ href: "/franvaro/ny", text: "Ansök om ledighet", ikon: "klocka" });
  egna.push({ href: "/franvaro/sjuk", text: "Sjukanmälan", ikon: "varning" });

  // Rattelse av en stampling ar bara meningsfull nar det finns stamplingar.
  if (stamplingPa) {
    egna.push({ href: "/tid", text: "Mina stämplingar", ikon: "tid" });
  }

  return [...chefsposter, ...egna];
}
