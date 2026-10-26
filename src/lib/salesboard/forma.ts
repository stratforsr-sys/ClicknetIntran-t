/**
 * Säljtavlans ögonblicksbild ur databasens rader.
 *
 * Ren logik utan anrop, utan Next och utan Supabase, så att den går att prova
 * med node (`tests/salesboard-server.mjs`). `tavlan.ts` läser raderna med
 * service role och lämnar dem hit, och allt som avgör vad tavlan visar står
 * här. Importerna är relativa med `.ts`, som i `regler.ts`.
 *
 * ===========================================================================
 * HÄR BLIR RADERNA DISPLAY-SÄKRA, FÄLT FÖR FÄLT.
 *
 * Raderna som kommer in bär employee-id, order-id och, beroende på frågan,
 * annat som inte får synas på en TV. Det som går ut är bara det `Ogonblick`
 * har plats för, och varje fält plockas för hand. Inget kopieras med
 * spridning (`...rad`), så ett nytt fält i en fråga kan aldrig följa med av
 * misstag. Id:n blir nycklar genom `rader.nyckel` (sha256, `nyckel.ts`), och
 * en dold säljares namn byts ut innan det lämnar den här filen.
 *
 * Nyckelfunktionen släpps in i stället för att importeras, eftersom hashen
 * kommer ur `node:crypto` och den här filen ska gå att läsa var som helst.
 * ===========================================================================
 *
 * Talen följer Golvet (`nav2/hem.ts`) och Provision: månadens antal är
 * `nettoAntal`, och ordervärdet räknas på samma sätt (godkända i månaden minus
 * makulerade i den). Målet är månadens mål i kronor ur inställningarna (R35), och
 * arbetsdagarna kommer ur `saljtakt.ts`. Dagen och klockan är svenska (`klocka.ts`).
 */

import { dagarBakat, svenskTidpunkt, svensktDatum } from "../klocka.ts";
import { harGodkants, nettoAntal, raknas, type Order, type Orderstatus } from "../order.ts";
import { MINSTA_DAGAR_FOR_PROGNOS, arbetsdagarIManad, arbetsdagarTill } from "../saljtakt.ts";
import { malFor, tavlingFor } from "./installningar.ts";
import {
  AKTIVA_STATUSAR,
  MINSTA_UNDERLAG,
  RESERV_TROSKEL,
  SALJANDE_ROLLER,
  arDold,
  arEfterregistrerad,
  initialerFor,
  visningsnamn,
} from "./regler.ts";
import type {
  Ogonblick,
  TavleHandelse,
  TavleManad,
  TavleOrder,
  TavlePerson,
  TavleSaljare,
  TavlansInstallningar,
  TavleTavling,
  TavleVinnare,
  Testtyp,
  Visning,
} from "./typer.ts";

// -----------------------------------------------------------------------------
// Raderna, så som `tavlan.ts` läser dem
// -----------------------------------------------------------------------------

/** En anställd: bara det som behövs för namnet, laget och om hen står i topplistan. */
export type RaTavlePerson = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  team_id: string | null;
  /** "active", "onboarding", "left" … Bara aktiva säljare står i topplistan utan order. */
  status?: string | null;
  employee_role?: { role: string }[] | null;
};

/**
 * Säljarens val i `salesboard_person` (0250). `display` läses som okänd med
 * flit: bara "namn" och "initialer" visar något (se `arDold`).
 */
export type RaTavleVal = { employee_id: string; display: unknown };

export type RaTavlePaket = { id: number; label: string };

/** En order ur `sales_order`, med de kolumner tavlan läser och inga andra. */
export type RaTavleOrder = {
  id: string;
  salesperson_id: string;
  package_id: number | null;
  term_months: number | null;
  /** Signeringsdagen, "2026-10-16". */
  signed_on: string | null;
  /** Signeringsmånaden, "2026-10-01". */
  period_month: string | null;
  status: string;
  /** Numeric i databasen. PostgREST ger ett tal, en direkt Postgres-läsning kan ge text. */
  order_value: number | string | null;
  /** "manual" är en fri order, utanför paketen (se `nav2/orderforma.ts`). */
  order_value_source: string | null;
  approved_at: string | null;
  /** Makuleringsdagen. Bara ett datum, inget klockslag. */
  cancelled_on: string | null;
  cancel_period_month: string | null;
};

