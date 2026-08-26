/**
 * E13 steg 6: konsekvensmotorn.
 *
 * Ren logik — inga anrop, inga hemligheter, ingen import av Supabase. Samma
 * linje som `provision-motor.ts`, `raster.ts` och `kv.ts`: motorn ska ga att
 * prova utan att starta Next. Se `tests/konsekvenser.mjs`.
 *
 * ===========================================================================
 * TRAPPAN STAR I `consequence_rule`, ALDRIG I ETT `if`.
 *
 * Sok efter ett tal harunder och du hittar 0, 1 och MINSTA_MINUTER. Trosklarna
 * (1, 2, 3 handelser), periodlangden (3 manader) och atgarden (varning,
 * bonusforlust, arende) ar RADER i `consequence_rule` (0037) och kommer hit som
 * argument. Bestallaren vill kunna uttrycka fler typer (fraga 50), och en
 * trappa i koden ar en trappa som kraver en deploy for att andras.
 *
 * Det som INTE ar data ar vad varje atgard faktiskt GOR. Det ar kod, och det
 * ska det vara.
 * ===========================================================================
 */

import { manadsnyckel } from "./provision.ts";

// -----------------------------------------------------------------------------
// O15 — vad som overhuvudtaget kan bli en handelse
// -----------------------------------------------------------------------------

/**
 * Minsta antal minuter en ogiltig franvaro kan besta av (O15, besvarad
 * 2026-08-25).
 *
 * Talet star ocksa som check-villkor pa `attendance_incident.minutes` i 0037,
 * och migrationen har en SJALVKONTROLL som faller om villkoret forsvinner. De
 * tva ar med flit samma tal pa tva stallen: granhsen ar ett beslut, inte en
 * instalining, och den som sanker den ska mota bada.
 *
 * ATT FLYTTA DEN HAR SIFFRAN AR INTE EN KODANDRING. Se rubriken nedan.
 */
export const MINSTA_MINUTER = 5;

/** Sa mycket av en stampling som motorn behover veta. Speglar `tid.ts`. */
export type Stampling = { kind: string; occurred_at: string };

/** Schemat for en dag. Speglar `work_schedule` genom `narvaro.ts`. */
export type Schemadag = { start_time: string; end_time: string };

