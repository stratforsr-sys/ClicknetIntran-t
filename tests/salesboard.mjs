#!/usr/bin/env node
/**
 * Säljtavlans rena regler. Sex saker står på spel och provas åt båda hållen:
 *
 *   1. DEN DOLDA SÄLJAREN. Den som valt att inte synas heter "En säljare" i
 *      varje namnform, och inget av namnet får finnas kvar i texten.
 *   2. MOTIVET ÄR STABILT. Ett ljudmotiv är en fast funktion av id:t. Ändras
 *      formeln byter varje säljare ljud över en natt, och rummet har lärt sig
 *      vems ljud som är vems. Därför är värdena fastspikade nedan.
 *   3. TRÖSKELN FÖR STOR AFFÄR. Den ska ge samma tal som `percentile_cont(0.9)`
 *      i Postgres, och "auto" får inte lita på en percentil av nitton order.
 *   4. TYST TID RÄKNAS I SVENSK TID. Inte i UTC och inte i serverns zon: en TV
 *      som plingar efter arbetstid för att servern står i UTC är ett fel som
 *      inte syns på utvecklarens egen dator. Julafton räknas som helg, som i
 *      takten.
 *   5. INSTÄLLNINGARNA KASTAR ALDRIG. Skräp i `nav_setting` ger standarden för
 *      det fältet, aldrig en tom tavla, och en dålig skrivning ändrar ingenting.
 *   6. TAVLAN FIRAR BARA DET SOM ÄR NYTT. Planeringen (`planera`) provas åt båda
 *      hållen: vad som firas (färsk order, serie, målet, halvvägs, dagsrekord,
 *      personbästa, första ordern, test) och, minst lika viktigt, vad som aldrig
 *      firas: det som fanns vid start, en gammal eller efterregistrerad order, en
 *      makulering och en ny månad. Ett målfirande som spelas två gånger är värre
 *      än ett som uteblir.
 *
 *   TZ=UTC node --experimental-strip-types tests/salesboard.mjs
 *
 * Svaren ska vara desamma med TZ=Europe/Stockholm: modulerna räknar svensk tid
 * uttryckligen.
 */
import { isDeepStrictEqual } from "node:util";
import { STANDARD, normalisera, uppdatera } from "../src/lib/salesboard/installningar.ts";
import {
  FARSK_MS,
  HORN_SPARR_MS,
  TEST_FARSK_MS,
  arDold,
  arEfterregistrerad,
  initialerFor,
  inomArbetsdag,
  ljudTillatet,
  nastaStart,
  hornTillatet,
  planera,
  samla,
  storAffarTroskel,
  visningsnamn,
} from "../src/lib/salesboard/regler.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(
    `  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`,
  );
  if (!villkor) fel++;
};
const lika = (a, b) => isDeepStrictEqual(a, b);

// -----------------------------------------------------------------------------
console.log("\nregler");

// --- Namn och monogram -------------------------------------------------------
{
  const former = ["fornamn", "fornamn_e", "hela"];

  ok("förnamn och efternamnets initial", visningsnamn("Amira", "Haddad", "fornamn_e", "namn") === "Amira H.");
  ok("hela namnet", visningsnamn("Amira", "Haddad", "hela", "namn") === "Amira Haddad");
  ok("bara förnamnet", visningsnamn("Amira", "Haddad", "fornamn", "namn") === "Amira");
  ok("å, ä och ö blir versaler", visningsnamn("Åsa", "öberg", "fornamn_e", "namn") === "Åsa Ö.");

  // "Initialer" är säljarens eget val och gäller före tavlans namnform.
  ok(
    "initialer ger A. H. i alla namnformer",
    former.every((f) => visningsnamn("Amira", "Haddad", f, "initialer") === "A. H."),
  );
  ok("initialer utan efternamn ger bara A.", visningsnamn("Amira", "", "hela", "initialer") === "A.");

  // DEN DOLDA SÄLJAREN. Inget av namnet får finnas kvar, i någon form.
  ok(
    "dold ger En säljare i alla namnformer",
    former.every((f) => visningsnamn("Amira", "Haddad", f, "dold") === "En säljare"),
  );
  ok(
    "ingen del av det dolda namnet läcker",
    former.every((f) => !/amira|haddad/i.test(visningsnamn("Amira", "Haddad", f, "dold"))),
  );

  // En tom efternamnsdel ger inget hängande mellanslag och ingen punkt.
  ok("tomt efternamn ger bara förnamnet", visningsnamn("Amira", "", "fornamn_e", "namn") === "Amira");
  ok("blanka tecken i efternamnet räknas som tomt", visningsnamn("Amira", "  ", "fornamn_e", "namn") === "Amira");
  ok("tomt efternamn i hela namnet ger inget hängande mellanslag", visningsnamn("Amira", "", "hela", "namn") === "Amira");
  ok("blanka tecken runt namnen klipps", visningsnamn(" Amira ", " Haddad ", "hela", "namn") === "Amira Haddad");

  // Långa namn skrivs ut hela här. Att de ska få plats är en fråga för ritningen.
  ok(
    "långt efternamn med bindestreck",
    visningsnamn("Maximilian", "Andersson-Lindqvist", "hela", "namn") === "Maximilian Andersson-Lindqvist" &&
      visningsnamn("Maximilian", "Andersson-Lindqvist", "fornamn_e", "namn") === "Maximilian A.",
  );

  ok("monogram ur förnamn och efternamn", initialerFor("Amira", "Haddad", "namn") === "AH");
  ok("monogram med å och ö", initialerFor("Åsa", "Öberg", "namn") === "ÅÖ");
  ok("monogram i versaler", initialerFor("åsa", "öberg", "namn") === "ÅÖ");
  ok("den som valt initialer har samma monogram", initialerFor("Amira", "Haddad", "initialer") === "AH");
  ok("monogram utan efternamn ger en bokstav", initialerFor("Amira", "", "namn") === "A");
  ok("dold ger ett neutralt monogram", initialerFor("Amira", "Haddad", "dold") === "·");

  // FAIL CLOSED. Bara "namn" och "initialer" visar ett namn. Allt annat som kan
  // komma ur databasen (null, ett stavfel, fel typ, en gammal form) är dolt, så
  // att ett fel aldrig kan lämna ut en säljare som bett om att få vara dold.
  const skrapVisningar = [null, undefined, "", "Namn", "NAMN", "dolt", "hidden", "namn ", " initialer", 0, 1, true, {}, []];
  ok(
    "en okänd visning är dold i alla namnformer",
    skrapVisningar.every((v) => former.every((f) => visningsnamn("Amira", "Haddad", f, v) === "En säljare")),
  );
  ok(
    "ingen del av namnet läcker vid en okänd visning",
    skrapVisningar.every((v) => former.every((f) => !/amira|haddad/i.test(visningsnamn("Amira", "Haddad", f, v)))),
  );
  ok("en okänd visning ger det neutrala monogrammet", skrapVisningar.every((v) => initialerFor("Amira", "Haddad", v) === "·"));
  ok(
    "ingen bokstav läcker i monogrammet vid en okänd visning",
    skrapVisningar.every((v) => !/[a-zåäö]/i.test(initialerFor("Amira", "Haddad", v))),
  );
  // ETT STÄLLE avgör om en säljare är dold, så att `byggTavlan` (som ger en dold säljare
  // `dold: true` och `motiv: null`) och namnfunktionerna aldrig kan vara oense. Bara de två
  // uttryckliga valen är synliga.
  ok("bara namn och initialer är inte dolda", arDold("namn") === false && arDold("initialer") === false);
  ok("dold är dold", arDold("dold") === true);
  ok(
    "allt annat är dolt",
    [...skrapVisningar, () => "namn", Symbol("namn"), new String("namn"), NaN].every((v) => arDold(v) === true),
  );
  ok("och inget argument alls är dolt", arDold() === true);
  ok(
    "namnfunktionerna är aldrig oense med arDold",
    [...skrapVisningar, "namn", "initialer", "dold"].every(
      (v) =>
        (visningsnamn("Amira", "Haddad", "hela", v) === "En säljare") === arDold(v) &&
        (initialerFor("Amira", "Haddad", v) === "·") === arDold(v),
    ),
  );
  ok(
    "de två uttryckliga valen visar fortfarande namnet",
    visningsnamn("Amira", "Haddad", "hela", "namn") === "Amira Haddad" &&
      visningsnamn("Amira", "Haddad", "hela", "initialer") === "A. H." &&
      initialerFor("Amira", "Haddad", "namn") === "AH" &&
      initialerFor("Amira", "Haddad", "initialer") === "AH",
  );

  // Ett tomt namn ger inget tomt fält på en TV: då gäller den dolda texten.
  const tomma = ["", " ", "   ", "\t\n", " "];
  ok(
    "tomma namn ger den dolda texten i alla namnformer",
    tomma.every((t) => former.every((f) => visningsnamn(t, t, f, "namn") === "En säljare")),
  );
  ok(
    "tomma namn med initialer ger den dolda texten",
    tomma.every((t) => visningsnamn(t, t, "fornamn_e", "initialer") === "En säljare"),
  );
  ok(
    "tomma namn ger det neutrala monogrammet",
    tomma.every((t) => initialerFor(t, t, "namn") === "·" && initialerFor(t, t, "initialer") === "·"),
  );
  ok(
    "ett tomt förnamn men inte ett tomt efternamn ger det som finns",
    visningsnamn("", "Haddad", "hela", "namn") === "Haddad" &&
      visningsnamn(" ", "Haddad", "fornamn_e", "initialer") === "H." &&
      initialerFor("", "Haddad", "namn") === "H",
  );
  ok(
    "formen bara förnamn med tomt förnamn blir tom och därmed dold",
    visningsnamn(" ", "Haddad", "fornamn", "namn") === "En säljare",
  );
  ok(
    "ett namn som inte är en sträng räknas som tomt",
    [null, undefined].every((t) => visningsnamn(t, t, "hela", "namn") === "En säljare" && initialerFor(t, t, "namn") === "·"),
  );

  // Första bokstaven tas efter NFC: ett Å som A + kombinerande ring är ändå ett Å.
  const aRing = "Åsa"; // Åsa, nedbrutet
  const oPrick = "Öberg"; // Öberg, nedbrutet
  ok("ett nedbrutet Å och Ö ger rätt monogram", initialerFor(aRing, oPrick, "namn") === "ÅÖ");
  ok("och med gemener", initialerFor("åsa", "öberg", "namn") === "ÅÖ");
  ok("och i initialformen", visningsnamn(aRing, oPrick, "fornamn_e", "initialer") === "Å. Ö.");
  ok("och i efternamnets initial", visningsnamn("Elin", oPrick, "fornamn_e", "namn") === "Elin Ö.");
  ok("namnet skrivs sammansatt", visningsnamn(aRing, oPrick, "hela", "namn") === "Åsa Öberg");
  ok("ett sammansatt namn är oförändrat", initialerFor("Åsa", "Öberg", "namn") === "ÅÖ" && visningsnamn("Åsa", "Öberg", "hela", "namn") === "Åsa Öberg");
}

// --- Stor affär --------------------------------------------------------------
{
  const auto = { lage: "auto", belopp: 30000 };
  const tusental = (n) => Array.from({ length: n }, (_, i) => (i + 1) * 1000);

  ok("nitton värden ger 30 000 i auto", storAffarTroskel(tusental(19), auto) === 30000);
  ok("inga värden alls ger 30 000 i auto", storAffarTroskel([], auto) === 30000);

  // Reserven är specens 30 000 och följer inte det fasta beloppet, som inte
  // gäller så länge läget är auto.
  ok(
    "reserven är 30 000 även när det fasta beloppet är ett annat",
    storAffarTroskel(tusental(19), { lage: "auto", belopp: 50000 }) === 30000,
  );

  // Exakt tjugo värden är den första gången percentilen används:
  // position 0,9 × 19 = 17,1 ger 18 000 + 0,1 × 1 000.
  ok("tjugo värden räcker för percentilen", storAffarTroskel(tusental(20), auto) === 18100);

  // Tjugoett värden är en rak träff: position 0,9 × 20 = 18 är det nittonde värdet.
  ok("en rak träff på ett värde ger det värdet", storAffarTroskel(tusental(21), auto) === 19000);

  // percentile_cont(0.9) över 1 000, 2 000 … 100 000 är 90 100.
  ok("hundra värden ger P90 med linjär interpolering", storAffarTroskel(tusental(100), auto) === 90100);

  const omvand = tusental(100).reverse();
  ok("ordningen på värdena spelar ingen roll", storAffarTroskel(omvand, auto) === 90100);
  ok("värdena sorteras inte om i anroparens lista", omvand[0] === 100000 && omvand[99] === 1000);

  ok(
    "ett fast belopp gäller som det är",
    storAffarTroskel(tusental(100), { lage: "belopp", belopp: 50000 }) === 50000 &&
      storAffarTroskel([], { lage: "belopp", belopp: 50000 }) === 50000,
  );
}

// --- Efterregistrerade order -------------------------------------------------
{
  ok("tre dagar före godkännandet med gräns två är efterregistrerad", arEfterregistrerad("2026-10-20", "2026-10-23", 2) === true);

  // "Mer än N dagar": exakt N dagar räknas inte.
  ok("exakt två dagar är inte mer än två", arEfterregistrerad("2026-10-21", "2026-10-23", 2) === false);
  ok("en order utan signeringsdatum är aldrig efterregistrerad", arEfterregistrerad(null, "2026-10-23", 2) === false);
  ok("samma dag är inte efterregistrerad", arEfterregistrerad("2026-10-23", "2026-10-23", 2) === false);
  ok(
    "gränsen noll tillåter bara samma dag",
    arEfterregistrerad("2026-10-22", "2026-10-23", 0) === true &&
      arEfterregistrerad("2026-10-23", "2026-10-23", 0) === false,
  );
  ok("ett signeringsdatum efter godkännandet är inte efterregistrerat", arEfterregistrerad("2026-10-25", "2026-10-23", 2) === false);
  ok("årsskiftet räknas rätt", arEfterregistrerad("2025-12-30", "2026-01-02", 2) === true);

  // Sommartidens slut (25 oktober, ett dygn på 25 timmar) ska inte göra två dygn
  // till mer än två.
  ok(
    "omställningen till vintertid ändrar inget",
    arEfterregistrerad("2026-10-24", "2026-10-26", 2) === false &&
      arEfterregistrerad("2026-10-24", "2026-10-26", 1) === true,
  );
}

