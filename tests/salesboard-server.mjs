#!/usr/bin/env node
/**
 * Säljtavlans server: ögonblicksbilden ur databasens rader (`formaOgonblick`),
 * tröskeln för stor affär ur statistiken, nycklarna och det som får tavlan att
 * gå vidare innan migrationen körts. Fem saker står på spel och provas åt båda
 * hållen:
 *
 *   1. BILDEN ÄR DISPLAY-SÄKER. Den går till en TV på en vägg och till
 *      webbläsarens utvecklarverktyg. Inget employee-id, inget order-id, ingen
 *      e-post, inget telefonnummer, ingen provision och inget kronmål får finnas
 *      i JSON-strängen, och en dold säljares namn finns inte där i någon form.
 *      Raderna i provet bär sådana fält med flit, så att en kopiering syns.
 *   2. DEN DOLDA SÄLJAREN ÄR DOLD ÅT DET SÄKRA HÅLLET. Bara visningarna "namn"
 *      och "initialer" visar något. Allt annat (dold, null, skräp) ger "En
 *      säljare" OCH motivet null, så att rummet inte känner igen hen på örat.
 *   3. SAMMA TAL SOM NAV. Månadens antal är `nettoAntal`, målet är summan av
 *      säljmålen och annars förra månaden, takten är `motMal`, och prognosen
 *      visas först från arbetsdag tre.
 *   4. ORDERLISTAN BÄR HELA DAGEN. Planeringen firar bara det som finns i
 *      bilden, så alla godkända i dag måste med, plus de åtta senaste inom
 *      fjorton dagar. Säljarens dagsantal räknas i tidsordning, i svensk tid.
 *   5. TRÖSKELN FÖR STOR AFFÄR följer samma regel som `storAffarTroskel`, fast
 *      den kommer ur statistiken: p90 när den räknats på minst tjugo order,
 *      annars 30 000 kr, och det fasta beloppet i läget "belopp".
 *   6. ÅTKOMSTEN FELAR ÅT DET SÄKRA HÅLLET. En TV på väggen som får 401 visar
 *      parningen, så en databas som har en dålig minut ska ge 503, aldrig 401.
 *      En tabell som saknas efter 0250 är ett fel, aldrig "ingen har valt att
 *      vara dold". Kakornas flaggor, förnyelsen, adressens hink, kvoten och
 *      TV:ns fråga under parningen provas som rena beslut.
 *
 *   TZ=UTC node --experimental-strip-types tests/salesboard-server.mjs
 */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { svensktDatum } from "../src/lib/klocka.ts";
import { normalisera } from "../src/lib/salesboard/installningar.ts";
import { hasha, normaliseraKod, nyKod, nyToken, visaKod } from "../src/lib/salesboard/parning.ts";
import { MINSTA_UNDERLAG, RESERV_TROSKEL, storAffarTroskel } from "../src/lib/salesboard/regler.ts";
import { formaOgonblick, lasStatistik, tavlansFonster, troskelFranStatistik, vinnarensManad } from "../src/lib/salesboard/forma.ts";
import { nyckelFor } from "../src/lib/salesboard/nyckel.ts";
import { lasningen, personvalen, saknasIDatabasen } from "../src/lib/salesboard/saknas.ts";
import {
  KAKA,
  PARKAKA,
  PARKAKA_LIVSTID,
  SKARMKAKA,
  SKARMKAKA_LIVSTID,
  SKARMKAKA_TID,
  adresshink,
  arKodkrock,
  arToken,
  forMangaKoder,
  klientIp,
  parkaka,
  parkakanBort,
  parningsbeslut,
  personbeslut,
  skarmbeslut,
  skarmkakanBehoverFornyas,
  skarmkakor,
  webblasare,
} from "../src/lib/salesboard/atkomstregler.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(
    `  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`,
  );
  if (!villkor) fel++;
};
const lika = (a, b) => isDeepStrictEqual(a, b);
const nara = (a, b) => typeof a === "number" && Math.abs(a - b) < 1e-9;

// -----------------------------------------------------------------------------
// Raderna
// -----------------------------------------------------------------------------

const LAG = "11111111-1111-4111-8111-111111111111";
const ANNAT_LAG = "22222222-2222-4222-8222-222222222222";
const ELIN = "e1e1e1e1-0000-4000-8000-000000000001";
const AMIRA = "a1a1a1a1-0000-4000-8000-000000000002";
const JONAS = "c1c1c1c1-0000-4000-8000-000000000003";
const OLLE = "f1f1f1f1-0000-4000-8000-000000000004";
const NILS = "b1b1b1b1-0000-4000-8000-000000000005";
const oid = (n) => `0d0d0d0d-0000-4000-8000-${String(n).padStart(12, "0")}`;
const k = (id) => nyckelFor(id);

/** Fredag 23 oktober 2026 kl. 12:00 svensk tid: arbetsdag 17 av 22. */
const NU = new Date("2026-10-23T10:00:00Z");

/**
 * En godkänd order. Signeringsdagen är godkännandets svenska dag om inget annat
 * sägs, och månaden följer signeringsdagen, som `period_month` i databasen.
 */
function order(n, saljare, godkand, over = {}) {
  const signed_on = over.signed_on ?? (godkand ? svensktDatum(godkand) : null);
  return {
    id: oid(n),
    salesperson_id: saljare,
    package_id: 2,
    term_months: 24,
    signed_on,
    period_month: signed_on ? `${signed_on.slice(0, 7)}-01` : null,
    status: "signerad",
    order_value: 17940,
    order_value_source: "package",
    approved_at: godkand,
    cancelled_on: null,
    cancel_period_month: null,
    company_name: `Kund ${n} AB`,
    // Fält som finns på raden i databasen men aldrig får nå en TV.
    commission_amount: 13579,
    org_number: "556677-8899",
    contact_email: "kund@exempel.se",
    ...over,
  };
}

const o1 = order(1, ELIN, "2026-10-23T06:30:00Z", { company_name: "Bergs Bygg AB" });
const o2 = order(2, AMIRA, "2026-10-23T08:02:00Z", { package_id: 1, term_months: 12, order_value: 11940, company_name: "Kafé Linnea" });
const o3 = order(3, JONAS, "2026-10-23T09:15:00Z", { order_value_source: "manual", order_value: 45000, company_name: "  Norrbygg AB  " });
const o4 = order(4, ELIN, "2026-10-23T09:40:00Z", { package_id: 3, term_months: 36, order_value: 71820, signed_on: "2026-10-16" });
const o5 = order(5, ELIN, "2026-10-01T08:00:00Z", { order_value: 35880 });
const o6 = order(6, JONAS, "2026-10-02T09:00:00Z", { package_id: 1, term_months: 12, order_value: 11940 });
const o7 = order(7, JONAS, "2026-10-05T10:00:00Z");
const o8 = order(8, ELIN, "2026-10-20T10:00:00Z");
const o9 = order(9, JONAS, "2026-10-21T10:00:00Z");
const o10 = order(10, ELIN, "2026-10-22T07:00:00Z");
// Signerad i september och makulerad i oktober: ett avdrag i oktober.
const o11 = order(11, JONAS, "2026-09-15T10:00:00Z", { status: "makulerad", cancelled_on: "2026-10-07", cancel_period_month: "2026-10-01" });
// Ett annat lag.
const o12 = order(12, OLLE, "2026-10-23T09:50:00Z");
// Signerad och makulerad i oktober: plus ett och minus ett, och Nils har inte bidragit.
const o13 = order(13, NILS, "2026-10-06T10:00:00Z", { status: "makulerad", cancelled_on: "2026-10-08", cancel_period_month: "2026-10-01" });
// September.
const s1 = order(21, ELIN, "2026-09-10T10:00:00Z");
const s2 = order(22, JONAS, "2026-09-11T10:00:00Z");

