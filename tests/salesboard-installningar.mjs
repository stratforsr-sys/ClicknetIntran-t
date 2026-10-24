#!/usr/bin/env node
/**
 * Säljtavlans inställningar: det skrivrutten (`/salesboard/skriv`) läser in,
 * och det sidan och rutten formar ur raderna. Fem saker står på spel och
 * provas åt båda hållen:
 *
 *   1. INGET TAPPAS TYST. `uppdatera` hoppar med flit över en del den inte kan
 *      läsa, och klipper ett tal till sina gränser. Rutten får därför aldrig
 *      svara ok på en skrivning där en del inte landade: fel typ, ett tal
 *      utanför gränserna, en okänd del och en arbetsdag som slutar innan den
 *      börjar ger 400, och svaret säger vilken del det gällde.
 *   2. GRÄNSERNA ÄR SAMMA SOM INSTÄLLNINGARNAS. Rutten och `installningar.ts`
 *      har var sin bild av gränserna. Provet håller dem i takt: det högsta
 *      tillåtna värdet landar, och ett steg till klipps.
 *   3. KODEN FRÅN TV:N går genom `normaliseraKod`: med eller utan streck, små
 *      eller stora bokstäver. En felskrift (I, O, 0, 1) avvisas.
 *   4. NAMNEN är 1–60 tecken som Postgres räknar dem, utan styrtecken.
 *   5. RADERNA FORMAS LIKA på sidan och i rutten: skärmarna på namn i svensk
 *      ordning, alla som tavlan kan visa med sina val (dolt åt det säkra
 *      hållet), och tröskeln för stor affär som tavlan räknar den.
 *   6. BESLUTEN: vem som får skriva (401, 403, 503), parningens inlösen,
 *      läget före 0250 och sparningen som jämför och byter (R25).
 *
 *   TZ=UTC node --experimental-strip-types tests/salesboard-installningar.mjs
 */
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { STANDARD, malFor, normalisera, uppdatera } from "../src/lib/salesboard/installningar.ts";
import { SALJANDE_ROLLER } from "../src/lib/salesboard/regler.ts";
import { troskelFranStatistik } from "../src/lib/salesboard/forma.ts";
import { arModulKand, typFor } from "../src/lib/handelselogg.ts";
import {
  FEL,
  GRANSER,
  HANDELSER,
  NAMN_MAX,
  atkomstsvar,
  efterForsok,
  formaSaljare,
  formaSkarmar,
  installationslage,
  nastaStampel,
  parningsutfall,
  planeraSparning,
  saljarutfall,
  sidansVag,
  tavlansPersoner,
  tillampa,
  tolkaSkrivning,
  troskelNu,
  webblasarnamn,
} from "../src/lib/salesboard/skrivning.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(
    `  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`,
  );
  if (!villkor) fel++;
};
const lika = (a, b) => isDeepStrictEqual(a, b);
const visa = (x) => JSON.stringify(x);

const ID = "3f2c1a9e-8b7d-4c6e-9f10-2a3b4c5d6e7f";
const ID2 = "b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e";
const spara = (delar) => tolkaSkrivning({ handling: "spara", delar });
/** Avslaget, med delen det gällde. */
const avslag = (s, del) => typeof s?.fel === "string" && s.fel.length > 0 && !("handling" in s) && (del === undefined || s.del === del);

// -----------------------------------------------------------------------------
console.log("\nKroppen och handlingen");
{
  ok("null är ingen begäran", avslag(tolkaSkrivning(null)));
  ok("en lista är ingen begäran", avslag(tolkaSkrivning([])));
  ok("en sträng är ingen begäran", avslag(tolkaSkrivning("spara")));
  ok("utan handling ger fel", avslag(tolkaSkrivning({})));
  const okand = tolkaSkrivning({ handling: "radera_allt" });
  ok("okänd handling ger fel", avslag(okand), visa(okand));
  ok("okänd handling säger det", okand.fel === FEL.handling, okand.fel);
  ok("handlingen är skiftlägeskänslig", avslag(tolkaSkrivning({ handling: "SPARA", delar: { ordning: "antal" } })));
  const extra = tolkaSkrivning({ handling: "koppla_bort", id: ID, och: "mer" });
  ok("ett okänt fält ger fel i stället för att tappas", avslag(extra, "och"), visa(extra));
  ok("felet nämner fältet", extra.fel.includes("och"), extra.fel);
}

