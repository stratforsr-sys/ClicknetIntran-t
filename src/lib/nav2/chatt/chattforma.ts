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
import { MATTNAMN, UTKAST_MAX, periodFor } from "./verktyg.ts";

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
  // Ett spann mellan två dagar som slutar på en månad: "9–15 nov", "1 till och med den 18 november".
  new RegExp(`${FORE}(?:den\\s+)?(?:[1-9]|[12]\\d|3[01])\\s*(?:[–-]|till(?:\\s+och\\s+med)?)\\s*(?:den\\s+)?(?:[1-9]|[12]\\d|3[01])(?::[ae])?\\s+(?:${MANAD})(?:\\s+(?:19|20)\\d{2})?${EFTER}`, "giu"),
  new RegExp(`${FORE}(?:den\\s+)?(?:[1-9]|[12]\\d|3[01])(?::[ae])?\\s+(?:${MANAD})(?:\\s+(?:19|20)\\d{2})?${EFTER}`, "giu"),
  new RegExp(`${FORE}(?:${MANAD})\\s+(?:19|20)\\d{2}${EFTER}`, "giu"),
  new RegExp(`${FORE}(?:år|året)\\s+(?:19|20)\\d{2}${EFTER}`, "giu"),
  new RegExp(`${FORE}(?:vecka|veckorna|v\\.)\\s*\\d{1,2}(?:(?:\\s+(?:och|till)\\s+|[–-])\\d{1,2})*${EFTER}`, "giu"),
];
/**
 * Siffror i alla skrivsätt (`\p{N}`), inte bara 0–9: "７", "٣", "⑦" och "⁷" är också tal (granskningen). För 0–9 är
 * regeln densamma som förut. Ett datum eller klockslag med andra siffror än 0–9 skyddas inte av TIDER och märks.
 */
const SIFFROR = new RegExp(`${FORE}(?:\\p{N}{1,3}(?:[ \\u00a0\\u202f]\\p{N}{3})+|\\p{N}+)(?:[.,]\\p{N}+)?(?:\\s?%)?`, "gu");
/** Delarna ett tal i bokstäver byggs av. Längre delar först, så att "sjutton" inte läses som "sju". */
const TALDEL = "ettusen|noll|tretton|fjorton|femton|sexton|sjutton|arton|nitton|tjugo|trettio|fyrtio|femtio|sextio|sjuttio|åttio|nittio|hundra|tusen|elva|tolv|två|tre|fyra|fem|sex|sju|åtta|nio|tio|ett|en";
/**
 * Tal i bokstäver, också sammansatta: "tolv", "tvåhundra", "femtiotusen", "trehundrafemtio".
 * Ordet ska bestå av taldelar från början till slut. "en" och "ett" ensamma är artiklar och räknas inte.
 */
const TALORD = new RegExp(
  `(?<![\\p{L}])(?!(?:en|ett)(?![\\p{L}]))(?:(?:${TALDEL})+|miljon(?:er)?|miljard(?:er)?)(?![\\p{L}])`,
  "giu",
);

/** Ord för mängder: "båda", "hälften", "en tredjedel", "dubbelt så många", "ett par". De är också tal. */
const KVANTORD = /(?<![\p{L}])(?:båda|bägge|hälften|halva|dubbelt|tredubbelt|(?:tredje|fjärde|femte|tionde)del(?:en|ar|arna)?|ett\s+par)(?![\p{L}])/giu;

/** Märken och våra egna platshållare får aldrig komma utifrån: varken ur modellens text eller ur ett verktygssvar. */
const tvatta = (s: string): string => s.replace(/⟦/g, "[").replace(/⟧/g, "]").replace(/[-]/g, "");
const plats = (bas: number, i: number): string => String.fromCharCode(bas) + String.fromCharCode(0xe100 + i) + String.fromCharCode(bas + 1);
const platsRe = (bas: number): RegExp => new RegExp(`${String.fromCharCode(bas)}([\\uE100-\\uF000])${String.fromCharCode(bas + 1)}`, "g");

function slaUpp(svar: Record<string, unknown>[], anrop: number, falt: string): number | string | undefined {
  const r = slaUppMedSkal(svar, anrop, falt);
  return "varde" in r ? r.varde : undefined;
}

/** Som `slaUpp`, men säger varför en hänvisning inte gick att slå upp. Skälet går tillbaka till Claude. */
function slaUppMedSkal(svar: Record<string, unknown>[], anrop: number, falt: string): { varde: number | string } | { skal: string } {
  let x: unknown = svar[anrop - 1];
  if (x === undefined || x === null) return { skal: `anrop ${anrop} finns inte` };
  // Ett svar som bär modellens egna ord (ett utkast den själv skrivit) är ingen källa: annars kunde ett påhittat tal tvättas genom det.
  // Undantaget är fält servern själv räknat (`_belagda`), som antalet uppgifter i utkastet.
  const rot = x as Record<string, unknown>;
  if (rot._egnaOrd === true && !(Array.isArray(rot._belagda) && rot._belagda.includes(falt))) return { skal: "svaret bär dina egna ord och är ingen källa" };
  for (const del of falt.split(".")) {
    if (del.startsWith("_") || x === null || typeof x !== "object" || !Object.hasOwn(x as object, del)) return { skal: "fältet finns inte" };
    x = (x as Record<string, unknown>)[del];
  }
  if (x === null || x === undefined || (typeof x === "string" && !x.trim())) return { skal: "fältet är tomt" };
  if (typeof x === "number") return Number.isFinite(x) ? { varde: x } : { skal: "fältet är tomt" };
  if (typeof x === "string") return { varde: x };
  return { skal: "fältet är en lista eller en grupp, inte ett tal" };
}

/** Hänvisningarna i texten som inte går att slå upp, var och en med sitt skäl. */
export function hanvisningsfel(text: string, svar: Record<string, unknown>[]): string[] {
  return [...text.matchAll(REF)].flatMap((m) => {
    const r = slaUppMedSkal(svar, Number(m[1]), m[2]);
    return "skal" in r ? [`{{t:${m[1]}.${m[2]}}}: ${r.skal}`] : [];
  });
}

/** Fälten med tal som går att hänvisa till, som `1.antal`. Claude får listan när ett svar skrivs om. */
export function talfalt(svar: Record<string, unknown>[]): string[] {
  const ut: string[] = [];
  svar.forEach((s, i) => {
    const ga = (x: unknown, stig: string, djup: number): void => {
      if (ut.length >= 40 || djup > 3 || x === null || typeof x !== "object") return;
      for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
        if (k.startsWith("_") || (Array.isArray(x) && Number(k) > 2)) continue;
        const ny = stig ? `${stig}.${k}` : k;
        if (typeof v === "number" && Number.isFinite(v) && "varde" in slaUppMedSkal(svar, i + 1, ny)) ut.push(`${i + 1}.${ny}`);
        else ga(v, ny, djup + 1);
      }
    };
    ga(s, "", 0);
  });
  return ut;
}

/** Citat inom raka eller typografiska citattecken, på en rad. */
const CITAT = /"([^"\n]{1,400})"|“([^”\n]{1,400})”|”([^”\n]{1,400})”|«([^»\n]{1,400})»/g;
/** Kortare än så kan ett citat vara en bit av ett datum eller ett tal, och skyddar ingenting. */
const CITAT_MINST = 8;

/** All text i verktygssvaren som går att citera. Svar med modellens egna ord och fält med understreck är ingen källa. */
function textUr(svar: Record<string, unknown>[]): string[] {
  const ut: string[] = [];
  const ga = (x: unknown, djup: number): void => {
    if (djup > 6 || ut.length > 2000) return;
    if (typeof x === "string") { const s = x.replace(/\s+/g, " ").trim(); if (s) ut.push(s); return; }
    if (Array.isArray(x)) { for (const y of x) ga(y, djup + 1); return; }
    if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) if (!k.startsWith("_")) ga(v, djup + 1);
  };
  for (const s of svar) if (s && s._egnaOrd !== true) ga(s, 0);
  return ut;
}

/** Är `inne` ett helt fält, eller en hel mening i fältet? En bit av en mening kan klippa ett tal ("15" ur "115"). */
const utanSlut = (x: string): string => x.replace(/[\s.!?:;,]+$/u, "").trim();
const helDel = (falt: string, inne: string): boolean => {
  const c = utanSlut(inne);
  return utanSlut(falt) === c || falt.split(/(?<=[.!?])\s+/u).some((m) => utanSlut(m) === c);
};

