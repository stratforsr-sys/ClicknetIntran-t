/**
 * Säljtavlans inställningar: standarderna och tolkningen av det som sparats.
 *
 * Ren logik, inga anrop, så att den går att prova med node. Raden ligger i
 * `nav_setting` under nyckeln `salesboard`, skrivs av admin och läses av
 * servern, som skickar den vidare i ögonblicksbilden.
 *
 * ===========================================================================
 * ALLT SOM LÄSES UR DATABASEN GÅR GENOM `normalisera`, OCH DEN KASTAR ALDRIG.
 *
 * Tavlan hänger på en vägg och ingen rör den. En rad med volymen 400, tiden
 * "8:00" eller en äldre form som saknar ett fält får därför aldrig ge ett
 * undantag i en rutt eller en tom skärm. Varje fält som inte går att läsa får
 * sin standard, ett i taget, och ett tal utanför sina gränser klipps till
 * närmaste gräns.
 *
 * Det gör också att ett nytt fält inte behöver någon migration: gamla rader
 * saknar det, och `normalisera` fyller i standarden.
 * ===========================================================================
 */

import type { Namnform, Ordning, TavlansInstallningar } from "./typer.ts";

/**
 * Samma form med varje fält skrivskyddat, också i delobjekten. En skrivning är då ett
 * kompileringsfel och inte bara ett undantag i drift. En skrivskyddad post går att läsa
 * som den vanliga typen (`const inst: TavlansInstallningar = STANDARD`), och en spridning
 * (`{ ...STANDARD }`) kopierar bara första nivån, så delobjekten förblir skrivskyddade.
 */
export type DjupSkrivskyddad<T> = T extends object ? { readonly [K in keyof T]: DjupSkrivskyddad<T[K]> } : T;

/** Fryser ett objekt och alla objekt i det, så att ett skrivförsök varken ändrar eller lägger till något. */
function djupfrys<T extends object>(objekt: T): DjupSkrivskyddad<T> {
  for (const varde of Object.values(objekt)) {
    if (typeof varde === "object" && varde !== null) djupfrys(varde);
  }
  return Object.freeze(objekt) as DjupSkrivskyddad<T>;
}

/**
 * Det en ny tavla börjar med, och det ett fält faller tillbaka på.
 *
 * Skrivskyddad i typen (en skrivning kompilerar inte) och djupfryst i drift. Allt som
 * läses faller tillbaka på den här, så ett skrivförsök som ändrade den
 * (`STANDARD.ljud.volym = 1`) hade ändrat vad varje fält blir i alla senare anrop,
 * tills servern startar om. I strikt läge kastar ett skrivförsök mot den, och i
 * slarvigt läge gör det ingenting. Den som vill ha något att ändra kallar
 * `normalisera(null)`, som ger ett nytt objekt.
 */
export const STANDARD: DjupSkrivskyddad<TavlansInstallningar> = djupfrys<TavlansInstallningar>({
  version: 1,
  lag: null,
  namn: "fornamn_e",
  ordning: "varde",
  mal: {},
  arbetsdag: { fran: "08:00", till: "18:00" },
  rorelse: "full",
  firande: {
    storAffar: { lage: "belopp", belopp: 40_000 },
    forstaOrdern: true,
    dagensForsta: true,
    personbasta: true,
    dagsrekord: true,
    halvvags: true,
    maletNatt: true,
    efterregistreradDagar: 2,
  },
  ljud: { pa: true, volym: 70, fran: "08:00", till: "18:00", helgTyst: true },
});

const NAMNFORMER: readonly Namnform[] = ["fornamn", "fornamn_e", "hela"];
const ORDNINGAR: readonly Ordning[] = ["varde", "antal"];
const RORELSER: readonly TavlansInstallningar["rorelse"][] = ["full", "lugn"];
const STORA_LAGEN: readonly TavlansInstallningar["firande"]["storAffar"]["lage"][] = ["auto", "belopp"];

/** En månad i målen, "2026-10". */
const MANAD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Ett mål i kronor. Under tusen är ett skrivfel, över hundra miljoner också. */
export const MAL_GRANSER = { min: 1_000, max: 100_000_000 } as const;

/** Så många månaders mål sparas. Äldre stryks, de nyaste står kvar. */
const MAL_MANADER = 36;