const PERSONER = [
  { id: ELIN, first_name: "Elin", last_name: "Berg", team_id: LAG, status: "active", employee_role: [{ role: "salesperson" }], email: "elin.berg@exempel.se", phone: "+46701112233" },
  { id: AMIRA, first_name: "Amira", last_name: "Haddad", team_id: LAG, status: "active", employee_role: [{ role: "salesperson" }], email: "amira.haddad@exempel.se", phone: "+46704445566" },
  { id: JONAS, first_name: "Jonas", last_name: "Kim", team_id: LAG, status: "active", employee_role: [{ role: "sales_manager" }], email: "jonas.kim@exempel.se", phone: "+46707778899" },
  { id: OLLE, first_name: "Olle", last_name: "Utanför", team_id: ANNAT_LAG, status: "active", employee_role: [{ role: "salesperson" }], email: "olle@exempel.se", phone: null },
  { id: NILS, first_name: "Nils", last_name: "Nolla", team_id: LAG, status: "left", employee_role: [{ role: "salesperson" }], email: "nils@exempel.se", phone: null },
];

const STATISTIK = {
  saljare: [
    { id: ELIN, forsta: oid(90), basta: 2 },
    { id: JONAS, forsta: oid(91), basta: 1 },
    { id: AMIRA, forsta: oid(2), basta: 0 },
    { id: OLLE, forsta: oid(92), basta: 4 },
  ],
  p90: 40000,
  antal90: 25,
  bastaDag: 3,
  manader: [
    { manad: "2026-08-01", antal: 21, varde: 372_800 },
    { manad: "2026-09-01", antal: 26, varde: 489_300 },
  ],
};

/** Det `tavlan.ts` läser ur databasen en fredag mitt på dagen, med ändringar ovanpå. */
function rader(over = {}) {
  return {
    lag: { id: LAG, namn: "Team Mikro" },
    bygge: "abc123def456",
    personer: PERSONER,
    val: [
      { employee_id: AMIRA, display: "dold" },
      { employee_id: JONAS, display: "initialer" },
    ],
    paket: [
      { id: 1, label: "Paket 1" },
      { id: 2, label: "Paket 2" },
      { id: 3, label: "Paket 3" },
    ],
    manadens: [o1, o2, o3, o4, o5, o6, o7, o8, o9, o10, o11, o12, o13],
    // Osorterad med flit: ordningen är bildens sak, inte frågans.
    senaste: [o10, o1, o2, o3, o4, o8, o9, o12],
    statistik: STATISTIK,
    handelser: [
      { id: 7, kind: "test", payload: { typ: "stor" }, created_at: "2026-10-23T09:58:00Z" },
      { id: 5, kind: "test", payload: { typ: "order" }, created_at: "2026-10-23T09:55:00Z" },
      { id: 4, kind: "test", payload: { typ: "forsta" }, created_at: "2026-10-23T09:50:00Z" },
      { id: 3, kind: "test", payload: { typ: "order" }, created_at: "2026-10-23T09:49:00Z" },
      { id: 8, kind: "test", payload: { typ: "konfetti" }, created_at: "2026-10-23T09:59:00Z" },
      { id: 9, kind: "annat", payload: { typ: "order" }, created_at: "2026-10-23T09:59:30Z" },
    ],
    nyckel: nyckelFor,
    ...over,
  };
}

const INST = normalisera({ lag: LAG, mal: { "2026-08": 460_000, "2026-10": 300_000 }, firande: { storAffar: { lage: "auto" } } });
const forma = (over = {}, inst = INST, nu = NU, skarm = null) => formaOgonblick(rader(over), inst, nu, skarm);
const orderMed = (bild, o) => bild.order.find((x) => x.nyckel === k(o.id));

