#!/usr/bin/env node
/**
 * E5.7: kvittot nere till hoger och dess angra-knapp.
 *
 *   node --experimental-strip-types tests/toast.mjs
 *
 * Kakan gar att skriva i webblasaren. Proven nedan handlar darfor mest om vad
 * som INTE ska tas emot — dispatchern i angra/actions.ts gor om hela
 * behorighetskontrollen anda, men en trasig kaka ska ge ingen toast i stallet
 * for en trasig sida.
 */
import { ANGRABARA, SEKUNDER, arId, franKaka, tillKaka } from "../src/lib/toast.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

rubrik("Kvittot overlever vagen genom kakan");
{
  const k = { text: "Inlägget är arkiverat.", angra: { handling: "nyhet.arkiverad", id: "abc-123" } };
  const ut = franKaka(tillKaka(k));
  ok("texten kommer tillbaka", ut.text === k.text);
  ok("handlingen kommer tillbaka", ut.angra.handling === "nyhet.arkiverad");
  ok("id kommer tillbaka", ut.angra.id === "abc-123");
}
{
  const ut = franKaka(tillKaka({ text: "Sparat." }));
  ok("ett kvitto utan angra far ingen knapp", ut.angra === undefined);
}
// Svenska tecken och komman maste overleva kodningen — annars blir varje
// kvitto med ett a-ring i en trasig kaka.
{
  const ut = franKaka(tillKaka({ text: "Ändrat, sparat och klart" }));
  ok("svenska tecken overlever", ut.text === "Ändrat, sparat och klart");
}

rubrik("En trasig eller pahittad kaka ger ingen toast");
ok("tom kaka", franKaka(undefined) === null);
ok("tom strang", franKaka("") === null);
ok("skrap", franKaka("inte-json") === null);
ok("json utan text", franKaka(encodeURIComponent(JSON.stringify({ a: "nyhet.arkiverad" }))) === null);
ok("tom text", franKaka(encodeURIComponent(JSON.stringify({ t: "   " }))) === null);

rubrik("Angra-knappen gar inte att fabricera");
// Listan ar stangd. En handling utanfor den ska inte ens ritas som en knapp.
{
  const ut = franKaka(encodeURIComponent(JSON.stringify({ t: "Hej", a: "employee.raderad", i: "abc" })));
  ok("okand handling ger kvitto utan knapp", ut !== null && ut.angra === undefined);
}
{
  const ut = franKaka(encodeURIComponent(JSON.stringify({ t: "Hej", a: "nyhet.arkiverad", i: "../../etc" })));
  ok("id som inte ar ett id ger kvitto utan knapp", ut !== null && ut.angra === undefined);
}
{
  const ut = franKaka(encodeURIComponent(JSON.stringify({ t: "Hej", a: "nyhet.arkiverad" })));
  ok("handling utan id ger kvitto utan knapp", ut !== null && ut.angra === undefined);
}

rubrik("Id-formen");
ok("uuid gar igenom", arId("3f2504e0-4f89-11d3-9a0c-0305e82c3301"));
ok("slug gar igenom", arId("anstallningsavtal-tillsvidare"));
ok("snedstreck nekas", !arId("a/b"));
ok("punkter nekas", !arId("../x"));
ok("tom strang nekas", !arId(""));
ok("citattecken nekas", !arId('a"b'));

rubrik("Langd och tid");
{
  const lang = "x".repeat(400);
  const ut = franKaka(tillKaka({ text: lang }));
  // En kaka foljer med i VARJE request. En lang text ar inte ett kvitto, det
  // ar ett felmeddelande som hamnat pa fel stalle.
  ok("texten klipps", ut.text.length <= 160, `${ut.text.length} tecken`);
}
// Kvittot bar en handling, inte bara en bekraftelse. Fem sekunder racker inte
// for att hinna lasa vad knappen gor.
ok("kvittot star kvar langre an en vanlig bekraftelse", SEKUNDER >= 8);
ok("listan over angrabara atgarder ar liten", ANGRABARA.length <= 6, `${ANGRABARA.length} st`);

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m" : `\n\x1b[31m${fel} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
