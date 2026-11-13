/**
 * Säljtavlans möten: vilka bokade möten som räknas, och hur de syns på tavlan.
 *
 * Ren logik utan anrop och utan Next, provad med node (`tests/salesboard-moten.mjs`).
 * `tavlan.ts` läser raderna, `forma.ts` lägger bilden, och här står reglerna.
 *
 * ===========================================================================
 * ETT MÖTE RÄKNAS NÄR ETT BOLAG FÅR SITT MÖTE, INTE NÄR ETT MÖTE BOKAS OM.
 *
 * Beställaren 2026-11-13: "säkerställ att möten som bokas om inte räknas som
 * ett nytt möte".
 *
 *  - Bara `art = 'ny'`. En ombokning och en uppföljning räknas aldrig.
 *  - Ett flyttat möte är samma rad (`antal_flyttningar`) och räknas en gång.
 *  - Ett möte med ett bolag som haft ett möte (av vilken art som helst, bokat
 *    av vem som helst) de senaste `DUBBLETT_DAGAR` dagarna räknas inte, också
 *    när det bokats som nytt. Samma bolag är samma bolags-id, samma telefon,
 *    samma domän eller samma namn utan bolagsform och skiljetecken. ORION CAR AB
 *    låg två gånger i Möten med olika nummer, och mötet 10/11 var en
 *    fortsättning på mötet 5/11: bara det första räknas.
 *  - Ett raderat möte finns inte och räknas inte. Ett firande som redan
 *    spelats tas inte tillbaka.
 * ===========================================================================
 *
 * ===========================================================================
 * INGET OM KUNDEN LÄMNAR SERVERN.
 *
 * Bolagets namn, telefon och domän läses bara för att känna igen samma bolag.
 * Bilden (`TavleMoten`) bär nycklar (hashar), vem som bokade, när och hur
 * många. En dold säljare får inget personligt, som på orderna (R23).
 * ===========================================================================
 */

import { svensktDatum } from "../klocka.ts";
import type { TavleBokare, TavleMote, TavleMoten, TavlePerson } from "./typer.ts";

/** Ett möte med ett bolag som haft ett möte så här nära inpå är en fortsättning, inget nytt möte. */
export const DUBBLETT_DAGAR = 90;

const DAG_MS = 86_400_000;

/** En rad ur `mote` med kedjans bolag, så som `tavlan.ts` läser den. */
export type RaMote = {
  id: string;
  bokat_av: string | null;
  bokat_nar: string | null;
  /** "ny", "ombokning" eller "uppfoljning". */
  art: string | null;
  kedja?: {
    bolag_id?: string | null;
    bolag?: { namn?: string | null; telefon?: string | null; doman?: string | null } | null;
  } | null;
};

// -----------------------------------------------------------------------------
// Samma bolag
// -----------------------------------------------------------------------------

/** Bolagsformer som inte skiljer två bolag åt: "Orion Car AB" och "ORION CAR" är samma. */
const FORMER = new Set(["ab", "aktiebolag", "publ", "hb", "handelsbolag", "kb", "kommanditbolag"]);

/**
 * Namnet utan bolagsform, skiljetecken och mellanrum, med gemener: "ORION CAR AB"
 * blir "orioncar". Null när det som blir kvar är för kort för att säga något
 * (två tecken eller färre): då hade två olika bolag kunnat bli samma.
 */
export function normNamn(namn: unknown): string | null {
  if (typeof namn !== "string") return null;
  const ord = namn
    .normalize("NFKC")
    .toLocaleLowerCase("sv-SE")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((o) => o && !FORMER.has(o));
  const ut = ord.join("");
  return ut.length > 2 ? ut : null;
}

/**
 * Telefonnumret som siffror i svensk form: "+46 70-677 47 73" blir "0706774773".
 * Null när det är för kort för att vara ett nummer.
 */
