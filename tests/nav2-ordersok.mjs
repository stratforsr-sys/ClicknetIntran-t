#!/usr/bin/env node
/**
 * Ordersökningen i Nav 2.0 (2026-11-11): sök på allt på ordern.
 *
 * Beställaren: "i order ska jag kunna söka upp ordrar på orgnummer,
 * telefonnummer eller fakturanummer … Gör sökningen ordentligt så att man kan
 * söka på typ allting."
 *
 * Två delar provas:
 *
 * - **servern:** `formaNummer` (src/lib/nav2/ordersok.ts) gör kundens poster i
 *   Inkio-bevakningens kopia (`crm_handelse`) till sökbara nummer: fakturor,
 *   avtal, Inkio-order och ärenden.
 * - **webbläsaren:** sökningens rena del i utkastet (blocket `ordersok`) plockas
 *   ur src/nav2/utkast.html och körs: siffror i alla format, flera ord, var
 *   träffen sitter, org.nr på en del av numret (även en enskild firmas), och
 *   K27: ett nummer hamnar aldrig i en länk.
 *
 *   node --experimental-strip-types tests/nav2-ordersok.mjs
 */
import { readFileSync } from "node:fs";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const rot = new URL("../", import.meta.url);
const las = (p) => readFileSync(new URL(p, rot), "utf8");

// ---------------------------------------------------------------------------
// Servern: kundens nummer ur Inkio-bevakningens kopia
// ---------------------------------------------------------------------------
rubrik("Kundens nummer ur Inkio (formaNummer)");
let formaNummer = null;
try {
  ({ formaNummer } = await import(new URL("src/lib/nav2/ordersok.ts", rot).href));
} catch (e) {
  ok("src/lib/nav2/ordersok.ts finns", false, e.message.split("\n")[0]);
}
if (formaNummer) {
  const rad = (o) => ({ org_number: "559512-3456", slag: "post", skapad: "2026-11-01T00:00:00Z", om_titel: null, om_nummer: null, data: null, ...o });
  const rader = [
    rad({ om_typ: "Invoice", om_titel: "1158", skapad: "2026-12-09T00:00:00Z", data: { invoice_number: "1158", total: 7463, due_date: "2026-12-19", status: "Sent", is_credit_note: false } }),
    rad({ om_typ: "Invoice", slag: "aktivitet", om_titel: "1158", skapad: "2026-12-10T08:00:00Z", data: { route: "/invoices/x" } }),
    rad({ om_typ: "Invoice", slag: "anteckning", om_titel: "1158", skapad: "2026-12-11T08:00:00Z", data: { roll: "Administratör" } }),
    rad({ om_typ: "Invoice", om_titel: "1201", data: { invoice_number: "1201", total: -1495, due_date: null, status: "Paid", is_credit_note: true } }),
    rad({ om_typ: "Contract", om_titel: "Optimerad Kampanjsida", om_nummer: "CTR-2026-00096", data: { status: "Active" } }),
    rad({ om_typ: "Sales Order", om_titel: "Optimerad Kampanjsida 24 mån", om_nummer: "SO-2026-00104", data: { status: "Confirmed" } }),
    // Ett samtal om samma order: nyare, utan läge. Läget står kvar.
    rad({ om_typ: "Sales Order", om_titel: "Optimerad Kampanjsida 24 mån", om_nummer: "SO-2026-00104", skapad: "2026-11-05T00:00:00Z", data: { status: null } }),
    rad({ om_typ: "Ticket", slag: "anteckning", om_titel: "Byt bild", om_nummer: "TKT-2026-00005" }),
    rad({ om_typ: "Customer", slag: "aktivitet" }),
    rad({ org_number: "5594001122", om_typ: "Invoice", om_titel: "1300", data: { invoice_number: "1300", total: 2985, due_date: "2026-11-30", status: "Overdue" } }),
  ];
  const n = formaNummer(rader);
  const a = n["559512-3456"] ?? [];
  const f = a.find((x) => x.nr === "1158");
  ok("fakturan blir ett nummer", f?.etikett === "Faktura", JSON.stringify(f));
  ok("en faktura med tre poster blir en rad", a.filter((x) => x.nr === "1158").length === 1);
  ok("belopp, förfallodag och läge ur fakturans post", f?.belopp === 7463 && f?.datum === "2026-12-19" && f?.status === "Skickad", JSON.stringify(f));
  ok("kreditfakturan heter så", a.find((x) => x.nr === "1201")?.etikett === "Kreditfaktura");
  const av = a.find((x) => x.nr === "CTR-2026-00096");
  ok("avtalet med tjänsten och läget", av?.etikett === "Avtal" && av?.titel === "Optimerad Kampanjsida" && av?.status === "Aktiv", JSON.stringify(av));
  const so = a.find((x) => x.nr === "SO-2026-00104");
  ok("Inkio-ordern, och läget står kvar när en nyare post saknar det", so?.etikett === "Order i Inkio" && so?.titel === "Optimerad Kampanjsida 24 mån" && so?.status === "Bekräftad", JSON.stringify(so));
  ok("ärendet", a.find((x) => x.nr === "TKT-2026-00005")?.etikett === "Ärende");
  ok("fakturorna först, nyast först, sedan avtal, order och ärenden", a.map((x) => x.nr).join() === "1158,1201,CTR-2026-00096,SO-2026-00104,TKT-2026-00005", a.map((x) => x.nr).join());
  ok("org.nr skrivs som i Nav", n["559400-1122"]?.[0]?.nr === "1300", Object.keys(n).join(", "));
  ok("ett okänt läge står som Inkio skriver det", formaNummer([rad({ om_typ: "Invoice", om_titel: "9", data: { invoice_number: "9", status: "Booked" } })])["559512-3456"]?.[0]?.status === "Booked");
  ok("inga rader, inga nummer", Object.keys(formaNummer([])).length === 0);
}

