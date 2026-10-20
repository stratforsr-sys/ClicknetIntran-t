import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { byggNav2Data, type Nav2Matt } from "@/lib/nav2/data";
import { lasUtkast } from "@/lib/nav2/mall";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0-utkastet, bakom navets egen inloggning.
 *
 * ===========================================================================
 * SAMMA FIL SOM DET PUBLICERADE UTKASTET. `src/nav2/utkast.html` ar exakt den
 * sida som ligger som privat artifact. Utan inbaddad data ar det utkastet med
 * sina exempel; med den ar det navet. Har laggs datan in, och tre saker som
 * navets CSP annars stoppar:
 *
 *   1. Skriptet far svarets nonce. CSP:n har 'strict-dynamic' och inget
 *      'unsafe-inline' for skript, sa en tagg utan nonce kors aldrig. Skriptet
 *      och stilen ar egna filer som webblasaren sparar (src/lib/nav2/mall.ts).
 *   2. Typsnitten kommer fran /nav2/fonts i stallet for Google Fonts.
 *      font-src ar 'self' data:, och <link onload> ar en inline-hanterare.
 *   3. Datan ligger i en JSON-tagg, och skriptet ar `defer`: det kors forst
 *      nar hela sidan ar last, alltsa med datan pa plats, sa att forsta
 *      ritningen redan ar den riktiga. `<` ersatts sa att en text i datan
 *      aldrig kan avsluta taggen.
 *
 * SVARET STROMMAS. Sidans borjan, med stilen och skriptet, gar ivag direkt,
 * sa att webblasaren hamtar (eller tar ur sin cache) och forbereder skriptet
 * medan datan byggs. Datan kommer sist. Gar den inte att bygga skrivs ett
 * besked i stallet, och skriptet startar inte: utan data far utkastets
 * exempel aldrig ritas (raden fore `const ND` i utkastet).
 *
 * Och dokumentets skal, som claude.ai lagger runt artifacten men som filen
 * saknar: doctype (annars ritas sidan i quirks-lage), `lang="sv"` (sa att
 * skarmlasaren laser svenska, WCAG 3.1.1) och viewport (annars ritar en
 * telefon sidan 980 px bred och forminskad, X2).
 * ===========================================================================
 *
 * Mellanvaran har redan skickat den som saknar session till inloggningen och
 * krävt steg tva och losenordsbyte dar det galler — den har rutten ar ingen
 * /api-rutt och passerar alltsa samma kontroller som varje sida.
 */

const SKAL = `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`;

const TYPSNITT = `<style>
@font-face{font-family:"Geist";src:url(/nav2/fonts/geist.woff2) format("woff2");font-weight:100 900;font-display:swap}
@font-face{font-family:"Geist Mono";src:url(/nav2/fonts/geist-mono.woff2) format("woff2");font-weight:100 900;font-display:swap}
@font-face{font-family:"Bricolage Grotesque";src:url(/nav2/fonts/bricolage.woff2) format("woff2");font-weight:200 800;font-display:swap}
</style>`;

const BESKED = (rubrik: string, text: string) =>
  `<div id="ndFel" role="alert" style="max-width:560px;margin:64px auto;padding:0 16px;font:15px/1.5 system-ui,sans-serif;color:#1d2a25"><h1 style="font-size:20px;margin:0 0 8px">${rubrik}</h1><p style="margin:0">${text}</p></div>`;

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/logga-in?nasta=%2Fnav2", request.url));

  const [d, h] = await Promise.all([lasUtkast(), headers()]);
  const nonce = h.get("x-nonce") ?? "";
  const svar = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store, max-age=0" };

  // Startsidan / skickar hit, sa ett konto utan anstalld far ett besked har, inte en omdirigering tillbaka.
  if (!user.employee) {
    return new NextResponse(SKAL + "<title>Nav</title></head><body>" + BESKED("Ditt konto saknar en anställd i Nav", "Kontakta den som administrerar Nav, så kopplas kontot till dig.") + "</body></html>", { headers: svar });
  }

  // Datan borjar byggas innan nagot skickas.
  const matt: Nav2Matt = {};
  const t0 = performance.now(), c0 = process.cpuUsage();
  const data = byggNav2Data(user, matt).then(
    (v) => ({ v, fel: null as unknown }),
    (fel: unknown) => ({ v: null, fel }),
  );

  const fore = d.fore.replace(/<link rel="preconnect"[^>]*>\s*/g, "").replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/, TYPSNITT);
  const borjan =
    SKAL +
    fore +
    `<link rel="stylesheet" href="/nav2/stil.css?v=${d.vStil}">` +
    d.mitt +
    `<script nonce="${nonce}" src="/nav2/skript.js?v=${d.vSkript}" data-nav2 defer></script>`;

  const enc = new TextEncoder();
  const strom = new ReadableStream<Uint8Array>({
    async start(c) {
      c.enqueue(enc.encode(borjan));
      const { v, fel } = await data;
      if (v) {
        const tData = Math.round(performance.now() - t0), c1 = process.cpuUsage(c0);
        // Var tiden gick (X3): med i datan, eftersom svarshuvudena redan ar skickade. Syns bara for den inloggade.
        const json = JSON.stringify({ ...v, matt: { data: tData, cpu: Math.round((c1.user + c1.system) / 1000), ...matt } }).replace(/</g, "\\u003c");
        c.enqueue(enc.encode(`<script nonce="${nonce}" type="application/json" id="ndData">${json}</script>` + d.efter));
      } else {
        if (fel) console.error("nav2: datan gick inte att bygga", fel);
        c.enqueue(enc.encode(BESKED("Nav kunde inte läsa din data just nu", "Ladda om sidan om en stund. Händer det igen, skriv en felrapport i nuvarande Nav.") + d.efter));
      }
      c.close();
    },
  });
  return new Response(strom, { headers: svar });
}
