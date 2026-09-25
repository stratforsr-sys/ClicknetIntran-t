#!/usr/bin/env node
/**
 * Kundordern. Fyra saker star pa spel och provas at bada hallen:
 *
 *   1. SATSUPPSLAGET. Uppslaget sker pa signeringsdatumet, inte pa dagens
 *      datum. Gar det fel andrar en ny sats vad nagon redan tjanat.
 *   2. MAKULERINGSMANADEN. En order fran mars som makuleras i augusti ska riva
 *      AUGUSTI. Blandas de tva ihop skrivs en stangd period om.
 *   3. STEGMATRISEN. Listan star bade har och i triggern i 0034. Provet kor
 *      hela matrisen sa att den dag de glider isar faller det har, inte i
 *      produktionen.
 *   4. ORGNUMRET. K27-undantaget: en enskild firmas personnummer MASTE ga
 *      igenom, annars gar en laglig kund inte att lagga in.
 *
 *   node --experimental-strip-types tests/order.mjs
 */
import {
  ORDERSTATUSAR,
  OVERGANGAR,
  gallandeSats,
  garOvergang,
  giltigTelefon,
  giltigtSigneringsdatum,
  grundprovision,
  harStangdPeriod,
  makuleradeIPeriod,
  manaderMedOrder,
  nettoAntal,
  normaliseraOrgnr,
  orderIPeriod,
  periodFor,
  provisionFor,
  raknas,
  AVTALSSLUT_VARSEL_DAGAR,
  BINDNINGSTID_MAX,
  BINDNINGSTID_MIN,
  affarensVarde,
  avtalsslut,
  bevakas,
  dagarTill,
  giltigBindningstid,
  tjanstensSlut,
  tjanstensVarde,
} from "../src/lib/order.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(
    `  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`,
  );
  if (!villkor) fel++;
};

// Bestallarens matris ur 0034. Star har for att provet ska ga att lasa; motorn
// far den som argument och kanner inga tal sjalv.
const SATSER = [
  { id: "r1", package_id: 1, term_months: 12, amount: 1500, valid_from: "2026-08-01", valid_to: null },
  { id: "r2", package_id: 1, term_months: 24, amount: 3000, valid_from: "2026-08-01", valid_to: null },
  { id: "r3", package_id: 1, term_months: 36, amount: 4500, valid_from: "2026-08-01", valid_to: null },
  { id: "r4", package_id: 2, term_months: 12, amount: 2500, valid_from: "2026-08-01", valid_to: null },
  { id: "r5", package_id: 2, term_months: 24, amount: 4000, valid_from: "2026-08-01", valid_to: null },
  { id: "r6", package_id: 2, term_months: 36, amount: 5500, valid_from: "2026-08-01", valid_to: null },
  { id: "r7", package_id: 3, term_months: 12, amount: 3500, valid_from: "2026-08-01", valid_to: null },
  { id: "r8", package_id: 3, term_months: 24, amount: 5000, valid_from: "2026-08-01", valid_to: null },
  { id: "r9", package_id: 3, term_months: 36, amount: 6500, valid_from: "2026-08-01", valid_to: null },
];

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
  // Ordervardet kom till 2026-09-09 (0050). `undefined` blir null och inte 0:
  // en order UTAN varde ar nagot annat an en order vard noll kronor, och
  // `ordervarde()` raknar de forsta i stallet for att summera dem.
  order_value: o.varde === undefined ? null : o.varde,
  cancel_period_month: o.makuleradManad ?? null,
});

console.log("\nSatsuppslaget");
{
  ok("paket 1, 12 man ger 1500", provisionFor(SATSER, 1, 12, "2026-08-14") === 1500);
  ok("paket 2, 24 man ger 4000", provisionFor(SATSER, 2, 24, "2026-08-14") === 4000);
  ok("paket 3, 36 man ger 6500", provisionFor(SATSER, 3, 36, "2026-08-14") === 6500);

  ok(
    "hela matrisen stammer",
    [
      [1, 12, 1500], [1, 24, 3000], [1, 36, 4500],
      [2, 12, 2500], [2, 24, 4000], [2, 36, 5500],
      [3, 12, 3500], [3, 24, 5000], [3, 36, 6500],
    ].every(([p, l, v]) => provisionFor(SATSER, p, l, "2026-08-14") === v),
  );

  ok(
    "sats som inte borjat galla ger null, inte noll",
    provisionFor(SATSER, 1, 12, "2026-07-31") === null,
  );

  ok("okand kombination ger null", provisionFor(SATSER, 1, 18, "2026-08-14") === null);
}