// -----------------------------------------------------------------------------
console.log("\nÖgonblicksbilden");
{
  const bild = forma();
  const json = JSON.stringify(bild);

  ok("versionen är 1", bild.v === 1);
  ok("servertiden är nu", bild.nu === "2026-10-23T10:00:00.000Z", bild.nu);
  ok("bygget följer med", bild.bygge === "abc123def456");
  ok("lagets namn", bild.lag === "Team Mikro");
  ok("ingen skärm när ingen skickas", bild.skarm === null);
  ok(
    "skärmen följer med när den skickas",
    lika(forma({}, INST, NU, { namn: "Kontoret", ljud: false }).skarm, { namn: "Kontoret", ljud: false }),
  );

  // --- Display-säker -----------------------------------------------------------
  ok("inget lag-id bland inställningarna", !("lag" in bild.installningar));
  const { lag: _lag, mal: _mal, tavling: _tavling, ...utanLag } = INST;
  ok("resten av inställningarna följer med", lika(bild.installningar, utanLag));
  for (const [vad, id] of [["Elins", ELIN], ["Amiras", AMIRA], ["Jonas", JONAS], ["Olles", OLLE], ["Nils", NILS], ["lagets", LAG]]) {
    ok(`${vad} id finns inte i JSON-strängen`, !json.includes(id));
  }
  const orderIdn = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 21, 22, 90, 91, 92].map(oid);
  ok("inget order-id finns i JSON-strängen", orderIdn.every((id) => !json.includes(id)));
  ok("ingen e-post", !json.includes("@"));
  ok("inga telefonnummer", !json.includes("+4670"));
  ok("inga organisationsnummer", !json.includes("556677"));
  ok("ingen provision", !json.includes("13579") && !/commission|provision/i.test(json));
  ok("inga säljmål ur sales_target", !json.includes("97531") && !/target/i.test(json));
  ok("ingen kund", !/Kund \d|Bergs Bygg|Norrbygg|Kafé Linnea|company/i.test(json));
  ok("inga mål per månad bland inställningarna, bara talen", !("mal" in bild.installningar));

  // --- Den dolda säljaren ---------------------------------------------------------
  const amira = bild.personer[k(AMIRA)];
  ok("den dolda säljaren heter En säljare", amira?.namn === "En säljare", amira?.namn);
  ok("och har det neutrala monogrammet", amira?.initialer === "·");
  ok("och är märkt dold", amira?.dold === true);
  ok("och har inget motiv: motiven finns inte längre", !("motiv" in (amira ?? {})));
  ok("Haddad finns inte i JSON-strängen", !/haddad/i.test(json));
  ok("Amira finns inte heller", !/amira/i.test(json));
  ok("hennes order finns ändå med", orderMed(bild, o2)?.person === k(AMIRA));
  ok("men hon står inte i topplistan", !bild.saljare.some((s) => s.person === k(AMIRA)));
  // R23: talen som avgör det personliga lämnar inte servern för en dold säljare.
  const r2d = orderMed(bild, o2);
  ok(
    "hennes första order någonsin är ingen första order på tavlan",
    r2d?.forstaNagonsin === false && r2d?.saljarensDagsantal === 0 && r2d?.saljarensBasta === 0,
    JSON.stringify(r2d),
  );

  // --- De andra -----------------------------------------------------------------
  const elin = bild.personer[k(ELIN)];
  ok("Elin visas med namn och monogram", lika(elin, { nyckel: k(ELIN), namn: "Elin B.", initialer: "EB", dold: false }), JSON.stringify(elin));
  const jonas = bild.personer[k(JONAS)];
  ok("Jonas har valt initialer", lika(jonas, { nyckel: k(JONAS), namn: "J. K.", initialer: "JK", dold: false }), JSON.stringify(jonas));
  ok(
    "personerna är de i orderna och topplistan",
    lika(Object.keys(bild.personer).sort(), [k(ELIN), k(AMIRA), k(JONAS)].sort()),
  );
  ok("Nils som slutat, med en makulerad order, är inte med", !(k(NILS) in bild.personer));
  ok("Olle i ett annat lag är inte med", !(k(OLLE) in bild.personer));
  ok("varje order och varje rad har sin person", bild.order.every((o) => o.person in bild.personer) && bild.saljare.every((r) => r.person in bild.personer));

  // --- Månaden ------------------------------------------------------------------
  const m = bild.manad;
  ok("månadens nyckel", m.nyckel === "2026-10");
  ok("månadens namn", m.namn === "Oktober");
  // Tio godkända i oktober och Nils order, minus Jonas septemberorder och Nils, båda makulerade i oktober.
  ok("antalet är nettoAntal för laget", m.antal === 9, String(m.antal));
  ok("ordervärdet är netto på samma sätt", m.varde === 284_220 - 2 * 17_940, String(m.varde));
  ok("målet är oktobers mål i kronor", m.mal === 300_000, String(m.mal));
  ok("arbetsdag 17 av 22", lika(m.dagar, { gangna: 17, totalt: 22 }), JSON.stringify(m.dagar));
  ok("takten är målet gånger andelen dagar", m.forvantat === Math.round((300_000 * 17) / 22), String(m.forvantat));
  ok("prognosen är värdet framskrivet", m.prognos === Math.round((248_340 * 22) / 17), String(m.prognos));
  ok("målet är inte nått", m.natt === null);
  ok("månadens största affär", m.storsta === 71_820, String(m.storsta));
  ok("inget av det gamla antalsmålet", !("malKalla" in m) && !("lage" in m) && !("kravPerDag" in m) && !("bidrag" in m));

  // --- Dagen ------------------------------------------------------------------------
  ok("dagens datum", bild.idag.datum === "2026-10-23");
  ok("fredag är veckans femte dag", bild.idag.veckodag === 4);
  ok("fyra godkända i dag i laget", bild.idag.antal === 4, String(bild.idag.antal));
  ok("dagens ordervärde", bild.idag.summa === 17940 + 11940 + 45000 + 71820, String(bild.idag.summa));
  ok("bästa dagen ur statistiken", bild.idag.bastaDag === 3);

  // --- Topplistan ---------------------------------------------------------------------
  ok(
    "topplistan: aktiva som kan sälja, utan den dolda",
    lika(bild.saljare.map((r) => r.person), [k(ELIN), k(JONAS)]),
    JSON.stringify(bild.saljare),
  );
  ok(
    "Elins månad, vecka och dag",
    lika(bild.saljare[0], { person: k(ELIN), antal: 5, varde: 161_520, vecka: [0, 1, 0, 1, 2], idag: 2 }),
    JSON.stringify(bild.saljare[0]),
  );
  ok(
    "Jonas septemberorder som makulerats i oktober dras av",
    lika(bild.saljare[1], { person: k(JONAS), antal: 3, varde: 74_880, vecka: [0, 0, 1, 0, 1], idag: 1 }),
    JSON.stringify(bild.saljare[1]),
  );
  const tom = forma({ manadens: [], senaste: [] });
  ok("en aktiv säljare utan order står med noll", lika(tom.saljare.map((r) => [r.person, r.antal, r.varde]), [[k(ELIN), 0, 0], [k(JONAS), 0, 0]]));

  // --- Grafen -------------------------------------------------------------------------
  ok("elva månader före oktober", bild.historik.length === 11 && bild.historik[0].nyckel === "2025-11" && bild.historik[10].nyckel === "2026-09");
  ok(
    "september ur statistiken, med augustis mål som ärvts",
    lika(bild.historik[10], { nyckel: "2026-09", namn: "sep", antal: 26, varde: 489_300, mal: 460_000 }),
    JSON.stringify(bild.historik[10]),
  );
  ok("en månad före alla mål har inget mål och inga order", lika(bild.historik[0], { nyckel: "2025-11", namn: "nov", antal: 0, varde: 0, mal: null }));

  // --- Orderna ------------------------------------------------------------------------
  ok(
    "dagens fyra och de senaste inom fjorton dagar, den nyaste först",
    lika(bild.order.map((o) => o.nyckel), [o4, o3, o2, o1, o10, o9, o8].map((o) => k(o.id))),
  );
  const r4 = orderMed(bild, o4);
  ok(
    "en paketorder med allt ifyllt",
    lika(r4, {
      nyckel: k(o4.id),
      person: k(ELIN),
      tid: "2026-10-23T09:40:00.000Z",
      dag: "2026-10-23",
      paket: "Paket 3",
      bindning: 36,
      belopp: 71820,
      niva: "stor",
      efterreg: true,
      forstaNagonsin: false,
      saljarensDagsantal: 2,
      saljarensBasta: 2,
      manaden: true,
    }),
    JSON.stringify(r4),
  );
  const r3 = orderMed(bild, o3);
  ok("en fri order heter Fri order", r3?.paket === "Fri order", r3?.paket);
  ok("45 000 kr är en stor affär över p90", r3?.niva === "stor");
  ok("Jonas bästa dag ur statistiken", r3?.saljarensBasta === 1);
  const r2 = orderMed(bild, o2);
  ok("Paket 1, 12 månader", r2?.paket === "Paket 1" && r2?.bindning === 12, JSON.stringify(r2));
  ok("11 940 kr är en vanlig order", r2?.niva === "vanlig");
  const r1 = orderMed(bild, o1);
  ok("Paket 2, 24 månader", r1?.paket === "Paket 2" && r1?.bindning === 24);
  ok("Elins första i dag", r1?.saljarensDagsantal === 1);
  ok("signerad samma dag är inte efterregistrerad", r1?.efterreg === false);
  ok("en äldre order har sin egen svenska dag", orderMed(bild, o10)?.dag === "2026-10-22");
  ok("Olles order i ett annat lag är inte med", !orderMed(bild, o12));
  const sept = forma({ senaste: [order(31, ELIN, "2026-10-23T09:00:00Z", { signed_on: "2026-09-29" })] });
  ok("en order signerad förra månaden räknas inte i månaden", sept.order[0]?.manaden === false, JSON.stringify(sept.order[0]));

  // --- Testhändelserna -------------------------------------------------------------------
  ok(
    "testhändelserna från de senaste tio minuterna, med giltig typ, i id-ordning",
    lika(bild.handelser, [
      { id: 4, typ: "forsta", tid: "2026-10-23T09:50:00.000Z" },
      { id: 5, typ: "order", tid: "2026-10-23T09:55:00.000Z" },
      { id: 7, typ: "stor", tid: "2026-10-23T09:58:00.000Z" },
    ]),
    JSON.stringify(bild.handelser),
  );
}

// -----------------------------------------------------------------------------
console.log("\nVisningen styr vad som lämnar servern");
{
  // R36: ordervärdet syns alltid, och kunden aldrig. De gamla brytarna läses inte längre.
  const gamla = forma({}, normalisera({ lag: LAG, visaVarde: false, visaKund: true }));
  ok("en gammal rad med visaVarde av visar ändå beloppen", orderMed(gamla, o4)?.belopp === 71820);
  ok("och ingen kund, fast visaKund står på", !/Bergs Bygg|Norrbygg|Linnea/.test(JSON.stringify(gamla)));
  ok("och brytarna följer inte med", !("visaVarde" in gamla.installningar) && !("visaKund" in gamla.installningar));
  const fast = forma({}, normalisera({ lag: LAG }));
  ok("stor affär är som standard 40 000 kr fast (R40)", orderMed(fast, o3)?.niva === "stor" && orderMed(fast, o2)?.niva === "vanlig");

  const hela = forma({}, normalisera({ lag: LAG, namn: "hela" }));
  ok("namnformen hela gäller den som visas med namn", hela.personer[k(ELIN)].namn === "Elin Berg");
  ok("men inte den som valt initialer", hela.personer[k(JONAS)].namn === "J. K.");
  ok("och inte den dolda", hela.personer[k(AMIRA)].namn === "En säljare" && !/haddad/i.test(JSON.stringify(hela)));

  const tioDagar = forma({}, normalisera({ lag: LAG, firande: { efterregistreradDagar: 10 } }));
  ok("efterregistrerad följer inställningen", orderMed(tioDagar, o4)?.efterreg === false);
}

