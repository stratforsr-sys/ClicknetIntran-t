#!/usr/bin/env node
/**
 * Svensk vaggklocka. Testet kors med TZ=UTC OCH TZ=Europe/Stockholm och maste
 * ge exakt samma svar bada gangerna — det ar hela poangen med modulen.
 *
 *   TZ=UTC node --experimental-strip-types tests/klocka.mjs
 */
import {
  svensktDatum,
  svenskaMinuter,
  svenskVeckodag,
  svenskTidpunkt,
  svenskDygnsstart,
  svenskDygnsslut,
  dagarBakat,
  svenskKlocka,
} from "../src/lib/klocka.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

console.log(`\n\x1b[1mKord med TZ=${process.env.TZ ?? "(systemets)"}\x1b[0m`);

console.log("\n\x1b[1mSommartid: Sverige ligger tva timmar fore UTC\x1b[0m");
{
  // Den riktiga stamplingen som avslojade buggen: 18:08 svensk tid.
  const stampling = "2026-08-17T16:08:34.000Z";
  ok("klockslaget lases som svensk tid", svenskKlocka(stampling) === "18:08", svenskKlocka(stampling));
  ok("minuter sedan midnatt", svenskaMinuter(stampling) === 18 * 60 + 8, String(svenskaMinuter(stampling)));
  ok("datumet ar svenskt", svensktDatum(stampling) === "2026-08-17");

  // Ett schema som slutar 17:00 ska sluta 15:00 UTC pa sommaren.
  ok("schemaslut 17:00 blir 15:00Z",
    svenskTidpunkt("2026-08-17", "17:00").toISOString() === "2026-08-17T15:00:00.000Z",
    svenskTidpunkt("2026-08-17", "17:00").toISOString());

  ok("sekunder i schematiden stor inte",
    svenskTidpunkt("2026-08-17", "17:00:00").toISOString() === "2026-08-17T15:00:00.000Z");
}

console.log("\n\x1b[1mVintertid: en timme fore UTC\x1b[0m");
{
  ok("samma schema i januari blir 16:00Z",
    svenskTidpunkt("2026-01-15", "17:00").toISOString() === "2026-01-15T16:00:00.000Z",
    svenskTidpunkt("2026-01-15", "17:00").toISOString());

  ok("morgonstampling i januari", svenskKlocka("2026-01-15T08:05:00.000Z") === "09:05");
}

console.log("\n\x1b[1mDygnsgransen gar vid svensk midnatt, inte serverns\x1b[0m");
{
  // 22:30Z pa sommaren ar 00:30 nasta dag i Sverige.
  ok("strax efter svensk midnatt raknas till nya dygnet",
    svensktDatum("2026-08-17T22:30:00.000Z") === "2026-08-18");

  ok("strax fore raknas till det gamla",
    svensktDatum("2026-08-17T21:30:00.000Z") === "2026-08-17");

  const start = svenskDygnsstart(new Date("2026-08-17T22:30:00.000Z"));
  ok("dygnsstart ar 22:00Z dagen innan", start === "2026-08-17T22:00:00.000Z", start);

  const slut = svenskDygnsslut("2026-08-17");
  ok("dygnsslut ar sista millisekunden", slut === "2026-08-17T21:59:59.999Z", slut);
}

console.log("\n\x1b[1mSkiftesdygnen\x1b[0m");
{
  // Sommartid 2026 borjar 29 mars, slutar 25 oktober.
  ok("dagen da klockan flyttas fram",
    svenskTidpunkt("2026-03-29", "12:00").toISOString() === "2026-03-29T10:00:00.000Z",
    svenskTidpunkt("2026-03-29", "12:00").toISOString());

  ok("dagen da den flyttas tillbaka",
    svenskTidpunkt("2026-10-25", "12:00").toISOString() === "2026-10-25T11:00:00.000Z",
    svenskTidpunkt("2026-10-25", "12:00").toISOString());

  // Dygnet ar 23 respektive 25 timmar — ett dygn bakat far anda inte hoppa
  // over ett datum.
  ok("dagen fore skiftet", dagarBakat("2026-03-30", 1) === "2026-03-29");
  ok("dagen fore hostskiftet", dagarBakat("2026-10-26", 1) === "2026-10-25");
  ok("fjorton dagar bakat", dagarBakat("2026-08-17", 14) === "2026-08-03");
}

console.log("\n\x1b[1mVeckodag raknas i svensk tid\x1b[0m");
{
  ok("17 augusti 2026 ar en mandag", svenskVeckodag("2026-08-17T10:00:00.000Z") === 1);
  ok("sondagen fore ar 7", svenskVeckodag("2026-08-16T10:00:00.000Z") === 7);

  // 22:30Z pa en sondag ar mandag i Sverige.
  ok("sen sondagkvall UTC ar mandag har", svenskVeckodag("2026-08-16T22:30:00.000Z") === 1);
}

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller godkända.\x1b[0m\n" : `\n\x1b[31m${fel} underkända.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
