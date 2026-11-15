#!/usr/bin/env node
/**
 * Mötens statistik som panel i utkastet: koden mellan `const msD` och `MSPANEL-SLUT` i src/nav2/utkast.html körs i
 * node:vm med en panel som byggs av motespanel.ts ur samma fixtur som tests/motespanel.mjs (förlagan version 9).
 *
 *   TZ=UTC node --experimental-strip-types tests/nav2-motespanel.mjs
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { byggPanelSvar } from "../src/lib/nav2/motespanel.ts";
import { INST_FORVAL } from "../src/lib/nav2/motesflode.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const html = readFileSync(process.env.UTKAST ?? new URL("../src/nav2/utkast.html", import.meta.url), "utf8");
const FX = JSON.parse(readFileSync(new URL("./fixtures/motespanel-2026-11-14.json", import.meta.url), "utf8"));
const NU = new Date(FX.nu);
const NAMN = { "p-a": "Anna Ab", "p-b": "Bo Cd", "p-c": "Cecilia Ef", "p-d": "David Gh" };
const panel = (o = {}, moten = FX.moten, kedjor = FX.kedjor) =>
  JSON.parse(JSON.stringify(byggPanelSvar(moten, kedjor, null, (id) => NAMN[id] ?? id, { ...structuredClone(INST_FORVAL), ...o }, NU)));

const start = html.indexOf("const msD = () =>"), slut = html.indexOf("/* MSPANEL-SLUT */");
ok("koden mellan markörerna finns", start > 0 && slut > start && html.includes("/* MSPANEL-START */"));
const kod = html.slice(start, slut);

/** En ny körning av utkastets kod, med ND och localStorage som provet väljer. */
function kor({ P, lagring = {}, kastar = false, kort = null } = {}) {
  const ls = kastar
    ? { getItem() { throw new Error("blockerad"); }, setItem() { throw new Error("blockerad"); } }
    : { getItem: (k) => (k in lagring ? lagring[k] : null), setItem: (k, v) => { lagring[k] = String(v); } };
  const bolag = Object.fromEntries(Object.values(P?.kedjor ?? {}).map((k, i) => [k.id, `Bolag ${i}`]));
  const ctx = {
    ND: { jag: { id: "p-a", namn: "Anna Ab" }, motesstat: { panel: P, bolag, perioder: { denna: { fran: "2026-11-09", till: "2026-11-15" }, forra: { fran: "2026-11-02", till: "2026-11-08" } }, chef: { krets: "alla", personer: [{ id: "p-a", namn: "Anna Ab", denna: tom(), forra: tom() }], offerter: {}, dagar: {}, kallor: [], bekraftelser: {}, utanUtfall: [] } } },
    S: {}, localStorage: ls, CSS: { escape: (s) => s },
    esc: (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]),
    I: () => "<svg></svg>", moTz: () => "Europe/Stockholm",
    ndMo: () => ({ kort: (kort ?? Object.values(P?.kedjor ?? {}).map((k) => k.id)).map((kedja) => ({ kedja })), inst: { bekraftaDagar: 2 } }),
    document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] },
    window: { addEventListener() {} }, console,
  };
  vm.createContext(ctx);
  vm.runInContext(kod + "\nglobalThis.MSP = MSP;", ctx);
  return ctx;
}
function tom() {
  const k = { andel: null, n: 0, av: 0 };
  return { samtal: 0, bokade: 0, per100: null, hallna: k, raddade: 0, affarer: k, forstaMote: k, bokatTillAffar: 0, oppnaOfferter: 0, tysta: 0, utanUtfall: 0 };
}
const text = (h) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const VAL = { period: "d90", person: null, mer: false, blad: null, anim: false };

