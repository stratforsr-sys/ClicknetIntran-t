#!/usr/bin/env node
/**
 * Kalendern: vems påminnelse som gäller, och "Ingen påminnelse" (granskningen E4).
 *
 *   TZ=UTC node --experimental-strip-types tests/kalender-push.mjs
 *
 * Förut gick pushen ändå när någon valt "Ingen": mötets "Ingen" sparades som
 * 10 minuter, och deltagarens "Ingen" (null) betydde "mötets". Nu bär mötet och
 * deltagarraden `reminder_off` (0212), och `skaPaminna` (som motespaminnelser
 * i kalender-push.ts använder) svarar null = ingen påminnelse.
 * Funktionen ligger i den rena modulen kalender-andring.ts, eftersom
 * kalender-push.ts drar in server-only och push-tjänsten.
 */
import { skaPaminna } from "../src/lib/nav2/kalender-andring.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const p = (m, d) => skaPaminna(m, d);

console.log("\nVems påminnelse gäller");
ok("mötets 10 minuter när deltagaren följer mötet", p({ reminder_min: 10, reminder_off: false }, { reminder_min: null, reminder_off: null }) === 10);
ok("mötets Ingen: ingen påminnelse", p({ reminder_min: 10, reminder_off: true }, { reminder_min: null, reminder_off: null }) === null);
ok("deltagarens Ingen: ingen påminnelse", p({ reminder_min: 10, reminder_off: false }, { reminder_min: null, reminder_off: true }) === null);
ok("deltagarens egna 30 minuter går före mötets Ingen", p({ reminder_min: null, reminder_off: true }, { reminder_min: 30, reminder_off: false }) === 30);
ok("deltagarens egna 5 minuter går före mötets 60", p({ reminder_min: 60, reminder_off: false }, { reminder_min: 5, reminder_off: false }) === 5);
ok("en gammal rad med minuter men utan reminder_off är deltagarens egen", p({ reminder_min: 60, reminder_off: false }, { reminder_min: 15, reminder_off: null }) === 15);
ok("0 minuter är en påminnelse (vid start), inte Ingen", p({ reminder_min: 0, reminder_off: false }, { reminder_min: null, reminder_off: null }) === 0);
ok("mötet utan minuter och utan Ingen: ingen påminnelse att räkna", p({ reminder_min: null, reminder_off: false }, { reminder_min: null, reminder_off: null }) === null);

console.log(fel ? `\n\x1b[31m${fel} prov foll.\x1b[0m` : "\n\x1b[32mAlla prov gick igenom.\x1b[0m");
process.exit(fel ? 1 : 0);
