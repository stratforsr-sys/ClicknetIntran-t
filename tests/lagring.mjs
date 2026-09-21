#!/usr/bin/env node
/**
 * Lagringsvalet (0065). Fem saker star pa spel:
 *
 *   1. RADEN AVGOR VAR EN FIL LIGGER, INTE MILJON. Bada lagringarna ar i bruk
 *      samtidigt — 1 693 gamla filer i Supabase, nya i R2 — och en fil som
 *      slas upp i fel lagring gar inte att oppna. Att lata "R2 ar pa" betyda
 *      "filen ligger i R2" ar sant for de nya och falskt for alla andra.
 *   2. EN RAD SOM INTE SAGER NAGOT BETYDER SUPABASE. Samma default som i 0065,
 *      och det ar dar allt som fanns fore kolumnen faktiskt ligger. En lasning
 *      som glomt `store` ska slas upp dar de flesta filer ar, inte kasta.
 *   3. HALVT UPPSATT R2 AR AVSTANGT. En endpoint utan nyckel ger inte en halv
 *      uppladdning utan ett fel per samtal, och ljudet finns inte kvar att
 *      hamta igen. Tre av fyra varden racker inte.
 *   4. BUCKETNAMNET FOR SUPABASE AR `filer` OCH KOMMER INTE UR MILJON. Bucketen
 *      heter sa sedan 0022; hamtas den ur `R2_BUCKET` skulle en andring av den
 *      variabeln gora alla gamla filer ooppningsbara.
 *   5. ETT SVENSKT FILNAMN OVERLEVER ETT HTTP-HUVUD. Supabase-klienten kodar
 *      sjalv, R2 signeras med ett fardigt huvud — och "Lakarintyg Hasselby.pdf"
 *      med riktiga prickar ar inte latin-1.
 *
 *   node --experimental-strip-types tests/lagring.mjs
 */
import {
  bucketFor,
  lagerForNyInspelning,
  nedladdningshuvud,
  r2Konfigurerad,
  tolkaLager,
} from "../src/lib/lagring.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(
    `  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`,
  );
  if (!villkor) fel++;
};

const full = {
  endpoint: "https://konto.eu.r2.cloudflarestorage.com",
  bucket: "clicknet-nav-inspelningar",
  nyckelId: "abc",
  hemlighet: "hemligt",
};

console.log("\n1. Raden avgor — tolkaLager()");
ok("'r2' ger r2", tolkaLager("r2") === "r2");
ok("'supabase' ger supabase", tolkaLager("supabase") === "supabase");
ok("undefined ger supabase", tolkaLager(undefined) === "supabase");
ok("null ger supabase", tolkaLager(null) === "supabase");
ok("okant varde ger supabase", tolkaLager("s3") === "supabase");
ok("tom strang ger supabase", tolkaLager("") === "supabase");
ok("versaler ar INTE r2", tolkaLager("R2") === "supabase", "check-villkoret i 0065 skriver gemener");

console.log("\n2. Halvt uppsatt R2 ar avstangt — r2Konfigurerad()");
ok("alla fyra ger true", r2Konfigurerad(full) === true);
for (const saknas of ["endpoint", "bucket", "nyckelId", "hemlighet"]) {
  const delvis = { ...full, [saknas]: undefined };
  ok(`utan ${saknas} ar det avstangt`, r2Konfigurerad(delvis) === false);
  ok(`tom ${saknas} ar ocksa avstangt`, r2Konfigurerad({ ...full, [saknas]: "" }) === false);
  ok(`bara blanksteg i ${saknas} ar avstangt`, r2Konfigurerad({ ...full, [saknas]: "   " }) === false);
}
ok("tomt objekt ar avstangt", r2Konfigurerad({}) === false);

console.log("\n3. Vart nasta inspelning skrivs — lagerForNyInspelning()");
ok("uppsatt R2 ger r2", lagerForNyInspelning(full) === "r2");
ok("avstangt ger supabase", lagerForNyInspelning({}) === "supabase");
ok(
  "halvt uppsatt ger supabase och inte ett fel",
  lagerForNyInspelning({ ...full, hemlighet: undefined }) === "supabase",
);

console.log("\n4. Bucketen — bucketFor()");
ok("supabase ar alltid 'filer'", bucketFor("supabase", "nagot-annat") === "filer");
ok("supabase ar 'filer' aven utan R2_BUCKET", bucketFor("supabase", undefined) === "filer");
ok("r2 tar namnet ur miljon", bucketFor("r2", "clicknet-nav-inspelningar") === "clicknet-nav-inspelningar");
ok("r2 trimmar", bucketFor("r2", "  spar  ") === "spar");
let kastade = false;
try {
  bucketFor("r2", undefined);
} catch {
  kastade = true;
}
ok("r2 utan bucketnamn kastar i stallet for att gissa", kastade);

console.log("\n5. Filnamnet i huvudet — nedladdningshuvud()");
const svenskt = nedladdningshuvud("Läkarintyg Hässelby.pdf");
ok("bar attachment", svenskt.startsWith("attachment;"));
ok("prickarna ar procentkodade i filename*", svenskt.includes("filename*=UTF-8''"));
ok(
  "asciidelen bar inga prickar",
  /filename="[\x20-\x7e]*"/.test(svenskt) && !/filename="[^"]*[åäöÅÄÖ]/.test(svenskt),
);
ok("procentkodningen gar att vanda", decodeURIComponent(svenskt.split("''")[1]) === "Läkarintyg Hässelby.pdf");

// Ett citattecken i filnamnet skulle annars avsluta `filename="..."` och gora
// resten av huvudet till nagot annat an ett filnamn.
const fult = nedladdningshuvud('en"fil\\.pdf');
ok("citattecken bryter inte huvudet", (fult.match(/"/g) || []).length === 2, fult);

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m\n` : "\n\x1b[32mAllt gront\x1b[0m\n");
process.exit(fel ? 1 : 0);
