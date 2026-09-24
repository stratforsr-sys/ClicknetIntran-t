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
  /**
   * Nar avtalet BORJAR galla (0068).
   *
   * Skild fran `signed_on` med flit, och skillnaden ar inte kosmetisk: ett avtal
   * signeras ofta innan det borjar loepa — driftstarten ligger nagra veckor
   * fram, eller forlangningen tecknas medan det gamla avtalet an galler.
   *
   * `signed_on` avgor vilken MANAD affaren hor till och nar provisionen betalas.
   * `starts_on` avgor nar avtalet TAR SLUT. Tva olika fragor som fram till 0068
   * delade pa ett datum eftersom ingen stallt den andra.
   */
  starts_on: string;
  /** Genererad i databasen ur `starts_on + term_months`. Aldrig skriven. */
  ends_on: string;
  /** Vad kunden betalar per manad, fryst pa ordern vid godkannandet (0068). */
  monthly_amount: number | null;
  /**
   * Vad som hande nar avtalet narmade sig sitt slut, eller null om ingen tagit
   * stallning an. Det ar NULL som halls bevakningen tand — se `bevakas()`.
   */
  renewal_outcome: "forlangd" | "avslutad" | null;
  /** Ordern som forlangningen blev. Bara satt nar utfallet ar `forlangd`. */
  renewal_order_id?: string | null;
  /** Varfor kunden inte forlangde. Kravs av databasen nar utfallet ar `avslutad`. */
  renewal_reason?: string | null;
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
  /**
   * Utkopet: det som gick ur affaren till att losa kunden ur ett gammalt avtal.
   *
   * NULL NAR INGET UTKOP FINNS, aldrig noll. Skillnaden ar densamma som
   * `order_value` gor mellan "vardet ar noll" och "vardet ar inte ifyllt" — en
   * nolla hade last som "vi kopte ut kunden for ingenting".
   *
   * Talet dras fran ordervardet innan bade saljarens provision och saljchefens
   * overtack raknas. Se `utkop.ts` for rakningen och 0060 for kolumnen.
   */
  buyout_amount?: number | null;
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
 *
 * ===========================================================================
 * UTKOPEN DRAS AV, OCH DE STAR OCKSA FOR SIG (0060).
 *
 * `tecknat` ar BRUTTO — vad kunderna tecknat — och `netto` ar vad bolaget fick
 * behalla: tecknat minus makulerat minus utkop. Bada behovs, och det ar samma
 * resonemang som `utanVarde` foljer: en manad dar 40 000 kr tecknats och
 * 12 000 kr gick till att kopa ut kunder ar inte samma manad som en dar 28 000
 * tecknats, och ett enda tal kan inte saga bada sakerna.
 *
 * MAKULERINGENS UTKOP DRAS OCKSA TILLBAKA. En makulerad affar tar bade sitt
 * ordervarde och sitt utkop ur manaden — annars hade avdraget varit for stort,
 * eftersom bruttot gick in men bara nettot kom bolaget till del.
 * ===========================================================================
 */