/** Minuter sedan midnatt ur "HH:MM" eller "HH:MM:SS". Samma som `narvaro.ts`. */
function minutOnDagen(tid: string): number {
  const [h, m] = tid.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Hur manga minuters utebliven instampling dagen bestar av, eller null nar
 * dagen inte ar ett fall alls.
 *
 * ===========================================================================
 * DEN SOM STAMPLAT IN OVERHUVUDTAGET RAKNAS ALDRIG. Det ar hela regeln.
 *
 * O15 sager tva saker: minst fem minuter, OCH att personen faktiskt inte var
 * pa plats. Den andra halvan ar den viktiga, och bestallarens egna ord var att
 * den som stamplar in for sent men varit har raknas ALDRIG.
 *
 * Darfor mater den har funktionen inte en LUCKA utan en HELT UTEBLIVEN dag.
 * Finns det en enda instampling lamnar den null, oavsett hur sent den kom,
 * hur langa glapp dagen har eller hur tidigt personen gick hem.
 *
 * Skalet ar D-K12, och det ar inte en teknisk detalj:
 *
 *   K12 1.2 sen ankomst NAR INTE PROVISIONEN. Det ar ett lofte till personalen
 *   i intresseavvagningens avsnitt 5, och intresseavvagningen ar beslutad
 *   2026-08-26 med det loftet i sig. En matning av "schemalagd tid utan
 *   stampling bakom sig" hade av ren aritmetik fangat sen ankomst — minuterna
 *   fore dagens forsta instampling ar precis forseningen — och da hade
 *   granhsen glidit utan att nagon flyttat den med avsikt.
 *
 * SAMMA SKAL GALLER TIDIG HEMGANG OCH GLAPP MITT PA DAGEN. De ar inte
 * "utebliven instampling", de ar nagot annat, och de har inte gatt igenom
 * frageomgangen. Vill bestallaren att de ska rakas ar det EN RAD har — men det
 * kraver att K12 avsnitt 6 och 7 skrivs och beslutas pa nytt, av nagon med
 * dataskyddskompetens. Bygg inte om den har funktionen utan det.
 *
 * Foljden ar att femminutersgranhsen sallan biter: en schemalagd dag ar langre
 * an sa. Den star kvar anda, bade har och i schemat, for att den ar det
 * bestallaren svarade och for att en dag med ett fyra minuter kort schema inte
 * ska bli ett disciplinart arende.
 * ===========================================================================
 *
 * `handelser` forvantas redan vara korda genom `gallande()` i `tid.ts` — en
 * rattelse som inte godkants ar inte en stampling.
 */
export function uteblivenInstampling(
  handelser: Stampling[],
  schema: Schemadag | null,
): number | null {
  // Utan schema finns ingen schemalagd tid att utebli fran. Att sakna schema ar
  // inte samma sak som att vara franvarande, lika lite som det ar samma sak som
  // att vara i tid (`senAnkomst` i `narvaro.ts` drar samma slutsats).
  if (!schema) return null;

  // EN ENDA STAMPLING RACKER for att dagen inte ska vara ett fall. Villkoret
  // ar med flit inte `kind === "in"`: en dag som bara har en utstampling ar en
  // dag nagon var har och navet tappat borjan pa, och det ar en rattelse och
  // inte en disciplinar handelse.
  if (handelser.length > 0) return null;

  const minuter = minutOnDagen(schema.end_time) - minutOnDagen(schema.start_time);
  if (minuter < MINSTA_MINUTER) return null;

  return minuter;
}

// -----------------------------------------------------------------------------
// Trappan
// -----------------------------------------------------------------------------

export const ATGARDER = ["varning", "skriftlig_erinran", "bonusforlust", "arende"] as const;
export type Atgard = (typeof ATGARDER)[number];

export const ATGARD_ETIKETT: Record<Atgard, string> = {
  varning: "Varning",
  skriftlig_erinran: "Skriftlig erinran",
  bonusforlust: "Bonusförlust",
  arende: "Personalärende",
};

/** En rad i `consequence_rule` (0037). */
export type Konsekvensregel = {
  id: string;
  ordning: number;
  antal_handelser: number;
  periodlangd_manader: number;
  atgard: Atgard;
  omfattning: "innevarande_manad" | null;
  notifiera: boolean;
};

export const HANDELSESTATUS = ["foreslagen", "godkand", "avvisad", "havd"] as const;
export type Handelsestatus = (typeof HANDELSESTATUS)[number];

/** En rad i `attendance_incident` (0037). */
export type Handelse = {
  id: string;
  employee_id: string;
  occurred_on: string;
  minutes: number;
  status: Handelsestatus;
  ordningsnummer: number | null;
  atgard: Atgard | null;
  period_month: string | null;
};

/**
 * Raknas handelsen med i trappan?
 *
 * ===========================================================================
 * BARA `godkand`. EN HAVD HANDELSE RAKNAS FOR INGENTING.
 *
 * Det ar samma sorts fraga som `raknas()` mot `harGodkants()` i `order.ts` —
 * och SVARET AR DET MOTSATTA. Skillnaden ar vad de tva sakerna betyder:
 *
 *   En MAKULERING ar tva handelser. Ordern gav provision i sin
 *   signeringsmanad och drar tillbaka den i sin makuleringsmanad, sa
 *   signeringen raknas fortfarande — den hande.
 *
 *   En HAVNING ar ett underkant beslut. Chefen sager att handelsen aldrig
 *   borde ha registrerats. Da ska den inte bara sluta ge en konsekvens, den
 *   ska sluta rakna mot nasta ocksa — annars star personen kvar pa steg tva
 *   efter att steg ett rivits, och trappan bygger pa ett beslut som ar taget
 *   tillbaka.
 *
 * Raden syns anda, bade for chefen och for den den galler (RLS i 0037 slapper
 * fram `havd`), for att en rattelse till personens fordel ska ga att se.
 * ===========================================================================
 */
export function raknas(h: Handelse): boolean {
  return h.status === "godkand";
}

/**
 * Datumet `n` manader fore `datum`, som "2026-05-15".
 *
 * Klockan 12:00 UTC av samma skal som `veckostart` i `kv.ts`: ett datum tolkat
 * som midnatt och sedan flyttat ar sarbart for varje sommartidsantagande nagon
 * senare lagger till.
 *
 * DEN 31:A KLAMS till manadens sista dag i stallet for att rulla over till
 * nasta manad. Tre manader fore den 31 maj ar den 28 februari, inte den 3 mars.
 * `setUTCMonth` gor det senare av sig sjalvt, och en period som blir tre dagar
 * kortare vissa manader ar precis den sortens sak ingen upptacker.
 */
export function manaderFore(datum: string, n: number): string {
  const d = new Date(`${datum}T12:00:00Z`);
  const dag = d.getUTCDate();

  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);

  const sistaIManaden = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12),
  ).getUTCDate();

  d.setUTCDate(Math.min(dag, sistaIManaden));
  return d.toISOString().slice(0, 10);
}

