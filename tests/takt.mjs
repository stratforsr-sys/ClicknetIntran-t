#!/usr/bin/env node
/**
 * Hemvyn (steg 2): takten i Teamet i månaden och taktens eget facit.
 *
 * Dagstalen är Clicknets riktiga order per signeringsdag (utan tillägg och
 * utkast), räknade i produktionen 2026-11-15. De är antal, inga namn. Det är
 * de här talen som designdokumentet bygger på: takten efter tio arbetsdagar sa
 * 11 i september (det blev 24) och 2 i oktober (det blev 3).
 *
 *   TZ=UTC node --experimental-strip-types tests/takt.mjs
 */
import { arbetsdagarIManad, taktLage, taktEfterhand, taktFacit, taktFacitVid } from "../src/lib/nav2/takt.ts";

let fel = 0;
const ok = (namn, villkor) => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}`);
  if (!villkor) fel++;
};
const text = (x) => JSON.stringify(x, (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? String(v) : v));
const lika = (namn, fas, vantat) => ok(`${namn} (fick ${text(fas)})`, text(fas) === text(vantat));

const SEP = { "2026-09-02": 1, "2026-09-03": 1, "2026-09-10": 1, "2026-09-11": 1, "2026-09-14": 1, "2026-09-15": 4, "2026-09-17": 4, "2026-09-23": 1, "2026-09-24": 5, "2026-09-25": 3, "2026-09-30": 2 };
const OKT = { "2026-10-02": 1, "2026-10-22": 1, "2026-10-29": 1 };

console.log("\n\x1b[1mArbetsdagar\x1b[0m");
lika("september har 22", arbetsdagarIManad("2026-09").length, 22);
lika("oktober har 22", arbetsdagarIManad("2026-10").length, 22);
lika("november har 21", arbetsdagarIManad("2026-11").length, 21);
lika("december: julafton, juldagen, annandagen och nyårsafton räknas inte", arbetsdagarIManad("2026-12").includes("2026-12-24"), false);

console.log("\n\x1b[1mTakten en morgon\x1b[0m");
lika("16 nov: 2 order efter 10 dagar", taktLage({ netto: 2, manad: "2026-11", idag: "2026-11-16" }), { gatt: 10, totalt: 21, prognos: 4 });
lika("skissens tal, söndag 15 nov", taktLage({ netto: 19, manad: "2026-11", idag: "2026-11-15" }).prognos, 40);
lika("första arbetsdagen", taktLage({ netto: 0, manad: "2026-12", idag: "2026-12-01" }).prognos, null);
lika("första arbetsdagen, gatt", taktLage({ netto: 0, manad: "2026-12", idag: "2026-12-01" }).gatt, 0);
lika("helgen räknar inte", taktLage({ netto: 3, manad: "2026-11", idag: "2026-11-08" }).gatt, 5);
lika("efter månaden räknas hela", taktLage({ netto: 24, manad: "2026-09", idag: "2026-10-01" }), { gatt: 22, totalt: 22, prognos: 24 });
lika("minus blir aldrig en negativ prognos", taktLage({ netto: -1, manad: "2026-11", idag: "2026-11-16" }).prognos, 0);

console.log("\n\x1b[1mI efterhand, ur dagstalen\x1b[0m");
const sep = taktEfterhand(SEP, "2026-09");
lika("sep efter 5", sep.efter5, Math.round((2 / 5) * 22));
lika("sep efter 10", sep.efter10, 11);
lika("sep blev", sep.blev, 24);
lika("okt efter 10", taktEfterhand(OKT, "2026-10").efter10, 2);
lika("okt blev", taktEfterhand(OKT, "2026-10").blev, 3);

console.log("\n\x1b[1mTaktens facit\x1b[0m");
const sparade = [
  { manad: "2026-10", gatt: 5, prognos: 4 },
  { manad: "2026-10", gatt: 10, prognos: 2 },
  { manad: "2026-10", gatt: 15, prognos: 3 },
];
const f = taktFacit(sparade, { "2026-09": 24, "2026-10": 3 }, { "2026-09": SEP });
lika("två månader, nyast först", f.map((m) => m.manad), ["2026-10", "2026-09"]);
lika("oktober ur det som visades", f[0], { manad: "2026-10", efter5: 4, efter10: 2, efter15: 3, blev: 3, efterhand: false });
lika("september i efterhand", f[1].efterhand, true);
lika("september efter 10", f[1].efter10, 11);

console.log("\n\x1b[1mTaktens facit vid samma dag som i dag\x1b[0m");
// Varje avslutad månad, inte bara den förra: oktober träffade, september missade stort.
lika("efter 10 dagar, alla månader", taktFacitVid(10, [], { "2026-09": 24, "2026-10": 3 }, { "2026-09": SEP, "2026-10": OKT }), [
  { manad: "2026-10", gatt: 10, sa: 2, blev: 3, efterhand: true },
  { manad: "2026-09", gatt: 10, sa: 11, blev: 24, efterhand: true },
]);
lika("efter 1 dag i september", taktFacitVid(1, [], { "2026-09": 24 }, { "2026-09": SEP })[0].sa, 0);
lika("efter 3 dagar i september", taktFacitVid(3, [], { "2026-09": 24 }, { "2026-09": SEP })[0].sa, Math.round((2 / 3) * 22));
lika("sparat värde går före efterhand", taktFacitVid(10, [{ manad: "2026-10", gatt: 10, prognos: 5 }], { "2026-10": 3 }, { "2026-10": OKT })[0], { manad: "2026-10", gatt: 10, sa: 5, blev: 3, efterhand: false });
lika("ingen dag gången ger inget facit", taktFacitVid(0, [], { "2026-10": 3 }, { "2026-10": OKT }), []);
lika("fler dagar än månaden har", taktFacitVid(22, [], { "2026-11": 4 }, { "2026-11": {} })[0].sa, null);

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m\n` : "\n\x1b[32mAllt stämmer\x1b[0m\n");
process.exit(fel ? 1 : 0);
