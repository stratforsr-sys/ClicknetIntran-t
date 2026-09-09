/**
 * E13 steg 11: saljchefens ersattning.
 *
 * Ren logik — inga anrop, inga hemligheter, ingen import av Supabase. Samma
 * linje som `order.ts`, `provision-motor.ts` och `konsekvens.ts`: filen ska ga
 * att prova utan att starta Next. Se `tests/chefsprovision.mjs`.
 *
 * ===========================================================================
 * TVA SATSER SOM ALDRIG MOTS PA SAMMA ORDER.
 *
 *   OVERTACKET (`override_percent`) galler NAGON ANNANS order. Basen ar det som
 *   blir over nar saljarens provision dragits av ordervardet.
 *
 *   EGEN FORSALJNING (`own_sale_percent`) galler saljchefens EGNA order. Basen
 *   ar hela ordervardet, och matrisen anvands inte alls.
 *
 * Bestallarens beslut 2026-09-09. Skalet till att de utesluter varandra ar att
 * overtacket finns for att chefen byggt nagon annans affar; pa en egen order
 * finns ingen sadan insats att ersatta, och bada satserna hade betalat samma
 * arbete tva ganger.
 *
 * `order_manager_commission_inte_egen` i 0050 sager samma sak i databasen.
 * ===========================================================================
 *
 * INGEN PROCENTSATS STAR I DEN HAR FILEN.
 *
 * Sok efter ett tal harunder och du hittar 0 och 100 — det ena for att en
 * restpost aldrig gar under noll, det andra for att procent ar hundradelar.
 * Satserna ar rader i `manager_commission_rate` (0050) och kommer hit som
 * argument. AC-10.1 kraver att provisionsreglerna ar konfiguration och inte kod,
 * och skalet ar praktiskt: en sats i koden gar varken att andra utan deploy
 * eller att visa for den som ska tjana pengarna.
 */

import { avrunda } from "./provision-motor.ts";

// -----------------------------------------------------------------------------
// Formen pa det databasen bar. Speglar 0050 utan att veta om databasen.
// -----------------------------------------------------------------------------

export type Chefssats = {
  id: string;
  /** Mottagaren. Exakt en oppen rad finns — se det unika indexet i 0050. */
  employee_id: string;
  /** Pa restposten av ANDRAS order. */
  override_percent: number;
  /** Pa hela ordervardet av EGNA order. */
  own_sale_percent: number;
  valid_from: string;
  valid_to: string | null;
};

/** Overtacket sa som det ska frysas pa ordern. */
export type Overtack = {
  manager_id: string;
  /** Ordervardet rakningen utgick fran. */
  order_value: number;
  /** Restposten: ordervardet minus saljarens provision, aldrig under noll. */
  base: number;
  percent: number;
  amount: number;
  rate_id: string;
};

// -----------------------------------------------------------------------------
// Satsuppslaget
// -----------------------------------------------------------------------------

/**
 * Satsen som gallde vid ett visst datum.
 *
 * ===========================================================================
 * UPPSLAGET SKER PA ORDERNS SIGNERINGSDATUM, inte pa manadens forsta dag.
 *
 * Det ar samma val som `gallandeSats` i `order.ts` gor, och motsatsen till
 * `gallandeNivaer` i `provision-motor.ts`. Skillnaden foljer av vad de tva ar,
 * och det ar vart att skriva ut:
 *
 *   VOLYMBONUSEN ar en egenskap hos HELA MANADEN — nivan bestams av manadens
 *   samlade ordervolym — och en trappa som byter form mitt i manaden gar darfor
 *   inte att tillampa per order utan att bli obegriplig (O16).
 *
 *   OVERTACKET ar en egenskap hos EN ORDER. Det raknas pa den enskilda orderns
 *   varde och provision, det fryses nar just den ordern godkanns, och det har
 *   ingenting med manadens ovriga order att gora. Da ar orderns eget datum det
 *   enda som ar meningsfullt att sla upp pa.
 *
 * Foljden ar att en satsandring mitt i manaden traffar order som signeras
 * DAREFTER, och lamnar de tidigare i fred. Det ar vad bestallarens val "galler
 * fran och med nu" i avsnitt 8.1 betyder, och till skillnad fran for trappan
 * betyder det nagot annat an "galler nasta manad".
 * ===========================================================================
 *
 * `valid_to` ar exklusivt: en sats som slutar 2026-10-01 galler till och med den
 * 30 september. Halvoppna intervall ar det enda sattet att undvika en dag som
 * antingen tillhor bada raderna eller ingen.
 *
 * Saknas satsen returneras null, aldrig noll procent. En nolla hade sett ut som
 * "saljchefen ska inte ha nagot" i stallet for "ingen sats ar satt", och de tva
 * ar olika svar — samma resonemang som `gallandeSats` for i `order.ts`.
 */
