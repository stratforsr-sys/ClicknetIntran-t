/**
 * Säljtavlans vy som ren logik: texterna, formaten, målkortets rader,
 * topplistans streck, grafens geometri, landningens tider och omladdningens regler.
 *
 * Ingen React och inga `@/`-importer, så att allt som avgör vad tavlan säger går
 * att prova med node (`tests/salesboard-tavla.mjs`). Ritningen (Vila.tsx och
 * kompositionerna) tar sina tal härifrån och lägger bara till form.
 *
 * ===========================================================================
 * SVENSKT FORMAT OCH SVENSK TID, OAVSETT VAR KODEN KÖR.
 *
 * Tavlan visar servertid: klockan, "i dag" och arbetsdagen räknas på `nu` ur
 * ögonblicksbilden plus den förskjutning källan mätt, och alltid i
 * Europe/Stockholm (`klocka.ts`). En TV med fel klocka eller fel zon ska ändå
 * säga 14:21 när ordern godkändes 14:21.
 *
 * Kronor skrivs "17 940 kr" med hårda mellanrum (sv-SE grupperar med U+00A0),
 * tusental "590 tkr" och veckan "v. 43".
 * ===========================================================================
 */

import { svenskaMinuter, svensktDatum, svenskVeckodag } from "../../lib/klocka.ts";
import type { TavleManad, TavlePerson } from "../../lib/salesboard/typer.ts";
import { UT } from "./motion/kurvor.ts";

/** Hårt mellanrum: "17 940 kr" bryts aldrig mellan talet och "kr". */
export const HART = " ";

// -----------------------------------------------------------------------------
// Format
// -----------------------------------------------------------------------------

const HELTAL = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 });

/** "17 940". Grupperingen är sv-SE:s hårda mellanrum. */
export const heltal = (n: number): string => HELTAL.format(Math.round(n)).replace(/\s/g, HART);

/** "17 940 kr". */
export const kronor = (n: number): string => `${heltal(n)}${HART}kr`;

const KLOCKA = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** "14:32:07" i svensk tid. */
export function klockaMedSekunder(ms: number): string {
  const p = Object.fromEntries(KLOCKA.formatToParts(new Date(ms)).map((d) => [d.type, d.value]));
  return `${p.hour}:${p.minute}:${p.second}`;
}

/** "14:21" i svensk tid, eller en tom sträng när tiden inte går att läsa. */
export function klockslag(iso: string | number): string {
  const ms = typeof iso === "number" ? iso : Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  return klockaMedSekunder(ms).slice(0, 5);
}

const MANADER = [
  "januari",
  "februari",
  "mars",
  "april",
  "maj",
  "juni",
  "juli",
  "augusti",
  "september",
  "oktober",
  "november",
  "december",
];
const MANADER_KORT = ["jan", "feb", "mars", "apr", "maj", "juni", "juli", "aug", "sep", "okt", "nov", "dec"];
const VECKODAGAR = ["måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag", "söndag"];

const versal = (s: string): string => s.charAt(0).toLocaleUpperCase("sv-SE") + s.slice(1);

/** Delarna i ett datum "2026-10-23". */
function datumdelar(datum: string): { ar: number; manad: number; dag: number } {
  const [ar, manad, dag] = datum.split("-").map(Number);
  return { ar, manad, dag };
}

/**
 * ISO-veckan: måndag först, och veckan hör till det år där dess torsdag ligger.
 * Veckonumret är då hur många hela veckor torsdagen ligger efter årets första dag.
 */
export function vecka(datum: string): number {
  const { ar, manad, dag } = datumdelar(datum);
  const d = new Date(Date.UTC(ar, manad - 1, dag));
  const veckodag = (d.getUTCDay() + 6) % 7; // måndag 0
  d.setUTCDate(d.getUTCDate() - veckodag + 3); // torsdagen samma vecka
  const nyar = Date.UTC(d.getUTCFullYear(), 0, 1);
  return 1 + Math.floor((d.getTime() - nyar) / 86_400_000 / 7);
}

/** Statusradens datum: "Fredag 23 oktober · v. 43". */
export function datumrad(ms: number): string {
  const datum = svensktDatum(new Date(ms));
  const { manad, dag } = datumdelar(datum);
  const veckodag = VECKODAGAR[svenskVeckodag(new Date(ms)) - 1];
  return `${versal(veckodag)} ${dag} ${MANADER[manad - 1]} · v.${HART}${vecka(datum)}`;
}

