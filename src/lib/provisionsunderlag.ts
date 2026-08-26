/**
 * E13 steg 7: det separata provisionsunderlaget.
 *
 * Ren logik — inga anrop, ingen import av Supabase. Samma linje som
 * `provision-motor.ts` och `lonerapport.ts`.
 *
 * ===========================================================================
 * VARFOR ETT EGET UNDERLAG OCH INTE EN KOLUMN I `payroll_row`.
 *
 * Bestallaren svarade pa fraga 57 att bonusen ska raknas i lonerapporten. Det
 * krockar med K5 och AC-2.17: NAVET RAKNAR INGEN LON. O10 loste det med ett
 * SEPARAT underlag som foljer med lonekorningen, och `payroll_row` far ingen
 * kronkolumn.
 *
 * Skillnaden ar inte kosmetisk, och den star redan utskriven i 0025:
 *
 *   `payroll_row` ar ett UNDERLAG SOM LAMNAR HUSET. Dess kolumner ar minuter
 *   och antal, aldrig kronor, for att navet inte far gissa vad en minut ar
 *   vard. Lades en kronkolumn dit blev navet ett lonesystem.
 *
 *   Provisionsunderlaget ar nagot annat: kronorna ar INTE en berakning av lon
 *   utan en huvudbokssumma som redan ar bokford och attesterad i
 *   `commission_entry`. Navet raknar inte fram dem har — det lister upp dem.
 *
 * Darfor ar de tva dokument, och darfor har det har dokumentet ingen kolumn
 * som kommer ur `payroll_row` och tvartom. BLANDAS DE IHOP ar man tillbaka i
 * precis det K5 forbjuder.
 * ===========================================================================
 */

import { manadFore } from "./provision.ts";

// -----------------------------------------------------------------------------
// Formen
// -----------------------------------------------------------------------------

/** En bokford eller live-raknad post, som underlaget bar den. */
export type Underlagspost = {
  slag: string;
  text: string;
  belopp: number;
};

export type Personunderlag = {
  employee_id: string;
  namn: string;
  /** `employee.employee_number`. Tom strang nar det inte ar satt. */
  anstallningsnummer: string;
  poster: Underlagspost[];
  summa: number;
};

export type Underlagsdokument = {
  /** Intjanandemanaden, "2026-08-01". */
  manad: string;
  /**
   * Manaden pengarna betalas ut i.
   *
   * MANADEN EFTER INTJANANDEMANADEN (fraga 58). Regeln ar en rad har och inte
   * en installning, och det ar en avvikelse fran avsnitt 8.2 som listar
   * utbetalningsmanaden som konfiguration. Skalet: det finns ingen tabell att
   * lagga den i, och en ny tabell for ett enda heltal ar en migration som inte
   * bar sin egen vikt. Kommer fragan upp ar det HAR den ska bytas ut mot ett
   * uppslag — och da ar det en rad.
   */
  utbetalas: string;
  /**
   * Ar manaden faststalld?
   *
   * ETT PRELIMINART UNDERLAG SKA SE PRELIMINART UT. En oppen manad raknas live
   * och andrar sig med varje ny order; ett papper som ser likadant ut i bada
   * fallen ar ett papper nagon betalar ut efter av misstag.
   */
  faststalld: boolean;
  personer: Personunderlag[];
  summa: number;
};

/** Summan av personernas summor. Det enda satt totalen far raknas fram pa. */
export function totalt(personer: Personunderlag[]): number {
  return personer.reduce((s, p) => s + p.summa, 0);
}

/** Utbetalningsmanaden for en intjanandemanad. Se `Underlagsdokument.utbetalas`. */
export function utbetalningsmanad(manad: string): string {
  return manadFore(manad, -1);
}

/**
 * Bygger dokumentet.
 *
 * NOLLRADER TAS BORT, MEN NOLLPERSONER STAR KVAR. En person vars manad gar
 * ihop till noll — lika mycket makulerat som tecknat — ska synas i underlaget
 * med sin nolla. Det ar en upplysning: lonekorningen ska veta att personen ar
 * raknad och inte glomd. En POST pa noll ar daremot ingen upplysning alls.
 */
export function byggUnderlag(
  manad: string,
  faststalld: boolean,
  personer: Personunderlag[],
): Underlagsdokument {
  const rensade = personer
    .map((p) => ({ ...p, poster: p.poster.filter((r) => r.belopp !== 0) }))
    .sort((a, b) => a.namn.localeCompare(b.namn, "sv"));

  return {
    manad,
    utbetalas: utbetalningsmanad(manad),
    faststalld,
    personer: rensade,
    summa: totalt(rensade),
  };
}

// -----------------------------------------------------------------------------
// Exporten
// -----------------------------------------------------------------------------

export const EXPORTKOLUMNER = [
  "Anställningsnummer",
  "Namn",
  "Intjänandemånad",
  "Utbetalas",
  "Slag",
  "Beskrivning",
  "Belopp",
] as const;

/**
 * Semikolon och BOM: svensk Excel oppnar filen ratt utan importguide. Samma
 * form som `csv()` i `lonerapport.ts`, och av samma skal.
 *
 * BELOPPET SKRIVS MED KOMMA som decimaltecken och utan tusentalsavgransare.
 * `kronor()` i `provision.ts` skriver U+2212 MINUS SIGN och hardt mellanslag —
 * ratt i en vy, obrukbart i en fil nagon ska rakna med. Ett ASCII-minus och ett
 * komma ar vad svensk Excel tolkar som ett tal.
 */
export function csvUnderlag(dok: Underlagsdokument): string {
  const cell = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const belopp = (n: number) => n.toFixed(2).replace(".", ",");

  const rader: string[] = [EXPORTKOLUMNER.map(cell).join(";")];

  for (const p of dok.personer) {
    for (const post of p.poster) {
      rader.push(
        [
          p.anstallningsnummer,
          p.namn,
          dok.manad,
          dok.utbetalas,
          post.slag,
          post.text,
          belopp(post.belopp),
        ]
          .map(cell)
          .join(";"),
      );
    }

    // EN SUMMARAD PER PERSON. Lonekorningen behover ett tal per manniska;
    // posterna ovan ar dess forklaring. Slaget heter "summa" sa att raden gar
    // att filtrera bort i ett kalkylblad utan att lasa beloppen.
    rader.push(
      [p.anstallningsnummer, p.namn, dok.manad, dok.utbetalas, "summa", "Att betala ut", belopp(p.summa)]
        .map(cell)
        .join(";"),
    );
  }

  return "﻿" + rader.join("\r\n") + "\r\n";
}

/** Filnamnet. Bar manaden och om underlaget ar preliminart. */
export function filnamn(dok: Underlagsdokument): string {
  return `provisionsunderlag-${dok.manad.slice(0, 7)}${dok.faststalld ? "" : "-preliminart"}.csv`;
}
