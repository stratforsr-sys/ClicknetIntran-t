#!/usr/bin/env node
/**
 * Parningen av en kontors-TV: koden, tokenen och hashen. Fem saker står på spel
 * och provas åt båda hållen:
 *
 *   1. ALFABETET. Åtta tecken ur exakt 32 ger 40 bitar, och `byte % 32` ger
 *      varje tecken precis lika stor chans. Med 31 eller 33 tecken hade vissa
 *      tecken blivit vanligare utan att något syntes. Därför provas både längden
 *      och att varje tecken träffas av exakt lika många av de 256 byten.
 *   2. INMATNINGEN. Den som läser koden på TV:n tvärs över kontoret skriver små
 *      bokstäver, blanksteg och streck. Koden ska ändå gå att lösa in.
 *   3. FELSKRIFTEN. I, O, 0 och 1 finns inte i alfabetet och rättas inte heller
 *      till något annat: en kod med ett I i är en felskrift, och den ska
 *      avvisas i stället för gissas.
 *   4. TOKENEN. 32 slumpbyte, alltså 43 tecken i base64url utan fyllnad. Den är
 *      det enda som släpper in en skärm, så den får aldrig bli kortare.
 *   5. HASHEN. Databasen sparar bara hashen, aldrig tokenen. Ändras algoritmen
 *      eller kodningen hittas ingen parad skärm igen, och varje TV faller
 *      tillbaka till parningen samma dag. Därför ett facit från utsidan.
 *
 *   TZ=UTC node --experimental-strip-types tests/salesboard-parning.mjs
 */
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import {
  KODALFABET,
  KODLANGD,
  KOD_GILTIG_MS,
  hasha,
  normaliseraKod,
  nyKod,
  nyToken,
  visaKod,
} from "../src/lib/salesboard/parning.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(
    `  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`,
  );
  if (!villkor) fel++;
};

// Alla tecken ligger i alfabetet.
const iAlfabetet = (s) => [...s].every((t) => KODALFABET.includes(t));

// En styrd slump: samma byte hela vägen, eller exakt de byte som anges.
const alltid = (byte) => (n) => new Uint8Array(n).fill(byte);
const dessa = (...byte) => () => Uint8Array.from(byte);