/** "21 okt" för en tidpunkt, i svensk tid. */
export function kortDatum(iso: string): string {
  if (Number.isNaN(Date.parse(iso))) return "";
  const { manad, dag } = datumdelar(svensktDatum(iso));
  return `${dag}${HART}${MANADER_KORT[manad - 1]}`;
}

/** Antal kalenderdagar från `a` till `b` (båda "YYYY-MM-DD"). */
function dagarMellan(a: string, b: string): number {
  const x = datumdelar(a);
  const y = datumdelar(b);
  return Math.round((Date.UTC(y.ar, y.manad - 1, y.dag) - Date.UTC(x.ar, x.manad - 1, x.dag)) / 86_400_000);
}

/** Veckodagarna kort, som tidskolumnen i flödet skriver en äldre dag. */
const VECKODAGAR_KORT = ["mån", "tis", "ons", "tor", "fre", "lör", "sön"];

/**
 * Klockslaget i flödet: "13:58" i dag, "i går", veckodagen kort ("tor") inom en
 * vecka, och datumet ("16 okt") för det som är äldre.
 */
export function flodeTid(iso: string, idag: string): string {
  if (Number.isNaN(Date.parse(iso))) return "";
  const dag = svensktDatum(iso);
  const sedan = dagarMellan(dag, idag);
  if (sedan <= 0) return klockslag(iso);
  if (sedan === 1) return "i går";
  const { ar, manad, dag: d } = datumdelar(dag);
  if (sedan < 7) return VECKODAGAR_KORT[(new Date(Date.UTC(ar, manad - 1, d)).getUTCDay() + 6) % 7];
  return `${d}${HART}${MANADER_KORT[manad - 1]}`;
}

/** "Fredag" ur en svensk dag, för topplistans kolumn i dag. */
export const veckodagKort = (i: number): string => versal(VECKODAGAR_KORT[i] ?? "");

/** "1:a", "2:a", "3:e", "11:e", "21:a": ordningstalet som i "3:e ordern i oktober". */
export function ordtal(n: number): string {
  const a = (n % 10 === 1 || n % 10 === 2) && n % 100 !== 11 && n % 100 !== 12;
  return `${n}${a ? ":a" : ":e"}`;
}

/** Tusental: "590 tkr". */
export const tkr = (n: number): string => `${heltal(n / 1000)}${HART}tkr`;

/** Snittet per order avrundat till hundratal, eller 0 utan order. */
export const snitt = (varde: number, antal: number): number => (antal > 0 ? Math.round(varde / antal / 100) * 100 : 0);

// -----------------------------------------------------------------------------
// Landningen: när en order landat rullar talen, i bildrutor vid 60 per sekund
// -----------------------------------------------------------------------------

/** Målkortets stora tal och siffrorna under det rullar 900 ms; texten byts när det landat. */
export const RULL = 54;
/** Radens antal rullar 700 ms och dess ordervärde 1 000 ms. */
export const RULL_ANTAL = 42;
export const RULL_VARDE = 60;
/** Raderna byter plats på 800 ms, flödet flyttar ner på 600 ms. */
export const FLIP = 48;
export const FLODE_FLIP = 36;
/** Raden som fått en order lyser mint och tonar tillbaka på 2,4 s. */
export const BLINK = 144;
/** Grafens stapel för månaden växer på 900 ms. */
export const GRAF = 54;
/** Det nya strecket ritas in från 0,2 s, på 0,5 s. */
export const STRECK: readonly [number, number] = [12, 42];
/** "↑2" står i sex sekunder. */
export const UPP = 360;
/** Landningen ritas om så här länge; sedan står tavlan still igen. */
export const LANDNING = Math.max(BLINK, UPP + 18);

/** Ett tal som rullar från `fran` till `till`, `lr` bildrutor in i en rullning på `langd`. */
export const rull = (fran: number, till: number, lr: number, langd: number): number =>
  fran + (till - fran) * UT(Math.min(1, Math.max(0, lr / langd)));

// -----------------------------------------------------------------------------
// Målkortet
// -----------------------------------------------------------------------------

/** Det målkortets rader räknas på. */
export type Matarlage = { varde: number; mal: number | null; forvantat: number | null; prognos: number | null; natt: string | null };

/** En del av en rad: det feta och resten, i den ordningen eller omvänt. */
export type Del = { fet: string; text: string; fetSist?: boolean };

