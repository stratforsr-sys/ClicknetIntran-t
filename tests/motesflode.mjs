#!/usr/bin/env node
/**
 * Möten: den rena regelmodulen för bekräftelsefönster, pipelinekolumn, nivå,
 * fördelning av mötesprovision och inställningar med förval.
 *
 *   TZ=UTC node --experimental-strip-types tests/motesflode.mjs
 */
import {
  INST_FORVAL, PIPE_KOLUMNER, lasInstallningar, lokalDag, bekraftelseFonster, pipelineKolumn,
  bradska, niva, fordela, taptSkal, manadFor, kortFas, ursprungligBokare, sorteraFas, provaInstallning, INST_NYCKLAR,
  sparadeSvar, motesTz, giltigTidszon, MOTES_NULAGE, MOTES_NEJ_SKAL, MOTES_KALLOR, motesVal, omfattas, nivaSvar, raknaRader, andel, omraknadRad, rattelseNot, radernaStammer, harLastBelopp, vemPaminns, utanRedanSkickade, provaAngra,
  vemBekraftar, foregaendeArbetsdag, nastaArbetsdag,
} from "../src/lib/nav2/motesflode.ts";

let fel = 0;
const ok = (namn, villkor) => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}`);
  if (!villkor) fel++;
};
const text = (x) => JSON.stringify(x);
const lika = (namn, fas, vantat) => ok(`${namn} (fick ${text(fas)})`, text(fas) === text(vantat));
const tz = "Europe/Stockholm";

console.log("\nBladens val på en plats (S1–S3): samma värden som före flytten");
lika("nulägets nycklar och texter", MOTES_NULAGE, { ingen: "Ingen SEO", sjalv: "Gör själv", byra: "Har byrå" });
lika("nej-skälen, i samma ordning", [...MOTES_NEJ_SKAL], ["Har redan en byrå", "För dyrt", "Inte nu", "Fel kontaktperson", "Annat"]);
lika("källförslagen, i samma ordning", [...MOTES_KALLOR], ["Kallsamtal", "Hemsida", "Rekommendation", "Tidigare kund"]);
lika("motesVal() skickar de tre listorna till gränssnittet", motesVal(), { nulage: { ingen: "Ingen SEO", sjalv: "Gör själv", byra: "Har byrå" }, nejSkal: ["Har redan en byrå", "För dyrt", "Inte nu", "Fel kontaktperson", "Annat"], kallor: ["Kallsamtal", "Hemsida", "Rekommendation", "Tidigare kund"] });
ok("motesVal() ger kopior: en ändring hos mottagaren rör inte listorna", (() => { const v = motesVal(); v.nejSkal.push("x"); v.kallor.length = 0; v.nulage.ny = "y"; return MOTES_NEJ_SKAL.length === 5 && MOTES_KALLOR.length === 4 && !("ny" in MOTES_NULAGE); })());

console.log("\nKlockslagens tidszon (B19)");
ok("motesTz() är en tidszon som finns", giltigTidszon(motesTz()));
ok("förvalet för inställningen moten.tidszon är samma zon som klockslagen går i", INST_FORVAL.tidszon === motesTz());
ok("ett klockslag i motesTz() följer sommartiden (09:00 UTC i juli är 11:00)", new Intl.DateTimeFormat("sv-SE", { timeZone: motesTz(), hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date("2026-07-01T09:00:00Z")) === "11:00");

console.log("\nSparade svar till bladet Ändra svaren (F18.2)");
lika("svaren läses som id och ja, texten följer inte med", sparadeSvar([{ id: "a", text: "Fråga?", ja: true }, { id: "b", text: "Annan?", ja: false }]), [{ id: "a", ja: true }, { id: "b", ja: false }]);
lika("ett svar utan id eller utan ja hoppas över", sparadeSvar([{ id: "a", ja: true }, { id: "", ja: true }, { ja: false }, { id: "c", ja: "ja" }, null, "x"]), [{ id: "a", ja: true }]);
lika("tom kolumn ger null", sparadeSvar(null), null);
lika("tom lista ger null", sparadeSvar([]), null);
lika("ett objekt i stället för en lista ger null", sparadeSvar({ id: "a", ja: true }), null);

console.log("Inställningar");
lika("tom lista ger förvalet", lasInstallningar([]), INST_FORVAL);
lika("kolumnordningen", PIPE_KOLUMNER, ["bokat", "att_bekrafta", "bekraftat", "hos_saljaren", "avgjort"]);
{
  const i = lasInstallningar([
    { key: "moten.bekrafta-dagar", value: "tre" },
    { key: "moten.tidszon", value: "Mars/Olympus" },
    { key: "moten.provision", value: { kvalificerat: -5, hallet: 300 } },
  ]);
  lika("dagar som text ger 2", i.bekraftaDagar, 2);
  lika("okänd tidszon ger förvalet", i.tidszon, "Europe/Stockholm");
  lika("negativt belopp ger hela förvalet", i.satser, { kvalificerat: 0, hallet: 0 });
}
lika("dagar 15 ger 2", lasInstallningar([{ key: "moten.bekrafta-dagar", value: 15 }]).bekraftaDagar, 2);
lika("dagar -1 ger 2", lasInstallningar([{ key: "moten.bekrafta-dagar", value: -1 }]).bekraftaDagar, 2);
lika("dagar 0 gäller", lasInstallningar([{ key: "moten.bekrafta-dagar", value: 0 }]).bekraftaDagar, 0);
lika("dagar 3 gäller", lasInstallningar([{ key: "moten.bekrafta-dagar", value: 3 }]).bekraftaDagar, 3);
{
  const sex = Array.from({ length: 6 }, (_, n) => ({ id: `f${n}`, text: `Fråga ${n}`, aktiv: true }));
  lika("sex frågor ger förvalet", lasInstallningar([{ key: "moten.fragor", value: sex }]).fragor, INST_FORVAL.fragor);
  lika("tom text ger förvalet", lasInstallningar([{ key: "moten.fragor", value: [{ id: "a", text: " ", aktiv: true }] }]).fragor, INST_FORVAL.fragor);
  const en = [{ id: "a", text: "Var VD med?", aktiv: true }];
  lika("en giltig fråga gäller", lasInstallningar([{ key: "moten.fragor", value: en }]).fragor, en);
  lika("noll frågor gäller", lasInstallningar([{ key: "moten.fragor", value: [] }]).fragor, []);
}
{
  const k = lasInstallningar([{ key: "moten.kolumnnamn", value: { bokat: "", hos_saljaren: "Väntar på rapport", avgjort: "x".repeat(25) } }]).kolumnnamn;
  lika("tomt namn ger förvalet för namnet", k.bokat, "Bokat");
  lika("giltigt namn gäller", k.hos_saljaren, "Väntar på rapport");
  lika("för långt namn ger förvalet", k.avgjort, "Avgjort");
}
lika("belopp gäller", lasInstallningar([{ key: "moten.provision", value: { kvalificerat: 600, hallet: 300 } }]).satser, { kvalificerat: 600, hallet: 300 });
lika("dela gäller", lasInstallningar([{ key: "moten.ombokning-provision", value: "dela" }]).ombokning, "dela");
lika("okänd regel ger ny", lasInstallningar([{ key: "moten.ombokning-provision", value: "halva" }]).ombokning, "ny");
lika("prefix gäller", lasInstallningar([{ key: "moten.rubrik-prefix", value: "Clicknet" }]).rubrikPrefix, "Clicknet");
lika("felaktig påminnelsetid ger förvalet", lasInstallningar([{ key: "moten.utfall-paminnelse", value: "25:00" }]).utfallPaminnelse, "18:00");
lika("mottagare gäller", lasInstallningar([{ key: "moten.mottagare", value: ["a", "b"] }]).mottagare, ["a", "b"]);
lika("bekräftelsens klockslag: förvalet 09:00", INST_FORVAL.bekraftaTid, "09:00");
lika("bekräftelsens klockslag gäller", lasInstallningar([{ key: "moten.bekrafta-tid", value: "13:30" }]).bekraftaTid, "13:30");
lika("bekräftelsens klockslag 9:00 (utan nolla) ger förvalet", lasInstallningar([{ key: "moten.bekrafta-tid", value: "9:00" }]).bekraftaTid, "09:00");
lika("uppgift och notis: på som förval", INST_FORVAL.bekraftaPaminn, true);
lika("uppgift och notis: av gäller", lasInstallningar([{ key: "moten.bekrafta-paminn", value: false }]).bekraftaPaminn, false);
lika("uppgift och notis: \"nej\" ger förvalet", lasInstallningar([{ key: "moten.bekrafta-paminn", value: "nej" }]).bekraftaPaminn, true);
lika("okänd nyckel välter inget", lasInstallningar([{ key: "moten.okand", value: 1 }, { key: "annat", value: null }]), INST_FORVAL);

console.log("Att spara en inställning (provaInstallning)");
{
  const fel = (n, v) => { const r = provaInstallning(n, v); return r.ok ? null : r.fel; };
  ok("30 dagar nekas med en mening", /0 till 14/.test(fel("moten.bekrafta-dagar", 30) ?? ""));
  ok("okänd nyckel nekas", !!fel("moten.okand", 1));
  ok("gäller från går inte att ändra", !!fel("moten.galler-fran", "2026-01-01T00:00:00Z"));
  lika("3 dagar går", provaInstallning("moten.bekrafta-dagar", 3), { ok: true, varde: 3 });
  lika("beloppen avrundas till ören", provaInstallning("moten.provision", { kvalificerat: 600.005, hallet: 300 }), { ok: true, varde: { kvalificerat: 600.01, hallet: 300 } });
  ok("negativt belopp nekas", !!fel("moten.provision", { kvalificerat: -1, hallet: 300 }));
  ok("ett kolumnnamn för långt nekas", !!fel("moten.kolumnnamn", { bokat: "x".repeat(25) }));
  ok("en okänd kolumn nekas", !!fel("moten.kolumnnamn", { klar: "Klar" }));
  lika("kolumnnamn trimmas", provaInstallning("moten.kolumnnamn", { hos_saljaren: " Väntar på rapport " }), { ok: true, varde: { hos_saljaren: "Väntar på rapport" } });
  ok("sex frågor nekas", !!fel("moten.fragor", Array.from({ length: 6 }, (_, i) => ({ id: "f" + i, text: "F", aktiv: true }))));
  ok("två frågor med samma id nekas", !!fel("moten.fragor", [{ id: "a", text: "A", aktiv: true }, { id: "a", text: "B", aktiv: true }]));
  ok("okänd tidszon nekas", !!fel("moten.tidszon", "Mars/Olympus"));
  lika("en riktig tidszon går", provaInstallning("moten.tidszon", "Europe/Oslo"), { ok: true, varde: "Europe/Oslo" });
  ok("25:00 nekas", !!fel("moten.utfall-paminnelse", "25:00"));
  ok("bekräftelsens klockslag 24:00 nekas med en mening", /TT:MM/.test(fel("moten.bekrafta-tid", "24:00") ?? ""));
  lika("bekräftelsens klockslag 08:30 går", provaInstallning("moten.bekrafta-tid", "08:30"), { ok: true, varde: "08:30" });
  lika("uppgift och notis av går", provaInstallning("moten.bekrafta-paminn", false), { ok: true, varde: false });
  ok("uppgift och notis som text nekas", !!fel("moten.bekrafta-paminn", "av"));
  ok("halva nekas", !!fel("moten.ombokning-provision", "halva"));
  lika("tomt prefix går", provaInstallning("moten.rubrik-prefix", "  "), { ok: true, varde: "" });
  ok("41 tecken prefix nekas", !!fel("moten.rubrik-prefix", "x".repeat(41)));
  ok("mottagare som inte är text nekas", !!fel("moten.mottagare", [1, 2]));
  ok("varje nyckel matchar nav_setting-mönstret", Object.values(INST_NYCKLAR).every((k) => /^[a-z0-9.-]{1,60}$/.test(k)));
}

console.log("Lokal dag och fönster");
lika("lokal dag efter midnatt", lokalDag("2026-11-15T23:15:00Z", tz), "2026-11-16");
lika("lokal dag i UTC", lokalDag("2026-11-15T23:15:00Z", "UTC"), "2026-11-15");
const M = "2026-11-16T08:00:00Z"; // måndag 16 nov 09:00 i Stockholm
lika("arbetsdagen före en måndag är fredagen", foregaendeArbetsdag("2026-11-16"), "2026-11-13");
lika("arbetsdagen efter en fredag är måndagen", nastaArbetsdag("2026-11-13"), "2026-11-16");
lika("arbetsdagen efter lördag är måndag", nastaArbetsdag("2026-11-14"), "2026-11-16");
lika("arbetsdagen före annandag jul-helgen (mån 28 dec) är onsdag 23 dec", foregaendeArbetsdag("2026-12-28"), "2026-12-23");
lika("måndagsmöte, två arbetsdagar: torsdag till fredag", bekraftelseFonster({ moteTid: M, senastAndrad: "2026-11-02T09:00:00Z", dagar: 2, tz }), { oppnar: "2026-11-12", senast: "2026-11-13" });
lika("tisdagsmöte: fredag till måndag", bekraftelseFonster({ moteTid: "2026-11-17T09:00:00Z", senastAndrad: "2026-11-02T09:00:00Z", dagar: 2, tz }), { oppnar: "2026-11-13", senast: "2026-11-16" });
lika("onsdagsmöte: måndag till tisdag", bekraftelseFonster({ moteTid: "2026-11-18T09:00:00Z", senastAndrad: "2026-11-02T09:00:00Z", dagar: 2, tz }), { oppnar: "2026-11-16", senast: "2026-11-17" });
lika("en arbetsdag: fredagen före en måndag", bekraftelseFonster({ moteTid: M, senastAndrad: "2026-11-02T09:00:00Z", dagar: 1, tz }), { oppnar: "2026-11-13", senast: "2026-11-13" });
lika("bokat arbetsdagen före (fredag): senast på mötesdagen", bekraftelseFonster({ moteTid: M, senastAndrad: "2026-11-13T10:00:00Z", dagar: 2, tz }).senast, "2026-11-16");
lika("bokat på lördagen: senast på mötesdagen", bekraftelseFonster({ moteTid: M, senastAndrad: "2026-11-14T10:00:00Z", dagar: 2, tz }).senast, "2026-11-16");
lika("bokat samma dag", bekraftelseFonster({ moteTid: M, senastAndrad: "2026-11-16T06:00:00Z", dagar: 2, tz }).senast, "2026-11-16");
lika("00:15 måndag lokalt räknas från måndagen", bekraftelseFonster({ moteTid: "2026-11-15T23:15:00Z", senastAndrad: "2026-11-01T09:00:00Z", dagar: 2, tz }).oppnar, "2026-11-12");
lika("över sommartiden (måndag 26 okt)", bekraftelseFonster({ moteTid: "2026-10-26T08:00:00Z", senastAndrad: "2026-10-01T09:00:00Z", dagar: 2, tz }).oppnar, "2026-10-22");
lika("dagar 0 öppnar på mötesdagen", bekraftelseFonster({ moteTid: M, senastAndrad: "2026-11-02T09:00:00Z", dagar: 0, tz }), { oppnar: "2026-11-16", senast: "2026-11-16" });
lika("över månadsskiftet (tisdag 1 dec)", bekraftelseFonster({ moteTid: "2026-12-01T09:00:00Z", senastAndrad: "2026-11-02T09:00:00Z", dagar: 2, tz }), { oppnar: "2026-11-27", senast: "2026-11-30" });
lika("julen räknas inte (måndag 28 dec)", bekraftelseFonster({ moteTid: "2026-12-28T09:00:00Z", senastAndrad: "2026-12-01T09:00:00Z", dagar: 2, tz }), { oppnar: "2026-12-22", senast: "2026-12-23" });
lika("trettondagen räknas inte (torsdag 7 jan)", bekraftelseFonster({ moteTid: "2027-01-07T09:00:00Z", senastAndrad: "2026-12-01T09:00:00Z", dagar: 2, tz }), { oppnar: "2027-01-04", senast: "2027-01-05" });
lika("fem arbetsdagar hoppar över en helg", bekraftelseFonster({ moteTid: "2026-11-20T09:00:00Z", senastAndrad: "2026-11-01T09:00:00Z", dagar: 5, tz }), { oppnar: "2026-11-13", senast: "2026-11-19" });

console.log("Pipelinekolumn");
const mote = { moteTid: M, langd: 30, bekraftat: false, utfall: null };
const f = bekraftelseFonster({ moteTid: M, senastAndrad: "2026-11-02T09:00:00Z", dagar: 2, tz });
lika("före fönstret: bokat", pipelineKolumn(mote, f, new Date("2026-11-11T10:00:00Z"), tz), "bokat");
lika("23:30 onsdag UTC = 00:30 torsdag lokalt: att bekräfta", pipelineKolumn(mote, f, new Date("2026-11-11T23:30:00Z"), tz), "att_bekrafta");
lika("lördag mellan fönstret och mötet: att bekräfta", pipelineKolumn(mote, f, new Date("2026-11-14T00:30:00Z"), tz), "att_bekrafta");
lika("bekräftat", pipelineKolumn({ ...mote, bekraftat: true }, f, new Date("2026-11-14T00:30:00Z"), tz), "bekraftat");
lika("bekräftat före fönstret", pipelineKolumn({ ...mote, bekraftat: true }, f, new Date("2026-11-10T00:30:00Z"), tz), "bekraftat");
lika("under mötet: fortfarande bekräftat", pipelineKolumn({ ...mote, bekraftat: true }, f, new Date("2026-11-16T08:20:00Z"), tz), "bekraftat");
lika("efter slutet: hos säljaren", pipelineKolumn(mote, f, new Date("2026-11-16T08:31:00Z"), tz), "hos_saljaren");
lika("efter slutet bekräftat: hos säljaren", pipelineKolumn({ ...mote, bekraftat: true }, f, new Date("2026-11-16T08:31:00Z"), tz), "hos_saljaren");
lika("utfall: avgjort", pipelineKolumn({ ...mote, utfall: "hallet" }, f, new Date("2026-11-13T10:00:00Z"), tz), "avgjort");
lika("kortFas utan öppet möte", kortFas({ harOppetMote: false, mote: null, fonster: null }, new Date(), tz), "avgjort");
lika("kortFas med öppet möte", kortFas({ harOppetMote: true, mote, fonster: f }, new Date("2026-11-11T10:00:00Z"), tz), "bokat");

console.log("Brådska (i morgon = nästa arbetsdag)");
lika("i dag", bradska("2026-11-16", "att_bekrafta", new Date("2026-11-16T12:00:00Z"), tz), "idag");
lika("fredag före senast måndag: i morgon", bradska("2026-11-16", "att_bekrafta", new Date("2026-11-13T12:00:00Z"), tz), "imorgon");
lika("lördag före senast måndag: i morgon", bradska("2026-11-16", "att_bekrafta", new Date("2026-11-14T12:00:00Z"), tz), "imorgon");
lika("måndag före senast tisdag: i morgon", bradska("2026-11-17", "att_bekrafta", new Date("2026-11-16T12:00:00Z"), tz), "imorgon");
lika("passerad senast", bradska("2026-11-16", "att_bekrafta", new Date("2026-11-17T07:00:00Z"), tz), "idag");
lika("långt kvar", bradska("2026-11-16", "att_bekrafta", new Date("2026-11-12T12:00:00Z"), tz), null);
lika("bekräftat har ingen brådska", bradska("2026-11-16", "bekraftat", new Date("2026-11-16T12:00:00Z"), tz), null);
lika("bokat dagen före senast: i morgon", bradska("2026-11-16", "bokat", new Date("2026-11-13T12:00:00Z"), tz), "imorgon");

console.log("Nivå");
const F2 = INST_FORVAL.fragor;
lika("båda ja", niva(F2, [{ id: "beslutsfattare", ja: true }, { id: "syfte", ja: true }]), "kvalificerat");
lika("ett nej", niva(F2, [{ id: "beslutsfattare", ja: true }, { id: "syfte", ja: false }]), "hallet");
ok("ett svar saknas ger fel", typeof niva(F2, [{ id: "beslutsfattare", ja: true }]) === "object");
lika("noll aktiva", niva([{ id: "a", text: "A", aktiv: false }], []), "kvalificerat");
lika("svar på inaktiv ignoreras", niva([{ id: "a", text: "A", aktiv: true }, { id: "b", text: "B", aktiv: false }], [{ id: "a", ja: true }, { id: "b", ja: false }]), "kvalificerat");

console.log("Fördelning");
const MO = ["O", "R"];
const fd = (o) => fordela({ ursprunglig: "O", bokatAv: "O", hallsAv: "S", mottagare: MO, regel: "ny", belopp: 600, ...o });
lika("ursprunglig bokade", fd({}), [{ employeeId: "O", belopp: 600, delatMed: null }]);
lika("säljaren bokade om", fd({ bokatAv: "S" }), [{ employeeId: "O", belopp: 600, delatMed: null }]);
lika("annan bokare, ny", fd({ bokatAv: "R" }), [{ employeeId: "R", belopp: 600, delatMed: null }]);
lika("annan bokare, dela", fd({ bokatAv: "R", regel: "dela" }), [{ employeeId: "O", belopp: 300, delatMed: "R" }, { employeeId: "R", belopp: 300, delatMed: "O" }]);
lika("ojämnt belopp", fd({ bokatAv: "R", regel: "dela", belopp: 300.01 }), [{ employeeId: "O", belopp: 150, delatMed: "R" }, { employeeId: "R", belopp: 150.01, delatMed: "O" }]);
lika("bokaren håller själv", fd({ hallsAv: "O" }), []);
lika("dela när hållaren är ursprunglig", fd({ bokatAv: "R", regel: "dela", hallsAv: "O" }), [{ employeeId: "R", belopp: 600, delatMed: null }]);
lika("ingen markerad", fordela({ ursprunglig: "O", bokatAv: "R", hallsAv: "S", mottagare: [], regel: "dela", belopp: 600 }), []);
lika("bara R markerad, dela", fordela({ ursprunglig: "O", bokatAv: "R", hallsAv: "S", mottagare: ["R"], regel: "dela", belopp: 600 }), [{ employeeId: "R", belopp: 600, delatMed: null }]);

console.log("Ursprunglig bokare");
{
  const k = new Map([
    ["a", { art: "ny", foregaende: null, bokatAv: "O" }],
    ["b", { art: "ombokning", foregaende: "a", bokatAv: "S" }],
    ["c", { art: "ombokning", foregaende: "b", bokatAv: "R" }],
    ["u", { art: "uppfoljning", foregaende: null, bokatAv: "O" }],
    ["v", { art: "ombokning", foregaende: "u", bokatAv: "R" }],
    ["x", { art: "ombokning", foregaende: "saknas", bokatAv: "R" }],
    ["y1", { art: "ombokning", foregaende: "y2", bokatAv: "R" }],
    ["y2", { art: "ombokning", foregaende: "y1", bokatAv: "R" }],
  ]);
  lika("nytt möte", ursprungligBokare("a", k), "O");
  lika("ombokat två gånger", ursprungligBokare("c", k), "O");
  lika("uppföljning ger ingen", ursprungligBokare("u", k), null);
  lika("ombokad uppföljning ger ingen", ursprungligBokare("v", k), null);
  lika("föregående saknas: den som bokade", ursprungligBokare("x", k), "R");
  lika("en slinga välter inget", ursprungligBokare("y1", k), null);
  lika("okänt möte", ursprungligBokare("z", k), null);
}

console.log("Ordningen på tavlan");
{
  const kort = [
    { fas: "avgjort", tid: "2026-11-10 10:00" }, { fas: "bokat", tid: "2026-11-20 10:00" },
    { fas: "avgjort", tid: "2026-11-12 10:00" }, { fas: "bokat", tid: "2026-11-18 10:00" },
    { fas: "hos_saljaren", tid: "2026-11-11 09:00" },
  ];
  lika("kolumnvis, stigande, Avgjort fallande", [...kort].sort(sorteraFas).map((k) => k.tid),
    ["2026-11-18 10:00", "2026-11-20 10:00", "2026-11-11 09:00", "2026-11-12 10:00", "2026-11-10 10:00"]);
}

console.log("Skäl och månad");
lika("uteblev obekräftat", taptSkal("uteblev", false), "Inte bekräftat före mötet");
lika("uteblev bekräftat", taptSkal("uteblev", true), "Uteblev trots bekräftelse");
lika("avbokat", taptSkal("avbokat", true), "Avbokat");
lika("månaden i Stockholm", manadFor("2026-11-30T23:30:00Z", tz), "2026-12-01");
lika("månaden mitt i", manadFor("2026-11-16T08:00:00Z", tz), "2026-11-01");

console.log("Låsningen: vilka möten");
ok("möte efter galler-fran omfattas", omfattas("2026-11-12T09:00:00Z", "2026-11-11T22:07:25Z") === true);
ok("möte på sekunden omfattas", omfattas("2026-11-11T22:07:25Z", "2026-11-11T22:07:25Z") === true);
ok("möte före galler-fran omfattas inte", omfattas("2026-11-11T09:00:00Z", "2026-11-11T22:07:25Z") === false);
ok("utan galler-fran omfattas inget (som vantarBedomning i moten.ts)", omfattas("2026-11-12T09:00:00Z", null) === false);

console.log("Svaren sparas med frågans text");
lika("bara aktiva frågor, med texten", nivaSvar(
  [{ id: "a", text: "Fråga A?", aktiv: true }, { id: "b", text: "Fråga B?", aktiv: false }, { id: "c", text: "Fråga C?", aktiv: true }],
  [{ id: "c", ja: false }, { id: "a", ja: true }, { id: "b", ja: true }, { id: "okand", ja: true }],
), [{ id: "a", text: "Fråga A?", ja: true }, { id: "c", text: "Fråga C?", ja: false }]);

console.log("Raderna som låses");
{
  const S = { kvalificerat: 600, hallet: 300 };
  const KV = { niva: "kvalificerat", svar: [] };
  const r = (o) => raknaRader({ ursprunglig: "O", bokatAv: "O", hallsAv: "S", mottagare: ["O", "R"], regel: "ny", satser: S, lage: KV, bekraftat: true, manad: "2026-11-01", ...o });
  lika("kvalificerat: en hel rad med satsen", r({}), [{ employee_id: "O", niva: "kvalificerat", belopp: 600, mojligt: 600, skal: null, satser: S, delat_med: null, del: "hel", manad: "2026-11-01" }]);
  lika("hållet: lägre belopp, samma möjliga", r({ lage: { niva: "hallet", svar: [] } }).map((x) => [x.belopp, x.mojligt, x.niva]), [[300, 600, "hallet"]]);
  lika("bokare utan markering: inga rader", r({ mottagare: ["R"] }), []);
  lika("uppföljning (ursprunglig null): inga rader", r({ ursprunglig: null }), []);
  lika("uteblev obekräftat: belopp 0, skälet, ingen nivå", r({ lage: { tappat: "uteblev" }, bekraftat: false }).map((x) => [x.niva, x.belopp, x.mojligt, x.skal]),
    [[null, 0, 600, "Inte bekräftat före mötet"]]);
  lika("avbokat", r({ lage: { tappat: "avbokat" } }).map((x) => [x.belopp, x.skal]), [[0, "Avbokat"]]);
  const d = r({ bokatAv: "R", regel: "dela", satser: { kvalificerat: 600.01, hallet: 300 } });
  lika("dela: två rader, öret till den som bokade om", d.map((x) => [x.employee_id, x.belopp, x.mojligt, x.del, x.delat_med]),
    [["O", 300, 300, "forsta_halvan", "R"], ["R", 300.01, 300.01, "andra_halvan", "O"]]);
  ok("dela: summan är satsen på öret", Math.round(d.reduce((s, x) => s + x.belopp * 100, 0)) === 60001);
  lika("ny: hela till den som bokade om", r({ bokatAv: "R" }).map((x) => [x.employee_id, x.belopp, x.del]), [["R", 600, "hel"]]);
  lika("dela när hållaren är ursprunglig: hela till R", r({ bokatAv: "R", regel: "dela", hallsAv: "O" }).map((x) => [x.employee_id, x.belopp, x.del, x.delat_med]), [["R", 600, "hel", null]]);
  const sk = r({});
  sk[0].satser.kvalificerat = 1;
  ok("satserna i raden är en kopia", S.kvalificerat === 600);
}

console.log("Omräkning ur raden (aldrig ur dagens inställning)");
{
  lika("andel hel", andel(600.01, "hel"), 600.01);
  lika("andel första halvan", andel(600.01, "forsta_halvan"), 300);
  lika("andel andra halvan", andel(600.01, "andra_halvan"), 300.01);
  const rad = { satser: { kvalificerat: 600.01, hallet: 300 }, del: "andra_halvan" };
  lika("hållet till kvalificerat, andra halvan", omraknadRad(rad, { niva: "kvalificerat", svar: [] }, true), { niva: "kvalificerat", belopp: 300.01, mojligt: 300.01, skal: null });
  lika("till hållet, första halvan", omraknadRad({ ...rad, del: "forsta_halvan" }, { niva: "hallet", svar: [] }, true), { niva: "hallet", belopp: 150, mojligt: 300, skal: null });
  lika("till uteblev, bekräftat", omraknadRad(rad, { tappat: "uteblev" }, true), { niva: null, belopp: 0, mojligt: 300.01, skal: "Uteblev trots bekräftelse" });
}

console.log("Rättelsens text och omkörningen");
lika("texten", rattelseNot("Bolaget AB", "2026-10-15"), "Rättelse möte Bolaget AB 2026-10-15");
{
  const S = { kvalificerat: 600.01, hallet: 300 };
  const rader = [{ niva: null, belopp: 0, skal: "Uteblev trots bekräftelse", satser: S, del: "forsta_halvan" }, { niva: null, belopp: 0, skal: "Uteblev trots bekräftelse", satser: S, del: "andra_halvan" }];
  ok("raderna har redan uteblev: stämmer", radernaStammer(rader, { tappat: "uteblev" }, true) === true);
  ok("annat skäl (obekräftat): stämmer inte", radernaStammer(rader, { tappat: "uteblev" }, false) === false);
  ok("hållet: stämmer inte", radernaStammer(rader, { niva: "hallet", svar: [] }, true) === false);
  ok("kvalificerat med rätt belopp (belopp som sträng): stämmer",
    radernaStammer([{ niva: "kvalificerat", belopp: "300.01", skal: null, satser: S, del: "andra_halvan" }], { niva: "kvalificerat", svar: [] }, true) === true);
  ok("inga rader: stämmer", radernaStammer([], { niva: "hallet", svar: [] }, true) === true);
}

console.log("Påminnelserna: vem ska påminnas");
{
  const inst = { ...INST_FORVAL, gallerFran: "2026-11-01T00:00:00Z" };
  const admins = ["a1", "a2"];
  // Alla tider i Stockholm i november: UTC+1. 18:00 lokal = 17:00Z.
  const m = (o) => ({ id: "m1", slut: "2026-11-10T14:00:00Z", utfall: null, niva: null, utfallNar: null, hallsAv: "h1", ...o });
  const kor = (moten, nuIso, i = inst) => vemPaminns(moten, admins, new Date(nuIso), i);
  lika("utfall saknas, före 18:00: ingenting", kor([m({})], "2026-11-10T16:59:00Z"), []);
  lika("utfall saknas, 18:00: hållaren", kor([m({})], "2026-11-10T17:00:00Z"), [{ kalla: "mote-utfall-saknas", till: "h1", moteId: "m1" }]);
  lika("utfall saknas, sluttiden inte passerad: ingenting", kor([m({ slut: "2026-11-10T18:30:00Z" })], "2026-11-10T18:00:00Z"), []);
  lika("utfall saknas, nästa dag: ingenting till hållaren", kor([m({})], "2026-11-11T17:00:00Z"), []);
  lika("utfall saknas, två dagar efter 18:00: alla admins", kor([m({})], "2026-11-12T17:00:00Z"),
    [{ kalla: "mote-utfall-saknas", till: "a1", moteId: "m1" }, { kalla: "mote-utfall-saknas", till: "a2", moteId: "m1" }]);
  lika("utfall saknas, två dagar efter före 18:00: ingenting", kor([m({})], "2026-11-12T16:00:00Z"), []);
  lika("hållet utan nivå, samma dag 18:00: bedömning till hållaren",
    kor([m({ utfall: "hallet", utfallNar: "2026-11-10T15:00:00Z" })], "2026-11-10T17:00:00Z"), [{ kalla: "mote-bedomning-saknas", till: "h1", moteId: "m1" }]);
  lika("hållet utan nivå, före 18:00: ingenting",
    kor([m({ utfall: "hallet", utfallNar: "2026-11-10T08:00:00Z" })], "2026-11-10T16:00:00Z"), []);
  lika("hållet utan nivå, två dagar efter utfallet: admins",
    kor([m({ utfall: "hallet", utfallNar: "2026-11-10T15:00:00Z" })], "2026-11-12T17:30:00Z"),
    [{ kalla: "mote-bedomning-saknas", till: "a1", moteId: "m1" }, { kalla: "mote-bedomning-saknas", till: "a2", moteId: "m1" }]);
  lika("hållet med nivå: ingenting", kor([m({ utfall: "hallet", niva: "hallet", utfallNar: "2026-11-10T15:00:00Z" })], "2026-11-10T17:00:00Z"), []);
  lika("uteblev: ingenting", kor([m({ utfall: "uteblev", utfallNar: "2026-11-10T15:00:00Z" })], "2026-11-10T17:00:00Z"), []);
  lika("före galler-fran: ingenting", kor([m({ slut: "2026-10-30T14:00:00Z" })], "2026-10-30T17:00:00Z"), []);
  lika("galler-fran saknas: ingenting", kor([m({})], "2026-11-10T17:00:00Z", { ...inst, gallerFran: null }), []);
  lika("påminnelsetiden är inställningen", kor([m({})], "2026-11-10T16:00:00Z", { ...inst, utfallPaminnelse: "17:00" }), [{ kalla: "mote-utfall-saknas", till: "h1", moteId: "m1" }]);
  lika("dagen räknas i tidszonen: 00:30 lokal tid är redan nästa dag", kor([m({ slut: "2026-11-10T22:30:00Z" })], "2026-11-10T23:30:00Z"), []);
  lika("två körningar samma dag: samma lista", kor([m({})], "2026-11-10T17:00:00Z"), kor([m({})], "2026-11-10T20:00:00Z"));
  lika("sommartid: 18:00 lokal är 16:00Z", kor([m({ slut: "2026-10-20T12:00:00Z" })], "2026-10-20T16:00:00Z", { ...inst, gallerFran: "2026-10-01T00:00:00Z" }), [{ kalla: "mote-utfall-saknas", till: "h1", moteId: "m1" }]);
  lika("ingen admin: tom lista två dagar efter", vemPaminns([m({})], [], new Date("2026-11-12T17:00:00Z"), inst), []);
}

console.log("Bekräftelsen: vem ska ringa, och när");
{
  const inst = { ...INST_FORVAL, gallerFran: "2026-11-01T00:00:00Z" };
  const aktiva = new Set(["b1", "h1", "x1"]);
  // Tisdag 17 nov 10:00 i Stockholm (09:00Z), bokat 6 nov. Fönstret: fredag 13 till måndag 16.
  const m = (o) => ({ id: "m1", moteTid: "2026-11-17T09:00:00Z", senastAndrad: "2026-11-06T10:00:00Z", bokatAv: "b1", hallsAv: "h1", bekraftat: false, utfall: null, uppgift: null, ...o });
  const kor = (moten, nuIso, i = inst, a = aktiva) => vemBekraftar(moten, a, new Date(nuIso), i);
  const svar = (o) => ({ moteId: "m1", till: "b1", slag: "ring", skapaUppgift: true, dag: "2026-11-13", senast: "2026-11-16", ...o });
  lika("torsdag före fönstret: ingenting", kor([m({})], "2026-11-12T10:00:00Z"), []);
  lika("fredag 08:59: ingenting än", kor([m({})], "2026-11-13T07:59:00Z"), []);
  lika("fredag 09:00: bokaren ska ringa, uppgiften läggs upp", kor([m({})], "2026-11-13T08:00:00Z"), [svar({})]);
  lika("lördag: ingenting (helg)", kor([m({})], "2026-11-14T08:00:00Z"), []);
  lika("söndag: ingenting (helg)", kor([m({})], "2026-11-15T12:00:00Z"), []);
  lika("måndag 09:00: sista dagen", kor([m({})], "2026-11-16T08:00:00Z"), [svar({ slag: "sista", dag: "2026-11-16" })]);
  lika("mötesdagen 09:00 (mötet 10:00): i dag", kor([m({})], "2026-11-17T08:00:00Z"), [svar({ slag: "idag", dag: "2026-11-17" })]);
  lika("mötesdagen före 09:00: ingenting än", kor([m({})], "2026-11-17T07:30:00Z"), []);
  lika("mötet 09:00: påminnelsen kommer en timme före (08:00)", kor([m({ moteTid: "2026-11-17T08:00:00Z" })], "2026-11-17T07:00:00Z"), [svar({ slag: "idag", dag: "2026-11-17" })]);
  lika("mötet har börjat: ingenting", kor([m({})], "2026-11-17T09:00:00Z"), []);
  lika("bekräftat: ingenting", kor([m({ bekraftat: true })], "2026-11-13T08:00:00Z"), []);
  lika("utfall satt (avbokat): ingenting", kor([m({ utfall: "avbokat" })], "2026-11-13T08:00:00Z"), []);
  lika("uppgiften finns: ingen ny, notisen till den som har uppgiften", kor([m({ uppgift: { id: "t1", till: "x1", avbruten: false } })], "2026-11-16T08:00:00Z"), [svar({ till: "x1", slag: "sista", skapaUppgift: false, dag: "2026-11-16" })]);
  lika("uppgiften utan ansvarig: bokaren", kor([m({ uppgift: { id: "t1", till: null, avbruten: false } })], "2026-11-13T08:00:00Z"), [svar({ skapaUppgift: false })]);
  lika("den som har uppgiften har slutat: bokaren", kor([m({ uppgift: { id: "t1", till: "borta", avbruten: false } })], "2026-11-13T08:00:00Z"), [svar({ skapaUppgift: false })]);
  lika("bokaren har slutat: hållaren", kor([m({ bokatAv: "borta" })], "2026-11-13T08:00:00Z"), [svar({ till: "h1" })]);
  lika("båda har slutat: ingenting", kor([m({ bokatAv: "borta", hallsAv: "borta2" })], "2026-11-13T08:00:00Z"), []);
  lika("uppgiften struken: inga fler notiser", kor([m({ uppgift: { id: "t1", till: "b1", avbruten: true } })], "2026-11-16T08:00:00Z"), []);
  lika("påminnelsen avstängd: ingenting", kor([m({})], "2026-11-13T08:00:00Z", { ...inst, bekraftaPaminn: false }), []);
  lika("galler-fran saknas: ingenting", kor([m({})], "2026-11-13T08:00:00Z", { ...inst, gallerFran: null }), []);
  lika("klockslaget är inställningen: 13:00", kor([m({})], "2026-11-13T11:59:00Z", { ...inst, bekraftaTid: "13:00" }), []);
  lika("klockslaget är inställningen: 13:00 går", kor([m({})], "2026-11-13T12:00:00Z", { ...inst, bekraftaTid: "13:00" }), [svar({})]);
  lika("dagarna är inställningen: tre arbetsdagar öppnar torsdag", kor([m({})], "2026-11-12T08:00:00Z", { ...inst, bekraftaDagar: 3 }), [svar({ dag: "2026-11-12" })]);
  lika("två körningar samma dag: samma lista", kor([m({})], "2026-11-13T08:00:00Z"), kor([m({})], "2026-11-13T15:00:00Z"));
  lika("bokat i fönstret (fredag 14:00 för måndag): senast måndag, samma dag efter 09:00",
    kor([m({ moteTid: "2026-11-16T13:00:00Z", senastAndrad: "2026-11-13T13:00:00Z" })], "2026-11-13T13:15:00Z"), [svar({ slag: "ring", senast: "2026-11-16" })]);
  // Julen: måndag 28 dec. Fönstret tisdag 22 till onsdag 23; julafton (torsdag) och juldagen (fredag) är inga arbetsdagar.
  const jul = { moteTid: "2026-12-28T09:00:00Z", senastAndrad: "2026-12-01T10:00:00Z" };
  lika("julafton: ingenting", kor([m(jul)], "2026-12-24T08:00:00Z"), []);
  lika("onsdag 23 dec: sista dagen", kor([m(jul)], "2026-12-23T08:00:00Z"), [svar({ slag: "sista", dag: "2026-12-23", senast: "2026-12-23" })]);
  lika("tisdag 22 dec: ring", kor([m(jul)], "2026-12-22T08:00:00Z"), [svar({ dag: "2026-12-22", senast: "2026-12-23" })]);
}

console.log("Påminnelserna: redan skickade");
{
  const nyckel = (k, id, d) => `${k}-${id}-${d}`;
  const att = [{ kalla: "mote-utfall-saknas", till: "h1", moteId: "m1" }, { kalla: "mote-utfall-saknas", till: "a1", moteId: "m1" }];
  const sk = (o = {}) => ({ employee_id: "h1", kalla: "mote-utfall-saknas", object_id: "m1", created_at: "2026-11-10T17:00:00Z", ...o });
  lika("ett läsfel ger null: inget skickas den körningen", utanRedanSkickade(att, { data: null, error: { message: "timeout" } }, "2026-11-10", tz, nyckel), null);
  lika("ett läsfel ger null även när data följer med", utanRedanSkickade(att, { data: [sk()], error: { message: "x" } }, "2026-11-10", tz, nyckel), null);
  lika("utan data och utan fel ger också null (aldrig 'allt är nytt')", utanRedanSkickade(att, { data: null, error: null }, "2026-11-10", tz, nyckel), null);
  lika("en tom lista utan fel: allt är nytt", utanRedanSkickade(att, { data: [], error: null }, "2026-11-10", tz, nyckel), att);
  lika("redan skickad i dag: hållaren utesluts, admin kvar", utanRedanSkickade(att, { data: [sk()], error: null }, "2026-11-10", tz, nyckel), [att[1]]);
  lika("skickad igår: ingen utesluts", utanRedanSkickade(att, { data: [sk({ created_at: "2026-11-09T17:00:00Z" })], error: null }, "2026-11-10", tz, nyckel), att);
  lika("dagen räknas i tidszonen: 23:30 lokal är samma dag", utanRedanSkickade(att, { data: [sk({ created_at: "2026-11-10T22:30:00Z" })], error: null }, "2026-11-10", tz, nyckel), [att[1]]);
  lika("annan källa utesluter inte", utanRedanSkickade(att, { data: [sk({ kalla: "mote-bedomning-saknas" })], error: null }, "2026-11-10", tz, nyckel), att);
}

console.log("Radering med låst provision (slutfix 2)");
ok("ett belopp över noll: låst", harLastBelopp([{ belopp: 0 }, { belopp: 300 }]) === true);
ok("bara nollor (tappat möte): inte låst", harLastBelopp([{ belopp: 0 }, { belopp: "0.00" }]) === false);
ok("inga rader: inte låst", harLastBelopp([]) === false);
ok("ett öre som sträng: låst", harLastBelopp([{ belopp: "0.01" }]) === true);

console.log("Ångra Bekräfta och Fick inte tag (F6.1)");
{
  const JAG = "jag", T = "2026-11-12T09:00:00.123Z", TDB = "2026-11-12T09:00:00.123+00:00", FORE = "2026-11-11T14:10:00.000Z";
  const m = (o = {}) => ({ bekraftat_nar: null, bekraftat_av: null, utfall: null, provision_last_nar: null, forsok: 0, senast_forsok: null, ...o });
  const b = (o = {}) => ({ vad: "bekrafta", nar: T, fore: null, jag: JAG, ...o });
  const f = (o = {}) => ({ vad: "forsok", nar: T, fore: null, jag: JAG, ...o });
  const bekr = m({ bekraftat_nar: TDB, bekraftat_av: JAG });
  lika("bekräftelsen: samma ögonblick och samma person går att ångra (databasens skrivsätt av tiden)", provaAngra(bekr, b()), { ok: true });
  ok("bekräftelsen: en annan tid (någon bekräftade om) ger 409", provaAngra(m({ bekraftat_nar: "2026-11-12T09:00:00.124Z", bekraftat_av: JAG }), b()).status === 409);
  ok("bekräftelsen: inte längre bekräftat (flyttat) ger 409", provaAngra(m(), b()).status === 409);
  ok("bekräftelsen: någon annans bekräftelse ångras inte", provaAngra(m({ bekraftat_nar: TDB, bekraftat_av: "annan" }), b()).status === 409);
  ok("bekräftelsen: mötet har fått utfall, ångras inte", provaAngra({ ...bekr, utfall: "hallet" }, b()).status === 409);
  ok("bekräftelsen: provisionen är låst, ångras inte", provaAngra({ ...bekr, provision_last_nar: "2026-11-12T10:00:00Z" }, b()).status === 409);
  const fors = m({ forsok: 2, senast_forsok: TDB });
  lika("försöket: samma ögonblick, tiden före äldre", provaAngra(fors, f({ fore: FORE })), { ok: true });
  lika("försöket: det första försöket har ingen tid före", provaAngra(m({ forsok: 1, senast_forsok: TDB }), f()), { ok: true });
  ok("försöket: ett nyare försök har sparats, 409", provaAngra(m({ forsok: 3, senast_forsok: "2026-11-12T09:05:00.000Z" }), f({ fore: FORE })).status === 409);
  ok("försöket: nollställt av en flytt, 409", provaAngra(m(), f()).status === 409);
  ok("försöket: mötet har bekräftats under tiden, 409", provaAngra({ ...fors, bekraftat_nar: "2026-11-12T09:01:00Z", bekraftat_av: JAG }, f({ fore: FORE })).status === 409);
  ok("försöket: mötet har fått utfall, 409", provaAngra({ ...fors, utfall: "uteblev" }, f({ fore: FORE })).status === 409);
  ok("försöket: tiden före får inte vara samma som eller nyare än försöket, 400", provaAngra(fors, f({ fore: T })).status === 400 && provaAngra(fors, f({ fore: "2026-11-13T09:00:00Z" })).status === 400);
}

console.log(fel ? `\n${fel} fel` : "\nAllt grönt");
process.exit(fel ? 1 : 0);
