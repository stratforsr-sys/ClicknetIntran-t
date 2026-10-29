#!/usr/bin/env node
/**
 * Appens service worker (/app-sw.js, räckvidd /): bara navigeringar, bara när nätet fallerar.
 *
 *   node --experimental-strip-types tests/app-sw.mjs
 *
 * Sidan /nav2 (utan snedstreck) ligger utanför pushens räckvidd /nav2/, så ingen
 * worker kontrollerar den. Utan nät blir det webbläsarens felsida. Den här
 * workern kontrollerar hela sajten, också nuvarande Nav, och får därför inte
 * röra något annat än en navigering som misslyckas på nätet. Filen körs här i
 * node:vm med falska self, caches och fetch.
 */
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const lika = (a, b) => JSON.stringify([...a]) === JSON.stringify(b);

const kalla = fs.readFileSync(fileURLToPath(new URL("../public/app-sw.js", import.meta.url)), "utf8");

/** En ny worker i en egen värld. `nat` styr fetch: "faller", eller en funktion (url, init) => Response. */
function ny({ nat = "faller", cacher = {}, preload = null } = {}) {
  const lyssnare = new Map();
  const butik = new Map(Object.entries(cacher).map(([n, urler]) => [n, new Map(urler.map((u) => [u, new Response("x")]))]));
  const logg = { fetch: [], put: [], raderade: [], skipWaiting: 0, claim: 0, preload: 0 };
  const caches = {
    open: async (namn) => {
      if (!butik.has(namn)) butik.set(namn, new Map());
      const m = butik.get(namn);
      return {
        put: async (url, svar) => { logg.put.push(String(url)); m.set(String(url), svar); },
        match: async (url) => m.get(String(url)),
      };
    },
    keys: async () => [...butik.keys()],
    delete: async (namn) => { logg.raderade.push(namn); return butik.delete(namn); },
  };
  const self = {
    addEventListener: (typ, fn) => lyssnare.set(typ, fn),
    skipWaiting: () => { logg.skipWaiting++; return Promise.resolve(); },
    clients: { claim: () => { logg.claim++; return Promise.resolve(); } },
    // preload: null = webbläsaren saknar navigation preload (ingen registration.navigationPreload), "ok" eller "faller" = enable() lyckas eller avvisas.
    registration: preload ? { navigationPreload: { enable: () => { logg.preload++; return preload === "faller" ? Promise.reject(new Error("nej")) : Promise.resolve(); } } } : {},
  };
  const fetchFalsk = async (url, init) => {
    logg.fetch.push({ url: String(url?.url ?? url), init });
    if (nat === "faller") throw new TypeError("Failed to fetch");
    return nat(url, init);
  };
  vm.runInNewContext(kalla, { self, caches, fetch: fetchFalsk, Response, Headers, URL, Promise, console }, { filename: "app-sw.js" });
  return { lyssnare, logg, butik };
}

/** Ropar upp en händelse och väntar in det som waitUntil/respondWith fick. */
async function handelse(w, typ, extra = {}) {
  const h = { respondWith: 0, lofte: null, vantar: [] };
  const e = {
    ...extra,
    waitUntil: (p) => { h.vantar.push(p); },
    respondWith: (p) => { h.respondWith++; h.lofte = p; },
  };
  const fn = w.lyssnare.get(typ);
  if (fn) fn(e);
  await Promise.all(h.vantar);
  h.svar = h.lofte ? await h.lofte : undefined;
  return h;
}
const nav = (url = "https://nav.test/nav2", mode = "navigate", method = "GET") => ({ request: { mode, method, url } });
const natSvaret = new Response("nätets sida", { status: 200, headers: { "content-type": "text/html" } });

