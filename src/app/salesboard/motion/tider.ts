/**
 * Kompositionernas tider och ljudspår, i bildrutor vid 60 per sekund.
 *
 * Tiderna är den godkända prototypens (v5, `mall.html`), och ljudspåret hör till
 * kompositionen: ett ljud läggs på en bildruta, så att rörelse och ljud aldrig
 * glider isär. Ren logik, så att provet kan spika varje tid.
 *
 * Tavlan bakom en order byter till det nya läget när kompositionens vila är slut
 * (`byt`), och kompositionen krymper sedan in i raden i flödet (`KRYMP`). Det är
 * då tavlans tal rullar, raden flyttar och grafen växer.
 */

import type { Motesniva } from "../../../lib/salesboard/regler.ts";
import type { LjudId, Ljudparametrar } from "../ljud.ts";
import { FPS } from "./matte.ts";

/** Ett ljud i spåret. `sparr`: hornet, som spelas högst en gång per 20 s (`hornTillatet`). */
export type Ljudpunkt = { f: number; ljud: LjudId; p?: Ljudparametrar; sparr?: boolean };

/** Kassaapparatens klocka ("ching") ringer 0,40 s in i inspelningen; ordervärdet landar exakt där. */
export const CHING = 0.4;

/** Utgången: allt krymper in i raden i flödet på 44 bildrutor. */
export const KRYMP = 44;
/** Raden i panelen tonas in när det gamla innehållet är borta (R32). */
export const RAD_IN: readonly [number, number] = [8, 20];
/** En vanlig order står till och med den här bildrutan, sedan krymper den. */
export const VANLIG_VILA = 262;
/** Den stora affärens cymbal: alla siffror låses, skärmen blixtrar och blir amber. */
export const STOR_D = 100;
export const STOR_VILA = STOR_D + 270;
/** Målet kommer 650 ms efter ordern som tog laget över det. */
export const MALET_VANTA = 39;
/** Målets egen längd. Cirkeln sluter sig från 430. */
export const MALET_LANGD = 470;
export const MALET_STANG = 430;
/** Halvvägs är inget helskärmsögonblick: målkortet säger det i sex sekunder. */
export const HALVVAGS = 360;
/** Lugn rörelse: kompositionen står still på sin vilobild så här länge. */
export const LUGN_HALL = 210;
/** Lugn rörelse: bilden tonas in och ut på 15 bildrutor (250 ms). */
export const LUGN_TONING = 15;

/** Antalet siffror i ett belopp som räkneverket visar: 18 900 har fem. */
export const siffror = (belopp: number): number => Math.max(1, String(Math.round(Math.abs(belopp))).length);

/** Räkneverkets sista kolumn landar här (vänster först, höger ett varv mer). */
export const landar = (antal: number): number => 26 + (antal - 1) * 3;

/** Bildrutan där en vanlig orders värde landar. */
export const vanligL = (belopp: number): number => 50 + landar(siffror(belopp));

export type OrderVariant = "vanlig" | "stor" | "forsta";

/** När tavlan byter till det nya läget, och när förloppet är slut. */
export type Ordertider = { byt: number; slut: number };

export function orderTider(variant: OrderVariant): Ordertider {
  const vila = variant === "stor" ? STOR_VILA : VANLIG_VILA;
  return { byt: vila, slut: vila + KRYMP };
}

/**
 * En orders ljudspår. Svischet toppar när svepet täcker skärmen, kassans "ching"
 * när beloppet landar, hornet strax efter. Den första ordern någonsin får fanfaren
 * i stället för hornet.
 *
 * Den stora affären: trumvirveln stiger mot cymbalen, som ligger 2,00 s in i filen
 * och slår på bildruta D, smällen och trumpeterna på cymbalen, publiken strax före,
 * pengarna när "kr" faller in, och kassan när lagets mätare landar.
 */
