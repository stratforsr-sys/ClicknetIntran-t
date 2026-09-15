/**
 * E13 steg 13: utkop pa affaren.
 *
 * Ren logik — inga anrop, inga hemligheter, ingen import av Supabase. Samma
 * linje som `order.ts`, `chefsprovision.ts` och `provision-motor.ts`: filen ska
 * ga att prova utan att starta Next. Se `tests/utkop.mjs`.
 *
 * ===========================================================================
 * VAD ETT UTKOP AR, PA BESTALLARENS SPRAK (2026-09-15):
 *
 *   *"Ibland tar vi fran ordervardet och koper ut kunder med det."*
 *
 * Kunden sitter i ett avtal nagon annanstans. For att fa affaren loser bolaget
 * ut henne ur det, och pengarna tas ur den nya affaren. Det som blir kvar ar
 * vad affaren faktiskt gav — och det ar pa det talet saljaren far sin procent.
 * ===========================================================================
 *
 * TRE TAL SOM ALDRIG FAR BLANDAS IHOP:
 *
 *   ORDERVARDET   brutto. Vad kunden tecknat: manadspriset gange avtalstiden.
 *   UTKOPET       det som gick ut till att losa kunden ur sitt gamla avtal.
 *   NETTOT        skillnaden. Basen for bade saljarens provision och
 *                 saljchefens overtack.
 *
 * NETTOT LAGRAS INTE. Det raknas fram ur de tva som star pa ordern, varje gang.
 * Ett lagrat netto hade varit ett tredje tal som kan saga emot de tva andra —
 * samma skal som `period_month` ar en genererad kolumn och inte en skriven.
 *
 * INGEN PROCENTSATS STAR I DEN HAR FILEN. Sok efter ett tal harunder och du
 * hittar 0 och 100 — det ena for att ett netto aldrig gar under noll, det andra
 * for att procent ar hundradelar. Satsen ar en rad i `buyout_commission_rate`
 * (0060) och kommer hit som argument. AC-10.1 kraver att provisionsreglerna ar
 * konfiguration och inte kod, och skalet ar praktiskt: en sats i koden gar
 * varken att andra utan deploy eller att visa for den som ska tjana pengarna.
 */

import { avrunda } from "./provision-motor.ts";

// -----------------------------------------------------------------------------
// Formen pa det databasen bar. Speglar 0060 utan att veta om databasen.
// -----------------------------------------------------------------------------

export type Utkopssats = {
  id: string;
  /** Saljarens andel av nettot. Exakt en oppen rad finns — se det unika indexet i 0060. */
  percent: number;
  valid_from: string;
  valid_to: string | null;
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
 * Samma val som `gallandeSats` i `order.ts` och `gallandeChefssats` i
 * `chefsprovision.ts` gor, och motsatsen till `gallandeNivaer` i
 * `provision-motor.ts`. Skillnaden foljer av vad de tva ar:
 *
 *   VOLYMBONUSEN ar en egenskap hos HELA MANADEN — nivan bestams av manadens
 *   samlade ordervolym — och en trappa som byter form mitt i manaden gar darfor
 *   inte att tillampa per order utan att bli obegriplig (O16).
 *
 *   UTKOPSSATSEN ar en egenskap hos EN ORDER. Den raknas pa den enskilda
 *   affarens netto och fryses nar just den ordern godkanns. Da ar orderns eget
 *   datum det enda som ar meningsfullt att sla upp pa — en order som laggs in i
 *   efterhand far den sats som gallde nar den skrevs.
 * ===========================================================================
 *
 * `valid_to` ar exklusivt: en sats som slutar 2026-10-01 galler till och med den
 * 30 september. Halvoppna intervall ar det enda sattet att undvika en dag som
 * antingen tillhor bada raderna eller ingen.
 *
 * Saknas satsen returneras null, aldrig noll procent. En nolla hade sett ut som
 * "saljaren ska inte ha nagot pa en utkopsaffar" i stallet for "ingen sats ar
 * satt", och de tva ar olika svar. Anroparen far da saga ifran i stallet for
 * att tyst bokfora noll kronor.
 */
export function gallandeUtkopssats(satser: Utkopssats[], datum: string): Utkopssats | null {
  const traffar = satser.filter(
    (s) => s.valid_from <= datum && (s.valid_to === null || s.valid_to > datum),
  );

  if (traffar.length === 0) return null;

  // Fler an en traff ar ett konfigurationsfel — det partiella unika indexet i
  // 0060 hindrar tva OPPNA rader, men inte tva overlappande stangda. Nyast
  // valid_from vinner, sa uppslaget ger ett svar i stallet for att falla.
  return traffar.sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1))[0];
}

// -----------------------------------------------------------------------------
// Rakningen
// -----------------------------------------------------------------------------

/**
 * Har affaren ett utkop?
 *
 * Ett eget predikat i stallet for `!= null` pa nio stallen. NOLL AR INTE ETT
 * UTKOP: villkoret `sales_order_utkop_positivt` i 0060 nekar en nolla i
 * kolumnen, men en klient kan skicka en, och en nolla som slapps igenom hade
 * bytt provisionskalla fran matrisen till 12 % utan att andra nagot tal — en
 * paketorder hade tyst gatt fran 1 500 kr till 1 433 kr.
 */
export function harUtkop(utkop: number | null | undefined): utkop is number {
  return typeof utkop === "number" && Number.isFinite(utkop) && utkop > 0;
}

/**
 * Nettot: det som ar kvar av affaren nar utkopet betalats.
 *
 * TALET GAR ALDRIG UNDER NOLL. Samma linje som `restpost` i
 * `chefsprovision.ts`, och av samma skal: ett negativt netto hade gett en
 * NEGATIV provision, alltsa ett avdrag pa en affar saljaren tecknat. Det ar
 * tvartemot vad provisionen ar till for, och vagen ut ur en affar som gatt
 * back ar en makulering — inte ett minustecken i en lonevy.
 *
 * `sales_order_utkop_ryms` i 0060 nekar redan ett utkop storre an ordervardet,
 * sa raden nas i praktiken bara av en klient som skickar egna tal. Den star
 * anda: en kontroll i databasen skyddar skrivningen, inte forhandsvisningen.
 */
export function nettoEfterUtkop(ordervarde: number, utkop: number | null): number {
  if (!harUtkop(utkop)) return ordervarde;
  const kvar = ordervarde - utkop;
  return kvar > 0 ? kvar : 0;
}

/**
 * Saljarens provision pa en affar med utkop: procenten pa NETTOT.
 *
 * MATRISEN ANVANDS INTE. Bestallarens beslut 2026-09-15 var att satsen ERSATTER
 * paketmatrisen pa en utkopsaffar, inte kommer utover den — sa den har
 * funktionen ar hela saljarens provision for ordern, och `commission_source`
 * blir `buyout`.
 *
 * Skalet ar att de tva annars hade dubbelraknat samma pengar: matrisens 1 500 kr
 * ar redan bolagets andel av ett fullt ordervarde, och pa en affar dar halva
 * vardet gick till att kopa ut kunden finns inte den marginalen.
 *
 * Avrundas till hela kronor har, och bara har. Beloppet fryses pa ordern i nasta
 * steg och gar aldrig genom nagon andra avrundning — samma regel som
 * `egenProvision` i `chefsprovision.ts` foljer.
 */
export function utkopsprovision(sats: Utkopssats, netto: number): number {
  return avrunda((netto * sats.percent) / 100);
}
