#!/usr/bin/env node
/**
 * Ordervardet och saljchefens ersattning. Sju saker star pa spel:
 *
 *   1. ORDERVARDET AR PRIS GANGE LOPTID. 995 x 12 = 11 940, inte 995. Med
 *      manadspriset ensamt blir restposten negativ pa VARJE paketorder, och
 *      overtacket noll for alltid utan att nagon ser varfor.
 *   2. RESTPOSTEN GAR ALDRIG UNDER NOLL. En handsatt order dar provisionen
 *      overstiger vardet ger 0 kr till chefen, aldrig ett avdrag.
 *   3. DE TVA SATSERNA MOTS ALDRIG. Pa en egen order galler 40 % och INGET
 *      overtack; pa andras galler matrisen och overtacket. Bada pa samma order
 *      hade betalat samma arbete tva ganger.
 *   4. TVA HANDELSER, INTE EN. Ett overtack bokfors i orderns signeringsmanad
 *      och dras tillbaka i dess makuleringsmanad — samma modell som saljarens
 *      egen provision, och av samma skal.
 *   5. OVERTACKET AR INTE EN ORDER. Det far aldrig hoja `antal.netto` och
 *      darmed volymtrappan. En chef med fem saljare skulle annars na niva 20
 *      utan att teckna en enda affar.
 *   6. OVERTACKET AR INTE EN BONUSBAS. K&V raknas pa grundprovision plus
 *      volymbonus, aldrig pa overtacket.
 *   7. MOTTAGAREN FINNS AVEN UTAN EGNA ORDER. `underlagForAlla` byggde fore
 *      2026-09-09 sin lista uteslutande ur personer som salt nagot, och en chef
 *      utan egen affar hade darmed uteblivit ur bade vyn och lonekorningen.
 *
 *   node --experimental-strip-types tests/chefsprovision.mjs
 */
import {
  affarenFor,
  arEgenForsaljning,
  egenProvision,
  gallandeChefssats,
  overtackFor,
  restpost,
  restpostenAtNoll,
} from "../src/lib/chefsprovision.ts";
import { ordervarde, ordervardeFor, ordervardeForPaket, periodFor } from "../src/lib/order.ts";
import { bokforingsposter, raknaUnderlag, underlagForAlla } from "../src/lib/provision-motor.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(
    `  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`,
  );
  if (!villkor) fel++;
};

const CHEF = "zen";
const SALJARE = "vlado";

const sats = (o = {}) => ({
  id: o.id ?? "sats-1",
  employee_id: o.chef ?? CHEF,
  override_percent: o.overtack ?? 10,
  own_sale_percent: o.egen ?? 40,
  valid_from: o.fran ?? "2026-09-01",
  valid_to: o.till ?? null,
});

const order = (o) => ({
  id: o.id ?? Math.random().toString(36).slice(2),
  salesperson_id: o.saljare ?? SALJARE,
  package_id: o.paket ?? 1,
  term_months: o.loptid ?? 12,
  signed_on: o.signerad,
  period_month: periodFor(o.signerad),
  status: o.status ?? "signerad",
  is_addon: false,
  commission_amount: o.belopp ?? null,
  order_value: o.varde === undefined ? null : o.varde,
  cancel_period_month: o.makuleradManad ?? null,
});

const chefspost = (o) => ({
  order_id: o.order ?? "o1",
  manager_id: o.chef ?? CHEF,
  amount: o.belopp,
  percent: o.procent ?? 10,
  period_month: periodFor(o.signerad),
  cancel_period_month: o.makuleradManad ?? null,
  signed_on: o.signerad,
  company_name: o.bolag ?? "Kund AB",
  makulerad: o.makulerad ?? false,
});

