#!/usr/bin/env node
/**
 * Teamet i månaden: kedjan, orsaken med belägg och läget mot eget mål (skiss 9).
 *
 *   node --experimental-strip-types tests/kedja.mjs
 */
import { ledFor, kedja, forklaring, statusMotMal, tillMalet, personVeckor, veckofonster, forstaDag } from "../src/lib/nav2/kedja.ts";

let fel = 0;
const lika = (namn, fas, vantat) => { const ok = JSON.stringify(fas) === JSON.stringify(vantat); console.log(`  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${ok ? "" : ` (fick ${JSON.stringify(fas)})`}`); if (!ok) fel++; };
const spann = [5, 6, 7, 5, 6, 7, 5, 6];

lika("båda veckorna under spannet: d", ledFor([2, 3, ...spann]), "d");
lika("båda över: u", ledFor([9, 10, ...spann]), "u");
lika("bara en vecka under: som vanligt", ledFor([2, 6, ...spann]), "n");
lika("utan data: null", ledFor([null, 3, ...spann]), null);
lika("för kort spann: null", ledFor([2, 3, 5, 6, null, null, null, null, null, null]), null);

const V = (o) => ({ samtal: 50, svar: null, bokade: 6, hallna: 5, order: 2, ...o });
const veckor = (senaste, fore) => [V(senaste), V(senaste), ...Array.from({ length: 8 }, (_x, i) => V({ ...fore, ...(i % 2 ? {} : {}) }))];
const sv = (k, lagt, vanligt) => [V({ [k]: lagt }), V({ [k]: lagt }), ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => V({ [k]: vanligt + (i % 3) }))];
lika("hållna under, bokade som vanligt: Möten uteblir", kedja(sv("hallna", 1, 4)).orsak, "Möten uteblir");
lika("samtal under: Färre samtal", kedja(sv("samtal", 10, 40)).orsak, "Färre samtal");
lika("order under, hållna som vanligt: Färre möten blir order", kedja(sv("order", 0, 2)).orsak, "Färre möten blir order");
lika("svar är alltid null: ingen regel om svar slår till", kedja(sv("bokade", 1, 5)).led[1], null);
lika("bokade under utan svar: ingen orsak", kedja(sv("bokade", 1, 5)).orsak, null);
lika("allt som vanligt: inget", kedja(sv("samtal", 41, 40)).orsak, null);
void veckor;

const S0 = { samtal: 120, hallna: 11, uteblev: 9, order: 2 }, F0 = { samtal: 480, hallna: 35, uteblev: 5, order: 9 };
lika("förklaringen med belägg och Varför vet jag inte", forklaring(["n", null, "n", "d", "n"], "Möten uteblir", S0, F0), "Ringer och bokar som vanligt. 9 av 20 möten uteblev, mot 5 av 40 före. Varför vet jag inte.");
lika("över sitt spann står som det är", forklaring(["n", null, "u", "n", "n"], null, S0, F0), "Bokade möten: över sitt eget spann två veckor i rad.");
lika("inget sticker ut", forklaring([null, null, null, null, null], null, S0, F0), "Inget sticker ut.");

lika("före sitt mål", statusMotMal(7, 12, 10, 21), "Före sitt mål");
lika("efter sitt mål", statusMotMal(2, 11, 10, 21), "Efter sitt mål");
lika("i takt", statusMotMal(6, 12, 10, 21), "I takt");
lika("utan mål: inget läge", statusMotMal(6, null, 10, 21), null);
lika("till målet", tillMalet(19, 46, 10, 21), { kvar: 27, dagar: 11, perDag: 2.5, hittills: 1.9 });
lika("utan mål: inget", tillMalet(19, null, 10, 21), null);