// ---------------------------------------------------------------------------
// Webbläsaren: blocket `ordersok` i utkastet
// ---------------------------------------------------------------------------
const html = readFileSync(process.env.UTKAST ?? new URL("src/nav2/utkast.html", rot), "utf8");
const a0 = html.indexOf("/* ordersok: start");
const b0 = html.indexOf("/* ordersok: slut */");
if (a0 < 0 || b0 < 0) {
  ok("blocket ordersok finns i utkastet", false);
  console.log(`\n\x1b[31m${fel} fel\x1b[0m`);
  process.exit(1);
}
// Samma som utkastets oQnorm; OPAKET är utkastets paket.
const oQnorm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const OPAKET = { 1: { l: "Optimerad Kampanjsida", pris: 1495 } };
const K = new Function(
  "oQnorm",
  "OPAKET",
  `${html.slice(a0, b0)}; return { oSiffror, oSokKanslig, oSokTermer, oSokTraff, oSokSpannText };`,
)(oQnorm, OPAKET);

const ab = {
  nr: 29, bolag: "Hedboms Bygg AB", kontakt: "Matias Hedbom", ort: "Malmö", vem: "Fredrik Olsson",
  org: "559512-3456", tel: "070-123 45 67", mejl: "info@hedboms.se", adress: "Storgatan 12", postnr: "211 22",
  p: 1, tj: [["Extra annons", "manad", 495, true, null]], note: "Ring före tio.", fri: null, mak: null,
  ndInkio: { kundnummer: "K-1042", ordernummer: "SO-2026-00104" },
  nummer: [
    { etikett: "Faktura", nr: "1158", belopp: 7463, datum: "2026-12-19", status: "Skickad", titel: null },
    { etikett: "Avtal", nr: "CTR-2026-00096", belopp: null, datum: null, status: "Aktiv", titel: "Optimerad Kampanjsida" },
  ],
};
const ef = { ...ab, nr: 30, bolag: "Annas Hårvård", kontakt: "Anna Berg", ort: "Lund", org: "850101-1234", tel: "+46 70 987 65 43", mejl: "anna@harvard.se", ndInkio: null, nummer: [] };
const sok = (o, q) => K.oSokTraff(o, K.oSokTermer(q));
const traff = (o, q, nyckel) => (sok(o, q) || []).some((h) => h.nyckel === nyckel);
const traffE = (o, q, etikett) => (sok(o, q) || []).some((h) => h.etikett === etikett);

