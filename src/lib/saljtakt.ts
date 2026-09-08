/**
 * E13 steg 10: dagen, takten och malet.
 *
 * Ren logik — inga anrop, inga hemligheter, ingen import av Supabase. Samma
 * linje som `order.ts`, `provision-motor.ts` och `konsekvens.ts`: filen ska ga
 * att prova utan att starta Next. Se `tests/saljtakt.mjs`.
 *
 * ===========================================================================
 * TRE FRAGOR SOM MOTORN INTE SVARADE PA, OCH VARFOR DE HOR IHOP
 *
 * `provision-motor.ts` svarar pa vad manaden ar VARD just nu. Bestallarens
 * invandning 2026-09-07 var att det inte racker for ett saljbolag: den som
 * oppnar sidan vill veta vad hen salt I DAG, vad manaden LANDAR pa om det
 * fortsatter sa har, och hur det star sig mot vad som forvantas.
 *
 * De tre ar samma rakning sedd genom tre tidsfonster — dagen, prognosen och
 * malet — och de maste darfor rakna pa SAMMA arbetsdagar. Ligger dagsraknaren
 * i en fil och takten i en annan glider de isar den dag nagon lagger till en
 * roddag pa ett av stallena.
 * ===========================================================================
 *
 * INGET BELOPP OCH INGEN TROSKEL STAR I DEN HAR FILEN. Trappan kommer in som
 * argument, precis som i motorn, och malet kommer ur `sales_target` (0049).
 * Talen harunder ar 0, 1, 2, 3, 4, 7, 12 och kalenderns egna.
 */

import {
  nivaFor,
  volymbonusBelopp,
  avrunda,
  type Bonusniva,
  type Underlag,
} from "./provision-motor.ts";
import { harGodkants, provisionFor, type Order, type Sats } from "./order.ts";

// -----------------------------------------------------------------------------
// Kalendern
//
// ===========================================================================
// TAKTEN RAKNAS PA ARBETSDAGAR, INTE PA KALENDERDAGAR.
//
// Skillnaden ar inte akademisk. Den 30 april 2027 har manaden 30 kalenderdagar
// och 20 arbetsdagar, och en saljare som star pa 10 order den 15:e taktar 20
// order pa kalenderdagar och 20 pa arbetsdagar — det ser lika ut. I DECEMBER ar
// det inte lika: manaden har 31 kalenderdagar och 21 vardagar, varav fyra ar
// roda. Den som star pa 10 order den 15 december taktar 21 order raknat pa
// kalender och 17 raknat pa faktiska arbetsdagar, och det ar de fyra ordrarna
// som avgor om nagon tror sig na niva 20 eller inte.
//
// En prognos som lovar en niva som inte kommer ar varre an ingen prognos alls.
// ===========================================================================
// -----------------------------------------------------------------------------

/**
 * Paskdagen for ett ar, som "2027-03-28".
 *
 * Meeus/Jones/Butcher for gregoriansk kalender. Algoritmen ser ut som trolleri
 * och ar det inte — den ar den slutna formen for "forsta sondagen efter forsta
 * fullmanen efter varjamndygnet", och den ar den enda av arets roda dagar som
 * inte gar att sla upp i en tabell utan att tabellen tar slut.
 *
 * Fyra av de svenska helgdagarna hanger i den: langfredag, paskdagen,
 * annandag pask, Kristi himmelsfardsdag och pingstdagen.
 */
export function paskdagen(ar: number): string {
  const a = ar % 19;
  const b = Math.floor(ar / 100);
  const c = ar % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const manad = Math.floor((h + l - 7 * m + 114) / 31);
  const dag = ((h + l - 7 * m + 114) % 31) + 1;

  return `${ar}-${String(manad).padStart(2, "0")}-${String(dag).padStart(2, "0")}`;
}