const pv = personVeckor({ samtal: ["2026-11-16", "2026-11-10", "2026-11-09", "2026-08-10"], bokade: ["2026-11-15"], hallna: [], uteblev: ["2026-11-01"], order: [] }, "2026-11-16");
lika("veckorna: nyast först, sju dagar var", pv.veckor.map((v) => v.samtal), [2, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
lika("ett samtal före de tio veckorna räknas inte", pv.s.samtal + pv.f.samtal, 3);
lika("underlaget: två veckor mot åtta", [pv.s.uteblev, pv.f.uteblev], [0, 1]);
lika("utan samtal i växeln: null, inte noll", personVeckor({ samtal: [], bokade: [], hallna: [], uteblev: [], order: [] }, "2026-11-16").veckor[0].samtal, null);
lika("svar är alltid null", pv.veckor[0].svar, null);

// Den som är ny: veckor före första dagen är ingen data, inte nollor. Annars ser två veckors arbete ut som "över spannet".
const ny = { samtal: ["2026-11-16", "2026-11-15", "2026-11-14", "2026-11-09", "2026-11-08", "2026-11-07"], bokade: ["2026-11-15", "2026-11-14", "2026-11-08", "2026-11-07"], hallna: [], uteblev: [], order: ["2026-11-12", "2026-11-05"] };
const utanForsta = kedja(personVeckor(ny, "2026-11-16").veckor);
lika("utan första dag: nollorna före ger 'över' (felet som rättas)", utanForsta.led[2], "u");
const medForsta = personVeckor(ny, "2026-11-16", "2026-11-03");
lika("veckor före första dagen: alla led null", [medForsta.veckor[2], medForsta.veckor[9]], [{ samtal: null, svar: null, bokade: null, hallna: null, order: null }, { samtal: null, svar: null, bokade: null, hallna: null, order: null }]);
lika("en vecka som börjar före första dagen räknas inte heller", medForsta.veckor[1].bokade, 2);
lika("en vecka som börjar dagen före: null", personVeckor(ny, "2026-11-16", "2026-11-04").veckor[1].bokade, null);
lika("ny person: inget led får färg, för tidigt att säga", kedja(medForsta.veckor).led, [null, null, null, null, null]);
lika("ny person: ingen orsak", kedja(medForsta.veckor).orsak, null);
lika("första dagen: anställningsdagen går före", forstaDag({ start: "2026-11-03", lagd: "2026-01-10" }, ["2025-12-01"]), "2026-11-03");
lika("utan anställningsdag: dagen personen lades in", forstaDag({ start: null, lagd: "2026-11-03" }, ["2026-11-05"]), "2026-11-03");
lika("data före inläggningen: den första händelsen", forstaDag({ start: null, lagd: "2026-11-03" }, ["2026-11-05", "2026-09-01"]), "2026-09-01");
lika("ingenting känt: ingen första dag", forstaDag(undefined, ["2026-09-01"]), null);
lika("första dagen långt bak: som förut", personVeckor(ny, "2026-11-16", "2025-01-01").veckor.map((v) => v.bokade), personVeckor(ny, "2026-11-16").veckor.map((v) => v.bokade));

// Samtalen läses vecka för vecka samtidigt: fönstren täcker hela spannet, utan glapp och utan överlapp.
const f = veckofonster("2026-09-07T12:00:00.000Z", "2026-11-16T12:00:00.000Z");
lika("tio veckor ger tio fönster", f.length, 10);
lika("första fönstret börjar vid början", f[0][0], "2026-09-07T12:00:00.000Z");
lika("sista fönstret är öppet framåt", f[9][1], null);
lika("inga glapp: varje fönster börjar där det förra slutar", f.slice(1).every((x, i) => x[0] === f[i][1]), true);
lika("en vecka per fönster", f[0][1], "2026-09-14T12:00:00.000Z");
lika("ett kort spann: ett fönster", veckofonster("2026-11-14T12:00:00.000Z", "2026-11-16T12:00:00.000Z"), [["2026-11-14T12:00:00.000Z", null]]);

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m` : "\n\x1b[32mAllt stämmer\x1b[0m");
process.exit(fel ? 1 : 0);
