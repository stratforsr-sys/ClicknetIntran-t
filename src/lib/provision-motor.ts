/**
 * E13 steg 2: raknemotorn.
 *
 * Ren logik — inga anrop, inga hemligheter, ingen import av Supabase. Samma
 * linje som `raster.ts`, `lonekostnad.ts` och `order.ts`: motorn ska ga att
 * prova utan att starta Next. Se `tests/provision-motor.mjs`.
 *
 * ===========================================================================
 * MOTORN RETURNERAR ETT UNDERLAG, INTE ETT TAL.
 *
 * Bestallarens krav (PROVISION_SPEC.md avsnitt 12): bade saljaren och chefen
 * ska kunna se VARFOR en summa blev som den blev. En funktion som svarar
 * `12400` gar inte att ifragasatta och darmed inte att lita pa — den forsta
 * gangen nagon tycker att siffran ar fel finns det ingenting att peka pa.
 *
 * Darfor ar `Underlag.rader` det egentliga svaret och `summa` bara deras
 * summa. Vyn VISAR raderna. Den raknar aldrig om nagot sjalv, och den lagger
 * aldrig till en post som motorn inte kanner till.
 * ===========================================================================
 *
 * INGEN SATS OCH INGET BONUSBELOPP STAR I DEN HAR FILEN.
 *
 * Sok efter ett tal harunder och du hittar 0, 1 och 2. Grundprovisionen ligger
 * frusen pa ordern (0034), och bonusniverna kommer i steg 3 som argument.
 * AC-10.1 kraver att provisionsreglerna ar konfiguration och inte kod.
 */

import {
  grundprovision,
  makuleradeIPeriod,
  orderIPeriod,
  type Order,
} from "./order.ts";

// -----------------------------------------------------------------------------
// Underlaget
// -----------------------------------------------------------------------------

/**
 * Slagen av rader ett underlag kan bara.
 *
 * `volymbonus`, `kv_bonus`, `ovrig_bonus` och `avdrag` fylls av steg 3, 5 och
 * 6. De star med redan nu for att vyn och periodstangningen ska kunna skrivas
 * mot en form som inte andrar sig under fotterna pa dem — en rad som byter
 * namn efter att den bokforts i `commission_entry` gor historiken olasbar.
 */
export const RADSLAG = [
  "order",
  "makulering",
  "volymbonus",
  "kv_bonus",
  "ovrig_bonus",
  "avdrag",
] as const;

export type Radslag = (typeof RADSLAG)[number];

export type Underlagsrad = {
  slag: Radslag;
  /** Vad raden ar, pa svenska. Samma text i vyn, i exporten och i huvudboken. */
  text: string;
  /** Signerat. Ett avdrag ar ett negativt belopp, aldrig ett positivt med flagga. */
  belopp: number;
  /** Ordern raden kommer ur, nar den kommer ur en order. */
  order_id?: string;
};

export type Underlag = {
  employee_id: string;
  manad: string;

  /** Hela svaret. `summa` ar deras summa och ingenting mer. */
  rader: Underlagsrad[];

  /**
   * Ordervolymen manaden raknas pa.
   *
   * `netto` kan bli NEGATIVT och det ar avsiktligt — makuleras fler order an
   * som tecknats i manaden ar saldot minus. Volymtrappan i steg 3 ger da niva
   * noll, aldrig en negativ niva, men provisionsavdraget sker anda.
   */
  antal: { signerade: number; makulerade: number; netto: number };

  grundprovision: number;

  /** Nivan manaden landade pa, eller null nar den lagsta troskeln inte natts. */
  volymbonus: { niva: Bonusniva; belopp: number } | null;

  /**
   * Nasta niva och hur langt dit. Prognosen i saljarens progressvy.
   *
   * Star med i UNDERLAGET och inte bara i vyn for att den ska raknas ur samma
   * trappa som bonusen. En "kvar till nasta niva" som vyn raknar fram sjalv ar
   * en andra tolkning av trappan, och den dagen de sager olika saker ar det
   * inte uppenbart vilken som har ratt.
   */
  nasta: { niva: Bonusniva; kvar: number } | null;

  summa: number;
};

// -----------------------------------------------------------------------------
// Avrundning
// -----------------------------------------------------------------------------