// -----------------------------------------------------------------------------
console.log("\nDold åt det säkra hållet");
{
  // Bara "namn" och "initialer" visar något. Allt annat är dolt, både namnet och motivet.
  for (const display of ["x", null, "Namn", "NAMN", " initialer", "", 0, undefined]) {
    const bild = forma({
      val: [
        { employee_id: AMIRA, display: "dold" },
        { employee_id: JONAS, display },
      ],
    });
    const p = bild.personer[k(JONAS)];
    ok(
      `visningen ${JSON.stringify(display) ?? "undefined"} ger ett dolt namn och ingen rad i topplistan`,
      p?.namn === "En säljare" && p?.initialer === "·" && p?.dold === true && !bild.saljare.some((r) => r.person === k(JONAS)) &&
        !/jonas|kim\b/i.test(JSON.stringify(bild)),
      JSON.stringify(p),
    );
  }

  // Ingen rad i salesboard_person: inget val gjort, och då visas namnet.
  const utanVal = forma({ val: [] });
  ok(
    "utan rad visas säljaren med namn",
    lika(utanVal.personer[k(AMIRA)], { nyckel: k(AMIRA), namn: "Amira H.", initialer: "AH", dold: false }),
    JSON.stringify(utanVal.personer[k(AMIRA)]),
  );

  // En order vars säljare inte finns bland personerna: inget namn att visa, alltså
  // dold. Utan lag, annars hade laget redan tagit bort hennes order.
  const okand = forma({ lag: null, personer: PERSONER.filter((p) => p.id !== ELIN) }, normalisera({}));
  const e = okand.personer[k(ELIN)];
  ok(
    "en säljare som saknas bland personerna är dold",
    e?.namn === "En säljare" && e?.dold === true && !okand.saljare.some((r) => r.person === k(ELIN)),
    JSON.stringify(e),
  );
}

// -----------------------------------------------------------------------------
console.log("\nLaget");
{
  const alla = forma({ lag: null }, normalisera({}));
  ok("utan lag gäller alla", alla.lag === null);
  ok("Olles order räknas", alla.manad.antal === 10 && alla.idag.antal === 5, `${alla.manad.antal} ${alla.idag.antal}`);
  ok("och står först i listan", alla.order[0]?.nyckel === k(o12.id));
  ok("Olle är med bland personerna", k(OLLE) in alla.personer);
  ok("utan mål i inställningarna finns inget mål", alla.manad.mal === null && alla.manad.forvantat === null, String(alla.manad.mal));
  ok("Olle står i topplistan", alla.saljare.some((r) => r.person === k(OLLE)));
  ok("Olles statistik följer med", orderMed(alla, o12)?.forstaNagonsin === false && orderMed(alla, o12)?.saljarensBasta === 4);
}

// -----------------------------------------------------------------------------
console.log("\nStor affär");
{
  const belopp = forma({}, normalisera({ lag: LAG, firande: { storAffar: { lage: "belopp", belopp: 50000 } } }));
  ok("ett fast belopp: 45 000 kr är vanlig", orderMed(belopp, o3)?.niva === "vanlig");
  ok("ett fast belopp: 71 820 kr är stor", orderMed(belopp, o4)?.niva === "stor");

  const fa = forma({ statistik: { ...STATISTIK, antal90: 19 } });
  ok("p90 ur nitton order litas inte på: 30 000 kr gäller", orderMed(fa, o3)?.niva === "stor" && orderMed(fa, o1)?.niva === "vanlig");
  const hog = forma({ statistik: { ...STATISTIK, p90: 50000 } });
  ok("p90 50 000 kr gör 45 000 kr vanlig", orderMed(hog, o3)?.niva === "vanlig" && orderMed(hog, o4)?.niva === "stor");
  const lika_ = forma({ statistik: { ...STATISTIK, p90: 45000 } });
  ok("exakt tröskeln är en stor affär", orderMed(lika_, o3)?.niva === "stor");

  const AUTO = { lage: "auto", belopp: 30000 };
  ok("läget belopp ger beloppet", troskelFranStatistik(80000, 40, { lage: "belopp", belopp: 55000 }) === 55000);
  ok("auto med tjugo order ger p90", troskelFranStatistik(41234.5, 20, AUTO) === 41234.5);
  ok("auto med nitton order ger 30 000", troskelFranStatistik(41234.5, 19, AUTO) === 30000);
  ok("auto utan p90 ger 30 000", troskelFranStatistik(null, 25, AUTO) === 30000);
  ok("auto utan underlag ger 30 000, inte det fasta beloppet", troskelFranStatistik(null, 0, { lage: "auto", belopp: 99000 }) === 30000);

  // Samma regel som `storAffarTroskel`, som räknar percentilen själv.
  const tjugo = Array.from({ length: 20 }, (_, i) => (i + 1) * 1000);
  const nitton = tjugo.slice(0, 19);
  ok("p90 av 1 000–20 000 är 18 100 som i percentile_cont", storAffarTroskel(tjugo, AUTO) === 18100);
  ok("samma svar med tjugo värden", troskelFranStatistik(18100, 20, AUTO) === storAffarTroskel(tjugo, AUTO));
  ok("samma svar med nitton värden", troskelFranStatistik(17100, 19, AUTO) === storAffarTroskel(nitton, AUTO));
  ok("samma svar utan värden", troskelFranStatistik(null, 0, AUTO) === storAffarTroskel([], AUTO));
  ok(
    "samma svar i läget belopp",
    troskelFranStatistik(18100, 20, { lage: "belopp", belopp: 12345 }) === storAffarTroskel(tjugo, { lage: "belopp", belopp: 12345 }),
  );

  // Gränserna är `regler.ts`:s egna konstanter, inte kopior, och de är specens tal.
  ok("tjugo order och 30 000 kr, som i specen", MINSTA_UNDERLAG === 20 && RESERV_TROSKEL === 30000);
  ok("en order för lite ger reserven", troskelFranStatistik(41234.5, MINSTA_UNDERLAG - 1, AUTO) === RESERV_TROSKEL);
  ok("precis nog ger p90", troskelFranStatistik(41234.5, MINSTA_UNDERLAG, AUTO) === 41234.5);
}

// -----------------------------------------------------------------------------
console.log("\nUtan statistik (0250 är inte körd)");
{
  const bild = forma({ statistik: null });
  ok("ingen order är någons första", bild.order.every((o) => o.forstaNagonsin === false));
  ok("ingen har en bästa dag", bild.order.every((o) => o.saljarensBasta === 0));
  ok("laget har ingen bästa dag", bild.idag.bastaDag === 0);
  ok("tröskeln är 30 000 kr", orderMed(bild, o3)?.niva === "stor" && orderMed(bild, o1)?.niva === "vanlig");
  ok("utan testhändelser är listan tom", forma({ handelser: [] }).handelser.length === 0);
  ok("utan val visas alla med namn", forma({ val: [] }).personer[k(JONAS)].namn === "Jonas K.");
}