/** En rad ur `salesboard_event` (0250). */
export type RaTavleHandelse = { id: number | string; kind: string; payload: unknown; created_at: string };

/** Svaret från `salesboard_statistik` (0250), läst genom `lasStatistik`. */
export type Tavlestatistik = {
  /** Per säljare: id för hens första godkända order någonsin, och hens bästa dag före i dag. */
  saljare: { id: string; forsta: string | null; basta: number }[];
  /** 90:e percentilen av de senaste 90 dagarnas ordervärden, eller null utan värden. */
  p90: number | null;
  /** Hur många order p90 räknades på. */
  antal90: number;
  /** Lagets största dagsantal tidigare i månaden. */
  bastaDag: number;
  /** De tidigare månadernas antal och ordervärde netto, för grafen. Månaden som "2026-09-01". */
  manader: { manad: string; antal: number; varde: number }[];
};

/** Allt `formaOgonblick` behöver ur databasen. */
export type TavlansRader = {
  /** Laget som gäller, eller null för alla. `tavlan.ts` har redan slagit upp att det finns. */
  lag: { id: string; namn: string } | null;
  /** Commit-sha för bygget. */
  bygge: string;
  /** Alla anställda. Laget väljs här, på `team_id`. */
  personer: RaTavlePerson[];
  /** Säljarnas val. Den som saknar rad har inte valt något och visas med namn. */
  val: RaTavleVal[];
  paket: RaTavlePaket[];
  /** Order med `period_month` eller `cancel_period_month` i månaden. */
  manadens: RaTavleOrder[];
  /** Godkända från och med `tavlansFonster().senasteFran`. */
  senaste: RaTavleOrder[];
  /** Statistiken, eller null när funktionen inte finns än (0250 är inte körd). */
  statistik: Tavlestatistik | null;
  /** Testhändelserna från `tavlansFonster().handelserFran`. */
  handelser: RaTavleHandelse[];
  /**
   * Förra månadens order (`period_month` eller `cancel_period_month` i den), bara när
   * vinnaren ska visas (`vinnarensManad`). Annars tom eller utelämnad.
   */
  forraManadens?: RaTavleOrder[];
  /** Id till nyckel. I servern `nyckelFor`. */
  nyckel: (id: string) => string;
};

// -----------------------------------------------------------------------------
// Fönstren
// -----------------------------------------------------------------------------

/** Orderlistan bär alla godkända i dag, men aldrig färre än så här. */
const ORDERLISTANS_MINSTA = 8;

/** Så många svenska dagar bakåt läses orderlistan. */
const ORDERLISTANS_DAGAR = 14;

/** Testhändelserna från de senaste tio minuterna (spec §8). */
const HANDELSER_MS = 600_000;

/** Grafen visar så många månader före den här. */
const HISTORIKENS_MANADER = 11;

/** Månadernas korta namn i grafen. */
const MANADER_KORT = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

/** Månadernas namn, som tavlan skriver dem. */
const MANADER = [
  "Januari", "Februari", "Mars", "April", "Maj", "Juni",
  "Juli", "Augusti", "September", "Oktober", "November", "December",
];

/** Första dagen i månaden före: "2026-09-01" för "2026-10-01" och "2025-12-01" för januari. */
function manadenFore(manad: string): string {
  const ar = Number(manad.slice(0, 4));
  const m = Number(manad.slice(5, 7));
  return m === 1 ? `${ar - 1}-12-01` : `${ar}-${String(m - 1).padStart(2, "0")}-01`;
}

/**
 * Dagarna och gränserna en bild byggs på, ur samma `nu` som bilden. `tavlan.ts`
 * frågar med de här gränserna, och `formaOgonblick` räknar med dem, så att
 * frågan och räkningen inte kan glida isär.
 */
