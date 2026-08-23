#!/usr/bin/env node
/**
 * Provisionens summering. Tva saker star pa spel och provas at bada hallen:
 *
 *   1. RATTELSEN. Tabellen ar append-only och en rattelse ar en negativ post.
 *      Gar summeringen fel dar visar navet ett belopp ingen kan forklara.
 *   2. MANADSGRANSEN. En post far inte glida in i fel manad, och en framtida
 *      manad far inte ga att bokfora alls.
 *
 *   node --experimental-strip-types tests/provision.mjs
 */
import {
  giltigManad,
  kronor,
  manadFore,
  manader,
  manadsnyckel,
  sammanfatta,
  summera,
  tolkaBelopp,
} from "../src/lib/provision.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

const p = (manad, belopp, deals = null) => ({ period_month: manad, amount: belopp, deals });

console.log("\n\x1b[1mMånadsnyckeln\x1b[0m");
ok("mitt i månaden ger den första", manadsnyckel("2026-08-17") === "2026-08-01");
ok("en Date räknas i svensk tid", manadsnyckel(new Date("2026-08-01T00:30:00+02:00")) === "2026-08-01");
ok(
  "och midnatt svensk tid hamnar inte i månaden innan",
  manadsnyckel(new Date("2026-09-01T00:30:00+02:00")) === "2026-09-01",
);
ok("en månad bakåt", manadFore("2026-08-01") === "2026-07-01");
ok("över ett årsskifte", manadFore("2026-01-01") === "2025-12-01");
ok("elva månader bakåt", manadFore("2026-08-01", 11) === "2025-09-01");
ok("och framåt med negativt steg", manadFore("2026-12-01", -1) === "2027-01-01");

console.log("\n\x1b[1mSummeringen\x1b[0m");
{
  const poster = [p("2026-08-01", 12000, 4), p("2026-08-01", 3000, 1), p("2026-07-01", 9000, 3)];
  const aug = summera(poster, "2026-08-01");
  ok("två poster i samma månad läggs ihop", aug.belopp === 15000, String(aug.belopp));
  ok("affärerna läggs ihop också", aug.affarer === 5, String(aug.affarer));
  ok("antalet poster räknas", aug.poster === 2, String(aug.poster));
  ok("en annan månad rörs inte", summera(poster, "2026-07-01").belopp === 9000);
  ok("en tom månad ger noll", summera(poster, "2026-06-01").belopp === 0);
  ok("och noll poster", summera(poster, "2026-06-01").poster === 0);
}

console.log("\n\x1b[1mRättelsen är en negativ post\x1b[0m");
{
  const poster = [p("2026-08-01", 12000, 4), p("2026-08-01", -2000)];
  const aug = summera(poster, "2026-08-01");
  ok("beloppet dras av", aug.belopp === 10000, String(aug.belopp));
  ok("men rättelsen räknas som en post", aug.poster === 2, String(aug.poster));
  ok(
    "en rättelse utan antal ändrar inte affärsantalet",
    aug.affarer === 4,
    String(aug.affarer),
  );

  // Det som INTE far handa: att en rattelse tolkas som en ny sanning och
  // ersatter den gamla posten. Da hade summan blivit -2000.
  ok("summan är inte den sista posten", aug.belopp !== -2000);
}

console.log("\n\x1b[1mAffärsantalet skiljer på noll och okänt\x1b[0m");
{
  ok(
    "ingen post har angett antal ger null",
    summera([p("2026-08-01", 5000)], "2026-08-01").affarer === null,
  );
  ok(
    "en post med noll affärer ger noll, inte null",
    summera([p("2026-08-01", 5000, 0)], "2026-08-01").affarer === 0,
  );
}

console.log("\n\x1b[1mSammanfattningen\x1b[0m");
{
  const poster = [
    p("2026-08-01", 12000, 4),
    p("2026-07-01", 9000, 3),
    p("2026-02-01", 4000, 1),
    p("2025-12-01", 50000, 20),
  ];
  const s = sammanfatta(poster, new Date("2026-08-17T12:00:00+02:00"));
  ok("denna månad", s.denna.belopp === 12000, String(s.denna.belopp));
  ok("förra månaden", s.forra.belopp === 9000, String(s.forra.belopp));
  ok("skillnaden", s.skillnad === 3000, String(s.skillnad));
  ok("i år räknas per kalenderår", s.iAr === 25000, String(s.iAr));
  ok("och tar inte med förra året", s.iAr !== 75000);
}

console.log("\n\x1b[1mHistoriken\x1b[0m");
{
  const rader = manader([p("2026-07-01", 1000), p("2026-08-01", 2000), p("2026-08-01", 500)]);
  ok("en rad per månad", rader.length === 2, String(rader.length));
  ok("nyaste först", rader[0].manad === "2026-08-01");
  ok("med summan", rader[0].belopp === 2500, String(rader[0].belopp));
}

console.log("\n\x1b[1mInmatade belopp\x1b[0m");
ok("vanligt tal", tolkaBelopp("12400") === 12400);
ok("med mellanslag", tolkaBelopp("12 400") === 12400);
ok("med hårt mellanslag", tolkaBelopp("12 400") === 12400);
ok("med komma", tolkaBelopp("12400,50") === 12400.5);
ok("med punkt", tolkaBelopp("12400.50") === 12400.5);
ok("med kr på slutet", tolkaBelopp("12 400 kr") === 12400);
ok("negativt går igenom — det är en rättelse", tolkaBelopp("-2000") === -2000);
ok("noll går igenom här och nekas i handlingen", tolkaBelopp("0") === 0);
ok("bokstäver nekas", tolkaBelopp("tolvtusen") === null);
ok("tomt nekas", tolkaBelopp("") === null);
ok("tre decimaler nekas", tolkaBelopp("100,123") === null);

console.log("\n\x1b[1mGiltig månad\x1b[0m");
{
  const nu = new Date("2026-08-17T12:00:00+02:00");
  ok("innevarande månad", giltigManad("2026-08-01", nu));
  ok("en månad bakåt", giltigManad("2026-07-01", nu));
  ok("nästa månad nekas — det vore en prognos", !giltigManad("2026-09-01", nu));
  ok("mitt i månaden nekas", !giltigManad("2026-08-17", nu));
  ok("månad 13 nekas", !giltigManad("2026-13-01", nu));
  ok("skräp nekas", !giltigManad("augusti", nu));
}

console.log("\n\x1b[1mKronor\x1b[0m");
ok("avrundas till hela kronor", kronor(12400.4).includes("12"));
// sv-SE skriver U+2212 MINUS SIGN, inte ASCII-bindestreck. Det ar ratt
// typografiskt, och det ar precis darfor `tolkaBelopp` maste kanna igen det.
ok("negativt belopp har svenskt minustecken", kronor(-2000).startsWith("−"), kronor(-2000));
ok(
  "ett visat belopp går att klistra tillbaka i formuläret",
  tolkaBelopp(kronor(-2000)) === -2000,
  String(tolkaBelopp(kronor(-2000))),
);
ok(
  "och ett positivt likaså",
  tolkaBelopp(kronor(12400)) === 12400,
  String(tolkaBelopp(kronor(12400))),
);

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller godkända.\x1b[0m\n" : `\n\x1b[31m${fel} underkända.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