// -----------------------------------------------------------------------------
console.log("\nMålet och takten");
{
  // Arbetsdag 2: för tidigt för en prognos.
  const tva = forma({ manadens: [o5, o6], senaste: [o5, o6] }, INST, new Date("2026-10-02T10:00:00Z"));
  ok("arbetsdag 2 av 22", lika(tva.manad.dagar, { gangna: 2, totalt: 22 }), JSON.stringify(tva.manad.dagar));
  ok("prognosen är null vid gångna 2", tva.manad.prognos === null);

  const tre = forma({ manadens: [o5, o6, o7], senaste: [o5, o6, o7] }, INST, new Date("2026-10-05T10:00:00Z"));
  ok("arbetsdag 3 ger en prognos: värdet × 22 / 3", tre.manad.prognos === Math.round((65_760 * 22) / 3), String(tre.manad.prognos));
  const tom = forma({ manadens: [], senaste: [] }, INST, new Date("2026-10-05T10:00:00Z"));
  ok("utan order ingen prognos", tom.manad.antal === 0 && tom.manad.varde === 0 && tom.manad.prognos === null && tom.manad.storsta === null);

  // Målet ärvs: utan eget mål i november gäller oktobers.
  const nov = forma({ manadens: [], senaste: [] }, INST, new Date("2026-11-10T10:00:00Z"));
  ok("en månad utan eget mål ärver det senaste", nov.manad.mal === 300_000, String(nov.manad.mal));
  const inget = forma({}, normalisera({ lag: LAG }));
  ok(
    "utan mål finns ingen takt och inget nått",
    inget.manad.mal === null && inget.manad.forvantat === null && inget.manad.natt === null,
    JSON.stringify(inget.manad),
  );
  ok("men antalet, värdet och prognosen finns", inget.manad.antal === 9 && inget.manad.varde === 248_340 && inget.manad.prognos === 321_381);
}

// -----------------------------------------------------------------------------
console.log("\nNär målet nåddes");
{
  const a1 = order(31, ELIN, "2026-10-01T08:00:00Z");
  const a2 = order(32, JONAS, "2026-10-02T08:00:00Z");
  const a3 = order(33, AMIRA, "2026-10-05T10:00:00Z");
  const a4 = order(34, ELIN, "2026-10-06T10:00:00Z");
  const natt = (manadens, mal = 40_000) => forma({ manadens, senaste: [] }, normalisera({ lag: LAG, mal: { "2026-10": mal } })).manad;

  ok("den tredje godkända tar värdet över 40 000 kr", natt([a4, a1, a3, a2]).natt === "2026-10-05T10:00:00.000Z");

  // En makulering före den 5:e: laget stod på 35 880 kr när den tredje kom.
  const tidig = order(35, JONAS, "2026-09-20T10:00:00Z", { status: "makulerad", cancelled_on: "2026-10-03", cancel_period_month: "2026-10-01" });
  const m = natt([a4, a1, a3, a2, tidig]);
  ok("en makulering före skjuter fram natt till nästa order", m.varde === 53_820 && m.natt === "2026-10-06T10:00:00.000Z", `${m.varde} ${m.natt}`);

  // Makuleringen bär bara ett datum. Samma dag räknas den efter dagens godkännanden.
  const sammaDag = { ...tidig, id: oid(36), cancelled_on: "2026-10-05" };
  ok("en makulering samma dag räknas efter dagens order", natt([a4, a1, a3, a2, sammaDag]).natt === "2026-10-05T10:00:00.000Z");
  ok("ett mål som inte nåtts ger null", natt([a1, a2, a3, a4], 80_000).natt === null);
}

// -----------------------------------------------------------------------------
console.log("\nOrderlistan");
{
  // Tio i dag och fem äldre: alla tio är med, och inget mer.
  const idag = Array.from({ length: 10 }, (_, i) => order(100 + i, ELIN, new Date(Date.parse("2026-10-23T06:00:00Z") + i * 300_000).toISOString()));
  const aldre = Array.from({ length: 5 }, (_, i) => order(120 + i, JONAS, `2026-10-${18 + i}T10:00:00Z`));
  const tio = forma({ manadens: [...idag, ...aldre], senaste: [...aldre, ...idag] });
  ok("alla tio godkända i dag är med", tio.order.length === 10 && tio.order.every((o) => o.dag === "2026-10-23"), String(tio.order.length));
  ok("den nyaste först", tio.order[0]?.nyckel === k(oid(109)) && tio.order[9]?.nyckel === k(oid(100)));
  ok("Elins dagsantal räknas i tidsordning", tio.order.map((o) => o.saljarensDagsantal).join(",") === "10,9,8,7,6,5,4,3,2,1");
  ok("dagens antal är tio", tio.idag.antal === 10);

  // Två i dag och tolv äldre: de åtta senaste.
  const tvaIdag = [order(200, ELIN, "2026-10-23T07:00:00Z"), order(201, JONAS, "2026-10-23T08:00:00Z")];
  const tolv = Array.from({ length: 12 }, (_, i) => order(210 + i, JONAS, `2026-10-${String(11 + i).padStart(2, "0")}T10:00:00Z`));
  const atta = forma({ manadens: [...tvaIdag, ...tolv], senaste: [...tolv, ...tvaIdag] });
  ok("de åtta senaste när dagen har färre", atta.order.length === 8, String(atta.order.length));
  ok(
    "dagens två och de sex senaste före, den nyaste först",
    lika(atta.order.map((o) => o.nyckel), [201, 200, 221, 220, 219, 218, 217, 216].map((n) => k(oid(n)))),
  );

  // Fjorton dagar räknas i svenska dagar: 9 oktober är med, 8 oktober är det inte.
  const fore = order(260, ELIN, "2026-10-08T21:30:00Z"); // 23:30 den 8:e
  const efter = order(261, ELIN, "2026-10-08T22:30:00Z"); // 00:30 den 9:e
  const grans = forma({ manadens: [fore, efter], senaste: [fore, efter] });
  ok("fjorton dagar bakåt i svensk tid", lika(grans.order.map((o) => o.nyckel), [k(efter.id)]), JSON.stringify(grans.order.map((o) => o.dag)));

  // Lika tid: id:t avgör, åt samma håll i listan och i räkningen.
  const f1 = order(51, ELIN, "2026-10-23T07:00:00Z");
  const f2 = order(52, ELIN, "2026-10-23T07:00:00Z");
  const f3 = order(53, ELIN, "2026-10-22T22:30:00Z"); // 00:30 svensk tid den 23:e
  const tid = forma({ manadens: [f1, f2, f3], senaste: [f1, f2, f3] });
  ok("lika tid: högre id står först", lika(tid.order.map((o) => o.nyckel), [f2, f1, f3].map((o) => k(o.id))));
  ok("halv ett på natten svensk tid är i dag", orderMed(tid, f3)?.dag === "2026-10-23" && tid.idag.antal === 3);
  ok(
    "dagsantalet följer samma ordning",
    orderMed(tid, f3)?.saljarensDagsantal === 1 && orderMed(tid, f1)?.saljarensDagsantal === 2 && orderMed(tid, f2)?.saljarensDagsantal === 3,
  );

  // Makulerade order syns inte och räknas inte. Betalda gör det.
  const g1 = order(61, ELIN, "2026-10-23T07:00:00Z", { status: "makulerad", cancelled_on: "2026-10-23", cancel_period_month: "2026-10-01" });
  const g2 = order(62, ELIN, "2026-10-23T08:00:00Z");
  const g3 = order(63, JONAS, "2026-10-23T09:00:00Z", { status: "betald", order_value: "45000.00" });
  const g4 = order(64, JONAS, "2026-10-23T09:30:00Z", { order_value: null, order_value_source: null, term_months: null });
  const g5 = order(65, JONAS, "2026-10-23T09:35:00Z", { package_id: 9 });
  const g = forma({ manadens: [g1, g2, g3, g4, g5], senaste: [g1, g2, g3, g4, g5] });
  ok("en makulerad order syns inte", !orderMed(g, g1));
  ok("och räknas inte i dag", g.idag.antal === 4, String(g.idag.antal));
  ok("Elins dagsantal hoppar över den", orderMed(g, g2)?.saljarensDagsantal === 1);
  ok("en betald order är med", orderMed(g, g3)?.niva === "stor");
  ok("ett belopp som text läses som tal", orderMed(g, g3)?.belopp === 45000);
  ok("ett saknat belopp är null och en vanlig order", orderMed(g, g4)?.belopp === null && orderMed(g, g4)?.niva === "vanlig");
  ok("dagens summa räknar ett saknat belopp som noll", g.idag.summa === 17940 + 45000 + 0 + 17940, String(g.idag.summa));
  ok("utan bindningstid står bara paketet", orderMed(g, g4)?.paket === "Paket 2" && orderMed(g, g4)?.bindning === null);
  ok("ett paket som inte finns är en fri order", orderMed(g, g5)?.paket === "Fri order");
}

