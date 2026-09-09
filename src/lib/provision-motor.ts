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
  ordervarde,
  type Order,
} from "./order.ts";
import type { Konsekvenslage } from "./konsekvens.ts";

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
  // Saljchefens overtack pa andras order, och tillbakadraget nar en sadan order
  // makuleras. TVA SLAG och inte ett: makuleringen sker i en ANNAN manad an
  // tillagget, precis som for saljarens egen provision, och tva slag i samma
  // manad ska ga att sarskilja i huvudboken. Se `chefsprovision.ts` for
  // rakningen och 0050 for var raderna kommer ifran.
  "chefsprovision",
  "chefsprovision_makulering",
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
   *
   * `bonusgrundande` ar det tal VOLYMTRAPPAN raknar pa. Det ar samma som
   * `netto` i en ren manad och lagre efter en bonusforlust — se
   * `Underlagskonsekvens`.
   */
  antal: {
    signerade: number;
    makulerade: number;
    netto: number;
    bonusgrundande: number;
  };

  grundprovision: number;

  /**
   * Vad personens order var varda for BOLAGET — en helt annan sorts tal an
   * resten av underlaget.
   *
   * ===========================================================================
   * DET HAR AR INTE PENGAR TILL NAGON, OCH DET FAR ALDRIG HAMNA I `summa`.
   *
   * `rader` och `summa` beskriver INTJANING: kronor som ska betalas ut till
   * personen. Ordervardet ar bolagets omsattning pa samma affarer, och de tva
   * star i samma vy men aldrig i samma summa. Ett ordervarde som slank in i
   * `summa` hade multiplicerat manadens lonekostnad med atta.
   *
   * Det ar ocksa skalet till att vardet star som ett EGET falt och inte som en
   * `Underlagsrad`: en rad i underlaget ar per definition en post som bokfors i
   * `commission_entry` nar perioden stangs, och det ska ordervardet inte.
   * ===========================================================================
   *
   * `utanVarde` ar antalet order som saknar varde helt — se `ordervarde()` i
   * `order.ts` for varfor de raknas i stallet for att summeras som nollor.
   */
  ordervarde: { netto: number; tecknat: number; makulerat: number; utanVarde: number };

  /** Nivan manaden landade pa, eller null nar den lagsta troskeln inte natts. */
  volymbonus: { niva: Bonusniva; belopp: number } | null;

  /**
   * K&V-bonusen, eller null nar inga veckor godkants.
   *
   * VISAS INTE I SALJARENS PROGRESSVY (avsnitt 9.1) utan pa K&V-sidan. Den hor
   * ihop med bedomningen, inte med ordervolymen. Den star anda i underlaget —
   * det ar underlaget som bokfors nar perioden stangs.
   */
  kv: { godkanda: number; procent: number; belopp: number } | null;

  /**
   * Saljchefens overtack pa andras order — null for alla utom mottagaren.
   *
   * ===========================================================================
   * DET HAR RAKNAS INTE FRAM HAR. Motorn tar emot fardiga poster.
   *
   * Skalet ar att overtacket FRYSES PER ORDER vid godkannandet, precis som
   * saljarens provision: procentsatsen som gallde da star pa raden i
   * `order_manager_commission` (0050) tillsammans med basen den raknades pa.
   * Skulle motorn rakna om det ur dagens sats hade en satsandring i november
   * andrat vad chefen fick i september — samma fel som den frusna
   * `commission_amount` finns for att hindra.
   *
   * Delningen ar densamma som for K&V: `chefsprovision.ts` vet vad ett overtack
   * ar, motorn vet hur manga av dem en manad innehaller.
   * ===========================================================================
   *
   * `antal` ar antalet ORDER bakom beloppet, inte order i trappans mening. Det
   * hojer aldrig `antal.netto` — se rubriken vid `raknaUnderlag`.
   */
  chefsprovision: { antal: number; makulerade: number; belopp: number } | null;

  /**
   * Nasta niva och hur langt dit. Prognosen i saljarens progressvy.
   *
   * Star med i UNDERLAGET och inte bara i vyn for att den ska raknas ur samma
   * trappa som bonusen. En "kvar till nasta niva" som vyn raknar fram sjalv ar
   * en andra tolkning av trappan, och den dagen de sager olika saker ar det
   * inte uppenbart vilken som har ratt.
   */
  nasta: { niva: Bonusniva; kvar: number } | null;

  /**
   * Manadens konsekvenslage — steg 6.
   *
   * `null` nar manaden ar ren, vilket ar det normala. Se `konsekvens.ts` for
   * vad de tva talen betyder och `bonusantal` nedan for varfor de behovs bada.
   */
  konsekvens: Underlagskonsekvens | null;

  summa: number;
};

