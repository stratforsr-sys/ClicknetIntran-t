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

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m" : `\n\x1b[31m${fel} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