/** Datumet `n` dagar efter `datum`. Negativt `n` gar bakat. */
export function dagPlus(datum: string, n: number): string {
  const d = new Date(`${datum}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Veckodagen for ett datum. 0 = sondag, 1 = mandag ... 6 = lordag. */
export function veckodag(datum: string): number {
  return new Date(`${datum}T00:00:00Z`).getUTCDay();
}

/**
 * De dagar ingen arbetar, for ett kalenderar.
 *
 * ===========================================================================
 * TRE DAGAR I LISTAN AR INTE HELGDAGAR I LAGENS MENING, OCH DE STAR MED ANDA.
 *
 * Julafton, midsommarafton och nyarsafton ar formellt vanliga vardagar. Ingen
 * saljare i Sverige tecknar avtal pa dem. Rakna dem som arbetsdagar och
 * decembers takt blir systematiskt for hog for alla, varje ar — en prognos som
 * ar fel at samma hall varje gang ar en prognos folk slutar lasa.
 *
 * De star darfor med, och valet ar utskrivet i vyn ("raknat pa arbetsdagar")
 * sa att den som tycker annat vet var det ska andras. Vill nagon dela upp de
 * tre fran de riktiga helgdagarna: dela listan, byt inte ut den.
 *
 * ALLA HELGONS DAG STAR MEDVETET INTE MED. Den infaller alltid pa en lordag och
 * hade darfor aldrig andrat en rakning. En rad som inte gor nagot ar en rad
 * nagon senare tror gor nagot.
 * ===========================================================================
 */
export function rodaDagar(ar: number): Set<string> {
  const pask = paskdagen(ar);

  return new Set([
    `${ar}-01-01`, // Nyarsdagen
    `${ar}-01-06`, // Trettondedag jul
    dagPlus(pask, -2), // Langfredagen
    pask, // Paskdagen
    dagPlus(pask, 1), // Annandag pask
    `${ar}-05-01`, // Forsta maj
    dagPlus(pask, 39), // Kristi himmelsfardsdag
    dagPlus(pask, 49), // Pingstdagen
    `${ar}-06-06`, // Sveriges nationaldag
    midsommarafton(ar),
    `${ar}-12-24`, // Julafton
    `${ar}-12-25`, // Juldagen
    `${ar}-12-26`, // Annandag jul
    `${ar}-12-31`, // Nyarsafton
  ]);
}

/**
 * Midsommarafton: fredagen fore midsommardagen, som i sin tur ar lordagen som
 * infaller 20–26 juni. Datumet gar alltsa inte att sla upp — det vandrar.
 */
function midsommarafton(ar: number): string {
  for (let dag = 19; dag <= 25; dag++) {
    const datum = `${ar}-06-${String(dag).padStart(2, "0")}`;
    if (veckodag(datum) === 5) return datum;
  }
  // Nas aldrig: sju datum i rad innehaller alltid en fredag.
  return `${ar}-06-19`;
}

/** Ar dagen en arbetsdag? Mandag–fredag som inte ar rod. */
export function arArbetsdag(datum: string): boolean {
  const d = veckodag(datum);
  if (d === 0 || d === 6) return false;
  return !rodaDagar(Number(datum.slice(0, 4))).has(datum);
}

/** Sista dagen i manaden, som "2026-09-30". */
export function sistaDagen(manad: string): string {
  const d = new Date(`${manad}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

/** Samtliga dagar i manaden, i ordning. Bade arbetsdagar och lediga. */
export function dagarIManad(manad: string): string[] {
  const ut: string[] = [];
  const sista = sistaDagen(manad);
  for (let d = manad; d <= sista; d = dagPlus(d, 1)) ut.push(d);
  return ut;
}

/** Arbetsdagarna i manaden, i ordning. */
export function arbetsdagarIManad(manad: string): string[] {
  return dagarIManad(manad).filter(arArbetsdag);
}

/**
 * Arbetsdagarna som PASSERAT, till och med `tomOchMed`.
 *
 * ===========================================================================
 * DAGEN I DAG RAKNAS SOM PASSERAD, och det ar ett val.
 *
 * Alternativet — att rakna dagen som pagaende och dela pa gardagens antal —
 * ger en takt som ar systematiskt for HOG hela dagen och faller till sanningen
 * i det ogonblick klockan slar tolv. Talet hade alltsa sjunkit varje kvall utan
 * att nagon gjort nagot fel, och den som ser sin prognos falla varje kvall
 * slutar tro pa den.
 *
 * Med dagen inraknad ar felet det motsatta och mildare: takten ar nagot LAG pa
 * morgonen och stiger under dagen nar orderna kommer in. Den ror sig at ratt
 * hall nar man arbetar, och det ar den enda av de tva rorelserna som beskriver
 * nagot verkligt.
 * ===========================================================================
 *
 * Ar `tomOchMed` en ledig dag raknas den inte — men alla arbetsdagar fore den
 * gor det.
 */
export function arbetsdagarTill(manad: string, tomOchMed: string): string[] {
  return arbetsdagarIManad(manad).filter((d) => d <= tomOchMed);
}

// -----------------------------------------------------------------------------
// Dagen
// -----------------------------------------------------------------------------

export type Dagsutfall = {
  /** Allt som tecknats i dag: utkast, inskickat och godkant. */
  antal: number;
  /** De som passerat chefens attest. */
  godkanda: number;
  /** De som ligger hos chefen. */
  vantande: number;
  /** Kronor pa de godkanda. Frusen sats, hamtad ur ordern. */
  kronor: number;
  /**
   * Kronor pa det som annu inte godkants, slaget ur matrisen.
   *
   * =========================================================================
   * DET HAR TALET FINNS INTE I DATABASEN, OCH SKA INTE GORA DET.
   *
   * `sales_order_provision_satt` i 0034 FORBJUDER ett belopp pa ett utkast, med
   * motiveringen "ett belopp pa ett utkast ser ut som ett lofte". Villkoret
   * star kvar orort.
   *
   * Men fragan "vad har jag salt for i dag" gar inte att besvara med bara de
   * attesterade orderna: chefen attesterar nar hon hinner, och en saljare som
   * lagt tre order pa formiddagen hade motts av noll kronor till efter lunch.
   * Talet raknas darfor fram VID LASNING ur samma matris ordern kommer att fa
   * sin sats ur, och visas SEPARAT med ordet "vantar" — aldrig hopslaget med
   * det godkanda.
   *
   * Skillnaden mot en kolumn i databasen ar att det har talet inte overlever
   * sidladdningen. Det ar en upplysning, inte ett lofte.
   * =========================================================================
   */
  kronorVantande: number;
};

/**
 * Vad som salts en viss dag.
 *
 * DAGEN AR SIGNERINGSDAGEN, inte inmatningsdagen. Ordern hor till den dag
 * kunden skrev pa — samma linje som `periodFor` i `order.ts`, och det ar den
 * enda tolkning som gor "i dag" och "den har manaden" till samma sorts tal.
 *
 * EN MAKULERAD ORDER RAKNAS INTE, aven om den tecknades i dag. Den som salde
 * och angrade samma dag har inte salt nagot, och en dagsraknare som sager
 * annat ar en raknare man kan blasa upp.
 */
export function saltEnDag(order: Order[], datum: string, satser: Sats[] = []): Dagsutfall {
  const dagens = order.filter((o) => o.signed_on === datum && o.status !== "makulerad");

  const godkanda = dagens.filter((o) => harGodkants(o.status));
  const vantande = dagens.filter((o) => !harGodkants(o.status));

  return {
    antal: dagens.length,
    godkanda: godkanda.length,
    vantande: vantande.length,
    kronor: godkanda.reduce((s, o) => s + (o.commission_amount ?? 0), 0),
    kronorVantande: vantande.reduce(
      (s, o) => s + (provisionFor(satser, o.package_id, o.term_months, o.signed_on) ?? 0),
      0,
    ),
  };
}

/**
 * Antal order per dag i manaden, for stapelraden.
 *
 * Bara arbetsdagar far en stapel. En helg med noll order sager ingenting om
 * nagon, och tio tomma staplar i rad lar ogat att raden ar full av tomrum.
 *
 * Rakningen foljer `saltEnDag`: makuleringar drar inte ned nagon dags stapel i
 * efterhand. En stapel ar vad som HANDE den dagen.
 */
export function dagsserie(order: Order[], manad: string): { dag: string; antal: number }[] {
  return arbetsdagarIManad(manad).map((dag) => ({
    dag,
    antal: order.filter((o) => o.signed_on === dag && o.status !== "makulerad").length,
  }));
}

// -----------------------------------------------------------------------------
// Takten
// -----------------------------------------------------------------------------

/**
 * Minsta antal passerade arbetsdagar innan en prognos far visas.
 *
 * ===========================================================================
 * EN PROGNOS UR EN DAG AR EN GISSNING UTKLADD TILL EN BERAKNING.
 *
 * Samma invandning som `prognosNastaNiva` redan bar: den som tecknar en order
 * pa manadens forsta arbetsdag taktar tjugoen. Talet ar aritmetiskt riktigt och
 * sager ingenting, och nasta dag utan order halveras det. Tre dagar ar inte
 * mycket, men det ar skillnaden mellan ett tal som ror sig och ett tal som
 * kastar sig.
 *
 * Under troskeln ar ratt svar att det ar for tidigt — inte en nolla, och inte
 * ett tal med en brasklapp.
 * ===========================================================================
 */
export const MINSTA_DAGAR_FOR_PROGNOS = 3;

export type Prognosman = {
  /** Ordervolymen manaden landar pa. */
  antal: number;
  /** Grundprovisionen da, framskriven pa samma takt. */
  grundprovision: number;
  /** Nivan den volymen nar, eller null. */
  niva: Bonusniva | null;
  /** Vad nivan ar vard da. */
  bonus: number;
  /** Grundprovision plus bonus. K&V star utanfor — se `takta`. */
  totalt: number;
};

export type Takt = {
  /** Arbetsdagar som passerat, dagen i dag inraknad. */
  gangna: number;
  /** Arbetsdagar i hela manaden. */
  totalt: number;
  kvar: number;
  /** Hur stor del av manaden som ar avverkad, 0–1. */
  andel: number;
  /** `null` under `MINSTA_DAGAR_FOR_PROGNOS`, eller nar ingenting salts. */
  prognos: Prognosman | null;
};

/**
 * Vad manaden landar pa om det fortsatter i samma takt.
 *
 * ===========================================================================
 * K&V-BONUSEN SKRIVS INTE FRAM, OCH DET AR INTE EN FORENKLING.
 *
 * Volymbonusen ar en funktion av ordervolymen, och ordervolymen ar det takten
 * skattar. Kedjan haller.
 *
 * K&V-bonusen ar en funktion av hur en MANNISKA bedomer samtal som annu inte
 * ringts. Att skriva fram den vore att prognosticera nagon annans omdome och
 * kalla det en berakning — och den som far en prognos med tva godkanda veckor
 * inbakade och sedan far en vecka underkand tycker med ratta att navet lovade
 * nagot.
 *
 * `totalt` ar darfor grundprovision plus volymbonus. Vyn sager det rakt ut.
 * ===========================================================================
 */
export function takta(
  underlag: Underlag,
  nivaer: Bonusniva[],
  manad: string,
  idag: string,
): Takt {
  const alla = arbetsdagarIManad(manad);
  const gangna = arbetsdagarTill(manad, idag).length;
  const totalt = alla.length;

  const grund = {
    gangna,
    totalt,
    kvar: Math.max(0, totalt - gangna),
    andel: totalt === 0 ? 0 : gangna / totalt,
  };

  // Manaden ar over: takten ar utfallet, inte en gissning om det.
  if (gangna >= totalt && totalt > 0) {
    return { ...grund, prognos: prognosAv(underlag.antal.netto, underlag.grundprovision, nivaer) };
  }

  if (gangna < MINSTA_DAGAR_FOR_PROGNOS) return { ...grund, prognos: null };
  if (underlag.antal.netto <= 0) return { ...grund, prognos: null };

  const faktor = totalt / gangna;

  return {
    ...grund,
    prognos: prognosAv(
      // AVRUNDAT TILL HELA ORDER, och till narmaste. Order gar inte att salja i
      // halvor, och en trappa som slar pa hela tal maste fa ett helt tal.
      Math.round(underlag.antal.netto * faktor),
      underlag.grundprovision * faktor,
      nivaer,
    ),
  };
}

function prognosAv(antal: number, grundprovision: number, nivaer: Bonusniva[]): Prognosman {
  const niva = nivaFor(nivaer, antal);
  const grund = avrunda(grundprovision);
  const bonus = niva ? avrunda(volymbonusBelopp(niva, antal, grundprovision)) : 0;

  return { antal, grundprovision: grund, niva, bonus, totalt: grund + bonus };
}

// -----------------------------------------------------------------------------
// Malet
// -----------------------------------------------------------------------------

/** En rad ur `sales_target` (0049). Bada malen ar frivilliga var for sig. */
export type Saljmal = {
  employee_id: string;
  period_month: string;
  mal_order: number | null;
  mal_kronor: number | null;
};

export type Mallage = "fore" | "i_takt" | "efter";

export type Malutfall = {
  mal: number;
  /** Utfallet hittills. */
  nu: number;
  /** Andel av malet, 0–1 och uppat. Kan overstiga 1. */
  andel: number;
  /** Var man BORDE sta i dag om manaden gick jamnt. */
  forvantat: number;
  /** Skillnaden mot det forvantade. Signerat: positivt ar fore. */
  mot: number;
  lage: Mallage;
  /** Vad som kravs per aterstaende arbetsdag. `null` nar malet ar natt. */
  kravPerDag: number | null;
};

/**
 * Toleransen for "i takt", som andel av malet.
 *
 * ===========================================================================
 * UTAN BAND HADE INGEN NAGONSIN LEGAT I TAKT.
 *
 * Det forvantade laget ar ett brakat tal — 20 order gangar 8/21 arbetsdagar ar
 * 7,6 order — och ingen star nagonsin pa 7,6 order. Utan tolerans hade
 * etiketten darfor alltid sagt "fore" eller "efter", aldrig "i takt", och tva
 * ord som tacker allt ar samma sak som inget ord.
 *
 * Fem procent av MALET och inte av det forvantade: annars ar bandet
 * mikroskopiskt den 2:a och brett den 28:e, alltsa vidast just nar precisionen
 * borjar betyda nagot.
 * ===========================================================================
 */
export const TAKTBAND = 0.05;

export function motMal(mal: number, nu: number, takt: Takt): Malutfall {
  const forvantat = mal * takt.andel;
  const mot = nu - forvantat;
  const band = mal * TAKTBAND;

  return {
    mal,
    nu,
    andel: mal === 0 ? 0 : nu / mal,
    forvantat,
    mot,
    lage: mot > band ? "fore" : mot < -band ? "efter" : "i_takt",
    kravPerDag: nu >= mal || takt.kvar === 0 ? null : (mal - nu) / takt.kvar,
  };
}

/**
 * Malet for en person och en manad, eller null.
 *
 * MALET SLAS UPP PA EXAKT MANAD och arvs aldrig fran manaden fore. Ett mal som
 * lever vidare av sig sjalvt ar ett mal ingen satt — och den forsta manaden
 * nagon inte hann satta ett blir da en tyst jamforelse mot ett tal fran en
 * annan tid.
 */
export function malFor(mal: Saljmal[], employee_id: string, manad: string): Saljmal | null {
  return (
    mal.find((m) => m.employee_id === employee_id && m.period_month === manad) ?? null
  );
}

// -----------------------------------------------------------------------------
// Manaden i backspegeln
// -----------------------------------------------------------------------------

export type Manadsfacit = {
  /** Order netto i manaden. Samma tal som underlaget bar. */
  antal: number;
  /** Dagen med flest order, eller null nar ingen dag har nagon. */
  bastaDagen: { dag: string; antal: number } | null;
  /** Arbetsdagar med minst en order. */
  dagarMedOrder: number;
  arbetsdagar: number;
  /** Order per arbetsdag i hela manaden. */
  snittPerArbetsdag: number;
};

/**
 * Manaden sammanfattad — det som ersatter dagskortet och takten nar man tittar
 * pa en manad som redan varit.
 *
 * ===========================================================================
 * "I DAG" OCH "TAKT" AR MENINGSLOSA I BACKSPEGELN, OCH DET AR INTE ETT
 * SMAKPROBLEM.
 *
 * Ett dagskort som star pa noll for att den valda manaden inte ar i dag ser
 * exakt likadant ut som ett dagskort for nagon som inte salt nagot i dag. Och
 * en "takt" for augusti ar inte en prognos utan utfallet, med en etikett som
 * pastar nagot annat.
 *
 * Bada bytts darfor ut mot fragor som HAR ett svar i efterhand: hur manga
 * dagar det faktiskt hande nagot, vilken dag som var bast, och hur jamnt
 * manaden gick. Vyn valjer, se `page.tsx`.
 * ===========================================================================
 *
 * `netto` skickas in i stallet for att raknas ur serien: serien vet inte om
 * makuleringar (en stapel ar vad som HANDE den dagen, se `dagsserie`), medan
 * `antal` ska vara samma tal som underlaget bar. Rakna dem pa var sitt hall och
 * de sager olika saker om samma manad.
 */
export function manadsfacit(
  serie: { dag: string; antal: number }[],
  netto: number,
): Manadsfacit {
  const med = serie.filter((d) => d.antal > 0);

  return {
    antal: netto,
    bastaDagen: med.length === 0 ? null : med.reduce((a, b) => (b.antal > a.antal ? b : a)),
    dagarMedOrder: med.length,
    arbetsdagar: serie.length,
    // Snittet raknas pa ALLA arbetsdagar, inte bara pa dem med order. Delat pa
    // dagarna med order svarar det pa "hur manga order kom det de dagar det kom
    // order", vilket ar minst ett i alla lagen och darmed sager ingenting.
    snittPerArbetsdag: serie.length === 0 ? 0 : netto / serie.length,
  };
}

// -----------------------------------------------------------------------------
// Aret
//
// ===========================================================================
// ETT AR AR EN LISTA AV MANADER, INTE ETT LANGT SPANN.
//
// Frestelsen ar att behandla aret som en enda period och rakna en volymbonus pa
// arets samlade ordervolym. Det vore fel pa tva satt samtidigt:
//
//   BONUSEN AR EN MANADSSAK. Nivan bestams av EN MANADS volym och betalas for
//   den manaden (avsnitt 5.2). Tolv manader med fyra order var ger noll bonus
//   tolv ganger; samma fyrtioatta order i EN manad ger niva 20. Ett arstal
//   raknat pa fyrtioatta hade pastatt det senare om nagon som gjort det forra.
//
//   MANADERNA HAR OLIKA SANNING. En stangd manad ar bokford och raknas aldrig
//   om; en oppen raknas live. Aret innehaller bada, och summan maste darfor
//   bildas manad for manad med var manads egen regel — inte av en motor som
//   kors en gang over hela spannet.
//
// DETSAMMA UTESLUTER ETT FRITT DATUMSPANN. "1-15 september" har ingen bonusniva
// att visa: halva manadens order nar kanske niva 5, men de pengarna finns inte
// forran manaden ar slut och kan ga at bada hall efter den 15:e. Talet hade
// sett ut som provision utan att ga att betala ut.
// ===========================================================================
// -----------------------------------------------------------------------------

/**
 * Manaderna i ett kalenderar, men aldrig framtida.
 *
 * En framtida manad ar inte en intjaning utan en prognos, och den hor inte
 * hemma i ett arstal — samma grans som `giltigManad` drar. Dessutom hade
 * decembers noll dragit ned snittet for alla redan i mars.
 */
export function manaderIAr(ar: number, idagsManad: string): string[] {
  const alla = Array.from({ length: 12 }, (_, i) => `${ar}-${String(i + 1).padStart(2, "0")}-01`);
  return alla.filter((m) => m <= idagsManad);
}

/**
 * Takten over en godtycklig lista manader.
 *
 * ===========================================================================
 * `niva` AR ALLTID NULL HAR.
 *
 * En niva ar en egenskap hos EN PERSONS MANAD. Ett ar har tolv, och ingen av
 * dem ar "arets"; ett lag har en per person, och ingen av dem ar "lagets".
 * Femtio order fordelade pa tio personer — eller pa tolv manader — ger ingen
 * bonus alls, medan femtio i en manad hos en person ger niva 20. Ett gemensamt
 * nivatal hade ritat samma bild for bada.
 *
 * BELOPPET skrivs daremot fram, och det ar arligt: bonusen som redan ar
 * intjanad ar rakad manad for manad med varje manads egen trappa, och
 * framskrivningen sager bara "fortsatter det sa har". Antagandet star i vyn.
 *
 * DEN HAR FUNKTIONEN ANVANDS INTE FOR EN ENSKILD PERSONS ENSKILDA MANAD — dar
 * ger `takta()` ett battre svar, eftersom den kan sla upp vilken niva prognosen
 * faktiskt landar pa. Se valet i `page.tsx`.
 * ===========================================================================
 */
export function taktaOverManader(
  manader: string[],
  idag: string,
  utfall: { antal: number; grundprovision: number; bonus: number },
): Takt {
  let totalt = 0;
  let gangna = 0;
  for (const m of manader) {
    totalt += arbetsdagarIManad(m).length;
    gangna += arbetsdagarTill(m, idag).length;
  }

  const grund = {
    gangna,
    totalt,
    kvar: Math.max(0, totalt - gangna),
    andel: totalt === 0 ? 0 : gangna / totalt,
  };

  if (gangna < MINSTA_DAGAR_FOR_PROGNOS || utfall.antal <= 0) {
    return { ...grund, prognos: null };
  }

  // Perioden ar slut: takten ar utfallet, inte en gissning om det.
  const faktor = gangna >= totalt ? 1 : totalt / gangna;

  const grundprovision = avrunda(utfall.grundprovision * faktor);
  const bonus = avrunda(utfall.bonus * faktor);

  return {
    ...grund,
    prognos: {
      // AVRUNDAT TILL HELA ORDER. Order gar inte att salja i halvor.
      antal: Math.round(utfall.antal * faktor),
      grundprovision,
      niva: null,
      bonus,
      totalt: grundprovision + bonus,
    },
  };
}

/** En manad sa som arsvyn bar den. Raknad av motorn, en gang, for just den manaden. */
export type Manadsrad = {
  manad: string;
  antal: number;
  summa: number;
  /** Troskeln manaden landade pa, eller null. Ett ar har tolv — se rubriken ovan. */
  niva: number | null;
  /** Ar manaden faststalld? Da ar `summa` bokford och raknas aldrig om. */
  stangd: boolean;
};

export type Arsfacit = {
  antal: number;
  summa: number;
  /** Manader med minst en order. */
  manaderMedOrder: number;
  /** Manader i perioden. Framtida manader ar inte med — se `manaderIAr`. */
  raknade: number;
  bastaManaden: Manadsrad | null;
  /** Hur manga manader som nadde en bonusniva. Det ar arets bonusfraga. */
  manaderMedNiva: number;
  /** Order per raknad manad. */
  snittPerManad: number;
};

/**
 * Perioden sammanfattad ur sina manader. Fungerar for en manad ocksa — da ar
 * `raknade` ett, och talen ar den manadens.
 *
 * SNITTET DELAS PA ALLA RAKNADE MANADER, inte bara pa dem med order — samma
 * resonemang som `manadsfacit` foljer for arbetsdagar. Delat pa manaderna med
 * order svarar det pa "hur mycket salde du de manader du salde nagot", vilket
 * ar minst ett i alla lagen och darmed sager ingenting.
 */
export function arsfacit(rader: Manadsrad[]): Arsfacit {
  const med = rader.filter((r) => r.antal > 0);
  const antal = rader.reduce((s, r) => s + r.antal, 0);

  return {
    antal,
    summa: rader.reduce((s, r) => s + r.summa, 0),
    manaderMedOrder: med.length,
    raknade: rader.length,
    bastaManaden: med.length === 0 ? null : med.reduce((a, b) => (b.antal > a.antal ? b : a)),
    manaderMedNiva: rader.filter((r) => r.niva !== null).length,
    snittPerManad: rader.length === 0 ? 0 : antal / rader.length,
  };
}

// -----------------------------------------------------------------------------
// Malen over en period
// -----------------------------------------------------------------------------

export type Malsumma = {
  /** Summan av malen. */
  mal: number;
  /** Utfallet for exakt de rader som HAR ett mal. */
  utfall: number;
  /** Antal satta mal bakom summan. Star i vyn, raknas inte pa. */
  antal: number;
};

/**
 * Malen summerade over en period, med utfallet raknat pa SAMMA KRETS.
 *
 * ===========================================================================
 * BADA SIDOR MASTE RAKNAS PA SAMMA RADER, OCH DET AR HELA FUNKTIONEN.
 *
 * Summeras tolv manaders mal men jamfors mot hela arets order blir kvoten
 * smickrande sa fort en manad saknar mal — talet hade STIGIT av att nagon
 * GLOMDE satta ett. Samma sak i foretagsvyn: tre satta mal om tjugo blir sextio,
 * medan fem personers order raknas mot dem.
 *
 * Funktionen tar darfor emot utfallet PER PERSON OCH MANAD och plockar sjalv ut
 * de rader som har ett ordermal. Ett utfall som skickas in fardigsummerat gar
 * inte att para ihop med sitt mal, och da ar felet tillbaka.
 *
 * BARA ORDERMAL RAKNAS. Kronmalet har ingen motsvarighet i `utfall` — det ar
 * antal order som star dar — och att blanda de tva hade gett en kvot mellan tva
 * olika enheter. Se `kronmalOverPeriod`.
 * ===========================================================================
 *
 * `mal: 0` betyder att inget ordermal finns i perioden. Vyn ska da inte rita
 * nagon bage; en nolla hade sett ut som ett mal ingen nadde.
 */
export function malOverPeriod(
  mal: Saljmal[],
  manader: string[],
  utfall: { employee_id: string; manad: string; antal: number }[],
): Malsumma {
  const iPerioden = new Set(manader);
  let summaMal = 0;
  let summaUtfall = 0;
  let antal = 0;

  for (const m of mal) {
    if (!iPerioden.has(m.period_month) || m.mal_order === null) continue;

    summaMal += m.mal_order;
    antal++;
    summaUtfall += utfall
      .filter((u) => u.employee_id === m.employee_id && u.manad === m.period_month)
      .reduce((s, u) => s + u.antal, 0);
  }

  return { mal: summaMal, utfall: summaUtfall, antal };
}

/**
 * Kronmalet summerat over perioden.
 *
 * Egen funktion for att det jamfors mot KRONOR och inte mot antal — samma skal
 * som gor att `malOverPeriod` bara raknar ordermal. Galler en person: ett
 * kronmal summerat over ett lag jamfort med lagets intjaning hade blandat in
 * dem som inte har nagot mal.
 */
export function kronmalOverPeriod(
  mal: Saljmal[],
  manader: string[],
  employee_id: string,
): number {
  const iPerioden = new Set(manader);
  return mal
    .filter((m) => iPerioden.has(m.period_month) && m.employee_id === employee_id)
    .reduce((s, m) => s + (m.mal_kronor ?? 0), 0);
}