console.log("\nNavigering");
{
  const h = await handelse(ny(), "fetch", nav());
  const svar = h.svar;
  ok("navigering utan nät ger offline-sidan", !!svar && svar.status === 200 && /text\/html/.test(svar.headers.get("content-type")) && (await svar.clone().text()).includes("Nav behöver nätet"));
  ok("offline-sidan har ingen CSP-rubrik (dess eget skript ska få köras)", !svar.headers.has("content-security-policy"));
  ok("offline-sidan skickas med charset utf-8 och no-store", svar.headers.get("content-type") === "text/html; charset=utf-8" && svar.headers.get("cache-control") === "no-store");
  const html = await svar.text();
  ok("offline-sidan har texten, länken och svenskt språk", html.includes("Det du har sparat finns kvar. Nav laddar om sig själv när telefonen är uppkopplad igen.") && html.includes("Försök igen") && html.includes('<html lang="sv">'));
  ok("offline-sidan har utkastets bakgrund och bläck", html.includes("#EEF1EC") && html.includes("#13201C"));
  ok("offline-sidan laddar om på online och hämtar Bricolage ur cachen", html.includes("online") && html.includes("location.reload()") && html.includes("nav-app-1") && html.includes("/nav2/fonts/bricolage.woff2"));
  ok("offline-sidan hämtar ingenting externt och bär ingen adress", !/https?:\/\//.test(html) && !html.includes("nav.test"));
}
{
  const h = await handelse(ny({ nat: async () => natSvaret }), "fetch", nav());
  const svarMedNat = h.svar;
  ok("navigering med nät ger nätets svar orört", svarMedNat === natSvaret);
}
{
  const felSvar = new Response("kaos", { status: 500 });
  const h = await handelse(ny({ nat: async () => felSvar }), "fetch", nav());
  ok("nätets felsvar (500) går orört igenom, bara ett nätfel ger offline-sidan", h.svar === felSvar);
}
{
  const w = ny();
  const h = await handelse(w, "fetch", nav("https://nav.test/nav2/kalender"));
  ok("navigeringen hämtas med den egna begäran", w.logg.fetch.length === 1 && w.logg.fetch[0].url === "https://nav.test/nav2/kalender" && h.respondWith === 1);
}

console.log("\nAllt annat rörs inte");
for (const [namn, mode] of [["fetch/XHR (cors)", "cors"], ["bilder och skript (no-cors)", "no-cors"], ["same-origin", "same-origin"]]) {
  const w = ny();
  const h = await handelse(w, "fetch", nav("https://nav.test/api/x", mode, "GET"));
  ok(`${namn} rörs inte`, h.respondWith === 0 && w.logg.fetch.length === 0);
}
{
  const h = await handelse(ny(), "fetch", nav("https://nav.test/api/x", "cors", "POST"));
  ok("annat än navigering rörs inte", h.respondWith === 0);
}

console.log("\nInstallation och aktivering");
{
  const w = ny({ nat: async () => new Response("typsnitt", { status: 200 }) });
  await handelse(w, "install");
  ok("installationen förladdar exakt typsnitten", lika(w.logg.put, ["/nav2/fonts/geist.woff2", "/nav2/fonts/bricolage.woff2"]));
  ok("typsnitten läggs i cachen nav-app-1", [...w.butik.keys()].join() === "nav-app-1" && w.butik.get("nav-app-1").size === 2);
  ok("förladdningen hämtar utan att följa omdirigeringar", w.logg.fetch.length === 2 && w.logg.fetch.every((f) => f.init?.redirect === "error"));
  ok("installationen kör skipWaiting()", w.logg.skipWaiting === 1);
}
{
  // En inloggad med väntande steg två får 307 även på typsnitten (granskningen av uppgift 3).
  const omdirigerat = new Response("inloggningen", { status: 200 });
  Object.defineProperty(omdirigerat, "redirected", { value: true });
  const w = ny({ nat: async () => omdirigerat });
  const h = await handelse(w, "install");
  ok("förladdningen cachar inte ett omdirigerat svar", w.logg.put.length === 0 && h.vantar.length > 0);
  ok("ett omdirigerat svar fäller inte installationen", w.logg.skipWaiting === 1);
}
{
  const w = ny({ nat: async () => new Response("nej", { status: 404 }) });
  await handelse(w, "install");
  ok("förladdningen cachar inte ett felsvar", w.logg.put.length === 0 && w.logg.skipWaiting === 1);
}
{
  const w = ny({ nat: "faller" });
  let kastade = false;
  try { await handelse(w, "install"); } catch { kastade = true; }
  ok("installationen utan nät fäller inte installationen", !kastade && w.logg.skipWaiting === 1);
}
{
  const w = ny({ cacher: { "nav-app-0": ["/a"], "nav-app-1": ["/b"], "nav-app-gammal": ["/c"], "annan-cache": ["/d"], "workbox-x": ["/e"] } });
  await handelse(w, "activate");
  ok("aktiveringen tar bort gamla nav-app-cacher men inga andra", lika(w.logg.raderade.sort(), ["nav-app-0", "nav-app-gammal"]));
  ok("aktiveringen behåller nav-app-1", w.butik.has("nav-app-1") && w.butik.has("annan-cache") && w.butik.has("workbox-x"));
  ok("aktiveringen kör clients.claim()", w.logg.claim === 1);
}
{
  const w = ny({ cacher: { "nav-app-0": [] } });
  await handelse(w, "activate");
  ok("aktiveringen tar bort nav-app-0 (provets egen rad)", lika(w.logg.raderade, ["nav-app-0"]));
}

console.log("\nNavigation preload");
{
  const w = ny({ preload: "ok" });
  await handelse(w, "activate");
  ok("aktiveringen slår på navigation preload", w.logg.preload === 1 && w.logg.claim === 1);
}
{
  const w = ny({ preload: "faller" });
  await handelse(w, "activate");
  ok("en preload som inte går att slå på fäller inte aktiveringen", w.logg.preload === 1 && w.logg.claim === 1);
}
{
  const w = ny();
  await handelse(w, "activate");
  ok("utan navigation preload i webbläsaren kastar aktiveringen inte", w.logg.claim === 1);
}
{
  const w = ny({ nat: async () => new Response("fel väg") });
  const h = await handelse(w, "fetch", { ...nav(), preloadResponse: Promise.resolve(natSvaret) });
  ok("förhämtat svar används orört och nätet frågas inte en gång till", h.svar === natSvaret && w.logg.fetch.length === 0);
}
{
  const w = ny({ nat: async () => natSvaret });
  const h = await handelse(w, "fetch", { ...nav(), preloadResponse: Promise.resolve(undefined) });
  ok("ingen förhämtning (undefined): den egna begäran används som förut", h.svar === natSvaret && w.logg.fetch.length === 1);
}
{
  const felSvar = new Response("kaos", { status: 500 });
  const h = await handelse(ny(), "fetch", { ...nav(), preloadResponse: Promise.resolve(felSvar) });
  ok("förhämtat felsvar (500) går orört igenom", h.svar === felSvar);
}
{
  const h = await handelse(ny(), "fetch", { ...nav(), preloadResponse: Promise.reject(new TypeError("Failed to fetch")) });
  ok("förhämtningen fallerar utan nät: offline-sidan", !!h.svar && (await h.svar.text()).includes("Nav behöver nätet"));
}

console.log("\nVad workern inte gör");
{
  const w = ny();
  ok("ingen push-hanterare (pushen bor i /nav2/sw.js)", !w.lyssnare.has("push"));
  ok("bara install, activate och fetch lyssnas på", lika([...w.lyssnare.keys()].sort(), ["activate", "fetch", "install"]));
}

console.log(fel ? `\n\x1b[31m${fel} prov foll.\x1b[0m` : "\n\x1b[32mAlla prov gick igenom.\x1b[0m");
process.exit(fel ? 1 : 0);
