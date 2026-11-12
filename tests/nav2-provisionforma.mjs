#!/usr/bin/env node
/**
 * Granskningen S06 (D5): månadens underlag i Nav 2.0 tar med alla med poster.
 *
 * Servern byggde månadens underlag av motorns personer, de aktiva säljarna och
 * den inloggade. En person som bara har poster i huvudboken kom aldrig med:
 * en säljare som slutat med en eftersläpande order, eller en icke-säljare med
 * en övrig bonus. Summan vid "Fastställ" blev då lägre än huvudbokens.
 *
 * Scenariot är agentens (rapporter/d-hjalp/jmf/provision-saknad-person.mjs):
 * oktober blir 6 300 kr på main, och 3 500 kr i Nav 2.0 före rättelsen.
 *
 *   TZ=UTC node --experimental-strip-types tests/nav2-provisionforma.mjs
 */
import { formaProvision } from "../src/lib/nav2/provisionforma.ts";
import { summera } from "../src/lib/provision.ts";
import { underlagForAlla } from "../src/lib/provision-motor.ts";
import { hallatSkal, rattelseForMote, vantandeFor } from "../src/lib/nav2/motesprovision.ts";
import { INST_FORVAL } from "../src/lib/nav2/motesflode.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const CHEF = "c0000000-0000-0000-0000-000000000001";
const AKTIV = "a0000000-0000-0000-0000-000000000001";
const SLUTAT = "a0000000-0000-0000-0000-000000000002";
const LEV = "d0000000-0000-0000-0000-000000000001";
const OKT = "2026-10-01";

const order = (id, saljare, signed, belopp) => ({
  id, salesperson_id: saljare, package_id: 2, term_months: 24, signed_on: signed, period_month: `${signed.slice(0, 7)}-01`,
  status: "signerad", is_addon: false, commission_amount: belopp, order_value: 35880, buyout_amount: null, finance_amount: null,
  cancel_period_month: null, company_name: "Bolag " + id, cancelled_on: null,
});
const post = (id, vem, belopp, kind, note, manad = OKT) => ({ id, employee_id: vem, period_month: manad, amount: belopp, deals: null, source: "manual", external_ref: null, kind, sales_order_id: null, note, entered_at: "2026-10-15T10:00:00Z" });
const personrader = [
  { id: CHEF, first_name: "Zen", last_name: "Chef", status: "active", employee_number: "1", roller: ["ceo", "sales_manager"] },
  { id: AKTIV, first_name: "Aktiv", last_name: "Säljare", status: "active", employee_number: "2", roller: ["salesperson"] },
  { id: SLUTAT, first_name: "Slutat", last_name: "Säljare", status: "offboarded", employee_number: "3", roller: ["salesperson"] },
  { id: LEV, first_name: "Leverans", last_name: "Person", status: "active", employee_number: "4", roller: ["delivery"] },
];
const material = [order("o1", AKTIV, "2026-10-05", 1500), order("o2", AKTIV, "2026-10-12", 1500)];
const poster = [
  post("p1", SLUTAT, 1800, null, "Eftersläpande order: Gamla AB, signerad 2026-08-28."),
  post("p2", LEV, 1000, "ovrig_bonus", "Hjälpte till med lanseringen."),
  post("p3", AKTIV, 500, "ovrig_bonus", "Månadens samtal."),
];
const indata = (over = {}) => ({
  mig: CHEF, provisionschef: true, malchef: true, bokforare: true, idag: OKT, idagsDatum: "2026-10-22",
  poster, material, nivaer: [], perioder: [], minaHandelser: [], regler: [], godkanda: [], kvPerManad: new Map(),
  mal: [], chefsposter: [], kvSamtal: [], policyer: [], kriterier: [], personrader, ...over,
});
const summaAv = (u) => Object.values(u).reduce((s, x) => s + x.summa, 0);

