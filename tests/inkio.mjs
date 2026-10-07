#!/usr/bin/env node
/**
 * Nav-order → Inkios format (0074). Det som provas:
 *
 *   1. ORGANISATIONSNUMRET blir XXXXXX-XXXX, och en enskild firma (personnummer)
 *      känns igen — Bolagsverket i Inkio slår bara upp juridiska personer.
 *   2. PAKETET blir en löpande rad med månadsbeloppet och bindningstiden —
 *      inte ordervärdet, som Inkio räknar fram själv.
 *   3. EN TJÄNST UTAN MOTSVARIGHET hamnar på "Övrigt" med namnet som text, i
 *      stället för att tappas.
 *   4. NAV-ORDERNS ID står i `external_order_id`. Det är det som gör ett andra
 *      försök ofarligt.
 *   5. KONTAKTEN får alltid ett förnamn — Inkio nekar annars hela kunden.
 *   6. (0075) EN ENSKILD FIRMA blir "Sole Proprietorship", och adressen från
 *      ordern används bara när alla tre fälten finns.
 *   7. (0075) LEVERANSRADEN säger steg, vad som hände, när (svensk tid) och vem.
 *
 *   node --experimental-strip-types tests/inkio.mjs
 */
import {
  arJuridiskPerson,
  delaNamn,
  inkioBolagsform,
  inkioIdUr,
  leveransrad,
  orderadress,
  inkioOrgnr,
  nyKund,
  nyOrder,
  orderrader,
  overenskommet,
} from "../src/lib/crm/inkio-mappning.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

console.log("\nOrganisationsnummer");
ok("med bindestreck oförändrat", inkioOrgnr("559467-3682") === "559467-3682");
ok("utan bindestreck får ett", inkioOrgnr("5594673682") === "559467-3682");
ok("tolv siffror kortas", inkioOrgnr("16559467-3682") === "559467-3682");
ok("för kort blir null", inkioOrgnr("12345") === null);
ok("aktiebolag är juridisk person", arJuridiskPerson("559467-3682"));
ok("enskild firma (personnummer) är det inte", !arJuridiskPerson("740627-8882"));

console.log("\nNamn");
const n1 = delaNamn("Anna Maria Svensson");
ok("efternamnet är sista ordet", n1.first_name === "Anna Maria" && n1.last_name === "Svensson");
ok("ett ord blir förnamn", delaNamn("Timur").first_name === "Timur");
ok("tomt blir tomt", delaNamn(null).first_name === "");

console.log("\nKunden");
const adress = { address_line_1: "Kumla Vad 119", address_line_2: "", postal_code: "733 98", city: "RANSTA", country: "Sweden" };
const k = nyKund({ bolag: "Aros Lås AB", orgnr: "5594673682", kontakt: null, telefon: "+46701234567", epost: null }, adress, null);
ok("Company med Inkios orgnr-form", k.customer.customer_type === "Company" && k.customer.tax_id === "559467-3682");
ok("aktiebolag om Bolagsverket inte säger annat", k.customer.legal_form === "Limited Company");
ok("kontakten får bolagets namn när ordern saknar kontakt", k.contact.first_name === "Aros Lås AB");
ok("adressen följer med oförändrad", k.address.city === "RANSTA");

console.log("\nOrdern");
const underlag = {
  navId: "0b6f6c62-1111-4a4a-9c9c-000000000001",
  signerad: "2026-10-07",
  startar: "2026-10-15",
  manadsbelopp: 1495,
  bindningManader: 12,
  paketnamn: "Paket 2",
  utkop: 2500,
  anteckning: "Ring efter lunch",
  navlank: "https://clicknet-nav.vercel.app/order?kund=0b6f6c62-1111-4a4a-9c9c-000000000001",
  tjanster: [
    { namn: "Google My Business", fakturering: "manad", belopp: 200, manader: null },
    { namn: "Logotyp", fakturering: "engang", belopp: 3000, manader: null },
  ],
};
const tj = {
  kampanjsida: "svc-kampanj",
  ovrigt: "svc-ovrigt",
  efterNamn: (n) => (n === "Google My Business" ? "svc-gmb" : null),
};
const rader = orderrader(underlag, tj);
ok("tre rader", rader.length === 3, `fick ${rader.length}`);
ok("paketet: Kampanjsida, månadsbelopp, bindning", rader[0].service === "svc-kampanj" && rader[0].rate === 1495 && rader[0].term_length === 12 && rader[0].type === "Recurring");
ok("tjänst med samma namn: egen tjänst, bindning ärvs", rader[1].service === "svc-gmb" && rader[1].term_length === 12 && rader[1].description === undefined);
ok("tjänst utan motsvarighet i Inkio: Övrigt med namnet", rader[2].service === "svc-ovrigt" && rader[2].description === "Logotyp" && rader[2].type === "One Time");
ok("utan månadsbelopp ingen paketrad", orderrader({ ...underlag, manadsbelopp: null, tjanster: [] }, tj).length === 0);

