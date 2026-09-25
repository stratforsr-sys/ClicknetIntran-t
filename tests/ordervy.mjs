#!/usr/bin/env node
/**
 * Ordervyn: filtret i adressen, och kunden bakom ordern.
 *
 * ===========================================================================
 * SJU SAKER STAR PA SPEL, OCH TRE AV DEM AR SAKERHET.
 *
 *   1. SOKRENSNINGEN. Texten gar in i ett PostgREST-filter. Slipper `%` igenom
 *      traffar en sokning pa ett tecken varje rad RLS slapper fram; slipper
 *      `,` eller `(` igenom gar fragan att bygga om. Provet kraver att bada
 *      forsvinner.
 *   2. ADRESSTOLKNINGEN. Allt okant maste bli forvalet. En handskriven adress,
 *      en gammal bokmarkning eller en lank ur ett chattfonster far aldrig ge
 *      ett kastat undantag — det hade blivit en femhundrasida av ett slarvfel.
 *   3. RUNDGANGEN. `tolkaFilter(filtretSomFraga(f)) === f` for varje filter.
 *      Haller den inte tappas ett val nar kundkortet oppnas och stangs.
 *   4. KUNDNYCKELN. `556677-8899` och `5566778899` MASTE bli samma kund, annars
 *      delas en kunds historik i tva kort. Och ett personnummer maste ga
 *      igenom — K27-undantaget.
 *   5. SUMMERINGEN. En makulerad order ska rakna som NOLL pa kundkortet, inte
 *      som ett avdrag. Forsta forsoket drog av den fran en summa den redan lag
 *      i och blev darfor dubbelt avdragen.
 *   6. BEHORIGHETEN TILL ATGARDERNA. `harAtgarder` avgor vilka knappar som ritas
 *      pa en order, och den dyra riktningen ar att en knapp DYKER UPP for nagon
 *      som inte ska ha den. Hela matrisen kors: fem statusar mot fyra roller,
 *      plus sexton rollkombinationer mot en makulerad order.
 *   7. STATUSENS TON. Kartan lag i tva komponenter och kunde saga emot sig sjalv.
 *      Provet kraver att varje status i `ORDERSTATUSAR` — listan triggern i 0034
 *      speglar — har exakt en ton.
 *
 *   node --experimental-strip-types tests/ordervy.mjs
 */
import { ORDERSTATUSAR } from "../src/lib/order.ts";
import {
  MANADSVAL_ANTAL,
  ORDERTAK,
  STATUSTON,
  STATUSVAL,
  avtalsforlopp,
  filtretSomFraga,
  harAtgarder,
  harFilter,
  kundnyckel,
  manadsval,
  orderhandelser,
  rensaSok,
  sammaKund,
  slaSammanKund,
  statusarnaI,
  tolkaFilter,
} from "../src/lib/ordervy.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(
    `  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`,
  );
  if (!villkor) fel++;
};

const MIG = "11111111-1111-1111-1111-111111111111";
const ANNAN = "22222222-2222-2222-2222-222222222222";

// -----------------------------------------------------------------------------
console.log("\nSokrensningen — sparren mot ett filter som bygger om sig sjalvt");
// -----------------------------------------------------------------------------