rubrik("Siffror i alla format");
ok("streck och mellanslag", K.oSiffror("070-123 45 67") === "0701234567");
ok("+46 blir 0", K.oSiffror("+46 70 123 45 67") === "0701234567");
ok("0046 blir 0", K.oSiffror("0046701234567") === "0701234567");
ok("+46 (0)70 blir 0", K.oSiffror("+46 (0)70-123 45 67") === "0701234567", K.oSiffror("+46 (0)70-123 45 67"));
ok("46 utan plus, elva siffror, blir 0", K.oSiffror("46701234567") === "0701234567");
ok("org.nr utan streck", K.oSiffror("559512-3456") === "5595123456");

rubrik("Telefon");
for (const q of ["0701234567", "070-123 45 67", "070 123 45 67", "+46701234567", "+46 70 123 45 67", "1234567"]) ok(`"${q}" hittar telefonen`, traff(ab, q, "tel"));
ok("lagrat med +46 hittas med 07…", traff(ef, "0709876543", "tel"));
ok("två siffror räcker inte för telefonen", !traff(ab, "45", "tel"));

rubrik("Org.nr");
for (const q of ["559512-3456", "5595123456", "165595123456", "559512"]) ok(`"${q}" hittar aktiebolagets org.nr`, traff(ab, q, "org"));
for (const q of ["850101-1234", "8501011234", "19850101-1234", "198501011234"]) ok(`hela numret "${q}" hittar den enskilda firman`, traff(ef, q, "org"));
for (const q of ["850101", "8501011", "0101-1234", "1234", "85010112"]) ok(`en del av den enskilda firmans org.nr, "${q}", hittar den`, traff(ef, q, "org"));
ok("två siffror räcker inte för ett org.nr", !traff(ab, "55", "org") && !traff(ef, "85", "org"));
const tp = (sok(ef, "0101-1234") || []).find((h) => h.nyckel === "org");
ok("delen markeras i den enskilda firmans org.nr", !!tp && tp.varde.slice(tp.spann[0], tp.spann[1]) === "0101-1234", JSON.stringify(tp));

rubrik("Inkios nummer");
ok("fakturanumret", traffE(ab, "1158", "Faktura"));
ok("avtalsnumret, med och utan streck, och slutet", traffE(ab, "CTR-2026-00096", "Avtal") && traffE(ab, "ctr202600096", "Avtal") && traffE(ab, "00096", "Avtal"));
ok("Inkio-ordern på ordern själv", traffE(ab, "SO-2026-00104", "Order i Inkio"));
ok("Inkios kundnummer", traffE(ab, "K-1042", "Kund i Inkio"));
ok("två tecken räcker inte för ett Inkio-nummer", !traffE(ab, "11", "Faktura"));
ok("fakturans läge och belopp söks inte", !traffE(ab, "skickad", "Faktura") && !traffE(ab, "7463", "Faktura"));

rubrik("Ordern själv");
ok("ordernumret med #", traff(ab, "#29", "nr"));
ok("ordernumret börjar med siffrorna", traff(ab, "2", "nr") && !traff(ab, "9", "nr"));
ok("bolaget", traff(ab, "hedboms", "bolag"));
ok("utan prickar: malmo hittar Malmö", traff(ab, "malmo", "ort"));
ok("kontaktpersonen", traff(ab, "matias", "kontakt"));
ok("mejlen", traff(ab, "info@hedboms", "mejl"));
ok("gatuadressen", traff(ab, "storgatan", "adress"));
ok("postnumret, med och utan mellanslag", traff(ab, "211 22", "postnr") && traff(ab, "21122", "postnr"));
ok("säljaren", traff(ab, "fredrik", "vem"));
ok("paketet", traff(ab, "kampanjsida", "paket"));
ok("tjänsten", traff(ab, "annons", "tj"));
ok("anteckningen", traff(ab, "tio", "note"));
ok("makuleringens skäl", traff({ ...ab, mak: { dag: "2026-11-02", skal: "Kunden ångrade sig", av: null } }, "ångrade", "mak"));
ok("den fria orderns skäl", traff({ ...ab, fri: { varde: 9000, prov: 1000, typ: "kr", skal: "Specialpris mässa" } }, "mässa", "fri"));

rubrik("Flera ord");
ok("alla ord måste finnas", sok(ab, "hedboms 1158") !== null && sok(ab, "hedboms 9999") === null);
ok("ordningen spelar ingen roll", sok(ab, "1158 malmö") !== null);
ok("ett tomt sökfält släpper igenom allt", Array.isArray(sok(ab, "")) && sok(ab, "").length === 0 && Array.isArray(sok(ab, "   ")));
ok("ingenting som matchar", sok(ab, "xyz") === null);