export function orderLjud(variant: OrderVariant, belopp: number): Ljudpunkt[] {
  if (variant === "stor") {
    const D = STOR_D;
    const sek = D / FPS;
    return [
      { f: 0, ljud: "svisch", p: { styrka: 0.6, fran: 0.2 } },
      { f: 0, ljud: "trumvirvel", p: { styrka: 1, fran: 2.0 - sek, kurva: [[0, 1.4], [sek - 0.06, 3.2], [sek - 0.02, 1]] } },
      { f: D - 22, ljud: "small", p: { styrka: 0.8 } },
      { f: D - 6, ljud: "trumpeter", p: { styrka: 0.85 } },
      { f: D - 24, ljud: "publik", p: { styrka: 0.7, tona: [5.0, 1.6] } },
      { f: D + 9, ljud: "pengar", p: { styrka: 0.9 } },
      { f: D + 112, ljud: "kassa", p: { styrka: 0.7 } },
    ];
  }
  const L = vanligL(belopp);
  const sista: Ljudpunkt =
    variant === "forsta" ? { f: L + 4, ljud: "fanfar", p: { styrka: 0.6, tona: [3.2, 1.2] } } : { f: L + 4, ljud: "horn", p: { styrka: 0.5 }, sparr: true };
  return [
    { f: 0, ljud: "svisch", p: { styrka: 0.45, fran: 0.18 } },
    { f: Math.round(L - CHING * FPS), ljud: "kassa", p: { styrka: 1 } },
    sista,
  ];
}

// -----------------------------------------------------------------------------
// Serien
// -----------------------------------------------------------------------------

/** En serie visar högst så många rader och "+N till". */
export const SERIE_MAX = 8;
/** Raderna kommer med en halv sekunds mellanrum. */
export const SERIE_STEG = 30;
/** Den första raden. */
export const SERIE_FORSTA = 40;

export type Serietider = Ordertider & {
  /** Bildrutan då rad `i` börjar komma in. */
  rad: (i: number) => number;
  /** Summeringen och lagets mätare. */
  summa: number;
  lag: number;
};

export function serieTider(antal: number): Serietider {
  const n = Math.max(1, Math.min(SERIE_MAX, antal));
  const sista = SERIE_FORSTA + (n - 1) * SERIE_STEG;
  const summa = sista + 30;
  const lag = summa + 14;
  const vila = lag + 48 + 90;
  return { rad: (i) => SERIE_FORSTA + Math.min(i, n - 1) * SERIE_STEG, summa, lag, byt: vila, slut: vila + KRYMP };
}

/** Seriens spår: svischet, en kassa per rad när dess värde landar, och hornet efter summan. */
export function serieLjud(antal: number): Ljudpunkt[] {
  const t = serieTider(antal);
  const n = Math.max(1, Math.min(SERIE_MAX, antal));
  const rader: Ljudpunkt[] = Array.from({ length: n }, (_, i) => ({
    f: Math.round(t.rad(i) + 12 - CHING * FPS),
    ljud: "kassa" as const,
    p: { styrka: 0.7 },
  }));
  return [{ f: 0, ljud: "svisch", p: { styrka: 0.45, fran: 0.18 } }, ...rader, { f: t.summa + 4, ljud: "horn", p: { styrka: 0.5 }, sparr: true }];
}

// -----------------------------------------------------------------------------
// Målet
// -----------------------------------------------------------------------------

export const maletTider = (): Ordertider => ({ byt: MALET_VANTA, slut: MALET_VANTA + MALET_LANGD });

/** Smällen ligger 0,36 s in i sin fil och slår när cirkeln täcker skärmen; fanfaren och arenan följer. */
export function maletLjud(): Ljudpunkt[] {
  const v = MALET_VANTA;
  return [
    { f: v + 30 - 0.36 * FPS, ljud: "small", p: { styrka: 0.8 } },
    { f: v + 24, ljud: "fanfar", p: { styrka: 0.9 } },
    { f: v + 30, ljud: "arena", p: { styrka: 0.85, tona: [5.6, 1.8] } },
  ];
}

