#!/usr/bin/env node
/**
 * Hemvyn (steg 1): reglerna för förslag, facit och domar (designdokumentet 1.3–1.7).
 *
 *   - När ett obekräftat möte blir ett förslag till den som håller mötet.
 *   - När ett förslag har blivit inaktuellt (flyttat, bekräftat, ny hållare).
 *   - Navs facit per val, över hela laget, aldrig per person.
 *   - Domen över en ändring, med motvikt och resten av laget.
 *   - Trendregeln, tyst tills 60 avgjorda möten finns.
 *
 * 2026-11-13 är en fredag, 2026-11-16 en måndag. Sverige är UTC+1 i november
 * och UTC+2 fram till 25 oktober.
 *
 *   TZ=UTC node --experimental-strip-types tests/forslagforma.mjs
 */
import {
  obekraftadeAttForesla, forslagNyckel, nyckelDelar, inaktuellt, oppetLage, utfallFor, facitPerVal, facitDags,
  domAndring, kollpunkt, trendLaget, troddeAvstamning, forFaAttSaga, facitVid,
} from "../src/lib/nav2/forslagforma.ts";

let fel = 0;
const ok = (namn, villkor) => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}`);
  if (!villkor) fel++;
};
const text = (x) => JSON.stringify(x, (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? String(v) : v));
const lika = (namn, fas, vantat) => ok(`${namn} (fick ${text(fas)})`, text(fas) === text(vantat));

const TZ = "Europe/Stockholm";
const INST = { tid: "14:00", bekraftaDagar: 2, tz: TZ, gallerFran: "2026-10-01T00:00:00Z" };
const AKT = new Set(["edvin", "mick", "zen"]);
const mote = (id, o) => ({
  id, moteTid: "2026-11-17T09:30:00Z", senastAndrad: "2026-11-10T09:00:00Z", hallsAv: "edvin", bokatAv: "mick",
  art: "ny", bekraftat: false, utfall: null, ...o,
});
const TIS = mote("TIS", {});
const MAN = mote("MAN", { moteTid: "2026-11-16T09:30:00Z" });
// Bokat samma morgon 08.00 till 12.30: sista dagen är mötesdagen.
const SAMMA = mote("SAMMA", { moteTid: "2026-11-16T11:30:00Z", senastAndrad: "2026-11-16T07:00:00Z" });
const vid = (iso, ...m) => obekraftadeAttForesla(m, AKT, new Date(iso), INST);

console.log("\n\x1b[1mNär ett obekräftat möte blir ett förslag\x1b[0m");
lika("måndag 13.59: inget än", vid("2026-11-16T12:59:00Z", TIS).length, 0);
lika("måndag 14.00: ett förslag", vid("2026-11-16T13:00:00Z", TIS).length, 1);
{
  const f = vid("2026-11-16T13:00:00Z", TIS)[0];
  lika("till den som håller mötet", f.om, "edvin");
  lika("nyckeln bär mötet, mötesdagen och hållaren", f.nyckel, "TIS@2026-11-17@edvin");
  lika("domen kommer arbetsdagen efter mötet", f.domsDag, "2026-11-18");
  lika("ingen valde räknas från mötets start", f.utgar, "2026-11-17T09:30:00.000Z");
  lika("mötets id följer med", f.moteId, "TIS");
}
lika("dagen före sista dagen: inget", vid("2026-11-13T15:00:00Z", TIS).length, 0);
lika("ett måndagsmöte frågas om på fredagen", vid("2026-11-13T13:00:00Z", MAN).length, 1);
lika("fredagsmötets dom kommer på måndagen", vid("2026-11-12T13:00:00Z", mote("FRE", { moteTid: "2026-11-13T09:30:00Z" }))[0].domsDag, "2026-11-16");
lika("missade jobbet sista dagen kommer förslaget ändå på mötesdagens morgon", vid("2026-11-17T06:00:00Z", TIS).length, 1);
lika("bokat samma dag: två timmar före mötet", vid("2026-11-16T09:30:00Z", SAMMA).length, 1);
lika("bokat samma dag: före gränsen", vid("2026-11-16T09:29:00Z", SAMMA).length, 0);
lika("mindre än en timme kvar ger inget", vid("2026-11-16T10:45:00Z", SAMMA).length, 0);
lika("ett möte som redan börjat ger inget", vid("2026-11-17T09:31:00Z", TIS).length, 0);
lika("bekräftat ger inget", vid("2026-11-16T13:00:00Z", mote("B", { bekraftat: true })).length, 0);
lika("ett möte med utfall ger inget", vid("2026-11-16T13:00:00Z", mote("U", { utfall: "avbokat" })).length, 0);
lika("ett uppföljningsmöte ger inget", vid("2026-11-16T13:00:00Z", mote("F", { art: "uppfoljning" })).length, 0);
lika("en ombokning räknas som ett första möte", vid("2026-11-16T13:00:00Z", mote("O", { art: "ombokning" })).length, 1);
lika("en hållare som slutat ger inget", vid("2026-11-16T13:00:00Z", mote("S", { hallsAv: "slutat" })).length, 0);
lika("möten före galler-fran rörs inte", obekraftadeAttForesla([TIS], AKT, new Date("2026-11-16T13:00:00Z"), { ...INST, gallerFran: "2026-12-01T00:00:00Z" }).length, 0);
lika("utan galler-fran skapas inget", obekraftadeAttForesla([TIS], AKT, new Date("2026-11-16T13:00:00Z"), { ...INST, gallerFran: null }).length, 0);
lika("samma person bokar och håller: raden kommer ändå", vid("2026-11-16T13:00:00Z", mote("E", { bokatAv: "edvin" })).length, 1);
lika("klockslaget är en inställning", obekraftadeAttForesla([TIS], AKT, new Date("2026-11-16T09:00:00Z"), { ...INST, tid: "10:00" }).length, 1);

console.log("\n\x1b[1mSommartid och röda dagar\x1b[0m");
// Måndag 26 okt, dagen efter bytet till vintertid. Fredag 23 okt är sommartid: 14.00 = 12.00 UTC.
const OKT = mote("OKT", { moteTid: "2026-10-26T09:30:00Z", senastAndrad: "2026-10-15T09:00:00Z" });
lika("sommartid: 13.59 svensk tid", vid("2026-10-23T11:59:00Z", OKT).length, 0);
lika("sommartid: 14.00 svensk tid", vid("2026-10-23T12:00:00Z", OKT).length, 1);
// Måndag 28 dec: julafton och juldagen är lediga, så sista dagen är onsdag 23 dec.
const JUL = mote("JUL", { moteTid: "2026-12-28T09:30:00Z", senastAndrad: "2026-12-10T09:00:00Z" });
lika("före jul: onsdagen är sista dagen", vid("2026-12-23T13:00:00Z", JUL).length, 1);
lika("före jul: tisdagen är för tidigt", vid("2026-12-22T15:00:00Z", JUL).length, 0);

console.log("\n\x1b[1mNyckeln och inaktuella förslag\x1b[0m");
lika("nyckeln", forslagNyckel(TIS, TZ), "TIS@2026-11-17@edvin");
lika("nyckelns delar", nyckelDelar("TIS@2026-11-17@edvin"), { mote: "TIS", dag: "2026-11-17", om: "edvin" });
lika("en trasig nyckel", nyckelDelar("skräp"), null);
const FLYTTAT = mote("TIS", { moteTid: "2026-11-24T09:30:00Z", senastAndrad: "2026-11-16T14:00:00Z" });
lika("ett flyttat möte får en ny nyckel när dess tid kommer", vid("2026-11-23T13:00:00Z", FLYTTAT)[0].nyckel, "TIS@2026-11-24@edvin");
const N = "TIS@2026-11-17@edvin";
lika("oförändrat möte är aktuellt", inaktuellt(N, TIS, TZ), false);
lika("flyttat till en annan dag", inaktuellt(N, FLYTTAT, TZ), true);
lika("ny hållare", inaktuellt(N, { ...TIS, hallsAv: "zen" }, TZ), true);
lika("bekräftat innan någon valt", inaktuellt(N, { ...TIS, bekraftat: true }, TZ), true);
lika("avbokat innan någon valt", inaktuellt(N, { ...TIS, utfall: "avbokat" }, TZ), true);
lika("mötet finns inte längre", inaktuellt(N, null, TZ), true);

console.log("\n\x1b[1mEtt öppet förslag: kvar, inaktuellt eller ingen valde\x1b[0m");
// "Ingen valde" ska räknas i facit. Ett förslag som blev inaktuellt före mötet ska inte det.
const UTGAR = "2026-11-17T09:30:00.000Z";
const FORE = new Date("2026-11-17T08:00:00Z"), EFTER = new Date("2026-11-17T09:45:00Z");
lika("före mötet: kvar", oppetLage(N, UTGAR, TIS, FORE, TZ), "oppet");
lika("mötet började utan val", oppetLage(N, UTGAR, TIS, EFTER, TZ), "ingen");
lika("mötet hölls ändå, utan val: ingen valde", oppetLage(N, UTGAR, { ...TIS, utfall: "hallet", utfallNar: "2026-11-17T10:30:00Z" }, new Date("2026-11-18T02:30:00Z"), TZ), "ingen");
lika("bekräftat före mötet", oppetLage(N, UTGAR, { ...TIS, bekraftat: true, bekraftatNar: "2026-11-16T15:00:00Z" }, EFTER, TZ), "inaktuellt");
lika("bekräftat i efterhand räknas som ingen valde", oppetLage(N, UTGAR, { ...TIS, bekraftat: true, bekraftatNar: "2026-11-17T11:00:00Z" }, new Date("2026-11-18T02:30:00Z"), TZ), "ingen");
lika("avbokat före mötet", oppetLage(N, UTGAR, { ...TIS, utfall: "avbokat", utfallNar: "2026-11-16T16:00:00Z" }, EFTER, TZ), "inaktuellt");
lika("flyttat", oppetLage(N, UTGAR, FLYTTAT, EFTER, TZ), "inaktuellt");
lika("ny hållare", oppetLage(N, UTGAR, { ...TIS, hallsAv: "zen" }, FORE, TZ), "inaktuellt");
lika("mötet finns inte längre", oppetLage(N, UTGAR, null, FORE, TZ), "inaktuellt");

console.log("\n\x1b[1mUtfallet på domsdagen\x1b[0m");
lika("hållet", utfallFor(N, { ...TIS, utfall: "hallet" }, TZ), "hallet");
lika("uteblev", utfallFor(N, { ...TIS, utfall: "uteblev" }, TZ), "uteblev");
lika("flyttat efter valet", utfallFor(N, FLYTTAT, TZ), "flyttat");
lika("utfallet är inte satt än", utfallFor(N, TIS, TZ), null);
lika("mötet finns inte längre", utfallFor(N, null, TZ), "okant");

// n hållna av `av`, resten uteblivna, spridda på tre personer och i tidsordning.
let lopnr = 0;
const rader = (...grupper) => {
  const ut = [];
  const kvar = grupper.map(([beslut, n, av]) => ({ beslut, n, av, i: 0 }));
  // Varva grupperna, så att de första tio raderna i tid innehåller alla val.
  for (let varv = 0; kvar.some((g) => g.i < g.av); varv++) {
    for (const g of kvar) {
      if (g.i >= g.av) continue;
      ut.push({ beslut: g.beslut, utfall: g.i < g.n ? "hallet" : "uteblev", om: `p${g.i % 3}`, dag: `2026-11-${String(10 + lopnr++ % 18).padStart(2, "0")}T${String(varv).padStart(2, "0")}:00:00Z` });
      g.i++;
    }
  }
  return ut.map((r, i) => ({ ...r, dag: new Date(Date.UTC(2026, 10, 1) + i * 3600_000).toISOString() }));
};
const av3 = (p) => (p === null ? null : Math.round(p * 1000) / 1000);

console.log("\n\x1b[1mNavs facit per val\x1b[0m");
{
  const F = facitPerVal(rader(["ringer-sjalv", 5, 7], ["lat-sta", 1, 4], ["ingen", 0, 2]), 0.01);
  lika("ringt själv", F.per["ringer-sjalv"], { n: 5, av: 7 });
  lika("låt stå", F.per["lat-sta"], { n: 1, av: 4 });
  lika("ingen valde står bredvid", F.per.ingen, { n: 0, av: 2 });
  lika("för få, tidigast vid 40", { sort: F.dom.sort, p: av3(F.dom.p), tidigast: F.dom.tidigast }, { sort: "for-fa", p: 0.197, tidigast: 40 });
}
lika("5 av 5 mot 0 av 5 ger utslag", facitPerVal(rader(["ringer-sjalv", 5, 5], ["lat-sta", 0, 5]), 0.01).dom.sort, "utslag");
lika("utslaget säger vid hur många möten", facitPerVal(rader(["ringer-sjalv", 5, 5], ["lat-sta", 0, 5]), 0.01).dom.vid, 10);
{
  const d = facitPerVal(rader(["ringer-sjalv", 4, 4], ["lat-sta", 0, 4]), 0.01).dom;
  lika("4 av 4 mot 0 av 4: under tio möten, ingen dom", { ...d, p: av3(d.p) }, { sort: "for-fa", p: 0.014, tidigast: 10, vid: 0 });
}
{
  // En person står för alla möten i "ringer själv": antalen visas, ingen dom.
  const r = rader(["ringer-sjalv", 5, 5], ["lat-sta", 0, 5]).map((x) => (x.beslut === "ringer-sjalv" ? { ...x, om: "edvin" } : x));
  lika("en person står för mer än hälften", facitPerVal(r, 0.01).dom.sort, "en-person");
  lika("antalen visas ändå", facitPerVal(r, 0.01).per["ringer-sjalv"], { n: 5, av: 5 });
}
{
  // Domen ges vid vart tionde möte. Tio möten ger utslag, och fem till ändrar inte domen förrän vid tjugo.
  const tio = rader(["ringer-sjalv", 5, 5], ["lat-sta", 0, 5]);
  const fler = [...tio, ...rader(["lat-sta", 5, 5]).map((x, i) => ({ ...x, dag: new Date(Date.UTC(2026, 11, 1) + i * 3600_000).toISOString() }))];
  const F = facitPerVal(fler, 0.01);
  lika("antalen är de senaste", F.per["lat-sta"], { n: 5, av: 10 });
  lika("domen står kvar från tio möten", [F.dom.sort, F.dom.vid], ["utslag", 10]);
  lika("talen domen räknades på är de tio första mötena", facitVid(fler, 10), { hog: { n: 5, av: 5 }, lag: { n: 0, av: 5 } });
  lika("före tio möten finns inga sådana tal", facitVid(fler, 0), { hog: { n: 0, av: 0 }, lag: { n: 0, av: 0 } });
}
{
  const r = [
    ...rader(["ringer-sjalv", 5, 5], ["lat-sta", 0, 5]),
    { beslut: "flytta", utfall: "flyttat", om: "p0", dag: "2026-11-20T10:00:00Z" },
    { beslut: "ringer-sjalv", utfall: "okant", om: "p0", dag: "2026-11-20T11:00:00Z" },
    { beslut: "inaktuellt", utfall: "hallet", om: "p0", dag: "2026-11-20T12:00:00Z" },
    { beslut: "ringer-sjalv", utfall: "avbokat", om: "p1", dag: "2026-11-20T13:00:00Z" },
  ];
  const F = facitPerVal(r, 0.01);
  lika("flyttade räknas för sig", F.flyttade, 1);
  lika("okänt och inaktuellt räknas inte, avbokat räknas som inte hållet", F.per["ringer-sjalv"], { n: 5, av: 6 });
  lika("delningen per val går att visa", F.detalj["ringer-sjalv"], { hallet: 5, uteblev: 0, avbokat: 1 });
}
lika("inga rader", facitPerVal([], 0.01).dom, { sort: "tomt", p: null, tidigast: null, vid: 0 });
lika("bara ett val har möten", facitPerVal(rader(["ringer-sjalv", 3, 3]), 0.01).dom.sort, "tomt");
lika("ringt själv är inte bättre: ingen gissning om när", facitPerVal(rader(["ringer-sjalv", 1, 6], ["lat-sta", 4, 5]), 0.01).dom.tidigast, null);
lika("var tionde möte", [facitDags(9, 0), facitDags(10, 0), facitDags(19, 10), facitDags(20, 10)], [false, true, false, true]);

console.log("\n\x1b[1mDet Nav trodde\x1b[0m");
lika("1 av 4 mot 5 av 7: för få för att säga något", forFaAttSaga({ n: 1, av: 4 }, { n: 5, av: 7 }, 0.01), true);
lika("0 av 5 mot 5 av 5: det går att säga", forFaAttSaga({ n: 0, av: 5 }, { n: 5, av: 5 }, 0.01), false);
lika("inget att jämföra med", forFaAttSaga({ n: 1, av: 4 }, { n: 0, av: 0 }, 0.01), true);
lika("under 20 rader stäms inget av", troddeAvstamning(Array.from({ length: 19 }, () => ({ trodde: { n: 1, av: 4 }, utfall: "hallet" }))), null);
lika("20 rader: räknade med 9, det blev 11", troddeAvstamning(Array.from({ length: 20 }, (_x, i) => ({ trodde: { n: 9, av: 20 }, utfall: i < 11 ? "hallet" : "uteblev" }))), { raknade: 9, av: 20, blev: 11 });
lika("rader utan trodde och utan utfall räknas inte", troddeAvstamning([...Array.from({ length: 20 }, () => ({ trodde: { n: 1, av: 2 }, utfall: "hallet" })), { trodde: null, utfall: "hallet" }, { trodde: { n: 1, av: 2 }, utfall: "flyttat" }]).av, 20);

console.log("\n\x1b[1mDomen över en ändring\x1b[0m");
// Måttet är uteblivna (bättre nedåt), motvikten hållna av alla (bättre uppåt).
// Domen prövas vid fasta antal, 20 och 40 möten efter ändringen, med halva gränsen
// per tillfälle. Prövad varje vecka hade en ändring utan verkan fått en dom en gång av åtta.
lika("kontrollpunkterna", [kollpunkt(0), kollpunkt(19), kollpunkt(20), kollpunkt(39), kollpunkt(40), kollpunkt(75)], [0, 0, 20, 20, 40, 40]);
const A = {
  fore: { n: 11, av: 40 }, efter: { n: 2, av: 40 }, motFore: { n: 26, av: 44 }, motEfter: { n: 36, av: 42 },
  resten: { fore: { n: 6, av: 30 }, efter: { n: 6, av: 30 } }, veckor: 5, battre: "ned", motBattre: "upp", grans: 0.05, gransMotvikt: 0.2,
};
lika("ser bra ut", domAndring(A), { sort: "ser-bra-ut", stangd: true, restenOcksa: false, helaLaget: false });
lika("utslag redan vid 20 möten", domAndring({ ...A, efter: { n: 0, av: 20 } }).sort, "ser-bra-ut");
lika("0,04 räcker inte när gränsen delas på två tillfällen", domAndring({ ...A, efter: { n: 4, av: 40 } }).sort, "ingen-skillnad");
lika("bättre, men motvikten blev sämre", domAndring({ ...A, motEfter: { n: 14, av: 42 } }).sort, "battre-men");
lika("motvikten åt fel håll men inom slumpen", domAndring({ ...A, motEfter: { n: 24, av: 42 } }).sort, "ser-bra-ut");
lika("resten av laget blev också bättre", domAndring({ ...A, resten: { fore: { n: 9, av: 30 }, efter: { n: 3, av: 30 } } }).restenOcksa, true);
lika("resten rörde sig för lite", domAndring({ ...A, resten: { fore: { n: 6, av: 30 }, efter: { n: 5, av: 30 } } }).restenOcksa, false);
lika("resten rörde sig åt andra hållet", domAndring({ ...A, resten: { fore: { n: 3, av: 30 }, efter: { n: 9, av: 30 } } }).restenOcksa, false);
lika("ändringen gäller hela laget", domAndring({ ...A, resten: null }).helaLaget, true);
lika("ser sämre ut", domAndring({ ...A, fore: { n: 2, av: 40 }, efter: { n: 11, av: 40 } }).sort, "ser-samre-ut");
lika("inget före att jämföra med", domAndring({ ...A, fore: { n: 2, av: 15 } }), { sort: "inget-fore", stangd: false, restenOcksa: false, helaLaget: false });
lika("för tidigt: för få efter", domAndring({ ...A, efter: { n: 1, av: 12 } }), { sort: "for-tidigt", stangd: false, restenOcksa: false, helaLaget: false });
lika("för tidigt: 25 möten utan utslag", domAndring({ ...A, efter: { n: 6, av: 25 } }).sort, "for-tidigt");
lika("40 möten utan utslag stänger raden", domAndring({ ...A, efter: { n: 8, av: 40 } }), { sort: "ingen-skillnad", stangd: true, restenOcksa: false, helaLaget: false });
lika("tolv veckor och för få möten", domAndring({ ...A, efter: { n: 1, av: 12 }, veckor: 12 }), { sort: "for-fa", stangd: true, restenOcksa: false, helaLaget: false });
lika("tolv veckor, 20–39 möten utan utslag", domAndring({ ...A, efter: { n: 6, av: 30 }, veckor: 12 }).sort, "for-fa");
lika("inget före stängs också efter tolv veckor", domAndring({ ...A, fore: { n: 2, av: 15 }, veckor: 12 }).stangd, true);
lika("ett mått som är bättre uppåt", domAndring({ ...A, battre: "upp", motBattre: "ned", fore: { n: 20, av: 40 }, efter: { n: 34, av: 40 }, motFore: { n: 5, av: 40 }, motEfter: { n: 5, av: 40 } }).sort, "ser-bra-ut");

console.log("\n\x1b[1mTrendregeln\x1b[0m");
const avgjorda = (antal, uteblev) => Array.from({ length: antal }, (_x, i) => ({ moteTid: new Date(Date.UTC(2026, 10, 1) + i * 3600_000).toISOString(), utfall: uteblev(i) ? "uteblev" : "hallet" }));
lika("elva möten: säger hur långt det är kvar", trendLaget(avgjorda(11, () => false), 0.01), { lage: "saknas", har: 11, behover: 60 });
{
  // 60 möten: 6 av de 40 första uteblev, 12 av de 20 senaste.
  const t = trendLaget(avgjorda(60, (i) => (i < 40 ? i % 7 === 0 : i % 5 < 3)), 0.01);
  lika("de 20 senaste mot de 40 före", [t.nya, t.fore], [{ n: 12, av: 20 }, { n: 6, av: 40 }]);
  lika("stor ökning ger utslag", t.lage, "utslag");
}
lika("ingen ökning ger inget", trendLaget(avgjorda(60, (i) => i % 6 === 0), 0.01).lage, "inget");
lika("ordningen i indatan spelar ingen roll", trendLaget(avgjorda(60, (i) => (i < 40 ? i % 7 === 0 : i % 5 < 3)).reverse(), 0.01).nya, { n: 12, av: 20 });
lika("fler än 60: bara de 60 senaste", trendLaget(avgjorda(80, (i) => i < 20), 0.01).fore, { n: 0, av: 40 });

console.log("\n\x1b[1mInställningarna\x1b[0m");
{
  const { FORSLAG_FORVAL, lasForslagInst, provaForslagInst, farAndraForslagInst } = await import("../src/lib/nav2/forslagforma.ts");
  lika("utan rader gäller förvalen", lasForslagInst([]), FORSLAG_FORVAL);
  lika("förvalen: allt av, gränserna som i designen", [FORSLAG_FORVAL.pa, FORSLAG_FORVAL.obekraftatTid, FORSLAG_FORVAL.gransFacit, FORSLAG_FORVAL.gransDom, FORSLAG_FORVAL.gransPerson, FORSLAG_FORVAL.gransMotvikt, FORSLAG_FORVAL.hemNytt],
    [false, "14:00", 0.01, 0.05, 0.01, 0.2, []]);
  lika("de följda inställningarna från början", FORSLAG_FORVAL.foljda, ["moten.bekrafta-dagar", "moten.bekrafta-tid", "moten.bekrafta-paminn"]);
  const U = "b0000000-0000-4000-8000-000000000001";
  const inst = lasForslagInst([
    { key: "forslag.pa", value: true }, { key: "forslag.obekraftat-tid", value: "13:30" }, { key: "forslag.grans-facit", value: 0.005 },
    { key: "hem.nytt", value: [U] }, { key: "forslag.grans-dom", value: "trasigt" }, { key: "annat.nyckel", value: 1 },
  ]);
  lika("sparade värden läses", [inst.pa, inst.obekraftatTid, inst.gransFacit, inst.hemNytt], [true, "13:30", 0.005, [U]]);
  lika("ett trasigt värde ger förvalet", inst.gransDom, 0.05);
  lika("hem.nytt kan vara alla", lasForslagInst([{ key: "hem.nytt", value: "alla" }]).hemNytt, "alla");
  lika("gränsen för facit: 0,001 till 0,1", [provaForslagInst("forslag.grans-facit", 0.0005).ok, provaForslagInst("forslag.grans-facit", 0.2).ok, provaForslagInst("forslag.grans-facit", 0.02)], [false, false, { ok: true, varde: 0.02 }]);
  lika("felet säger vad som gäller", provaForslagInst("forslag.grans-facit", 0.2), { ok: false, fel: "Gränsen ska vara mellan 0,001 och 0,1." });
  lika("klockslaget ska vara TT:MM", [provaForslagInst("forslag.obekraftat-tid", "25:00").ok, provaForslagInst("forslag.obekraftat-tid", "09:15")], [false, { ok: true, varde: "09:15" }]);
  lika("på eller av", [provaForslagInst("forslag.pa", "ja").ok, provaForslagInst("forslag.pa", true)], [false, { ok: true, varde: true }]);
  lika("hem.nytt: en lista personer utan dubbletter", provaForslagInst("hem.nytt", [U, U]), { ok: true, varde: [U] });
  lika("hem.nytt: annat än id:n nekas", provaForslagInst("hem.nytt", ["kalle"]).ok, false);
  lika("en okänd nyckel nekas", provaForslagInst("moten.tidszon", "Europe/Stockholm"), { ok: false, fel: "Okänd inställning." });
  lika("följda inställningar är nycklar", [provaForslagInst("forslag.foljda-installningar", ["moten.bekrafta-dagar"]).ok, provaForslagInst("forslag.foljda-installningar", ["DROP TABLE"]).ok], [true, false]);
  // Brytarna (på/av, vilka som har nya hemmet) ändras bara av superadmin. Gränserna av admin och uppåt.
  lika("en säljare ändrar ingenting", farAndraForslagInst(["salesperson"], "forslag.grans-facit"), false);
  lika("en teamledare ändrar ingen gräns: den som döms ska inte kunna flytta ribban", ["forslag.grans-facit", "forslag.grans-dom", "forslag.grans-person", "forslag.grans-motvikt"].map((k) => farAndraForslagInst(["team_lead"], k)), [false, false, false, false]);
  lika("en säljchef ändrar ingen gräns heller", farAndraForslagInst(["sales_manager"], "forslag.grans-dom"), false);
  lika("en teamledare ändrar klockslaget för obekräftade möten", farAndraForslagInst(["team_lead"], "forslag.obekraftat-tid"), true);
  lika("vd och admin ändrar gränserna", [farAndraForslagInst(["ceo"], "forslag.grans-dom"), farAndraForslagInst(["admin"], "forslag.grans-motvikt")], [true, true]);
  lika("en teamledare slår inte på förslagen", farAndraForslagInst(["team_lead"], "forslag.pa"), false);
  lika("en säljchef väljer inte vilka som har nya hemmet", farAndraForslagInst(["sales_manager"], "hem.nytt"), false);
  lika("en admin slår på förslagen", [farAndraForslagInst(["admin"], "forslag.pa"), farAndraForslagInst(["ceo"], "hem.nytt")], [true, true]);
}

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m\n` : "\n\x1b[32mAllt stämmer\x1b[0m\n");
process.exit(fel ? 1 : 0);
