/**
 * E13 steg 1: kundorder. Ren logik — inga anrop, inga hemligheter.
 *
 * Samma linje som `raster.ts`, `franvaro.ts` och `lonekostnad.ts`: filen ska ga
 * att prova utan att starta Next. Se `tests/order.mjs`.
 *
 * ===========================================================================
 * INGEN PROVISIONSSATS STAR I DEN HAR FILEN.
 *
 * Sok efter ett tal harunder och du hittar 0, 1, 2, 12 och 100. Nio belopp
 * ligger i `commission_rate` (0034) och skickas in som argument. AC-10.1 kraver
 * att provisionsreglerna ar konfiguration och inte kod, och skalet ar
 * praktiskt: en sats i koden gar varken att andra utan deploy eller att visa
 * for den som ska tjana pengarna.
 *
 * Samma frestelse som 0025 beskriver for skattesatserna, och samma svar.
 * ===========================================================================
 */

import { svensktDatum } from "./klocka.ts";

// -----------------------------------------------------------------------------
// Formen pa det databasen bar. Speglar 0034 utan att veta om databasen.
// -----------------------------------------------------------------------------

export const ORDERSTATUSAR = [
  "utkast",
  "inskickad",
  "signerad",
  "betald",
  "makulerad",
] as const;

export type Orderstatus = (typeof ORDERSTATUSAR)[number];

export const STATUS_ETIKETT: Record<Orderstatus, string> = {
  utkast: "Utkast",
  inskickad: "Väntar på godkännande",
  signerad: "Godkänd",
  betald: "Betald",
  makulerad: "Makulerad",
};

/** Loptiderna som gar att salja. Speglar check-villkoret i 0034. */
export const LOPTIDER = [12, 24, 36] as const;
export type Loptid = (typeof LOPTIDER)[number];

export type Paket = {
  id: number;
  label: string;
  list_price: number;
  sort: number;
  active: boolean;
};

export type Sats = {
  id: string;
  package_id: number;
  term_months: number;
  amount: number;
  valid_from: string;
  valid_to: string | null;
};

export type Order = {
  id: string;
  salesperson_id: string;
  package_id: number;
  term_months: number;
  signed_on: string;
  period_month: string;
  status: Orderstatus;
  is_addon: boolean;
  commission_amount: number | null;
  /**
   * Vad affaren ar vard for bolaget. NULLBART, och det ar inte slarv.
   *
   * Kolumnen kom till 2026-09-09 (0050). Order som godkandes fore det har inget
   * varde och far inget i efterhand — bestallarens beslut. Allt som summerar
   * ordervarde maste darfor tala en nolla utan att pasta att affaren var vardelos;
   * se `ordervarde()` nedan, som raknar antalet saknade varden vid sidan av
   * summan just for att vyn ska kunna saga skillnaden med ord.
   */
  order_value: number | null;
  cancel_period_month: string | null;
};

// -----------------------------------------------------------------------------
// Stegbytena
//
// Listan star ocksa i triggern `sales_order_stegbyte` i 0034, och det ar med
// flit. Koden ritar knapparna, databasen avgor. Provet kor hela matrisen mot
// bada, sa den dag de glider isar faller det — samma losning som
// `nastaSteg()` i rekryteringen fick av samma skal.
// -----------------------------------------------------------------------------

export const OVERGANGAR: Record<Orderstatus, Orderstatus[]> = {
  utkast: ["inskickad", "signerad"],
  inskickad: ["utkast", "signerad"],
  signerad: ["betald", "makulerad"],
  betald: ["makulerad"],
  makulerad: [],
};

export function garOvergang(fran: Orderstatus, till: Orderstatus): boolean {
  return OVERGANGAR[fran].includes(till);
}

/** Ar ordern en levande affar just nu? Anvands till listor och kon, inte till pengar. */
export function raknas(status: Orderstatus): boolean {
  return status === "signerad" || status === "betald";
}