console.log("\nVersioneringen: en ny sats andrar inte det som redan salts");
{
  const versionerat = [
    { id: "g", package_id: 1, term_months: 12, amount: 1500, valid_from: "2026-08-01", valid_to: "2026-10-01" },
    { id: "n", package_id: 1, term_months: 12, amount: 1800, valid_from: "2026-10-01", valid_to: null },
  ];

  ok("augusti far gamla satsen", provisionFor(versionerat, 1, 12, "2026-08-14") === 1500);
  ok("30 september far gamla satsen", provisionFor(versionerat, 1, 12, "2026-09-30") === 1500);
  ok("1 oktober far den nya", provisionFor(versionerat, 1, 12, "2026-10-01") === 1800);

  // valid_to ar EXKLUSIVT. Gar den granskontrollen fel tillhor den 1 oktober
  // antingen bada raderna eller ingen.
  ok(
    "skarven har varken glapp eller overlapp",
    gallandeSats(versionerat, 1, 12, "2026-10-01")?.id === "n" &&
      gallandeSats(versionerat, 1, 12, "2026-09-30")?.id === "g",
  );
}

console.log("\nPerioden kommer ur signeringsdatumet");
{
  ok("14 augusti hor till augusti", periodFor("2026-08-14") === "2026-08-01");
  ok("1 augusti hor till augusti", periodFor("2026-08-01") === "2026-08-01");
  ok("31 augusti hor till augusti", periodFor("2026-08-31") === "2026-08-01");
}

console.log("\nMakuleringen belastar makuleringsmanaden");
{
  // Bestallarens eget exempel: en order fran mars som makuleras i augusti ska
  // riva augusti, inte mars.
  const rader = [
    order({ id: "a", signerad: "2026-03-10", status: "makulerad", belopp: 3000, makuleradManad: "2026-08-01" }),
    order({ id: "b", signerad: "2026-08-05", belopp: 1500 }),
    order({ id: "c", signerad: "2026-08-07", belopp: 2500 }),
  ];

  // MARS STAR KVAR PA SITT EGET TAL. Ordern signerades dar och gav provision
  // dar; makuleringen ar ett avdrag i AUGUSTI. Att lata makuleringen rensa bort
  // signeringsbidraget hade raknat om en stangd period — precis det avsnitt 4.4
  // sager aldrig far ske. Provet lag fel till 2026-08-25.
  ok("mars behaller sin signerade order", orderIPeriod(rader, "2026-03-01").length === 1);
  ok("mars star kvar pa 3000", grundprovision(rader, "2026-03-01") === 3000);

  ok("augusti har tva signerade", orderIPeriod(rader, "2026-08-01").length === 2);
  ok("makuleringen ligger i augusti", makuleradeIPeriod(rader, "2026-08-01").length === 1);
  ok("mars belastas inte av makuleringen", makuleradeIPeriod(rader, "2026-03-01").length === 0);

  ok("augusti nettoantal blir 1", nettoAntal(rader, "2026-08-01") === 1);
  ok("augusti grundprovision blir 1000", grundprovision(rader, "2026-08-01") === 1500 + 2500 - 3000);
}

console.log("\nSignerad och makulerad i SAMMA manad tar ut varandra");
{
  // Bagge handelserna ligger i augusti: +1500 nar den godkandes, -1500 nar den
  // makulerades. Netto noll. Raknas bara avdraget bokfors pengar tillbaka som
  // aldrig betalades ut.
  const rader = [
    order({ id: "a", signerad: "2026-08-05", status: "makulerad", belopp: 1500, makuleradManad: "2026-08-01" }),
    order({ id: "b", signerad: "2026-08-06", belopp: 2500 }),
  ];

  ok("nettoantalet blir 1, inte 0", nettoAntal(rader, "2026-08-01") === 1);
  ok("grundprovisionen blir 2500, inte 1000", grundprovision(rader, "2026-08-01") === 2500);

  const bara = [rader[0]];
  ok("en ensam sadan order ger 0, inte -1500", grundprovision(bara, "2026-08-01") === 0);
  ok("och nettoantalet 0, inte -1", nettoAntal(bara, "2026-08-01") === 0);
}