export function tavlansFonster(nu: Date): {
  /** Svensk dag, "2026-10-23". */
  idag: string;
  /** Månaden, "2026-10-01". */
  manad: string;
  /** Svensk midnatt fjorton dagar bakåt, ISO. */
  senasteFran: string;
  /** Tio minuter bakåt, ISO. */
  handelserFran: string;
} {
  const idag = svensktDatum(nu);
  const manad = `${idag.slice(0, 7)}-01`;
  return {
    idag,
    manad,
    senasteFran: svenskTidpunkt(dagarBakat(idag, ORDERLISTANS_DAGAR), "00:00").toISOString(),
    handelserFran: new Date(nu.getTime() - HANDELSER_MS).toISOString(),
  };
}

/** Prisbildens adress på tavlan. Bilden ligger bakom tavlans egen åtkomst (`/salesboard/bild`). */
export const bildAdress = (id: string | null): string | null => (id ? `/salesboard/bild?id=${id}` : null);

/**
 * Månaden vars vinnare ska visas, "2026-09-01", eller null. Vinnaren visas första
 * arbetsdagen i nästa månad, och bara om förra månadens tävling var på.
 * `tavlan.ts` läser förra månadens order bara då.
 */
export function vinnarensManad(installningar: TavlansInstallningar, nu: Date): string | null {
  const { idag, manad } = tavlansFonster(nu);
  if (arbetsdagarIManad(manad)[0] !== idag) return null;
  const forra = manadenFore(manad);
  return tavlingFor(installningar.tavling, forra.slice(0, 7)) ? forra : null;
}

// -----------------------------------------------------------------------------
// Stor affär och statistiken
// -----------------------------------------------------------------------------

/**
 * Tröskeln för stor affär ur statistiken: samma regel som `storAffarTroskel`,
 * men p90 räknas i databasen (`salesboard_statistik`) i stället för ur varje
 * ordervärde, som API:t hade kapat tyst vid tusen rader.
 *
 * Det fasta beloppet i läget "belopp". I "auto" p90 när den räknats på minst
 * tjugo order, annars 30 000 kr, och det oavsett det fasta beloppet. Gränserna
 * är `regler.ts`:s egna konstanter, och provet håller de två funktionerna i takt.
 */
export function troskelFranStatistik(
  p90: number | null,
  antal90: number,
  val: TavlansInstallningar["firande"]["storAffar"],
): number {
  if (val.lage === "belopp") return val.belopp;
  return antal90 >= MINSTA_UNDERLAG && p90 !== null ? p90 : RESERV_TROSKEL;
}

/** Statistiken när den saknas: ingen första order, inga bästa dagar, ingen p90. */
const TOM_STATISTIK: Tavlestatistik = { saljare: [], p90: null, antal90: 0, bastaDag: 0, manader: [] };

/** Ett ändligt tal, också negativt (en månad med fler makuleringar än order), annars noll. */
const talUr = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);

/** Ett antal: ett ändligt tal, noll eller mer, i hela tal. Allt annat är noll. */
const antalUr = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);

/**
 * Läser svaret från `salesboard_statistik`. Det är jsonb och kan i princip vara
 * vad som helst, så det läses fält för fält, som inställningarna. Det som inte
 * är ett objekt ger null, och ett fält som inte går att läsa får sin standard.
 */
export function lasStatistik(data: unknown): Tavlestatistik | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;

  const saljare: Tavlestatistik["saljare"] = [];
  if (Array.isArray(d.saljare)) {
    for (const s of d.saljare as unknown[]) {
      if (typeof s !== "object" || s === null) continue;
      const r = s as Record<string, unknown>;
      if (typeof r.id !== "string") continue;
      saljare.push({ id: r.id, forsta: typeof r.forsta === "string" ? r.forsta : null, basta: antalUr(r.basta) });
    }
  }

  const manader: Tavlestatistik["manader"] = [];
  if (Array.isArray(d.manader)) {
    for (const m of d.manader as unknown[]) {
      if (typeof m !== "object" || m === null) continue;
      const r = m as Record<string, unknown>;
      if (typeof r.manad !== "string" || !/^\d{4}-\d{2}-01$/.test(r.manad)) continue;
      manader.push({ manad: r.manad, antal: Math.round(talUr(r.antal)), varde: talUr(r.varde) });
    }
  }

  return {
    saljare,
    manader,
    p90: typeof d.p90 === "number" && Number.isFinite(d.p90) ? d.p90 : null,
    antal90: antalUr(d.antal90),
    bastaDag: antalUr(d.bastaDag),
  };
}

