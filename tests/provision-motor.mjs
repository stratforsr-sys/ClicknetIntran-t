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
  bokforingsposter,
  forSaljare,
  gallandeNivaer,
  kvBas,
  kvarTillNasta,
  nivaFor,
  prognosNastaNiva,
  raknaUnderlag,
  summaAv,
  underlagForAlla,
  volymbonusBelopp,
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

// =============================================================================
// Steg 3 — volymtrappan
// =============================================================================

// EN PAHITTAD TRAPPA. Bestallaren har inte satt beloppen (avsnitt 5.1) och
// ingenting seedas i databasen. Talen nedan finns bara har, i provet, och just
// darfor ar de olika och orunda: en trappa med 1000/2000/3000 hade sett ratt ut
// aven om motorn plockat fel rad.
const TRAPPA = [
  { id: "n5",  threshold: 5,  amount: 2000, unit: "amount_fixed", valid_from: "2026-08-01", valid_to: null },
  { id: "n10", threshold: 10, amount: 5500, unit: "amount_fixed", valid_from: "2026-08-01", valid_to: null },
  { id: "n15", threshold: 15, amount: 9000, unit: "amount_fixed", valid_from: "2026-08-01", valid_to: null },
  { id: "n30", threshold: 30, amount: 25000, unit: "amount_fixed", valid_from: "2026-08-01", valid_to: null },
];

const manadensOrder = (n, saljare = "s1") =>
  Array.from({ length: n }, (_, i) =>
    order({
      id: `o${i}`,
      saljare,
      signerad: `2026-08-${String((i % 28) + 1).padStart(2, "0")}`,
      belopp: 1500,
    }),
  );

console.log("\nTrappan: den hogsta troskel raknaren natt");
{
  const t = gallandeNivaer(TRAPPA, "2026-08-01");

  ok("under lagsta troskeln finns ingen niva", nivaFor(t, 4) === null);
  ok("noll order ger ingen niva", nivaFor(t, 0) === null);
  ok("exakt 5 nar niva 5", nivaFor(t, 5)?.threshold === 5);
  ok("9 star kvar pa niva 5", nivaFor(t, 9)?.threshold === 5);
  ok("10 nar niva 10", nivaFor(t, 10)?.threshold === 10);
  ok("17 star pa niva 15", nivaFor(t, 17)?.threshold === 15);

  // Over 30 star trappan still (avsnitt 5.3). Chefen far bokfora en ovrig
  // bonus for hand; motorn hittar inte pa en niva 35.
  ok("40 order ger fortfarande niva 30", nivaFor(t, 40)?.threshold === 30);

  // NIVAN BLIR ALDRIG NEGATIV.
  ok("negativt saldo ger ingen niva", nivaFor(t, -3) === null);
}

console.log("\nKvar till nasta niva — underlaget till progressvyn");
{
  const t = gallandeNivaer(TRAPPA, "2026-08-01");

  ok("0 order: 5 kvar till niva 5", kvarTillNasta(t, 0)?.kvar === 5);
  ok("7 order: 3 kvar till niva 10", kvarTillNasta(t, 7)?.kvar === 3 && kvarTillNasta(t, 7)?.niva.threshold === 10);
  ok("exakt pa en niva pekar vidare", kvarTillNasta(t, 10)?.niva.threshold === 15);

  // Trappan ar slut. Ratt svar ar "ingen nasta niva", inte en nolla som ser ut
  // som "du ar framme".
  ok("over 30 finns ingen nasta niva", kvarTillNasta(t, 31) === null);
  ok("negativt saldo pekar pa den lagsta", kvarTillNasta(t, -2)?.niva.threshold === 5);
}

