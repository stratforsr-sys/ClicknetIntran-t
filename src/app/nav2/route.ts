import { readFile } from "node:fs/promises";
import path from "node:path";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { byggNav2Data, type Nav2Matt } from "@/lib/nav2/data";

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
 *      'unsafe-inline' for skript, sa en tagg utan nonce kors aldrig.
 *   2. Typsnitten kommer fran /nav2/fonts i stallet for Google Fonts.
 *      font-src ar 'self' data:, och <link onload> ar en inline-hanterare.
 *   3. Datan ligger i en JSON-tagg FORE skriptet, sa att forsta ritningen
 *      redan ar den riktiga. `<` ersatts sa att en text i datan aldrig kan
 *      avsluta taggen.
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

let mall: Promise<string> | null = null;
function lasMall(): Promise<string> {
  // En gang per instans. Filen andras bara med en ny deploy.
  if (!mall) mall = readFile(path.join(process.cwd(), "src/nav2/utkast.html"), "utf8");
  return mall;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/logga-in?nasta=%2Fnav2", request.url));
  if (!user.employee) return NextResponse.redirect(new URL("/", request.url));

  const matt: Nav2Matt = {};
  const t0 = performance.now(), c0 = process.cpuUsage();
  const [html, data, h] = await Promise.all([lasMall(), byggNav2Data(user, matt), headers()]);
  const tData = Math.round(performance.now() - t0), c1 = process.cpuUsage(c0), cpu = Math.round((c1.user + c1.system) / 1000);
  if (!data) return NextResponse.redirect(new URL("/", request.url));

  const nonce = h.get("x-nonce") ?? "";
  const json = JSON.stringify(data).replace(/</g, "\\u003c");

  let ut = html.replace(/<link rel="preconnect"[^>]*>\s*/g, "").replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/, TYPSNITT);
  const forsta = ut.indexOf("<script>");
  if (forsta < 0) return new NextResponse("Utkastet saknar sitt skript.", { status: 500 });
  ut =
    SKAL +
    ut.slice(0, forsta) +
    `<script nonce="${nonce}" type="application/json" id="ndData">${json}</script><script nonce="${nonce}">` +
    ut.slice(forsta + "<script>".length);

  return new NextResponse(ut, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Persondata far aldrig cachas av en mellanliggande proxy.
      "Cache-Control": "private, no-store, max-age=0",
      // Var tiden gick, per del (X3). Syns bara for den inloggade, i webblasarens natverksflik.
      "Server-Timing": [`data;dur=${tData}`, `cpu;dur=${cpu}`, ...Object.entries(matt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k};dur=${v}`)].join(", "),
    },
  });
}