// -----------------------------------------------------------------------------
// Tävlingen (spec 2026-10-26)
// -----------------------------------------------------------------------------

/** Mellanspelet: tolv sekunder, varav den sista sekunden är utgången. */
export const TAVLING_LANGD = 720;
/** Ytan sluter sig tillbaka över tavlan härifrån. */
export const TAVLING_UT = 660;
/** Loppets första stapel, och mellanrummet till nästa (cirka 130 ms). */
export const LOPP_FORSTA = 70;
export const LOPP_STEG = 8;
/** En stapel växer på så här många bildrutor. */
export const LOPP_VAXER = 28;
/** Knuffen och gränsen: fem och en halv sekund. */
export const KNUFF_LANGD = 330;
export const KNUFF_UT = 284;
/** Vinnaren: nio sekunder. */
export const VINNARE_LANGD = 540;
export const VINNARE_UT = 486;

/** Stapel `i` i loppet börjar växa här. Tre staplar ryms på 16 bildrutor, under en halv sekund. */
export const loppStart = (i: number): number => LOPP_FORSTA + i * LOPP_STEG;

/** Scenerna landar ingen order: `byt` är 0, och tavlan bakom står still. */
export const tavlingTider = (): Ordertider => ({ byt: 0, slut: TAVLING_LANGD });
export const knuffTider = (): Ordertider => ({ byt: 0, slut: KNUFF_LANGD });
export const vinnareTider = (): Ordertider => ({ byt: 0, slut: VINNARE_LANGD });

/**
 * Knuffen och gränsen: ett kort svisch när ytan sveper in, och sedan ett lätt ljud
 * när meningen landar, svagare än en order. Mellanspelet är tyst: ett ljud var
 * tionde minut vore tjat.
 */
export function knuffLjud(typ: "knuff" | "grans"): Ljudpunkt[] {
  if (typ === "knuff") return [{ f: 0, ljud: "svisch", p: { styrka: 0.32, fran: 0.18 } }, { f: 46, ljud: "pengar", p: { styrka: 0.45 } }];
  return [{ f: 0, ljud: "svisch", p: { styrka: 0.4, fran: 0.18 } }, { f: 44, ljud: "trumpeter", p: { styrka: 0.5, tona: [2.4, 0.9] } }];
}

/** Vinnaren: som målet men svagare. Utan vinnare är scenen tyst. */
export function vinnareLjud(medVinnare: boolean): Ljudpunkt[] {
  if (!medVinnare) return [];
  return [
    { f: Math.round(30 - 0.36 * FPS), ljud: "small", p: { styrka: 0.6 } },
    { f: 24, ljud: "fanfar", p: { styrka: 0.75 } },
    { f: 30, ljud: "arena", p: { styrka: 0.6, tona: [4.6, 1.6] } },
  ];
}

// -----------------------------------------------------------------------------
// Mötena
//
// ===========================================================================
// ETT MÖTE SER OCH LÅTER INTE SOM EN ORDER.
//
// Orderna sveper upp underifrån i mint och låter som en kassa. Mötena sveper in
// från sidan i ljung, bär aldrig ett kronbelopp och låter som anslag och klockor
// (tonerna syntetiserade, de stora ljuden från ElevenLabs Music via Higgsfield; se
// ljud.ts). Rörelsen är dagens rad: tio platser i två grupper om fem, där
// bokarens block faller på plats. Fem och tio är rader som
// fylls, så att rummet ser milstolpen komma.
// ===========================================================================
// -----------------------------------------------------------------------------

/** Firandets längd per nivå: ett möte till är en remsa i nederkanten, resten tar skärmen. */
export const MOTE_LANGD: Record<Motesniva, number> = { vanlig: 252, lag: 252, dagensForsta: 330, forsta: 420, fem: 510, tio: 690 };

