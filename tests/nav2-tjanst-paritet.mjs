#!/usr/bin/env node
/**
 * Formulärets provision i Nav 2.0 är serverns (0293 och nettoregeln, 2026-11-13).
 *
 * Nav 2.0 visar provisionen medan ordern skrivs (`ndSim` i utkast.html), och
 * godkännandet fryser den på servern (`saljarensProvision` + `affarenFor`).
 * Säger de olika saker ser säljchefen ett tal i formuläret och ett annat på
 * ordern. Provet plockar `ndSim` och dess hjälpare ORDAGRANT ur sidan, kör dem
 * i en sandlåda och jämför med serverns funktioner, affär för affär, över ett
 * rutnät av paket, löptider, tjänster med och utan val, utköp, finans och
 * chefens egen försäljning.
 *
 *   node --experimental-strip-types tests/nav2-tjanst-paritet.mjs
 *   UTKAST=<fil> node … (en annan utkast.html)
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { saljarensProvision } from "../src/lib/saljarprovision.ts";
import { affarenFor, arEgenForsaljning, gallandeChefssats } from "../src/lib/chefsprovision.ts";
import { affarensVarde } from "../src/lib/order.ts";
import { finansavgift, gallandeFinanssats, nettoEfterFinans } from "../src/lib/finans.ts";
import { gallandeUtkopssats, nettoEfterUtkop } from "../src/lib/utkop.ts";

let fel = 0;
let antal = 0;
const ok = (namn, villkor, extra = "") => {
  antal++;
  if (!villkor) {
    fel++;
    console.log(`  \x1b[31m✗\x1b[0m ${namn}${extra ? "  " + extra : ""}`);
  }
};
const html = readFileSync(process.env.UTKAST ?? new URL("../src/nav2/utkast.html", import.meta.url), "utf8");
const skript = html.match(/<script>([\s\S]*?)<\/script>/g).map((x) => x.slice(8, -9)).sort((a, b) => b.length - a.length)[0];
const rader = skript.split("\n");

/** En deklaration ur sidan: en rad, eller en funktion till och med raden "}". */
function plocka(borjan) {
  const i = rader.findIndex((r) => r.startsWith(borjan));
  if (i < 0) throw new Error("hittar inte i utkast.html: " + borjan);
  if (!/^(async )?function /.test(borjan)) return rader[i];
  // En funktion på en rad: klamrarna går jämnt ut på den raden.
  const jamn = (r) => (r.match(/{/g) || []).length === (r.match(/}/g) || []).length;
  if (jamn(rader[i])) return rader[i];
  let e = i;
  while (!/^}/.test(rader[e])) e++;
  return rader.slice(i, e + 1).join("\n");
}

const kod = [
  plocka("let oTjVarde = "),
  plocka("let oVarde = "),
  "const _ndOVarde = oVarde, _ndOTj = oTjVarde;",
  plocka("oTjVarde = (t, lop) => ndO() && t.length > 3"),
  plocka("function ndGaller("),
  plocka("const ndAvrunda = "),
  plocka("function ndVemId("),
  plocka("function ndSim("),
  plocka("function ndProvSimText("),
  plocka("function ndRegelText("),
].join("\n");

const SALJ = "a0000000-0000-0000-0000-000000000001";
const CHEF = "c0000000-0000-0000-0000-000000000001";
const D = {
  satser: [
    { id: "r2-12", package_id: 2, term_months: 12, amount: 1800, valid_from: "2026-01-01", valid_to: null },
    { id: "r2-24", package_id: 2, term_months: 24, amount: 2400, valid_from: "2026-01-01", valid_to: null },
    { id: "r3-12", package_id: 3, term_months: 12, amount: 3500, valid_from: "2026-01-01", valid_to: null },
    { id: "r3-36", package_id: 3, term_months: 36, amount: 6000, valid_from: "2026-01-01", valid_to: null },
  ],
  chefssatser: [{ id: "m1", employee_id: CHEF, override_percent: 10, own_sale_percent: 40, valid_from: "2026-01-01", valid_to: null }],
  utkopssatser: [{ id: "u1", percent: 12, valid_from: "2026-01-01", valid_to: null }],
  finanssatser: [{ id: "f1", percent_per_year: 11, valid_from: "2026-01-01", valid_to: null }],
  saljare: [{ id: SALJ, namn: "Sara Säljare" }, { id: CHEF, namn: "Zen Chef" }],
  paket: [{ id: 2, l: "Paket 2", pris: 1495 }, { id: 3, l: "Paket 3", pris: 1995 }],
};
const sandlada = {
  ND: { order: D, jag: { id: CHEF, namn: "Zen Chef" } },
  S: { role: "chef" },
  OPAKET: { 2: { l: "Paket 2", pris: 1495 }, 3: { l: "Paket 3", pris: 1995 } },
  ME: { chef: { namn: "Zen Chef" }, saljare: { namn: "Sara Säljare" } },
  kIdag: () => "2026-11-13",
  oKr: (n) => `${Math.round(n)} kr`,
  Math,
  JSON,
};
sandlada.ndO = () => sandlada.ND.order;
vm.createContext(sandlada);
vm.runInContext(kod + "\nglobalThis.__ut = { ndSim, ndProvSimText };", sandlada);
const { ndSim, ndProvSimText } = sandlada.__ut;

// ---------------------------------------------------------------------------
const TJ = [
  { name: "Hemsida", billing: "engang", amount: 7995 },
  { name: "SEO", billing: "manad", amount: 1995 },
  { name: "Annonser", billing: "manad", amount: 1000 },
];
const VAL = [null, { f: "kr", v: 0 }, { f: "kr", v: 800 }, { f: "%", v: 10 }, { f: "%", v: 12.5 }];