/**
 * Handelserna som ligger inom det rullande fonstret vid ett visst datum.
 *
 * ===========================================================================
 * FONSTRET RAKNAS BAKAT FRAN DATUMET, och det ar det som forenar tva svar som
 * lat motstridiga.
 *
 *   Fraga 42: "perioden ar rullande, raknad fran den forsta".
 *   Fraga 47: "varningen nollstalls tre manader efter den SENASTE".
 *
 * Ett fonster som ankras i den FORSTA handelsen uppfyller 42 men inte 47: efter
 * tre manader fran den forsta borjar allt om, aven om det kom en handelse till
 * i forra veckan.
 *
 * Ett fonster som raknas BAKAT fran det datum man fragar om uppfyller BADA:
 *
 *   - Tva handelser inom tre manader av varandra: den andra ser den forsta.
 *     Det ar 42, ordagrant, i det fall 42 handlar om.
 *   - Har det inte hant nagot pa tre manader ar fonstret tomt, for om den
 *     SENASTE ligger utanfor ligger alla utanfor. Det ar 47, exakt.
 *
 * Darfor ar det den har regeln som galler, och den star utskriven har for att
 * nasta lasare inte ska "ratta" den tillbaka till 42:s ordalydelse.
 *
 * Fonstret ar HALVOPPET: en handelse exakt tre manader tillbaka ligger utanfor.
 * Varje grans som gar att tolka at tva hall faller ut till den anstalldas
 * fordel — samma princip som toleransen i `raster.ts` och `narvaro.ts`.
 * ===========================================================================
 */
export function iFonstret(
  handelser: Handelse[],
  datum: string,
  periodlangdManader: number,
): Handelse[] {
  const start = manaderFore(datum, periodlangdManader);
  return handelser.filter((h) => raknas(h) && h.occurred_on > start && h.occurred_on <= datum);
}

/**
 * Trappsteget en handelse landar pa nar den godkanns.
 *
 * `tidigare` far garna vara personens hela historik — funktionen filtrerar
 * sjalv pa fonstret och pa `godkand`. HANDELSEN SOM BESLUTAS SKA INTE STA I
 * `tidigare`; den raknas som en, hardkodat, for att den annu inte har den
 * status som `raknas()` kraver.
 *
 * Regeln som valjs ar den HOGSTA ordning vars troskel ar natt. Nas ingen regel
 * — trappan ar tom, eller den lagsta troskeln ar hogre an antalet — blir svaret
 * null och handelsen godkanns utan konsekvens. Det ar ett giltigt lage: en
 * trappa dar forsta steget kraver tva handelser ger ingenting pa den forsta.
 *
 * TRAPPAN STAR STILL PA SITT SISTA STEG. Fjarde och femte gangen ger samma
 * atgard som tredje sa lange ingen lagger till en regel med hogre ordning —
 * samma form som volymtrappan over 30 (avsnitt 5.3).
 */
