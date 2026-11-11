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
} from "../src/lib/nav2/motesflode.ts";

let fel = 0;
const ok = (namn, villkor) => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}`);
  if (!villkor) fel++;
};
const text = (x) => JSON.stringify(x);
const lika = (namn, fas, vantat) => ok(`${namn} (fick ${text(fas)})`, text(fas) === text(vantat));
const tz = "Europe/Stockholm";

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
  ok("halva nekas", !!fel("moten.ombokning-provision", "halva"));
  lika("tomt prefix går", provaInstallning("moten.rubrik-prefix", "  "), { ok: true, varde: "" });
  ok("41 tecken prefix nekas", !!fel("moten.rubrik-prefix", "x".repeat(41)));
  ok("mottagare som inte är text nekas", !!fel("moten.mottagare", [1, 2]));
  ok("varje nyckel matchar nav_setting-mönstret", Object.values(INST_NYCKLAR).every((k) => /^[a-z0-9.-]{1,60}$/.test(k)));
}

console.log("Lokal dag och fönster");
lika("lokal dag efter midnatt", lokalDag("2026-11-15T23:15:00Z", tz), "2026-11-16");
lika("lokal dag i UTC", lokalDag("2026-11-15T23:15:00Z", "UTC"), "2026-11-15");
const M = "2026-11-16T08:00:00Z";
lika("fönster två dagar", bekraftelseFonster({ moteTid: M, senastAndrad: "2026-11-02T09:00:00Z", dagar: 2, tz }), { oppnar: "2026-11-14", senast: "2026-11-15" });
lika("bokat dagen före", bekraftelseFonster({ moteTid: M, senastAndrad: "2026-11-15T10:00:00Z", dagar: 2, tz }).senast, "2026-11-16");
lika("bokat samma dag", bekraftelseFonster({ moteTid: M, senastAndrad: "2026-11-16T06:00:00Z", dagar: 2, tz }).senast, "2026-11-16");
lika("midnatt öppnar lördag", bekraftelseFonster({ moteTid: "2026-11-15T23:15:00Z", senastAndrad: "2026-11-01T09:00:00Z", dagar: 2, tz }).oppnar, "2026-11-14");
lika("över sommartiden", bekraftelseFonster({ moteTid: "2026-10-26T07:00:00Z", senastAndrad: "2026-10-01T09:00:00Z", dagar: 2, tz }).oppnar, "2026-10-24");
lika("dagar 0 öppnar på mötesdagen", bekraftelseFonster({ moteTid: M, senastAndrad: "2026-11-02T09:00:00Z", dagar: 0, tz }).oppnar, "2026-11-16");
lika("över månadsskiftet", bekraftelseFonster({ moteTid: "2026-12-01T09:00:00Z", senastAndrad: "2026-11-02T09:00:00Z", dagar: 2, tz }), { oppnar: "2026-11-29", senast: "2026-11-30" });

console.log("Pipelinekolumn");
const mote = { moteTid: M, langd: 30, bekraftat: false, utfall: null };
const f = bekraftelseFonster({ moteTid: M, senastAndrad: "2026-11-02T09:00:00Z", dagar: 2, tz });
lika("före fönstret: bokat", pipelineKolumn(mote, f, new Date("2026-11-13T10:00:00Z"), tz), "bokat");
lika("23:30 fredag UTC = 00:30 lördag lokalt: att bekräfta", pipelineKolumn(mote, f, new Date("2026-11-13T23:30:00Z"), tz), "att_bekrafta");
lika("01:30 lokalt lördag: att bekräfta", pipelineKolumn(mote, f, new Date("2026-11-14T00:30:00Z"), tz), "att_bekrafta");
lika("bekräftat", pipelineKolumn({ ...mote, bekraftat: true }, f, new Date("2026-11-14T00:30:00Z"), tz), "bekraftat");
lika("bekräftat före fönstret", pipelineKolumn({ ...mote, bekraftat: true }, f, new Date("2026-11-10T00:30:00Z"), tz), "bekraftat");
lika("under mötet: fortfarande bekräftat", pipelineKolumn({ ...mote, bekraftat: true }, f, new Date("2026-11-16T08:20:00Z"), tz), "bekraftat");
lika("efter slutet: hos säljaren", pipelineKolumn(mote, f, new Date("2026-11-16T08:31:00Z"), tz), "hos_saljaren");
lika("efter slutet bekräftat: hos säljaren", pipelineKolumn({ ...mote, bekraftat: true }, f, new Date("2026-11-16T08:31:00Z"), tz), "hos_saljaren");
lika("utfall: avgjort", pipelineKolumn({ ...mote, utfall: "hallet" }, f, new Date("2026-11-13T10:00:00Z"), tz), "avgjort");
lika("kortFas utan öppet möte", kortFas({ harOppetMote: false, mote: null, fonster: null }, new Date(), tz), "avgjort");
lika("kortFas med öppet möte", kortFas({ harOppetMote: true, mote, fonster: f }, new Date("2026-11-13T10:00:00Z"), tz), "bokat");

console.log("Brådska");
lika("i dag", bradska("2026-11-15", "att_bekrafta", new Date("2026-11-15T12:00:00Z"), tz), "idag");
lika("i morgon", bradska("2026-11-15", "att_bekrafta", new Date("2026-11-14T12:00:00Z"), tz), "imorgon");
lika("passerad senast", bradska("2026-11-15", "att_bekrafta", new Date("2026-11-16T07:00:00Z"), tz), "idag");
lika("långt kvar", bradska("2026-11-15", "att_bekrafta", new Date("2026-11-12T12:00:00Z"), tz), null);
lika("bekräftat har ingen brådska", bradska("2026-11-15", "bekraftat", new Date("2026-11-15T12:00:00Z"), tz), null);
lika("bokat dagen före senast: i morgon", bradska("2026-11-15", "bokat", new Date("2026-11-14T12:00:00Z"), tz), "imorgon");

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

console.log(fel ? `\n${fel} fel` : "\nAllt grönt");
process.exit(fel ? 1 : 0);
