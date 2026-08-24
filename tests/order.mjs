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
  makuleradeIPeriod,
  manaderMedOrder,
  nettoAntal,
  normaliseraOrgnr,
  orderIPeriod,
  periodFor,
  provisionFor,
  raknas,
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

  ok("mars raknar inga signerade order kvar", orderIPeriod(rader, "2026-03-01").length === 0);
  ok("augusti har tva signerade", orderIPeriod(rader, "2026-08-01").length === 2);
  ok("makuleringen ligger i augusti", makuleradeIPeriod(rader, "2026-08-01").length === 1);
  ok("mars belastas inte av makuleringen", makuleradeIPeriod(rader, "2026-03-01").length === 0);

  ok("augusti nettoantal blir 1", nettoAntal(rader, "2026-08-01") === 1);
  ok("augusti grundprovision blir 1000", grundprovision(rader, "2026-08-01") === 1500 + 2500 - 3000);
  ok("mars star oforandrat pa noll", grundprovision(rader, "2026-03-01") === 0);
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
  ok("tva manader totalt", m.length === 2, m.join(", "));
}

console.log(fel === 0 ? "\n\x1b[32mAllt gront.\x1b[0m\n" : `\n\x1b[31m${fel} fel.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