// -----------------------------------------------------------------------------
console.log("\nspara: delarna läses fält för fält");
{
  ok("utan delar ger fel", avslag(tolkaSkrivning({ handling: "spara" })));
  ok("delar som lista ger fel", avslag(spara([])));
  ok("delar som null ger fel", avslag(spara(null)));
  const tomt = spara({});
  ok("tomma delar ger fel: inget att spara", avslag(tomt) && tomt.fel === FEL.inget, visa(tomt));

  const brytare = spara({ firande: { halvvags: false } });
  ok("en brytare går igenom", lika(brytare, { handling: "spara", delar: { firande: { halvvags: false } } }), visa(brytare));
  const flera = spara({ ljud: { volym: 30, helgTyst: false }, firande: { storAffar: { lage: "belopp", belopp: 45_000 } } });
  ok(
    "flera delar i grupper går igenom exakt som de skickades",
    lika(flera, { handling: "spara", delar: { ljud: { volym: 30, helgTyst: false }, firande: { storAffar: { lage: "belopp", belopp: 45_000 } } } }),
    visa(flera),
  );

  const strang = spara({ firande: { halvvags: "true" } });
  ok('"true" är ingen brytare', avslag(strang, "firande.halvvags"), visa(strang));
  const etta = spara({ firande: { halvvags: 1 } });
  ok("1 är ingen brytare, och delen pekas ut", avslag(etta, "firande.halvvags"), visa(etta));

  const okand = spara({ ljud: { hogt: true } });
  ok("en okänd del i en grupp ger fel", avslag(okand, "ljud.hogt"), visa(okand));
  ok("felet nämner delen", okand.fel.includes("ljud.hogt"), okand.fel);
  ok("en okänd del överst ger fel", avslag(spara({ farg: "rosa" }), "farg"));
  ok("versionen går inte att skriva", avslag(spara({ version: 1 }), "version"));
  const proto = spara(JSON.parse('{"__proto__":{"ordning":"antal"}}'));
  ok("__proto__ är en okänd del, inte en väg in", avslag(proto, "__proto__"), visa(proto));

  ok("en grupp som inte är ett objekt ger fel", avslag(spara({ ljud: true }), "ljud"));
  ok("en grupp som är null ger fel", avslag(spara({ arbetsdag: null }), "arbetsdag"));
  ok("en tom grupp ger fel", avslag(spara({ ljud: {} }), "ljud"));
  ok("en tom grupp i en grupp ger fel", avslag(spara({ firande: { storAffar: {} } }), "firande.storAffar"));
}

console.log("\nspara: tal, val, klockslag och laget");
{
  ok("volym 0 går", !avslag(spara({ ljud: { volym: 0 } })));
  ok("volym 100 går", !avslag(spara({ ljud: { volym: 100 } })));
  const hog = spara({ ljud: { volym: 150 } });
  ok("volym 150 ger fel i stället för att klippas", avslag(hog, "ljud.volym"), visa(hog));
  ok("felet säger gränserna", hog.fel.includes("0") && hog.fel.includes("100"), hog.fel);
  ok("volym −1 ger fel", avslag(spara({ ljud: { volym: -1 } }), "ljud.volym"));
  ok("volym 70,5 ger fel i stället för att avrundas", avslag(spara({ ljud: { volym: 70.5 } }), "ljud.volym"));
  ok('volym "70" ger fel', avslag(spara({ ljud: { volym: "70" } }), "ljud.volym"));
  ok("volym NaN ger fel", avslag(spara({ ljud: { volym: Number.NaN } }), "ljud.volym"));

  ok("beloppet 1 000 går", !avslag(spara({ firande: { storAffar: { belopp: 1_000 } } })));
  ok("beloppet 10 000 000 går", !avslag(spara({ firande: { storAffar: { belopp: 10_000_000 } } })));
  ok("beloppet 999 ger fel", avslag(spara({ firande: { storAffar: { belopp: 999 } } }), "firande.storAffar.belopp"));
  ok("beloppet 10 000 001 ger fel", avslag(spara({ firande: { storAffar: { belopp: 10_000_001 } } }), "firande.storAffar.belopp"));
  ok("efterregistrerad 0 dagar går", !avslag(spara({ firande: { efterregistreradDagar: 0 } })));
  ok("efterregistrerad 31 dagar ger fel", avslag(spara({ firande: { efterregistreradDagar: 31 } }), "firande.efterregistreradDagar"));

  ok('namnformen "hela" går', !avslag(spara({ namn: "hela" })));
  ok('namnformen "x" ger fel', avslag(spara({ namn: "x" }), "namn"));
  ok('rörelsen "lugn" går', !avslag(spara({ rorelse: "lugn" })));
  ok('rörelsen "snabb" ger fel', avslag(spara({ rorelse: "snabb" }), "rorelse"));
  ok('läget "auto" går', !avslag(spara({ firande: { storAffar: { lage: "auto" } } })));
  ok('läget "manuell" ger fel', avslag(spara({ firande: { storAffar: { lage: "manuell" } } }), "firande.storAffar.lage"));

  ok('klockslaget "07:30" går', !avslag(spara({ arbetsdag: { fran: "07:30" } })));
  ok('klockslaget "7:30" ger fel', avslag(spara({ arbetsdag: { fran: "7:30" } }), "arbetsdag.fran"));
  ok('klockslaget "24:00" ger fel', avslag(spara({ ljud: { till: "24:00" } }), "ljud.till"));
  ok("ett klockslag som tal ger fel", avslag(spara({ ljud: { fran: 800 } }), "ljud.fran"));

  ok("laget null (alla) går", lika(spara({ lag: null }), { handling: "spara", delar: { lag: null } }));
  const lag = spara({ lag: ID.toUpperCase() });
  ok("ett lag-id går, i små bokstäver", lika(lag, { handling: "spara", delar: { lag: ID } }), visa(lag));
  ok("ett tomt lag ger fel", avslag(spara({ lag: "" }), "lag"));
  ok("ett lag som inte är ett id ger fel", avslag(spara({ lag: "Team Mikro" }), "lag"));
  ok("ett lag som tal ger fel", avslag(spara({ lag: 5 }), "lag"));
}

