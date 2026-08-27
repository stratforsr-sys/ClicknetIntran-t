/**
 * E0.7. Nar nattjobbet inte gor sitt. Ren logik, inga importer.
 *
 * Samma linje som `konsekvens.ts`, `raster.ts` och `fel.ts`: allt harinne gar
 * att prova utan att starta Next och utan Supabase. Skrivningen sker nagon
 * annanstans; det som ar vart att prova ar att digesten ar stabil och att
 * granserna ligger dar de ska.
 *
 * ===========================================================================
 * LARMVAGEN AR `error_report`, INTE EN NY TABELL
 *
 * Tre skal, och inget av dem ar att spara en migration:
 *
 *   1. Notisklockan laser redan `error_report` och ger raden till den som
 *      hanterar kon.
 *   2. `/fel` AR kon, med status, ansvar och avslut. Ett larm som hamnar
 *      nagon annanstans har ingen av de tre.
 *   3. `registrera_fel` raknar upp `occurrences` pa (digest, path). Ett steg
 *      som faller varje natt i en manad ska bli EN rad med siffran 30, inte
 *      trettio rader.
 *
 * Punkt 3 ar hela skalet till att `normaliseraFel()` finns. Ett felmeddelande
 * som bar nattens datum eller radens uuid ger en ny digest varje natt, och da
 * ar raknaren meningslos — kon fylls med samma bugg om och om igen och den
 * forsta riktiga rapporten begravs.
 * ===========================================================================
 */

/**
 * Placeholders. De ar avsiktligt olika sa att en normaliserad text gar att
 * lasa: "hamtade <n> rader for <id>" sager fortfarande vad som hande.
 */
const TIDSSTAMPEL =
  /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const DATUM = /\d{4}-\d{2}-\d{2}/g;
const SIFFERGRUPP = /\d+/g;

/** Langre an sa ar ingen text som ska bli en grupperingsnyckel. */
const MAX_NORMALISERAD = 500;

/**
 * Gor ett felmeddelande stabilt over natter.
 *
 * Ordningen ar inte godtycklig. Tidsstamplarna gar forst eftersom de bar bade
 * datum och siffergrupper; uuid:n fore datum eftersom ett rent numeriskt uuid
 * annars kan klippas mitt i; siffergrupperna sist, nar allt med struktur redan
 * ar borttaget.
 *
 * Funktionen ar trubbig med flit. En normalisering som forsoker behalla
 * "intressanta" siffror far en digest som andrar sig nar felet andrar sig lite
 * grand — och da ar det ingen gruppering langre.
 */
export function normaliseraFel(text: string | null | undefined): string {
  if (text === null || text === undefined) return "";
  return String(text)
    .replace(TIDSSTAMPEL, "<tid>")
    .replace(UUID, "<id>")
    .replace(DATUM, "<datum>")
    .replace(SIFFERGRUPP, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NORMALISERAD);
}

/**
 * FNV-1a, 32 bitar, i ren JS.
 *
 * `crypto.createHash` hade gett en battre hash och samtidigt gjort filen
 * omojlig att prova som ren logik — det ar en import, och den enda importen i
 * filen. Kollisionsrisken har ar ointressant: det som hashas ar en handfull
 * feltexter fran sex steg, inte ett adressrum.
 */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    // Multiplikation med FNV-primtalet 16777619, uttryckt som skift for att
    // halla sig inom 32 bitar utan att tappa precision i en double.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Grupperingsnyckeln for ett larm.
 *
 * Steget star med i klartext: den som laser kon ska se vilket steg som fallit
 * utan att sla upp digesten nagonstans. Check-villkoret
 * `error_report_automatisk_har_digest` i 0026 nekar en automatisk rad utan
 * digest, sa den ar obligatorisk och aldrig valfri.
 */
export function larmDigest(steg: string, meddelande: string | null | undefined): string {
  return `natt-${steg}-${fnv1a(normaliseraFel(meddelande))}`;
}

/**
 * Sokvagen ett larm skrivs pa.
 *
 * FALLAN: `rensaSokvag()` klipper bort bade query och fragment. `#satser` hade
 * alltsa fallit bort och samtliga sex steg grupperats ihop till en enda rad pa
 * `/api/jobb/natt`. Ett fallet `franvaro`-steg ar en annan bugg an ett fallet
 * `satser`-steg, och de ska inte dela raknare.
 *
 * Rutten finns inte som sida, och det ar meningen. Sokvagen ar en etikett som
 * pekar ut var felet lag, precis som `/arenden/:id` gor.
 */
