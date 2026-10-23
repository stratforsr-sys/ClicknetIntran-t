#!/usr/bin/env node
/**
 * Granskningen S08: ordern i Nav 2.0 räknar som beställaren beslutat.
 *
 * - **K5 (D2), beslut B2:** en paketorder där kunden betalar mindre än
 *   listpris. Säljarens matrisprovision är oförändrad; ordervärdet, chefens
 *   egen försäljning och övertäcket räknas på det verkliga priset, och det
 *   priset fryses på ordern (och går till Inkio). Utan ändrat pris: exakt som
 *   i dag.
 * - **D6:** godkännandet skriver bara om ordern fortfarande har den status som
 *   lästes, så ett dubbelklick bokför en gång.
 * - **D16:** "Spara som utkast" prövar signeringsdatum, löptid och belopp.
 *
 * `raknaFramProvision` plockas ordagrant ur `src/app/(app)/order/actions.ts`
 * (samma grepp som granskningens `d-hjalp/jmf/bygg-main-rakna.mjs`), och bara
 * databasläsningen byts mot satserna nedan. Inget nät, ingen databas.
 *
 *   node --experimental-strip-types tests/nav2-order.mjs
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const rot = new URL("../", import.meta.url);
const las = (p) => readFileSync(new URL(p, rot), "utf8");

const R = await import(new URL("src/lib/orderregler.ts", rot).href);

// ---------------------------------------------------------------------------
rubrik("Rabatten ur formuläret (B2)");
const fd = (o) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
ok("utan markören: null (behåll det som var)", R.rabattUrFormular(fd({ monthly_amount: "1295" }), 1495) === null);
ok("1 295 mot 1 495: rabatten 1 295", R.rabattUrFormular(fd({ pris_ritad: "1", monthly_amount: "1 295" }), 1495)?.rabatt === 1295);
ok("listpriset: ingen rabatt", R.rabattUrFormular(fd({ pris_ritad: "1", monthly_amount: "1495" }), 1495)?.rabatt === null);
ok("tomt fält: ingen rabatt", R.rabattUrFormular(fd({ pris_ritad: "1", monthly_amount: "" }), 1495)?.rabatt === null);
ok("över listpris: nej med besked", "fel" in (R.rabattUrFormular(fd({ pris_ritad: "1", monthly_amount: "1600" }), 1495) ?? {}));
ok("noll: nej med besked", "fel" in (R.rabattUrFormular(fd({ pris_ritad: "1", monthly_amount: "0" }), 1495) ?? {}));
ok("går inte att tolka: nej med besked", "fel" in (R.rabattUrFormular(fd({ pris_ritad: "1", monthly_amount: "10.000" }), 1495) ?? {}));
ok("paketpriset med rabatt", R.paketManadsbelopp(1495, 1295) === 1295);
ok("paketpriset utan rabatt", R.paketManadsbelopp(1495, null) === 1495 && R.paketManadsbelopp(1495, undefined) === 1495);
ok("en rabatt som inte ryms under ett nytt listpris gäller inte", R.paketManadsbelopp(995, 1295) === 995 && R.giltigRabatt(995, 1295) === null);

rubrik("Anteckningen (samma text som utkastets ordSkapa)");
ok("rabatt med skäl", R.rabattAnteckning(null, 1495, 1295, "Kampanj") === "Rabatt 200 kr/mån: Kampanj.");
ok("rabatt med skäl före säljarens text", R.rabattAnteckning("Ring före 10.", 1495, 1295, "Lojal kund") === "Rabatt 200 kr/mån: Lojal kund. Ring före 10.");
ok("rabatt utan skäl", R.rabattAnteckning("", 1495, 1295, "") === "Rabatt 200 kr/mån.");
ok("en ändrad rabatt byter raden", R.rabattAnteckning("Rabatt 200 kr/mån: Kampanj. Ring före 10.", 1495, 1395, "Kampanj") === "Rabatt 100 kr/mån: Kampanj. Ring före 10.");
ok("listpriset igen tar bort raden", R.rabattAnteckning("Rabatt 200 kr/mån: Kampanj. Ring före 10.", 1495, null, "") === "Ring före 10.");
ok("utan nytt skäl behålls det gamla (granskningen I2)", R.rabattAnteckning("Rabatt 200 kr/mån: Kampanj. Ring före 10.", 1495, 1295, "") === "Rabatt 200 kr/mån: Kampanj. Ring före 10.");
ok("ett nytt skäl ersätter det gamla", R.rabattAnteckning("Rabatt 200 kr/mån: Kampanj.", 1495, 1295, "Lojal kund") === "Rabatt 200 kr/mån: Lojal kund.");

rubrik("Ångra Förlänger inte (D23, granskningen I1)");
const nu = Date.parse("2026-10-23T12:00:00Z");
const utfall = { renewal_outcome: "avslutad", renewal_by: "me", renewal_at: "2026-10-23T11:55:00Z", salesperson_id: "me" };
ok("eget utfall för fem minuter sedan: får ångras", R.farAngraUtfall(utfall, "me", nu) === true);
ok("eget utfall för elva minuter sedan: nej", R.farAngraUtfall({ ...utfall, renewal_at: "2026-10-23T11:49:00Z" }, "me", nu) === false);
ok("någon annans utfall: nej", R.farAngraUtfall({ ...utfall, renewal_by: "chef" }, "me", nu) === false);
ok("en förlängd order: nej", R.farAngraUtfall({ ...utfall, renewal_outcome: "forlangd" }, "me", nu) === false);
ok("inte säljarens order: nej", R.farAngraUtfall({ ...utfall, salesperson_id: "annan" }, "me", nu) === false);
ok("en egen mening om rabatt rörs inte", R.rabattAnteckning("Rabatt 100 kr/mån godkänd av Johanna", 1495, null, "") === "Rabatt 100 kr/mån godkänd av Johanna");

// ---------------------------------------------------------------------------
// raknaFramProvision ur actions.ts
// ---------------------------------------------------------------------------
const act = las("src/app/(app)/order/actions.ts");
const rader = act.split("\n");
function block(start) {
  const s = rader.findIndex((r) => start.test(r));
  if (s < 0) throw new Error("hittar inte " + start);
  let e = s;
  while (e < rader.length && !/^}/.test(rader[e]) && !/^  \| \{ klar: false; fel: string \};/.test(rader[e])) e++;
  return rader.slice(s, e + 1).join("\n");
}
let rakna = block(/^async function raknaFramProvision/);
const fore = rakna;
rakna = rakna.replace(/const db = supabaseAdmin\(\);\s*\n\s*const \[([\s\S]*?)\] = await Promise\.all\(\[[\s\S]*?\]\);/, "const [$1] = (globalThis as any).__DB__;");
ok("databasläsningen i raknaFramProvision hittades", rakna !== fore);
const lib = (f) => pathToFileURL(fileURLToPath(new URL(`src/lib/${f}`, rot))).href;
const dir = mkdtempSync(join(tmpdir(), "nav2-order-"));
writeFileSync(
  join(dir, "rakna.ts"),
  `import { kronor, tolkaBelopp } from "${lib("provision.ts")}";
import { affarensVarde, gallandeSats } from "${lib("order.ts")}";
import { affarenFor, arEgenForsaljning, gallandeChefssats, procentProvision, restpostenAtNoll } from "${lib("chefsprovision.ts")}";
import { gallandeUtkopssats, harUtkop, nettoEfterUtkop, utkopsprovision } from "${lib("utkop.ts")}";
import { finansavgift, finansprocent, gallandeFinanssats, nettoEfterFinans } from "${lib("finans.ts")}";
import * as orderregler from "${lib("orderregler.ts")}";
const { paketManadsbelopp } = orderregler as any;
${block(/^type Framrakning =/)}
export ${rakna}
`,
);
const { raknaFramProvision } = await import(pathToFileURL(join(dir, "rakna.ts")).href);

const CHEF = "c0000000-0000-0000-0000-000000000001";
const SALJ = "a0000000-0000-0000-0000-000000000001";
globalThis.__DB__ = [
  { data: [{ id: "r24", package_id: 2, term_months: 24, amount: 2400, valid_from: "2026-01-01", valid_to: null }] },
  { data: [{ id: 2, label: "Mellan", list_price: 1495, sort: 2, active: true }] },
  { data: [{ id: "m1", employee_id: CHEF, override_percent: 10, own_sale_percent: 40, valid_from: "2026-01-01", valid_to: null }] },
  { data: [{ id: "u1", percent: 12, valid_from: "2026-01-01", valid_to: null }] },
  { data: [{ id: "f1", percent_per_year: 11, valid_from: "2026-01-01", valid_to: null }] },
];
const berakna = (vem, extra = {}) => raknaFramProvision(2, 24, "2026-10-20", vem, new FormData(), null, { manadsbelopp: null, tjanster: [], finans: false, ...extra });

rubrik("Paket 2 för 1 295 kr i stället för 1 495 kr i 24 månader (Review Focus 3)");
const lista = await berakna(SALJ);
const rabatt = await berakna(SALJ, { rabatt: 1295 });
ok("listpris: ordervärdet 35 880 kr", lista.klar && lista.satt.order_value === 35880, String(lista.satt?.order_value));
ok("rabatt: ordervärdet fryses på 31 080 kr", rabatt.klar && rabatt.satt.order_value === 31080, String(rabatt.satt?.order_value ?? rabatt.fel));
ok("rabatt: månadsbeloppet fryses på 1 295 kr (det Inkio får)", rabatt.satt?.monthly_amount === 1295);
ok("rabatt: säljarens provision är matrisens, densamma som för 1 495 kr", rabatt.satt?.commission_amount === lista.satt.commission_amount && rabatt.satt?.commission_source === "matrix" && rabatt.satt?.commission_rate_id === "r24");
ok("rabatt: ordervärdets källa är paketet", rabatt.satt?.order_value_source === "package");
ok("rabatt: övertäcket räknas på 31 080 kr", rabatt.overtack?.order_value === 31080 && lista.overtack?.order_value === 35880, `${rabatt.overtack?.order_value} / ${lista.overtack?.order_value}`);
ok("rabatt: övertäcket är lägre än på listpris", rabatt.overtack.amount < lista.overtack.amount, `${rabatt.overtack.amount} < ${lista.overtack.amount}`);

const chefRabatt = await berakna(CHEF, { rabatt: 1295 });
ok("chefens egen försäljning: 40 % av 31 080 kr = 12 432 kr", chefRabatt.satt?.commission_amount === 12432 && chefRabatt.satt?.commission_source === "manager", String(chefRabatt.satt?.commission_amount));

rubrik("Utan ändrat pris: exakt som i dag (Review Focus 4)");
const utan1 = await berakna(SALJ, { rabatt: null });
const utan2 = await berakna(SALJ, { rabatt: 1495 });
const utan3 = await berakna(CHEF);
ok("rabatt null ger samma resultat som ingen rabatt", JSON.stringify(utan1) === JSON.stringify(lista));
ok("rabatt = listpris ger samma resultat som ingen rabatt", JSON.stringify(utan2) === JSON.stringify(lista));
ok("chefens egen utan rabatt: 40 % av 35 880 kr", utan3.satt?.commission_amount === 14352, String(utan3.satt?.commission_amount));
const fri = await berakna(SALJ, { manadsbelopp: 1295, rabatt: 1000 });
ok("en fri order bryr sig inte om rabatten (kräver provision som förut)", fri.klar === false && /utanför paketreglerna/.test(fri.fel));

rubrik("Nav 2.0 visar det verkliga priset före godkännandet (orderforma.ts)");
const F = await import(new URL("src/lib/nav2/orderforma.ts", rot).href);
const satserna = {
  paket: [{ id: 2, label: "Mellan", list_price: 1495, sort: 2, active: true }],
  satser: [{ id: "r24", package_id: 2, term_months: 24, amount: 2400, valid_from: "2026-01-01", valid_to: null }],
  chefssatser: [{ id: "m1", employee_id: CHEF, override_percent: 10, own_sale_percent: 40, valid_from: "2026-01-01", valid_to: null }],
  utkopssatser: [],
  finanssatser: [],
};
const inskickad = { package_id: 2, term_months: 24, signed_on: "2026-10-20", salesperson_id: SALJ, monthly_amount: null, buyout_amount: null, financed: false, proposed_commission_amount: null, proposed_commission_percent: null };
const fhLista = F.forhandsprovision(inskickad, [], satserna);
const fhRabatt = F.forhandsprovision({ ...inskickad, discounted_monthly_amount: 1295 }, [], satserna);
const fhChef = F.forhandsprovision({ ...inskickad, salesperson_id: CHEF, discounted_monthly_amount: 1295 }, [], satserna);
ok("förhandsvisningen: ordervärdet 31 080 kr med rabatten", fhRabatt.varde === 31080, String(fhRabatt.varde));
ok("förhandsvisningen: säljarens provision är matrisens", fhRabatt.provision === fhLista.provision && fhRabatt.kalla === "matrix");
ok("förhandsvisningen: chefens egen 12 432 kr, som godkännandet", fhChef.provision === chefRabatt.satt.commission_amount, String(fhChef.provision));
ok("förhandsvisningen utan rabatt: som förut", fhLista.varde === 35880 && F.forhandsprovision({ ...inskickad, discounted_monthly_amount: null }, [], satserna).varde === 35880);

// ---------------------------------------------------------------------------
rubrik("Godkännandet en gång (D6)");
ok("ingen rad ändrad: inte godkänd", R.godkannandeSkrevs([]) === false && R.godkannandeSkrevs(null) === false);
ok("en rad ändrad: godkänd", R.godkannandeSkrevs([{ id: "x" }]) === true);
const gk = act.slice(act.indexOf("export async function godkannOrder("), act.indexOf("export async function redigeraOrder("));
const upd = gk.indexOf('.from("sales_order")\n      .update(andring)');
const updRad = gk.slice(upd, gk.indexOf(";", upd));
ok("uppdateringen villkoras på den lästa statusen", /\.eq\("status", rad\.status\)/.test(updRad), updRad.replace(/\s+/g, " "));
ok("uppdateringen läser tillbaka raden", /\.select\("id"\)/.test(updRad));
ok("utan skriven rad bokförs ingenting (beskedet före övertäcket)", gk.indexOf("godkannandeSkrevs(") > upd && gk.indexOf("godkannandeSkrevs(") < gk.indexOf("skrivOvertack("));

// ---------------------------------------------------------------------------
rubrik("Spara som utkast prövar som skapaOrder (D16)");
const rutt = las("src/app/nav2/order/route.ts");
// Handlingen "utkast" kör `sparaUtkast` (genom medNyckel).
const ut = rutt.slice(rutt.indexOf("async function sparaUtkast("));
ok("sparaUtkast finns", rutt.includes("async function sparaUtkast("));
ok("signeringsdatumet prövas (inte i framtiden)", /giltigtSigneringsdatum\(/.test(ut));
ok("en paketorder har matrisens löptider", /LOPTIDER/.test(ut));
ok("ett fritt belopp som inte går att tolka nekas", /Skriv vad kunden betalar per månad/.test(ut));
ok("den angivna provisionen sparas", /proposed_commission_amount/.test(ut) && /angivenProvision\(/.test(ut));
ok("tjänsterna tolkas som i skapaOrder (egen bindningstid)", /tjansterUrFormular\(/.test(ut));
ok("rabatten sparas", /discounted_monthly_amount/.test(ut));
ok("startdatumets form prövas", /\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(start\)/.test(ut));
ok("utköpet prövas (tomt, noll, negativt)", /Utköpsbeloppet/.test(ut));
const at = rutt.slice(rutt.indexOf('case "ateruppta":'), rutt.indexOf('case "inkio-igen":'));
ok("ateruppta: säljaren ångrar sitt eget utfall (farAngraUtfall via bevakaIgen), chefen som förut", /farAngraUtfall\(|bevakaIgen\(/.test(at) && /aterupptaBevakning\(/.test(at));
ok("skapa och utkast går genom medNyckel", /case "skapa":[\s\S]{0,200}?return medNyckel\(/.test(rutt) && /case "utkast":\s*return medNyckel\(request, mig, \(\) => sparaUtkast\(/.test(rutt));

// ---------------------------------------------------------------------------
// S10b: D10, D23 och de mindre fynden
// ---------------------------------------------------------------------------
rubrik("Rättelse av en godkänd paketorder: det frysta priset gäller (D10, S10b)");
const rp = (falt, o) => (typeof R.rattelsePris === "function" ? R.rattelsePris(fd(falt), o) : { fel: "rattelsePris saknas" });
const fr = { sammaPaket: true, fryst: 1495, frystRabatt: null };
{
  const a = rp({ pris_ritad: "1", monthly_amount: "1495" }, { ...fr, listpris: 1395 });
  ok("listpriset sänkt sedan godkännandet: rättelsen nekas inte", !("fel" in a), JSON.stringify(a));
  ok("listpriset sänkt: det frysta priset gäller", a.fryst === 1495 && a.rabatt === null, JSON.stringify(a));
  const b = rp({ pris_ritad: "1", monthly_amount: "1495" }, { ...fr, listpris: 1595 });
  ok("listpriset höjt: ingen tyst rabatt", !("fel" in b) && b.rabatt === null && b.fryst === 1495, JSON.stringify(b));
  const c = rp({ pris_ritad: "1", monthly_amount: "1295" }, { sammaPaket: true, fryst: 1295, frystRabatt: 1295, listpris: 1395 });
  ok("en fryst rabatt står kvar som den var", !("fel" in c) && c.fryst === 1295 && c.rabatt === 1295, JSON.stringify(c));
  const d = rp({ monthly_amount: "" }, { ...fr, listpris: 1395 });
  ok("utan prismarkör (/order): det frysta priset gäller", !("fel" in d) && d.fryst === 1495 && d.rabatt === null, JSON.stringify(d));
  const e = rp({ pris_ritad: "1", monthly_amount: "" }, { ...fr, listpris: 1395 });
  ok("tomt prisfält: orört, det frysta priset gäller", !("fel" in e) && e.fryst === 1495, JSON.stringify(e));
  const f = rp({ pris_ritad: "1", monthly_amount: "1200" }, { ...fr, listpris: 1395 });
  ok("ett ändrat pris under dagens listpris: en ny rabatt", !("fel" in f) && f.fryst === null && f.rabatt === 1200, JSON.stringify(f));
  const g = rp({ pris_ritad: "1", monthly_amount: "1500" }, { ...fr, listpris: 1395 });
  ok("ett ändrat pris över dagens listpris: nej med besked", "fel" in g);
  const h = rp({ pris_ritad: "1", monthly_amount: "1995" }, { sammaPaket: false, fryst: 1495, frystRabatt: null, listpris: 1995 });
  ok("annat paket: dagens listpris, inget fryst", !("fel" in h) && h.fryst === null && h.rabatt === null, JSON.stringify(h));
  const i = rp({ pris_ritad: "1", monthly_amount: "1 495" }, { ...fr, listpris: 1395 });
  ok("samma pris med mellanslag är samma pris", !("fel" in i) && i.fryst === 1495, JSON.stringify(i));
}
const frystLagre = await berakna(SALJ, { fryst: 1395 });
ok("raknaFramProvision: ett fryst pris under listpriset räknas som det är", frystLagre.klar && frystLagre.satt.order_value === 33480 && frystLagre.satt.monthly_amount === 1395, String(frystLagre.satt?.order_value ?? frystLagre.fel));
const frystHogre = await berakna(SALJ, { fryst: 1595 });
ok("raknaFramProvision: ett fryst pris över dagens listpris räknas som det är", frystHogre.klar && frystHogre.satt.order_value === 38280 && frystHogre.satt.monthly_amount === 1595, String(frystHogre.satt?.order_value ?? frystHogre.fel));
ok("raknaFramProvision: det frysta priset rör inte matrisen", frystHogre.satt?.commission_amount === lista.satt.commission_amount && frystHogre.satt?.commission_source === "matrix" && frystHogre.satt?.order_value_source === "package");
const red = act.slice(act.indexOf("export async function redigeraOrder("), act.indexOf("export async function returneraOrder("));
ok("redigeraOrder prövar priset med rattelsePris", /rattelsePris\(form,/.test(red));
ok("redigeraOrder skickar det frysta priset till raknaFramProvision", /raknaFramProvision\([\s\S]{0,400}?\bfryst\b/.test(red));

rubrik("Rättelse av en paketorder med handsatt provision (D10, S10b)");
{
  const rv = (falt, o) => (typeof R.rattelseProvision === "function" ? R.rattelseProvision(fd(falt), o) : fd(falt));
  const a = rv({ package_id: "2" }, { commission_source: "manual", commission_amount: 5000 });
  ok("handsatt på ordern, inget val i formuläret: beloppet följer med", a.get("provision_form") === "belopp" && a.get("commission_amount") === "5000");
  const b = rv({ package_id: "2" }, { commission_source: "matrix", commission_amount: 2400 });
  ok("matrisen på ordern: formuläret orört", !b.has("provision_form"));
  const c = rv({ provision_form: "procent", commission_percent: "10" }, { commission_source: "manual", commission_amount: 5000 });
  ok("formuläret har ett eget val: det gäller", c.get("provision_form") === "procent" && c.get("commission_percent") === "10");
  const d = rv({ provision_form: "" }, { commission_source: "manual", commission_amount: "5000.00" });
  ok("tomt val i formuläret: beloppet följer med", d.get("provision_form") === "belopp" && d.get("commission_amount") === "5000");
  const handsatt = await raknaFramProvision(2, 24, "2026-10-20", SALJ, a, null, { manadsbelopp: null, tjanster: [], finans: false, fryst: 1495 });
  ok("raknaFramProvision: den handsatta provisionen räknas inte om på matrisen", handsatt.klar && handsatt.satt.commission_amount === 5000 && handsatt.satt.commission_source === "manual", JSON.stringify(handsatt.satt ?? handsatt.fel));
  ok("redigeraOrder lägger tillbaka orderns handsatta provision", /rattelseProvision\(form,/.test(red) && /commission_source/.test(red));
}

rubrik("Ta bort en orderbilaga (D23, S10b)");
{
  const nej = (a) => (typeof R.bilagaBortNej === "function" ? R.bilagaBortNej({ orderId: "o1", status: "inskickad", egen: true, hanterare: false, fil: { sales_order_id: "o1", purpose: "sales_order", removed_at: null }, ...a }) : "saknas");
  ok("säljaren tar bort en fil på sin inskickade order", nej({}) === null, String(nej({})));
  ok("en fil på en annan order: nej", typeof nej({ fil: { sales_order_id: "o2", purpose: "sales_order", removed_at: null } }) === "string");
  ok("en inspelning på ordern: nej (bara orderbilagor)", typeof nej({ fil: { sales_order_id: "o1", purpose: "call_recording", removed_at: null } }) === "string");
  ok("en fil som inte finns: nej", typeof nej({ fil: null }) === "string");
  ok("redan borttagen: nej", typeof nej({ fil: { sales_order_id: "o1", purpose: "sales_order", removed_at: "2026-10-23T10:00:00Z" } }) === "string");
  ok("säljaren på en godkänd order: nej", typeof nej({ status: "signerad" }) === "string");
  ok("säljchefen på en godkänd order: ja", nej({ status: "signerad", egen: false, hanterare: true }) === null);
  ok("någon annans order: nej", typeof nej({ egen: false }) === "string");
  ok("en makulerad order behåller sina filer", typeof nej({ status: "makulerad", hanterare: true }) === "string");
  const tb = act.slice(act.indexOf("export async function taBortOrderbilaga("), act.indexOf("export async function lasAvtalsforslag("));
  ok("taBortOrderbilaga prövar filen och ordern före borttagningen", tb.indexOf("bilagaBortNej(") > 0 && tb.indexOf("bilagaBortNej(") < tb.indexOf("taBortInnehall("));
}

rubrik("Bevaka igen efter tio minuter (D23, S10b)");
{
  const bi = (o, mig, hanterare) => (typeof R.bevakaIgen === "function" ? R.bevakaIgen(o, mig, hanterare, nu) : { fel: "saknas", status: 500 });
  const gammalt = { ...utfall, renewal_at: "2026-10-23T10:00:00Z" };
  ok("säljchefen: ett gammalt utfall bevakas igen", bi(gammalt, "chef", true) === "hanterare");
  ok("säljaren inom tio minuter: sitt eget", bi(utfall, "me", false) === "egen");
  ok("säljaren efter tio minuter: 403", bi(gammalt, "me", false)?.status === 403);
  ok("någon annans order: 404", bi(gammalt, "annan", false)?.status === 404);
  ok("ett förlängt avtal: nej", bi({ ...gammalt, renewal_outcome: "forlangd" }, "chef", true)?.status === 400);
  ok("ett avtal som redan bevakas: nej", bi({ ...gammalt, renewal_outcome: null }, "chef", true)?.status === 400);
  const at2 = rutt.slice(rutt.indexOf('case "ateruppta":'), rutt.indexOf('case "inkio-igen":'));
  ok("rutten avgör med bevakaIgen", /bevakaIgen\(/.test(at2));
}

rubrik("Rabattraden var den än står (S08, mindre)");
ok("en rabattrad som inte står först dubbleras inte", R.rabattAnteckning("Ring före 10. Rabatt 200 kr/mån: Kampanj.", 1495, 1295, "") === "Rabatt 200 kr/mån: Kampanj. Ring före 10.", String(R.rabattAnteckning("Ring före 10. Rabatt 200 kr/mån: Kampanj.", 1495, 1295, "")));
ok("en rabattrad mitt i tas bort vid listpris", R.rabattAnteckning("Ring före 10. Rabatt 200 kr/mån: Kampanj. Mejla avtalet.", 1495, null, "") === "Ring före 10. Mejla avtalet.");
ok("ett skäl med punkt i behålls helt", R.rabattAnteckning("Rabatt 200 kr/mån: Kampanj v.42. Ring före 10.", 1495, 1295, "") === "Rabatt 200 kr/mån: Kampanj v.42. Ring före 10.");

// S10b omgång 2 (granskarens fynd)
rubrik("Granskarens fynd (S10b omgång 2)");
{
  const rv = (falt, o) => R.rattelseProvision(fd(falt), { proposed_commission_percent: null, ...o });
  const a = rv({ provision_form: "belopp", commission_amount: "4000" }, { commission_source: "manager", commission_amount: 4000 });
  ok("V1: chefens egen fria order, oförändrat belopp: inget handsatt (40 % räknas om)", !a.has("provision_form") && !a.has("commission_amount"));
  const b = rv({ provision_form: "belopp", commission_amount: "4500" }, { commission_source: "manager", commission_amount: 4000 });
  ok("V1: ett ändrat belopp är ett beslut och gäller", b.get("provision_form") === "belopp" && b.get("commission_amount") === "4500");
  const c = rv({ provision_form: "procent", commission_percent: "40" }, { commission_source: "manager", commission_amount: 4000, proposed_commission_percent: 40 });
  ok("V1: den angivna procenten oförändrad: inget handsatt", !c.has("provision_form"));
  const d = rv({ provision_form: "belopp", commission_amount: "3000" }, { commission_source: "manual", commission_amount: 3000 });
  ok("V1: en handsatt provision står kvar handsatt", d.get("provision_form") === "belopp" && d.get("commission_amount") === "3000");
  const e = rv({ provision_form: "belopp", commission_amount: "2 000" }, { commission_source: "buyout", commission_amount: 2000 });
  ok("V1: utköpets provision oförändrad: räknas om på utköpssatsen", !e.has("provision_form"));
  const f = R.rattelsePris(fd({ pris_ritad: "1", monthly_amount: "1495" }), { sammaPaket: true, fryst: 1495, frystRabatt: 1295, listpris: 1495 });
  ok("M3: en inaktuell rabatt följer inte med det frysta priset", f.fryst === 1495 && f.rabatt === null, JSON.stringify(f));
  ok("M6: dubbla mellanslag i resten av anteckningen rörs inte", R.rabattAnteckning("Ring  före 10.", 1495, null, "") === "Ring  före 10.");
  ok("M6: borttagen rad mitt i lämnar ett mellanslag", R.rabattAnteckning("Ring före 10. Rabatt 200 kr/mån: K. Mejla.", 1495, null, "") === "Ring före 10. Mejla.");
  ok("M1: redigeraOrder skriver rabattraden vid ett nytt pris", /rabattAnteckning\(/.test(red) && /rabatt_skal/.test(red));
  ok("M1: rutten släpper igenom rabatt_skal för en godkänd order", /rattaGodkand: \[[^\]]*"rabatt_skal"/.test(rutt));
  ok("V1: redigeraOrder skickar den angivna procenten till rattelseProvision", /proposed_commission_percent/.test(red));
}

console.log(fel ? `\n\x1b[31m${fel} prov föll.\x1b[0m` : "\n\x1b[32mAlla prov gick igenom.\x1b[0m");
process.exit(fel ? 1 : 0);
