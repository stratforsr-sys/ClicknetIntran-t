#!/usr/bin/env node
/**
 * Nav 2.0, Möten (B2): de rena talen på Mötessidan. Talen räknas fram ur
 * raderna vid läsning, så provet matar funktionerna med en fast datamängd:
 * tre säljare, veckan 2026-10-26 till 2026-11-01 och fem kedjor.
 *
 *   TZ=UTC node --experimental-strip-types tests/motesstat.mjs
 */
import { vecka, veckotal, offerter, dagarTillMote, perKalla, bakom } from "../src/lib/nav2/motesstatforma.ts";
import * as forma from "../src/lib/nav2/motesstatforma.ts";

let fel = 0;
const ok = (namn, villkor) => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}`);
  if (!villkor) fel++;
};
// JSON.stringify gör NaN och Infinity till null och skulle släppa igenom en
// kvot som delat 0 med 0. Därför skrivs icke-ändliga tal ut som text.
const synliga = (_nyckel, varde) => (typeof varde === "number" && !Number.isFinite(varde) ? String(varde) : varde);
const text = (x) => JSON.stringify(x, synliga);
const lika = (namn, fas, vantat) => ok(`${namn} (fick ${text(fas)})`, text(fas) === text(vantat));

const S1 = "s1", S2 = "s2", S3 = "s3";
const V = { fran: "2026-10-26", till: "2026-11-01" };
const NU = new Date("2026-11-02T08:00:00Z");

// Tidsstämplar ligger mitt på dagen svensk tid (10:00Z), utom där provet
// uttryckligen vill testa att Stockholmsdagen och UTC-dagen skiljer sig.
const m = (id, kedja, o) => ({
  id, kedja, bokatAv: S1, hallsAv: S2, art: "ny", utfall: null, resultat: null, kalla: "dialer", ...o,
});
const k = (id, o) => ({
  id, forstaBokatAv: S1, forstaBokatNar: "2026-10-26T10:00:00Z", forstaMoteTid: null, forstaHallnaHallsAv: S2,
  avslut: null, avslutNar: null, affarForstaMote: false, offertNar: null, kolumn: null, kalla: "dialer", ...o,
});

// Fem kedjor. S1 bokade alla, S2 höll mötena.
const moten = [
  // k1: affär på första mötet
  m("m1", "k1", { bokatNar: "2026-10-26T10:00:00Z", moteTid: "2026-10-28T10:00:00Z", utfall: "hallet", resultat: "affar" }),
  // k2: offert som blev affär sex dagar senare
  m("m2", "k2", { bokatNar: "2026-10-26T08:00:00Z", moteTid: "2026-10-26T13:00:00Z", utfall: "hallet", resultat: "offert" }),
  // k3: nej
  m("m3", "k3", { bokatNar: "2026-10-26T10:00:00Z", moteTid: "2026-10-30T10:00:00Z", utfall: "hallet", resultat: "nej", kalla: "hemsida" }),
  // k4: uteblev, ombokad, hållen, därefter öppen offert, och ett uppföljningsmöte som ingen fört in utfallet för
  m("m4a", "k4", { bokatNar: "2026-10-27T10:00:00Z", moteTid: "2026-10-28T10:00:00Z", utfall: "uteblev" }),
  m("m4b", "k4", { bokatNar: "2026-10-28T10:00:00Z", moteTid: "2026-10-29T10:00:00Z", art: "ombokning", utfall: "hallet", resultat: "offert" }),
  m("m6", "k4", { bokatNar: "2026-10-29T10:00:00Z", moteTid: "2026-11-01T10:00:00Z", art: "uppfoljning" }),
  // ett uppföljningsmöte som ännu inte är över (08:00Z + 30 min är i framtiden mot nu 08:00Z)
  m("m8", "k4", { bokatNar: "2026-10-29T10:00:00Z", moteTid: "2026-11-02T07:40:00Z", art: "uppfoljning" }),
  // k5: avbokat
  m("m5", "k5", { bokatNar: "2026-10-27T10:00:00Z", moteTid: "2026-10-30T10:00:00Z", utfall: "avbokat", kalla: "hemsida" }),
  // S3: bokat 23:30Z söndag = måndag 26 okt i Sverige, ska räknas i veckan
  m("m7", "k7", { bokatAv: S3, hallsAv: S3, bokatNar: "2026-10-25T23:30:00Z", moteTid: "2026-10-27T10:00:00Z", kalla: "tips" }),
  // S3: bokat 23:30Z söndag 1 nov = måndag 2 nov i Sverige, hör till nästa vecka
  m("m10", "k10", { bokatAv: S3, hallsAv: S3, bokatNar: "2026-11-01T23:30:00Z", moteTid: "2026-11-05T10:00:00Z", kalla: "tips" }),
  // S3: bokat veckan innan, hållet inne i veckan, åtta dagar mellan
  m("m9", "k9", { bokatAv: S3, hallsAv: S3, bokatNar: "2026-10-20T10:00:00Z", moteTid: "2026-10-30T10:00:00Z", utfall: "hallet", kalla: "tips" }),
];
const kedjor = [
  k("k1", { forstaMoteTid: "2026-10-28T10:00:00Z", avslut: "affar", avslutNar: "2026-10-28T12:00:00Z", affarForstaMote: true }),
  k("k2", { forstaMoteTid: "2026-10-26T13:00:00Z", offertNar: "2026-10-26T13:00:00Z", avslut: "affar", avslutNar: "2026-11-01T10:00:00Z" }),
  k("k3", { forstaMoteTid: "2026-10-30T10:00:00Z", offertNar: "2026-10-28T10:00:00Z", avslut: "nej", avslutNar: "2026-10-30T14:00:00Z", kalla: "hemsida" }),
  k("k4", { forstaMoteTid: "2026-10-28T10:00:00Z", offertNar: "2026-10-29T12:00:00Z", kolumn: "folj_upp" }),
  k("k5", { forstaMoteTid: "2026-10-30T10:00:00Z", forstaHallnaHallsAv: null, avslut: "avbokat", avslutNar: "2026-10-29T10:00:00Z", kalla: "hemsida" }),
];

console.log("\n\x1b[1mvecka\x1b[0m");
lika("söndag 1 nov hör till veckan 26 okt–1 nov", vecka("2026-11-01"), V);
lika("måndag 26 okt är veckans första dag", vecka("2026-10-26"), V);
lika("onsdag mitt i veckan", vecka("2026-10-28"), V);
lika("måndag 2 nov börjar en ny vecka", vecka("2026-11-02"), { fran: "2026-11-02", till: "2026-11-08" });
lika("veckan går över månadsskifte och årsskifte", vecka("2026-12-31"), { fran: "2026-12-28", till: "2027-01-03" });

console.log("\n\x1b[1mveckotal, säljare 1 (bokade alla fem)\x1b[0m");
const t1 = veckotal(S1, V, moten, kedjor, 50, NU);
ok("samtal speglar det som skickades in", t1.samtal === 50);
ok("bokade = 5 (ombokning och uppföljning räknas inte)", t1.bokade === 5);
ok("per100 = 10,0 (5 av 50, en decimal)", t1.per100 === 10);
lika("hallna = 3 av 5", t1.hallna, { andel: 0.6, n: 3, av: 5 });
ok("raddade = 1 (ombokningen som blev hållen)", t1.raddade === 1);
ok("bokatTillAffar = 2", t1.bokatTillAffar === 2);
lika("affarer är säljare 2:s, inte säljare 1:s", t1.affarer, { andel: null, n: 0, av: 0 });

console.log("\n\x1b[1mveckotal, säljare 2 (höll mötena)\x1b[0m");
const t2 = veckotal(S2, V, moten, kedjor, 0, NU);
lika("affarer = 2 av 3", t2.affarer, { andel: 2 / 3, n: 2, av: 3 });
lika("forstaMote = 1 av 2", t2.forstaMote, { andel: 0.5, n: 1, av: 2 });
ok("oppnaOfferter = 1", t2.oppnaOfferter === 1);
ok("tysta = 0", t2.tysta === 0);
lika("hallna utan egna bokningar är – (andel null, inte NaN)", t2.hallna, { andel: null, n: 0, av: 0 });
ok("per100 är null när samtal = 0", t2.per100 === null);
ok("hallna.andel är exakt null, inte NaN", t2.hallna.andel === null);
ok("bokade = 0", t2.bokade === 0);
ok("utanUtfall = 1 (m6; m8 är inte över än)", t2.utanUtfall === 1);

console.log("\n\x1b[1mStockholmsdagen mot UTC-dagen\x1b[0m");
const t3 = veckotal(S3, V, moten, kedjor, 10, NU);
ok("bokat 25 okt 23:30Z (måndag i Sverige) räknas i veckan, m10 (23:30Z 1 nov = 2 nov i Sverige) inte", t3.bokade === 1);
lika("hallna räknas på mötestid, inte bokningstid", t3.hallna, { andel: 1, n: 1, av: 1 });
ok("utanUtfall räknar m7 (utfall saknas, över), inte m10 (i framtiden)", t3.utanUtfall === 1);

console.log("\n\x1b[1mtysta offerter\x1b[0m");
const medTyst = [...kedjor, k("k11", { offertNar: "2026-10-01T10:00:00Z", kolumn: "tyst" }), k("k12", { offertNar: null, kolumn: "bokat" })];
ok("en tyst offert syns i tysta oavsett vecka", veckotal(S2, V, moten, medTyst, 0, NU).tysta === 1);
ok("öppnaOfferter räknar inte den tysta", veckotal(S2, V, moten, medTyst, 0, NU).oppnaOfferter === 1);

console.log("\n\x1b[1mofferter\x1b[0m");
const o = offerter(medTyst, V);
ok("skickade = 3 (offertNar i veckan: k2, k3, k4)", o.skickade === 3);
ok("affar = 1", o.affar === 1);
ok("nej = 1", o.nej === 1);
ok("tysta = 1", o.tysta === 1);
ok("medianDagar = 6 (offert 26 okt, affär 1 nov)", o.medianDagar === 6);
ok("medianDagar är null utan affärer", offerter([kedjor[2]], V).medianDagar === null);
const tva = [
  k("a", { offertNar: "2026-10-26T10:00:00Z", avslut: "affar", avslutNar: "2026-10-28T10:00:00Z" }),
  k("b", { offertNar: "2026-10-26T10:00:00Z", avslut: "affar", avslutNar: "2026-10-31T10:00:00Z" }),
];
ok("jämnt antal ger medelvärdet av de två mittersta", offerter(tva, V).medianDagar === 3.5);

console.log("\n\x1b[1mdagarTillMote\x1b[0m");
const d = dagarTillMote(moten, V);
lika("alla fyra hinkar finns, i ordning", Object.keys(d), ["0–1", "2–3", "4–7", "8+"]);
lika("0–1: m2 (samma dag) hållet, m4a (i morgon) uteblev", d["0–1"], { andel: 0.5, n: 1, av: 2 });
lika("2–3: m1 hållet, m5 avbokat", d["2–3"], { andel: 0.5, n: 1, av: 2 });
lika("4–7: m3 hållet", d["4–7"], { andel: 1, n: 1, av: 1 });
lika("8+: m9 hållet", d["8+"], { andel: 1, n: 1, av: 1 });
lika("tom hink har andel null", dagarTillMote([], V)["8+"], { andel: null, n: 0, av: 0 });

console.log("\n\x1b[1mdagarTillMote: hinkgränser och Stockholmsdagar\x1b[0m");
// Ett möte i taget; hinken är den som fått en rad.
const hink = (bokatNar, moteTid) => {
  const r = dagarTillMote([m("g", "kg", { bokatNar, moteTid, utfall: "hallet" })], V);
  return Object.keys(r).filter((h) => r[h].av === 1).join(",");
};
ok("1 dag (26 → 27 okt) är 0–1", hink("2026-10-26T10:00:00Z", "2026-10-27T10:00:00Z") === "0–1");
ok("2 dagar (26 → 28 okt) är 2–3", hink("2026-10-26T10:00:00Z", "2026-10-28T10:00:00Z") === "2–3");
ok("3 dagar (26 → 29 okt) är 2–3", hink("2026-10-26T10:00:00Z", "2026-10-29T10:00:00Z") === "2–3");
ok("4 dagar (26 → 30 okt) är 4–7", hink("2026-10-26T10:00:00Z", "2026-10-30T10:00:00Z") === "4–7");
ok("7 dagar (19 → 26 okt) är 4–7", hink("2026-10-19T10:00:00Z", "2026-10-26T10:00:00Z") === "4–7");
ok("8 dagar (19 → 27 okt) är 8+", hink("2026-10-19T10:00:00Z", "2026-10-27T10:00:00Z") === "8+");
ok("bokat 23:30Z söndag (måndag i Sverige) till tisdag är 1 dag, inte 2 som i UTC", hink("2026-10-25T23:30:00Z", "2026-10-27T10:00:00Z") === "0–1");
ok("möte 23:30Z (nästa dag i Sverige) är 2 dagar, inte 1 som i UTC", hink("2026-10-26T10:00:00Z", "2026-10-27T23:30:00Z") === "2–3");

console.log("\n\x1b[1mmedianDagar över Stockholmsmidnatt\x1b[0m");
const natt = [k("n", { offertNar: "2026-10-25T23:30:00Z", avslut: "affar", avslutNar: "2026-11-01T10:00:00Z" })];
ok("offert 23:30Z söndag (måndag 26 okt i Sverige) till 1 nov är 6 dagar, inte 7 som i UTC", offerter(natt, V).medianDagar === 6);

console.log("\n\x1b[1mavslutet avbokat är inte en affär eller ett nej\x1b[0m");
// Hållen första mötestid hos säljare 2, men kedjan slutade avbokad: ska inte in i nämnaren.
const medAvbokad = [...kedjor, k("k13", { forstaMoteTid: "2026-10-29T10:00:00Z", offertNar: "2026-10-29T10:00:00Z", avslut: "avbokat", avslutNar: "2026-10-30T10:00:00Z" })];
lika("affarer är fortfarande 2 av 3", veckotal(S2, V, moten, medAvbokad, 0, NU).affarer, { andel: 2 / 3, n: 2, av: 3 });
lika("forstaMote är fortfarande 1 av 2", veckotal(S2, V, moten, medAvbokad, 0, NU).forstaMote, { andel: 0.5, n: 1, av: 2 });
lika("bakom affarer innehåller inte k13", bakom("affarer", S2, V, moten, medAvbokad).sort(), ["k1", "k2", "k3"]);
const oa = offerter(medAvbokad, V);
ok("offerter: affar 1 och nej 1 oförändrade", oa.affar === 1 && oa.nej === 1);
ok("perKalla: avbokad kedja ger ingen affär", perKalla(moten, medAvbokad, V).find((r) => r.kalla === "dialer").affarer === 2);

console.log("\n\x1b[1mperKalla\x1b[0m");
const pk = perKalla(moten, kedjor, V);
lika("en rad per källa, flest bokade först", pk, [
  { kalla: "dialer", bokade: 3, hallna: 3, affarer: 2 },
  { kalla: "hemsida", bokade: 2, hallna: 1, affarer: 0 },
  { kalla: "tips", bokade: 1, hallna: 1, affarer: 0 },
]);

console.log("\n\x1b[1mbakom: raderna bakom varje tal\x1b[0m");
const antal = (t) => (t !== null && typeof t === "object" ? t.av : t);
for (const [namn, person, t, samtal] of [["säljare 1", S1, t1], ["säljare 2", S2, t2], ["säljare 3", S3, t3]]) {
  for (const tal of Object.keys(t)) {
    const id = bakom(tal, person, V, moten, kedjor, NU);
    if (tal === "samtal" || tal === "per100") ok(`${namn}: ${tal} ger [] (samtalen hämtas ur rutten)`, Array.isArray(id) && id.length === 0);
    else ok(`${namn}: ${tal} har ${antal(t[tal])} rader bakom sig`, Array.isArray(id) && id.length === antal(t[tal]));
  }
}
lika("bokade säljare 1 pekar på mötes-id", bakom("bokade", S1, V, moten, kedjor).sort(), ["m1", "m2", "m3", "m4a", "m5"]);
lika("hallna pekar på nämnaren, alltså även uteblivna och avbokade", bakom("hallna", S1, V, moten, kedjor).sort(), ["m1", "m2", "m3", "m4a", "m5"]);
lika("affarer pekar på kedje-id", bakom("affarer", S2, V, moten, kedjor).sort(), ["k1", "k2", "k3"]);
lika("utanUtfall med nu 08:00Z: bara m6 är över (m8 + 30 min ligger efter nu)", bakom("utanUtfall", S2, V, moten, kedjor, NU), ["m6"]);
lika("utanUtfall med senare nu: m8 hinner bli över", bakom("utanUtfall", S2, V, moten, kedjor, new Date("2026-11-02T08:11:00Z")).sort(), ["m6", "m8"]);

console.log("\n\x1b[1mperKalla: inga nollrader (S6)\x1b[0m");
{
  // Ett gammalt öppet möte utanför veckan: källan förekommer men har varken bokade, hållna eller affärer i veckan.
  const gammalt = [...moten, m("m90", "k90", { bokatNar: "2026-09-01T10:00:00Z", moteTid: "2026-09-03T10:00:00Z", kalla: "gammal" })];
  const rader = perKalla(gammalt, kedjor, V);
  ok("källan 'gammal' har bara nollor och är borta", !rader.some((r) => r.kalla === "gammal"));
  ok("ingen rad har bokade, hållna och affärer lika med 0", rader.every((r) => r.bokade + r.hallna + r.affarer > 0));
  lika("övriga rader är oförändrade", rader.map((r) => r.kalla), ["dialer", "hemsida", "tips"]);
}

console.log("\n\x1b[1minomKrets: teamledarens krets (K2)\x1b[0m");
{
  const T1 = "t1", T2 = "t2", UTE = "ute", UTE2 = "ute2";
  const krets = [T1, T2];
  const mm = [
    m("a1", "ka", { bokatAv: T1, hallsAv: T1 }),
    m("a2", "kb", { bokatAv: T1, hallsAv: UTE }), // bokat i teamet, hållet utanför: står kvar
    m("a3", "kc", { bokatAv: UTE, hallsAv: T2 }), // hållet i teamet: står kvar
    m("a4", "kd", { bokatAv: UTE, hallsAv: UTE2 }), // helt utanför: faller bort
    m("a5", "ke", { bokatAv: UTE2, hallsAv: UTE }), // helt utanför, kedjan har ingen i teamet: faller bort
  ];
  const kk = [
    k("ka", { forstaBokatAv: T1, forstaHallnaHallsAv: T1 }),
    k("kb", { forstaBokatAv: T1, forstaHallnaHallsAv: UTE }),
    k("kc", { forstaBokatAv: UTE, forstaHallnaHallsAv: T2 }),
    k("kd", { forstaBokatAv: UTE, forstaHallnaHallsAv: UTE2 }),
    k("ke", { forstaBokatAv: UTE2, forstaHallnaHallsAv: UTE }),
    k("kf", { forstaBokatAv: UTE, forstaHallnaHallsAv: UTE2 }), // inget möte och ingen i teamet: faller bort
    k("kg", { forstaBokatAv: T2, forstaHallnaHallsAv: UTE }), // inget möte i listan men teamets bokning: står kvar
  ];
  ok("inomKrets finns som export", typeof forma.inomKrets === "function");
  const r = forma.inomKrets?.(mm, kk, krets) ?? { moten: [], kedjor: [] };
  lika("möten: bokat ELLER hållet i teamet står kvar", r.moten.map((x) => x.id), ["a1", "a2", "a3"]);
  lika("kedjor: ett behållet möte pekar på dem, eller en i teamet är första bokare/hållare", r.kedjor.map((x) => x.id), ["ka", "kb", "kc", "kg"]);
  ok("säljare i ett annat team faller bort ur möten", !r.moten.some((x) => x.bokatAv === UTE2 || x.hallsAv === UTE2));
  const alla = forma.inomKrets?.(mm, kk, null) ?? { moten: [], kedjor: [] };
  ok("krets null (chef) släpper igenom allt", alla.moten.length === 5 && alla.kedjor.length === 7);
  const tom = forma.inomKrets?.(mm, kk, []) ?? { moten: [1], kedjor: [1] };
  ok("tom krets ger inget", tom.moten.length === 0 && tom.kedjor.length === 0);
  // Talen: teamets person får samma tal som utan begränsning, den utanför försvinner ur underlaget.
  const tFore = veckotal(T1, V, mm, kk, 0, NU), tEfter = veckotal(T1, V, r.moten, r.kedjor, 0, NU);
  lika("T1:s tal ändras inte av begränsningen", tEfter, tFore);
  ok("UTE2 har inga bokade kvar efter begränsningen", veckotal(UTE2, V, r.moten, r.kedjor, 0, NU).bokade === 0);
}

console.log("\n\x1b[1mI2: teamets block räknar bara teamets rader\x1b[0m");
{
  const T1 = "t1", T2 = "t2", UTE = "ute", UTE2 = "ute2";
  const krets = [T1, T2];
  const tid = (dag) => `2026-10-${dag}T10:00:00Z`;
  const mm = [
    // Teamets egna: T1 bokar (hemsida), T2 håller. Hållet. Bokad och hållen i veckan.
    m("t-a", "kt1", { bokatAv: T1, hallsAv: T2, kalla: "hemsida", bokatNar: tid(26), moteTid: tid(28), utfall: "hallet", resultat: "offert" }),
    // T1 bokar, UTE håller: bokartalet är T1:s, ingen annan.
    m("t-b", "kt2", { bokatAv: T1, hallsAv: UTE, kalla: "dialer", bokatNar: tid(27), moteTid: tid(29), utfall: "uteblev" }),
    // T2 bokar och håller, dialer, hållet, affär i kedjan.
    m("t-c", "kt3", { bokatAv: T2, hallsAv: T2, kalla: "dialer", bokatNar: tid(26), moteTid: tid(27), utfall: "hallet", resultat: "affar" }),
    // Ombokning hållen av T2 i kedja som T1 först bokade: T1:s räddade.
    m("t-d", "kt1", { bokatAv: T2, hallsAv: T2, art: "ombokning", kalla: "hemsida", bokatNar: tid(28), moteTid: tid(30), utfall: "hallet" }),
    // Felscenario 2: bokat av UTE (hemsida), hållet av T2. Båda är UTE:s bokartal.
    m("u-a", "ku1", { bokatAv: UTE, hallsAv: T2, kalla: "hemsida", bokatNar: tid(27), moteTid: tid(29), utfall: "hallet" }),
    // Felscenario 1: UTE:s kedja ku2, T1 höll ett uppföljningsmöte.
    m("u-b", "ku2", { bokatAv: T1, hallsAv: T1, art: "uppfoljning", kalla: "tips", bokatNar: tid(28), moteTid: tid(30), utfall: "hallet" }),
    // Helt utanför.
    m("u-c", "ku3", { bokatAv: UTE2, hallsAv: UTE, kalla: "tips", bokatNar: tid(26), moteTid: tid(28), utfall: "hallet" }),
  ];
  const kk = [
    k("kt1", { forstaBokatAv: T1, forstaHallnaHallsAv: T2, kalla: "hemsida", offertNar: tid(28), kolumn: "folj_upp" }),
    k("kt2", { forstaBokatAv: T1, forstaHallnaHallsAv: UTE, kalla: "dialer", offertNar: tid(29), kolumn: "tyst" }),
    k("kt3", { forstaBokatAv: T2, forstaHallnaHallsAv: T2, kalla: "dialer", offertNar: tid(27), avslut: "affar", avslutNar: tid(30) }),
    k("ku1", { forstaBokatAv: UTE, forstaHallnaHallsAv: T2, kalla: "hemsida" }),
    k("ku2", { forstaBokatAv: UTE, forstaHallnaHallsAv: UTE, kalla: "tips", offertNar: tid(28), avslut: "affar", avslutNar: tid(30) }),
    k("ku3", { forstaBokatAv: UTE2, forstaHallnaHallsAv: UTE, kalla: "tips", offertNar: tid(27), avslut: "affar", avslutNar: tid(29) }),
  ];
  const r = forma.inomKrets(mm, kk, krets);
  const kol = (rader, kalla) => rader.find((x) => x.kalla === kalla) ?? { bokade: 0, hallna: 0, affarer: 0 };

  const off = offerter(r.kedjor, V, krets);
  lika("offerter: UTE:s och kt2:s (UTE håller) offerter och affärer räknas inte", off,
    { skickade: 2, affar: 1, nej: 0, tysta: 0, medianDagar: 3 });
  const offUtanKrets = offerter(r.kedjor, V);
  ok("offerter utan krets räknar som förut (ku2 med)", offUtanKrets.affar === 2);
  lika("offerter: krets null är oförändrat", offerter(kk, V, null), offerter(kk, V));

  const pk2 = perKalla(r.moten, r.kedjor, V, krets);
  ok("hemsida: u-a (bokat av UTE, hållet av T2) ger varken bokade eller hållna", kol(pk2, "hemsida").bokade === 1 && kol(pk2, "hemsida").hallna === 2,
    text(kol(pk2, "hemsida")));
  ok("tips: bara u-b (uppföljning, kedjan är UTE:s) och ku2:s affär: allt UTE:s, ingen rad", !pk2.some((x) => x.kalla === "tips"), text(pk2));
  ok("dialer: affär bara kt3 (UTE:s ku2 är tips)", kol(pk2, "dialer").affarer === 1, text(kol(pk2, "dialer")));
  lika("perKalla: krets null är oförändrat", perKalla(mm, kk, V, null), perKalla(mm, kk, V));

  const dg = dagarTillMote(r.moten, V, krets);
  const dgAlla = dagarTillMote(r.moten, V);
  const antalDg = (d) => Object.values(d).reduce((s, x) => s + x.av, 0);
  ok("dagarTillMote: bara teamets bokartal (t-a, t-b, t-c; inte u-a)", antalDg(dg) === 3 && antalDg(dgAlla) === 4, `${antalDg(dg)} resp ${antalDg(dgAlla)}`);
  lika("dagarTillMote: krets null är oförändrat", dagarTillMote(mm, V, null), dagarTillMote(mm, V));

  // Summan per kolumn i Källa ska vara lika med personradernas summa för teamet.
  const personer = krets.map((id) => veckotal(id, V, r.moten, r.kedjor, 0, NU));
  const sBokade = personer.reduce((s, p) => s + p.bokade, 0);
  const sHallna = personer.reduce((s, p) => s + p.hallna.n + p.raddade, 0);
  const sAffarer = personer.reduce((s, p) => s + p.affarer.n, 0);
  const sum = (kolnamn) => pk2.reduce((s, x) => s + x[kolnamn], 0);
  ok("Källa: summan Bokade = Σ bokade i personraderna", sum("bokade") === sBokade && sBokade > 0, `${sum("bokade")} mot ${sBokade}`);
  ok("Källa: summan Affärer = Σ affarer.n i personraderna", sum("affarer") === sAffarer && sAffarer > 0, `${sum("affarer")} mot ${sAffarer}`);
  // u-b är en uppföljning i UTE:s kedja: den hör inte till teamet och ingen personrad räknar den.
  ok("Källa: summan Hållna = Σ (hallna.n + raddade)", sum("hallna") === sHallna && sHallna > 0, `${sum("hallna")} mot ${sHallna}`);

  // Uppföljningar har ingen ägare i personraderna; närmast är kedjans första bokare (som ombokningar).
  const uppf = [
    m("v-a", "kv1", { bokatAv: T1, hallsAv: T2, art: "uppfoljning", kalla: "mässa", bokatNar: tid(28), moteTid: tid(30), utfall: "hallet" }),
    m("v-b", "kv2", { bokatAv: T1, hallsAv: T1, art: "uppfoljning", kalla: "mässa", bokatNar: tid(28), moteTid: tid(30), utfall: "hallet" }),
  ];
  const ukk = [k("kv1", { forstaBokatAv: T2 }), k("kv2", { forstaBokatAv: UTE })];
  lika("uppföljning hålls: räknas hos kedjans första bokare (kv1 ja, kv2 nej)", kol(perKalla(uppf, ukk, V, krets), "mässa").hallna, 1);
}

console.log("\n\x1b[1mI1: null är alla bara för en chefsroll\x1b[0m");
{
  ok("kretsFor finns", typeof forma.kretsFor === "function");
  ok("samtalTillatet finns", typeof forma.samtalTillatet === "function");
  const kf = forma.kretsFor ?? (() => "saknas");
  lika("kretsFor: undefined (fel) förblir undefined", kf(undefined, ["sales_manager"]), undefined);
  lika("kretsFor: null + team_lead ensam är fel (undefined)", kf(null, ["team_lead"]), undefined);
  lika("kretsFor: null + ingen roll är fel", kf(null, []), undefined);
  for (const roll of ["sales_manager", "ceo", "admin"]) lika(`kretsFor: null + ${roll} är alla`, kf(null, [roll]), null);
  lika("kretsFor: null + team_lead + sales_manager är alla", kf(null, ["team_lead", "sales_manager"]), null);
  lika("kretsFor: en lista förblir listan", kf(["a", "b"], ["team_lead"]), ["a", "b"]);
  const st = forma.samtalTillatet ?? (() => ({ status: 0, fel: "saknas" }));
  const FEL500 = { status: 500, fel: "Samtalen gick inte att läsa." };
  lika("samtalTillatet: undefined ger 500", st(undefined, ["admin"], "x"), FEL500);
  lika("samtalTillatet: null + team_lead ger 500", st(null, ["team_lead"], "x"), FEL500);
  lika("samtalTillatet: null + roll saknas ger 500", st(null, [], "x"), FEL500);
  lika("samtalTillatet: null + ceo ger ok", st(null, ["ceo"], "x"), { ok: true });
  lika("samtalTillatet: null + admin ger ok", st(null, ["admin"], "x"), { ok: true });
  lika("samtalTillatet: null + sales_manager ger ok", st(null, ["sales_manager"], "x"), { ok: true });
  lika("samtalTillatet: personen i listan ger ok", st(["a", "b"], ["team_lead"], "b"), { ok: true });
  lika("samtalTillatet: utanför listan med flera ger teamtexten", st(["a", "b"], ["team_lead"], "c"), { status: 403, fel: "Du ser bara samtalen i ditt team." });
  lika("samtalTillatet: utanför listan med en ger egna-texten", st(["a"], ["sales_rep"], "c"), { status: 403, fel: "Du ser bara dina egna samtal." });
}

console.log("\n\x1b[1mM2: fore kräver tidszon\x1b[0m");
{
  const f = (fore) => forma.samtalsfonster({ fran: "2026-10-26", till: "2026-11-01", fore });
  ok("fore utan zon är fel", "fel" in f("2026-10-31T10:00"));
  ok("fore med sekunder men utan zon är fel", "fel" in f("2026-10-31T10:00:00"));
  ok("fore med Z är ok", !("fel" in f("2026-10-31T10:00:00Z")));
  ok("fore med millisekunder och Z är ok", !("fel" in f("2026-10-31T10:00:00.123Z")));
  ok("fore med +02:00 är ok", f("2026-10-31T12:00:00+02:00").fore === "2026-10-31T10:00:00.000Z");
  ok("fore med -05:00 är ok", !("fel" in f("2026-10-31T05:00:00-05:00")));
  ok("fore med +0200 (utan kolon) är fel", "fel" in f("2026-10-31T12:00:00+0200"));
}

console.log("\n\x1b[1msamtalsfönster (S1–S3)\x1b[0m");
{
  ok("samtalsfonster finns som export", typeof forma.samtalsfonster === "function");
  const f = (o) => forma.samtalsfonster?.(o) ?? { fel: "saknas" };
  ok("2026-99-99 är fel", "fel" in f({ fran: "2026-99-99", till: "2026-99-99" }));
  ok("2026-02-30 är fel (går inte fram och tillbaka)", "fel" in f({ fran: "2026-02-30", till: "2026-03-01" }));
  ok("till 2026-02-30 är fel", "fel" in f({ fran: "2026-02-20", till: "2026-02-30" }));
  ok("fel format är fel", "fel" in f({ fran: "26-10-26", till: "2026-10-27" }));
  ok("saknade datum är fel", "fel" in f({ fran: undefined, till: undefined }));
  ok("till före fran är fel", "fel" in f({ fran: "2026-10-27", till: "2026-10-26" }));
  ok("14 dagar (inräknat) är ok", !("fel" in f({ fran: "2026-10-19", till: "2026-11-01" })));
  ok("15 dagar är fel", "fel" in f({ fran: "2026-10-19", till: "2026-11-02" }));
  const cet = f({ fran: "2026-10-26", till: "2026-11-02" });
  ok("slutet i CET: till 2026-11-02 ger 2026-11-02T23:00:00.000Z", cet.slut === "2026-11-02T23:00:00.000Z", cet.slut);
  ok("början i CET: fran 2026-10-26 ger 2026-10-25T23:00:00.000Z", cet.fran === "2026-10-25T23:00:00.000Z", cet.fran);
  ok("början i CEST: fran 2026-06-29 ger 2026-06-28T22:00:00.000Z", f({ fran: "2026-06-29", till: "2026-07-06" }).fran === "2026-06-28T22:00:00.000Z");
  const cest = f({ fran: "2026-06-29", till: "2026-07-06" });
  ok("slutet i CEST: till 2026-07-06 ger 2026-07-06T22:00:00.000Z", cest.slut === "2026-07-06T22:00:00.000Z", cest.slut);
  const om = f({ fran: "2026-10-19", till: "2026-10-25" });
  ok("slutet över höstens omställning (25 okt, 25 timmar): 2026-10-25T23:00:00.000Z", om.slut === "2026-10-25T23:00:00.000Z", om.slut);
  const vår = f({ fran: "2026-03-23", till: "2026-03-29" });
  ok("slutet över vårens omställning (29 mars, 23 timmar): 2026-03-29T22:00:00.000Z", vår.slut === "2026-03-29T22:00:00.000Z", vår.slut);
  ok("utan fore: fore är null (ingen filtrering)", f({ fran: "2026-10-26", till: "2026-11-01" }).fore === null);
  const fo = f({ fran: "2026-10-26", till: "2026-11-01", fore: "2026-11-02T08:00:00Z" });
  ok("giltig fore ges tillbaka som ISO", fo.fore === "2026-11-02T08:00:00.000Z", fo.fore);
  ok("en fore som inte går att tolka är fel", "fel" in f({ fran: "2026-10-26", till: "2026-11-01", fore: "i går" }));
  ok("en fore som '15' är fel", "fel" in f({ fran: "2026-10-26", till: "2026-11-01", fore: "15" }));
  ok("en fore som inte är en sträng är fel", "fel" in f({ fran: "2026-10-26", till: "2026-11-01", fore: 12345 }));
  ok("tom fore räknas som saknad", f({ fran: "2026-10-26", till: "2026-11-01", fore: "" }).fore === null);
}

console.log("");
process.exit(fel ? 1 : 0);