console.log("\nDe tre bonusformerna");
{
  const fast = { ...TRAPPA[1] };
  const proc = { ...TRAPPA[1], unit: "percent", amount: 10 };
  const per = { ...TRAPPA[1], unit: "amount_per_order", amount: 400 };

  ok("amount_fixed ger sitt belopp", volymbonusBelopp(fast, 12, 18000) === 5500);
  ok("amount_fixed bryr sig inte om antalet", volymbonusBelopp(fast, 30, 45000) === 5500);
  ok("percent raknar pa grundprovisionen", volymbonusBelopp(proc, 12, 18000) === 1800);

  // RETROAKTIVITETEN (avsnitt 5.2): nas niva 10 far ALLA order niva 10:s
  // belopp, inte bara de over troskeln. Tolv order ger 12 x 400, inte 2 x 400.
  ok("amount_per_order galler samtliga order", volymbonusBelopp(per, 12, 18000) === 4800);
}

console.log("\nBonusen i underlaget");
{
  const u = raknaUnderlag("s1", manadensOrder(11), "2026-08-01", TRAPPA);

  ok("elva order", u.antal.netto === 11);
  ok("niva 10 natt", u.volymbonus?.niva.threshold === 10);
  ok("bonusen ar 5500", u.volymbonus?.belopp === 5500);
  ok("grundprovisionen ar 16500", u.grundprovision === 11 * 1500);
  ok("summan ar 22000", u.summa === 11 * 1500 + 5500);
  ok("summan ar fortfarande radernas summa", u.summa === summaAv(u.rader));

  const bonusrad = u.rader.find((r) => r.slag === "volymbonus");
  ok("bonusen ar en egen rad", bonusrad !== undefined);
  ok("raden sager vad som utloste den", bonusrad.text === "Volymbonus nivå 10, 11 order", bonusrad.text);
  ok("bonusraden pekar inte pa nagon order", bonusrad.order_id === undefined);
  ok("nasta niva ar med i underlaget", u.nasta?.niva.threshold === 15 && u.nasta?.kvar === 4);
}

console.log("\nUtan konfigurerad trappa finns ingen bonus");
{
  // Bestallaren har inte satt beloppen an. Tom tabell ska ge NOLL bonus, aldrig
  // en gissad — samma linje som tackningsgraden i 0025.
  const u = raknaUnderlag("s1", manadensOrder(20), "2026-08-01", []);
  ok("ingen niva", u.volymbonus === null);
  ok("ingen bonusrad", !u.rader.some((r) => r.slag === "volymbonus"));
  ok("summan ar bara grundprovisionen", u.summa === 20 * 1500);
  ok("och ingen nasta niva att peka pa", u.nasta === null);
}

console.log("\nMakuleringen sanker nivan");
{
  // Tolv order i augusti, tva av dem makulerade i augusti. Netto tio -> niva 10.
  const rader = manadensOrder(12);
  rader[0] = { ...rader[0], status: "makulerad", cancel_period_month: "2026-08-01" };
  rader[1] = { ...rader[1], status: "makulerad", cancel_period_month: "2026-08-01" };

  const u = raknaUnderlag("s1", rader, "2026-08-01", TRAPPA);

  ok("nettoantalet blir 10", u.antal.netto === 10);
  ok("nivan blir 10, inte 12", u.volymbonus?.niva.threshold === 10);
  ok("grundprovisionen tar ut sig sjalv for de tva", u.grundprovision === 10 * 1500);
}

console.log("\nNegativt saldo ger inget bonusavdrag, men avdraget star kvar");
{
  const rader = [
    order({ id: "a", signerad: "2026-03-10", status: "makulerad", belopp: 3000, makuleradManad: "2026-08-01" }),
    order({ id: "b", signerad: "2026-03-11", status: "makulerad", belopp: 1500, makuleradManad: "2026-08-01" }),
  ];

  const u = raknaUnderlag("s1", rader, "2026-08-01", TRAPPA);
  ok("ingen niva", u.volymbonus === null);
  ok("men avdraget bokfors", u.summa === -4500);
}

