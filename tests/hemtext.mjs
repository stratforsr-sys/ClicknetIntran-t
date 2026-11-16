#!/usr/bin/env node
/**
 * Hemvyn: texterna i korten och genomgångarna. De skrivs av mallar, inte av AI:
 * samma data ger samma text, och texten går att prova (designdokumentet, Texterna).
 *
 * Tonen: korta meningar, antal före procent, aldrig en orsak, och "Det här ser
 * jag inte" där det är sant.
 *
 *   TZ=UTC node --experimental-strip-types tests/hemtext.mjs
 */
import {
  KALLRAD, textObekraftat, textKortObekraftade, textKortForslag, textAndratInledning, textKvitto, textFacit, textFacitKort, textTakt, textTaktFacit, textTaktKort,
  textAndringDom, textTrendSaknas, textTrodde, textAndel, textDom, narText, manadsnamn, gangerText, textFel, felkod, textLagnamn,
} from "../src/lib/nav2/hemtext.ts";

let fel = 0;
const ok = (namn, villkor) => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}`);
  if (!villkor) fel++;
};
const text = (x) => JSON.stringify(x);
const lika = (namn, fas, vantat) => ok(`${namn} (fick ${text(fas)})`, text(fas) === text(vantat));

const TZ = "Europe/Stockholm";
const M = { kund: "Hagby Glas", dag: "i morgon", kl: "09.00", bokare: "Mick", forsok: 2, jag: false };

console.log("\n\x1b[1mFörsta kedjan\x1b[0m");
lika("förslaget", textObekraftat(M, { n: 1, av: 4 }, true), [
  "Mötet med Hagby Glas i morgon 09.00 är inte bekräftat. Mick har ringt två gånger utan svar.",
  "Hittills har 1 av 4 obekräftade möten hållits. Det är för få för att säga något.",
  "Det här ser jag inte: om kunden har hört av sig på annat sätt.",
]);
lika("ett försök", textObekraftat({ ...M, forsok: 1 }, null, true)[0], "Mötet med Hagby Glas i morgon 09.00 är inte bekräftat. Mick har ringt en gång utan svar.");
lika("kortet: ett tal, en mening och förslagets egen knapp", textKortForslag(M), { tal: "1", vad: "möte i morgon är obekräftat", text: "Hagby Glas 09.00. Mick har ringt två gånger utan svar.", knapp: "Välj vad som händer" });
lika("kortet när ingen har ringt", textKortForslag({ ...M, forsok: 0 }).text, "Hagby Glas 09.00. Inget försök att nå kunden är noterat.");
lika("kortet när det är ens eget möte", textKortForslag({ ...M, jag: true }).text, "Hagby Glas 09.00. Du har ringt två gånger utan svar.");
lika("genomgången av det som ändrats", textAndratInledning({ foljs: 4, bra: 2, samre: 1, tidiga: 1 }), { fore: "Jag följer fyra ändringar.", fet: "Två ser bra ut", efter: " och går att ta vidare. En ser sämre ut. En är för tidig att döma. Ingen ändring får ”ser bra ut” om något annat blev sämre på köpet." });
lika("en ändring, för tidig", textAndratInledning({ foljs: 1, bra: 0, samre: 0, tidiga: 1 }), { fore: "Jag följer en ändring.", fet: "", efter: " Den är för tidig att döma. Ingen ändring får ”ser bra ut” om något annat blev sämre på köpet." });
lika("inga ändringar", textAndratInledning({ foljs: 0, bra: 0, samre: 0, tidiga: 0 }), { fore: "Jag följer inga ändringar än.", fet: "", efter: " Berätta om en ändring, så följer jag måttet och säger hur det gick." });
lika("inget försök noterat: Nav säger vad den ser, inte vad någon gjort", textObekraftat({ ...M, forsok: 0 }, null, true)[0], "Mötet med Hagby Glas i morgon 09.00 är inte bekräftat. Inget försök att nå kunden är noterat.");
lika("du bokade själv", textObekraftat({ ...M, jag: true }, null, true)[0], "Mötet med Hagby Glas i morgon 09.00 är inte bekräftat. Du har ringt två gånger utan svar.");
lika("bokaren är okänd", textObekraftat({ ...M, bokare: null }, null, true)[0], "Mötet med Hagby Glas i morgon 09.00 är inte bekräftat. Kunden har ringts två gånger utan svar.");
lika("inget att jämföra med", textObekraftat(M, null, true)[1], "Jag har inga tidigare obekräftade möten att jämföra med.");
lika("nollan räknas som inget", textObekraftat(M, { n: 0, av: 0 }, true)[1], "Jag har inga tidigare obekräftade möten att jämföra med.");
lika("när det går att säga: bara antal, ingen orsak", textObekraftat(M, { n: 3, av: 20 }, false, { n: 30, av: 40 })[1], "Hittills har 3 av 20 obekräftade möten hållits. Av de bekräftade hölls 30 av 40.");
lika("elva försök skrivs med siffror", gangerText(11), "11 gånger");
lika("kortet, ett möte", textKortObekraftade(1, "i morgon"), "1 möte i morgon är obekräftat");
lika("kortet, tre möten", textKortObekraftade(3, "i morgon"), "3 möten i morgon är obekräftade");
lika("kortet, olika dagar", textKortObekraftade(2, null), "2 möten är obekräftade");
lika("kvitto: jag ringer själv", textKvitto("ringer-sjalv", "på onsdag"), "Klart. Bekräftelsen ligger i din lista i dag. På onsdag säger jag hur det gick.");
lika("kvitto: låt stå", textKvitto("lat-sta", "i morgon"), "Klart. Mötet står kvar som det är. I morgon säger jag hur det gick.");
lika("kvitto: flytta", textKvitto("flytta", "på onsdag"), "Klart. Mötet är flyttat. Står den nya tiden också obekräftad sista dagen frågar jag igen.");

console.log("\n\x1b[1mNär\x1b[0m");
lika("i morgon", narText("2026-11-17T08:00:00Z", new Date("2026-11-16T13:00:00Z"), TZ), { dag: "i morgon", kl: "09.00" });
lika("i dag", narText("2026-11-16T11:30:00Z", new Date("2026-11-16T09:30:00Z"), TZ), { dag: "i dag", kl: "12.30" });
lika("på måndag, sett från fredagen", narText("2026-11-16T09:30:00Z", new Date("2026-11-13T13:00:00Z"), TZ), { dag: "på måndag", kl: "10.30" });
lika("längre bort", narText("2026-12-28T09:30:00Z", new Date("2026-12-15T13:00:00Z"), TZ), { dag: "28 dec", kl: "10.30" });
lika("månadens namn", [manadsnamn("2026-10"), manadsnamn("2026-01")], ["oktober", "januari"]);

console.log("\n\x1b[1mDomen dagen efter\x1b[0m");
lika("hållet", textDom({ kund: "Hagby Glas", val: "ringer-sjalv", utfall: "hallet", bekraftat: true }), "Hagby Glas: du valde att ringa själv. Mötet hölls. Det blev bekräftat före mötet.");
lika("uteblev", textDom({ kund: "Hagby Glas", val: "lat-sta", utfall: "uteblev", bekraftat: false }), "Hagby Glas: du valde att låta mötet stå. Kunden uteblev. Mötet blev aldrig bekräftat.");
lika("ingen valde", textDom({ kund: "Hagby Glas", val: "ingen", utfall: "hallet", bekraftat: false }), "Hagby Glas: ingen valde. Mötet hölls. Mötet blev aldrig bekräftat.");
lika("utfallet saknas", textDom({ kund: "Hagby Glas", val: "ringer-sjalv", utfall: null, bekraftat: true }), "Hagby Glas: du valde att ringa själv. Utfallet är inte satt. Jag dömer när det är det.");
lika("okänt", textDom({ kund: "Hagby Glas", val: "lat-sta", utfall: "okant", bekraftat: false }), "Hagby Glas: du valde att låta mötet stå. Utfallet blev aldrig satt, så jag kan inte säga hur det gick.");
lika("flyttat", textDom({ kund: "Hagby Glas", val: "flytta", utfall: "flyttat", bekraftat: false }), "Hagby Glas: du valde att flytta mötet. Mötet flyttades till en ny tid.");
lika("för chefen står namnet", textDom({ kund: "Hagby Glas", val: "ringer-sjalv", utfall: "hallet", bekraftat: true, vem: "Edvin" }), "Hagby Glas: Edvin valde att ringa själv. Mötet hölls. Det blev bekräftat före mötet.");

console.log("\n\x1b[1mNavs facit\x1b[0m");
const d0 = { hallet: 0, uteblev: 0, avbokat: 0 };
const F = {
  per: { "ringer-sjalv": { n: 5, av: 7 }, flytta: { n: 0, av: 0 }, "lat-sta": { n: 1, av: 4 }, ingen: { n: 0, av: 2 } },
  detalj: { "ringer-sjalv": d0, flytta: d0, "lat-sta": d0, ingen: d0 }, flyttade: 0,
  dom: { sort: "for-fa", p: 0.197, tidigast: 40, vid: 10 },
};
lika("för få", textFacit(F), "När någon har ringt själv har 5 av 7 möten hållits. Låt stå: 1 av 4. Ingen valde: 0 av 2. För få för att skilja från slump. Tidigast vid runt 40 möten, om skillnaden håller.");
lika("för få, utan gissning om när", textFacit({ ...F, dom: { ...F.dom, tidigast: null } }).endsWith("För få för att skilja från slump."), true);
lika("flyttade står för sig", textFacit({ ...F, flyttade: 2 }).includes("Flyttade: 2."), true);
lika("utslag: urvalet står i samma mening", textFacit({ ...F, dom: { sort: "utslag", p: 0.004, tidigast: null, vid: 10 } }), "När någon har ringt själv har 5 av 7 möten hållits. Låt stå: 1 av 4. Ingen valde: 0 av 2. Vid 10 möten var skillnaden för stor för att vara slump. Den som håller mötet väljer vilka möten hen ringer om, så den visar inte att samtalet gjorde den.");
lika("en person: antalen visas, ingen dom", textFacit({ ...F, dom: { sort: "en-person", p: 0.004, tidigast: null, vid: 10 } }).endsWith("En person står för mer än hälften av mötena i ett val. Då vore det här ett facit om den personen, så jag dömer inte."), true);
lika("ingen har valt låt stå än", textFacit({ ...F, per: { ...F.per, "lat-sta": { n: 0, av: 0 }, ingen: { n: 0, av: 0 } }, dom: { sort: "tomt", p: null, tidigast: null, vid: 0 } }), "När någon har ringt själv har 5 av 7 möten hållits. Det finns inget att jämföra med än.");
lika("inget alls", textFacit({ ...F, per: { "ringer-sjalv": { n: 0, av: 0 }, flytta: { n: 0, av: 0 }, "lat-sta": { n: 0, av: 0 }, ingen: { n: 0, av: 0 } }, dom: { sort: "tomt", p: null, tidigast: null, vid: 0 } }), "Inget facit än. Det kommer när de första mötena har fått ett utfall.");
lika("kort, i förslaget", textFacitKort(F), "I laget hittills: ringt själv 5 av 7 hölls, låt stå 1 av 4. För få för att säga något, tidigast vid runt 40 möten.");
lika("kort, tomt", textFacitKort({ ...F, per: { ...F.per, "ringer-sjalv": { n: 0, av: 0 }, "lat-sta": { n: 0, av: 0 } }, dom: { sort: "tomt", p: null, tidigast: null, vid: 0 } }), "Inget facit i laget än.");
lika("det Nav trodde", textTrodde({ raknade: 9, av: 20, blev: 11 }), "Jag räknade med att 9 av 20 skulle hållas. Det blev 11.");

console.log("\n\x1b[1mTeamet i månaden\x1b[0m");
lika("med mål", textTakt({ netto: 19, mal: 46, prognos: 40, utanMal: 0, manad: "2026-11" }), { stort: "19 av 46 order", rad: "I samma takt blir det ungefär 40. Det är en uträkning på takten, inget löfte.", malrad: null });
lika("utan mål", textTakt({ netto: 2, mal: null, prognos: 4, utanMal: 0, manad: "2026-11" }), { stort: "2 order", rad: "I samma takt blir det ungefär 4. Det är en uträkning på takten, inget löfte.", malrad: "Inget mål satt för november." });
lika("en order", textTakt({ netto: 1, mal: null, prognos: 2, utanMal: 0, manad: "2026-11" }).stort, "1 order");
lika("mål saknas för några", textTakt({ netto: 19, mal: 46, prognos: 40, utanMal: 2, manad: "2026-11" }).malrad, "Mål saknas för 2 personer.");
lika("mål saknas för en", textTakt({ netto: 19, mal: 46, prognos: 40, utanMal: 1, manad: "2026-11" }).malrad, "Mål saknas för 1 person.");
lika("första arbetsdagen", textTakt({ netto: 0, mal: 46, prognos: null, utanMal: 0, manad: "2026-12" }).rad, "För tidigt för en takt. Den kommer när månadens första arbetsdag har gått.");
const TR = [
  { manad: "2026-10", gatt: 10, sa: 2, blev: 3, efterhand: true },
  { manad: "2026-09", gatt: 10, sa: 11, blev: 24, efterhand: true },
];
lika("på kortet: bara den senaste månaden, så att kortet ryms", textTaktFacit(TR), "Efter 10 dagar sa takten 2 i oktober (det blev 3). Räknat i efterhand ur orderna.");
lika("taktens facit, flera månader", textTaktFacit(TR, 3), "Efter 10 dagar sa takten 2 i oktober (det blev 3) och 11 i september (det blev 24). Räknat i efterhand ur orderna.");
lika("ur det som visades", textTaktFacit([{ ...TR[0], efterhand: false }]), "Efter 10 dagar sa takten 2 i oktober (det blev 3).");
lika("efter en dag", textTaktFacit([{ manad: "2026-10", gatt: 1, sa: 0, blev: 3, efterhand: false }]), "Efter 1 dag sa takten 0 i oktober (det blev 3).");
lika("högst tre månader när fler begärs", textTaktFacit([TR[0], TR[1], { manad: "2026-08", gatt: 10, sa: 5, blev: 3, efterhand: true }, { manad: "2026-07", gatt: 10, sa: 9, blev: 9, efterhand: true }], 3).includes("juli"), false);
lika("kortets rad: takten och förra månadens facit i en mening", textTaktKort(40, [{ manad: "2026-10", gatt: 10, sa: 38, blev: 44, efterhand: false }]), "I samma takt blir det ungefär 40. I oktober sa takten 38, det blev 44.");
lika("kortets rad: räknat i efterhand sägs som det var", textTaktKort(4, TR), "I samma takt blir det ungefär 4. I oktober hade takten sagt 2, det blev 3.");
lika("kortets rad utan facit", textTaktKort(4, []), "I samma takt blir det ungefär 4.");
lika("kortets rad för tidigt", textTaktKort(null, TR), "För tidigt för en takt. Den kommer när månadens första arbetsdag har gått.");
lika("inget facit än", textTaktFacit([]), "Takten har inget facit än. Det kommer när en månad är avslutad.");
lika("månader utan värde hoppas över", textTaktFacit([{ manad: "2026-10", gatt: 10, sa: null, blev: 3, efterhand: true }]), "Takten har inget facit än. Det kommer när en månad är avslutad.");

console.log("\n\x1b[1mDet som ändrats\x1b[0m");
const D = { sort: "ser-bra-ut", stangd: true, restenOcksa: false, helaLaget: false };
lika("ser bra ut", textAndringDom(D, "färre möten hålls"), "Ser bra ut.");
lika("resten också", textAndringDom({ ...D, restenOcksa: true }, "färre möten hålls"), "Ser bra ut. Resten av laget blev också bättre.");
lika("hela laget", textAndringDom({ ...D, helaLaget: true }, "färre möten hålls"), "Ser bra ut. Hela laget ändrade sig samtidigt, så jag har inget att jämföra med.");
lika("bättre, men", textAndringDom({ ...D, sort: "battre-men" }, "färre möten hålls"), "Bättre, men färre möten hålls.");
lika("sämre, resten också", textAndringDom({ ...D, sort: "ser-samre-ut", restenOcksa: true }, "färre möten hålls"), "Ser sämre ut. Resten av laget blev också sämre.");
lika("inget före", textAndringDom({ ...D, sort: "inget-fore", stangd: false }, ""), "Inget före att jämföra med.");
lika("för tidigt", textAndringDom({ ...D, sort: "for-tidigt", stangd: false }, ""), "För tidigt att säga.");
lika("ingen skillnad", textAndringDom({ ...D, sort: "ingen-skillnad" }, ""), "Ingen skillnad som går att se.");
lika("för få", textAndringDom({ ...D, sort: "for-fa" }, ""), "För få möten för att säga något.");
lika("en andel står aldrig utan sitt antal", textAndel({ n: 2, av: 20 }, { fore: 6, efter: 5 }), "2 av 20 uteblev. Bokade per vecka: 6 före, 5 efter.");
lika("decimalkomma", textAndel({ n: 2, av: 20 }, { fore: 1.5, efter: 5 }), "2 av 20 uteblev. Bokade per vecka: 1,5 före, 5 efter.");
lika("trenden saknar underlag", textTrendSaknas(11, 60), "För att jämföra laget med sig självt behöver jag 60 avgjorda möten. Jag har 11.");

console.log("\n\x1b[1mKällraden\x1b[0m");
lika("regler", KALLRAD.regler, "Räknat av regler");
lika("AI", KALLRAD.ai, "Skrivet av AI ur Navs tal");

console.log("\n\x1b[1mInga orsaker och inga utrop\x1b[0m");
{
  const alla = [
    ...textObekraftat(M, { n: 1, av: 4 }, true), textFacit(F), textFacitKort(F), textTaktFacit(TR),
    textAndringDom(D, "x"), textKvitto("ringer-sjalv", "i morgon"), textDom({ kund: "X", val: "lat-sta", utfall: "uteblev", bekraftat: false }),
  ].join(" ");
  ok("inget utropstecken", !alla.includes("!"));
  ok("aldrig 'eftersom', 'därför att' eller 'på grund av' om ett utfall", !/eftersom|därför att|på grund av|tack vare/i.test(alla));
  ok("aldrig procent", !alla.includes("%") && !/procent/i.test(alla));
}

console.log("\n\x1b[1mLagets öppna rader, hos chefen\x1b[0m");
{
  const { textLagetsOppna } = await import("../src/lib/nav2/hemtext.ts");
  lika("tre i morgon, en utan val", textLagetsOppna(3, 1, "i morgon"), "Obekräftade möten i morgon: 3, varav 1 utan val.");
  lika("alla har ett val", textLagetsOppna(2, 0, "i morgon"), "Obekräftade möten i morgon: 2. Alla har fått ett val.");
  lika("ett möte utan val", textLagetsOppna(1, 1, "i dag"), "Obekräftade möten i dag: 1, utan val.");
  lika("ett möte med val", textLagetsOppna(1, 0, "i dag"), "Obekräftade möten i dag: 1. Valet är gjort.");
  lika("olika dagar: ingen dag i raden", textLagetsOppna(4, 4, null), "Obekräftade möten: 4, alla utan val.");
}

// Fel till den som läser: kort svenska och en kod, aldrig databasens egen text.
const kod = felkod();
ok("felkoden är fem tecken 0–9 och a–f", /^[0-9a-f]{5}$/.test(kod));
ok("två felkoder skiljer sig (nästan alltid)", new Set(Array.from({ length: 20 }, felkod)).size > 15);
lika("läsfel", textFel("lasa", "a1b2c"), "Det gick inte att läsa just nu. Försök igen. Felkod a1b2c.");
lika("sparfel", textFel("spara", "a1b2c"), "Det gick inte att spara just nu. Försök igen. Felkod a1b2c.");
lika("ett lag", textLagnamn(["Norr"]), "Norr");
lika("två lag", textLagnamn(["Norr", "Syd"]), "Norr och Syd");
lika("tre lag", textLagnamn(["Norr", "Syd", "Väst"]), "Norr, Syd och Väst");
lika("inga lag", textLagnamn([]), null);

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m\n` : "\n\x1b[32mAllt stämmer\x1b[0m\n");
process.exit(fel ? 1 : 0);