/** "HH:MM" på ett dygn, 00:00–23:59. */
const KLOCKSLAG = /^([01]\d|2[0-3]):[0-5]\d$/;

// -----------------------------------------------------------------------------
// Läsarna. Var och en tar något okänt och ger ett giltigt värde, aldrig ett fel.
// -----------------------------------------------------------------------------

/** Fältet `nyckel` ur `indata`, eller undefined när `indata` inte är ett objekt. */
const falt = (indata: unknown, nyckel: string): unknown =>
  typeof indata === "object" && indata !== null ? (indata as Record<string, unknown>)[nyckel] : undefined;

/** Bara en riktig brytare räknas. "true", 1 och "ja" är skräp. */
const brytare = (x: unknown, bas: boolean): boolean => (typeof x === "boolean" ? x : bas);

const alternativ = <T extends string>(x: unknown, tillatna: readonly T[], bas: T): T =>
  tillatna.find((t) => t === x) ?? bas;

/** Ett heltal klippt till [min, max]. Det som inte är ett ändligt tal ger `bas`. */
function heltal(x: unknown, min: number, max: number, bas: number): number {
  if (typeof x !== "number" || !Number.isFinite(x)) return bas;
  return Math.min(max, Math.max(min, Math.round(x)));
}

const klockslag = (x: unknown, bas: string): string => (typeof x === "string" && KLOCKSLAG.test(x) ? x : bas);

/**
 * Arbetsdagen: ett par där slutet ligger efter början.
 *
 * Tidslinjen delar med arbetsdagens bredd, så ett par som slutar före eller när
 * det börjar (18:00–08:00, 09:00–09:00) är ogiltigt, och HELA paret faller då
 * tillbaka på `bas`. Fält för fält hade gett ett halvt par, ett nytt "från" med
 * det gamla "till", och det är en gissning. `bas` är alltid ett giltigt par:
 * standarden, eller det som gäller nu efter att ha gått genom `normalisera`.
 *
 * Det gäller inte ljudtiden. Den FÅR gå över midnatt (22:00–06:00), och lika
 * tider är ett tomt fönster, inte ett fel (se `ljudTillatet`).
 *
 * "HH:MM" med nollor framför går att jämföra som text.
 */
function arbetsdagen(indata: unknown, bas: TavlansInstallningar["arbetsdag"]): TavlansInstallningar["arbetsdag"] {
  const fran = klockslag(falt(indata, "fran"), bas.fran);
  const till = klockslag(falt(indata, "till"), bas.till);
  return till > fran ? { fran, till } : { fran: bas.fran, till: bas.till };
}

/**
 * Målen per månad. Det som läses läggs ovanpå `bas`: en månad med ett mål sätts,
 * en månad med null tas bort (målet ärvs då från månaden före), och det som inte är
 * en månad eller ett mål inom gränserna lämnas som det var. Så kan admin ändra en
 * månad utan att skicka alla, och en dålig skrivning ändrar ingenting.
 */
function malen(x: unknown, bas: Record<string, number>): Record<string, number> {
  const ut: Record<string, number> = { ...bas };
  if (typeof x === "object" && x !== null && !Array.isArray(x)) {
    for (const [manad, varde] of Object.entries(x as Record<string, unknown>)) {
      if (!MANAD.test(manad)) continue;
      if (varde === null) delete ut[manad];
      else if (typeof varde === "number" && Number.isFinite(varde) && varde >= MAL_GRANSER.min && varde <= MAL_GRANSER.max) {
        ut[manad] = Math.round(varde);
      }
    }
  }
  const manader = Object.keys(ut).sort();
  return Object.fromEntries(manader.slice(-MAL_MANADER).map((k) => [k, ut[k]]));
}

/**
 * Månadens mål i kronor: månadens eget, annars det senaste före den, annars null.
 * Ett mål gäller alltså tills någon sätter ett nytt, också bakåt i grafen.
 */
export function malFor(mal: Readonly<Record<string, number>>, manad: string): number | null {
  let basta: string | null = null;
  for (const k of Object.keys(mal)) if (k <= manad && (basta === null || k > basta)) basta = k;
  return basta === null ? null : mal[basta];
}

/**
 * Lagets id. Null betyder alla lag och är ett giltigt svar, så att
 * `{lag: null}` kan släppa ett tidigare val. En tom sträng betyder också alla,
 * annars hade ett tomt val i en lista gett en tavla utan en enda order.
 */
