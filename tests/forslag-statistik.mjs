#!/usr/bin/env node
/**
 * Hemvyn (steg 1): statistiken bakom Navs facit och domar.
 *
 * Fishers exakta prov, ensidigt, och "tidigast vid runt N möten". Talen är
 * räknade för hand 2026-11-15 och står i designdokumentet (1.4).
 *
 *   node --experimental-strip-types tests/forslag-statistik.mjs
 */
import { fisherEnsidig, tidigastVid } from "../src/lib/nav2/statistik.ts";

let fel = 0;
const ok = (namn, villkor) => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}`);
  if (!villkor) fel++;
};
const text = (x) => JSON.stringify(x, (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? String(v) : v));
const lika = (namn, fas, vantat) => ok(`${namn} (fick ${text(fas)})`, text(fas) === text(vantat));

console.log("\n\x1b[1mFishers exakta prov, ensidigt\x1b[0m");
lika("5 av 5 mot 0 av 5", fisherEnsidig({ n: 5, av: 5 }, { n: 0, av: 5 }).toFixed(4), "0.0040");
lika("5 av 5 mot 1 av 5", fisherEnsidig({ n: 5, av: 5 }, { n: 1, av: 5 }).toFixed(4), "0.0238");
lika("4 av 4 mot 0 av 4", fisherEnsidig({ n: 4, av: 4 }, { n: 0, av: 4 }).toFixed(4), "0.0143");
lika("4 av 5 mot 1 av 4", fisherEnsidig({ n: 4, av: 5 }, { n: 1, av: 4 }).toFixed(4), "0.1667");
lika("5 av 7 mot 1 av 4", fisherEnsidig({ n: 5, av: 7 }, { n: 1, av: 4 }).toFixed(4), "0.1970");
lika("en tom grupp ger 1", fisherEnsidig({ n: 0, av: 0 }, { n: 1, av: 4 }), 1);
lika("lika andelar ger inget utslag", fisherEnsidig({ n: 2, av: 4 }, { n: 2, av: 4 }) > 0.5, true);
lika("aldrig över 1", fisherEnsidig({ n: 0, av: 5 }, { n: 5, av: 5 }) <= 1, true);

console.log("\n\x1b[1mTidigast vid runt N möten\x1b[0m");
lika("5 av 7 mot 1 av 4 vid 0,01", tidigastVid({ n: 5, av: 7 }, { n: 1, av: 4 }, 0.01), 40);
lika("5 av 7 mot 1 av 4 vid 0,05", tidigastVid({ n: 5, av: 7 }, { n: 1, av: 4 }, 0.05), 30);
lika("lika andelar", tidigastVid({ n: 2, av: 4 }, { n: 1, av: 2 }, 0.01), null);
lika("fel håll", tidigastVid({ n: 1, av: 4 }, { n: 3, av: 4 }, 0.01), null);
lika("en tom grupp", tidigastVid({ n: 0, av: 0 }, { n: 1, av: 4 }, 0.01), null);
lika("redan utslag ger dagens antal, avrundat uppåt", tidigastVid({ n: 5, av: 5 }, { n: 0, av: 5 }, 0.01), 10);

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m\n` : "\n\x1b[32mAllt stämmer\x1b[0m\n");
process.exit(fel ? 1 : 0);