export function larmSokvag(steg: string): string {
  return `/api/jobb/natt/${steg}`;
}

/**
 * ===========================================================================
 * MAX_TIMMAR = 26
 *
 * Jobbet kor 02:30, en gang per dygn. Tva korningar ligger alltsa 24 timmar
 * isar, och 24 + 2 timmars slack for en korning som blir forsenad ger 26.
 *
 * Harledningen ar vart att skriva ut, for bada riktningarna ar fel:
 *
 *   - Under 24 larmar det varje dag strax fore nasta korning, nar allt ar
 *     som det ska. Ett larm som alltid lyser ar inget larm.
 *   - Over 26 blir tystnaden lang. Med 26 larmar det forst nar en korning
 *     faktiskt uteblivit — 04:30 dagen efter — och det ar den tidigaste
 *     tidpunkt da man VET nagot i stallet for att misstanka det.
 *
 * Slacken ar inte gissad. De fem kvittona i handelseloggen 2026-08-23 till
 * 2026-08-27 skrevs 02:44, 03:19, 02:30, 02:52 och 02:34 — Vercel startar
 * jobbet nar den har plats, inte pa sekunden. Storsta uppmatta avstand mellan
 * tva korningar ar 24,6 timmar. Gransen 26 ligger alltsa 1,4 timmar over det
 * varsta normala fallet och 21,4 timmar under tva uteblivna natter.
 * ===========================================================================
 */
export const MAX_TIMMAR = 26;

export type Driftlage = "ok" | "forsenat" | "aldrig";

export type Driftbesked = {
  lage: Driftlage;
  /** Timmar sedan senaste korningen, en decimal. Null nar den aldrig skett. */
  timmar: number | null;
};

/**
 * Etiketterna star har och inte i vyerna.
 *
 * Bade drift-kortet pa `/fel` och raden pa startsidan sager samma sak om samma
 * lage. Tva kopior av texten glider isar, och da beskriver de tva olika
 * allvarsgrader av ett tillstand som ar ett.
 */
export const DRIFT_ETIKETT: Record<Driftlage, string> = {
  ok: "Nattjobbet kördes som det skulle",
  forsenat: "Nattjobbet har inte kört på över ett dygn",
  aldrig: "Nattjobbet har aldrig lämnat något kvitto",
};

/**
 * Har jobbet kort nyligen nog?
 *
 * `aldrig` ar ett EGET lage och inte bara ett stort antal timmar. I koden ser
 * en korning som aldrig skett ut som en oandligt gammal korning, men for en
 * manniska ar det tva olika besked: "jobbet slutade fungera" och "jobbet har
 * aldrig fungerat". Det andra pekar pa cron-posten, det forsta pa steget.
 */
export function bedomDrift({
  senaste,
  nu,
  maxTimmar = MAX_TIMMAR,
}: {
  senaste: string | Date | null | undefined;
  nu: Date | string;
  maxTimmar?: number;
}): Driftbesked {
  if (senaste === null || senaste === undefined || senaste === "") {
    return { lage: "aldrig", timmar: null };
  }

  const da = senaste instanceof Date ? senaste : new Date(senaste);
  const till = nu instanceof Date ? nu : new Date(nu);
  if (Number.isNaN(da.getTime()) || Number.isNaN(till.getTime())) {
    return { lage: "aldrig", timmar: null };
  }

  const timmar = Math.round(((till.getTime() - da.getTime()) / 3_600_000) * 10) / 10;

  // Ett kvitto som ligger i framtiden ar en klocka som gatt fel, inte ett
  // uteblivet jobb. Att larma om det hade bytt ett problem mot ett annat.
  return { lage: timmar > maxTimmar ? "forsenat" : "ok", timmar };
}

/**
 * Texten i larmet om det uteblivna kvittot.
 *
 * Antalet timmar star i klartext for den som laser kon — och forsvinner i
 * digesten, eftersom `normaliseraFel()` byter siffergruppen mot `<n>`. Det ar
 * precis den mekanismen som gor att fjorton natters tystnad blir en rad med
 * raknaren 14 i stallet for fjorton rader.
 */
export function kvittoLarmtext(besked: Driftbesked): string {
  if (besked.lage === "aldrig") {
    return "Nattjobbet har inget kvitto alls i handelseloggen. Kontrollera cron-posten i vercel.json.";
  }
  return `Nattjobbet lamnade sitt senaste kvitto for ${besked.timmar} timmar sedan, mot gransen ${MAX_TIMMAR}. Minst en natt har hoppats over.`;
}