/** Märkreglerna som text. De ingår i provets avtryck: ändras de gäller inte ett gammalt prov. */
export const MARKREGLER = [REF, ...TIDER, SIFFROR, TALORD, KVANTORD, CITAT].map((r) => r.source).join("\n") + `\n${CITAT_MINST}`;

/** Byter varje ordagrant citat ur ett verktygssvar mot det `ny` ger. Andra citat lämnas orörda. */
function ersattCitat(text: string, svar: Record<string, unknown>[], ny: (m: string) => string): string {
  const kallText = textUr(svar);
  return text.replace(CITAT, (m, ...g: unknown[]) => {
    const inne = String(g.slice(0, 4).find((x) => typeof x === "string") ?? "").replace(/\s+/g, " ").trim();
    return inne.length >= CITAT_MINST && /\p{L}/u.test(inne) && kallText.some((s) => helDel(s, inne)) ? ny(m) : m;
  });
}

/** Texten utan citaten ur datan: det Claude själv säger. Provet letar förbjudna ord bara där. */
export const utanDatacitat = (text: string, svar: Record<string, unknown>[]): string => ersattCitat(text, svar, () => "\"…\"");

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
  // Ett ordagrant citat ur ett verktygssvar är datan själv, med datan som källa. Claude påstår inget tal i det.
  t = ersattCitat(t, svar, (m) => { if (tider.length >= 3000) return m; tider.push(m); return plats(0xe002, tider.length - 1); });
  for (const re of TIDER) t = t.replace(re, (m) => { if (tider.length >= 3000) return m; tider.push(m); return plats(0xe002, tider.length - 1); });
  const markt = (m: string): string => { obelagda++; return `⟦obelagt:${m}⟧`; };
  t = t.replace(SIFFROR, markt).replace(TALORD, markt).replace(KVANTORD, markt);
  t = t.replace(platsRe(0xe002), (_m, c: string) => tider[c.charCodeAt(0) - 0xe100] ?? "").replace(platsRe(0xe000), (_m, c: string) => refar[c.charCodeAt(0) - 0xe100] ?? "");
  return { text: t, tal, obelagda };
}

/** Texten utan märken, som den läses: för loggen och för den som inte kan klicka. */
export const utanMarken = (text: string): string => text.replace(/⟦(?:t\d+|obelagt):([^⟧]*)⟧/g, "$1");

/* ------------------------------------------------------------------------ */
/* Kostnaden                                                                 */
/* ------------------------------------------------------------------------ */

/** Dollar per miljon token, in och ut (designdokumentet, "Kostnad"). De tre modellerna chatten kan ställas på. */
const PRIS: Record<string, { inn: number; ut: number }> = {
  "claude-opus-5-5": { inn: 4, ut: 20 },
  "claude-sonnet-5-5": { inn: 2, ut: 10 },
  "claude-haiku-5-5": { inn: 0.1, ut: 0.5 },
};
export const KANDA_MODELLER: readonly string[] = Object.keys(PRIS);
/**
 * Reservmodellerna Anthropic kan låta ta över en fråga som den valda modellen avböjer. De kan inte väljas, men
 * de kostar: 5 och 25 dollar per miljon token, mer än Opus 5.5.
 */
const RESERVPRIS: Record<string, { inn: number; ut: number }> = {
  "claude-opus-5": { inn: 5, ut: 25 },
  "claude-opus-4-8": { inn: 5, ut: 25 },
};
/** Det dyraste priset Nav känner till. En okänd modell räknas så, så att gränsen aldrig underskattas. */
const DYRAST = Object.values({ ...PRIS, ...RESERVPRIS }).reduce((a, p) => ({ inn: Math.max(a.inn, p.inn), ut: Math.max(a.ut, p.ut) }), { inn: 0, ut: 0 });
/** Haiku 5.5 kostar mer när prompten är över 100 000 token. */
const HAIKU_STOR = { grans: 100_000, inn: 0.5, ut: 2.5 };
/** Att läsa ur cachen kostar en tiondel av en vanlig intoken, att skriva dit en fjärdedel mer (fem minuters cache). */
const CACHE_LAS = 0.1;
const CACHE_SKRIV = 1.25;

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  /** Ett försök per modell som körde: den begärda och varje reservmodell. Saknas när bara en modell körde. */
  iterations?: ({ type: string; model?: string | null } & Partial<Usage>)[] | null;
};

/** Modellens namn utan datum på slutet: "claude-sonnet-5-5-20261001" är "claude-sonnet-5-5". */
const utanDatum = (modell: string): string => modell.replace(/-\d{8}$/, "");
/** Samma modell, med eller utan datum i namnet: API:t svarar med det daterade namnet när frågan bad om aliaset. */
export const sammaModell = (a: string, b: string): boolean => utanDatum(a) === utanDatum(b);
const KAND_PRIS: Record<string, { inn: number; ut: number }> = { ...PRIS, ...RESERVPRIS };

function prisFor(modell: string, prompt: number): { inn: number; ut: number } {
  const namn = utanDatum(modell);
  if (namn === "claude-haiku-5-5" && prompt > HAIKU_STOR.grans) return HAIKU_STOR;
  return KAND_PRIS[namn] ?? DYRAST;
}

export type Forsok = { modell: string; reserv: boolean; usage: Usage };

/**
 * Försöken bakom ett svar. Avböjer den valda modellen och en reservmodell tar över står varje försök för sig i
 * `usage.iterations`, med sin egen modell och sina egna token, och Anthropic tar betalt för varje. Toppens
 * `usage` gäller då bara det sista försöket. `svarade` är modellen som stod för svaret (`model` i svaret).
 */
export function forsok(modell: string, usage: Usage, svarade: string = modell): Forsok[] {
  const lista = Array.isArray(usage.iterations) ? usage.iterations : [];
  if (!lista.length) return [{ modell: svarade, reserv: utanDatum(svarade) !== utanDatum(modell), usage }];
  return lista.map((f) => {
    const u: Usage = { input_tokens: f.input_tokens ?? 0, output_tokens: f.output_tokens ?? 0, cache_read_input_tokens: f.cache_read_input_tokens ?? 0, cache_creation_input_tokens: f.cache_creation_input_tokens ?? 0 };
    if (f.type === "fallback_message") return { modell: f.model || "okand", reserv: true, usage: u };
    if (f.type === "message") return { modell: f.model || modell, reserv: false, usage: u };
    // Ett försök av en sort Nav inte känner räknas som den dyraste modellen.
    return { modell: "okand", reserv: false, usage: u };
  });
}

/**
 * Kostnaden i dollar för ett anrop: det Anthropic tar betalt, ur token och modellens pris, för varje försök.
 * Gränserna räknas på det här talet. En okänd modell räknas som den dyraste, så att gränsen aldrig underskattas.
 */
export function kostnadUsd(modell: string, usage: Usage, svarade: string = modell): number {
  return forsok(modell, usage, svarade).reduce((summa, f) => {
    const u = f.usage;
    const las = u.cache_read_input_tokens || 0;
    const skriv = u.cache_creation_input_tokens || 0;
    const p = prisFor(f.modell, (u.input_tokens || 0) + las + skriv);
    return summa + ((u.input_tokens || 0) * p.inn + las * p.inn * CACHE_LAS + skriv * p.inn * CACHE_SKRIV + (u.output_tokens || 0) * p.ut) / 1e6;
  }, 0);
}

/** Samma kostnad i kronor, för den som läser loggen. */
export const kostnadKr = (modell: string, usage: Usage, krPerDollar: number): number => kostnadUsd(modell, usage) * krPerDollar;

/** Det mesta en fråga kan kosta i uttoken: varje varv fullt ut, till modellens utpris. Läggs på förbrukningen före anropet. */
export const maxFragaUsd = (modell: string, maxUt: number, maxVarv: number): number => (prisFor(modell, 0).ut * maxUt * maxVarv) / 1e6;

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

/** Beskedet när personens förra fråga inte är klar. */
export const PAGAR_BESKED = "Din förra fråga pågår fortfarande. Försök igen när den är klar.";

/**
 * Chattens rutt får arbeta högst 120 s (`maxDuration` i src/app/nav2/chatt/route.ts, som måste stå som ett tal där).
 * En pågående rad äldre än så, plus 10 s, har fastnat: funktionen dog, eller slutraden gick inte att skriva, och
 * slutraden kommer aldrig. Samma gräns för spärren (forePagar) och för utfall och Stämmer inte (vantarSlutrad).
 */
export const PAGAR_MS = 130_000;

/** Beskedet när raden ännu inte har sin slutrad (R1): utfall och Stämmer inte tas emot först när den är skriven. */
export const EJ_KLAR_BESKED = "Svaret sparas fortfarande. Försök igen om en stund.";