// -----------------------------------------------------------------------------
console.log("\nOrdervardet ar manadspriset gange loptiden");
{
  ok("Paket 1, 12 man", ordervardeFor(995, 12) === 11940, `${ordervardeFor(995, 12)}`);
  ok("Paket 1, 24 man", ordervardeFor(995, 24) === 23880, `${ordervardeFor(995, 24)}`);
  ok("Paket 3, 36 man", ordervardeFor(1995, 36) === 71820, `${ordervardeFor(1995, 36)}`);

  const paket = [
    { id: 1, label: "Paket 1", list_price: 995, sort: 1, active: true },
    { id: 3, label: "Paket 3", list_price: 1995, sort: 3, active: true },
  ];
  ok("Uppslag ur paketlistan", ordervardeForPaket(paket, 3, 36) === 71820);
  ok("Okant paket ger null, inte noll", ordervardeForPaket(paket, 2, 12) === null);
}

// -----------------------------------------------------------------------------
console.log("\nRestposten gar aldrig under noll");
{
  ok("Normalfallet", restpost(11940, 1500) === 10440);
  ok("Provision over varde klipps till noll", restpost(2000, 3000) === 0);
  ok("...och det marks", restpostenAtNoll(2000, 3000) === true);
  ok("Exakt lika ar inte ett klipp", restpost(1500, 1500) === 0 && !restpostenAtNoll(1500, 1500));
}

// -----------------------------------------------------------------------------
console.log("\nOvertacket pa andras order");
{
  const o = overtackFor(sats(), SALJARE, 11940, 1500);
  ok("Tio procent av restposten", o?.amount === 1044, `${o?.amount}`);
  ok("Basen sparas", o?.base === 10440);
  ok("Ordervardet sparas", o?.order_value === 11940);
  ok("Satsen pekas ut", o?.rate_id === "sats-1");
  ok("Mottagaren ar chefen", o?.manager_id === CHEF);

  const stor = overtackFor(sats(), SALJARE, 71820, 6500);
  ok("Paket 3, 36 man", stor?.amount === 6532, `${stor?.amount}`);

  ok("Ingen sats ger null, inte noll", overtackFor(null, SALJARE, 11940, 1500) === null);
  ok(
    "Noll procent bokfors inte",
    overtackFor(sats({ overtack: 0 }), SALJARE, 11940, 1500) === null,
  );
  ok(
    "Restpost noll bokfors inte",
    overtackFor(sats(), SALJARE, 2000, 3000) === null,
  );

  // 0,4 % av 100 kr ar 40 ore, som avrundas till noll. En nollpost i en tabell
  // som inte gar att skriva om ar varken en upplysning eller mojlig att stada.
  ok(
    "Ett belopp som avrundas till noll bokfors inte",
    overtackFor(sats({ overtack: 0.4 }), SALJARE, 1600, 1500) === null,
  );
}

