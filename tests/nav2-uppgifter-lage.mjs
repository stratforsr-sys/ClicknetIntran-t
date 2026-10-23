#!/usr/bin/env node
/**
 * Granskningen S10 (F2-15): Uppgifter i Nav 2.0 behåller Pågår och Returnerad,
 * och fokusläget sparar att en uppgift påbörjats.
 *
 * Förut gjorde klienten om navets läge till klar, granskas eller öppen, så
 * `pagar` och `returnerad` blev "Ej påbörjad" eller "Försenad", och
 * `fokusStart` satte `startad` bara i webbläsaren.
 *
 * Provet läser modulblocket UPPGIFTER ur det byggda utkastet och kör det i en
 * sandlåda där utkastets egna funktioner är attrapper. Kör det mot
 * `src/nav2/utkast.html` (eller filen i `UTKAST`).
 *
 *   node tests/nav2-uppgifter-lage.mjs
 */
import { readFileSync } from "node:fs";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const html = readFileSync(process.env.UTKAST ?? new URL("../src/nav2/utkast.html", import.meta.url), "utf8");
const block = html.match(/\/\* =+\n {3}NAV 2\.0 I RIKTIGT LÄGE: UPPGIFTER[\s\S]*?NDKOPPLAD\.add\('uppgifter'\); \}/)?.[0];
ok("modulblocket UPPGIFTER finns i utkastet", !!block);
if (!block) {
  console.log(`\n\x1b[31m${fel} prov föll.\x1b[0m`);
  process.exit(1);
}

const plus = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const dow = (d) => ((new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;

function uppgift(id, lage) {
  return {
    id, lage, vy: "egen", t: "Uppgift " + id, due: "2026-10-23", tid: null, est: null, prio: 3, klarAt: null,
    links: [], proj: null, delar: [], granskare: null, ansvarig: null, serie: null, besk: "",
    skapadAv: "Zen Test", skapadAt: "2026-10-20T08:00:00Z", stilla: false, minRoll: null, handelser: [],
  };
}

// En värld: utkastets globala namn som attrapper, modulen körd ovanpå.
function varld() {
  const skickat = [];
  const g = {
    ND: { jag: { id: "mig", namn: "Zen Test" }, uppgifter: {
      uppgifter: [uppgift("a", "pagar"), uppgift("b", "returnerad"), uppgift("c", "ej_paborjad"), uppgift("d", "granskas"), uppgift("e", "klar")],
      projekt: [], mallar: [], kollegor: [], klara: [], fokus: [], forstaSteg: {}, personer: [], skriv: true,
    } },
    TASKS: [], PROJEKT: {}, MALLAR: [], KOLLEGOR: [], MOTEN: {}, HIST: {}, KLARA_FORR: {}, S: {}, NDKOPPLAD: new Set(),
    role: () => "saljare", kIdag: () => "2026-10-23", frKort: (d) => d, frPlus: plus, frDow: dow,
    ndMandag: (d) => { let x = d; while (dow(x) !== 1) x = plus(x, -1); return x; },
    isDone: (t) => t.lage === "klar",
    toast: () => {}, render: () => {}, esc: (s) => String(s),
    ndSkriv: async (url, data) => { skickat.push({ url, data }); return { ok: true, status: 200, data: { ok: "Påbörjad." } }; },
    ndSvar: (s) => s.data, ndSkrivFel: () => {},
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location: { reload: () => {} },
    document: { addEventListener: () => {}, getElementById: () => null },
    // Utkastets egna, som modulen slår in:
    upgRutaHtml: () => '<p class="upg-rstatus"><span class="upg-dot ">Ej påbörjad</span><span>Skapad av Zen</span></p><ul class="upg-hist"></ul><div class="upg-chat"></div>',
    fokusStart(ids) { g.S.fokusMode = { id: ids[0], queue: ids.slice(1) }; const t = g.TASKS.find((x) => x.id === ids[0]); if (t) t.startad = true; },
    fokusNasta() { const f = g.S.fokusMode; if (!f.queue.length) { g.S.fokusMode = null; return; } f.id = f.queue.shift(); g.TASKS.find((x) => x.id === f.id).startad = true; },
  };
  const inbyggda = new Set(["Object", "Array", "JSON", "Math", "Date", "Set", "Map", "String", "Number", "Boolean", "Promise", "RegExp", "Error", "Symbol", "parseInt", "parseFloat", "isNaN", "encodeURIComponent", "decodeURIComponent", "undefined", "NaN", "Infinity", "console", "setTimeout", "clearTimeout", "structuredClone", "Intl"]);
  const attrapp = () => new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => "" : attrapp()), apply: () => attrapp() });
  const sandlada = new Proxy(g, {
    has: (_, k) => typeof k === "string" && !inbyggda.has(k),
    get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? t[k] : attrapp()),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  new Function("sandlada", `with (sandlada) {\n${block}\n}`)(sandlada);
  return { g, skickat };
}