// -----------------------------------------------------------------------------
console.log("\ntillampa: delarna landar, eller så sparas ingenting");
{
  const r = tillampa(STANDARD, { ljud: { volym: 30 }, ordning: "antal" });
  ok("en giltig del ger hela inställningarna", "installningar" in r && r.installningar.ljud.volym === 30 && r.installningar.ordning === "antal", visa(r));
  ok("det som inte nämns står kvar", "installningar" in r && r.installningar.ljud.fran === "08:00" && r.installningar.namn === "fornamn_e");
  ok("resultatet är normaliserat", "installningar" in r && lika(r.installningar, normalisera(r.installningar)));
  ok("standarden rörs inte", STANDARD.ljud.volym === 70 && STANDARD.ordning === "varde");

  const tidig = tillampa(STANDARD, { arbetsdag: { till: "07:00" } });
  ok("en arbetsdag som slutar före början ger fel", avslag(tidig, "arbetsdag"), visa(tidig));
  ok("felet säger hur", tidig.fel === FEL.arbetsdag, tidig.fel);
  ok("lika början och slut ger fel", avslag(tillampa(STANDARD, { arbetsdag: { fran: "18:00" } }), "arbetsdag"));
  const par = tillampa(STANDARD, { arbetsdag: { fran: "19:00", till: "21:00" } });
  ok("ett helt par som flyttas förbi det gamla slutet går", "installningar" in par && lika(par.installningar.arbetsdag, { fran: "19:00", till: "21:00" }), visa(par));
  const natt = tillampa(STANDARD, { ljud: { fran: "22:00", till: "06:00" } });
  ok("ljudtiden får gå över midnatt", "installningar" in natt && lika([natt.installningar.ljud.fran, natt.installningar.ljud.till], ["22:00", "06:00"]));
  const lag = tillampa({ ...STANDARD, lag: ID }, { lag: null });
  ok("laget kan släppas till alla", "installningar" in lag && lag.installningar.lag === null);

  // Skyddsnätet: delar som inte gått genom tolkaSkrivning. Det som inte landar
  // som det skickades sparas inte, oavsett varför.
  const klippt = tillampa(STANDARD, { ljud: { volym: 150 } });
  ok("ett tal som hade klippts ger fel i stället", avslag(klippt, "ljud.volym"), visa(klippt));
  const avrundad = tillampa(STANDARD, { ljud: { volym: 70.4 } });
  ok("ett tal som hade avrundats ger fel i stället", avslag(avrundad, "ljud.volym"), visa(avrundad));
  const skrap = tillampa(STANDARD, { ordning: "nej" });
  ok("en del som hade tappats ger fel i stället", avslag(skrap, "ordning"), visa(skrap));
  const okand = tillampa(STANDARD, { firande: { konfetti: true } });
  ok("en okänd del som hade tappats ger fel i stället", avslag(okand, "firande.konfetti"), visa(okand));
}

console.log("\nGränserna är inställningarnas");
{
  // Det högsta och lägsta tillåtna landar som det är; ett steg utanför klipps
  // av `uppdatera`. Flyttar någon en gräns i installningar.ts faller det här.
  const landar = (byggare, varde, las) => las(uppdatera(STANDARD, byggare(varde))) === varde;
  const grans = [
    ["volym", GRANSER.volym, (v) => ({ ljud: { volym: v } }), (s) => s.ljud.volym],
    ["belopp", GRANSER.belopp, (v) => ({ firande: { storAffar: { belopp: v } } }), (s) => s.firande.storAffar.belopp],
    ["efterregistrerad", GRANSER.efterregistreradDagar, (v) => ({ firande: { efterregistreradDagar: v } }), (s) => s.firande.efterregistreradDagar],
  ];
  for (const [namn, g, byggare, las] of grans) {
    ok(`${namn}: ${g.min} landar`, landar(byggare, g.min, las));
    ok(`${namn}: ${g.max} landar`, landar(byggare, g.max, las));
    ok(`${namn}: ${g.min - 1} klipps av inställningarna`, !landar(byggare, g.min - 1, las));
    ok(`${namn}: ${g.max + 1} klipps av inställningarna`, !landar(byggare, g.max + 1, las));
  }
}

// -----------------------------------------------------------------------------
console.log("\npara: koden och namnet");
{
  const r = tolkaSkrivning({ handling: "para", kod: " k7m4-qx9p ", namn: "Säljrummet" });
  ok("en kod normaliseras: små bokstäver, streck och blanksteg", lika(r, { handling: "para", kod: "K7M4QX9P", namn: "Säljrummet" }), visa(r));
  ok("en kod utan streck går", tolkaSkrivning({ handling: "para", kod: "K7M4QX9P", namn: "TV" }).kod === "K7M4QX9P");
  const o = tolkaSkrivning({ handling: "para", kod: "K7M4-QX9O", namn: "TV" });
  ok("ett O rättas inte till något, det avvisas", avslag(o, "kod") && o.fel === FEL.kodform, visa(o));
  ok("en etta avvisas", avslag(tolkaSkrivning({ handling: "para", kod: "K7M1-QX9P", namn: "TV" }), "kod"));
  ok("sju tecken avvisas", avslag(tolkaSkrivning({ handling: "para", kod: "K7M4-QX9", namn: "TV" }), "kod"));
  ok("en kod som tal avvisas", avslag(tolkaSkrivning({ handling: "para", kod: 12345678, namn: "TV" }), "kod"));
  ok("utan kod avvisas", avslag(tolkaSkrivning({ handling: "para", namn: "TV" }), "kod"));
  ok("utan namn avvisas", avslag(tolkaSkrivning({ handling: "para", kod: "K7M4QX9P" }), "namn"));

  const rent = tolkaSkrivning({ handling: "para", kod: "K7M4QX9P", namn: "  TV \n  i   köket " });
  ok("namnet trimmas och blanksteg slås ihop", rent.namn === "TV i köket", visa(rent));
  ok("ett namn av bara blanksteg avvisas", avslag(tolkaSkrivning({ handling: "para", kod: "K7M4QX9P", namn: "   " }), "namn"));
  ok(`${NAMN_MAX} tecken går`, tolkaSkrivning({ handling: "para", kod: "K7M4QX9P", namn: "a".repeat(NAMN_MAX) }).namn?.length === NAMN_MAX);
  const lang = tolkaSkrivning({ handling: "para", kod: "K7M4QX9P", namn: "a".repeat(NAMN_MAX + 1) });
  ok("namn över 60 ger fel", avslag(lang, "namn") && lang.fel === FEL.namn, visa(lang));
  // Postgres räknar tecken, inte UTF-16-enheter: 60 tecken utanför BMP är 120 enheter i JS.
  ok("60 tecken utanför BMP går", !avslag(tolkaSkrivning({ handling: "para", kod: "K7M4QX9P", namn: "𝐓".repeat(60) })));
  ok("61 tecken utanför BMP ger fel", avslag(tolkaSkrivning({ handling: "para", kod: "K7M4QX9P", namn: "𝐓".repeat(61) }), "namn"));
  const nfc = tolkaSkrivning({ handling: "para", kod: "K7M4QX9P", namn: "Mälarsalen" });
  ok("namnet sätts samman (NFC)", nfc.namn === "Mälarsalen", visa(nfc));
  ok("ett styrtecken avvisas", avslag(tolkaSkrivning({ handling: "para", kod: "K7M4QX9P", namn: "TV\u0000" }), "namn"));
  ok("en riktningsväxling avvisas", avslag(tolkaSkrivning({ handling: "para", kod: "K7M4QX9P", namn: "TV\u202Egnirp" }), "namn"));
  ok("ett namn som tal avvisas", avslag(tolkaSkrivning({ handling: "para", kod: "K7M4QX9P", namn: 7 }), "namn"));
}

