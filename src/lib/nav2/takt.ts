/**
 * Hemvyn: takten i Teamet i månaden, och taktens eget facit (designdokumentet, steg 2).
 *
 * Takten är en uträkning, inget löfte: nettoorder hittills delat med de
 * arbetsdagar som gått, gånger månadens arbetsdagar. Den visas från dag ett,
 * och bredvid står vad den sa förra månaden och vad det blev. Clicknets order
 * kommer i klumpar (5 på en dag), så takten kan missa stort: efter tio dagar sa
 * den 11 i september, och det blev 24. Därför står dess facit alltid bredvid.
 *
 * "Gått" räknas på morgonen: arbetsdagar före i dag. Det är samma läge som
 * nattjobbet sparar, så facit räknas ur det som faktiskt visades.
 *
 * Rena funktioner. Arbetsdagarna (helger och röda dagar) är samma som säljtakten
 * och Mötens: `arArbetsdag` i saljtakt.ts.
 */
import { arArbetsdag } from "../saljtakt.ts";

/** Kalenderdagens nästa dag, "YYYY-MM-DD". */
const nasta = (dag: string): string => {
  const [a, m, d] = dag.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + 1, 12)).toISOString().slice(0, 10);
};

/** Månadens arbetsdagar i ordning. `manad` är "YYYY-MM". */
export function arbetsdagarIManad(manad: string): string[] {
  const ut: string[] = [];
  for (let d = `${manad}-01`; d.startsWith(manad); d = nasta(d)) if (arArbetsdag(d)) ut.push(d);
  return ut;
}

export type TaktLage = { gatt: number; totalt: number; prognos: number | null };

/**
 * Takten en morgon. `idag` kan ligga efter månaden (då har alla dagar gått) eller
 * före den (då har inga gått). Ingen arbetsdag gången ger ingen prognos, och en
 * prognos blir aldrig mindre än noll även när makuleringarna är fler.
 */
export function taktLage(i: { netto: number; manad: string; idag: string }): TaktLage {
  const dagar = arbetsdagarIManad(i.manad);
  const gatt = dagar.filter((d) => d < i.idag).length;
  const totalt = dagar.length;
  const prognos = gatt === 0 ? null : Math.max(0, Math.round((i.netto / gatt) * totalt));
  return { gatt, totalt, prognos };
}

export type TaktManad = {
  manad: string;
  efter5: number | null;
  efter10: number | null;
  efter15: number | null;
  blev: number;
  /** Sant när talen räknats i efterhand ur dagstalen, inte ur det som visades. */
  efterhand: boolean;
};

const MORGNAR = [5, 10, 15] as const;

/** Månadens nettoorder ur dagstalen (+1 på signeringsdagen, −1 på makuleringsdagen). */
const manadensNetto = (nettoPerDag: Record<string, number>, manad: string, fore?: string): number =>
  Object.entries(nettoPerDag).reduce((s, [d, n]) => (d.startsWith(manad) && (fore === undefined || d < fore) ? s + n : s), 0);

/**
 * Vad takten hade sagt morgonen då exakt `gatt` arbetsdagar hade gått, räknat i
 * efterhand ur dagstalen. null när månaden inte har så många arbetsdagar kvar
 * att det finns en sådan morgon, eller när ingen dag har gått.
 */
export function taktSaVid(nettoPerDag: Record<string, number>, manad: string, gatt: number): number | null {
  const dagar = arbetsdagarIManad(manad);
  if (gatt < 1 || gatt >= dagar.length) return null;
  const morgon = dagar[gatt];
  return taktLage({ netto: manadensNetto(nettoPerDag, manad, morgon), manad, idag: morgon }).prognos;
}

/** Vad takten hade sagt efter 5, 10 och 15 arbetsdagar, och vad månaden blev, räknat i efterhand. */
export function taktEfterhand(nettoPerDag: Record<string, number>, manad: string): Omit<TaktManad, "manad" | "efterhand"> {
  const sa = (gatt: number) => taktSaVid(nettoPerDag, manad, gatt);
  return { efter5: sa(5), efter10: sa(10), efter15: sa(15), blev: manadensNetto(nettoPerDag, manad) };
}

export type TaktTraff = { manad: string; gatt: number; sa: number | null; blev: number; efterhand: boolean };

/**
 * Taktens facit vid SAMMA antal gångna arbetsdagar som i dag, för varje avslutad
 * månad, nyast först. Det här står bredvid prognosen på kortet: den som läser
 * "ungefär 40 efter 10 dagar" ser vad takten sa efter 10 dagar varje tidigare
 * månad och vad det blev. Alla månader visas, också de där takten missade.
 * Sparade morgonvärden går före uträkningen i efterhand.
 */
export function taktFacitVid(
  gatt: number,
  sparade: { manad: string; gatt: number; prognos: number }[],
  blev: Record<string, number>,
  dagstal: Record<string, Record<string, number>> = {},
): TaktTraff[] {
  if (gatt < 1) return [];
  return Object.keys(blev)
    .sort((a, b) => (a < b ? 1 : -1))
    .map((manad): TaktTraff => {
      const sparad = sparade.find((s) => s.manad === manad && s.gatt === gatt);
      if (sparad) return { manad, gatt, sa: sparad.prognos, blev: blev[manad], efterhand: false };
      return { manad, gatt, sa: taktSaVid(dagstal[manad] ?? {}, manad, gatt), blev: blev[manad], efterhand: true };
    });
}

/**
 * Facit för avslutade månader, nyast först. Sparade morgonvärden går före
 * uträkningen i efterhand; en månad utan sparade värden räknas ur dagstalen och
 * märks `efterhand`. `blev` är månadens slutliga nettoorder.
 */
export function taktFacit(
  sparade: { manad: string; gatt: number; prognos: number }[],
  blev: Record<string, number>,
  dagstal: Record<string, Record<string, number>> = {},
): TaktManad[] {
  return Object.keys(blev)
    .sort((a, b) => (a < b ? 1 : -1))
    .map((manad): TaktManad => {
      const egna = sparade.filter((s) => s.manad === manad);
      if (egna.length) {
        const vid = (g: number) => egna.find((s) => s.gatt === g)?.prognos ?? null;
        return { manad, efter5: vid(MORGNAR[0]), efter10: vid(MORGNAR[1]), efter15: vid(MORGNAR[2]), blev: blev[manad], efterhand: false };
      }
      const e = taktEfterhand(dagstal[manad] ?? {}, manad);
      return { manad, efter5: e.efter5, efter10: e.efter10, efter15: e.efter15, blev: blev[manad], efterhand: true };
    });
}
