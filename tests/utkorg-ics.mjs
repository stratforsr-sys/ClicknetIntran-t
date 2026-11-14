#!/usr/bin/env node
/**
 * Utkorgens kalenderfil till gäster utanför Clicknet (granskningen S14).
 *
 *   1. Ett möte med klockslag får sin inbjudan och sin avbokning.
 *   2. ETT HELDAGSMÖTE (0204) FÅR OCKSÅ SIN. Nav 2.0 låter ett heldagsmöte ha
 *      gäster och kvittot säger "får en inbjudan med mejl"; utkorgen hoppade
 *      förut över varje händelse utan klockslag, så gästen fick ingenting.
 *   3. En gammal sekvens, fel metod för läget och en tom adress skickas inte.
 *   4. (2026-11-13) Kundens namn på mötet, vad brevet gäller och namnet ur förra brevet.
 *
 *   node --experimental-strip-types tests/utkorg-ics.mjs
 */
import { arMotesRubrik, brevslag, forraNamnet, forraPlatsen, icsGaller } from "../src/lib/utkorg-ics.ts";
import { arVideoplats } from "../src/lib/nav2/motenforma.ts";

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
// Möten, Ändra (2026-11-03): en gäst som tas bort ur ett möte som står kvar får sin avbokning.
prov("avbokning till en borttagen gäst, mötet står kvar", icsGaller({ ...mote, ics_sequence: 2 }, a, 2, "CANCEL", true), true);
prov("borttagen gäst, gammal sekvens", icsGaller({ ...mote, ics_sequence: 3 }, a, 2, "CANCEL", true), false);
prov("borttagen rör inte en inbjudan (adressen prövas i utkorgen)", icsGaller(mote, a, 0, "REQUEST", true), true);

// Kundens brev (2026-11-13): Mötens egen rubrik står aldrig i brevet; där heter mötet "Möte med Clicknet".
prov("Mötens rubrik med prefix", arMotesRubrik("Clicknet - Nordic Grön AB: Möte"), true);
prov("Mötens rubrik utan prefix", arMotesRubrik("Nordic Grön AB: Möte"), true);
prov("den gamla rubriken", arMotesRubrik("SEO-möte: Nordic Grön AB"), true);
prov("en egen rubrik i kalendern är inte Mötens", arMotesRubrik("Genomgång av offerten"), false);
prov("ett möte som bara heter Möte är inte Mötens", arMotesRubrik("Möte"), false);
prov("tom rubrik", arMotesRubrik(null), false);

// Vad brevet gäller och vem det hälsar på, ur det gästen redan fått (loggen, nyast först).
const nar1 = "onsdag 18 november 2026 kl 08:00–08:30", nar2 = "torsdag 19 november 2026 kl 10:00–10:30";
const logg = [
  { epost: a, metod: "CANCEL", nar: nar1, namn: "Anna Berg" },
  { epost: "annan@exempel.se", metod: "REQUEST", nar: nar1, namn: "Bo" },
  { epost: a, metod: "REQUEST", nar: nar1, namn: "Anna Berg" },
];
prov("sekvens 0: en första inbjudan", brevslag(logg, a, 0, nar1), "ny");
prov("tillbaka efter en avbokning: en första inbjudan", brevslag(logg, a, 1, nar1), "ny");
prov("samma tid som förra brevet: ändrat", brevslag(logg.slice(1), "annan@exempel.se", 1, nar1), "andrad");
prov("en annan tid än förra brevet: ny tid", brevslag(logg.slice(1), "annan@exempel.se", 1, nar2), "tid");
prov("aldrig fått något: en första inbjudan", brevslag(logg, "ny@exempel.se", 2, nar1), "ny");
prov("brev från före 2026-11-03 utan adress: ny tid, som förut", brevslag([{ metod: "REQUEST" }], "ny@exempel.se", 2, nar1), "tid");
prov("namnet ur förra brevet till adressen", forraNamnet(logg, a), "Anna Berg");
prov("namnet följer adressen, inte det senaste brevet", forraNamnet(logg, "annan@exempel.se"), "Bo");
prov("adressen jämförs utan versaler", forraNamnet([{ epost: "Gast@Exempel.se", namn: "Gun" }], a), "Gun");
// Platsen i förra brevet (2026-11-14): ett brev om en ändring säger vad som är nytt, länken eller var mötet hålls.
prov("platsen och länken ur förra brevet", JSON.stringify(forraPlatsen([{ epost: a, plats: "Microsoft Teams", lank: null }], a)), JSON.stringify({ plats: "Microsoft Teams", url: null }));
prov("platsen följer adressen", JSON.stringify(forraPlatsen([{ epost: "x@y.se", plats: "Telefon", lank: null }, { epost: a, plats: "Zoom", lank: "https://zoom.us/j/1" }], a)), JSON.stringify({ plats: "Zoom", url: "https://zoom.us/j/1" }));
prov("ett brev utan plats och länk loggade", JSON.stringify(forraPlatsen([{ epost: a, plats: null, lank: null }], a)), JSON.stringify({ plats: null, url: null }));
prov("ett brev från före 2026-11-14 vet inte platsen", forraPlatsen([{ epost: a, nar: "x" }], a), null);
prov("aldrig fått något", forraPlatsen([], a), null);
prov("Videotjänsterna", ["Microsoft Teams", "Google Meet", "Zoom", "Videomöte"].every(arVideoplats) && !arVideoplats("Telefon") && !arVideoplats("Storgatan 1") && !arVideoplats(null) && arVideoplats(" Zoom "), true);
prov("brev före 2026-11-13 har inget namn", forraNamnet([{ epost: a, metod: "REQUEST" }], a), null);
prov("ett tomt namn är inget namn", forraNamnet([{ epost: a, namn: "  " }], a), null);

if (fel) { console.log(`\n${fel} fel`); process.exit(1); }
console.log("\nalla gröna");
