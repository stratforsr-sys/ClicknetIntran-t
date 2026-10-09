#!/usr/bin/env node
/**
 * Finans pa affaren (0079). Bestallaren 2026-10-09:
 *
 *   *"var finanspartner tar 11% av ordervardet per ar, alltsa om det ar 12
 *   manader sa tar dem 11%, om det ar 24, 22% osv."*
 *
 * Fem saker star pa spel:
 *
 *   1. PROCENTEN AR PER AR. 12 man = 11 %, 24 = 22 %, 36 = 33 %, och en fri
 *      order pa 18 man = 16,5 % — proportionellt, inte avrundat till hela ar.
 *   2. BASEN AR BRUTTOT, fore utkopet. Bestallarens svar pa foljdfragan.
 *   3. AVGIFTEN DRAS FRAN NETTOT, efter utkopet, och nettot gar aldrig under
 *      noll. Chefens sats och overtacket raknas pa det som blir kvar.
 *   4. EN SAKNAD SATS BLIR NULL, ALDRIG NOLL. En nolla hade raknat en
 *      finansaffar som gratis.
 *   5. MANADENS ORDERVARDE drar av avgifterna och visar dem for sig, och en
 *      makulering tar tillbaka sin avgift.
 *
 *   node --experimental-strip-types tests/finans.mjs
 */
import {
  finansavgift,
  finansprocent,
  gallandeFinanssats,
  nettoEfterFinans,
  procenttext,
} from "../src/lib/finans.ts";
import { nettoEfterUtkop } from "../src/lib/utkop.ts";
import { affarenFor } from "../src/lib/chefsprovision.ts";
import { affarensVarde, ordervarde } from "../src/lib/order.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(
    `  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`,
  );
  if (!villkor) fel++;
};

const sats = (o = {}) => ({
  id: o.id ?? "finans-1",
  percent_per_year: o.procent ?? 11,
  valid_from: o.fran ?? "2026-01-01",
  valid_to: o.till ?? null,
});

const order = (o) => ({
  id: o.id ?? Math.random().toString(36).slice(2),
  salesperson_id: "vlado",
  package_id: 1,
  term_months: 12,
  signed_on: o.signerad ?? "2026-10-10",
  period_month: (o.signerad ?? "2026-10-10").slice(0, 7) + "-01",
  status: o.status ?? "signerad",
  is_addon: false,
  commission_amount: 1500,
  order_value: o.varde ?? 11940,
  buyout_amount: o.utkop ?? null,
  financed: o.finans != null,
  finance_amount: o.finans ?? null,
  cancel_period_month: o.makuleradManad ?? null,
});

// -----------------------------------------------------------------------------
console.log("\nProcenten per ar");
// -----------------------------------------------------------------------------
{
  ok("12 manader = 11 %", finansprocent(11, 12) === 11);
  ok("24 manader = 22 %", finansprocent(11, 24) === 22);
  ok("36 manader = 33 %", finansprocent(11, 36) === 33);
  ok("18 manader = 16,5 %, inte avrundat till hela ar", finansprocent(11, 18) === 16.5);
  ok("Texten ar svensk", procenttext(16.5) === "16,5 %", procenttext(16.5));
  ok("...och utan onodiga decimaler", procenttext(22) === "22 %", procenttext(22));
}

// -----------------------------------------------------------------------------
console.log("\nAvgiften i kronor");
// -----------------------------------------------------------------------------
{
  // Paket 1, 995 kr i manaden.
  ok("Paket 1, 12 man: 11 % av 11 940 = 1 313", finansavgift(11940, 12, 11) === 1313, `${finansavgift(11940, 12, 11)}`);
  ok("Paket 1, 24 man: 22 % av 23 880 = 5 254", finansavgift(23880, 24, 11) === 5254, `${finansavgift(23880, 24, 11)}`);
  ok("Paket 1, 36 man: 33 % av 35 820 = 11 821", finansavgift(35820, 36, 11) === 11821, `${finansavgift(35820, 36, 11)}`);
  ok("Hela kronor", Number.isInteger(finansavgift(12345, 7, 11)));

  // PROV 2. Tjansterna ar en del av ordervardet och darmed av basen.
  const medTjanst = affarensVarde(995, 12, [
    { name: "Installation", billing: "engang", amount: 4000, follows_order: false, term_months: null, starts_on: null },
  ]);
  ok("Tjansterna ingar i basen", finansavgift(medTjanst, 12, 11) === Math.round(15940 * 0.11), `${finansavgift(medTjanst, 12, 11)}`);
}

