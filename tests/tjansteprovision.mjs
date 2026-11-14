#!/usr/bin/env node
/**
 * Provision på en orders tilläggstjänster (0293) och säljarens del av affären.
 *
 * Beställaren 2026-11-13:
 *   - en tjänst får provision i kronor eller procent, satt av säljchef, VD
 *     eller ekonomi, och godkännandet kräver ett val per tjänst (0 kr går);
 *   - finans ger 12 % av det som blir kvar i stället för matrisen, som utköp.
 *
 * Fallet bakom: Jämtlandsstäd #40, Paket 3 i tolv månader med en hemsida
 * (7 995 kr engång) och SEO (1 995 kr/mån). Matrisen gav 3 500 kr för paketet
 * och ingenting för tjänsterna, medan övertäcket räknades på hela 55 875 kr.
 *
 *   node --experimental-strip-types tests/tjansteprovision.mjs
 */
import {
  behallBindning,
  behallProvision,
  forStorProvision,
  forStorText,
  kronorPaRaden,
  valPaRaden,
  paraIhop,
  provisionUrRad,
  saknasText,
  tjanstensProvision,
  tjanstRad,
  uppraknat,
  utanProvision,
  valtext,
  valUrFormular,
} from "../src/lib/tjansteprovision.ts";
import { nettoregelFor, nettoregeltext, saljarensProvision } from "../src/lib/saljarprovision.ts";
import { affarenFor } from "../src/lib/chefsprovision.ts";
import { affarensVarde, storreIOren } from "../src/lib/order.ts";
import { avrunda } from "../src/lib/provision-motor.ts";
import { finansavgift, nettoEfterFinans } from "../src/lib/finans.ts";
import { nettoEfterUtkop } from "../src/lib/utkop.ts";