rubrik("Oktober i agentens scenario (chefen ser alla)");
{
  const ut = formaProvision(indata());
  const okt = ut.underlag["2026-10"];
  ok("säljaren som slutat finns i underlaget", Boolean(okt[SLUTAT]), Object.keys(okt).join(","));
  ok("leveranspersonen med en övrig bonus finns i underlaget", Boolean(okt[LEV]));
  ok("den eftersläpande ordern räknas hos den som slutat", okt[SLUTAT]?.summa === 1800, String(okt[SLUTAT]?.summa));
  ok("bonusen räknas hos leveranspersonen", okt[LEV]?.summa === 1000 && okt[LEV]?.ovrig === 1000);
  const total = summaAv(okt);
  ok("summan av summa över alla rader är 6 300 kr", total === 6300, `${total} kr`);
  const main = summera(poster, OKT).belopp + underlagForAlla(material, OKT, [], new Map(), new Map(), []).reduce((s, u) => s + u.summa, 0);
  ok("samma summa som main:s företagsvy", total === main, `main ${main} kr`);
  ok("båda har ett namn i personlistan", ut.personer.some((p) => p.id === SLUTAT) && ut.personer.some((p) => p.id === LEV));
  ok("ingen av dem räknas som säljare (listan börjar fortfarande med säljarna)", ut.personer.find((p) => p.id === SLUTAT)?.saljare === false && ut.personer.find((p) => p.id === LEV)?.saljare === false);
}

rubrik("Andra månader och andra läsare");
{
  const ut = formaProvision(indata());
  ok("september har ingen rad för leveranspersonen (inga poster där)", !ut.underlag["2026-09"][LEV]);
  const stangd = formaProvision(indata({ perioder: [{ period_month: OKT, status: "closed", closed_at: "2026-11-05T09:00:00Z", paid_at: null }] }));
  ok("en fastställd månad: huvudbokens summa, alla med", summaAv(stangd.underlag["2026-10"]) === 3300 && Boolean(stangd.underlag["2026-10"][SLUTAT]), String(summaAv(stangd.underlag["2026-10"])));
  const saljare = formaProvision(indata({ mig: AKTIV, provisionschef: false, malchef: false, bokforare: false }));
  ok("en säljare ser bara sig själv, inte andras poster", Object.keys(saljare.underlag["2026-10"]).join(",") === AKTIV);
}

// ---------------------------------------------------------------------------------------------------------
// Möten (uppgift 7): mötesprovisionen i Provision
// ---------------------------------------------------------------------------------------------------------
const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const M3 = "33333333-3333-4333-8333-333333333333";
const M4 = "44444444-4444-4444-8444-444444444444";
const M5 = "55555555-5555-4555-8555-555555555555";
const mpost = (id, vem, manad, belopp, niva = "kvalificerat", dag = "2026-10-11", bolag = "Ekholm Transport") => ({ mote_id: id, employee_id: vem, manad, belopp, niva, bolag, dag, delat_med_namn: null });
const mrad = (id, niva, belopp, mojligt, over = {}) => ({
  moteId: id, bolag: "Bolag " + id.slice(0, 1), dag: "2026-10-1" + id.slice(0, 1), saljare: "Sara Säljare", niva, belopp, mojligt, skal: niva ? null : "Avbokat",
  delatMed: null, manad: "2026-10-01", ifragasattNar: null, beslutNar: null, ...over,
});

