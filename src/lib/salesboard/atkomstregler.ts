/**
 * Säljtavlans åtkomst som rena beslut: kakorna, adressen och dess hink, kvoten
 * för parningskoder, TV:ns fråga under parningen, skärmuppslaget och den
 * inloggade.
 *
 * Ren logik utan Next och utan Supabase, så att den går att prova med node
 * (`tests/salesboard-server.mjs`). `atkomst.ts` och parningsrutten gör anropen
 * och frågar här vad svaren betyder.
 *
 * ===========================================================================
 * FELET GÅR ÅT DET SÄKRA HÅLLET, OCH FÖR EN TV ÄR DET 503.
 *
 * En TV som får 401 visar parningen, och ingen står bredvid och parar om den.
 * Därför ger en databas som har en dålig minut 503, som tavlan väntar ut, och
 * aldrig 401. 401 betyder bara att det är säkert att ingen åtkomst finns: ingen
 * kaka och ingen session, en skärm som kopplats bort, ett konto utan anställning
 * eller en anställd som slutat.
 * ===========================================================================
 *
 * SERVERKOD, som `parning.ts`: adressen prövas med `node:net`. Filen bär inte
 * `import "server-only"` för att proven ska kunna köra den, men den får aldrig
 * importeras av en klientkomponent.
 */

import { isIP } from "node:net";
import type { Lasning } from "./saknas.ts";

// -----------------------------------------------------------------------------
// Kakorna
// -----------------------------------------------------------------------------

export const SKARMKAKA = "nav_tavla";
/** När skärmkakan senast sattes, i millisekunder. Avgör förnyelsen. */
export const SKARMKAKA_TID = "nav_tavla_t";
export const PARKAKA = "nav_tavla_par";

/** Flaggorna på tavlans kakor: bara servern läser dem, bara över https, bara under /salesboard. */
export const KAKA = Object.freeze({ httpOnly: true, secure: true, sameSite: "lax", path: "/salesboard" } as const);

/** 400 dagar i sekunder, webbläsarnas tak för en kakas livstid. */
export const SKARMKAKA_LIVSTID = 34_560_000;

/** Parningskakan lever längre än koden (tio minuter), så att en godkänd kod hinner lösas in. */
export const PARKAKA_LIVSTID = 900;

const DYGN_MS = 86_400_000;

export type Kakval = { httpOnly: boolean; secure: boolean; sameSite: "lax"; path: string; maxAge: number };

/** En kaka att sätta: namnet, värdet och valen, som `res.cookies.set(namn, varde, val)`. */
export type Kaka = { namn: string; varde: string; val: Kakval };

const val = (maxAge: number): Kakval => ({ ...KAKA, maxAge });

/** Skärmkakan och tiden den sattes, båda i 400 dagar. */
export function skarmkakor(token: string, nu: number): Kaka[] {
  return [
    { namn: SKARMKAKA, varde: token, val: val(SKARMKAKA_LIVSTID) },
    { namn: SKARMKAKA_TID, varde: String(nu), val: val(SKARMKAKA_LIVSTID) },
  ];
}

/** Parningskakan med TV:ns nonce. */
export function parkaka(nonce: string): Kaka {
  return { namn: PARKAKA, varde: nonce, val: val(PARKAKA_LIVSTID) };
}

/** Tar bort parningskakan. Samma sökväg som den sattes med, annars ligger den kvar. */
export function parkakanBort(): Kaka {
  return { namn: PARKAKA, varde: "", val: val(0) };
}

/**
 * Ska skärmkakan förnyas? När den sattes för mer än ett dygn sedan, och när
 * tiden saknas, inte går att läsa eller ligger i framtiden. En tid som inte går
 * att lita på förnyas hellre än att lämnas: förnyelsen kostar en rubrik, och en
 * kaka som löper ut stänger ute en TV ingen rör.
 */
export function skarmkakanBehoverFornyas(satt: string | undefined, nu: number): boolean {
  const tid = satt ? Number(satt) : NaN;
  return !(Number.isFinite(tid) && tid <= nu && nu - tid <= DYGN_MS);
}

/** En token och en nonce ur `nyToken`: 43 tecken base64url. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Är värdet en välformad token? Något annat slås aldrig upp. */
export function arToken(s: unknown): s is string {
  return typeof s === "string" && TOKEN.test(s);
}

// -----------------------------------------------------------------------------
// Adressen
// -----------------------------------------------------------------------------

/** Rubrikerna, som `Headers`. */
type Rubriker = { get(namn: string): string | null };

/**
 * IPv6-adressens åtta grupper som tal, eller null. Tar en adress som `isIP`
 * redan godkänt. En IPv4-adress sist ("::ffff:1.2.3.4") blir de två sista
 * grupperna.
 */