console.log("\nVersioneringen: trappan slas upp pa MANADEN, inte pa ordern");
{
  const versionerat = [
    { id: "g", threshold: 5, amount: 2000, unit: "amount_fixed", valid_from: "2026-08-01", valid_to: "2026-10-01" },
    { id: "n", threshold: 5, amount: 3000, unit: "amount_fixed", valid_from: "2026-10-01", valid_to: null },
  ];

  ok("augusti far gamla trappan", gallandeNivaer(versionerat, "2026-08-01")[0].amount === 2000);
  ok("september far gamla trappan", gallandeNivaer(versionerat, "2026-09-01")[0].amount === 2000);
  ok("oktober far den nya", gallandeNivaer(versionerat, "2026-10-01")[0].amount === 3000);
  ok("bara en rad galler at gangen", gallandeNivaer(versionerat, "2026-10-01").length === 1);

  // En andring mitt i september med valet "galler fran och med nu" far
  // valid_from = i dag och slar darfor igenom i OKTOBER. September behaller sin
  // trappa hela manaden — se resonemanget i `gallandeNivaer`.
  const mittI = [
    { id: "g", threshold: 5, amount: 2000, unit: "amount_fixed", valid_from: "2026-08-01", valid_to: "2026-09-17" },
    { id: "n", threshold: 5, amount: 3000, unit: "amount_fixed", valid_from: "2026-09-17", valid_to: null },
  ];
  ok("september rors inte av en andring den 17:e", gallandeNivaer(mittI, "2026-09-01")[0].amount === 2000);
  ok("oktober far den nya", gallandeNivaer(mittI, "2026-10-01")[0].amount === 3000);
}

console.log("\nBokforingsposterna — det underlaget blir nar perioden stangs");
{
  const rader = manadensOrder(11);
  rader[0] = { ...rader[0], status: "makulerad", cancel_period_month: "2026-08-01" };

  const u = raknaUnderlag("s1", rader, "2026-08-01", TRAPPA);
  const poster = bokforingsposter(u);

  ok("tre poster: grundprovision, makulering, bonus", poster.length === 3, poster.map((p) => p.slag).join(", "));
  ok("summan av posterna ar underlagets summa", poster.reduce((s, p) => s + p.belopp, 0) === u.summa);

  // TVA HANDELSER, INTE ETT NETTOTAL. Huvudboken far elva signerade order och
  // en makulering, inte tio order. Det ar samma skillnad som `harGodkants`
  // handlar om: nettot ar en summering, inte det som hande.
  const grund = poster.find((p) => p.slag === "order");
  ok("grundprovisionen bar antalet SIGNERADE order", grund.antal === 11);
  ok("och sitt belopp", grund.belopp === 11 * 1500);
  const mak = poster.find((p) => p.slag === "makulering");
  ok("nettot ar summan av de tva posterna", grund.belopp + mak.belopp === 10 * 1500);

  ok("makuleringen ar negativ", mak.belopp === -1500);
  ok("makuleringen bar inget antal — kolumnen tillater inte negativa tal", mak.antal === null);

  ok("bonusposten finns", poster.some((p) => p.slag === "volymbonus" && p.belopp === 5500));
}

console.log("\nNollposter bokfors inte");
{
  const nollbonus = TRAPPA.map((n) => ({ ...n, amount: 0 }));
  const u = raknaUnderlag("s1", manadensOrder(11), "2026-08-01", nollbonus);

  ok("nivan syns i underlaget", u.volymbonus?.niva.threshold === 10);
  ok("bonusraden finns for sparbarhetens skull", u.rader.some((r) => r.slag === "volymbonus"));

  // ... men en bokford nolla ar ingen upplysning, och append-only gor att den
  // inte gar att stada bort efterat.
  ok("men den bokfors inte", !bokforingsposter(u).some((p) => p.slag === "volymbonus"));

  const tomt = bokforingsposter(raknaUnderlag("s1", [], "2026-08-01", TRAPPA));
  ok("en manad utan rorelse ger inga poster alls", tomt.length === 0);
}

