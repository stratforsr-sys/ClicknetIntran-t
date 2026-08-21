#!/usr/bin/env node
/**
 * E15 / M13: lonekostnadsrakningen. Ingen databas.
 *
 *   node --experimental-strip-types tests/lonekostnad.mjs
 *
 * Provet skickar in sina EGNA satser, precis som tests/franvaro.mjs gor med
 * franvaroreglerna. Ett prov som laste satserna ur databasen hade slutat prova
 * rakningen och borjat prova seeden — och den dag arbetsgivaravgiften andras
 * hade provet blivit rott utan att nagot var fel.
 *
 * Behorigheten (K26) provas mot riktiga databasen i tests/rls.mjs.
 */
import {
  alderVidAretsIngang,
  avgiftssats,
  manaderIPerioden,
  raknaLonekostnad,
  kronor,
} from "../src/lib/lonekostnad.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const nara = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

// Provets egna satser. Samma sorts tal som seeden i 0025, men provet ager dem.
const SATSER = {
  standard: 31.42,
  reducerad: 10.21,
  reduceradTak: 25000,
  ungMin: 15,
  ungMax: 17,
  seniorMin: 66,
  tackningsgrad: null,
  franvarofaktor: {},
};

rubrik("Alder vid arets ingang — fodelsearet racker (K27)");
// Den som ar fodd ar B har den 1 januari ar Y fyllt exakt Y - B - 1 ar,
// oavsett fodelsemanad. Det ar darfor ett fodelsedatum inte behovs.
ok("fodd 2008 ar 17 vid ingangen av 2026", alderVidAretsIngang(2026, 2008) === 17);
ok("fodd 2010 ar 15 vid ingangen av 2026", alderVidAretsIngang(2026, 2010) === 15);
ok("fodd 2011 ar 14 vid ingangen av 2026", alderVidAretsIngang(2026, 2011) === 14);
ok("fodd 1959 ar 66 vid ingangen av 2026", alderVidAretsIngang(2026, 1959) === 66);
ok("ett ar senare ar samma person ett ar aldre", alderVidAretsIngang(2027, 2008) === 18);

rubrik("Vilken sats som galler");
ok("en vuxen far full sats", avgiftssats(30, SATSER).procent === SATSER.standard);
ok("och inget manadstak", avgiftssats(30, SATSER).tak === null);
ok("en 17-aring far den lagre satsen", avgiftssats(17, SATSER).procent === SATSER.reducerad);
ok("med manadstak", avgiftssats(17, SATSER).tak === SATSER.reduceradTak);
ok("en 15-aring likasa", avgiftssats(15, SATSER).grund === "ung");
// Den som fyllt 18 vid arets ingang ar inte langre ung i regelns mening.
ok("en 18-aring far full sats", avgiftssats(18, SATSER).grund === "standard");
ok("en 14-aring far full sats", avgiftssats(14, SATSER).grund === "standard");
ok("en 66-aring far den lagre satsen", avgiftssats(66, SATSER).procent === SATSER.reducerad);
// De aldres nedsattning ar INTE takad. Det ar skillnaden mot ungdomarnas.
ok("men utan manadstak", avgiftssats(66, SATSER).tak === null);
ok("en 65-aring far full sats", avgiftssats(65, SATSER).grund === "standard");

rubrik("Perioden delas pa kalendermanader (AC-13.5)");
const helManad = manaderIPerioden("2026-03-01", "2026-03-31");
ok("en hel manad ger en del", helManad.length === 1 && helManad[0].dagar === 31);
const overSkifte = manaderIPerioden("2026-03-16", "2026-04-15");
ok("en period over ett manadsskifte ger tva", overSkifte.length === 2);
ok("med ratt antal dagar i vardera", overSkifte[0].dagar === 16 && overSkifte[1].dagar === 15);
ok("och ratt manadslangder", overSkifte[0].dagarIManaden === 31 && overSkifte[1].dagarIManaden === 30);
const overArsskifte = manaderIPerioden("2026-12-20", "2027-01-10");
ok("och ett arsskifte gar ocksa bra", overArsskifte.length === 2 && overArsskifte[1].ar === 2027);
ok("skottar februari raknas ratt", manaderIPerioden("2028-02-01", "2028-02-29")[0].dagar === 29);
ok("bakvant intervall ger inga delar", manaderIPerioden("2026-04-01", "2026-03-01").length === 0);