// --- Tysta tider -------------------------------------------------------------
{
  const ljud = STANDARD.ljud; // på, volym 70, 08:00–18:00, tyst på helger
  const natt = { ...ljud, fran: "22:00", till: "06:00" };
  const nattAlla = { ...natt, helgTyst: false };
  const heldag = { ...ljud, fran: "00:00", till: "23:59" };
  const medHelg = { ...ljud, helgTyst: false };

  // Fredag 2026-10-23, sommartid (UTC+2).
  ok("fredag 09:30 svensk tid låter", ljudTillatet("2026-10-23T07:30:00Z", ljud) === true);
  ok("fredag 18:30 låter inte", ljudTillatet("2026-10-23T16:30:00Z", ljud) === false);
  ok("lördag 11:00 låter inte med tyst på helger", ljudTillatet("2026-10-24T09:00:00Z", ljud) === false);
  ok("före öppning i dag: bara klockslaget", nastaStart("2026-10-23T05:00:00Z", "08:00", true) === "08:00");
  ok("efter stängning en torsdag: i morgon", nastaStart("2026-10-22T17:00:00Z", "08:00", true) === "i morgon 08:00");
  ok("fredag kväll: måndag", nastaStart("2026-10-23T17:00:00Z", "08:00", true) === "måndag 08:00");
  ok("utan arbetsdagskrav: lördag är i morgon", nastaStart("2026-10-23T17:00:00Z", "08:00", false) === "i morgon 08:00");
  ok("julafton och juldagarna hoppas över", nastaStart("2026-12-23T17:00:00Z", "08:00", true) === "måndag 08:00", nastaStart("2026-12-23T17:00:00Z", "08:00", true));
  ok("en tid som inte går att läsa ger null", nastaStart("trasig", "08:00", true) === null && nastaStart("2026-10-23T05:00:00Z", "", true) === null);
  ok("lördag 11:00 låter när helgen inte är tyst", ljudTillatet("2026-10-24T09:00:00Z", medHelg) === true);

  // Fönstret är halvöppet: från och med `fran`, till men inte med `till`.
  ok("08:00 låter", ljudTillatet("2026-10-23T06:00:00Z", ljud) === true);
  ok("07:59 låter inte", ljudTillatet("2026-10-23T05:59:00Z", ljud) === false);
  ok("17:59 låter", ljudTillatet("2026-10-23T15:59:00Z", ljud) === true);
  ok("18:00 låter inte", ljudTillatet("2026-10-23T16:00:00Z", ljud) === false);

  // Vintertid (UTC+1) ger en annan förskjutning från samma klocka.
  ok("fredag 08:00 i januari låter", ljudTillatet("2027-01-15T07:00:00Z", ljud) === true);
  ok("fredag 07:59 i januari låter inte", ljudTillatet("2027-01-15T06:59:00Z", ljud) === false);

  ok("av betyder alltid tyst", ljudTillatet("2026-10-23T07:30:00Z", { ...ljud, pa: false }) === false);
  ok("volym noll betyder tyst", ljudTillatet("2026-10-23T07:30:00Z", { ...ljud, volym: 0 }) === false);

  // Ett fönster över midnatt: 22:00–06:00.
  ok("22:00 till 06:00 låter 23:00", ljudTillatet("2026-10-23T21:00:00Z", nattAlla) === true);
  ok("22:00 till 06:00 låter 05:00", ljudTillatet("2026-10-23T03:00:00Z", nattAlla) === true);
  ok("22:00 till 06:00 låter inte 12:00", ljudTillatet("2026-10-23T10:00:00Z", nattAlla) === false);
  ok(
    "22:00 till 06:00 börjar 22:00 och slutar 06:00",
    ljudTillatet("2026-10-23T20:00:00Z", nattAlla) === true &&
      ljudTillatet("2026-10-23T04:00:00Z", nattAlla) === false,
  );
  ok("natten gäller bara vardagar när helgen är tyst", ljudTillatet("2026-10-24T21:00:00Z", natt) === false);

  // Lika tider är ett tomt fönster. Det felar åt det tysta hållet.
  ok("lika från och till är tyst", ljudTillatet("2026-10-23T07:30:00Z", { ...ljud, fran: "09:30", till: "09:30" }) === false);

  // Julafton 2026 är en torsdag, och är bara ledig för att `arArbetsdag` säger det.
  ok("julafton är tyst med tyst på helger", ljudTillatet("2026-12-24T10:00:00Z", ljud) === false);
  ok("julafton låter när helgen inte är tyst", ljudTillatet("2026-12-24T10:00:00Z", medHelg) === true);
  ok("dagen före julafton låter", ljudTillatet("2026-12-23T10:00:00Z", ljud) === true);

  // Dagen är den svenska, inte den i UTC. 22:30 UTC är 00:30 dagen efter.
  ok("fredag kväll UTC är lördag natt i Sverige", ljudTillatet("2026-10-23T22:30:00Z", heldag) === false);
  ok("söndag kväll UTC är måndag natt i Sverige", ljudTillatet("2026-10-25T23:30:00Z", heldag) === true);

  ok("en tid som inte går att läsa är tyst, inte ett fel", ljudTillatet("inte en tid", ljud) === false);

  // Arbetsdagen för vilan och för omladdningen följer samma klocka och kalender.
  const dag = { fran: "08:00", till: "18:00" };
  const tio = { fran: "10:00", till: "16:00" };
  ok("fredag 09:30 är inom arbetsdagen", inomArbetsdag("2026-10-23T07:30:00Z", dag) === true);
  ok("fredag 18:30 är utanför", inomArbetsdag("2026-10-23T16:30:00Z", dag) === false);
  ok(
    "arbetsdagen är halvöppen",
    inomArbetsdag("2026-10-23T06:00:00Z", dag) === true &&
      inomArbetsdag("2026-10-23T05:59:00Z", dag) === false &&
      inomArbetsdag("2026-10-23T15:59:00Z", dag) === true &&
      inomArbetsdag("2026-10-23T16:00:00Z", dag) === false,
  );
  ok("lördag är utanför arbetsdagen", inomArbetsdag("2026-10-24T09:00:00Z", dag) === false);
  ok("julafton är utanför arbetsdagen", inomArbetsdag("2026-12-24T10:00:00Z", dag) === false);
  ok(
    "andra tider går att välja",
    inomArbetsdag("2026-10-23T07:30:00Z", tio) === false && inomArbetsdag("2026-10-23T10:00:00Z", tio) === true,
  );
  ok("en tid som inte går att läsa är utanför, inte ett fel", inomArbetsdag("inte en tid", dag) === false);
}

// --- Inställningarna ---------------------------------------------------------
{
  // Standarderna ligger fast: de är det en ny tavla börjar med.
  const FORVANTAD = {
    version: 1,
    lag: null,
    namn: "fornamn_e",
    ordning: "varde",
    mal: {},
    arbetsdag: { fran: "08:00", till: "18:00" },
    rorelse: "full",
    firande: {
      storAffar: { lage: "belopp", belopp: 40000 },
      forstaOrdern: true,
      dagensForsta: true,
      personbasta: true,
      dagsrekord: true,
      halvvags: true,
      maletNatt: true,
      efterregistreradDagar: 2,
    },
    ljud: { pa: true, volym: 70, fran: "08:00", till: "18:00", helgTyst: true },
  };
  ok("standardvärdena", lika(STANDARD, FORVANTAD));

  // Standarden är djupfryst. Ett skrivförsök (i en rutt, i ett prov) som ändrade
  // den hade ändrat vad varje fält faller tillbaka på, för alla senare anrop.
  ok(
    "STANDARD och alla delobjekt är frysta",
    [STANDARD, STANDARD.arbetsdag, STANDARD.firande, STANDARD.firande.storAffar, STANDARD.ljud].every(Object.isFrozen),
  );

  // Inget som läses ur databasen får fälla tavlan.
  ok("null ger standarden", lika(normalisera(null), STANDARD));
  ok(
    "skräp som helhet ger standarden",
    [undefined, "x", 42, true, [], [1, 2], {}].every((indata) => lika(normalisera(indata), STANDARD)),
  );
  ok("en tolkning delar ingenting med standarden", (() => {
    const a = normalisera(null);
    a.ljud.volym = 1;
    a.firande.storAffar.belopp = 1;
    a.mal["2026-10"] = 1;
    return a !== STANDARD && STANDARD.ljud.volym === 70 && STANDARD.firande.storAffar.belopp === 40000 && !("2026-10" in STANDARD.mal);
  })());

  // Klippning.
  const volymMed = (volym) => normalisera({ ljud: { volym } }).ljud.volym;
  ok("volymen klipps till 100", volymMed(400) === 100);
  ok("volymen klipps till 0", volymMed(-5) === 0);
  ok("volymen blir ett heltal", volymMed(70.6) === 71);
  ok("en volym som inte är ett tal ger standarden", ["hög", "70", null, NaN, Infinity, {}].every((v) => volymMed(v) === 70));
  ok("klippningen rör inte resten av ljudet", lika(normalisera({ ljud: { volym: 400 } }).ljud, { ...STANDARD.ljud, volym: 100 }));

  const dagarMed = (efterregistreradDagar) => normalisera({ firande: { efterregistreradDagar } }).firande.efterregistreradDagar;
  ok("efterregistrerad klipps till 30", dagarMed(99) === 30);
  ok("efterregistrerad klipps till 0", dagarMed(-3) === 0);
  ok("efterregistrerad blir ett heltal", dagarMed(2.4) === 2);

  const beloppMed = (belopp) => normalisera({ firande: { storAffar: { belopp } } }).firande.storAffar.belopp;
  ok("beloppet klipps upp till 1 000", beloppMed(5) === 1000);
  ok("beloppet klipps ned till 10 000 000", beloppMed(99_999_999) === 10_000_000);
  ok("ett belopp inom gränserna står kvar", beloppMed(50000) === 50000);

  // Tider.
  const franMed = (fran) => normalisera({ arbetsdag: { fran } }).arbetsdag.fran;
  // Före 18:00, som är standardens slut: en arbetsdag som slutar före den börjar är ogiltig (se nedan).
  ok("giltiga tider står kvar", ["00:00", "07:30", "17:59"].every((t) => franMed(t) === t));
  ok(
    "sent på dygnet går att välja som slut och som ljudtid",
    normalisera({ arbetsdag: { till: "23:59" } }).arbetsdag.till === "23:59" &&
      normalisera({ ljud: { fran: "23:59" } }).ljud.fran === "23:59",
  );
  ok(
    "ogiltiga tider ger standarden",
    ["8:00", "24:00", "25:00", "12:60", "12:5", "12:00:00", "kl 8", "", 800, null].every((t) => franMed(t) === "08:00"),
  );
  ok(
    "bara det ogiltiga fältet faller tillbaka",
    lika(normalisera({ arbetsdag: { fran: "nu", till: "20:00" } }).arbetsdag, { fran: "08:00", till: "20:00" }),
  );
  ok(
    "ljudtiden tolkas på samma sätt",
    lika(normalisera({ ljud: { fran: "7", till: "21:30" } }).ljud, { ...STANDARD.ljud, till: "21:30" }),
  );

  // Arbetsdagen är bredden på tidslinjen, och tidslinjen delar med den. Slutar den
  // före eller när den börjar är den ogiltig, och HELA paret faller tillbaka på
  // standarden: en halv arbetsdag (nytt "från" med gammalt "till") vore en gissning.
  const arbetsdagMed = (arbetsdag) => normalisera({ arbetsdag }).arbetsdag;
  ok("en arbetsdag som slutar före den börjar faller tillbaka", lika(arbetsdagMed({ fran: "18:00", till: "08:00" }), STANDARD.arbetsdag));
  ok("en arbetsdag utan bredd faller tillbaka", lika(arbetsdagMed({ fran: "09:00", till: "09:00" }), STANDARD.arbetsdag));
  ok(
    "en minut är en arbetsdag",
    lika(arbetsdagMed({ fran: "09:00", till: "09:01" }), { fran: "09:00", till: "09:01" }) &&
      lika(arbetsdagMed({ fran: "00:00", till: "23:59" }), { fran: "00:00", till: "23:59" }),
  );
  ok(
    "paret faller tillbaka ihop och inte fält för fält",
    lika(arbetsdagMed({ fran: "20:00", till: "19:00" }), STANDARD.arbetsdag) &&
      lika(arbetsdagMed({ fran: "20:00", till: "nu" }), STANDARD.arbetsdag),
  );
  ok(
    "ett ensamt fält som ger ett ogiltigt par faller tillbaka",
    lika(arbetsdagMed({ fran: "20:00" }), STANDARD.arbetsdag) && lika(arbetsdagMed({ till: "07:59" }), STANDARD.arbetsdag),
  );
  ok(
    "ett giltigt par står kvar",
    lika(arbetsdagMed({ fran: "06:00", till: "22:00" }), { fran: "06:00", till: "22:00" }),
  );

  // Men ljudtiden FÅR gå över midnatt (22:00–06:00) och får vara lika: det är ett
  // tomt fönster och inte ett fel (se ljudTillatet).
  ok(
    "ljudtiden över midnatt står kvar",
    lika(normalisera({ ljud: { fran: "22:00", till: "06:00" } }).ljud, { ...STANDARD.ljud, fran: "22:00", till: "06:00" }),
  );
  ok(
    "ljudtiden med lika tider står kvar",
    lika(normalisera({ ljud: { fran: "09:30", till: "09:30" } }).ljud, { ...STANDARD.ljud, fran: "09:30", till: "09:30" }),
  );

  // Val och brytare.
  ok("okänt namnval ger standarden", normalisera({ namn: "x" }).namn === "fornamn_e");
  ok("känt namnval står kvar", ["fornamn", "fornamn_e", "hela"].every((n) => normalisera({ namn: n }).namn === n));
  ok(
    "okänd rörelse ger standarden",
    normalisera({ rorelse: "snabb" }).rorelse === "full" && normalisera({ rorelse: "lugn" }).rorelse === "lugn",
  );
  ok(
    "okänt läge för stor affär ger standarden",
    normalisera({ firande: { storAffar: { lage: "alltid" } } }).firande.storAffar.lage === "belopp" &&
      normalisera({ firande: { storAffar: { lage: "auto" } } }).firande.storAffar.lage === "auto",
  );

  const skrap = normalisera({ ordning: "nej", firande: { dagsrekord: 0, halvvags: "ja" } });
  ok(
    "en brytare måste vara en riktig brytare",
    skrap.ordning === "varde" && skrap.firande.dagsrekord === true && skrap.firande.halvvags === true,
  );
  const av = normalisera({ ordning: "antal", ljud: { helgTyst: false }, firande: { halvvags: false } });
  ok(
    "en brytare går att stänga av",
    av.ordning === "antal" && av.ljud.helgTyst === false && av.firande.halvvags === false,
  );
  ok(
    "fel typ för en hel grupp ger gruppens standard",
    lika(normalisera({ firande: "alla", ljud: [1], arbetsdag: 5 }), STANDARD),
  );

  // Laget.
  ok("ett lag står kvar", normalisera({ lag: "team-1" }).lag === "team-1");
  ok("ett tomt eller felaktigt lag betyder alla", ["", "  ", 5, {}, undefined].every((l) => normalisera({ lag: l }).lag === null));

  // Okända nycklar och versionen.
  const med = normalisera({ foo: 1, version: 7, ljud: { x: 2, volym: 50 }, firande: { storAffar: { y: 3 } } });
  const nycklar = (o) => Object.keys(o).sort();
  ok(
    "okända nycklar klipps bort på alla nivåer",
    lika(nycklar(med), nycklar(STANDARD)) &&
      lika(nycklar(med.ljud), nycklar(STANDARD.ljud)) &&
      lika(nycklar(med.firande), nycklar(STANDARD.firande)) &&
      lika(nycklar(med.firande.storAffar), ["belopp", "lage"]),
  );
  ok("versionen är alltid 1", med.version === 1);

  // Tolkningen ändrar inget som redan är tolkat.
  const rorig = {
    namn: "hela",
    ordning: "ja",
    mal: { "2026-10": 550000.4, "2026-11": "x" },
    ljud: { volym: 250, fran: "6:00" },
    firande: { efterregistreradDagar: 3.7, storAffar: { belopp: 1 } },
    strunt: [1],
  };
  ok("normalisera är idempotent", lika(normalisera(normalisera(rorig)), normalisera(rorig)));
  ok("och klarar en tur genom JSON", lika(normalisera(JSON.parse(JSON.stringify(normalisera(rorig)))), normalisera(rorig)));

  // Uppdatering: delar in, resten kvar.
  const utanKund = uppdatera(STANDARD, { ordning: "antal" });
  ok("uppdatera ändrar det som skickas", utanKund.ordning === "antal");
  ok("och lämnar resten oförändrat", lika({ ...utanKund, ordning: "varde" }, STANDARD));
  const tvaMal = uppdatera(uppdatera(STANDARD, { mal: { "2026-10": 550_000 } }), { mal: { "2026-11": 600_000 } });
  ok("ett nytt mål läggs till de som finns", lika(tvaMal.mal, { "2026-10": 550_000, "2026-11": 600_000 }), JSON.stringify(tvaMal.mal));

  const tystare = uppdatera(STANDARD, { ljud: { volym: 30 } });
  ok(
    "en del av en grupp ändrar bara den delen",
    lika(tystare.ljud, { ...STANDARD.ljud, volym: 30 }) && lika(tystare.firande, STANDARD.firande),
  );

  // EN DÅLIG SKRIVNING ÄNDRAR INGENTING. Det som inte går att läsa faller tillbaka
  // på det som gäller nu, inte på standarden.
  const nu = uppdatera(STANDARD, { namn: "hela", lag: "team-1", ljud: { volym: 30 } });
  const efterSkrap = uppdatera(nu, { namn: "x", lag: 5, ljud: { volym: "hög", fran: "tidigt" }, firande: "alla", okand: 1 });
  ok("dåliga delar lämnar det som gäller nu orört", lika(efterSkrap, nu));
  ok("ingenting att uppdatera ger samma inställningar", [null, undefined, "x", 3, [], {}].every((d) => lika(uppdatera(nu, d), nu)));
  ok("en klippt del klipps, den faller inte tillbaka", uppdatera(nu, { ljud: { volym: 400 } }).ljud.volym === 100);
  ok("lag: null betyder alla igen", uppdatera(nu, { lag: null }).lag === null);
  ok("lag lämnas orört när det inte nämns", uppdatera(nu, { namn: "fornamn" }).lag === "team-1");

  // Ingenting delas eller ändras i det som skickas in.
  const djupfrys = (o) => {
    for (const v of Object.values(o)) if (typeof v === "object" && v !== null) djupfrys(v);
    return Object.freeze(o);
  };
  const frysta = djupfrys(structuredClone(nu));
  const nyare = uppdatera(frysta, djupfrys({ ljud: { volym: 10 }, firande: { storAffar: { belopp: 60000 } } }));
  ok(
    "uppdatera ändrar inte inställningarna som skickas in",
    frysta.ljud.volym === 30 && nyare.ljud.volym === 10 && nyare.firande.storAffar.belopp === 60000 && nyare !== frysta,
  );
  ok("uppdatera tolkar även det som gäller nu", uppdatera({ ljud: { volym: 999 } }, {}).ljud.volym === 100);

  // Arbetsdagen i uppdatera: ett par som blir ogiltigt av en dålig skrivning
  // lämnar det som gäller nu orört (inte standarden).
  const smal = uppdatera(STANDARD, { arbetsdag: { fran: "09:00", till: "17:00" } });
  ok("uppdatera sätter en giltig arbetsdag", lika(smal.arbetsdag, { fran: "09:00", till: "17:00" }));
  ok(
    "uppdatera lämnar arbetsdagen orörd när paret skulle bli ogiltigt",
    lika(uppdatera(smal, { arbetsdag: { fran: "20:00" } }).arbetsdag, smal.arbetsdag) &&
      lika(uppdatera(smal, { arbetsdag: { till: "08:00" } }).arbetsdag, smal.arbetsdag) &&
      lika(uppdatera(smal, { arbetsdag: { fran: "17:00", till: "09:00" } }).arbetsdag, smal.arbetsdag),
  );
  ok(
    "uppdatera kan flytta båda ändarna på en gång",
    lika(uppdatera(smal, { arbetsdag: { fran: "20:00", till: "22:00" } }).arbetsdag, { fran: "20:00", till: "22:00" }),
  );
  ok(
    "en ogiltig arbetsdag som redan ligger sparad rättas vid nästa uppdatering",
    lika(uppdatera({ arbetsdag: { fran: "18:00", till: "08:00" } }, {}).arbetsdag, STANDARD.arbetsdag),
  );

  // SIST I AVSNITTET. Fryser inte STANDARD, ändrar skrivförsöken den och alla prov
  // efter dem faller. Därför ligger de här och inte bland standardvärdena.
  const skrivforsok = [
    () => { STANDARD.namn = "hela"; },
    () => { STANDARD.arbetsdag.fran = "00:00"; },
    () => { STANDARD.ljud.volym = 1; },
    () => { STANDARD.firande.storAffar.belopp = 1; },
    () => { STANDARD.firande.nytt = true; },
    () => { delete STANDARD.ordning; },
    () => { STANDARD.ljud = { pa: false }; },
  ];
  let kastade = 0;
  for (const forsok of skrivforsok) {
    // I strikt läge (en modul är det) kastar ett skrivförsök mot en fryst post. Det är i sin ordning.
    try { forsok(); } catch { kastade++; }
  }
  ok("ett skrivförsök kastar i strikt läge", kastade === skrivforsok.length, `${kastade} av ${skrivforsok.length}`);
  ok("ett skrivförsök ändrar inte STANDARD", lika(STANDARD, FORVANTAD));
  ok("och inte vad normalisera faller tillbaka på", lika(normalisera(null), FORVANTAD) && lika(normalisera({ ljud: "x" }), FORVANTAD));
}