rubrik("Förlagans tal, 90 dagar, alla");
{
  const P = panel(), c = kor({ P });
  const h = c.msPanelVy(P, VAL), t = text(h);
  ok("rubriken", t.includes("Inget av de 3 obekräftade mötena blev av."));
  ok("navet: 55 % och 6 av 11 kom", /msp-hv[^>]*>55<small>%/.test(h) && t.includes("6 av 11 kom"));
  ok("kvalificerade: 33 % och 2 av 6 hållna möten", /data-msp-blad="kval"[\s\S]*?>33<small>%[\s\S]*?2 av 6 hållna möten/.test(h));
  ok("raden under: 4 hållna saknar bedömning", t.includes("4 hållna saknar bedömning"));
  ok("svarade: 0 svarade inte · 3 ringdes aldrig", t.includes("0 svarade inte · 3 ringdes aldrig"));
  const gora = [...h.matchAll(/class="msp-gi" data-msp-blad="(\w+)"><b>(\d+)<\/b>/g)].map((m) => m[2]);
  ok("att göra nu: 7, 5, 1, 2", gora.join(",") === "7,5,1,2", gora.join(","));
  ok("närmast att bekräfta: mån 16 nov 10:30", t.includes("Närmast mån 16 nov 10:30"));
  ok("utan mål står inget om målet", !/målet/.test(t));
  ok("ingen period före med fem: ingen jämförelse i navet", !/Upp från|Ned från|Samma som/.test(t));
  ok("skärmläsaren får talet i rutans namn", h.includes('aria-label="Kvalificerade: 33 procent, 2 av 6 hållna möten. Visa listan"'));
  ok("90 dagar är förvalt och tryckt", /data-msp-period="d90" aria-pressed="true"/.test(h));
  ok("personerna: Alla och de fyra", (h.match(/data-msp-person=/g) || []).length === 5);
}

rubrik("Mål");
{
  const P = panel({ mal: { show: 50, noshow: 40 } }), c = kor({ P });
  const h = c.msPanelVy(P, VAL), t = text(h);
  ok("navet: Över målet 50 %", /msp-hero[\s\S]*Över målet 50 %/.test(h));
  ok("no-show 45 % mot målet högst 40: texten säger att det är för högt", /<i class="msp-dot fara"><\/i>Över målet, högst 40 %/.test(h));
  const Pn = panel({ mal: { noshow: 50 } }), hn = kor({ P: Pn }).msPanelVy(Pn, VAL);
  ok("no-show 45 % mot målet högst 50: Inom målet", /<i class="msp-dot ok"><\/i>Inom målet, högst 50 %/.test(hn));
  ok("pinnen på mätaren står vid målet", h.includes('<u style="left:40%"></u>'));
  ok("målet står i rutans namn för skärmläsaren", h.includes("Över målet, högst 40 %. Visa listan"));
  const Pl = panel({ mal: { show: 50 } }), hl = kor({ P: Pl }).msPanelVy(Pl, { ...VAL, period: "vecka", person: "p-c" });
  ok("under fem i nämnaren: pinnen står kvar men inget omdöme i text", !/målet/.test(text(hl)));
  const P0 = panel({ mal: { kval: 0 } }), h0 = kor({ P: P0 }).msPanelVy(P0, VAL);
  ok("mål 0: pinnen i mätarens början, inte utanför", h0.includes('<u style="left:0%"></u>'));
}