/**
 * Har ordern NAGON GANG godkants? Det ar det har talet pengarna raknas pa.
 *
 * ===========================================================================
 * SKILLNADEN MOT `raknas` ar hela makuleringsmodellen, och den var fel i
 * steg 1 (rattad 2026-08-25 i steg 2).
 *
 * En makulering ar TVA handelser, inte en: ordern gav provision i sin
 * signeringsmanad, och drar tillbaka den i makuleringsmanaden. De tva bokfors
 * i olika manader med flit — det ar det som gor att en stangd period aldrig
 * behover skrivas om.
 *
 * Raknas signeringsbidraget pa `raknas` forsvinner det forsta av de tva i det
 * ogonblick statusen blir `makulerad`, och da uppstar tva fel:
 *
 *   1. En order som signeras OCH makuleras i samma manad gav -1500 i stallet
 *      for 0. Avdraget bokfordes mot ett tillagg som aldrig fanns.
 *   2. En order fran mars som makuleras i augusti fick MARS att raknas om
 *      fran 3000 till 0. Precis det avsnitt 4.4 i specifikationen sager aldrig
 *      far ske: "Mars rors aldrig."
 *
 * `makulerad` naddes alltid via `signerad` — bade stegtriggern i 0034 och
 * villkoret `sales_order_provision_satt` garanterar det — sa statusen ar ett
 * giltigt bevis pa att ordern en gang godkandes.
 * ===========================================================================
 */
export function harGodkants(status: Orderstatus): boolean {
  return status === "signerad" || status === "betald" || status === "makulerad";
}

// -----------------------------------------------------------------------------
// Satsuppslaget
// -----------------------------------------------------------------------------

/**
 * Satsen som gallde vid ett visst datum.
 *
 * Versioneringen ar halva poangen med tabellen: fragan "vilken sats gallde nar
 * ordern skrevs" ar precis den som stalls nar en utbetalning ifragasatts.
 * Uppslaget sker darfor pa SIGNERINGSDATUMET, aldrig pa dagens datum.
 *
 * `valid_to` ar exklusivt: en sats som slutar 2026-09-01 galler till och med
 * den 31 augusti. Halvoppna intervall ar det enda sattet att undvika en dag som
 * antingen tillhor bada raderna eller ingen.
 *
 * Saknas satsen returneras null, aldrig noll. En nolla hade sett ut som en
 * order utan provision i stallet for en konfiguration som inte ar ifylld —
 * samma resonemang som `cost_rate` i 0025.
 */
export function gallandeSats(
  satser: Sats[],
  paket: number,
  loptid: number,
  datum: string,
): Sats | null {
  const traffar = satser.filter(
    (s) =>
      s.package_id === paket &&
      s.term_months === loptid &&
      s.valid_from <= datum &&
      (s.valid_to === null || s.valid_to > datum),
  );

  if (traffar.length === 0) return null;

  // Fler an en trass ar ett konfigurationsfel — det partiella unika indexet i
  // 0034 hindrar tva OPPNA rader, men inte tva overlappande stangda. Nyast
  // valid_from vinner, sa uppslaget ger ett svar i stallet for att falla.
  return traffar.sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1))[0];
}

/** Provisionen for en order enligt matrisen, eller null om satsen saknas. */
export function provisionFor(
  satser: Sats[],
  paket: number,
  loptid: number,
  signeringsdatum: string,
): number | null {
  return gallandeSats(satser, paket, loptid, signeringsdatum)?.amount ?? null;
}

// -----------------------------------------------------------------------------
// Ordervardet
// -----------------------------------------------------------------------------

/**
 * Vad ett paket ar vart over sin avtalstid: manadspriset gange antalet manader.
 *
 * ===========================================================================
 * BESTALLARENS DEFINITION, LAMNAD 2026-09-09. Ett Paket 1 pa tolv manader ar
 * vart 995 x 12 = 11 940 kr, inte 995 kr.
 *
 * Skillnaden ar inte akademisk: ordervardet ar basen for saljchefens overtack,
 * och med manadspriset ensamt hade restposten blivit NEGATIV pa varje paketorder
 * — matrisens lagsta provision ar 1 500 kr och det lagsta manadspriset 995.
 * Overtacket hade da varit noll for alltid, och ingen hade sett varfor.
 * ===========================================================================
 *
 * `list_price` beskrevs i 0034 som ett falt som "anvands inte till nagon
 * berakning". Det stammer inte langre, och kommentaren dar ar ratad i 0050.
 * Priset ar versionerat pa samma satt som allt annat: kolumnen ligger i
 * `sales_package` och andras den, andras kommande ordrars varde — men inte
 * redan godkanda, eftersom vardet FRYSES pa ordern vid godkannandet precis som
 * provisionen.
 */
export function ordervardeFor(manadspris: number, loptid: number): number {
  return manadspris * loptid;
}

/** Ordervardet for ett paket ur paketlistan, eller null nar paketet saknas. */
export function ordervardeForPaket(
  paket: Paket[],
  paketId: number,
  loptid: number,
): number | null {
  const p = paket.find((x) => x.id === paketId);
  return p ? ordervardeFor(p.list_price, loptid) : null;
}