console.log("\nSkärmarna: byt namn, ljud och koppla bort");
{
  ok("byt_namn går", lika(tolkaSkrivning({ handling: "byt_namn", id: ID, namn: " Köket " }), { handling: "byt_namn", id: ID, namn: "Köket" }));
  ok("byt_namn över 60 ger fel", avslag(tolkaSkrivning({ handling: "byt_namn", id: ID, namn: "x".repeat(61) }), "namn"));
  ok("byt_namn utan id ger fel", avslag(tolkaSkrivning({ handling: "byt_namn", namn: "Köket" }), "id"));
  ok("ett id som inte är ett uuid ger fel", avslag(tolkaSkrivning({ handling: "koppla_bort", id: "1 or 1=1" }), "id"));
  ok("koppla_bort går, id i små bokstäver", lika(tolkaSkrivning({ handling: "koppla_bort", id: ID2.toUpperCase() }), { handling: "koppla_bort", id: ID2 }));
  ok("ljud_skarm av går", lika(tolkaSkrivning({ handling: "ljud_skarm", id: ID, ljud: false }), { handling: "ljud_skarm", id: ID, ljud: false }));
  ok('ljud_skarm "false" ger fel', avslag(tolkaSkrivning({ handling: "ljud_skarm", id: ID, ljud: "false" }), "ljud"));
  ok("ljud_skarm utan ljud ger fel", avslag(tolkaSkrivning({ handling: "ljud_skarm", id: ID }), "ljud"));
}

console.log("\nperson: bara visningen (R33, R38)");
{
  ok("dold går", lika(tolkaSkrivning({ handling: "person", id: ID, display: "dold" }), { handling: "person", id: ID, display: "dold" }));
  ok("initialer går", !avslag(tolkaSkrivning({ handling: "person", id: ID, display: "initialer" })));
  const motiv = tolkaSkrivning({ handling: "person", id: ID, display: "namn", motiv: 3 });
  ok("ett motiv är ett okänt fält: motiven finns inte längre", avslag(motiv, "motiv"), visa(motiv));
  const x = tolkaSkrivning({ handling: "person", id: ID, display: "x" });
  ok('display "x" ger fel', avslag(x, "display"), visa(x));
  ok('display "constructor" ger fel, uppslaget är bara egna nycklar', avslag(tolkaSkrivning({ handling: "person", id: ID, display: "constructor" }), "display"));
  ok("utan display ger fel", avslag(tolkaSkrivning({ handling: "person", id: ID }), "display"));
  ok("person utan id ger fel", avslag(tolkaSkrivning({ handling: "person", display: "namn" }), "id"));
}

console.log("\nmålen per månad (R35)");
{
  const mal = spara({ mal: { "2026-10": 550_000, "2026-11": null } });
  ok("ett mål och en borttagning går igenom", lika(mal, { handling: "spara", delar: { mal: { "2026-10": 550_000, "2026-11": null } } }), visa(mal));
  ok("en månad som inte finns ger fel", avslag(spara({ mal: { "2026-13": 550_000 } }), "mal.2026-13"));
  ok("ett mål under tusen ger fel", avslag(spara({ mal: { "2026-10": 999 } }), "mal.2026-10"));
  ok("ett mål med decimaler ger fel", avslag(spara({ mal: { "2026-10": 550_000.5 } }), "mal.2026-10"));
  ok("tomma mål ger fel", avslag(spara({ mal: {} }), "mal"));
  const satt = tillampa(STANDARD, { mal: { "2026-10": 550_000 } });
  ok("målet landar", "installningar" in satt && satt.installningar.mal["2026-10"] === 550_000, visa(satt));
  const borta = tillampa(satt.installningar, { mal: { "2026-10": null } });
  ok("ett borttaget mål landar som inget mål", "installningar" in borta && !("2026-10" in borta.installningar.mal), visa(borta));
  ok("ordningen går igenom", lika(spara({ ordning: "antal" }), { handling: "spara", delar: { ordning: "antal" } }));
  ok('ordningen "x" ger fel', avslag(spara({ ordning: "x" }), "ordning"));
}

