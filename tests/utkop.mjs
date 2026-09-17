#!/usr/bin/env node
/**
 * Utkopet pa affaren (0060). Sex saker star pa spel:
 *
 *   1. NETTOT AR BASEN, INTE BRUTTOT. Bestallaren 2026-09-15: *"da ska det dras
 *      minus pa affaren och sen ska det raknas pa 12 % for saljaren i provision
 *      pa det som ar over efter utkopet"*. Raknas procenten pa bruttot far
 *      saljaren betalt for pengar som gick ut till kunden.
 *   2. NETTOT GAR ALDRIG UNDER NOLL. Ett utkop storre an affaren ar ett
 *      skrivfel, och ett negativt netto hade gett en NEGATIV provision — alltsa
 *      ett avdrag pa en affar saljaren tecknat.
 *   3. SATSEN SLAS UPP PA SIGNERINGSDATUMET. Andras satsen i november ska en
 *      order fran september fortfarande fa septembers sats.
 *   4. EN SAKNAD SATS BLIR NULL, ALDRIG NOLL. En nolla ser ut som "utkopsaffarer
 *      ger ingen provision" i stallet for "ingen sats ar satt".
 *   5. NOLL AR INTE ETT UTKOP. En nolla i faltet far inte byta provisionskalla
 *      fran matrisen till procentsatsen — da hade en vanlig paketorder tyst
 *      gatt fran 1 500 kr till 1 433 kr.
 *   6. OVERTACKET RAKNAS PA NETTOT. Bestallarens val samma dag: utkopspengarna
 *      ar utbetalda till kunden och ar inte bolagets marginal, sa saljchefen far
 *      inte procent pa dem heller.
 *
 * Plus en rakning pa manadsniva: `ordervarde()` ska dra av utkopen ur `netto`
 * men lata `tecknat` sta kvar brutto, sa att en manad gar att stamma av mot
 * bade avtalen och bokforingen.
 *
 *   node --experimental-strip-types tests/utkop.mjs
 */
import {
  gallandeUtkopssats,
  harUtkop,
  nettoEfterUtkop,
  utkopsprovision,
} from "../src/lib/utkop.ts";
import { affarenFor } from "../src/lib/chefsprovision.ts";
import { ordervarde, ordervardeFor } from "../src/lib/order.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(
    `  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`,
  );
  if (!villkor) fel++;
};

const sats = (o = {}) => ({
  id: o.id ?? "utkop-1",
  percent: o.procent ?? 12,
  valid_from: o.fran ?? "2026-09-01",
  valid_to: o.till ?? null,
});

const order = (o) => ({
  id: o.id ?? Math.random().toString(36).slice(2),
  salesperson_id: o.saljare ?? "vlado",
  package_id: 1,
  term_months: 12,
  signed_on: o.signerad ?? "2026-09-10",
  period_month: (o.signerad ?? "2026-09-10").slice(0, 7) + "-01",
  status: o.status ?? "signerad",
  is_addon: false,
  commission_amount: o.provision ?? 1500,
  order_value: o.varde ?? 11940,
  buyout_amount: o.utkop ?? null,
  cancel_period_month: o.makuleradManad ?? null,
});

// -----------------------------------------------------------------------------
console.log("\nNettot");
// -----------------------------------------------------------------------------
{
  ok("Utan utkop ar nettot bruttot", nettoEfterUtkop(11940, null) === 11940);
  ok("Utkopet dras av", nettoEfterUtkop(20000, 5000) === 15000);
  ok("Ett utkop lika stort som affaren ger noll", nettoEfterUtkop(11940, 11940) === 0);

  // PROV 2. Villkoret `sales_order_utkop_ryms` i 0060 nekar det har i databasen,
  // men en klient kan skicka egna tal och forhandsvisningen raknar pa dem.
  ok(
    "Ett utkop storre an affaren ger NOLL, aldrig ett minustal",
    nettoEfterUtkop(10000, 15000) === 0,
    `${nettoEfterUtkop(10000, 15000)}`,
  );

  // PROV 5. Den tysta varianten: en nolla som slapps igenom hade sett ut som ett
  // utkop och bytt provisionskalla utan att andra ett enda tal.
  ok("Noll ar inte ett utkop", harUtkop(0) === false);
  ok("null ar inte ett utkop", harUtkop(null) === false);
  ok("undefined ar inte ett utkop", harUtkop(undefined) === false);
  ok("NaN ar inte ett utkop", harUtkop(Number.NaN) === false);
  ok("Ett positivt tal ar ett utkop", harUtkop(5000) === true);
  ok("Nettot ror sig inte av en nolla", nettoEfterUtkop(11940, 0) === 11940);
}

