/**
 * Månadens tävling på tavlan: loppet, och när mellanspelet och vinnaren spelas.
 *
 * Ren logik utan klocka och utan webbläsare, så att reglerna går att prova med
 * node (`tests/salesboard.mjs`). Planeringen (`regler.ts`) frågar här när den
 * avgör knuffen, kön (`ko.ts`) när den bygger scenerna, och Tavla.tsx när den
 * lägger in ett mellanspel.
 *
 * ===========================================================================
 * TÄVLINGEN VISAR BARA DEM SOM KAN VINNA (spec 2026-10-26, Barankay).
 *
 * Rankning slår fel när den som ligger långt efter ställs mot ledaren: hen ger
 * upp. Loppet är därför ledaren och de som är inom räckhåll, högst tre
 * snittorder bakom, och högst två av dem. Avståndet sägs i order och inte i
 * kronor, eftersom en order är något man kan ringa efter (målgradienten).
 * Dolda säljare finns inte i `saljare` och är därför aldrig med.
 * ===========================================================================
 */

import type { Ogonblick, TavleSaljare } from "./typer.ts";

/** Inom räckhåll: högst så många snittorder bakom ledaren. */
export const RACKVIDD = 3;
/** Så många visas utöver ledaren. */
export const MED_LEDAREN = 2;
/** Mellanspelet går var tionde minut, räknat från förra. */
export const MELLANSPEL_MS = 600_000;
/** Sista arbetsveckan (högst så många arbetsdagar kvar) var femte minut. */
export const SISTA_VECKAN_DAGAR = 4;
export const SISTA_VECKAN_MS = 300_000;
/** Har en knuff eller en gränsscen spelats så nyligen hoppar mellanspelet över sin tur. */
export const LUGN_EFTER_KNUFF_MS = 120_000;

/** Lagets snittorder i kronor, avrundad till hundratal (som `snitt` i vy.ts). 0 utan order. */
export const snittorder = (varde: number, antal: number): number => (antal > 0 ? Math.round(varde / antal / 100) * 100 : 0);

const ORDEN = ["noll", "en", "två", "tre", "fyra", "fem", "sex", "sju", "åtta", "nio", "tio"];

/** "en order", "två order", "12 order". */
export const ordOrder = (n: number): string => `${ORDEN[n] ?? String(n)} order`;

/** Hur många snittorder `kr` motsvarar, avrundat uppåt: 1 kr bakom är en order bakom. */
export const iOrder = (kr: number, snitt: number): number => (snitt > 0 ? Math.max(1, Math.ceil(kr / snitt)) : 0);

/** En rad i loppet. */
export type Loppsrad = {
  person: string;
  varde: number;
  /** Ledaren och den som delar ledningen. */
  leder: boolean;
  /** Snittorder bakom ledaren, 0 för ledaren. */
  bakom: number;
  /** Har nått kvalgränsen (alltid sant utan gräns). */
  over: boolean;
  /** "leder", "delar ledningen", "leder · en order till gränsen", "två order bakom". */
  text: string;
};

export type Lopp = {
  rader: Loppsrad[];
  /** Lagets snittorder i kronor. */
  snitt: number;
  /** Ledarens ordervärde. */
  topp: number;
};

type Rad = Pick<TavleSaljare, "person" | "varde">;

/** Raderna med högst värde först, och vid lika nyckeln, så att ordningen aldrig hoppar mellan två bilder. */
const ordnade = <T extends Rad>(rader: readonly T[]): T[] =>
  [...rader].sort((a, b) => b.varde - a.varde || (a.person < b.person ? -1 : a.person > b.person ? 1 : 0));

/**
 * Loppet: ledaren (och den som delar ledningen) och de som är inom räckhåll,
 * högst tre rader. Null när ingen har sålt något eller laget saknar en
 * snittorder, och då visas inget mellanspel.
 *
 * - Ledaren: "leder", eller "delar ledningen". Har ledaren inte nått gränsen
 *   står det hur långt det är kvar, i order. Är ingen inom räckhåll står
 *   försprånget: "leder med tre order".
 * - De andra: "en order bakom", "två order bakom", "tre order bakom".
 */
