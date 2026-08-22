/**
 * E0.6 felrapportering. Ren logik, inga importer.
 *
 * Samma skal som avvikelsemotorn och losenordskraven: det har ska ga att prova
 * utan att starta Next, eftersom det ar den enda delen av felrapporteringen som
 * gar att prova alls. Skrivningen provas mot databasen i tests/fel.mjs, men
 * `maskera()` ar en ren strangfunktion och behover inget mer an indata.
 *
 * Hela behorighetsresonemanget i migration 0026 vilar pa att `maskera()` gor
 * det den sager. Andrar du den: las rubriken "Behorighet" i 0026 forst.
 */

export type Felstatus = "new" | "ack" | "closed";
export type Felsort = "automatic" | "manual";

export const STATUS_ETIKETT: Record<Felstatus, string> = {
  new: "Ny",
  ack: "Tittar på den",
  closed: "Avslutad",
};

export const SORT_ETIKETT: Record<Felsort, string> = {
  automatic: "Fångat av navet",
  manual: "Inrapporterat",
};

/**
 * Tak for hur mycket text som sparas.
 *
 * En stack fran Next med serverkomponenter kan bli tiotusentals tecken, och
 * raderna efter de forsta tjugo ar ramverkets eget innanmate. Klipp gor tabellen
 * lasbar; det som klipps bort hade anda inte pekat pa navets kod.
 */
export const MAX_MEDDELANDE = 2000;
export const MAX_STACK = 8000;
export const MAX_BODY = 4000;

const EPOST = /[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+/g;
const PERSONNUMMER = /\b(?:19|20)?\d{6}[-+]?\d{4}\b/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/**
 * Postgres skriver ut det krockande vardet i klartext:
 *
 *   duplicate key value violates unique constraint "employee_email_key"
 *   DETAIL: Key (email)=(anna@exempel.se) already exists.
 *
 * Kolumnnamnet ar det som beratter vad som gick fel. Vardet ar persondata och
 * behovs inte for att laga nagot, sa det ar vardet som gar.
 */
const PG_NYCKELVARDE = /\((\s*[\w",\s]+?\s*)\)=\(([^)]*)\)/g;

/**
 * Tar bort det som kan vara en uppgift om en manniska ur en teknisk text.
 *
 * Ordningen ar inte godtycklig: postgresregeln gar forst och tommer parentesen
 * i klartext, darefter fangar de tre ovriga sadant som star fritt i texten.
 *
 * Funktionen ar avsiktligt trubbig. En maskering som forsoker vara smart och
 * bara ta bort "riktiga" adresser slapper igenom det den inte kanner igen, och
 * det ar fel vag att fela har. Ett uuid som maskeras bort kostar ett
 * uppslag i loggen; ett personnummer som star kvar kostar mer.
 *
 * Det den INTE tar: fritext som nagon skrivit i en rubrik och som kastats
 * tillbaka i ett felmeddelande. Det gar inte att kanna igen, och darfor ar
 * lasbehorigheten i 0026 anda smal.
 */
export function maskera(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const rensad = text
    .replace(PG_NYCKELVARDE, (_m, kolumn: string) => `(${kolumn.trim()})=(dolt)`)
    .replace(EPOST, "[e-post]")
    .replace(PERSONNUMMER, "[personnummer]")
    .replace(UUID, "[id]");
  return rensad.length === 0 ? null : rensad;
}

/** Maskerar och klipper. Anvands pa allt som skrivs till `message`/`stack`. */
export function maskeraOchKlipp(text: string | null | undefined, tak: number): string | null {
  const m = maskera(text);
  if (m === null) return null;
  return m.length <= tak ? m : `${m.slice(0, tak)}\n… (klippt)`;
}

/**
 * Sokvag utan query och fragment.
 *
 * En query bar sokord, filter och ibland ett namn — `/sok?q=anna` sager vem
 * nagon letade efter. Sokvagen sager var felet lag, och det ar det man behover
 * for att hitta tillbaka till koden.
 *
 * Tar emot bade en hel URL och en ren sokvag, eftersom klienten skickar
 * `location.pathname` och servern far en absolut adress.
 */
export function rensaSokvag(inkommande: string | null | undefined): string {
  if (!inkommande) return "/";
  let s = String(inkommande).trim();
  if (s === "") return "/";

  const utanSchema = s.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "");
  s = utanSchema === "" ? "/" : utanSchema;

  s = s.split("?")[0].split("#")[0];
  if (!s.startsWith("/")) s = `/${s}`;

  // Sokvagar med ett id i sig grupperas ihop. /arenden/<uuid> och
  // /arenden/<ett annat uuid> ar samma sida och samma bugg — utan det blir
  // varje besok pa en trasig detaljsida en egen rad i kon.
  s = s.replace(UUID, ":id");

  return s.length > 300 ? s.slice(0, 300) : s;
}

/**
 * Vad kon ska visa overst.
 *
 * Blockerande fore icke-blockerande, darefter nyast. Antalet drabbade avgor
 * INTE ordningen: ett fel som stoppar en person fran att stampla ut ar
 * viktigare an ett skevt datum som femton personer sett och rott pa axlarna at.
 */
export function sorteraKo<
  T extends { blocking: boolean; last_seen_at: string; status: Felstatus },
>(rader: T[]): T[] {
  const rang: Record<Felstatus, number> = { new: 0, ack: 1, closed: 2 };
  return [...rader].sort((a, b) => {
    if (rang[a.status] !== rang[b.status]) return rang[a.status] - rang[b.status];
    if (a.blocking !== b.blocking) return a.blocking ? -1 : 1;
    return b.last_seen_at.localeCompare(a.last_seen_at);
  });
}

/** Kort etikett for en rad i kon. Digesten ar det enda en klientrapport har. */
export function rubrikFor(rad: {
  kind: Felsort;
  message: string | null;
  body: string | null;
  digest: string | null;
  path: string;
}): string {
  if (rad.kind === "manual") {
    const forsta = (rad.body ?? "").split("\n")[0].trim();
    return forsta.length > 90 ? `${forsta.slice(0, 90)}…` : forsta || rad.path;
  }
  if (rad.message) {
    const forsta = rad.message.split("\n")[0].trim();
    return forsta.length > 90 ? `${forsta.slice(0, 90)}…` : forsta;
  }
  return `Fel på ${rad.path}${rad.digest ? ` (${rad.digest.slice(0, 8)})` : ""}`;
}
