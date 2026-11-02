import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { byggNav2Data, type Nav2Matt } from "@/lib/nav2/data";
import { lasUtkast } from "@/lib/nav2/mall";
import { lasIdentitet } from "@/lib/identitet";
import { skal } from "@/lib/nav2/app";
import { forvarmPg } from "@/lib/nav2/pgrest";

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

/**
 * Typsnitten (F1 i prestandaprovet 2026-11-02). Förut upptäckte webbläsaren
 * dem först när skriptet ritat text, och de bytte typsnitt synligt 130–370 ms
 * efter första ritningen; vid varje återbesök frågades de om (0,3–0,45 s).
 * Nu förladdas de i huvudet, och adressen bär `?v=` så att next.config.ts kan
 * cacha dem för alltid. Versionen är filernas innehåll, räknad i bygget (next.config.ts), så en ny
 * fil får en ny adress av sig själv.
 */
const TYPSNITT_V = process.env.NAV2_TYPSNITT_V || "1";
const TYPSNITTEN: [familj: string, fil: string, vikt: string][] = [
  ["Geist", "geist", "100 900"],
  ["Geist Mono", "geist-mono", "100 900"],
  ["Bricolage Grotesque", "bricolage", "200 800"],
];
const TYPSNITT =
  TYPSNITTEN.map(([, fil]) => `<link rel="preload" href="/nav2/fonts/${fil}.woff2?v=${TYPSNITT_V}" as="font" type="font/woff2" crossorigin>`).join("") +
  "<style>\n" +
  TYPSNITTEN.map(([familj, fil, vikt]) => `@font-face{font-family:"${familj}";src:url(/nav2/fonts/${fil}.woff2?v=${TYPSNITT_V}) format("woff2");font-weight:${vikt};font-display:swap}`).join("\n") +
  "\n</style>";

const BESKED = (rubrik: string, text: string) =>
  `<div id="ndFel" role="alert" style="max-width:560px;margin:64px auto;padding:0 16px;font:15px/1.5 system-ui,sans-serif;color:#1d2a25"><h1 style="font-size:20px;margin:0 0 8px">${rubrik}</h1><p style="margin:0">${text}</p></div>`;

export async function GET(request: Request) {
  // Schemat och den första anslutningen medan inloggningen läses (pgrest.ts), bara för en inloggning som
  // mellanvaran redan kontrollerat (identitetsrubriken, src/lib/identitet.ts).
  if (lasIdentitet(await headers())) forvarmPg();
  const tAuth = performance.now();
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/logga-in?nasta=%2Fnav2", request.url));
  const auth = Math.round(performance.now() - tAuth);

  const [d, h] = await Promise.all([lasUtkast(), headers()]);
  const nonce = h.get("x-nonce") ?? "";
  const ua = h.get("user-agent") ?? "";
  const version = process.env.VERCEL_GIT_COMMIT_SHA ?? null;
  // Server-Timing: inloggningen syns i webbläsarens nätverksflik. Datans tider kommer i `matt`, eftersom huvudena går före den.
  const svar = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store, max-age=0", "Server-Timing": `auth;dur=${auth}` };

  // Startsidan / skickar hit, sa ett konto utan anstalld far ett besked har, inte en omdirigering tillbaka.
  if (!user.employee) {
    return new NextResponse(skal(ua, version) + "<title>Nav</title></head><body>" + BESKED("Ditt konto saknar en anställd i Nav", "Kontakta den som administrerar Nav, så kopplas kontot till dig.") + "</body></html>", { headers: svar });
  }

  // Datan borjar byggas innan nagot skickas.
  const matt: Nav2Matt = {};
  const t0 = performance.now(), c0 = process.cpuUsage();
  // Läsningarna direkt i Postgres med den identitet mellanvaran verifierat; aldrig för ett konto med lösenordstvång (0017).
  const id = lasIdentitet(h);
  const pg = id && !id.kraverLosenordsbyte && id.authUserId === user.authUserId ? { authUserId: id.authUserId, email: id.email } : null;
  // Gul 15 (produktionsprovet 2026-10-30): varför pg-vägen uteblev. Aldrig e-post eller token i loggen.
  if (!pg) console.warn("nav2: utan pg", { id: !!id, losen: id?.kraverLosenordsbyte ?? null, samma: id?.authUserId === user.authUserId });
  const data = byggNav2Data(user, matt, pg).then(
    (v) => ({ v, fel: null as unknown }),
    (fel: unknown) => ({ v: null, fel }),
  );

  const fore = d.fore.replace(/<link rel="preconnect"[^>]*>\s*/g, "").replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/, TYPSNITT);
  const borjan =
    skal(ua, version) +
    fore +
    `<link rel="stylesheet" href="/nav2/stil.css?v=${d.vStil}">` +
    // Riktigt läge från första ritningen (G3): utkastets regel `body.nd-riktig .proto` döljer demoraden
    // ("Utkast · Exempeldata") redan medan datan byggs, och när den inte gick att bygga. Filen har ingen
    // egen <body>, så taggen läggs här, före markupen. ndStart lägger samma klass och ändrar ingenting.
    `<body class="nd-riktig">` +
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
        c.enqueue(enc.encode(BESKED("Nav kunde inte läsa din data just nu", "Ladda om sidan om en stund. Händer det igen, säg till den som administrerar Nav.") + d.efter));
      }
      c.close();
    },
  });
  return new Response(strom, { headers: svar });
}
