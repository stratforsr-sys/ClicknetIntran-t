#!/usr/bin/env node
/**
 * 0067: det skriftliga provets rakning, fragformat och lagen.
 *
 *   node --experimental-strip-types tests/prov.mjs
 *
 * Behorigheten — att alla chefer ser alla prov, och att `essay_question` inte
 * gar att lasa for nagon inloggad roll — provas mot riktiga databasen i
 * tests/rls.mjs.
 */
import {
  MAX_PROVFRAGOR,
  MAX_PROVPOANG,
  MINSTA_SVAR,
  PROVPOANG_STANDARD,
  farSkriva,
  ordrakning,
  provlage,
  provprocent,
  rattningslage,
  saknadeSvar,
  skrivProvfragor,
  tolkaProvfragor,
} from "../src/lib/prov.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

rubrik("Frågorna skrivs som text");
const en = tolkaProvfragor("Vad är en säljstruktur? | 2 | Nämner ordningen och syftet");
ok("frågan tolkas", en.fragor[0]?.prompt === "Vad är en säljstruktur?");
ok("taket tolkas", en.fragor[0]?.max_points === 2);
ok("rättarstödet tolkas", en.fragor[0]?.guidance === "Nämner ordningen och syftet");

ok("taket kan utelämnas", tolkaProvfragor("Vad är ett avslut?").fragor[0]?.max_points === PROVPOANG_STANDARD);
ok("rättarstödet kan utelämnas", tolkaProvfragor("Vad är ett avslut? | 3").fragor[0]?.guidance === null);
ok("flera rader ger flera frågor", tolkaProvfragor("Ett?\nTvå?\nTre?").fragor.length === 3);
ok("tomma rader hoppas över", tolkaProvfragor("Ett?\n\n\nTvå?").fragor.length === 2);
ok("tom text ger inget fel", tolkaProvfragor("").fel === null);

rubrik("Vad som nekas");
ok("rad utan fråga nekas", Boolean(tolkaProvfragor(" | 2 | stöd").fel));
ok("poängtak som inte är ett tal nekas", Boolean(tolkaProvfragor("Ett? | två").fel));
ok("poängtak över taket nekas", Boolean(tolkaProvfragor(`Ett? | ${MAX_PROVPOANG + 1}`).fel));
ok("poängtak noll nekas", Boolean(tolkaProvfragor("Ett? | 0").fel));
ok("decimaltal nekas", Boolean(tolkaProvfragor("Ett? | 1.5").fel));
ok(
  "fler än taket antal frågor nekas",
  Boolean(tolkaProvfragor(Array.from({ length: MAX_PROVFRAGOR + 1 }, (_, i) => `F${i}?`).join("\n")).fel),
);
// Ett fel far aldrig ge halva provet tillbaka. Ett delvis tolkat prov hade
// sparats som ett helt, och skillnaden syns forst nar nagon ska skriva det.
ok("ett fel ger inga frågor alls", tolkaProvfragor("Bra?\nDålig? | två").fragor.length === 0);

rubrik("Fram och tillbaka");
const text = "Vad är en säljstruktur? | 2 | Nämner ordningen\nVad vill du uppnå med introt? | 2";
ok("texten överlever en runda", skrivProvfragor(tolkaProvfragor(text).fragor) === text);

rubrik("Poäng till procent");
const fragor = [
  { id: "a", max_points: 2 },
  { id: "b", max_points: 2 },
];
ok("allt rätt ger 100", provprocent(fragor, { a: 2, b: 2 }) === 100);
ok("halva ger 50", provprocent(fragor, { a: 2, b: 0 }) === 50);
ok("delvis rätt räknas", provprocent(fragor, { a: 1, b: 1 }) === 50);
ok("inget satt ger 0", provprocent(fragor, {}) === 0);
ok("ett prov utan frågor ger 0, inte 100", provprocent([], { a: 2 }) === 0);

