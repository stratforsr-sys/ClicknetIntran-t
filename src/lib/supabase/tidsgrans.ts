/**
 * Mellanvaran när Supabase är seg (2026-11-16).
 *
 * VARFÖR. Mellanvaran väntar på Supabase före varje sida: `getUser()` går till
 * Supabase Auth, och dagsstämpeln går till REST. Utan tidsgräns väntade den så
 * länge Supabase lät den, och när databasen stod still 2026-11-16 (en migration
 * på en Nano med strypt disk, se docs/ARBETSLOGG.md) gav Vercel upp efter en
 * stund: varje sida för den som var inloggad blev "504
 * MIDDLEWARE_INVOCATION_TIMEOUT", en kraschsida utan förklaring.
 *
 * Nu har varje anrop en tidsgräns, och ett nätfel skiljs från "inte inloggad".
 * Det andra är viktigt: ett nätfel får aldrig bli en omdirigering till
 * inloggningen. Den som då loggar in igen får samma fel, och tror att det är
 * lösenordet. I stället svarar navet 503 med en sida som säger vad som händer
 * och försöker igen av sig själv.
 *
 * Filen har inga `@/`-importer, så att tests/seg-databas.mjs kan läsa den direkt.
 */

/** Hur länge mellanvaran väntar på Supabase per anrop. Vercel ger mellanvaran 25 s. */
export const SUPABASE_TIDSGRANS_MS = 8_000;

/** Dagsstämpeln får hålla sidan i högst så här länge; resten går i bakgrunden. */
export const STAMPEL_TIDSGRANS_MS = 1_500;

/** Sekunder innan sidan försöker igen av sig själv. */
export const FORSOK_IGEN_S = 20;

/**
 * En fetch som ger upp efter `ms`. Ett eget avbrott från anroparen gäller
 * fortfarande; det som händer först vinner. Byggd på AbortController och
 * setTimeout, eftersom AbortSignal.any/timeout inte är säkra i Edge-miljön.
 */
export function medTidsgrans(bas: typeof fetch, ms: number): typeof fetch {
  return async (input, init) => {
    const styr = new AbortController();
    const timer = setTimeout(() => styr.abort(new Error(`Supabase svarade inte inom ${ms} ms`)), ms);
    const egen = init?.signal;
    if (egen) {
      if (egen.aborted) styr.abort(egen.reason);
      else egen.addEventListener("abort", () => styr.abort(egen.reason), { once: true });
    }
    try {
      return await bas(input, { ...init, signal: styr.signal });
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Var felet från `getUser()` ett nätfel (Supabase svarade inte, eller svarade
 * 5xx) och inte ett besked om sessionen?
 *
 * Supabase Auth gör tidsgränser, avbrutna anslutningar och 5xx till
 * `AuthRetryableFetchError` (status 0 eller 5xx). En saknad eller ogiltig
 * session är andra fel med status 4xx, eller `AuthSessionMissingError`; de ska
 * till inloggningen precis som förut.
 */
export function arNatfel(fel: unknown): boolean {
  if (!fel || typeof fel !== "object") return false;
  const f = fel as { name?: unknown; status?: unknown; __isAuthError?: unknown };
  if (f.name === "AuthRetryableFetchError") return true;
  const status = typeof f.status === "number" ? f.status : undefined;
  return status === 0 || (status !== undefined && status >= 500);
}

/**
 * Väntar på `p` i högst `ms`. `klar: false` betyder att tiden gick ut; löftet
 * fortsätter då i bakgrunden och dess fel sväljs.
 */
export async function inomTid<T>(p: Promise<T>, ms: number): Promise<{ klar: true; varde: T } | { klar: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ut = new Promise<{ klar: false }>((res) => {
    timer = setTimeout(() => res({ klar: false }), ms);
  });
  p.catch(() => {});
  try {
    return await Promise.race([p.then((varde) => ({ klar: true as const, varde })), ut]);
  } finally {
    clearTimeout(timer);
  }
}

/** Vill begäran ha en hel sida (en adress i webbläsaren), inte data? */
export function villHaSida(metod: string, rubriker: Headers): boolean {
  if (metod !== "GET") return false;
  const dest = rubriker.get("sec-fetch-dest");
  if (dest) return dest === "document";
  return !rubriker.has("rsc") && (rubriker.get("accept") ?? "").includes("text/html");
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Sidan som visas när Supabase inte svarar. Liten och fristående: inga typsnitt,
 * skript eller bilder som också skulle behöva laddas. Stilen bär nonce så att
 * den klarar navets CSP.
 */
export function segSida(nonce: string, adress: string): string {
  const a = esc(adress);
  return `<!doctype html>
<html lang="sv"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="${FORSOK_IGEN_S};url=${a}">
<title>Nav svarar inte just nu</title>
<style nonce="${esc(nonce)}">
:root{--bg:#f6f5f1;--fg:#1d2420;--dim:#5d665f;--linje:#d9d8d2;--knapp:#1f4d3a;--knapptext:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#141815;--fg:#e8ebe7;--dim:#9aa39b;--linje:#2b322d;--knapp:#8fc4a5;--knapptext:#10140f}}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;display:grid;place-items:center;padding:24px 16px}
main{max-width:30rem;width:100%}
h1{font-size:1.5rem;line-height:1.25;margin:0 0 .75rem;font-weight:600;letter-spacing:-.01em}
p{margin:0 0 1rem;color:var(--dim)}
.rad{display:flex;align-items:center;gap:1rem;margin-top:1.75rem;padding-top:1.25rem;border-top:1px solid var(--linje)}
a{display:inline-block;background:var(--knapp);color:var(--knapptext);text-decoration:none;padding:.65rem 1.1rem;border-radius:8px;font-weight:600}
small{color:var(--dim);font-variant-numeric:tabular-nums}
</style></head>
<body><main>
<h1>Nav får inget svar från databasen just nu</h1>
<p>Det är databasen som är överbelastad, inte din inloggning. Du behöver inte logga in igen.</p>
<p>Det brukar gå över inom några minuter. Inget du har sparat har försvunnit.</p>
<div class="rad"><a href="${a}">Försök igen</a><small>Sidan försöker själv om ${FORSOK_IGEN_S} s.</small></div>
</main></body></html>`;
}

/** Rubrikerna på ett 503 från mellanvaran: aldrig cachat, och när det är värt att försöka igen. */
export function segRubriker(): Record<string, string> {
  return { "cache-control": "no-store", "retry-after": String(FORSOK_IGEN_S) };
}