/**
 * Hela kronor, matematiskt.
 *
 * `Math.round` ensamt duger inte: den avrundar mot plus oandligheten, sa
 * -0,5 blir -0 i stallet for -1. Halvor ska ga BORT fran nollan at bada hallen,
 * annars ar ett avdrag pa 1500,50 kr systematiskt snallare mot bolaget an ett
 * tillagg pa lika mycket.
 *
 * AVRUNDA EN GANG, PA DEN FARDIGA RADEN (avsnitt 5.4). Aldrig per order pa
 * vagen: trettio orebelopp som avrundas var for sig blir upp till trettio
 * kronors avvikelse mot samma tal avrundat till sist.
 */
export function avrunda(belopp: number): number {
  return belopp < 0 ? -Math.round(-belopp) : Math.round(belopp);
}

/** Summan av rader. Det enda satt en summa far raknas fram pa. */
export function summaAv(rader: Underlagsrad[]): number {
  return rader.reduce((s, r) => s + r.belopp, 0);
}

// -----------------------------------------------------------------------------
// Radtexterna
//
// Texten byggs har och inte i vyn. Skalet ar att samma rad hamnar pa tre
// stallen — saljarens vy, chefens export och `commission_entry.note` nar
// perioden stangs — och tre formuleringar av samma post ar tre tillfallen att
// tro att de ar olika poster.
// -----------------------------------------------------------------------------

function ordertext(o: Order): string {
  const tillagg = o.is_addon ? ", tillägg" : "";
  return `Order ${o.signed_on}, paket ${o.package_id}, ${o.term_months} mån${tillagg}`;
}

function makuleringstext(o: Order): string {
  return `Makulerad order, tecknad ${o.signed_on}`;
}

// -----------------------------------------------------------------------------
// Volymtrappan — steg 3
//
// INGET BELOPP OCH INGEN NIVA STAR I DEN HAR FILEN. Trapporna 5/10/15/20/25/30
// och deras belopp ar rader i `commission_bonus_level` (0035) och kommer hit som
// argument. Ingenting seedas: en gissad bonus ser ratt ut och blir tyst sanning,
// samma resonemang som tackningsgraden i 0025.
// -----------------------------------------------------------------------------

export const BONUSENHETER = ["amount_fixed", "percent", "amount_per_order"] as const;
export type Bonusenhet = (typeof BONUSENHETER)[number];

export type Bonusniva = {
  id: string;
  /** Antalet order som kravs. 5, 10, 15 ... */
  threshold: number;
  amount: number;
  unit: Bonusenhet;
  valid_from: string;
  valid_to: string | null;
};

/**
 * Trappan som galler for en MANAD.
 *
 * ===========================================================================
 * UPPSLAGET SKER PA MANADENS FORSTA DAG, inte pa orderns signeringsdatum.
 *
 * Skillnaden mot `gallandeSats` i `order.ts` ar avsiktlig och foljer av vad de
 * tva ar. Provisionssatsen ar en egenskap hos EN ORDER och slas darfor upp pa
 * den orderns datum. Volymbonusen ar en egenskap hos HELA MANADEN — nivan
 * bestams av manadens samlade ordervolym — och en trappa som byter form mitt i
 * manaden gar darfor inte att tillampa "per order" utan att bli obegriplig.
 *
 * Det gor ocksa bestallarens tre val i avsnitt 8.1 entydiga:
 *
 *   "Galler allt intjanat denna manad"  -> valid_from = den 1:a  -> slar igenom nu
 *   "Galler fran och med nu"            -> valid_from = i dag    -> slar igenom nasta manad
 *   "Galler fran och med nasta manad"   -> valid_from = nasta 1:a -> slar igenom nasta manad
 *
 * De tva sista sammanfaller mitt i en manad och skiljer sig den 1:a, vilket ar
 * ratt: den som andrar trappan pa forsta dagen menar den manaden.
 *
 * Regeln star inte i specifikationen — den var inte stalld. Se O16.
 * ===========================================================================
 */
export function gallandeNivaer(nivaer: Bonusniva[], manad: string): Bonusniva[] {
  return nivaer
    .filter((n) => n.valid_from <= manad && (n.valid_to === null || n.valid_to > manad))
    .sort((a, b) => a.threshold - b.threshold);
}

/**
 * Nivan ett antal order nar.
 *
 * Den HOGSTA troskel raknaren natt eller passerat (avsnitt 5.2). Under den
 * lagsta troskeln finns ingen niva — `null`, aldrig en niva med beloppet noll.
 *
 * NIVAN BLIR ALDRIG NEGATIV. Ett negativt ordersaldo — fler makuleringar an
 * order i manaden — ger ingen niva alls. Provisionsavdraget sker anda; det ar
 * grundprovisionen som bar det, inte bonusen.
 *
 * `nivaer` forvantas redan vara filtrerad genom `gallandeNivaer`.
 */
