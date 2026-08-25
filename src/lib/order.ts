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