/**
 * Konsekvensen sa som underlaget bar den.
 *
 * ===========================================================================
 * TVA ANTAL, OCH DE AR OLIKA MED FLIT.
 *
 * `antal.netto` ar vad personen faktiskt salde i manaden. Det ar den siffran
 * vyn ska visa nar den sager "du har 20 order", och den ar sann oavsett vad som
 * hant med bonusen.
 *
 * `bonusantal` ar vad VOLYMTRAPPAN raknar pa. Efter en bonusforlust borjar
 * orderraknaren om fran noll (fraga 45), sa den som stod pa 20 nar konsekvensen
 * slog in och sedan saljer fem till far niva 5:s belopp pa de fem — inte niva
 * 25 pa alla tjugofem.
 *
 * BLANDAS DE IHOP blir antingen vyn en logn ("du har 5 order" till nagon som
 * salt 20) eller bonusen fel. Halls de isar sager underlaget bada sakerna, och
 * det ar hela poangen med att motorn returnerar ett underlag och inte ett tal.
 * ===========================================================================
 */
export type Underlagskonsekvens = {
  bonusforlust: boolean;
  /** Datumet raknaren borjar om fran, eller null. */
  raknareFran: string | null;
  /** Antalet handelser bakom laget. Visas, raknas inte. */
  handelser: number;
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

function chefstext(p: Chefspost): string {
  return `Övertäck ${p.percent} % på ${p.company_name}, tecknad ${p.signed_on}`;
}

function chefsmakuleringstext(p: Chefspost): string {
  return `Makulerat övertäck, ${p.company_name} tecknad ${p.signed_on}`;
}

// -----------------------------------------------------------------------------
// Saljchefens overtack — steg 11
//
// INGEN PROCENTSATS STAR HAR HELLER. Posten kommer fardigraknad ur
// `order_manager_commission` (0050); `percent` foljer med enbart for att kunna
// skrivas ut i radtexten, och den multipliceras aldrig med nagonting.
// -----------------------------------------------------------------------------

/**
 * Ett bokfort overtack, sa som huvudboken bar det.
 *
 * MANADSFALTEN KOMMER UR ORDERN och inte ur posten. `order_manager_commission`
 * har med flit ingen egen manadskolumn — overtacket foljer sin order, bokfors i
 * dess `period_month` och dras tillbaka i dess `cancel_period_month`. En egen
 * kolumn hade varit ett andra svar pa samma fraga.
 */
export type Chefspost = {
  order_id: string;
  manager_id: string;
  amount: number;
  percent: number;

  /** Ur ordern, for manadsplaceringen och for radtexten. */
  period_month: string;
  cancel_period_month: string | null;
  signed_on: string;
  company_name: string;
  makulerad: boolean;
};

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
  kv: KvIndata | null = null,
  konsekvens: Konsekvenslage | null = null,
  chefsposter: Chefspost[] = [],
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

  // ===========================================================================
  // ORDERRAKNAREN BORJAR OM EFTER EN BONUSFORLUST (fraga 45).
  //
  // Bara order signerade FRAN OCH MED handelsens dag bygger den nya trappan.
  // Tva val i den meningen ar vardu att skriva ut:
  //
  //   HANDELSENS DAG, inte beslutets. Annars hade utfallet hangt pa nar chefen
  //   hann titta i kon, och order som saljaren tecknat under tiden hade
  //   raderats av ett dröjsmål som inte ar hens. Samma linje som `manadFor` i
  //   `konsekvens.ts`.
  //
  //   FRAN OCH MED, inte efter. En order signerad samma dag hamnar i den NYA
  //   trappan. Granhsen gar att tolka at tva hall och faller darfor ut till den
  //   anstalldas fordel — samma princip som toleransen i `raster.ts`.
  //
  // MAKULERINGAR FOLJER SIN ORDER. En makulering drar bara ned den nya
  // raknaren om ordern den galler ocksa hor dit. En order fran den 3:e som
  // makuleras efter en konsekvens den 20:e ska inte minska en raknare den
  // aldrig ingick i — da hade personen straffats tva ganger for samma order.
  // ===========================================================================
  const fran = konsekvens?.raknareFran ?? null;
  const efterKonsekvens = <T extends { signed_on: string }>(rader: T[]) =>
    fran === null ? rader : rader.filter((o) => o.signed_on >= fran);

  const antal = {
    signerade: signerade.length,
    makulerade: makulerade.length,
    netto: signerade.length - makulerade.length,
    bonusgrundande:
      efterKonsekvens(signerade).length - efterKonsekvens(makulerade).length,
  };

  // Samma tal som orderraderna ger. Det star som eget falt for att
  // procentbonusen raknas PA det, och for att en avvikelse mellan de tva ar ett
  // fel som ska ga att se — provet kontrollerar att de aldrig glider isar.
  const grund = grundprovision(mina, manad);

  const trappa = gallandeNivaer(nivaer, manad);
  const niva = nivaFor(trappa, antal.bonusgrundande);

  const volymbonus = niva
    ? { niva, belopp: avrunda(volymbonusBelopp(niva, antal.bonusgrundande, grund)) }
    : null;

  if (volymbonus) {
    rader.push({
      slag: "volymbonus",
      text: konsekvens?.bonusforlust
        ? `Volymbonus nivå ${volymbonus.niva.threshold}, ${antal.bonusgrundande} order efter konsekvensen`
        : `Volymbonus nivå ${volymbonus.niva.threshold}, ${antal.netto} order`,
      belopp: volymbonus.belopp,
    });
  }

  // K&V-BONUSEN LAGGS SIST, och basen ar de tva raderna ovan. Ordningen ar inte
  // kosmetisk: basen ar grundprovision + volymbonus (O3), sa raden maste raknas
  // efter att volymbonusen ar bestamd.
  //
  // ===========================================================================
  // VID EN BONUSFORLUST FALLER K&V-BONUSEN HELT — inte delvis, och den borjar
  // inte om som orderraknaren gor. Se O17.
  //
  // Bestallaren sa "samtliga bonusar for innevarande manad faller" (fraga 44)
  // och gjorde EN undantagsregel: orderraknaren borjar om (fraga 45). Ett
  // uttryckligt undantag for det ena talar for att det andra inte har nagot.
  //
  // Det finns ocksa ett strukturellt skal, och det ar det starkare: en ORDER
  // har ett signeringsdatum och gar darfor att lagga fore eller efter en
  // handelse. En VECKA har inte det. En vecka som spanner over konsekvensdagen
  // hade fatt delas, och avsnitt 6.2 sager redan att en halv vecka inte ar
  // nagot man bedomer — den hoppas over. Att bygga en tredje sorts halv vecka
  // hade motsagt den regeln.
  //
  // O17 ar ett FORSLAG som galler tills bestallaren sager annat. Sags det
  // annat ar det den har raden som andras, och `KvIndata` bar redan allt som
  // behovs for att rakna om pa fardre veckor.
  // ===========================================================================
  const kvBonus =
    kv && kv.procent > 0 && !konsekvens?.bonusforlust
      ? {
          godkanda: kv.godkanda,
          procent: kv.procent,
          belopp: avrunda((kvBas(grund, volymbonus?.belopp ?? 0) * kv.procent) / 100),
        }
      : null;

  if (kvBonus) {
    rader.push({
      slag: "kv_bonus",
      text: `K&V-bonus, ${kvBonus.godkanda} godkänd${kvBonus.godkanda === 1 ? "" : "a"} ${
        kvBonus.godkanda === 1 ? "vecka" : "veckor"
      } (${kvBonus.procent} %)`,
      belopp: kvBonus.belopp,
    });
  }

  // ===========================================================================
  // OVERTACKET LIGGER SIST, OCH DET AR INTE BARA EN PLACERING.
  //
  // Raderna kommer EFTER K&V-raden for att ingenting ovanfor far rakna pa dem.
  // Tre saker foljer av det, och alla tre ar bestallarens regler eller foljer av
  // dem:
  //
  //   VOLYMTRAPPAN ROR DEM INTE. `antal` raknas ur ORDER personen sjalv salt.
  //   Rakhades overtacken in dar hade en saljchef med fem saljare natt niva 20
  //   utan att teckna en enda affar, och trappan hade slutat betyda ordervolym.
  //
  //   K&V-BASEN ROR DEM INTE. Basen ar grundprovision plus volymbonus (O3), och
  //   K&V bedoms pa personens EGNA samtal. Att lata en procentsats pa nagon
  //   annans affar hoja den bonusen hade gjort chefens K&V-utfall till en
  //   funktion av hur mycket laget salde. Se O19.
  //
  //   EN BONUSFORLUST ROR DEM INTE. Overtacket ar inte en bonus utan ersattning
  //   for utfort arbete, i samma mening som grundprovisionen — och den ar orord
  //   vid en konsekvens (avsnitt 7.3, bestallarens uttryckliga besked). Se O19.
  //
  // Alla tre ar FORSLAG som galler tills bestallaren sager annat, och alla tre
  // andras genom att flytta de har raderna uppat. Att de ligger sist ar darfor
  // det som gor dem lasbara: allt ovanfor ar redan raknat nar de laggs till.
  // ===========================================================================
  const minaChefsposter = chefsposter.filter((p) => p.manager_id === employee_id);

  // SAMMA TVAHANDELSEMODELL SOM ORDERN SJALV. Ett overtack bidrar i sin orders
  // SIGNERINGSMANAD och dras tillbaka i dess MAKULERINGSMANAD, och de tva ar
  // olika manader med flit. Se `harGodkants` i `order.ts` for felet som uppstar
  // nar de blandas ihop — det ratades dar 2026-08-25 och far inte aterinforas
  // har.
  const chefsIn = minaChefsposter.filter((p) => p.period_month === manad);
  const chefsUt = minaChefsposter.filter(
    (p) => p.makulerad && p.cancel_period_month === manad,
  );

  for (const p of chefsIn) {
    rader.push({
      slag: "chefsprovision",
      text: chefstext(p),
      belopp: p.amount,
      order_id: p.order_id,
    });
  }

  for (const p of chefsUt) {
    rader.push({
      slag: "chefsprovision_makulering",
      text: chefsmakuleringstext(p),
      belopp: -p.amount,
      order_id: p.order_id,
    });
  }

  const chefsbelopp =
    chefsIn.reduce((s, p) => s + p.amount, 0) - chefsUt.reduce((s, p) => s + p.amount, 0);

  const chefsprovision =
    chefsIn.length > 0 || chefsUt.length > 0
      ? { antal: chefsIn.length, makulerade: chefsUt.length, belopp: chefsbelopp }
      : null;

  return {
    employee_id,
    manad,
    rader,
    antal,
    grundprovision: grund,
    ordervarde: ordervarde(mina, manad),
    chefsprovision,
    volymbonus,
    kv: kvBonus,
    // PROGNOSEN RAKNAS PA DEN NYA TRAPPAN. Efter en konsekvens ar "3 order kvar
    // till nasta bonus" ett pastaende om raknaren som borjade om, inte om den
    // manaden hade utan handelsen — annars lovar vyn en niva som inte kommer.
    nasta: kvarTillNasta(trappa, antal.bonusgrundande),
    konsekvens: konsekvens
      ? {
          bonusforlust: konsekvens.bonusforlust,
          raknareFran: konsekvens.raknareFran,
          handelser: konsekvens.handelser.length,
        }
      : null,
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
  kvPerPerson: Map<string, KvIndata> = new Map(),
  konsekvensPerPerson: Map<string, Konsekvenslage> = new Map(),
  chefsposter: Chefspost[] = [],
): Underlag[] {
  const personer = new Set<string>();
  for (const o of [...orderIPeriod(order, manad), ...makuleradeIPeriod(order, manad)]) {
    personer.add(o.salesperson_id);
  }

  // ===========================================================================
  // MOTTAGAREN MASTE MED AVEN UTAN EGNA ORDER, och det ar hela poangen med
  // raderna nedan.
  //
  // Fram till 2026-09-09 var listan uteslutande "personer som salt nagot i
  // manaden". En saljchef som inte tecknat en enda egen affar men fatt overtack
  // pa fem av sina saljares hade darfor INTE FUNNITS i chefens vy — och,
  // allvarligare, inte i `stangning.ts`, som bygger sin bokforing pa exakt den
  // har funktionen. Overtacket hade raknats live hela manaden och sedan tyst
  // uteblivit ur lonekorningen.
  //
  // Det ar samma sorts fel som "makuleringar av aldre order foll bort ur
  // hamtaOrder" (rattat 2026-09-08): det gar at det halL dar ingen saknar sina
  // pengar forran det ar for sent.
  //
  // MANADSFILTRET STAR HAR OCKSA. En post vars order signerades i mars far inte
  // gora mars manadsvy till en lista med chefen i — `raknaUnderlag` hade gett
  // hen ett tomt underlag, och en rad pa noll kronor i en lagvy ar en person som
  // ser ut att ha misslyckats.
  // ===========================================================================
  for (const p of chefsposter) {
    if (p.period_month === manad || (p.makulerad && p.cancel_period_month === manad)) {
      personer.add(p.manager_id);
    }
  }

  return [...personer]
    .sort()
    .map((id) =>
      raknaUnderlag(
        id,
        order,
        manad,
        nivaer,
        kvPerPerson.get(id) ?? null,
        konsekvensPerPerson.get(id) ?? null,
        chefsposter,
      ),
    );
}

// -----------------------------------------------------------------------------
// K&V-bonusen — steg 5
//
// Veckologiken ligger i `kv.ts` och pengarna har. Delningen ar avsiktlig:
// `kv.ts` vet vad en godkand vecka ar, motorn vet vad den ar vard, och ingen av
// dem behover kunna bada for att ga att prova.
// -----------------------------------------------------------------------------

/** Manadens K&V-utfall, redan reducerat av `kvManad()` i `kv.ts`. */
export type KvIndata = {
  /** Antal godkanda veckor. */
  godkanda: number;
  /** Veckor med fullstandig bedomning, godkanda eller ej. Visas, raknas inte. */
  bedomda: number;
  /** Procentsatsen de ger, redan takad. */
  procent: number;
};

/**
 * Basen K&V-bonusen raknas pa: grundprovision PLUS volymbonus (O3).
 *
 * K&V RAKNAS ALDRIG PA K&V. Bestallarens svar pa fraga 30 var "manadens
 * provision inklusive volymbonus", alltsa hela manadens intjaning FORE
 * K&V-bonusen. Att lagga den till basen hade gjort bonusen beroende av sig
 * sjalv, och ordningen mellan de tva raderna hade da avgjort utfallet.
 */
export function kvBas(grundprovision: number, volymbonus: number): number {
  return grundprovision + volymbonus;
}

// -----------------------------------------------------------------------------
// Prognosen — steg 4
// -----------------------------------------------------------------------------

export type Prognos = {
  /** Nivan som nas harnast. */
  niva: Bonusniva;
  /** Antal order kvar dit. */
  kvar: number;
  /** Snittprovisionen per order hittills i manaden. Bestallarens val, fraga 52. */
  snittPerOrder: number;
  /** Grundprovisionen nar nivan nas, med snittet framskrivet. */
  grundprovisionDa: number;
  /** Bonusen nivan ger da. */
  bonusDa: number;
  /** Vad totalen blir. */
  totaltDa: number;
};

/**
 * Vad nasta niva ger, och vad totalen blir nar den nas (avsnitt 9.1).
 *
 * ===========================================================================
 * PROGNOSEN RAKNAS PA NUVARANDE SNITTPROVISION PER ORDER — bestallarens val
 * pa fraga 52 — och ANTAGANDET SKA SKRIVAS UT I VYN.
 *
 * Skalet ar att en prognos utan sina forutsattningar ar en siffra folk brakar
 * om. "Du far 22 000 kr vid tio order" ar fel sa fort de tre sista orderna ar
 * mindre an de sju forsta, och da ar det navet som ljog. "Vid samma snitt som
 * hittills" ar samma tal med ett villkor som gar att kontrollera.
 *
 * `null` nar det inte gar att saga nagot: ingen nasta niva (trappan star still
 * over 30), eller inga order an att rakna ett snitt ur. En prognos ur noll
 * order hade varit en gissning utklaadd till en berakning.
 * ===========================================================================
 */
export function prognosNastaNiva(u: Underlag): Prognos | null {
  if (!u.nasta) return null;
  if (u.antal.signerade === 0) return null;

  const snittPerOrder = u.grundprovision / u.antal.signerade;
  const grundprovisionDa = u.grundprovision + u.nasta.kvar * snittPerOrder;
  const bonusDa = avrunda(
    volymbonusBelopp(u.nasta.niva, u.nasta.niva.threshold, grundprovisionDa),
  );

  return {
    niva: u.nasta.niva,
    kvar: u.nasta.kvar,
    snittPerOrder,
    grundprovisionDa: avrunda(grundprovisionDa),
    bonusDa,
    totaltDa: avrunda(grundprovisionDa) + bonusDa,
  };
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
 *
 * ===========================================================================
 * EN BONUSFORLUST BOKFORS INTE SOM EN POST. Den syns som en post SOM INTE
 * FINNS — volymbonusraden uteblir, eller ar mindre an manaden borde ha gett.
 *
 * Frestelsen ar en `avdrag`-rad pa noll kronor "sa att det syns". Den vore fel
 * pa tva satt: den ar en nollpost i en append-only tabell, och den pastar att
 * pengar dragits nar det som hant ar att de aldrig tjanades in.
 *
 * SPARBARHETEN (avsnitt 12) ligger i stallet i `attendance_incident`, som ar
 * permanent och laser sig av bade chefen och den det galler (RLS i 0037). Vyn
 * lagger de tva bredvid varandra: manadens poster ur huvudboken, och skalet ur
 * handelsen. Det galler ocksa en STANGD manad — handelserna finns kvar, sa
 * fragan "varfor fick jag ingen volymbonus i augusti" gar att besvara i
 * november lika val som i augusti.
 * ===========================================================================
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

  // ===========================================================================
  // OVERTACKET BOKFORS SOM TVA POSTER, INTE SOM EN NETTOSUMMA.
  //
  // Frestelsen ar att slaga ihop dem: tre overtack pa 1 044 kr och ett
  // makulerat ger 2 088 kr, och EN post pa det talet ar kortare att lasa.
  //
  // Den skulle vara fel av samma skal som `makulering` har en egen post och inte
  // dras av fran `order`: en huvudbok som bara bar nettot kan inte svara pa vad
  // som tjanades in och vad som drogs tillbaka. Och eftersom `commission_entry`
  // ar append-only gar den upplysningen aldrig att lagga till i efterhand.
  //
  // Texterna slas daremot ihop per post — en post per SLAG och inte en per
  // order, precis som ovan. Orderraderna finns redan i `sales_order` med sina
  // egna id:n, och `order_manager_commission` bar rakningen bakom varje krona.
  // ===========================================================================
  for (const slag of ["chefsprovision", "chefsprovision_makulering"] as const) {
    const rader = av(slag);
    if (rader.length === 0) continue;
    const belopp = summaAv(rader);
    if (belopp === 0) continue;

    poster.push({
      slag,
      belopp,
      // `deals` ar antalet order bakom posten. For tillagget ar det ett aakta
      // antal; for makuleringen ar beloppet negativt och kolumnen har
      // `check (deals >= 0)` i 0031, sa antalet star i texten i stallet — samma
      // losning som `makulering` ovan.
      antal: slag === "chefsprovision" ? rader.length : null,
      text:
        slag === "chefsprovision"
          ? `Övertäck på ${rader.length} ${rader.length === 1 ? "order" : "order"}`
          : `Makulerat övertäck, ${rader.length} ${rader.length === 1 ? "order" : "order"}`,
    });
  }

  return poster;
}