rubrik("Grundfallet: en vuxen pa 35 000 kr");
const vuxen = raknaLonekostnad(
  {
    manadslon: 35000,
    fodelsear: 1995,
    periodStart: "2026-03-01",
    periodSlut: "2026-03-31",
    franvarominuter: {},
    arbetadeMinuter: 10000,
    intakt: null,
  },
  SATSER,
);
ok("bruttolonen ar hela manadslonen", vuxen.bruttolon === 35000);
ok("avgiften ar 31,42 procent", nara(vuxen.arbetsgivaravgift, 35000 * 0.3142), `${vuxen.arbetsgivaravgift}`);
ok("totalkostnaden ar summan", nara(vuxen.totalkostnad, 35000 + 35000 * 0.3142), `${vuxen.totalkostnad}`);
ok("break-even saknas utan tackningsgrad", vuxen.breakEven === null);
ok("och det star utskrivet varfor", vuxen.anmarkningar.some((a) => a.includes("Täckningsgraden")));
ok("tackningsbidrag ar null, inte noll", vuxen.tackningsbidrag === null);

rubrik("AC-13.8: rates_used bevarar vad siffran byggde pa");
ok("satserna finns med", vuxen.ratesUsed.standard === 31.42);
// En sats forklarar ingenting utan talet den tillampades pa.
ok("och underlaget ocksa", vuxen.ratesUsed.manadslon === 35000);
ok("inklusive perioden", Array.isArray(vuxen.ratesUsed.period));

rubrik("Manadstaket galler den del som ligger under det");
// 30 000 kr till en 17-aring: 25 000 med lagre sats, 5 000 med full.
const ung = raknaLonekostnad(
  {
    manadslon: 30000,
    fodelsear: 2009,
    periodStart: "2026-03-01",
    periodSlut: "2026-03-31",
    franvarominuter: {},
    arbetadeMinuter: 10000,
    intakt: null,
  },
  SATSER,
);
ok(
  "delen under taket far lagre sats, delen over full",
  nara(ung.arbetsgivaravgift, 25000 * 0.1021 + 5000 * 0.3142),
  `${ung.arbetsgivaravgift}`,
);
ok("och det star utskrivet", ung.anmarkningar.some((a) => a.includes("månadstaket")));

// Under taket blir det bara lagre sats.
const ungUnderTak = raknaLonekostnad(
  { manadslon: 20000, fodelsear: 2009, periodStart: "2026-03-01", periodSlut: "2026-03-31", franvarominuter: {}, arbetadeMinuter: 1, intakt: null },
  SATSER,
);
ok("helt under taket ger bara lagre sats", nara(ungUnderTak.arbetsgivaravgift, 20000 * 0.1021));
ok("och ingen anmarkning om taket", !ungUnderTak.anmarkningar.some((a) => a.includes("månadstaket")));

// Taket ar PER KALENDERMANAD. En period over ett skifte har alltsa tva tak,
// inte ett — det ar hela skalet att perioden delas.
const ungOverSkifte = raknaLonekostnad(
  { manadslon: 30000, fodelsear: 2009, periodStart: "2026-03-16", periodSlut: "2026-04-15", franvarominuter: {}, arbetadeMinuter: 1, intakt: null },
  SATSER,
);
ok(
  "en period over ett manadsskifte far tva tak, inte ett",
  nara(ungOverSkifte.arbetsgivaravgift, 30000 * 0.1021),
  `${ungOverSkifte.arbetsgivaravgift} — bada delarna ryms under sitt eget tak`,
);
ok("och perioden redovisas manad for manad", ungOverSkifte.manader.length === 2);

rubrik("Utan fodelsear tas full sats");
const utanAr = raknaLonekostnad(
  { manadslon: 30000, fodelsear: null, periodStart: "2026-03-01", periodSlut: "2026-03-31", franvarominuter: {}, arbetadeMinuter: 1, intakt: null },
  SATSER,
);
// Full sats ar dyrare, alltsa forsiktigare. En underskattad kostnad ar farlig
// i ett break-even, en overskattad bara forsiktig.
ok("full sats nar aret saknas", nara(utanAr.arbetsgivaravgift, 30000 * 0.3142));
ok("och det star utskrivet", utanAr.anmarkningar.some((a) => a.includes("Födelseår")));

rubrik("Franvaro kommer ur payroll_row, och kostar som standard fullt");
const medFranvaro = {
  manadslon: 30000,
  fodelsear: 1995,
  periodStart: "2026-03-01",
  periodSlut: "2026-03-31",
  // Halva perioden sjuk. Nyckeln ar samma som payroll_row.absence_minutes bar.
  franvarominuter: { sick: 4800 },
  arbetadeMinuter: 4800,
  intakt: null,
};
const utanFaktor = raknaLonekostnad(medFranvaro, SATSER);
ok("utan satt faktor gors inget avdrag", utanFaktor.franvaroavdrag === 0);
ok("och kostnaden ar hel manadslon", utanFaktor.bruttolon === 30000);

// Satts faktorn till 80 betalar arbetsgivaren 80 procent under franvaron,
// alltsa ett avdrag pa 20 procent av den franvarande delen.
const medFaktor = raknaLonekostnad(medFranvaro, { ...SATSER, franvarofaktor: { sick: 80 } });
ok("med faktor 80 blir avdraget 20 procent av halva lonen", nara(medFaktor.franvaroavdrag, 3000), `${medFaktor.franvaroavdrag}`);
ok("bruttolonen minskar", nara(medFaktor.bruttolon, 27000));
ok("och avgiften raknas pa den minskade lonen", nara(medFaktor.arbetsgivaravgift, 27000 * 0.3142));