console.log("\ntesta: typen");
{
  ok('testtyp "malet" är ok', lika(tolkaSkrivning({ handling: "testa", typ: "malet" }), { handling: "testa", typ: "malet" }));
  for (const typ of ["order", "stor", "forsta", "serie"]) ok(`testtyp "${typ}" är ok`, tolkaSkrivning({ handling: "testa", typ }).typ === typ);
  ok('testtyp "halvvags" finns inte', avslag(tolkaSkrivning({ handling: "testa", typ: "halvvags" }), "typ"));
  ok("testtypen är skiftlägeskänslig", avslag(tolkaSkrivning({ handling: "testa", typ: "Malet" }), "typ"));
  ok("utan typ ger fel", avslag(tolkaSkrivning({ handling: "testa" }), "typ"));
  ok('"constructor" är ingen testtyp', avslag(tolkaSkrivning({ handling: "testa", typ: "constructor" }), "typ"));
}

// -----------------------------------------------------------------------------
console.log("\nTexterna och händelserna");
{
  ok("säljaren får beskedet ur briefen", FEL.inteAdmin === "Bara admin kan ändra säljtavlan.", FEL.inteAdmin);
  ok("koden som inte finns", FEL.koden === "Koden finns inte eller har gått ut.", FEL.koden);
  ok("tabellerna som inte finns än", FEL.inteInstallerad === "Säljtavlans tabeller är inte installerade än.", FEL.inteInstallerad);
  ok("namnets gräns står i texten", FEL.namn.includes(String(NAMN_MAX)), FEL.namn);

  const handelser = Object.values(HANDELSER);
  ok(
    "de fyra ur briefen loggas",
    ["salesboard.settings_changed", "salesboard.screen_created", "salesboard.screen_revoked", "salesboard.person_changed"].every((h) => handelser.includes(h)),
    visa(handelser),
  );
  ok("varje händelse kommer ur en registrerad modul", handelser.every(arModulKand), visa(handelser.filter((h) => !arModulKand(h))));
  ok("en ny skärm är ett skapande", typFor(HANDELSER.para) === "skapande", typFor(HANDELSER.para));
  ok("en ändrad inställning är en ändring", typFor(HANDELSER.spara) === "andring", typFor(HANDELSER.spara));
  ok("inga två handlingar delar händelse", new Set(handelser).size === handelser.length);
}

// -----------------------------------------------------------------------------
console.log("\nSkärmarna formas för listan");
{
  const rad = (namn, extra = {}) => ({
    id: ID,
    name: namn,
    sound: true,
    created_at: "2026-10-24T08:00:00.123456+00:00",
    claimed_at: "2026-10-24T08:00:05+00:00",
    last_seen_at: "2026-10-24T09:14:21.5+00:00",
    user_agent: null,
    ...extra,
  });
  const lista = formaSkarmar([rad("Örebro"), rad("Ängen"), rad("Åsen"), rad("Zon"), rad("bas")]);
  ok("namnen i svensk ordning: å, ä, ö efter z", lika(lista.map((s) => s.namn), ["bas", "Zon", "Åsen", "Ängen", "Örebro"]), visa(lista.map((s) => s.namn)));
  const s = formaSkarmar([rad("Säljrummet", { token_hash: "hemlig", last_ip: "10.0.0.7", revoked_by: ID2 })])[0];
  ok(
    "bara det listan visar följer med",
    lika(Object.keys(s).sort(), ["id", "ljud", "namn", "parad", "sedd", "skapad", "tv", "webblasare"]),
    visa(Object.keys(s)),
  );
  ok("ingen hash och ingen adress", !JSON.stringify(s).includes("hemlig") && !JSON.stringify(s).includes("10.0.0.7"));
  ok("tiderna blir ISO med Z, som Safari läser", s.skapad === "2026-10-24T08:00:00.123Z" && s.sedd === "2026-10-24T09:14:21.500Z", visa(s));
  const ny = formaSkarmar([rad("Ny", { claimed_at: null, last_seen_at: null })])[0];
  ok("en skärm som inte anslutit har varken parad eller sedd", ny.parad === null && ny.sedd === null);
  const trasig = formaSkarmar([rad("Trasig", { last_seen_at: "i går" })])[0];
  ok("en tid som inte går att läsa blir null", trasig.sedd === null);
}

console.log("\nWebbläsaren i klartext");
{
  const fall = [
    ["Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36", "Chrome 130 · Linux ARM", false],
    ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chromium/128.0.6613.84 Chrome/128.0.6613.84 Safari/537.36", "Chromium 128 · Linux", false],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15", "Safari 18 · macOS", false],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.68", "Edge 130 · Windows", false],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0", "Firefox 131 · Linux", false],
    ["Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) 76.0.3809.146/6.0 TV Safari/537.36", "Samsung-TV", true],
    ["Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Safari/537.36 WebAppManager", "Chrome 79 · LG-TV", true],
    ["Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7233) AppleWebKit/537.36 (KHTML, like Gecko) Silk/112.3.1 like Chrome/112.0.5615.213 Safari/537.36", "Chrome 112 · Android-TV", true],
  ];
  for (const [ua, namn, tv] of fall) {
    const w = webblasarnamn(ua);
    ok(`${namn}${tv ? " (TV)" : ""}`, w.namn === namn && w.tv === tv, visa(w));
  }
  ok("ingen webbläsare ger null", lika(webblasarnamn(null), { namn: null, tv: false }));
  ok("en okänd sträng säger det", webblasarnamn("curl/8.4.0").namn === "Okänd webbläsare");
}

