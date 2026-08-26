/**
 * Den verifierade identiteten, vidarebefordrad fran mellanvaran till servern.
 *
 * ===========================================================================
 * VARFOR DEN HAR FILEN FINNS
 *
 * `supabase.auth.getUser()` verifierar tokenen genom att FRAGA Supabase Auth
 * over natet. Den kordes tva ganger per sidvisning: en gang i mellanvaran, som
 * maste veta om det finns en session for att kunna omdirigera, och en gang till
 * i `getCurrentUser()`, som behover veta vem det ar.
 *
 * Tva turer till samma tjanst med samma token, for att fa samma svar. Den andra
 * kostade ~30-50 ms pa VARJE sida i navet, och det marktes: sokningen hade 4 ms
 * marginal mot sitt krav pa 500 ms nar det matdes 2026-08-26.
 *
 * Mellanvaran skickar nu vidare det den redan tagit reda pa i en
 * request-rubrik, och `getCurrentUser()` litar pa den i stallet for att fraga
 * om.
 *
 * ===========================================================================
 * VARFOR DET AR SAKERT — och exakt vad som gor det sakert
 *
 * En rubrik fran webblasaren ar inget att lita pa. Vem som helst kan skicka
 * `x-nav-user: <nagon annans id>`.
 *
 * DET SOM GOR DEN PALITLIG AR ATT MELLANVARAN ALLTID RENSAR DEN FORST.
 * `rensaIdentitet()` anropas pa forsta raden i `updateSession()`, fore varje
 * gren och fore varje `return`. En rubrik som kom utifran finns alltsa inte
 * kvar nar servern lasar — det enda som kan sta dar ar det mellanvaran sjalv
 * skrev efter att `getUser()` svarat.
 *
 * DARFOR FAR DEN HAR ORDNINGEN ALDRIG KASTAS OM, och darfor ligger rensningen i
 * en egen funktion med det har namnet: den ska vara omojlig att lasa forbi.
 *
 * `/api` ar det ena stallet dar mellanvaran returnerar tidigt. Rensningen har
 * redan skett da, sa rutterna dar far ingen rubrik alls — och `getCurrentUser()`
 * faller tillbaka pa `getUser()` precis som forr.
 * ===========================================================================
 */

/** Auth-kontots id. Satts bara av mellanvaran, efter verifierad session. */
export const RUBRIK_ID = "x-nav-auth-id";

/** E-posten ur samma svar, sa att servern slipper en tur for den ocksa. */
export const RUBRIK_EPOST = "x-nav-auth-epost";

/**
 * Om kontot maste byta losenord. Ligger i `app_metadata` och kommer med i
 * `getUser()`-svaret — se losenordsbyte.ts. Utan den har raden hade
 * `getCurrentUser()` behovt fraga Auth anda, och hela vinsten varit borta.
 */
export const RUBRIK_BYTE = "x-nav-auth-byte";

const ALLA = [RUBRIK_ID, RUBRIK_EPOST, RUBRIK_BYTE];

/**
 * Tar bort rubrikerna om nagon utifran skickat dem.
 *
 * ANROPAS FORST I MELLANVARAN, alltid. Se rubriken ovan.
 */
export function rensaIdentitet(headers: Headers): void {
  for (const namn of ALLA) headers.delete(namn);
}

/** Skriver den verifierade identiteten. Anropas efter `getUser()`. */
export function skrivIdentitet(
  headers: Headers,
  user: { id: string; email?: string | null },
  kraverLosenordsbyte: boolean,
): void {
  headers.set(RUBRIK_ID, user.id);
  // En e-post kan i teorin bara tecken som inte gar i en rubrik. Faller den bort
  // har tar `getCurrentUser()` e-posten ur employee-raden i stallet.
  if (user.email && /^[\x20-\x7e]+$/.test(user.email)) headers.set(RUBRIK_EPOST, user.email);
  if (kraverLosenordsbyte) headers.set(RUBRIK_BYTE, "1");
}

export type Identitet = {
  authUserId: string;
  email: string | null;
  kraverLosenordsbyte: boolean;
};

/** Laser identiteten, eller null om mellanvaran inte kort for den har vagen. */
export function lasIdentitet(headers: Headers): Identitet | null {
  const id = headers.get(RUBRIK_ID);
  if (!id) return null;
  return {
    authUserId: id,
    email: headers.get(RUBRIK_EPOST),
    kraverLosenordsbyte: headers.get(RUBRIK_BYTE) === "1",
  };
}
