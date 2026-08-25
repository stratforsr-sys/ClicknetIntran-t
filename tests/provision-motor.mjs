#!/usr/bin/env node
/**
 * Raknemotorn. Fem saker star pa spel och provas at bada hallen:
 *
 *   1. UNDERLAGET AR SVARET. `summa` maste alltid vara exakt summan av
 *      `rader`. Glider de isar visar vyn ett tal den inte kan forklara.
 *   2. TVA HANDELSER, INTE EN. En makulerad order bidrar i sin
 *      signeringsmanad OCH i sin makuleringsmanad. Blandas de ihop skrivs en
 *      stangd period om, eller sa bokfors ett avdrag mot ett tillagg som
 *      aldrig fanns.
 *   3. PERSONFILTRET. Chefens vy hamtar allas order i en fraga. Laker en
 *      annan persons order in i ett underlag blir det en utbetalning till fel
 *      manniska.
 *   4. AVRUNDNINGEN. Matematiskt at BADA hallen. `Math.round` ensamt gor -0,5
 *      till -0 och darmed varje avdrag snallare an motsvarande tillagg.
 *   5. NEGATIVT SALDO. Fler makuleringar an order ger minus, med flit.
 *
 *   node --experimental-strip-types tests/provision-motor.mjs
 */
import {
  avrunda,
  forSaljare,
  raknaUnderlag,
  summaAv,
  underlagForAlla,
} from "../src/lib/provision-motor.ts";
import { periodFor } from "../src/lib/order.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(
    `  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`,
  );
  if (!villkor) fel++;
};

const order = (o) => ({
  id: o.id ?? Math.random().toString(36).slice(2),
  salesperson_id: o.saljare ?? "s1",
  package_id: o.paket ?? 1,
  term_months: o.loptid ?? 12,
  signed_on: o.signerad,
  period_month: periodFor(o.signerad),
  status: o.status ?? "signerad",
  is_addon: o.tillagg ?? false,
  commission_amount: o.belopp ?? null,
  cancel_period_month: o.makuleradManad ?? null,
});

console.log("\nUnderlaget ar svaret, summan ar bara deras summa");
{
  const rader = [
    order({ id: "a", signerad: "2026-08-05", belopp: 1500 }),
    order({ id: "b", signerad: "2026-08-07", paket: 2, loptid: 24, belopp: 4000 }),
  ];

  const u = raknaUnderlag("s1", rader, "2026-08-01");

  ok("tva rader", u.rader.length === 2);
  ok("summan blir 5500", u.summa === 5500);
  ok("summan ar exakt radernas summa", u.summa === summaAv(u.rader));
  ok("grundprovisionen stammer med summan", u.grundprovision === u.summa);
  ok("alla rader ar av slaget order", u.rader.every((r) => r.slag === "order"));
  ok("varje rad pekar pa sin order", u.rader.every((r) => r.order_id));

  ok(
    "raden beskriver affaren",
    u.rader[1].text === "Order 2026-08-07, paket 2, 24 mån",
    u.rader[1].text,
  );

  ok("nettoantalet blir 2", u.antal.netto === 2);
  ok("inga makuleringar", u.antal.makulerade === 0);
}

console.log("\nTillagget syns i texten");
{
  const u = raknaUnderlag(
    "s1",
    [order({ signerad: "2026-08-05", belopp: 1500, tillagg: true })],
    "2026-08-01",
  );
  ok("tillagg star utskrivet", u.rader[0].text.endsWith(", tillägg"), u.rader[0].text);
}

console.log("\nEn makulering ar TVA handelser i TVA manader");
{
  // Bestallarens eget exempel: en order fran mars som makuleras i augusti.
  const rader = [
    order({
      id: "a", signerad: "2026-03-10", status: "makulerad",
      belopp: 3000, makuleradManad: "2026-08-01",
    }),
    order({ id: "b", signerad: "2026-08-05", belopp: 1500 }),
  ];

  const mars = raknaUnderlag("s1", rader, "2026-03-01");
  const aug = raknaUnderlag("s1", rader, "2026-08-01");

  // MARS RORS ALDRIG (avsnitt 4.4). Perioden ar stangd och utbetald; att
  // makuleringen raknade bort marsraden hade skrivit om en stangd period.
  ok("mars star kvar pa 3000", mars.summa === 3000);
  ok("mars har en rad, och den ar en order", mars.rader.length === 1 && mars.rader[0].slag === "order");
  ok("mars vet ingenting om makuleringen", mars.antal.makulerade === 0);

  // AUGUSTI BAR AVDRAGET.
  ok("augusti blir -1500", aug.summa === -1500);
  ok("augusti har tva rader", aug.rader.length === 2);
  ok("avdragsraden ar negativ", aug.rader.some((r) => r.slag === "makulering" && r.belopp === -3000));
  ok(
    "avdragsraden pekar tillbaka pa nar ordern tecknades",
    aug.rader.find((r) => r.slag === "makulering").text === "Makulerad order, tecknad 2026-03-10",
  );
  ok("augusti nettoantal blir 0", aug.antal.netto === 0);
  ok("summan ar fortfarande radernas summa", aug.summa === summaAv(aug.rader));
}