// -----------------------------------------------------------------------------
console.log("\nSäljarna: alla som tavlan kan visa (R28)");
{
  const LAG = "11111111-2222-4333-8444-555555555555";
  const ANNAT = "99999999-8888-4777-8666-555555555555";
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const person = (n, fornamn, efternamn, extra = {}) => ({
    id: id(n),
    first_name: fornamn,
    last_name: efternamn,
    team_id: LAG,
    status: "active",
    employee_role: [{ role: "salesperson" }],
    ...extra,
  });
  const anstallda = [
    person(1, "Sara", "Lind"),
    person(2, "Amira", "Haddad"),
    person(3, "Örjan", "Berg", { status: "onboarding" }),
    person(4, "Elin", "Berg", { status: "offboarded" }),
    person(5, "Jonas", "Karlsson", { employee_role: [{ role: "sales_manager" }, { role: "ceo" }] }),
    person(6, "Omar", "Nilsson", { team_id: ANNAT }),
    person(7, "Maximilian", "Andersson-Lindqvist", { employee_role: [{ role: "team_lead" }, { role: "salesperson" }] }),
    person(8, "Ingen", "Roll", { employee_role: null }),
    person(9, "Lena", "Ekonomi", { employee_role: [{ role: "finance" }] }),
    person(10, "Gamla", "Order", { status: "offboarded" }),
    person(11, "Makulerad", "Bara", { status: "offboarded" }),
  ];
  const val = [
    { employee_id: id(1), display: "initialer" },
    { employee_id: id(2), display: "dold" },
    { employee_id: id(7), display: "osynlig" },
    { employee_id: id(4), display: "dold" },
  ];
  // Tavlans fönster för fredagen den 23 oktober: månaden och orderlistans fjorton dagar.
  const fonster = { manad: "2026-10-01", senasteFran: "2026-10-08T22:00:00.000Z" };
  const order = (n, status, period_month, approved_at, cancel_period_month = null) => ({ salesperson_id: id(n), status, period_month, approved_at, cancel_period_month });
  const ordrar = [
    order(4, "signerad", "2026-10-01", "2026-10-05T09:00:00Z"), // slutat, sålt i månaden
    order(5, "betald", "2026-10-01", "2026-10-21T13:00:00Z"), // chefen och VD:n säljer själv
    order(6, "signerad", "2026-10-01", "2026-10-20T08:00:00Z"), // ett annat lag
    order(9, "inskickad", "2026-10-01", null), // aldrig godkänd: syns inte
    order(10, "signerad", "2026-09-01", "2026-10-12T10:00:00Z"), // signerad i september, godkänd inom listans fjorton dagar
    order(11, "makulerad", "2026-10-01", "2026-10-03T10:00:00Z", "2026-10-01"), // makulerad i månaden: inget bidrag
    order(8, "signerad", "2026-09-01", "2026-09-29T10:00:00Z"), // förra månaden, utanför listan
  ];

  const syns = tavlansPersoner(ordrar, fonster);
  ok("tavlans personer: bidragen och orderlistan", lika([...syns].sort(), [id(4), id(5), id(6), id(10)].sort()), visa([...syns]));
  ok("en order som aldrig godkänts syns inte", !syns.has(id(9)));
  ok("en order som makulerats i månaden är inget bidrag", !syns.has(id(11)));
  ok("en order utanför orderlistan och månaden syns inte", !syns.has(id(8)));

  const lagets = formaSaljare(anstallda, val, LAG, ordrar, fonster);
  ok(
    "laget: aktiva säljare, och alla som sålt det tavlan visar",
    lika(lagets.map((s) => s.fornamn), ["Amira", "Elin", "Gamla", "Jonas", "Maximilian", "Sara", "Örjan"]),
    visa(lagets.map((s) => s.fornamn)),
  );
  ok("ett annat lags säljare är inte med", !lagets.some((s) => s.fornamn === "Omar"));
  ok("den utan roller och utan order är inte med", !lagets.some((s) => s.fornamn === "Ingen"));
  ok("ekonomi utan order är inte med", !lagets.some((s) => s.fornamn === "Lena"));
  ok("den som slutat utan order i fönstret är inte med", !lagets.some((s) => s.fornamn === "Makulerad"));

  const varfor = Object.fromEntries(lagets.map((s) => [s.fornamn, s.varfor]));
  ok("en vanlig säljare behöver ingen markering", varfor.Sara === null && varfor.Amira === null && varfor.Örjan === null, visa(varfor));
  ok("den som slutat markeras Slutat", varfor.Elin === "Slutat" && varfor.Gamla === "Slutat", visa(varfor));
  ok("chefen som säljer markeras med sin roll", varfor.Jonas === "Säljchef", visa(varfor));
  ok("en teamledare som också är säljare är en säljare", varfor.Maximilian === null, visa(varfor));

  const elin = lagets.find((s) => s.fornamn === "Elin");
  ok("valen följer med också för den som slutat", elin.visning === "dold", visa(elin));
  const sara = lagets.find((s) => s.fornamn === "Sara");
  ok("valet följer med", sara.visning === "initialer", visa(sara));
  const amira = lagets.find((s) => s.fornamn === "Amira");
  ok("dold", amira.visning === "dold", visa(amira));
  const jonas = lagets.find((s) => s.fornamn === "Jonas");
  ok("utan val: namn, som tavlan", jonas.visning === "namn", visa(jonas));
  const max = lagets.find((s) => s.fornamn === "Maximilian");
  ok("en visning som inte finns är dold, som på tavlan", max.visning === "dold", visa(max));
  ok(
    "bara det kortet behöver",
    lika(Object.keys(sara).sort(), ["efternamn", "fornamn", "id", "lag", "varfor", "visning"]),
    visa(Object.keys(sara)),
  );

  const alla = formaSaljare(anstallda, val, null, ordrar, fonster);
  ok("alla lag: också det andra lagets säljare", alla.some((s) => s.fornamn === "Omar"), visa(alla.map((s) => s.fornamn)));
  ok(
    "utan order: de aktiva vars roll kan sälja, också chefen och VD:n (R30)",
    lika(formaSaljare(anstallda, [], LAG, [], fonster).map((s) => s.fornamn), ["Amira", "Jonas", "Maximilian", "Sara", "Örjan"]),
  );
  ok("utan order är chefen markerad med sin roll", formaSaljare(anstallda, [], LAG, [], fonster).find((s) => s.fornamn === "Jonas")?.varfor === "Säljchef");
}

