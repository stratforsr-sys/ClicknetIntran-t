#!/usr/bin/env node
/**
 * Granskningen S03 (G2, G4): utkastets enda skrivväg, `ndSkriv`, och dess läsväg `ndLas`.
 *
 * Alla vyhjälpare i Nav 2.0 skickar genom `ndSkriv` i `moduler/nd.js`. Den
 * ska göra fyra saker som ingen hjälpare gjorde förut:
 *
 * - **ett lås per handling:** ett dubbelklick eller en Enter som repeteras ger
 *   en `fetch`, och det andra trycket får pågår-texten i stället
 * - **en tidsgräns:** en begäran som hänger avbryts efter `tid` ms
 * - **en nyckel** (`X-Nav-Nyckel`) som skickas igen vid nästa försök inom 60 s
 *   när det förra inte fick något svar, så att servern (`medNyckel`) inte gör
 *   samma sak två gånger
 * - **svaret i klartext:** en omdirigering till inloggningen eller en
 *   HTML-sida betyder utloggad, inte "Nav svarade inte"
 *
 * Provet läser blocket "Skrivvägen" ur det byggda utkastet och kör det med en
 * påhittad `fetch`. Kör det efter `ndpatch.py`, mot `src/nav2/utkast.html`
 * (eller filen i `UTKAST`).
 *
 *   node tests/nav2-skriv.mjs
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const html = readFileSync(process.env.UTKAST ?? new URL("../src/nav2/utkast.html", import.meta.url), "utf8");
const block = html.match(/\/\* -{10} Skrivvägen[\s\S]*?\/\* -{10} Skrivvägen slut -{10} \*\//)?.[0];
ok("blocket Skrivvägen finns i utkastet", !!block);
if (!block) {
  console.log(`\n\x1b[31m${fel} prov föll.\x1b[0m`);
  process.exit(1);
}

const TEXT = {
  utloggad: "Du är utloggad. Logga in i en ny flik och tryck Spara igen.",
  tid: "Nav svarade inte på 20 sekunder. Det kan ha sparats: ladda om och titta innan du försöker igen.",
  pagar: "Det här sparas redan. Vänta ett ögonblick.",
};
const LOGGA_IN = "/logga-in?nasta=%2Fnav2";

// En ny värld per fall: utkastets block, en fetch som provet styr och kvittona som ritas.
function varld() {
  const anrop = [], kvitton = [], flikar = [];
  let uuid = 0, svar = () => new Promise(() => {});
  const fetch = (url, init = {}) => {
    anrop.push({ url, init });
    const p = svar(url, init);
    return new Promise((res, rej) => {
      init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
      p.then(res, rej);
    });
  };
  const ctx = vm.createContext({
    fetch,
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}` },
    AbortController, setTimeout, clearTimeout, Date, Map, JSON, Promise, String, Object, Error,
    toast: (msg) => kvitton.push({ msg, acts: [] }),
    toastActs: (msg, acts) => kvitton.push({ msg, acts }),
    window: { open: (u) => flikar.push(u), event: undefined },
    // Kvittona som syns, som utkastets #toasts.
    document: { querySelectorAll: (sel) => (sel === "#toasts .toast span" ? kvitton.map((k) => ({ textContent: k.msg })) : []) },
  });
  vm.runInContext(`${block}\nthis.ut = {ndSkriv, ndLas, ndSkrivFel};`, ctx);
  return { ...ctx.ut, anrop, kvitton, flikar, satt: (f) => { svar = f; }, handelse: (e) => { ctx.window.event = e; } };
}
const jsonSvar = (status, data, extra = {}) => Promise.resolve({
  ok: status >= 200 && status < 300, status, redirected: false, url: "https://nav.test/nav2/nyheter",
  headers: { get: (k) => (k.toLowerCase() === "content-type" ? "application/json" : null) },
  json: async () => data, ...extra,
});
const htmlSvar = (extra = {}) => Promise.resolve({
  ok: true, status: 200, redirected: false, url: "https://nav.test/nav2/nyheter",
  headers: { get: (k) => (k.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null) },
  json: async () => { throw new SyntaxError("Unexpected token <"); }, ...extra,
});
const knapp = () => {
  const a = new Map();
  return { setAttribute: (k, v) => a.set(k, v), removeAttribute: (k) => a.delete(k), getAttribute: (k) => a.get(k) ?? null, attr: a };
};
const vanta = (ms) => new Promise((r) => setTimeout(r, ms));
const nyckelI = (a) => a.init.headers["X-Nav-Nyckel"];

rubrik("(a) Två tryck direkt efter varandra");
{
  const v = varld();
  let slapp;
  v.satt(() => new Promise((r) => { slapp = () => r(jsonSvar(200, { ok: "Publicerat. 3 fick en notis." })); }));
  const k = knapp();
  const forsta = v.ndSkriv("/nav2/nyheter", { handling: "publicera", rubrik: "PROV" }, { knapp: k });
  const andra = v.ndSkriv("/nav2/nyheter", { handling: "publicera", rubrik: "PROV" }, { knapp: k });
  ok("en fetch", v.anrop.length === 1, `${v.anrop.length} st`);
  ok("knappen är upptagen under anropet", k.getAttribute("aria-busy") === "true");
  const b = await andra;
  ok("det andra trycket får pågår-texten och ingenting görs", !b.ok && b.pagar === true && b.fel === TEXT.pagar);
  // En Enter som hålls nere repeterar trettio gånger i sekunden: texten visas en gång per lås.
  v.ndSkrivFel(b);
  const c = await v.ndSkriv("/nav2/nyheter", { handling: "publicera", rubrik: "PROV" }, { knapp: k });
  v.ndSkrivFel(c);
  ok("pågår-texten visas en gång, inte för varje tryck", v.kvitton.length === 1 && v.kvitton[0].msg === TEXT.pagar && c.pagar === true && v.anrop.length === 1, `${v.kvitton.length} kvitton`);
  slapp();
  const a = await forsta;
  ok("det första får serverns svar", a.ok === true && a.status === 200 && a.data.ok === "Publicerat. 3 fick en notis.");
  ok("knappen är ledig igen", k.getAttribute("aria-busy") === null);
  ok("POST med JSON, kakan och nyckeln", v.anrop[0].init.method === "POST" && v.anrop[0].init.credentials === "same-origin"
    && JSON.parse(v.anrop[0].init.body).handling === "publicera" && /^[A-Za-z0-9-]{8,64}$/.test(nyckelI(v.anrop[0])));
  v.satt(() => jsonSvar(200, { ok: "Publicerat." }));
  await v.ndSkriv("/nav2/nyheter", { handling: "publicera", rubrik: "PROV" });
  ok("efter svaret går det att skicka igen, med en ny nyckel", v.anrop.length === 2 && nyckelI(v.anrop[1]) !== nyckelI(v.anrop[0]));
}
{
  const v = varld();
  v.satt(() => new Promise(() => {}));
  v.ndSkriv("/nav2/kalender", { handling: "skapa", t: "A" }, { tid: 1000 });
  v.ndSkriv("/nav2/kalender", { handling: "flytta", id: "x" }, { tid: 1000 });
  v.ndSkriv("/nav2/kalender", { handling: "flytta", id: "y" }, { tid: 1000 });
  ok("olika handlingar och id låser inte varandra", v.anrop.length === 3, `${v.anrop.length} st`);
  // Granskningen I1: en annan sparning under väntetiden (två bockar, en autosparning med ny text) får inte tappas.
  v.ndSkriv("/nav2/coachning", { handling: "svar-falt", ov: "o1", dag: "2026-10-22", falt: "skal", varde: true }, { tid: 1000 });
  v.ndSkriv("/nav2/coachning", { handling: "svar-falt", ov: "o1", dag: "2026-10-22", falt: "sam", varde: true }, { tid: 1000 });
  ok("samma handling utan id men med en annan kropp går igenom", v.anrop.length === 5, `${v.anrop.length} st`);
  const dubbel = await v.ndSkriv("/nav2/coachning", { handling: "svar-falt", ov: "o1", dag: "2026-10-22", falt: "sam", varde: true }, { tid: 1000 });
  ok("samma kropp en gång till är ett dubbeltryck", dubbel.pagar === true && v.anrop.length === 5);
  v.ndSkriv("/nav2/kalender", { handling: "flytta", id: "z" }, { nyckel: "kal-snabb", tid: 1000 });
  v.ndSkriv("/nav2/kalender", { handling: "flytta", id: "w" }, { nyckel: "kal-snabb", tid: 1000 });
  ok("en egen låsnyckel låser det den säger", v.anrop.length === 6, `${v.anrop.length} st`);
}

{
  // Knappen ur klicket: anropet kommer direkt ur en klickhanterare, så window.event är klicket.
  const v = varld();
  let slapp;
  v.satt(() => new Promise((r) => { slapp = () => r(jsonSvar(200, { ok: "Lagt." })); }));
  const k = knapp();
  v.handelse({ type: "click", target: { closest: (s) => (s === "button" ? k : null) } });
  const p = v.ndSkriv("/nav2/provision", { handling: "bonus" });
  v.handelse(undefined);
  ok("knappen i klicket blir upptagen utan att anroparen skickar den", k.getAttribute("aria-busy") === "true");
  slapp();
  await p;
  ok("och ledig efter svaret", k.getAttribute("aria-busy") === null);
  const k2 = knapp();
  v.handelse({ type: "keydown", target: { closest: () => k2 } });
  v.satt(() => jsonSvar(200, { ok: "Lagt." }));
  await v.ndSkriv("/nav2/provision", { handling: "bonus" });
  v.handelse(undefined);
  ok("en tangent markerar ingen knapp", k2.attr.size === 0);
}

rubrik("(b) och (c) Utloggad");
{
  const v = varld();
  v.satt(() => htmlSvar({ redirected: true, url: "https://nav.test/logga-in?nasta=%2Fnav2%2Fnyheter" }));
  const s = await v.ndSkriv("/nav2/nyheter", { handling: "publicera" });
  ok("omdirigering till /logga-in ger utloggad", s.utloggad === true && !s.ok && s.fel === TEXT.utloggad);
}
for (const [namn, url] of [["steg två", "https://nav.test/logga-in/verifiera?nasta=%2Fnav2"], ["lösenordsbytet", "https://nav.test/byt-losenord"], ["auth", "https://nav.test/auth/callback"]]) {
  const v = varld();
  v.satt(() => htmlSvar({ redirected: true, url }));
  const s = await v.ndSkriv("/nav2/hem", { handling: "grattis" });
  ok(`omdirigering till ${namn} ger utloggad`, s.utloggad === true && s.fel === TEXT.utloggad);
}
{
  const v = varld();
  v.satt(() => htmlSvar());
  const s = await v.ndSkriv("/nav2/hem", { handling: "grattis" });
  ok("en HTML-sida ger utloggad, aldrig 'Nav svarade inte'", s.utloggad === true && s.fel === TEXT.utloggad);
}
{
  const v = varld();
  v.satt(() => jsonSvar(401, { fel: "Du måste vara inloggad." }));
  const s = await v.ndSkriv("/nav2/hem", { handling: "grattis" });
  ok("401 ger utloggad", s.utloggad === true && s.fel === TEXT.utloggad);
  v.ndSkrivFel(s);
  const k = v.kvitton.at(-1);
  ok("kvittot har texten och Logga in", k && k.msg === TEXT.utloggad && k.acts.length === 1 && k.acts[0][0] === "Logga in");
  k.acts[0][1]();
  ok("Logga in öppnar inloggningen i en ny flik", v.flikar[0] === LOGGA_IN, v.flikar[0]);
  v.ndSkrivFel(await v.ndSkriv("/nav2/nyheter", { handling: "publicera" }));
  ok("ett andra utloggat svar medan kvittot syns ger inget kvitto till", v.kvitton.length === 1, `${v.kvitton.length} kvitton`);
}

rubrik("(d) Läsläge och serverns nej");
{
  const v = varld();
  v.satt(() => jsonSvar(423, { fel: "Läsläge: det här sparas när beställaren slår på vyn. Ingenting ändrades.", laslage: true }));
  const s = await v.ndSkriv("/nav2/order", { handling: "skapa" });
  ok("423 ger laslage och serverns text", s.laslage === true && !s.ok && s.fel.startsWith("Läsläge:"));
}
for (const st of [400, 403, 404, 409]) {
  const v = varld();
  v.satt(() => jsonSvar(st, { fel: `Serverns text ${st}.`, falt: "rubrik" }));
  const s = await v.ndSkriv("/nav2/nyheter", { handling: "publicera" });
  ok(`${st} ger serverns text och datan`, !s.ok && s.status === st && s.fel === `Serverns text ${st}.` && s.data.falt === "rubrik" && !s.utloggad);
}
{
  const v = varld();
  v.satt(() => jsonSvar(500, { fel: "Något gick fel." }));
  const s = await v.ndSkriv("/nav2/nyheter", { handling: "publicera" });
  ok("5xx ger 5xx-texten med status", s.fel === "Nav kunde inte spara (fel 500). Försök igen om en stund.");
  v.satt(() => htmlSvar({ ok: false, status: 504 }));
  const t = await v.ndSkriv("/nav2/nyheter", { handling: "publicera" });
  ok("en 504-sida från värden är ett 5xx, inte utloggad", !t.utloggad && t.fel === "Nav kunde inte spara (fel 504). Försök igen om en stund.");
}
{
  const v = varld();
  v.satt(() => jsonSvar(200, { fel: "Det gick inte." }));
  const s = await v.ndSkriv("/nav2/nyheter", { handling: "publicera" });
  ok("200 med fel är ett nej", !s.ok && s.fel === "Det gick inte.");
}

rubrik("(e) En begäran som hänger");
{
  const v = varld();
  v.satt(() => new Promise(() => {}));
  const k = knapp();
  const s = await v.ndSkriv("/nav2/provision", { handling: "bonus", id: "p1" }, { tid: 50, knapp: k });
  ok("avbryts efter tidsgränsen med tidsgränstexten", !s.ok && s.fel === TEXT.tid);
  ok("knappen är ledig igen", k.getAttribute("aria-busy") === null);
  v.satt(() => jsonSvar(200, { ok: "Lagt." }));
  const t = await v.ndSkriv("/nav2/provision", { handling: "bonus", id: "p1" }, { tid: 50 });
  ok("nästa försök inom 60 s skickar samma nyckel", t.ok && v.anrop.length === 2 && nyckelI(v.anrop[1]) === nyckelI(v.anrop[0]));
  await v.ndSkriv("/nav2/provision", { handling: "bonus", id: "p1" }, { tid: 50 });
  ok("efter svaret glöms den", nyckelI(v.anrop[2]) !== nyckelI(v.anrop[0]));
}
{
  const v = varld();
  v.satt(() => Promise.reject(new TypeError("Failed to fetch")));
  const s = await v.ndSkriv("/nav2/leads", { handling: "forsok", id: "l1" });
  ok("ett nätfel är inte utloggad och säger att det kan ha sparats", !s.ok && !s.utloggad && /kan ha sparats/.test(s.fel));
  v.satt(() => jsonSvar(200, { ok: "Sparat." }));
  await v.ndSkriv("/nav2/leads", { handling: "forsok", id: "l1" });
  ok("och nästa försök skickar samma nyckel", nyckelI(v.anrop[1]) === nyckelI(v.anrop[0]));
}
{
  const v = varld();
  v.satt(() => new Promise(() => {}));
  await v.ndSkriv("/nav2/leads", { handling: "forsok", id: "l2" }, { tid: 20 });
  const real = Date.now;
  const nu = real() + 61000;
  Date.now = () => nu;
  try {
    v.satt(() => jsonSvar(200, { ok: "Sparat." }));
    await v.ndSkriv("/nav2/leads", { handling: "forsok", id: "l2" });
  } finally { Date.now = real; }
  ok("efter 60 s är det en ny nyckel", nyckelI(v.anrop[1]) !== nyckelI(v.anrop[0]));
}

{
  // Servern arbetar fortfarande med det första försöket: 409 pågår. Nästa försök måste bära samma nyckel.
  const v = varld();
  v.satt(() => new Promise(() => {}));
  await v.ndSkriv("/nav2/kalender", { handling: "skapa" }, { tid: 20 });
  v.satt(() => jsonSvar(409, { fel: TEXT.pagar, pagar: true }));
  const s = await v.ndSkriv("/nav2/kalender", { handling: "skapa" });
  ok("serverns 409 pågår visar texten", !s.ok && s.fel === TEXT.pagar);
  v.satt(() => jsonSvar(200, { ok: "Sparat." }));
  await v.ndSkriv("/nav2/kalender", { handling: "skapa" });
  ok("och nyckeln behålls till nästa försök", nyckelI(v.anrop[2]) === nyckelI(v.anrop[0]) && nyckelI(v.anrop[1]) === nyckelI(v.anrop[0]));
}

{
  // Granskningen I2: en annan skrivning inom 60 s efter en tidsgräns får en egen nyckel, inte den förras svar.
  const v = varld();
  v.satt(() => new Promise(() => {}));
  await v.ndSkriv("/nav2/nyheter", { handling: "publicera", rubrik: "A" }, { tid: 20 });
  v.satt(() => jsonSvar(200, { ok: "Publicerat." }));
  await v.ndSkriv("/nav2/nyheter", { handling: "publicera", rubrik: "B" });
  ok("inlägg B efter A:s tidsgräns bär en ny nyckel", nyckelI(v.anrop[1]) !== nyckelI(v.anrop[0]));
  await v.ndSkriv("/nav2/nyheter", { handling: "publicera", rubrik: "A" });
  ok("A igen bär A:s nyckel", nyckelI(v.anrop[2]) === nyckelI(v.anrop[0]));
}
{
  // Huvudet kom, men kroppen fastnade: det är en tidsgräns, inte en utloggning (granskningen M2).
  const v = varld();
  v.satt((url, init) => Promise.resolve({
    ok: true, status: 200, redirected: false, url: "https://nav.test/nav2/kalender",
    headers: { get: (k) => (k.toLowerCase() === "content-type" ? "application/json" : null) },
    json: () => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))),
  }));
  const s = await v.ndSkriv("/nav2/kalender", { handling: "spara", t: "M" }, { tid: 30 });
  ok("en kropp som fastnar ger tidsgränsen, inte utloggad", !s.utloggad && s.fel === TEXT.tid, s.fel);
  v.satt(() => jsonSvar(200, { ok: "Sparat." }));
  await v.ndSkriv("/nav2/kalender", { handling: "spara", t: "M" });
  ok("och nästa försök bär samma nyckel", nyckelI(v.anrop[1]) === nyckelI(v.anrop[0]));
}

rubrik("ndLas, för GET");
{
  const v = varld();
  v.satt(() => jsonSvar(200, { underlag: [1] }));
  const s = await v.ndLas("/nav2/tid?period=2026-10");
  ok("JSON ger datan", s.ok && s.data.underlag[0] === 1 && (v.anrop[0].init.method ?? "GET") === "GET" && v.anrop[0].init.credentials === "same-origin");
  ok("utan nyckel", !v.anrop[0].init.headers || !v.anrop[0].init.headers["X-Nav-Nyckel"]);
  v.satt(() => htmlSvar({ redirected: true, url: "https://nav.test/logga-in?nasta=%2Fnav2" }));
  const t = await v.ndLas("/nav2/tid?period=2026-10");
  ok("omdirigering ger utloggad", t.utloggad === true && t.fel === TEXT.utloggad);
  v.satt(() => jsonSvar(200, { a: 1 }));
  const a = v.ndLas("/nav2/kalender?vy=vecka"), b = v.ndLas("/nav2/kalender?vy=vecka");
  await Promise.all([a, b]);
  ok("ingen lås för läsningar", v.anrop.length === 4, `${v.anrop.length} st`);
  v.satt(() => new Promise(() => {}));
  const h = await v.ndLas("/nav2/kalender?vy=vecka", { tid: 30 });
  ok("tidsgränsen gäller också", !h.ok && h.fel.startsWith("Nav svarade inte på 20 sekunder"));
}

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m" : `\n\x1b[31m${fel} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