function lagId(x: unknown, bas: string | null): string | null {
  if (x === null) return null;
  if (typeof x !== "string") return bas;
  return x.trim() || null;
}

/**
 * Läser `indata` fält för fält. Det som saknas eller har fel typ tas ur `bas`,
 * och det som läses bygger alltid ett nytt objekt: inget delas med `bas`, och
 * okända nycklar följer aldrig med eftersom bara kända fält läses.
 */
function tolka(indata: unknown, bas: TavlansInstallningar): TavlansInstallningar {
  const arbetsdag = falt(indata, "arbetsdag");
  const firande = falt(indata, "firande");
  const storAffar = falt(firande, "storAffar");
  const ljud = falt(indata, "ljud");

  return {
    version: 1,
    lag: lagId(falt(indata, "lag"), bas.lag),
    namn: alternativ(falt(indata, "namn"), NAMNFORMER, bas.namn),
    ordning: alternativ(falt(indata, "ordning"), ORDNINGAR, bas.ordning),
    mal: malen(falt(indata, "mal"), bas.mal),
    arbetsdag: arbetsdagen(arbetsdag, bas.arbetsdag),
    rorelse: alternativ(falt(indata, "rorelse"), RORELSER, bas.rorelse),
    firande: {
      storAffar: {
        lage: alternativ(falt(storAffar, "lage"), STORA_LAGEN, bas.firande.storAffar.lage),
        belopp: heltal(falt(storAffar, "belopp"), 1_000, 10_000_000, bas.firande.storAffar.belopp),
      },
      forstaOrdern: brytare(falt(firande, "forstaOrdern"), bas.firande.forstaOrdern),
      dagensForsta: brytare(falt(firande, "dagensForsta"), bas.firande.dagensForsta),
      personbasta: brytare(falt(firande, "personbasta"), bas.firande.personbasta),
      dagsrekord: brytare(falt(firande, "dagsrekord"), bas.firande.dagsrekord),
      halvvags: brytare(falt(firande, "halvvags"), bas.firande.halvvags),
      maletNatt: brytare(falt(firande, "maletNatt"), bas.firande.maletNatt),
      efterregistreradDagar: heltal(falt(firande, "efterregistreradDagar"), 0, 30, bas.firande.efterregistreradDagar),
    },
    ljud: {
      pa: brytare(falt(ljud, "pa"), bas.ljud.pa),
      volym: heltal(falt(ljud, "volym"), 0, 100, bas.ljud.volym),
      fran: klockslag(falt(ljud, "fran"), bas.ljud.fran),
      till: klockslag(falt(ljud, "till"), bas.ljud.till),
      helgTyst: brytare(falt(ljud, "helgTyst"), bas.ljud.helgTyst),
    },
  };
}

/**
 * Tolkar det som sparats (eller inget alls) till giltiga inställningar.
 *
 * - Volymen klipps till 0–100 och blir ett heltal.
 * - Efterregistrerad klipps till 0–30 dagar, och beloppet till 1 000–10 000 000 kr.
 * - Målen är månad → kronor inom `MAL_GRANSER`; det som inte går att läsa stryks.
 * - Tider som inte är "HH:MM" faller tillbaka på standarden, liksom fel typ.
 * - Arbetsdagen måste sluta efter att den börjat, annars faller hela paret
 *   tillbaka på standarden. Ljudtiden är fri och får gå över midnatt.
 * - Okända nycklar tas bort.
 */
export function normalisera(indata: unknown): TavlansInstallningar {
  return tolka(indata, STANDARD);
}

/**
 * Lägger `delar` ovanpå de inställningar som gäller nu.
 *
 * `delar` är en del av formen och inte hela: det som inte nämns står kvar, och
 * ett fält i en grupp byts utan att resten av gruppen rörs (`{ljud: {volym: 30}}`).
 *
 * Det som nämns men inte går att läsa faller tillbaka på det som gäller NU och
 * inte på standarden. En dålig skrivning ska ändra ingenting, och en volym på
 * "hög" ska inte slå om ett val som admin gjort till fabriksvärdet. Det som går
 * att läsa klipps som i `normalisera`.
 */
export function uppdatera(nu: TavlansInstallningar, delar: unknown): TavlansInstallningar {
  return tolka(delar, normalisera(nu));
}