console.log("\nSparningen: jämför och byt (R25)");
{
  const forsta = planeraSparning(null, { ljud: { volym: 30 } });
  ok("ingen rad än: en ny rad, utan villkor", "installningar" in forsta && forsta.villkor === null && forsta.installningar.ljud.volym === 30, visa(forsta));
  const rad = { value: { ljud: { volym: 40 }, ordning: "antal" }, updated_at: "2026-10-24T08:12:33.123456+00:00" };
  const andra = planeraSparning(rad, { ljud: { pa: false } });
  ok("en rad: villkoret är radens updated_at", "installningar" in andra && andra.villkor === rad.updated_at, visa(andra));
  ok("det som redan gällde står kvar", andra.installningar.ljud.volym === 40 && andra.installningar.ordning === "antal" && andra.installningar.ljud.pa === false);
  const nej = planeraSparning(rad, { arbetsdag: { till: "07:00" } });
  ok("en del som inte landar ger nej, före all skrivning", avslag(nej, "arbetsdag"), visa(nej));
  ok("en rad med skräp läses som standarden", planeraSparning({ value: "trasig", updated_at: "x" }, { ordning: "antal" }).installningar.ordning === "antal");

  ok("landade: klart", efterForsok(1, true) === "klar");
  ok("krock första gången: läs om och försök igen", efterForsok(1, false) === "igen");
  ok("krock andra gången: 409", efterForsok(2, false) === "krock");
  ok("landade andra gången: klart", efterForsok(2, true) === "klar");
  ok("409-texten", FEL.samtidigt === "Någon annan sparade samtidigt. Ladda om sidan och försök igen.", FEL.samtidigt);
}

console.log("\nBesluten i rutten och på sidan");
{
  const admin = { typ: "admin", id: "e1" };
  ok("admin: inget nej", atkomstsvar(admin) === null);
  ok("utan session: 401", lika(atkomstsvar({ typ: "nej", session: false }), { status: 401, fel: FEL.utloggad }));
  ok("en säljare: 403 med briefens text", lika(atkomstsvar({ typ: "nej", session: true }), { status: 403, fel: FEL.inteAdmin }));
  ok("går det inte att veta: 503, aldrig 401 eller 403", lika(atkomstsvar({ typ: "oklart" }), { status: 503, fel: FEL.svararInte }));

  ok("sidan: utan session till inloggningen", sidansVag({ typ: "nej", session: false }) === "inloggning");
  ok("sidan: en säljare får nejet", sidansVag({ typ: "nej", session: true }) === "nej");
  ok("sidan: går det inte att veta, ett lugnt fel", sidansVag({ typ: "oklart" }) === "stopp");
  ok("sidan: admin ser korten", sidansVag(admin) === "visa");

  ok("parningen: en rad löstes in", parningsutfall(null, 1) === "klar");
  ok("parningen: ingen rad, skärmen bort och 404", parningsutfall(null, 0) === "ingen-kod");
  ok("parningen: ett fel, skärmen bort och felet", parningsutfall({ message: "nej" }, 0) === "fel");

  ok("före 0250: allt saknas", installationslage("saknas", "saknas", "saknas") === "ej");
  ok("efter 0250: allt svarar", installationslage("svar", "svar", "svar") === "installerad");
  ok("statistiken saknas ensam: tavlan klarar sig utan", installationslage("svar", "svar", "saknas") === "installerad");
  ok("skärmarna svarar men valen saknas: fel, aldrig 'ingen dold'", installationslage("svar", "saknas", "saknas") === "fel");
  ok("valen svarar men skärmarna saknas: fel", installationslage("saknas", "svar", "saknas") === "fel");
  ok("statistiken svarar men tabellerna saknas: fel", installationslage("saknas", "saknas", "svar") === "fel");
  ok("ett riktigt fel på skärmarna: fel", installationslage("fel", "svar", "svar") === "fel");

  ok("säljarna: allt svarar", saljarutfall({ anstallda: "svar", order: "svar", val: "svar", ovriga: [] }) === "rader");
  ok("säljarna före 0250: utan val", saljarutfall({ anstallda: "svar", order: "svar", val: "saknas", ovriga: ["saknas"] }) === "inga-val");
  ok("valen saknas fast 0250 svarar: fel", saljarutfall({ anstallda: "svar", order: "svar", val: "saknas", ovriga: ["svar"] }) === "fel");
  ok("de anställda går inte att läsa: fel", saljarutfall({ anstallda: "fel", order: "svar", val: "svar", ovriga: [] }) === "fel");
  ok("orderna går inte att läsa: fel", saljarutfall({ anstallda: "svar", order: "fel", val: "svar", ovriga: [] }) === "fel");
}