// -----------------------------------------------------------------------------
console.log("\nDe tva satserna mots aldrig pa samma order");
{
  ok("Chefen kanns igen", arEgenForsaljning(sats(), CHEF) === true);
  ok("Saljaren ar inte chefen", arEgenForsaljning(sats(), SALJARE) === false);
  ok("Utan sats ar ingen chef", arEgenForsaljning(null, CHEF) === false);

  ok("Fyrtio procent av hela vardet", egenProvision(sats(), 11940) === 4776);
  ok("INGET overtack pa egen order", overtackFor(sats(), CHEF, 11940, 1500) === null);

  const egen = affarenFor({
    sats: sats(),
    saljareId: CHEF,
    ordervarde: 11940,
    saljarprovision: 1500,
    saljarkalla: "matrix",
  });
  ok("Egen order: 40 % ERSATTER matrisen", egen.provision === 4776, `${egen.provision}`);
  ok("Egen order: kallan ar manager", egen.kalla === "manager");
  ok("Egen order: inget overtack", egen.overtack === null);

  const andras = affarenFor({
    sats: sats(),
    saljareId: SALJARE,
    ordervarde: 11940,
    saljarprovision: 1500,
    saljarkalla: "matrix",
  });
  ok("Andras order: matrisen galler", andras.provision === 1500 && andras.kalla === "matrix");
  ok("Andras order: overtacket raknas", andras.overtack?.amount === 1044);

  // En fri order som chefen sjalv tecknat: 40 % pa det inskrivna vardet, och
  // provisionen som godkannaren skrivit in anvands inte alls.
  const friEgen = affarenFor({
    sats: sats(),
    saljareId: CHEF,
    ordervarde: 18000,
    saljarprovision: 2200,
    saljarkalla: "manual",
  });
  ok("Fri order, chefen sjalv: 40 % av 18 000", friEgen.provision === 7200, `${friEgen.provision}`);
  ok("...och kallan ar manager, inte manual", friEgen.kalla === "manager");

  const friAndras = affarenFor({
    sats: sats(),
    saljareId: SALJARE,
    ordervarde: 18000,
    saljarprovision: 2200,
    saljarkalla: "manual",
  });
  ok("Fri order, saljare: handsatt provision star", friAndras.provision === 2200);
  ok("...och overtacket raknas pa skillnaden", friAndras.overtack?.amount === 1580, `${friAndras.overtack?.amount}`);

  // Utan sats ska matrisen galla aven for den som SKULLE varit mottagare.
  const utanSats = affarenFor({
    sats: null,
    saljareId: CHEF,
    ordervarde: 11940,
    saljarprovision: 1500,
    saljarkalla: "matrix",
  });
  ok("Ingen sats: matrisen galler for alla", utanSats.provision === 1500 && utanSats.kalla === "matrix");
}

// -----------------------------------------------------------------------------
console.log("\nSatsen slas upp pa orderns signeringsdatum");
{
  const historik = [
    sats({ id: "gammal", overtack: 5, fran: "2026-09-01", till: "2026-10-01" }),
    sats({ id: "ny", overtack: 10, fran: "2026-10-01" }),
  ];

  ok("Fore bytet", gallandeChefssats(historik, "2026-09-20")?.id === "gammal");
  ok("Efter bytet", gallandeChefssats(historik, "2026-10-05")?.id === "ny");
  // valid_to ar EXKLUSIVT: raden som slutar 2026-10-01 galler till och med den
  // 30 september. Halvoppna intervall ar det enda sattet att undvika en dag som
  // tillhor bada raderna eller ingen.
  ok("Sista dagen hor till den gamla", gallandeChefssats(historik, "2026-09-30")?.id === "gammal");
  ok("Forsta dagen hor till den nya", gallandeChefssats(historik, "2026-10-01")?.id === "ny");
  ok("Fore all historik ger null", gallandeChefssats(historik, "2026-08-15") === null);
}

// -----------------------------------------------------------------------------
console.log("\nOvertacket i underlaget: tva handelser, inte en");
{
  const poster = [
    chefspost({ order: "a", belopp: 1044, signerad: "2026-09-05", bolag: "Alfa AB" }),
    chefspost({ order: "b", belopp: 2088, signerad: "2026-09-12", bolag: "Beta AB" }),
    // Tecknad i september, makulerad i oktober. Bidrar i BADA manaderna.
    chefspost({
      order: "c",
      belopp: 500,
      signerad: "2026-09-20",
      bolag: "Gamma AB",
      makulerad: true,
      makuleradManad: "2026-10-01",
    }),
  ];

  const sep = raknaUnderlag(CHEF, [], "2026-09-01", [], null, null, poster);
  ok("September far alla tre tillaggen", sep.chefsprovision?.antal === 3);
  ok("Summan ar deras summa", sep.chefsprovision?.belopp === 3632, `${sep.chefsprovision?.belopp}`);
  ok("Inget avdrag i september", sep.chefsprovision?.makulerade === 0);
  ok("`summa` ar exakt radernas summa", sep.summa === sep.rader.reduce((s, r) => s + r.belopp, 0));

  const okt = raknaUnderlag(CHEF, [], "2026-10-01", [], null, null, poster);
  ok("Oktober bar bara avdraget", okt.chefsprovision?.antal === 0);
  ok("...och det ar negativt", okt.chefsprovision?.belopp === -500, `${okt.chefsprovision?.belopp}`);
  ok("SEPTEMBER RORS INTE av oktobers makulering", sep.chefsprovision?.belopp === 3632);

  const nov = raknaUnderlag(CHEF, [], "2026-11-01", [], null, null, poster);
  ok("En manad utan rorelse ger null, inte en nolla", nov.chefsprovision === null);

  // Posterna hor till EN person. Lacker de over ar det en utbetalning till fel
  // manniska — samma spärr som personfiltret pa orderna.
  const annan = raknaUnderlag(SALJARE, [], "2026-09-01", [], null, null, poster);
  ok("Nagon annans overtack lacker inte in", annan.chefsprovision === null);
}