console.log("\nFler makuleringar an order ger ett negativt saldo");
{
  const rader = [
    order({ id: "a", signerad: "2026-03-10", status: "makulerad", belopp: 3000, makuleradManad: "2026-08-01" }),
    order({ id: "b", signerad: "2026-03-11", status: "makulerad", belopp: 1500, makuleradManad: "2026-08-01" }),
  ];

  // Talet ar negativt med flit. Bonusnivan blir noll i steg 3, men avdraget
  // sker anda — pengarna ska tillbaka.
  ok("nettoantalet blir -2", nettoAntal(rader, "2026-08-01") === -2);
  ok("provisionen blir -4500", grundprovision(rader, "2026-08-01") === -4500);
}

console.log("\nStatus avgor vad som raknas");
{
  ok("signerad raknas", raknas("signerad"));
  ok("betald raknas", raknas("betald"));
  ok("utkast raknas inte", !raknas("utkast"));
  ok("inskickad raknas INTE", !raknas("inskickad"), "vantar pa godkannande");
  ok("makulerad raknas inte", !raknas("makulerad"));

  const rader = [
    order({ signerad: "2026-08-02", status: "utkast" }),
    order({ signerad: "2026-08-03", status: "inskickad" }),
    order({ signerad: "2026-08-04", status: "signerad", belopp: 1500 }),
    order({ signerad: "2026-08-05", status: "betald", belopp: 2500 }),
  ];

  ok("bara godkanda raknas i perioden", orderIPeriod(rader, "2026-08-01").length === 2);
  ok("summan blir 4000", grundprovision(rader, "2026-08-01") === 4000);
}

console.log("\nStegmatrisen — samma lista som triggern i 0034");
{
  const VANTAT = {
    utkast: ["inskickad", "signerad"],
    inskickad: ["utkast", "signerad"],
    signerad: ["betald", "makulerad"],
    betald: ["makulerad"],
    makulerad: [],
  };

  for (const fran of ORDERSTATUSAR) {
    for (const till of ORDERSTATUSAR) {
      const vantat = VANTAT[fran].includes(till);
      ok(
        `${fran} -> ${till} ${vantat ? "tillatet" : "nekas"}`,
        garOvergang(fran, till) === vantat,
      );
    }
  }

  ok(
    "makulerad ar en atervandsgrand",
    OVERGANGAR.makulerad.length === 0,
    "annars forsvinner avdraget ur makuleringsmanaden",
  );
}

console.log("\nOrganisationsnummer — K27-undantaget");
{
  ok("med bindestreck", normaliseraOrgnr("556677-8899") === "556677-8899");
  ok("utan bindestreck", normaliseraOrgnr("5566778899") === "556677-8899");
  ok("med mellanslag", normaliseraOrgnr("556677 8899") === "556677-8899");

  // Det har ar hela poangen med undantaget: en enskild firma har personnummer
  // som organisationsnummer. Nekas formatet gar kunden inte att lagga in.
  ok(
    "enskild firma med personnummer gar igenom",
    normaliseraOrgnr("850101-1234") === "850101-1234",
  );
  ok("tolv siffror kortas till tio", normaliseraOrgnr("198501011234") === "850101-1234");

  ok("for kort nekas", normaliseraOrgnr("5566") === null);
  ok("tom strang nekas", normaliseraOrgnr("") === null);
  ok("bokstaver nekas", normaliseraOrgnr("abcdef-ghij") === null);
}

console.log("\nTelefon och signeringsdatum");
{
  ok("vanligt mobilnummer", giltigTelefon("070-123 45 67"));
  ok("med landskod", giltigTelefon("+46 70 123 45 67"));
  ok("vaxel med parentes", giltigTelefon("+46 (0)8 123 456"));
  ok("for fa siffror nekas", !giltigTelefon("12345"));
  ok("bokstaver nekas", !giltigTelefon("ring mig"));

  ok("dagens datum gar igenom", giltigtSigneringsdatum("2026-08-25", "2026-08-25"));
  ok("bakat i tiden gar igenom", giltigtSigneringsdatum("2026-03-01", "2026-08-25"));
  ok(
    "framtida signering nekas",
    !giltigtSigneringsdatum("2026-09-01", "2026-08-25"),
    "en prognos ar inte en intjaning",
  );
  ok("fel format nekas", !giltigtSigneringsdatum("2026-8-1", "2026-08-25"));
}

