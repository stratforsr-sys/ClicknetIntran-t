/**
 * Publika vagar. Allt annat kraver session.
 *
 * /api star med eftersom rutterna dar autentiserar sig sjalva — det
 * schemalagda jobbet har ingen session att visa upp, och skulle annars
 * omdirigeras till inloggningssidan och tyst gora ingenting.
 *
 * /salesboard star med av samma skal: saljtavlan hanger pa en TV utan session.
 * Varje rutt och sida under /salesboard provar sjalv vem som fragar, en parad
 * skarm eller en inloggad anstalld (src/lib/salesboard/atkomst.ts). Sessionen
 * fornyas fortfarande har for den som ar inloggad, och steg tva och
 * losenordsbytet galler som forut.
 */
const PUBLIC = ["/logga-in", "/auth", "/uppstart", "/api", "/salesboard"];

/**
 * Appens filer. Matchas EXAKT, aldrig som prefix: /nav2/sw.js.map, /app-sw.jsx
 * och /nav2/version ska fortfarande kravas inloggning for.
 *
 * Webblasaren hamtar manifestet och service workerna utan session. Ett manifest
 * bakom inloggning gor att den utloggade inte kan installera appen, och en
 * service worker-uppdatering som far en omdirigering (307 till /logga-in)
 * avvisas. Ingen av filerna innehaller nagot hemligt.
 *
 *  - /nav2/manifest.webmanifest: appens namn, ikoner och start_url.
 *  - /nav2/sw.js: pushens service worker (registreringen har rackvidd /nav2/).
 *  - /app-sw.js: appens service worker (offline-sidan).
 *  - /.well-known/assetlinks.json: Google Plays bevis for att appen hor till
 *    sajten. Filen laggs i repot forst i Google Play-passet, men vagen oppnas
 *    redan nu sa att det passet bara behover lagga till en fil.
 */
export const APPFILER: readonly string[] = [
  "/nav2/manifest.webmanifest",
  "/nav2/sw.js",
  "/app-sw.js",
  "/.well-known/assetlinks.json",
];

/**
 * Prefix som ar oppna: typsnitten (inte hemliga, och offline-sidan forladdar
 * dem) och ikonerna (bilder slapps redan av mellanvarans matcher pa filandelsen,
 * men vagen star har ocksa sa att provet kan lasa den). Prefixet maste sluta
 * med snedstreck, sa att /nav2/fonts och /nav2/fontsx/a inte traffas.
 */
const APPFILER_PREFIX = ["/nav2/fonts/", "/nav2/ikon/"];

/** Svarar vagen utan inloggning? Allt som inte star har kraver session. */
export function arPublik(path: string): boolean {
  if (PUBLIC.some((p) => path === p || path.startsWith(p + "/"))) return true;
  if (APPFILER.includes(path)) return true;
  return APPFILER_PREFIX.some((p) => path.startsWith(p));
}