// -----------------------------------------------------------------------------
console.log("\nOvertacket ar varken en order eller en bonusbas");
{
  const poster = Array.from({ length: 25 }, (_, i) =>
    chefspost({ order: `o${i}`, belopp: 1000, signerad: "2026-09-05" }),
  );

  const trappa = [
    { id: "n5", threshold: 5, amount: 200, unit: "amount_fixed", valid_from: "2026-09-01", valid_to: null },
    { id: "n20", threshold: 20, amount: 1200, unit: "amount_fixed", valid_from: "2026-09-01", valid_to: null },
  ];

  const u = raknaUnderlag(CHEF, [], "2026-09-01", trappa, null, null, poster);
  ok("Tjugofem overtack ar noll egna order", u.antal.netto === 0);
  ok("...och ger INGEN volymbonus", u.volymbonus === null);
  ok("...men pengarna finns", u.summa === 25000, `${u.summa}`);

  // K&V raknas pa grundprovision + volymbonus (O3). Overtacket ar ingetdera.
  const medKv = raknaUnderlag(
    CHEF,
    [order({ id: "egen", signerad: "2026-09-03", belopp: 4776, varde: 11940, saljare: CHEF })],
    "2026-09-01",
    [],
    { godkanda: 4, bedomda: 4, procent: 5 },
    null,
    poster,
  );
  // 5 % av 4 776 kr, inte av 4 776 + 25 000.
  ok("K&V raknas UTAN overtacket", medKv.kv?.belopp === 239, `${medKv.kv?.belopp}`);

  // En bonusforlust river volymbonus och K&V. Overtacket ar ersattning for
  // utfort arbete, i samma mening som grundprovisionen, och star kvar.
  const vidForlust = raknaUnderlag(
    CHEF,
    [],
    "2026-09-01",
    trappa,
    { godkanda: 4, bedomda: 4, procent: 5 },
    { bonusforlust: true, raknareFran: "2026-09-10", handelser: [{}, {}] },
    poster,
  );
  ok("Bonusforlusten river K&V", vidForlust.kv === null);
  ok("...men INTE overtacket", vidForlust.chefsprovision?.belopp === 25000);
}

// -----------------------------------------------------------------------------
console.log("\nMottagaren finns aven utan egna order");
{
  const order_ = [
    order({ id: "a", saljare: SALJARE, signerad: "2026-09-05", belopp: 1500, varde: 11940 }),
  ];
  const poster = [chefspost({ order: "a", belopp: 1044, signerad: "2026-09-05" })];

  const lag = underlagForAlla(order_, "2026-09-01", [], new Map(), new Map(), poster);
  ok("Tva personer, inte en", lag.length === 2, `${lag.length}`);
  ok("Saljaren far sin provision", lag.find((u) => u.employee_id === SALJARE)?.summa === 1500);
  ok("Chefen far sitt overtack", lag.find((u) => u.employee_id === CHEF)?.summa === 1044);

  // En post fran en ANNAN manad far inte dra in chefen i den har manadens lista.
  // En rad pa noll kronor i en lagvy ar en person som ser ut att ha misslyckats.
  const marsposter = [chefspost({ order: "gammal", belopp: 900, signerad: "2026-03-04" })];
  const septemberlag = underlagForAlla(order_, "2026-09-01", [], new Map(), new Map(), marsposter);
  ok("En post fran mars drar inte in chefen i september", septemberlag.length === 1);
}