/** Bildrutan där bokarens nya block landar. Mötesbokarnas lista räknar det härifrån. */
export const MOTE_LANDAR: Record<Motesniva, number> = { vanlig: 40, lag: 40, dagensForsta: 72, forsta: 86, fem: 104, tio: 132 };

/** Utgången: så här många bildrutor före slutet sveper scenen ut. */
export const MOTE_UT = 30;

/** Mötena byter inget på tavlan bakom: `byt` är 0, och listan landar på `MOTE_LANDAR`. */
export const moteTider = (niva: Motesniva): Ordertider => ({ byt: 0, slut: MOTE_LANGD[niva] });

export const moteLandar = (niva: Motesniva): number => MOTE_LANDAR[niva];

/** Fem: block 1–4 landar med tolv bildrutors mellanrum, sedan en paus, och det femte på `MOTE_LANDAR.fem`. */
export const femBlock = (i: number): number => (i < 4 ? 40 + i * 12 : MOTE_LANDAR.fem);

/** Tio: block 1–9 landar allt tätare (12 bildrutor ner till 6), sedan en paus, och det tionde på `MOTE_LANDAR.tio`. */
export function tioBlock(i: number): number {
  if (i >= 9) return MOTE_LANDAR.tio;
  let f = 36;
  for (let k = 0; k < i; k++) f += Math.max(6, 12 - k);
  return f;
}

/** Halvtonssteg uppåt för blocken: pentatoniskt i fem, durskalan i tio. */
const FEM_STEG = [0, 2, 4, 7];
const TIO_STEG = [0, 2, 4, 5, 7, 9, 11, 12, 14];
const takt = (halvtoner: number): number => 2 ** (halvtoner / 12);

/**
 * Mötets ljudspår. Ett möte till: ett lätt svisch och två anslag när blocket landar.
 * Det första: ett brutet ackord. Fem: en ton per block uppåt och ett ackord på det
 * femte. Tio: en skala som går allt fortare, och klangen och publiken på det tionde.
 */
export function moteLjud(niva: Motesniva, antal: number): Ljudpunkt[] {
  const land = MOTE_LANDAR[niva];
  if (niva === "fem") {
    return [
      { f: 0, ljud: "svisch", p: { styrka: 0.4, fran: 0.18 } },
      ...FEM_STEG.map((h, i): Ljudpunkt => ({ f: femBlock(i), ljud: "ton", p: { styrka: 0.5 + i * 0.08, takt: takt(h) } })),
      { f: land, ljud: "ackord", p: { styrka: 0.9 } },
      { f: land, ljud: "ton", p: { styrka: 0.6, takt: 2 } },
    ];
  }
  if (niva === "tio") {
    return [
      { f: 0, ljud: "svisch", p: { styrka: 0.5, fran: 0.18 } },
      ...TIO_STEG.map((h, i): Ljudpunkt => ({ f: tioBlock(i), ljud: "ton", p: { styrka: 0.42 + i * 0.05, takt: takt(h) } })),
      { f: land, ljud: "klang", p: { styrka: 1 } },
      { f: land + 4, ljud: "publik", p: { styrka: 0.55, tona: [4.2, 1.6] } },
    ];
  }
  if (niva === "forsta") {
    return [
      { f: 0, ljud: "svisch", p: { styrka: 0.4, fran: 0.18 } },
      { f: land - 2, ljud: "valkommen", p: { styrka: 0.85 } },
    ];
  }
  // Ett möte till och dagens första: det andra anslaget i "pling" kommer 0,1 s in, när blocket slår i.
  const styrka = niva === "dagensForsta" ? 0.75 : antal > 0 ? 0.6 : 0.5;
  return [
    { f: 0, ljud: "svisch", p: { styrka: niva === "dagensForsta" ? 0.35 : 0.2, fran: 0.18 } },
    { f: land - 6, ljud: "pling", p: { styrka } },
  ];
}