rubrik("Bladet");
{
  const P = panel(), c = kor({ P });
  const b = c.msPanelBlad(P, VAL, "show"), t = text(b);
  ok("rubrik och fördelning: Hållet 6 · Uteblev 5", t.includes("Blev mötet av?") && t.includes("Hållet 6 · Uteblev 5"));
  ok("en dialog med ✕", b.includes('role="dialog"') && b.includes('aria-modal="true"') && /data-msp-x aria-label="Stäng"/.test(b));
  const rader = (b.match(/class="msp-br"/g) || []).length, kort = (b.match(/data-ms-kort=/g) || []).length;
  ok("varje rad med ett kort är en knapp som öppnar kortet", rader === 11 && kort === 11, `${kort} av ${rader}`);
  const bs = kor({ P, kort: [] }).msPanelBlad(P, VAL, "show");
  ok("utan kort på tavlan: bara namnet", !bs.includes("data-ms-kort") && (bs.match(/class="msp-br"/g) || []).length === 11);
  const a = text(c.msPanelBlad(P, VAL, "attbekr"));
  ok("att bekräfta börjar med det närmaste", a.indexOf("mån 16 nov 10:30") > 0 && a.indexOf("mån 16 nov 10:30") < a.indexOf("tis 17 nov"));
  ok("bekräftelsens dagar ur inställningen", a.includes("Bekräftelsen öppnar två arbetsdagar före mötet."));
  const k = text(c.msPanelBlad(P, VAL, "kval"));
  ok("kvalbladet: företagets frågor", k.includes("Var rätt beslutsfattare med? Ja i 2 av 2.") && k.includes("Inte bedömt 4"));
  ok("en okänd lista ger inget blad", c.msPanelBlad(P, VAL, "finnsinte") === "");
}