console.log("\nManadslistan");
{
  const rader = [
    order({ signerad: "2026-08-05", belopp: 1500 }),
    order({ signerad: "2026-06-05", belopp: 1500 }),
    order({ signerad: "2026-03-10", status: "makulerad", belopp: 3000, makuleradManad: "2026-08-01" }),
    order({ signerad: "2026-07-01", status: "utkast" }),
  ];

  const m = manaderMedOrder(rader);
  ok("nyast forst", m[0] === "2026-08-01");
  ok("utkastets manad kommer inte med", !m.includes("2026-07-01"));
  ok("makuleringsmanaden kommer med", m.includes("2026-08-01"));

  // MARS AR MED, och det ar ratt: ordern tjanades in dar. Att makuleringen
  // ligger i augusti tar inte bort manaden ur historiken — den som tjanade
  // 3000 kr i mars ska se mars i sin lista. Provet lag fel till 2026-08-25.
  ok("signeringsmanaden finns kvar aven efter makulering", m.includes("2026-03-01"));
  ok("tre manader totalt", m.length === 3, m.join(", "));
}

// -----------------------------------------------------------------------------
console.log("\nOrder som hinner bli godkand for sent (O11)");
{
  const stangda = ["2026-06-01", "2026-07-01", "2026-08-01"];

  // Fallet som hande pa riktigt 2026-09-08: signerad 25 augusti, godkand den
  // 8 september, tva timmar efter att augusti faststallts.
  ok("augustiorder nar augusti ar stangd", harStangdPeriod("2026-08-25", stangda));
  ok("den 1:a i en stangd manad ocksa", harStangdPeriod("2026-08-01", stangda));
  ok("den sista i en stangd manad ocksa", harStangdPeriod("2026-08-31", stangda));

  // DAGEN AVGOR INGENTING, MANADEN GOR DET. Det ar `periodFor` som ar regeln,
  // och den bygger pa signeringsdatumet — inte pa nar nagon godkande.
  ok("septemberorder ar fri", !harStangdPeriod("2026-09-01", stangda));
  ok("majorder ar fri, den manaden ar inte stangd", !harStangdPeriod("2026-05-20", stangda));

  ok("utan stangda manader ar allt fritt", !harStangdPeriod("2026-08-25", []));

  // En Set duger lika bra som en lista — anroparen ska inte behova valja form.
  ok("tar emot en Set", harStangdPeriod("2026-07-15", new Set(stangda)));
}

// -----------------------------------------------------------------------------
console.log("\nAvtalsslutet (0068)");
{
  // Det vanliga fallet.
  ok("tolv manader fran 24 september", avtalsslut("2026-09-24", 12) === "2027-09-24");
  ok("tjugofyra manader", avtalsslut("2026-09-24", 24) === "2028-09-24");
  ok("arsskiftet gar over", avtalsslut("2026-11-30", 3) === "2027-02-28");

  // ===========================================================================
  // MANADSSKIFTET KLIPPS. Provat mot Postgres `make_interval` innan raden
  // skrevs: 31 januari plus en manad ar 28 februari, inte 3 mars.
  //
  // Det ar precis det JavaScripts `setMonth` gor fel, och skulle nagon skriva
  // om funktionen till en rad faller den har.
  // ===========================================================================
  ok("31 januari + 1 manad blir 28 februari", avtalsslut("2026-01-31", 1) === "2026-02-28");
  ok("31 mars + 1 manad blir 30 april", avtalsslut("2026-03-31", 1) === "2026-04-30");
  ok("31 augusti + 6 manader blir 28 februari", avtalsslut("2026-08-31", 6) === "2027-02-28");

  // Skottaret: 2028 ar ett, sa den 29:e finns.
  ok("31 januari 2028 + 1 manad blir 29 februari", avtalsslut("2028-01-31", 1) === "2028-02-29");

  // En dag som finns i bada manaderna ror sig inte.
  ok("den 15:e klipps aldrig", avtalsslut("2026-01-15", 1) === "2026-02-15");

  ok("en manad ar minsta bindningstid", giltigBindningstid(BINDNINGSTID_MIN));
  ok("sextio ar storsta", giltigBindningstid(BINDNINGSTID_MAX));
  ok("noll manader ar inget avtal", !giltigBindningstid(0));
  ok("sextioen nekas", !giltigBindningstid(61));
  ok("halva manader nekas", !giltigBindningstid(18.5));
  ok("arton manader gar bra nu", giltigBindningstid(18), "det gjorde det inte fore 0068");
}

