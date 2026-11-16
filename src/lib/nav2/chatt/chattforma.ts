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
  // Ett spann mellan två dagar som slutar på en månad: "9–15 nov", "1 till och med den 18 november".
  new RegExp(`${FORE}(?:den\\s+)?(?:[1-9]|[12]\\d|3[01])\\s*(?:[–-]|till(?:\\s+och\\s+med)?)\\s*(?:den\\s+)?(?:[1-9]|[12]\\d|3[01])(?::[ae])?\\s+(?:${MANAD})(?:\\s+(?:19|20)\\d{2})?${EFTER}`, "giu"),
  new RegExp(`${FORE}(?:den\\s+)?(?:[1-9]|[12]\\d|3[01])(?::[ae])?\\s+(?:${MANAD})(?:\\s+(?:19|20)\\d{2})?${EFTER}`, "giu"),
  new RegExp(`${FORE}(?:${MANAD})\\s+(?:19|20)\\d{2}${EFTER}`, "giu"),
  new RegExp(`${FORE}(?:år|året)\\s+(?:19|20)\\d{2}${EFTER}`, "giu"),
  new RegExp(`${FORE}(?:vecka|veckorna|v\\.)\\s*\\d{1,2}(?:(?:\\s+(?:och|till)\\s+|[–-])\\d{1,2})*${EFTER}`, "giu"),
];
const SIFFROR = new RegExp(`${FORE}(?:\\d{1,3}(?:[ \\u00a0\\u202f]\\d{3})+|\\d+)(?:[.,]\\d+)?(?:\\s?%)?`, "gu");
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

/** Ett tidigare svar som skickas med i samtalet: utan märken och utan tal, så att ett gammalt tal inte kan återanvändas utan källa. */
export const utanTal = (text: string): string => utanMarken(text).replace(/\d+(?:[\s.,:]\d+)*/g, "[tal]");

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