export function trappstegFor(
  regler: Konsekvensregel[],
  tidigare: Handelse[],
  datum: string,
): Konsekvensregel | null {
  const traffar = regler.filter(
    (r) => iFonstret(tidigare, datum, r.periodlangd_manader).length + 1 >= r.antal_handelser,
  );

  if (traffar.length === 0) return null;
  return traffar.reduce((hogst, r) => (r.ordning > hogst.ordning ? r : hogst));
}

/**
 * Manaden en godkand handelse belastar.
 *
 * ===========================================================================
 * HANDELSENS EGEN MANAD, inte den manad chefen rakade fatta beslutet i.
 *
 * "Bonusforlusten galler endast innevarande manad" (fraga 43), och "innevarande"
 * ar manaden ur SALJARENS synvinkel: den manad hen inte var pa jobbet.
 *
 * Alternativet — beslutsdatumets manad — hade gjort utfallet beroende av nar
 * chefen hann titta i kon. Tva likadana fall dar det ena godkanns den 31:a och
 * det andra den 1:a hade da fallit ut i olika manader, och den skillnaden ar
 * chefens och inte saljarens. Samma resonemang som halvbedomda K&V-veckor
 * (avsnitt 6.2) och som `period_month` pa ordern, som slas upp pa
 * signeringsdatumet och inte pa godkannandet.
 *
 * EN STANGD PERIOD ROSS INTE av det har. Den behover ingen sarbehandling:
 * en stangd manad laser sin siffra ur `commission_entry` och fragar aldrig
 * motorn (avsnitt 5.5). Bonusforlusten far darmed ingen verkan bakat, och
 * chefen ska fa veta det NAR HEN GODKANNER — inte upptacka det efterat. Se
 * `beslutaHandelse` i sidans actions.
 * ===========================================================================
 */
export function manadFor(handelse: Pick<Handelse, "occurred_on">): string {
  return manadsnyckel(handelse.occurred_on);
}

// -----------------------------------------------------------------------------
// Vad konsekvensen gor med manadens bonus
// -----------------------------------------------------------------------------

/**
 * Manadens konsekvenslage, sa som `provision-motor.ts` behover det.
 *
 * `null` — och inte ett objekt med `bonusforlust: false` — nar manaden ar ren.
 * Vyn ska kunna skilja "ingen konsekvens" fran "en konsekvens utan verkan", och
 * en flagga som nastan alltid ar false blir en flagga ingen laser.
 */
export type Konsekvenslage = {
  /** Faller volymbonusen och K&V-bonusen for manaden? */
  bonusforlust: boolean;
  /**
   * Fran och med vilket datum orderraknaren borjar om (fraga 45).
   *
   * Null nar ingen bonusforlust intraffat. Ar den satt raknar volymtrappan
   * BARA order signerade fran och med det datumet.
   */
  raknareFran: string | null;
  /** Handelserna som ligger bakom, for underlaget och for vyn. */
  handelser: Handelse[];
};

/**
 * Manadens lage for en person.
 *
 * `handelser` far garna vara personens hela historik — funktionen plockar sjalv
 * ut manadens godkanda rader, av samma skal som `raknaUnderlag` tar emot hela
 * ordermaterialet: ett filter som anroparen ansvarar for ar ett filter nagon
 * glommer.
 */