/** Raderna i målkortet för ett läge. */
export function matarRader(m: Matarlage): { status: string | null; bra: boolean; natt: boolean; fakta: Del[] } {
  if (m.mal === null || m.mal <= 0) {
    return {
      status: null,
      bra: false,
      natt: false,
      fakta: [{ fet: "Inget mål", text: "satt för månaden" }, ...(m.prognos !== null ? [{ fet: tkr(m.prognos), text: "Prognos", fetSist: true }] : [])],
    };
  }
  const natt = m.varde >= m.mal;
  if (natt) {
    const over = m.varde - m.mal;
    return {
      status: "Målet nått",
      bra: true,
      natt,
      fakta: [{ fet: m.natt ? kortDatum(m.natt) : "", text: "" }, ...(over > 0 ? [{ fet: `+${kronor(over)}`, text: "över" }] : [])],
    };
  }
  const diff = m.forvantat === null ? 0 : m.varde - m.forvantat;
  const rund = Math.round(diff / 100) * 100;
  const status = Math.abs(rund) < 100 ? "I takt" : rund > 0 ? `${kronor(rund)} före takten` : `${kronor(-rund)} efter takten`;
  return {
    status,
    bra: diff >= 0,
    natt,
    fakta: [{ fet: kronor(m.mal - m.varde), text: "kvar" }, ...(m.prognos !== null ? [{ fet: tkr(m.prognos), text: "Prognos", fetSist: true }] : [])],
  };
}

/**
 * Målkortets rader `lr` bildrutor in i en landning från `fran` till `till`. Raden
 * beskriver alltid talet som syns (R31): den byter först när talet landat.
 */
export function matarText(fran: Matarlage, till: Matarlage, lr: number): ReturnType<typeof matarRader> {
  return matarRader(lr >= RULL ? till : fran);
}

// -----------------------------------------------------------------------------
// Topplistans streck
// -----------------------------------------------------------------------------

/** Ett streck i en veckodag: fyra lodräta och det femte snett över, som på en griffeltavla. */
export type Streck = { x1: number; y1: number; x2: number; y2: number };

/** Strecken för `n` order och bredden de tar, i ritningens enheter (30 höga). */
export function streck(n: number): { linjer: Streck[]; bredd: number } {
  const linjer: Streck[] = [];
  for (let i = 0; i < n; i++) {
    const x0 = Math.floor(i / 5) * 46;
    const j = i % 5;
    linjer.push(j < 4 ? { x1: x0 + j * 8, y1: 2, x2: x0 + j * 8, y2: 28 } : { x1: x0 - 4, y1: 24, x2: x0 + 28, y2: 6 });
  }
  return { linjer, bredd: n === 0 ? 0 : Math.floor((n - 1) / 5) * 46 + Math.min(4, n) * 8 };
}

// -----------------------------------------------------------------------------
// Grafen
// -----------------------------------------------------------------------------

/** En stapel i grafen, i ritningens enheter (u). */
export type Grafstapel = {
  x: number;
  b: number;
  h: number;
  y0: number;
  klass: "natt-r" | "under-r" | "nu-r";
  /** Målstrecket, eller null utan mål. */
  malY: number | null;
  /** Prognosens streckade ruta, bara för månaden. */
  prognosY: number | null;
  etikettY: number;
  etikett: string;
  namn: string;
  nu: boolean;
  titel: string;
};

/** Skalans steg: det minsta "jämna" steget som ger högst `linjer` steg upp till `max`. */
function jamntSteg(max: number, linjer: number): number {
  const bas = [1, 2, 2.5, 5];
  for (let e = 3; e < 10; e++) for (const b of bas) if ((b * 10 ** e) * linjer >= max) return b * 10 ** e;
  return 10 ** 10;
}

/**
 * Grafens geometri: tolv staplar (elva månader och den här), målstreck, prognosen
 * och skalan. `W` och `H` är ytans storlek i u. Skalan har sju steg när grafen är
 * hög och bara varannan linje när den är låg (under 170 u), så att etiketterna inte
 * trängs: 100 000 kr per steg blir 200 000.
 */
