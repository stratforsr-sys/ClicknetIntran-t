#!/usr/bin/env node
/**
 * Fillagringens rena regler. Ingen databas, ingen bucket.
 *
 *   node --experimental-strip-types tests/filer.mjs
 *
 * Det som provas mot riktiga databasen — RLS, oppningsloggen, den stangda
 * bucketen och att ett lakarintyg inte kan bara ett filnamn — ligger i
 * tests/rls.mjs. Har provas bara det som ar rakning och stranghantering.
 */
import {
  ANDAMAL_ETIKETT,
  MAX_BYTE,
  TILLATNA_TYPER,
  URL_SEKUNDER,
  bygStig,
  provaFil,
  storlek,
  visningsnamn,
} from "../src/lib/filer.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

rubrik("Vad som slapps in");
ok("en PDF gar igenom", provaFil("sick_certificate", { type: "application/pdf", size: 1000 }) === null);
ok("en telefonbild gar igenom", provaFil("sick_certificate", { type: "image/jpeg", size: 3_000_000 }) === null);
ok("en PNG gar igenom", provaFil("document_attachment", { type: "image/png", size: 500 }) === null);

// Storage sallar ocksa, och check-villkoret i 0022 en tredje gang. Det har
// lagret finns for att felet ska ga att lasa.
ok(
  "ett word-dokument nekas",
  provaFil("sick_certificate", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: 1000,
  })?.kod === "typ",
);
ok("en ljudfil nekas som intyg", provaFil("sick_certificate", { type: "audio/mpeg", size: 1000 })?.kod === "typ");
ok("men slapps in som rollspel", provaFil("roleplay", { type: "audio/mpeg", size: 1000 }) === null);
ok("och en PDF nekas som rollspel", provaFil("roleplay", { type: "application/pdf", size: 1000 })?.kod === "typ");
ok("en tom fil nekas", provaFil("sick_certificate", { type: "application/pdf", size: 0 })?.kod === "tom");
ok("en for stor fil nekas", provaFil("sick_certificate", { type: "application/pdf", size: MAX_BYTE.sick_certificate + 1 })?.kod === "storlek");
ok("exakt gransen slapps in", provaFil("sick_certificate", { type: "application/pdf", size: MAX_BYTE.sick_certificate }) === null);

// Webblasare skickar ibland med teckenuppsattning i content-type. Utan
// normaliseringen hade en giltig PDF nekats beroende pa vilken webblasare den
// kom fran, och felet hade varit omojligt att aterskapa.
ok(
  "teckenuppsattning i mime-typen stor inte",
  provaFil("sick_certificate", { type: "application/pdf; charset=binary", size: 10 }) === null,
);
ok(
  "versaler i mime-typen stor inte",
  provaFil("sick_certificate", { type: "IMAGE/JPEG", size: 10 }) === null,
);

ok("felet talar om vad som gar att lamna in", provaFil("sick_certificate", { type: "text/plain", size: 10 })?.text.includes("PDF"));

rubrik("K35: ett lakarintyg bar aldrig ett filnamn");
// Filnamnet ar text som anvandaren skrivit. "cancerbesked.pdf" ar en diagnos,
// och 0020 finns for att det inte ska ga att lagra en. Namnet raknas darfor
// fram ur datumet i stallet.
const intyg = {
  purpose: "sick_certificate",
  filename: null,
  mime_type: "application/pdf",
  uploaded_at: "2026-08-21T09:14:00.000Z",
};
ok("namnet raknas fram ur datumet", visningsnamn(intyg) === "Lakarintyg 2026-08-21.pdf");
ok(
  "ett filnamn som mot forvantan lagrats anvands inte anda",
  visningsnamn({ ...intyg, filename: "cancerbesked.pdf" }) === "Lakarintyg 2026-08-21.pdf",
);
ok("en bild far ratt andelse", visningsnamn({ ...intyg, mime_type: "image/jpeg" }) === "Lakarintyg 2026-08-21.jpg");
ok(
  "utan datum blir det inte 'undefined'",
  visningsnamn({ purpose: "sick_certificate", filename: null, mime_type: "application/pdf" }) ===
    "Lakarintyg utan datum.pdf",
);

ok(
  "en bilaga behaller sitt namn — den handlar inte om nagon",
  visningsnamn({ purpose: "document_attachment", filename: "Prislista 2026.pdf", mime_type: "application/pdf" }) ===
    "Prislista 2026.pdf",
);
// Ett rollspel ar den egna rosten, inte en uppgift om halsa. Namnet far folja
// med, och utan namn blir det en begriplig etikett i stallet for "Bilaga".
ok(
  "en inspelning utan namn far en begriplig etikett",
  visningsnamn({ purpose: "roleplay", filename: null, mime_type: "audio/mpeg" }) ===
    "Inspelat testsamtal.mp3",
);

rubrik("Sokvagen");
// Sokvagen syns i den signerade URL:en, alltsa i adressfaltet och i varje
// historik den hamnar i. Inget av det anvandaren skrivit far ligga dar.
const stig = bygStig("sick_certificate", "6f3f0c2e-1111-2222-3333-444455556666");
ok("sokvagen ar andamal och uuid", stig === "sick_certificate/6f3f0c2e-1111-2222-3333-444455556666");
ok("sokvagen bar inget filnamn", !stig.includes("."));

rubrik("Storlek i klartext");
ok("byte", storlek(512) === "512 B");
ok("kilobyte", storlek(4096) === "4 kB");
ok("megabyte med komma", storlek(1_500_000) === "1,4 MB");

rubrik("Konstanterna haller vad rubrikerna lovar");
ok("URL:en lever kort", URL_SEKUNDER <= 60, `${URL_SEKUNDER} s`);
ok("intygstaket ar 10 MB", MAX_BYTE.sick_certificate === 10 * 1024 * 1024);
// En kvart inspelat samtal i mp3 ar omkring fjorton megabyte. Med samma tak som
// for ett intyg hade halva rollspelen nekats vid inlamningen.
ok("inspelningar far vara storre", MAX_BYTE.roleplay > MAX_BYTE.sick_certificate, `${MAX_BYTE.roleplay / 1024 / 1024} MB`);
ok("bilagan har samma tak som intyget", MAX_BYTE.document_attachment === MAX_BYTE.sick_certificate);
ok("intyg och bilaga slapper in samma typer", TILLATNA_TYPER.sick_certificate.join() === TILLATNA_TYPER.document_attachment.join());
ok("rollspelet slapper bara in ljud", TILLATNA_TYPER.roleplay.every((t) => t.startsWith("audio/")));
// Video hade dragit in ansikten i en bedomning som handlar om vad nagon sager.
ok("och aldrig video", TILLATNA_TYPER.roleplay.every((t) => !t.startsWith("video/")));
ok("varje andamal har en etikett pa svenska", Object.keys(TILLATNA_TYPER).every((a) => Boolean(ANDAMAL_ETIKETT[a])));

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m" : `\n\x1b[31m${fel} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
