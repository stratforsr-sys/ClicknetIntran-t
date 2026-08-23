/**
 * E6.5 / AC-12.5: adoptionsstatistik.
 *
 * Ren logik, inga importer. Sjalva fragorna stalls med `adoption_*`-funktionerna
 * i 0029, som svarar med antal och aldrig med namn — per-person-raderna i
 * `activity_day` gar inte att lasa via API:t, inte ens for saljchefen.
 */

export type Aktivitetsdag = {
  /** ISO-datum, YYYY-MM-DD. */
  dag: string;
  /** Skilda personer den dagen. */
  dau: number;
  /** Skilda personer i sjudagarsfonstret som slutar den dagen. */
  wau: number;
};

/** Hogsta varde i serien. Skalan pa staplarna, aldrig noll. */
export function toppvarde(serie: Aktivitetsdag[]): number {
  return Math.max(1, ...serie.map((d) => d.wau));
}

/**
 * Klibbighet: DAU delat med WAU, i procent.
 *
 * Sager hur stor del av veckans anvandare som var inne just i dag, alltsa hur
 * ofta folk kommer tillbaka. 100 % betyder att alla som anvande navet den har
 * veckan var inne i dag; 20 % att de tittar in ungefar en dag i veckan.
 *
 * Null nar veckan ar tom. En kvot med noll i namnaren ar inte 0 % — den ar
 * ingen uppgift, och en nolla hade sett ut som ett svar.
 */
export function klibbighet(serie: Aktivitetsdag[]): number | null {
  const sista = serie[serie.length - 1];
  if (!sista || sista.wau === 0) return null;
  return Math.round((sista.dau / sista.wau) * 100);
}

/**
 * Andel av de anstallda som anvant navet den senaste veckan.
 *
 * Det ar den siffra piloten faktiskt fragar efter: inte hur manga som var
 * inne, utan hur stor del av dem som BORDE vara det. Null nar antalet
 * anstallda inte gar att lasa — hellre inget tal an ett som delar med noll.
 */
export function tackning(serie: Aktivitetsdag[], antalAnstallda: number): number | null {
  const sista = serie[serie.length - 1];
  if (!sista || antalAnstallda <= 0) return null;
  return Math.round((sista.wau / antalAnstallda) * 100);
}

/**
 * Hur lange sedan, i hela dagar. Null nar datumet saknas.
 *
 * Anvands for dokument som ingen oppnat: "aldrig" ar ett annat svar an "for
 * 200 dagar sedan", och de kraver olika atgard.
 */
export function dagarSedan(datum: string | null, nu: Date = new Date()): number | null {
  if (!datum) return null;
  const tidpunkt = new Date(datum);
  if (Number.isNaN(tidpunkt.getTime())) return null;
  return Math.floor((nu.getTime() - tidpunkt.getTime()) / 86_400_000);
}
