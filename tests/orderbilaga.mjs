#!/usr/bin/env node
/**
 * Utlasningen ur en uppladdad avtals-PDF (E13 steg 9, O14).
 *
 * Det som provas ar inte att den hittar mycket, utan att den HELLRE LAMNAR
 * TOMT AN GISSAR. Ordern bar ett provisionsbelopp som fryses och betalas ut,
 * sa ett falt som ser ifyllt ut men ar fel kostar pengar:
 *
 *   1. TVA OLIKA VARDEN GER TOMT. Ett avtal bar bade kundens och vart eget
 *      bolagsnamn. Fylls kundens plats med vart namn syns det aldrig.
 *   2. BARA ISO-DATUM. "05/08/26" gar inte att tolka, och datumet styr vilken
 *      MANAD nagon far betalt.
 *   3. ORGNUMMER KRAVER BINDESTRECK. Tio siffror i rad ar lika garna ett
 *      telefonnummer.
 *   4. KONTAKTPERSON KRAVER LEDTEXT. Utan den blir vilket egennamn som helst
 *      kundens kontakt.
 *   5. INGET SPARAS. Funktionen returnerar ett forslag med sin kalla — vad
 *      anroparen gor med det ar sidans sak, och sidan forifyller ett formular.
 *
 *   node --experimental-strip-types tests/orderbilaga.mjs
 */
import { antalIfyllda, tolkaAvtalstext } from "../src/lib/orderbilaga.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(
    `  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`,
  );
  if (!villkor) fel++;
};

const AVTAL = `
AVTAL OM DIGITAL NARVARO

Kund: Nordvik Bygg AB
Organisationsnummer: 556677-8899
Kontaktperson: Lena Sjoberg
Telefon: 070-123 45 67

Tjanst: Paket 2
Avtalstid: 24 manader fran startdatum

Ort och datum: Goteborg 2026-08-15
`;

console.log("\nEtt vanligt avtal");
{
  const f = tolkaAvtalstext(AVTAL);

  ok("bolagsnamnet", f.company_name?.varde === "Nordvik Bygg AB", f.company_name?.varde);
  ok("organisationsnumret", f.org_number?.varde === "556677-8899", f.org_number?.varde);
  ok("kontaktpersonen", f.contact_name?.varde === "Lena Sjoberg", f.contact_name?.varde);
  ok("telefonnumret normaliseras", f.phone?.varde === "0701234567", f.phone?.varde);
  ok("paketet", f.package_id?.varde === "2", f.package_id?.varde);
  ok("loptiden", f.term_months?.varde === "24", f.term_months?.varde);
  ok("signeringsdatumet", f.signed_on?.varde === "2026-08-15", f.signed_on?.varde);
  ok("alla sju falt", antalIfyllda(f) === 7, `${antalIfyllda(f)}`);
}

console.log("\nVarje forslag bar sin kalla");
{
  const f = tolkaAvtalstext(AVTAL);
  ok("kallan visar var i texten svaret kom ifran", (f.org_number?.kalla ?? "").includes("556677-8899"));
  ok("och den ar kort nog att visa", (f.org_number?.kalla ?? "").length < 130);
}

console.log("\nTva olika varden ger TOMT, inte det forsta");
{
  // Vart eget bolag star ocksa i avtalet. Fylls kundens plats med vart namn
  // syns det aldrig — orderraden ser komplett ut.
  const tva = AVTAL + "\nLeverantor: Clicknet Sverige AB\n";
  const f = tolkaAvtalstext(tva);
  ok("bolagsnamnet lamnas tomt", f.company_name === undefined);
  ok("men orgnumret star kvar — det finns bara ett", f.org_number?.varde === "556677-8899");

  const tvaDatum = AVTAL + "\nBetalningsvillkor gäller från 2026-09-01.\n";
  ok("tva olika datum ger tomt", tolkaAvtalstext(tvaDatum).signed_on === undefined);

  // Samma varde flera ganger ar inget problem: en mall upprepar sidhuvudet.
  const upprepat = AVTAL + "\nNordvik Bygg AB, sidan 2\n";
  ok(
    "samma bolagsnamn tva ganger gar bra",
    tolkaAvtalstext(upprepat).company_name?.varde === "Nordvik Bygg AB",
  );
}