export function lopp(rader: readonly Rad[], lag: { varde: number; antal: number }, grans: number | null): Lopp | null {
  const snitt = snittorder(lag.varde, lag.antal);
  const alla = ordnade(rader);
  const topp = alla[0]?.varde ?? 0;
  if (snitt <= 0 || topp <= 0) return null;

  const ledare = alla.filter((r) => r.varde === topp);
  const ovriga = alla.filter((r) => r.varde < topp && r.varde > 0);
  const nara = ovriga.filter((r) => iOrder(topp - r.varde, snitt) <= RACKVIDD).slice(0, MED_LEDAREN);
  const over = (v: number) => grans === null || v >= grans;

  let ledartext = ledare.length > 1 ? "delar ledningen" : "leder";
  if (!over(topp)) ledartext += ` · ${ordOrder(iOrder(grans! - topp, snitt))} till gränsen`;
  else if (ledare.length === 1 && nara.length === 0 && ovriga.length > 0) ledartext += ` med ${ordOrder(iOrder(topp - ovriga[0].varde, snitt))}`;

  const visade = [
    ...ledare.slice(0, 1 + MED_LEDAREN).map((r): Loppsrad => ({ person: r.person, varde: r.varde, leder: true, bakom: 0, over: over(r.varde), text: ledartext })),
    ...nara.map((r): Loppsrad => {
      const bakom = iOrder(topp - r.varde, snitt);
      return { person: r.person, varde: r.varde, leder: false, bakom, over: over(r.varde), text: `${ordOrder(bakom)} bakom` };
    }),
  ].slice(0, 1 + MED_LEDAREN);
  return { rader: visade, snitt, topp };
}

/** Hur ofta mellanspelet går: var tionde minut, och var femte den sista arbetsveckan. */
export const mellanspelVar = (dagarKvar: number): number => (dagarKvar <= SISTA_VECKAN_DAGAR ? SISTA_VECKAN_MS : MELLANSPEL_MS);

/**
 * Ska mellanspelet spelas nu?
 *
 * - "nu": tävlingen är på, tavlan är lugn (inget spelas eller köar), det är
 *   arbetsdag, och turen har kommit.
 * - "hoppa": turen har kommit, men en knuff eller gränsscen spelades de senaste
 *   två minuterna, eller ingen har sålt något. Turen räknas som tagen.
 * - "vanta": inte än. Ett firande som spelas skjuter upp mellanspelet tills
 *   tavlan är lugn igen.
 *
 * En bild som inte laddats färdigt (`bildKlar` falskt) väntar också.
 */
export function mellanspelDags(o: {
  bild: Ogonblick;
  nuMs: number;
  senastMs: number;
  knuffMs: number | null;
  lugnt: boolean;
  arbetsdag: boolean;
  bildKlar: boolean;
}): "nu" | "hoppa" | "vanta" {
  const t = o.bild.tavling;
  if (!t || !o.lugnt || !o.arbetsdag || !o.bildKlar) return "vanta";
  if (o.nuMs - o.senastMs < mellanspelVar(t.dagarKvar)) return "vanta";
  if (o.knuffMs !== null && o.nuMs - o.knuffMs >= 0 && o.nuMs - o.knuffMs < LUGN_EFTER_KNUFF_MS) return "hoppa";
  return lopp(o.bild.saljare, o.bild.manad, t.grans) ? "nu" : "hoppa";
}

/** Ska förra månadens vinnare spelas nu? En gång per skärm och månad, när arbetsdagen börjat och tavlan är lugn. */
export function vinnareDags(o: { bild: Ogonblick; visad: boolean; lugnt: boolean; arbetsdag: boolean; bildKlar: boolean }): boolean {
  return o.bild.vinnare !== null && !o.visad && o.lugnt && o.arbetsdag && o.bildKlar;
}