// -----------------------------------------------------------------------------
console.log("\nFönstren");
{
  ok(
    "en fredag i oktober",
    lika(tavlansFonster(NU), {
      idag: "2026-10-23",
      manad: "2026-10-01",
      // Svensk midnatt den 9 oktober, sommartid.
      senasteFran: "2026-10-08T22:00:00.000Z",
      handelserFran: "2026-10-23T09:50:00.000Z",
    }),
    JSON.stringify(tavlansFonster(NU)),
  );
  const jan = forma({ manadens: [], senaste: [] }, INST, new Date("2026-01-15T10:00:00Z"));
  ok("grafen i januari börjar i februari året före", jan.historik[0].nyckel === "2025-02" && jan.historik[10].nyckel === "2025-12");
  ok("dagen är svensk: 23:30 UTC den 31 december är nyårsdagen", tavlansFonster(new Date("2026-12-31T23:30:00Z")).manad === "2027-01-01");
  ok("vintertid: svensk midnatt är 23:00 UTC", tavlansFonster(new Date("2026-12-15T10:00:00Z")).senasteFran === "2026-11-30T23:00:00.000Z");
}

// -----------------------------------------------------------------------------
console.log("\nStatistiken ur databasen");
{
  ok("null ger null", lasStatistik(null) === null);
  ok("en sträng ger null", lasStatistik("x") === null);
  ok("en lista ger null", lasStatistik([]) === null);
  ok(
    "ett tomt objekt ger tomma standarder",
    lika(lasStatistik({}), { saljare: [], manader: [], p90: null, antal90: 0, bastaDag: 0 }),
    JSON.stringify(lasStatistik({})),
  );
  const s = lasStatistik({
    saljare: [{ id: ELIN, forsta: oid(1), basta: 2 }, { id: 5, forsta: oid(2), basta: 1 }, null, { id: JONAS, forsta: null, basta: "3" }],
    p90: 40000.5,
    antal90: 25,
    bastaDag: 3,
    manader: [{ manad: "2026-09-01", antal: 22, varde: 639_962 }, { manad: "2026-09", antal: 1, varde: 1 }, { manad: "2026-08-01", antal: -1, varde: "x" }],
  });
  ok(
    "giltiga säljare läses, skräp hoppas över, en bästa dag som inte är ett tal blir noll",
    lika(s, {
      saljare: [
        { id: ELIN, forsta: oid(1), basta: 2 },
        { id: JONAS, forsta: null, basta: 0 },
      ],
      manader: [
        { manad: "2026-09-01", antal: 22, varde: 639_962 },
        { manad: "2026-08-01", antal: -1, varde: 0 },
      ],
      p90: 40000.5,
      antal90: 25,
      bastaDag: 3,
    }),
    JSON.stringify(s),
  );
  ok(
    "fel typer ger standarderna",
    lika(lasStatistik({ saljare: "x", p90: "40000", antal90: null, bastaDag: -2 }), { saljare: [], manader: [], p90: null, antal90: 0, bastaDag: 0 }),
  );
}

// -----------------------------------------------------------------------------
console.log("\nEn tabell eller funktion som inte finns än");
{
  for (const code of ["42P01", "PGRST205", "PGRST202", "42883"]) {
    ok(`${code} betyder att 0250 inte är körd`, saknasIDatabasen({ code, message: "finns inte" }) === true);
  }
  for (const x of [null, undefined, {}, { code: "23505" }, { code: "PGRST116" }, { code: "42501" }, { code: "42703" }, "42P01", { code: 42 }]) {
    ok(`${JSON.stringify(x) ?? "undefined"} är ett annat fel`, saknasIDatabasen(x) === false);
  }

  // Läsningens tre lägen. Bara de fyra koderna ovan är "saknas". Allt annat som
  // inte är ett svar är ett riktigt fel, och det ger 503.
  ok("inget fel är ett svar", lasningen(null) === "svar" && lasningen(undefined) === "svar");
  for (const code of ["42P01", "PGRST205", "PGRST202", "42883"]) ok(`${code} är saknas`, lasningen({ code }) === "saknas");
  for (const x of [{ code: "42501" }, { code: "PGRST116" }, { code: "57014" }, { code: "08006" }, { message: "fetch failed" }, "42P01"]) {
    ok(`${JSON.stringify(x)} är ett riktigt fel`, lasningen(x) === "fel");
  }

  // Säljarnas val. Före 0250 finns inga val, och då visas namnen. Har statistiken
  // eller händelserna svarat är 0250 körd, och då är en tabell som saknas ett fel:
  // annars hade varje dold säljare visats med namn.
  ok("valen svarade: raderna gäller", personvalen("svar", ["saknas", "saknas"]) === "rader");
  ok("valen gick fel: fel", personvalen("fel", ["svar", "svar"]) === "fel");
  ok("allt saknas: inga val, som före 0250", personvalen("saknas", ["saknas", "saknas"]) === "inga");
  ok("valen saknas men statistiken svarade: fel", personvalen("saknas", ["svar", "saknas"]) === "fel");
  ok("valen saknas men händelserna svarade: fel", personvalen("saknas", ["saknas", "svar"]) === "fel");

  // Skärmen. En välformad token finns bara efter 0250, så en tabell som saknas
  // är ett fel (503) och aldrig "inte parad" (401).
  ok("skärmen finns", skarmbeslut("svar", true) === "skarm");
  ok("ingen skärm med den token: inte parad", skarmbeslut("svar", false) === "ingen");
  ok("tabellen saknas: fel, inte 401", skarmbeslut("saknas", false) === "fel");
  ok("uppslaget gick fel: fel, inte 401", skarmbeslut("fel", false) === "fel");
}

// -----------------------------------------------------------------------------
console.log("\nDen inloggade");
{
  const med = (status) => ({ employee: { status } });
  const utan = { employee: null };
  ok("ingen session: nej", personbeslut(null) === "nej");
  ok("aktiv: in", personbeslut(med("active")) === "in");
  ok("håller på att börja: in", personbeslut(med("onboarding")) === "in");
  ok("har slutat: nej", personbeslut(med("offboarded")) === "nej");
  ok("en okänd status: nej", personbeslut(med("")) === "nej" && personbeslut(med("Active")) === "nej");
  // En session utan employee: getCurrentUser() skiljer inte på ett konto utan
  // anställning och en läsning som gick fel, så raden läses en gång till.
  ok("session utan employee: läs själv", personbeslut(utan) === "las");
  ok("den egna läsningen gick fel: 503", personbeslut(utan, { fel: true, status: null }) === "fel");
  ok("ingen rad: ett konto utan anställning, 401", personbeslut(utan, { fel: false, status: null }) === "nej");
  ok("raden finns och är aktiv: getCurrentUser tappade den, 503", personbeslut(utan, { fel: false, status: "active" }) === "fel");
  ok("raden finns och håller på att börja: 503", personbeslut(utan, { fel: false, status: "onboarding" }) === "fel");
  ok("raden finns och har slutat: 401", personbeslut(utan, { fel: false, status: "offboarded" }) === "nej");
  ok("employee avgör när den finns", personbeslut(med("active"), { fel: true, status: null }) === "in");
}