// -----------------------------------------------------------------------------
console.log("\nSatsuppslaget");
// -----------------------------------------------------------------------------
{
  // PROV 3. Tva rader, den forsta stangd den 1 november.
  const satser = [
    sats({ id: "sep", procent: 12, fran: "2026-09-01", till: "2026-11-01" }),
    sats({ id: "nov", procent: 14, fran: "2026-11-01" }),
  ];

  ok("Septemberordern far septembersatsen", gallandeUtkopssats(satser, "2026-09-10")?.id === "sep");
  ok("Sista dagen fore bytet hor till den gamla", gallandeUtkopssats(satser, "2026-10-31")?.id === "sep");
  ok("valid_to ar EXKLUSIVT", gallandeUtkopssats(satser, "2026-11-01")?.id === "nov");
  ok("En order fore forsta satsen far ingen", gallandeUtkopssats(satser, "2026-08-31") === null);

  // PROV 4. Tom lista ger null, inte en sats med noll procent.
  ok("Ingen sats alls ger null", gallandeUtkopssats([], "2026-09-10") === null);

  // Tva overlappande stangda rader ar ett konfigurationsfel. Uppslaget faller
  // inte — nyast valid_from vinner — sa vyn far ett svar i stallet for ett kast.
  const krock = [
    sats({ id: "gammal", fran: "2026-09-01", till: "2026-12-01" }),
    sats({ id: "nyare", fran: "2026-10-01", till: "2026-12-01" }),
  ];
  ok("Vid krock vinner nyast valid_from", gallandeUtkopssats(krock, "2026-10-15")?.id === "nyare");
}

// -----------------------------------------------------------------------------
console.log("\nProvisionen");
// -----------------------------------------------------------------------------
{
  // PROV 1, bestallarens eget exempel i tal: 20 000 minus 5 000 ger 15 000, och
  // 12 % av det ar 1 800.
  const netto = nettoEfterUtkop(20000, 5000);
  ok("12 % av nettot", utkopsprovision(sats(), netto) === 1800, `${utkopsprovision(sats(), netto)}`);

  // Och kontrollen at andra hallet: pa BRUTTOT hade det blivit 2 400 kr, alltsa
  // 600 kr for mycket per affar. Det ar den skillnaden hela ovningen handlar om.
  ok("...och inte 12 % av bruttot", utkopsprovision(sats(), 20000) === 2400);

  // Avrundning sker EN gang, pa det fardiga beloppet.
  ok("Avrundas till hela kronor", utkopsprovision(sats(), 11941) === 1433, `${utkopsprovision(sats(), 11941)}`);

  // Ett paketvarde, sa att talet gar att kanna igen ur vyn.
  const paketnetto = nettoEfterUtkop(ordervardeFor(995, 12), 5000);
  ok("Paket 1 pa tolv man med 5 000 i utkop ger 6 940 kvar", paketnetto === 6940);
  ok("...och 833 kr i provision", utkopsprovision(sats(), paketnetto) === 833);
}

