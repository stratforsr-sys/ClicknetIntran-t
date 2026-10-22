/**
 * Dagsljuset i Stockholm: när solen går upp och ned, och hur lång dagen är.
 *
 * Inloggningens urtavla (src/app/logga-in/Urtavla.tsx) ritar dygnet och året
 * med det. Räknat med NOAA:s solformel, den som deras solkalkylator och
 * almanackorna bygger på: inom en minut från almanackan, och utan någon fråga
 * till någon tjänst. Tiden gäller solens övre kant mot en plan horisont, med
 * ljusbrytningen (90,833°), som i almanackan.
 *
 * Ren logik utan import, så att provet kan köra den rakt av
 * (tests/inloggning.mjs).
 */

export type Plats = { lat: number; lon: number };

/** Clicknets klocka går i svensk tid, och dagsljuset räknas för Stockholm. */
export const STOCKHOLM: Plats = { lat: 59.3293, lon: 18.0686 };

const DAG_MS = 86_400_000;
const GRAD = Math.PI / 180;
const sin = (g: number) => Math.sin(g * GRAD);
const cos = (g: number) => Math.cos(g * GRAD);
const tan = (g: number) => Math.tan(g * GRAD);

/**
 * Solens deklination och tidsekvationen (i minuter) vid en tidpunkt, efter
 * NOAA:s "General Solar Position Calculations".
 */
function solen(tid: number): { dekl: number; tidsekv: number } {
  const t = (tid / DAG_MS + 2440587.5 - 2451545) / 36525;
  const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c =
    sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) + sin(2 * m) * (0.019993 - 0.000101 * t) + sin(3 * m) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const langd = l0 + c - 0.00569 - 0.00478 * sin(omega);
  const lutning = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60 + 0.00256 * cos(omega);
  const y = tan(lutning / 2) ** 2;
  const ekv =
    y * sin(2 * l0) -
    2 * e * sin(m) +
    4 * e * y * sin(m) * cos(2 * l0) -
    0.5 * y * y * sin(4 * l0) -
    1.25 * e * e * sin(2 * m);
  return { dekl: Math.asin(sin(lutning) * sin(langd)) / GRAD, tidsekv: (4 * ekv) / GRAD };
}

/**
 * Soluppgång och solnedgång en kalenderdag. Null när solen inte går upp
 * eller inte går ned (midnattssol, polarnatt), vilket aldrig händer i
 * Stockholm men gör funktionen ärlig norr om polcirkeln.
 */
export function solTider(ar: number, manad: number, dag: number, plats: Plats = STOCKHOLM): { upp: Date; ned: Date } | null {
  const midnatt = Date.UTC(ar, manad - 1, dag);
  const vid = (riktning: -1 | 1): Date | null => {
    // Minuter efter midnatt i Greenwich. Gissningen är solens middag, och tre
    // varv räcker: solens läge ändras inte mycket på de timmar det flyttar sig.
    let minut = 720 - 4 * plats.lon;
    for (let k = 0; k < 3; k++) {
      const { dekl, tidsekv } = solen(midnatt + minut * 60_000);
      const cosTimvinkel = cos(90.833) / (cos(plats.lat) * cos(dekl)) - tan(plats.lat) * tan(dekl);
      if (cosTimvinkel <= -1 || cosTimvinkel >= 1) return null;
      minut = 720 - 4 * plats.lon - tidsekv + riktning * 4 * (Math.acos(cosTimvinkel) / GRAD);
    }
    return new Date(midnatt + minut * 60_000);
  };
  const upp = vid(-1);
  const ned = vid(1);
  return upp && ned ? { upp, ned } : null;
}

/** Till närmaste hela minut, som almanackan avrundar. */
export function narmasteMinut(tid: Date): Date {
  return new Date(Math.round(tid.getTime() / 60_000) * 60_000);
}

/** Minuter mellan soluppgång och solnedgång. */
export function dagslangd(ar: number, manad: number, dag: number, plats: Plats = STOCKHOLM): number {
  const t = solTider(ar, manad, dag, plats);
  return t ? (t.ned.getTime() - t.upp.getTime()) / 60_000 : 0;
}

/** Antal dagar året har. */
export function dagarIAret(ar: number): number {
  return (Date.UTC(ar + 1, 0, 1) - Date.UTC(ar, 0, 1)) / DAG_MS;
}

/** Dagens ordning i året, 0 för 1 januari. */
export function dagIAret(ar: number, manad: number, dag: number): number {
  return (Date.UTC(ar, manad - 1, dag) - Date.UTC(ar, 0, 1)) / DAG_MS;
}

/** Dagslängden, i minuter, för varje dag i året. Index 0 är 1 januari. */
export function aretsDagsljus(ar: number, plats: Plats = STOCKHOLM): number[] {
  return Array.from({ length: dagarIAret(ar) }, (_, i) => {
    const d = new Date(Date.UTC(ar, 0, 1 + i));
    return dagslangd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), plats);
  });
}

/** "9 t 24 min", "42 min". */
export function langdText(minuter: number): string {
  const m = Math.round(minuter);
  const t = Math.floor(m / 60);
  return t > 0 ? `${t} t ${m % 60} min` : `${m} min`;
}

/**
 * Hur dagen ändrats sedan i går: "6 min kortare än i går". Runt solstånden
 * ändras den med sekunder, och då står det så.
 */
export function andringText(idag: number, igar: number): string {
  const d = Math.round(idag - igar);
  if (d === 0) return "nästan lika lång som i går";
  return `${Math.abs(d)} min ${d > 0 ? "längre" : "kortare"} än i går`;
}