// -----------------------------------------------------------------------------
console.log("\nNettot");
// -----------------------------------------------------------------------------
{
  ok("Utan finans ar nettot orort", nettoEfterFinans(11940, null) === 11940);
  ok("En nolla ar ingen finans", nettoEfterFinans(11940, 0) === 11940);
  ok("Avgiften dras av", nettoEfterFinans(11940, 1313) === 10627);
  ok("Nettot gar aldrig under noll", nettoEfterFinans(1000, 5000) === 0);

  // PROV 2 OCH 3. Avgiften raknas pa BRUTTOT, och dras sedan fran nettot
  // efter utkopet: 20 000 brutto, 5 000 utkop, 11 % = 2 200, kvar 12 800.
  const avgift = finansavgift(20000, 12, 11);
  const netto = nettoEfterFinans(nettoEfterUtkop(20000, 5000), avgift);
  ok("Avgiften raknas pa bruttot, inte efter utkopet", avgift === 2200, `${avgift}`);
  ok("Bada avdragen dras", netto === 12800, `${netto}`);
}

// -----------------------------------------------------------------------------
console.log("\nSatsuppslaget");
// -----------------------------------------------------------------------------
{
  const satser = [
    sats({ id: "gammal", procent: 10, fran: "2026-01-01", till: "2027-01-01" }),
    sats({ id: "ny", procent: 12, fran: "2027-01-01" }),
  ];
  ok("Signeringsdatumet avgor", gallandeFinanssats(satser, "2026-10-09")?.id === "gammal");
  ok("valid_to ar exklusivt", gallandeFinanssats(satser, "2027-01-01")?.id === "ny");
  // PROV 4.
  ok("En saknad sats ar null, aldrig noll", gallandeFinanssats(satser, "2025-12-31") === null);
}

// -----------------------------------------------------------------------------
console.log("\nProvision och overtack");
// -----------------------------------------------------------------------------
{
  const chefssats = {
    id: "chef-1",
    employee_id: "zen",
    override_percent: 10,
    own_sale_percent: 40,
    valid_from: "2026-09-01",
    valid_to: null,
  };

  const netto = nettoEfterFinans(11940, finansavgift(11940, 12, 11)); // 10 627

  // MATRISEN ROR SIG INTE: saljaren far sina 1 500. Restposten krymper.
  const saljare = affarenFor({
    sats: chefssats,
    saljareId: "vlado",
    ordervarde: netto,
    saljarprovision: 1500,
    saljarkalla: "matrix",
  });
  ok("Matrisens belopp star kvar", saljare.provision === 1500);
  ok("Overtacket raknas pa det som ar kvar", saljare.overtack?.base === 9127, `${saljare.overtack?.base}`);
  ok("...10 % av 9 127 = 913", saljare.overtack?.amount === 913, `${saljare.overtack?.amount}`);

  // CHEFENS EGEN ORDER: 40 % av nettot, inte av bruttot.
  const egen = affarenFor({
    sats: chefssats,
    saljareId: "zen",
    ordervarde: netto,
    saljarprovision: 0,
    saljarkalla: "matrix",
  });
  ok("Chefens sats raknas pa nettot", egen.provision === Math.round(10627 * 0.4), `${egen.provision}`);
  ok("...och inget overtack", egen.overtack === null);
}

// -----------------------------------------------------------------------------
console.log("\nManadens ordervarde");
// -----------------------------------------------------------------------------
{
  // PROV 5.
  const rader = [
    order({ id: "a", varde: 11940 }),
    order({ id: "b", varde: 23880, finans: 5254 }),
    order({ id: "c", varde: 20000, utkop: 5000, finans: 2200 }),
  ];
  const v = ordervarde(rader, "2026-10-01");
  ok("Tecknat star kvar brutto", v.tecknat === 55820, `${v.tecknat}`);
  ok("Finansen summeras for sig", v.finans === 7454, `${v.finans}`);
  ok("Utkopen summeras for sig", v.utkop === 5000);
  ok("Nettot ar tecknat minus utkop minus finans", v.netto === 43366, `${v.netto}`);

  const utan = ordervarde([order({ id: "d", varde: 11940 })], "2026-10-01");
  ok("Utan finans ar allt som forut", utan.netto === 11940 && utan.finans === 0);

  const makulerad = [
    order({ id: "e", varde: 23880, finans: 5254 }),
    order({
      id: "f",
      varde: 23880,
      finans: 5254,
      signerad: "2026-09-10",
      status: "makulerad",
      makuleradManad: "2026-10-01",
    }),
  ];
  const m = ordervarde(makulerad, "2026-10-01");
  ok("Makuleringen tar tillbaka sin avgift", m.finans === 0, `${m.finans}`);
  ok("Nettot blir noll", m.netto === 0, `${m.netto}`);
}

console.log(
  fel === 0
    ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m\n"
    : `\n\x1b[31m${fel} prov misslyckades.\x1b[0m\n`,
);
process.exit(fel === 0 ? 0 : 1);