/**
 * Väntar loggraden fortfarande på sin slutrad (R1)? `pagar`, eller `stoppas` i väntan på slutraden, och yngre än
 * PAGAR_MS. En äldre sådan rad får aldrig sin slutrad, så "försök igen om en stund" vore ett löfte som inte håller.
 * Går tiden inte att läsa räknas raden som väntande.
 */
export function vantarSlutrad(stopReason: unknown, nar: unknown, nu: number): boolean {
  if (stopReason !== "pagar" && stopReason !== "stoppas") return false;
  const t = typeof nar === "string" ? Date.parse(nar) : NaN;
  return !Number.isFinite(t) || nu - t < PAGAR_MS;
}

/**
 * En fråga i taget per person. Varje fråga reserverar sin rad (`stop_reason` "pagar") i tur och ordning, och läser
 * sedan personens pågående rader. Finns en annan som reserverades före min väntar min: av två frågor stoppas aldrig
 * båda. Två som läser samtidigt kan båda gå igenom, som utan spärren. En rad äldre än `maxMs` har fastnat (funktionen
 * dog innan raden rättades) och räknas inte.
 */
export function forePagar(rader: unknown, min: string, nu: number, maxMs: number): boolean {
  if (!Array.isArray(rader)) return false;
  const lista = (rader as { id?: unknown; nar?: unknown }[]).flatMap((r) => {
    const t = typeof r?.nar === "string" ? Date.parse(r.nar) : NaN;
    return typeof r?.id === "string" && Number.isFinite(t) && nu - t < maxMs ? [{ id: r.id, t }] : [];
  });
  const jag = lista.find((r) => r.id === min)?.t ?? nu;
  return lista.some((r) => r.id !== min && (r.t < jag || (r.t === jag && r.id < min)));
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

/**
 * Ett tidigare svar som skickas med i samtalet: utan märken och utan tal, så att ett gammalt tal inte kan återanvändas utan källa.
 * Datum, klockslag och veckonummer står kvar (A2-1), med samma regel som `sattInTal` släpper igenom dem i svaret (`TIDER`):
 * en följdfråga som "Lägg den dagen efter" behöver dagen. Texten kommer från klienten, så märken och platshållare tvättas först.
 */
export const utanTal = (text: string): string => {
  const tider: string[] = [];
  let t = tvatta(utanMarken(text));
  for (const re of TIDER) t = t.replace(re, (m) => { if (tider.length >= 3000) return m; tider.push(m); return plats(0xe002, tider.length - 1); });
  // Siffror i alla skrivsätt (`\p{N}`), som i SIFFROR: "７" och "⑦" är också tal och får inte nå Claude ur en tidigare tur.
  return t.replace(/\p{N}+(?:[\s.,:]\p{N}+)*/gu, "[tal]").replace(platsRe(0xe002), (_m, c: string) => tider[c.charCodeAt(0) - 0xe100] ?? "");
};

/** Kortets läge i historiken (A2-2): utfallen (`UTFALL`), och ett kort som fortfarande väntar på personen. */
const KORTLAGE: Record<string, string> = { godkant: "godkändes", delvis: "gjordes delvis", avbrutet: "avbröts", angrat: "ångrades", vantar: "väntar på Godkänn" };
/** Högst så här många steg och kort per tur i historiken, och så lång blir raden. */
export const HISTORIA_STEG = 4;
export const HISTORIA_KORT = 3;
const HISTORIA_RAD_TECKEN = 400;
/**
 * Text från klienten i historikraden och i Om: inga styrtecken, märken, platshållare, citattecken eller parenteser, och
 * kort. Först NFKC, så att tecken i full bredd ("＂", "（") och andra skrivsätt blir de vanliga och tas bort, och sedan
 * alla parenteser och citattecken (`\p{Ps}`, `\p{Pe}`, `\p{Pi}`, `\p{Pf}`), inte bara de vanligaste (granskningen):
 * texten kan då varken stänga formen eller härma en ny. Kortas sist, för NFKC kan göra texten längre.
 */
const radText = (v: unknown, n: number): string =>
  tvatta(typeof v === "string" ? v.normalize("NFKC") : "").replace(/[\u0000-\u001f\u007f-\u009f"\p{Ps}\p{Pe}\p{Pi}\p{Pf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, n).trim();

/**
 * Den sista raden i ett tidigare svars tur (A2-2): vad som hämtades och vad som hände med korten, till exempel
 * "(Hämtat: hållna möten för laget, förra veckan. Kortet ”Ring Hagby Glas” godkändes.)". Raden byggs ur det klienten
 * skickar med turen: `hamtat`, texterna i `hamtar` för stegen som svarade, och `kortUtfall`, varje korts text och läge.
 * Den är data om turen, aldrig en instruktion: formen är fast, texterna tvättas och kortas, ett okänt läge tas inte med,
 * och talen tas bort med `utanTal`, som i svaret. Tom när inget finns att säga.
 */
export function historiaRad(hamtat: unknown, kortUtfall: unknown): string {
  const steg = (Array.isArray(hamtat) ? (hamtat as unknown[]) : [])
    .map((s) => radText(s, 120).replace(/^(?:Hämtar|Söker i) /, "").replace(/\.$/, ""))
    .filter((s) => s && !/^(?:Förbereder|Kontrollerar) /.test(s))
    .slice(0, HISTORIA_STEG);
  const kort = (Array.isArray(kortUtfall) ? (kortUtfall as unknown[]) : [])
    .flatMap((k) => {
      const o = (k && typeof k === "object" ? k : {}) as { text?: unknown; lage?: unknown };
      const text = radText(o.text, 80);
      const lage = typeof o.lage === "string" && Object.hasOwn(KORTLAGE, o.lage) ? KORTLAGE[o.lage] : "";
      return text && lage ? [`Kortet ”${text}” ${lage}.`] : [];
    })
    .slice(0, HISTORIA_KORT);
  const inne = [steg.length ? `Hämtat: ${steg.join("; ")}.` : "", ...kort].filter(Boolean).join(" ");
  return inne ? `(${utanTal(inne).slice(0, HISTORIA_RAD_TECKEN)})` : "";
}

/* ------------------------------------------------------------------------ */
/* Om den här (O)                                                            */
/* ------------------------------------------------------------------------ */

/**
 * Det en fråga kan gälla: en sak personen tittar på i Nav, och orden den får i frågans tur. Bara sådant ett verktyg kan
 * läsa: Väntar (las_vantar), ett möte eller en uppgift (las_dag, las_vecka) och ett tal i Din månad (las_matt,
 * las_provision). Inget verktyg flyttar eller ändrar något, och listan lovar inte det heller.
 */
export const OM_SORTER = { vantar: "en rad i Väntar på dig", mote: "ett möte i kalendern", uppgift: "en uppgift", manad: "ett tal i Din månad" } as const;
/** Så lång blir titeln i frågans tur. */
export const OM_TECKEN = 120;
/** Formens början. Systemtexten säger samma början, så att de aldrig skiljer sig. */
export const OM_BORJAN = "(Om:";

/**
 * Raden före frågan när den gäller något personen tittar på (O), till exempel
 * "(Om: en rad i Väntar på dig ”Skicka offert till Solbacken: frist 16 nov.”)". Formen är fast. Titeln är text från
 * skärmen och data, aldrig en instruktion: den tvättas som historikens rad (inga styrtecken, märken, citattecken eller
 * parenteser, så att den inte kan stänga formen eller börja en ny rad), utan osynliga formattecken, kortas till
 * OM_TECKEN tecken, och talen byts mot "[tal]" (`utanTal`), för titeln är inget belägg. Datum och klockslag står kvar.
 * "" utan något (`undefined` eller `null`); `null` när det inte går att läsa (en sort utanför listan, ingen titel).
 */
export function omRad(om: unknown): string | null {
  if (om === undefined || om === null) return "";
  if (typeof om !== "object" || Array.isArray(om)) return null;
  const o = om as { sort?: unknown; titel?: unknown };
  if (typeof o.sort !== "string" || !Object.hasOwn(OM_SORTER, o.sort)) return null;
  const titel = utanTal(radText(typeof o.titel === "string" ? o.titel.replace(/\p{Cf}/gu, "") : "", OM_TECKEN));
  return titel ? `${OM_BORJAN} ${OM_SORTER[o.sort as keyof typeof OM_SORTER]} ”${titel}”)` : null;
}

/* ------------------------------------------------------------------------ */
/* Fråga tillbaka (B2)                                                       */
/* ------------------------------------------------------------------------ */

/** Valet under en fråga tillbaka: frågan och knapparna. Ett klick ställer alternativet som nästa fråga, med historik. */
export type Val = { fraga: string; alternativ: string[] };
/**
 * Högst så många knappar, och så långa. Kortare än tre tecken går inte att ställa som en fråga (rutten svarar 400).
 * Längden är kandidaternas längsta (ett bolag, 120 tecken i verktyg.ts), så att ingen kandidat stryks för sin längd.
 */
export const VAL_MAX = 4;
export const VAL_TECKEN = 120;
const VAL_FRAGA_TECKEN = 300;
const likt = (s: string): string => s.replace(/\s+/g, " ").trim().toLocaleLowerCase("sv-SE");

/**
 * Valet ur Claudes anrop till fraga_tillbaka (B2). Ett alternativ står kvar bara om det står ordagrant (versaler och
 * mellanrum räknas inte) bland `kandidater` i ett av den här frågans verktygssvar, eller som hela ord i personens egen
 * fråga, eller som `bolag` på en rad i ett svar från las_affarer när bolaget har ett helt ord gemensamt med personens fråga
 * (provet 2026-11-17: Claude listade affärerna och frågade direkt, utan att gå vägen som ger kandidater), och om det
 * inte ger ett obelagt tal (`sattInTal`). Knappen bär källans egen text, aldrig Claudes. Inget annat är
 * en källa, varken historiken eller det frågan gäller (Om): ett klick ställer alternativet som personens fråga.
 * Dubbletter och alternativ kortare än tre eller längre än VAL_TECKEN tecken stryks, och högst VAL_MAX står kvar.
 * Stryks ett alternativ ur källan för att det bär ett tal ("Bygg 24 AB") visas inga knappar alls: ett halvt urval kunde
 * läsas som hela (granskningen). Blir färre än två kvar visar slingan frågan som vanlig text.
 */
export function valUr(input: unknown, svar: readonly Record<string, unknown>[], fraga: string): Val {
  const i = (input && typeof input === "object" ? input : {}) as { fraga?: unknown; alternativ?: unknown };
  const text = (typeof i.fraga === "string" ? i.fraga : "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, VAL_FRAGA_TECKEN);
  const kandidater = svar.flatMap((s) => (s && Array.isArray(s.kandidater) ? (s.kandidater as unknown[]).filter((k): k is string => typeof k === "string") : []));
  // Ett bolag ur affärslistan räknas bara när det delar ett helt ord (minst tre tecken) med frågan: det är det otydliga namnet.
  const ord = new Set((fraga.match(/[\p{L}\p{N}]{3,}/gu) ?? []).map((w) => w.toLocaleLowerCase("sv-SE")));
  const bolag = svar.flatMap((s) => (s && s._verktyg === "las_affarer" && Array.isArray(s.affarer) ? (s.affarer as unknown[]) : []))
    .map((a) => (a && typeof a === "object" ? (a as { bolag?: unknown }).bolag : null))
    .filter((b): b is string => typeof b === "string" && (b.match(/[\p{L}\p{N}]{3,}/gu) ?? []).some((w) => ord.has(w.toLocaleLowerCase("sv-SE"))));
  const alternativ: string[] = [];
  let talStruket = false;
  for (const a of Array.isArray(i.alternativ) ? (i.alternativ as unknown[]) : []) {
    if (typeof a !== "string" || alternativ.length >= VAL_MAX) continue;
    const n = a.replace(/\s+/g, " ").trim();
    if (!n) continue;
    const monster = n.replace(/[.*+?^$|()[\]{}\\]/g, "\\$&").replace(/ /g, "\\s+");
    const iFragan = new RegExp(FORE + monster + EFTER, "iu").exec(fraga)?.[0];
    const kalla = (kandidater.find((k) => likt(k) === likt(n)) ?? iFragan ?? bolag.find((b) => likt(b) === likt(n)) ?? "").replace(/\s+/g, " ").trim();
    if (kalla.length < 3 || kalla.length > VAL_TECKEN || alternativ.some((x) => likt(x) === likt(kalla))) continue;
    if (sattInTal(kalla, [...svar]).obelagda > 0) { talStruket = true; continue; }
    alternativ.push(kalla);
  }
  return { fraga: text, alternativ: talStruket ? [] : alternativ };
}

/* ------------------------------------------------------------------------ */
/* Reservmodellen                                                            */
/* ------------------------------------------------------------------------ */

/**
 * Turen som den skickas tillbaka efter att en reservmodell tagit över mitt i den. Före det sista bytet
 * (`fallback`-blocket) behålls bara text, och bytesmärket står kvar där det stod. Tänkande och verktygsanrop
 * från modellen som avböjde tas bort, och de verktygen körs aldrig. Efter bytet behålls allt. Utan byte är
 * turen orörd. (Anthropics anvisning, "Echoing fallback turns back".)
 */
export function efterReserv<T extends { type: string }>(innehall: T[]): T[] {
  let sista = -1;
  innehall.forEach((b, i) => { if (b.type === "fallback") sista = i; });
  if (sista < 0) return innehall;
  return innehall.filter((b, i) => i >= sista || b.type === "text" || b.type === "fallback");
}

/* ------------------------------------------------------------------------ */
/* Bifoga: bilder och PDF i en fråga (skiss 9)                               */
/* ------------------------------------------------------------------------ */

/**
 * Högst tre filer, högst 3 MB var och 3 MB tillsammans. Taket är Vercels: en begäran får vara högst 4,5 MB,
 * och filerna går som base64 (en tredjedel större). Bilagorna sparas aldrig: loggen får bara antal och sort.
 */
export const BILAGA = { max: 3, maxBytes: 3 * 1024 * 1024, sorter: ["image/png", "image/jpeg", "image/webp", "application/pdf"] } as const;
export type Bilaga = { sort: (typeof BILAGA.sorter)[number]; namn: string; data: string };
const SORTNAMN: Record<string, string> = { "image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WEBP", "application/pdf": "PDF" };
const bytesAv = (b64: string): number => Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);

export function lasBilagor(x: unknown): { ok: true; bilagor: Bilaga[] } | { ok: false; fel: string } {
  if (x === undefined || x === null) return { ok: true, bilagor: [] };
  if (!Array.isArray(x)) return { ok: false, fel: "Filen går inte att skicka: okänt format." };
  if (x.length > BILAGA.max) return { ok: false, fel: `Filen går inte att skicka: högst ${BILAGA.max} filer per fråga.` };
  const ut: Bilaga[] = [];
  let summa = 0;
  for (const r of x as Record<string, unknown>[]) {
    const namn = String(r?.namn ?? "filen").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120) || "filen";
    const sort = String(r?.sort ?? "");
    const data = String(r?.data ?? "");
    if (!(BILAGA.sorter as readonly string[]).includes(sort)) return { ok: false, fel: `Filen går inte att skicka: ${namn} är varken en bild (PNG, JPEG, WEBP) eller en PDF.` };
    if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return { ok: false, fel: `Filen går inte att skicka: ${namn} gick inte att läsa.` };
    const n = bytesAv(data);
    if (n > BILAGA.maxBytes) return { ok: false, fel: `Filen går inte att skicka: ${namn} är större än 3 MB.` };
    summa += n;
    ut.push({ sort: sort as Bilaga["sort"], namn, data });
  }
  if (summa > BILAGA.maxBytes) return { ok: false, fel: "Filen går inte att skicka: filerna är större än 3 MB tillsammans." };
  return { ok: true, bilagor: ut };
}

/**
 * Bilagorna som block i frågans tur: en bild som image, en PDF som document. Texten kommer efter. Den sista bär ett
 * cachemärke: bilagan skickas om i varje varv, och från andra varvet läses den ur cachen till en tiondel av priset.
 * Märket ändrar inget av det Claude läser.
 */
export function bilageBlock(bilagor: readonly Bilaga[]): Record<string, unknown>[] {
  return bilagor.map((b, n) => ({
    type: b.sort === "application/pdf" ? "document" : "image",
    source: { type: "base64", media_type: b.sort, data: b.data },
    ...(n === bilagor.length - 1 ? { cache_control: { type: "ephemeral" } } : {}),
  }));
}

/**
 * Det mesta bilagorna kan kosta, för reservationen: en bild högst 1 600 token, en PDF högst en token per tre byte
 * och aldrig mer än 100 sidor à 3 000. Bilagan skickas om i varje varv, så kostnaden räknas gånger varven.
 */
export function bilagaUsd(modell: string, bilagor: readonly Bilaga[], maxVarv: number): number {
  if (!bilagor.length) return 0;
  const token = bilagor.reduce((a, b) => a + (b.sort === "application/pdf" ? Math.min(300_000, Math.ceil(bytesAv(b.data) / 3)) : 1600), 0);
  return (prisFor(modell, token).inn * token * maxVarv) / 1e6;
}

/** Det loggen får veta om bilagorna: antal och sort, aldrig namn eller innehåll. */
export const bilagaLogg = (bilagor: readonly Bilaga[]): string => (bilagor.length ? ` [${bilagor.length} bifogade: ${bilagor.map((b) => SORTNAMN[b.sort]).join(", ")}]` : "");

/* ------------------------------------------------------------------------ */
/* Strömmen: svaret skrivs fram mening för mening (varv 2, A1-1)             */
/* ------------------------------------------------------------------------ */

/** Högst en `text`-händelse så här ofta. */
export const UTKAST_MS = 120;

/**
 * Slutet på en mening: punkt, frågetecken eller utropstecken (med citattecken eller parentes efter) följt av ett
 * blanktecken, eller en radbrytning. Hänvisningarnas klamrar och fetstilens stjärnor läses i samma svep.
 */
const GRANS = /\{\{|\}\}|\*\*|[.!?]["”»’')\]]*(?=\s)|\n/g;

/**
 * Var de hela meningarna slutar (index efter skiljetecknet), efter `fran`. En mening är hel när nästa tecken redan
 * har kommit och är ett blanktecken, så att "10.30", "{{t:1.antal}}" och "t.ex" aldrig klipps vid punkten. Ett
 * slut inne i en hänvisning (`{{` utan `}}`) eller inne i fetstil (udda antal `**`) räknas inte. Ett svep.
 */
export function meningsgranser(text: string, fran = 0): number[] {
  const ut: number[] = [];
  let inne = false;
  let fet = false;
  for (const m of text.matchAll(GRANS)) {
    if (m[0] === "{{") inne = true;
    else if (m[0] === "}}") inne = false;
    else if (m[0] === "**") fet = !fet;
    else if (!inne && !fet) {
      const i = (m.index ?? 0) + m[0].length;
      if (i > fran) ut.push(i);
    }
  }
  return ut;
}

/** Texten fram till och med sista hela meningen. Resten kommer med svaret. */
export const helaMeningar = (text: string): string => text.slice(0, meningsgranser(text).at(-1) ?? 0).trimEnd();

/** Tecknen som kan öppna ett citat i CITAT. `»` och `’` öppnar inget där, så de kan inte ändra hur tecknen paras. */
const OPPNAR_CITAT = /["“”«]/;

/**
 * Står ett tecken som kan öppna ett citat kvar utanför ett helt citat? Då kan citatet sluta först efter texten, och
 * CITAT parar tecknen annorlunda i hela svaret: ett tal som är ett ordagrant citat i utkastet kan bli obelagt i svaret
 * (`"Kunden sa ”12 licenser.” och …"`). Utan ett sådant tecken paras varje citat i texten likadant i hela svaret, för
 * vart och ett slutar vid första slutande tecken efter det öppnande. Samma steg som i sattInTal före citaten.
 */
const oparatCitat = (text: string): boolean => OPPNAR_CITAT.test(tvatta(text).replace(REF, () => plats(0xe000, 0)).replace(TRASIG_REF, () => plats(0xe000, 0)).replace(CITAT, ""));

/**
 * Ett utkast som får visas: talen insatta som i slutsvaret, eller null. Ett obelagt tal, en halv hänvisning eller ett
 * citat som inte är slut stoppar strömmen där den är: hellre ett kortare utkast än ett tal utan källa, och varje utkast
 * är början av slutsvarets text.
 */
export function utkastAv(prefix: string, svar: Record<string, unknown>[]): { text: string; tal: InsattTal[] } | null {
  if (!prefix || oparatCitat(prefix)) return null;
  const insatt = sattInTal(prefix, svar);
  if (insatt.obelagda > 0 || /\{\{|\}\}/.test(insatt.text)) return null;
  return { text: insatt.text, tal: insatt.tal };
}

/**
 * Det längsta utkastet som får visas av meningarna som slutar efter `fran`, och var provet slutade (`provat`).
 * Varje meningsslut prövas högst en gång under ett varv: texten före det ändras inte medan resten skrivs.
 */
export function slappUtkast(text: string, svar: Record<string, unknown>[], fran = 0): { utkast: { text: string; tal: InsattTal[] } | null; provat: number } {
  const granser = meningsgranser(text, fran);
  for (let n = granser.length - 1; n >= 0; n--) {
    const u = utkastAv(text.slice(0, granser[n]).trimEnd(), svar);
    if (u) return { utkast: u, provat: granser.at(-1)! };
  }
  return { utkast: null, provat: granser.at(-1) ?? fran };
}

/* ------------------------------------------------------------------------ */
/* Efter svaret: följdfrågor, Ja-knappen och underlaget (varv 2, A1-3, A1-4)  */
/* ------------------------------------------------------------------------ */

export type Anropsrad = { namn: string; input: unknown; ok?: boolean };
export type Nasta = { text: string; knapp: string };
/** Högst så många följdfrågor under ett svar (planen: "högst två följdfrågor som går att lita på"). */
export const NASTA_MAX = 2;

const PERIODPAR: Record<string, string> = { "denna-vecka": "forra-veckan", "forra-veckan": "denna-vecka", "denna-manad": "forra-manaden", "forra-manaden": "denna-manad" };
const vemSort = (v: unknown): string => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!s || ["jag", "mig", "mina", "min"].includes(s)) return "jag";
  if (["laget", "teamet", "alla"].includes(s)) return "laget";
  return s;
};
const versal = (s: string): string => s.charAt(0).toLocaleUpperCase("sv-SE") + s.slice(1);
const jamforbar = (s: string): string => s.toLocaleLowerCase("sv-SE").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Följdfrågorna under ett svar. Regler, inte AI: de byggs ur de verktygsanrop som svarade, aldrig ur Claudes text.
 * Varje fråga står på egna ben (behöver ingen historik) och är samma sorts fråga som provet redan prövar.
 *   - las_matt: samma mått för den andra perioden av samma slag (veckan och förra veckan, månaden och förra
 *     månaden), och för laget när frågan gällde dig och du får se fler än dig själv (`laget`), eller för dig när
 *     den gällde laget.
 *   - las_provision: den andra månaden.
 *   - las_affarer: laget när frågan gällde dig och du får se laget, eller dina när den gällde laget.
 *   - las_dag: i morgon, när frågan gällde i dag.
 * Det som redan lästs i frågan föreslås inte, inte heller frågan som just ställdes. `laget` ska vara samma prövning
 * som verktyget gör (`vemKrets`): kretsen är alla, eller har någon annan än personen. En fråga om en namngiven person
 * ger inga följdfrågor: namnet är Claudes indata till verktyget, och följdfrågan får inte bära något Claude har skrivit.
 */
export function nastaFragor(i: { anrop: readonly Anropsrad[]; fraga: string; idag: string; laget: boolean }): Nasta[] {
  const lasta = new Set(i.anrop.map((a) => nyckelFor(a.namn, (a.input ?? {}) as Record<string, unknown>)));
  const stalld = jamforbar(i.fraga);
  const ut: Nasta[] = [];
  const lagg = (namn: string, input: Record<string, unknown>, text: string, knapp: string) => {
    if (ut.length >= NASTA_MAX) return;
    const n = nyckelFor(namn, input);
    if (lasta.has(n) || jamforbar(text) === stalld || ut.some((x) => x.text === text)) return;
    ut.push({ text, knapp });
  };
  const imorgon = /^\d{4}-\d{2}-\d{2}$/.test(i.idag) ? new Date(Date.parse(`${i.idag}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : "";
  for (const a of i.anrop) {
    if (a.ok !== true) continue;
    const input = (a.input ?? {}) as Record<string, unknown>;
    const vem = vemSort(input.vem);
    if (a.namn === "las_matt") {
      const matt = String(input.matt ?? "");
      const namn = (MATTNAMN as Record<string, string>)[matt];
      const period = String(input.period ?? "");
      const andra = PERIODPAR[period];
      const text = (p: string) => periodFor(p, i.idag)?.text ?? "";
      if (!namn || !andra || !text(period) || !text(andra) || (vem !== "jag" && vem !== "laget")) continue;
      lagg("las_matt", { matt, vem, period: andra }, `Hur många ${namn} hade ${vem} ${text(andra)}?`, versal(text(andra)));
      if (vem === "jag" && i.laget) lagg("las_matt", { matt, vem: "laget", period }, `Hur många ${namn} hade laget ${text(period)}?`, "Laget");
      if (vem === "laget") lagg("las_matt", { matt, vem: "jag", period }, `Hur många ${namn} hade jag ${text(period)}?`, "Bara jag");
    } else if (a.namn === "las_provision") {
      const andra = PERIODPAR[String(input.manad ?? "")];
      const text = andra ? periodFor(andra, i.idag)?.text : undefined;
      if (text && (andra === "denna-manad" || andra === "forra-manaden")) lagg("las_provision", { manad: andra }, `Hur ser min provision ut för ${text}?`, versal(text));
    } else if (a.namn === "las_affarer") {
      if (vem === "jag" && i.laget) lagg("las_affarer", { vem: "laget" }, "Hur ser lagets öppna affärer ut?", "Laget");
      if (vem === "laget") lagg("las_affarer", { vem: "jag" }, "Hur ser mina öppna affärer ut?", "Bara mina");
    } else if (a.namn === "las_dag") {
      if (imorgon && input.dag === i.idag) lagg("las_dag", { dag: imorgon }, "Vad har jag i morgon?", "I morgon");
    }
  }
  return ut;
}

/** Vad ett anrop läser, så att samma läsning inte föreslås två gånger. */
function nyckelFor(namn: string, input: Record<string, unknown>): string {
  if (namn === "las_matt") return `${namn}|${String(input.matt ?? "")}|${vemSort(input.vem)}|${String(input.period ?? "")}`;
  if (namn === "las_affarer") return `${namn}|${vemSort(input.vem)}`;
  if (namn === "las_provision") return `${namn}|${String(input.manad ?? "")}`;
  if (namn === "las_dag") return `${namn}|${String(input.dag ?? "")}`;
  return namn;
}

/**
 * Sista meningen är en fråga om att göra något ("Ska jag lägga en uppgift om det?"). Bara en markering: Ja-knappen
 * visas inte förrän B4, eftersom svaret på "Ja, gör det." beror på historiken, som tappar tal och datum (A2-1).
 */
const SKA_JAG = /(?:^|[.?!]\s|\n)Ska jag [^?\n]{3,160}\?\s*$/;
export const jaFraga = (text: string, kort: number): boolean => kort === 0 && SKA_JAG.test(utanMarken(text).trim());

/** `rubrik` sätts av samtalet ur verktygets källrad (`kallrad`), som bor bredvid verktygen och inte här. */
export type Underlag = { anrop: number; verktyg: string; rubrik?: string; kolumner: string[]; rader: (string | number | null)[][]; totalt: number | null };
/** Högst så många rader och kolumner i underlaget. */
export const UNDERLAG_RADER = 10;
export const UNDERLAG_KOLUMNER = 4;

const cell = (v: unknown): string | number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, 120) : null;
const antalEller = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

/**
 * Raderna bakom svarets tal, ett klick bort: ur det verktygssvar som flest av svarets tal kommer ur, och bara när
 * det svaret har en lista som är en tabell. Inget nytt läses och ingenting räknas: `totalt` är verktygets eget
 * antal, och null när verktyget inte har något (Väntar på dig räknar inte sina rader, och ska inte räknas här).
 * Underlaget går aldrig till Claude och står aldrig i svarets text.
 */
export function underlagUr(svar: readonly Record<string, unknown>[], tal: readonly InsattTal[]): Underlag | null {
  const per = new Map<number, number>();
  for (const t of tal) per.set(t.kalla.anrop, (per.get(t.kalla.anrop) ?? 0) + 1);
  let anrop = 0;
  for (const [a, n] of per) if (!anrop || n > (per.get(anrop) ?? 0)) anrop = a;
  const s = svar[anrop - 1];
  if (!anrop || !s || typeof s.fel === "string") return null;
  const lista = (k: string): Record<string, unknown>[] => (Array.isArray(s[k]) ? (s[k] as unknown[]).filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);
  const verktyg = String(s._verktyg ?? "");
  let kolumner: string[] = [];
  let rader: (string | number | null)[][] = [];
  let totalt: number | null = null;
  if (verktyg === "las_affarer") {
    kolumner = ["Bolag", "Steg", "Nästa", "Belopp"];
    rader = lista("affarer").map((a) => [cell(a.bolag), cell(a.steg), cell(typeof a.nastaDag === "string" ? `${a.nastaDag}${typeof a.nastaTid === "string" && a.nastaTid ? ` ${a.nastaTid}` : ""}` : null), cell(a.belopp)]);
    totalt = antalEller(s.oppna);
  } else if (verktyg === "las_provision") {
    kolumner = ["Order", "Belopp"];
    rader = lista("rader").map((r) => [cell(r.text), cell(r.belopp)]);
    totalt = antalEller(s.antalRader);
  } else if (verktyg === "las_dag") {
    const poster = lista("poster");
    if (poster.length) {
      kolumner = ["Tid", "Vad"];
      rader = poster.map((p) => [cell(p.tid), cell(p.rubrik)]);
      totalt = antalEller(s.kalenderposter);
    } else if (Array.isArray(s.uppgifter)) {
      kolumner = ["Uppgift"];
      rader = (s.uppgifter as unknown[]).map((u) => [cell(u)]);
      totalt = antalEller(s.uppgifterKvar);
    }
  } else if (verktyg === "las_vantar" && Array.isArray(s.rader)) {
    kolumner = ["Väntar"];
    rader = (s.rader as unknown[]).map((r) => [cell(r)]);
  }
  rader = rader.filter((r) => r.some((c) => c !== null)).slice(0, UNDERLAG_RADER).map((r) => r.slice(0, UNDERLAG_KOLUMNER));
  if (!rader.length) return null;
  return { anrop, verktyg, kolumner: kolumner.slice(0, UNDERLAG_KOLUMNER), rader, totalt };
}

/* ------------------------------------------------------------------------ */
/* Kortens utfall och raden en begäran gäller (varv 2, A1-2, A1-5)           */
/* ------------------------------------------------------------------------ */

/** En loggrads id: en uuid, som databasen ger. Allt annat avvisas innan det når databasen. */
export const arRadId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * Det som kan hända med ett kort efter svaret (planen A1-5): godkänt, delvis (några steg gick igenom, andra inte),
 * avbrutet eller ångrat. Avfärdat följs upp på samma sätt som godkänt. Allt annat avvisas.
 */
export const UTFALL = ["godkant", "delvis", "avbrutet", "angrat"] as const;
/**
 * Fälten på ett kort som personen kan rätta före Godkänn (funktion 6), i den ordning de skrivs: raden (`titel`, för en
 * uppföljning bolaget), dagen och vem uppgiften är åt. Ett kort som ändrades räknas inte som att AI:n hade rätt.
 */
export const ANDRAT = ["titel", "dag", "till"] as const;
export type AndratFalt = (typeof ANDRAT)[number];
/**
 * Fälten varje kort har. En uppföljning har bolaget (`titel`) och dagen, men ingen "åt": ett `till` på ett sådant kort
 * är inget personen kan ha ändrat, och skrivs inte. Ett förbered-verktyg som saknas här får hela ANDRAT, så att en
 * ändring aldrig tappas.
 */
export const ANDRAT_FOR: Readonly<Record<string, readonly AndratFalt[]>> = {
  forbered_uppgifter: ANDRAT,
  forbered_uppfoljning: ["titel", "dag"],
};
/** `andrat` finns bara när personen ändrade något, och då i ANDRAT:s ordning, utan dubbletter. */
export type Utfall = { rad: string; anrop: number; lage: (typeof UTFALL)[number]; andrat?: AndratFalt[] };

export function lasUtfall(x: unknown): { ok: true; utfall: Utfall } | { ok: false; fel: string } {
  const u = (x ?? {}) as Record<string, unknown>;
  if (!x || typeof x !== "object" || Array.isArray(x)) return { ok: false, fel: "Utfallet saknas." };
  if (!arRadId(u.rad)) return { ok: false, fel: "Svaret saknas." };
  if (typeof u.anrop !== "number" || !Number.isInteger(u.anrop) || u.anrop < 1 || u.anrop > 100) return { ok: false, fel: "Kortet saknas." };
  if (!(UTFALL as readonly unknown[]).includes(u.lage)) return { ok: false, fel: "Okänt utfall." };
  // Ändrat är klientens ord, som läget: bara en lista med kända fält tas emot. Tom lista, eller null, är inget ändrat.
  if (u.andrat !== undefined && u.andrat !== null && (!Array.isArray(u.andrat) || u.andrat.length > 10 || !u.andrat.every((f) => (ANDRAT as readonly unknown[]).includes(f)))) {
    return { ok: false, fel: "Okänt fält i ändrat." };
  }
  const andrat = ANDRAT.filter((f) => Array.isArray(u.andrat) && u.andrat.includes(f));
  return { ok: true, utfall: { rad: u.rad.toLowerCase(), anrop: u.anrop, lage: u.lage as Utfall["lage"], ...(andrat.length ? { andrat } : {}) } };
}

/** Är loggens anrop ett kort som visades? Bara korSamtal sätter `kort: true`, där kortet läggs i svaret. */
export const visatKort = (a: unknown): boolean => {
  const x = a as Record<string, unknown> | null | undefined;
  return !!x && typeof x === "object" && String(x.namn ?? "").startsWith("forbered_") && x.ok === true && x.kort === true;
};

/**
 * Villkoren för att skriva ett utfall utan att skriva över ett annat: varje visat korts `utfall` som det lästes
 * (null när inget fanns). Rutten skriver bara om raden fortfarande står så (`verktyg->i->>utfall`), så att två utfall
 * samtidigt på samma rad (två kort, ett dubbelklick) inte tar ut varandra. Index från 0, som i jsonb.
 */
export function kortensUtfall(verktyg: unknown): [number, string | null][] {
  if (!Array.isArray(verktyg)) return [];
  return verktyg.flatMap((a, i): [number, string | null][] => {
    if (!visatKort(a)) return [];
    const v = (a as Record<string, unknown>).utfall;
    return [[i, v === undefined || v === null ? null : typeof v === "string" ? v : JSON.stringify(v)]];
  });
}

/**
 * Loggradens verktyg med kortets utfall inskrivet, eller null när anropet inte är ett kort som visades (`visatKort`:
 * ett förbered-anrop som svarade och vars kort lades i svaret, alltså inte en dubblett och inte ett kort över
 * KORT_MAX). Ingen ny kolumn: `verktyg` är redan jsonb. Samma utfall en gång till (ett dubbelklick, ett omförsök)
 * ändrar ingenting, så att `utfallNar` förblir första gången: `andrad` är då falsk.
 */
export function medUtfall(verktyg: unknown, u: Utfall, nar: string): { verktyg: unknown[]; andrad: boolean } | null {
  if (!Array.isArray(verktyg)) return null;
  const a = verktyg[u.anrop - 1] as Record<string, unknown> | undefined;
  if (!a || !visatKort(a)) return null;
  if (a.utfall === u.lage) return { verktyg, andrad: false };
  // Ändrat (funktion 6) skrivs bara med kortets första utfall: ett fält kan bara ha ändrats före Godkänn. Ett senare
  // utfall (godkänt, sedan ångrat) behåller det som står och kan varken lägga till eller ta bort något. Så räknas ett
  // ändrat kort aldrig om till ett som AI:n hade rätt i, och en ändring efter beslutet skrivs inte som en före.
  // Bara fält som kortet har (ANDRAT_FOR): `till` på en uppföljning skrivs inte. Blir inget kvar skrivs ingen `andrat`.
  const forsta = a.utfall === undefined || a.utfall === null;
  const har = ANDRAT_FOR[String(a.namn ?? "")] ?? ANDRAT;
  const andrat = (u.andrat ?? []).filter((f) => har.includes(f));
  const ny = [...verktyg];
  ny[u.anrop - 1] = { ...a, utfall: u.lage, utfallNar: nar, ...(forsta && andrat.length ? { andrat } : {}) };
  return { verktyg: ny, andrad: true };
}

/** Medianen av talen, eller null när det inte finns något tal. Mätningen före varje påstående om tid (A1-6). */
export function median(tal: readonly number[]): number | null {
  const s = tal.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Raden provet (`scripts/chatt-prov.mjs`) skriver per modell: median-ms för hela samtalet och median-varv (anrop till
 * Claude) per körning, med antalet körningar som bar mätningen. En sparad körning från före mätningen (utan `varv` och
 * `tider`) räknas inte, och finns ingen alls står det att den saknas, aldrig noll.
 */
export function medianRad(korningar: readonly unknown[]): string {
  const matta = mattaKorningar(korningar);
  if (!matta.length) return "Median per körning: saknas (ingen körning bar mätningen).";
  const ms = Math.round(median(matta.map((m) => m.ms)) ?? 0);
  return `Median per körning: ${ms} ms och ${median(matta.map((m) => m.varv))} varv, av ${matta.length} ${matta.length === 1 ? "körning" : "körningar"}.`;
}

/** Körningarna som bar mätningen (A1-6): varv och ms. En sparad körning från före mätningen räknas inte. */
function mattaKorningar(korningar: readonly unknown[]): { varv: number; ms: number }[] {
  return korningar.flatMap((r) => {
    const x = (r ?? {}) as { varv?: unknown; tider?: { totalt?: unknown } | null };
    const ms = x.tider?.totalt;
    return typeof x.varv === "number" && Number.isFinite(x.varv) && typeof ms === "number" && Number.isFinite(ms) ? [{ varv: x.varv, ms }] : [];
  });
}

/**
 * Anteckningen som `scripts/chatt-prov.mjs --kor` sparar per modell i `nav_chatt_prov.anteckning`: varv, omskrivna
 * svar, reservmodellen, frågorna som föll och medianraden (A1-6) sist. Här, och inte i skriptet, så att texten går att
 * pröva utan att provet körs (det kostar pengar).
 */
export function provAnteckning(r: { varv: number; omskrivna: number; korningar: number; reserv: number; fall: readonly { id: string }[]; median: string; grupper?: readonly Provgrupp[] }): string {
  // B-satsen: grupperna (de femtio godkända och de nya, var för sig) står sist, så att nästa jämförelse går att räkna ur raden.
  return `${r.varv} varv per fråga. Omskrivna svar: ${r.omskrivna} av ${r.korningar}. Reservmodellen tog över ${r.reserv} ${r.reserv === 1 ? "gång" : "gånger"}. Föll: ${r.fall.map((f) => f.id).join(", ") || "inga"}. ${r.median}${r.grupper?.length ? ` ${r.grupper.map((g) => g.rad).join(" ")}` : ""}`;
}

/* ------------------------------------------------------------------------ */
/* B-satsens godkännande                                                     */
/* ------------------------------------------------------------------------ */

/** Avtrycket vars godkända rad i `nav_chatt_prov` B-satsen jämförs med (chatt-plan.md, B, överst). */
export const FORE_AVTRYCK = "485de06db391";

/** En grupp frågor i provet, räknad ur körningarna: de femtio godkända eller de nya. `rad` är det provet skriver. */
export type Provgrupp = { namn: string; ratt: number; fragor: number; omskrivna: number; korningar: number; medianVarv: number | null; rad: string };

/** Gruppen ur frågornas utfall: en fråga är rätt bara när varje körning av den är rätt. */
export function provgrupp(namn: string, utfallen: readonly { ratt: boolean; matningar: readonly unknown[] }[]): Provgrupp {
  const m = utfallen.flatMap((x) => x.matningar);
  const ratt = utfallen.filter((x) => x.ratt).length;
  const omskrivna = m.filter((r) => Boolean((r as { omskrivet?: unknown } | null)?.omskrivet)).length;
  return {
    namn, ratt, fragor: utfallen.length, omskrivna, korningar: m.length, medianVarv: median(mattaKorningar(m).map((x) => x.varv)),
    rad: `${namn}: ${ratt} av ${utfallen.length} rätt. Omskrivna svar: ${omskrivna} av ${m.length}. ${medianRad(m)}`,
  };
}

/**
 * B-satsens fyra villkor (chatt-plan.md, B, överst), ett per rad med "ja", "nej" eller "går inte att räkna" och skälet:
 * (1) de femtio godkända frågorna har minst lika många rätt som den godkända raden för FORE_AVTRYCK, (2) de nya frågorna
 * är rätta, (3) median-varv och (4) andelen omskrivna svar har inte ökat. 3 och 4 gäller de femtio, för bara de har en
 * före-rad: talen ur radens anteckning ("Omskrivna svar: a av b", "Median per körning: … och n varv"). Bär anteckningen
 * de femtios egen grupp (provAnteckning med grupper) jämförs den, med gruppens rätt; annars de första talen. `fore` är raden
 * (`ratt`, `fragor`, `anteckning`), "ingen" när databasen är läst och modellen inte har någon godkänd rad, null när
 * raden inte är läst; `antal` är hur många frågor varje grupp har i frågefilen, så att ett delprov aldrig räknas som
 * hela. Raderna avgör inget: en människa godkänner raden för hand.
 */
export function godkannandet(
  fore: { ratt: number; fragor: number; anteckning: string | null } | "ingen" | null,
  femtio: Provgrupp | null,
  nya: Provgrupp | null,
  antal: { femtio: number; nya: number },
): string[] {
  const jaNej = (ok: boolean) => (ok ? "ja" : "nej");
  const ejKord = (g: Provgrupp | null, alla: number) => (!g ? `går inte att räkna: de kördes inte` : g.fragor !== alla ? `går inte att räkna: ${g.fragor} av ${alla} kördes` : null);
  const ejRad = fore === "ingen" ? `går inte att räkna: modellen har ingen godkänd rad för ${FORE_AVTRYCK}` : `går inte att räkna: den godkända raden för ${FORE_AVTRYCK} är inte läst`;
  const rad = fore === "ingen" ? null : fore;
  // En rad i den nya formen bär de femtios grupp sist, och då jämförs den: talen först gäller hela körningen, med de nya
  // frågorna (granskningen). En rad i den gamla formen, som den godkända för FORE_AVTRYCK, har bara hela körningens tal.
  const namn = femtio?.namn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const grupp = rad && namn ? new RegExp(`${namn}: (\\d+) av (\\d+) rätt\\. Omskrivna svar: (\\d+) av (\\d+)\\. Median per körning: (?:\\d+ ms och (\\d+(?:\\.\\d+)?) varv|saknas)`).exec(rad.anteckning ?? "") : null;
  const forstaOm = /Omskrivna svar: (\d+) av (\d+)/.exec(rad?.anteckning ?? "");
  const forstaVarv = /Median per körning: \d+ ms och (\d+(?:\.\d+)?) varv/.exec(rad?.anteckning ?? "");
  const foreRad = rad && grupp ? { ratt: Number(grupp[1]), fragor: Number(grupp[2]) } : rad;
  const omFore = grupp ? [grupp[3], grupp[4]] : forstaOm ? [forstaOm[1], forstaOm[2]] : null;
  const varvFore = grupp ? (grupp[5] ?? null) : (forstaVarv?.[1] ?? null);
  const f = ejKord(femtio, antal.femtio);
  const n = ejKord(nya, antal.nya);
  const g = femtio!;
  return [
    `1. De ${antal.femtio} godkända frågorna har minst lika många rätt som den godkända raden: ${f ?? (!foreRad ? ejRad : foreRad.fragor !== g.fragor ? `går inte att räkna: raden har ${foreRad.fragor} frågor` : `${g.ratt} av ${g.fragor} mot ${foreRad.ratt} av ${foreRad.fragor}: ${jaNej(g.ratt >= foreRad.ratt)}`)}.`,
    `2. De nya frågorna är rätta: ${n ?? `${nya!.ratt} av ${nya!.fragor}: ${jaNej(nya!.ratt === nya!.fragor)}`}.`,
    `3. Median-varv för de ${antal.femtio} har inte ökat: ${f ?? (!rad ? ejRad : !varvFore ? "går inte att räkna: den godkända radens anteckning saknar medianen (raden är från före mätningen)" : g.medianVarv === null ? "går inte att räkna: körningarna bar ingen mätning" : `${g.medianVarv} mot ${varvFore}: ${jaNej(g.medianVarv <= Number(varvFore))}`)}.`,
    `4. Andelen omskrivna svar för de ${antal.femtio} har inte ökat: ${f ?? (!rad ? ejRad : !omFore ? "går inte att räkna: den godkända radens anteckning saknar antalet" : `${g.omskrivna} av ${g.korningar} mot ${omFore[0]} av ${omFore[1]}: ${jaNej(g.omskrivna * Number(omFore[1]) <= Number(omFore[0]) * g.korningar)}`)}.`,
    "Raderna avgör inget. En människa jämför och godkänner raden för hand.",
  ];
}

/**
 * Början av ärendet som Stämmer inte under ett svar i chatten skriver (`/nav2/hem`, `flagga` med `var: "chatt"`), med
 * loggradens id i parentesen. Avläsningen för den som sköter chatten (`chattLage`) räknar ärendena på det.
 */
export const STAMMER_INTE_HUVUD = "Startsidan, chatten: svaret stämmer inte (loggrad ";
/** Loggradens id ur ett Stämmer inte-ärende, eller null när texten inte är ett sådant ärende. */
export function stammerInteId(body: unknown): string | null {
  if (typeof body !== "string" || !body.startsWith(STAMMER_INTE_HUVUD)) return null;
  const id = body.slice(STAMMER_INTE_HUVUD.length, STAMMER_INTE_HUVUD.length + 36).toLowerCase();
  return arRadId(id) && body[STAMMER_INTE_HUVUD.length + 36] === ")" ? id : null;
}

/** Verktygen ett kort går att bygga om med, utan Claude (funktion 6). Läsningarna går bara genom en fråga. */
export const KOMMANDO_VERKTYG = ["forbered_uppgifter", "forbered_uppfoljning"] as const;
export type Kommando = { verktyg: (typeof KOMMANDO_VERKTYG)[number]; input: Record<string, unknown> };
/** Så lång får en text i ett kommando vara. Kortet klipper själv det som visas och görs (`korVerktyg`). */
const KOMMANDO_TECKEN = 1000;

/**
 * Ett kommando från webbläsaren: `{verktyg, input}`. Claudes input prövas mot verktygets schema hos Anthropic,
 * webbläsarens gör det inte, så det prövas här lika strängt: bara de två förbered-verktygen, exakt schemats nycklar och
 * texter som texter (inga tal, listor eller styrtecken som blir en titel; tab och radbrytning går, som i Claudes input).
 * Svaret bär input i schemats form, inget annat.
 */
export function lasKommando(x: unknown): { ok: true; kommando: Kommando } | { ok: false; fel: string } {
  if (!x || typeof x !== "object" || Array.isArray(x)) return { ok: false, fel: "Kortet saknas." };
  const k = x as Record<string, unknown>;
  if (!(KOMMANDO_VERKTYG as readonly unknown[]).includes(k.verktyg)) return { ok: false, fel: "Okänt verktyg." };
  const verktyg = k.verktyg as Kommando["verktyg"];
  const FEL = { ok: false as const, fel: "Kortet går inte att läsa." };
  const arObjekt = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const exakt = (o: Record<string, unknown>, nycklar: readonly string[]) => Object.keys(o).length === nycklar.length && nycklar.every((n) => Object.hasOwn(o, n));
  // Tab och radbrytning tas emot: Claudes input kan bära dem, och kortet slår ihop blanktecken själv (`kort`).
  const text = (v: unknown): v is string => typeof v === "string" && v.length <= KOMMANDO_TECKEN && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);
  const input = k.input;
  if (!arObjekt(input)) return FEL;
  if (verktyg === "forbered_uppgifter") {
    const lista = input.uppgifter;
    if (!exakt(input, ["uppgifter"]) || !Array.isArray(lista) || lista.length < 1 || lista.length > UTKAST_MAX) return FEL;
    const uppgifter: { titel: string; dag: string; till: string }[] = [];
    for (const u of lista) {
      if (!arObjekt(u) || !exakt(u, ["titel", "dag", "till"]) || !text(u.titel) || !text(u.dag) || !text(u.till)) return FEL;
      uppgifter.push({ titel: u.titel, dag: u.dag, till: u.till });
    }
    return { ok: true, kommando: { verktyg, input: { uppgifter } } };
  }
  if (!exakt(input, ["bolag", "dag"]) || !text(input.bolag) || !text(input.dag)) return FEL;
  return { ok: true, kommando: { verktyg, input: { bolag: input.bolag, dag: input.dag } } };
}

/**
 * Verktygens egna fel är skrivna till Claude, och några ber den fråga personen. När kortet byggs om står felet under
 * fältet personen skrev i, så de säger i stället vad personen kan skriva. Claude får samma text som förut.
 */
const TILL_PERSONEN: Record<string, string> = {
  "En uppgift läggs åt en person i taget. Fråga vem som ska göra den.": "En uppgift läggs åt en person i taget. Skriv vem som ska göra den.",
  "Flera heter så.": "Flera heter så. Skriv hela namnet.",
  "Fråga vilket bolag det gäller.": "Skriv vilket bolag det gäller.",
  "Flera öppna affärer matchar namnet.": "Flera öppna affärer matchar namnet. Skriv hela bolagsnamnet.",
};
export const kommandoFel = (fel: string): string => TILL_PERSONEN[fel] ?? fel;
/** Texterna kommandoFel byter, för provet: varje sådan text ska finnas i verktyg.ts, annars byts den aldrig. */
export const KOMMANDO_FEL_TEXTER = Object.keys(TILL_PERSONEN);