rubrik("Var träffen sitter");
const t = (sok(ab, "1234567") || []).find((h) => h.nyckel === "tel");
ok("telefonens träff markeras i siffrorna", !!t && t.varde.slice(t.spann[0], t.spann[1]) === "123 45 67", JSON.stringify(t));
const tf = (sok(ab, "1158") || []).find((h) => h.etikett === "Faktura");
ok("fakturans träff markeras", !!tf && tf.varde.slice(tf.spann[0], tf.spann[1]) === "1158", JSON.stringify(tf));
const tk = (sok(ab, "ctr202600096") || []).find((h) => h.etikett === "Avtal");
ok("ett nummer skrivet utan streck markeras med strecken", !!tk && tk.varde.slice(tk.spann[0], tk.spann[1]) === "CTR-2026-00096", JSON.stringify(tk));
ok("bolaget syns redan på raden", (sok(ab, "hedboms") || []).find((h) => h.nyckel === "bolag")?.synlig === true);
ok("fakturan syns inte på raden", tf?.synlig === false);
ok("fakturans uppgifter följer med träffen", tf?.belopp === 7463 && tf?.status === "Skickad");
ok("två ord markeras båda", JSON.stringify(K.oSokSpannText("Hedboms Bygg AB", K.oSokTermer("bygg hedboms"))) === "[[0,7],[8,12]]", JSON.stringify(K.oSokSpannText("Hedboms Bygg AB", K.oSokTermer("bygg hedboms"))));
ok("ett nummer markerar ingen text", K.oSokSpannText("Hedboms Bygg AB", K.oSokTermer("1158")).length === 0);

rubrik("Länkar och adresser (K27)");
ok("ett personnummer är känsligt", K.oSokKanslig("850101-1234"));
ok("ett telefonnummer också", K.oSokKanslig("070 123 45 67"));
ok("ett bolagsnamn är det inte", !K.oSokKanslig("Hedboms"));
ok("ett fakturanummer är det inte", !K.oSokKanslig("1158"));

// ---------------------------------------------------------------------------
// Kopplingen: utkastet och servern använder delarna
// ---------------------------------------------------------------------------
rubrik("Utkastet använder blocket");
const kropp = (namn) => {
  const i = html.indexOf(`function ${namn}(`);
  return i < 0 ? "" : html.slice(i, html.indexOf("\n}", i));
};
ok("ordFiltrera söker med oSokOrder", /oSokOrder\(o\)/.test(kropp("ordFiltrera")));
ok("o7Lank lägger aldrig ett nummer i länken", /oSokKanslig\(S\.ordQ\)/.test(kropp("o7Lank")));
ok("ndOrdLank lägger aldrig ett nummer i adressen", /oSokKanslig\(S\.ordQ\)/.test(kropp("ndOrdLank")));
ok("ndOrdStart ger ordern kundens nummer", /nummer:/.test(kropp("ndOrdStart")));
ok("spärren mot org.nr är borta", !html.includes("Organisationsnummer går inte att söka på"));
ok("oOrgLik finns inte kvar", !/oOrgLik/.test(html));
ok("ingen särregel för personnummer i sökningen", !/oPersonnr|'personnr'/.test(html));
ok("tomläget säger inte att hela numret krävs", !/hittas bara på hela numret/.test(kropp("o7SokTom")));
ok("sökfältet säger vad det söker i", /placeholder="Sök bolag, org\.nr, telefon, fakturanummer/.test(html));

rubrik("Servern skickar numren");
const ord = las("src/lib/nav2/order.ts");
ok("byggOrder läser kundernas poster i Inkio-kopian", /from\("crm_handelse"\)/.test(ord) && /formaNummer\(/.test(ord));
ok("bara för order i urvalet (RLS har redan sagt ja)", /urval\.order\.map\(\(o\) => o\.org_number\)/.test(ord));
ok("raderade poster söks inte", /\.is\("raderad", null\)/.test(ord));
ok("NdOrderdata bär nummer per kund", /nummer: Record<string, NdNummer\[\]>/.test(ord));

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m` : "\n\x1b[32mAllt grönt\x1b[0m");
process.exit(fel ? 1 : 0);