// -----------------------------------------------------------------------------
console.log("\nKakorna");
{
  const NU_MS = Date.parse("2026-10-23T10:00:00Z");
  const DYGN = 86_400_000;
  const flaggor = { httpOnly: true, secure: true, sameSite: "lax", path: "/salesboard" };

  ok("namnen", SKARMKAKA === "nav_tavla" && SKARMKAKA_TID === "nav_tavla_t" && PARKAKA === "nav_tavla_par");
  ok("flaggorna: HttpOnly, Secure, SameSite=Lax, bara /salesboard", lika({ ...KAKA }, flaggor), JSON.stringify(KAKA));
  ok("skärmkakan lever i 400 dagar", SKARMKAKA_LIVSTID === 400 * 86_400 && SKARMKAKA_LIVSTID === 34_560_000);
  ok("parningskakan lever i 900 s", PARKAKA_LIVSTID === 900);

  const token = nyToken();
  ok(
    "skärmkakan och tiden den sattes",
    lika(skarmkakor(token, NU_MS), [
      { namn: "nav_tavla", varde: token, val: { ...flaggor, maxAge: 34_560_000 } },
      { namn: "nav_tavla_t", varde: String(NU_MS), val: { ...flaggor, maxAge: 34_560_000 } },
    ]),
    JSON.stringify(skarmkakor(token, NU_MS)),
  );
  ok("parningskakan", lika(parkaka(token), { namn: "nav_tavla_par", varde: token, val: { ...flaggor, maxAge: 900 } }));
  ok(
    "parningskakan tas bort på samma sökväg",
    lika(parkakanBort(), { namn: "nav_tavla_par", varde: "", val: { ...flaggor, maxAge: 0 } }),
  );

  // Förnyelsen: när kakan sattes för mer än ett dygn sedan, eller när tiden saknas
  // eller inte går att lita på.
  ok("utan tid förnyas kakan", skarmkakanBehoverFornyas(undefined, NU_MS) === true);
  ok("en tom tid förnyas", skarmkakanBehoverFornyas("", NU_MS) === true);
  ok("skräp förnyas", skarmkakanBehoverFornyas("igår", NU_MS) === true);
  ok("satt nyss: ingen förnyelse", skarmkakanBehoverFornyas(String(NU_MS - 60_000), NU_MS) === false);
  ok("exakt ett dygn är inte mer än ett dygn", skarmkakanBehoverFornyas(String(NU_MS - DYGN), NU_MS) === false);
  ok("mer än ett dygn: förnyas", skarmkakanBehoverFornyas(String(NU_MS - DYGN - 1), NU_MS) === true);
  ok("en tid i framtiden går inte att lita på: förnyas", skarmkakanBehoverFornyas(String(NU_MS + 60_000), NU_MS) === true);

  ok("en token ur nyToken är välformad", arToken(token));
  ok(
    "för kort, för lång, fel tecken och ingenting är ingen token",
    !arToken(token.slice(1)) && !arToken(`${token}A`) && !arToken(`${token.slice(1)}+`) && !arToken(`${token.slice(1)}=`) &&
      !arToken("") && !arToken(undefined) && !arToken(null),
  );
}

// -----------------------------------------------------------------------------
console.log("\nAdressen");
{
  const h = (o) => new Headers(o);
  ok("första adressen i x-forwarded-for", klientIp(h({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })) === "203.0.113.7");
  ok("annars x-real-ip", klientIp(h({ "x-real-ip": "198.51.100.4" })) === "198.51.100.4");
  ok("skräp i x-forwarded-for: då x-real-ip", klientIp(h({ "x-forwarded-for": "unknown", "x-real-ip": "198.51.100.4" })) === "198.51.100.4");
  ok("IPv6", klientIp(h({ "x-forwarded-for": "2001:db8::1" })) === "2001:db8::1");
  ok("IPv4 i IPv6 blir IPv4", klientIp(h({ "x-forwarded-for": "::ffff:203.0.113.7" })) === "203.0.113.7");
  ok("en zon går inte in i inet", klientIp(h({ "x-forwarded-for": "fe80::1%eth0" })) === null);
  ok("en port är ingen adress", klientIp(h({ "x-forwarded-for": "203.0.113.7:443" })) === null);
  ok("hakparenteser är ingen adress", klientIp(h({ "x-forwarded-for": "[2001:db8::1]" })) === null);
  ok("ingen rubrik: null", klientIp(h({})) === null);

  ok("en IPv4-adress är sin egen hink", adresshink("203.0.113.7") === "203.0.113.7");
  ok("en IPv6-adress hinkas på sitt /64", adresshink("2001:db8:1:2:aaaa::1") === "2001:db8:1:2::/64");
  ok("samma /64 skrivet på ett annat sätt", adresshink("2001:0DB8:0001:0002:ffff:0:0:9") === "2001:db8:1:2::/64");
  ok("ett annat /64", adresshink("2001:db8:1:3::1") === "2001:db8:1:3::/64");
  ok(":: först och sist", adresshink("::1") === "0:0:0:0::/64" && adresshink("2001:db8::") === "2001:db8:0:0::/64");
  ok("åtta grupper", adresshink("1:2:3:4:5:6:7:8") === "1:2:3:4::/64");
  ok("IPv4 sist i en IPv6-adress", adresshink("1:2:3:4:5:6:1.2.3.4") === "1:2:3:4::/64");
  ok("IPv4 i IPv6 hinkas som IPv4", adresshink("::ffff:203.0.113.7") === "203.0.113.7");
  ok("en okänd adress är en egen hink", adresshink(null) === "okänd");
  ok("webbläsaren kapas vid 300 tecken", webblasare(h({ "user-agent": "x".repeat(400) }))?.length === 300 && webblasare(h({})) === null);
}

// -----------------------------------------------------------------------------
console.log("\nKvoten för parningskoder");
{
  const mig = "203.0.113.7";
  const ggr = (n, ip) => Array.from({ length: n }, () => ip);
  ok("inga aktiva: ok", forMangaKoder([], mig) === false);
  ok("fyra från samma adress: ok", forMangaKoder(ggr(4, mig), mig) === false);
  ok("fem från samma adress: 429", forMangaKoder(ggr(5, mig), mig) === true);
  ok("fem från en annan adress: ok", forMangaKoder(ggr(5, "198.51.100.4"), mig) === false);
  ok(
    "fem från samma /64: 429",
    forMangaKoder(["2001:db8:1:2::1", "2001:db8:1:2::2", "2001:db8:1:2::3", "2001:db8:1:2:ffff::4", "2001:db8:1:2:1:2:3:4"], "2001:db8:1:2::99") === true,
  );
  ok("fem från ett annat /64: ok", forMangaKoder(ggr(5, "2001:db8:1:3::1"), "2001:db8:1:2::99") === false);
  const olika = (n) => Array.from({ length: n }, (_, i) => `198.51.100.${i + 1}`);
  ok("49 aktiva i hela tabellen: ok", forMangaKoder(olika(49), mig) === false);
  ok("50 aktiva i hela tabellen: 429", forMangaKoder(olika(50), mig) === true);
  ok("utan adress delar alla utan adress på fem", forMangaKoder(ggr(5, null), null) === true && forMangaKoder(ggr(4, null), null) === false);
  ok("IPv4 i IPv6 räknas som samma IPv4", forMangaKoder(ggr(5, "::ffff:203.0.113.7"), mig) === true);
}

