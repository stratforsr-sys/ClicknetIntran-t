#!/usr/bin/env node
/**
 * Nav-order → Inkios format (0074). Det som provas:
 *
 *   1. ORGANISATIONSNUMRET blir XXXXXX-XXXX, och en enskild firma (personnummer)
 *      känns igen — Bolagsverket i Inkio slår bara upp juridiska personer.
 *   2. PAKETET blir en löpande rad med månadsbeloppet och bindningstiden, och
 *      ordern får hela värdet och längden i huvudet (`order_value`,
 *      `term_months`) och hur den faktureras (intern månadsvis, en egen plan
 *      med engångsbeloppet först, eller finansierad) — Inkio nekar sedan
 *      2026-10 en order utan dem.
 *   3. EN TJÄNST UTAN MOTSVARIGHET hamnar på "Övrigt" med namnet som text, i
 *      stället för att tappas.
 *   4. NAV-ORDERNS ID står i `external_order_id`. Det är det som gör ett andra
 *      försök ofarligt.
 *   5. KONTAKTEN får alltid ett förnamn — Inkio nekar annars hela kunden.
 *   6. (0075) EN ENSKILD FIRMA blir "Sole Proprietorship", och adressen från
 *      ordern används bara när alla tre fälten finns.
 *   7. (0075) LEVERANSRADEN säger steg, vad som hände, när (svensk tid) och vem.
 *   8. (varv 4) LANDNINGSSIDAN: kundens webbplats blir en adress Nav kan
 *      anropa — men aldrig en IP-adress eller ett internt namn — och svaret
 *      blir aktiv eller inte aktiv med ett ord om varför.
 *
 *   node --experimental-strip-types tests/inkio.mjs
 */