let fall = 0;
const testa = ({ p, lop, man, tj, val, utkop, finans, vem }) => {
  fall++;
  // Formulärets form (onSomOrder): tj som [namn, typ, belopp], tjp parallellt.
  const sim = { vem: vem === CHEF ? "Zen Chef" : "Sara Säljare", sign: "2026-11-04", p, lop, man, tj: tj.map((t) => [t.name, t.billing, t.amount]), tjp: val, utkop, finans, fri: null };
  const k = ndSim(sim);

  // Serverns form.
  const tjanster = tj.map((t, i) => ({
    ...t,
    follows_order: t.billing === "manad",
    term_months: null,
    starts_on: null,
    provision: val[i] ? { form: val[i].f === "%" ? "procent" : "belopp", varde: val[i].v } : null,
  }));
  const varde = affarensVarde(man, lop, tjanster);
  const fs = finans ? gallandeFinanssats(D.finanssatser, "2026-11-04") : null;
  const avgift = fs ? finansavgift(varde, lop, fs.percent_per_year) : null;
  const netto = nettoEfterFinans(nettoEfterUtkop(varde, utkop), avgift);
  const chefssats = gallandeChefssats(D.chefssatser, "2026-11-04");
  const chefenSaljer = arEgenForsaljning(chefssats, vem);
  const del = saljarensProvision({ paket: p, loptid: lop, signerad: "2026-11-04", netto, utkop, finans, friOrder: false, chefenSaljer, handsatt: { procent: null, belopp: null }, satser: D.satser, nettosats: gallandeUtkopssats(D.utkopssatser, "2026-11-04"), tjanster });
  const namn = `P${p} ${lop} mån, ${tj.map((t, i) => `${t.name}:${val[i] ? val[i].v + val[i].f : "–"}`).join(" ") || "inga tjänster"}${utkop ? ", utköp " + utkop : ""}${finans ? ", finans" : ""}${vem === CHEF ? ", chefens egen" : ""}`;

  if (!del.klar) {
    ok(`${namn}: båda nekar`, k.fel !== null && k.prov === null, `klient ${k.prov} / ${k.fel}, server ${del.fel}`);
    return;
  }
  const a = affarenFor({ sats: chefssats, saljareId: vem, ordervarde: netto, saljarprovision: del.provision, saljarkalla: del.kalla, handsatt: false });
  ok(`${namn}: ordervärdet`, k.varde === varde, `${k.varde} / ${varde}`);
  ok(`${namn}: finansavgiften`, k.finans === (avgift ?? 0), `${k.finans} / ${avgift}`);
  ok(`${namn}: källan`, k.kalla === a.kalla, `${k.kalla} / ${a.kalla}`);
  ok(`${namn}: provisionen`, k.prov === a.provision, `${k.prov} / ${a.provision}`);
  if (a.kalla === "matrix") {
    ok(`${namn}: tjänsternas kronor`, JSON.stringify(k.tjKr) === JSON.stringify(del.tjanster.map((t) => t.provision_kr)), `${JSON.stringify(k.tjKr)} / ${JSON.stringify(del.tjanster.map((t) => t.provision_kr))}`);
    ok(`${namn}: spärren`, JSON.stringify(k.saknas) === JSON.stringify(del.saknas), `${JSON.stringify(k.saknas)} / ${JSON.stringify(del.saknas)}`);
  } else {
    ok(`${namn}: ingen spärr när tjänsterna ingår`, k.kalla !== "matrix" && del.saknas.length === 0);
  }
  if (a.kalla === "buyout") ok(`${namn}: regeln`, k.regel === del.nettoregel, `${k.regel} / ${del.nettoregel}`);
  // Texten under provisionen nämner det som gav beloppet.
  const text = ndProvSimText(sim);
  if (a.kalla === "buyout") ok(`${namn}: texten säger 12 % och avdraget`, text.startsWith("12 % av det som blir kvar efter") && text.includes(finans ? "finans" : "utköp"), text);
  if (a.kalla === "matrix" && del.tjansteprovision > 0) ok(`${namn}: texten nämner tjänsterna`, text.includes("+ tjänster"), text);
};

for (const [p, lop, man] of [[2, 12, 1495], [2, 24, 1295], [3, 12, 1995], [3, 36, 1995]]) {
  for (let maske = 0; maske < 8; maske++) {
    const tj = TJ.filter((_, i) => maske & (1 << i));
    // Valen: alla kombinationer för upp till två tjänster, ett urval för tre.
    const valListor = tj.length === 0 ? [[]] : tj.length === 1 ? VAL.map((v) => [v]) : tj.length === 2 ? VAL.flatMap((a) => VAL.map((b) => [a, b])) : [[null, null, null], [VAL[2], VAL[3], VAL[4]], [VAL[1], null, VAL[3]]];
    for (const val of valListor) {
      for (const utkop of [null, 3000]) {
        for (const finans of [false, true]) {
          for (const vem of [SALJ, CHEF]) testa({ p, lop, man, tj, val, utkop, finans, vem });
        }
      }
    }
  }
}
// Matrisraden saknas (Paket 2 i 36 mån): båda nekar på matrisen, och nettoregeln går ändå.
testa({ p: 2, lop: 36, man: 1495, tj: [], val: [], utkop: null, finans: false, vem: SALJ });
testa({ p: 2, lop: 36, man: 1495, tj: [], val: [], utkop: null, finans: true, vem: SALJ });

console.log(`${fall} affärer, ${antal} jämförelser: ${fel === 0 ? "\x1b[32mformuläret räknar som servern\x1b[0m" : `\x1b[31m${fel} skiljer sig\x1b[0m`}`);
process.exit(fel === 0 ? 0 : 1);