// -----------------------------------------------------------------------------
console.log("\nBokforingen: tva poster, inte ett netto");
{
  const poster = [
    chefspost({ order: "a", belopp: 1044, signerad: "2026-09-05" }),
    chefspost({ order: "b", belopp: 2088, signerad: "2026-09-12" }),
    chefspost({
      order: "c",
      belopp: 500,
      signerad: "2026-08-20",
      makulerad: true,
      makuleradManad: "2026-09-01",
    }),
  ];

  const u = raknaUnderlag(CHEF, [], "2026-09-01", [], null, null, poster);
  const bok = bokforingsposter(u);

  const tillagg = bok.find((p) => p.slag === "chefsprovision");
  const avdrag = bok.find((p) => p.slag === "chefsprovision_makulering");

  ok("Tillagget ar en egen post", tillagg?.belopp === 3132, `${tillagg?.belopp}`);
  ok("Avdraget ar en egen post", avdrag?.belopp === -500, `${avdrag?.belopp}`);
  ok("Antalet foljer med tillagget", tillagg?.antal === 2);
  // `deals` har `check (deals >= 0)` i 0031. Ett negativt antal hade fallt vid
  // insert, mitt i en periodstangning.
  ok("Avdraget bar inget antal", avdrag?.antal === null);
  ok(
    "Bokforingen summerar till underlaget",
    bok.reduce((s, p) => s + p.belopp, 0) === u.summa,
  );
}

// -----------------------------------------------------------------------------
console.log("\nOrdervardet i underlaget");
{
  const rader = [
    order({ id: "a", signerad: "2026-09-05", belopp: 1500, varde: 11940 }),
    order({ id: "b", signerad: "2026-09-12", belopp: 3000, varde: 23880 }),
    // Fran fore 0050: godkand, men utan varde. Bestallarens beslut 2026-09-09.
    order({ id: "gammal", signerad: "2026-09-02", belopp: 1500 }),
  ];

  const v = ordervarde(rader, "2026-09-01");
  ok("Tecknat summeras", v.tecknat === 35820, `${v.tecknat}`);
  ok("Saknade varden RAKNAS, inte summeras", v.utanVarde === 1);
  ok("Netto utan makuleringar ar tecknat", v.netto === 35820);

  const medMakulering = [
    ...rader,
    order({
      id: "c",
      signerad: "2026-08-20",
      belopp: 1500,
      varde: 11940,
      status: "makulerad",
      makuleradManad: "2026-09-01",
    }),
  ];
  const v2 = ordervarde(medMakulering, "2026-09-01");
  ok("Makuleringen dras i sin EGEN manad", v2.netto === 23880, `${v2.netto}`);
  ok("...och det tecknade star kvar", v2.tecknat === 35820);

  // Augusti rors inte: ordern bidrog dar och drar tillbaka i september.
  const aug = ordervarde(medMakulering, "2026-08-01");
  ok("Augusti bar sitt tecknade varde", aug.tecknat === 11940);

  const u = raknaUnderlag(SALJARE, rader, "2026-09-01");
  ok("Underlaget bar vardet", u.ordervarde.netto === 35820);
  // Det viktigaste provet i hela filen: ordervardet ar bolagets omsattning och
  // inte pengar till nagon. Slinker det in i `summa` mangdubblas lonekostnaden.
  ok("ORDERVARDET LIGGER ALDRIG I `summa`", u.summa === 6000, `${u.summa}`);
}

console.log(
  fel === 0
    ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m\n"
    : `\n\x1b[31m${fel} prov misslyckades.\x1b[0m\n`,
);
process.exit(fel === 0 ? 0 : 1);