// -----------------------------------------------------------------------------
console.log("\nplanera");

{
  const NU = "2026-10-23T10:00:00Z"; // fredag 12:00 svensk tid
  const DAG = "2026-10-23";
  const NATT = "2026-10-23T09:59:00Z"; // när laget nådde målet

  /** `minuter` före `nu`, som ISO. */
  const fore = (minuter, nu = NU) => new Date(Date.parse(nu) - minuter * 60_000).toISOString();
  const typer = (r) => r.firanden.map((f) => f.typ);
  const djup = (o) => {
    for (const v of Object.values(o)) if (typeof v === "object" && v !== null) djup(v);
    return Object.freeze(o);
  };

  /** En godkänd order i dag. Standarden är färsk, inte efterregistrerad och inget särskilt. */
  const ord = (nyckel, over = {}) => ({
    nyckel,
    person: "p1",
    tid: fore(2),
    dag: DAG,
    vad: "Paket 2 · 24 mån",
    kund: "Bergs Bygg AB",
    belopp: 17940,
    niva: "vanlig",
    efterreg: false,
    forstaNagonsin: false,
    saljarensDagsantal: 1,
    saljarensBasta: 3,
    ...over,
  });
  /** Dagens första order, känd sedan länge, så att en ny order inte är dagens första av en slump. */
  const TIDIG = ord("tidig", { tid: "2026-10-23T06:30:00Z" });

  /**
   * En ögonblicksbild med rimliga standarder: 5 av målet 100 (så att varken
   * halvvägs eller målet kommer av sig självt), 2 i dag mot en bästa dag på 9
   * (inget dagsrekord) och en enda känd order. `inst` läggs över firandebrytarna.
   */
  const bild = ({ nu = NU, manad, idag, inst, ...rest } = {}) => {
    const { lag, ...utanLag } = structuredClone(STANDARD);
    return {
      v: 1,
      nu,
      bygge: "abc123",
      lag: null,
      skarm: null,
      installningar: { ...utanLag, firande: { ...utanLag.firande, ...inst } },
      manad: {
        nyckel: "2026-10",
        namn: "Oktober",
        antal: 5,
        mal: 100,
        forvantat: 4,
        prognos: 22,
        dagar: { gangna: 17, totalt: 22 },
        natt: null,
        storsta: null,
        ...manad,
        // Reglerna räknar på ordervärdet (R35). Proven skriver målet i "antal" av vana, och
        // värdet följer antalet om inget annat sägs, så att varje korsning provas i kronor.
        varde: manad?.varde ?? manad?.antal ?? 5,
      },
      idag: { datum: DAG, antal: 2, summa: 35000, bastaDag: 9, ...idag },
      order: [TIDIG],
      // R23 felar åt det dolda hållet: en säljare som saknas räknas som dold. Fixturens
      // säljare syns därför med namn, så att varianten och taggarna går att prova.
      personer: { p1: { nyckel: "p1", namn: "Amira H.", initialer: "AH", motiv: 2, dold: false } },
      handelser: [],
      ...rest,
    };
  };
  /** Bilden med nya order överst (den nyaste först, som servern listar dem) och den kända under. */
  const med = (nya, over = {}) => bild({ order: [...nya, TIDIG], ...over });
  const minneAv = (over = {}) => ({ kanda: [], dag: DAG, handelse: 0, manad: "2026-10", halvvags: false, malet: false, dagsrekord: null, ...over });
  /** Ett steg i vanlig drift: minnet efter en start på `forra`, om inget annat anges. */
  const steg = (forra, ny, minne = planera(null, forra, null).minne) => planera(forra, ny, minne);

  const grund = bild();
  const m0 = planera(null, grund, null).minne;

  // --- Start: allt som finns är sett, ingenting firas ------------------------
  {
    const tre = bild({ order: [ord("c", { tid: fore(1) }), ord("b", { tid: fore(3) }), ord("a", { tid: fore(5) })] });
    const s = planera(null, tre, null);
    ok("start med tre order ger inga firanden", s.firanden.length === 0);
    ok("och alla tre är kända", lika([...s.minne.kanda].sort(), ["a", "b", "c"]));
    ok("minnet bär månaden", s.minne.manad === "2026-10");

    const utanMinne = planera(tre, tre, null);
    ok(
      "saknas minnet är det en start även när det finns en förra bild",
      utanMinne.firanden.length === 0 && utanMinne.minne.kanda.length === 3,
    );
    const utanForra = planera(null, tre, minneAv());
    ok(
      "saknas den förra bilden är det en start även när det finns ett minne",
      utanForra.firanden.length === 0 && utanForra.minne.kanda.length === 3,
    );
    ok(
      "och ett minne från en annan dag byts mot bildens nycklar vid en start",
      lika([...planera(null, tre, minneAv({ kanda: ["gammal"], dag: "2026-10-22" })).minne.kanda].sort(), ["a", "b", "c"]),
    );
    ok(
      "men ett minne från samma dag behåller sina nycklar över en start",
      lika([...planera(null, tre, minneAv({ kanda: ["gammal"] })).minne.kanda].sort(), ["a", "b", "c", "gammal"]),
    );

    // Testhändelser: id 7 är högst, och ingen spelas.
    const hb = (id, typ = "stor") => ({ id, typ, tid: fore(0) });
    const medTest = bild({ handelser: [hb(4), hb(7), hb(5)] });
    ok("start spelar inga testhändelser", planera(null, medTest, null).firanden.length === 0);
    ok("handelse blir högsta id", planera(null, medTest, null).minne.handelse === 7);
    ok("och är noll utan testhändelser", s.minne.handelse === 0);
    ok("handelse går aldrig bakåt vid en omstart", planera(null, bild({ handelser: [hb(3)] }), minneAv({ handelse: 12 })).minne.handelse === 12);

    // Halvvägs och målet sätts till om de redan passerats.
    const flaggor = (antal, mal) => {
      const m = planera(null, bild({ manad: { antal, mal } }), null).minne;
      return [m.halvvags, m.malet];
    };
    ok("start före halva målet sätter ingen flagga", lika(flaggor(4, 10), [false, false]));
    ok("start vid halva målet sätter halvvägs", lika(flaggor(5, 10), [true, false]));
    ok("start vid och över målet sätter båda", lika(flaggor(10, 10), [true, true]) && lika(flaggor(12, 10), [true, true]));
    ok("start utan mål sätter ingen flagga", lika(flaggor(12, null), [false, false]) && lika(flaggor(12, 0), [false, false]));
    ok("halva målet avrundas uppåt", lika(flaggor(4, 9), [false, false]) && lika(flaggor(5, 9), [true, false]));

    // Dagsrekord: sätts till dagens datum om antalet i dag redan slagit månadens bästa dag.
    const rek = (antal, bastaDag) => planera(null, bild({ idag: { antal, bastaDag } }), null).minne.dagsrekord;
    ok("start med ett redan slaget dagsrekord sätter dagens datum", rek(4, 3) === DAG);
    ok("start utan slaget dagsrekord sätter inget", rek(3, 3) === null && rek(2, 3) === null && rek(0, 0) === null);
    // Rekordet räknas som slaget vid start bara om det hade firats: minst tre i dag och en bästa dag att slå.
    ok("start räknar inte rekordet som slaget under lägstanivån på tre", rek(2, 1) === null && rek(1, 0) === null);
    ok("och inte när det inte finns någon bästa dag att slå", rek(3, 0) === null && rek(9, 0) === null);

    // En omstart med 2 mot bästa 1 tar inte ifrån dagen dess rekord: det sägs när laget når tre, som utan omstart.
    {
      const a1 = ord("a1", { tid: fore(60) });
      const a2 = ord("a2", { tid: fore(30) });
      const a3 = ord("a3", { tid: fore(1) });
      const efterEn = bild({ idag: { antal: 1, bastaDag: 1 }, order: [a1] });
      const efterTva = bild({ idag: { antal: 2, bastaDag: 1 }, order: [a2, a1] });
      const efterTre = bild({ idag: { antal: 3, bastaDag: 1 }, order: [a3, a2, a1] });

      const utanOmstart = steg(efterTva, efterTre, steg(efterEn, efterTva).minne);
      const medOmstart = steg(efterTva, efterTre, planera(null, efterTva, null).minne);
      const rekordTagg = (r) => r.firanden[0].taggar.filter((t) => t.typ === "dagsrekord");
      ok("utan omstart får tredje ordern rekordet", lika(rekordTagg(utanOmstart), [{ typ: "dagsrekord", nu: 3, forra: 1 }]));
      ok("efter en omstart vid två får tredje ordern det också", lika(rekordTagg(medOmstart), [{ typ: "dagsrekord", nu: 3, forra: 1 }]));
      ok("och omstartens minne hade inte förbrukat det", planera(null, efterTva, null).minne.dagsrekord === null);
    }

    // En omstart mitt i månaden med ett minne från samma månad: det som firats står kvar.
    const firat = minneAv({ halvvags: true, malet: true, dagsrekord: DAG });
    const omstart = planera(null, bild({ manad: { antal: 9, mal: 10 } }), firat);
    ok(
      "en omstart samma månad behåller det som redan firats",
      omstart.minne.malet === true && omstart.minne.halvvags === true && omstart.minne.dagsrekord === DAG,
    );
    ok(
      "och målet firas inte igen när antalet når det efter omstarten",
      steg(bild({ manad: { antal: 9, mal: 10 } }), bild({ manad: { antal: 10, mal: 10 } }), omstart.minne).firanden.length === 0,
    );
    const annanManad = planera(null, bild({ manad: { antal: 3, mal: 10 } }), minneAv({ manad: "2026-09", halvvags: true, malet: true, dagsrekord: DAG }));
    ok(
      "ett minne från en annan månad räknas inte",
      annanManad.minne.malet === false &&
        annanManad.minne.halvvags === false &&
        annanManad.minne.dagsrekord === null &&
        annanManad.minne.manad === "2026-10",
    );
    ok(
      "en omstart bär också halvvägs när antalet fallit under halva målet",
      (() => {
        const o = planera(null, bild({ manad: { antal: 4, mal: 10 } }), minneAv({ halvvags: true }));
        return o.minne.halvvags === true && o.minne.malet === false && steg(bild({ manad: { antal: 4, mal: 10 } }), bild({ manad: { antal: 5, mal: 10 } }), o.minne).firanden.length === 0;
      })(),
    );

    // Ett minne från en annan månad än bildens är en start, också när det finns en
    // förra bild från den här månaden: då firas inte en ny order eller ett mål mot ett gammalt minne.
    const septemberMinne = minneAv({ manad: "2026-09", kanda: [], halvvags: true, malet: true, dagsrekord: DAG });
    const motSeptember = planera(grund, med([ord("ny1")], { manad: { antal: 10, mal: 10 } }), septemberMinne);
    ok("ett minne från en annan månad än bildens ger en start trots en förra bild", motSeptember.firanden.length === 0);
    ok("och det nya minnet gäller bildens månad", motSeptember.minne.manad === "2026-10" && motSeptember.minne.kanda.includes("ny1"));

    // Och tvärtom: antalen i en förra bild från en annan månad går inte att jämföra med bildens.
    // Bilderna ligger tätt (midnatt svensk tid, 22:00 UTC), så att det inte är avbrottet som tystar målet.
    const septemberBild = bild({ nu: "2026-09-30T21:59:30Z", manad: { nyckel: "2026-09", namn: "September", antal: 3, mal: 10 }, idag: { datum: "2026-09-30" }, order: [] });
    const oktoberBild = bild({ nu: "2026-09-30T22:00:10Z", manad: { antal: 12, mal: 10 }, idag: { datum: "2026-10-01" }, order: [] });
    const motForraManad = planera(septemberBild, oktoberBild, minneAv());
    ok("en förra bild från en annan månad räknas inte, så antalet har inte passerat något", motForraManad.firanden.length === 0);
    ok("men målet räknas som passerat i det nya minnet", motForraManad.minne.malet === true && motForraManad.minne.halvvags === true);
  }

  // --- Ny order ---------------------------------------------------------------
  {
    const ny1 = ord("ny1");
    const tom0 = bild({ order: [], idag: { antal: 0 } });
    const mTom0 = planera(null, tom0, null).minne;
    const r1 = steg(grund, med([ny1]), m0);
    ok("en ny färsk order ger ett order-firande", r1.firanden.length === 1 && r1.firanden[0].typ === "order");
    ok("med ordern själv och varianten vanlig", lika(r1.firanden[0].order, ny1) && r1.firanden[0].variant === "vanlig");
    ok("utan taggar när inget särskilt hänt", lika(r1.firanden[0].taggar, []));
    ok(
      "ett order-firande har exakt de fält gränssnittet anger",
      lika(Object.keys(r1.firanden[0]).sort(), ["order", "taggar", "typ", "variant"]),
    );
    ok("ordern blir känd, och den gamla står kvar", lika([...r1.minne.kanda].sort(), ["ny1", "tidig"]));

    const r1b = steg(med([ny1]), med([ny1]), r1.minne);
    ok("samma bild igen ger inga firanden", r1b.firanden.length === 0);
    ok("och ändrar inte minnet", lika(r1b.minne, r1.minne));

    // Färskhet: tio minuter är gränsen, och "högst" tio firas.
    const medTid = (tid) => steg(grund, med([ord("g", { tid })]), m0);
    ok("en order 11 minuter gammal firas inte", medTid(fore(11)).firanden.length === 0);
    ok("men blir känd, så att den inte firas senare", medTid(fore(11)).minne.kanda.includes("g"));
    ok("en order 9 minuter gammal firas", medTid(fore(9)).firanden.length === 1);
    ok("exakt tio minuter firas fortfarande", medTid(new Date(Date.parse(NU) - FARSK_MS).toISOString()).firanden.length === 1);
    ok("en millisekund mer gör att den inte firas", medTid(new Date(Date.parse(NU) - FARSK_MS - 1).toISOString()).firanden.length === 0);
    // Servern och databasen har inte exakt samma klocka: en order några sekunder "i framtiden" är färsk.
    ok("en order med tid strax efter bildens tid firas", medTid(new Date(Date.parse(NU) + 3000).toISOString()).firanden.length === 1);
    ok("en tid som inte går att läsa firas inte men blir känd", medTid("inte en tid").firanden.length === 0 && medTid("inte en tid").minne.kanda.includes("g"));
    ok("en bild vars egen tid inte går att läsa firar ingenting", steg(grund, med([ny1], { nu: "inte en tid" }), m0).firanden.length === 0);
    ok("färskheten är tio minuter", FARSK_MS === 600_000 && TEST_FARSK_MS === 120_000);

    // Lika tid: order med exakt samma tid står kvar i den ordning listan gav dem.
    const lika1 = ord("l1", { tid: fore(3) });
    const lika2 = ord("l2", { tid: fore(3) });
    const rLika = steg(tom0, bild({ order: [lika1, lika2], idag: { antal: 2 } }), mTom0);
    ok("order med exakt samma tid firas i den ordning listan ger", lika(rLika.firanden.map((f) => f.order.nyckel), ["l1", "l2"]));
    ok("och dagens första hör till den som står först", lika(rLika.firanden[0].taggar, [{ typ: "dagensForsta" }]) && lika(rLika.firanden[1].taggar, []));
    ok(
      "samma tid i omvänd lista ger omvänd ordning",
      lika(steg(tom0, bild({ order: [lika2, lika1], idag: { antal: 2 } }), mTom0).firanden.map((f) => f.order.nyckel), ["l2", "l1"]),
    );

    // En order som listas två gånger firas en gång och minns en gång.
    const dubbel = steg(grund, med([ny1, ny1]), m0);
    ok("en order som listas två gånger firas en gång", dubbel.firanden.length === 1);
    ok("och finns en gång i minnet", dubbel.minne.kanda.filter((k) => k === "ny1").length === 1);

    // En order vars tid inte går att läsa kan inte placeras, och tar inte dagens första ifrån de andra.
    const oklar = ord("oklar", { tid: "inte en tid" });
    const rOklar = steg(tom0, bild({ order: [oklar, ord("klar", { tid: fore(1) })], idag: { antal: 2 } }), mTom0);
    ok("en order med oläsbar tid firas inte", lika(rOklar.firanden.map((f) => f.order.nyckel), ["klar"]));
    ok("och tar inte dagens första ifrån en order med läsbar tid", lika(rOklar.firanden[0].taggar, [{ typ: "dagensForsta" }]));

    // Efterregistrerad och annan dag.
    const efter = steg(grund, med([ord("e", { efterreg: true })]), m0);
    ok("en efterregistrerad order firas inte", efter.firanden.length === 0);
    ok("men blir känd", efter.minne.kanda.includes("e"));

    // Strax efter midnatt: en order från 23:58 är sju minuter gammal men gårdagens.
    const mid = { nu: "2026-10-22T22:05:00Z", idag: { datum: "2026-10-23", antal: 0, bastaDag: 4 } };
    const midBas = bild({ ...mid, order: [] });
    const sen = ord("sen", { tid: "2026-10-22T21:58:00Z", dag: "2026-10-22" });
    const rs = steg(midBas, bild({ ...mid, order: [sen] }));
    ok("gårdagens order firas inte hur färsk den än är", rs.firanden.length === 0);
    ok("men blir känd", rs.minne.kanda.includes("sen"));

    // Varianten.
    const variant = (over, inst) => steg(grund, bild({ order: [ord("v", over), TIDIG], inst }), m0).firanden[0].variant;
    ok("en första order någonsin ger forsta", variant({ forstaNagonsin: true }) === "forsta");
    ok("en stor affär ger stor", variant({ niva: "stor" }) === "stor");
    ok("en vanlig order ger vanlig", variant({}) === "vanlig");
    ok("en första order som också är stor ger forsta", variant({ forstaNagonsin: true, niva: "stor" }) === "forsta");
    ok(
      "utan brytaren för första ordern ger den ändå inte forsta",
      variant({ forstaNagonsin: true }, { forstaOrdern: false }) === "vanlig" &&
        variant({ forstaNagonsin: true, niva: "stor" }, { forstaOrdern: false }) === "stor",
    );
  }

  // --- Taggar ----------------------------------------------------------------
  {
    const tom = bild({ order: [], idag: { antal: 0 } });
    const mTom = planera(null, tom, null).minne;
    const ensam = (over = {}, inst) => steg(tom, bild({ order: [ord("f", over)], idag: { antal: 1 }, inst }), mTom).firanden[0].taggar;

    ok("dagens första order får taggen dagensForsta", lika(ensam(), [{ typ: "dagensForsta" }]));
    ok("brytaren för dagens första stänger taggen", lika(ensam({}, { dagensForsta: false }), []));
    ok("en order som inte är dagens första får den inte", lika(steg(grund, med([ord("t")]), m0).firanden[0].taggar, []));

    // Gårdagens order är äldre men räknas inte som dagens tidigaste.
    const igar = ord("igar", { dag: "2026-10-22", tid: "2026-10-22T13:00:00Z" });
    ok(
      "en order från i går tar inte ifrån dagens första dess tagg",
      lika(steg(tom, bild({ order: [ord("f"), igar], idag: { antal: 1 } }), mTom).firanden[0].taggar, [{ typ: "dagensForsta" }]),
    );
    // Dagens tidigaste kan vara en order som inte firades (efterregistrerad). Då är ingen av de firade den första.
    const tidigEfter = ord("e1", { tid: fore(9), efterreg: true });
    const senare = ord("s1", { tid: fore(1) });
    const rEfter = steg(tom, bild({ order: [senare, tidigEfter], idag: { antal: 2 } }), mTom);
    ok(
      "dagens första är den tidigaste i dag även om den inte firades",
      typer(rEfter).join() === "order" && lika(rEfter.firanden[0].taggar, []),
    );

    // Personbästa.
    const pbTagg = (dagsantal, basta, inst) =>
      steg(grund, med([ord("p", { saljarensDagsantal: dagsantal, saljarensBasta: basta })], { inst }), m0).firanden[0].taggar;
    ok("två i dag med bästa en ger personbasta med antal två", lika(pbTagg(2, 1), [{ typ: "personbasta", antal: 2 }]));
    ok("tre i dag med bästa två ger personbasta med antal tre", lika(pbTagg(3, 2), [{ typ: "personbasta", antal: 3 }]));
    ok("lika med bästa är inte ett bästa", lika(pbTagg(2, 2), []) && lika(pbTagg(3, 3), []));
    ok("under bästa är inte ett bästa", lika(pbTagg(2, 5), []));
    ok("en enda order i dag är inget personbästa, inte ens mot noll", lika(pbTagg(1, 0), []));
    ok("brytaren för personbästa stänger taggen", lika(pbTagg(3, 1, { personbasta: false }), []));

    // "Hens bästa tidigare dag" förutsätter att det fanns en tidigare dag. Är bästa 0 finns den inte
    // (och tills statistiken finns är den 0 för alla): då ska ingens andra order få taggen.
    ok("två i dag med bästa 0 ger ingen personbästa-tagg", lika(pbTagg(2, 0), []));
    ok("inte heller fler i dag mot bästa 0", [3, 4, 9].every((n) => lika(pbTagg(n, 0), [])));
    ok("men bästa 1 räcker: två i dag ger taggen", lika(pbTagg(2, 1), [{ typ: "personbasta", antal: 2 }]));
    // R23: en dold säljare får inget personligt på tavlan. Ingen personbästa-tagg och ingen
    // "första ordern"; dagsrekordet och dagens första är lagets och står kvar.
    {
      const DOLD_P = { p1: { nyckel: "p1", namn: "En säljare", initialer: "·", motiv: null, dold: true } };
      const doldPb = steg(grund, med([ord("p", { saljarensDagsantal: 3, saljarensBasta: 1 })], { personer: DOLD_P }), m0).firanden[0];
      ok("R23: en dold säljare får ingen personbästa-tagg", lika(doldPb.taggar, []));
      const doldForsta = (over) => steg(grund, bild({ order: [ord("v", over), TIDIG], personer: DOLD_P }), m0).firanden[0].variant;
      ok("R23: en dold säljares första order är en vanlig ny order", doldForsta({ forstaNagonsin: true }) === "vanlig");
      ok("R23: och en stor affär om den är stor", doldForsta({ forstaNagonsin: true, niva: "stor" }) === "stor");
      const saknas = steg(grund, bild({ order: [ord("v", { person: "okand", forstaNagonsin: true, saljarensDagsantal: 3, saljarensBasta: 1 }), TIDIG] }), m0).firanden[0];
      ok("R23: en säljare som saknas i bilden räknas som dold", saknas.variant === "vanlig" && lika(saknas.taggar, []));
      const tomD = bild({ order: [], idag: { antal: 0 }, personer: DOLD_P });
      const mTomD = planera(null, tomD, null).minne;
      ok(
        "R23: dagens första står kvar för en dold säljare",
        lika(steg(tomD, bild({ order: [ord("f")], idag: { antal: 1 }, personer: DOLD_P }), mTomD).firanden[0].taggar, [{ typ: "dagensForsta" }]),
      );
      const rekordD = steg(
        grund,
        med([ord("r", { saljarensDagsantal: 3, saljarensBasta: 1 })], { idag: { antal: 10, bastaDag: 9 }, personer: DOLD_P }),
        m0,
      ).firanden[0];
      ok("R23: dagsrekordet står kvar för en dold säljare, men inte personbästa", lika(rekordD.taggar.map((t) => t.typ), ["dagsrekord"]));
      const synlig = steg(grund, med([ord("p", { saljarensDagsantal: 3, saljarensBasta: 1 })]), m0).firanden[0];
      ok("R23: en säljare som syns får personbästa som förut", lika(synlig.taggar, [{ typ: "personbasta", antal: 3 }]));
    }
    ok(
      "ingen annan tagg påverkas av att bästa är 0",
      lika(steg(grund, med([ord("p", { saljarensDagsantal: 2, saljarensBasta: 0 })]), m0).firanden[0].taggar, []) &&
        lika(steg(tom, bild({ order: [ord("f", { saljarensDagsantal: 2, saljarensBasta: 0 })], idag: { antal: 1 } }), mTom).firanden[0].taggar, [{ typ: "dagensForsta" }]),
    );

    // Dagsrekord: laget har 4 i dag med bästa dag 3, och rekordet hör till den sista nya ordern.
    const rekord = (fran, till, inst, minne) => {
      const forra = bild({ idag: { antal: fran[0], bastaDag: fran[1] }, inst });
      return steg(forra, bild({ idag: { antal: till[0], bastaDag: till[1] }, order: [ord("r"), TIDIG], inst }), minne ?? planera(null, forra, null).minne);
    };
    const r4 = rekord([3, 3], [4, 3]);
    ok("4 i dag mot bästa 3 ger dagsrekord på ordern", lika(r4.firanden[0].taggar, [{ typ: "dagsrekord", nu: 4, forra: 3 }]));
    ok("och minnet säger att dagen har sitt rekord", r4.minne.dagsrekord === DAG);

    const n4 = bild({ order: [ord("r"), TIDIG], idag: { antal: 4, bastaDag: 3 } });
    const n5 = bild({ order: [ord("r5", { tid: fore(1) }), ord("r"), TIDIG], idag: { antal: 5, bastaDag: 3 } });
    ok("nästa order samma dag får inget dagsrekord", lika(steg(n4, n5, r4.minne).firanden[0].taggar, []));
    ok(
      "en annan dag kan ge ett nytt",
      lika(rekord([3, 3], [4, 3], undefined, minneAv({ kanda: ["tidig"], dagsrekord: "2026-10-22" })).firanden[0].taggar, [{ typ: "dagsrekord", nu: 4, forra: 3 }]),
    );
    ok("lika med bästa dagen är inget rekord", lika(rekord([2, 3], [3, 3]).firanden[0].taggar, []));
    ok("under tre order i dag är inget rekord", lika(rekord([1, 1], [2, 1]).firanden[0].taggar, []));
    ok("tre i dag mot bästa två är ett rekord", lika(rekord([2, 2], [3, 2]).firanden[0].taggar, [{ typ: "dagsrekord", nu: 3, forra: 2 }]));
    // Första arbetsdagen i månaden finns ingen bästa dag (0): då finns inget rekord att slå, och
    // taggen "DAGSREKORD · 3 (FÖRRA 0)" ska aldrig synas.
    ok(
      "utan en bästa dag att slå (0) ger inget antal ett dagsrekord",
      [3, 4, 5, 9].every((till) => lika(rekord([till - 1, 0], [till, 0]).firanden[0].taggar, [])),
    );
    ok("och minnet förbrukar inget", rekord([2, 0], [3, 0]).minne.dagsrekord === null);
    ok("men bästa dag 1 räcker för ett rekord", lika(rekord([2, 1], [3, 1]).firanden[0].taggar, [{ typ: "dagsrekord", nu: 3, forra: 1 }]));
    const avstangd = rekord([3, 3], [4, 3], { dagsrekord: false });
    ok("brytaren för dagsrekord stänger taggen", lika(avstangd.firanden[0].taggar, []));
    ok("och förbrukar inte dagens rekord", avstangd.minne.dagsrekord === null);

    // Två nya i samma bild: rekordet på den sista, dagens första på den första, i tidsordning.
    const forraDag = bild({ order: [], idag: { antal: 3, bastaDag: 3 } });
    const mDag = planera(null, forraDag, null).minne;
    const tva = steg(
      forraDag,
      bild({ order: [ord("y2", { tid: fore(1) }), ord("y1", { tid: fore(3) })], idag: { antal: 5, bastaDag: 4 } }),
      mDag,
    );
    ok("två nya order blir två order-firanden i tidsordning", lika(tva.firanden.map((f) => f.order.nyckel), ["y1", "y2"]) && typer(tva).join() === "order,order");
    ok("dagens första hör till den första av dem", lika(tva.firanden[0].taggar, [{ typ: "dagensForsta" }]));
    ok("och dagsrekordet till den sista", lika(tva.firanden[1].taggar, [{ typ: "dagsrekord", nu: 5, forra: 4 }]));

    // Flera taggar på en order: dagsrekord, personbästa, dagens första.
    const alla = steg(
      bild({ order: [], idag: { antal: 3, bastaDag: 3 } }),
      bild({ order: [ord("a", { saljarensDagsantal: 3, saljarensBasta: 1 })], idag: { antal: 4, bastaDag: 3 } }),
      mDag,
    );
    ok(
      "taggarna kommer i visningsordningen",
      lika(alla.firanden[0].taggar.map((t) => t.typ), ["dagsrekord", "personbasta", "dagensForsta"]),
    );
  }

  // --- Serie -----------------------------------------------------------------
  {
    const s1 = ord("s1", { tid: fore(3) });
    const s2 = ord("s2", { tid: fore(2) });
    const s3 = ord("s3", { tid: fore(1) });
    const rs = steg(grund, med([s3, s2, s1]), m0);
    ok("tre nya order i en bild blir en serie", lika(typer(rs), ["serie"]));
    ok("med de tre i tidsordning", lika(rs.firanden[0].order.map((o) => o.nyckel), ["s1", "s2", "s3"]));
    ok("och inget mer i serien", lika(Object.keys(rs.firanden[0]).sort(), ["order", "typ"]));
    ok("alla tre blir kända", ["s1", "s2", "s3"].every((k) => rs.minne.kanda.includes(k)));

    const fyra = steg(grund, med([ord("s4", { tid: fore(0.5) }), s3, s2, s1]), m0);
    ok("fyra nya blir en serie med fyra", lika(typer(fyra), ["serie"]) && fyra.firanden[0].order.length === 4);
    ok("två nya blir två order-firanden", lika(typer(steg(grund, med([s2, s1]), m0)), ["order", "order"]));

    // Serien räknar dem som firas: en efterregistrerad bland tre blir två order.
    const medEfter = steg(grund, med([s3, ord("s2", { tid: fore(2), efterreg: true }), s1]), m0);
    ok("serien räknar bara dem som firas", lika(typer(medEfter), ["order", "order"]));
    ok("men den efterregistrerade blir känd", medEfter.minne.kanda.includes("s2"));
    ok(
      "tre nya med en gammal bland dem blir också två order",
      lika(typer(steg(grund, med([s3, s2, ord("s1", { tid: fore(30) })]), m0)), ["order", "order"]),
    );

    // En serie har ingen plats för taggar, så den förbrukar inte dagens rekord: nästa ensamma order får det.
    const forraRek = bild({ idag: { antal: 2, bastaDag: 3 } });
    const mRek = planera(null, forraRek, null).minne;
    const serieRek = steg(forraRek, med([s3, s2, s1], { idag: { antal: 5, bastaDag: 3 } }), mRek);
    ok("en serie förbrukar inte dagsrekordet", lika(typer(serieRek), ["serie"]) && serieRek.minne.dagsrekord === null);
    const efterSerie = steg(
      med([s3, s2, s1], { idag: { antal: 5, bastaDag: 3 } }),
      bild({ order: [ord("sist", { tid: fore(0.5) }), s3, s2, s1, TIDIG], idag: { antal: 6, bastaDag: 3 } }),
      serieRek.minne,
    );
    ok("utan att tappa det: nästa ensamma order får rekordet", lika(efterSerie.firanden[0].taggar, [{ typ: "dagsrekord", nu: 6, forra: 3 }]));
  }

  // --- Målet och halvvägs ------------------------------------------------------
  {
    const f9 = bild({ manad: { antal: 9, mal: 10 } });
    const m9 = planera(null, f9, null).minne;
    const f10 = bild({ manad: { antal: 10, mal: 10, natt: NATT }, order: [ord("sista"), TIDIG] });

    const rm = steg(f9, f10, m9);
    ok("9 till 10 med mål 10 ger målet sist, efter ordern", lika(typer(rm), ["order", "malet"]));
    ok("målet bär tiden det nåddes", lika(rm.firanden[1], { typ: "malet", natt: NATT }));
    ok("och minnet säger att målet är firat", rm.minne.malet === true && rm.minne.halvvags === true);
    ok("10 till 11 ger inget mål", steg(f10, bild({ manad: { antal: 11, mal: 10, natt: NATT }, order: [ord("sista"), TIDIG] }), rm.minne).firanden.length === 0);
    ok(
      "målet kan komma utan någon ny order (en efterregistrerad tog laget över)",
      lika(typer(steg(f9, bild({ manad: { antal: 10, mal: 10, natt: NATT } }), m9)), ["malet"]),
    );
    ok("utan natt används bildens tid", lika(steg(f9, bild({ manad: { antal: 10, mal: 10, natt: null } }), m9).firanden, [{ typ: "malet", natt: NU }]));
    ok(
      "en serie och målet blir serien först och målet sist",
      lika(
        typer(steg(f9, bild({ manad: { antal: 10, mal: 10, natt: NATT }, order: [ord("a3", { tid: fore(1) }), ord("a2", { tid: fore(2) }), ord("a1", { tid: fore(3) }), TIDIG] }), m9)),
        ["serie", "malet"],
      ),
    );

    // Halvvägs.
    const h4 = bild({ manad: { antal: 4, mal: 10 } });
    const h5 = bild({ manad: { antal: 5, mal: 10 } });
    const mh4 = planera(null, h4, null).minne;
    const rh = steg(h4, h5, mh4);
    ok("4 till 5 med mål 10 ger halvvägs", lika(rh.firanden, [{ typ: "halvvags" }]));
    ok("minnet säger halvvägs men inte målet", rh.minne.halvvags === true && rh.minne.malet === false);
    ok("5 till 6 ger inte halvvägs igen", steg(h5, bild({ manad: { antal: 6, mal: 10 } }), rh.minne).firanden.length === 0);
    ok("3 till 4 ger ingen halvvägs", steg(bild({ manad: { antal: 3, mal: 10 } }), h4, planera(null, bild({ manad: { antal: 3, mal: 10 } }), null).minne).firanden.length === 0);

    const h10 = bild({ manad: { antal: 10, mal: 10 } });
    const r410 = steg(h4, h10, mh4);
    ok("4 till 10 med mål 10 ger bara målet", lika(typer(r410), ["malet"]));
    ok("och minnet har båda flaggorna", r410.minne.malet === true && r410.minne.halvvags === true);
    ok("halvvägs avrundas uppåt: 4 till 5 med mål 9", lika(steg(bild({ manad: { antal: 4, mal: 9 } }), bild({ manad: { antal: 5, mal: 9 } })).firanden, [{ typ: "halvvags" }]));
    ok("ett stort steg över halva målet ger halvvägs", lika(steg(bild({ manad: { antal: 2, mal: 10 } }), bild({ manad: { antal: 7, mal: 10 } })).firanden, [{ typ: "halvvags" }]));
    ok("mål 1 ger bara målet", lika(typer(steg(bild({ manad: { antal: 0, mal: 1 } }), bild({ manad: { antal: 1, mal: 1 } }))), ["malet"]));
    ok(
      "halvvägs kommer efter ordern",
      lika(typer(steg(h4, bild({ manad: { antal: 5, mal: 10 }, order: [ord("hv"), TIDIG] }), mh4)), ["order", "halvvags"]),
    );

    // Utan mål finns varken halvvägs eller målet.
    ok(
      "utan mål firas varken halvvägs eller målet",
      [null, 0].every((mal) => steg(bild({ manad: { antal: 0, mal } }), bild({ manad: { antal: 60, mal } })).firanden.length === 0),
    );

    // Makulering: tyst, och målet nås inte en gång till.
    const c9 = bild({ manad: { antal: 9, mal: 10 }, order: [TIDIG] });
    const rc = steg(f10, c9, rm.minne);
    ok("en makulerad order försvinner tyst", rc.firanden.length === 0);
    ok("och dess nyckel står kvar i minnet resten av dagen", rc.minne.kanda.includes("sista"));
    ok("men målet är fortfarande firat", rc.minne.malet === true && rc.minne.halvvags === true);
    const k10 = bild({ manad: { antal: 10, mal: 10, natt: NATT }, order: [ord("sista2"), TIDIG] });
    const rk = steg(c9, k10, rc.minne);
    ok("9 till 10 efter en makulering ger inget nytt mål", lika(typer(rk), ["order"]));
    // Samma för halvvägs: 5 till 4 till 5.
    const rh4 = steg(h5, h4, rh.minne);
    ok("5 till 4 är tyst", rh4.firanden.length === 0 && rh4.minne.halvvags === true);
    ok("och 4 till 5 därefter firar inte halvvägs igen", steg(h4, h5, rh4.minne).firanden.length === 0);
    // Antalet är samma efter en makulering och en ny order: det är ordern som firas, inte antalet.
    ok("en ny order efter en makulering firas som vanligt", rk.firanden[0].order.nyckel === "sista2");

    // Brytarna: av betyder tyst, men minnet noterar att det passerats.
    const utanMal = steg(f9, bild({ manad: { antal: 10, mal: 10 }, inst: { maletNatt: false } }), m9);
    ok("brytaren för målet stänger firandet", utanMal.firanden.length === 0);
    ok("men målet räknas som passerat", utanMal.minne.malet === true);
    ok("och halvvägs firas inte i stället", steg(h4, bild({ manad: { antal: 10, mal: 10 }, inst: { maletNatt: false } }), mh4).firanden.length === 0);
    const utanHalv = steg(h4, bild({ manad: { antal: 5, mal: 10 }, inst: { halvvags: false } }), mh4);
    ok("brytaren för halvvägs stänger firandet", utanHalv.firanden.length === 0 && utanHalv.minne.halvvags === true);

    // Ett mål som ändras under månaden.
    const f11 = bild({ manad: { antal: 11, mal: 20 } });
    const sankt = steg(f11, bild({ manad: { antal: 11, mal: 10 } }));
    ok("ett mål som sänks under antalet firas inte", sankt.firanden.length === 0);
    ok("men räknas som nått, så att en makulering och en ny order inte firar det", sankt.minne.malet === true);
    ok(
      "målet firas en gång per månad: ett höjt mål som nås firas inte igen",
      steg(bild({ manad: { antal: 19, mal: 20 } }), bild({ manad: { antal: 20, mal: 20 } }), minneAv({ halvvags: true, malet: true })).firanden.length === 0,
    );

    // Korsningen är ett villkor för sig, inte bara en följd av minnet: har förra bilden
    // redan varit vid målet eller halva målet har inget passerats i den här.
    const utanSpar = minneAv({ kanda: ["tidig"] });
    ok(
      "att förra bilden redan låg vid målet är ingen korsning, vad minnet än säger",
      steg(bild({ manad: { antal: 10, mal: 10 } }), bild({ manad: { antal: 11, mal: 10 } }), utanSpar).firanden.length === 0,
    );
    ok(
      "att förra bilden redan låg över halva målet är ingen korsning, vad minnet än säger",
      steg(bild({ manad: { antal: 5, mal: 10 } }), bild({ manad: { antal: 6, mal: 10 } }), utanSpar).firanden.length === 0 &&
        steg(bild({ manad: { antal: 6, mal: 10 } }), bild({ manad: { antal: 7, mal: 10 } }), utanSpar).firanden.length === 0,
    );
    ok(
      "men en riktig korsning firas med ett minne som inte hunnit notera något",
      lika(typer(steg(bild({ manad: { antal: 9, mal: 10 } }), bild({ manad: { antal: 10, mal: 10 } }), utanSpar)), ["malet"]) &&
        lika(typer(steg(bild({ manad: { antal: 4, mal: 10 } }), bild({ manad: { antal: 5, mal: 10 } }), utanSpar)), ["halvvags"]),
    );

    // Start över målet och sedan en order till.
    const s12 = bild({ manad: { antal: 12, mal: 10 } });
    const ms12 = planera(null, s12, null);
    ok("start med antal 12 och mål 10 firar inget", ms12.firanden.length === 0);
    ok("12 till 13 ger inget mål", steg(s12, bild({ manad: { antal: 13, mal: 10 } }), ms12.minne).firanden.length === 0);
  }

  // --- En order som lämnar bilden kommer inte tillbaka som ny -----------------------------
  {
    const kl = (t) => `2026-10-23T${t}Z`;
    const T = ord("tidig", { tid: kl("06:00:00") });
    const X = ord("X", { tid: kl("10:00:09") });
    const firadeX = (...svar) => svar.flatMap((r) => r.firanden).filter((f) => f.order?.nyckel === "X").length;

    // (a) Ett försenat svar. Två servrar har var sin processcache på två sekunder (spec §8), så en
    // hämtning kan få ett äldre bygge än den förra: A har X, B (äldre) saknar den, C har den igen.
    const b0 = bild({ nu: kl("10:00:00"), order: [T] });
    const m = planera(null, b0, null).minne;
    const A = bild({ nu: kl("10:00:10"), order: [X, T] });
    const rA = planera(b0, A, m);
    const B = bild({ nu: kl("10:00:09.500"), order: [T] });
    const rB = planera(A, B, rA.minne);
    const C = bild({ nu: kl("10:00:12"), order: [X, T] });
    const rC = planera(B, C, rB.minne);
    ok("A firar ordern", lika(typer(rA), ["order"]) && rA.firanden[0].order.nyckel === "X");
    ok("en order firas en gång även när ett försenat svar saknar den", firadeX(rA, rB, rC) === 1, `${firadeX(rA, rB, rC)} gånger`);
    ok("det försenade svaret firar inget och nästa bild firar inte om ordern", rB.firanden.length === 0 && rC.firanden.length === 0);
    // Också om anroparen tar emot det försenade svaret som förra bild: ordern är ändå känd.
    ok("det gäller också när det försenade svaret blir förra bild", firadeX(planera(B, C, rA.minne)) === 0);

    // (b) En makulering som ångras inom tio minuter. Ordern firades redan och firas inte en gång till.
    const X30 = ord("X", { tid: kl("10:00:30") });
    const c0 = bild({ nu: kl("10:00:00"), order: [T] });
    const r1 = planera(c0, bild({ nu: kl("10:01:00"), order: [X30, T] }), planera(null, c0, null).minne);
    const r2 = planera(bild({ nu: kl("10:01:00"), order: [X30, T] }), bild({ nu: kl("10:03:00"), order: [T] }), r1.minne);
    const r3 = planera(bild({ nu: kl("10:03:00"), order: [T] }), bild({ nu: kl("10:05:00"), order: [X30, T] }), r2.minne);
    ok("ordern firas första gången", lika(typer(r1), ["order"]));
    ok("makuleringen är tyst och ordern står kvar i minnet", r2.firanden.length === 0 && r2.minne.kanda.includes("X"));
    ok("en ångrad makulering inom tio minuter firas inte igen", r3.firanden.length === 0);
    ok(
      "inte heller en order som kommer tillbaka flera gånger",
      lika(typer(planera(bild({ nu: kl("10:05:00"), order: [X30, T] }), bild({ nu: kl("10:07:00"), order: [T] }), r3.minne)), []) &&
        firadeX(planera(bild({ nu: kl("10:07:00"), order: [T] }), bild({ nu: kl("10:08:00"), order: [X30, T] }), r3.minne)) === 0,
    );
    // En makulerad order som aldrig firats (för gammal) och som kommer tillbaka är fortfarande tyst.
    ok(
      "en gammal order som kommer tillbaka är tyst som förut",
      planera(bild({ nu: kl("10:30:00"), order: [T] }), bild({ nu: kl("10:31:00"), order: [ord("gammal", { tid: kl("10:00:00") }), T] }), planera(null, bild({ nu: kl("10:30:00"), order: [T] }), null).minne).firanden.length === 0,
    );

    // (c) Det försenade svaret ändrar ingenting: inga firanden och samma minne, som en kopia.
    ok("en bild som är äldre än den förra firar inget", rB.firanden.length === 0);
    ok("och lämnar minnet som det var", lika(rB.minne, rA.minne));
    ok(
      "men som en kopia, utan delad lista med minnet som kom in",
      rB.minne !== rA.minne && rB.minne.kanda !== rA.minne.kanda,
    );
    // Varje fält i minnet kommer tillbaka som det var, också när de inte har sina standardvärden.
    const rikt = minneAv({ kanda: ["tidig", "X", "Q"], handelse: 7, halvvags: true, malet: true, dagsrekord: DAG });
    const rRikt = planera(A, B, rikt);
    ok("ett försenat svar ger tillbaka varje fält i minnet som det var", lika(rRikt.minne, rikt));
    ok("som en egen kopia", rRikt.minne !== rikt && rRikt.minne.kanda !== rikt.kanda);
    const Y = ord("Y", { tid: kl("10:00:09") });
    const rY = planera(A, bild({ nu: kl("10:00:09.500"), order: [Y, T] }), rA.minne);
    ok("en order som bara finns i det försenade svaret firas inte och blir inte känd", rY.firanden.length === 0 && !rY.minne.kanda.includes("Y"));
    ok(
      "samma tid som den förra bilden är inget försenat svar",
      lika(typer(planera(A, bild({ nu: kl("10:00:10"), order: [ord("Z", { tid: kl("10:00:09") }), X, T] }), rA.minne)), ["order"]),
    );
    ok(
      "en förra bild med en tid som inte går att läsa gör ingen bild försenad",
      lika(typer(planera(bild({ nu: "inte en tid", order: [X, T] }), bild({ nu: kl("10:00:12"), order: [ord("Z", { tid: kl("10:00:11") }), X, T] }), rA.minne)), ["order"]),
    );
    const utanMinne = planera(A, B, null);
    ok(
      "ett försenat svar utan ett minne som går att läsa ger minnet som det var vid förra bilden",
      utanMinne.firanden.length === 0 && lika([...utanMinne.minne.kanda].sort(), ["X", "tidig"]),
    );
    const nov1 = bild({ nu: "2026-11-01T00:00:30Z", manad: { nyckel: "2026-11", namn: "November", antal: 0, mal: 29 }, idag: { datum: "2026-11-01", antal: 0, bastaDag: 0 }, order: [] });
    const mNov1 = planera(null, nov1, null).minne;
    const sentOkt = planera(nov1, bild({ nu: "2026-10-31T23:59:59Z", idag: { datum: "2026-10-31" }, order: [ord("sent", { dag: "2026-10-31", tid: "2026-10-31T23:59:00Z" })] }), mNov1);
    ok("ett försenat svar från förra månaden efter ett månadsskifte ändrar ingenting", sentOkt.firanden.length === 0 && lika(sentOkt.minne, mNov1));

    // Dagen byts: då städas minnet. Innan dess står nycklarna kvar.
    const IGAR = "2026-10-22";
    const g1 = ord("g1", { dag: IGAR, tid: `${IGAR}T09:00:00Z` });
    const g2 = ord("g2", { dag: IGAR, tid: `${IGAR}T09:30:00Z` });
    const igar1 = bild({ nu: `${IGAR}T10:00:00Z`, idag: { datum: IGAR }, order: [g2, g1] });
    const igar2 = bild({ nu: `${IGAR}T10:05:00Z`, idag: { datum: IGAR }, order: [g2] }); // g1 makuleras
    const mI1 = planera(null, igar1, null).minne;
    const rI2 = planera(igar1, igar2, mI1);
    ok("samma dag: en order som lämnat bilden står kvar i minnet", lika([...rI2.minne.kanda].sort(), ["g1", "g2"]));
    const imorgon1 = bild({ nu: "2026-10-23T06:00:00Z", order: [g2] });
    const rM1 = planera(igar2, imorgon1, rI2.minne);
    ok("när dagen byts städas minnet: bara bildens nycklar står kvar", lika(rM1.minne.kanda, ["g2"]));
    ok("och bytet firar ingenting", rM1.firanden.length === 0);
    const rM2 = planera(imorgon1, bild({ nu: "2026-10-23T06:05:00Z", order: [ord("ny", { tid: "2026-10-23T06:04:00Z" }), g2] }), rM1.minne);
    ok("första ordern den nya dagen firas, som dagens första", lika(typer(rM2), ["order"]) && lika(rM2.firanden[0].taggar, [{ typ: "dagensForsta" }]));
    ok("och minnet behåller gårdagens nyckel som ligger kvar i bilden", rM2.minne.kanda.includes("g2") && rM2.minne.kanda.includes("ny"));

    // Ett försenat svar över midnatt. Minnet vet själv vilken dag listan gäller (`dag`), så det spelar
    // ingen roll om anroparen tar emot det försenade svaret från gårdagen som förra bild: dagen städas
    // inte en andra gång, och en order som makuleras och ångras firas inte om.
    {
      const mid = (hhmmss) => `2026-10-22T${hhmmss}Z`; // 22:00:00Z är midnatt svensk tid (sommartid)
      const D = "2026-10-22";
      const D1 = "2026-10-23";
      const gammal = ord("g", { dag: D, tid: mid("20:00:00") });
      const Z = ord("Z", { dag: D1, tid: mid("22:00:00") }); // godkänd 00:00:00 den 23:e
      const A = bild({ nu: mid("21:59:59"), idag: { datum: D }, order: [gammal] });
      const B = bild({ nu: mid("22:00:01"), idag: { datum: D1 }, order: [Z, gammal] });
      const S = bild({ nu: mid("21:59:58"), idag: { datum: D }, order: [gammal] }); // försenat svar från gårdagen
      const C = bild({ nu: mid("22:00:30"), idag: { datum: D1 }, order: [gammal] }); // Z makuleras
      const C2 = bild({ nu: mid("22:01:00"), idag: { datum: D1 }, order: [Z, gammal] }); // och ångras

      for (const [vem, slarvig] of [
        ["en anropare som behåller det nyaste svaret", false],
        ["en slarvig anropare som tar emot det försenade svaret som förra bild", true],
      ]) {
        const rB = planera(A, B, planera(null, A, null).minne);
        const rS = planera(B, S, rB.minne);
        const rC = planera(slarvig ? S : B, C, rS.minne);
        const rC2 = planera(C, C2, rC.minne);
        const antal = [rB, rS, rC, rC2].flatMap((r) => r.firanden).filter((f) => f.order?.nyckel === "Z").length;
        ok(`${vem}: ordern som makuleras och ångras firas en gång`, antal === 1, `${antal} gånger`);
        ok(`${vem}: det försenade svaret ändrar inget`, rS.firanden.length === 0 && lika(rS.minne, rB.minne));
        ok(`${vem}: minnet behåller ordern efter makuleringen`, rC.minne.kanda.includes("Z") && rC.minne.dag === D1);
      }
    }
  }

  // --- Minnet vet vilken dag det gäller ------------------------------------------------------
  {
    const kl = (t) => `2026-10-23T${t}Z`;
    const T = ord("tidig", { tid: kl("06:00:00") });
    const X = ord("X", { tid: kl("10:00:30") });
    const s0 = bild({ nu: kl("10:00:00"), order: [T] });

    // (b) En omladdning samma dag glömmer inget. En order som makulerades före omladdningen och
    // ångras efter den, inom tio minuter, firas inte om.
    const s1 = bild({ nu: kl("10:01:00"), order: [X, T] });
    const r1 = planera(s0, s1, planera(null, s0, null).minne); // X firas
    const s2 = bild({ nu: kl("10:03:00"), order: [T] }); // X makuleras
    const r2 = planera(s1, s2, r1.minne);
    const sparat = JSON.parse(JSON.stringify(r2.minne)); // minnet ligger i localStorage över omladdningen
    const s3 = bild({ nu: kl("10:04:00"), order: [T] });
    const omladdad = planera(null, s3, sparat); // ingen förra bild
    const s4 = bild({ nu: kl("10:05:00"), order: [X, T] }); // X ångras
    const r4 = planera(s3, s4, omladdad.minne);
    ok("ordern firades före omladdningen", lika(typer(r1), ["order"]));
    ok("en omladdning firar ingenting", omladdad.firanden.length === 0);
    ok("och glömmer inte dagens kända order", lika([...omladdad.minne.kanda].sort(), ["X", "tidig"]));
    ok("en order som ångras efter en omladdning samma dag firas inte om", r4.firanden.length === 0);
    ok("minnet från samma dag bär med sig en nyckel som ingen bild längre har", planera(null, s3, sparat).minne.kanda.includes("X"));

    // (c) Ett minne från i går vid en morgonstart städas till dagens nycklar.
    const igarMinne = minneAv({ kanda: ["a", "b", "c", "d", "e"], dag: "2026-10-22" });
    const morgon = bild({ nu: kl("06:00:20"), order: [ord("f", { tid: kl("06:00:00") }), ord("e", { dag: "2026-10-22", tid: "2026-10-22T15:00:00Z" }), ord("c", { dag: "2026-10-22", tid: "2026-10-22T14:00:00Z" })] });
    const morgonStart = planera(null, morgon, igarMinne);
    ok("ett minne från i går vid en morgonstart firar ingenting", morgonStart.firanden.length === 0);
    ok("och städas till dagens nycklar: bildens, inte gårdagens övriga", lika([...morgonStart.minne.kanda].sort(), ["c", "e", "f"]));
    ok("minnet bär dagens dag", morgonStart.minne.dag === DAG);
    ok(
      "ett minne från i går i ett vanligt steg över dagsbytet städas på samma sätt",
      lika(
        [...planera(bild({ nu: "2026-10-22T21:59:30Z", idag: { datum: "2026-10-22" }, order: [] }), bild({ nu: "2026-10-22T22:00:10Z", order: [ord("f", { tid: "2026-10-22T22:00:00Z" })], idag: { datum: DAG } }), igarMinne).minne.kanda].sort(),
        ["f"],
      ),
    );

    // (d) Ett minne i äldre form, utan `dag`, läses som en okänd dag: det städas som vid ett dagsbyte, men används i övrigt.
    const { dag: _dag, ...gammaltMinne } = minneAv({ kanda: ["tidig", "Q", "X"] });
    ok("minnet i äldre form saknar fältet", !("dag" in gammaltMinne));
    const N = ord("N", { tid: kl("10:04:50") });
    const rGammalt = planera(s3, bild({ nu: kl("10:05:00"), order: [N, T] }), gammaltMinne);
    ok("ett minne utan dag läses och ger inget fel: en ny order firas, det är ingen start", lika(typer(rGammalt), ["order"]) && rGammalt.firanden[0].order.nyckel === "N");
    ok("dagen är okänd, så minnet städas till bildens nycklar", lika([...rGammalt.minne.kanda].sort(), ["N", "tidig"]));
    ok("och bär dagen nu", rGammalt.minne.dag === DAG);
    ok(
      "men en order som minnet kände och som ligger i bilden firas inte om",
      planera(s3, bild({ nu: kl("10:05:00"), order: [X, T] }), gammaltMinne).firanden.length === 0,
    );
    const startGammalt = planera(null, s3, gammaltMinne);
    ok("vid en start städas ett minne utan dag till bildens nycklar", lika(startGammalt.minne.kanda, ["tidig"]) && startGammalt.minne.dag === DAG);
    ok("ett minne med dagen null är detsamma som utan dag", lika(planera(s3, bild({ nu: kl("10:05:00"), order: [N, T] }), { ...gammaltMinne, dag: null }), rGammalt));
    ok(
      "en dag som inte är en sträng räknas också som okänd och ger inget fel",
      [5, {}, ["x"], true, ""].every((d) => {
        const r = planera(s3, bild({ nu: kl("10:05:00"), order: [N, T] }), { ...gammaltMinne, dag: d });
        return lika(typer(r), ["order"]) && lika([...r.minne.kanda].sort(), ["N", "tidig"]) && r.minne.dag === DAG;
      }),
    );
    ok(
      "ett försenat svar ger tillbaka en dag som inte är en sträng som okänd (null)",
      [5, {}, ["x"], true].every((d) => planera(bild({ nu: kl("10:05:00"), order: [T] }), bild({ nu: kl("10:04:00"), order: [T] }), { ...gammaltMinne, dag: d }).minne.dag === null),
    );
    const gammaltForsenat = planera(bild({ nu: kl("10:05:00"), order: [T] }), bild({ nu: kl("10:04:00"), order: [T] }), gammaltMinne);
    ok(
      "ett försenat svar lämnar ett minne utan dag som det var, med dagen okänd (null)",
      gammaltForsenat.firanden.length === 0 && lika(gammaltForsenat.minne, { ...gammaltMinne, dag: null }),
    );

    // Minnet bär alltid bildens dag: efter en start, ett vanligt steg och ett dagsbyte.
    ok("efter en start bär minnet bildens dag", planera(null, s0, null).minne.dag === DAG);
    ok("efter ett vanligt steg bär minnet bildens dag", r1.minne.dag === DAG && r2.minne.dag === DAG);
    ok(
      "efter ett dagsbyte bär minnet den nya dagen",
      planera(bild({ nu: "2026-10-22T21:59:30Z", idag: { datum: "2026-10-22" }, order: [] }), bild({ nu: "2026-10-22T22:00:10Z", idag: { datum: DAG }, order: [] }), minneAv({ dag: "2026-10-22" })).minne.dag === DAG,
    );
    ok(
      "ett försenat svar utan läsbart minne ger minnet som det var vid förra bilden, med förra bildens dag",
      planera(bild({ nu: "2026-10-23T10:00:00Z", order: [T] }), bild({ nu: "2026-10-23T09:59:00Z", idag: { datum: "2026-10-22" }, order: [] }), null).minne.dag === DAG,
    );
  }

  // --- Ett avbrott mellan två bilder -------------------------------------------------------
  {
    // Målet och halva målet firas inte i efterhand. Ligger det mer än tio minuter mellan bilderna
    // (TV:n var offline) noteras korsningen tyst. Order har sin egen färskhetsregel.
    const efter = (min, extraMs = 0) => new Date(Date.parse(NU) + min * 60_000 + extraMs).toISOString();

    const f9 = bild({ manad: { antal: 9, mal: 10 } });
    const m9 = planera(null, f9, null).minne;
    const mal10 = (nu, over = {}) => bild({ nu, manad: { antal: 10, mal: 10, natt: NATT }, ...over });

    const l11 = steg(f9, mal10(efter(11)), m9);
    ok("ett mål som nåtts under ett avbrott på 11 minuter firas inte", l11.firanden.length === 0);
    ok("men noteras som passerat", l11.minne.malet === true && l11.minne.halvvags === true);
    ok("och firas inte heller senare", steg(mal10(efter(11)), mal10(efter(12)), l11.minne).firanden.length === 0);
    ok("ett avbrott på 9 minuter firar målet som vanligt", lika(typer(steg(f9, mal10(efter(9)), m9)), ["malet"]));
    ok("exakt tio minuter är fortfarande färskt", lika(typer(steg(f9, mal10(efter(0, FARSK_MS)), m9)), ["malet"]));
    ok("en millisekund mer är det inte", steg(f9, mal10(efter(0, FARSK_MS + 1)), m9).firanden.length === 0);
    ok("en förra bild med en tid som inte går att läsa räknas som ett avbrott", steg(bild({ nu: "inte en tid", manad: { antal: 9, mal: 10 } }), mal10(efter(1)), m9).firanden.length === 0);
    ok(
      "utan avbrott firas bara målet när halva målet passeras i samma steg",
      lika(typer(steg(bild({ manad: { antal: 4, mal: 10 } }), mal10(efter(1)))), ["malet"]),
    );

    // En order som är färsk firas, men målet den tog laget över firas inte i efterhand.
    const nyOrd = ord("sist", { tid: efter(9) });
    const medOrder = steg(f9, mal10(efter(11), { order: [nyOrd, TIDIG] }), m9);
    ok("en färsk order firas även efter ett avbrott, men inte målet den tog laget över", lika(typer(medOrder), ["order"]) && medOrder.minne.malet === true);

    // Halva målet på samma sätt.
    const h4 = bild({ manad: { antal: 4, mal: 10 } });
    const mh4 = planera(null, h4, null).minne;
    const halv5 = (nu) => bild({ nu, manad: { antal: 5, mal: 10 } });
    const hl11 = steg(h4, halv5(efter(11)), mh4);
    ok("halvvägs under ett avbrott på 11 minuter firas inte", hl11.firanden.length === 0);
    ok("men noteras som passerat", hl11.minne.halvvags === true && hl11.minne.malet === false);
    ok("och firas inte heller senare", steg(halv5(efter(11)), bild({ nu: efter(12), manad: { antal: 6, mal: 10 } }), hl11.minne).firanden.length === 0);
    ok("ett avbrott på 9 minuter firar halvvägs som vanligt", lika(typer(steg(h4, halv5(efter(9)), mh4)), ["halvvags"]));
    ok("exakt tio minuter är fortfarande färskt", lika(typer(steg(h4, halv5(efter(0, FARSK_MS)), mh4)), ["halvvags"]));
    ok("en millisekund mer är det inte", steg(h4, halv5(efter(0, FARSK_MS + 1)), mh4).firanden.length === 0);

    // Målet nåddes i går kväll under ett avbrott över natten och firas inte nästa morgon.
    const igarKvall = bild({ nu: "2026-10-22T15:00:00Z", idag: { datum: "2026-10-22" }, order: [], manad: { antal: 9, mal: 10 } });
    const iMorse = bild({ nu: "2026-10-23T06:00:00Z", order: [], manad: { antal: 10, mal: 10, natt: "2026-10-22T15:58:00Z" } });
    const natten = steg(igarKvall, iMorse);
    ok("ett mål som nåtts under ett avbrott över natten firas inte nästa morgon", natten.firanden.length === 0 && natten.minne.malet === true);
  }

  // --- Månadsbyte --------------------------------------------------------------
  {
    const okt = bild({ manad: { antal: 29, mal: 29, natt: NATT }, order: [ord("sista"), TIDIG] });
    const minneOkt = minneAv({ kanda: ["sista", "tidig"], handelse: 3, halvvags: true, malet: true, dagsrekord: DAG });
    const nov = (over = {}) =>
      bild({
        nu: "2026-11-02T08:00:00Z",
        manad: { nyckel: "2026-11", namn: "November", antal: 0, mal: 29, natt: null, ...over.manad },
        idag: { datum: "2026-11-02", antal: 0, bastaDag: 0, ...over.idag },
        order: over.order ?? [],
      });

    const rn = steg(okt, nov(), minneOkt);
    ok("ett månadsbyte ger inga firanden", rn.firanden.length === 0);
    ok("och nollställer målet och halvvägs", rn.minne.malet === false && rn.minne.halvvags === false);
    ok("och dagsrekordet", rn.minne.dagsrekord === null);
    ok("och bär den nya månaden", rn.minne.manad === "2026-11");
    ok("och glömmer nycklarna från månaden som gick", lika(rn.minne.kanda, []));
    ok("men inte vilka testhändelser som setts", rn.minne.handelse === 3);

    const nyO = ord("n1", { dag: "2026-11-02", tid: "2026-11-02T07:59:00Z" });
    const rn1 = steg(okt, nov({ manad: { antal: 1 }, idag: { antal: 1 }, order: [nyO] }), minneOkt);
    ok("en order i den första bilden i den nya månaden firas inte", rn1.firanden.length === 0);
    ok("men blir känd", lika(rn1.minne.kanda, ["n1"]));

    const redan = steg(okt, nov({ manad: { antal: 12, mal: 10 } }), minneOkt);
    ok("en ny månad som redan ligger över målet firar inget", redan.firanden.length === 0 && redan.minne.malet === true && redan.minne.halvvags === true);

    // Därefter gäller reglerna som vanligt, också målet, i den nya månaden.
    const forraNov = nov({ manad: { antal: 28 }, idag: { antal: 1 }, order: [nyO] });
    const mNov = planera(null, forraNov, null).minne;
    const n2 = ord("n2", { dag: "2026-11-02", tid: "2026-11-02T07:59:30Z" });
    const efter = steg(forraNov, nov({ manad: { antal: 29, natt: "2026-11-02T07:59:30Z" }, idag: { antal: 2 }, order: [n2, nyO] }), mNov);
    ok("efter månadsbytet firas en ny order som vanligt", efter.firanden[0].typ === "order" && efter.firanden[0].order.nyckel === "n2");
    ok("och målet kan firas en gång till, i den nya månaden", lika(typer(efter), ["order", "malet"]));
  }

  // --- En dag, steg för steg ---------------------------------------------------------
  {
    // Målet är 10. Tavlan startar kl. 09:00 med två order i dag och 8 av 10.
    const klockan = (hhmm) => `2026-10-23T${hhmm}:00Z`;
    const o = (nyckel, hhmm) => ord(nyckel, { tid: klockan(hhmm) });
    const bildKl = (hhmm, antal, order) =>
      bild({ nu: klockan(hhmm), manad: { antal, mal: 10, natt: klockan(hhmm) }, idag: { antal: order.length, bastaDag: 9 }, order });

    const e1 = o("e1", "06:30");
    const e2 = o("e2", "06:50");
    const b0 = bildKl("07:00", 8, [e2, e1]);
    const start = planera(null, b0, null);
    ok("kl. 09:00 (07:00 UTC): start, ingenting firas", start.firanden.length === 0);

    const n1 = o("n1", "07:01");
    const b1 = bildKl("07:02", 9, [n1, e2, e1]);
    const s1 = planera(b0, b1, start.minne);
    ok("en ny order firas", lika(typer(s1), ["order"]) && s1.firanden[0].order.nyckel === "n1");

    const s1b = planera(b1, b1, s1.minne);
    ok("samma bild igen firar inget", s1b.firanden.length === 0);

    const b2 = bildKl("07:04", 8, [e2, e1]); // n1 makuleras
    const s2 = planera(b1, b2, s1b.minne);
    ok("en makulering är tyst", s2.firanden.length === 0);
    ok("och ordern är ändå känd resten av dagen", s2.minne.kanda.includes("n1"));

    const n2 = o("n2", "07:09");
    const b3 = bildKl("07:10", 9, [n2, e2, e1]);
    const s3 = planera(b2, b3, s2.minne);
    ok("en ny order efter makuleringen firas som vanligt", lika(typer(s3), ["order"]) && s3.firanden[0].order.nyckel === "n2");

    const n3 = o("n3", "07:11");
    const b4 = bildKl("07:12", 10, [n3, n2, e2, e1]);
    const s4 = planera(b3, b4, s3.minne);
    ok("ordern som tar laget över målet firas, och sedan målet", lika(typer(s4), ["order", "malet"]) && s4.firanden[0].order.nyckel === "n3");
    ok("målet bär tiden det nåddes", s4.firanden[1].natt === klockan("07:12"));

    const b5 = bildKl("07:13", 9, [n2, e2, e1]); // n3 makuleras
    const s5 = planera(b4, b5, s4.minne);
    ok("makuleringen av ordern som tog laget över målet är tyst", s5.firanden.length === 0);

    const n4 = o("n4", "07:19");
    const b6 = bildKl("07:20", 10, [n4, n2, e2, e1]);
    const s6 = planera(b5, b6, s5.minne);
    ok("och när antalet når målet igen firas ordern men inte målet", lika(typer(s6), ["order"]) && s6.firanden[0].order.nyckel === "n4");

    // TV:n startas om: den förra bilden är borta, minnet ligger kvar i localStorage.
    const sparat = JSON.parse(JSON.stringify(s6.minne));
    const s7 = planera(null, bildKl("07:30", 10, [n4, n2, e2, e1]), sparat);
    ok("en omstart firar inget", s7.firanden.length === 0);

    const n5 = o("n5", "07:31");
    const b8 = bildKl("07:32", 11, [n5, n4, n2, e2, e1]);
    const s8 = planera(bildKl("07:30", 10, [n4, n2, e2, e1]), b8, s7.minne);
    ok("och nästa order efter omstarten firas som en order, utan mål", lika(typer(s8), ["order"]) && s8.firanden[0].order.nyckel === "n5");
  }

  // --- Testhändelser -------------------------------------------------------------
  {
    const hb = (id, typ = "stor", sekunder = 5) => ({ id, typ, tid: new Date(Date.parse(NU) - sekunder * 1000).toISOString() });
    const t4 = bild({ handelser: [hb(4)] });
    const mt = planera(null, t4, null).minne;
    const t5 = bild({ handelser: [hb(5, "serie"), hb(4)] });
    const rt = steg(t4, t5, mt);

    ok("en testhändelse med id 5 efter id 4 ger ett test", lika(rt.firanden, [{ typ: "test", testtyp: "serie", id: 5 }]));
    ok("och minnet har id 5", rt.minne.handelse === 5);
    ok("samma bild igen ger inget test", steg(t5, t5, rt.minne).firanden.length === 0);
    ok("ett id som redan setts spelas inte", steg(t4, bild({ handelser: [hb(3, "order")] }), mt).firanden.length === 0);
    ok("ett test räknas aldrig: minnet rörs inte i övrigt", lika({ ...rt.minne, handelse: 0 }, { ...mt, handelse: 0 }));

    // Färskhet: yngre än två minuter.
    const gammalt = steg(t4, bild({ handelser: [hb(6, "order", 121)] }), mt);
    ok("en testhändelse äldre än två minuter spelas inte", gammalt.firanden.length === 0);
    ok("men räknas som sedd", gammalt.minne.handelse === 6);
    ok("under två minuter spelas den", lika(typer(steg(t4, bild({ handelser: [hb(6, "order", 119)] }), mt)), ["test"]));
    ok("exakt två minuter är för gammalt", steg(t4, bild({ handelser: [hb(6, "order", TEST_FARSK_MS / 1000)] }), mt).firanden.length === 0);
    ok("en millisekund yngre spelas", lika(typer(steg(t4, bild({ handelser: [{ id: 6, typ: "order", tid: new Date(Date.parse(NU) - TEST_FARSK_MS + 1).toISOString() }] }), mt)), ["test"]));

    // Flera, i id-ordning, och en post två gånger spelas en gång.
    const flera = steg(t4, bild({ handelser: [hb(8, "malet"), hb(6, "stor"), hb(7, "forsta"), hb(6, "stor")] }), mt);
    ok("flera nya testhändelser spelas i id-ordning", lika(flera.firanden.map((f) => f.id), [6, 7, 8]));
    ok("och med sin typ", lika(flera.firanden.map((f) => f.testtyp), ["stor", "forsta", "malet"]));
    ok("ett test har exakt de fält gränssnittet anger", lika(Object.keys(flera.firanden[0]).sort(), ["id", "testtyp", "typ"]));
    ok("minnet har det högsta id:t", flera.minne.handelse === 8);

    // Ordningen: order eller serie, sedan halvvägs eller målet, sedan test.
    const allt = steg(
      bild({ manad: { antal: 9, mal: 10 }, handelser: [hb(1)] }),
      bild({ manad: { antal: 10, mal: 10, natt: NATT }, order: [ord("z"), TIDIG], handelser: [hb(2), hb(1)] }),
      planera(null, bild({ manad: { antal: 9, mal: 10 }, handelser: [hb(1)] }), null).minne,
    );
    ok("ordningen är order, målet, test", lika(typer(allt), ["order", "malet", "test"]));
    const halvAllt = steg(
      bild({ manad: { antal: 4, mal: 10 }, handelser: [hb(1)] }),
      bild({ manad: { antal: 5, mal: 10 }, order: [ord("z"), TIDIG], handelser: [hb(2), hb(1)] }),
      planera(null, bild({ manad: { antal: 4, mal: 10 }, handelser: [hb(1)] }), null).minne,
    );
    ok("ordningen är order, halvvägs, test", lika(typer(halvAllt), ["order", "halvvags", "test"]));
  }

  // --- Rent och begränsat -----------------------------------------------------------
  {
    // Ingenting som skickas in får ändras. Frysta indata gör att en skrivning kastar.
    const forra = djup(bild({ manad: { antal: 9, mal: 10 } }));
    const ny = djup(
      bild({
        manad: { antal: 10, mal: 10, natt: NATT },
        order: [ord("z3", { tid: fore(1) }), ord("z2", { tid: fore(2) }), ord("z1", { tid: fore(3) }), TIDIG],
        handelser: [{ id: 9, typ: "stor", tid: fore(0) }],
      }),
    );
    const minne = djup(minneAv({ kanda: ["tidig", "borta"], handelse: 3 }));
    const fore_ = JSON.stringify([forra, ny, minne]);
    let kastade = false;
    let r;
    try {
      r = planera(forra, ny, minne);
    } catch {
      kastade = true;
    }
    ok("planera ändrar inte det som skickas in", !kastade && JSON.stringify([forra, ny, minne]) === fore_);
    ok("och ger ett fullständigt svar på frysta indata", !kastade && lika(typer(r), ["serie", "malet", "test"]));
    ok("minnet i svaret delar ingen lista med minnet som skickades in", r.minne.kanda !== minne.kanda);
    ok("serien delar ingen lista med bildens order", r.firanden[0].order !== ny.order);
    // Inte heller när bilden saknar order och listan ändå förs vidare oförändrad.
    const minneTva = minneAv({ kanda: ["a", "b"] });
    const rTom = planera(bild({ order: [] }), bild({ order: [] }), minneTva);
    ok("minnet delar ingen lista med det som kom in, inte ens när bilden saknar order", lika(rTom.minne.kanda, ["a", "b"]) && rTom.minne.kanda !== minneTva.kanda);
    ok("planera är deterministisk", lika(planera(forra, ny, minne), planera(forra, ny, minne)));

    // En TV som går i månader. Bilden har alla dagens order och de åtta senaste, så en dags nycklar är
    // begränsade, och minnet städas när dagen byts: det blir aldrig större än en dag plus de åtta.
    {
      const PER_DAG = 42;
      const DAGAR = 12;
      const tvaDigit = (n) => String(n).padStart(2, "0");
      const gamla = Array.from({ length: 8 }, (_, i) => ord(`h${i}`, { dag: "2026-10-04", tid: `2026-10-04T09:${tvaDigit(50 - i)}:00Z` }));
      let tidigare = [...gamla];              // alla order hittills, den nyaste först
      let forraBild = bild({ nu: "2026-10-04T10:00:00Z", idag: { datum: "2026-10-04" }, order: tidigare });
      let minneNu = planera(null, forraBild, null).minne;
      let storst = 0;
      const forstaVidDagsbyte = [];
      const firade = new Map();

      for (let d = 0; d < DAGAR; d++) {
        const datum = `2026-10-${tvaDigit(5 + d)}`;
        let idagOrder = [];
        for (let i = 0; i < PER_DAG; i++) {
          const nyO = ord(`d${d}-${i}`, { dag: datum, tid: `${datum}T10:${tvaDigit(i)}:00Z` });
          idagOrder = [nyO, ...idagOrder];
          const fonster = [...idagOrder, ...tidigare].slice(0, Math.max(idagOrder.length, 8));
          const nyBild = bild({ nu: `${datum}T10:${tvaDigit(i)}:30Z`, idag: { datum }, order: fonster });
          const r = planera(forraBild, nyBild, minneNu);
          for (const f of r.firanden) if (f.typ === "order") firade.set(f.order.nyckel, (firade.get(f.order.nyckel) ?? 0) + 1);
          forraBild = nyBild;
          minneNu = r.minne;
          storst = Math.max(storst, minneNu.kanda.length);
          if (i === 0) forstaVidDagsbyte.push(minneNu.kanda.length);
        }
        tidigare = [...idagOrder, ...tidigare];
      }

      ok(`${DAGAR * PER_DAG} order på ${DAGAR} dagar firas en gång var`, firade.size === DAGAR * PER_DAG && [...firade.values()].every((n) => n === 1), `${firade.size} firade`);
      ok(`minnet blir aldrig större än en dag plus de åtta (${PER_DAG + 8})`, storst <= PER_DAG + 8, `högst ${storst}`);
      ok("och är åtta nycklar när en ny dag börjar", forstaVidDagsbyte.every((n) => n === 8), forstaVidDagsbyte.join(" "));
      ok("order från tidigare dagar glöms när dagen byts", !minneNu.kanda.includes("d0-0") && !minneNu.kanda.includes("d10-0") && !minneNu.kanda.includes("h0"));
      ok(
        "men en order som lämnat bilden under dagen står kvar tills dagen byts",
        minneNu.kanda.includes("d10-41") && !forraBild.order.some((o) => o.nyckel === "d10-41"),
      );
    }
    ok("en dubblett i minnet blir en post", lika(steg(grund, grund, minneAv({ kanda: ["tidig", "tidig", "tidig"] })).minne.kanda, ["tidig"]));

    // Minnet ligger i localStorage som JSON och måste klara en tur dit och tillbaka.
    const fran = med([ord("j1")], { manad: { antal: 4, mal: 10 } });
    const till = med([ord("j2"), ord("j1")], { manad: { antal: 5, mal: 10 } });
    const direkt = steg(fran, till);
    const viaJson = planera(fran, till, JSON.parse(JSON.stringify(planera(null, fran, null).minne)));
    ok("minnet klarar en tur genom JSON", lika(viaJson, direkt) && direkt.firanden.length === 2);
    ok("även efter firandet", lika(JSON.parse(JSON.stringify(direkt.minne)), direkt.minne));

    // Ett minne som inte går att läsa är en start, aldrig ett fel och aldrig ett firande.
    const skrap = [
      "x", 5, true, [], {}, { kanda: "a" },
      { ...m0, kanda: null }, { ...m0, kanda: undefined }, { ...m0, handelse: "5" }, { ...m0, handelse: NaN },
      { ...m0, manad: 202610 }, { ...m0, halvvags: 1 }, { ...m0, malet: undefined }, { ...m0, dagsrekord: undefined },
    ];
    let skrapOk = true;
    for (const s of skrap) {
      try {
        const rs = planera(grund, med([ord("ny1")]), s);
        skrapOk &&= rs.firanden.length === 0 && rs.minne.kanda.includes("ny1") && Array.isArray(rs.minne.kanda);
      } catch {
        skrapOk = false;
      }
    }
    ok("ett minne som inte går att läsa är en start och inte ett fel", skrapOk);
  }

  // --- samla ------------------------------------------------------------------------
  {
    const fo = (nyckel) => ({ typ: "order", order: ord(nyckel), variant: "vanlig", taggar: [] });
    const mal = { typ: "malet", natt: NATT };
    const prov = { typ: "test", testtyp: "order", id: 1 };

    const tva = [fo("a"), fo("b"), mal];
    ok("samla lämnar två order och målet oförändrade", lika(samla(tva), tva));
    ok("och ger en ny lista", samla(tva) !== tva);

    const tre = [fo("a"), fo("b"), fo("c"), mal];
    const sam = samla(tre);
    ok("tre order och målet blir en serie och målet", lika(sam.map((f) => f.typ), ["serie", "malet"]));
    ok("serien har de tre i ordning", lika(sam[0].order.map((o) => o.nyckel), ["a", "b", "c"]));
    ok("serien har inga fler fält", lika(Object.keys(sam[0]).sort(), ["order", "typ"]));
    ok("målet är kvar efter serien", lika(sam[1], mal));

    ok(
      "serien tar den första ordens plats och resten står kvar i ordning",
      lika(samla([prov, fo("a"), { typ: "halvvags" }, fo("b"), fo("c")]).map((f) => f.typ), ["test", "serie", "halvvags"]),
    );
    ok("en serie och en order till blir en serie", lika(samla([{ typ: "serie", order: [ord("a"), ord("b"), ord("c")] }, fo("d")]).map((f) => f.order?.length), [4]));
    ok("tre order och ett test blir serien och testet", lika(samla([fo("a"), fo("b"), prov, fo("c")]).map((f) => f.typ), ["serie", "test"]));
    ok("det som inte är order lämnas orört", lika(samla([{ typ: "halvvags" }, mal, prov]), [{ typ: "halvvags" }, mal, prov]));
    ok("tomt in ger tomt ut", lika(samla([]), []));
    ok("en ensam order lämnas", lika(samla([fo("a")]), [fo("a")]));
    ok("samla är idempotent", lika(samla(samla(tre)), samla(tre)));

    const frusen = djup([fo("a"), fo("b"), fo("c"), mal].map((f) => structuredClone(f)));
    let kastar = false;
    try {
      samla(frusen);
    } catch {
      kastar = true;
    }
    ok("samla ändrar inte det som skickas in", !kastar);

    // Så används den: firandena från flera bilder under samlingsfönstret slås ihop.
    const bas = bild({ manad: { antal: 5, mal: 100 } });
    const bm = planera(null, bas, null).minne;
    const bild1 = med([ord("w2", { tid: fore(1) }), ord("w1", { tid: fore(2) })]);
    const r1 = planera(bas, bild1, bm);
    const bild2 = med([ord("w4", { tid: fore(0.5) }), ord("w3", { tid: fore(0.8) }), ord("w2", { tid: fore(1) }), ord("w1", { tid: fore(2) })]);
    const r2 = planera(bild1, bild2, r1.minne);
    ok("två bilder med två order var blir två och två", lika(typer(r1), ["order", "order"]) && lika(typer(r2), ["order", "order"]));
    const ihop = samla([...r1.firanden, ...r2.firanden]);
    ok("och samlade blir de en serie med fyra i den ordning de kom", lika(typer({ firanden: ihop }), ["serie"]) && lika(ihop[0].order.map((o) => o.nyckel), ["w1", "w2", "w3", "w4"]));
  }

  // --- Spärrtiden för motivet -----------------------------------------------------------
  {
    ok("hornet är tillåtet första gången", hornTillatet(null, 0) === true);
    ok("inom spärren är det inte tillåtet", hornTillatet(1000, 15000) === false);
    ok("efter spärren är det tillåtet", hornTillatet(1000, 21001) === true);
    ok("spärren är tjugo sekunder", HORN_SPARR_MS === 20_000);
    ok("exakt tjugo sekunder efter är fortfarande inom spärren", hornTillatet(1000, 21000) === false);
    ok("samma ögonblick är inom spärren", hornTillatet(1000, 1000) === false);
    ok("en klocka som gått bakåt spärrar inte för alltid", hornTillatet(50_000, 1000) === true);
  }
}

console.log(fel === 0 ? "\n\x1b[32mAllt grönt.\x1b[0m\n" : `\n\x1b[31m${fel} fel.\x1b[0m\n`);
process.exit(fel ? 1 : 0);