rubrik("Mötesposterna går in i månadens underlag");
{
  const mp = [mpost(M1, AKTIV, "2026-10-01", 600), mpost(M2, AKTIV, "2026-10-01", 300, "hallet"), mpost(M3, AKTIV, "2026-11-01", 600)];
  const ut = formaProvision(indata({ motesposter: mp }));
  const okt = ut.underlag["2026-10"][AKTIV];
  ok("oktober: två mötesrader i den öppna månadens rader", okt.rader.filter((r) => r.slag === "motesprovision").length === 2);
  ok("summan är 3 000 (två order à 1 500) + 500 övrig bonus + 900 möten = 4 400", okt.summa === 4400, String(okt.summa));
  ok("sammanfattningen per person: 2 möten, 900 kr", okt.moten?.antal === 2 && okt.moten?.belopp === 900, JSON.stringify(okt.moten));
  ok("en annan månads möte räknas inte in", !ut.underlag["2026-10"][AKTIV].rader.some((r) => r.text.includes("2026-11")));
  ok("en person utan möten har ingen sammanfattning", ut.underlag["2026-10"][SLUTAT].moten === null);

  // Chefen ser bokaren i listan även när bokaren inte har en enda order eller post.
  const bara = formaProvision(indata({ motesposter: [mpost(M4, LEV, "2026-10-01", 600)] }));
  ok("den som bara har mötesposter finns i underlaget", bara.underlag["2026-10"][LEV]?.moten?.belopp === 600 && bara.underlag["2026-10"][LEV].summa === 1600, String(bara.underlag["2026-10"][LEV]?.summa));

  // En säljare ser bara sina egna.
  const mig = formaProvision(indata({ mig: AKTIV, provisionschef: false, malchef: false, bokforare: false, motesposter: [...mp, mpost(M4, LEV, "2026-10-01", 600)] }));
  ok("en icke-chef får bara sina egna mötesposter", mig.underlag["2026-10"][AKTIV].moten?.belopp === 900 && Object.keys(mig.underlag["2026-10"]).join(",") === AKTIV);

  // Fastställd månad: huvudboken är sanningen, motorn räknar inte om. Ingen dubbelräkning.
  const stangd = formaProvision(indata({
    motesposter: mp,
    perioder: [{ period_month: OKT, status: "faststalld", closed_at: "2026-11-05T09:00:00Z", paid_at: null }],
    poster: [...poster, { ...post("pm", AKTIV, 900, null, "Mötesprovision, 2 möten"), deals: 2, source: "motor", external_ref: `${OKT}:${AKTIV}:motesprovision` }],
  }));
  const s = stangd.underlag["2026-10"][AKTIV];
  ok("fastställd: bara den bokförda posten (900 + 500), inte motorn en gång till", s.summa === 1400, String(s.summa));
  ok("fastställd: raden i listan har etiketten Mötesprovision", s.rader.some((r) => r.text === "Mötesprovision" && r.belopp === 900));
  ok("fastställd: sammanfattningen är huvudbokens, 2 möten och 900 kr", s.moten?.antal === 2 && s.moten?.belopp === 900, JSON.stringify(s.moten));
  // Ett möte som ändrats efter fastställelsen: motorn ser det nya beloppet, men månaden står orörd.
  const andrad = formaProvision(indata({
    motesposter: [mpost(M1, AKTIV, "2026-10-01", 600), mpost(M2, AKTIV, "2026-10-01", 600, "kvalificerat")],
    perioder: [{ period_month: OKT, status: "faststalld", closed_at: "2026-11-05T09:00:00Z", paid_at: null }],
    poster: [...poster, { ...post("pm", AKTIV, 900, null, "Mötesprovision, 2 möten"), deals: 2, source: "motor", external_ref: `${OKT}:${AKTIV}:motesprovision` }],
  })).underlag["2026-10"][AKTIV];
  ok("fastställd: en ändrad rad räknas inte om (ingen dubbelräkning), summan står kvar", andrad.summa === 1400 && andrad.moten?.belopp === 900, `${andrad.summa} / ${andrad.moten?.belopp}`);
}