export function nivaFor(nivaer: Bonusniva[], antal: number): Bonusniva | null {
  const natta = nivaer.filter((n) => antal >= n.threshold);
  if (natta.length === 0) return null;
  return natta.reduce((hogst, n) => (n.threshold > hogst.threshold ? n : hogst));
}

/**
 * Nasta niva och hur langt dit. Underlaget till "3 order kvar till nasta bonus"
 * i saljarens progressvy (avsnitt 9.1).
 *
 * `null` nar trappan ar slut — over 30 star den still (avsnitt 5.3), och da ar
 * ratt svar i vyn att det inte finns nagon nasta niva, inte en nolla som ser ut
 * som "du ar framme".
 */
export function kvarTillNasta(
  nivaer: Bonusniva[],
  antal: number,
): { niva: Bonusniva; kvar: number } | null {
  const kommande = nivaer.filter((n) => n.threshold > antal).sort((a, b) => a.threshold - b.threshold);
  if (kommande.length === 0) return null;
  return { niva: kommande[0], kvar: kommande[0].threshold - antal };
}

/**
 * Bonusbeloppet for en niva. OAVRUNDAT — avrundningen sker en gang, pa den
 * fardiga raden (avsnitt 5.4).
 *
 * RETROAKTIVITETEN LIGGER HAR (avsnitt 5.2): bonusen pa en uppnadd niva galler
 * SAMTLIGA order i perioden, inte bara de over troskeln. Nas niva 10 far alla
 * tio orderna niva 10:s belopp — darfor multipliceras `amount_per_order` med
 * hela `antal` och inte med antalet over troskeln.
 */
export function volymbonusBelopp(
  niva: Bonusniva,
  antal: number,
  grundprovision: number,
): number {
  switch (niva.unit) {
    case "amount_fixed":
      return niva.amount;
    case "percent":
      return (grundprovision * niva.amount) / 100;
    case "amount_per_order":
      return niva.amount * antal;
  }
}

// -----------------------------------------------------------------------------
// Motorn
// -----------------------------------------------------------------------------

/** Orderna som hor till en person. */
export function forSaljare(order: Order[], employee_id: string): Order[] {
  return order.filter((o) => o.salesperson_id === employee_id);
}

/**
 * Underlaget for en person och en manad.
 *
 * `order` far garna vara hela materialet — motorn plockar sjalv ut personens
 * rader och manadens. Skalet ar att chefens vy hamtar allas order i en fraga,
 * och ett filter som anroparen ansvarar for ar ett filter nagon glommer.
 *
 * TVA HANDELSER, INTE EN. En makulerad order bidrar bade i sin
 * SIGNERINGSMANAD (plus) och i sin MAKULERINGSMANAD (minus). Det ar det som
 * gor att en stangd period aldrig behover skrivas om — se `harGodkants` i
 * `order.ts` for felet som uppstar nar de tva blandas ihop.
 */
export function raknaUnderlag(
  employee_id: string,
  order: Order[],
  manad: string,
  nivaer: Bonusniva[] = [],
): Underlag {
  const mina = forSaljare(order, employee_id);

  const signerade = orderIPeriod(mina, manad);
  const makulerade = makuleradeIPeriod(mina, manad);

  const rader: Underlagsrad[] = [
    ...signerade.map((o) => ({
      slag: "order" as const,
      text: ordertext(o),
      // Beloppet tas fran ORDERN, inte ur matrisen. Ordern bar den frusna
      // satsen (0034), sa en sats som andras i november andrar inte vad nagon
      // tjanade i augusti. `?? 0` nas aldrig — villkoret
      // `sales_order_provision_satt` kraver ett belopp fran och med `signerad`
      // — men en tyst nolla ar battre an ett kastat fel i en lonevy.
      belopp: o.commission_amount ?? 0,
      order_id: o.id,
    })),
    ...makulerade.map((o) => ({
      slag: "makulering" as const,
      text: makuleringstext(o),
      belopp: -(o.commission_amount ?? 0),
      order_id: o.id,
    })),
  ];

  const antal = {
    signerade: signerade.length,
    makulerade: makulerade.length,
    netto: signerade.length - makulerade.length,
  };

  // Samma tal som orderraderna ger. Det star som eget falt for att
  // procentbonusen raknas PA det, och for att en avvikelse mellan de tva ar ett
  // fel som ska ga att se — provet kontrollerar att de aldrig glider isar.
  const grund = grundprovision(mina, manad);

  const trappa = gallandeNivaer(nivaer, manad);
  const niva = nivaFor(trappa, antal.netto);

  const volymbonus = niva
    ? { niva, belopp: avrunda(volymbonusBelopp(niva, antal.netto, grund)) }
    : null;

  if (volymbonus) {
    rader.push({
      slag: "volymbonus",
      text: `Volymbonus nivå ${volymbonus.niva.threshold}, ${antal.netto} order`,
      belopp: volymbonus.belopp,
    });
  }

  return {
    employee_id,
    manad,
    rader,
    antal,
    grundprovision: grund,
    volymbonus,
    nasta: kvarTillNasta(trappa, antal.netto),
    summa: summaAv(rader),
  };
}

