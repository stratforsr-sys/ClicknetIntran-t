#!/usr/bin/env node
/**
 * Pushen i telefonen: vilken notis en push visar, och att den väcker telefonen.
 *
 *   node --experimental-strip-types tests/pushko.mjs
 *
 * 2026-11-03 i Zens Samsung: 18 pushar mellan 13:15 och 16:15 hämtades aldrig,
 * och 17:37 visade telefonen fyra notiser från eftermiddagen i stället för de
 * nya. Pushen gick med "normal" brådska, som en sovande Android får skjuta upp,
 * och en skur som kommer på en gång kunde bli en notis, eftersom alla hämtningar
 * läste samma markör. Kön som blev kvar visades sedan före det nya.
 *
 * `nastaIKon` (pushko.ts) är regeln. Markörens lås ligger i `kalPushNasta`
 * (kalender-push.ts) och provades mot databasen när det byggdes: av åtta
 * samtidiga flyttar från samma markör gick en igenom.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { nastaIKon, SKUR_MS } from "../src/lib/nav2/pushko.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

const T = Date.parse("2026-11-03T16:37:00Z");
const n = (id, minFore) => ({ id, created_at: new Date(T - minFore * 60_000).toISOString() });
const id = (x) => (x ? x.id : null);

console.log("\nEn notis per push, den äldsta först");
ok("tom kö: ingen notis", nastaIKon([], 0) === null);
ok("en notis efter markören visas", id(nastaIKon([n(10, 0)], 9)) === 10);
ok("allt före och på markören är visat", nastaIKon([n(8, 1), n(9, 0)], 9) === null);
const skur = [n(14, 0), n(13, 0), n(12, 0.2), n(11, 0.5)];
ok("en skur visas i den ordning den kom", [10, 11, 12, 13].map((m) => id(nastaIKon(skur, m))).join() === "11,12,13,14");
ok("kön kan komma i vilken ordning som helst", id(nastaIKon([n(12, 0), n(11, 0)], 0)) === 11);

console.log("\nDet nya går före det som blev kvar");
const kvar = [n(520, 167), n(521, 167), n(525, 107), n(556, 1), n(557, 0.5), n(558, 0)];
ok("det som är mer än tio minuter äldre än det nyaste hoppas över", id(nastaIKon(kvar, 519)) === 556);
ok("resten av den nya skuren kommer i ordning", id(nastaIKon(kvar, 556)) === 557 && id(nastaIKon(kvar, 557)) === 558);
ok("precis tio minuter äldre hör till skuren", id(nastaIKon([n(1, 10), n(2, 0)], 0)) === 1);
ok("strax över tio minuter äldre gör det inte", id(nastaIKon([n(1, 10.01), n(2, 0)], 0)) === 2);
ok("SKUR_MS är tio minuter", SKUR_MS === 10 * 60_000);
ok("en ensam gammal notis visas ändå (pushen kan ha kommit sent)", id(nastaIKon([n(7, 600)], 0)) === 7);

console.log("\nPushen väcker en sovande telefon");
const push = fs.readFileSync(fileURLToPath(new URL("../src/lib/nav2/push.ts", import.meta.url)), "utf8");
ok("push.ts skickar Urgency: high", /Urgency:\s*"high"/.test(push));
ok("och ingen annan brådska", (push.match(/Urgency:/g) ?? []).length === 1);

console.log(fel ? `\n\x1b[31m${fel} prov foll.\x1b[0m` : "\n\x1b[32mAlla prov gick igenom.\x1b[0m");
process.exit(fel ? 1 : 0);
