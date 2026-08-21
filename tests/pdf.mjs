#!/usr/bin/env node
/**
 * E2.12: hopfogningen av text ur en PDF.
 *
 *   node --experimental-strip-types tests/pdf.mjs
 *
 * Sjalva pdfjs-anropet ligger i src/lib/pdf.ts, som bar `import "server-only"`
 * och darfor bara gar att ladda inifran Next. Det som har regler att prova ar
 * hopfogningen och avklippet, och de bor i src/lib/pdftext.ts.
 */
import { MAX_TECKEN, sammanfogaSidor } from "../src/lib/pdftext.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

rubrik("Sidorna fogas ihop");
ok(
  "bitarna pa en sida blir en rad",
  sammanfogaSidor([["Prislista", "2026", "for", "sokmotoroptimering"]]) ===
    "Prislista 2026 for sokmotoroptimering",
);
ok(
  "varje sida blir en egen rad",
  sammanfogaSidor([["Sida", "ett"], ["Sida", "tva"]]) === "Sida ett\nSida tva",
);

// pdfjs delar ofta upp text i sma bitar med egna mellanslag i kanterna — en
// sparrad rubrik kan bli ett element per bokstav. Utan kollapsen hade
// tsvectorn fyllts av tomrum, och texten blivit svar att lasa i ett utdrag.
ok(
  "upprepade blanksteg kollapsar",
  sammanfogaSidor([["  Rubrik ", "\n\n", " med   luft  "]]) === "Rubrik med luft",
);
ok("tomma sidor hoppas over", sammanfogaSidor([["Text"], [], ["   "], ["Mer"]]) === "Text\nMer");

rubrik("Nar det inte finns nagon text");
// En inskannad PDF ar bilder utan textlager. Bilagan ska ga att ladda upp
// anda — den blir bara inte sokbar. Null ar alltsa ett svar, inte ett fel.
ok("en inskannad PDF ger null", sammanfogaSidor([[], [], []]) === null);
ok("bara blanksteg ger null", sammanfogaSidor([["   ", "\n"]]) === null);
ok("noll sidor ger null", sammanfogaSidor([]) === null);

rubrik("Avklippet");
// En tsvector tar inte emot mer an 1 MB. Utan avklippet hade en tillrackligt
// lang PDF gjort det omojligt att spara dokumentet over huvud taget.
const langt = sammanfogaSidor(Array.from({ length: 500 }, () => ["x".repeat(1000)]));
ok("langa filer klipps av", langt.length <= MAX_TECKEN, `${langt.length} tecken`);
ok("men texten som ryms finns kvar", langt.startsWith("x".repeat(1000)));

const nastanMax = sammanfogaSidor([["y".repeat(MAX_TECKEN - 10)]]);
ok("strax under gransen klipps inte", nastanMax.length === MAX_TECKEN - 10);

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m" : `\n\x1b[31m${fel} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
