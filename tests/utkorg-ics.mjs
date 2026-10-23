#!/usr/bin/env node
/**
 * Utkorgens kalenderfil till gäster utanför Clicknet (granskningen S14).
 *
 *   1. Ett möte med klockslag får sin inbjudan och sin avbokning.
 *   2. ETT HELDAGSMÖTE (0204) FÅR OCKSÅ SIN. Nav 2.0 låter ett heldagsmöte ha
 *      gäster och kvittot säger "får en inbjudan med mejl"; utkorgen hoppade
 *      förut över varje händelse utan klockslag, så gästen fick ingenting.
 *   3. En gammal sekvens, fel metod för läget och en tom adress skickas inte.
 *
 *   node --experimental-strip-types tests/utkorg-ics.mjs
 */
import { icsGaller } from "../src/lib/utkorg-ics.ts";

let fel = 0;
const prov = (namn, fick, ville) => {
  if (fick === ville) console.log(`  ok  ${namn}`);
  else { fel++; console.log(`  FEL ${namn}: fick ${fick}, ville ${ville}`); }
};

const mote = { tid: "07:00:00", dag: "2026-11-20", ics_sequence: 0, cancelled_at: null };
const heldag = { tid: null, dag: "2026-11-20", ics_sequence: 0, cancelled_at: null };
const a = "gast@exempel.se";

prov("möte, inbjudan", icsGaller(mote, a, 0, "REQUEST"), true);
prov("möte, avbokning", icsGaller({ ...mote, ics_sequence: 1, cancelled_at: "2026-10-23T12:00:00Z" }, a, 1, "CANCEL"), true);
prov("heldag, inbjudan", icsGaller(heldag, a, 0, "REQUEST"), true);
prov("heldag över flera dagar, avbokning", icsGaller({ ...heldag, ics_sequence: 2, cancelled_at: "2026-10-23T12:00:00Z" }, a, 2, "CANCEL"), true);
prov("gammal sekvens", icsGaller({ ...mote, ics_sequence: 3 }, a, 2, "REQUEST"), false);
prov("inbjudan till inställt möte", icsGaller({ ...mote, cancelled_at: "2026-10-23T12:00:00Z" }, a, 0, "REQUEST"), false);
prov("avbokning av möte som står kvar", icsGaller(mote, a, 0, "CANCEL"), false);
prov("tom adress", icsGaller(mote, "", 0, "REQUEST"), false);
prov("händelsen borta", icsGaller(null, a, 0, "REQUEST"), false);
prov("heldag utan dag", icsGaller({ ...heldag, dag: null }, a, 0, "REQUEST"), false);

if (fel) { console.log(`\n${fel} fel`); process.exit(1); }
console.log("\nalla gröna");