// Tjugo fragor a tva poang ar hela kursen "Saljstruktur". Gransen 70 % gar vid
// 28 poang, och det ar just den granskningen som gor att en poang hit eller dit
// spelar roll — darfor provas den med riktiga tal.
const tjugo = Array.from({ length: 20 }, (_, i) => ({ id: `f${i}`, max_points: 2 }));
const poang = (antalTva, antalEtt) =>
  Object.fromEntries(tjugo.map((f, i) => [f.id, i < antalTva ? 2 : i < antalTva + antalEtt ? 1 : 0]));
ok("28 av 40 poäng blir 70 %", provprocent(tjugo, poang(14, 0)) === 70);
ok("27 av 40 poäng blir 68 %, alltså under gränsen", provprocent(tjugo, poang(13, 1)) === 68);

rubrik("Läget räknas fram ur raderna");
ok("inget påbörjat", provlage([]) === "ej_paborjat");
ok("utkast", provlage([{ status: "utkast", passed: null, created_at: "2026-09-01" }]) === "utkast");
ok("inlämnat", provlage([{ status: "inlamnad", passed: null, created_at: "2026-09-01" }]) === "inlamnad");
ok("retur", provlage([{ status: "retur", passed: null, created_at: "2026-09-01" }]) === "retur");
ok("godkänt", provlage([{ status: "rattad", passed: true, created_at: "2026-09-01" }]) === "godkant");
ok("underkänt", provlage([{ status: "rattad", passed: false, created_at: "2026-09-01" }]) === "underkant");

// Ett underkant forsok skrivs aldrig over — omtaget ar en NY rad. Laget ska
// darfor alltid komma ur den senaste, oavsett vilken ordning raderna kommer i.
ok(
  "senaste raden avgör, även om den äldre kommer först",
  provlage([
    { status: "rattad", passed: false, created_at: "2026-09-01" },
    { status: "utkast", passed: null, created_at: "2026-09-10" },
  ]) === "utkast",
);

rubrik("Vem som får skriva");
ok("ett påbörjat prov går att skriva i", farSkriva("utkast"));
ok("ett returnerat prov går att skriva i", farSkriva("retur"));
ok("ett inlämnat prov gör det INTE", !farSkriva("inlamnad"));
ok("ett godkänt prov gör det INTE", !farSkriva("godkant"));
ok("ett underkänt prov gör det INTE", !farSkriva("underkant"), "omtaget är ett nytt försök");

rubrik("Vilka frågor som saknar svar");
const rader = [
  { id: "a", sort: 1 },
  { id: "b", sort: 2 },
  { id: "c", sort: 3 },
];
const langt = "x".repeat(MINSTA_SVAR);
ok("alla tomma ger alla nummer", saknadeSvar(rader, {}).join() === "1,2,3");
ok("besvarade räknas bort", saknadeSvar(rader, { a: langt, c: langt }).join() === "2");
ok("blanksteg är inget svar", saknadeSvar(rader, { a: "   \n  " }).includes(1));
ok("för kort svar räknas som saknat", saknadeSvar(rader, { a: "ja" }).includes(1));
ok("numren kommer i ordning", saknadeSvar([...rader].reverse(), {}).join() === "1,2,3");

rubrik("Ordräkning");
ok("tom text ger noll", ordrakning("") === 0);
ok("bara blanksteg ger noll", ordrakning("   \n ") === 0);
ok("ett ord", ordrakning("struktur") === 1);
ok("radbrytningar räknas som mellanrum", ordrakning("en\nstruktur i\tsamtalet") === 4);

rubrik("Rättningens sammanfattning");
ok("inget satt", rattningslage(fragor, {}).satta === 0);
ok("summan räknas", rattningslage(fragor, { a: 2, b: 1 }).summa === 3);
ok("taket räknas", rattningslage(fragor, {}).tak === 4);
ok("klar först när varje fråga har poäng", !rattningslage(fragor, { a: 2 }).klar);
ok("noll poäng är ett satt betyg", rattningslage(fragor, { a: 0, b: 0 }).klar);
// Noll ar ett BETYG och inte ett tomt falt. Raknades det som osatt hade den som
// underkant varje svar aldrig kunnat trycka pa knappen.
ok("noll poäng räknas som satt", rattningslage(fragor, { a: 0, b: 2 }).satta === 2);

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m" : `\n\x1b[31m${fel} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