ok("jokertecknet % tas bort", !rensaSok("%").includes("%"), JSON.stringify(rensaSok("%")));
ok("jokertecknet _ tas bort", !rensaSok("a_b").includes("_"), rensaSok("a_b"));
ok("komma tas bort", !rensaSok("Bygg, AB").includes(","), rensaSok("Bygg, AB"));
ok("parenteser tas bort", !/[()]/.test(rensaSok("Bygg (Syd)")), rensaSok("Bygg (Syd)"));
ok("punkt tas bort", !rensaSok("a.eq.b").includes("."), rensaSok("a.eq.b"));
ok("kolon tas bort", !rensaSok("or:x").includes(":"), rensaSok("or:x"));
ok("citattecken tas bort", !/["']/.test(rensaSok(`O'Brien "AB"`)), rensaSok(`O'Brien "AB"`));
ok("bakstreck tas bort", !rensaSok("a\\b").includes("\\"), rensaSok("a\\b"));

ok("ett vanligt bolagsnamn gar oforandrat igenom", rensaSok("Nordbygg AB") === "Nordbygg AB");
ok("aaoo klarar sig", rensaSok("Åkeri Öst Ängen") === "Åkeri Öst Ängen");
ok("bindestreck far vara kvar", rensaSok("Bygg-Ett") === "Bygg-Ett", rensaSok("Bygg-Ett"));
ok("& far vara kvar", rensaSok("Bygg & Co") === "Bygg & Co", rensaSok("Bygg & Co"));
ok("dubbla mellanslag slas ihop", rensaSok("a   b") === "a b");
ok("kanterna trimmas", rensaSok("  ab  ") === "ab");
ok("langden kapas till 60", rensaSok("x".repeat(200)).length === 60);
ok("en text av bara syntax blir tom", rensaSok("%_(),.:") === "", JSON.stringify(rensaSok("%_(),.:")));

// -----------------------------------------------------------------------------
console.log("\nAdresstolkningen — allt okant blir forvalet");
// -----------------------------------------------------------------------------

const tomt = tolkaFilter({}, MIG);
ok("tom adress ger alla saljare", tomt.vem === "alla");
ok("tom adress ger alla tider", tomt.tid.slag === "alla");
ok("tom adress ger alla statusar", tomt.status === "alla");
ok("tom adress ger tom sokning", tomt.sok === "");

ok("skrap i vem blir alla", tolkaFilter({ vem: "drop table" }, MIG).vem === "alla");
ok("skrap i tid blir alla", tolkaFilter({ tid: "i-fjol" }, MIG).tid.slag === "alla");
ok("skrap i status blir alla", tolkaFilter({ status: "inskickadd" }, MIG).status === "alla");

ok("`jag` loeses upp mot den inloggade", tolkaFilter({ vem: "jag" }, MIG).vem === MIG);
ok("ett uuid slapps igenom", tolkaFilter({ vem: ANNAN }, MIG).vem === ANNAN);

const manadsfilter = tolkaFilter({ tid: "2026-09-01" }, MIG);
ok(
  "en manadsnyckel blir ett manadsval",
  manadsfilter.tid.slag === "manad" && manadsfilter.tid.manad === "2026-09-01",
);

const dagsfilter = tolkaFilter({ tid: "2026-09-24" }, MIG);
ok(
  "ett kalenderdatum blir ett dagsval",
  dagsfilter.tid.slag === "dag" && dagsfilter.tid.datum === "2026-09-24",
);

// DEN 1:A AR EN MANAD OCH INTE EN DAG. Ordningen i `tolkaFilter` avgor det, och
// det ar ett medvetet val: manadsvaljaren skickar alltid den 1:a, och
// datumvaljaren traffar den bara en gang per manad. Byts ordningen blir
// manadsfiltret ett dagsfilter som visar de order som rakade signeras pa en 1:a.
ok("den 1:a lases som en manad, inte som en dag", tolkaFilter({ tid: "2026-09-01" }, MIG).tid.slag === "manad");

ok("den 31 februari avvisas", tolkaFilter({ tid: "2026-02-31" }, MIG).tid.slag === "alla");
ok("manad 13 avvisas", tolkaFilter({ tid: "2026-13-01" }, MIG).tid.slag === "alla");
ok("ett arrayvarde tas fran forsta platsen", tolkaFilter({ status: ["betald", "utkast"] }, MIG).status === "betald");
ok("sokningen rensas redan i tolkningen", tolkaFilter({ sok: "a%b" }, MIG).sok === "a b");

// -----------------------------------------------------------------------------
console.log("\nRundgangen — ett filter overlever att bli en adress och tillbaka");
// -----------------------------------------------------------------------------

const alla = [
  { vem: "alla", tid: { slag: "alla" }, status: "alla", sok: "" },
  { vem: ANNAN, tid: { slag: "alla" }, status: "alla", sok: "" },
  { vem: "alla", tid: { slag: "manad", manad: "2025-12-01" }, status: "alla", sok: "" },
  { vem: "alla", tid: { slag: "dag", datum: "2026-09-24" }, status: "alla", sok: "" },
  { vem: "alla", tid: { slag: "alla" }, status: "vantar", sok: "" },
  { vem: "alla", tid: { slag: "alla" }, status: "alla", sok: "Nordbygg AB" },
  { vem: ANNAN, tid: { slag: "manad", manad: "2026-03-01" }, status: "makulerad", sok: "Bygg-Ett" },
];

for (const f of alla) {
  const fraga = filtretSomFraga(f);
  const sp = Object.fromEntries(new URLSearchParams(fraga.replace(/^\?/, "")));
  const tillbaka = tolkaFilter(sp, MIG);
  ok(
    `rundgang: ${fraga || "(tom adress)"}`,
    JSON.stringify(tillbaka) === JSON.stringify(f),
    JSON.stringify(tillbaka),
  );
}

ok("forvalen skrivs inte ut", filtretSomFraga(alla[0]) === "");
ok("extra parametrar foljer med", filtretSomFraga(alla[0], { kund: "abc" }) === "?kund=abc");
ok(
  "extra parametrar staplas pa filtret",
  filtretSomFraga(alla[4], { ny: "1" }) === "?status=vantar&ny=1",
  filtretSomFraga(alla[4], { ny: "1" }),
);

ok("harFilter ar falskt for forvalet", harFilter(alla[0]) === false);
for (const [i, f] of alla.entries()) {
  if (i === 0) continue;
  ok(`harFilter ar sant for ${filtretSomFraga(f)}`, harFilter(f) === true);
}

// -----------------------------------------------------------------------------
console.log("\nStatuslagena");
// -----------------------------------------------------------------------------

ok("alla ger ett TOMT villkor", statusarnaI("alla").length === 0);
ok("vantar ar `inskickad`", statusarnaI("vantar").join() === "inskickad");
ok("betald ar sig sjalv", statusarnaI("betald").join() === "betald");
ok("varje lage utom alla ger minst en status", STATUSVAL.filter((s) => s !== "alla").every((s) => statusarnaI(s).length > 0));
ok("taket ar ett positivt tal", ORDERTAK > 0);

// -----------------------------------------------------------------------------
console.log("\nStatusens ton — en karta, inte tva");
// -----------------------------------------------------------------------------

// KARTAN LAG I BADA KOMPONENTERNA fram till 2026-09-25. Record<Orderstatus, ...>
// gor en saknad status till ett kompileringsfel, men provet stalls mot
// `ORDERSTATUSAR` — som ar listan triggern i 0034 speglar — sa att en status som
// laggs till i databasen och i typen inte kan glömmas har.
ok(
  "varje status i ORDERSTATUSAR har en ton",
  ORDERSTATUSAR.every((s) => STATUSTON[s] !== undefined),
  ORDERSTATUSAR.filter((s) => STATUSTON[s] === undefined).join() || "alla",
);
ok("inga toner utan status", Object.keys(STATUSTON).every((s) => ORDERSTATUSAR.includes(s)));
ok("makulerad ar rod", STATUSTON.makulerad === "danger");
ok("inskickad ar gul — den kraver nagot av nagon", STATUSTON.inskickad === "warn");
ok("betald och signerad har OLIKA ton", STATUSTON.betald !== STATUSTON.signerad);

// -----------------------------------------------------------------------------
console.log("\nharAtgarder — hela matrisen, fem statusar mot fyra roller");
// -----------------------------------------------------------------------------

/**
 * Den dyra riktningen ar att en knapp DYKER UPP for nagon som inte ska ha den.
 * Matrisen kors darfor i sin helhet, och varje rad star utskriven med sitt
 * forvantade svar — en tabell man kan lasa mot specifikationen i stallet for ett
 * uttryck man maste tolka.
 */
const ROLLER = {
  saljare: { hanterare: false, bokforare: false, agare: true, upphovsperson: true },
  "annan saljare": { hanterare: false, bokforare: false, agare: false, upphovsperson: false },
  saljchef: { hanterare: true, bokforare: false, agare: false, upphovsperson: false },
  ekonomi: { hanterare: true, bokforare: true, agare: false, upphovsperson: false },
};

const VANTAT = {
  //                 saljare  annan  saljchef  ekonomi
  utkast: [true, false, false, false],
  inskickad: [false, false, true, true],
  signerad: [true, false, true, true],
  betald: [true, false, true, true],
  makulerad: [false, false, false, false],
};

for (const status of ORDERSTATUSAR) {
  const rader = Object.entries(ROLLER);
  for (const [i, [namn, roll]] of rader.entries()) {
    const svar = harAtgarder({ status, ...roll });
    ok(`${status} / ${namn} → ${VANTAT[status][i] ? "åtgärder" : "inget"}`, svar === VANTAT[status][i], `fick ${svar}`);
  }
}

// EN MAKULERAD ORDER HAR INGENTING FOR NAGON, och det ar inte en detalj: ingen
// vag leder ut ur `makulerad` i `OVERGANGAR`, sa en knapp dar hade varit en knapp
// som alltid misslyckas. Provas separat over ALLA rollkombinationer, inte bara de
// fyra realistiska ovan.
let makuleradOppen = 0;
for (const hanterare of [false, true])
  for (const bokforare of [false, true])
    for (const agare of [false, true])
      for (const upphovsperson of [false, true])
        if (harAtgarder({ status: "makulerad", hanterare, bokforare, agare, upphovsperson })) {
          makuleradOppen++;
        }
ok("ingen av sexton rollkombinationer far atgarder pa en makulerad order", makuleradOppen === 0, `${makuleradOppen} slapptes igenom`);

// ETT UTKAST TILLHOR SIN AGARE OCH INGEN ANNAN. Sarskilt inte chefen: ett utkast
// ar inte inskickat, och specifikationen later inte nagon annan skicka in det.
ok(
  "saljchefen ser inget pa nagon annans utkast",
  harAtgarder({ status: "utkast", hanterare: true, bokforare: true, agare: false, upphovsperson: true }) === false,
);
ok(
  "agaren ser sitt eget utkast aven utan att ha lagt upp det",
  harAtgarder({ status: "utkast", hanterare: false, bokforare: false, agare: true, upphovsperson: false }) === true,
);

// UPPHOVSPERSONEN FAR RATTA KUNDUPPGIFTER pa en godkand order aven utan rollen.
// Det ar hela skalet till att `upphovsperson` finns som begrepp.
ok(
  "den som la upp ordern kommer at den nar den ar signerad",
  harAtgarder({ status: "signerad", hanterare: false, bokforare: false, agare: false, upphovsperson: true }) === true,
);
ok(
  "men en utomstaende saljare gor det inte",
  harAtgarder({ status: "betald", hanterare: false, bokforare: false, agare: false, upphovsperson: false }) === false,
);

// -----------------------------------------------------------------------------
console.log("\nManadsvaljaren");
// -----------------------------------------------------------------------------

const mv = manadsval("2026-09-25");
ok("forsta manaden ar innevarande", mv[0] === "2026-09-01", mv[0]);
ok("andra manaden ar forra", mv[1] === "2026-08-01", mv[1]);
ok("langden foljer konstanten", mv.length === MANADSVAL_ANTAL);
ok("listan gar over ett arsskifte", manadsval("2026-01-15")[1] === "2025-12-01", manadsval("2026-01-15")[1]);
ok("varje post ar en manadsnyckel", mv.every((m) => /^\d{4}-\d{2}-01$/.test(m)));
ok("tolkningen kanner igen varje post", mv.every((m) => tolkaFilter({ tid: m }, MIG).tid.slag === "manad"));

// -----------------------------------------------------------------------------
console.log("\nKundnyckeln — samma kund fast olika inskriven");
// -----------------------------------------------------------------------------

const medBindestreck = { org_number: "556677-8899", company_name: "Nordbygg AB" };
const utanBindestreck = { org_number: "5566778899", company_name: "NORDBYGG AB" };
const medSekel = { org_number: "16556677-8899", company_name: "Nordbygg" };
const annatBolag = { org_number: "999999-9999", company_name: "Sydbygg AB" };
const namnbyte = { org_number: "556677-8899", company_name: "Nordbygg Entreprenad AB" };

ok("bindestreck spelar ingen roll", kundnyckel(medBindestreck) === kundnyckel(utanBindestreck));
ok("tolv siffror med sekel kortas till tio", kundnyckel(medSekel) === kundnyckel(medBindestreck));
ok("tva olika bolag far olika nyckel", kundnyckel(medBindestreck) !== kundnyckel(annatBolag));
ok("ett namnbyte behaller nyckeln", kundnyckel(namnbyte) === kundnyckel(medBindestreck));

// K27: en enskild firma har PERSONNUMMER som organisationsnummer, och det maste
// ga igenom — annars gar en laglig kund inte att lagga in, och inte att hitta.
ok("ett personnummer ger en nummernyckel", kundnyckel({ org_number: "850101-1234", company_name: "Anna Ek" }).startsWith("nr:"));

// Utan nummer faller nyckeln tillbaka pa namnet. Samre, men battre an att varje
// sadan order blir en egen kund.
ok("tomt nummer ger en namnnyckel", kundnyckel({ org_number: "", company_name: "Cykel AB" }) === "namn:cykel ab");
ok("for kort nummer ger en namnnyckel", kundnyckel({ org_number: "123", company_name: "Cykel AB" }) === "namn:cykel ab");
ok("versaler spelar ingen roll i namnnyckeln", kundnyckel({ org_number: "", company_name: " CYKEL AB " }) === "namn:cykel ab");

ok("sammaKund pa nummer", sammaKund(medBindestreck, utanBindestreck) === true);
ok("sammaKund pa namn nar numret saknas", sammaKund({ org_number: "", company_name: "Cykel AB" }, { org_number: "", company_name: "cykel ab" }) === true);
ok("sammaKund pa namn aven med olika nummer", sammaKund({ org_number: "111111-1111", company_name: "Cykel AB" }, { org_number: "222222-2222", company_name: "Cykel AB" }) === true);
ok("olika bolag ar inte samma kund", sammaKund(medBindestreck, annatBolag) === false);
ok("tva namnlosa rader ar INTE samma kund", sammaKund({ org_number: "", company_name: "" }, { org_number: "", company_name: "" }) === false);

// -----------------------------------------------------------------------------
console.log("\nKundsummeringen — en makulerad order ar noll, inte ett avdrag");
// -----------------------------------------------------------------------------

const rad = (extra) => ({
  id: "o1",
  company_name: "Nordbygg AB",
  org_number: "556677-8899",
  contact_name: "Anna Ek",
  contact_phone: "070-1234567",
  contact_email: null,
  status: "signerad",
  signed_on: "2026-03-01",
  starts_on: "2026-03-01",
  ends_on: "2028-03-01",
  term_months: 24,
  monthly_amount: 995,
  order_value: 23880,
  buyout_amount: null,
  commission_amount: 3000,
  renewal_outcome: null,
  salesperson_id: MIG,
  ...extra,
});

const tre = [
  rad({ id: "a", signed_on: "2024-05-02", ends_on: "2026-05-02", order_value: 11940, commission_amount: 1500, monthly_amount: 995 }),
  rad({ id: "b", signed_on: "2026-03-01", ends_on: "2028-03-01", order_value: 23880, commission_amount: 3000, monthly_amount: 995 }),
  rad({ id: "c", signed_on: "2026-09-10", ends_on: "2027-09-10", status: "makulerad", order_value: 9000, commission_amount: 1200, monthly_amount: 750 }),
];

const k = slaSammanKund(tre);
ok("antalet ar alla order, aven de makulerade", k.antal === 3);
ok("levande raknar de i kraft", k.levande === 2);
ok("makulerade raknas for sig", k.makulerade === 1);
ok("ordervardet ar de levandes summa", k.ordervarde === 11940 + 23880, String(k.ordervarde));
ok("den makulerade ordern drar INTE av en gang till", k.ordervarde !== 11940 + 23880 - 9000);
ok("provisionen ar de levandes summa", k.provision === 1500 + 3000, String(k.provision));
ok("manadsintakten raknar bara levande avtal", k.manadsintakt === 995 + 995, String(k.manadsintakt));
ok("kund sedan ar det tidigaste datumet", k.kundSedan === "2024-05-02", k.kundSedan);
ok("slutdatumet ar det senaste levande", k.slutdatum === "2028-03-01", String(k.slutdatum));
ok("nyast forst i listan", k.order[0].id === "c", k.order[0].id);
ok("bolaget kommer ur den nyaste ordern", k.bolag === "Nordbygg AB");

// EN KUND UTAN NAGOT I KRAFT. Slutdatumet maste bli null och inte ett datum ur
// en makulerad order — kortet sager "inget avtal i kraft", och ett datum dar
// hade last som att kunden har ett avtal.
const bara = slaSammanKund([rad({ id: "d", status: "makulerad" })]);
ok("ingen levande order ger inget slutdatum", bara.slutdatum === null);
ok("ingen levande order ger noll i ordervarde", bara.ordervarde === 0);
ok("ingen levande order ger noll i manadsintakt", bara.manadsintakt === 0);

// MEJLADRESSEN TAS UR DEN NYASTE ORDER SOM HAR EN. Order fran fore 2026-09-15
// saknar kolumnen, och da ska kortet visa den adress som finns langre bak i
// stallet for en tom rad pa den nyaste.
const medMejl = slaSammanKund([
  rad({ id: "ny", signed_on: "2026-09-01", contact_email: null }),
  rad({ id: "gammal", signed_on: "2024-01-01", contact_email: "anna@nordbygg.se" }),
]);
ok("mejlen hamtas ur en aldre order nar den nyaste saknar den", medMejl.kontakt.mejl === "anna@nordbygg.se", String(medMejl.kontakt.mejl));

ok("en tom lista ger noll utan att kasta", slaSammanKund([]).antal === 0);
ok("en tom lista ger inget slutdatum", slaSammanKund([]).slutdatum === null);

// Order som saknar varde RAKNAS, de blir inte nollor. Se `ordervarde()` i
// order.ts for samma resonemang: vyn maste kunna saga skillnaden med ord.
const utan = slaSammanKund([rad({ id: "x", order_value: null }), rad({ id: "y", order_value: 1000 })]);
ok("order utan varde raknas", utan.utanVarde === 1, String(utan.utanVarde));
ok("order utan varde bidrar med noll till summan", utan.ordervarde === 1000);

// -----------------------------------------------------------------------------
console.log("\nAvtalsforloppet — stapeln pa kortet och tidslinjen i kundkortet");
// -----------------------------------------------------------------------------

const mitt = avtalsforlopp("2026-01-01", "2027-01-01", "2026-07-02");
ok("halvvags ar ungefar en halv", Math.abs(mitt.andel - 0.5) < 0.01, String(mitt.andel));
ok("dagarna kvar raknas framat", mitt.dagarKvar === 183, String(mitt.dagarKvar));

const forst = avtalsforlopp("2026-01-01", "2027-01-01", "2026-01-01");
ok("forsta dagen ar noll", forst.andel === 0);
ok("hela loptiden star kvar", forst.dagarKvar === 365, String(forst.dagarKvar));

const sist = avtalsforlopp("2026-01-01", "2027-01-01", "2027-01-01");
ok("sista dagen ar ett", sist.andel === 1);
ok("noll dagar kvar pa sista dagen", sist.dagarKvar === 0);

// KLIPPNINGEN AR HELA SKALET TILL ATT `andel` FINNS. Ett avtal som gatt ut ska
// ligga pa 1 och inte pa 1,3 — stapeln kan inte bli langre an sin ranna, och ett
// tal over ett hade ritat utanfor kortet.
const ute = avtalsforlopp("2026-01-01", "2027-01-01", "2027-06-01");
ok("ett utgangret avtal klipps till ett", ute.andel === 1, String(ute.andel));
ok("men dagarna kvar blir negativa", ute.dagarKvar < 0, String(ute.dagarKvar));

// FORE STARTEN klipps at andra hallen. Ett avtal som borjar galla nasta manad ska
// ligga pa noll och inte pa minus en tiondel.
const innan = avtalsforlopp("2026-10-01", "2027-10-01", "2026-09-25");
ok("ett avtal som inte borjat ligger pa noll", innan.andel === 0, String(innan.andel));
ok("men har fler dagar kvar an sin loptid", innan.dagarKvar > innan.dagarTotalt);

// SAMMA DAG I BADA ANDAR far inte ge division med noll. `dagarTotalt` golvas till
// ett, och stapeln blir full — vilket ar ratt: avtalet ar over.
const noll = avtalsforlopp("2026-09-25", "2026-09-25", "2026-09-25");
ok("noll dagars loptid kastar inte", Number.isFinite(noll.andel), String(noll.andel));
ok("noll dagars loptid ger en full stapel", noll.andel === 1);

// -----------------------------------------------------------------------------
console.log("\nHandelserna — ingen post utan en kolumn bakom sig");
// -----------------------------------------------------------------------------

const h1 = orderhandelser({
  created_at: "2026-03-01T08:00:00Z",
  signed_on: "2026-03-01",
  approved_at: null,
  cancelled_on: null,
  renewal_outcome: null,
});
ok("en ny order har en post", h1.length === 1, String(h1.length));
ok("och den ar uppläggningen", h1[0].rubrik === "Ordern lades upp");

// SIGNERINGEN FAR EN EGEN POST BARA NAR DEN SKILJER SIG FRAN UPPLAGGNINGEN. Tva
// poster med samma datum och nastan samma innebord ar brus i en tidslinje.
const h2 = orderhandelser({
  created_at: "2026-03-05T08:00:00Z",
  signed_on: "2026-03-01",
  approved_at: "2026-03-06T09:00:00Z",
  cancelled_on: null,
  renewal_outcome: null,
});
ok("en backdaterad order far en egen signeringspost", h2.length === 3, String(h2.length));
ok("posterna star i datumordning", h2.map((p) => p.datum).join() === "2026-03-01,2026-03-05,2026-03-06", h2.map((p) => p.datum).join());
ok("godkannandet ar gront", h2[2].ton === "ok");

// INGEN "INSKICKAD"-POST. Ogonblicket har ingen tidsstampel i tabellen, och en
// uppdiktad tidpunkt i en tidslinje ar samre an ett hal.
ok("ingen post saknar ett datum", h2.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.datum)));
ok("ingen post heter inskickad", h2.every((p) => !p.rubrik.toLowerCase().includes("inskickad")));