// -----------------------------------------------------------------------------
console.log("\nAlfabetet och konstanterna");
{
  ok("alfabetet är exakt det avtalade", KODALFABET === "ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
  ok("32 tecken", KODALFABET.length === 32, String(KODALFABET.length));

  // 256 går jämnt upp i 32. Det är hela skälet till att `byte % 32` är rättvist.
  ok("32 delar 256 jämnt, så ingen modulosnedvridning", 256 % KODALFABET.length === 0);
  ok("inget tecken förekommer två gånger", new Set(KODALFABET).size === KODALFABET.length);

  // Tecknen som läses fel på en TV tvärs över rummet.
  ok("varken I, O, 0 eller 1", ![..."IO01"].some((t) => KODALFABET.includes(t)));
  ok("bara versaler och siffror", /^[A-Z0-9]+$/.test(KODALFABET));

  ok("koden har åtta tecken", KODLANGD === 8);
  ok("åtta tecken ur 32 ger 40 bitar", Math.log2(KODALFABET.length) * KODLANGD === 40);
  ok("koden gäller i tio minuter", KOD_GILTIG_MS === 10 * 60 * 1000, String(KOD_GILTIG_MS));
}

// -----------------------------------------------------------------------------
console.log("\nEn slumpad kod");
{
  const koder = Array.from({ length: 1000 }, () => nyKod());
  const unika = new Set(koder).size;

  ok("varje kod har åtta tecken", koder.every((k) => k.length === 8));
  ok("och bara tecken ur alfabetet", koder.every(iAlfabetet));
  ok("tusen koder ger minst 990 unika", unika >= 990, String(unika));

  // Åtta tusen tecken ur 32: att något tecken aldrig dyker upp är praktiskt
  // taget omöjligt, så en slump som aldrig når alfabetets ände syns här.
  const sedda = new Set(koder.join(""));
  ok("alla 32 tecken förekommer", sedda.size === 32, String(sedda.size));
}

// -----------------------------------------------------------------------------
console.log("\nSlumpen kommer ur randomBytes");
{
  // Statistik kan inte skilja `randomBytes` från `Math.random`, men en kod eller
  // token som går att förutse släpper in en främling. Därför provas själva källan:
  // `randomBytes` byts mot en spion som släpper igenom det riktiga anropet.
  const riktig = crypto.randomBytes;
  const begart = [];
  crypto.randomBytes = (n) => {
    begart.push(n);
    return riktig(n);
  };
  syncBuiltinESMExports();
  try {
    nyKod();
    nyToken();
  } finally {
    crypto.randomBytes = riktig;
    syncBuiltinESMExports();
  }

  ok("nyKod hämtar åtta byte ur randomBytes", begart.includes(8), begart.join(","));
  ok("nyToken hämtar 32 byte ur randomBytes", begart.includes(32), begart.join(","));
}

// -----------------------------------------------------------------------------
console.log("\nKoden ur en styrd slump");
{
  // 0xFF % 32 = 31, alltså alfabetets sista tecken. Ett index utanför alfabetet
  // hade gett "undefined" mitt i koden.
  const ff = nyKod(alltid(0xff));
  ok(
    "en slump som alltid ger 0xFF ger bara tecken ur alfabetet",
    ff.length === 8 && iAlfabetet(ff),
    ff,
  );
  ok("0xFF är alfabetets sista tecken, åtta gånger", ff === "99999999", ff);
  ok("0x00 är det första", nyKod(alltid(0x00)) === "AAAAAAAA");

  // Facit tecken för tecken: K=9, 7=29, M=11, 4=26, Q=14, X=21, 9=31, P=13.
  ok(
    "byte 9, 29, 11, 26, 14, 21, 31, 13 blir K7M4QX9P",
    nyKod(dessa(9, 29, 11, 26, 14, 21, 31, 13)) === "K7M4QX9P",
  );
  // Samma tecken med höga byte: `% 32` ska vika tillbaka dem, ett varv eller fler.
  ok(
    "samma byte plus ett eller flera varv blir samma kod",
    nyKod(dessa(233, 221, 171, 154, 110, 85, 63, 13)) === "K7M4QX9P",
  );

  // RÄTTVISAN. Alla 256 möjliga byte, och varje tecken ska träffas av exakt
  // lika många: 256 / 32 = 8. Med ett alfabet som inte delar 256 jämnt blir
  // några tecken vanligare, och det är precis det här provet som ser det.
  const traffar = new Map();
  for (let b = 0; b < 256; b++) {
    const t = nyKod(alltid(b))[0];
    traffar.set(t, (traffar.get(t) ?? 0) + 1);
  }
  ok("alla 256 byte ger ett tecken ur alfabetet", iAlfabetet([...traffar.keys()].join("")));
  ok("alla 32 tecken träffas", traffar.size === 32, String(traffar.size));
  ok("och varje tecken av exakt åtta byte", [...traffar.values()].every((n) => n === 8));

  // En byte per tecken: det är det som gör att ingen byte behöver kastas bort.
  let begart = null;
  nyKod((n) => {
    begart = n;
    return new Uint8Array(n);
  });
  ok("koden begär exakt åtta byte av slumpen", begart === 8, String(begart));

  // En slump som ger för få byte får inte ge en kortare, trasig kod.
  let kastade = false;
  try {
    nyKod(() => new Uint8Array(3));
  } catch {
    kastade = true;
  }
  ok("en slump som ger för få byte avvisas", kastade);
}

// -----------------------------------------------------------------------------
console.log("\nInmatningen");
{
  ok("små bokstäver, streck och blanksteg rensas", normaliseraKod(" k7m4-qx9p ") === "K7M4QX9P");
  ok("en redan ren kod förblir som den är", normaliseraKod("K7M4QX9P") === "K7M4QX9P");
  ok("versaler med streck", normaliseraKod("K7M4-QX9P") === "K7M4QX9P");
  ok("blanksteg i stället för streck", normaliseraKod("K7M4 QX9P") === "K7M4QX9P");
  ok("tabb och radbrytning runt om", normaliseraKod("\tK7M4QX9P\n") === "K7M4QX9P");
  ok("hårt blanksteg från en inklistrad rad", normaliseraKod("K7M4 QX9P") === "K7M4QX9P");

  // FÖR KORT OCH FÖR LÅNG. En kod som saknar ett tecken ska inte "nästan" gälla.
  ok("sju tecken ger null", normaliseraKod("K7M4QX9") === null);
  ok("nio tecken ger null", normaliseraKod("K7M4QX9PA") === null);
  ok("tom sträng ger null", normaliseraKod("") === null);
  ok("bara streck och blanksteg ger null", normaliseraKod(" - - ") === null);

  // FELSKRIFT. Tecknen som alfabetet medvetet saknar rättas inte till något
  // annat, hur lockande det än vore: en gissning är en annan kod.
  for (const tecken of ["I", "O", "0", "1"]) {
    const platser = [`${tecken}7M4QX9P`, `K7M${tecken}QX9P`, `K7M4QX9${tecken}`];
    ok(
      `${tecken} i en kod ger null, först, mitt i och sist`,
      platser.every((k) => normaliseraKod(k) === null && normaliseraKod(k.toLowerCase()) === null),
    );
  }
  ok(
    "andra tecken ger null",
    ["K7M4QX9_", "K7M4QX9.", "K7M4QX9Å", "K7M4QX9%"].every((s) => normaliseraKod(s) === null),
  );

  // `toUpperCase()` gör ß till SS och ſ till S. Då hade en tydlig felskrift
  // blivit en giltig kod, så versaliseringen får inte avgöra vad som släpps in.
  ok(
    "tecken som bara blir alfabetets vid versalisering godtas inte",
    normaliseraKod("ßK7M4QX") === null && normaliseraKod("K7M4QXſP") === null,
  );

  // Kroppen kommer ur JSON från en webbläsare: det som inte är text är ingen kod.
  // Ett undantag räknas som fel här, i stället för att välta hela provet.
  const kodAv = (v) => {
    try {
      return normaliseraKod(v);
    } catch {
      return "kastade";
    }
  };
  ok(
    "allt som inte är en sträng ger null, inte ett undantag",
    [undefined, null, 12345678, {}, ["K7M4QX9P"]].every((v) => kodAv(v) === null),
  );

  // Det som visas på TV:n ska gå att skriva in igen.
  const slumpade = Array.from({ length: 200 }, () => nyKod());
  const tillbaka = (k, f = (v) => v) => normaliseraKod(f(visaKod(k))) === k;
  ok("en visad kod går att skriva in igen", slumpade.every((k) => tillbaka(k)));
  ok("och med små bokstäver", slumpade.every((k) => tillbaka(k, (v) => v.toLowerCase())));
}

// -----------------------------------------------------------------------------
console.log("\nVisningen");
{
  ok("K7M4QX9P visas som K7M4-QX9P", visaKod("K7M4QX9P") === "K7M4-QX9P", visaKod("K7M4QX9P"));

  const form = new RegExp(`^[${KODALFABET}]{4}-[${KODALFABET}]{4}$`);
  const visade = Array.from({ length: 100 }, () => visaKod(nyKod()));
  ok("en ny kod visas som fyra tecken, streck och fyra", visade.every((v) => form.test(v)));
}

// -----------------------------------------------------------------------------
console.log("\nTokenen");
{
  const t = nyToken();
  ok("43 tecken", t.length === 43, String(t.length));
  ok("bara base64url, utan fyllnad", /^[A-Za-z0-9_-]+$/.test(t), t);
  ok("32 byte när den avkodas", Buffer.from(t, "base64url").length === 32);

  const tokens = Array.from({ length: 200 }, () => nyToken());
  const form = /^[A-Za-z0-9_-]{43}$/;
  ok("tvåhundra tokens har alla rätt längd och form", tokens.every((x) => form.test(x)));
  ok("och är tvåhundra olika", new Set(tokens).size === 200, String(new Set(tokens).size));
}

// -----------------------------------------------------------------------------
console.log("\nHashen");
{
  // Facit från utsidan (shasum -a 256), inte ur den egna koden.
  ok(
    'sha256 av "a" är facit',
    hasha("a") === "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
    hasha("a"),
  );
  ok(
    'sha256 av "abc" är facit',
    hasha("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  ok(
    "sha256 av tomma strängen är facit",
    hasha("") === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );

  const t = nyToken();
  ok("hashen är 64 små hextecken", /^[0-9a-f]{64}$/.test(hasha(t)), hasha(t));
  ok("samma token ger samma hash", hasha(t) === hasha(t));
  ok("en annan token ger en annan hash", hasha(t) !== hasha(nyToken()));
}

console.log(fel === 0 ? "\n\x1b[32mAllt grönt.\x1b[0m\n" : `\n\x1b[31m${fel} fel.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