// -----------------------------------------------------------------------------
console.log("\nOvertacket");
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

  // PROV 6. Bestallarens exempel: 20 000 − 5 000 = 15 000, saljaren 1 800,
  // restposten 13 200, overtacket 1 320.
  const netto = nettoEfterUtkop(20000, 5000);
  const affar = affarenFor({
    sats: chefssats,
    saljareId: "vlado",
    ordervarde: netto,
    saljarprovision: utkopsprovision(sats(), netto),
    saljarkalla: "buyout",
  });

  ok("Kallan foljer med", affar.kalla === "buyout");
  ok("Saljaren far 1 800", affar.provision === 1800);
  ok("Restposten ar 13 200", affar.overtack?.base === 13200, `${affar.overtack?.base}`);
  ok("Overtacket ar 1 320", affar.overtack?.amount === 1320, `${affar.overtack?.amount}`);

  // Pa bruttot hade overtacket blivit 1 820 kr — alltsa 500 kr pa pengar som
  // redan gatt ut till kunden.
  const pabrutto = affarenFor({
    sats: chefssats,
    saljareId: "vlado",
    ordervarde: 20000,
    saljarprovision: 1800,
    saljarkalla: "buyout",
  });
  ok("...och inte 1 820, som bruttot hade gett", pabrutto.overtack?.amount === 1820);

  // CHEFENS EGNA UTKOPSAFFAR. Da galler egen-satsen pa NETTOT, och inget
  // overtack bokfors — de tva satserna mots aldrig pa samma order.
  const egen = affarenFor({
    sats: chefssats,
    saljareId: "zen",
    ordervarde: netto,
    saljarprovision: 1800,
    saljarkalla: "buyout",
  });
  ok("Chefens egen utkopsaffar ger 40 % av nettot", egen.provision === 6000, `${egen.provision}`);
  ok("...och inget overtack", egen.overtack === null);
  ok("...och kallan blir manager, inte buyout", egen.kalla === "manager");
}

// -----------------------------------------------------------------------------
console.log("\nManaden");
// -----------------------------------------------------------------------------
{
  const rader = [
    order({ id: "a", varde: 11940 }),
    order({ id: "b", varde: 20000, utkop: 5000 }),
    order({ id: "c", varde: 11940, utkop: 2000 }),
  ];

  const v = ordervarde(rader, "2026-09-01");

  ok("Tecknat star kvar BRUTTO", v.tecknat === 43880, `${v.tecknat}`);
  ok("Utkopen summeras for sig", v.utkop === 7000, `${v.utkop}`);
  ok("Nettot ar tecknat minus utkop", v.netto === 36880, `${v.netto}`);
  ok("Inget saknar varde", v.utanVarde === 0);

  // En manad helt utan utkop ska bete sig EXAKT som fore 0060. Det ar det
  // viktigaste provet i avsnittet: rattelsen far inte flytta ett enda tal i de
  // manader som redan raknats.
  const gamla = ordervarde([order({ id: "d", varde: 11940 })], "2026-09-01");
  ok("Utan utkop ar netto = tecknat", gamla.netto === 11940 && gamla.utkop === 0);

  // MAKULERINGEN TAR BADE VARDET OCH UTKOPET. Bruttot gick in i
  // signeringsmanaden men bara nettot kom bolaget till del — dras bara vardet av
  // blir avdraget for stort.
  const makulerad = [
    order({ id: "e", varde: 20000, utkop: 5000 }),
    order({
      id: "f",
      varde: 20000,
      utkop: 5000,
      signerad: "2026-08-10",
      status: "makulerad",
      makuleradManad: "2026-09-01",
    }),
  ];
  const m = ordervarde(makulerad, "2026-09-01");
  ok("Makuleringens varde dras", m.makulerat === 20000);
  ok("Makuleringens utkop dras tillbaka", m.utkop === 0, `${m.utkop}`);
  ok("Nettot blir noll", m.netto === 0, `${m.netto}`);
}

console.log(
  fel === 0
    ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m\n"
    : `\n\x1b[31m${fel} prov misslyckades.\x1b[0m\n`,
);
process.exit(fel === 0 ? 0 : 1);
