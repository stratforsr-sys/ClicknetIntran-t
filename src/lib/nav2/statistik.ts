/**
 * Hemvyn: statistiken bakom Navs facit och domar (designdokumentet 1.4, 1.5, 1.7).
 *
 * Fishers exakta prov, ensidigt. Det gäller vid vilket antal som helst, så Nav
 * kan räkna från första mötet i stället för att vänta på en fast gräns. Med få
 * möten krävs en stor skillnad: 5 av 5 mot 0 av 5 ger 0,004, 4 av 5 mot 1 av 4
 * ger 0,17.
 *
 * Rena funktioner utan importer, så att provet går med
 * `node --experimental-strip-types`.
 */

/** n av ett antal. `av = 0` betyder att det inte finns något att räkna på. */
export type NAv = { n: number; av: number };

// log(k!) med en tabell som växer vid behov. Tal upp till några tusen räcker.
const LF: number[] = [0, 0];
const logFak = (k: number): number => {
  for (let i = LF.length; i <= k; i++) LF[i] = LF[i - 1] + Math.log(i);
  return LF[k];
};
const logBinom = (n: number, k: number): number => logFak(n) - logFak(k) - logFak(n - k);

const giltig = (x: NAv): boolean =>
  Number.isInteger(x.n) && Number.isInteger(x.av) && x.av > 0 && x.n >= 0 && x.n <= x.av;

/**
 * Sannolikheten att `hog` får minst så stor andel som den fick, om båda
 * grupperna egentligen är likadana (den hypergeometriska övre svansen).
 * Ett litet tal betyder att skillnaden är svår att förklara med slump.
 * En tom eller trasig grupp ger 1: då finns inget att pröva.
 */
export function fisherEnsidig(hog: NAv, lag: NAv): number {
  if (!giltig(hog) || !giltig(lag)) return 1;
  const N = hog.av + lag.av;
  const K = hog.n + lag.n;
  const nämnare = logBinom(N, K);
  let p = 0;
  const max = Math.min(hog.av, K);
  for (let x = hog.n; x <= max; x++) {
    const resten = K - x;
    if (resten > lag.av) continue;
    p += Math.exp(logBinom(hog.av, x) + logBinom(lag.av, resten) - nämnare);
  }
  return Math.min(1, p);
}

const TAK = 2000;

/**
 * Vid hur många möten skulle dagens andelar räcka för ett utslag? Antalet
 * fördelas i samma proportion som i dag och n räknas med samma andelar
 * (avrundat). Svaret avrundas UPPÅT till tiotal, eftersom det är ett
 * "tidigast": skillnader i små tal krymper oftast när det blir fler.
 * null när `hog` inte har större andel, när en grupp är tom, eller när inte ens
 * 2 000 möten skulle räcka.
 */
export function tidigastVid(hog: NAv, lag: NAv, grans: number): number | null {
  if (!giltig(hog) || !giltig(lag)) return null;
  const s1 = hog.n / hog.av;
  const s2 = lag.n / lag.av;
  if (!(s1 > s2)) return null;
  const summa = hog.av + lag.av;
  for (let T = summa; T <= TAK; T++) {
    const a1 = Math.round((T * hog.av) / summa);
    const a2 = T - a1;
    if (a1 < 1 || a2 < 1) continue;
    const p = fisherEnsidig({ n: Math.round(a1 * s1), av: a1 }, { n: Math.round(a2 * s2), av: a2 });
    if (p <= grans) return Math.ceil(T / 10) * 10;
  }
  return null;
}