rubrik("Sektionen Mötesprovision i vyn");
{
  const rad = [mrad("1", "kvalificerat", 600, 600), mrad("2", "hallet", 300, 600, { skal: "Nej på: Var rätt beslutsfattare med?" }), mrad("3", null, 0, 600), mrad("4", null, 0, 600, { skal: "Inte bekräftat före mötet", manad: "2026-09-01" })]
    .map((r, i) => ({ ...r, moteId: [M1, M2, M3, M4][i] }));
  const med = (over = {}) => formaProvision(indata({ mig: AKTIV, provisionschef: false, malchef: false, bokforare: false, motesvy: { mottagare: true, rader: rad, vantar: [] }, ...over }));
  const n = med().moten;
  ok("tre tal för innevarande månad: 900 kr, 2 hållna, 1 kvalificerad, 1 tappat", n?.summa === 900 && n.hallna === 2 && n.kvalificerade === 1 && n.tappade === 1, JSON.stringify({ ...n, rader: undefined }));
  ok("en rad per möte (fyra)", n?.rader.length === 4);
  const r2 = n?.rader.find((r) => r.moteId === M2);
  ok("hållet-nivån kan ifrågasättas", r2?.kanIfragasatta === true && r2?.vantar === false);
  ok("kvalificerat kan inte ifrågasättas", n?.rader.find((r) => r.moteId === M1)?.kanIfragasatta === false);
  const r3 = n?.rader.find((r) => r.moteId === M3);
  ok("ett tappat möte bär möjligt belopp och skäl", r3?.niva === null && r3.mojligt === 600 && r3.belopp === 0 && r3.skal === "Avbokat");
  ok("raderna är nyast först", n?.rader.map((r) => r.dag).join() === [...(n?.rader.map((r) => r.dag) ?? [])].sort().reverse().join());

  const fragad = med({ motesvy: { mottagare: true, vantar: [], rader: [{ ...rad[1], moteId: M2, ifragasattNar: "2026-10-20T10:00:00Z" }] } }).moten;
  ok("redan ifrågasatt kan inte ifrågasättas igen", fragad?.rader[0].kanIfragasatta === false);
  const beslutad = med({ motesvy: { mottagare: true, vantar: [], rader: [{ ...rad[1], moteId: M2, beslutNar: "2026-10-21T10:00:00Z" }] } }).moten;
  ok("efter ett beslut kan det inte ifrågasättas", beslutad?.rader[0].kanIfragasatta === false);

  // Väntande: ur mote, inget belopp.
  const v = med({ motesvy: { mottagare: true, rader: [], vantar: [{ moteId: M5, bolag: "Nordvik", dag: "2026-10-30", saljare: "Jonas", manad: "2026-10-01" }] } }).moten;
  ok("väntande möte: en rad utan belopp", v?.rader.length === 1 && v.rader[0].vantar === true && v.rader[0].belopp === 0 && v.rader[0].niva === null);
  ok("och räknas inte i de tre talen", v?.summa === 0 && v.hallna === 0 && v.tappade === 0);

  // Null: inte mottagare och aldrig en rad.
  ok("null utan rader för den som inte är mottagare", med({ motesvy: { mottagare: false, rader: [], vantar: [] } }).moten === null);
  ok("null när ingen motesvy skickats alls", med({ motesvy: undefined }).moten === null);
  ok("inte mottagare men har haft en rad: sektionen visas", med({ motesvy: { mottagare: false, rader: [rad[0]], vantar: [] } }).moten?.rader.length === 1);
  ok("inte mottagare: väntande möten visas inte", med({ motesvy: { mottagare: false, rader: [rad[0]], vantar: [{ moteId: M5, bolag: "N", dag: "2026-10-30", saljare: "J", manad: "2026-10-01" }] } }).moten?.rader.length === 1);
  ok("rader utan något på spel tas inte med", med({ motesvy: { mottagare: true, rader: [mrad(M1, "kvalificerat", 0, 0)], vantar: [] } }).moten?.rader.length === 0);

  // rattadI: månaden en rättelse bokförts i, ur external_ref.
  const rpost = (vem, manad, ref) => ({ ...post("r" + manad + vem, vem, 300, "rattelse", "Rättelse möte", manad), source: "motor", external_ref: ref });
  const ra = med({ poster: [...poster, rpost(AKTIV, OKT, `${OKT}:${AKTIV}:rattelse:mote:${M2}:v2`), rpost(LEV, OKT, `${OKT}:${LEV}:rattelse:mote:${M1}:v2`)] }).moten;
  ok("rattadI = rättelsens månad för just det mötet", ra?.rader.find((r) => r.moteId === M2)?.rattadI === "2026-10", String(ra?.rader.find((r) => r.moteId === M2)?.rattadI));
  ok("en annan persons rättelse (annat möte) räknas inte", ra?.rader.find((r) => r.moteId === M1)?.rattadI === null);
  ok("rattelseForMote tolkar referensen", rattelseForMote(`2026-11-01:${AKTIV}:rattelse:mote:${M2}:v3`)?.moteId === M2 && rattelseForMote(`2026-11-01:${AKTIV}:rattelse:mote:${M2}:v3`)?.version === 3 && rattelseForMote("2026-11-01:x:motesprovision") === null && rattelseForMote(null) === null);
}