// -----------------------------------------------------------------------------
console.log("\nParningen: TV:ns fråga");
{
  const NU_MS = Date.parse("2026-10-23T10:00:00Z");
  const om = (ms) => new Date(NU_MS + ms).toISOString();
  const SKARM = "5c5c5c5c-0000-4000-8000-000000000001";
  ok("ingen kaka eller ingen rad: 410", lika(parningsbeslut(null, NU_MS), { typ: "utgangen" }));
  ok("väntar på admin", lika(parningsbeslut({ expires_at: om(60_000), screen_id: null }, NU_MS), { typ: "vanta" }));
  ok("gått ut utan godkännande: 410", lika(parningsbeslut({ expires_at: om(0), screen_id: null }, NU_MS), { typ: "utgangen" }));
  ok("en tid som inte går att läsa: 410", lika(parningsbeslut({ expires_at: "igår", screen_id: null }, NU_MS), { typ: "utgangen" }));
  ok("godkänd: lös in", lika(parningsbeslut({ expires_at: om(60_000), screen_id: SKARM }, NU_MS), { typ: "los_in", skarmId: SKARM }));
  ok(
    "godkänd medan den gällde och sedan gått ut: lös in ändå",
    lika(parningsbeslut({ expires_at: om(-30_000), screen_id: SKARM }, NU_MS), { typ: "los_in", skarmId: SKARM }),
  );
  ok("en kod som redan finns är 23505", arKodkrock({ code: "23505", message: "duplicate key" }) === true);
  ok("andra fel är ingen krock", arKodkrock({ code: "23503" }) === false && arKodkrock(null) === false && arKodkrock({ code: "PGRST205" }) === false);
}

// -----------------------------------------------------------------------------
console.log("\nNycklarna");
{
  const n = nyckelFor(ELIN);
  ok("tolv små hextecken", /^[0-9a-f]{12}$/.test(n), n);
  ok("sha256 av tavla: och id:t", n === createHash("sha256").update(`tavla:${ELIN}`).digest("hex").slice(0, 12));
  ok("samma id ger samma nyckel", nyckelFor(ELIN) === n);
  ok("olika id ger olika nycklar", nyckelFor(AMIRA) !== n && nyckelFor(oid(1)) !== nyckelFor(oid(2)));
  ok("nyckeln är inte början av id:t", !ELIN.replace(/-/g, "").startsWith(n));
}

// -----------------------------------------------------------------------------
console.log("\nTävlingen och vinnaren");
{
  const ID = "0123456789abcdef01234567";
  const PA = normalisera({ ...INST, tavling: { "2026-10": { pa: true, pris: "Spa för två", bild: ID, grans: 120_000 } } });
  const b = forma({}, PA);
  ok("en påslagen tävling står i bilden", lika(b.tavling, { pris: "Spa för två", bild: `/salesboard/bild?id=${ID}`, grans: 120_000, dagarKvar: 5 }), JSON.stringify(b.tavling));
  ok("inställningarna i bilden bär inga tävlingar", !("tavling" in b.installningar) && !("mal" in b.installningar));
  ok("utan tävling är fältet null", forma().tavling === null && forma().vinnare === null);
  const AV = normalisera({ ...INST, tavling: { "2026-10": { pa: false, pris: "Spa för två" } } });
  ok("en avslagen tävling ger null: tavlan visar ingenting", forma({}, AV).tavling === null);
  ok("en tävling i september gäller inte i oktober", forma({}, normalisera({ ...INST, tavling: { "2026-09": { pa: true, pris: "Hörlurar" } } })).tavling === null);
  ok("utan bild är adressen null", forma({}, normalisera({ ...INST, tavling: { "2026-10": { pa: true, pris: "Hörlurar" } } })).tavling.bild === null);

  // Första arbetsdagen i november, måndag 2 november 2026: oktobers vinnare.
  const MAN = new Date("2026-11-02T08:30:00Z");
  const okt = (n, vem, kr) => order(n, vem, `2026-10-${String(10 + (n % 10)).padStart(2, "0")}T10:00:00Z`, { order_value: kr, order_value_source: "manual" });
  const forra = [okt(31, ELIN, 40_000), okt(32, ELIN, 25_000), okt(33, JONAS, 50_000), okt(34, AMIRA, 90_000), okt(35, OLLE, 100_000)];
  const NOV = (grans, pa = true) => normalisera({ ...INST, tavling: { "2026-10": { pa, pris: "Spa för två", bild: ID, grans } } });
  const v = forma({ manadens: [], senaste: [], forraManadens: forra }, NOV(60_000), MAN).vinnare;
  ok("vinnaren är den med högst ordervärde i laget, utan den dolda", lika(v?.personer, [k(ELIN)]) && v.varde === 65_000, JSON.stringify(v));
  ok("vinnaren bär månaden, priset och bilden", v?.nyckel === "2026-10" && v.manad === "oktober" && v.pris === "Spa för två" && v.bild === `/salesboard/bild?id=${ID}`);
  ok("vinnaren står i personerna", forma({ manadens: [], senaste: [], forraManadens: forra }, NOV(60_000), MAN).personer[k(ELIN)]?.namn === "Elin B.");
  const ingen = forma({ manadens: [], senaste: [], forraManadens: forra }, NOV(70_000), MAN).vinnare;
  ok("når ingen gränsen vinner ingen", lika(ingen?.personer, []) && ingen.varde === null && ingen.grans === 70_000, JSON.stringify(ingen));
  const lika2 = [okt(41, ELIN, 50_000), okt(42, JONAS, 50_000)];
  const delad = forma({ manadens: [], senaste: [], forraManadens: lika2 }, NOV(null), MAN).vinnare;
  ok("lika i toppen delar priset", lika(delad?.personer, [k(ELIN), k(JONAS)].sort()) && delad.varde === 50_000, JSON.stringify(delad));
  ok("utan order vinner ingen", lika(forma({ manadens: [], senaste: [], forraManadens: [] }, NOV(null), MAN).vinnare?.personer, []));
  ok("vinnaren visas bara första arbetsdagen", forma({ forraManadens: forra }, NOV(null), new Date("2026-11-03T08:30:00Z")).vinnare === null);
  ok("och bara om förra månadens tävling var på", forma({ forraManadens: forra }, NOV(null, false), MAN).vinnare === null);
  ok("vinnarensManad säger när förra månaden läses", vinnarensManad(NOV(null), MAN) === "2026-10-01" && vinnarensManad(NOV(null), NU) === null && vinnarensManad(NOV(null, false), MAN) === null);
  const lordag = new Date("2026-08-01T08:30:00Z");
  ok("en månad som börjar en lördag: vinnaren på måndagen", vinnarensManad(normalisera({ tavling: { "2026-07": { pa: true, pris: "x" } } }), lordag) === null
    && vinnarensManad(normalisera({ tavling: { "2026-07": { pa: true, pris: "x" } } }), new Date("2026-08-03T08:30:00Z")) === "2026-07-01");
}

console.log("\nParningens hash");
{
  // Rutten hashar koden ur `nyKod`, admin skriver in den med streck och små
  // bokstäver, och inställningarna hashar `normaliseraKod` av det. De måste mötas.
  const koder = Array.from({ length: 200 }, () => nyKod());
  ok(
    "en kod som skrivits av från TV:n normaliseras till samma kod",
    koder.every((kod) => normaliseraKod(` ${visaKod(kod).toLowerCase()} `) === kod),
  );
  ok("och ger samma hash", hasha(normaliseraKod("k7m4-qx9p")) === hasha("K7M4QX9P"));
  ok("koden med streck ger en annan hash, därför hashas den normaliserade", hasha("K7M4-QX9P") !== hasha("K7M4QX9P"));
}

console.log(fel === 0 ? "\n\x1b[32mAllt grönt.\x1b[0m\n" : `\n\x1b[31m${fel} fel.\x1b[0m\n`);
process.exit(fel ? 1 : 0);
