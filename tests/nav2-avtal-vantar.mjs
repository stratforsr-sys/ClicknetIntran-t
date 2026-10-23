#!/usr/bin/env node
/**
 * Nav 2.0, Avtal (granskningen F1-3, beslut B3): när väntar ett utfärdat
 * mallavtal på påskrift? Den påskrivna PDF:en laddas upp som ett eget avtal
 * (0073), och från den stunden ska påminnelserna sluta.
 *
 *   TZ=UTC node --experimental-strip-types tests/nav2-avtal-vantar.mjs
 */
import { vantarPaPaskrift } from "../src/lib/nav2/avtalforma.ts";

let fel = 0;
const ok = (namn, villkor) => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}`);
  if (!villkor) fel++;
};

const P = "11111111-1111-4111-8111-111111111111";
const Q = "22222222-2222-4222-8222-222222222222";
const mall = { employee_id: P, source: "template", status: "issued", issued_at: "2026-10-01T08:00:00+00:00" };
const upp = (d, extra = {}) => ({ employee_id: P, source: "upload", status: "issued", issued_at: d, ...extra });

console.log("\n\x1b[1mMallavtal och uppladdat avtal\x1b[0m");
ok("utan uppladdat avtal väntar mallavtalet", vantarPaPaskrift(mall, [mall]) === true);
ok("mallavtal 1 okt + uppladdat 5 okt = påskrivet", vantarPaPaskrift(mall, [mall, upp("2026-10-05T09:00:00+00:00")]) === false);
ok("uppladdat samma stund räknas som påskrivet", vantarPaPaskrift(mall, [mall, upp("2026-10-01T08:00:00+00:00")]) === false);
ok("uppladdat före mallavtalet är ett äldre avtal: väntar", vantarPaPaskrift(mall, [upp("2026-09-01T09:00:00+00:00"), mall]) === true);
ok("ett borttaget uppladdat avtal räknas inte", vantarPaPaskrift(mall, [mall, upp("2026-10-05T09:00:00+00:00", { status: "withdrawn" })]) === true);
ok("en annan persons uppladdade avtal räknas inte", vantarPaPaskrift(mall, [mall, upp("2026-10-05T09:00:00+00:00", { employee_id: Q })]) === true);
ok("tidsstämplar i olika format jämförs som tid", vantarPaPaskrift(mall, [mall, upp("2026-10-01T10:30:00.123Z")]) === false);

console.log("\n\x1b[1mBara ett utfärdat mallavtal kan vänta\x1b[0m");
ok("utkast väntar inte", vantarPaPaskrift({ ...mall, status: "draft", issued_at: null }, []) === false);
ok("tillbakadraget väntar inte", vantarPaPaskrift({ ...mall, status: "withdrawn" }, []) === false);
ok("ett uppladdat avtal väntar aldrig", vantarPaPaskrift(upp("2026-10-05T09:00:00+00:00"), []) === false);

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m\n` : "\n\x1b[32mAlla gröna\x1b[0m\n");
process.exit(fel ? 1 : 0);