export function gallandeChefssats(satser: Chefssats[], datum: string): Chefssats | null {
  const traffar = satser.filter(
    (s) => s.valid_from <= datum && (s.valid_to === null || s.valid_to > datum),
  );

  if (traffar.length === 0) return null;

  // Fler an en trass ar ett konfigurationsfel — det partiella unika indexet i
  // 0050 hindrar tva OPPNA rader, men inte tva overlappande stangda. Nyast
  // valid_from vinner, sa uppslaget ger ett svar i stallet for att falla.
  return traffar.sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1))[0];
}

// -----------------------------------------------------------------------------
// Rakningen
// -----------------------------------------------------------------------------

/**
 * Restposten: det som blir over av ordervardet nar saljarens provision dragits.
 *
 * ===========================================================================
 * TALET GAR ALDRIG UNDER NOLL. Bestallarens beslut 2026-09-09.
 *
 * Pa en paketorder kan det inte handa — matrisens hogsta belopp ar 6 500 kr och
 * det lagsta ordervardet 11 940 kr. Pa en HANDSATT order kan det: godkannaren
 * skriver in bada talen, och en provision pa 3 000 kr mot ett ordervarde pa
 * 2 000 kr ger −1 000 kr.
 *
 * Skulle den restposten fa slaga igenom hade saljchefen fatt ett AVDRAG pa en
 * affar nagon annan tecknat, och avdraget hade dessutom sjunkit i takt med att
 * chefen forhandlade upp saljarens provision. Det ar tvartemot vad overtacket
 * ar till for.
 *
 * Nollan doljer ingenting: bade `order_value` och `commission_amount` star kvar
 * pa ordern, sa den som undrar varfor overtacket blev noll ser bada talen. Vyn
 * markerar dessutom ordern — se `restpostenAtNoll`.
 * ===========================================================================
 */
export function restpost(ordervarde: number, saljarprovision: number): number {
  const kvar = ordervarde - saljarprovision;
  return kvar > 0 ? kvar : 0;
}

/**
 * Slog restposten i botten? Ett eget predikat, sa att vyn kan saga det med ord.
 *
 * Skillnaden mot `restpost(...) === 0` ar att en order dar vardet EXAKT motsvarar
 * provisionen ocksa ger noll, utan att nagot ar konstigt. Den har fragan galler
 * bara det fall dar talet klipptes.
 */
export function restpostenAtNoll(ordervarde: number, saljarprovision: number): boolean {
  return ordervarde - saljarprovision < 0;
}

/**
 * Ar det saljchefen sjalv som star som saljare pa ordern?
 *
 * Den har fragan avgor VILKEN av de tva satserna som galler, och den maste
 * darfor stallas pa ETT stalle. Stalls den pa tva hinner de sager olika saker
 * den dag mottagaren byts — och da far antingen chefen bade 40 % och overtacket,
 * eller ingetdera.
 */
export function arEgenForsaljning(sats: Chefssats | null, saljareId: string): boolean {
  return sats !== null && sats.employee_id === saljareId;
}

/**
 * Saljchefens provision pa sin EGEN order: procenten pa hela ordervardet.
 *
 * MATRISEN ANVANDS INTE. Bestallarens beslut 2026-09-09 var att satsen ERSATTER
 * paketmatrisen, inte kommer utover den — sa den har funktionen ar hela
 * provisionen for ordern, och `commission_source` blir `manager`.
 *
 * Avrundas till hela kronor har, och bara har. Beloppet fryses pa ordern i nasta
 * steg och gar aldrig genom nagon andra avrundning.
 */
