/**
 * Chattens rena delar: talen i svaret, kostnaden och spärrarna.
 *
 * Regeln (designdokumentet 2026-11-15, "Tal i svaret"): Claude skriver aldrig
 * ut ett tal. Den hänvisar till ett fält i ett verktygssvar med
 * `{{t:<anrop>.<fält>}}`, och servern sätter in värdet. Varje tal i svaret bär
 * då sin källa. Allt annat som ser ut som ett tal, i siffror eller bokstäver,
 * märks som obelagt och räknas. Andelen svar utan obelagda tal är chattens
 * kvalitetsmått.
 *
 * Märkena i den färdiga texten:
 *   ⟦t3:14 500⟧      ett belagt tal, med id till listan `tal`
 *   ⟦obelagt:12⟧     något som ser ut som ett tal men saknar hänvisning
 *   ⟦obelagt:?⟧      en hänvisning som inte gick att slå upp
 *
 * Filen är ren: inga läsningar, ingen klocka, inget nätverk.
 */

export type TalRef = { verktyg: string; anrop: number; falt: string };
export type InsattTal = { id: string; varde: number | string; kalla: TalRef };

const REF = /\{\{t:(\d{1,3})\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\}\}/g;
const TRASIG_REF = /\{\{[^{}]*\}\}/g;
const MANAD = "januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|okt|nov|dec";
const FORE = "(?<![\\p{L}\\p{N}_])";
const EFTER = "(?![\\p{L}\\p{N}_])";
/** Datum och klockslag. De är inga påståenden om hur mycket, och lämnas i fred. Ordningen spelar roll. */
const TIDER: RegExp[] = [
  new RegExp(`${FORE}\\d{4}-\\d{2}-\\d{2}${EFTER}`, "gu"),
  new RegExp(`${FORE}(?:kl\\.?|klockan)\\s*\\d{1,2}(?:[.:]\\d{2})?${EFTER}`, "giu"),
  new RegExp(`${FORE}(?:[01]?\\d|2[0-3]):[0-5]\\d${EFTER}`, "gu"),
  new RegExp(`${FORE}(?:den\\s+)?(?:[1-9]|[12]\\d|3[01])(?::[ae])?\\s+(?:${MANAD})(?:\\s+(?:19|20)\\d{2})?${EFTER}`, "giu"),
  new RegExp(`${FORE}(?:${MANAD})\\s+(?:19|20)\\d{2}${EFTER}`, "giu"),
  new RegExp(`${FORE}(?:år|året)\\s+(?:19|20)\\d{2}${EFTER}`, "giu"),
  new RegExp(`${FORE}(?:vecka|veckorna|v\\.)\\s*\\d{1,2}(?:\\s*(?:,|och|till|–|-)\\s*\\d{1,2})*${EFTER}`, "giu"),
];
const SIFFROR = new RegExp(`${FORE}(?:\\d{1,3}(?:[ \\u00a0\\u202f]\\d{3})+|\\d+)(?:[.,]\\d+)?(?:\\s?%)?`, "gu");
const ENTAL = "en|ett|två|tre|fyra|fem|sex|sju|åtta|nio";
/** Tal i bokstäver. "en" och "ett" ensamma är artiklar och räknas inte. */
const TALORD = new RegExp(
  `(?<![\\p{L}])(?:noll|två|tre|fyra|fem|sex|sju|åtta|nio|tio|elva|tolv|tretton|fjorton|femton|sexton|sjutton|arton|nitton|(?:tjugo|trettio|fyrtio|femtio|sextio|sjuttio|åttio|nittio)(?:${ENTAL})?|hundra|tusen|miljon(?:er)?|miljard(?:er)?)(?![\\p{L}])`,
  "giu",
);

/** Märken och våra egna platshållare får aldrig komma utifrån: varken ur modellens text eller ur ett verktygssvar. */
const tvatta = (s: string): string => s.replace(/⟦/g, "[").replace(/⟧/g, "]").replace(/[-]/g, "");
const plats = (bas: number, i: number): string => String.fromCharCode(bas) + String.fromCharCode(0xe100 + i) + String.fromCharCode(bas + 1);
const platsRe = (bas: number): RegExp => new RegExp(`${String.fromCharCode(bas)}([\\uE100-\\uF000])${String.fromCharCode(bas + 1)}`, "g");

function slaUpp(svar: Record<string, unknown>[], anrop: number, falt: string): number | string | undefined {
  let x: unknown = svar[anrop - 1];
  if (x === undefined || x === null) return undefined;
  // Ett svar som bär modellens egna ord (ett utkast den själv skrivit) är ingen källa: annars kunde ett påhittat tal tvättas genom det.
  if ((x as Record<string, unknown>)._egnaOrd === true) return undefined;
  for (const del of falt.split(".")) {
    if (del.startsWith("_") || x === null || typeof x !== "object" || !Object.hasOwn(x as object, del)) return undefined;
    x = (x as Record<string, unknown>)[del];
  }
  if (typeof x === "number") return Number.isFinite(x) ? x : undefined;
  if (typeof x === "string") return x.trim() ? x : undefined;
  return undefined;
}

