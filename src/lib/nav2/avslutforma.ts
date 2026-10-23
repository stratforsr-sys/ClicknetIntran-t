/**
 * Nav 2.0, Anställda: ren logik för avslutet och checklistornas fritext.
 * Inga anrop, så att provet (`tests/nav2-anstallda-avslut.mjs`) når den.
 *
 * Granskningen 2026-10-22, S10:
 *   - F1-8: ett avslut med sista dag i dag eller bakåt stänger inloggningen
 *     direkt; ett med sista dag framåt stängs av nattjobbet natten efter sista
 *     dagen (`stangPlaneradeAvslut`).
 *   - F1-9: värdet, anteckningen och skälet i checklistorna tar inga
 *     personnummer (samma regel som K27 och 0030:s `ser_ut_som_personnummer`).
 */

export const PNR = /\d{6}[-+]?\d{4}/;
export const PNR_TEXT = "Det ser ut som ett personnummer. Navet sparar inga, så ta bort det.";

export function harPersonnummer(...texter: (string | null | undefined)[]): boolean {
  return texter.some((t) => !!t && PNR.test(t));
}

/** Stängs inloggningen nu? Bara när sista dagen är i dag eller passerad. */
export function avslutNu(slut: string, idag: string): boolean {
  return slut <= idag;
}

export type PlaneratAvslut = { id: string; status: string; end_date: string | null; end_reason_by: string | null };

/**
 * Avsluten att stänga i natt: inte redan avslutade, sista dagen före i dag, och
 * med en avslutslista (bara ett registrerat avslut har en). En visstid med ett
 * slutdatum men utan avslut rörs aldrig.
 */
export function attStangaINatt(personer: PlaneratAvslut[], medLista: Set<string>, idag: string): PlaneratAvslut[] {
  return personer.filter((p) => p.status !== "offboarded" && !!p.end_date && p.end_date < idag && medLista.has(p.id));
}