const h3 = orderhandelser({
  created_at: "2026-03-01T08:00:00Z",
  signed_on: "2026-03-01",
  approved_at: "2026-03-02T09:00:00Z",
  cancelled_on: "2026-09-10",
  cancel_reason: "Kunden gick i konkurs",
  renewal_outcome: null,
});
ok("makuleringen kommer sist", h3[h3.length - 1].rubrik === "Makulerad");
ok("skalet foljer med", h3[h3.length - 1].text === "Kunden gick i konkurs");
ok("makuleringen ar rod", h3[h3.length - 1].ton === "danger");

const h4 = orderhandelser({
  created_at: "2025-03-01T08:00:00Z",
  signed_on: "2025-03-01",
  approved_at: "2025-03-02T09:00:00Z",
  cancelled_on: null,
  renewal_outcome: "avslutad",
  renewal_at: "2026-09-20T10:00:00Z",
  renewal_reason: "Bytte till konkurrent",
});
ok("ett avslutat avtal far en post", h4.some((p) => p.rubrik === "Kunden förlängde inte"));
ok("orsaken foljer med", h4.some((p) => p.text === "Bytte till konkurrent"));

// UTAN TIDSSTAMPEL, INGEN POST. `renewal_at` ar null pa order fran fore 0068, och
// da ska tidslinjen tiga i stallet for att gissa ett datum.
const h5 = orderhandelser({
  created_at: "2025-03-01T08:00:00Z",
  signed_on: "2025-03-01",
  approved_at: null,
  cancelled_on: null,
  renewal_outcome: "forlangd",
  renewal_at: null,
});
ok("ett utfall utan tidsstampel ger ingen post", h5.every((p) => !p.rubrik.includes("förläng")));

// -----------------------------------------------------------------------------
console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m\n" : `\n\x1b[31m${fel} prov misslyckades.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