console.log("\nAvrundningen sker en gang, pa den fardiga bonusraden");
{
  // 30 order, 0,5 % pa 45 000 kr grundprovision = 225 kr jamnt. Med en sats som
  // ger orebelopp ska avrundningen ske EN gang: 33 1/3 % av 45 000 ar 15 000
  // exakt, sa provet tar i stallet en sats som inte gar jamnt ut.
  const proc = [{ id: "p", threshold: 5, amount: 7.5, unit: "percent", valid_from: "2026-08-01", valid_to: null }];
  const u = raknaUnderlag("s1", manadensOrder(7), "2026-08-01", proc);

  // 7 x 1500 = 10 500. 7,5 % = 787,50 -> 788.
  ok("bonusen avrundas till 788", u.volymbonus?.belopp === 788);
  ok("bonusraden ar ett helt kronbelopp", Number.isInteger(u.rader.find((r) => r.slag === "volymbonus").belopp));
  ok("summan blir 11288", u.summa === 10500 + 788);
}

// =============================================================================
// Steg 4 — prognosen
// =============================================================================

console.log("\nPrognosen till nasta niva");
{
  const u = raknaUnderlag("s1", manadensOrder(7), "2026-08-01", TRAPPA);
  const p = prognosNastaNiva(u);

  ok("sju order pekar mot niva 10", p?.niva.threshold === 10);
  ok("tre order kvar", p?.kvar === 3);
  ok("snittet ar 1500 per order", p?.snittPerOrder === 1500);
  ok("grundprovisionen da blir 15000", p?.grundprovisionDa === 10 * 1500);
  ok("bonusen da blir 5500", p?.bonusDa === 5500);
  ok("totalen da blir 20500", p?.totaltDa === 20500);
}

console.log("\nPrognosen sager ingenting nar den inte kan");
{
  // Trappan star still over 30 (avsnitt 5.3). Ingen nasta niva att peka pa.
  ok("over trappans slut finns ingen prognos", prognosNastaNiva(raknaUnderlag("s1", manadensOrder(31), "2026-08-01", TRAPPA)) === null);

  // Utan order finns inget snitt. En prognos ur noll order hade varit en
  // gissning utkladd till en berakning.
  ok("utan order finns ingen prognos", prognosNastaNiva(raknaUnderlag("s1", [], "2026-08-01", TRAPPA)) === null);

  // Utan konfigurerad trappa finns ingen niva att sikta pa.
  ok("utan trappa finns ingen prognos", prognosNastaNiva(raknaUnderlag("s1", manadensOrder(7), "2026-08-01", [])) === null);
}

console.log("\nPrognosen raknar pa MANADENS snitt, inte pa paketpriset");
{
  // Fyra order: tre sma och en stor. Snittet ar 2250, inte 1500.
  const blandat = [
    order({ id: "a", signerad: "2026-08-01", belopp: 1500 }),
    order({ id: "b", signerad: "2026-08-02", belopp: 1500 }),
    order({ id: "c", signerad: "2026-08-03", belopp: 1500 }),
    order({ id: "d", signerad: "2026-08-04", paket: 3, loptid: 36, belopp: 4500 }),
  ];

  const p = prognosNastaNiva(raknaUnderlag("s1", blandat, "2026-08-01", TRAPPA));
  ok("snittet ar 2250", p?.snittPerOrder === 2250);
  ok("en order kvar till niva 5", p?.kvar === 1);
  ok("grundprovisionen da blir 11250", p?.grundprovisionDa === 9000 + 2250);
  ok("och totalen 13250", p?.totaltDa === 11250 + 2000);
}

console.log("\nProcentbonusen i prognosen raknas pa den framskrivna summan");
{
  const proc = [{ id: "p", threshold: 10, amount: 10, unit: "percent", valid_from: "2026-08-01", valid_to: null }];
  const p = prognosNastaNiva(raknaUnderlag("s1", manadensOrder(7), "2026-08-01", proc));

  // 10 order x 1500 = 15 000, 10 % = 1 500. Inte 10 % av de 10 500 som finns nu.
  ok("bonusen da blir 1500", p?.bonusDa === 1500);
  ok("totalen da blir 16500", p?.totaltDa === 16500);
}

// =============================================================================
// Steg 5 — K&V-bonusen i underlaget
//
// Veckologiken provas i tests/kv.mjs. Har provas bara pengarna.
// =============================================================================

