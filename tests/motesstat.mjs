#!/usr/bin/env node
/**
 * Nav 2.0, Möten (B2): de rena talen på Mötessidan. Talen räknas fram ur
 * raderna vid läsning, så provet matar funktionerna med en fast datamängd:
 * tre säljare, veckan 2026-10-26 till 2026-11-01 och fem kedjor.
 *
 *   TZ=UTC node --experimental-strip-types tests/motesstat.mjs
 */
import { vecka, veckotal, offerter, dagarTillMote, perKalla, bakom } from "../src/lib/nav2/motesstatforma.ts";

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

console.log("");
process.exit(fel ? 1 : 0);
