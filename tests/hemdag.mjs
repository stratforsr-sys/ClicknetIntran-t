#!/usr/bin/env node
/**
 * Min dag: dagens ram ur schemat och rasterna (skiss 9). Den mest specifika nivån gäller, och utan schema
 * för dagen finns ingen ram.
 *
 *   node --experimental-strip-types tests/hemdag.mjs
 */
import { dagensRam } from "../src/lib/nav2/hemdag.ts";

let fel = 0;
const lika = (namn, fas, vantat) => { const ok = JSON.stringify(fas) === JSON.stringify(vantat); console.log(`  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${ok ? "" : ` (fick ${JSON.stringify(fas)})`}`); if (!ok) fel++; };
const S = (x) => ({ scope: "company", employee_id: null, team_id: null, weekday: 1, start_time: "08:00:00", end_time: "17:00:00", valid_from: "2026-01-01", ...x });
const R = (x) => ({ scope: "company", employee_id: null, team_id: null, weekday: 1, sort: 1, duration_minutes: 60, valid_from: "2026-01-01", ...x });

lika("företagets schema och en rast", dagensRam([S({})], [R({})], "jag", null, "2026-11-16", 1), { start: 480, slut: 1020, rast: 60 });
lika("personens eget schema går före", dagensRam([S({}), S({ scope: "employee", employee_id: "jag", start_time: "07:30:00", end_time: "16:00:00" })], [], "jag", null, "2026-11-16", 1), { start: 450, slut: 960, rast: 0 });
lika("lagets raster: två raster läggs ihop", dagensRam([S({})], [R({}), R({ scope: "team", team_id: "t1", sort: 1, duration_minutes: 45 }), R({ scope: "team", team_id: "t1", sort: 2, duration_minutes: 15 })], "jag", "t1", "2026-11-16", 1), { start: 480, slut: 1020, rast: 60 });
lika("en dag utan schema har ingen ram", dagensRam([S({})], [R({})], "jag", null, "2026-11-15", 7), null);
lika("ett schema som inte har trätt i kraft gäller inte", dagensRam([S({ valid_from: "2026-12-01" })], [], "jag", null, "2026-11-16", 1), null);

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m` : "\n\x1b[32mAllt stämmer\x1b[0m");
process.exit(fel ? 1 : 0);
