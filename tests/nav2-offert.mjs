#!/usr/bin/env node
/**
 * Rutan Offert skickad i Nav 2.0 (0303): fältet Belopp, paketen som fyller i det, och det som skickas.
 *
 * Provet läser två block ur utkastet (delen med beloppet, och funktionen som bygger det som skickas) och kör dem i
 * en sandlåda där resten av utkastet är attrapper. Talen per paket och bindningstid kommer från servern
 * (`offertPaketVal` i motenforma.ts, prövad i tests/moten.mjs): klienten räknar inga pengar.
 *
 *   node tests/nav2-offert.mjs
 */
import { readFileSync } from "node:fs";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra && !villkor ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const html = readFileSync(process.env.UTKAST ?? new URL("../src/nav2/utkast.html", import.meta.url), "utf8");
const delen = html.match(/\/\/ Offertens belopp \(0303\): en offert har ett pris\.[\s\S]*?(?=\nfunction moSkalFalt\(D\)\{)/)?.[0];
const bygg = html.match(/\nfunction moDlgBygg\(D\)\{[\s\S]*?(?=\n\/\/ Ändra: bara det som skiljer sig)/)?.[0];
ok("delen med beloppet finns i utkastet", !!delen);
ok("funktionen som bygger det som skickas finns i utkastet", !!bygg);
if (!delen || !bygg) {
  console.log(`\n\x1b[31m${fel} prov föll.\x1b[0m`);
  process.exit(1);
}

const inbyggda = new Set(["Object", "Array", "JSON", "Math", "Date", "Set", "Map", "String", "Number", "Boolean", "Promise", "RegExp", "Error", "Symbol", "parseInt", "parseFloat", "isNaN", "undefined", "NaN", "Infinity", "console"]);
const attrapp = () => new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => "" : attrapp()), apply: () => attrapp() });
function kor(block, g, namn = []) {
  const sandlada = new Proxy(g, {
    has: (_, k) => typeof k === "string" && !inbyggda.has(k),
    get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? t[k] : attrapp()),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  new Function("sandlada", `with (sandlada) {\n${block}\n__ut = {${namn.join(", ")}};\n}`)(sandlada);
  return Object.assign(g, g.__ut);
}

const PAKET = [{ id: 1, l: "Bas", belopp: { 12: 17880, 24: 35760, 36: 53640 } }, { id: 2, l: "Mellan", belopp: { 12: 35880, 24: 71760, 36: 107640 } }];
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
function utkastet(paket = PAKET) {
  const g = {
    ndMo: () => ({ offertPaket: paket }), esc, MOOB: " *",
    moFalt: (D, namn, etikett, inp) => `<div data-falt="${namn}"><label>${etikett}</label>${inp}${D.fel[namn] ? `<p class="mo-err">${D.fel[namn]}</p>` : ""}</div>`,
    moInp: (D, namn, o = {}) => `<input name="${namn}" value="${esc(D.f[namn] || "")}" placeholder="${esc(o.ph || "")}" ${o.extra || ""}>`,
    moTyp: () => "hallet", moSvarData: () => null, ndIdag: () => "2026-11-16", moEgenFel: () => "", moUpp: () => ({}),
  };
  kor(delen, g, ["moOffertPaket", "moOffertFyll", "moOffertBeloppDel"]);
  kor(bygg, g, ["moDlgBygg"]);
  return g;
}
const blad = (f = {}) => ({ typ: "utfall", u: "hallet", k: { kedja: "K", mote: { id: "M", tid: "2026-11-16 10:00" } }, f: { val: "offert", skal: "", datum: "2026-11-19", text: "", belopp: "", paket: "", lop: "", ...f }, fel: {}, tid: null });

rubrik("Fältet Belopp");
{
  const g = utkastet();
  const h = g.moOffertBeloppDel(blad());
  ok("fältet finns, och säger att det gäller hela kronor", /data-falt="belopp"/.test(h) && h.includes("Hela kronor. En offert har ett pris."), h);
  ok("paketen går att välja, inget är valt från början", (h.match(/data-mopaket=/g) || []).length === 2 && !/data-mopaket="\d+" aria-pressed="true"/.test(h), h);
  ok("bindningstiden visas först när ett paket är valt", !/data-molop=/.test(h));
  const med = g.moOffertBeloppDel(blad({ paket: "2" }));
  ok("valt paket: tre bindningstider", (med.match(/data-molop=/g) || []).length === 3 && /data-mopaket="2" aria-pressed="true"/.test(med) && med.includes("24 mån"), med);
  const utan = utkastet([]).moOffertBeloppDel(blad());
  ok("utan paket visas bara fältet Belopp", /data-falt="belopp"/.test(utan) && !/data-mopaket=/.test(utan), utan);
}

rubrik("Paketet och bindningstiden fyller i beloppet");
{
  const g = utkastet();
  const D = blad({ paket: "2", lop: "24" });
  g.moOffertFyll(D);
  ok("Mellan i 24 månader ger serverns tal", D.f.belopp === "71760", D.f.belopp);
  const D2 = blad({ paket: "2", belopp: "50000" });
  g.moOffertFyll(D2);
  ok("utan bindningstid rörs inte det som står", D2.f.belopp === "50000", D2.f.belopp);
  const D3 = blad({ paket: "9", lop: "24", belopp: "123" });
  g.moOffertFyll(D3);
  ok("ett paket som inte finns ändrar ingenting", D3.f.belopp === "123", D3.f.belopp);
  const D4 = blad({ paket: "1", lop: "12" });
  D4.fel.belopp = "Skriv offertens belopp.";
  g.moOffertFyll(D4);
  ok("felet vid fältet försvinner när beloppet fylls i", D4.f.belopp === "17880" && !("belopp" in D4.fel));
}

rubrik("Det som skickas");
{
  const g = utkastet();
  const utan = g.moDlgBygg(blad());
  ok("utan belopp: felet står vid fältet och inget skickas", utan.e?.belopp === "Skriv offertens belopp." && !utan.handling, JSON.stringify(utan));
  const med = g.moDlgBygg(blad({ belopp: "212 000" }));
  ok("beloppet skickas som ett heltal", med.handling === "utfall" && med.data.belopp === 212000 && med.data.resultat === "offert" && med.data.datum === "2026-11-19" && !("paket" in med.data), JSON.stringify(med));
  const paket = g.moDlgBygg(blad({ belopp: "71760", paket: "2", lop: "24" }));
  ok("paketet följer med när ett är valt", paket.data?.belopp === 71760 && paket.data?.paket === 2, JSON.stringify(paket));
  ok("noll kronor går att spara", g.moDlgBygg(blad({ belopp: "0" })).data?.belopp === 0);
  for (const b of ["tolv", "12,50", "-5", "100000001"]) {
    const r = g.moDlgBygg(blad({ belopp: b }));
    ok(`"${b}" nekas vid fältet`, r.e?.belopp === "Beloppet ska vara hela kronor, högst 100 000 000." && !r.handling, JSON.stringify(r));
  }
  const upp = g.moDlgBygg(blad({ val: "uppfoljning", belopp: "5000" }));
  ok("en uppföljning skickar aldrig ett belopp", upp.handling === "utfall" && !("belopp" in upp.data) && !("paket" in upp.data), JSON.stringify(upp));
}

console.log(fel ? `\n\x1b[31m${fel} prov föll.\x1b[0m` : "\n\x1b[32mAlla prov gick igenom.\x1b[0m");
process.exit(fel ? 1 : 0);