export function grafPlan(o: {
  W: number;
  H: number;
  historik: readonly TavleManad[];
  nu: { namn: string; varde: number; mal: number | null; antal: number; prognos: number | null };
}): { staplar: Grafstapel[]; linjer: { y: number; etikett: string }[]; x0: number } {
  const manader = [...o.historik.slice(-11), { nyckel: "", namn: o.nu.namn, antal: o.nu.antal, varde: o.nu.varde, mal: o.nu.mal }];
  const natt = o.nu.mal !== null && o.nu.varde >= o.nu.mal;
  const prognos = !natt && o.nu.prognos !== null && o.nu.prognos > o.nu.varde ? o.nu.prognos : null;
  const hogst = Math.max(1, ...manader.map((m) => Math.max(m.varde, m.mal ?? 0)), prognos ?? 0);
  const x0 = 58;
  const y0 = o.H - 34;
  const h = Math.max(1, y0 - 34);
  const steg = jamntSteg(hogst * 1.04, 7);
  const max = Math.ceil((hogst * 1.04) / steg) * steg;
  const linjesteg = h < 170 ? steg * 2 : steg;
  const y = (v: number) => y0 - (Math.min(Math.max(0, v), max) / max) * h;
  const kol = (o.W - x0) / 12;
  const b = Math.min(44, kol * 0.58);
  const linjer: { y: number; etikett: string }[] = [];
  for (let v = 0; v <= max + 1e-6; v += linjesteg) linjer.push({ y: y(v), etikett: heltal(v / 1000) });
  const staplar = manader.map((m, i): Grafstapel => {
    const ar = i === manader.length - 1;
    const x = x0 + i * kol + (kol - b) / 2;
    const p = ar ? prognos : null;
    const topp = Math.min(y(m.varde), m.mal !== null ? y(m.mal) : Infinity, p !== null ? y(p) : Infinity);
    return {
      x,
      b,
      h: Math.max(0, y0 - y(m.varde)),
      y0,
      klass: ar ? "nu-r" : m.mal !== null && m.varde >= m.mal ? "natt-r" : "under-r",
      malY: m.mal !== null ? y(m.mal) : null,
      prognosY: p !== null ? y(p) : null,
      etikettY: topp - 10,
      etikett: heltal(m.varde / 1000),
      namn: m.namn,
      nu: ar,
      titel: `${m.namn}: ${kronor(m.varde)}${m.mal !== null ? ` av ${kronor(m.mal)}` : ""} · ${heltal(m.antal)} order`,
    };
  });
  return { staplar, linjer, x0 };
}

/** En person som saknas i bilden ritas som en dold säljare, aldrig som ett fel. */
export const DOLD: TavlePerson = { nyckel: "", namn: "En säljare", initialer: "·", dold: true };

// -----------------------------------------------------------------------------
// Firandets texter
// -----------------------------------------------------------------------------

/** Taggen som konturpiller: "DAGSREKORD · 6 (FÖRRA 5)", "PERSONBÄSTA · 3 I DAG", "DAGENS FÖRSTA". */
export function taggText(
  t: { typ: "dagsrekord"; nu: number; forra: number } | { typ: "personbasta"; antal: number } | { typ: "dagensForsta" },
): { fet: string; text: string } {
  if (t.typ === "dagsrekord") return { fet: "Dagsrekord", text: `${t.nu} order i dag (förra ${t.forra})` };
  if (t.typ === "personbasta") return { fet: "Personbästa", text: `${t.antal} i dag` };
  return { fet: "Dagens första", text: "order" };
}

// -----------------------------------------------------------------------------
// Skärmen: inbränning, vila och omladdning
// -----------------------------------------------------------------------------

/** Inbränningsskyddet: hela duken flyttas 0–2 px var fjärde minut, i ett mönster som går igenom alla nio lägen. */
export function pixelskift(ms: number): { x: number; y: number } {
  const steg = Math.floor(ms / 240_000);
  const i = ((steg % 9) + 9) % 9;
  return { x: i % 3, y: Math.floor(i / 3) };
}

/** Utan lyckad hämtning så länge står tavlan som offline (spec §8). */
export const OFFLINE_MS = 120_000;

/**
 * Nattens omladdning: klockan 04:00–04:30 svensk tid, om sidan inte redan
 * laddats om i natt. En sida som startade efter 03:30 laddas inte om, så att
 * omladdningen aldrig blir en slinga.
 */
export function nattomladdning(nuMs: number, startMs: number): boolean {
  const m = svenskaMinuter(new Date(nuMs));
  return m >= 240 && m < 270 && nuMs - startMs > 3_600_000;
}

/**
 * Ett nytt bygge laddar om tavlan vid nästa lugna stund, men bara om ljudet
 * startade utan klick (kiosk) eller utanför arbetsdagen. Annars hade ett klick
 * behövts igen mitt på dagen, och omladdningen väntar till natten (spec §8).
 */
export function byggomladdning(o: { nyttBygge: boolean; lugnt: boolean; ljudUtanKlick: boolean; arbetsdag: boolean }): boolean {
  return o.nyttBygge && o.lugnt && (o.ljudUtanKlick || !o.arbetsdag);
}