// -----------------------------------------------------------------------------
// Personerna
// -----------------------------------------------------------------------------

/**
 * Säljaren så som tavlan får se hen.
 *
 * ===========================================================================
 * DOLD AVGÖRS AV `arDold` (regler.ts), OCH DOLD BETYDER BÅDE NAMNET OCH MOTIVET.
 *
 * Allt utom exakt "namn" och "initialer" är dolt: "dold", null, ett stavfel, en
 * form som inte finns än. En dold säljare står inte i topplistan och får inget
 * personligt i firandet (R23): ingen första order, inget personbästa.
 * ===========================================================================
 *
 * En säljare som inte finns bland personerna har inget namn att visa och är
 * därför också dold.
 */
function tavlePerson(
  id: string,
  person: RaTavlePerson | undefined,
  val: RaTavleVal | undefined,
  namnform: TavlansInstallningar["namn"],
  nyckel: (id: string) => string,
): TavlePerson {
  // Utan rad har säljaren inte valt något, och då visas namnet (standarden i 0250).
  const visning: unknown = val ? val.display : "namn";
  const dold = !person || arDold(visning);
  const visas: Visning = dold ? "dold" : (visning as Visning);
  // En dold säljares namn lämnas inte ens till namnfunktionerna.
  const fornamn = dold ? "" : (person?.first_name ?? "");
  const efternamn = dold ? "" : (person?.last_name ?? "");

  return {
    nyckel: nyckel(id),
    namn: visningsnamn(fornamn, efternamn, namnform, visas),
    initialer: initialerFor(fornamn, efternamn, visas),
    dold,
  };
}

// -----------------------------------------------------------------------------
// Orderna
// -----------------------------------------------------------------------------

/** Klockslaget som millisekunder, eller NaN när det saknas eller inte går att läsa. */
const ms = (iso: string | null): number => (iso ? Date.parse(iso) : NaN);

/** Har ordern ett godkännande som går att läsa? Bara de kan placeras i tid. */
const harTid = (o: RaTavleOrder): o is RaTavleOrder & { approved_at: string } => Number.isFinite(ms(o.approved_at));

/** Godkännandet som ISO med Z, oavsett hur databasen skrev det. */
const iso = (tid: string): string => new Date(Date.parse(tid)).toISOString();

/**
 * Äldst först: godkännandet, och vid lika tid id:t, så att ordningen är densamma
 * varje gång. Listan och säljarens dagsantal räknar åt samma håll. Tar bara
 * order som `harTid` släppt igenom.
 */
