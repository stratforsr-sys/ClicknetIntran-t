/**
 * Tillfalliga losenord for konton som laggs upp av en chef.
 *
 * Ingen `server-only` langre. Modulen bar ingen hemlighet — den ar ren logik
 * over `crypto.getRandomValues`, och markeringen gjorde bara att den inte gick
 * att kora i `tests/losenordskrav.mjs`. Att ordet aldrig lamnar servern ar
 * anropar­nas ansvar, och de ar server actions.
 *
 * Sa lange navet inte mejlar gar losenordet fran chef till anstalld muntligt
 * eller pa en lapp. Det styr utformningen: inga tecken som gar att hora fel
 * eller lasa fel — inga nollor mot O, inga ettor mot l och I, ingen versal
 * som forsvinner i en handskriven rad.
 */

/** 31 tecken. Alla gar att lasa upp i telefon utan att nagon fragar om. */
const TECKEN = "abcdefghjkmnpqrstuvwxyz23456789";

const GRUPPER = 4;
const PER_GRUPP = 5;

/**
 * Rejektionsurval, inte modulo. Med 256 % 31 = 8 hade de atta forsta tecknen
 * blivit vanligare an de ovriga — en liten skevhet, men gratis att undvika.
 */
function slumpaTecken(antal: number): string {
  const tak = Math.floor(256 / TECKEN.length) * TECKEN.length;
  const ut: string[] = [];

  while (ut.length < antal) {
    const byte = crypto.getRandomValues(new Uint8Array(antal * 2));
    for (const b of byte) {
      if (b >= tak) continue;
      ut.push(TECKEN[b % TECKEN.length]);
      if (ut.length === antal) break;
    }
  }

  return ut.join("");
}

/**
 * Fyra grupper om fem tecken: `hjkmn-pqrst-uvwxy-23456`.
 *
 * 20 tecken ur 31 mojliga ar knappt 100 bitar. Grupperingen ar for manniskan
 * som ska lasa upp det, bindestrecken raknas inte som hemlighet.
 */
export function nyttTillfalligtLosenord(): string {
  const rader: string[] = [];
  for (let i = 0; i < GRUPPER; i++) rader.push(slumpaTecken(PER_GRUPP));
  return rader.join("-");
}