console.log("\nK&V-bonusen raknas pa grundprovision PLUS volymbonus");
{
  // 11 order x 1500 = 16 500 grundprovision, niva 10 ger 5 500 volymbonus.
  // Basen ar 22 000. Tva godkanda veckor = 2,5 %.
  const u = raknaUnderlag("s1", manadensOrder(11), "2026-08-01", TRAPPA, {
    godkanda: 2,
    bedomda: 3,
    procent: 2.5,
  });

  ok("basen ar 22000", kvBas(u.grundprovision, u.volymbonus.belopp) === 22000);
  ok("bonusen blir 550", u.kv?.belopp === 550);
  ok("och summan 22550", u.summa === 22550);
  ok("summan ar fortfarande radernas summa", u.summa === summaAv(u.rader));

  const rad = u.rader.find((r) => r.slag === "kv_bonus");
  ok("bonusen ar en egen rad", rad !== undefined);
  ok("raden sager vad som utloste den", rad.text === "K&V-bonus, 2 godkända veckor (2.5 %)", rad.text);
}

console.log("\nK&V raknas ALDRIG pa K&V");
{
  // Om K&V-bonusen laggs till basen blir 22 000 -> 22 550 -> 563 i stallet for
  // 550, och da avgor ordningen mellan raderna vad nagon far betalt.
  const u = raknaUnderlag("s1", manadensOrder(11), "2026-08-01", TRAPPA, {
    godkanda: 2, bedomda: 2, procent: 2.5,
  });

  ok("bonusen ar 2,5 % av 22000, inte av 22550", u.kv?.belopp === 550);
  ok(
    "basen innehaller ingen K&V-rad",
    kvBas(u.grundprovision, u.volymbonus.belopp) === u.summa - u.kv.belopp,
  );
}

console.log("\nEn godkand vecka i singular");
{
  const u = raknaUnderlag("s1", manadensOrder(7), "2026-08-01", TRAPPA, {
    godkanda: 1, bedomda: 1, procent: 1.25,
  });
  const rad = u.rader.find((r) => r.slag === "kv_bonus");
  ok("texten boejs ratt", rad.text === "K&V-bonus, 1 godkänd vecka (1.25 %)", rad.text);
}

console.log("\nUtan godkanda veckor finns ingen K&V-rad");
{
  const utan = raknaUnderlag("s1", manadensOrder(11), "2026-08-01", TRAPPA, {
    godkanda: 0, bedomda: 3, procent: 0,
  });
  ok("ingen kv-rad", utan.kv === null && !utan.rader.some((r) => r.slag === "kv_bonus"));
  ok("summan ar grundprovision plus volymbonus", utan.summa === 16500 + 5500);

  const inget = raknaUnderlag("s1", manadensOrder(11), "2026-08-01", TRAPPA);
  ok("och utan K&V-underlag alls likasa", inget.kv === null && inget.summa === 22000);
}

console.log("\nK&V-bonus utan volymbonus raknas pa enbart grundprovisionen");
{
  // Tre order — under lagsta troskeln, ingen volymbonus. 4500 x 5 % = 225.
  const u = raknaUnderlag("s1", manadensOrder(3), "2026-08-01", TRAPPA, {
    godkanda: 4, bedomda: 4, procent: 5,
  });
  ok("ingen volymbonus", u.volymbonus === null);
  ok("K&V-bonusen blir 225", u.kv?.belopp === 225);
  ok("summan blir 4725", u.summa === 4725);
}

console.log("\nK&V-bonusen bokfors som en egen post");
{
  const u = raknaUnderlag("s1", manadensOrder(11), "2026-08-01", TRAPPA, {
    godkanda: 2, bedomda: 2, procent: 2.5,
  });
  const poster = bokforingsposter(u);

  ok("tre poster", poster.length === 3, poster.map((p) => p.slag).join(", "));
  ok("K&V star for sig", poster.some((p) => p.slag === "kv_bonus" && p.belopp === 550));
  ok("summan av posterna ar underlagets summa", poster.reduce((s, p) => s + p.belopp, 0) === u.summa);
}

console.log(fel === 0 ? "\n\x1b[32mAllt gront.\x1b[0m\n" : `\n\x1b[31m${fel} fel.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