function tidsordning(a: RaTavleOrder, b: RaTavleOrder): number {
  const skillnad = ms(a.approved_at) - ms(b.approved_at);
  if (skillnad !== 0) return skillnad;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Ordervärdet som tal, eller null när det saknas eller inte går att läsa. */
function vardeFor(o: RaTavleOrder): number | null {
  if (o.order_value === null || o.order_value === undefined) return null;
  const varde = Number(o.order_value);
  return Number.isFinite(varde) ? varde : null;
}

/**
 * Paketets namn. En fri order (värdet satt för hand, utanför paketen) och en
 * order vars paket inte finns heter "Fri order".
 */
function paketFor(o: RaTavleOrder, paket: Map<number, string>): string {
  if (o.order_value_source === "manual") return "Fri order";
  const namn = o.package_id !== null ? paket.get(o.package_id) : undefined;
  return namn || "Fri order";
}

/** Bindningstiden i hela månader, eller null när den saknas. */
const bindningFor = (o: RaTavleOrder): number | null =>
  typeof o.term_months === "number" && Number.isFinite(o.term_months) && o.term_months > 0 ? Math.round(o.term_months) : null;

/** Listan utan dubbletter, i den ordning de först förekommer. */
const unika = <T>(lista: readonly T[]): T[] => [...new Set(lista)];

/** Räknas ordern i månaden: godkänd någon gång och signerad i den. Som `orderIPeriod`. */
const iManaden = (o: RaTavleOrder, manad: string): boolean =>
  harGodkants(o.status as Orderstatus) && o.period_month === manad;

/** Makulerad i månaden. Som `makuleradeIPeriod`. */
const makuleradI = (o: RaTavleOrder, manad: string): boolean =>
  o.status === "makulerad" && o.cancel_period_month === manad;

/**
 * När laget nådde målet: godkännandet där ordervärdet, räknat netto fram till
 * dess, först nådde målet. Null när målet inte är nått nu.
 *
 * Godkännandena räknas i tidsordning. En makulering i månaden drar sitt värde från
 * godkännanden dagen efter `cancelled_on` och senare. Den bär bara ett datum,
 * och samma dag räknas den efter dagens godkännanden: tavlan gissar inte på
 * ett klockslag som inte finns.
 */
function nattFor(manadens: RaTavleOrder[], manad: string, mal: number | null, varde: number): string | null {
  if (mal === null || varde < mal) return null;

  const godkannanden = manadens.filter((o) => iManaden(o, manad)).filter(harTid).sort(tidsordning);
  // En makulering utan datum räknas från början, så att den aldrig flyttar natt bakåt.
  const makuleringar = manadens
    .filter((o) => makuleradI(o, manad))
    .map((o) => ({ dag: o.cancelled_on ?? "", varde: vardeFor(o) ?? 0 }));

  let summa = 0;
  for (const o of godkannanden) {
    summa += vardeFor(o) ?? 0;
    const dag = svensktDatum(o.approved_at);
    const avdrag = makuleringar.filter((m) => m.dag < dag).reduce((s, m) => s + m.varde, 0);
    if (summa - avdrag >= mal) return iso(o.approved_at);
  }
  return null;
}

// -----------------------------------------------------------------------------
// Testhändelserna
// -----------------------------------------------------------------------------

const TESTTYPER: readonly Testtyp[] = ["order", "stor", "forsta", "serie", "malet"];

/**
 * En testhändelse, eller null. Payloaden skrivs av inställningarnas `testa`
 * som `{typ}`, och en typ som inte finns spelas inte.
 */
function lasHandelse(h: RaTavleHandelse): TavleHandelse | null {
  const id = Number(h.id);
  const typ = typeof h.payload === "object" && h.payload !== null ? (h.payload as Record<string, unknown>).typ : undefined;
  const testtyp = TESTTYPER.find((t) => t === typ);
  if (!Number.isSafeInteger(id) || !testtyp || !Number.isFinite(ms(h.created_at))) return null;
  return { id, typ: testtyp, tid: iso(h.created_at) };
}

// -----------------------------------------------------------------------------
// Bilden
// -----------------------------------------------------------------------------


/** Månaden `n` månader före `manad` ("2026-10-01" → "2026-07-01" för n = 3). */
function manaderFore(manad: string, n: number): string {
  let m = manad;
  for (let i = 0; i < n; i++) m = manadenFore(m);
  return m;
}

/** Ordervärdet netto: godkända i månaden minus makulerade i den, för de order som skickas in. */
function nettoVarde(order: readonly RaTavleOrder[], manad: string): number {
  let summa = 0;
  for (const o of order) {
    if (iManaden(o, manad)) summa += vardeFor(o) ?? 0;
    if (makuleradI(o, manad)) summa -= vardeFor(o) ?? 0;
  }
  return summa;
}

/** Måndag 0 till söndag 6 för en svensk dag. */
function veckodag(datum: string): number {
  const [ar, manad, dag] = datum.split("-").map(Number);
  return (new Date(Date.UTC(ar, manad - 1, dag)).getUTCDay() + 6) % 7;
}

/**
 * Bygger ögonblicksbilden ur raderna.
 *
 * - **Laget** är `rader.lag`, annars alla. Order räknas för dem som står i laget
 *   nu, som på Golvet och i `salesboard_statistik`.
 * - **Månaden** är ordervärdet netto mot månadens mål i kronor (`malFor`), och
 *   antalet som statistik. Takten är målet gånger andelen gångna arbetsdagar, och
 *   prognosen värdet framskrivet på arbetsdagarna, från arbetsdag tre.
 * - **Topplistan** är de aktiva i laget vars roll kan sälja (R30), och alla som
 *   har order som räknas i månaden eller godkänts i veckan, utom de dolda. Talen är månadens netto och
 *   veckans godkända per dag.
 * - **Orderna** är alla godkända i dag och de åtta senaste inom fjorton dagar,
 *   den nyaste först. Planeringen firar bara det som finns i bilden, så dagen
 *   får aldrig kapas.
 * - **Grafen** är de elva månaderna före, ur statistiken, med målet som gällde.
 * - **Testhändelserna** är de från de senaste tio minuterna.
 *
 * `installningar.lag` och `installningar.mal` går inte ut: laget har `tavlan.ts`
 * redan slagit upp, och målen står som tal i månaden och grafen.
 */
export function formaOgonblick(
  rader: TavlansRader,
  installningar: TavlansInstallningar,
  nu: Date,
  skarm: { namn: string; ljud: boolean } | null,
): Ogonblick {
  const { nyckel } = rader;
  const fonster = tavlansFonster(nu);
  const { idag, manad } = fonster;

  // --- Laget ------------------------------------------------------------------
  const lag = rader.lag;
  const laget = new Set(rader.personer.filter((p) => lag !== null && p.team_id === lag.id).map((p) => p.id));
  const iLaget = (id: string): boolean => lag === null || laget.has(id);
  const manadens = rader.manadens.filter((o) => iLaget(o.salesperson_id));

  // --- Månaden ------------------------------------------------------------------
  const antal = nettoAntal(manadens as unknown as Order[], manad);
  const varde = nettoVarde(manadens, manad);
  const mal = malFor(installningar.mal, manad.slice(0, 7));
  const totalt = arbetsdagarIManad(manad).length;
  const gangna = arbetsdagarTill(manad, idag).length;
  const forvantat = mal === null || totalt === 0 ? null : Math.round((mal * gangna) / totalt);
  const prognos = gangna >= MINSTA_DAGAR_FOR_PROGNOS && varde > 0 ? Math.round((varde * totalt) / gangna) : null;
  // Månadens största: bland det som räknas i månaden och inte makulerats i den.
  const raknade = manadens.filter((o) => iManaden(o, manad) && !makuleradI(o, manad));
  const storsta = raknade.reduce<number | null>((max, o) => {
    const v = vardeFor(o);
    return v !== null && (max === null || v > max) ? v : max;
  }, null);

  // --- Orderna ----------------------------------------------------------------------
  const fran = dagarBakat(idag, ORDERLISTANS_DAGAR);
  // Äldst först. Bara signerade och betalda: en makulerad order tas bort i tysthet.
  const godkanda = rader.senaste
    .filter((o) => iLaget(o.salesperson_id) && raknas(o.status as Orderstatus))
    .filter(harTid)
    .filter((o) => svensktDatum(o.approved_at) >= fran)
    .sort(tidsordning);

  // Säljarens antal den dagen, den här ordern inräknad, i samma ordning.
  const dagsantal = new Map<string, number>();
  const lopande = new Map<string, number>();
  for (const o of godkanda) {
    const nyckelDag = `${o.salesperson_id} ${svensktDatum(o.approved_at)}`;
    const n = (lopande.get(nyckelDag) ?? 0) + 1;
    lopande.set(nyckelDag, n);
    dagsantal.set(o.id, n);
  }

  const idagsOrder = godkanda.filter((o) => svensktDatum(o.approved_at) === idag);
  const nyastForst = [...godkanda].reverse();
  const valda = new Set([...idagsOrder, ...nyastForst.slice(0, ORDERLISTANS_MINSTA)].map((o) => o.id));
  const urval = nyastForst.filter((o) => valda.has(o.id));

  const statistik = rader.statistik ?? TOM_STATISTIK;
  const forstaFor = new Map(statistik.saljare.map((s) => [s.id, s.forsta]));
  const bastaFor = new Map(statistik.saljare.map((s) => [s.id, s.basta]));
  const troskel = troskelFranStatistik(statistik.p90, statistik.antal90, installningar.firande.storAffar);
  const paket = new Map(rader.paket.map((p) => [p.id, p.label]));
  const dagar = installningar.firande.efterregistreradDagar;

  // --- Personerna -----------------------------------------------------------------------
  const personRader = new Map(rader.personer.map((p) => [p.id, p]));
  const valRader = new Map(rader.val.map((v) => [v.employee_id, v]));
  const personFor = new Map<string, TavlePerson>();
  const person = (id: string): TavlePerson => {
    let p = personFor.get(id);
    if (!p) {
      p = tavlePerson(id, personRader.get(id), valRader.get(id), installningar.namn, nyckel);
      personFor.set(id, p);
    }
    return p;
  };

  const order = urval.map((o): TavleOrder => {
    const dag = svensktDatum(o.approved_at);
    const v = vardeFor(o);
    // En dold säljare får inget personligt (R23): ingen första order och inget personbästa,
    // och talen som avgör dem lämnar inte servern.
    const dold = person(o.salesperson_id).dold;
    return {
      nyckel: nyckel(o.id),
      person: nyckel(o.salesperson_id),
      tid: iso(o.approved_at),
      dag,
      paket: paketFor(o, paket),
      bindning: bindningFor(o),
      belopp: v,
      niva: v !== null && v >= troskel ? "stor" : "vanlig",
      efterreg: arEfterregistrerad(o.signed_on, dag, dagar),
      forstaNagonsin: !dold && forstaFor.get(o.salesperson_id) === o.id,
      saljarensDagsantal: dold ? 0 : (dagsantal.get(o.id) ?? 1),
      saljarensBasta: dold ? 0 : (bastaFor.get(o.salesperson_id) ?? 0),
      manaden: harGodkants(o.status as Orderstatus) && o.period_month === manad,
    };
  });

  // --- Topplistan -------------------------------------------------------------------------
  const vd = veckodag(idag);
  const mandag = dagarBakat(idag, vd);
  const veckan = [0, 1, 2, 3, 4].map((i) => dagarBakat(mandag, -i));
  const aktiva = new Set<string>(AKTIVA_STATUSAR);
  const kandidater = unika([
    ...rader.personer
      .filter((p) => iLaget(p.id) && aktiva.has(p.status ?? "") && (p.employee_role ?? []).some((r) => SALJANDE_ROLLER.has(r.role)))
      .map((p) => p.id),
    ...raknade.map((o) => o.salesperson_id),
    ...godkanda.filter((o) => veckan.includes(svensktDatum(o.approved_at))).map((o) => o.salesperson_id),
  ]);
  const saljare: TavleSaljare[] = [];
  for (const id of kandidater) {
    if (person(id).dold) continue;
    const egna = manadens.filter((o) => o.salesperson_id === id);
    const vecka: TavleSaljare["vecka"] = [0, 0, 0, 0, 0];
    for (const o of godkanda) {
      if (o.salesperson_id !== id) continue;
      const i = veckan.indexOf(svensktDatum(o.approved_at));
      if (i >= 0) vecka[i]++;
    }
    saljare.push({
      person: nyckel(id),
      antal: nettoAntal(egna as unknown as Order[], manad),
      varde: nettoVarde(egna, manad),
      vecka,
      idag: idagsOrder.filter((o) => o.salesperson_id === id).length,
    });
  }

  const personer: Record<string, TavlePerson> = {};
  for (const id of unika([...urval.map((o) => o.salesperson_id), ...kandidater])) {
    const p = person(id);
    personer[p.nyckel] = p;
  }

  // --- Grafen -------------------------------------------------------------------------------
  const perManad = new Map((statistik.manader ?? []).map((m) => [m.manad, m]));
  const historik: TavleManad[] = [];
  for (let n = HISTORIKENS_MANADER; n >= 1; n--) {
    const m = manaderFore(manad, n);
    const rad = perManad.get(m);
    historik.push({
      nyckel: m.slice(0, 7),
      namn: MANADER_KORT[Number(m.slice(5, 7)) - 1] ?? "",
      antal: rad?.antal ?? 0,
      varde: rad?.varde ?? 0,
      mal: malFor(installningar.mal, m.slice(0, 7)),
    });
  }

  // --- Testhändelserna --------------------------------------------------------------------
  const handelserFran = Date.parse(fonster.handelserFran);
  const handelser = rader.handelser
    .filter((h) => h.kind === "test" && ms(h.created_at) >= handelserFran)
    .map(lasHandelse)
    .filter((h): h is TavleHandelse => h !== null)
    .sort((a, b) => a.id - b.id);

  // --- Tävlingen --------------------------------------------------------------------------
  // Loppet räknar tavlan själv ur `saljare`, som redan är utan de dolda. Här står bara priset.
  const t = tavlingFor(installningar.tavling, manad.slice(0, 7));
  const tavling: TavleTavling | null = t ? { pris: t.pris, bild: bildAdress(t.bild), grans: t.grans, dagarKvar: Math.max(0, totalt - gangna) } : null;

  // Förra månadens vinnare: högst ordervärde netto i laget, utan de dolda, och minst gränsen.
  let vinnare: TavleVinnare | null = null;
  const vinnarensM = vinnarensManad(installningar, nu);
  const forraT = vinnarensM ? tavlingFor(installningar.tavling, vinnarensM.slice(0, 7)) : null;
  if (vinnarensM && forraT) {
    const perSaljare = new Map<string, RaTavleOrder[]>();
    for (const o of rader.forraManadens ?? []) {
      if (!iLaget(o.salesperson_id)) continue;
      perSaljare.set(o.salesperson_id, [...(perSaljare.get(o.salesperson_id) ?? []), o]);
    }
    const varden = [...perSaljare].filter(([id]) => !person(id).dold).map(([id, egna]) => ({ id, varde: nettoVarde(egna, vinnarensM) }));
    const hogst = Math.max(0, ...varden.map((v) => v.varde));
    const vann = hogst > 0 && (forraT.grans === null || hogst >= forraT.grans) ? varden.filter((v) => v.varde === hogst).map((v) => v.id) : [];
    for (const id of vann) {
      const p = person(id);
      personer[p.nyckel] = p;
    }
    vinnare = {
      nyckel: vinnarensM.slice(0, 7),
      manad: (MANADER[Number(vinnarensM.slice(5, 7)) - 1] ?? "").toLowerCase(),
      pris: forraT.pris,
      bild: bildAdress(forraT.bild),
      personer: vann.map((id) => nyckel(id)).sort(),
      varde: vann.length ? hogst : null,
      grans: forraT.grans,
    };
  }

  // Lagets id, målen och tävlingarna stannar här. Lagets namn står i `lag`, målen i månaden och grafen,
  // och den här månadens tävling i `tavling`.
  const { lag: _lagId, mal: _mal, tavling: _tavling, ...utanLag } = installningar;

  return {
    v: 1,
    nu: nu.toISOString(),
    bygge: rader.bygge,
    lag: lag?.namn ?? null,
    skarm: skarm ? { namn: skarm.namn, ljud: skarm.ljud } : null,
    installningar: utanLag,
    manad: {
      nyckel: manad.slice(0, 7),
      namn: MANADER[Number(manad.slice(5, 7)) - 1] ?? "",
      antal,
      varde,
      mal,
      forvantat,
      prognos,
      dagar: { gangna, totalt },
      natt: nattFor(manadens, manad, mal, varde),
      storsta,
    },
    idag: {
      datum: idag,
      veckodag: vd <= 4 ? vd : null,
      antal: idagsOrder.length,
      summa: idagsOrder.reduce((s, o) => s + (vardeFor(o) ?? 0), 0),
      bastaDag: statistik.bastaDag,
    },
    order,
    saljare,
    historik,
    personer,
    handelser,
    tavling,
    vinnare,
  };
}
