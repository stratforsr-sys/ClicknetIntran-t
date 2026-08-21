#!/usr/bin/env node
/**
 * E8.7 / AC-6.7: rollspelets rakning och rubrikformat.
 *
 *   node --experimental-strip-types tests/rollspel.mjs
 *
 * Behorigheten och sparren mot att bedoma utan att ha oppnat inspelningen
 * provas mot riktiga databasen i tests/rls.mjs.
 */
import {
  MAX_POANG,
  STANDARDPOANG,
  lageFor,
  procent,
  skrivKriterier,
  tolkaKriterier,
} from "../src/lib/rollspel.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

rubrik("Rubriken skrivs som text");
const enkel = tolkaKriterier("Behovsanalys | 5 | Staller minst tre oppna fragor");
ok("rubrik, tak och vagledning tolkas", enkel.kriterier[0]?.label === "Behovsanalys");
ok("taket tolkas", enkel.kriterier[0]?.max_points === 5);
ok("vagledningen tolkas", enkel.kriterier[0]?.guidance === "Staller minst tre oppna fragor");

ok("taket kan utelamnas", tolkaKriterier("Avslut").kriterier[0]?.max_points === STANDARDPOANG);
ok("vagledningen kan utelamnas", tolkaKriterier("Avslut | 3").kriterier[0]?.guidance === null);
ok("flera rader ger flera kriterier", tolkaKriterier("Ett\nTva\nTre").kriterier.length === 3);
ok("tomma rader hoppas over", tolkaKriterier("Ett\n\n\nTva").kriterier.length === 2);
ok("tom text ger tom rubrik utan fel", tolkaKriterier("").fel === null);

rubrik("Vad som nekas");
ok("rad utan rubrik nekas", Boolean(tolkaKriterier(" | 5 | text").fel));
ok("poangtak som inte ar ett tal nekas", Boolean(tolkaKriterier("Ett | tva").fel));
ok("poangtak over taket nekas", Boolean(tolkaKriterier(`Ett | ${MAX_POANG + 1}`).fel));
ok("poangtak noll nekas", Boolean(tolkaKriterier("Ett | 0").fel));
ok("decimaltal nekas", Boolean(tolkaKriterier("Ett | 2.5").fel));
ok("fler an tjugo kriterier nekas", Boolean(tolkaKriterier(Array.from({length: 21}, (_, i) => `K${i}`).join("\n")).fel));
// Ett fel ska aldrig ge halva rubriken tillbaka. En delvis tolkad rubrik hade
// sparats som en hel.
ok("ett fel ger inga kriterier alls", tolkaKriterier("Bra\nDalig | tva").kriterier.length === 0);

rubrik("Fram och tillbaka");
const text = "Behovsanalys | 5 | Staller minst tre oppna fragor\nAvslut | 3";
ok("texten overlever en runda", skrivKriterier(tolkaKriterier(text).kriterier) === text);

rubrik("Poang till procent");
const krit = [
  { id: "a", max_points: 5 },
  { id: "b", max_points: 5 },
];
ok("allt ratt ger 100", procent(krit, { a: 5, b: 5 }) === 100);
ok("halva ger 50", procent(krit, { a: 5, b: 0 }) === 50);
ok("inget ger 0", procent(krit, {}) === 0);
ok("olika tak vagas mot varandra", procent([{ id: "a", max_points: 8 }, { id: "b", max_points: 2 }], { a: 8, b: 0 }) === 80);
ok("avrundas till heltal", procent([{ id: "a", max_points: 3 }], { a: 1 }) === 33);

// Poang over taket ska inte kunna lyfta resultatet over hundra — servern
// nekar det redan, men rakningen ska inte forlita sig pa det.
ok("poang over taket klipps", procent(krit, { a: 50, b: 5 }) === 100);
ok("negativa poang klipps", procent(krit, { a: -5, b: 5 }) === 50);

// Ett rollspel utan rubrik ska inte bli godkant av misstag.
ok("rubrik utan kriterier ger 0, inte 100", procent([], { a: 5 }) === 0);

rubrik("Laget raknas fram ur historiken");
ok("inget inlamnat", lageFor([]) === "ej_inlamnat");
ok("inlamnat men obedomt", lageFor([{ submitted_at: "2026-08-01", graded_at: null, passed: null }]) === "vantar");
ok("godkant", lageFor([{ submitted_at: "2026-08-01", graded_at: "2026-08-02", passed: true }]) === "godkant");
ok("underkant", lageFor([{ submitted_at: "2026-08-01", graded_at: "2026-08-02", passed: false }]) === "underkant");

// Den senaste galler, oavsett vilken ordning raderna kommer i. Ett underkant
// forsok skrivs aldrig over — det ligger kvar som historik.
ok(
  "senaste inlamningen avgor, aven om aldre kommer forst",
  lageFor([
    { submitted_at: "2026-08-01", graded_at: "2026-08-02", passed: false },
    { submitted_at: "2026-08-10", graded_at: null, passed: null },
  ]) === "vantar",
);
ok(
  "ett godkant efter ett underkant galler",
  lageFor([
    { submitted_at: "2026-08-10", graded_at: "2026-08-11", passed: true },
    { submitted_at: "2026-08-01", graded_at: "2026-08-02", passed: false },
  ]) === "godkant",
);

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m" : `\n\x1b[31m${fel} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