/**
 * Underlag for samtliga saljare med rorelse i manaden. Chefens vy.
 *
 * Ordningen ar id-ordning och inte beloppsordning: en lista som sorterar
 * personer efter vad de tjanat blir en rangordning, och det ar inte vad vyn
 * ar till for. Sortering pa namn gors av vyn, som ar den som har namnen.
 */
export function underlagForAlla(
  order: Order[],
  manad: string,
  nivaer: Bonusniva[] = [],
): Underlag[] {
  const personer = new Set<string>();
  for (const o of [...orderIPeriod(order, manad), ...makuleradeIPeriod(order, manad)]) {
    personer.add(o.salesperson_id);
  }

  return [...personer].sort().map((id) => raknaUnderlag(id, order, manad, nivaer));
}

// -----------------------------------------------------------------------------
// Bokforingen — det underlaget blir nar perioden stangs
//
// ===========================================================================
// EN OPPEN PERIOD RAKNAS LIVE. EN STANGD PERIOD AR BOKFORD.
//
// Avsnitt 5.5 i specifikationen, och skalet ar att bada svaren behovs:
//
//   Oppen manad  — bonusen andrar sig hela tiden. Order elva hojer bonusen pa
//                  order ett till tio. Vyn maste darfor rakna om varje gang
//                  nagon tittar, annars visar den fel tal.
//   Stangd manad — siffran maste sta stilla. Raknas den om ur konfigurationen
//                  andrar en ny bonusniva vad nagon fick betalt i augusti.
//
// Bokforingen ar overgangen mellan de tva. Efter den ar `commission_entry`
// sanningen om manaden och motorn rors aldrig mer for den.
// ===========================================================================
// -----------------------------------------------------------------------------

export type Bokforingspost = {
  slag: Radslag;
  belopp: number;
  /** `commission_entry.deals`. Null nar antalet inte betyder nagot for posten. */
  antal: number | null;
  text: string;
};

/**
 * Underlaget som poster i huvudboken. En post per slag, inte en per order.
 *
 * Skalet ar att huvudboken ar en HUVUDBOK: den svarar pa vad som bokforts, och
 * orderraderna finns redan i `sales_order` med sina egna id:n. Att kopiera dit
 * dem hade gett tva stallen som bada pastar sig veta vad manaden bestod av.
 *
 * NOLLPOSTER HOPPAS OVER. En bokford nolla ar ingen upplysning, och i en
 * append-only tabell gar den inte att stada bort efterat.
 */
export function bokforingsposter(u: Underlag): Bokforingspost[] {
  const poster: Bokforingspost[] = [];

  const av = (slag: Radslag) => u.rader.filter((r) => r.slag === slag);

  const order = av("order");
  if (order.length > 0) {
    poster.push({
      slag: "order",
      belopp: summaAv(order),
      antal: u.antal.signerade,
      text: `Grundprovision, ${u.antal.signerade} order`,
    });
  }

  const makulering = av("makulering");
  if (makulering.length > 0) {
    // `deals` ar null och inte ett negativt tal: kolumnen har `check (deals >= 0)`
    // i 0031, och antalet makulerade order star anda i texten.
    poster.push({
      slag: "makulering",
      belopp: summaAv(makulering),
      antal: null,
      text: `Makulering, ${u.antal.makulerade} order`,
    });
  }

  for (const slag of ["volymbonus", "kv_bonus", "ovrig_bonus", "avdrag"] as const) {
    const rader = av(slag);
    if (rader.length === 0) continue;
    const belopp = summaAv(rader);
    if (belopp === 0) continue;
    poster.push({ slag, belopp, antal: null, text: rader.map((r) => r.text).join("; ") });
  }

  return poster;
}