const skriv = (v: number | string): string =>
  typeof v === "number" ? v.toLocaleString("sv-SE", { maximumFractionDigits: Number.isInteger(v) ? 0 : 1 }) : tvatta(v);

/**
 * Sätter in talen ur verktygssvaren och märker allt som inte är belagt.
 * `svar[0]` är första anropets svar (hänvisas som `{{t:1.…}}`), med verktygets
 * namn i `_verktyg`. Fält som börjar med understreck går inte att hänvisa till.
 */
export function sattInTal(text: string, svar: Record<string, unknown>[]): { text: string; tal: InsattTal[]; obelagda: number } {
  const tal: InsattTal[] = [];
  let obelagda = 0;
  const refar: string[] = [];
  const tider: string[] = [];

  let t = tvatta(text).replace(REF, (_m, a: string, falt: string) => {
    const anrop = Number(a);
    const varde = slaUpp(svar, anrop, falt);
    if (varde === undefined || refar.length >= 3000) { obelagda++; refar.push("⟦obelagt:?⟧"); }
    else {
      const id = `t${tal.length + 1}`;
      tal.push({ id, varde, kalla: { verktyg: String(svar[anrop - 1]?._verktyg ?? ""), anrop, falt } });
      refar.push(`⟦${id}:${skriv(varde)}⟧`);
    }
    return plats(0xe000, refar.length - 1);
  });
  // En hänvisning som inte följer formen sätts aldrig in.
  t = t.replace(TRASIG_REF, () => { obelagda++; refar.push("⟦obelagt:?⟧"); return plats(0xe000, refar.length - 1); });
  for (const re of TIDER) t = t.replace(re, (m) => { if (tider.length >= 3000) return m; tider.push(m); return plats(0xe002, tider.length - 1); });
  const markt = (m: string): string => { obelagda++; return `⟦obelagt:${m}⟧`; };
  t = t.replace(SIFFROR, markt).replace(TALORD, markt);
  t = t.replace(platsRe(0xe002), (_m, c: string) => tider[c.charCodeAt(0) - 0xe100] ?? "").replace(platsRe(0xe000), (_m, c: string) => refar[c.charCodeAt(0) - 0xe100] ?? "");
  return { text: t, tal, obelagda };
}

/** Texten utan märken, som den läses: för loggen och för den som inte kan klicka. */
export const utanMarken = (text: string): string => text.replace(/⟦(?:t\d+|obelagt):([^⟧]*)⟧/g, "$1");

/* ------------------------------------------------------------------------ */
/* Kostnaden                                                                 */
/* ------------------------------------------------------------------------ */

/** Dollar per miljon token, in och ut (designdokumentet, "Kostnad"). */
const PRIS: Record<string, { inn: number; ut: number }> = {
  "claude-opus-5-5": { inn: 4, ut: 20 },
  "claude-sonnet-5-5": { inn: 2, ut: 10 },
  "claude-haiku-5-5": { inn: 0.1, ut: 0.5 },
};
export const KANDA_MODELLER: readonly string[] = Object.keys(PRIS);
/** Att läsa ur cachen kostar en tiondel av en vanlig intoken, att skriva dit en fjärdedel mer (fem minuters cache). */
const CACHE_LAS = 0.1;
const CACHE_SKRIV = 1.25;

export type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };

/**
 * Kostnaden i dollar för ett anrop: det Anthropic tar betalt, ur token och modellens pris. Taken räknas på det
 * här talet. En okänd modell räknas som den dyraste, så att taket aldrig underskattas.
 */
export function kostnadUsd(modell: string, usage: Usage): number {
  const p = PRIS[modell] ?? PRIS["claude-opus-5-5"];
  return (
    ((usage.input_tokens || 0) * p.inn +
      (usage.cache_read_input_tokens || 0) * p.inn * CACHE_LAS +
      (usage.cache_creation_input_tokens || 0) * p.inn * CACHE_SKRIV +
      (usage.output_tokens || 0) * p.ut) /
    1e6
  );
}

/** Samma kostnad i kronor, för den som läser loggen. */
export const kostnadKr = (modell: string, usage: Usage, krPerDollar: number): number => kostnadUsd(modell, usage) * krPerDollar;

/** Det mesta en fråga kan kosta i uttoken: varje varv fullt ut, till modellens utpris. Läggs på förbrukningen före anropet. */
export const maxFragaUsd = (modell: string, maxUt: number, maxVarv: number): number => ((PRIS[modell] ?? PRIS["claude-opus-5-5"]).ut * maxUt * maxVarv) / 1e6;

/* ------------------------------------------------------------------------ */
/* Spärrarna                                                                 */
/* ------------------------------------------------------------------------ */

export type Besked = { ok: true } | { ok: false; skal: string };