// -----------------------------------------------------------------------------
console.log("\nTröskeln för stor affär, som tavlan räknar den");
{
  const AUTO = { lage: "auto", belopp: 1_000 };
  const p = troskelNu({ saljare: [], p90: 42_150.4, antal90: 37, bastaDag: 0 });
  ok("med underlag gäller percentilen", p.auto === 42_150.4 && p.percentil === true && p.underlag === 37, visa(p));
  ok("samma tal som tavlan", p.auto === troskelFranStatistik(42_150.4, 37, AUTO));
  const f = troskelNu({ saljare: [], p90: 52_000, antal90: 12, bastaDag: 0 });
  ok("för litet underlag: reserven, inte percentilen", f.auto === troskelFranStatistik(52_000, 12, AUTO) && f.percentil === false, visa(f));
  const lik = troskelNu({ saljare: [], p90: 30_000, antal90: 5, bastaDag: 0 });
  ok("en percentil som råkar vara lika med reserven räknas inte som percentil", lik.percentil === false, visa(lik));
  const utan = troskelNu(null);
  ok("utan statistik (0250 inte körd): som tavlan utan statistik", utan.auto === troskelFranStatistik(null, 0, AUTO) && utan.percentil === false && utan.underlag === 0, visa(utan));
  const tom = troskelNu({ saljare: [], p90: null, antal90: 40, bastaDag: 0 });
  ok("ingen percentil alls: reserven", tom.auto === troskelFranStatistik(null, 40, AUTO) && tom.percentil === false, visa(tom));
  // Gränsen för underlaget, åt båda hållen: tavlans regel och kortets text ska säga samma sak.
  for (const antal of [19, 20]) {
    const t = troskelNu({ saljare: [], p90: 48_000, antal90: antal, bastaDag: 0 });
    const regeln = troskelFranStatistik(48_000, antal, AUTO);
    ok(`${antal} order: ${t.percentil ? "percentilen" : "reserven"}, som regeln`, t.auto === regeln && t.percentil === (regeln === 48_000), visa(t));
  }
}

console.log("\nKällkoden bär inga osynliga tecken (Trojan Source)");
{
  const osynlig = (k) => k === 0xad || k === 0xfeff || (k >= 0x200b && k <= 0x200f) || (k >= 0x202a && k <= 0x202e) || (k >= 0x2060 && k <= 0x2069);
  for (const fil of ["src/lib/salesboard/skrivning.ts", "tests/salesboard-installningar.mjs"]) {
    const text = readFileSync(new URL(`../${fil}`, import.meta.url), "utf8");
    const funna = [...text].filter((t) => osynlig(t.codePointAt(0)));
    ok(`${fil}: inga osynliga tecken eller riktningsväxlingar`, funna.length === 0, funna.map((t) => t.codePointAt(0).toString(16)).join(" "));
  }
}

console.log("\nmålens arv, stämpeln och de säljande rollerna");
{
  const mal = { "2026-08": 520_000, "2026-10": 550_000 };
  ok("en månad med eget mål har sitt", malFor(mal, "2026-10") === 550_000);
  ok("en månad utan mål ärver det senaste före", malFor(mal, "2026-09") === 520_000 && malFor(mal, "2026-12") === 550_000);
  ok("en månad före alla mål har inget", malFor(mal, "2026-07") === null && malFor({}, "2026-10") === null);
  const lasta = normalisera({ mal: { "2026-10": 550_000, "2026-13": 1, x: 2, "2026-11": "mycket", "2026-12": 50 } });
  ok("normalisera stryker skräp bland målen", lika(lasta.mal, { "2026-10": 550_000 }), visa(lasta.mal));
  const manga = normalisera({ mal: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`20${String(23 + Math.floor(i / 12))}-${String((i % 12) + 1).padStart(2, "0")}`, 100_000])) });
  ok("bara de 36 senaste månaderna sparas", Object.keys(manga.mal).length === 36 && !("2023-01" in manga.mal) && "2026-04" in manga.mal, visa(Object.keys(manga.mal).slice(0, 3)));

  const las = "2026-10-24T08:12:33.123Z";
  ok("stämpeln är nu när klockan gått framåt", nastaStampel(las, "2026-10-24T08:12:34.000Z") === "2026-10-24T08:12:34.000Z");
  ok("stämpeln är efter den lästa när klockan står still", nastaStampel(las, las) === "2026-10-24T08:12:33.124Z");
  ok("stämpeln är efter den lästa när klockan går efter", nastaStampel(las, "2026-10-24T08:00:00.000Z") === "2026-10-24T08:12:33.124Z");
  ok("utan rad är stämpeln nu", nastaStampel(null, las) === las);
  ok("en oläslig rad ger nu", nastaStampel("x", las) === las);

  // R30: samma roller som orderformuläret. Navets fil exporterar inte sin mängd, så provet läser den.
  const navOrder = readFileSync(new URL("../src/lib/nav2/order.ts", import.meta.url), "utf8");
  const navs = navOrder.match(/const SALJANDE_ROLLER = new Set\(\[([^\]]*)\]\)/)?.[1]?.match(/"[^"]+"/g)?.map((x) => x.slice(1, -1));
  ok("de säljande rollerna är orderformulärets", lika([...SALJANDE_ROLLER].sort(), (navs ?? []).sort()), visa(navs));
}

console.log(fel === 0 ? "\n\x1b[32mAllt grönt.\x1b[0m\n" : `\n\x1b[31m${fel} fel.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