// -----------------------------------------------------------------------------
console.log("\nBevakningen: nar navet sager till");
{
  const idag = "2026-09-24";

  ok("nittio dagars varsel", AVTALSSLUT_VARSEL_DAGAR === 90);
  ok("dagar till i morgon ar ett", dagarTill("2026-09-25", idag) === 1);
  ok("dagar till i gar ar minus ett", dagarTill("2026-09-23", idag) === -1);
  ok("dagar till i dag ar noll", dagarTill(idag, idag) === 0);

  // Sommartidsomstallningen 25 oktober ligger inne i spannet. Raknas dygnen
  // fran midnatt i stallet for mitt pa dagen blir ett av dem 23 eller 25 timmar,
  // och svaret hamnar en dag fel.
  ok("over sommartidsomstallningen", dagarTill("2026-11-01", "2026-10-01") === 31);

  ok("slutet ligger langt bort", !bevakas("2027-06-01", false, idag));
  ok("nittioen dagar kvar ar for tidigt", !bevakas("2026-12-24", false, idag));
  ok("nittio dagar kvar tander posten", bevakas("2026-12-23", false, idag));
  ok("en vecka kvar", bevakas("2026-10-01", false, idag));

  // ===========================================================================
  // ETT AVTAL SOM REDAN LOPT UT STAR KVAR I LISTAN.
  //
  // Frestelsen ar att slacka posten pa slutdatumet. Men det ar da den betyder
  // mest: kunden ar fortfarande kund, och det enda som hant ar att ingen ringde
  // i tid.
  // ===========================================================================
  ok("utgangna avtal star kvar", bevakas("2026-08-01", false, idag));
  ok("ett ar for sent star ocksa kvar", bevakas("2025-09-24", false, idag));

  // Det som slacker posten ar ett UTFALL, inte att tiden gatt.
  ok("hanterad slacker posten", !bevakas("2026-10-01", true, idag));
  ok("hanterad slacker aven ett utgangret avtal", !bevakas("2025-09-24", true, idag));
  ok("utan slutdatum ingen post", !bevakas(null, false, idag));
}

// -----------------------------------------------------------------------------
console.log("\nTillaggstjanster (0068)");
{
  const manadstjanst = {
    name: "Extra nummer",
    billing: "manad",
    amount: 199,
    follows_order: true,
    term_months: null,
    starts_on: null,
  };

  const engangstjanst = {
    name: "Installation",
    billing: "engang",
    amount: 4000,
    follows_order: false,
    term_months: null,
    starts_on: null,
  };

  const egenBindning = {
    name: "Växel",
    billing: "manad",
    amount: 500,
    follows_order: false,
    term_months: 36,
    starts_on: "2026-10-01",
  };

  // ===========================================================================
  // EN ENGANGSAVGIFT GANGES INTE MED NAGOT.
  //
  // Skrevs de tva likadant blev installationen pa 4 000 kr vard 96 000 kr pa
  // ett tvaarsavtal — och det talet gar rakt in i provisionsunderlaget.
  // ===========================================================================
  ok("engangsavgiften ar hela summan", tjanstensVarde(engangstjanst, 24) === 4000);
  ok("engangsavgiften ror sig inte med loptiden", tjanstensVarde(engangstjanst, 36) === 4000);

  ok("manadstjanst som foljer ordern", tjanstensVarde(manadstjanst, 24) === 199 * 24);
  ok("samma tjanst pa ett kortare avtal", tjanstensVarde(manadstjanst, 12) === 199 * 12);
  ok("egen bindningstid raknar pa sin egen", tjanstensVarde(egenBindning, 12) === 500 * 36);

  // Slutdatumet: bara en manadstjanst med EGEN bindningstid har ett eget.
  ok("engangsavgiften tar aldrig slut", tjanstensSlut(engangstjanst) === null);
  ok("den som foljer ordern har inget eget slut", tjanstensSlut(manadstjanst) === null);
  ok("egen bindningstid ger eget slut", tjanstensSlut(egenBindning) === "2029-10-01");

  // ---------------------------------------------------------------------------
  // Hela affaren. Talet gar in i `order_value` och darmed i provisionen.
  // ---------------------------------------------------------------------------
  ok("utan tjanster ar det bara avtalet", affarensVarde(995, 12) === 11940);
  ok(
    "med tre tjanster",
    affarensVarde(995, 24, [manadstjanst, engangstjanst, egenBindning]) ===
      995 * 24 + 199 * 24 + 4000 + 500 * 36,
  );
  ok("en tom lista andrar ingenting", affarensVarde(995, 12, []) === 11940);
}

console.log(fel === 0 ? "\n\x1b[32mAllt gront.\x1b[0m\n" : `\n\x1b[31m${fel} fel.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