/** Ett godkänt prov gäller en modell och ett avtryck av systemtexten och verktygen: `<modell>@<avtryck>`. */
export const provNyckel = (modell: string, avtryck: string): string => `${modell}@${avtryck}`;

/**
 * Får chatten slås på? Fyra saker ska vara sanna, och ingen av dem kan en
 * session ordna åt beställaren: nyckeln finns i miljön, avtalet med Anthropic
 * är bekräftat, modellen är en av dem Nav kan räkna kostnaden för, och just
 * den modellen har ett godkänt prov på just den här systemtexten och de här
 * verktygen. Gränserna i dollar är inget villkor: de finns alltid (0305).
 */
export function farSlasPa(i: { nyckel: boolean; avtal: boolean; modell: string; avtryck: string; godkandaProv: readonly string[] }): Besked {
  if (!i.nyckel) return { ok: false, skal: "Nyckeln saknas i den här miljön." };
  if (!i.avtal) return { ok: false, skal: "Personuppgiftsbiträdesavtalet med Anthropic är inte bekräftat." };
  if (!KANDA_MODELLER.includes(i.modell)) return { ok: false, skal: "Modellen är inte en av dem Nav kan räkna kostnaden för." };
  if (i.godkandaProv.includes(provNyckel(i.modell, i.avtryck))) return { ok: true };
  if (i.godkandaProv.some((p) => p.startsWith(`${i.modell}@`))) return { ok: false, skal: "Systemtexten eller verktygen har ändrats sedan provet. Kör provet igen." };
  return { ok: false, skal: "Modellen har inget godkänt prov." };
}

/**
 * Gränserna (beställaren 2026-11-15): dollar per person och för företaget,
 * varje kalendermånad. De är data i `nav_chatt_tak`, inte inställningar, och
 * en installation utan rad får standardvärdena (0305). Prövningen görs i
 * databasen, i samma steg som loggraden skrivs (`nav_chatt_reservera`): det
 * använda plus det mesta en fråga kan kosta får inte gå över gränsen.
 */
export type Utrymme = { personUsd: number; foretagUsd: number; takPersonUsd: number; takForetagUsd: number };

/** Databasens svar om utrymmet. Ett svar som inte går att läsa är inget utrymme: null, aldrig noll. */
export function lasUtrymme(v: unknown): Utrymme | null {
  if (!v || typeof v !== "object") return null;
  const x = v as Record<string, unknown>;
  const tal = (k: string, minst: number): number | null => (typeof x[k] === "number" && Number.isFinite(x[k]) && (x[k] as number) >= minst ? (x[k] as number) : null);
  const personUsd = tal("person_usd", 0), foretagUsd = tal("foretag_usd", 0), takPersonUsd = tal("tak_person_usd", Number.MIN_VALUE), takForetagUsd = tal("tak_foretag_usd", Number.MIN_VALUE);
  if (personUsd === null || foretagUsd === null || takPersonUsd === null || takForetagUsd === null) return null;
  return { personUsd, foretagUsd, takPersonUsd, takForetagUsd };
}

/** Beskedet när en gräns är nådd. Skrivrutan svarar då som sökrutan och säger varför. */
export const takBesked = (skal: unknown): string =>
  skal === "foretag" ? "Företaget har använt månadens AI-utrymme. Det fylls på den 1:a." : "Du har använt månadens AI-utrymme. Det fylls på den 1:a.";

/* ------------------------------------------------------------------------ */
/* Inställningarna                                                           */
/* ------------------------------------------------------------------------ */

export const CHATT_NYCKLAR = {
  pa: "chatt.pa",
  modell: "chatt.modell",
  avtal: "chatt.avtal",
  krPerDollar: "chatt.kr-per-dollar",
} as const;

export type ChattInst = { pa: boolean; modell: string; avtal: boolean; krPerDollar: number };
export const CHATT_STANDARD: ChattInst = { pa: false, modell: "claude-sonnet-5-5", avtal: false, krPerDollar: 11 };

const positivt = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

/** Inställningarna ur `nav_setting`. Allt som saknas eller har fel sort får standardvärdet, och standarden är av. Taken står inte här. */
export function lasChattInst(rader: readonly { key: string; value: unknown }[]): ChattInst {
  const v = (nyckel: string): unknown => rader.find((r) => r.key === nyckel)?.value;
  const modell = v(CHATT_NYCKLAR.modell);
  return {
    pa: v(CHATT_NYCKLAR.pa) === true,
    modell: typeof modell === "string" && modell ? modell : CHATT_STANDARD.modell,
    avtal: v(CHATT_NYCKLAR.avtal) === true,
    krPerDollar: positivt(v(CHATT_NYCKLAR.krPerDollar)) ?? CHATT_STANDARD.krPerDollar,
  };
}

/** Ett tidigare svar som skickas med i samtalet: utan märken och utan tal, så att ett gammalt tal inte kan återanvändas utan källa. */
export const utanTal = (text: string): string => utanMarken(text).replace(/\d+(?:[\s.,:]\d+)*/g, "[tal]");