let fel = 0;
let antal = 0;
const ok = (namn, villkor, extra = "") => {
  antal++;
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${!villkor && extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const lika = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Jämtlandsstäd #40, så som ordern står i produktionen.
const HEMSIDA = { name: "Bygga/Updatera hemsida", billing: "engang", amount: 7995, follows_order: false, term_months: null, starts_on: null };
const SEO = { name: "SEO Löpande", billing: "manad", amount: 1995, follows_order: true, term_months: null, starts_on: null };
const EGEN = { name: "Annonsering", billing: "manad", amount: 1000, follows_order: false, term_months: 6, starts_on: "2026-12-01" };

// ---------------------------------------------------------------------------
rubrik("Tjänstens provision i kronor");
ok("inget val: null, aldrig noll", tjanstensProvision(HEMSIDA, 12) === null);
ok("valet null: null", tjanstensProvision({ ...HEMSIDA, provision: null }, 12) === null);
ok("fast belopp: beloppet", tjanstensProvision({ ...HEMSIDA, provision: { form: "belopp", varde: 800 } }, 12) === 800);
ok("0 kr är ett val som ger noll", tjanstensProvision({ ...HEMSIDA, provision: { form: "belopp", varde: 0 } }, 12) === 0);
ok("10 % på en engångsavgift: på beloppet (7 995 → 800)", tjanstensProvision({ ...HEMSIDA, provision: { form: "procent", varde: 10 } }, 12) === 800);
ok(
  "10 % på en månadstjänst: på månader × belopp (1 995 × 12 → 2 394), inte på en månad",
  tjanstensProvision({ ...SEO, provision: { form: "procent", varde: 10 } }, 12) === 2394,
);
ok("en månadstjänst som följer ordern räknar på orderns löptid (24 mån → 4 788)", tjanstensProvision({ ...SEO, provision: { form: "procent", varde: 10 } }, 24) === 4788);
ok("en månadstjänst med egen bindning räknar på sin egen (6 × 1 000 × 10 % = 600)", tjanstensProvision({ ...EGEN, provision: { form: "procent", varde: 10 } }, 36) === 600);
ok("avrundas till hela kronor (12,5 % av 7 995 = 999,375 → 999)", tjanstensProvision({ ...HEMSIDA, provision: { form: "procent", varde: 12.5 } }, 12) === 999);
ok("halvor bort från noll (5 % av 7 990 = 399,5 → 400)", tjanstensProvision({ ...HEMSIDA, amount: 7990, provision: { form: "procent", varde: 5 } }, 12) === 400);
ok("ett belopp med ören avrundas (799,50 → 800)", tjanstensProvision({ ...HEMSIDA, provision: { form: "belopp", varde: 799.5 } }, 12) === 800);

// ---------------------------------------------------------------------------
rubrik("Valet ur formulärets JSON");
ok("tomt: inget val", provisionUrRad({}, "X") === null);
ok("bara formen: inget val", provisionUrRad({ provision_form: "belopp" }, "X") === null);
ok("bara talet: inget val", provisionUrRad({ provision: "800" }, "X") === null);
ok("tomt tal: inget val", provisionUrRad({ provision_form: "procent", provision: "" }, "X") === null);
ok("kronor som text", lika(provisionUrRad({ provision_form: "belopp", provision: "1 200" }, "X"), { form: "belopp", varde: 1200 }));
ok("kronor som tal", lika(provisionUrRad({ provision_form: "belopp", provision: 800 }, "X"), { form: "belopp", varde: 800 }));
ok("procent med decimalkomma", lika(provisionUrRad({ provision_form: "procent", provision: "12,5" }, "X"), { form: "procent", varde: 12.5 }));
ok("procent med procenttecken", lika(provisionUrRad({ provision_form: "procent", provision: "10%" }, "X"), { form: "procent", varde: 10 }));
ok("0 kr är ett val", lika(provisionUrRad({ provision_form: "belopp", provision: "0" }, "X"), { form: "belopp", varde: 0 }));
ok("0 som tal är ett val", lika(provisionUrRad({ provision_form: "belopp", provision: 0 }, "X"), { form: "belopp", varde: 0 }));
ok("negativt: nej med namnet", provisionUrRad({ provision_form: "belopp", provision: "-5" }, "SEO")?.fel?.includes("SEO"));
ok("över 100 %: nej", "fel" in (provisionUrRad({ provision_form: "procent", provision: "120" }, "X") ?? {}));
ok("100 % går", lika(provisionUrRad({ provision_form: "procent", provision: "100" }, "X"), { form: "procent", varde: 100 }));
ok("över 100 i kronor går", lika(provisionUrRad({ provision_form: "belopp", provision: "120" }, "X"), { form: "belopp", varde: 120 }));
ok("okänd form: nej", "fel" in (provisionUrRad({ provision_form: "andel", provision: "5" }, "X") ?? {}));
ok("går inte att tolka: nej", "fel" in (provisionUrRad({ provision_form: "belopp", provision: "tio" }, "X") ?? {}));
ok("NaN som tal: nej", "fel" in (provisionUrRad({ provision_form: "belopp", provision: Number.NaN }, "X") ?? {}));

// ---------------------------------------------------------------------------
rubrik("Spärren och beskedet");
ok("utan val: namnen i ordning", lika(utanProvision([HEMSIDA, SEO]), ["Bygga/Updatera hemsida", "SEO Löpande"]));
ok("0 kr räknas som valt", lika(utanProvision([{ ...HEMSIDA, provision: { form: "belopp", varde: 0 } }, SEO]), ["SEO Löpande"]));
ok("alla valda: tom", utanProvision([{ ...HEMSIDA, provision: { form: "belopp", varde: 0 } }]).length === 0);
ok("uppräkningen: en", uppraknat(["A"]) === "A");
ok("uppräkningen: två", uppraknat(["A", "B"]) === "A och B");
ok("uppräkningen: tre", uppraknat(["A", "B", "C"]) === "A, B och C");
ok("beskedet nämner båda tjänsterna", saknasText(["Hemsida", "SEO"]).includes("Hemsida och SEO"));
ok("beskedet säger att 0 kr går", saknasText(["Hemsida"]).includes("0 kr"));
ok("valtext kronor", valtext({ form: "belopp", varde: 1200 }) === `${(1200).toLocaleString("sv-SE")} kr`);
ok("valtext procent", valtext({ form: "procent", varde: 12.5 }) === `${(12.5).toLocaleString("sv-SE")} %`);

// ---------------------------------------------------------------------------
rubrik("Rättelser tappar inga val");
const satt = { ...SEO, provision: { form: "procent", varde: 10 } };
ok("säljarens omskrivning behåller valet på samma tjänst", lika(behallProvision([SEO], [satt])[0].provision, { form: "procent", varde: 10 }));
ok("namnet jämförs utan skiftläge och kantblanksteg", lika(behallProvision([{ ...SEO, name: " seo löpande " }], [satt])[0].provision, { form: "procent", varde: 10 }));
ok("ett ändrat belopp tappar valet (hanteraren gör om det)", behallProvision([{ ...SEO, amount: 2495 }], [satt])[0].provision === null);
ok("en ändrad typ tappar valet", behallProvision([{ ...SEO, billing: "engang" }], [satt])[0].provision === null);
ok("ett val i det nya går före det gamla", lika(behallProvision([{ ...SEO, provision: { form: "belopp", varde: 5 } }], [satt])[0].provision, { form: "belopp", varde: 5 }));
const db = [{ ...HEMSIDA, id: "h" }, { ...SEO, id: "s", provision: { form: "belopp", varde: 300 } }];
const fran = valUrFormular(db, [{ ...HEMSIDA, provision: { form: "belopp", varde: 800 } }, SEO]);
ok("rättelsen av en godkänd order: formulärets val läggs på databasens rad", lika(fran[0].provision, { form: "belopp", varde: 800 }) && fran[0].id === "h");
ok("en rad utan val i formuläret tar inte bort databasens val", lika(fran[1].provision, { form: "belopp", varde: 300 }));
ok("formuläret kan inte lägga till tjänster på en godkänd order", valUrFormular(db, [...db, EGEN]).length === 2);
const rad = tjanstRad("o1", { ...SEO, provision: { form: "procent", varde: 10 }, provision_kr: 2394 }, 1);
ok("raden till databasen bär valet och kronorna", rad.commission_form === "procent" && rad.commission_value === 10 && rad.commission_amount === 2394 && rad.sort === 1 && rad.order_id === "o1");
const rad0 = tjanstRad("o1", HEMSIDA, 0);
ok("utan val står de tre kolumnerna tomma (null, inte noll)", rad0.commission_form === null && rad0.commission_value === null && rad0.commission_amount === null);

// ---------------------------------------------------------------------------
rubrik("Två likadana tjänster delar aldrig ett val (granskningen 2026-11-13, I1)");
const EXTRA = { name: "Extra sida", billing: "engang", amount: 2000, follows_order: false, term_months: null, starts_on: null };
const dbx = [{ ...EXTRA, id: "a" }, { ...EXTRA, id: "b" }];
const v1 = valUrFormular(dbx, [{ ...EXTRA, provision: { form: "belopp", varde: 1000 } }, EXTRA]);
ok("1 000 kr på den första, tomt på den andra: bara den första får 1 000", v1[0].provision?.varde === 1000 && !v1[1].provision, JSON.stringify(v1.map((t) => t.provision)));
const v2 = valUrFormular(dbx, [{ ...EXTRA, provision: { form: "belopp", varde: 1000 } }, { ...EXTRA, provision: { form: "belopp", varde: 0 } }]);
ok("1 000 kr och 0 kr: var sitt", v2[0].provision?.varde === 1000 && v2[1].provision?.varde === 0, JSON.stringify(v2.map((t) => t.provision)));
const v3 = valUrFormular(dbx, [{ ...EXTRA, provision: { form: "belopp", varde: 1000 } }]);
ok("en annan lista: en tvetydig rad får inget val (spärren frågar i stället)", !v3[0].provision && !v3[1].provision, JSON.stringify(v3.map((t) => t.provision)));
const v4 = valUrFormular([...dbx, { ...SEO, id: "s" }], [{ ...SEO, provision: { form: "procent", varde: 10 } }]);
ok("... men en entydig rad i en annan lista får sitt val", v4[2].provision?.varde === 10 && !v4[0].provision && !v4[1].provision);
const b1 = behallProvision([EXTRA, EXTRA], [{ ...EXTRA, provision: { form: "belopp", varde: 1000 } }, EXTRA]);
ok("säljarens omskrivning av två likadana: valet stannar på sin rad", b1[0].provision?.varde === 1000 && !b1[1].provision, JSON.stringify(b1.map((t) => t.provision)));
const b2 = behallProvision([EXTRA, EXTRA, SEO], [{ ...EXTRA, provision: { form: "belopp", varde: 1000 } }, EXTRA]);
ok("... och när listan växt: inget val på de tvetydiga", !b2[0].provision && !b2[1].provision);
ok("paraIhop: samma lista i samma ordning parar på platsen", JSON.stringify(paraIhop([EXTRA, SEO], [EXTRA, SEO])) === "[0,1]");
ok("paraIhop: omkastad ordning parar entydiga på nyckeln", JSON.stringify(paraIhop([SEO, HEMSIDA], [HEMSIDA, SEO])) === "[1,0]");

rubrik("Egen bindningstid överlever Nav 2.0:s omskrivning (granskningen M5)");
const egenGammal = { ...EGEN, id: "e" };
const franNav2 = { ...EGEN, follows_order: true, term_months: null, starts_on: null };
const bb = behallBindning([franNav2, HEMSIDA], [egenGammal]);
ok("månadstjänsten behåller sex månader från 1 december", bb[0].follows_order === false && bb[0].term_months === 6 && bb[0].starts_on === "2026-12-01");
ok("en ny tjänst lämnas orörd", bb[1] === HEMSIDA);
ok("en som följde ordern förut följer den fortfarande", behallBindning([{ ...SEO }], [{ ...SEO }])[0].follows_order === true);
ok("en rad som själv bär egen bindning (gamla Nav) står kvar", behallBindning([{ ...EGEN, term_months: 3 }], [egenGammal])[0].term_months === 3);

// ---------------------------------------------------------------------------
rubrik("Säljarens del: grunderna i ordning");
const SALJ = "a0000000-0000-0000-0000-000000000001";
const SATSER = [
  { id: "r3-12", package_id: 3, term_months: 12, amount: 3500, valid_from: "2026-01-01", valid_to: null },
  { id: "r2-24", package_id: 2, term_months: 24, amount: 2400, valid_from: "2026-01-01", valid_to: null },
];
const NETTOSATS = { id: "u1", percent: 12, valid_from: "2026-01-01", valid_to: null };
const CHEFSSATS = { id: "m1", employee_id: "c1", override_percent: 10, own_sale_percent: 40, valid_from: "2026-01-01", valid_to: null };

/** Hela affären som `raknaFramProvision` räknar den, utan databas. */
function affar({ man = 1995, lop = 12, paket = 3, tjanster = [], utkop = null, finans = false, fri = false, chefen = false, handsatt = { procent: null, belopp: null }, nettosats = NETTOSATS } = {}) {
  const varde = affarensVarde(man, lop, tjanster);
  const avgift = finans ? finansavgift(varde, lop, 11) : null;
  const netto = nettoEfterFinans(nettoEfterUtkop(varde, utkop), avgift);
  const del = saljarensProvision({ paket, loptid: lop, signerad: "2026-11-04", netto, utkop, finans, friOrder: fri, chefenSaljer: chefen, handsatt, satser: SATSER, nettosats, tjanster });
  if (!del.klar) return { del, varde, avgift, netto };
  const a = affarenFor({ sats: CHEFSSATS, saljareId: chefen ? "c1" : SALJ, ordervarde: netto, saljarprovision: del.provision, saljarkalla: del.kalla, handsatt: handsatt.procent !== null || handsatt.belopp !== null });
  return { del, varde, avgift, netto, a };
}

const jamt0 = affar({ tjanster: [HEMSIDA, SEO] });
ok("Jämtlandsstäd: ordervärdet är 55 875 kr", jamt0.varde === 55875);
ok("Jämtlandsstäd utan val: godkännandet nekas med båda namnen", jamt0.del.klar && lika(jamt0.del.saknas, ["Bygga/Updatera hemsida", "SEO Löpande"]));
ok("Jämtlandsstäd utan val: matrisen står som grund (3 500)", jamt0.del.grund === 3500 && jamt0.del.kalla === "matrix" && jamt0.del.matrisrad?.id === "r3-12");

const jamt = affar({ tjanster: [{ ...HEMSIDA, provision: { form: "procent", varde: 10 } }, { ...SEO, provision: { form: "procent", varde: 10 } }] });
ok("10 % på båda: 3 500 + 800 + 2 394 = 6 694", jamt.del.provision === 6694 && jamt.del.tjansteprovision === 3194 && jamt.del.saknas.length === 0);
ok("kronorna står per tjänst", lika(jamt.del.tjanster.map((t) => t.provision_kr), [800, 2394]));
ok("källan är matrisen och matrisraden följer med", jamt.del.kalla === "matrix" && jamt.del.matrisrad?.id === "r3-12");
ok("övertäcket räknas på det som blir kvar efter HELA säljarprovisionen: 10 % av (55 875 − 6 694) = 4 918", jamt.a.overtack?.amount === 4918 && jamt.a.overtack?.base === 49181, JSON.stringify(jamt.a.overtack));
ok("säljaren får hela beloppet", jamt.a.provision === 6694 && jamt.a.kalla === "matrix");

const blandat = affar({ tjanster: [{ ...HEMSIDA, provision: { form: "belopp", varde: 1000 } }, { ...SEO, provision: { form: "belopp", varde: 0 } }] });
ok("kronor och 0 kr: 3 500 + 1 000 + 0 = 4 500, ingen spärr", blandat.del.provision === 4500 && blandat.del.saknas.length === 0);

const halv = affar({ tjanster: [{ ...HEMSIDA, provision: { form: "belopp", varde: 1000 } }, SEO] });
ok("en av två vald: spärren nämner bara den andra, beloppet räknar den valda", lika(halv.del.saknas, ["SEO Löpande"]) && halv.del.provision === 4500);

const utanTj = affar();
ok("utan tjänster: exakt matrisen, som förut", utanTj.del.provision === 3500 && utanTj.del.tjansteprovision === 0 && utanTj.del.saknas.length === 0);

// ---------------------------------------------------------------------------
rubrik("Finans: 12 % av det som blir kvar (beställaren 2026-11-13)");
const fin = affar({ man: 1495, lop: 24, paket: 2, finans: true });
// 1 495 × 24 = 35 880; avgift 22 % = 7 894 (7 893,6); kvar 27 986; 12 % = 3 358 (3 358,32)
ok("avgiften: 22 % av 35 880 = 7 894", fin.avgift === 7894);
ok("kvar: 27 986", fin.netto === 27986);
ok("säljaren får 12 % av det som blir kvar: 3 358, inte matrisens 2 400", fin.del.provision === 3358 && fin.a.provision === 3358, String(fin.del.provision));
ok("källan är nettosatsen och regeln är finans", fin.del.kalla === "buyout" && fin.del.nettoregel === "finans" && fin.del.procent === 12 && fin.del.matrisrad === null);
ok("övertäcket på det som blir kvar efter säljaren: 10 % av 24 628 = 2 463", fin.a.overtack?.amount === 2463);

const finTj = affar({ finans: true, tjanster: [HEMSIDA, SEO] });
ok("finans med tjänster: inget val krävs, tjänsterna ingår i det som blir kvar", finTj.del.klar && finTj.del.saknas.length === 0 && finTj.del.tjansteprovision === 0);
ok("finans med tjänster: 12 % av (55 875 − 11 % av 55 875)", finTj.del.provision === Math.round((55875 - Math.round(55875 * 0.11)) * 0.12));
ok("finans med tjänster: tjänsternas kronor står tomma", finTj.del.tjanster.every((t) => t.provision_kr === null));
const finTjVal = affar({ finans: true, tjanster: [{ ...HEMSIDA, provision: { form: "belopp", varde: 5000 } }, SEO] });
ok("ett tjänsteval på en finansaffär betalas inte ut ovanpå (samma krona två gånger)", finTjVal.del.provision === finTj.del.provision && finTjVal.del.tjansteprovision === 0);

const utk = affar({ man: 1495, lop: 36, paket: 2, utkop: 12240 });
ok("utköp som förut: 12 % av 41 580 = 4 990 (IE Cleaning #24)", utk.del.provision === 4990 && utk.del.nettoregel === "utkop");
const bada = affar({ man: 1495, lop: 24, paket: 2, utkop: 5000, finans: true });
ok("utköp och finans: 12 % av (35 880 − 5 000 − 7 894) = 2 758", bada.netto === 22986 && bada.del.provision === 2758 && bada.del.nettoregel === "utkop_finans");

const finUtanSats = affar({ finans: true, nettosats: null });
ok("finans utan nettosats: nej, aldrig matrisen i tysthet", !finUtanSats.del.klar && finUtanSats.del.fel.includes("finansaffärer"));
const utkUtanSats = affar({ utkop: 1000, nettosats: null });
ok("utköp utan sats: utköpets mening, ordagrant som förut", !utkUtanSats.del.klar && utkUtanSats.del.fel.startsWith("Ingen utköpssats gällde"));

// ---------------------------------------------------------------------------
rubrik("Godkännarens eget tal går före allt");
const handKr = affar({ finans: true, tjanster: [HEMSIDA], handsatt: { procent: null, belopp: 5000 } });
ok("handsatt belopp på en finansaffär: beloppet, och ingen spärr för tjänsten", handKr.del.provision === 5000 && handKr.del.kalla === "manual" && handKr.del.saknas.length === 0 && handKr.del.nettoregel === null);
const handPr = affar({ tjanster: [HEMSIDA, SEO], handsatt: { procent: 10, belopp: null } });
ok("handsatt procent: på nettot, tjänsterna ingår (10 % av 55 875 = 5 588)", handPr.del.provision === 5588 && handPr.del.saknas.length === 0);
const handNoll = affar({ tjanster: [HEMSIDA], handsatt: { procent: null, belopp: 0 } });
ok("utan provision (0 kr för hand): ingen spärr för tjänsterna", handNoll.del.provision === 0 && handNoll.del.saknas.length === 0);

// ---------------------------------------------------------------------------
rubrik("Chefens egen försäljning och fri order");
const chef = affar({ chefen: true, tjanster: [HEMSIDA, SEO] });
ok("chefens egen paketorder: ingen spärr, 40 % av hela 55 875 = 22 350", chef.del.saknas.length === 0 && chef.a.provision === 22350 && chef.a.kalla === "manager");
const chefFin = affar({ chefen: true, finans: true });
ok("chefens egen finansorder: 40 % av det som blir kvar, nettoregeln gäller inte", chefFin.a.kalla === "manager" && chefFin.a.provision === Math.round(chefFin.netto * 0.4));
const fri = affar({ fri: true, paket: 3 });
ok("fri order utan provision: nej", !fri.del.klar && fri.del.fel.includes("utanför paketreglerna"));
const friFin = affar({ fri: true, finans: true });
ok("fri order med finans utan eget tal: nettoregeln (som utköpet redan gjorde)", friFin.del.klar && friFin.del.kalla === "buyout");
const ingenMatris = affar({ paket: 1, lop: 12 });
ok("matrisrad saknas: nej med beskedet", !ingenMatris.del.klar && ingenMatris.del.fel.startsWith("Ingen provisionssats"));

// ---------------------------------------------------------------------------
rubrik("Nettoregeln i ord");
ok("ingen regel utan avdrag", nettoregelFor(null, false) === null);
ok("noll räknas inte som utköp (anroparen silar, men regeln tål null)", nettoregelFor(null, true) === "finans");
const kr = (n) => `${n} kr`;
ok("finans", nettoregeltext("finans", { procent: 12, netto: 27986, utkop: null, finans: 7894 }, kr) === "12 % av 27986 kr som blev kvar efter finans 7894 kr");
ok("utköp och finans", nettoregeltext("utkop_finans", { procent: 12, netto: 1, utkop: 2, finans: 3 }, kr).endsWith("utköp 2 kr och finans 3 kr"));
ok("ingen regel: tomt", nettoregeltext(null, { procent: 12, netto: 1, utkop: null, finans: null }, kr) === "");

// ---------------------------------------------------------------------------
// Hårdtestet 2026-11-13: 0293:s villkor släpper igenom 'NaN' och 'Infinity'
// (i Postgres är NaN >= 0 sant). Läses en sådan rad blir den inget val, så
// spärren stoppar i stället för att NaN hamnar i `commission_amount`.
rubrik("Raden ur databasen: bara ett giltigt val är ett val");
ok("belopp som PostgREST-sträng", lika(valPaRaden("belopp", "800.00"), { form: "belopp", varde: 800 }));
ok("procent som tal", lika(valPaRaden("procent", 12.5), { form: "procent", varde: 12.5 }));
ok("0 kr är ett val", lika(valPaRaden("belopp", "0"), { form: "belopp", varde: 0 }));
ok("100 % är ett val", lika(valPaRaden("procent", "100"), { form: "procent", varde: 100 }));
ok("NaN är inget val", valPaRaden("belopp", "NaN") === null);
ok("Infinity är inget val", valPaRaden("belopp", "Infinity") === null);
ok("-Infinity är inget val", valPaRaden("belopp", "-Infinity") === null);
ok("negativt är inget val", valPaRaden("belopp", "-1") === null);
ok("procent över 100 är inget val", valPaRaden("procent", "100.01") === null);
ok("form utan tal är inget val", valPaRaden("belopp", null) === null && valPaRaden("procent", "") === null);
ok("okänd form är inget val", valPaRaden("kronor", "5") === null && valPaRaden(null, "5") === null);
ok("frysta kronor som sträng", kronorPaRaden("2394.00") === 2394);
ok("inga frysta kronor: null", kronorPaRaden(null) === null && kronorPaRaden(undefined) === null);
ok("NaN-kronor: null, aldrig NaN", kronorPaRaden("NaN") === null && kronorPaRaden("Infinity") === null);
ok("0 kr frysta: 0", kronorPaRaden("0") === 0);

// ---------------------------------------------------------------------------
// Hårdtestet 2026-11-13, logiken: enheten i texten, taket för skrivfel, exakta
// halvor och ören.
rubrik("Enheten i texten måste stämma med valet");
ok("\"10%\" med kronor valt: fel, inte 10 kr", "fel" in (provisionUrRad({ provision_form: "belopp", provision: "10%" }, "SEO") ?? {}));
ok("\"10 kr\" med procent valt: fel, inte 10 %", "fel" in (provisionUrRad({ provision_form: "procent", provision: "10 kr" }, "SEO") ?? {}));
ok("\"12 %\" med procent valt: 12 %", lika(provisionUrRad({ provision_form: "procent", provision: "12 %" }, "SEO"), { form: "procent", varde: 12 }));
ok("\"1 200 kr\" med kronor valt: 1 200 kr", lika(provisionUrRad({ provision_form: "belopp", provision: "1 200 kr" }, "SEO"), { form: "belopp", varde: 1200 }));
ok("\"10kr%\" med procent valt: fel, inte 10 % (granskningen 2026-11-14)", "fel" in (provisionUrRad({ provision_form: "procent", provision: "10kr%" }, "SEO") ?? {}));
ok("\"1%0\" med kronor valt: fel", "fel" in (provisionUrRad({ provision_form: "belopp", provision: "1%0" }, "SEO") ?? {}));
ok("\"10 KR\" med procent valt: fel", "fel" in (provisionUrRad({ provision_form: "procent", provision: "10 KR" }, "SEO") ?? {}));

rubrik("Taket: ett fast belopp kan inte vara mer än tjänsten är värd");
const HEMB = (kr) => ({ ...HEMSIDA, provision: { form: "belopp", varde: kr } });
ok("7 995 kr på en hemsida för 7 995 kr går", forStorProvision([HEMB(7995)], 12) === null);
ok("7 995,01 kr går inte", forStorProvision([HEMB(7995.01)], 12)?.namn === HEMSIDA.name);
ok("80 000 kr på 7 995 kr går inte", forStorProvision([HEMB(80000)], 12)?.varde === 7995);
ok("månadstjänst: värdet är månader × belopp (1 995 × 12 = 23 940)", forStorProvision([{ ...SEO, provision: { form: "belopp", varde: 23940 } }], 12) === null && forStorProvision([{ ...SEO, provision: { form: "belopp", varde: 23941 } }], 12) !== null);
ok("egen bindningstid: 1 000 × 6 = 6 000", forStorProvision([{ ...EGEN, provision: { form: "belopp", varde: 6001 } }], 24) !== null);
ok("100 % är aldrig över taket", forStorProvision([{ ...HEMSIDA, provision: { form: "procent", varde: 100 } }], 12) === null);
ok("beskedet namnger tjänsten och båda beloppen", /Bygga\/Updatera hemsida \(80\s000 kr\).*\(7\s995 kr\)/.test(forStorText({ namn: HEMSIDA.name, kr: 80000, varde: 7995 })));
{
  const x = affar({ tjanster: [HEMB(80000), { ...SEO, provision: { form: "belopp", varde: 0 } }] });
  ok("regeln nekar, i stället för att nolla övertäcket", !x.del.klar && /större än vad tjänsten är värd/.test(x.del.fel), JSON.stringify(x.del));
  ok("nekandet säger att felet sitter i tjänsternas provision (kortet visar rutan)", x.del.tjanstFel === true);
  ok("andra nekanden gör det inte (fri order utan provision)", affar({ fri: true, tjanster: [HEMB(80000)] }).del.tjanstFel === undefined);
  ok("finans: kronspärren prövas inte, tjänsterna ingår i de 12 procenten", affar({ finans: true, tjanster: [HEMB(80000)] }).del.klar === true);
}

rubrik("Formulärtolkningen nekar inte för dolda val (granskningen 2026-11-14)");
{
  const { tjansterUrFormular } = await import("../src/lib/orderregler.ts");
  const form = (extra) => { const f = new FormData(); f.set("term_months", "12"); for (const [k, v] of Object.entries(extra)) f.set(k, v); f.set("tjanster", JSON.stringify([{ name: HEMSIDA.name, billing: "engang", amount: 7995, follows_order: true, provision_form: "belopp", provision: "80000" }])); return f; };
  const fin = tjansterUrFormular(form({ finans_ritad: "1", finans: "on" }), { provision: true });
  ok("finansorder med ett dolt val på 80 000 kr sparas", !("fel" in fin) && fin.tjanster[0].provision?.varde === 80000, JSON.stringify(fin));
  const egen = tjansterUrFormular(form({}), { provision: true });
  ok("paketorder: tolkningen sparar, regeln nekar vid godkännandet", !("fel" in egen) && forStorProvision(egen.tjanster, 12) !== null, JSON.stringify(egen));
}

rubrik("Exakta halvor och ören: flyttalsbruset avgör ingenting");
ok("38,4999… (840 × 11 % × 5/12) blir 39", avrunda((840 * ((11 * 5) / 12)) / 100) === 39);
ok("250 × 64,6 % = 161,50 blir 162", avrunda((250 * 64.6) / 100) === 162);
ok("27 000 × 36,55 % = 9 868,50 blir 9 869", avrunda((27000 * 36.55) / 100) === 9869);
ok("-0,5 blir -1, bort från nollan", avrunda(-0.5) === -1 && avrunda(-1500.5) === -1501);
ok("38,49 blir 38 och 38,51 blir 39", avrunda(38.49) === 38 && avrunda(38.51) === 39);
ok("ordervärdet i hela ören (1 495 × 12 + 0,01 × 12 + 0,01)", affarensVarde(1495, 12, [
  { name: "A", billing: "manad", amount: 0.01, follows_order: true, term_months: null, starts_on: null },
  { name: "B", billing: "engang", amount: 0.01, follows_order: false, term_months: null, starts_on: null },
]) === 17940.13);
ok("utköp lika med värdet är inte större", !storreIOren(17940.13, 17940.129999999997) && storreIOren(17940.14, 17940.13));

// ---------------------------------------------------------------------------
rubrik("Hundra slumpade affärer: summan stämmer alltid");
let slump = 7;
const r = (n) => ((slump = (slump * 16807) % 2147483647) % n);
let fyll = 0;
for (let i = 0; i < 100; i++) {
  const tj = [HEMSIDA, SEO, EGEN].filter(() => r(2)).map((t) => (r(3) ? { ...t, provision: r(2) ? { form: "belopp", varde: r(3000) } : { form: "procent", varde: r(101) } } : t));
  const x = affar({ tjanster: tj, finans: r(4) === 0, utkop: r(5) === 0 ? 1 + r(4000) : null });
  if (!x.del.klar) continue;
  const summa = x.del.grund + x.del.tjanster.reduce((s, t) => s + (t.provision_kr ?? 0), 0);
  if (summa !== x.del.provision || x.del.provision < 0) fyll++;
  if (x.del.kalla !== "matrix" && x.del.tjansteprovision !== 0) fyll++;
  if (x.del.kalla === "matrix" && x.del.saknas.length !== tj.filter((t) => !t.provision).length) fyll++;
}
ok("grund + tjänster = provisionen, tjänster bara på matrisen, spärren exakt de utan val", fyll === 0, `${fyll} fel`);

console.log(`\n${fel === 0 ? "\x1b[32m" : "\x1b[31m"}${antal - fel} av ${antal} gröna\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