rubrik("Navets läge står kvar i listan (F2-15)");
{
  const { g } = varld();
  const t = (id) => g.TASKS.find((x) => x.id === id);
  ok("alla öppna uppgifter kom med", ["a", "b", "c", "d"].every((id) => t(id)), g.TASKS.map((x) => x.id).join(","));
  ok("pagar visas som Pågår (startad)", t("a")?.startad === true);
  ok("returnerad är inte Pågår", !t("b")?.startad);
  ok("returnerad behåller sitt läge", t("b")?.ndLage === "returnerad");
  ok("ej påbörjad är inte Pågår", !t("c")?.startad);
  ok("granskas står kvar", t("d")?.lage === "granskas");
}

rubrik("Rutan säger Returnerad");
{
  const { g } = varld();
  const t = (id) => g.TASKS.find((x) => x.id === id);
  const hb = g.upgRutaHtml(t("b"));
  ok("returnerad: lägesraden säger Returnerad", /upg-rstatus"><span class="upg-dot [^"]*">Returnerad</.test(hb), hb.slice(0, 120));
  const hc = g.upgRutaHtml(t("c"));
  ok("ej påbörjad: lägesraden är orörd", hc.includes(">Ej påbörjad<"));
}

rubrik("Fokusläget sparar påbörjat");
{
  const { g, skickat } = varld();
  g.fokusStart(["c"]);
  await new Promise((r) => setTimeout(r, 0));
  const p = skickat.filter((s) => s.data.handling === "paborja");
  ok("fokusStart skickar paborja", p.length === 1 && p[0].data.id === "c" && p[0].url === "/nav2/uppgifter", JSON.stringify(skickat));
  g.fokusStart(["c"]);
  await new Promise((r) => setTimeout(r, 0));
  ok("en gång per uppgift", skickat.filter((s) => s.data.handling === "paborja").length === 1);
  skickat.length = 0;
  g.fokusStart(["a"]);
  await new Promise((r) => setTimeout(r, 0));
  ok("redan Pågår: ingenting skickas", skickat.length === 0, JSON.stringify(skickat));
  skickat.length = 0;
  g.S.fokusMode = { id: "a", queue: ["b"] };
  g.fokusNasta();
  await new Promise((r) => setTimeout(r, 0));
  ok("nästa i fokuspasset påbörjas också", skickat.some((s) => s.data.handling === "paborja" && s.data.id === "b"), JSON.stringify(skickat));
}

rubrik("Fokus drar aldrig en uppgift ur granskningen");
{
  const { g, skickat } = varld();
  g.fokusStart(["d"]);
  await new Promise((r) => setTimeout(r, 0));
  ok("granskas: ingen paborja", !skickat.some((s) => s.data.handling === "paborja"), JSON.stringify(skickat));
}

rubrik("Påbörjat som inte sparas lämnar läget som det var");
{
  const { g } = varld();
  g.ndSkriv = async () => ({ ok: false, status: 500, data: { fel: "nej" } });
  g.ndSvar = (s) => s.data;
  g.fokusStart(["b"]);
  await new Promise((r) => setTimeout(r, 0));
  const t = g.TASKS.find((x) => x.id === "b");
  ok("returnerad står kvar som returnerad", t.ndLage === "returnerad", t.ndLage);
  ok("och är inte Pågår", !t.startad);
}

rubrik("I läsläge skickas ingenting");
{
  const { g, skickat } = varld();
  g.ND.uppgifter.skriv = false;
  g.fokusStart(["c"]);
  await new Promise((r) => setTimeout(r, 0));
  ok("ingen paborja när Uppgifter inte sparar", skickat.length === 0, JSON.stringify(skickat));
}

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m" : `\n\x1b[31m${fel} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
