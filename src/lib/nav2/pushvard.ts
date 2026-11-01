/**
 * Nav 2.0: vilka adresser en push-prenumeration får peka på (granskningen F2-18).
 *
 * En prenumerations `endpoint` är en adress som servern POST:ar till när något
 * pushas, både kvällsnotisen och "Skicka ett prov". Släpps vilken https-adress
 * som helst in kan vem som helst få servern att posta till en valfri värd (en
 * mild SSRF). Webbläsarnas pushtjänster har fasta värdar, och bara de släpps in.
 *
 * Filen är ren (inget server-only, inget nätverk) så att provet kan importera
 * den. `push.ts` och rutten `hem/route.ts` använder samma funktion: den prövas
 * när prenumerationen sparas och en gång till när något skickas, eftersom
 * rader som sparades före spärren annars skulle fortsätta gälla.
 */

/** Exakta värdar. */
const VARDAR = new Set([
  "fcm.googleapis.com", // Chrome, Edge (Chromium), Opera, Android
  "updates.push.services.mozilla.com", // Firefox
  "web.push.apple.com", // Safari och hemskärmsappar på iOS/macOS
]);
/** Underdomäner: `*.notify.windows.com` (Edge/Windows) och `*.push.apple.com`. */
const SUFFIX = [".notify.windows.com", ".push.apple.com"];

export function arPushtjanst(adress: unknown): boolean {
  if (typeof adress !== "string" || adress.length > 1000) return false;
  let u: URL;
  try {
    u = new URL(adress);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  if (u.port && u.port !== "443") return false;
  const v = u.hostname.toLowerCase();
  return VARDAR.has(v) || SUFFIX.some((s) => v.endsWith(s) && v.length > s.length);
}