export function ordervarde(
  order: Order[],
  manad: string,
): {
  netto: number;
  tecknat: number;
  makulerat: number;
  utanVarde: number;
  utkop: number;
} {
  const in_ = orderIPeriod(order, manad);
  const ut = makuleradeIPeriod(order, manad);

  const summa = (rader: Order[]) => rader.reduce((s, o) => s + (o.order_value ?? 0), 0);
  const saknade = (rader: Order[]) => rader.filter((o) => o.order_value === null).length;
  const utkopen = (rader: Order[]) => rader.reduce((s, o) => s + (o.buyout_amount ?? 0), 0);

  const tecknat = summa(in_);
  const makulerat = summa(ut);
  const utkop = utkopen(in_) - utkopen(ut);

  return {
    netto: tecknat - makulerat - utkop,
    tecknat,
    makulerat,
    utanVarde: saknade(in_) + saknade(ut),
    utkop,
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
 * Kundens mejladress. Avsiktligt tillatande, av samma skal som `giltigTelefon`.
 *
 * Nagot fore ett @, nagot efter, en punkt i domanen och inga blanktecken. En
 * strangare regel nekar riktiga adresser — plustecken, underdoman, nya
 * toppdomaner — och vinner ingenting: navet skickar inga brev hit, det ar en
 * uppgift OM kunden. Samma villkor star som `sales_order_mejlform` i 0060, sa
 * att en klient som gar forbi formularet moter samma grans.
 *
 * TOMT AR GILTIGT och hanteras av anroparen. Adressen ar frivillig — order fran
 * fore 2026-09-15 har ingen, och ett krav hade gjort varje gammal order
 * orattbar.
 */
export function giltigMejl(text: string): boolean {
  const rensat = text.trim();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rensat);
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

// -----------------------------------------------------------------------------
// Avtalsslutet
//
// =============================================================================
// DE TVA TALEN HAR ALLTID FUNNITS. INGEN HAR RAKNAT MED DEM.
//
// `signed_on` och `term_months` har statt i `sales_order` sedan 0034, och
// tillsammans sager de nar kundens avtal tar slut. Ingen vy, ingen notis och
// ingen fraga har stallt den fragan — sa en kund vars avtal loepte ut gjorde det
// tyst, och samtalet som hade kunnat forlanga det ringdes aldrig.
//
// Bestallaren 2026-09-24: *"vi maste fa notifikation pa varje kunds avtal som
// loeper ut sa att vi kan ringa dem och forlanga dem"*. Funktionerna harunder ar
// den meningen, och de bor har — i den importfria filen — av samma skal som
// resten: rakningen ska ga att prova utan att starta Next, och klienten,
// servern och notisen ska tala samma tal.
// =============================================================================
// -----------------------------------------------------------------------------

/** Ramen for en bindningstid. Speglar `sales_order_bindningstid` i 0068. */
export const BINDNINGSTID_MIN = 1;
export const BINDNINGSTID_MAX = 60;

/**
 * Sa lange innan avtalet tar slut som navet borjar saga till.
 *
 * Nittio dagar ar bestallarens val 2026-09-24, och det ar en forhandlingstid
 * och inte en paminnelsetid: kunden ska hinna fa ett samtal, tanka efter och
 * skriva pa innan det gamla avtalet loper ut. En kortare frist hade gjort varje
 * forlangning till en bradska.
 */
export const AVTALSSLUT_VARSEL_DAGAR = 90;

/** Ar bindningstiden inom ramen? Samma grans som databasen drar. */
export function giltigBindningstid(manader: number): boolean {
  return Number.isInteger(manader) && manader >= BINDNINGSTID_MIN && manader <= BINDNINGSTID_MAX;
}

/**
 * Datumet ett avtal tar slut: startdatumet plus antalet manader.
 *
 * ===========================================================================
 * MANADSSKIFTET KLIPPS, DET SPILLER INTE OVER.
 *
 * Ett avtal som borjar 31 januari och loper en manad tar slut 28 februari, inte
 * 3 mars. Det ar vad Postgres `make_interval` gor i den genererade kolumnen
 * `ends_on` (0068), och JavaScripts `setMonth` gor tvartom: den spiller over
 * till nasta manad.
 *
 * Skillnaden ar tre dagar, en gang om aret, pa ett falt som styr nar nagon
 * ringer en kund — och den hade synts som att klienten och databasen sa olika
 * saker om samma avtal. Klippningen nedan ar darfor inte en detalj utan hela
 * skalet till att funktionen inte ar en rad.
 * ===========================================================================
 */
export function avtalsslut(startdatum: string, manader: number): string {
  const [ar, manad, dag] = startdatum.split("-").map(Number);

  // Manadsraekningen gors pa tal och inte pa ett Date, sa att ingen tidszon far
  // rora resultatet. `klocka.ts` beskriver samma fallgrop for dygnen.
  const totalt = (ar * 12 + (manad - 1)) + manader;
  const nyttAr = Math.floor(totalt / 12);
  const nyManad = (totalt % 12) + 1;

  // Sista dagen i malmanaden. Dag 0 i nasta manad ar sista dagen i den har —
  // och `Date.UTC` med manad 12 rullar over aret av sig sjalvt.
  const sistaDagen = new Date(Date.UTC(nyttAr, nyManad, 0)).getUTCDate();
  const nyDag = Math.min(dag, sistaDagen);

  return `${String(nyttAr).padStart(4, "0")}-${String(nyManad).padStart(2, "0")}-${String(nyDag).padStart(2, "0")}`;
}

/**
 * Antalet dygn fran i dag till ett datum. Negativt nar datumet passerat.
 *
 * Bada datumen tolkas mitt pa dagen i UTC, av samma skal som `sjuk-frist`
 * raknar likadant: klockan tolv ar tolv timmar fran bada dygnsgranserna, sa
 * sommartid kan inte gora ett dygn till noll eller tva.
 */
export function dagarTill(datum: string, idag: string): number {
  const till = Date.parse(`${datum}T12:00:00Z`);
  const fran = Date.parse(`${idag}T12:00:00Z`);
  return Math.round((till - fran) / 86_400_000);
}

/**
 * Ska avtalet synas i bevakningen i dag?
 *
 * ===========================================================================
 * ETT AVTAL SOM REDAN LOPT UT STAR KVAR I LISTAN, och det ar ett val.
 *
 * Frestelsen ar att sluta tjata nar datumet passerat — posten har ju "gatt ut".
 * Men det ar tvartom da den betyder mest: kunden ar fortfarande kund, och det
 * enda som hant ar att ingen ringde i tid. Slocknade posten pa slutdatumet hade
 * bevakningen varit tystast precis nar den behovdes.
 *
 * Det som slacker posten ar ett UTFALL — nagon har ringt, och kunden har
 * antingen skrivit pa igen eller sagt nej. Se `renewal_outcome` i 0068.
 * ===========================================================================
 */
export function bevakas(slutdatum: string | null, hanterad: boolean, idag: string): boolean {
  if (!slutdatum || hanterad) return false;
  return dagarTill(slutdatum, idag) <= AVTALSSLUT_VARSEL_DAGAR;
}

// -----------------------------------------------------------------------------
// Tillaggstjansterna
// -----------------------------------------------------------------------------

/** Engangsavgift eller manadsavgift. Speglar `billing` i 0068. */
export const FAKTURERING = ["engang", "manad"] as const;
export type Fakturering = (typeof FAKTURERING)[number];

export const FAKTURERING_ETIKETT: Record<Fakturering, string> = {
  engang: "Engångsavgift",
  manad: "Månadsavgift",
};

/**
 * En tillaggstjanst pa en order.
 *
 * `follows_order` ar sant nar tjansten loper precis som huvudavtalet. Da star
 * `term_months` och `starts_on` tomma — se villkoren i 0068 for varfor de inte
 * far vara ifyllda samtidigt.
 */
export type Tjanst = {
  name: string;
  billing: Fakturering;
  amount: number;
  follows_order: boolean;
  term_months: number | null;
  starts_on: string | null;
};

/**
 * Vad en tjanst ar vard over sin avtalstid.
 *
 * ===========================================================================
 * EN ENGANGSAVGIFT GANGES INTE MED NAGOT.
 *
 * Bestallarens form 2026-09-24: manadstjansten skrivs som ett MANADSBELOPP och
 * vardet raknas — samma form som huvudordern. Engangsavgiften ar daremot redan
 * hela summan.
 *
 * Skrivs de tva likadant blir en installationsavgift pa 4 000 kr vard 96 000 kr
 * pa ett tvaarsavtal, och det talet gar rakt in i provisionsunderlaget. Det ar
 * darfor `billing` ar ett krav pa raden och inte en etikett i vyn.
 * ===========================================================================
 *
 * `orderLoptid` anvands bara av en manadstjanst som FOLJER huvudordern. En
 * tjanst med egen bindningstid raknar pa sin egen.
 */
export function tjanstensVarde(tjanst: Tjanst, orderLoptid: number): number {
  if (tjanst.billing === "engang") return tjanst.amount;
  const manader = tjanst.follows_order ? orderLoptid : (tjanst.term_months ?? 0);
  return tjanst.amount * manader;
}

/**
 * Nar tjansten tar slut, eller null nar den inte kan ta slut.
 *
 * En engangsavgift har inget slut — den ar betald och over. En tjanst som
 * foljer huvudordern tar slut nar ORDERN gor det, och far darfor inte en egen
 * post i bevakningen; det ar huvudordern som bevakas. Bara en manadstjanst med
 * EGEN bindningstid svarar med ett eget datum har.
 */
export function tjanstensSlut(tjanst: Tjanst): string | null {
  if (tjanst.billing !== "manad") return null;
  if (tjanst.follows_order) return null;
  if (!tjanst.starts_on || !tjanst.term_months) return null;
  return avtalsslut(tjanst.starts_on, tjanst.term_months);
}

/**
 * Hela affarens varde: huvudavtalet plus tjansterna.
 *
 * ===========================================================================
 * TJANSTERNA RAKNAS IN, OCH DET AR ETT BESTALLARBESLUT 2026-09-24.
 *
 * Fragan stalldes uttryckligen — raknas tillaggstjansternas varde in i orderns
 * varde och provision? — och svaret var ja: *"en saljare som saljer en tjanst
 * till ska fa betalt for den"*.
 *
 * Foljden ar att den har funktionen ar en PENGAFUNKTION. Talet den svarar med
 * gar in i `order_value`, som ar basen for bade saljarens provision och
 * saljchefens overtack, och som fryses pa ordern vid godkannandet. Den ar
 * darfor enda stallet summeringen gors — klientens forhandsvisning och serverns
 * framrakning anropar bada den, precis som `ordervardeFor` och `nettoEfterUtkop`
 * redan delas.
 * ===========================================================================
 */
export function affarensVarde(
  manadsbelopp: number,
  loptid: number,
  tjanster: Tjanst[] = [],
): number {
  const grund = ordervardeFor(manadsbelopp, loptid);
  return tjanster.reduce((summa, t) => summa + tjanstensVarde(t, loptid), grund);
}