export function konsekvenslageFor(handelser: Handelse[], manad: string): Konsekvenslage | null {
  const manadens = handelser
    .filter((h) => raknas(h) && manadFor(h) === manad)
    .sort((a, b) => a.occurred_on.localeCompare(b.occurred_on));

  if (manadens.length === 0) return null;

  const forluster = manadens.filter((h) => h.atgard === "bonusforlust");

  return {
    bonusforlust: forluster.length > 0,
    // SENASTE forlusten, inte den forsta. Tva bonusforluster i samma manad
    // nollstaller raknaren tva ganger, och det ar den sista som galler.
    raknareFran: forluster.length > 0 ? forluster[forluster.length - 1].occurred_on : null,
    handelser: manadens,
  };
}

/**
 * Manadens lage for VARJE person i materialet.
 *
 * ETT LAGE PER PERSON, raknat ur bara den personens rader. Matas
 * `konsekvenslageFor` hela hogen smittar en annans bonusforlust vidare till
 * alla i manaden — samma sorts fel som personfiltret i `raknaUnderlag` finns
 * for att hindra, och det ar darfor filtret ligger har och inte hos anroparen.
 */
export function lagenPerPerson(
  handelser: Handelse[],
  manad: string,
): Map<string, Konsekvenslage> {
  const ut = new Map<string, Konsekvenslage>();

  for (const person of new Set(handelser.map((h) => h.employee_id))) {
    const lage = konsekvenslageFor(
      handelser.filter((h) => h.employee_id === person),
      manad,
    );
    if (lage) ut.set(person, lage);
  }

  return ut;
}

/**
 * Vad saljarens progressvy ska varna om (avsnitt 9.1).
 *
 * `null` nar det inte finns nagot att varna om. Vyn ska inte visa en tom ruta
 * som sager "noll ogiltiga franvaroer" — den upplysningen ar inte en upplysning,
 * och att staendigt paminna nagon om en trappa hen inte ar pa ar precis den
 * sortens anvandning K12 avsnitt 4 varnar for.
 */
export type Varningslage = {
  /** Antal godkanda handelser i fonstret just nu. */
  antal: number;
  /** Vad NASTA handelse skulle leda till. Null nar trappan tar slut. */
  nasta: Konsekvensregel | null;
  /** Datumet da fonstret ar tomt igen (fraga 47). */
  nollstallsDen: string;
  /** Hela manader kvar dit, for texten "2 manader kvar". */
  manaderKvar: number;
};

export function varningslage(
  handelser: Handelse[],
  regler: Konsekvensregel[],
  idag: string,
): Varningslage | null {
  // Det langsta fonstret nagon regel anvander avgor hur langt bakat det
  // overhuvudtaget ar meningsfullt att titta.
  const langst = regler.reduce((m, r) => Math.max(m, r.periodlangd_manader), 0);
  if (langst === 0) return null;

  const inne = iFonstret(handelser, idag, langst).sort((a, b) =>
    a.occurred_on.localeCompare(b.occurred_on),
  );
  if (inne.length === 0) return null;

  const senaste = inne[inne.length - 1];

  // NOLLSTALLNINGEN RAKNAS FRAN DEN SENASTE (fraga 47). Att den ar samma dag
  // som fonstret blir tomt ar ingen slump — se `iFonstret`.
  const nollstallsDen = manaderFore(senaste.occurred_on, -langst);

  return {
    antal: inne.length,
    nasta: trappstegFor(regler, handelser, idag),
    nollstallsDen,
    manaderKvar: helaManaderMellan(idag, nollstallsDen),
  };
}

/**
 * Hela manader mellan tva datum, nedat. Underlaget till "2 manader kvar".
 *
 * Nedat och inte narmast: den som har 2 manader och 29 dagar kvar ska lasa
 * "2 manader kvar" och bli av med varningen senare an hen trodde, inte tidigare.
 */
export function helaManaderMellan(fran: string, till: string): number {
  if (till <= fran) return 0;
  let n = 0;
  while (manaderFore(till, n + 1) >= fran) n++;
  return n;
}