/**
 * Manadens ordervarde: det som tecknats minus det som makulerats.
 *
 * ===========================================================================
 * SAKNADE VARDEN RAKNAS, DE SUMMERAS INTE.
 *
 * En order fran fore 0050 har `order_value = null`. Att lata den bidra med noll
 * ar aritmetiskt riktigt och kommunikativt fel: en manad med tre order varda
 * 40 000 kr och en utan varde ser da ut att ha fyra order varda 40 000 kr, och
 * ingen kan se att talet ar ofullstandigt.
 *
 * Darfor bar svaret bade summan och `utanVarde`. Vyn skriver ut det andra talet
 * nar det ar storre an noll, och da vet lasaren vad summan INTE innehaller.
 * Samma resonemang som `bedomda` bredvid `godkanda` i K&V-utfallet.
 * ===========================================================================
 *
 * Makuleringen dras i MAKULERINGSMANADEN, inte i signeringsmanaden — samma
 * tvahandelsemodell som `grundprovision` foljer, och av samma skal: en stangd
 * period skrivs aldrig om.
 */
export function ordervarde(
  order: Order[],
  manad: string,
): { netto: number; tecknat: number; makulerat: number; utanVarde: number } {
  const in_ = orderIPeriod(order, manad);
  const ut = makuleradeIPeriod(order, manad);

  const summa = (rader: Order[]) => rader.reduce((s, o) => s + (o.order_value ?? 0), 0);
  const saknade = (rader: Order[]) => rader.filter((o) => o.order_value === null).length;

  const tecknat = summa(in_);
  const makulerat = summa(ut);

  return {
    netto: tecknat - makulerat,
    tecknat,
    makulerat,
    utanVarde: saknade(in_) + saknade(ut),
  };
}

// -----------------------------------------------------------------------------
// Perioden
// -----------------------------------------------------------------------------

/**
 * Ordrarna som raknas for en manad.
 *
 * En order hor till manaden den SIGNERADES i. Godkannandet kan komma senare och
 * flyttar ingenting — det ar hela skalet till att `period_month` ar en genererad
 * kolumn ur `signed_on` i databasen.
 *
 * EN MAKULERAD ORDER LIGGER KVAR HAR. Se `harGodkants`: makuleringen ar ett
 * eget avdrag i sin egen manad, inte ett suddgummi over signeringsmanaden.
 */
export function orderIPeriod(order: Order[], manad: string): Order[] {
  return order.filter((o) => harGodkants(o.status) && o.period_month === manad);
}

/**
 * Makuleringarna som belastar en manad.
 *
 * MAKULERINGEN BOKFORS I MAKULERINGSMANADEN, inte i signeringsmanaden.
 * Bestallarens beslut 2026-08-24: en order fran mars som makuleras i augusti
 * river augusti. Skalet ar att marsperioden ar stangd och utbetald, och en
 * stangd period skrivs inte om.
 */
export function makuleradeIPeriod(order: Order[], manad: string): Order[] {
  return order.filter((o) => o.status === "makulerad" && o.cancel_period_month === manad);
}

/**
 * Antalet order som volymtrappan raknar pa: signerade i manaden minus de som
 * makulerats i manaden.
 *
 * TALET KAN BLI NEGATIVT, och det ar avsiktligt. Makuleras fler order an som
 * tecknats blir manadens ordersaldo minus. Bonusnivan blir da noll — den blir
 * aldrig negativ — men provisionsavdraget sker anda, och det ar ratt: pengarna
 * ska tillbaka. Se `nivaFor` i steg 3.
 */
export function nettoAntal(order: Order[], manad: string): number {
  return orderIPeriod(order, manad).length - makuleradeIPeriod(order, manad).length;
}

/**
 * Grundprovisionen for en manad: det som signerats minus det som makulerats.
 *
 * Beloppet tas fran ORDERN och inte ur matrisen. Ordern bar den frusna satsen
 * (0034), sa en sats som andras i november andrar inte vad nagon tjanade i
 * augusti.
 */
export function grundprovision(order: Order[], manad: string): number {
  const in_ = orderIPeriod(order, manad).reduce((s, o) => s + (o.commission_amount ?? 0), 0);
  const ut = makuleradeIPeriod(order, manad).reduce((s, o) => s + (o.commission_amount ?? 0), 0);
  return in_ - ut;
}