export function normTelefon(telefon: unknown): string | null {
  if (typeof telefon !== "string") return null;
  let s = telefon.replace(/\D/g, "");
  if (s.startsWith("0046")) s = `0${s.slice(4)}`;
  else if (s.startsWith("46")) s = `0${s.slice(2)}`;
  return s.length >= 7 ? s : null;
}

/** Domäner som många bolag delar: en gmail-adress säger inget om vilket bolag det är. */
const DELADE_DOMANER = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.se",
  "outlook.com",
  "outlook.se",
  "live.com",
  "live.se",
  "msn.com",
  "yahoo.com",
  "yahoo.se",
  "icloud.com",
  "me.com",
  "telia.com",
  "bredband.net",
  "spray.se",
  "comhem.se",
  "bahnhof.se",
]);

/**
 * Domänen utan protokoll, "www.", sökväg och port: "https://www.Orion.se/om" blir
 * "orion.se". Null utan punkt, och för domäner som många bolag delar.
 */
export function normDoman(doman: unknown): string | null {
  if (typeof doman !== "string") return null;
  const d = doman
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#:]/)[0]
    .replace(/\.$/, "");
  if (!d.includes(".") || d.length < 4 || DELADE_DOMANER.has(d)) return null;
  return d;
}

/** Allt som känner igen mötets bolag, som nycklar: id, namn, telefon och domän. */
function bolagsnycklar(m: RaMote): string[] {
  const k = m.kedja ?? null;
  const b = k?.bolag ?? null;
  return [
    k?.bolag_id ? `b:${k.bolag_id}` : null,
    b ? normNamn(b.namn) && `n:${normNamn(b.namn)}` : null,
    b ? normTelefon(b.telefon) && `t:${normTelefon(b.telefon)}` : null,
    b ? normDoman(b.doman) && `d:${normDoman(b.doman)}` : null,
  ].filter((x): x is string => typeof x === "string");
}

// -----------------------------------------------------------------------------
// Vilka som räknas
// -----------------------------------------------------------------------------

const ms = (iso: string | null): number => (iso ? Date.parse(iso) : NaN);