console.log("\nSignerad och makulerad i samma manad tar ut varandra");
{
  const rader = [
    order({
      id: "a", signerad: "2026-08-05", status: "makulerad",
      belopp: 1500, makuleradManad: "2026-08-01",
    }),
  ];

  const u = raknaUnderlag("s1", rader, "2026-08-01");

  // Bagge handelserna ligger i augusti: +1500 och -1500. Netto noll. Raknas
  // bara avdraget bokfors pengar tillbaka som aldrig betalades ut.
  ok("summan blir 0, inte -1500", u.summa === 0);
  ok("men bada handelserna syns", u.rader.length === 2);
  ok("nettoantalet blir 0, inte -1", u.antal.netto === 0);
  ok("bade en signering och en makulering raknas", u.antal.signerade === 1 && u.antal.makulerade === 1);
}

console.log("\nFler makuleringar an order ger ett negativt saldo");
{
  const rader = [
    order({ id: "a", signerad: "2026-03-10", status: "makulerad", belopp: 3000, makuleradManad: "2026-08-01" }),
    order({ id: "b", signerad: "2026-03-11", status: "makulerad", belopp: 1500, makuleradManad: "2026-08-01" }),
  ];

  const u = raknaUnderlag("s1", rader, "2026-08-01");

  // Talet ar negativt med flit. Volymtrappan i steg 3 ger niva noll — den blir
  // aldrig negativ — men avdraget sker anda: pengarna ska tillbaka.
  ok("nettoantalet blir -2", u.antal.netto === -2);
  ok("summan blir -4500", u.summa === -4500);
}

console.log("\nUtkast och inskickat rors inte");
{
  const rader = [
    order({ id: "a", signerad: "2026-08-02", status: "utkast" }),
    order({ id: "b", signerad: "2026-08-03", status: "inskickad" }),
    order({ id: "c", signerad: "2026-08-04", belopp: 1500 }),
  ];

  const u = raknaUnderlag("s1", rader, "2026-08-01");
  ok("bara den godkanda raknas", u.rader.length === 1 && u.summa === 1500);
  ok("inskickad vantar pa godkannande och ger ingenting", u.antal.signerade === 1);
}

console.log("\nPersonfiltret");
{
  const rader = [
    order({ id: "a", saljare: "s1", signerad: "2026-08-05", belopp: 1500 }),
    order({ id: "b", saljare: "s2", signerad: "2026-08-06", belopp: 4000 }),
    order({ id: "c", saljare: "s2", signerad: "2026-08-07", belopp: 2500 }),
  ];

  ok("forSaljare plockar ratt rader", forSaljare(rader, "s2").length === 2);

  const en = raknaUnderlag("s1", rader, "2026-08-01");
  ok("s1 far bara sin egen order", en.rader.length === 1 && en.summa === 1500);

  const alla = underlagForAlla(rader, "2026-08-01");
  ok("tva personer med rorelse", alla.length === 2);
  ok("ingen persons summa laker in i en annans", alla.map((u) => u.summa).join() === "1500,6500");
  ok("varje underlag bar sitt eget id", alla.map((u) => u.employee_id).join() === "s1,s2");

  const tom = raknaUnderlag("s3", rader, "2026-08-01");
  ok("den utan order far ett tomt underlag, inte ett fel", tom.summa === 0 && tom.rader.length === 0);
}

console.log("\nEn makulering ensam i manaden ger personen ett underlag");
{
  // Personen har ingen signerad order i augusti, bara ett avdrag. Utan raden
  // hade hen forsvunnit ur chefens lista trots att hens saldo ar minus.
  const rader = [
    order({ id: "a", saljare: "s2", signerad: "2026-03-10", status: "makulerad", belopp: 3000, makuleradManad: "2026-08-01" }),
  ];

  const alla = underlagForAlla(rader, "2026-08-01");
  ok("personen finns med", alla.length === 1 && alla[0].employee_id === "s2");
  ok("och saldot ar -3000", alla[0].summa === -3000);
}

console.log("\nAvrundningen ar matematisk at bada hallen");
{
  ok("1500,4 blir 1500", avrunda(1500.4) === 1500);
  ok("1500,5 blir 1501", avrunda(1500.5) === 1501);
  ok("1500,6 blir 1501", avrunda(1500.6) === 1501);

  // Fallan: Math.round avrundar mot plus oandligheten, sa -0,5 blir -0 och
  // -1500,5 blir -1500. Da ar varje avdrag systematiskt snallare mot bolaget
  // an motsvarande tillagg.
  ok("-1500,5 blir -1501, inte -1500", avrunda(-1500.5) === -1501);
  ok("-1500,4 blir -1500", avrunda(-1500.4) === -1500);
  ok("-0,5 blir -1, inte -0", avrunda(-0.5) === -1);
  ok("noll ar noll", avrunda(0) === 0 && !Object.is(avrunda(0), -0));

  ok(
    "avrundning at bada hallen ar symmetrisk",
    [0.5, 1.5, 2.5, 1500.5].every((t) => avrunda(-t) === -avrunda(t)),
  );
}

console.log("\nTomma fall");
{
  const u = raknaUnderlag("s1", [], "2026-08-01");
  ok("inga order ger noll, inte NaN", u.summa === 0 && Number.isFinite(u.summa));
  ok("och inga rader", u.rader.length === 0);
  ok("inga personer i chefens lista", underlagForAlla([], "2026-08-01").length === 0);
  ok("summaAv pa tomt ar 0", summaAv([]) === 0);
}

console.log(fel === 0 ? "\n\x1b[32mAllt gront.\x1b[0m\n" : `\n\x1b[31m${fel} fel.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