const doc = nyOrder(underlag, "kund-1", null, rader);
ok("Nav-id i external_order_id", doc.external_order_id === underlag.navId);
ok("signeringen är orderdatum, starten leveransdatum", doc.order_date === "2026-10-07" && doc.delivery_date === "2026-10-15");
ok("utan säljare: tom sträng, inte null", doc.sales_person === "");
ok("länken och utköpet i anteckningen", doc.notes.includes(underlag.navlank) && doc.notes.includes("Utköp: 2500 kr."));

const avtalat = overenskommet(underlag, "Mick Corneliusson", "2026-10-07");
ok("överenskommet säger paket, belopp, bindning och godkännare", avtalat.includes("Paket 2") && avtalat.includes("/mån") && avtalat.includes("12 mån") && avtalat.includes("Mick Corneliusson"), avtalat);

console.log("\nEnskild firma och adress (0075)");
ok("enskild firma → Sole Proprietorship", inkioBolagsform("740627-8882", null) === "Sole Proprietorship");
ok("aktiebolag → Bolagsverkets form, annars Limited Company", inkioBolagsform("559467-3682", null) === "Limited Company");
ok("enskild firmas kund får rätt form", nyKund({ bolag: "IE Cleaning", orgnr: "740627-8882", kontakt: "Ida E", telefon: "070", epost: null }, adress, null).customer.legal_form === "Sole Proprietorship");
ok("adress med alla tre fälten", orderadress("Storgatan 1", "123 45", "Ort")?.city === "Ort");
ok("adress utan ort blir null", orderadress("Storgatan 1", "123 45", " ") === null);

console.log("\nLeveransens rader i Inkio (0075)");
const bokad = leveransrad({ steg: "valkomstsamtal", handelse: "bokad", startar: "2026-10-14T08:00:00Z", vem: "Zen Ali", forsok: 1 });
ok("bokad: steg, svensk tid och vem", bokad.includes("Välkomstsamtal bokat") && bokad.includes("10:00") && bokad.includes("Zen Ali"), bokad);
const ejsvar = leveransrad({ steg: "valkomstsamtal", handelse: "ej_svar", startar: "2026-10-14T08:00:00Z", vem: null, forsok: 2 });
ok("ej svar: försöket står med", ejsvar.includes("försök 2") && ejsvar.includes("svarade inte"), ejsvar);
ok("genomfört kickoff", leveransrad({ steg: "kickoff", handelse: "genomford", startar: "2026-10-14T08:00:00Z", vem: "Zen", forsok: 1 }).includes("Kickoff genomfört (Zen)"));
ok("inställt", leveransrad({ steg: "avstamning_30", handelse: "installd", startar: "2026-11-14T09:00:00Z", vem: null, forsok: 1 }).includes("Avstämning efter 30 dagar"));
ok("okänt steg blir Leveransmöte", leveransrad({ steg: null, handelse: "flyttad", startar: "2026-10-14T08:00:00Z", vem: null, forsok: 1 }).includes("Leveransmöte flyttat"));
ok("raden säger varifrån den kom", bokad.startsWith("Leverans · ") && bokad.endsWith("Clicknet Nav"));

console.log("\nInklistrat id");
ok("ur adressen", inkioIdUr("https://crm.inkio.se/customers/01a10ffe-dbea-733f-a228-65b245b7448b") === "01a10ffe-dbea-733f-a228-65b245b7448b");
ok("skräp ger null", inkioIdUr("LC-10490") === null);

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m\n` : "\n\x1b[32mAlla prov gick igenom\x1b[0m\n");
process.exit(fel ? 1 : 0);