function grupper(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const fyra = s.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (fyra) {
    const [a, b, c, d] = fyra.slice(1).map(Number);
    s = `${s.slice(0, fyra.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const [vanster, hoger, ...mer] = s.split("::");
  if (mer.length) return null;
  const v = vanster ? vanster.split(":") : [];
  const h = hoger === undefined ? null : hoger ? hoger.split(":") : [];
  const alla = h === null ? v : [...v, ...Array<string>(Math.max(0, 8 - v.length - h.length)).fill("0"), ...h];
  if (alla.length !== 8) return null;

  const tal = alla.map((g) => parseInt(g, 16));
  return tal.every((t) => Number.isInteger(t) && t >= 0 && t <= 0xffff) ? tal : null;
}

/** "::ffff:203.0.113.7" som "203.0.113.7", annars null. */
function ipv4IIpv6(ip: string): string | null {
  if (isIP(ip) !== 6) return null;
  const g = grupper(ip);
  if (!g || g.slice(0, 5).some((t) => t !== 0) || g[5] !== 0xffff) return null;
  return `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
}

/**
 * En adress som Postgres tar i en `inet`-kolumn, eller null. En sträng som inte
 * är en adress hade fällt hela skrivningen, så den prövas först.
 */
function adress(kandidat: string | null | undefined): string | null {
  const ip = kandidat?.trim() ?? "";
  // En zon (fe80::1%eth0) är en adress för Node men inte för Postgres.
  if (!isIP(ip) || ip.includes("%")) return null;
  return ipv4IIpv6(ip) ?? ip;
}

/**
 * Klientens adress: den första i `x-forwarded-for`, annars `x-real-ip`, och den
 * första som är en adress. Vercel skriver båda och skriver över det klienten
 * skickat. En IPv4-adress i IPv6-form blir IPv4, så att den räknas i rätt hink.
 */
export function klientIp(h: Rubriker): string | null {
  return adress(h.get("x-forwarded-for")?.split(",")[0]) ?? adress(h.get("x-real-ip"));
}

/** Webbläsaren, kapad vid 300 tecken, eller null. Visas i inställningarnas lista över skärmar. */
export function webblasare(h: Rubriker): string | null {
  return h.get("user-agent")?.trim().slice(0, 300) || null;
}

/**
 * Hinken en adress räknas i när kvoten prövas: en IPv4-adress för sig och en
 * IPv6-adress på sitt /64. Ett /64 är en enda anslutning, och den som har ett
 * har fler adresser att byta mellan än det finns koder. Utan adress delar alla
 * på en hink.
 */
export function adresshink(ip: string | null): string {
  if (ip === null) return "okänd";
  const fyra = ipv4IIpv6(ip);
  if (fyra) return fyra;
  if (isIP(ip) !== 6) return ip;
  const g = grupper(ip);
  return g ? `${g.slice(0, 4).map((t) => t.toString(16)).join(":")}::/64` : ip;
}

// -----------------------------------------------------------------------------
// Parningen
// -----------------------------------------------------------------------------

/** Högst så många koder får gälla samtidigt i hela tabellen. */
export const HOGST_AKTIVA = 50;

/** Högst så många koder får gälla samtidigt per hink (`adresshink`). */
export const HOGST_PER_ADRESS = 5;

/**
 * Är det för många aktiva koder för att ge en till? `aktiva` är adresserna på
 * koderna som gäller nu, utan den som frågar om sin egen gamla kod.
 */
export function forMangaKoder(aktiva: readonly (string | null)[], min: string | null): boolean {
  if (aktiva.length >= HOGST_AKTIVA) return true;
  const hink = adresshink(min);
  return aktiva.filter((a) => adresshink(a) === hink).length >= HOGST_PER_ADRESS;
}

/** Postgres: unikt värde finns redan. Här en kod som råkar finnas, en på en biljon. */
export function arKodkrock(fel: unknown): boolean {
  return typeof fel === "object" && fel !== null && (fel as { code?: unknown }).code === "23505";
}

/** Parningsraden bakom TV:ns nonce, så som TV:ns fråga ser den. */
export type Parningsrad = { expires_at: string; screen_id: string | null };

export type Parningsbeslut = { typ: "vanta" } | { typ: "utgangen" } | { typ: "los_in"; skarmId: string };

/**
 * TV:ns fråga (GET /salesboard/par). Ingen rad (eller ingen kaka): 410, och TV:n
 * visar en ny kod. En rad utan skärm väntar tills koden gått ut. En rad med
 * skärm löses in, också när koden hunnit gå ut: admin godkände den medan den
 * gällde.
 */
export function parningsbeslut(rad: Parningsrad | null, nu: number): Parningsbeslut {
  if (!rad) return { typ: "utgangen" };
  if (rad.screen_id) return { typ: "los_in", skarmId: rad.screen_id };
  return Date.parse(rad.expires_at) > nu ? { typ: "vanta" } : { typ: "utgangen" };
}

// -----------------------------------------------------------------------------
// Vem som frågar
// -----------------------------------------------------------------------------

/**
 * Uppslaget av en skärm vars kaka bär en välformad token.
 *
 *   "skarm"  skärmen finns och är inte bortkopplad
 *   "ingen"  ingen sådan skärm: kakan släpper inte in, och den inloggade prövas
 *   "fel"    uppslaget gick fel, eller tabellen saknas. En välformad token finns
 *            bara efter 0250, så också "saknas" är ett fel (503), aldrig 401.
 */
export function skarmbeslut(lasning: Lasning, harRad: boolean): "skarm" | "ingen" | "fel" {
  if (lasning !== "svar") return "fel";
  return harRad ? "skarm" : "ingen";
}

const AKTIVA = new Set(["active", "onboarding"]);

/**
 * Släpps den inloggade in?
 *
 *   "in"   en anställd som är aktiv eller håller på att börja
 *   "nej"  ingen session, en som slutat, eller ett konto utan anställning (401)
 *   "las"  en session utan employee. `getCurrentUser()` säger inte om raden saknas
 *          eller inte gick att läsa, så den läses en gång till (`egen`) och
 *          beslutet tas om.
 *   "fel"  den egna läsningen gick fel, eller raden finns och är aktiv fast
 *          `getCurrentUser()` inte fick den, alltså en läsning som föll (503)
 */
export function personbeslut(
  user: { employee: { status: string } | null } | null,
  egen?: { fel: boolean; status: string | null },
): "in" | "nej" | "las" | "fel" {
  if (!user) return "nej";
  if (user.employee) return AKTIVA.has(user.employee.status) ? "in" : "nej";
  if (!egen) return "las";
  if (egen.fel) return "fel";
  return egen.status !== null && AKTIVA.has(egen.status) ? "fel" : "nej";
}