rubrik("Skälet till den lägre nivån");
{
  ok("frågorna som besvarats med nej, med sin text", hallatSkal([{ id: "a", text: "Var rätt beslutsfattare med?", ja: false }, { id: "b", text: "Visste kunden?", ja: true }]) === "Nej på: Var rätt beslutsfattare med?");
  ok("flera nej", hallatSkal([{ id: "a", text: "A?", ja: false }, { id: "b", text: "B?", ja: false }]) === "Nej på: A?, B?");
  ok("inget nej, inget skäl", hallatSkal([{ id: "a", text: "A?", ja: true }]) === null);
  ok("trasigt svar ger null, aldrig ett fel", hallatSkal(null) === null && hallatSkal("x") === null && hallatSkal([null, 3, {}]) === null);
}

rubrik("Väntar på bedömning: vem som får, ur kedjorna");
{
  const SARA = "s0000000-0000-0000-0000-00000000000a";
  const ANNA = "s0000000-0000-0000-0000-00000000000b";
  const NY = "s0000000-0000-0000-0000-00000000000c";
  const inst = { ...INST_FORVAL, mottagare: [ANNA, NY], gallerFran: "2026-11-01T00:00:00Z" };
  const karta = new Map([
    ["a1", { art: "forsta", foregaende: null, bokatAv: ANNA }],
    ["a2", { art: "ombokning", foregaende: "a1", bokatAv: SARA }],
    ["b1", { art: "forsta", foregaende: null, bokatAv: SARA }],
    ["c1", { art: "uppfoljning", foregaende: null, bokatAv: ANNA }],
    ["d1", { art: "forsta", foregaende: null, bokatAv: ANNA }],
    ["d2", { art: "ombokning", foregaende: "d1", bokatAv: NY }],
  ]);
  const mote = (id, bokatAv, over = {}) => ({ id, art: karta.get(id).art, foregaende: karta.get(id).foregaende, bokatAv, hallsAv: SARA, moteTid: "2026-11-05T10:00:00Z", bolag: "B" + id, dag: "2026-11-05", manad: "2026-11-01", saljare: "Sara", ...over });
  const kand = [mote("a2", SARA), mote("b1", SARA), mote("c1", ANNA), mote("d2", NY), mote("a1", ANNA, { moteTid: "2026-10-05T10:00:00Z" })];
  const anna = vantandeFor(ANNA, kand, karta, inst).map((x) => x.moteId).sort();
  ok("den ursprungliga bokaren väntar på ett möte som säljaren bokade om", anna.includes("a2"));
  ok("ett möte före moten.galler-fran visas aldrig", !anna.includes("a1"));
  ok("ett möte bokat av säljaren utan markering: ingen rad", !anna.includes("b1"));
  ok("ett uppföljningsmöte ger ingen rad", !anna.includes("c1"));
  ok("ny bokare tar hela (regel ny): den ursprungliga väntar inte", !anna.includes("d2"));
  ok("nya bokaren väntar på d2", vantandeFor(NY, kand, karta, inst).map((x) => x.moteId).join() === "d2");
  const dela = vantandeFor(ANNA, kand, karta, { ...inst, ombokning: "dela" }).map((x) => x.moteId);
  ok("vid delning väntar båda på d2", dela.includes("d2") && vantandeFor(NY, kand, karta, { ...inst, ombokning: "dela" }).some((x) => x.moteId === "d2"));
  ok("utan galler-fran omfattas inget", vantandeFor(ANNA, kand, karta, { ...inst, gallerFran: null }).length === 0);
  // Hållaren som också bokade får aldrig rad.
  const sjalv = vantandeFor(ANNA, [mote("a1", ANNA, { hallsAv: ANNA })], karta, inst);
  ok("den som både bokade och höll får ingen rad", sjalv.length === 0);
}

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m" : `\n\x1b[31m${fel} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