export function egenProvision(sats: Chefssats, ordervarde: number): number {
  return avrunda((ordervarde * sats.own_sale_percent) / 100);
}

/**
 * Overtacket pa en order nagon ANNAN tecknat.
 *
 * `null` i tre fall, och de betyder olika saker:
 *
 *   Ingen sats ar satt          — saljchefen ska inte ha nagot annu.
 *   Chefen ar sjalv saljaren    — da galler `egenProvision` i stallet.
 *   Satsen ar noll procent      — en post pa noll kronor ar ingen upplysning,
 *                                 och i en tabell som inte gar att skriva om ar
 *                                 den heller inte gar att stada bort. Samma
 *                                 regel som `bokforingsposter` foljer for
 *                                 nollposter i huvudboken.
 *
 * Ordervardet ska vara ordens FRYSTA varde och provisionen dess FRYSTA belopp.
 * Rakningen sker en gang, vid godkannandet, och resultatet lagras — se
 * `order_manager_commission` i 0050. Att rakna om den i en vy hade gett ett
 * annat tal sa fort nagon andrade satsen.
 */
export function overtackFor(
  sats: Chefssats | null,
  saljareId: string,
  ordervarde: number,
  saljarprovision: number,
): Overtack | null {
  if (sats === null) return null;
  if (arEgenForsaljning(sats, saljareId)) return null;
  if (sats.override_percent <= 0) return null;

  const base = restpost(ordervarde, saljarprovision);
  const amount = avrunda((base * sats.override_percent) / 100);

  // En restpost pa noll ger ett belopp pa noll, och den posten ska inte skrivas.
  // Villkoret star pa BELOPPET och inte pa basen: med en mycket liten restpost
  // och en mycket liten sats kan produkten avrundas till noll anda.
  if (amount <= 0) return null;

  return {
    manager_id: sats.employee_id,
    order_value: ordervarde,
    base,
    percent: sats.override_percent,
    amount,
    rate_id: sats.id,
  };
}

/**
 * Hela affaren for en order, sett fran bada hallen.
 *
 * ===========================================================================
 * DEN HAR FUNKTIONEN AR DET ENDA STALLET DAR DE TVA SATSERNA VALJS EMELLAN.
 *
 * Bade inmatningens forhandsvisning, godkannandet och proven gar genom den. Det
 * ar avsiktligt: regeln "40 % ELLER matrisen, och overtack bara pa andras" ar
 * lika latt att skriva ratt som att skriva halvratt, och en andra tolkning nagon
 * annanstans i koden hade synts forst nar nagon undrade over sin lon.
 * ===========================================================================
 *
 * `saljarprovision` ar den provision som gallt UTAN chefsregeln — ur matrisen
 * eller handsatt. Den anvands bara nar ordern inte ar chefens egen; ar den det
 * ersatts den av `egenProvision`.
 */
export type Affar = {
  /** Provisionen som ska frysas pa ordern. */
  provision: number;
  /** Varifran den kom. Speglar `commission_source` i 0034 och 0050. */
  kalla: "matrix" | "manual" | "manager";
  /** Overtacket, eller null nar inget ska bokforas. */
  overtack: Overtack | null;
};

export function affarenFor(arg: {
  sats: Chefssats | null;
  saljareId: string;
  ordervarde: number;
  /** Provisionen ur matrisen eller handsatt. Ignoreras vid egen forsaljning. */
  saljarprovision: number;
  /** Kallan for `saljarprovision`. Ignoreras vid egen forsaljning. */
  saljarkalla: "matrix" | "manual";
}): Affar {
  const { sats, saljareId, ordervarde, saljarprovision, saljarkalla } = arg;

  if (arEgenForsaljning(sats, saljareId)) {
    return {
      provision: egenProvision(sats!, ordervarde),
      kalla: "manager",
      overtack: null,
    };
  }

  return {
    provision: saljarprovision,
    kalla: saljarkalla,
    overtack: overtackFor(sats, saljareId, ordervarde, saljarprovision),
  };
}