import {
  aktivitetsdelar,
  aktivitetstext,
  arJuridiskPerson,
  delaNamn,
  inkioBolagsform,
  inkioIdUr,
  leveransrad,
  orderadress,
  inkioOrgnr,
  landningsadress,
  nyKund,
  nyOrder,
  orderrader,
  ordervarde,
  avtalsmanader,
  fakturering,
  plusManader,
  overenskommet,
  sakerAdress,
  sidlage,
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
// 1 495 × 12 + 200 × 12 + 3 000 en gång. Utköpet är inte ordervärde.
ok("ordervärdet är radernas summa över löptiden", doc.order_value === 23340, `fick ${doc.order_value}`);
ok("längden är bindningstiden", doc.term_months === 12);
ok("bara paketet: 1 495 kr i tolv månader är 17 940", ordervarde(orderrader({ ...underlag, tjanster: [] }, tj)) === 17940);
ok("öresbelopp avrundas till ören", ordervarde([{ ...rader[0], rate: 1038.75 }]) === 12465);

console.log("\nFaktureringen (Inkio kräver valet sedan 2026-10)");
const paketet = orderrader({ ...underlag, tjanster: [] }, tj);
const vanlig = nyOrder({ ...underlag, tjanster: [] }, "kund-1", null, paketet);
ok("vanlig order: intern, månadsvis, 15 dagar", vanlig.invoicing === "Internal" && vanlig.invoice_schedule === "Monthly" && vanlig.payment_terms_days === 15);
ok("månadsvis: ingen egen plan, inget finansbolag", vanlig.invoice_plan.length === 0 && vanlig.financing_company === null);
ok("månadsvis delar värdet i precis månadsbeloppet", vanlig.order_value / vanlig.term_months === 1495);
ok("anteckningen säger att faktureringen är Navs förval", vanlig.notes.includes("intern, månadsvis, 15 dagar (Navs förval)"));

ok("med engångsbelopp: egen plan", doc.invoicing === "Internal" && doc.invoice_schedule === "Custom" && doc.payment_terms_days === 15);
ok("en faktura i månaden under avtalet", doc.invoice_plan.length === 12, `fick ${doc.invoice_plan.length}`);
ok("engångsbeloppet ligger på den första", doc.invoice_plan[0].amount === 1495 + 200 + 3000 && doc.invoice_plan[1].amount === 1695);
ok("planen börjar på leveransdagen och slutar inom avtalet", doc.invoice_plan[0].invoice_date === "2026-10-15" && doc.invoice_plan[11].invoice_date === "2027-09-15");
const planOre = doc.invoice_plan.reduce((s, f) => s + Math.round(f.amount * 100), 0);
ok("planen summerar exakt till ordervärdet", planOre === Math.round(doc.order_value * 100), `${planOre} mot ${doc.order_value}`);

const langre = { ...underlag, tjanster: [{ namn: "Google My Business", fakturering: "manad", belopp: 200, manader: 24 }] };
const langreRader = orderrader(langre, tj);
const langreDoc = nyOrder(langre, "kund-1", null, langreRader);
ok("en tjänst som löper längre förlänger avtalet", avtalsmanader(langre, langreRader) === 24 && langreDoc.term_months === 24);
ok("efter bindningstiden faktureras bara tjänsten", langreDoc.invoice_plan.length === 24 && langreDoc.invoice_plan[12].amount === 200 && langreDoc.invoice_plan[11].amount === 1695);
ok("och planen summerar ändå till värdet", langreDoc.invoice_plan.reduce((s, f) => s + Math.round(f.amount * 100), 0) === Math.round(langreDoc.order_value * 100));

const fin = nyOrder({ ...underlag, tjanster: [], finansierad: true }, "kund-1", null, paketet, "Novo");
ok("finansierad: finansbolaget och inget annat", fin.invoicing === "Financed" && fin.financing_company === "Novo" && fin.invoice_schedule === null && fin.payment_terms_days === null && fin.invoice_plan.length === 0);
ok("finansierad: anteckningen säger vilket bolag", fin.notes.includes("finansierad via Novo"));
let kastade = false;
try {
  fakturering({ ...underlag, finansierad: true }, paketet, null);
} catch {
  kastade = true;
}
ok("finansierad utan finansbolag stoppas i Nav, inte i Inkio", kastade);

ok("31 januari plus en månad är sista februari", plusManader("2026-01-31", 1) === "2026-02-28" && plusManader("2028-01-31", 1) === "2028-02-29");
ok("över årsskiftet", plusManader("2026-10-15", 11) === "2027-09-15");

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

console.log("\nKundens aktivitet (Inkio, varv 3)");
const svensk = aktivitetstext(
  "Dennis D submitted order #[SO-2026-00006](ref:Sales Order/01a1) (1 000,00 kr)",
  "{0} submitted order {1} ({2})",
  '["Dennis D", "#[SO-2026-00006](ref:Sales Order/01a1)", "1 000,00 kr"]',
);
ok("känd mall blir svenska", svensk === "Dennis D skickade in order #[SO-2026-00006](ref:Sales Order/01a1) (1 000,00 kr)", svensk);
ok("okänd mall visas som Inkio skrev den", aktivitetstext("Invoice 12 was paid", "Invoice {0} was paid", '["12"]') === "Invoice 12 was paid");
ok("trasiga argument ger originaltexten", aktivitetstext("x", "{0} created customer {1}", "inte json") === "x");
const delar = aktivitetsdelar(svensk, "https://crm.inkio.se");
ok("hänvisningen blir en länk till Inkio", delar[1]?.lank === "https://crm.inkio.se/sales-orders/01a1" && delar[1]?.text === "SO-2026-00006");
ok("texten runt omkring står kvar", delar[0].text === "Dennis D skickade in order " && delar[2].text === " (1 000,00 kr)");
ok("okänd posttyp blir bara etiketten", aktivitetsdelar("se #[X-1](ref:Okand/9)", "b")[1]?.lank === undefined);
ok("anteckning med radbrytning orörd", aktivitetsdelar("rad ett\nrad två", "b")[0].text === "rad ett\nrad två");

console.log("\nInklistrat id");
ok("ur adressen", inkioIdUr("https://crm.inkio.se/customers/01a10ffe-dbea-733f-a228-65b245b7448b") === "01a10ffe-dbea-733f-a228-65b245b7448b");
ok("skräp ger null", inkioIdUr("LC-10490") === null);

console.log("\nLandningssidan (varv 4)");
ok("domän utan schema får https", landningsadress("mmgrav.se") === "https://mmgrav.se/");
ok("full adress med sökväg står kvar", landningsadress(" https://www.mmgrav.se/kampanj ") === "https://www.mmgrav.se/kampanj");
ok("http står kvar", landningsadress("http://exempel.se") === "http://exempel.se/");
ok("tomt och null ger null", landningsadress("") === null && landningsadress(null) === null);
ok("skräp ger null", landningsadress(".") === null && landningsadress("ingen sida") === null && landningsadress("se") === null);
ok("IP-adress nekas", landningsadress("127.0.0.1") === null && landningsadress("http://10.0.0.5/x") === null);
ok("IP som tal nekas", landningsadress("http://2130706433") === null);
ok("IPv6 nekas", landningsadress("http://[::1]/") === null);
ok("localhost och interna namn nekas", landningsadress("localhost") === null && landningsadress("db.internal") === null && landningsadress("server.local") === null);
ok("annan port nekas", landningsadress("exempel.se:8080") === null);
ok("inloggning i adressen nekas", landningsadress("https://a:b@exempel.se") === null);
ok("annat schema nekas", landningsadress("ftp://exempel.se") === null && landningsadress("javascript://exempel.se") === null);
ok("svensk domän blir punycode", /^https:\/\/xn--[a-z0-9-]+\.se\/$/.test(String(landningsadress("grävtjänst.se"))), String(landningsadress("grävtjänst.se")));
ok("vidarekoppling till intern adress nekas", !sakerAdress(new URL("http://169.254.169.254/latest")));
ok("200 är aktiv", sidlage(200).aktiv);
ok("403 bakom skydd är aktiv", sidlage(403).aktiv && sidlage(403).text.includes("403"));
ok("404 är inte aktiv", !sidlage(404).aktiv && sidlage(404).text.includes("finns inte"));
ok("500 är inte aktiv", !sidlage(503).aktiv && sidlage(503).text.includes("503"));
ok("slinga är inte aktiv", !sidlage(310).aktiv);
ok("inget svar är inte aktiv, med orsaken", !sidlage(null, "X").aktiv && sidlage(null, "X").text === "X");

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m\n` : "\n\x1b[32mAlla prov gick igenom\x1b[0m\n");
process.exit(fel ? 1 : 0);
