#!/usr/bin/env node
/**
 * Granskningen S10 (G8): Rutiners "Fråga <ägare>" och "Påminn ägarna om
 * granskning" går till riktiga handlingar, inte till påhittade kvitton.
 *
 * Provet läser modulblocket RUTINER ur det byggda utkastet och kör det i en
 * sandlåda där utkastets egna funktioner är attrapper. Kör det mot
 * `src/nav2/utkast.html` (eller filen i `UTKAST`).
 *
 *   node tests/nav2-rutiner-fraga.mjs
 */
import { readFileSync } from "node:fs";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const html = readFileSync(process.env.UTKAST ?? new URL("../src/nav2/utkast.html", import.meta.url), "utf8");
const block = html.match(/\/\* =+\n {3}NAV 2\.0 I RIKTIGT LÄGE: RUTINER[\s\S]*?NDKOPPLAD\.add\('rutiner'\); \}/)?.[0];
ok("modulblocket RUTINER finns i utkastet", !!block);
if (!block) { console.log(`\n\x1b[31m${fel} prov föll.\x1b[0m`); process.exit(1); }

function varld() {
  const skickat = [], lyssnare = [];
  const g = {
    ND: null, S: { view: "rutiner" }, NDKOPPLAD: new Set(),
    toast: () => {}, render: () => {}, esc: (s) => String(s),
    ndSkriv: async (url, data) => { skickat.push({ url, data }); return { ok: true, status: 200, data: { ok: "Mick får frågan i Nav, med rutinen kopplad." } }; },
    ndSvar: (s) => s.data, ndSkrivFel: () => {},
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location: { reload: () => {} },
    document: { addEventListener: (typ, f) => lyssnare.push([typ, f]), getElementById: () => null },
    rSida: (r) => `<div class="rtn-knappar"><button type="button" class="btn btn-s btn-sm" data-act="toast" data-msg="Mick får frågan i Nav, med rutinen kopplad.">Fråga Mick</button></div>`,
    felHtml: (r) => `<p class="rtn-rm">Saknas ditt problem? <button type="button" class="tlink" data-act="toast" data-msg="Mick får frågan i Nav, med rutinen kopplad.">Fråga Mick</button></p>`,
    forvaltningVy: () => `<button type="button" class="tlink rtn-mer" data-act="toast" data-msg="Ägarna till 3 rutiner fick en påminnelse om granskning.">Påminn ägarna om granskning</button>`,
  };
  const inbyggda = new Set(["Object", "Array", "JSON", "Math", "Date", "Set", "Map", "String", "Number", "Boolean", "Promise", "RegExp", "Error", "Symbol", "parseInt", "parseFloat", "isNaN", "encodeURIComponent", "decodeURIComponent", "undefined", "NaN", "Infinity", "console", "setTimeout", "clearTimeout", "structuredClone", "Intl"]);
  const attrapp = () => new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => "" : attrapp()), apply: () => attrapp() });
  const sandlada = new Proxy(g, {
    has: (_, k) => typeof k === "string" && !inbyggda.has(k),
    get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? t[k] : attrapp()),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  new Function("sandlada", `with (sandlada) {\n${block}\n}`)(sandlada);
  // Riktigt läge från och med nu (modulen läser ND.rutiner när den anropas).
  g.ND = { rutiner: { rutiner: [], farRed: true } };
  const klick = (dataset) => { const e = { target: { closest: () => ({ dataset }) }, preventDefault() {}, stopImmediatePropagation() {} }; for (const [typ, f] of lyssnare) if (typ === "click") f(e); };
  return { g, skickat, klick };
}

rubrik("Knapparna pekar på handlingar, inte på kvitton");
{
  const { g } = varld();
  const r = { id: "kundtjanst", agare: "Mick Ägare", t: "Kundtjänst" };
  const s = g.rSida(r), f = g.felHtml(r), v = g.forvaltningVy();
  ok("Fråga i sidan: ingen toast", !/data-act="toast"/.test(s) && /data-ndrutfraga="kundtjanst"/.test(s), s);
  ok("Fråga under problemen: ingen toast", !/data-act="toast"/.test(f) && /data-ndrutfraga="kundtjanst"/.test(f), f);
  ok("Påminn ägarna: ingen toast", !/data-act="toast"/.test(v) && /data-ndrutpaminng/.test(v), v);
  ok("texten och klasserna står kvar", /class="btn btn-s btn-sm"[^>]*>Fråga Mick</.test(s) && /class="tlink rtn-mer"[^>]*>Påminn ägarna om granskning</.test(v));
}

rubrik("Klicken skickar till /nav2/rutiner");
{
  const { klick, skickat } = varld();
  klick({ ndrutfraga: "kundtjanst" });
  await new Promise((r) => setTimeout(r, 0));
  ok("Fråga skickar handlingen fraga med rutinen", skickat.some((x) => x.url === "/nav2/rutiner" && x.data.handling === "fraga" && x.data.id === "kundtjanst"), JSON.stringify(skickat));
  klick({ ndrutpaminng: "" });
  await new Promise((r) => setTimeout(r, 0));
  ok("Påminn skickar paminn-granska", skickat.some((x) => x.data.handling === "paminn-granska"), JSON.stringify(skickat));
}

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m" : `\n\x1b[31m${fel} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