/** Manaderna som har nagon rorelse, nyast forst. */
export function manaderMedOrder(order: Order[]): string[] {
  const alla = new Set<string>();
  for (const o of order) {
    if (harGodkants(o.status)) alla.add(o.period_month);
    if (o.cancel_period_month) alla.add(o.cancel_period_month);
  }
  return [...alla].sort().reverse();
}

// -----------------------------------------------------------------------------
// Inmatning
// -----------------------------------------------------------------------------

/**
 * Organisationsnummer, normaliserat till NNNNNN-NNNN.
 *
 * K27-UNDANTAGET: en enskild firma har personnummer som organisationsnummer.
 * Formatet gar darfor inte att neka, till skillnad fran i `contract.variables`
 * (0028). Undantaget star i DECISIONS.md och foljden ar att numret aldrig far
 * hamna i den globala sokningen.
 *
 * Tio siffror kravs. Ett tolvsiffrigt nummer med sekel kortas till tio — den
 * som klistrar in fran ett register ska inte motas av ett formatfel.
 */
export function normaliseraOrgnr(text: string): string | null {
  const siffror = text.replace(/\D/g, "");
  const tio = siffror.length === 12 ? siffror.slice(2) : siffror;
  if (tio.length !== 10) return null;
  return `${tio.slice(0, 6)}-${tio.slice(6)}`;
}

/**
 * Telefonnummer. Avsiktligt tillatande: siffror, mellanslag, bindestreck,
 * plustecken och parenteser, minst sju siffror.
 *
 * En strangare kontroll hade nekat vaxelnummer och utlandska nummer, och det ar
 * kundens nummer — inte ett falt navet raknar pa.
 */
export function giltigTelefon(text: string): boolean {
  const rensat = text.trim();
  if (!/^[+\d][\d\s\-()]*$/.test(rensat)) return false;
  return rensat.replace(/\D/g, "").length >= 7;
}

/**
 * Ar signeringsdatumet giltigt och inte i framtiden?
 *
 * Framtida signering nekas av samma skal som `giltigManad` nekar framtida
 * manader i provisionen: en order som signeras nasta manad ar inte en intjaning
 * utan en prognos, och de tva ska inte kunna blandas i samma tabell.
 */
export function giltigtSigneringsdatum(datum: string, nu: Date | string = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return false;

  // Dagen raknas i SVENSK tid, inte serverns. Pa Vercel star servern i UTC, och
  // den 1:a klockan 00:30 svensk tid hade da lasts som den 31:e — vilket bade
  // hade slappt igenom ett framtida datum och lagt ordern i fel manad. Hela
  // bakgrunden star i `klocka.ts`.
  return datum <= svensktDatum(nu);
}

/** Manaden ordern hor till, ur signeringsdatumet. Speglar den genererade kolumnen. */
export function periodFor(signeringsdatum: string): string {
  return `${signeringsdatum.slice(0, 7)}-01`;
}

// -----------------------------------------------------------------------------
// Order som hinner bli godkand for sent
// -----------------------------------------------------------------------------

/**
 * Hor ordern till en period som redan ar faststalld?
 *
 * ===========================================================================
 * EDGE CASE 5.6, OCH DEN HANDE PA RIKTIGT 2026-09-08.
 *
 * En order signerad 25 augusti godkandes den 8 september, tva timmar efter att
 * augusti faststallts. Ordern hor till augusti — perioden bestams av
 * signeringsdatumet (3.4) — och augusti var rakad och last.
 *
 * Foljden var att 6 500 kr intjanade och godkanda kronor ALDRIG kom med i
 * nagon lonekorning. `faststallPeriod` vagrar kora om en stangd manad, och
 * nagon annan vag in i huvudboken finns inte. Ingenting sa ifran.
 *
 * DEN HAR FUNKTIONEN AR INTE EN SPARR. Att neka godkannandet hade varit fel
 * svar: ordern ar en riktig affar, och en affar som inte gar att registrera
 * forsvinner inte — den blir ett mejl till nagon i stallet. Se O11 och
 * avsnitt 5.6: forslaget ar att provisionen bokfors i den OPPNA perioden med
 * en anteckning om att den hor till augusti, eftersom en stangd period aldrig
 * oppnas.
 *
 * Funktionen svarar alltsa pa "behover den har ordern den behandlingen", och
 * anroparen — `godkannOrder` — gor det som ska goras.
 * ===========================================================================
 */
export function harStangdPeriod(
  signeringsdatum: string,
  stangdaManader: Iterable<string>,
): boolean {
  const manad = periodFor(signeringsdatum);
  for (const m of stangdaManader) if (m === manad) return true;
  return false;
}