rubrik("Tomt underlag");
{
  const P = panel({}, [], []), c = kor({ P });
  const h = c.msPanelVy(P, VAL) + c.msPanelBlad(P, VAL, "show");
  ok("Inga möten i perioden.", text(h).includes("Inga möten i perioden."));
  ok("inga NaN, undefined eller null i texten", !/NaN|undefined|null/.test(text(h)));
  ok("Inget väntar just nu.", text(h).includes("Inget väntar just nu."));
  ok("strecket i rutorna", /msp-rv tom"[^>]*>–/.test(h));
  const hv = c.msPanelVy(P, { ...VAL, period: "vecka" });
  ok("vecka utan möten i någon period: ingen uppmaning om längre period", text(hv).includes("Inga möten i perioden.") && !text(hv).includes("längre period"));
  const L = panel({}, [], []); L.tal.vecka.alla.rubrik = ["Inga möten i perioden.", "Välj en längre period för att se mer."];
  ok("vecka när servern säger att en längre period har möten: uppmaningen visas", text(c.msPanelVy(L, { ...VAL, period: "vecka" })).includes("Välj en längre period för att se mer."));
  ok("90 dagar: ingen uppmaning om längre period", !text(h).includes("längre period"));
}

rubrik("Person och period");
{
  const P = panel(), c = kor({ P });
  const h = c.msPanelVy(P, { ...VAL, period: "vecka", person: "p-c" }), t = text(h);
  ok("C, vecka: navet visar nästa möte och 2 bokade framåt", t.includes("Nästa möte tis 17 nov 10:00") && t.includes("2 möten bokade framåt") && h.includes('data-msp-blad="kommer"'));
  ok("C är tryckt", /data-msp-person="p-c" aria-pressed="true"/.test(h));
}

rubrik("Minnet (nd-ms-val:<id>)");
{
  const P = panel();
  const v1 = kor({ P, lagring: { "nd-ms-val:p-a": JSON.stringify({ person: "p-slutat", period: "x" }) } }).msValLas();
  ok("okänt sparat val ger förvalet", v1.period === "d90" && v1.person === null, JSON.stringify(v1));
  const v2 = kor({ P, kastar: true }).msValLas();
  ok("lagring som kastar ger förvalet", v2.period === "d90" && v2.person === null);
  const v3 = kor({ P, lagring: { "nd-ms-val:p-a": JSON.stringify({ person: "p-b", period: "manad" }) } }).msValLas();
  ok("ett giltigt val läses", v3.period === "manad" && v3.person === "p-b");
  const lag = {}, c = kor({ P, lagring: lag });
  c.msValSpara({ period: "vecka", person: "p-c" });
  ok("sparas per användare", lag["nd-ms-val:p-a"] === JSON.stringify({ period: "vecka", person: "p-c" }));
  let kast = null; try { kor({ P, kastar: true }).msValSpara({ period: "vecka", person: null }); } catch (e) { kast = e; }
  ok("sparandet tål en lagring som kastar", !kast);
}

rubrik("Mer: dagens vy");
{
  const P = panel(), c = kor({ P });
  const el = { innerHTML: "", querySelector: () => null };
  c.MSP.anim = false;
  c.ndMsChef(el);
  ok("Mer är en knapp med aria-expanded=false", /data-msp-mer aria-expanded="false"/.test(el.innerHTML) && !el.innerHTML.includes("ms-tabell"));
  c.MSP.mer = true; c.ndMsChef(el);
  ok("utfälld: Vecka för vecka och den befintliga tabellen", el.innerHTML.includes("Vecka för vecka") && el.innerHTML.includes('class="ms-tabell"') && /data-msp-mer aria-expanded="true"/.test(el.innerHTML));
  ok("panelen står överst", el.innerHTML.indexOf("msp-bento") < el.innerHTML.indexOf("ms-tabell"));
  c.MSP.blad = "kval"; c.ndMsChef(el);
  ok("bladet ritas när det är öppet", el.innerHTML.includes('role="dialog"') && text(el.innerHTML).includes("Kvalificering"));
  const g = kor({ P: null }); const e2 = { innerHTML: "", querySelector: () => null };
  g.ND.motesstat.panel = undefined; g.ndMsChef(e2);
  ok("utan panel (äldre server): dagens vy som förut", e2.innerHTML.includes('class="ms-tabell"') && !e2.innerHTML.includes("msp-bento"));
}

rubrik("Rörelsen");
{
  const css = html.slice(html.indexOf("/* MSPANEL-CSS-START"), html.indexOf("/* MSPANEL-CSS-SLUT */"));
  const media = css.indexOf("@media (prefers-reduced-motion:no-preference){");
  const animationer = [...css.matchAll(/animation:/g)].map((m) => m.index);
  ok("CSS:en finns mellan markörerna", css.length > 1000);
  ok("varje animation ligger inom prefers-reduced-motion: no-preference", media > 0 && animationer.length >= 4 && animationer.every((i) => i > media));
  ok("uppräkningen frågar prefers-reduced-motion", kod.includes("matchMedia('(prefers-reduced-motion: reduce)')"));
  ok("bladet glider in bara när det öppnas, inte vid varje omritning", /\.msp-blad\.ny\{animation/.test(css) && !/\.msp-blad\{animation/.test(css) && /MSP\.bladNy = true/.test(kod));
  ok("listans rullning står kvar vid en omritning", /\.msp-bl'\)[^\n]*scrollTop/.test(kod));
}

rubrik("Målen och dödsgränserna i Mötens inställningar");
{
  const i = html.indexOf("function moInstVy(){"), vy = i > 0 ? html.slice(i, html.indexOf("\n}\n", i)) : "";
  for (const [k, l] of [["show", "Show rate"], ["noshow", "No-show rate"], ["bekr", "Svarade på bekräftelsen"], ["kval", "Kvalificerade"], ["closing", "Closing rate"]]) {
    ok(`målfältet ${l}`, vy.includes(`data-moimal="\${k}"`) || (vy.includes("data-moimal=") && html.includes(`['${k}', '${l}']`)));
  }
  ok("målfälten är tal 0–100 med platshållaren Inget mål", /type="number" min="0" max="100" step="1"[^>]*data-moimal=[^>]*placeholder="Inget mål"/.test(vy));
  ok("Uppföljning äldre än (dagar)", vy.includes("Uppföljning äldre än (dagar)") && /data-moi="dodDagar"/.test(vy) && /min="1" max="365"/.test(vy));
  ok("Inget svar i rad", vy.includes("Inget svar i rad") && /data-moi="dodTysta"/.test(vy) && /min="1" max="20"/.test(vy));
  ok("rubriken Statistik", vy.includes("<h3>Statistik"));
  const m = /function moMalAv\(lista\)\{[\s\S]*?\n\}/.exec(html);
  ok("moMalAv finns", !!m);
  const moMalAv = m ? Function(`${m[0]}; return moMalAv;`)() : () => null;
  const f = (k, v) => ({ dataset: { moimal: k }, value: v });
  ok("sparar målen som ett objekt utan de tomma fälten", JSON.stringify(moMalAv([f("show", "70"), f("noshow", ""), f("kval", " 0 "), f("closing", "  ")])) === JSON.stringify({ show: 70, kval: 0 }));
  ok("ett felaktigt tal skickas som det är, så att servern säger nej", JSON.stringify(moMalAv([f("show", "7,5")])) === JSON.stringify({ show: 7.5 }) && Number.isNaN(moMalAv([f("bekr", "x")]).bekr));
  ok("nycklarna i MOINST", /mal:'moten\.mal'/.test(html) && /dodDagar:'moten\.dod-dagar'/.test(html) && /dodTysta:'moten\.dod-tysta'/.test(html));
  ok("dödsgränserna skickas som tal", /ds\.moi === 'dodDagar' \|\| ds\.moi === 'dodTysta'/.test(html));
  ok("ett nekat mål går tillbaka till det sparade", /mal:'\[data-moimal\]'/.test(html));
  ok("en sparning markerar bara att statistiken ska räknas om", /MOINSTSTAT\.includes\(falt\)\) I\.statAndrad = true/.test(html) && !/MOINSTSTAT\.includes\(falt\)[^\n]*ndOmlas/.test(html));
  ok("statistiken räknas om en gång när inställningarna stängs", /function moInstStang\(\)\{[\s\S]*?statAndrad[\s\S]*?ndOmlas\('mo-latt'\)/.test(html) && (html.match(/moInstStang\(\)/g) || []).length >= 3);
  ok("bekräftelsens dagar, tidszonen och frågorna räknas också om", /const MOINSTSTAT = \[[^\]]*'bekraftaDagar'[^\]]*'tidszon'[^\]]*'fragor'/.test(html));
}

rubrik("Snabb inmatning i målen: 80 Tab 15 Tab");
{
  const m = /async function moInstSpara\(falt, varde\)\{[\s\S]*?\n\}/.exec(html);
  ok("moInstSpara finns", !!m);
  if (m) {
    const svar = [], skickat = [], ritat = [];
    const d = { installningar: { mal: {} }, inst: { mal: {} } };
    const ctx = {
      S: { moInst: { fel: {}, sparar: null, sparat: null } }, MOINST: { mal: "moten.mal" }, MOINSTSTAT: ["mal"], ndMo: () => d,
      moInstRita: () => ritat.push(JSON.stringify(d.installningar.mal)), moInstAterstall: () => {}, setTimeout: () => 0, Promise,
      ndMoPost: (_v, b) => { skickat.push(JSON.stringify(b.varde)); return new Promise((r) => svar.push(r)); },
    };
    vm.createContext(ctx); vm.runInContext(m[0], ctx);
    const ett = ctx.moInstSpara("mal", { show: 80 });
    ok("fältet ritas om med det just skrivna målet, inte det gamla", ritat[0] === JSON.stringify({ show: 80 }));
    const tva = ctx.moInstSpara("mal", { show: 80, noshow: 15 });
    await new Promise((r) => setImmediate(r));
    ok("andra sparningen väntar tills den första är klar", skickat.length === 1);
    svar[0]({ ok: true, varde: { show: 80 } }); await ett; await new Promise((r) => setImmediate(r));
    ok("sedan skickas båda målen", skickat.length === 2 && skickat[1] === JSON.stringify({ show: 80, noshow: 15 }));
    svar[1]({ ok: true, varde: { show: 80, noshow: 15 } }); await tva;
    ok("det sparade är båda målen", JSON.stringify(d.installningar.mal) === JSON.stringify({ show: 80, noshow: 15 }));
    const tre = ctx.moInstSpara("mal", { show: 101, noshow: 15 });
    await new Promise((r) => setImmediate(r));
    svar[2]({ ok: true, fel: "Målet är ett heltal 0–100." }); await tre;
    ok("ett nekat mål går tillbaka till det sparade", JSON.stringify(d.installningar.mal) === JSON.stringify({ show: 80, noshow: 15 }) && ctx.S.moInst.fel["moten.mal"]);
    const fyra = ctx.moInstSpara("mal", { show: 7.5 });
    await new Promise((r) => setImmediate(r));
    ctx.S.moInst = null;   // panelen stängs innan svaret kommit
    svar[3]({ ok: true, fel: "Målet är ett heltal 0–100." }); await fyra;
    ok("stängs panelen före svaret går ett nekat mål ändå tillbaka", JSON.stringify(d.installningar.mal) === JSON.stringify({ show: 80, noshow: 15 }));
  }
  const st = /function moInstStang\(\)\{[\s\S]*?\n\}/.exec(html);
  if (st && m) {
    let omlast = 0, klar;
    const ctx = { S: { moInst: { statAndrad: true } }, render() {}, NDOMLAS: { "mo-latt": {} }, ndOmlas: () => { omlast++; }, Promise };
    vm.createContext(ctx); vm.runInContext(m[0] + "\n" + st[0], ctx);
    ctx.moInstSpara.ko = { "moten.mal": new Promise((r) => { klar = r; }) };
    ctx.moInstStang();
    await new Promise((r) => setImmediate(r));
    ok("statistiken räknas inte om medan en sparning pågår", omlast === 0);
    klar(); await new Promise((r) => setImmediate(r));
    ok("utan när sparningen är klar, en gång", omlast === 1);
  }
}

rubrik("Från listan till kortet och tillbaka");
{
  const P = panel(), c = kor({ P });
  let ritad = 0;
  c.moGa = () => {}; c.render = () => { ritad++; }; c.S.view = "moten"; c.S.moStat = true;
  const kedja = Object.values(P.kedjor)[0].id;
  c.MSP.blad = "uppfnu";
  vm.runInContext(`msOppnaKort(${JSON.stringify(kedja)})`, c);
  ok("kortet öppnas ovanpå tavlan, som förut", c.S.moOpen === kedja && c.S.moStat === false && c.MSP.blad === null);
  ok("vägen tillbaka till listan sparas", c.S.moTillbaka && c.S.moTillbaka.blad === "uppfnu");
  const m = /function moStang\(\)\{[\s\S]*?\n\}/.exec(html);
  ok("moStang finns", !!m);
  if (m) {
    vm.runInContext(m[0], c);
    vm.runInContext("moStang()", c);
    ok("✕ och Esc går tillbaka till statistiken med samma lista öppen", c.S.moOpen === null && c.S.moStat === true && c.MSP.blad === "uppfnu" && c.S.moTillbaka === null);
    ok("listan glider inte in igen och talen räknas inte upp på nytt", c.MSP.bladNy === false && c.MSP.anim === false);
    c.S.moOpen = kedja; c.S.moStat = false; c.MSP.blad = null;
    vm.runInContext("moStang()", c);
    ok("ett kort som öppnats från tavlan stängs till tavlan", c.S.moStat === false && c.MSP.blad === null);
  }
  ok("ett kort som öppnas från tavlan glömmer vägen till statistiken", /if \(ds\.moopen\)\{[^\n]*S\.moTillbaka = null/.test(html));
  ok("byte mellan Pipeline, Kalender och Statistik glömmer vägen", /if \(ds\.movy\)\{[^\n]*S\.moTillbaka = null/.test(html));
  ok("en djuplänk till Möten glömmer vägen", /moInit\(\); S\.view = 'moten';[^\n]*S\.moTillbaka = null/.test(html));
}

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m` : "\n\x1b[32mAllt grönt\x1b[0m");
process.exit(fel ? 1 : 0);
