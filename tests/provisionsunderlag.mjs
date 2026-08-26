#!/usr/bin/env node
/**
 * Det separata provisionsunderlaget (E13 steg 7, O10).
 *
 * Filen LAMNAR HUSET, sa formatet ar inte en detalj:
 *
 *   1. SEMIKOLON OCH BOM. Svensk Excel oppnar filen utan importguide. Utan BOM
 *      blir varje a och o fel i rubrikraden, och det ser ut som ett fel i navet.
 *   2. KOMMA SOM DECIMALTECKEN, ASCII-MINUS. `kronor()` skriver U+2212 och hart
 *      mellanslag — ratt i en vy, obrukbart i ett kalkylblad. Provet kraver att
 *      exporten INTE anvander den.
 *   3. EN SUMMARAD PER PERSON, och den ar exakt summan av personens poster.
 *      Glider de isar betalar lonekorningen ut ett tal ingen kan forklara.
 *   4. NOLLPOSTER FALLER BORT, NOLLPERSONER GOR DET INTE. En person vars manad
 *      gar ihop till noll ska synas — hen ar raknad, inte glomd.
 *   5. UTBETALNINGSMANADEN ar manaden efter intjanandemanaden (fraga 58).
 *
 *   node --experimental-strip-types tests/provisionsunderlag.mjs
 */
import {
  EXPORTKOLUMNER,
  byggUnderlag,
  csvUnderlag,
  filnamn,
  totalt,
  utbetalningsmanad,
} from "../src/lib/provisionsunderlag.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(
    `  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`,
  );
  if (!villkor) fel++;
};

const person = (p) => ({
  employee_id: p.id,
  namn: p.namn,
  anstallningsnummer: p.nummer ?? "",
  poster: p.poster ?? [],
  summa: (p.poster ?? []).reduce((s, r) => s + r.belopp, 0),
});

console.log("\nUtbetalningsmanaden ar manaden efter");
{
  ok("augusti betalas i september", utbetalningsmanad("2026-08-01") === "2026-09-01");
  ok("december betalas i januari", utbetalningsmanad("2026-12-01") === "2027-01-01");
}

console.log("\nNollposter faller bort, nollpersoner star kvar");
{
  const dok = byggUnderlag("2026-08-01", true, [
    person({
      id: "a",
      namn: "Anna Ek",
      poster: [
        { slag: "order", text: "Grundprovision, 3 order", belopp: 4500 },
        { slag: "avdrag", text: "Ingenting", belopp: 0 },
      ],
    }),
    person({
      id: "b",
      namn: "Bo Lind",
      poster: [
        { slag: "order", text: "Grundprovision, 1 order", belopp: 1500 },
        { slag: "makulering", text: "Makulering, 1 order", belopp: -1500 },
      ],
    }),
  ]);

  ok("nollposten ar borta", dok.personer[0].poster.length === 1);
  ok("bada personerna star kvar", dok.personer.length === 2);
  ok("nollpersonen har sina tva poster", dok.personer[1].poster.length === 2);
  ok("och summan noll", dok.personer[1].summa === 0);
  ok("totalen ar 4500", dok.summa === 4500);
}

console.log("\nSorteringen ar pa namn, inte pa belopp");
{
  const dok = byggUnderlag("2026-08-01", true, [
    person({ id: "c", namn: "Örjan Ås", poster: [{ slag: "order", text: "x", belopp: 9000 }] }),
    person({ id: "a", namn: "Anna Ek", poster: [{ slag: "order", text: "y", belopp: 100 }] }),
  ]);

  // En lista som sorterar personer efter vad de tjanat ar en rangordning, och
  // det ar inte vad ett loneunderlag ar till for.
  ok("Anna forst", dok.personer[0].namn === "Anna Ek");
  ok("O sorteras sist enligt svensk kollation", dok.personer[1].namn === "Örjan Ås");
}

console.log("\nFormatet pa filen");
{
  const dok = byggUnderlag("2026-08-01", true, [
    person({
      id: "a",
      namn: "Anna Ek",
      nummer: "1042",
      poster: [
        { slag: "order", text: "Grundprovision, 3 order", belopp: 4500 },
        { slag: "makulering", text: "Makulering, 1 order", belopp: -1500.5 },
      ],
    }),
  ]);

  const fil = csvUnderlag(dok);
  const rader = fil.split("\r\n");

  ok("filen borjar med BOM", fil.startsWith("﻿"));
  ok("rubrikraden har alla kolumner", rader[0].endsWith(EXPORTKOLUMNER.join(";")));
  ok("radbrytningen ar CRLF", fil.includes("\r\n"));

  ok("beloppet skrivs med komma", rader[1].endsWith(";4500,00"), rader[1]);
  ok("minus ar ASCII-bindestreck", rader[2].endsWith(";-1500,50"), rader[2]);
  ok(
    "ingen U+2212 nagonstans i filen",
    !fil.includes("−"),
    "kronor() far inte anvandas i en export",
  );
  ok("inga harda mellanslag", !fil.includes(" "));

  // Summaraden: sista raden fore den avslutande tomma.
  const summarad = rader[3];
  ok("en summarad per person", summarad.includes(";summa;"), summarad);
  ok("summan ar postsummans exakta varde", summarad.endsWith(";2999,50"), summarad);

  ok("anstallningsnumret star forst", rader[1].startsWith("1042;"));
  ok("intjanandemanad och utbetalningsmanad star pa varje rad", rader[1].includes("2026-08-01;2026-09-01;"));
}

console.log("\nCeller med semikolon citeras");
{
  const dok = byggUnderlag("2026-08-01", true, [
    person({
      id: "a",
      namn: "Ek; Anna",
      poster: [{ slag: "order", text: 'Order "stor"', belopp: 100 }],
    }),
  ]);

  const fil = csvUnderlag(dok);
  ok("semikolon i ett namn citeras", fil.includes('"Ek; Anna"'));
  ok("citattecken dubbleras", fil.includes('"Order ""stor"""'));
}

console.log("\nFilnamnet sager om underlaget ar preliminart");
{
  const stangd = byggUnderlag("2026-08-01", true, []);
  const oppen = byggUnderlag("2026-08-01", false, []);

  ok("faststalld manad", filnamn(stangd) === "provisionsunderlag-2026-08.csv");
  ok("oppen manad markeras", filnamn(oppen) === "provisionsunderlag-2026-08-preliminart.csv");
  ok("och laget star i dokumentet", oppen.faststalld === false && stangd.faststalld === true);
}

console.log("\nTotalen ar summan av personernas summor och ingenting annat");
{
  const personer = [
    person({ id: "a", namn: "A", poster: [{ slag: "order", text: "x", belopp: 1000 }] }),
    person({ id: "b", namn: "B", poster: [{ slag: "order", text: "y", belopp: -250 }] }),
  ];
  ok("negativt raknas med", totalt(personer) === 750);
  ok("tom lista ger noll", totalt([]) === 0);
}

console.log(fel === 0 ? "\n\x1b[32mAllt gront.\x1b[0m\n" : `\n\x1b[31m${fel} fel.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