// VAB betalas av Forsakringskassan, inte av arbetsgivaren. Faktor 0.
const vab = raknaLonekostnad(
  { ...medFranvaro, franvarominuter: { care_of_child: 4800 } },
  { ...SATSER, franvarofaktor: { care_of_child: 0 } },
);
ok("faktor 0 drar av hela den franvarande delen", nara(vab.bruttolon, 15000), `${vab.bruttolon}`);

// En typ utan satt faktor ska aldrig ge ett avdrag av misstag.
const blandat = raknaLonekostnad(
  { ...medFranvaro, franvarominuter: { sick: 2400, vacation: 2400 } },
  { ...SATSER, franvarofaktor: { sick: 80 } },
);
ok("bara typen med faktor pverkar", nara(blandat.franvaroavdrag, 30000 * 0.25 * 0.2), `${blandat.franvaroavdrag}`);

rubrik("Tomt underlag ljuger inte");
// `{}` betyder "inte matt", inte "ingen franvaro" — se 0012.
const omatt = raknaLonekostnad(
  { manadslon: 30000, fodelsear: 1995, periodStart: "2026-03-01", periodSlut: "2026-03-31", franvarominuter: {}, arbetadeMinuter: 0, intakt: null },
  SATSER,
);
ok("omatt tid ger hel manadslon", omatt.bruttolon === 30000);
ok("och en anmarkning om att inget ar avrakvat", omatt.anmarkningar.some((a) => a.includes("ingen mätt tid")));

rubrik("Break-even och tackningsbidrag");
const medGrad = raknaLonekostnad(
  { manadslon: 30000, fodelsear: 1995, periodStart: "2026-03-01", periodSlut: "2026-03-31", franvarominuter: {}, arbetadeMinuter: 1, intakt: null },
  { ...SATSER, tackningsgrad: 50 },
);
ok("break-even ar kostnaden delad med tackningsgraden", nara(medGrad.breakEven, medGrad.totalkostnad / 0.5), `${medGrad.breakEven}`);
ok("en lagre tackningsgrad kraver mer forsaljning", raknaLonekostnad(
  { manadslon: 30000, fodelsear: 1995, periodStart: "2026-03-01", periodSlut: "2026-03-31", franvarominuter: {}, arbetadeMinuter: 1, intakt: null },
  { ...SATSER, tackningsgrad: 25 },
).breakEven > medGrad.breakEven);

const medIntakt = raknaLonekostnad(
  { manadslon: 30000, fodelsear: 1995, periodStart: "2026-03-01", periodSlut: "2026-03-31", franvarominuter: {}, arbetadeMinuter: 1, intakt: 100000 },
  { ...SATSER, tackningsgrad: 50 },
);
ok("tackningsbidrag ar intakt minus kostnad", nara(medIntakt.tackningsbidrag, 100000 - medIntakt.totalkostnad));
// Noll intakt ar ett svar, ingen intakt ar inget svar. De far inte se likadana ut.
const nollIntakt = raknaLonekostnad(
  { manadslon: 30000, fodelsear: 1995, periodStart: "2026-03-01", periodSlut: "2026-03-31", franvarominuter: {}, arbetadeMinuter: 1, intakt: 0 },
  SATSER,
);
ok("noll i intakt ger ett negativt tackningsbidrag", nollIntakt.tackningsbidrag < 0);
ok("och ingen intakt ger null", vuxen.tackningsbidrag === null);

rubrik("Inga pensions- eller forsakringssatser finns");
// Anvandarens besked 2026-08-21: bolaget har varken. En sats pa noll i vyn
// hade sett ut som en kostnad nagon glomt fylla i.
ok("berakningen har inga sadana falt", !("pension" in vuxen) && !("forsakring" in vuxen));
ok("och rates_used bar inga heller", !("pension" in vuxen.ratesUsed));

rubrik("Kronor for en manniska");
// Svensk formatering anvander HART mellanslag (U+00A0) som tusenavgransare,
// inte ett vanligt. Den som jamfor strangar nagon annanstans i navet maste
// veta det — darav att provet star pa tecknet och inte pa hur det ser ut.
ok("tusenavgransare ar ett hart mellanslag", kronor(48320) === "48\u00a0320 kr", JSON.stringify(kronor(48320)));
ok("ett belopp under tusen far ingen avgransare", kronor(950) === "950 kr");
ok("ore avrundas bort — vyn visar hela kronor", kronor(48320.49) === "48\u00a0320 kr");
ok("null blir tankstreck", kronor(null) === "—");

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m" : `\n\x1b[31m${fel} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
