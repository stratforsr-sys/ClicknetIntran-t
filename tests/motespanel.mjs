#!/usr/bin/env node
/**
 * Mötens statistik som panel: talen ur motespanel.ts mot förlagans fakta (version 9, produktionen 2026-11-14).
 *
 *   TZ=UTC node --experimental-strip-types tests/motespanel.mjs
 */
import { readFileSync } from "node:fs";
import { byggPanel, byggPanelSvar, PERIODER, panelPerioder, panelUnderlag, panelKarta, lokalTid } from "../src/lib/nav2/motespanel.ts";
import { INST_FORVAL } from "../src/lib/nav2/motesflode.ts";

let fel = 0;
const ok = (namn, villkor) => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}`);
  if (!villkor) fel++;
};
const text = (x) => JSON.stringify(x);
const lika = (namn, fas, vantat) => ok(`${namn} (fick ${text(fas)})`, text(fas) === text(vantat));

const FX = JSON.parse(readFileSync(new URL("./fixtures/motespanel-2026-11-14.json", import.meta.url), "utf8"));
const NU = new Date(FX.nu);
const TZ = "Europe/Stockholm";
const P = panelPerioder(NU, TZ);
const inst = (o = {}) => ({ ...structuredClone(INST_FORVAL), ...o });
const panel = (o = {}, period = "d90", person = null, moten = FX.moten, kedjor = FX.kedjor) => byggPanel(moten, kedjor, P[period], person, inst(o), NU);
const kvot = (a) => ({ n: a.n, av: a.av });

console.log("\nPerioderna (lördag 14 nov 20:30)");
lika("vecka", [P.vecka.fran, P.vecka.till, P.vecka.foreFran, P.vecka.foreTill, P.vecka.mot], ["2026-11-09", "2026-11-15T23:59", "2026-11-02", "2026-11-08T23:59", "vecka 45"]);
lika("månad", [P.manad.fran, P.manad.till, P.manad.foreFran, P.manad.foreTill, P.manad.mot], ["2026-11-01", "2026-11-30T23:59", "2026-10-01", "2026-10-31T23:59", "i oktober"]);
lika("90 dagar", [P.d90.fran, P.d90.till, P.d90.foreFran, P.d90.foreTill], ["2026-08-16", null, "2026-05-18", "2026-08-16"]);

console.log("\nFörlagans tal, 90 dagar, alla");
{
  const p = panel();
  lika("show 6 av 11", kvot(p.show), { n: 6, av: 11 });
  lika("noshow 5 av 11", kvot(p.noshow), { n: 5, av: 11 });
  lika("svarade 8 av 11, 0 svarade inte, 3 ringdes aldrig", [kvot(p.bekr), p.bekr.svaradeInte.length, p.bekr.aldrig.length], [{ n: 8, av: 11 }, 0, 3]);
  lika("kvalificerade 2 av 6 hållna, 4 obedömda", [kvot(p.kval), p.kval.obedomda.length], [{ n: 2, av: 6 }, 4]);
  lika("frågorna efter mötet, med företagets texter", p.kval.fragor, [{ text: "Var rätt beslutsfattare med?", ja: 2, av: 2 }, { text: "Visste kunden vad mötet gällde?", ja: 2, av: 2 }]);
  lika("efter första mötet [offert, nytt, följs upp, dog]", [p.efter.offert.length, p.efter.nytt.length, p.efter.foljsUpp.length, p.efter.dog.length], [2, 2, 2, 0]);
  lika("till offert 2 av 6", kvot(p.offert), { n: 2, av: 6 });
  lika("closing: inget avgjort, 2 offerter väntar", [p.closing.av, p.closing.ejAvgjorda.length], [0, 2]);
  lika("rubriken", p.rubrik, ["Inget av de 3 obekräftade mötena blev av.", ""]);
  lika("att göra nu [bekräfta, utan ny tid, uppföljning, offert väntar]", [p.attGora.attBekr.length, p.attGora.utanTid.length, p.attGora.uppfNu.length, p.attGora.offSvar.length], [7, 5, 1, 2]);
  lika("inget möte saknar utfall", p.attGora.utan.length, 0);
  const U = panelUnderlag(FX.moten, FX.kedjor, inst(), NU);
  const { moten, kedjor } = panelKarta(U);
  lika("närmast att bekräfta: mån 16 nov 10:30", moten[p.attGora.attBekr[0]].tid, "2026-11-16T10:30");
  ok("att bekräfta är sorterat med närmast först", p.attGora.attBekr.every((id, i, a) => !i || moten[a[i - 1]].tid <= moten[id].tid));
  ok("bokade framåt är sorterat med närmast först, inga uppföljningsmöten", p.kommer.every((id, i, a) => moten[id].art !== "uppfoljning" && (!i || moten[a[i - 1]].tid <= moten[id].tid)));
  ok("strecken i navet: 11 avgjorda i tidsordning", p.avgjorda.length === 11 && p.avgjorda.every((id, i, a) => !i || moten[a[i - 1]].tid <= moten[id].tid));
  lika("kedjornas läge följer med till bladen", [kedjor[p.efter.offert[0]].ut, kedjor[p.efter.offert[0]].slut], ["offert", "svar"]);
  ok("korta nycklar i listorna, riktiga id i kartan", p.show.ids.every((n) => n.length <= 3) && /^k\d+$/.test(kedjor[p.efter.offert[0]].id) && /^k\d+$/.test(moten[p.show.ids[0]].kedja));
  ok("inga bolagsnamn eller personnamn i kartan", !/AB|zen|mick|carl|fredrik/i.test(JSON.stringify({ moten, kedjor })));
  lika("perioden före finns, med tomma tal", p.fore.show, { n: 0, av: 0 });
  lika("utan mål: inget omdöme", p.omdome, {});
}

console.log("\nTomt underlag");
{
  const p = panel({}, "d90", null, [], []);
  lika("rubriken", p.rubrik, ["Inga möten i perioden.", "Välj en längre period för att se mer."]);
  ok("varje nämnare är 0", [p.show, p.noshow, p.bekr, p.kval, p.offert, p.closing].every((a) => a.av === 0 && a.n === 0));
  lika("ingen period före", p.fore, null);
  ok("inga NaN", !/NaN|null,null/.test(JSON.stringify(p)));
}

console.log("\nVälj en längre period: bara när en längre period har möten");
{
  const m = { id: "m1", kedja: "kx1", bokatAv: "a", hallsAv: "a", bokatNar: "2026-09-20T08:00:00Z", moteTid: "2026-10-01T08:00:00Z", art: "ny", utfall: "hallet", resultat: null, kalla: "", bekraftatNar: null, forsok: 0, niva: null };
  const k = { id: "kx1", forstaBokatAv: "a", forstaBokatNar: "2026-09-20T08:00:00Z", forstaMoteTid: "2026-10-01T08:00:00Z", forstaHallnaHallsAv: "a", avslut: null, avslutNar: null, affarForstaMote: false, offertNar: null, kolumn: null, kalla: "" };
  const s = byggPanelSvar([m], [k], null, String, inst(), NU);
  lika("vecka och månad utan möten, 90 dagar med: uppmaningen står kvar", [s.tal.vecka.alla.rubrik[1], s.tal.manad.alla.rubrik[1]], ["Välj en längre period för att se mer.", "Välj en längre period för att se mer."]);
  lika("90 dagar har inget längre att välja", s.tal.d90.alla.rubrik[1], "");
  const t = byggPanelSvar([], [], null, String, inst(), NU);
  lika("inga möten i någon period: ingen uppmaning", PERIODER.map((p) => t.tal[p].alla.rubrik[1]), ["", "", ""]);
  lika("rubriken säger fortfarande att perioden är tom", t.tal.vecka.alla.rubrik[0], "Inga möten i perioden.");
}

console.log("\nPersonen");
{
  const p = panel({}, "vecka", "p-c");
  lika("Bokaren C denna vecka: inget avgjort, 2 bokade framåt", [p.show.av, p.kommer.length], [0, 2]);
  lika("C:s att göra: 2 att bekräfta, inget annat", [p.attGora.attBekr.length, p.attGora.utanTid.length, p.attGora.uppfNu.length, p.attGora.offSvar.length], [2, 0, 0, 0]);
  const z = panel({}, "d90", "p-a");
  ok("A bokade eller höll: lika många avgjorda som alla (A höll eller bokade alla)", z.show.av === 11);
}

console.log("\nGränsen följer svensk tid");
{
  const m = (id, moteTid, extra = {}) => ({ id, kedja: "kx" + id, bokatAv: "a", hallsAv: "a", bokatNar: "2026-11-01T08:00:00Z", moteTid, art: "ny", utfall: "hallet", resultat: null, kalla: "", bekraftatNar: null, forsok: 0, niva: null, ...extra });
  const k = (id) => ({ id: "kx" + id, forstaBokatAv: "a", forstaBokatNar: "x", forstaMoteTid: null, forstaHallnaHallsAv: null, avslut: null, avslutNar: null, affarForstaMote: false, offertNar: null, kolumn: null, kalla: "" });
  const dec = new Date("2026-12-05T12:00:00Z");
  const Pd = panelPerioder(dec, TZ);
  const sent = [m("1", "2026-11-30T22:30:00Z")];
  lika("23:30 den 30 nov (22:30Z) är 30 nov svensk tid", lokalTid("2026-11-30T22:30:00Z", TZ), "2026-11-30T23:30");
  lika("och räknas i november, perioden före december", byggPanel(sent, [k("1")], Pd.manad, null, inst(), dec).fore.show, { n: 1, av: 1 });
  lika("inte i december", byggPanel(sent, [k("1")], Pd.manad, null, inst(), dec).show.av, 0);
  lika("efter övergången till sommartid: 29 mars 22:30Z är 30 mars", lokalTid("2026-03-29T22:30:00Z", TZ), "2026-03-30T00:30");
  const apr = new Date("2026-04-02T10:00:00Z");
  lika("veckan som börjar måndag 30 mars tar med det mötet", byggPanel([m("2", "2026-03-29T22:30:00Z")], [k("2")], panelPerioder(apr, TZ).vecka, null, inst(), apr).show.av, 1);
  lika("en annan tidszon flyttar dagen", lokalTid("2026-11-30T22:30:00Z", "America/New_York"), "2026-11-30T17:30");
}

console.log("\nOmdöme mot mål");
{
  lika("show 55 % mot målet 50: över", panel({ mal: { show: 50 } }).omdome, { show: "over" });
  lika("show 55 % mot målet 60: under", panel({ mal: { show: 60 } }).omdome, { show: "under" });
  lika("noshow 45 % mot målet 40: under (lägre är bättre)", panel({ mal: { noshow: 40 } }).omdome, { noshow: "under" });
  lika("noshow 45 % mot målet 50: över", panel({ mal: { noshow: 50 } }).omdome, { noshow: "over" });
  lika("kval mot målet 0: över", panel({ mal: { kval: 0 } }).omdome, { kval: "over" });
  lika("closing utan avgjorda: inget omdöme", panel({ mal: { closing: 100 } }).omdome, {});
  lika("ett tomt underlag ger inget omdöme", panel({ mal: { show: 50 } }, "d90", null, [], []).omdome, {});
}

console.log("\nDödsgränserna är inställningar");
{
  const kedjor = FX.kedjor.map((k) => ({ ...k }));
  const vantande = panel().efter.foljsUpp;
  const id = vantande[0];
  const riktig = panelKarta(panelUnderlag(FX.moten, FX.kedjor, inst(), NU)).kedjor[id].id;
  kedjor.find((k) => k.id === riktig).ingetSvarIRad = 1;
  lika("1 inget svar med förvalet 3: följs upp", panel({}, "d90", null, FX.moten, kedjor).efter.foljsUpp.includes(id), true);
  lika("1 inget svar med gränsen 1: dog", panel({ dodTysta: 1 }, "d90", null, FX.moten, kedjor).efter.dog.includes(id), true);
  const gammal = FX.kedjor.map((k) => (k.id === riktig ? { ...k, uppfoljningDatum: "2026-11-01" } : k));
  lika("uppföljning 13 dagar gammal, förval 21: följs upp", panel({}, "d90", null, FX.moten, gammal).efter.foljsUpp.includes(id), true);
  lika("med gränsen 10 dagar: dog", panel({ dodDagar: 10 }, "d90", null, FX.moten, gammal).efter.dog.includes(id), true);
  lika("bekräftelsen öppnar en arbetsdag före i stället för två: 2 att bekräfta", panel({ bekraftaDagar: 1 }).attGora.attBekr.length, 2);
}

console.log("\nGranskningens fynd (Fable 2026-11-15)");
{
  const m = (id, moteTid, { kedja, ...extra } = {}) => ({ id, kedja: "kg" + (kedja ?? id), bokatAv: "a", hallsAv: "a", bokatNar: "2026-11-01T08:00:00Z", moteTid, art: "ny", utfall: "hallet", resultat: null, kalla: "", bekraftatNar: null, forsok: 0, niva: null, ...extra });
  const k = (id, extra = {}) => ({ id: "kg" + id, forstaBokatAv: "a", forstaBokatNar: "x", forstaMoteTid: null, forstaHallnaHallsAv: null, avslut: null, avslutNar: null, affarForstaMote: false, offertNar: null, kolumn: null, kalla: "", ...extra });
  const en = [m("1", "2026-11-12T09:00:00Z")];
  lika("under fem i nämnaren: inget omdöme (procenten är brus)", byggPanel(en, [k("1")], P.d90, null, inst({ mal: { show: 50, noshow: 15 } }), NU).omdome, {});
  const nu = (min) => new Date(NU.getTime() - min * 60000).toISOString();
  const pagar = byggPanel([m("2", nu(5), { utfall: null })], [k("2")], P.d90, null, inst(), NU);
  lika("ett möte som började för 5 minuter sedan saknar inte utfall än", pagar.attGora.utan.length, 0);
  const slut = byggPanel([m("3", nu(31), { utfall: null })], [k("3")], P.d90, null, inst(), NU);
  lika("efter 30 minuter saknar det utfall (samma regel som Mer)", slut.attGora.utan.length, 1);
  const avb = byggPanel([m("4", "2026-10-01T08:00:00Z"), m("5", "2026-10-10T08:00:00Z", { kedja: "4", art: "uppfoljning", utfall: "avbokat" })],
    [k("4", { ingetSvarIRad: 5 })], P.d90, null, inst(), NU);
  lika("ett avbokat senare möte är inget nytt möte: kedjan dog", [avb.efter.nytt.length, avb.efter.dog.length], [0, 1]);
  ok("fixturen har inga riktiga förnamn", !/zen|mick|carl|fredrik/i.test(readFileSync(new URL("./fixtures/motespanel-2026-11-14.json", import.meta.url), "utf8")));
  const server = readFileSync(new URL("../src/lib/nav2/motesstat.ts", import.meta.url), "utf8");
  ok("ett fel i panelens läsning ger panel null, inte tom statistik", /lasPanelRader\(supabase, nu, kapad\)\.catch\(/.test(server) && /try \{\s*panel = /.test(server));
}

console.log(fel ? `\n${fel} fel` : "\nAllt grönt");
process.exit(fel ? 1 : 0);
