#!/usr/bin/env node
/**
 * Mellanvaran när Supabase är seg (src/lib/supabase/tidsgrans.ts).
 *
 * 2026-11-16 stod databasen still i 25–50 minuter. Mellanvaran väntade på
 * Supabase utan tidsgräns, och varje sida blev "504 MIDDLEWARE_INVOCATION_TIMEOUT".
 * Provet håller fast tre saker:
 *   1. ett anrop till Supabase ger upp efter tidsgränsen,
 *   2. de fel Supabase Auth VERKLIGEN ger vid ett nätfel räknas som nätfel, och
 *      "inte inloggad" gör det inte (annars skickas folk till inloggningen
 *      fast det är databasen som strular, eller får 503 fast de är utloggade),
 *   3. mellanvaran använder klassningen före omdirigeringen till /logga-in.
 *
 * Inget nätverk: Supabase-klienten får en låtsad fetch.
 *
 *   node --experimental-strip-types tests/seg-databas.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  medTidsgrans, arNatfel, inomTid, villHaSida, segSida, segRubriker, SUPABASE_TIDSGRANS_MS, FORSOK_IGEN_S,
} from "../src/lib/supabase/tidsgrans.ts";

let fel = 0;
const ok = (villkor, text, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${text}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

// En fetch som aldrig svarar, men respekterar avbrott.
const hanger = (_u, init) => new Promise((_res, rej) => {
  init?.signal?.addEventListener("abort", () => rej(init.signal.reason ?? new Error("avbruten")), { once: true });
});
const svarar = (status, kropp) => async () =>
  new Response(JSON.stringify(kropp), { status, headers: { "content-type": "application/json" } });

console.log("\nTidsgränsen");
{
  const t = Date.now();
  let kastade = false;
  try { await medTidsgrans(hanger, 150)("https://x.invalid/"); } catch { kastade = true; }
  const ms = Date.now() - t;
  ok(kastade && ms >= 140 && ms < 1000, "en fetch som hänger ger upp efter tidsgränsen", `${ms} ms`);

  const egen = new AbortController();
  setTimeout(() => egen.abort(), 30);
  const t2 = Date.now();
  try { await medTidsgrans(hanger, 5000)("https://x.invalid/", { signal: egen.signal }); } catch {}
  ok(Date.now() - t2 < 500, "anroparens eget avbrott gäller fortfarande");

  const svar = await medTidsgrans(svarar(200, { a: 1 }), 1000)("https://x.invalid/");
  ok(svar.status === 200, "ett snabbt svar går igenom som vanligt");
  ok(SUPABASE_TIDSGRANS_MS < 25_000, "tidsgränsen ligger under Vercels 25 s för mellanvaran", `${SUPABASE_TIDSGRANS_MS} ms`);
}

console.log("\nSupabase Auths egna fel, klassade");
const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.x";
const klient = (f) => createClient("https://prov.supabase.invalid", "anon", {
  global: { fetch: f }, auth: { persistSession: false, autoRefreshToken: false },
});
{
  const { error } = await klient(medTidsgrans(hanger, 100)).auth.getUser(jwt);
  ok(arNatfel(error), "Supabase svarar inte (tidsgräns) = nätfel", error?.name);
}
{
  const { error } = await klient(svarar(503, { message: "upstream" })).auth.getUser(jwt);
  ok(arNatfel(error), "Supabase svarar 503 = nätfel", `${error?.name} ${error?.status}`);
}
{
  const { error } = await klient(async () => { throw new TypeError("fetch failed"); }).auth.getUser(jwt);
  ok(arNatfel(error), "anslutningen bryts = nätfel", error?.name);
}
{
  const { error } = await klient(svarar(403, { code: "bad_jwt", message: "invalid JWT" })).auth.getUser(jwt);
  ok(error && !arNatfel(error), "ogiltig token (403) är INTE nätfel, går till inloggningen", `${error?.name} ${error?.status}`);
}
{
  const { error } = await klient(svarar(401, { message: "unauthorized" })).auth.getUser(jwt);
  ok(error && !arNatfel(error), "401 är INTE nätfel", `${error?.name} ${error?.status}`);
}
{
  const { error } = await klient(hanger).auth.getUser();
  ok(error && !arNatfel(error), "ingen session alls är INTE nätfel (och frågar inte nätet)", error?.name);
}
ok(!arNatfel(null) && !arNatfel(undefined), "inget fel är inte nätfel");

console.log("\nInom tid");
{
  const snabb = await inomTid(Promise.resolve(7), 100);
  ok(snabb.klar && snabb.varde === 7, "ett löfte som hinner ger sitt värde");
  const t = Date.now();
  const seg = await inomTid(new Promise((r) => setTimeout(r, 2000)), 80);
  ok(!seg.klar && Date.now() - t < 500, "ett löfte som inte hinner släpps efter tidsgränsen");
  const felet = await inomTid(Promise.reject(new Error("x")).catch(() => "fångat"), 100);
  ok(felet.klar, "ett fel i bakgrunden blir inget ohanterat fel");
}

console.log("\nSidan eller data");
{
  const h = (o) => new Headers(o);
  ok(villHaSida("GET", h({ "sec-fetch-dest": "document" })), "webbläsarens adressfält får sidan");
  ok(!villHaSida("GET", h({ "sec-fetch-dest": "empty", accept: "text/html" })), "navets egna fetch får kort text");
  ok(!villHaSida("GET", h({ rsc: "1", accept: "text/html" })), "RSC-begäran får kort text");
  ok(!villHaSida("POST", h({ "sec-fetch-dest": "document" })), "en server action (POST) får kort text");
  ok(villHaSida("GET", h({ accept: "text/html,application/xhtml+xml" })), "utan sec-fetch-dest avgör accept");
}

console.log("\nSidan");
{
  const html = segSida("Tm9uY2U=", '/uppgifter?x="><script>');
  ok(html.includes('nonce="Tm9uY2U="'), "stilen bär nonce (navets CSP)");
  ok(!html.includes("<script"), "adressen escapas, inget skript kan smita in");
  ok(html.includes(`content="${FORSOK_IGEN_S};url=/uppgifter?x=&quot;&gt;&lt;script&gt;"`), "sidan försöker igen själv mot samma adress");
  ok(html.includes("Du behöver inte logga in igen"), "sidan säger att det inte är inloggningen");
  ok(html.includes("prefers-color-scheme:dark"), "mörkt läge");
  const r = segRubriker();
  ok(r["cache-control"] === "no-store" && r["retry-after"] === String(FORSOK_IGEN_S), "503 cachas aldrig och säger när det är värt att försöka igen");
}

console.log("\nMellanvaran");
{
  const kod = readFileSync(new URL("../src/lib/supabase/middleware.ts", import.meta.url), "utf8");
  const natfel = kod.indexOf("arNatfel(authFel)");
  const inloggning = kod.indexOf('url.pathname = "/logga-in"');
  ok(natfel > 0 && natfel < inloggning, "nätfelet prövas FÖRE omdirigeringen till /logga-in");
  ok(kod.includes("global: { fetch: medTidsgrans(fetch, SUPABASE_TIDSGRANS_MS) }"), "Supabase-klienten i mellanvaran har tidsgränsen");
  ok(kod.includes("inomTid(stampel, STAMPEL_TIDSGRANS_MS)"), "dagsstämpeln håller inte sidan längre än sin gräns");
  ok(/rensaIdentitet\(headers\);[\s\S]*arNatfel\(authFel\)/.test(kod), "identitetsrubrikerna rensas fortfarande först");
  const rot = readFileSync(new URL("../src/middleware.ts", import.meta.url), "utf8");
  ok(rot.includes("updateSession(request, event)"), "waitUntil når mellanvaran (event skickas vidare)");
}

console.log(fel ? `\n\x1b[31m${fel} fel.\x1b[0m` : "\n\x1b[32mAlla kontroller godkända.\x1b[0m");
process.exit(fel ? 1 : 0);