/** Raderna med en bokningstid som går att läsa, den äldsta först. Lika tider ordnas på id, så att svaret aldrig vacklar. */
function tidsordnade(rader: readonly RaMote[]): RaMote[] {
  return rader
    .filter((m) => Number.isFinite(ms(m.bokat_nar)))
    .sort((a, b) => ms(a.bokat_nar) - ms(b.bokat_nar) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Id:na för de möten som räknas (se rubriken). Raderna ska börja minst
 * `DUBBLETT_DAGAR` dagar före det första mötet som ska avgöras: ett möte i
 * början av raderna har ingen historik att jämföras med och räknas.
 *
 * Fönstret räknas från bolagets senaste möte, inte från det första: ett bolag
 * som träffas var sjätte vecka är samma kundrelation hela vägen.
 */
export function raknadeMoten(rader: readonly RaMote[]): Set<string> {
  const senast = new Map<string, number>();
  const ut = new Set<string>();
  for (const m of tidsordnade(rader)) {
    const t = ms(m.bokat_nar);
    const nycklar = bolagsnycklar(m);
    const fortsattning = nycklar.some((k) => {
      const s = senast.get(k);
      return s !== undefined && t - s <= DUBBLETT_DAGAR * DAG_MS;
    });
    if (m.art === "ny" && m.bokat_av && !fortsattning) ut.add(m.id);
    for (const k of nycklar) senast.set(k, t);
  }
  return ut;
}

/**
 * Bokarna vars första rad (av vilken art som helst) är från `idag`. Har de bokat
 * något före raderna vet bara databasen det: `tavlan.ts` frågar för just dem, och
 * svaret går tillbaka in som `tidigare`. Oftast är listan tom.
 */
export function forstaKandidater(rader: readonly RaMote[], idag: string): string[] {
  const forst = new Map<string, string>();
  for (const m of tidsordnade(rader)) {
    if (m.bokat_av && !forst.has(m.bokat_av)) forst.set(m.bokat_av, m.bokat_nar as string);
  }
  return [...forst].filter(([, tid]) => svensktDatum(tid) === idag).map(([id]) => id);
}

// -----------------------------------------------------------------------------
// Bilden
// -----------------------------------------------------------------------------

/** Allt `formaMoten` behöver. */
export type Motesunderlag = {
  /** Mötena från `motesfonster().fran` och framåt, av alla arter. */
  rader: readonly RaMote[];
  /** Bokare som har möten före raderna (`forstaKandidater` och en fråga). */
  tidigare: ReadonlySet<string>;
  /** Svensk dag, "2026-11-13". */
  idag: string;
  /** Månaden, "2026-11". */
  manad: string;
  /** Står personen i laget som tavlan visar? */
  iLaget: (id: string) => boolean;
  /** Personen som tavlan får se hen (dold eller inte). */
  person: (id: string) => TavlePerson;
  nyckel: (id: string) => string;
  /** Aktiva mötesbokare i laget (rollen `meeting_booker`): de står i listan också med noll möten. */
  kandidater: readonly string[];
};

/** Mötesdelen av bilden, och vilka personer den behöver i `personer`. */
export function formaMoten(u: Motesunderlag): { moten: TavleMoten; personer: string[] } {
  const ordnade = tidsordnade(u.rader);
  const raknas = raknadeMoten(ordnade);

  // Första mötet någonsin: bokarens första rad över huvud taget, och inget före raderna.
  const forstaRad = new Map<string, string>();
  for (const m of ordnade) if (m.bokat_av && !forstaRad.has(m.bokat_av)) forstaRad.set(m.bokat_av, m.id);

  const lopande = new Map<string, number>();
  const lista: TavleMote[] = [];
  const perManad = new Map<string, number>();
  const perDag = new Map<string, number>();
  let manad = 0;

  for (const m of ordnade) {
    const vem = m.bokat_av;
    if (!vem || !raknas.has(m.id) || !u.iLaget(vem)) continue;
    const dag = svensktDatum(m.bokat_nar as string);
    if (dag.slice(0, 7) === u.manad) {
      manad++;
      perManad.set(vem, (perManad.get(vem) ?? 0) + 1);
    }
    if (dag !== u.idag) continue;
    const n = (lopande.get(vem) ?? 0) + 1;
    lopande.set(vem, n);
    perDag.set(vem, n);
    const dold = u.person(vem).dold;
    lista.push({
      nyckel: u.nyckel(m.id),
      person: u.nyckel(vem),
      tid: new Date(ms(m.bokat_nar)).toISOString(),
      dag,
      // En dold säljare får inget personligt (R23), och talen som avgör det lämnar inte servern.
      forstaNagonsin: !dold && forstaRad.get(vem) === m.id && !u.tidigare.has(vem),
      bokarensDagsantal: dold ? 0 : n,
    });
  }

  const ids = [...new Set([...u.kandidater.filter(u.iLaget), ...perManad.keys(), ...perDag.keys()])];
  const bokare: TavleBokare[] = ids
    .filter((id) => !u.person(id).dold)
    .map((id) => ({ person: u.nyckel(id), idag: perDag.get(id) ?? 0, manad: perManad.get(id) ?? 0 }));

  return {
    moten: { idag: lista.length, manad, lista: lista.reverse(), bokare },
    // Också de dolda: mötet ska kunna stå med "En säljare" när det firas för laget.
    personer: ids,
  };
}

/**
 * Fönstret som raderna läses i: från svensk midnatt `DUBBLETT_DAGAR` dagar före
 * månadens första dag, så att varje möte i månaden kan jämföras med sina 90 dagar.
 */
export function motesfonsterFran(manadensForsta: string): string {
  const [ar, man, dag] = manadensForsta.split("-").map(Number);
  // Midnatt i Sverige är 22 eller 23 UTC dagen före; en dag extra bakåt räcker gott.
  return new Date(Date.UTC(ar, man - 1, dag) - (DUBBLETT_DAGAR + 1) * DAG_MS).toISOString();
}