console.log("\nDatum: bara ISO");
{
  ok("15/8-26 lases inte", tolkaAvtalstext("Datum: 15/8-26").signed_on === undefined);
  ok(
    "15 augusti 2026 lases inte",
    tolkaAvtalstext("Datum: 15 augusti 2026").signed_on === undefined,
  );
  ok("2026-13-01 ar inget datum", tolkaAvtalstext("2026-13-01").signed_on === undefined);
  ok("2026-02-30 slapps igenom", tolkaAvtalstext("2026-02-30").signed_on?.varde === "2026-02-30");
}

console.log("\nOrgnummer kraver bindestreck");
{
  ok(
    "tio siffror i rad lases inte",
    tolkaAvtalstext("Organisationsnummer 5566778899").org_number === undefined,
  );
  ok(
    "med bindestreck lases det",
    tolkaAvtalstext("Orgnr 556677-8899").org_number?.varde === "556677-8899",
  );
  // K27-undantaget i avsnitt 3.2: en enskild firma har personnummer som
  // organisationsnummer, och det gar inte att neka utan att neka en laglig
  // kund. Numret hamnar i ett formularfalt, inte i databasen.
  ok(
    "en enskild firmas nummer lases ocksa",
    tolkaAvtalstext("Orgnr 850101-1234").org_number?.varde === "850101-1234",
  );
}

console.log("\nKontaktperson kraver ledtext");
{
  ok(
    "ett egennamn utan ledtext blir ingen kontakt",
    tolkaAvtalstext("Undertecknat av Lena Sjoberg").contact_name === undefined,
  );
  ok(
    "med ledtext blir det det",
    tolkaAvtalstext("Kontakt: Lena Sjoberg").contact_name?.varde === "Lena Sjoberg",
  );

  // Nasta ledtext avslutar namnet. Blanksteg ar kollapsade nar monstret kors,
  // sa radbrytningen fore "Telefon:" finns inte langre — utan lookaheaden blir
  // ledtexten ett tredje namn.
  ok(
    "nasta ledtext ater inte upp namnet",
    tolkaAvtalstext("Kontaktperson: Lena Sjoberg Telefon: 070-123 45 67").contact_name?.varde ===
      "Lena Sjoberg",
    tolkaAvtalstext("Kontaktperson: Lena Sjoberg Telefon: 070-123 45 67").contact_name?.varde,
  );

  // `\w` ar ASCII i JavaScript, sa en ordgrans ligger mitt i "Åsa". Ett namn
  // med a-ring, a-umlaut eller o-umlaut far inte klippas av.
  ok(
    "namn med svenska tecken klipps inte",
    tolkaAvtalstext("Kontakt: Åsa Öberg Telefon: 070-123 45 67").contact_name?.varde ===
      "Åsa Öberg",
    tolkaAvtalstext("Kontakt: Åsa Öberg Telefon: 070-123 45 67").contact_name?.varde,
  );
}

console.log("\nPaket och loptid utanfor listan lases inte");
{
  ok("paket 4 finns inte", tolkaAvtalstext("Paket 4").package_id === undefined);
  ok("18 manader finns inte", tolkaAvtalstext("18 manader").term_months === undefined);
  ok("36 man lases", tolkaAvtalstext("36 mån").term_months?.varde === "36");
}

console.log("\nEn PDF utan textlager ger ett tomt forslag, inte ett fel");
{
  ok("null ger tomt", antalIfyllda(tolkaAvtalstext(null)) === 0);
  ok("tom strang ger tomt", antalIfyllda(tolkaAvtalstext("")) === 0);
  ok("brus ger tomt", antalIfyllda(tolkaAvtalstext("%PDF-1.4 ���")) === 0);
}

console.log("\nRadbrytningar och sonderdelade ord");
{
  // pdfjs delar ofta ett ord i flera bitar, och `sammanfogaSidor` fogar dem
  // med mellanslag. Ett monster som kraver exakta avstand hade traffat pa ett
  // dokument och missat pa nasta.
  const styckigt = "Kund :  Nordvik   Bygg\nAB\nOrgnr :  556677 - 8899";
  const f = tolkaAvtalstext(styckigt);
  ok("bolagsnamnet over en radbrytning", f.company_name?.varde === "Nordvik Bygg AB", f.company_name?.varde);
  // Mellanslag runt bindestrecket ar INTE samma sak som ett bindestreck.
  // Hellre tomt an ett nummer som kanske ar tva.
  ok("orgnumret med mellanslag lases inte", f.org_number === undefined);
}

console.log(fel === 0 ? "\n\x1b[32mAllt gront.\x1b[0m\n" : `\n\x1b[31m${fel} fel.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
