#!/usr/bin/env node
/**
 * Utskicken (0255): vem som får vad, i vilken kanal. Ren, utan databas.
 *
 * Tre regler bär inställningen:
 *
 *   1. SUPERADMINS STÄNGNING GÅR INTE ATT ÖPPNA. Personens eget lager kan bara
 *      stänga det superadmin låtit vara, aldrig öppna det superadmin stängt.
 *   2. DET SMALASTE LAGRET VINNER. Personen före nivån före bolaget, och inom
 *      ett lager sorten före området före hela kanalen.
 *   3. KATALOGEN ÄR HEL. Varje sort har ett namn och ett område som finns, och
 *      ingen nyckel utanför katalogen går att spara.
 *
 *   node --experimental-strip-types tests/utskick.mjs
 */
import { NOTIS_KALLOR } from "../src/lib/notiser.ts";
import {
  OMRADEN, SORTER, SORT_NAMN, MORGON_AVSNITT, andra, andraMedUnder, antalAv, arNyckel, far, kanalerFor,
  lastAvSuperadmin, nycklarFor, nycklarForAvsnitt, omradeFor, rensa,
} from "../src/lib/utskick.ts";

let fel = 0;
const prov = (namn, ok) => { if (!ok) { fel++; console.error(`FEL  ${namn}`); } else console.log(`ok   ${namn}`); };

const n = nycklarFor("order-makulerad");
prov("nycklarna går från sort till kanal", n.join("|") === "sort:order-makulerad|omrade:order|*");

// Standard när ingen sagt något.
prov("standard gäller utan regler", far({}, "mejl", n, true) && !far({}, "mejl", n, false));

// 1. Superadmins stängning håller.
prov("bolaget stänger, egen kan inte öppna",
  !far({ alla: { mejl: { "*": false } }, egen: { mejl: { "sort:order-makulerad": true } } }, "mejl", n, true));
prov("egen kan stänga det superadmin låtit vara", !far({ egen: { mejl: { "omrade:order": false } } }, "mejl", n, true));
prov("egen kan slå på det som är av som standard", far({ egen: { mejl: { "sort:order-makulerad": true } } }, "mejl", n, false));
prov("superadmin kan slå på det som är av som standard", far({ niva: { mejl: { "omrade:order": true } } }, "mejl", n, false));
prov("egen kan stänga det superadmin slagit på", !far({ alla: { mejl: { "*": true } }, egen: { mejl: { "*": false } } }, "mejl", n, true));
prov("låst när superadmin stängt", lastAvSuperadmin({ person: { mejl: { "omrade:order": false } } }, "mejl", n));
prov("inte låst när superadmin öppnat", !lastAvSuperadmin({ person: { mejl: { "omrade:order": true } }, alla: { mejl: { "*": false } } }, "mejl", n));

// 2. Det smalaste lagret vinner.
prov("personen före bolaget", far({ alla: { mejl: { "*": false } }, person: { mejl: { "omrade:order": true } } }, "mejl", n, true));
prov("nivån före bolaget", far({ alla: { mejl: { "omrade:order": false } }, niva: { mejl: { "*": true } } }, "mejl", n, true));
prov("sorten före området inom ett lager", far({ egen: { mejl: { "omrade:order": false, "sort:order-makulerad": true } } }, "mejl", n, true));
prov("en annan kanal påverkas inte", far({ alla: { mejl: { "*": false } } }, "klocka", n, true));

// Morgonbrevet.
prov("ett avsnitt kan stängas", !far({ egen: { morgon: { "avsnitt:idag": false } } }, "morgon", nycklarForAvsnitt("idag"), true));
prov("hela brevet kan stängas", !far({ person: { morgon: { "*": false } } }, "morgon", nycklarForAvsnitt("avtal"), true));

// 3. Katalogen är hel.
const omraden = new Set(OMRADEN.map((o) => o.id));
for (const s of SORTER) {
  if (!SORT_NAMN[s]) prov(`sorten ${s} har ett namn`, false);
  if (!omraden.has(omradeFor(s))) prov(`sorten ${s} har ett område som finns`, false);
}
prov("varje sort har namn och område", SORTER.every((s) => SORT_NAMN[s] && omraden.has(omradeFor(s))));
prov("alla klockans sorter är med", NOTIS_KALLOR.every((s) => SORTER.includes(s)));
prov("varje område har minst en sort", OMRADEN.every((o) => SORTER.some((s) => omradeFor(s) === o.id)));
prov("en härledd sort mejlas inte", !kanalerFor("rutin").includes("mejl") && kanalerFor("order-makulerad").includes("mejl"));
prov("kvällsnotisen är bara push", kanalerFor("kvallsnotis").join() === "push");
prov("avsnitten har unika id", new Set(MORGON_AVSNITT.map((a) => a.id)).size === MORGON_AVSNITT.length);

prov("okänd nyckel nekas", !arNyckel("mejl", "sort:finns-inte") && !arNyckel("mejl", "omrade:x") && !arNyckel("klocka", "avsnitt:idag"));
prov("mejl för härledd sort nekas", !arNyckel("mejl", "sort:rutin") && arNyckel("klocka", "sort:rutin"));
prov("ändring till på, av och ärv",
  JSON.stringify(andra(andra({}, "mejl", "*", false), "mejl", "omrade:tid", true)) === '{"mejl":{"*":false,"omrade:tid":true}}' &&
  JSON.stringify(andra({ mejl: { "*": false } }, "mejl", "*", null)) === "{}");
prov("egen: hela kanalen av suddar undantagen under",
  JSON.stringify(andraMedUnder({ mejl: { "sort:order-makulerad": true, "omrade:tid": true }, push: { "*": false } }, "mejl", "*", false)) === '{"mejl":{"*":false},"push":{"*":false}}');
prov("egen: ett område suddar bara sina sorter",
  JSON.stringify(andraMedUnder({ mejl: { "sort:order-makulerad": true, "sort:tid-schema": false } }, "mejl", "omrade:order", false)) === '{"mejl":{"sort:tid-schema":false,"omrade:order":false}}');
prov("ogiltig ändring ger null", andra({}, "sms", "*", false) === null && andra({}, "mejl", "*", "nej") === null);
prov("rensa släpper bara igenom giltigt",
  JSON.stringify(rensa({ mejl: { "*": false, "sort:x": false, "omrade:lon": "ja" }, sms: { "*": false } })) === '{"mejl":{"*":false}}' &&
  JSON.stringify(rensa("skräp")) === "{}");
prov("antal avstängda", antalAv({ mejl: { "*": false, "omrade:tid": true }, push: { "*": false } }) === 2);

if (fel) { console.error(`\n${fel} fel`); process.exit(1); }
console.log("\nUtskicken: allt grönt");
