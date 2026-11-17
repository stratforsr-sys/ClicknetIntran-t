#!/usr/bin/env node
/**
 * Det nya hemmet i Nav 2.0 (prefix hv), byggt som skiss A v2 ("Instrumentet"): hälsningen och Väntar på dig till
 * vänster, urtavlan i mitten, månaden, Nav föreslår och Det som ändrats till höger, genvägarna och skrivrutan under.
 *
 * Provet läser blocket NYA HEMMET ur utkastet och kör det i en sandlåda där resten av utkastet är attrapper,
 * med två fasta ND: en chef och en säljare. Det som prövas är det som aldrig får gå fel i hemmet:
 *   - markupen är skissens: samma element, klasser, ordning, aria och fasta texter, matade med Navs data
 *     (förväntningarna är räknade ur skissens egna mallar i .lyft/skiss-a-delar, inte ur det byggda);
 *   - urtavlan är arbetsdagen: vinkeln för en tid, mötena som bågar, en frist på sin tid, det som brinner på
 *     visaren, kvällen visar i morgon, utan schema 08–17 och inget löfte om arbetsdagens slut;
 *   - stilen är skissens tecken för tecken, med bara kontraktets ändringar (§3 i .lyft/bygg-kontrakt.md);
 *   - Din månad visar bara det provisionsmotorn har räknat: väntande order står som antal, aldrig som kronor,
 *     och utan provisionsregel visas inga kronor alls;
 *   - varje genomgång säger hur texten kom till ("Räknat av regler") och vad Nav inte ser;
 *   - inget hv-namn finns två gånger (utkastet är ett enda namnrum).
 *
 *   node tests/nav2-hemvy.mjs
 */
import { existsSync, readFileSync } from "node:fs";

let fel = 0;
// Varje kontroll har en sort, som i provkartan: MARKUP låser skissens utseende, BETEENDE är funktion, säkerhet,
// data och tillgänglighet, REGEL är en stilregel som gäller oavsett skiss, MENYRAD rör det utanför hemmet.
// rubrik() sätter avsnittets sort; okM/okR/okN säger sorten för en enskild kontroll. Räkningen står sist.
let SORT = "BETEENDE";
const tally = {}, perRubrik = [];
const ok = (namn, villkor, extra = "", sort = SORT) => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${process.env.PROV_SORT ? `[${sort}] ` : ""}${namn}${extra && !villkor ? "  " + String(extra).slice(0, 400) : ""}`);
  if (!villkor) fel++;
  const t = (tally[sort] ??= { ja: 0, nej: 0 }); villkor ? t.ja++ : t.nej++;
  const r = perRubrik[perRubrik.length - 1]; if (r) villkor ? r.ja++ : r.nej++;
};
const okM = (namn, villkor, extra = "") => ok(namn, villkor, extra, "MARKUP");
const okR = (namn, villkor, extra = "") => ok(namn, villkor, extra, "REGEL");
const okN = (namn, villkor, extra = "") => ok(namn, villkor, extra, "MENYRAD");
const rubrik = (t, sort = "BETEENDE") => { SORT = sort; perRubrik.push({ t, ja: 0, nej: 0 }); console.log(`\n\x1b[1m${t}\x1b[0m`); };
// Skissens ikoner kan ligga under egna hv-namn (kontraktet §6): en ikon jämförs som ⟨svg⟩. Urtavlans bild (viewBox 400) jämförs alltid.
const utanIkon = (s) => String(s ?? "").replace(/<svg(?![^>]*viewBox="0 0 400 400")[^>]*>[\s\S]*?<\/svg>/g, "⟨svg⟩");

// Provet bor i tests/ (../src) men skrivs i .lyft/prov-ny/ (../../src): den första som finns läses.
const html = readFileSync(process.env.UTKAST ?? [new URL("../src/nav2/utkast.html", import.meta.url), new URL("../../src/nav2/utkast.html", import.meta.url)].find((u) => existsSync(u)) ?? new URL("../src/nav2/utkast.html", import.meta.url), "utf8");
const block = html.match(/\/\* =+\n {3}NAV 2\.0 I RIKTIGT LÄGE: NYA HEMMET \(prefix hv\)[\s\S]*?\/\* -{10} Nya hemmet slut -{10} \*\//)?.[0];
ok("blocket NYA HEMMET finns i utkastet", !!block);
if (!block) {
  console.log(`\n\x1b[31m${fel} prov föll.\x1b[0m`);
  process.exit(1);
}

rubrik("Utkastet är ett namnrum", "REGEL");
{
  const namn = [...html.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+(hv[A-Za-z0-9_]*)\s*\(|(?:^|\n)\s*(?:const|let)\s+(hv[A-Za-z0-9_]*|HV[A-Za-z0-9_]*)\s*=/g)].map((m) => m[1] || m[2]);
  const dubbla = namn.filter((n, i) => namn.indexOf(n) !== i);
  ok(`${namn.length} namn med prefixet hv, inget finns två gånger`, namn.length > 20 && dubbla.length === 0, dubbla.join(", "));
  for (const f of ["hvHem", "hvVantar", "hvForeslar", "hvTeam", "hvDinManad", "hvAndrat", "hvArk", "hvSkriv", "hvInstRuta"]) {
    ok(`${f} finns en gång`, (html.match(new RegExp(`function ${f}\\(`, "g")) || []).length === 1);
  }
  ok("render väljer: det nya hemmet bara för den som har det", html.includes("const hvNytt = S.view === 'hem' && !!S.hv && hvPa();") && /if \(hvNytt\)\{\s*wrap\.innerHTML = `\$\{renderDrift\(\)\}\$\{hvHem\(\)\}`;/.test(html));
  ok("det gamla hemmet ritas som förut för alla andra", html.includes("<div class=\"hemtop\">${renderHub()}${renderBrief()}</div>") && html.includes("${chef ? renderTeamGoal() + renderCnHemChef()"));
  ok("hemmets fönster går kant i kant", /\.main\.hvmode\{padding:0\}/.test(html));
  ok("sidopanelen står i Hovra för den som har nya hemmet och inte valt något", /ND\.hem\.nytt \? 'hovra' : 'utfalld'/.test(html));
}

/* ------------------------------------------------------------------------ */
/* Sandlådan                                                                 */
/* ------------------------------------------------------------------------ */

const inbyggda = new Set(["Object", "Array", "JSON", "Math", "Date", "Set", "Map", "String", "Number", "Boolean", "Promise", "RegExp", "Error", "Symbol", "parseInt", "parseFloat", "isNaN", "undefined", "NaN", "Infinity", "console", "encodeURIComponent", "setTimeout", "clearTimeout"]);
const attrapp = () => new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => "" : attrapp()), apply: () => attrapp() });
function kor(kod, g, namn = []) {
  const sandlada = new Proxy(g, {
    has: (_, k) => typeof k === "string" && !inbyggda.has(k),
    get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? t[k] : attrapp()),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  new Function("sandlada", `with (sandlada) {\n${kod}\n__ut = {${namn.join(", ")}};\n}`)(sandlada);
  return Object.assign(g, g.__ut);
}
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kr = (n) => `${Math.round(n).toLocaleString("sv-SE")} kr`;

const FORSLAG = (antal) => Array.from({ length: antal }, (_x, i) => ({
  id: `f${i}`, mote: `m${i}`, rubrik: `Hagby Glas ${i} i morgon 09.00`, val: ["ringer-sjalv", "flytta", "lat-sta"], utgar: "2026-11-17T08:00:00Z", kalla: "Räknat av regler",
  rader: [`Mötet med Hagby Glas ${i} i morgon 09.00 är inte bekräftat. Mick har ringt två gånger utan svar.`, "Hittills har 1 av 4 obekräftade möten hållits. Det är för få för att säga något.", "Det här ser jag inte: om kunden har hört av sig på annat sätt."],
  kort: { tal: "1", vad: "möte i morgon är obekräftat", text: `Hagby Glas ${i} 09.00. Mick har ringt två gånger utan svar.`, knapp: "Välj vad som händer" },
}));
const TEAM = {
  manad: "2026-11", manadsnamn: "november", netto: 19, vantar: 1, makulerade: 1, mal: 46, utanMal: 0, takt: { gatt: 10, totalt: 21, prognos: 40 },
  facit: [{ manad: "2026-10", gatt: 10, sa: 38, blev: 44, efterhand: false }],
  text: { stort: "19 av 46 order", rad: "I samma takt blir det ungefär 40. Det är en uträkning på takten, inget löfte.", malrad: null, facit: "Efter 10 dagar sa takten 38 i oktober (det blev 44).", kort: "I samma takt blir det ungefär 40. I oktober sa takten 38, det blev 44." },
  kalla: "Räknat av regler",
};
const ANDRAT = [{ id: "a1", sort: "forslag", text: "Hagby Glas: du valde att låta mötet stå. Mötet hölls. Mötet blev aldrig bekräftat.", dom: null, tal: null, ton: "vet", stangd: true, galler: "dig", nar: "2026-11-13T07:00:00Z", vem: null, kommentar: null, fran: "regel", kalla: "Räknat av regler" }];

const GOLVET = {
  manad: "2026-11", lag: "Team Nord", antal: 19, netto: 412000, mal: { order: 46 }, idagAntal: 3, idagSumma: 80000, utanVarde: 0, senast: null,
  idag: [
    { id: "o1", vem: "Mick Prov", kund: "Hagmans Rör", vad: "Stor, 36 månader", belopp: 36000, kl: "10:12", du: false, jag: false, grattis: 1 },
    { id: "o2", vem: "Edvin Prov", kund: "Åkes Bygg", vad: "Mellan, 36 månader", belopp: null, kl: "11:40", du: true, jag: false, grattis: 2 },
  ],
};
const AKORT = { foljs: 4, nastaDom: "2026-11-27", stort: { tal: "2 av 52", vad: "möten uteblev" }, text: "Carl ringer före 10. En annan ändring ser sämre ut." };
function hem({ chef, forslag = 1, andrat = ANDRAT, andratKort = AKORT, rader = null, team = TEAM, underlag = "med", vantar = 1, pa = true, inst = null, golvet = GOLVET, mode = "morgon", hvton = null, nu = 480, dag = undefined, kal = null, kalImorgon = null, kalender = true, tasks = null } = {}) {
  const anrop = [];
  // Kalendern i dag och nästa arbetsdag (ndHemNasta ger 2026-11-17). Mötena har slut (e) och id, som KEV.
  const KAL = kal ?? [{ s: 660, e: 690, t: "PEGU Byggservice", id: "k1" }, { s: 840, e: 870, t: "Veckomöte", id: "k2" }];
  const KALI = kalImorgon ?? [{ s: 540, e: 570, t: "Morgonmöte Team Nord", id: "k3" }];
  const U = {
    rader: [{ slag: "order", text: "#11 Hagmans Rör", sub: "Stor, 36 månader", dag: "2026-11-03", belopp: 6500 }, { slag: "order", text: "#12 Åkes Bygg", sub: "Mellan, 36 månader", dag: "2026-11-05", belopp: 8000 }],
    antal: { signerade: 2, makulerade: 0, netto: 2 }, bonusantal: 2, summa: 14500, niva: null, nasta: { niva: { t: 5, a: 500 }, kvar: 3 }, moten: null,
    vantar: Array.from({ length: vantar }, (_x, i) => ({ id: `v${i}`, nr: 20 + i, bolag: "Björks Åkeri", prov: 2000, st: "inskickad" })), utkast: [],
  };
  const g = {
    ND: {
      jag: { id: "jag" },
      hem: {
        nytt: true, inst, dag: dag ?? null,
        forslag: { pa, oppna: FORSLAG(forslag), kortrad: forslag ? `${forslag} ${forslag === 1 ? "möte i morgon är obekräftat" : "möten i morgon är obekräftade"}` : null, andrat, andratKort, trend: { har: 11, behover: 60 }, trendrad: "För att jämföra laget med sig självt behöver jag 60 avgjorda möten. Jag har 11." },
        team: chef ? team : null,
        golvet, push: { nyckel: "n", enheter: 1, ledare: !!chef },
      },
      uppgifter: { klara: [{ at: "2026-11-16T09:00:00Z" }, { at: "2026-11-16T13:00:00Z" }, { at: "2026-11-13T13:00:00Z" }] },
      provision: { jagId: "jag", underlag: { "2026-11": underlag === "med" ? { jag: {} } : {} }, moten: null },
      moten: { kort: [], saljare: [{ id: "p1", namn: "Edvin Prov" }], offertPaket: [] },
      tid: { stamplar: true, modulPa: true },
    },
    S: { view: "hem", role: chef ? "chef" : "saljare", mode, events: [], hv: undefined, flagged: new Set(), hiddenKinds: new Set(), done: new Set(), speaking: false },
    MODES: { morgon: { halsning: "God morgon", dag: "Måndag 16 november" }, slut: { halsning: "Bra jobbat i dag", dag: "Måndag 16 november" } },
    KIND_LABEL: { rutin: "rutiner", uppgift: "uppgifter", "frånvaro": "frånvaro" },
    DELTA: { chef: { morgon: "I natt och i morse: 2 nya poster i klockan, senast Order #31 är godkänd.", slut: "I dag: inget nytt i klockan." }, saljare: { morgon: "I natt och i morse: inget nytt i klockan.", slut: "I dag: inget nytt i klockan." } },
    FRMAN: ["", "januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"],
    TMR: { chef: { kal: [["09:00", "Morgonmöte Team Nord"]], uppg: ["Ring Solbacken"], borta: [["Mick Prov", "semester"]], beslut: [["Carls ledighet", "börjar 18 nov, beslut innan dess"]] }, saljare: { kal: [["09:00", "Morgonmöte Team Nord"], ["13:30", "PEGU Byggservice"]], uppg: ["Skicka offert till Solbacken"] } },
    WEEK: { chef: { dagar: [["mån", "16", ["Morgonmöte 09:00"], null, "2026-11-16"], ["tis", "17", ["2 i kalendern", "Mick semester"], ["Besluta Carls ledighet", "danger"], "2026-11-17"], ["ons", "18", ["Inget inbokat"], null, "2026-11-18"]], klart: ["Ring Solbacken", "Bokför novemberprovisionen, {PV}"] },
            saljare: { dagar: [["mån", "16", ["PEGU Byggservice 11:00"], null, "2026-11-16"], ["tis", "17", ["Inget inbokat"], null, "2026-11-17"]], klart: ["Skicka offert till Solbacken"] } },
    ndHemTmrSynk: () => "2026-11-17", ndHemVecka: () => ({ man: "2026-11-16", fre: "2026-11-20" }), ndHemNasta: () => "2026-11-17", ndHemDagNamn: () => "Tisdag", ndPlusDag: (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }, ndVecka: () => 47, frPeriod: () => "16–20 nov",
    hemPvPoster: () => ({ n: 4, summa: 12000 }), ndHemPushRad: () => "På för den här enheten.", ndHemLive: () => { anrop.push(["live"]); },
    ndHemPost: async (handling, data) => { anrop.push([handling, data]); return { ok: handling === "flagga" ? "Markerad som fel. Raden blir underlag för att rätta sammanfattningen." : handling === "grattis" ? "Grattis skickat. Säljaren får en pling." : "Sparat." }; },
    INBOX: [{ id: "r1", nar: "nu" }, { id: "r2", nar: "idag" }, { id: "r3", nar: "vanta" }],
    ndUp: () => true, TASKS: tasks ?? [{ id: "7", ndNytt: [{ sort: "kommentar" }] }, { id: "8", ndNytt: [] }], ndNyPrick: (t) => `<span class="upg-nyprick" title="Nytt på uppgift ${t.id}"></span>`, ME: { chef: { fornamn: "Zen", namn: "Zen Prov" }, saljare: { fornamn: "Edvin", namn: "Edvin Prov" } },
    esc, kr, oKr: kr, I: (n) => `<svg data-i="${n}"></svg>`, hubMark: (s) => `<svg data-nav="${s}"></svg>`,
    ndHemRad: rader ?? [
      { id: "r1", nar: "nu", heat: 5, bkind: "frånvaro", kind: "Frånvaro", bt: "{Carl} är sjukanmäld.", t: "Carl är sjukanmäld", why: "Sjuk sedan i dag. Ingen har bekräftat", act: { l: "Bekräfta" }, gor: () => {} },
      { id: "r2", nar: "idag", heat: 2, bkind: "uppgift", kind: "Uppgift", bt: "{Ring tillbaka Mälarö Frakt} i dag.", t: "Ring tillbaka Mälarö Frakt", why: "Frist i dag", act: { l: "Klar", check: true }, gor: () => {}, ga: () => {} },
      { id: "r3", nar: "vanta", heat: 1, bkind: "rutin", kind: "Rutin", bt: "{Säljsamtal} ska granskas.", t: "Rutinen Säljsamtal ska granskas", why: "Granskningen var 12 nov", act: { l: "Granska" }, ga: () => {} },
      { id: "r4", nar: "nu", heat: 3, bkind: "möten", kind: "Möten", bt: "Sätt utfall på {2 möten}.", t: "Sätt utfall på 2 möten", why: "Hölls i fredags", act: { l: "Öppna" }, ga: () => {} },
      { id: "r5", nar: "vanta", heat: 1, bkind: "utbildning", kind: "Utbildning", bt: "{Släpp inte kunden för tidigt}.", t: "Kursen Släpp inte kunden för tidigt", why: "Del 2 av 3", act: { l: "Öppna" }, ga: () => {} },
    ],
    ndHemSynk: () => {}, complete: () => {}, teamNow: () => (chef ? [["Carl Prov", "inne", "sedan 07:58"], ["Mick Prov", "sjuk", "sjuk sedan i dag"], ["Edvin Prov", "ej", "schemat börjar 08:00"]] : []),
    LAGE: { inne: { l: "Inne" }, sjuk: { l: "Sjuk" }, ledig: { l: "Ledig" }, ej: { l: "Ej instämplad" } },
    stampLage: () => "ute", hm: (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`, now: () => nu,
    kIdag: () => "2026-11-16", ndHemLangt: (d) => (d === "2026-11-17" ? "Tisdag 17 november" : "Måndag 16 november"), ndHemKal: (d) => (d === "2026-11-17" ? KALI : KAL),
    ndKopplad: (vy) => vy !== "kalender" || kalender, ndP: () => g.ND.provision, pvSt: () => {}, PVMAN: "2026-11", pvManNamn: () => "november", pvUnderlag: () => U,
    pvTakt: () => ({ prognos: { totalt: 30500 } }), oProv: (o) => o.prov, oDat: (d) => `${+d.slice(8)} nov`, frKort: (d) => `${+d.slice(8)} nov`,
    ndOmlasAnmal: () => {}, ndOmlas: () => Promise.resolve(true), render: () => {}, toast: () => {},
    document: { addEventListener: () => {}, getElementById: () => null, querySelector: () => null }, window: { addEventListener: () => {}, scrollTo: () => {} },
    localStorage: { getItem: (k) => (k === "nav2-hvton" ? hvton : null), setItem: () => {} },
    openPal: () => { anrop.push(["pal"]); }, TextDecoder, AbortController,
    // Tickarna och Navs egen toast räknas, så att proven ser hur många som startas och vad som går till Nav.
    CSS: { escape: (x) => String(x) }, setInterval: (f, ms) => { anrop.push(["setInterval", ms]); return { f }; }, clearInterval: (t) => { if (t) anrop.push(["clearInterval"]); },
    toastActs: (msg, acts) => { anrop.push(["navtoast", msg, acts.length]); },
  };
  kor(block, g, ["hvHem", "hvVantar", "hvForeslar", "hvTeam", "hvDinManad", "hvAndrat", "hvArk", "hvSkriv", "hvInstRuta", "hvPa", "hvFlagga", "hvDolj", "hvVisa", "hvGrattis", "hvHamta", "hvOppna", "hvValj", "hvTangent", "hvFraga", "hvChattGodkann", "hvChattAngra", "hvKlick", "hvStang", "hvPlaneraDag", "hvSseDela", "hvVidBotten", "hvChattStopp", "hvChattIgen", "hvBokaDag", "hvAngraDag", "hvKopiera",
    "hvUrtavla", "hvUrMitt", "hvUrRam", "hvUrVink", "hvUrBage", "hvDagPlan", "hvVisadDag", "hvDagSlut", "hvHalsning", "hvTraffar", "hvTraffVy", "hvEfterRita", "hvFlip", "hvMinut", "hvD", "hvForeMat", "hvFokusNyckel", "hvHeroRad", "hvDockRad", "hvLys", "hvStegKlocka", "hvValjTraff", "hvBokaKnapp", "hvDagNyckel", "hvSkala", "hvLageSynk",
    "hvTradSpara", "hvTradLas", "hvSidanGar", "hvSrSag", "hvAnnanFlik", "hvChattAvbryt", "hvChattLage", "hvKortBygg", "hvKortRattaOppna", "hvKortRattaStang",
    "hvKortFor", "hvKortUtfall", "hvArkGolvet", "hvArkVantar", "hvArkDag", "hvGenv", "hvTopp", "hvGor", "hvKlar", "hvAteroppna", "hvLasOm", "hvTillbaka", "hvSkaLasaOm", "hvBildTa", "hvSedan", "hvSedanText", "hvRattaRad", "hvUrKort", "hvMittUtfall", "hvForberedChip", "hvNavTraffar", "hvTraffOmrita", "hvArkFacit", "hvArkForslag"]);
  g.anrop = anrop;
  return g;
}
// Ett avsnitt på hemmet hittas på sin aria-label (rubriken först, ensam eller före ett kolon): skissens <section class="hv-sek">,
// <section class="hv-man"> och <button class="hv-andr">. Ett tomt avsnitt är en rad utan namn (<div class="hv-andr">): då på sin rubrik <b>.
const kort = (h, etikett) => {
  const e = etikett.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return h.match(new RegExp(`<(section|button|div) class="hv-(?:sek|man|andr)[^"]*"[^>]*aria-label="${e}(?::[^"]*)?"[^>]*>[\\s\\S]*?</\\1>`))?.[0]
    ?? h.match(new RegExp(`<(div|button) class="hv-andr[^"]*"[^>]*>(?:(?!</\\1>)[\\s\\S])*?<b>${e}</b>[\\s\\S]*?</\\1>`))?.[0] ?? "";
};
const namnet = (k) => k.match(/^<(?:section|button|div)[^>]*aria-label="([^"]*)"/)?.[1] ?? "";
const stor = (k) => k.match(/<div class="hv-stor">([\s\S]*?)<\/div>/)?.[1] ?? "";
// Navs riktiga frKort ger veckodagen först ("tors 27 nov"), sandlådans ger bara "27 nov". Där hemmet tar bort veckodagen
// (skissens "nästa dom 27 nov") prövas det med den riktiga formen, så att provet inte godkänner ett fel som bara syns i Nav.
const frKortRiktig = (d) => `${["", "mån", "tis", "ons", "tors", "fre", "lör", "sön"][new Date(`${d}T12:00:00Z`).getUTCDay() || 7]} ${+d.slice(8)} ${["", "jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"][+d.slice(5, 7)]}`;
// Skissens egna mallar (.lyft/skiss-a-delar: vy.js, ur.js, trad.js) körda av ett skript med provets data, med
// ikonerna som ⟨svg⟩ och kontraktets namnbyten (§6: data-hvinl blir data-hvark, data-hvhem blir data-hvstang, Förbered
// bär data-hvforbered). Inget här är skrivet för hand, utom en sak: i A_heroP och A_hero står punkten efter mötet inne
// i knappen ("…Byggservice.</button>"), som i produkten. Skissen har den efter knappen; flytten står i .lyft/avvikelser.md
// under "Skissens fel som rättats" (Punkten efter mötet i lägesmeningen) och väntar på beställarens ja. Nycklarna: A = chefen 08.00 utan schema, B = hela dagen
// (schema 08–17, 10.30, en frist 15.00, en order 10.12), C = kvällen 18.00, E = 15.30 efter mötena, F = utan kalender,
// G = Min dag 09.41, I = läget till höger, T = tråden.
const SK = {
 "A_heroP": "<p class=\"an\" style=\"--i:1\"><button class=\"hv-herok\" data-hvark=\"vantar\"><b data-roll=\"lage\">Två saker brinner.</b></button> Två möten kvar i dag, <button class=\"hv-herok\" data-hvark=\"dag\" data-m=\"k1\">nästa 11.00 med PEGU Byggservice.</button>",
 "A_hero": "<div class=\"hv-hero\"><div><h1 class=\"an\" style=\"--i:0\">God morgon, Zen</h1><p class=\"an\" style=\"--i:1\"><button class=\"hv-herok\" data-hvark=\"vantar\"><b data-roll=\"lage\">Två saker brinner.</b></button> Två möten kvar i dag, <button class=\"hv-herok\" data-hvark=\"dag\" data-m=\"k1\">nästa 11.00 med PEGU Byggservice.</button><button class=\"hv-lyssna\" data-hvlyssna aria-label=\"Lyssna på dagen i korthet\">⟨svg⟩Lyssna</button></p></div><button class=\"hv-ins kompakt\" data-hvark=\"dag\" aria-label=\"Dagen utan schema, klockan 08.00. Två möten kvar, två saker brinner. Öppna Min dag\"><svg viewBox=\"0 0 400 400\" aria-hidden=\"true\"><path class=\"r-ring\" d=\"M112.0 352.4A176 176 0 1 1 288.0 352.4\"/><line class=\"r-tick h\" x1=\"112.0\" y1=\"352.4\" x2=\"117.0\" y2=\"343.8\"/><line class=\"r-tick\" x1=\"90.8\" y1=\"338.1\" x2=\"93.9\" y2=\"334.1\"/><line class=\"r-tick\" x1=\"72.0\" y1=\"320.8\" x2=\"75.6\" y2=\"317.3\"/><line class=\"r-tick\" x1=\"55.8\" y1=\"300.9\" x2=\"59.9\" y2=\"298.1\"/><line class=\"r-tick h\" x1=\"42.7\" y1=\"279.0\" x2=\"51.7\" y2=\"274.5\"/><line class=\"r-tick\" x1=\"32.9\" y1=\"255.4\" x2=\"37.7\" y2=\"253.8\"/><line class=\"r-tick\" x1=\"26.7\" y1=\"230.6\" x2=\"31.6\" y2=\"229.7\"/><line class=\"r-tick\" x1=\"24.1\" y1=\"205.1\" x2=\"29.1\" y2=\"205.0\"/><line class=\"r-tick h\" x1=\"25.2\" y1=\"179.6\" x2=\"35.1\" y2=\"180.7\"/><line class=\"r-tick\" x1=\"30.0\" y1=\"154.4\" x2=\"34.8\" y2=\"155.7\"/><line class=\"r-tick\" x1=\"38.4\" y1=\"130.3\" x2=\"43.0\" y2=\"132.3\"/><line class=\"r-tick\" x1=\"50.2\" y1=\"107.6\" x2=\"54.5\" y2=\"110.2\"/><line class=\"r-tick h\" x1=\"65.2\" y1=\"86.9\" x2=\"72.8\" y2=\"93.3\"/><line class=\"r-tick\" x1=\"83.0\" y1=\"68.5\" x2=\"86.3\" y2=\"72.3\"/><line class=\"r-tick\" x1=\"103.3\" y1=\"53.0\" x2=\"106.0\" y2=\"57.1\"/><line class=\"r-tick\" x1=\"125.6\" y1=\"40.5\" x2=\"127.7\" y2=\"45.0\"/><line class=\"r-tick h\" x1=\"149.5\" y1=\"31.4\" x2=\"152.4\" y2=\"41.0\"/><line class=\"r-tick\" x1=\"174.5\" y1=\"25.9\" x2=\"175.2\" y2=\"30.8\"/><line class=\"r-tick\" x1=\"200.0\" y1=\"24.0\" x2=\"200.0\" y2=\"29.0\"/><line class=\"r-tick\" x1=\"225.5\" y1=\"25.9\" x2=\"224.8\" y2=\"30.8\"/><line class=\"r-tick h\" x1=\"250.5\" y1=\"31.4\" x2=\"247.6\" y2=\"41.0\"/><line class=\"r-tick\" x1=\"274.4\" y1=\"40.5\" x2=\"272.3\" y2=\"45.0\"/><line class=\"r-tick\" x1=\"296.7\" y1=\"53.0\" x2=\"294.0\" y2=\"57.1\"/><line class=\"r-tick\" x1=\"317.0\" y1=\"68.5\" x2=\"313.7\" y2=\"72.3\"/><line class=\"r-tick h\" x1=\"334.8\" y1=\"86.9\" x2=\"327.2\" y2=\"93.3\"/><line class=\"r-tick\" x1=\"349.8\" y1=\"107.6\" x2=\"345.5\" y2=\"110.2\"/><line class=\"r-tick\" x1=\"361.6\" y1=\"130.3\" x2=\"357.0\" y2=\"132.3\"/><line class=\"r-tick\" x1=\"370.0\" y1=\"154.4\" x2=\"365.2\" y2=\"155.7\"/><line class=\"r-tick h\" x1=\"374.8\" y1=\"179.6\" x2=\"364.9\" y2=\"180.7\"/><line class=\"r-tick\" x1=\"375.9\" y1=\"205.1\" x2=\"370.9\" y2=\"205.0\"/><line class=\"r-tick\" x1=\"373.3\" y1=\"230.6\" x2=\"368.4\" y2=\"229.7\"/><line class=\"r-tick\" x1=\"367.1\" y1=\"255.4\" x2=\"362.3\" y2=\"253.8\"/><line class=\"r-tick h\" x1=\"357.3\" y1=\"279.0\" x2=\"348.3\" y2=\"274.5\"/><line class=\"r-tick\" x1=\"344.2\" y1=\"300.9\" x2=\"340.1\" y2=\"298.1\"/><line class=\"r-tick\" x1=\"328.0\" y1=\"320.8\" x2=\"324.4\" y2=\"317.3\"/><line class=\"r-tick\" x1=\"309.2\" y1=\"338.1\" x2=\"306.1\" y2=\"334.1\"/><line class=\"r-tick h\" x1=\"288.0\" y1=\"352.4\" x2=\"283.0\" y2=\"343.8\"/><path class=\"r-band\" d=\"M125.0 329.9A150 150 0 1 1 275.0 329.9\"/><path class=\"m r-mote\" data-m=\"k1\" style=\"--i:0\" d=\"M86.1 102.4A150 150 0 0 1 116.3 75.5\"/><path class=\"m r-mote\" data-m=\"k2\" style=\"--i:1\" d=\"M315.9 104.8A150 150 0 0 1 337.1 139.1\"/><g class=\"r-vis\" data-vis=\"kompakt\" data-vinkel=\"-150.0\" style=\"transform:rotate(-150.0deg)\"><line x1=\"200\" y1=\"98\" x2=\"200\" y2=\"14\"/><circle cx=\"200\" cy=\"14\" r=\"3.2\"/></g></svg><div class=\"hv-mitt\"><span class=\"l\">Nästa</span><span class=\"k num\" data-roll=\"mitt-k-kompakt\">11.00</span></div></button></div>",
 "A_vantar": "<section class=\"hv-sek an\" style=\"--i:2\" aria-label=\"Väntar på dig\"><div class=\"hv-sekh\"><h2>Väntar på dig</h2><span class=\"hv-n\" data-roll=\"vantar-n\">3</span><button class=\"hv-lank hv-end\" data-hvark=\"vantar\">Hela listan⟨svg⟩</button></div><div class=\"hv-rad an\" style=\"--i:3\" data-flip=\"rad-r1\" data-rad=\"r1\" data-m=\"r1\"><i class=\"hv-prk het\" aria-hidden=\"true\"></i><button class=\"hv-radt\" data-hvrad=\"r1\" aria-label=\"Carl är sjukanmäld. Sjuk sedan i dag. Ingen har bekräftat. Brinner\"><b>Carl är sjukanmäld</b><small>Sjuk sedan i dag. Ingen har bekräftat</small></button><button class=\"hv-btn\" data-hvgor=\"r1\">Bekräfta</button></div><div class=\"hv-rad an\" style=\"--i:4\" data-flip=\"rad-r4\" data-rad=\"r4\" data-m=\"r4\"><i class=\"hv-prk het\" aria-hidden=\"true\"></i><button class=\"hv-radt\" data-hvrad=\"r4\" aria-label=\"Sätt utfall på 2 möten. Hölls i fredags. Brinner\"><b>Sätt utfall på 2 möten</b><small>Hölls i fredags</small></button><button class=\"hv-btn\" data-hvgor=\"r4\">Öppna</button></div><div class=\"hv-rad an\" style=\"--i:5\" data-flip=\"rad-r2\" data-rad=\"r2\" data-m=\"r2\"><i class=\"hv-prk\" aria-hidden=\"true\"></i><button class=\"hv-radt\" data-hvrad=\"r2\" aria-label=\"Ring tillbaka Mälarö Frakt. Frist i dag. I dag\"><b>Ring tillbaka Mälarö Frakt</b><small>Frist i dag</small></button><button class=\"hv-btn\" data-hvgor=\"r2\">⟨svg⟩Klar</button></div><div class=\"hv-mer-rad\" data-flip=\"vantar-fot\"><button class=\"hv-lank\" data-hvark=\"vantar\">2 till som kan vänta⟨svg⟩</button></div></section>",
 "A_ur": "<div class=\"hv-ins stor\" data-flip=\"ur\" role=\"group\" aria-label=\"Dagen utan schema, klockan 08.00. Två möten kvar, två saker brinner\"><svg viewBox=\"0 0 400 400\" aria-hidden=\"true\"><path class=\"r-ring\" d=\"M112.0 352.4A176 176 0 1 1 288.0 352.4\"/><line class=\"r-tick h\" x1=\"112.0\" y1=\"352.4\" x2=\"117.0\" y2=\"343.8\"/><text class=\"r-siffra ande\" x=\"104.5\" y=\"365.4\">08</text><line class=\"r-tick\" x1=\"90.8\" y1=\"338.1\" x2=\"93.9\" y2=\"334.1\"/><line class=\"r-tick\" x1=\"72.0\" y1=\"320.8\" x2=\"75.6\" y2=\"317.3\"/><line class=\"r-tick\" x1=\"55.8\" y1=\"300.9\" x2=\"59.9\" y2=\"298.1\"/><line class=\"r-tick h\" x1=\"42.7\" y1=\"279.0\" x2=\"51.7\" y2=\"274.5\"/><text class=\"r-siffra\" x=\"29.3\" y=\"285.7\">09</text><line class=\"r-tick\" x1=\"32.9\" y1=\"255.4\" x2=\"37.7\" y2=\"253.8\"/><line class=\"r-tick\" x1=\"26.7\" y1=\"230.6\" x2=\"31.6\" y2=\"229.7\"/><line class=\"r-tick\" x1=\"24.1\" y1=\"205.1\" x2=\"29.1\" y2=\"205.0\"/><line class=\"r-tick h\" x1=\"25.2\" y1=\"179.6\" x2=\"35.1\" y2=\"180.7\"/><text class=\"r-siffra\" x=\"10.3\" y=\"177.8\">10</text><line class=\"r-tick\" x1=\"30.0\" y1=\"154.4\" x2=\"34.8\" y2=\"155.7\"/><line class=\"r-tick\" x1=\"38.4\" y1=\"130.3\" x2=\"43.0\" y2=\"132.3\"/><line class=\"r-tick\" x1=\"50.2\" y1=\"107.6\" x2=\"54.5\" y2=\"110.2\"/><line class=\"r-tick h\" x1=\"65.2\" y1=\"86.9\" x2=\"72.8\" y2=\"93.3\"/><text class=\"r-siffra\" x=\"53.7\" y=\"77.2\">11</text><line class=\"r-tick\" x1=\"83.0\" y1=\"68.5\" x2=\"86.3\" y2=\"72.3\"/><line class=\"r-tick\" x1=\"103.3\" y1=\"53.0\" x2=\"106.0\" y2=\"57.1\"/><line class=\"r-tick\" x1=\"125.6\" y1=\"40.5\" x2=\"127.7\" y2=\"45.0\"/><line class=\"r-tick h\" x1=\"149.5\" y1=\"31.4\" x2=\"152.4\" y2=\"41.0\"/><text class=\"r-siffra\" x=\"145.2\" y=\"17.0\">12</text><line class=\"r-tick\" x1=\"174.5\" y1=\"25.9\" x2=\"175.2\" y2=\"30.8\"/><line class=\"r-tick\" x1=\"200.0\" y1=\"24.0\" x2=\"200.0\" y2=\"29.0\"/><line class=\"r-tick\" x1=\"225.5\" y1=\"25.9\" x2=\"224.8\" y2=\"30.8\"/><line class=\"r-tick h\" x1=\"250.5\" y1=\"31.4\" x2=\"247.6\" y2=\"41.0\"/><text class=\"r-siffra\" x=\"254.8\" y=\"17.0\">13</text><line class=\"r-tick\" x1=\"274.4\" y1=\"40.5\" x2=\"272.3\" y2=\"45.0\"/><line class=\"r-tick\" x1=\"296.7\" y1=\"53.0\" x2=\"294.0\" y2=\"57.1\"/><line class=\"r-tick\" x1=\"317.0\" y1=\"68.5\" x2=\"313.7\" y2=\"72.3\"/><line class=\"r-tick h\" x1=\"334.8\" y1=\"86.9\" x2=\"327.2\" y2=\"93.3\"/><text class=\"r-siffra\" x=\"346.3\" y=\"77.2\">14</text><line class=\"r-tick\" x1=\"349.8\" y1=\"107.6\" x2=\"345.5\" y2=\"110.2\"/><line class=\"r-tick\" x1=\"361.6\" y1=\"130.3\" x2=\"357.0\" y2=\"132.3\"/><line class=\"r-tick\" x1=\"370.0\" y1=\"154.4\" x2=\"365.2\" y2=\"155.7\"/><line class=\"r-tick h\" x1=\"374.8\" y1=\"179.6\" x2=\"364.9\" y2=\"180.7\"/><text class=\"r-siffra\" x=\"389.7\" y=\"177.8\">15</text><line class=\"r-tick\" x1=\"375.9\" y1=\"205.1\" x2=\"370.9\" y2=\"205.0\"/><line class=\"r-tick\" x1=\"373.3\" y1=\"230.6\" x2=\"368.4\" y2=\"229.7\"/><line class=\"r-tick\" x1=\"367.1\" y1=\"255.4\" x2=\"362.3\" y2=\"253.8\"/><line class=\"r-tick h\" x1=\"357.3\" y1=\"279.0\" x2=\"348.3\" y2=\"274.5\"/><text class=\"r-siffra\" x=\"370.7\" y=\"285.7\">16</text><line class=\"r-tick\" x1=\"344.2\" y1=\"300.9\" x2=\"340.1\" y2=\"298.1\"/><line class=\"r-tick\" x1=\"328.0\" y1=\"320.8\" x2=\"324.4\" y2=\"317.3\"/><line class=\"r-tick\" x1=\"309.2\" y1=\"338.1\" x2=\"306.1\" y2=\"334.1\"/><line class=\"r-tick h\" x1=\"288.0\" y1=\"352.4\" x2=\"283.0\" y2=\"343.8\"/><text class=\"r-siffra ande\" x=\"295.5\" y=\"365.4\">17</text><path class=\"r-band\" d=\"M125.0 329.9A150 150 0 1 1 275.0 329.9\"/><path class=\"m r-mote\" data-m=\"k1\" style=\"--i:0\" d=\"M86.1 102.4A150 150 0 0 1 116.3 75.5\"/><path class=\"m r-mote\" data-m=\"k2\" style=\"--i:1\" d=\"M315.9 104.8A150 150 0 0 1 337.1 139.1\"/><g class=\"r-vis\" data-vis=\"stor\" data-vinkel=\"-150.0\" style=\"transform:rotate(-150.0deg)\"><line x1=\"200\" y1=\"98\" x2=\"200\" y2=\"14\"/><circle cx=\"200\" cy=\"14\" r=\"3.2\"/></g></svg><button class=\"hv-pin brinn\" style=\"left:34.3%;top:77.3%\" data-m=\"brinn\" data-hvark=\"vantar\" aria-label=\"Två saker brinner nu. Öppna Väntar på dig\"><span data-roll=\"brinn-stor\">2</span><span class=\"hv-tip\">Två saker brinner nu<small>Öppna Väntar på dig</small></span></button><button class=\"hv-pin\" style=\"left:25.1%;top:22.0%\" data-m=\"k1\" data-hvark=\"dag\" aria-label=\"11.00–11.30 · PEGU Byggservice. Öppna Min dag\"><span class=\"hv-tip\">11.00–11.30 · PEGU Byggservice<small>Öppna Min dag</small></span></button><button class=\"hv-pin\" style=\"left:81.9%;top:30.3%\" data-m=\"k2\" data-hvark=\"dag\" aria-label=\"14.00–14.30 · Veckomöte. Öppna Min dag\"><span class=\"hv-tip\">14.00–14.30 · Veckomöte<small>Öppna Min dag</small></span></button><button class=\"hv-mitt\" data-hvark=\"dag\" data-m=\"k1\" aria-label=\"11.00 PEGU Byggservice. Öppna Min dag\"><span class=\"l\">Nästa</span><span class=\"k num\" data-roll=\"mitt-k-stor\">11.00</span><span class=\"v\">PEGU Byggservice</span><span class=\"s\" data-roll=\"mitt-s-stor\">om 3 h</span></button></div>",
 "B_ur": "<div class=\"hv-ins stor\" data-flip=\"ur\" role=\"group\" aria-label=\"Dagen 08.00 till 17.00, klockan 10.30. Två möten kvar, två saker brinner\"><svg viewBox=\"0 0 400 400\" aria-hidden=\"true\"><path class=\"r-ring\" d=\"M112.0 352.4A176 176 0 1 1 288.0 352.4\"/><line class=\"r-tick h\" x1=\"112.0\" y1=\"352.4\" x2=\"117.0\" y2=\"343.8\"/><text class=\"r-siffra ande\" x=\"104.5\" y=\"365.4\">08</text><line class=\"r-tick\" x1=\"90.8\" y1=\"338.1\" x2=\"93.9\" y2=\"334.1\"/><line class=\"r-tick\" x1=\"72.0\" y1=\"320.8\" x2=\"75.6\" y2=\"317.3\"/><line class=\"r-tick\" x1=\"55.8\" y1=\"300.9\" x2=\"59.9\" y2=\"298.1\"/><line class=\"r-tick h\" x1=\"42.7\" y1=\"279.0\" x2=\"51.7\" y2=\"274.5\"/><text class=\"r-siffra\" x=\"29.3\" y=\"285.7\">09</text><line class=\"r-tick\" x1=\"32.9\" y1=\"255.4\" x2=\"37.7\" y2=\"253.8\"/><line class=\"r-tick\" x1=\"26.7\" y1=\"230.6\" x2=\"31.6\" y2=\"229.7\"/><line class=\"r-tick\" x1=\"24.1\" y1=\"205.1\" x2=\"29.1\" y2=\"205.0\"/><line class=\"r-tick h\" x1=\"25.2\" y1=\"179.6\" x2=\"35.1\" y2=\"180.7\"/><text class=\"r-siffra\" x=\"10.3\" y=\"177.8\">10</text><line class=\"r-tick\" x1=\"30.0\" y1=\"154.4\" x2=\"34.8\" y2=\"155.7\"/><line class=\"r-tick\" x1=\"38.4\" y1=\"130.3\" x2=\"43.0\" y2=\"132.3\"/><line class=\"r-tick\" x1=\"50.2\" y1=\"107.6\" x2=\"54.5\" y2=\"110.2\"/><line class=\"r-tick h\" x1=\"65.2\" y1=\"86.9\" x2=\"72.8\" y2=\"93.3\"/><text class=\"r-siffra\" x=\"53.7\" y=\"77.2\">11</text><line class=\"r-tick\" x1=\"83.0\" y1=\"68.5\" x2=\"86.3\" y2=\"72.3\"/><line class=\"r-tick\" x1=\"103.3\" y1=\"53.0\" x2=\"106.0\" y2=\"57.1\"/><line class=\"r-tick\" x1=\"125.6\" y1=\"40.5\" x2=\"127.7\" y2=\"45.0\"/><line class=\"r-tick h\" x1=\"149.5\" y1=\"31.4\" x2=\"152.4\" y2=\"41.0\"/><text class=\"r-siffra\" x=\"145.2\" y=\"17.0\">12</text><line class=\"r-tick\" x1=\"174.5\" y1=\"25.9\" x2=\"175.2\" y2=\"30.8\"/><line class=\"r-tick\" x1=\"200.0\" y1=\"24.0\" x2=\"200.0\" y2=\"29.0\"/><line class=\"r-tick\" x1=\"225.5\" y1=\"25.9\" x2=\"224.8\" y2=\"30.8\"/><line class=\"r-tick h\" x1=\"250.5\" y1=\"31.4\" x2=\"247.6\" y2=\"41.0\"/><text class=\"r-siffra\" x=\"254.8\" y=\"17.0\">13</text><line class=\"r-tick\" x1=\"274.4\" y1=\"40.5\" x2=\"272.3\" y2=\"45.0\"/><line class=\"r-tick\" x1=\"296.7\" y1=\"53.0\" x2=\"294.0\" y2=\"57.1\"/><line class=\"r-tick\" x1=\"317.0\" y1=\"68.5\" x2=\"313.7\" y2=\"72.3\"/><line class=\"r-tick h\" x1=\"334.8\" y1=\"86.9\" x2=\"327.2\" y2=\"93.3\"/><text class=\"r-siffra\" x=\"346.3\" y=\"77.2\">14</text><line class=\"r-tick\" x1=\"349.8\" y1=\"107.6\" x2=\"345.5\" y2=\"110.2\"/><line class=\"r-tick\" x1=\"361.6\" y1=\"130.3\" x2=\"357.0\" y2=\"132.3\"/><line class=\"r-tick\" x1=\"370.0\" y1=\"154.4\" x2=\"365.2\" y2=\"155.7\"/><line class=\"r-tick h\" x1=\"374.8\" y1=\"179.6\" x2=\"364.9\" y2=\"180.7\"/><text class=\"r-siffra\" x=\"389.7\" y=\"177.8\">15</text><line class=\"r-tick\" x1=\"375.9\" y1=\"205.1\" x2=\"370.9\" y2=\"205.0\"/><line class=\"r-tick\" x1=\"373.3\" y1=\"230.6\" x2=\"368.4\" y2=\"229.7\"/><line class=\"r-tick\" x1=\"367.1\" y1=\"255.4\" x2=\"362.3\" y2=\"253.8\"/><line class=\"r-tick h\" x1=\"357.3\" y1=\"279.0\" x2=\"348.3\" y2=\"274.5\"/><text class=\"r-siffra\" x=\"370.7\" y=\"285.7\">16</text><line class=\"r-tick\" x1=\"344.2\" y1=\"300.9\" x2=\"340.1\" y2=\"298.1\"/><line class=\"r-tick\" x1=\"328.0\" y1=\"320.8\" x2=\"324.4\" y2=\"317.3\"/><line class=\"r-tick\" x1=\"309.2\" y1=\"338.1\" x2=\"306.1\" y2=\"334.1\"/><line class=\"r-tick h\" x1=\"288.0\" y1=\"352.4\" x2=\"283.0\" y2=\"343.8\"/><text class=\"r-siffra ande\" x=\"295.5\" y=\"365.4\">17</text><path class=\"r-band\" d=\"M125.0 329.9A150 150 0 1 1 275.0 329.9\"/><path class=\"r-gatt\" d=\"M125.0 329.9A150 150 0 0 1 62.3 140.6\"/><path class=\"m r-mote\" data-m=\"k1\" style=\"--i:0\" d=\"M86.1 102.4A150 150 0 0 1 116.3 75.5\"/><path class=\"m r-mote\" data-m=\"k2\" style=\"--i:1\" d=\"M315.9 104.8A150 150 0 0 1 337.1 139.1\"/><line class=\"m r-frist\" data-m=\"upg-9\" style=\"--i:2\" x1=\"315.2\" y1=\"186.5\" x2=\"336.1\" y2=\"184.1\"/><circle class=\"m r-order\" data-m=\"o1\" style=\"--i:3\" cx=\"28.7\" cy=\"159.4\" r=\"4.5\"/><g class=\"r-vis\" data-vis=\"stor\" data-vinkel=\"-66.7\" style=\"transform:rotate(-66.7deg)\"><line x1=\"200\" y1=\"98\" x2=\"200\" y2=\"14\"/><circle cx=\"200\" cy=\"14\" r=\"3.2\"/></g></svg><button class=\"hv-pin brinn\" style=\"left:21.1%;top:37.5%\" data-m=\"brinn\" data-hvark=\"vantar\" aria-label=\"Två saker brinner nu. Öppna Väntar på dig\"><span data-roll=\"brinn-stor\">2</span><span class=\"hv-tip\">Två saker brinner nu<small>Öppna Väntar på dig</small></span></button><button class=\"hv-pin\" style=\"left:25.1%;top:22.0%\" data-m=\"k1\" data-hvark=\"dag\" aria-label=\"11.00–11.30 · PEGU Byggservice. Öppna Min dag\"><span class=\"hv-tip\">11.00–11.30 · PEGU Byggservice<small>Öppna Min dag</small></span></button><button class=\"hv-pin\" style=\"left:81.9%;top:30.3%\" data-m=\"k2\" data-hvark=\"dag\" aria-label=\"14.00–14.30 · Veckomöte. Öppna Min dag\"><span class=\"hv-tip\">14.00–14.30 · Veckomöte<small>Öppna Min dag</small></span></button><button class=\"hv-pin\" style=\"left:81.3%;top:46.3%\" data-m=\"upg-9\" data-hvark=\"dag\" aria-label=\"Frist 15.00 · Skicka offert till Solbacken. 15 min · Öppna Min dag\"><span class=\"hv-tip\">Frist 15.00 · Skicka offert till Solbacken<small>15 min · Öppna Min dag</small></span></button><button class=\"hv-pin\" style=\"left:7.2%;top:39.9%\" data-m=\"o1\" data-hvark=\"golvet\" aria-label=\"10.12 · Mick Prov signerade Hagmans Rör. Stor, 36 månader · Öppna Golvet\"><span class=\"hv-tip\">10.12 · Mick Prov signerade Hagmans Rör<small>Stor, 36 månader · Öppna Golvet</small></span></button><button class=\"hv-mitt\" data-hvark=\"dag\" data-m=\"k1\" aria-label=\"11.00 PEGU Byggservice. Öppna Min dag\"><span class=\"l\">Nästa</span><span class=\"k num\" data-roll=\"mitt-k-stor\">11.00</span><span class=\"v\">PEGU Byggservice</span><span class=\"s\" data-roll=\"mitt-s-stor\">om 30 min</span></button></div>",
 "C_ur": "<div class=\"hv-ins stor\" data-flip=\"ur\" role=\"group\" aria-label=\"Urtavlan visar i morgon\"><svg viewBox=\"0 0 400 400\" aria-hidden=\"true\"><path class=\"r-ring\" d=\"M112.0 352.4A176 176 0 1 1 288.0 352.4\"/><line class=\"r-tick h\" x1=\"112.0\" y1=\"352.4\" x2=\"117.0\" y2=\"343.8\"/><text class=\"r-siffra ande\" x=\"104.5\" y=\"365.4\">08</text><line class=\"r-tick\" x1=\"90.8\" y1=\"338.1\" x2=\"93.9\" y2=\"334.1\"/><line class=\"r-tick\" x1=\"72.0\" y1=\"320.8\" x2=\"75.6\" y2=\"317.3\"/><line class=\"r-tick\" x1=\"55.8\" y1=\"300.9\" x2=\"59.9\" y2=\"298.1\"/><line class=\"r-tick h\" x1=\"42.7\" y1=\"279.0\" x2=\"51.7\" y2=\"274.5\"/><text class=\"r-siffra\" x=\"29.3\" y=\"285.7\">09</text><line class=\"r-tick\" x1=\"32.9\" y1=\"255.4\" x2=\"37.7\" y2=\"253.8\"/><line class=\"r-tick\" x1=\"26.7\" y1=\"230.6\" x2=\"31.6\" y2=\"229.7\"/><line class=\"r-tick\" x1=\"24.1\" y1=\"205.1\" x2=\"29.1\" y2=\"205.0\"/><line class=\"r-tick h\" x1=\"25.2\" y1=\"179.6\" x2=\"35.1\" y2=\"180.7\"/><text class=\"r-siffra\" x=\"10.3\" y=\"177.8\">10</text><line class=\"r-tick\" x1=\"30.0\" y1=\"154.4\" x2=\"34.8\" y2=\"155.7\"/><line class=\"r-tick\" x1=\"38.4\" y1=\"130.3\" x2=\"43.0\" y2=\"132.3\"/><line class=\"r-tick\" x1=\"50.2\" y1=\"107.6\" x2=\"54.5\" y2=\"110.2\"/><line class=\"r-tick h\" x1=\"65.2\" y1=\"86.9\" x2=\"72.8\" y2=\"93.3\"/><text class=\"r-siffra\" x=\"53.7\" y=\"77.2\">11</text><line class=\"r-tick\" x1=\"83.0\" y1=\"68.5\" x2=\"86.3\" y2=\"72.3\"/><line class=\"r-tick\" x1=\"103.3\" y1=\"53.0\" x2=\"106.0\" y2=\"57.1\"/><line class=\"r-tick\" x1=\"125.6\" y1=\"40.5\" x2=\"127.7\" y2=\"45.0\"/><line class=\"r-tick h\" x1=\"149.5\" y1=\"31.4\" x2=\"152.4\" y2=\"41.0\"/><text class=\"r-siffra\" x=\"145.2\" y=\"17.0\">12</text><line class=\"r-tick\" x1=\"174.5\" y1=\"25.9\" x2=\"175.2\" y2=\"30.8\"/><line class=\"r-tick\" x1=\"200.0\" y1=\"24.0\" x2=\"200.0\" y2=\"29.0\"/><line class=\"r-tick\" x1=\"225.5\" y1=\"25.9\" x2=\"224.8\" y2=\"30.8\"/><line class=\"r-tick h\" x1=\"250.5\" y1=\"31.4\" x2=\"247.6\" y2=\"41.0\"/><text class=\"r-siffra\" x=\"254.8\" y=\"17.0\">13</text><line class=\"r-tick\" x1=\"274.4\" y1=\"40.5\" x2=\"272.3\" y2=\"45.0\"/><line class=\"r-tick\" x1=\"296.7\" y1=\"53.0\" x2=\"294.0\" y2=\"57.1\"/><line class=\"r-tick\" x1=\"317.0\" y1=\"68.5\" x2=\"313.7\" y2=\"72.3\"/><line class=\"r-tick h\" x1=\"334.8\" y1=\"86.9\" x2=\"327.2\" y2=\"93.3\"/><text class=\"r-siffra\" x=\"346.3\" y=\"77.2\">14</text><line class=\"r-tick\" x1=\"349.8\" y1=\"107.6\" x2=\"345.5\" y2=\"110.2\"/><line class=\"r-tick\" x1=\"361.6\" y1=\"130.3\" x2=\"357.0\" y2=\"132.3\"/><line class=\"r-tick\" x1=\"370.0\" y1=\"154.4\" x2=\"365.2\" y2=\"155.7\"/><line class=\"r-tick h\" x1=\"374.8\" y1=\"179.6\" x2=\"364.9\" y2=\"180.7\"/><text class=\"r-siffra\" x=\"389.7\" y=\"177.8\">15</text><line class=\"r-tick\" x1=\"375.9\" y1=\"205.1\" x2=\"370.9\" y2=\"205.0\"/><line class=\"r-tick\" x1=\"373.3\" y1=\"230.6\" x2=\"368.4\" y2=\"229.7\"/><line class=\"r-tick\" x1=\"367.1\" y1=\"255.4\" x2=\"362.3\" y2=\"253.8\"/><line class=\"r-tick h\" x1=\"357.3\" y1=\"279.0\" x2=\"348.3\" y2=\"274.5\"/><text class=\"r-siffra\" x=\"370.7\" y=\"285.7\">16</text><line class=\"r-tick\" x1=\"344.2\" y1=\"300.9\" x2=\"340.1\" y2=\"298.1\"/><line class=\"r-tick\" x1=\"328.0\" y1=\"320.8\" x2=\"324.4\" y2=\"317.3\"/><line class=\"r-tick\" x1=\"309.2\" y1=\"338.1\" x2=\"306.1\" y2=\"334.1\"/><line class=\"r-tick h\" x1=\"288.0\" y1=\"352.4\" x2=\"283.0\" y2=\"343.8\"/><text class=\"r-siffra ande\" x=\"295.5\" y=\"365.4\">17</text><path class=\"r-band\" d=\"M125.0 329.9A150 150 0 1 1 275.0 329.9\"/><path class=\"m r-mote\" data-m=\"k3\" style=\"--i:0\" d=\"M65.3 265.9A150 150 0 0 1 52.6 227.6\"/></svg><button class=\"hv-pin\" style=\"left:14.4%;top:61.8%\" data-m=\"k3\" data-hvark=\"vecka\" aria-label=\"09.00–09.30 · Morgonmöte Team Nord. I morgon · Öppna Veckan\"><span class=\"hv-tip\">09.00–09.30 · Morgonmöte Team Nord<small>I morgon · Öppna Veckan</small></span></button><button class=\"hv-mitt\" data-hvark=\"vecka\" aria-label=\"I morgon: första mötet 09.00 med Morgonmöte Team Nord. Öppna Veckan som kommer\"><span class=\"l\">I morgon</span><span class=\"k num\" data-roll=\"mitt-k-stor\">09.00</span><span class=\"v\">Morgonmöte Team Nord</span><span class=\"s\" data-roll=\"mitt-s-stor\">Ett möte</span></button></div>",
 "C_heroP": "<p class=\"an\" style=\"--i:1\"><button class=\"hv-herok\" data-hvark=\"vantar\"><b data-roll=\"lage\">Två saker brinner.</b></button> I morgon börjar du 09.00 med Morgonmöte Team Nord.",
 "E_ur": "<div class=\"hv-ins stor\" data-flip=\"ur\" role=\"group\" aria-label=\"Dagen utan schema, klockan 15.30. Inga möten kvar, två saker brinner\"><svg viewBox=\"0 0 400 400\" aria-hidden=\"true\"><path class=\"r-ring\" d=\"M112.0 352.4A176 176 0 1 1 288.0 352.4\"/><line class=\"r-tick h\" x1=\"112.0\" y1=\"352.4\" x2=\"117.0\" y2=\"343.8\"/><text class=\"r-siffra ande\" x=\"104.5\" y=\"365.4\">08</text><line class=\"r-tick\" x1=\"90.8\" y1=\"338.1\" x2=\"93.9\" y2=\"334.1\"/><line class=\"r-tick\" x1=\"72.0\" y1=\"320.8\" x2=\"75.6\" y2=\"317.3\"/><line class=\"r-tick\" x1=\"55.8\" y1=\"300.9\" x2=\"59.9\" y2=\"298.1\"/><line class=\"r-tick h\" x1=\"42.7\" y1=\"279.0\" x2=\"51.7\" y2=\"274.5\"/><text class=\"r-siffra\" x=\"29.3\" y=\"285.7\">09</text><line class=\"r-tick\" x1=\"32.9\" y1=\"255.4\" x2=\"37.7\" y2=\"253.8\"/><line class=\"r-tick\" x1=\"26.7\" y1=\"230.6\" x2=\"31.6\" y2=\"229.7\"/><line class=\"r-tick\" x1=\"24.1\" y1=\"205.1\" x2=\"29.1\" y2=\"205.0\"/><line class=\"r-tick h\" x1=\"25.2\" y1=\"179.6\" x2=\"35.1\" y2=\"180.7\"/><text class=\"r-siffra\" x=\"10.3\" y=\"177.8\">10</text><line class=\"r-tick\" x1=\"30.0\" y1=\"154.4\" x2=\"34.8\" y2=\"155.7\"/><line class=\"r-tick\" x1=\"38.4\" y1=\"130.3\" x2=\"43.0\" y2=\"132.3\"/><line class=\"r-tick\" x1=\"50.2\" y1=\"107.6\" x2=\"54.5\" y2=\"110.2\"/><line class=\"r-tick h\" x1=\"65.2\" y1=\"86.9\" x2=\"72.8\" y2=\"93.3\"/><text class=\"r-siffra\" x=\"53.7\" y=\"77.2\">11</text><line class=\"r-tick\" x1=\"83.0\" y1=\"68.5\" x2=\"86.3\" y2=\"72.3\"/><line class=\"r-tick\" x1=\"103.3\" y1=\"53.0\" x2=\"106.0\" y2=\"57.1\"/><line class=\"r-tick\" x1=\"125.6\" y1=\"40.5\" x2=\"127.7\" y2=\"45.0\"/><line class=\"r-tick h\" x1=\"149.5\" y1=\"31.4\" x2=\"152.4\" y2=\"41.0\"/><text class=\"r-siffra\" x=\"145.2\" y=\"17.0\">12</text><line class=\"r-tick\" x1=\"174.5\" y1=\"25.9\" x2=\"175.2\" y2=\"30.8\"/><line class=\"r-tick\" x1=\"200.0\" y1=\"24.0\" x2=\"200.0\" y2=\"29.0\"/><line class=\"r-tick\" x1=\"225.5\" y1=\"25.9\" x2=\"224.8\" y2=\"30.8\"/><line class=\"r-tick h\" x1=\"250.5\" y1=\"31.4\" x2=\"247.6\" y2=\"41.0\"/><text class=\"r-siffra\" x=\"254.8\" y=\"17.0\">13</text><line class=\"r-tick\" x1=\"274.4\" y1=\"40.5\" x2=\"272.3\" y2=\"45.0\"/><line class=\"r-tick\" x1=\"296.7\" y1=\"53.0\" x2=\"294.0\" y2=\"57.1\"/><line class=\"r-tick\" x1=\"317.0\" y1=\"68.5\" x2=\"313.7\" y2=\"72.3\"/><line class=\"r-tick h\" x1=\"334.8\" y1=\"86.9\" x2=\"327.2\" y2=\"93.3\"/><text class=\"r-siffra\" x=\"346.3\" y=\"77.2\">14</text><line class=\"r-tick\" x1=\"349.8\" y1=\"107.6\" x2=\"345.5\" y2=\"110.2\"/><line class=\"r-tick\" x1=\"361.6\" y1=\"130.3\" x2=\"357.0\" y2=\"132.3\"/><line class=\"r-tick\" x1=\"370.0\" y1=\"154.4\" x2=\"365.2\" y2=\"155.7\"/><line class=\"r-tick h\" x1=\"374.8\" y1=\"179.6\" x2=\"364.9\" y2=\"180.7\"/><text class=\"r-siffra\" x=\"389.7\" y=\"177.8\">15</text><line class=\"r-tick\" x1=\"375.9\" y1=\"205.1\" x2=\"370.9\" y2=\"205.0\"/><line class=\"r-tick\" x1=\"373.3\" y1=\"230.6\" x2=\"368.4\" y2=\"229.7\"/><line class=\"r-tick\" x1=\"367.1\" y1=\"255.4\" x2=\"362.3\" y2=\"253.8\"/><line class=\"r-tick h\" x1=\"357.3\" y1=\"279.0\" x2=\"348.3\" y2=\"274.5\"/><text class=\"r-siffra\" x=\"370.7\" y=\"285.7\">16</text><line class=\"r-tick\" x1=\"344.2\" y1=\"300.9\" x2=\"340.1\" y2=\"298.1\"/><line class=\"r-tick\" x1=\"328.0\" y1=\"320.8\" x2=\"324.4\" y2=\"317.3\"/><line class=\"r-tick\" x1=\"309.2\" y1=\"338.1\" x2=\"306.1\" y2=\"334.1\"/><line class=\"r-tick h\" x1=\"288.0\" y1=\"352.4\" x2=\"283.0\" y2=\"343.8\"/><text class=\"r-siffra ande\" x=\"295.5\" y=\"365.4\">17</text><path class=\"r-band\" d=\"M125.0 329.9A150 150 0 1 1 275.0 329.9\"/><path class=\"r-gatt\" d=\"M125.0 329.9A150 150 0 1 1 347.7 226.0\"/><path class=\"m r-mote forbi\" data-m=\"k1\" style=\"--i:0\" d=\"M86.1 102.4A150 150 0 0 1 116.3 75.5\"/><path class=\"m r-mote forbi\" data-m=\"k2\" style=\"--i:1\" d=\"M315.9 104.8A150 150 0 0 1 337.1 139.1\"/><circle class=\"m r-order\" data-m=\"o1\" style=\"--i:2\" cx=\"28.7\" cy=\"159.4\" r=\"4.5\"/><circle class=\"m r-order\" data-m=\"o2\" style=\"--i:3\" cx=\"118.0\" cy=\"44.3\" r=\"4.5\"/><g class=\"r-vis\" data-vis=\"stor\" data-vinkel=\"100.0\" style=\"transform:rotate(100.0deg)\"><line x1=\"200\" y1=\"98\" x2=\"200\" y2=\"14\"/><circle cx=\"200\" cy=\"14\" r=\"3.2\"/></g></svg><button class=\"hv-pin brinn\" style=\"left:81.0%;top:55.5%\" data-m=\"brinn\" data-hvark=\"vantar\" aria-label=\"Två saker brinner nu. Öppna Väntar på dig\"><span data-roll=\"brinn-stor\">2</span><span class=\"hv-tip\">Två saker brinner nu<small>Öppna Väntar på dig</small></span></button><button class=\"hv-pin\" style=\"left:25.1%;top:22.0%\" data-m=\"k1\" data-hvark=\"dag\" aria-label=\"11.00–11.30 · PEGU Byggservice. Har varit · Öppna Min dag\"><span class=\"hv-tip\">11.00–11.30 · PEGU Byggservice<small>Har varit · Öppna Min dag</small></span></button><button class=\"hv-pin\" style=\"left:81.9%;top:30.3%\" data-m=\"k2\" data-hvark=\"dag\" aria-label=\"14.00–14.30 · Veckomöte. Har varit · Öppna Min dag\"><span class=\"hv-tip\">14.00–14.30 · Veckomöte<small>Har varit · Öppna Min dag</small></span></button><button class=\"hv-pin\" style=\"left:7.2%;top:39.9%\" data-m=\"o1\" data-hvark=\"golvet\" aria-label=\"10.12 · Mick Prov signerade Hagmans Rör. Stor, 36 månader · Öppna Golvet\"><span class=\"hv-tip\">10.12 · Mick Prov signerade Hagmans Rör<small>Stor, 36 månader · Öppna Golvet</small></span></button><button class=\"hv-pin\" style=\"left:29.5%;top:11.1%\" data-m=\"o2\" data-hvark=\"golvet\" aria-label=\"11.40 · Edvin Prov signerade Åkes Bygg. Mellan, 36 månader · Öppna Golvet\"><span class=\"hv-tip\">11.40 · Edvin Prov signerade Åkes Bygg<small>Mellan, 36 månader · Öppna Golvet</small></span></button><button class=\"hv-mitt\" data-hvark=\"dag\" aria-label=\"Öppna Min dag\"><span class=\"l\">Klockan</span><span class=\"k num\" data-roll=\"mitt-k-stor\">15.30</span><span class=\"v\">Inga fler möten i dag</span></button></div>",
 "E2_ur": "<div class=\"hv-ins stor\" data-flip=\"ur\" role=\"group\" aria-label=\"Dagen 08.00 till 17.00, klockan 15.30. Inga möten kvar, två saker brinner\"><svg viewBox=\"0 0 400 400\" aria-hidden=\"true\"><path class=\"r-ring\" d=\"M112.0 352.4A176 176 0 1 1 288.0 352.4\"/><line class=\"r-tick h\" x1=\"112.0\" y1=\"352.4\" x2=\"117.0\" y2=\"343.8\"/><text class=\"r-siffra ande\" x=\"104.5\" y=\"365.4\">08</text><line class=\"r-tick\" x1=\"90.8\" y1=\"338.1\" x2=\"93.9\" y2=\"334.1\"/><line class=\"r-tick\" x1=\"72.0\" y1=\"320.8\" x2=\"75.6\" y2=\"317.3\"/><line class=\"r-tick\" x1=\"55.8\" y1=\"300.9\" x2=\"59.9\" y2=\"298.1\"/><line class=\"r-tick h\" x1=\"42.7\" y1=\"279.0\" x2=\"51.7\" y2=\"274.5\"/><text class=\"r-siffra\" x=\"29.3\" y=\"285.7\">09</text><line class=\"r-tick\" x1=\"32.9\" y1=\"255.4\" x2=\"37.7\" y2=\"253.8\"/><line class=\"r-tick\" x1=\"26.7\" y1=\"230.6\" x2=\"31.6\" y2=\"229.7\"/><line class=\"r-tick\" x1=\"24.1\" y1=\"205.1\" x2=\"29.1\" y2=\"205.0\"/><line class=\"r-tick h\" x1=\"25.2\" y1=\"179.6\" x2=\"35.1\" y2=\"180.7\"/><text class=\"r-siffra\" x=\"10.3\" y=\"177.8\">10</text><line class=\"r-tick\" x1=\"30.0\" y1=\"154.4\" x2=\"34.8\" y2=\"155.7\"/><line class=\"r-tick\" x1=\"38.4\" y1=\"130.3\" x2=\"43.0\" y2=\"132.3\"/><line class=\"r-tick\" x1=\"50.2\" y1=\"107.6\" x2=\"54.5\" y2=\"110.2\"/><line class=\"r-tick h\" x1=\"65.2\" y1=\"86.9\" x2=\"72.8\" y2=\"93.3\"/><text class=\"r-siffra\" x=\"53.7\" y=\"77.2\">11</text><line class=\"r-tick\" x1=\"83.0\" y1=\"68.5\" x2=\"86.3\" y2=\"72.3\"/><line class=\"r-tick\" x1=\"103.3\" y1=\"53.0\" x2=\"106.0\" y2=\"57.1\"/><line class=\"r-tick\" x1=\"125.6\" y1=\"40.5\" x2=\"127.7\" y2=\"45.0\"/><line class=\"r-tick h\" x1=\"149.5\" y1=\"31.4\" x2=\"152.4\" y2=\"41.0\"/><text class=\"r-siffra\" x=\"145.2\" y=\"17.0\">12</text><line class=\"r-tick\" x1=\"174.5\" y1=\"25.9\" x2=\"175.2\" y2=\"30.8\"/><line class=\"r-tick\" x1=\"200.0\" y1=\"24.0\" x2=\"200.0\" y2=\"29.0\"/><line class=\"r-tick\" x1=\"225.5\" y1=\"25.9\" x2=\"224.8\" y2=\"30.8\"/><line class=\"r-tick h\" x1=\"250.5\" y1=\"31.4\" x2=\"247.6\" y2=\"41.0\"/><text class=\"r-siffra\" x=\"254.8\" y=\"17.0\">13</text><line class=\"r-tick\" x1=\"274.4\" y1=\"40.5\" x2=\"272.3\" y2=\"45.0\"/><line class=\"r-tick\" x1=\"296.7\" y1=\"53.0\" x2=\"294.0\" y2=\"57.1\"/><line class=\"r-tick\" x1=\"317.0\" y1=\"68.5\" x2=\"313.7\" y2=\"72.3\"/><line class=\"r-tick h\" x1=\"334.8\" y1=\"86.9\" x2=\"327.2\" y2=\"93.3\"/><text class=\"r-siffra\" x=\"346.3\" y=\"77.2\">14</text><line class=\"r-tick\" x1=\"349.8\" y1=\"107.6\" x2=\"345.5\" y2=\"110.2\"/><line class=\"r-tick\" x1=\"361.6\" y1=\"130.3\" x2=\"357.0\" y2=\"132.3\"/><line class=\"r-tick\" x1=\"370.0\" y1=\"154.4\" x2=\"365.2\" y2=\"155.7\"/><line class=\"r-tick h\" x1=\"374.8\" y1=\"179.6\" x2=\"364.9\" y2=\"180.7\"/><text class=\"r-siffra\" x=\"389.7\" y=\"177.8\">15</text><line class=\"r-tick\" x1=\"375.9\" y1=\"205.1\" x2=\"370.9\" y2=\"205.0\"/><line class=\"r-tick\" x1=\"373.3\" y1=\"230.6\" x2=\"368.4\" y2=\"229.7\"/><line class=\"r-tick\" x1=\"367.1\" y1=\"255.4\" x2=\"362.3\" y2=\"253.8\"/><line class=\"r-tick h\" x1=\"357.3\" y1=\"279.0\" x2=\"348.3\" y2=\"274.5\"/><text class=\"r-siffra\" x=\"370.7\" y=\"285.7\">16</text><line class=\"r-tick\" x1=\"344.2\" y1=\"300.9\" x2=\"340.1\" y2=\"298.1\"/><line class=\"r-tick\" x1=\"328.0\" y1=\"320.8\" x2=\"324.4\" y2=\"317.3\"/><line class=\"r-tick\" x1=\"309.2\" y1=\"338.1\" x2=\"306.1\" y2=\"334.1\"/><line class=\"r-tick h\" x1=\"288.0\" y1=\"352.4\" x2=\"283.0\" y2=\"343.8\"/><text class=\"r-siffra ande\" x=\"295.5\" y=\"365.4\">17</text><path class=\"r-band\" d=\"M125.0 329.9A150 150 0 1 1 275.0 329.9\"/><path class=\"r-gatt\" d=\"M125.0 329.9A150 150 0 1 1 347.7 226.0\"/><path class=\"m r-mote forbi\" data-m=\"k1\" style=\"--i:0\" d=\"M86.1 102.4A150 150 0 0 1 116.3 75.5\"/><path class=\"m r-mote forbi\" data-m=\"k2\" style=\"--i:1\" d=\"M315.9 104.8A150 150 0 0 1 337.1 139.1\"/><circle class=\"m r-order\" data-m=\"o1\" style=\"--i:2\" cx=\"28.7\" cy=\"159.4\" r=\"4.5\"/><circle class=\"m r-order\" data-m=\"o2\" style=\"--i:3\" cx=\"118.0\" cy=\"44.3\" r=\"4.5\"/><g class=\"r-vis\" data-vis=\"stor\" data-vinkel=\"100.0\" style=\"transform:rotate(100.0deg)\"><line x1=\"200\" y1=\"98\" x2=\"200\" y2=\"14\"/><circle cx=\"200\" cy=\"14\" r=\"3.2\"/></g></svg><button class=\"hv-pin brinn\" style=\"left:81.0%;top:55.5%\" data-m=\"brinn\" data-hvark=\"vantar\" aria-label=\"Två saker brinner nu. Öppna Väntar på dig\"><span data-roll=\"brinn-stor\">2</span><span class=\"hv-tip\">Två saker brinner nu<small>Öppna Väntar på dig</small></span></button><button class=\"hv-pin\" style=\"left:25.1%;top:22.0%\" data-m=\"k1\" data-hvark=\"dag\" aria-label=\"11.00–11.30 · PEGU Byggservice. Har varit · Öppna Min dag\"><span class=\"hv-tip\">11.00–11.30 · PEGU Byggservice<small>Har varit · Öppna Min dag</small></span></button><button class=\"hv-pin\" style=\"left:81.9%;top:30.3%\" data-m=\"k2\" data-hvark=\"dag\" aria-label=\"14.00–14.30 · Veckomöte. Har varit · Öppna Min dag\"><span class=\"hv-tip\">14.00–14.30 · Veckomöte<small>Har varit · Öppna Min dag</small></span></button><button class=\"hv-pin\" style=\"left:7.2%;top:39.9%\" data-m=\"o1\" data-hvark=\"golvet\" aria-label=\"10.12 · Mick Prov signerade Hagmans Rör. Stor, 36 månader · Öppna Golvet\"><span class=\"hv-tip\">10.12 · Mick Prov signerade Hagmans Rör<small>Stor, 36 månader · Öppna Golvet</small></span></button><button class=\"hv-pin\" style=\"left:29.5%;top:11.1%\" data-m=\"o2\" data-hvark=\"golvet\" aria-label=\"11.40 · Edvin Prov signerade Åkes Bygg. Mellan, 36 månader · Öppna Golvet\"><span class=\"hv-tip\">11.40 · Edvin Prov signerade Åkes Bygg<small>Mellan, 36 månader · Öppna Golvet</small></span></button><button class=\"hv-mitt\" data-hvark=\"dag\" aria-label=\"Öppna Min dag\"><span class=\"l\">Inga fler möten</span><span class=\"k num\" data-roll=\"mitt-k-stor\">17.00</span><span class=\"v\">Arbetsdagen slutar</span><span class=\"s\" data-roll=\"mitt-s-stor\">1 h 30 min kvar</span></button></div>",
 "F_ur": "<div class=\"hv-ins stor\" data-flip=\"ur\" role=\"group\" aria-label=\"Dagen utan schema, klockan 08.00. Inga möten kvar, två saker brinner\"><svg viewBox=\"0 0 400 400\" aria-hidden=\"true\"><path class=\"r-ring\" d=\"M112.0 352.4A176 176 0 1 1 288.0 352.4\"/><line class=\"r-tick h\" x1=\"112.0\" y1=\"352.4\" x2=\"117.0\" y2=\"343.8\"/><text class=\"r-siffra ande\" x=\"104.5\" y=\"365.4\">08</text><line class=\"r-tick\" x1=\"90.8\" y1=\"338.1\" x2=\"93.9\" y2=\"334.1\"/><line class=\"r-tick\" x1=\"72.0\" y1=\"320.8\" x2=\"75.6\" y2=\"317.3\"/><line class=\"r-tick\" x1=\"55.8\" y1=\"300.9\" x2=\"59.9\" y2=\"298.1\"/><line class=\"r-tick h\" x1=\"42.7\" y1=\"279.0\" x2=\"51.7\" y2=\"274.5\"/><text class=\"r-siffra\" x=\"29.3\" y=\"285.7\">09</text><line class=\"r-tick\" x1=\"32.9\" y1=\"255.4\" x2=\"37.7\" y2=\"253.8\"/><line class=\"r-tick\" x1=\"26.7\" y1=\"230.6\" x2=\"31.6\" y2=\"229.7\"/><line class=\"r-tick\" x1=\"24.1\" y1=\"205.1\" x2=\"29.1\" y2=\"205.0\"/><line class=\"r-tick h\" x1=\"25.2\" y1=\"179.6\" x2=\"35.1\" y2=\"180.7\"/><text class=\"r-siffra\" x=\"10.3\" y=\"177.8\">10</text><line class=\"r-tick\" x1=\"30.0\" y1=\"154.4\" x2=\"34.8\" y2=\"155.7\"/><line class=\"r-tick\" x1=\"38.4\" y1=\"130.3\" x2=\"43.0\" y2=\"132.3\"/><line class=\"r-tick\" x1=\"50.2\" y1=\"107.6\" x2=\"54.5\" y2=\"110.2\"/><line class=\"r-tick h\" x1=\"65.2\" y1=\"86.9\" x2=\"72.8\" y2=\"93.3\"/><text class=\"r-siffra\" x=\"53.7\" y=\"77.2\">11</text><line class=\"r-tick\" x1=\"83.0\" y1=\"68.5\" x2=\"86.3\" y2=\"72.3\"/><line class=\"r-tick\" x1=\"103.3\" y1=\"53.0\" x2=\"106.0\" y2=\"57.1\"/><line class=\"r-tick\" x1=\"125.6\" y1=\"40.5\" x2=\"127.7\" y2=\"45.0\"/><line class=\"r-tick h\" x1=\"149.5\" y1=\"31.4\" x2=\"152.4\" y2=\"41.0\"/><text class=\"r-siffra\" x=\"145.2\" y=\"17.0\">12</text><line class=\"r-tick\" x1=\"174.5\" y1=\"25.9\" x2=\"175.2\" y2=\"30.8\"/><line class=\"r-tick\" x1=\"200.0\" y1=\"24.0\" x2=\"200.0\" y2=\"29.0\"/><line class=\"r-tick\" x1=\"225.5\" y1=\"25.9\" x2=\"224.8\" y2=\"30.8\"/><line class=\"r-tick h\" x1=\"250.5\" y1=\"31.4\" x2=\"247.6\" y2=\"41.0\"/><text class=\"r-siffra\" x=\"254.8\" y=\"17.0\">13</text><line class=\"r-tick\" x1=\"274.4\" y1=\"40.5\" x2=\"272.3\" y2=\"45.0\"/><line class=\"r-tick\" x1=\"296.7\" y1=\"53.0\" x2=\"294.0\" y2=\"57.1\"/><line class=\"r-tick\" x1=\"317.0\" y1=\"68.5\" x2=\"313.7\" y2=\"72.3\"/><line class=\"r-tick h\" x1=\"334.8\" y1=\"86.9\" x2=\"327.2\" y2=\"93.3\"/><text class=\"r-siffra\" x=\"346.3\" y=\"77.2\">14</text><line class=\"r-tick\" x1=\"349.8\" y1=\"107.6\" x2=\"345.5\" y2=\"110.2\"/><line class=\"r-tick\" x1=\"361.6\" y1=\"130.3\" x2=\"357.0\" y2=\"132.3\"/><line class=\"r-tick\" x1=\"370.0\" y1=\"154.4\" x2=\"365.2\" y2=\"155.7\"/><line class=\"r-tick h\" x1=\"374.8\" y1=\"179.6\" x2=\"364.9\" y2=\"180.7\"/><text class=\"r-siffra\" x=\"389.7\" y=\"177.8\">15</text><line class=\"r-tick\" x1=\"375.9\" y1=\"205.1\" x2=\"370.9\" y2=\"205.0\"/><line class=\"r-tick\" x1=\"373.3\" y1=\"230.6\" x2=\"368.4\" y2=\"229.7\"/><line class=\"r-tick\" x1=\"367.1\" y1=\"255.4\" x2=\"362.3\" y2=\"253.8\"/><line class=\"r-tick h\" x1=\"357.3\" y1=\"279.0\" x2=\"348.3\" y2=\"274.5\"/><text class=\"r-siffra\" x=\"370.7\" y=\"285.7\">16</text><line class=\"r-tick\" x1=\"344.2\" y1=\"300.9\" x2=\"340.1\" y2=\"298.1\"/><line class=\"r-tick\" x1=\"328.0\" y1=\"320.8\" x2=\"324.4\" y2=\"317.3\"/><line class=\"r-tick\" x1=\"309.2\" y1=\"338.1\" x2=\"306.1\" y2=\"334.1\"/><line class=\"r-tick h\" x1=\"288.0\" y1=\"352.4\" x2=\"283.0\" y2=\"343.8\"/><text class=\"r-siffra ande\" x=\"295.5\" y=\"365.4\">17</text><path class=\"r-band\" d=\"M125.0 329.9A150 150 0 1 1 275.0 329.9\"/><g class=\"r-vis\" data-vis=\"stor\" data-vinkel=\"-150.0\" style=\"transform:rotate(-150.0deg)\"><line x1=\"200\" y1=\"98\" x2=\"200\" y2=\"14\"/><circle cx=\"200\" cy=\"14\" r=\"3.2\"/></g></svg><button class=\"hv-pin brinn\" style=\"left:34.3%;top:77.3%\" data-m=\"brinn\" data-hvark=\"vantar\" aria-label=\"Två saker brinner nu. Öppna Väntar på dig\"><span data-roll=\"brinn-stor\">2</span><span class=\"hv-tip\">Två saker brinner nu<small>Öppna Väntar på dig</small></span></button><div class=\"hv-mitt\"><span class=\"l\">Klockan</span><span class=\"k num\">08.00</span><span class=\"s\">Kalendern är inte kopplad</span><button class=\"hv-lank\" data-hvgo=\"Inställningar, Kalender\">Koppla kalendern</button></div></div>",
 "G_dag": "<div class=\"hv-arkhuvud an\" style=\"--i:0\">⟨svg⟩<h2 id=\"hvArktext\">Två möten kvar och två saker som väntar. <b>Allt ryms, med 4 h 24 min över.</b></h2><button class=\"hv-kn\" data-hvstang>Stäng <kbd>esc</kbd></button></div><div class=\"hv-dag\"><div class=\"hv-ins ark\" data-flip=\"ur\" role=\"group\" aria-label=\"Dagen 08.00 till 17.00, klockan 09.41. Två möten kvar, en sak brinner\"><svg viewBox=\"0 0 400 400\" aria-hidden=\"true\"><path class=\"r-ring\" d=\"M112.0 352.4A176 176 0 1 1 288.0 352.4\"/><line class=\"r-tick h\" x1=\"112.0\" y1=\"352.4\" x2=\"117.0\" y2=\"343.8\"/><text class=\"r-siffra ande\" x=\"104.5\" y=\"365.4\">08</text><line class=\"r-tick\" x1=\"90.8\" y1=\"338.1\" x2=\"93.9\" y2=\"334.1\"/><line class=\"r-tick\" x1=\"72.0\" y1=\"320.8\" x2=\"75.6\" y2=\"317.3\"/><line class=\"r-tick\" x1=\"55.8\" y1=\"300.9\" x2=\"59.9\" y2=\"298.1\"/><line class=\"r-tick h\" x1=\"42.7\" y1=\"279.0\" x2=\"51.7\" y2=\"274.5\"/><text class=\"r-siffra\" x=\"29.3\" y=\"285.7\">09</text><line class=\"r-tick\" x1=\"32.9\" y1=\"255.4\" x2=\"37.7\" y2=\"253.8\"/><line class=\"r-tick\" x1=\"26.7\" y1=\"230.6\" x2=\"31.6\" y2=\"229.7\"/><line class=\"r-tick\" x1=\"24.1\" y1=\"205.1\" x2=\"29.1\" y2=\"205.0\"/><line class=\"r-tick h\" x1=\"25.2\" y1=\"179.6\" x2=\"35.1\" y2=\"180.7\"/><text class=\"r-siffra\" x=\"10.3\" y=\"177.8\">10</text><line class=\"r-tick\" x1=\"30.0\" y1=\"154.4\" x2=\"34.8\" y2=\"155.7\"/><line class=\"r-tick\" x1=\"38.4\" y1=\"130.3\" x2=\"43.0\" y2=\"132.3\"/><line class=\"r-tick\" x1=\"50.2\" y1=\"107.6\" x2=\"54.5\" y2=\"110.2\"/><line class=\"r-tick h\" x1=\"65.2\" y1=\"86.9\" x2=\"72.8\" y2=\"93.3\"/><text class=\"r-siffra\" x=\"53.7\" y=\"77.2\">11</text><line class=\"r-tick\" x1=\"83.0\" y1=\"68.5\" x2=\"86.3\" y2=\"72.3\"/><line class=\"r-tick\" x1=\"103.3\" y1=\"53.0\" x2=\"106.0\" y2=\"57.1\"/><line class=\"r-tick\" x1=\"125.6\" y1=\"40.5\" x2=\"127.7\" y2=\"45.0\"/><line class=\"r-tick h\" x1=\"149.5\" y1=\"31.4\" x2=\"152.4\" y2=\"41.0\"/><text class=\"r-siffra\" x=\"145.2\" y=\"17.0\">12</text><line class=\"r-tick\" x1=\"174.5\" y1=\"25.9\" x2=\"175.2\" y2=\"30.8\"/><line class=\"r-tick\" x1=\"200.0\" y1=\"24.0\" x2=\"200.0\" y2=\"29.0\"/><line class=\"r-tick\" x1=\"225.5\" y1=\"25.9\" x2=\"224.8\" y2=\"30.8\"/><line class=\"r-tick h\" x1=\"250.5\" y1=\"31.4\" x2=\"247.6\" y2=\"41.0\"/><text class=\"r-siffra\" x=\"254.8\" y=\"17.0\">13</text><line class=\"r-tick\" x1=\"274.4\" y1=\"40.5\" x2=\"272.3\" y2=\"45.0\"/><line class=\"r-tick\" x1=\"296.7\" y1=\"53.0\" x2=\"294.0\" y2=\"57.1\"/><line class=\"r-tick\" x1=\"317.0\" y1=\"68.5\" x2=\"313.7\" y2=\"72.3\"/><line class=\"r-tick h\" x1=\"334.8\" y1=\"86.9\" x2=\"327.2\" y2=\"93.3\"/><text class=\"r-siffra\" x=\"346.3\" y=\"77.2\">14</text><line class=\"r-tick\" x1=\"349.8\" y1=\"107.6\" x2=\"345.5\" y2=\"110.2\"/><line class=\"r-tick\" x1=\"361.6\" y1=\"130.3\" x2=\"357.0\" y2=\"132.3\"/><line class=\"r-tick\" x1=\"370.0\" y1=\"154.4\" x2=\"365.2\" y2=\"155.7\"/><line class=\"r-tick h\" x1=\"374.8\" y1=\"179.6\" x2=\"364.9\" y2=\"180.7\"/><text class=\"r-siffra\" x=\"389.7\" y=\"177.8\">15</text><line class=\"r-tick\" x1=\"375.9\" y1=\"205.1\" x2=\"370.9\" y2=\"205.0\"/><line class=\"r-tick\" x1=\"373.3\" y1=\"230.6\" x2=\"368.4\" y2=\"229.7\"/><line class=\"r-tick\" x1=\"367.1\" y1=\"255.4\" x2=\"362.3\" y2=\"253.8\"/><line class=\"r-tick h\" x1=\"357.3\" y1=\"279.0\" x2=\"348.3\" y2=\"274.5\"/><text class=\"r-siffra\" x=\"370.7\" y=\"285.7\">16</text><line class=\"r-tick\" x1=\"344.2\" y1=\"300.9\" x2=\"340.1\" y2=\"298.1\"/><line class=\"r-tick\" x1=\"328.0\" y1=\"320.8\" x2=\"324.4\" y2=\"317.3\"/><line class=\"r-tick\" x1=\"309.2\" y1=\"338.1\" x2=\"306.1\" y2=\"334.1\"/><line class=\"r-tick h\" x1=\"288.0\" y1=\"352.4\" x2=\"283.0\" y2=\"343.8\"/><text class=\"r-siffra ande\" x=\"295.5\" y=\"365.4\">17</text><path class=\"r-band\" d=\"M125.0 329.9A150 150 0 1 1 275.0 329.9\"/><path class=\"r-gatt\" d=\"M125.0 329.9A150 150 0 0 1 50.3 210.2\"/><path class=\"m r-mote forbi\" data-m=\"k1\" style=\"--i:0\" d=\"M65.3 265.9A150 150 0 0 1 52.6 227.6\"/><path class=\"m r-mote\" data-m=\"k2\" style=\"--i:1\" d=\"M86.1 102.4A150 150 0 0 1 135.2 64.7\"/><path class=\"m r-mote\" data-m=\"k3\" style=\"--i:2\" d=\"M283.7 75.5A150 150 0 0 1 326.8 119.9\"/><path class=\"m r-upg het\" data-m=\"upg-7\" style=\"--i:3\" d=\"M74.2 206.4A126 126 0 0 1 74.1 204.6\"/><path class=\"m r-upg\" data-m=\"upg-8\" style=\"--i:4\" d=\"M74.0 200.2A126 126 0 0 1 75.6 180.3\"/><g class=\"r-vis\" data-vis=\"ark\" data-vinkel=\"-93.9\" style=\"transform:rotate(-93.9deg)\"><line x1=\"200\" y1=\"98\" x2=\"200\" y2=\"14\"/><circle cx=\"200\" cy=\"14\" r=\"3.2\"/></g></svg><button class=\"hv-pin brinn\" style=\"left:18.6%;top:52.1%\" data-m=\"brinn\" data-hvark=\"vantar\" aria-label=\"En sak brinner nu. Öppna Väntar på dig\"><span data-roll=\"brinn-ark\">1</span><span class=\"hv-tip\">En sak brinner nu<small>Öppna Väntar på dig</small></span></button><button class=\"hv-pin\" style=\"left:14.4%;top:61.8%\" data-m=\"k1\" data-hvark=\"dag\" aria-label=\"09.00–09.30 · Nordic Grön &amp; Mark. Har varit · Öppna Min dag\"><span class=\"hv-tip\">09.00–09.30 · Nordic Grön &amp; Mark<small>Har varit · Öppna Min dag</small></span></button><button class=\"hv-pin\" style=\"left:27.2%;top:20.2%\" data-m=\"k2\" data-hvark=\"dag\" aria-label=\"11.00–11.45 · PEGU Byggservice. Öppna Min dag\"><span class=\"hv-tip\">11.00–11.45 · PEGU Byggservice<small>Öppna Min dag</small></span></button><button class=\"hv-pin\" style=\"left:76.9%;top:23.9%\" data-m=\"k3\" data-hvark=\"dag\" aria-label=\"13.30–14.15 · Veckomöte. Öppna Min dag\"><span class=\"hv-tip\">13.30–14.15 · Veckomöte<small>Öppna Min dag</small></span></button><button class=\"hv-mitt\" data-hvark=\"dag\" data-m=\"k2\" aria-label=\"11.00 PEGU Byggservice. Öppna Min dag\"><span class=\"l\">Nästa</span><span class=\"k num\" data-roll=\"mitt-k-ark\">11.00</span><span class=\"v\">PEGU Byggservice</span><span class=\"s\" data-roll=\"mitt-s-ark\">om 1 h 19 min</span></button></div><div><div class=\"hv-dlista\"><div class=\"hv-drad mote forbi an\" style=\"--i:1\" data-m=\"k1\"><span class=\"hv-kl num\">09.00</span><i class=\"hv-pk\" aria-hidden=\"true\"></i><span class=\"hv-vad\"><b>Nordic Grön &amp; Mark</b><small>09.00–09.30</small></span></div><div class=\"hv-dnu\" aria-label=\"Klockan 09.41\">09.41 nu</div><div class=\"hv-drad upg het an\" style=\"--i:2\" data-m=\"upg-7\"><span class=\"hv-kl num\">09.41</span><i class=\"hv-pk\" aria-hidden=\"true\"></i><span class=\"hv-vad\"><b>Ring Mälarö</b><small>5 min, lagt i en lucka · brinner</small></span><button class=\"hv-btn\" data-hvgor=\"upg-7\">⟨svg⟩Klar</button></div><div class=\"hv-drad upg an\" style=\"--i:3\" data-m=\"upg-8\"><span class=\"hv-kl num\">09.46</span><i class=\"hv-pk\" aria-hidden=\"true\"></i><span class=\"hv-vad\"><b>Skicka offert</b><small>20 min, lagt i en lucka</small></span><button class=\"hv-btn\" data-hvgor=\"upg-8\">⟨svg⟩Klar</button></div><div class=\"hv-drad mote an\" style=\"--i:4\" data-m=\"k2\"><span class=\"hv-kl num\">11.00</span><i class=\"hv-pk\" aria-hidden=\"true\"></i><span class=\"hv-vad\"><b>PEGU Byggservice</b><small>11.00–11.45</small></span><button class=\"hv-btn\" data-hvforbered=\"Förbered mitt möte 11.00 med PEGU Byggservice\">Förbered</button></div><div class=\"hv-drad mote an\" style=\"--i:5\" data-m=\"k3\"><span class=\"hv-kl num\">13.30</span><i class=\"hv-pk\" aria-hidden=\"true\"></i><span class=\"hv-vad\"><b>Veckomöte</b><small>13.30–14.15</small></span></div></div><div class=\"hv-arkfot\" aria-live=\"polite\"><button class=\"hv-lank\" data-hvark=\"vantar\">En sak kan vänta och ligger inte i dag⟨svg⟩</button><span class=\"hv-end\"><button class=\"hv-btn\" data-hvboka>Boka tiden i kalendern</button></span></div></div></div>",
 "I_fors1": "<section class=\"hv-sek hv-fs an\" style=\"--i:4\" aria-label=\"Nav föreslår\" data-flip=\"forslag\">\n    <div class=\"hv-sekh\"><span class=\"hv-mark\">⟨svg⟩</span><h2>Nav föreslår</h2><span class=\"hv-mono hv-end\">Räknat av regler</span></div>\n    <div class=\"hv-fst\"><b class=\"num\">1</b><span>möte i morgon är obekräftat</span></div>\n    <p>Hagby Glas 0 09.00. Mick har ringt två gånger utan svar.</p>\n    <div class=\"hv-rader\"><button class=\"hv-btn fx\" data-hvforslag=\"f0\">Välj vad som händer</button></div>\n  </section>",
 "I_fors0": "<div class=\"hv-andr an\" style=\"--i:4\"><span class=\"hv-mark\">⟨svg⟩</span><span><b>Nav föreslår</b> &nbsp;Inga förslag just nu.</span></div>",
 "I_andrat": "<button class=\"hv-andr an\" style=\"--i:5\" data-hvark=\"andrat\" aria-label=\"Det som ändrats: 4 följs · nästa dom 27 nov. 2 av 52 möten uteblev. Carl ringer före 10. En annan ändring ser sämre ut. Visa översynen\"><span><b>Det som ändrats</b> <span class=\"hv-mono\">&nbsp;4 följs · nästa dom 27 nov</span><br><span class=\"hv-ink\">2 av 52 möten uteblev.</span> Carl ringer före 10. En annan ändring ser sämre ut.</span>⟨svg⟩</button>",
 "I_andrat0": "<button class=\"hv-andr an\" style=\"--i:5\" data-hvark=\"andrat\"><span><b>Det som ändrats</b> &nbsp;Berätta om en ändring</span>⟨svg⟩</button>",
 "I_team": "<section class=\"hv-man an\" style=\"--i:3\" role=\"button\" tabindex=\"0\" data-hvark=\"team\" aria-label=\"Teamet i november: 19 av 46 order, dag 10 av 21, 1 väntar · 1 makulerad. Visa uträkningen\">\n      <div class=\"hv-manh\"><h2>Teamet i november</h2><span class=\"hv-mono\">Räknat av regler</span></div>\n      <div class=\"hv-stor\"><b class=\"num\" data-roll=\"netto\">19</b><span>av 46 order</span><span class=\"hv-mono hv-dagn\">dag 10 av 21</span></div>\n      <div class=\"hv-mat\" role=\"img\" aria-label=\"19 av 46 order. I samma takt ungefär 40.\"><i class=\"nu\" style=\"width:41.3%\"></i><i class=\"takt\" style=\"left:87.0%\"></i></div><p>I samma takt blir det ungefär 40. I oktober sa takten 38, det blev 44.</p>\n      <div class=\"hv-manf\"><span>1 väntar · 1 makulerad</span><span class=\"hv-lank\">Visa uträkningen⟨svg⟩</span></div>\n    </section>",
 "I_team0": "<section class=\"hv-man an\" style=\"--i:3\" role=\"button\" tabindex=\"0\" data-hvark=\"team\" aria-label=\"Teamet i november: 19 order, dag 10 av 21, 1 väntar · 1 makulerad. Visa uträkningen\">\n      <div class=\"hv-manh\"><h2>Teamet i november</h2><span class=\"hv-mono\">Räknat av regler</span></div>\n      <div class=\"hv-stor\"><b class=\"num\" data-roll=\"netto\">19</b><span>order</span><span class=\"hv-mono hv-dagn\">dag 10 av 21</span></div>\n      <p>Inget mål satt för november.</p>\n      <div class=\"hv-manf\"><span>1 väntar · 1 makulerad</span><span class=\"hv-lank\">Visa uträkningen⟨svg⟩</span></div>\n    </section>",
 "I_manad": "<section class=\"hv-man an\" style=\"--i:3\" role=\"button\" tabindex=\"0\" data-hvark=\"manad\" aria-label=\"Din november: 14 500 kr i provision. 1 order väntar på godkännande. 3 order till nästa steg. Visa uträkningen\">\n    <div class=\"hv-manh\"><h2>Din november</h2><span class=\"hv-mono\">Räknat av provisionsmotorn</span></div>\n    <div class=\"hv-stor\"><b class=\"num\">14 500</b><span>kr i provision</span><span class=\"hv-mono hv-dagn\">2 order</span></div>\n    <div class=\"hv-mat steg\" role=\"img\" aria-label=\"2 order av 5 till nästa steg, 1 väntar på godkännande\"><i class=\"pa\"></i><i class=\"pa\"></i><i class=\"vant\"></i><i class=\"\"></i><i class=\"\"></i></div>\n    <p>1 order väntar på godkännande. 3 order till nästa steg.</p>\n    <div class=\"hv-manf\"><span class=\"hv-lank\">Visa uträkningen⟨svg⟩</span></div>\n  </section>",
 "T_topp": "<button class=\"hv-kn\" data-hvstang>⟨svg⟩Hem</button><button class=\"hv-dock\" data-hvark=\"dag\" aria-label=\"Min dag\"><span class=\"hv-ins mini\" data-flip=\"ur\" aria-hidden=\"true\"><svg viewBox=\"0 0 400 400\" aria-hidden=\"true\"><path class=\"r-ring\" d=\"M112.0 352.4A176 176 0 1 1 288.0 352.4\"/><path class=\"r-band\" d=\"M125.0 329.9A150 150 0 1 1 275.0 329.9\"/><path class=\"m r-mote\" data-m=\"k1\" style=\"--i:0\" d=\"M86.1 102.4A150 150 0 0 1 116.3 75.5\"/><path class=\"m r-mote\" data-m=\"k2\" style=\"--i:1\" d=\"M315.9 104.8A150 150 0 0 1 337.1 139.1\"/><g class=\"r-vis\" data-vis=\"mini\" data-vinkel=\"-150.0\" style=\"transform:rotate(-150.0deg)\"><line x1=\"200\" y1=\"52\" x2=\"200\" y2=\"18\"/></g></svg></span><span class=\"s\">Nästa <b class=\"num\">11.00</b> PEGU Byggservice</span></button><button class=\"hv-kn hv-brinn\" data-hvark=\"vantar\"><i></i><span data-roll=\"trad-brinn\">2 brinner</span></button>",
 "T_lugn": "<button class=\"hv-kn hv-brinn lugn\" data-hvark=\"vantar\"><i></i><span data-roll=\"trad-brinn\">Inget brinner</span></button>",
 "halsning": [
  [
   599,
   "God morgon"
  ],
  [
   600,
   "God förmiddag"
  ],
  [
   719,
   "God förmiddag"
  ],
  [
   720,
   "God eftermiddag"
  ],
  [
   1079,
   "God eftermiddag"
  ],
  [
   1080,
   "God kväll"
  ]
 ]
};

rubrik("Chefens hem: tre fält runt urtavlan, inga kort (skiss A v2)");
{
  const g = hem({ chef: true });
  const h = g.hvHem();
  ok("hemmet ritas för den som har det nya hemmet", g.hvPa() === true && /<div class="hv(?: in)?"/.test(h));
  okM("inga kort: hälsningen och Väntar på dig, urtavlan i mitten, läget till höger", !h.includes("hv-card") && /<div class="hv-hem" id="hvHem"><div class="hv-hemin">\s*<div class="hv-nu"><div class="hv-hero">/.test(h) && /<\/section><\/div>\s*<div class="hv-urkol an" style="--i:1"><div class="hv-ins stor" data-flip="ur" role="group"/.test(h) && /<\/div><\/div>\s*<div class="hv-lage"><section class="hv-man an" style="--i:3"/.test(h), h.slice(Math.max(0, h.indexOf("hv-hem")), h.indexOf("hv-hem") + 400));
  okM("Väntar på dig", /<section class="hv-sek an" style="--i:2" aria-label="Väntar på dig">/.test(h));
  okM("Nav föreslår", /<section class="hv-sek hv-fs an" style="--i:4" aria-label="Nav föreslår" data-flip="forslag">/.test(h));
  okM("Teamet i november, inte Din månad", /<section class="hv-man an" style="--i:3" role="button" tabindex="0" data-hvark="team" aria-label="Teamet i november: /.test(h) && !h.includes("Din november"));
  okM("Det som ändrats", /<button class="hv-andr an" style="--i:5" data-hvark="andrat" aria-label="Det som ändrats: /.test(h));
  const lage = h.slice(h.indexOf('<div class="hv-lage">'));
  okM("läget i skissens ordning: månaden, Nav föreslår, Det som ändrats, och inget mer", h.includes('<div class="hv-lage">') && lage.indexOf("hv-man") < lage.indexOf("hv-fs") && lage.indexOf("hv-fs") < lage.indexOf("hv-andr") && /data-hvark="andrat"[\s\S]*?<\/button><\/div>\s*<\/div><\/div>/.test(lage), lage.slice(0, 200));
  okM("hälsningen och en rad om läget", h.includes('<h1 class="an" style="--i:0">God morgon, Zen</h1>') && h.includes(SK.A_heroP), h.match(/<div class="hv-hero">[\s\S]*?<\/p>/)?.[0]);
  okM("överraden: på plats, datum och Stämpla in", /<header class="hv-topp">/.test(h) && h.includes('<b class="num"><span data-roll="pa">1</span><small>/3</small></b><span class="t">på plats</span>') && h.includes('<span class="hv-datum">Måndag 16 november<small>v.47</small></span>') && /<button class="hv-stamp"[^>]*>Stämpla in<\/button>/.test(h), h.match(/<header class="hv-topp">[\s\S]*?<\/header>/)?.[0]);
  ok("Stämpla in bär stämplingens handling", /<button class="hv-stamp"[^>]*data-act="in"[^>]*>Stämpla in<\/button>/.test(h));
  ok("skrivrutan finns, och säger (i rutans titel) att svaren inte kommer från AI", h.includes("data-hvskriv") && /title="Svaren kommer ur Navs sökruta, inte från AI\./.test(h));
  okM("genvägarna Min dag och Veckan som kommer", h.includes('<button class="hv-chip" data-hvark="dag">Min dag</button><button class="hv-chip" data-hvark="vecka">Veckan som kommer</button>'));
  const ng = hem({ chef: true, golvet: null }); ng.S.hv.mer = true;
  ok("utan Golvets data finns ingen väg dit, inte heller i Mer", !ng.hvHem().includes('data-hvark="golvet"') && /role="menuitem"/.test(ng.hvHem()));
}

rubrik("Väntar på dig: samma lista som i dag, det som brinner först");
{
  const g = hem({ chef: true });
  const k = kort(g.hvHem(), "Väntar på dig");
  const titlar = [...k.matchAll(/<button class="hv-radt" data-hvrad="[^"]*" aria-label="[^"]*"><b>([^<]*)<\/b><small>[^<]*<\/small><\/button><button class="hv-btn" data-hvgor=/g)].map((m) => m[1]);
  okM("tre rader som i skissen: det som brinner och det senare i dag, hetast överst", titlar.length === 3 && titlar[0] === "Carl är sjukanmäld" && titlar[1] === "Sätt utfall på 2 möten" && titlar[2] === "Ring tillbaka Mälarö Frakt", titlar.join(" | "));
  okM("avsnittet är skissens, tecken för tecken (ikonerna jämförs som ⟨svg⟩)", utanIkon(k) === SK.A_vantar, utanIkon(k));
  okM("en varm punkt på det som brinner, och bara där", (k.match(/<i class="hv-prk het" aria-hidden="true"><\/i>/g) || []).length === 2 && (k.match(/class="hv-prk/g) || []).length === 3);
  ok("ett klick löser saken: knappen bär radens id", k.includes('data-hvgor="r1"') && k.includes(">Bekräfta</button>"));
  okM("resten ligger ett klick bort", /<div class="hv-mer-rad" data-flip="vantar-fot"><button class="hv-lank" data-hvark="vantar">2 till som kan vänta(?:<svg[^>]*>[\s\S]*?<\/svg>)?<\/button><\/div><\/section>$/.test(k), k.match(/<div class="hv-mer-rad[\s\S]*$/)?.[0]);
  const tom = kort(hem({ chef: true, rader: [] }).hvHem(), "Väntar på dig");
  ok("tomt läge: Inget väntar på dig just nu.", tom.includes("Inget väntar på dig just nu.") && !tom.includes("data-hvgor"), tom);
  okM("tomt läge som skissen: bock, ingen siffra och ingen Hela listan", /^<section class="hv-sek an" style="--i:2" aria-label="Väntar på dig"><div class="hv-sekh"><h2>Väntar på dig<\/h2><span class="hv-n" data-roll="vantar-n"><\/span><\/div><div class="hv-lugn">(?:<svg[^>]*>[\s\S]*?<\/svg>)Inget väntar på dig just nu\.<\/div><\/section>$/.test(tom), tom);
}

rubrik("Nav föreslår: ett tal, en mening, en knapp, och källan i huvudet (skiss A)");
{
  // Källan är en knapp till facit (funktion 5) med skissens text och utseende i vila: markupen jämförs som skissens span.
  const somSkiss = (h) => h.replace(/<button class="hv-mono hv-end" data-hvark="facit" aria-label="[^"]*">([^<]*)<\/button>/g, '<span class="hv-mono hv-end">$1</span>');
  const ett = somSkiss(kort(hem({ chef: false }).hvHem(), "Nav föreslår"));
  okM("ett förslag: avsnittet är skissens, tecken för tecken", utanIkon(ett) === SK.I_fors1, utanIkon(ett));
  okM("förslagets tal och vad det räknar", ett.includes('<div class="hv-fst"><b class="num">1</b><span>möte i morgon är obekräftat</span></div>'), ett);
  okM("en mening och förslagets egen knapp", ett.includes("<p>Hagby Glas 0 09.00. Mick har ringt två gånger utan svar.</p>") && ett.includes('<div class="hv-rader"><button class="hv-btn fx" data-hvforslag="f0">Välj vad som händer</button></div>'), ett);
  okM("Navs märke och källan i huvudet", /<div class="hv-sekh"><span class="hv-mark"><svg[^>]*>[\s\S]*?<\/svg><\/span><h2>Nav föreslår<\/h2><span class="hv-mono hv-end">Räknat av regler<\/span><\/div>/.test(ett), ett);
  ok("ingen bläddring när det bara finns ett", !ett.includes("data-hvnasta") && !ett.includes("1 av 1"));
  const tva = somSkiss(kort(hem({ chef: false, forslag: 2 }).hvHem(), "Nav föreslår"));
  ok("två förslag: 1 av 2 och ett steg som heter Nästa förslag", tva.includes(">1 av 2<") && /data-hvnasta>Nästa förslag</.test(tva) && !/förslag till/.test(tva), tva);
  okM("bläddringen som skissen: talet i huvudet, steget som länk bredvid knappen", tva.includes('<h2>Nav föreslår</h2><span class="hv-n">1 av 2</span><span class="hv-mono hv-end">Räknat av regler</span>') && /<button class="hv-btn fx" data-hvforslag="f0">Välj vad som händer<\/button><button class="hv-lank" data-hvnasta>Nästa förslag(?:<svg[^>]*>[\s\S]*?<\/svg>)?<\/button><\/div>/.test(tva), tva);
  const sist = hem({ chef: false, forslag: 3 }); sist.S.hv.fi = 2;
  const sk = kort(sist.hvHem(), "Nav föreslår");
  ok("på det sista förslaget säger knappen att den går till det första", sk.includes(">3 av 3<") && /data-hvnasta>Till det första</.test(sk), sk);
  // Dag ett (skissens tomläge): inga dömda förslag, så tomraden är ingen dörr till facit (funktion 5).
  const tom = kort(hem({ chef: true, forslag: 0, andrat: [], pa: false, inst: { pa: false, farBrytare: true } }).hvHem(), "Nav föreslår");
  ok("tomt: Inga förslag just nu., inget om avstängt", tom.includes("Inga förslag just nu.") && !/avstängda|trendregeln|avgjorda möten/.test(tom), tom);
  okM("tomt som skissen: en rad med märket, ingen rubrik och ingen knapp", utanIkon(tom) === SK.I_fors0, utanIkon(tom));
}

rubrik("Teamet i månaden");
{
  const k = kort(hem({ chef: true }).hvHem(), "Teamet i november");
  okM("avsnittet är skissens, tecken för tecken", utanIkon(k) === SK.I_team, utanIkon(k));
  okM("det stora talet är det säkra: order av målet, och dagen bredvid", /<b class="num" data-roll="netto">19<\/b><span>av 46 order<\/span><span class="hv-mono hv-dagn">dag 10 av 21<\/span>/.test(stor(k)), stor(k));
  ok("takten står med sitt facit bredvid, och leder till uträkningen", k.includes("I samma takt blir det ungefär 40. I oktober sa takten 38, det blev 44.") && k.includes("Visa uträkningen"), k);
  ok("väntande och makulerade står som antal", k.includes("1 väntar") && k.includes("1 makulerad"), k);
  okM("mätaren har takten som ett streck", k.includes('<div class="hv-mat" role="img" aria-label="19 av 46 order. I samma takt ungefär 40."><i class="nu" style="width:41.3%"></i><i class="takt" style="left:87.0%"></i></div>'), k.match(/<div class="hv-mat[\s\S]*?<\/div>/)?.[0]);
  ok("avsnittet öppnar genomgången", k.includes('data-hvark="team"') && k.includes("Visa uträkningen"));
  // Skiss A: utan mål står talet utan mätare, och raden säger att inget mål är satt (vy.js manad, utanMal).
  const utan = kort(hem({ chef: true, team: { ...TEAM, mal: null, text: { ...TEAM.text, stort: "19 order", malrad: "Inget mål satt för november." } } }).hvHem(), "Teamet i november");
  okM("inget mål satt: talet utan mätare, och en rad som säger det", utanIkon(utan) === SK.I_team0 && !utan.includes("hv-mat"), utanIkon(utan));
  const tidigt = kort(hem({ chef: true, team: { ...TEAM, takt: { gatt: 0, totalt: 21, prognos: null }, text: { ...TEAM.text, rad: "För tidigt för en takt. Den kommer när månadens första arbetsdag har gått.", facit: "", kort: "För tidigt för en takt. Den kommer när månadens första arbetsdag har gått." } } }).hvHem(), "Teamet i november");
  ok("första arbetsdagen: ingen prognos, inget streck", tidigt.includes("För tidigt för en takt.") && !tidigt.includes('class="takt"'), tidigt);
}

rubrik("Din månad: bara det provisionsmotorn har räknat");
{
  const g = hem({ chef: false });
  const h = g.hvHem(), k = kort(h, "Din november");
  ok("säljaren får Din månad, inte Teamet", !!k && !h.includes("Teamet i"));
  ok("kortets tal är godkänd provision", /<b class="num">14[\s ]500<\/b><span>kr i provision<\/span>/.test(stor(k)), stor(k));
  ok("väntande order står som antal", k.includes("1 order väntar på godkännande."), k);
  ok("väntande kronor står aldrig i kortet", !/16[\s ]500/.test(k) && !/2[\s ]000/.test(k) && !k.includes("≈"), k);
  // 500 kr är nästa stegs belopp. Det får inte stå någonstans på kortet; 14 500 kr (med hårt mellanslag före 500) är provisionen.
  ok("avståndet till nästa steg står i order", k.includes("3 order till nästa steg.") && !/(?<!\d[\s\u00a0])500\s?kr/.test(k), k);
  ok("kortets namn för skärmläsaren bär samma tal som ritas", namnet(k) === "Din november: 14\u00a0500 kr i provision. 1 order väntar på godkännande. 3 order till nästa steg. Visa uträkningen", namnet(k));
  okM("mätaren har ett fack per order, och den väntande är ljusare", k.includes('<div class="hv-mat steg" role="img" aria-label="2 order av 5 till nästa steg, 1 väntar på godkännande"><i class="pa"></i><i class="pa"></i><i class="vant"></i><i class=""></i><i class=""></i></div>'), k.match(/<div class="hv-mat[\s\S]*?<\/div>/)?.[0]);
  okM("avsnittet är skissens, tecken för tecken", utanIkon(k) === SK.I_manad, utanIkon(k));
  ok("prognosen i kronor står inte på kortet", !/30[\s ]500/.test(k) && !/[Pp]rognos/.test(k), k);
  ok("aldrig du förlorar, aldrig en jämförelse med kollegor", !/förlorar|kollegor|före månadsskiftet/i.test(k));
  const utan = kort(hem({ chef: false, underlag: "utan" }).hvHem(), "Din november");
  ok("utan provisionsregel visas inga kronor", !!utan && !/\bkr\b/.test(utan) && /<b class="num">2<\/b><span>order i november<\/span>/.test(stor(utan)), utan);
}

rubrik("Det som ändrats: en rad som öppnar översynen (skiss A)");
{
  const ag = hem({ chef: true }); ag.frKort = frKortRiktig;
  const k = kort(ag.hvHem(), "Det som ändrats");
  okM("raden är skissens, tecken för tecken", utanIkon(k) === SK.I_andrat, utanIkon(k));
  okM("hur många som följs och nästa dom står efter rubriken", k.includes('<b>Det som ändrats</b> <span class="hv-mono">&nbsp;4 följs · nästa dom 27 nov</span>'), k);
  okM("det mätta talet först i meningen", k.includes('<br><span class="hv-ink">2 av 52 möten uteblev.</span> Carl ringer före 10. En annan ändring ser sämre ut.</span>'), k);
  const utan = kort(hem({ chef: true, andratKort: { ...AKORT, stort: null, nastaDom: null } }).hvHem(), "Det som ändrats");
  ok("utan mätt tal: inget tal och ingen tom ruta", !utan.includes("hv-ink") && !utan.includes("nästa dom") && utan.includes("Carl ringer före 10."), utan);
  const tom = kort(hem({ chef: true, andrat: [], andratKort: { foljs: 0, nastaDom: null, stort: null, text: "" } }).hvHem(), "Det som ändrats");
  okM("inget ändrat: bara rubriken och Berätta om en ändring", utanIkon(tom) === SK.I_andrat0, utanIkon(tom));
}

rubrik("Ett öppnat kort tar ytan");
{
  const g = hem({ chef: false });
  g.S.hv.ark = "vantar";
  const v = g.hvHem();
  ok("hemmet viker undan för arket", !v.includes('id="hvHem"') && v.includes('id="hvArk"') && v.includes("data-hvstang"));
  ok("hela listan i grupperna Nu, Senare i dag och Kan vänta", />Nu</.test(v) && />Senare i dag</.test(v) && />Kan vänta</.test(v) && (v.match(/class="hv-sak[ "]/g) || []).length === 5, v.match(/class="hv-grupp">[^<]*/g)?.join(" "));
  ok("varje sak har en rad om varför", v.includes("Sjuk sedan i dag. Ingen har bekräftat") && v.includes("Granskningen var 12 nov"));
  ok("skrivrutan står kvar under arket", v.includes("data-hvskriv"));

  Object.assign(g.S.hv, { ark: "forslag", id: "f0", data: { forslag: { id: "f0", forslag: { ...FORSLAG(1)[0], lage: "oppet", mitt: true, valt: null, domsDag: "på onsdag", dom: null, kommentar: null } } } });
  const f = g.hvHem();
  ok("förslaget: Nav talar först, med sina tre rader", f.includes("Mötet med Hagby Glas 0 i morgon 09.00 är inte bekräftat.") && f.includes("Hittills har 1 av 4 obekräftade möten hållits.") && f.includes("Det här ser jag inte: om kunden har hört av sig på annat sätt."), f);
  // Skissens inlForslag: tre lika knappar i en hv-utkrad (trad.js rad 112). Vad varje val gör står under, en rad per val.
  ok("tre lika val", /<div class="hv-utkrad"><button class="hv-btn" data-hvval="ringer-sjalv" >Jag ringer själv<\/button><button class="hv-btn" data-hvval="flytta" >Flytta mötet<\/button><button class="hv-btn" data-hvval="lat-sta" >Låt stå<\/button><\/div>/.test(f) && (f.match(/data-hvval=/g) || []).length === 3 && ["Jag ringer själv", "Flytta mötet", "Låt stå"].every((l) => f.includes(`<p class="hv-tank"><b>${l}.</b> `)), f.match(/<div class="hv-utkrad">[\s\S]*?<\/div>/)?.[0]);
  ok("källraden säger hur texten kom till", f.includes("Räknat av regler"));
  ok("Nav kontaktar aldrig kunden, och det står där", f.includes("Nav ringer eller skriver aldrig till kunden."));
  ok("personens egen rad går att skriva", f.includes('data-hvkommentar="f0"') && f.includes('maxlength="200"'));
  g.S.hv.kvitto = { text: "Klart. Mötet står kvar som det är. På onsdag säger jag hur det gick.", angra: "f0" };
  g.S.hv.data.forslag.forslag.lage = "valt"; g.S.hv.data.forslag.forslag.valt = "lat-sta";
  const kv = g.hvHem();
  // Skissens kvitto (trad.js rad 111): bocken och texten i hv-kvi, Ångra bredvid, i en hv-utkrad.
  ok("kvittot och Ångra står under inlägget i tråden", /<div class="hv-utkrad" aria-live="polite"><span class="hv-kvi"><i class="hv-ok"><svg[^>]*>[\s\S]*?<\/svg><\/i>Klart\. Mötet står kvar som det är\. På onsdag säger jag hur det gick\.<\/span><button class="hv-btn" data-hvangra="f0">Ångra<\/button><\/div>/.test(kv), kv.match(/<div class="hv-utkrad"[^>]*><span class="hv-kvi">[\s\S]*?<\/div>/)?.[0]);
  ok("efter valet finns inga val kvar att trycka på", !kv.includes("data-hvval"));
  g.S.hv.data.forslag.forslag = { ...g.S.hv.data.forslag.forslag, mitt: false, lage: "oppet", valt: null };
  g.S.hv.kvitto = null;
  ok("den som inte håller mötet får inga val", !g.hvHem().includes("data-hvval"));

  Object.assign(g.S.hv, { ark: "manad", kvitto: null });
  const m = g.hvHem();
  // Skissens inlManad (trad.js rad 89): ordernumret i den smala kolumnen, kunden i fetstil, beloppet sist på raden.
  ok("uträkningen: order för order", /<div class="hv-sak"><span class="hv-mono">#11<\/span><div><b>Hagmans Rör<\/b>[\s\S]*?<\/div><span class="num">6[\s ]500 kr<\/span><\/div>/.test(m) && /<div class="hv-sak"><span class="hv-mono">#12<\/span><div><b>Åkes Bygg<\/b>[\s\S]*?<\/div><span class="num">8[\s ]000 kr<\/span><\/div>/.test(m) && /14[\s ]500 kr/.test(m), m.match(/<div class="hv-lista">[\s\S]{0,900}/)?.[0]);
  ok("väntande order med ungefärligt belopp, märkt", /≈ 2[\s ]000 kr/.test(m) && m.includes("fryses vid godkännandet"), m);
  ok("det Nav inte ser", m.includes("Det här ser jag inte: om en order makuleras senare. Då dras provisionen den månaden."));
  ok("varje rad går att fråga om", (m.match(/data-hvfraga=/g) || []).length === 2 && m.includes("Fråga om raden"));
  ok("prognosen i takten står här, bakom klicket, som en uträkning", /Prognos i din nuvarande takt: 30[\s ]500 kr/.test(m) && m.includes("inget löfte"), m);
  ok("källraden", m.includes("Räknat av regler"));
}
{
  const g = hem({ chef: true });
  Object.assign(g.S.hv, {
    ark: "team",
    data: {
      team: { team: { kort: TEAM, utrakning: "19 order på 10 arbetsdagar, gånger månadens 21 arbetsdagar, blir ungefär 40.", personer: [{ id: "p1", namn: "Carl Prov", bokade: 8, hallna: 5, uteblivna: 1, order: 6 }, { id: "p2", namn: "Edvin Prov", bokade: 2, hallna: 6, uteblivna: 3, order: 4 }], oppna: "Obekräftade möten i morgon: 3, varav 1 utan val.", takten: [{ manad: "2026-10", efter5: 30, efter10: 38, efter15: 41, blev: 44, efterhand: false }, { manad: "2026-09", efter5: 9, efter10: 11, efter15: 20, blev: 24, efterhand: true }], serInte: "Det här ser jag inte: order som inte är inlagda i Nav, och varför en order makulerades.", kalla: "Räknat av regler" } },
      facit: { facit: { text: "När någon har ringt själv har 5 av 7 möten hållits. Låt stå: 1 av 4. För få för att skilja från slump.", trodde: null, kalla: "Räknat av regler" } },
    },
  });
  const t = g.hvHem();
  ok("lagets öppna rader står kvar i genomgången", t.includes("Obekräftade möten i morgon: 3, varav 1 utan val."));

  // Navs riktiga frKort ger veckodagen först, och hemmet tar bort den i "nästa dom" (se frKortRiktig ovan).
  g.frKort = frKortRiktig;
  Object.assign(g.S.hv, {
    ark: "andrat",
    data: { andrat: { farLaget: true, foljs: 1, nastaDom: "2026-11-27", inledning: { fore: "Jag följer en ändring.", fet: "Den ser bra ut", efter: " och går att ta vidare. Ingen ändring får ”ser bra ut” om något annat blev sämre på köpet." }, kalla: "Räknat av regler", matt: [{ nyckel: "moten.uteblivna", text: "Uteblivna möten av hållna och uteblivna.", serInte: "Ser inte varför." }],
      andrat: [
        { id: "a1", sort: "andring", text: "Vi ringer kunden dagen före.", dom: "Ser bra ut. Hela laget ändrade sig samtidigt, så jag har inget att jämföra med.", tal: "0 av 20 uteblev. Bokade per vecka: 6 före, 7 efter.", ton: "upp", nar: "2026-11-13T07:00:00Z", vem: null, kommentar: null, fran: "person", mitt: false, kalla: "Räknat av regler" },
        { id: "a2", sort: "forslag", text: "Hagby Glas: Edvin valde att låta mötet stå. Kunden uteblev. Mötet blev aldrig bekräftat.", dom: null, tal: null, ton: "vet", nar: "2026-11-12T07:00:00Z", vem: "Edvin", kommentar: "Kunden bad om ny tid.", fran: "regel", mitt: false, kalla: "Räknat av regler" },
      ] } },
  });
  const a = g.hvHem();
  ok("det som ändrats: varje rad med källa, tal och dom", a.includes("Vi ringer kunden dagen före.") && a.includes("0 av 20 uteblev. Bokade per vecka: 6 före, 7 efter.") && a.includes("Ser bra ut.") && a.includes("Någon berättade") && a.includes("Nav såg det"), a);
  ok("personens egen rad står bredvid, som personens ord", a.includes("”Kunden bad om ny tid.”"));
  // Skissens inlAndrat (trad.js rad 98–100): listan, sedan knappen i ett eget stycke. Produktens Pröva med laget står
  // i radens tredje kolumn (skissens tomma <span>) på raden som ser bra ut, och bara där.
  ok("Berätta om en ändring i foten, Pröva med laget på raden som ser bra ut", /<p><button class="hv-btn" data-hvform="beratta">Berätta om en ändring<\/button><\/p>/.test(a) && /<b>Vi ringer kunden dagen före\.<\/b>[\s\S]*?<\/div><button class="hv-btn" data-hvform="prova">Pröva med laget<\/button><\/div>/.test(a) && (a.match(/data-hvform="prova"/g) || []).length === 1 && /<b>Hagby Glas: Edvin valde[\s\S]*?<\/div><span><\/span><\/div>/.test(a), a.match(/<div class="hv-lista">[\s\S]*?Berätta om en ändring<\/button><\/p>/)?.[0]);
  // Skissens inlAndrat har inget huvud. "N följs · nästa dom" står som en hv-tank-rad under listan (avvikelselistan).
  ok("inledningen som i skissen, och huvudet med N följs och nästa dom", a.includes("<p>Jag följer en ändring. <b>Den ser bra ut</b> och går att ta vidare. Ingen ändring får ”ser bra ut” om något annat blev sämre på köpet.</p><p class=\"hv-kalla\">") && a.includes('<p class="hv-tank">1 följs · nästa dom 27 nov</p>'), a.slice(a.search(/data-hvinl="andrat"/), a.search(/data-hvinl="andrat"/) + 700));
  ok("källraden", a.includes("Räknat av regler"));
  g.S.hv.form = { typ: "beratta", text: "", om: "jag", fran: "2026-11-16", matt: "moten.uteblivna", fel: "" };
  const fo = g.hvHem();
  ok("formuläret har fyra fält: vad, vem, från vilken dag och vilket mått", fo.includes('data-hvfalt="text"') && fo.includes('data-hvfalt="om"') && fo.includes('data-hvfalt="fran"') && fo.includes('data-hvfalt="matt"') && fo.includes("data-hvandring"), fo.match(/<form class="hv-form"[\s\S]*?<\/form>/)?.[0]);
  ok("chefen kan välja laget eller en person, säljaren bara sig själv", fo.includes('value="laget"') && fo.includes('value="p1"'));
  const s = hem({ chef: false });
  Object.assign(s.S.hv, { ark: "andrat", data: { andrat: { farLaget: false, foljs: 0, nastaDom: null, inledning: { fore: "Jag följer inga ändringar än.", fet: "", efter: " Berätta om en ändring, så följer jag måttet och säger hur det gick." }, kalla: "Räknat av regler", matt: [{ nyckel: "moten.uteblivna", text: "x", serInte: "y" }], andrat: [] } }, form: { typ: "beratta", text: "", om: "jag", fran: "2026-11-16", matt: "moten.uteblivna", fel: "" } });
  const sf = s.hvHem();
  ok("säljaren berättar bara om sig själv, och prövar inte med laget", !sf.includes('value="laget"') && !sf.includes('data-hvform="prova"') && sf.includes("Jag följer inga ändringar än."), sf.match(/<form class="hv-form"[\s\S]*?<\/form>/)?.[0]);
}

rubrik("Hela listan: det som finns kvar från det gamla hemmet (F2)");
{
  const g = hem({ chef: true });
  g.S.hv.ark = "vantar";
  const v = g.hvHem();
  ok("en rad med en källa går att öppna, också när knappen gör något annat", v.includes('data-hvga="r2"') && v.includes('data-hvga="r3"') && !v.includes('data-hvga="r1"'), v.match(/data-hvga="[^"]*"/g)?.join(" "));
  ok("raderna går att nå med tangentbordet (J, K, E, Enter)", (v.match(/class="hv-sak[^"]*"[^>]*\bdata-id="/g) || []).length === 5 && html.includes("document.querySelectorAll('.irow, .hv-sak[data-id]')"));
}

rubrik("Det gamla hemmets saker har en plats: nytt sedan sist");
{
  const rader = [
    { id: "upg-7", nar: "nu", heat: 3, bkind: "uppgift", bt: "{Ring Solbacken} är försenad.", t: "Ring Solbacken", why: "Skulle varit klar i går", act: { l: "Klar", check: true }, gor: () => {}, ga: () => {} },
    { id: "upg-8", nar: "idag", heat: 2, bkind: "uppgift", bt: "{Skicka offert} i dag.", t: "Skicka offert", why: "Frist i dag", act: { l: "Klar", check: true }, gor: () => {}, ga: () => {} },
  ];
  const g = hem({ chef: false, rader });
  const k = kort(g.hvHem(), "Väntar på dig");
  ok("pricken står på uppgiften som fått något nytt, i kortet", (k.match(/upg-nyprick/g) || []).length === 1 && /upg-nyprick" title="Nytt på uppgift 7"><\/span>Ring Solbacken/.test(k), k);
  g.S.hv.ark = "vantar";
  const v = g.hvHem();
  ok("och i hela listan", (v.match(/upg-nyprick/g) || []).length === 1 && v.indexOf("upg-nyprick") < v.indexOf("Ring Solbacken") && v.indexOf("upg-nyprick") > v.indexOf('data-id="upg-7"'), v.match(/data-id="upg-7"[\s\S]{0,300}/)?.[0]);
}

rubrik("Skiss A: Veckan som kommer");
{
  const g = hem({ chef: true });
  const DAG = ["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag"];
  Object.assign(g, {
    ndPlusDag: (d, n) => `2026-11-${String(+d.slice(8) + n).padStart(2, "0")}`,
    ndHemDagNamn: (d) => DAG[+d.slice(8) - 16],
    ndHemKal: (d) => (d === "2026-11-16" ? [{ s: 540, e: 570, t: "Nordic Grön & Mark" }, { s: 660, e: 705, t: "PEGU Byggservice" }] : d === "2026-11-17" ? [{ s: 600, e: 630, t: "Maya Städ" }] : []),
    ndHemBorta: (d) => (d === "2026-11-18" ? [["Mick Prov", "semester"]] : []),
  });
  g.hvOppna("vecka");
  const v = g.hvHem();
  okM("rubriken som skissen: veckonummer, i kalendern, borta och att få klart", v.includes('<h2 id="hvArktext">Veckan som kommer, <b>v.47</b>. 3 i kalendern, en borta, två saker att få klart.</h2>'), v.match(/<h2 id="hvArktext">[\s\S]*?<\/h2>/)?.[0]);
  okM("fem kolumner i ett rutnät", (v.match(/class="hv-vdag/g) || []).length === 5 && /<div class="hv-vecka"><button class="hv-vdag idag an" style="--i:1"/.test(v));
  okM("i dag är märkt och öppnar Min dag, med dagens möten i ordning", v.includes('<button class="hv-vdag idag an" style="--i:1" data-hvark="dag"><header><b>Mån</b><small>i dag</small><span>16 nov</span></header><small class="hv-tank">2 i kalendern</small><i>09.00 Nordic Grön &amp; Mark</i><i>11.00 PEGU Byggservice</i></button>'), v.match(/<button class="hv-vdag idag[\s\S]*?<\/button>/)?.[0]);
  okM("en annan dag: rubrik, antal och posterna, och den leder vidare", /<button class="hv-vdag an" style="--i:2" data-[a-z]+(?:="[^"]*")?><header><b>Tis<\/b><span>17 nov<\/span><\/header><small class="hv-tank">1 i kalendern<\/small><i>10\.00 Maya Städ<\/i><\/button>/.test(v), v.match(/<button class="hv-vdag an" style="--i:2"[\s\S]*?<\/button>/)?.[0]);
  okM("foten: Att få klart i veckan, med en knapp dit", /<div class="hv-arkfot"><span>Att få klart i veckan: <b>Ring Solbacken<\/b> och 1 till<\/span><span class="hv-end"><button class="hv-btn" data-[a-z]+="[^"]*">Öppna Uppgifter<\/button><\/span><\/div>/.test(v), v.match(/<div class="hv-arkfot"[\s\S]*?<\/div>/)?.[0]);
  ok("inget annat: ingen nästa arbetsdag, ingen kvällsnotis", !v.includes("Nästa arbetsdag") && !v.includes("Kvällsnotisen") && !v.includes("I dag blev"));
  okR("kvällsnotisen hämtas inte längre när Veckan öppnas", !/function hvOppna\([^)]*\)\{[\s\S]{0,700}kvall=1/.test(html));
}

rubrik("Det gamla hemmets saker har en plats: Golvet och Grattis");
{
  const g = hem({ chef: false });
  g.S.hv.ark = "golvet";
  const v = g.hvHem();
  // Skissens inlGolvet (trad.js rad 94): klockslaget med punkt i den smala kolumnen, "vem signerade kund" i fetstil.
  ok("dagens signerade order, med antal och summa", v.includes("<b>3 signerade</b>") && /80[\s ]000 kr/.test(v) && /<div class="hv-sak"><span class="hv-mono">10\.12<\/span><div><b>Mick Prov signerade Hagmans Rör<\/b><small>Stor, 36 månader · <span class="num">36[\s ]000 kr<\/span><\/small><\/div>/.test(v), v.slice(v.search(/data-hvinl="golvet"/), v.search(/data-hvinl="golvet"/) + 900));
  ok("månaden för laget, order netto mot målet", v.includes("Team Nord") && v.includes("november") && v.includes("19 order av 46"), v);
  ok("Grattis går att skicka till en kollega", /data-hvgratt="o1"[^>]*aria-pressed="false"/.test(v) && v.includes("Grattis"));
  ok("på den egna ordern står hur många som gratulerat, utan knapp", !v.includes('data-hvgratt="o2"') && /<div class="hv-sak"><span class="hv-mono">11\.40<\/span><div><b>Du signerade Åkes Bygg<\/b>[\s\S]*?<\/div><span class="hv-mono">2 grattis<\/span><\/div>/.test(v), v.slice(v.search(/data-hvinl="golvet"/), v.search(/data-hvinl="golvet"/) + 1400));
  ok("order som inte syns räknas bara i summan, och det står där", v.includes("1 order till i dag syns bara i summan"), v);
  ok("ett belopp som saknas står som ett streck, aldrig som noll", />–</.test(v) && !/>0 kr</.test(v));
  ok("källraden säger var talen kommer ifrån", v.includes("Räknat av regler"));
  await g.hvGrattis("o1");
  ok("Grattis sparas som förut, och Golvet läses om", JSON.stringify(g.anrop[0]) === JSON.stringify(["grattis", { order: "o1" }]) && g.anrop.some((a) => a[0] === "live") && g.S.hv.kvitto?.text === "Grattis skickat. Säljaren får en pling.", JSON.stringify(g.anrop));
  const tom = hem({ chef: false, golvet: { ...GOLVET, idag: [], idagAntal: 0, idagSumma: 0 } });
  tom.S.hv.ark = "golvet";
  ok("tomt läge", tom.hvHem().includes("Inga signerade order än i dag."));
}

rubrik("Rådgivarens fynd: klicken, hämtningarna, Escape och exempeldata");
{
  // 1. Fönstrets rot får aldrig bära ett attribut som klicklyssnaren lyssnar efter: då sväljs varje klick som inte
  //    har en egen väljare (Min dag, Stämpla in, Lyssna, Skicka, Öppna kalendern).
  const lyssnar = html.match(/e\.target\.closest\('(\[data-hvtr\][^']*)'\)/)?.[1].match(/data-[a-z]+/g) ?? [];
  ok("klicklyssnarens väljare går att läsa ur koden", lyssnar.length > 15 && lyssnar.includes("data-hvark"), lyssnar.join(" "));
  const g = hem({ chef: true });
  const sidor = [g.hvHem()];
  for (const ark of ["vantar", "vecka", "golvet", "manad"]) { g.S.hv.ark = ark; sidor.push(g.hvHem()); }
  g.S.hv.ark = null;
  const fel1 = [];
  for (const h of sidor) for (const m of h.matchAll(/<([a-z0-9]+)\b([^>]*)>/g)) {
    if (!lyssnar.some((a) => new RegExp(`\\b${a}(=|\\s|$)`).test(m[2]))) continue;
    if (m[1] === "button" || (m[1] === "section" && /role="button"/.test(m[2]))) continue;
    fel1.push(m[0].slice(0, 90));
  }
  ok("bara knappar och kort som är knappar bär klicklyssnarens attribut", fel1.length === 0, fel1.join(" | "));
  ok("fönstrets ton står i ett eget attribut", /<div class="hv(?: in)?(?: hv-skriver)?"[^>]*\bdata-hvtema="mork"/.test(sidor[0]) && /\.hv\[data-hvtema="ljus"\]\{/.test(html) && !/\.hv\[data-hvton=/.test(html));
  okM("fönstret säger sitt läge, som skissen (data-hvlage)", /<div class="hv(?: in)?"[^>]*\bdata-hvlage="hem"/.test(sidor[0]) && /<div class="hv(?: in)?"[^>]*\bdata-hvlage="ark"/.test(sidor[1]));

  // 2. En efterhämtning för ett ark får inte kasta ett annat arks hämtning.
  const r = hem({ chef: true });
  const losa = {};
  r.ndLas = (url) => new Promise((klar) => { losa[/las=team/.test(url) ? "team" : /las=facit/.test(url) ? "facit" : /las=andrat/.test(url) ? "andrat" : "forslag"] = klar; });
  r.S.hv.ark = "team";
  const p1 = r.hvHamta("team");
  const p2 = r.hvHamta("forslag", "f0");
  losa.forslag({ ok: false, data: { fel: "Förslaget finns inte." } });
  await p2;
  ok("ett fel för ett ark som inte är öppet visas inte i det öppna arket", !r.S.hv.fel, String(r.S.hv.fel));
  losa.team({ ok: true, data: { team: { kort: TEAM, personer: [], takten: [], utrakning: "", oppna: null, serInte: "", kalla: "Räknat av regler" } } });
  await p1;
  ok("det öppna arkets svar kommer fram fast en annan hämtning startade efter", !!r.S.hv.data.team && !r.hvHem().includes("Hämtar lagets tal"), JSON.stringify(Object.keys(r.S.hv.data)));

  const kvar = hem({ chef: true });
  kvar.ndLas = () => new Promise(() => {});
  Object.assign(kvar.S.hv, { ark: "team", fel: "Nav svarade inte." });
  kvar.hvHamta("forslag", "f0");
  ok("en hämtning för ett annat ark suddar inte det öppna arkets fel", kvar.S.hv.fel === "Nav svarade inte.", String(kvar.S.hv.fel));

  const v = hem({ chef: false });
  const hamtat = [];
  v.ndLas = async (url) => { hamtat.push(url); return { ok: true, data: { forslag: { ...FORSLAG(1)[0], lage: "valt", mitt: true } } }; };
  let slapp;
  v.ndSkriv = () => new Promise((klar) => { slapp = klar; });
  v.ndSvar = (x) => x;
  Object.assign(v.S.hv, { ark: "forslag", id: "f0", data: { forslag: { id: "f0", forslag: { ...FORSLAG(1)[0], lage: "oppet", mitt: true } } } });
  const val = v.hvValj("lat-sta");
  v.S.hv.ark = "manad"; v.S.hv.id = null;   // personen gick vidare innan servern svarat
  slapp({ ok: "Klart. Mötet står kvar som det är." });
  await val;
  ok("valet sparas, men arket som lämnats hämtas inte om", hamtat.length === 0 && v.S.hv.ark === "manad", hamtat.join(" "));

  // 3. Escape stänger det som ligger överst, inte arket under.
  const e = hem({ chef: true });
  const tryck = (key, target = {}) => { let stoppad = false; e.hvTangent({ key, target, preventDefault: () => { stoppad = true; } }); return stoppad; };
  Object.assign(e.S.hv, { ark: "andrat", form: { typ: "beratta", text: "Vi ringer dagen före", om: "jag", fran: "2026-11-16", matt: "", fel: "" } });
  e.document.getElementById = (id) => (id === "pal" ? {} : null);
  tryck("Escape");
  ok("med paletten öppen rör Escape varken formuläret eller arket", e.S.hv.ark === "andrat" && !!e.S.hv.form);
  e.document.getElementById = () => null;
  e.S.todoOpen = true; tryck("Escape");
  ok("med Att göra öppet rör Escape inte arket", e.S.hv.ark === "andrat" && !!e.S.hv.form);
  e.S.todoOpen = false; e.S.prfRuta = { sek: "admin" }; tryck("Escape");
  ok("med Inställningar öppet rör Escape inte arket", e.S.hv.ark === "andrat" && !!e.S.hv.form);
  e.S.prfRuta = null; tryck("Escape");
  ok("annars stänger Escape först formuläret", e.S.hv.ark === "andrat" && e.S.hv.form === null);
  tryck("Escape");
  ok("och sedan arket", e.S.hv.ark === null);
  ok("lyssnaren hör tangenten före Navs vanliga, så att den ser vad som var öppet", /document\.addEventListener\('keydown', hvTangent, true\);/.test(html));

  // 4. Texten om var förslagen slås på visas bara för den som har brytaren.
  const INST = { pa: false, obekraftatTid: "14:00", gransFacit: 0.01, gransDom: 0.05, gransPerson: 0.01, gransMotvikt: 0.2, foljda: [], hemNytt: [] };
  const utan = kort(hem({ chef: true, forslag: 0, pa: false, inst: { ...INST, farBrytare: false } }).hvHem(), "Nav föreslår");
  ok("ingen rad om avstängda förslag, för någon (beställaren: som skissen)", !utan.includes("avstängda"));
  const med = kort(hem({ chef: true, forslag: 0, pa: false, inst: { ...INST, farBrytare: true } }).hvHem(), "Nav föreslår");
  ok("inte heller för den som har brytaren", !med.includes("avstängda") && med.includes("Inga förslag just nu."));

  // 6. Utan provisionens data visas inga tal alls: utkastets exempelmotor får aldrig stå som riktig.
  const ex = hem({ chef: false });
  ex.ndP = () => null;
  const k = kort(ex.hvHem(), "Din november");
  ok("Din månad utan provisionens data: inga tal, och det står varför", !/\d/.test(k.replace(/<[^>]*>/g, "")) && k.includes("Provisionen går inte att läsa just nu."), k);
  ex.S.hv.ark = "manad";
  const a = ex.hvHem();
  ok("och uträkningen visar inga exempelrader", !a.includes("Hagmans Rör") && !/14[\s ]500/.test(a) && a.includes("Provisionen går inte att läsa just nu."), a.slice(0, 1200));
  const ej = hem({ chef: false });
  ej.ndKopplad = (vy) => vy !== "provision";
  const ejk = kort(ej.hvHem(), "Din november");
  ok("när vyn Provision inte är kopplad står just det, utan tal", ejk.includes("Provisionen är inte kopplad till hemmet än.") && !ejk.includes("går inte att läsa") && !/\d/.test(ejk.replace(/<[^>]*>/g, "")), ejk);
  ok("kortet säger skälet och inget mer: ingen kommentar om varför Nav hellre tiger", !k.includes("Jag visar hellre") && !ejk.includes("Jag visar hellre"));

  // 8. Formuläret listar bara dem läsaren får berätta om.
  const f = hem({ chef: true });
  f.ND.moten.kollegor = [{ id: "p1", namn: "Edvin Prov" }, { id: "p2", namn: "Utanför Laget" }];
  Object.assign(f.S.hv, { ark: "andrat", data: { andrat: { farLaget: true, krets: ["jag", "p1"], kalla: "Räknat av regler", matt: [{ nyckel: "moten.uteblivna", text: "x", serInte: "y" }], andrat: [] } }, form: { typ: "beratta", text: "", om: "jag", fran: "2026-11-16", matt: "moten.uteblivna", fel: "" } });
  const lag = f.hvHem();
  ok("teamledaren kan bara välja personer i sitt lag", lag.includes('value="p1"') && !lag.includes('value="p2"') && lag.includes('value="laget"'), lag.match(/<select data-hvfalt="om">[\s\S]*?<\/select>/)?.[0]);
  f.S.hv.data.andrat.krets = null;
  ok("den som ser alla kan välja alla", f.hvHem().includes('value="p2"'));
}

rubrik("Rutan Nya hemmet i Inställningar");
{
  const INST = { pa: false, obekraftatTid: "14:00", gransFacit: 0.01, gransDom: 0.05, gransPerson: 0.01, gransMotvikt: 0.2, foljda: ["moten.bekrafta-dagar"], hemNytt: ["p1"] };
  const superadmin = hem({ chef: true, inst: { ...INST, farBrytare: true } }).hvInstRuta();
  ok("superadmin ser rutan med brytarna", superadmin.includes("Nya hemmet") && superadmin.includes('data-hvinst="forslag.pa"') && superadmin.includes('data-hvinst="hem.nytt"'), superadmin.slice(0, 300));
  ok("brytaren säger vad den gör, och vad av betyder", superadmin.includes("Nav skapar förslag och dömer dem. Av: jobben räknar bara och skriver i kvittot."));
  ok("klockslaget och de fyra gränserna, var och en med en mening om vad den gör", ["forslag.obekraftat-tid", "forslag.grans-facit", "forslag.grans-dom", "forslag.grans-person", "forslag.grans-motvikt"].every((k) => superadmin.includes(`data-hvinst="${k}"`)) && (superadmin.match(/class="hv-ihj"/g) || []).length >= 6, superadmin);
  ok("vilka som har nya hemmet: personer eller alla", superadmin.includes("Edvin Prov") && superadmin.includes('data-hvinstalla'));
  const admin = hem({ chef: true, inst: { ...INST, farBrytare: false } }).hvInstRuta();
  ok("en admin ser klockslaget, men varken gränserna eller brytarna", admin.includes('data-hvinst="forslag.obekraftat-tid"') && !admin.includes('data-hvinst="forslag.grans-') && !admin.includes('data-hvinst="forslag.pa"') && !admin.includes('data-hvinst="hem.nytt"'), admin.slice(0, 600));
  ok("säljaren ser ingen ruta", hem({ chef: false, inst: null }).hvInstRuta() === "");
}

rubrik("Chatten i skrivrutan");
{
  const kodat = (r) => new TextEncoder().encode(`data: ${JSON.stringify(r)}\n\n`);
  const strom = (rader, grind = null) => ({ ok: true, status: 200, headers: { get: () => "text/event-stream; charset=utf-8" }, body: { getReader() { const k = rader.map(kodat); let i = 0; return { read: async () => { if (grind && i === 1) await grind; return i < k.length ? { done: false, value: k[i++] } : { done: true }; } }; } } });
  const nej = (status, data) => ({ ok: false, status, headers: { get: () => "application/json" }, body: null, json: async () => data });
  const SVAR = { h: "svar", text: "Laget höll ⟦t1:12⟧ av ⟦t2:19⟧ möten. Det är ⟦obelagt:63 %⟧.\n\n<img src=x onerror=alert(1)>", tal: [{ id: "t1", varde: 12, om: "Hållna möten · Ditt lag · förra veckan · data per 2026-11-16", kalla: { verktyg: "las_matt", anrop: 1, falt: "antal" } }, { id: "t2", varde: 19, om: "Hållna möten · Ditt lag", kalla: { verktyg: "las_matt", anrop: 1, falt: "av" } }], obelagda: 1, kalla: "Skrivet av AI ur Navs tal", utkast: [] };
  const klick = (g, attr) => g.hvKlick({ target: { closest: () => ({ dataset: attr }) }, preventDefault() {}, stopPropagation() {} });

  // Av: skrivrutan svarar som paletten.
  const av = hem({ chef: true });
  const hamtat = [];
  av.fetch = async (...a) => { hamtat.push(a); return nej(409, { fel: "Chatten är inte påslagen." }); };
  av.S.hv.q = "hur går det för laget";
  av.hvFraga();
  ok("med chatten av går skrivrutan till paletten, och ingenting skickas till chatten", av.anrop.some((a) => a[0] === "pal") && hamtat.length === 0 && av.S.hv.ark === null);
  ok("rutan säger att svaren inte kommer från AI", /Svaren kommer ur Navs sökruta, inte från AI/.test(av.hvSkriv()));

  // På: frågan går till chatten, och korten viker undan.
  const pa = hem({ chef: true });
  pa.ND.hem.chatt = true;
  let slapp; const grind = new Promise((k) => { slapp = k; });
  const skickat = [];
  pa.fetch = async (url, init) => { skickat.push([url, init]); return strom([{ h: "hamtar", text: "Hämtar hållna möten för laget, förra veckan." }, SVAR], grind); };
  ok("rutan säger att svaren skrivs av AI", /skrivs av AI/.test(pa.hvSkriv()) && !/inte från AI/.test(pa.hvSkriv()));
  pa.S.hv.q = "Hur gick lagets möten förra veckan?";
  const p = pa.hvFraga();
  await new Promise((k) => setTimeout(k, 5));
  const mitt = pa.hvHem();
  ok("frågan går till /nav2/chatt och inte till paletten", skickat.length === 1 && skickat[0][0] === "/nav2/chatt" && skickat[0][1].method === "POST" && JSON.parse(skickat[0][1].body).fraga === "Hur gick lagets möten förra veckan?" && !pa.anrop.some((a) => a[0] === "pal"));
  ok("korten viker undan och frågan står kvar", pa.S.hv.ark === "chatt" && mitt.includes("Hur gick lagets möten förra veckan?") && !mitt.includes('id="hvHem"'));
  ok("medan verktyget kör står det vad som hämtas", mitt.includes("Hämtar hållna möten för laget, förra veckan."));
  ok("skrivrutan står kvar under samtalet, och är tom", mitt.includes("data-hvskriv") && pa.S.hv.q === "");
  slapp(); await p; await new Promise((k) => setTimeout(k, 5));
  const klart = pa.hvHem();
  ok("talen är knappar som bär sin källa", /<button class="hv-siffra[^"]*" data-hvtal="0:t1"[^>]*>12<\/button>/.test(klart) && /data-hvtal="0:t2"[^>]*>19</.test(klart), klart.slice(klart.indexOf("hv-tur"), klart.indexOf("hv-tur") + 900));
  ok("ett tal utan belägg är utmärkt, och rutan säger det", /<mark class="hv-obel"[^>]*>63 %<\/mark>/.test(klart) && klart.includes("kunde jag inte belägga"));
  ok("källraden säger att texten är skriven av AI", klart.includes("Skrivet av AI ur Navs tal") && !klart.slice(klart.indexOf("hv-tur")).includes("Räknat av regler"));
  ok("text i svaret kan inte bli kod", !klart.includes("<img src=x") && klart.includes("&lt;img src=x"));
  klick(pa, { hvtal: "0:t1" });
  ok("ett klick på talet visar källan: mått, vem, period och data per", pa.hvHem().includes("Hållna möten · Ditt lag · förra veckan · data per 2026-11-16"));
  klick(pa, { hvtal: "0:t1" });
  ok("ett klick till döljer den", !pa.hvHem().includes("förra veckan · data per"));

  // Nästa fråga bär samtalet, utan märken.
  pa.fetch = async (url, init) => { skickat.push([url, init]); return strom([{ ...SVAR, text: "Inget nytt.", tal: [], obelagda: 0 }]); };
  pa.S.hv.q = "Och veckan före?";
  await pa.hvFraga();
  const h2 = JSON.parse(skickat[1][1].body).historia;
  ok("nästa fråga bär det förra utbytet, utan märken", h2.length === 1 && h2[0].fraga === "Hur gick lagets möten förra veckan?" && h2[0].svar.startsWith("Laget höll 12 av 19 möten.") && !h2[0].svar.includes("⟦"), JSON.stringify(h2));
  ok("båda turerna står i samtalet", (pa.hvHem().match(/class="hv-tur"/g) || []).length === 2);

  // Ett kort: Claude förbereder, personen godkänner. Varje steg går till Navs vanliga rutt.
  const u = hem({ chef: false });
  u.ND.hem.chatt = true;
  const KORT = { rubrik: "Lägg upp 2 uppgifter", klart: "Uppgifterna är upplagda.", varning: null,
    rader: [{ text: "Ring <b>Hagby</b> Glas", dag: "2026-11-17", not: "åt Sara <i>Lind</i>" }, { text: "Skicka offerten", dag: null, not: "utan dag" }],
    steg: [{ vag: "/nav2/uppgifter", body: { handling: "skapa", titel: "Ring <b>Hagby</b> Glas", dag: "2026-11-17", till: "p-sara" }, angra: { handling: "avbryt", id: "$id" } }, { vag: "/nav2/uppgifter", body: { handling: "skapa", titel: "Skicka offerten", dag: null }, angra: { handling: "avbryt", id: "$id" } }] };
  const FLYTT = { rubrik: "Ändra dagen för uppföljningen", klart: "Uppföljningen är ändrad.", varning: "Går inte att ångra här efteråt.", rader: [{ text: "Solbacken", dag: "2026-11-20", not: "förut 2026-11-12" }],
    steg: [{ vag: "/nav2/moten", body: { handling: "uppfoljning_andra", kedja: "k1", fore: null, datum: "2026-11-20", text: null }, angra: null }] };
  u.fetch = async () => strom([{ h: "hamtar", text: "Förbereder uppgifter att godkänna." }, { h: "svar", text: "Jag har förberett det. Det väntar på Godkänn.", tal: [], obelagda: 0, kalla: "Skrivet av AI, inte ur Navs tal eller kunskapsbasen", kort: [KORT, FLYTT] }]);
  const skrivet = [];
  u.ndSkriv = async (url, data) => { skrivet.push([url, data]); return u.__fall && skrivet.length === u.__fall ? { fel: "Det sparades inte." } : { ok: "Sparat.", id: `ny${skrivet.length}`, uppfoljning_andrad: "v2" }; };
  u.ndSvar = (x) => x;
  const omlast = [];
  u.ndOmlas = (d) => { omlast.push(d); return Promise.resolve(true); };
  u.NDOMLAS = {};
  u.S.hv.q = "Lägg upp att jag ringer Hagby i morgon";
  await u.hvFraga();
  let ut = u.hvHem();
  ok("kortet säger exakt vad som ska göras, med Godkänn och Avbryt, och inget är gjort", ut.includes('data-hvchattgodkann="0:0"') && ut.includes('data-hvchattavbryt="0:0"') && ut.includes("Lägg upp 2 uppgifter") && ut.includes("Inget är gjort än") && skrivet.length === 0, ut.slice(ut.indexOf("hv-utk"), ut.indexOf("hv-utk") + 600));
  ok("kortets text kan inte bli kod, och raden säger dag och åt vem", ut.includes("Ring &lt;b&gt;Hagby&lt;/b&gt; Glas") && ut.includes("åt Sara &lt;i&gt;Lind&lt;/i&gt;") && ut.includes("utan dag") && !ut.includes("<b>Hagby</b>"));
  ok("två kort i samma svar står var för sig, och varningen står före Godkänn", ut.includes('data-hvchattgodkann="0:1"') && ut.includes("Ändra dagen för uppföljningen") && ut.indexOf("Går inte att ångra här efteråt.") < ut.indexOf('data-hvchattgodkann="0:1"') && ut.indexOf("Går inte att ångra här efteråt.") > ut.indexOf('data-hvchattgodkann="0:0"'));
  ok("källraden är den servern skickade", ut.includes("Skrivet av AI, inte ur Navs tal eller kunskapsbasen"));
  u.__fall = 2;
  await u.hvChattGodkann(0, 0);
  ut = u.hvHem();
  ok("faller det andra steget står Godkänn kvar, Avbryt är borta och kortet säger hur långt det kom", skrivet.length === 2 && ut.includes('data-hvchattgodkann="0:0"') && !ut.includes('data-hvchattavbryt="0:0"') && ut.includes("1 av 2 är gjorda.") && omlast.includes("upg"), ut.slice(ut.indexOf("hv-utk"), ut.indexOf("hv-utk") + 700));
  u.__fall = 0;
  await u.hvChattGodkann(0, 0);
  ok("ett nytt tryck gör bara det som saknas, med exakt det kortet sa", skrivet.length === 3 && skrivet[2][1].titel === "Skicka offerten" && skrivet[2][1].dag === null && skrivet[0][0] === "/nav2/uppgifter" && skrivet[0][1].handling === "skapa" && skrivet[0][1].dag === "2026-11-17" && skrivet[0][1].till === "p-sara", JSON.stringify(skrivet));
  ut = u.hvHem();
  ok("sedan står kvittot med Ångra, och Godkänn är borta", !ut.includes('data-hvchattgodkann="0:0"') && ut.includes("Uppgifterna är upplagda.") && ut.includes('data-hvchattangra="0:0"'));
  await u.hvChattGodkann(0, 0);
  ok("ett tryck till gör ingenting", skrivet.length === 3);
  await u.hvChattAngra(0, 0);
  ok("Ångra tar tillbaka stegen i omvänd ordning, med id:t rutten svarade", skrivet.length === 5 && skrivet[3][1].handling === "avbryt" && skrivet[3][1].id === "ny3" && skrivet[4][1].id === "ny1" && u.hvHem().includes("Ångrat.") && !u.hvHem().includes('data-hvchattangra="0:0"'), JSON.stringify(skrivet.slice(3)));
  klick(u, { hvchattgodkann: "0:1" });
  await new Promise((r) => setTimeout(r, 0));
  ut = u.hvHem();
  ok("ett kort utan Ångra visar bara kvittot, och Möten läses om", skrivet.length === 6 && skrivet[5][0] === "/nav2/moten" && skrivet[5][1].handling === "uppfoljning_andra" && ut.includes("Uppföljningen är ändrad.") && !ut.includes('data-hvchattangra="0:1"') && omlast.includes("hv"), JSON.stringify([skrivet[5], omlast]));

  // Avbryt gör ingenting, och efter Avbryt går kortet inte att godkänna.
  const avb = hem({ chef: false });
  avb.ND.hem.chatt = true;
  avb.fetch = async () => strom([{ h: "svar", text: "Förberett.", tal: [], obelagda: 0, kalla: "Skrivet av AI", kort: [KORT] }]);
  const avSkrivet = [];
  avb.ndSkriv = async (url, data) => { avSkrivet.push([url, data]); return { ok: "Sparat.", id: "x" }; };
  avb.ndSvar = (x) => x; avb.ndOmlas = () => Promise.resolve(true); avb.NDOMLAS = {};
  avb.S.hv.q = "Lägg upp det";
  await avb.hvFraga();
  klick(avb, { hvchattavbryt: "0:0" });
  await avb.hvChattGodkann(0, 0);
  ok("Avbryt gör ingenting, och ett avbrutet kort går inte att godkänna", avSkrivet.length === 0 && avb.hvHem().includes("Avbrutet. Inget är gjort.") && !avb.hvHem().includes("data-hvchattgodkann"));
  // Svarar rutten utan det Ångra behöver finns ingen Ångra-knapp: hellre ingen knapp än en som inte fungerar.
  const ua = hem({ chef: false });
  ua.ND.hem.chatt = true;
  ua.fetch = async () => strom([{ h: "svar", text: "Förberett.", tal: [], obelagda: 0, kalla: "Skrivet av AI", kort: [KORT] }]);
  ua.ndSkriv = async () => ({ ok: "Sparat." });
  ua.ndSvar = (x) => x; ua.ndOmlas = () => Promise.resolve(true); ua.NDOMLAS = {};
  ua.S.hv.q = "Lägg upp det";
  await ua.hvFraga();
  await ua.hvChattGodkann(0, 0);
  ok("utan id i ruttens svar finns ingen Ångra-knapp", ua.hvHem().includes("Uppgifterna är upplagda.") && !ua.hvHem().includes("data-hvchattangra"));

  // Taket, avböjandet och avstängningen.
  const t = hem({ chef: false });
  t.ND.hem.chatt = true;
  t.fetch = async () => nej(429, { fel: "Du har använt månadens AI-utrymme. Det fylls på den 1:a.", tak: true });
  t.S.hv.q = "en fråga till";
  await t.hvFraga();
  ok("när utrymmet är slut säger rutan varför, och erbjuder sökrutan", t.hvHem().includes("Du har använt månadens AI-utrymme. Det fylls på den 1:a.") && t.hvHem().includes('data-hvchattsok="0"'));
  t.ND.hem.chattAnvant = 37;
  ok("personen ser hur mycket av månadens AI-utrymme som är använt", t.hvSkriv().includes("37 % av månadens AI-utrymme är använt"), t.hvSkriv());
  t.ND.hem.chattAnvant = null;
  ok("går det inte att läsa står ingen procent", !/AI-utrymme/.test(t.hvSkriv()) && t.hvSkriv().includes("Svaren skrivs av AI"));
  t.ND.hem.chatt = false; t.ND.hem.chattAnvant = 37;
  ok("och när chatten är av står ingenting om utrymmet", !/AI-utrymme/.test(t.hvSkriv()));
  klick(t, { hvchattsok: "0" });
  ok("Sök i stället öppnar paletten", t.anrop.some((a) => a[0] === "pal"));
  const a = hem({ chef: false });
  a.ND.hem.chatt = true;
  a.fetch = async () => strom([{ h: "avbojt", text: "Modellen avböjde att svara på det här. Sök i stället ger svar ur Navs sökruta." }]);
  a.S.hv.q = "något konstigt";
  await a.hvFraga();
  ok("avböjer modellen säger rutan det rakt", a.hvHem().includes("Modellen avböjde att svara") && a.hvHem().includes("data-hvchattsok") && !a.hvHem().includes("Skrivet av AI"));
  const s = hem({ chef: false });
  s.ND.hem.chatt = true;
  s.fetch = async () => nej(409, { fel: "Chatten är inte påslagen." });
  s.S.hv.q = "hej hej";
  await s.hvFraga();
  ok("har chatten stängts av sedan sidan lästes går frågan till paletten", s.ND.hem.chatt === false && s.anrop.some((x) => x[0] === "pal") && s.S.hv.ark === null);
  const n = hem({ chef: false });
  n.ND.hem.chatt = true;
  n.fetch = async () => { throw new Error("nätet"); };
  n.S.hv.q = "hej hej";
  await n.hvFraga();
  ok("svarar inte Nav säger rutan det", /Nav svarade inte/.test(n.hvHem()) && n.S.hv.chatt[0].laddar === false);

  // Rutan i Inställningar: läget, för superadmin.
  const INST = { pa: false, obekraftatTid: "14:00", gransFacit: 0.01, gransDom: 0.05, gransPerson: 0.01, gransMotvikt: 0.2, foljda: [], hemNytt: [] };
  const lage = hem({ chef: true, inst: { ...INST, farBrytare: true } });
  lage.ND.hem.chattLage = { pa: false, skal: "Modellen har inget godkänt prov.", modell: "claude-sonnet-5-5", utrymme: { personUsd: 0, foretagUsd: 12.4, takPersonUsd: 14, takForetagUsd: 85 }, allas: [{ namn: "Sara <i>Prov</i>", usd: 9.25, fragor: 210 }, { namn: "Tea Prov", usd: 3.15, fragor: 1 }] };
  const lr = lage.hvInstRuta();
  ok("superadmin ser att chatten är av och vad som saknas", lr.includes("Chatten med AI är avstängd") && lr.includes("Modellen har inget godkänt prov."));
  ok("gränserna står i dollar, per person och för företaget, och var de sätts", lr.includes("14 dollar per person") && lr.includes("85 dollar för företaget") && lr.includes("per kalendermånad") && !/tak i kronor|frågor per person och dag/.test(lr), lr.slice(lr.indexOf("Chatten med AI"), lr.indexOf("Chatten med AI") + 900));
  ok("och vad som är använt i månaden, för företaget och per person", lr.includes("12,40 av 85 dollar") && lr.includes("Sara &lt;i&gt;Prov&lt;/i&gt;") && lr.includes("9,25 dollar") && lr.includes("210 frågor") && lr.includes("1 fråga") && !lr.includes("1 frågor"));
  lage.ND.hem.chattLage = { ...lage.ND.hem.chattLage, utrymme: null, allas: [] };
  ok("går utrymmet inte att läsa sägs det, utan ett påhittat tal", lage.hvInstRuta().includes("Gränserna gick inte att läsa") && !/\d+ av \d+ dollar/.test(lage.hvInstRuta()));
  ok("utan läge står ingenting om chatten", !hem({ chef: true, inst: { ...INST, farBrytare: false } }).hvInstRuta().includes("Chatten med AI"));
}

rubrik("Rättelser efter klickprovet 2026-11-15");
{
  const h = hem({ chef: true }).hvHem();
  okN("Nästa att göra är ihopfälld i det nya hemmet, som i skissen", /const min = pillHv\(\) \? !S\.hvPillUt : S\.pillMin;/.test(html) && /if \(d\.pillmin !== undefined && pillHv\(\)\)\{ S\.hvPillUt = !S\.hvPillUt;/.test(html));
  okN("utfälld lyfts den över skrivrutan", /body\.hvbody \.todopill:not\(\.min\)\{bottom:/.test(html));
  // Riktig data 2026-11-17: vid 920 px låg rutan över skrivrutans knapp Skicka. Nav döljer den redan under 900 px.
  okN("under 1000 px visas den inte i hemmet, så att den aldrig täcker Skicka", /@media \(max-width:1000px\)\{body\.hvbody \.todopill\{display:none\}\}/.test(html) && /@media \(max-width:900px\)\{ ?\.todopill\{display:none\} ?\}/.test(html));
  const tk = kort(h, "Teamet i november");
  okM("Teamets dag står kort, efter talet", /<span class="hv-mono hv-dagn">dag 10 av 21<\/span><\/div>/.test(stor(tk) + "</div>") && tk.includes('<div class="hv-manh"><h2>Teamet i november</h2><span class="hv-mono">Räknat av regler</span></div>'), tk.match(/<div class="hv-manh">[\s\S]*?<\/div>\s*<div class="hv-stor">[\s\S]*?<\/div>/)?.[0]);
  okM("veckonumret efter datumet", h.includes('<span class="hv-datum">Måndag 16 november<small>v.47</small></span>'));
  ok("Lyssna efter läget, med det gamla hemmets uppläsning", /<button class="hv-lyssna" data-listen[^>]*>[\s\S]*?Lyssna<\/button>/.test(h));
  okM("Lyssna som i skissen: sist i meningen, en spelknapp och ett namn", /<button class="hv-lyssna" data-listen aria-label="Lyssna på dagen i korthet"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5l12 7-12 7z"\/><\/svg>Lyssna<\/button><\/p>/.test(h), h.match(/<button class="hv-lyssna[\s\S]*?<\/button>/)?.[0]);
  ok("Teamets rad är skissens: takten och facit i en mening", tk.includes("I samma takt blir det ungefär 40. I oktober sa takten 38, det blev 44.") && !tk.includes("inget löfte"), tk);
  const genv = h.match(/<div class="hv-genv"[^>]*>[\s\S]*?<\/span><\/div>/)?.[0] ?? "";
  ok("genvägarna som i skissen: Min dag, Veckan som kommer, Möten, Min statistik, Mer", /data-hvark="dag"[^>]*>Min dag/.test(genv) && />Veckan som kommer</.test(genv) && /data-go="\/moten"[^>]*>Möten[ <]/.test(genv) && /data-hvmer[^>]*>Mer</.test(genv), genv);
  ok("Förbered står bara när chatten svarar", !genv.includes("data-hvforbered"));
}

rubrik("Tonen följer Nav (punkt 3)", "REGEL");
{
  ok("ingen egen tonknapp i hemvyn", !/nav2-hvton|hv-tonk|data-hvton|hvTon\b/.test(html));
  const tema = (theme, mork) => { const g = hem({ chef: true }); g.S.theme = theme; g.prfDatornMorkt = () => mork; return g.hvHem().match(/data-hvtema="([^"]*)"/)?.[1]; };
  ok("ljust i Inställningar ger ljust fönster", tema("light", true) === "ljus");
  ok("mörkt i Inställningar ger mörkt fönster", tema("dark", false) === "mork");
  ok("Automatiskt följer datorn", tema("auto", true) === "mork" && tema("auto", false) === "ljus");
  ok("hemmet ritas om när temat byts", /function prfTemaSynk\(\)\{ if \(S\.prfRuta \|\| S\.prfMeny \|\| \(S\.view === 'hem' && hvPa\(\)\)\) render\(\); \}/.test(html));
  ok("och när datorn byter, i läget Automatiskt", /matchMedia\('\(prefers-color-scheme: dark\)'\)\.addEventListener\('change', \(\) => \{ if \(S\.theme === 'auto'\) prfTemaSynk\(\); \}\)/.test(html));
}

rubrik("Överraden: laget, datum och stämpling (skiss A)");
{
  // teamNow i riktigt läge: de som är inne, avvikelserna, och resten av laget som inte är instämplade.
  const kod = html.match(/teamNow = function\(\)\{[\s\S]*?\n\};/)?.[0] ?? "";
  const lag = (paPlats, dagsbild, alla) => { const g = { ND: { tid: { chef: { paPlats, dagsbild, lag: alla } } }, _ndTeamNow: () => [], teamNow: null }; new Function("g", `with (g) { ${kod} }`)(g); return g.teamNow(); };
  const sju = Array.from({ length: 7 }, (_x, i) => ({ id: `p${i}`, namn: `Person ${i}` }));
  const t = lag([], [], sju);
  ok("en söndag utan scheman: alla sju står med, ingen inne", t.length === 7 && t.every((x) => x[1] === "ej"), JSON.stringify(t));
  const t2 = lag([{ namn: "Person 0", sedan: "07:58" }], [{ namn: "Person 1", lage: "sjuk", detalj: "sjuk sedan i dag" }], sju);
  ok("den som är inne och den som är sjuk räknas en gång", t2.length === 7 && t2.filter((x) => x[1] === "inne").length === 1 && t2.filter((x) => x[1] === "sjuk").length === 1, JSON.stringify(t2));
  const g = hem({ chef: true });
  g.teamNow = () => sju.map((p) => [p.namn, "ej", "inte instämplad"]);
  const h = g.hvHem();
  okM("0/7 på plats med stapeln, som en knapp som visar vilka", h.includes('<button class="hv-lg" data-hvdra aria-expanded="false" aria-label="Laget just nu: 0 av 7 på plats. Visa vilka."><b class="num"><span data-roll="pa">0</span><small>/7</small></b><span class="t">på plats</span><span class="hv-lgbar" aria-hidden="true"><i style="flex:7;background:var(--hv-p-ej)"></i></span>'), h.match(/<header class="hv-topp">[\s\S]*?<\/header>/)?.[0]);
  const s = hem({ chef: true });
  s.ND.tid = { stamplar: false, modulPa: true };
  ok("Stämpla in finns också för den som inte måste stämpla", /data-act="in"[^>]*>Stämpla in/.test(s.hvHem()));
  s.ND.tid = { stamplar: false, modulPa: false };
  ok("men inte när stämplingen är avstängd", !/data-act="in"/.test(s.hvHem()));
  ok("dagens stämplingar läses för alla när stämplingen är på", html.includes("S.events = ND.tid.modulPa ? ndDagensEvents() : [];"));
}

// Regeln för en väljare i hemmets CSS, exakt som den står (första träffen utanför @media när inget annat sägs).
const regel = (sel, i = html) => { const m = i.match(new RegExp(`(?:^|\\n|\\})${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\{([^}]*)\\}`)); return m ? m[1] : null; };
const media = (villkor) => { const start = html.indexOf(`@media ${villkor}{`); if (start < 0) return ""; let d = 0, j = start; for (; j < html.length; j++) { if (html[j] === "{") d++; else if (html[j] === "}") { d--; if (d === 0) break; } } return html.slice(start, j + 1); };
// Hemmets stil: från hemmets första kommentar till </style>. Där står skissens CSS tecken för tecken (kontraktet §2.2),
// och efter den produktens egna regler för det skissen saknar (§5).
const hemStart = ["/* ===================== Nya hemmet (prefix hv)", "/* ---------- Hemmets tokens ---------- */"].map((m) => html.indexOf(m)).filter((i) => i >= 0);
const hemCss = hemStart.length ? html.slice(Math.min(...hemStart), html.indexOf("</style>", Math.min(...hemStart))) : "";
// Ett block (@media, @container) med klamrarna matchade, ur en given text.
const cssBlock = (text, huvud) => { const start = text.indexOf(`${huvud}{`); if (start < 0) return ""; let d = 0, j = start; for (; j < text.length; j++) { if (text[j] === "{") d++; else if (text[j] === "}") { d--; if (d === 0) break; } } return text.slice(start, j + 1); };
const utanKommentar = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const norm = (s) => utanKommentar(s).replace(/\s*\n\s*/g, "").trim();
// Skissens stil.css rad 33–497, med kontraktets §3 och inget annat: utan .hv-rail och 960-regeln, --hv-ur utan --sk-h,
// höjdregeln 716 i stället för 760, 1180 i stället för 1240, och .hv-herok utan understrykning (v2). Skriven av ett
// skript ur skissens fil, inte för hand.
const SKISS_CSS = String.raw`

/* ---------- Hemmets tokens ---------- */
.hv{
  --hv-fs-1:12px; --hv-fs-2:13px; --hv-fs-3:14px; --hv-fs-4:15px; --hv-fs-5:16px; --hv-fs-mono:11px; --hv-fs-h1:40px; --hv-fs-tal:48px;
  --hv-s1:4px; --hv-s2:8px; --hv-s3:12px; --hv-s4:16px; --hv-s5:24px; --hv-s6:32px; --hv-s7:48px;
  --hv-r1:8px; --hv-r2:12px; --hv-r3:16px;
  --hv-t-snabb:120ms; --hv-t:180ms; --hv-t-lugn:250ms; --hv-ease:cubic-bezier(.2,.7,.2,1); --hv-ease-ut:cubic-bezier(.4,0,1,1);
  /* Urtavlans storlek följer fönstrets höjd: hela dagen syns utan att något annat trängs undan. */
  --hv-ur:clamp(232px, calc(100dvh - 292px), 432px);
  --hv-base:#0E1B17;
  --hv-yta:color-mix(in srgb,var(--hv-ink) 5%,var(--hv-base));
  --hv-yta-2:color-mix(in srgb,var(--hv-ink) 9%,var(--hv-base));
  --hv-pop:color-mix(in srgb,var(--hv-ink) 9%,var(--hv-base));
  --hv-ink:#EDF3F0; --hv-ink-2:#A9B9B2; --hv-ink-3:#8A9C94;
  --hv-line:rgba(255,255,255,.075); --hv-line-2:rgba(255,255,255,.15); --hv-line-3:#5E7068;
  --hv-brand:#5DC39F; --hv-on-brand:#06211A; --hv-brand-ink:#6FCDAB; --hv-brand-soft:rgba(93,195,159,.15);
  --hv-signal:#E8B15A; --hv-signal-ink:#E8B15A; --hv-on-signal:#241500; --hv-danger:#EE8B80;
  --hv-shadow:0 12px 32px -14px rgba(0,0,0,.55),0 1px 0 rgba(255,255,255,.04) inset;
  /* Urtavlan */
  --hv-band:color-mix(in srgb,var(--hv-ink) 7%,var(--hv-base));
  --hv-band-gatt:color-mix(in srgb,var(--hv-ink) 15%,var(--hv-base));
  --hv-tick:color-mix(in srgb,var(--hv-ink) 26%,var(--hv-base));
  --hv-mote:var(--hv-brand); --hv-mote-forbi:color-mix(in srgb,var(--hv-brand) 38%,var(--hv-base));
  --hv-upg:var(--hv-ink-2);
  --hv-p-inne:#5DC39F; --hv-p-sjuk:#E98A7F; --hv-p-ledig:#8DB6E4; --hv-p-ej:#5E7068;
  --hub:#0F201B; --hub-brand:#5DC39F; --hub-ink:#ECF2EF; --hub-signal:#E8B15A;
  position:relative;container-type:inline-size;container-name:hv;
  width:100%;min-width:0;height:100%;display:flex;overflow:hidden;
  background:var(--hv-base);color:var(--hv-ink);
  font:400 var(--hv-fs-3)/1.5 var(--f-body);font-variant-numeric:tabular-nums;
}
.hv[data-hvtema="ljus"]{
  --hv-base:#EEF1EC;
  --hv-yta:#F7F9F6; --hv-yta-2:#E3E8E2; --hv-pop:#FFFFFF;
  --hv-ink:#13201C; --hv-ink-2:#44524C; --hv-ink-3:#5A6862;
  --hv-line:rgba(19,32,28,.09); --hv-line-2:rgba(19,32,28,.17); --hv-line-3:#85938B;
  --hv-brand:#0E7A5F; --hv-on-brand:#FFFFFF; --hv-brand-ink:#0A5A46; --hv-brand-soft:#DDEFE6;
  --hv-signal:#D98A1C; --hv-signal-ink:#8A5200; --hv-on-signal:#2A1700; --hv-danger:#C4473C;
  --hv-shadow:0 12px 32px -16px rgba(19,32,28,.28),0 1px 2px rgba(19,32,28,.06);
  --hv-band:#E0E6DF; --hv-band-gatt:#C8D1C9; --hv-tick:#A9B5AD;
  --hv-mote-forbi:#9CC9B8;
  --hv-p-inne:#0E7A5F; --hv-p-sjuk:#C4473C; --hv-p-ledig:#3A6EA5; --hv-p-ej:#A9B5AD;
  --hub:#0F2A22; --hub-brand:#4FD1A5; --hub-ink:#EAF4EE; --hub-signal:#F2B24C;
}
.hv *{box-sizing:border-box}
.hv :where(button){font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0;margin:0;text-align:inherit}
.hv :where(button):disabled{cursor:default;opacity:.5}
.hv :is(button,textarea,input,[tabindex],a):focus-visible{outline:2px solid var(--hv-brand);outline-offset:2px}
.hv :is(h1,h2,h3){text-wrap:balance;margin:0}
.hv p{margin:0;text-wrap:pretty}
.hv .num{font-variant-numeric:tabular-nums}
.hv-i{width:16px;height:16px;flex:none}
.hv-mono{font:500 var(--hv-fs-mono)/1.4 var(--f-mono);letter-spacing:.01em;color:var(--hv-ink-3)}
.hv-dold{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}


/* ---------- Fönstret ---------- */
.hv-fonster{flex:1;min-width:0;display:flex;flex-direction:column;position:relative}
.hv-topp{flex:none;display:flex;align-items:center;gap:var(--hv-s3);height:60px;padding:0 var(--hv-s6);position:relative;z-index:4}
.hv-scen{flex:1;min-height:0;position:relative}
.hv-fot{flex:none;position:relative;z-index:3;display:flex;flex-direction:column;align-items:center;gap:var(--hv-s3);padding:var(--hv-s2) var(--hv-s6) var(--hv-s5)}

/* Knappar: en tyst, en huvudknapp, en länk. :active trycker ned, ingen hover-rörelse. */
.hv-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 12px;border-radius:var(--hv-r1);border:1px solid var(--hv-line-2);font-size:var(--hv-fs-2);font-weight:500;white-space:nowrap;transition:background-color var(--hv-t-snabb) var(--hv-ease),border-color var(--hv-t-snabb) var(--hv-ease),transform var(--hv-t-snabb) var(--hv-ease)}
.hv-btn.pri{background:var(--hv-brand);border-color:transparent;color:var(--hv-on-brand)}
.hv-btn.fx{border-color:color-mix(in srgb,var(--hv-brand) 55%,transparent);color:var(--hv-brand-ink)}
.hv-lank{display:inline-flex;align-items:center;gap:4px;font-size:var(--hv-fs-2);font-weight:500;color:var(--hv-ink-2);min-height:28px;transition:color var(--hv-t-snabb) var(--hv-ease)}
.hv-lank .hv-i{width:14px;height:14px}
@media (hover:hover){
  .hv-btn:not(.pri):hover{background:color-mix(in srgb,var(--hv-ink) 6%,transparent)}
  .hv-btn.pri:hover{background:color-mix(in srgb,var(--hv-brand) 88%,var(--hv-ink))}
  .hv-lank:hover{color:var(--hv-ink)}
}
.hv :is(.hv-btn,.hv-chip,.hv-ik,.hv-send,.hv-stamp,.hv-kn,.hv-pin,.hv-atgk):active:not(:disabled){transform:scale(.97)}

/* ---------- Överraden ---------- */
.hv-meny{display:none;width:36px;height:36px;border-radius:var(--hv-r1);place-items:center}
.hv-lg{display:inline-flex;align-items:center;gap:10px;height:36px;padding:0 10px 0 8px;margin-left:-8px;border-radius:var(--hv-r1);transition:background-color var(--hv-t-snabb) var(--hv-ease)}
.hv-lg b{font:600 var(--hv-fs-5)/1 var(--f-body)}
.hv-lg b small{font-size:var(--hv-fs-1);font-weight:500;color:var(--hv-ink-3)}
.hv-lg .t{font-size:var(--hv-fs-2);color:var(--hv-ink-2)}
.hv-lgbar{display:flex;gap:2px;width:112px;height:4px}
.hv-lgbar i{display:block;height:100%;border-radius:2px;min-width:4px}
.hv-lg .hv-i{width:14px;height:14px;color:var(--hv-ink-3);transform:rotate(90deg);transition:transform var(--hv-t) var(--hv-ease)}
.hv-lg[aria-expanded="true"]{background:var(--hv-yta-2)}
.hv-lg[aria-expanded="true"] .hv-i{transform:rotate(-90deg)}
@media (hover:hover){.hv-lg:hover{background:var(--hv-yta)}}
.hv-dra{position:absolute;top:56px;left:var(--hv-s6);width:min(440px,calc(100% - 32px));background:var(--hv-pop);border:1px solid var(--hv-line-2);border-radius:var(--hv-r2);box-shadow:var(--hv-shadow);padding:6px;animation:hvIn var(--hv-t) var(--hv-ease) both;z-index:6}
.hv-prow{display:grid;grid-template-columns:28px minmax(0,1fr) auto;align-items:center;gap:10px;min-height:40px;padding:0 8px;border-radius:var(--hv-r1)}
.hv-av{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;background:var(--hv-yta-2);font:600 12px var(--f-body);color:var(--hv-ink-2)}
.hv-st{display:inline-flex;align-items:center;gap:6px;font-size:var(--hv-fs-2);color:var(--hv-ink-2);white-space:nowrap}
.hv-st i{width:6px;height:6px;border-radius:50%}
.hv-st small{color:var(--hv-ink-3);font-size:var(--hv-fs-1)}
.hv-topph{margin-left:auto;display:flex;align-items:center;gap:var(--hv-s4)}
.hv-datum{font-size:var(--hv-fs-2);color:var(--hv-ink-2);display:flex;align-items:baseline;gap:8px}
.hv-datum small{font:500 var(--hv-fs-mono) var(--f-mono);color:var(--hv-ink-3)}
.hv-stamp{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 14px;border-radius:var(--hv-r1);background:var(--hv-brand);color:var(--hv-on-brand);font-size:var(--hv-fs-2);font-weight:600;transition:transform var(--hv-t-snabb) var(--hv-ease),background-color var(--hv-t-snabb) var(--hv-ease)}
.hv-stamp.inne{background:none;color:var(--hv-ink-2);border:1px solid var(--hv-line-2);font-weight:500}
.hv-stamp.inne .hv-i{color:var(--hv-brand)}
/* I tråden och arken: Hem, den dockade urtavlan, nästa möte och det som brinner. */
.hv-kn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border-radius:var(--hv-r1);border:1px solid var(--hv-line-2);font-size:var(--hv-fs-2);font-weight:500;transition:transform var(--hv-t-snabb) var(--hv-ease),background-color var(--hv-t-snabb) var(--hv-ease)}
@media (hover:hover){.hv-kn:hover{background:var(--hv-yta)}}
.hv-dock{display:inline-flex;align-items:center;gap:10px;height:36px;padding:0 10px 0 4px;border-radius:var(--hv-r1);font-size:var(--hv-fs-2);color:var(--hv-ink-2)}
.hv-dock b{color:var(--hv-ink);font-weight:500}
@media (hover:hover){.hv-dock:hover{background:var(--hv-yta)}}
.hv-brinn{display:inline-flex;align-items:center;gap:6px;font-size:var(--hv-fs-2);font-weight:500;white-space:nowrap}
.hv-brinn i{width:7px;height:7px;border-radius:50%;background:var(--hv-signal)}
.hv-brinn.lugn i{background:var(--hv-brand)}

/* ---------- Hemmet: tre fält runt urtavlan ---------- */
.hv-hem{position:absolute;inset:0;display:flex;flex-direction:column;overflow-y:auto;overscroll-behavior:contain;padding:var(--hv-s2) var(--hv-s6) var(--hv-s5);transition:opacity var(--hv-t) var(--hv-ease)}
.hv-hemin{width:100%;max-width:1280px;margin:auto;display:grid;grid-template-columns:minmax(0,1.12fr) var(--hv-ur) minmax(0,.92fr);grid-template-areas:"nu ur lage";column-gap:clamp(32px,4vw,64px);align-items:start}
.hv-nu{grid-area:nu;min-width:0}
.hv-urkol{grid-area:ur;display:flex;flex-direction:column;align-items:center}
.hv-lage{grid-area:lage;min-width:0;display:flex;flex-direction:column;gap:28px;padding-top:6px}
.hv-lage>.hv-sek{margin-top:0}
.hv-dagn{margin-left:auto;align-self:center}
@media (max-height:716px){
  .hv{--hv-fs-h1:36px;--hv-fs-tal:42px}
  .hv-sek{margin-top:var(--hv-s5)}
  .hv-lage{gap:var(--hv-s5)}
  .hv-rad{min-height:56px}
  .hv-fot{padding-bottom:var(--hv-s4)}
}
.hv-skriver .hv-hem{opacity:0;visibility:hidden;pointer-events:none;transition:opacity var(--hv-t) var(--hv-ease),visibility 0s var(--hv-t)}

/* Hälsningen bär en mening om läget. Varje del leder dit den handlar om. */
.hv-hero h1{font:600 var(--hv-fs-h1)/1.04 var(--f-display);letter-spacing:-.028em}
.hv-hero>div>p{margin-top:10px;font-size:var(--hv-fs-5);line-height:1.5;color:var(--hv-ink-2);max-width:42ch}
.hv-hero>div>p b{color:var(--hv-ink);font-weight:500}
.hv-herok{display:inline;text-decoration:none;text-decoration-color:var(--hv-line-2);text-decoration-thickness:1px;text-underline-offset:4px;transition:text-decoration-color var(--hv-t-snabb) var(--hv-ease)}
@media (hover:hover){.hv-herok:hover{text-decoration-color:currentColor}}
.hv-lyssna{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 8px;margin-left:6px;border-radius:6px;font-size:var(--hv-fs-1);color:var(--hv-ink-3);vertical-align:2px;transition:background-color var(--hv-t-snabb) var(--hv-ease)}
.hv-lyssna svg{width:9px;height:9px;fill:currentColor}
.hv-lyssna .hv-stopp{width:8px;height:8px;border-radius:2px;background:currentColor}
@media (hover:hover){.hv-lyssna:hover{background:var(--hv-yta);color:var(--hv-ink)}}
.hv-hero .hv-ins.kompakt{display:none}

/* Avsnitten är grupper med linje och luft, inga kort. */
.hv-sek{margin-top:var(--hv-s6)}
.hv-sekh{display:flex;align-items:baseline;gap:8px;padding-bottom:10px;border-bottom:1px solid var(--hv-line)}
.hv-sekh h2{font:600 var(--hv-fs-3)/1.3 var(--f-body);letter-spacing:-.005em}
.hv-sekh .hv-n{font:500 var(--hv-fs-mono) var(--f-mono);color:var(--hv-ink-3)}
.hv-sekh .hv-end{margin-left:auto}
.hv-mark{display:inline-flex;align-self:center}
.hv-rad{display:grid;grid-template-columns:18px minmax(0,1fr) auto;align-items:center;column-gap:10px;min-height:60px;padding:8px 0;border-bottom:1px solid var(--hv-line);transition:opacity var(--hv-t) var(--hv-ease-ut),transform var(--hv-t) var(--hv-ease-ut)}
.hv-rad.ut{opacity:0;transform:translateX(12px)}
.hv-prk{width:8px;height:8px;border-radius:50%;border:1.5px solid var(--hv-line-3);justify-self:center}
.hv-prk.het{background:var(--hv-signal);border-color:var(--hv-signal)}
.hv-radt{display:block;min-width:0;padding:2px 0}
.hv-radt b{display:block;font-size:var(--hv-fs-4);font-weight:500;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hv-radt small{display:block;margin-top:2px;font-size:var(--hv-fs-2);color:var(--hv-ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (hover:hover){.hv-radt:hover b{text-decoration:underline;text-decoration-color:var(--hv-line-3);text-underline-offset:3px}}
.hv-radt:focus-visible{outline-offset:4px;border-radius:4px}
.hv-mer-rad{display:flex;justify-content:space-between;align-items:center;padding-top:6px}
.hv-lugn{display:flex;align-items:center;gap:10px;min-height:52px;color:var(--hv-ink-2);font-size:var(--hv-fs-3)}
.hv-lugn .hv-i{color:var(--hv-brand)}
.hv-start{margin:var(--hv-s3) 0 0;padding:0;list-style:none;border-top:1px solid var(--hv-line)}
.hv-start li{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;min-height:52px;padding:8px 0;border-bottom:1px solid var(--hv-line);font-size:var(--hv-fs-3);color:var(--hv-ink-2)}
.hv-start li b{display:block;color:var(--hv-ink);font-weight:500;font-size:var(--hv-fs-4)}

/* Nav föreslår: ett tal, en mening, en knapp. Källan står i huvudet. */
.hv-fs .hv-fst{display:flex;align-items:baseline;gap:10px;margin-top:var(--hv-s3)}
.hv-fs .hv-fst b{font:600 32px/1 var(--f-display);letter-spacing:-.02em}
.hv-fs .hv-fst span{font-size:var(--hv-fs-4);font-weight:500}
.hv-fs p{margin-top:6px;color:var(--hv-ink-2);max-width:46ch}
.hv-fs .hv-rader{display:flex;align-items:center;gap:var(--hv-s3);margin-top:var(--hv-s3)}

/* Månaden: det säkra talet stort, takten som ett streck, motvikten bredvid. */
.hv-man{display:block;width:100%;text-align:left;border-radius:var(--hv-r2);padding:var(--hv-s3);margin:calc(var(--hv-s3) * -1);transition:background-color var(--hv-t-snabb) var(--hv-ease)}
@media (hover:hover){.hv-man:hover{background:var(--hv-yta)}}
.hv-man:focus-visible{outline-offset:0}
.hv-manh{display:flex;align-items:baseline;gap:8px}
.hv-manh h2{font:600 var(--hv-fs-3)/1.3 var(--f-body)}
.hv-manh .hv-mono{margin-left:auto}
.hv-stor{display:flex;align-items:baseline;gap:10px;margin-top:var(--hv-s2)}
.hv-stor b{font:600 var(--hv-fs-tal)/.95 var(--f-display);letter-spacing:-.035em}
.hv-stor span{font-size:var(--hv-fs-4);color:var(--hv-ink-2)}
.hv-stor .hv-dagn{font:500 var(--hv-fs-mono) var(--f-mono);color:var(--hv-ink-3)}
.hv-mat{position:relative;height:6px;margin-top:var(--hv-s4);border-radius:3px;background:var(--hv-band);overflow:visible}
.hv-mat .nu{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:var(--hv-brand);transform-origin:left center}
.hv-mat .takt{position:absolute;top:-5px;width:2px;height:16px;margin-left:-1px;border-radius:1px;background:var(--hv-ink)}
.hv-mat.steg{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:3px;background:none}
.hv-mat.steg i{display:block;height:6px;border-radius:2px;background:var(--hv-band)}
.hv-mat.steg i.pa{background:var(--hv-brand)}
.hv-mat.steg i.vant{background:color-mix(in srgb,var(--hv-brand) 38%,var(--hv-band))}
.hv-man p{margin-top:var(--hv-s3);color:var(--hv-ink-2);max-width:44ch}
.hv-manf{display:flex;align-items:center;flex-wrap:wrap;gap:4px 12px;margin-top:var(--hv-s3);font-size:var(--hv-fs-2);color:var(--hv-ink-3)}
.hv-manf .hv-lank{margin-left:auto;color:var(--hv-ink-2)}
.hv-andr{display:flex;align-items:center;gap:12px;width:100%;min-height:52px;padding:12px 0;border-top:1px solid var(--hv-line);border-bottom:1px solid var(--hv-line);font-size:var(--hv-fs-2);line-height:1.55;color:var(--hv-ink-2);text-align:left;transition:color var(--hv-t-snabb) var(--hv-ease)}
.hv-andr+.hv-andr{border-top:0}
.hv-andr>span:not(.hv-mark){flex:1;min-width:0}
.hv-andr b{color:var(--hv-ink);font-weight:600;font-size:var(--hv-fs-3)}
.hv-andr .hv-ink{color:var(--hv-ink);font-weight:500}
.hv-andr>.hv-i{flex:none;color:var(--hv-ink-3)}
@media (hover:hover){button.hv-andr:hover{color:var(--hv-ink)}}
.hv-man.tyst{margin:0;padding:0}
.hv-exempel{font:500 var(--hv-fs-mono) var(--f-mono);color:var(--hv-ink-3);padding:3px 6px;border:1px dashed var(--hv-line-3);border-radius:5px}

/* ---------- Urtavlan ---------- */
.hv-ins{position:relative;width:var(--hv-ur);aspect-ratio:1;flex:none}
.hv-ins>svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.hv-ins .r-ring{fill:none;stroke:var(--hv-tick);stroke-width:1}
.hv-ins .r-tick{stroke:var(--hv-tick);stroke-width:1}
.hv-ins .r-tick.h{stroke-width:1.6}
.hv-ins .r-siffra{font:500 10.5px var(--f-mono);fill:var(--hv-ink-3);text-anchor:middle;dominant-baseline:central}
.hv-ins .r-siffra.ande{fill:var(--hv-ink-2)}
.hv-ins .r-band{fill:none;stroke:var(--hv-band);stroke-width:14}
.hv-ins .r-gatt{fill:none;stroke:var(--hv-band-gatt);stroke-width:14}
.hv-ins .m{transition:opacity var(--hv-t-snabb) var(--hv-ease)}
.hv-ins .r-mote{fill:none;stroke:var(--hv-mote);stroke-width:14}
.hv-ins .r-mote.forbi{stroke:var(--hv-mote-forbi)}
.hv-ins .r-upg{fill:none;stroke:var(--hv-upg);stroke-width:5;stroke-linecap:round}
.hv-ins .r-upg.het{stroke:var(--hv-signal)}
.hv-ins .r-frist{stroke:var(--hv-ink);stroke-width:2;stroke-linecap:round}
.hv-ins .r-frist.het{stroke:var(--hv-signal)}
.hv-ins .r-order{fill:var(--hv-brand);stroke:var(--hv-base);stroke-width:2;transform-box:fill-box;transform-origin:center}
.hv-ins .r-vis line{stroke:var(--hv-ink);stroke-width:2;stroke-linecap:round}
.hv-ins .r-vis circle{fill:var(--hv-ink)}
.hv-ins .r-vis{transform-box:view-box;transform-origin:200px 200px;transition:transform var(--hv-t-lugn) var(--hv-ease)}
.hv-ins .r-vis.vilar line{stroke-dasharray:3 4}
.hv-ins.har-hl .m:not(.hl){opacity:.28}
/* Märkena är riktiga knappar ovanpå bilden: 28 px, en ring i fokus, en rad om vad de är. */
.hv-pin{position:absolute;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;z-index:2;transition:transform var(--hv-t-snabb) var(--hv-ease)}
.hv-pin:focus-visible{outline:2px solid var(--hv-brand);outline-offset:0}
@media (hover:hover){.hv-pin:hover{box-shadow:inset 0 0 0 2px var(--hv-ink)}}
.hv-pin.brinn{width:24px;height:24px;margin:-12px 0 0 -12px;background:var(--hv-signal);color:var(--hv-on-signal);font:700 12px/24px var(--f-body);text-align:center;border:2px solid var(--hv-base);z-index:3}
.hv-tip{position:absolute;left:50%;bottom:calc(100% + 8px);transform:translate(-50%,4px);opacity:0;pointer-events:none;white-space:nowrap;background:var(--hv-pop);color:var(--hv-ink);border:1px solid var(--hv-line-2);border-radius:var(--hv-r1);padding:6px 10px;font:500 12px/1.35 var(--f-body);text-align:left;box-shadow:var(--hv-shadow);transition:opacity var(--hv-t-snabb) var(--hv-ease),transform var(--hv-t-snabb) var(--hv-ease);z-index:7}
.hv-tip small{display:block;font-weight:400;color:var(--hv-ink-3)}
.hv-pin:is(:hover,:focus-visible) .hv-tip,.hv-pin.hl .hv-tip{opacity:1;transform:translate(-50%,0)}
.hv-mitt{position:absolute;left:50%;top:50%;width:44%;transform:translate(-50%,-52%);display:flex;flex-direction:column;align-items:center;text-align:center;border-radius:50%;padding:6px 0}
button.hv-mitt{cursor:pointer}
.hv-mitt .l{font-size:var(--hv-fs-1);color:var(--hv-ink-3)}
.hv-mitt .k{font:500 calc(var(--hv-ur) * .095)/1.08 var(--f-body);letter-spacing:-.035em;margin-top:2px}
.hv-mitt .v{max-width:100%;margin-top:4px;font-size:var(--hv-fs-3);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hv-mitt .s{margin-top:1px;font-size:var(--hv-fs-1);color:var(--hv-ink-3)}
.hv-mitt .hv-lank{margin-top:6px;color:var(--hv-brand-ink)}
.hv-nyckel{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px 14px;margin-top:var(--hv-s3);font:500 var(--hv-fs-mono)/1 var(--f-mono);color:var(--hv-ink-3)}
.hv-nyckel span{display:inline-flex;align-items:center;gap:6px}
.hv-nyckel i{display:inline-block}
.hv-nyckel .k-mote{width:12px;height:6px;background:var(--hv-mote)}
.hv-nyckel .k-upg{width:12px;height:3px;border-radius:2px;background:var(--hv-upg)}
.hv-nyckel .k-brinn{width:7px;height:7px;border-radius:50%;background:var(--hv-signal)}
.hv-nyckel .k-order{width:7px;height:7px;border-radius:50%;background:var(--hv-brand)}
.hv-nyckel .hv-lank{font:500 var(--hv-fs-2) var(--f-body)}
.hv-dagval{display:inline-flex;gap:2px;padding:2px;border-radius:9px;background:var(--hv-yta)}
.hv-dagval button{height:28px;padding:0 12px;border-radius:7px;font-size:var(--hv-fs-1);font-weight:500;color:var(--hv-ink-2)}
.hv-dagval button[aria-pressed="true"]{background:var(--hv-pop);color:var(--hv-ink);box-shadow:0 1px 2px rgba(0,0,0,.12)}
.hv-ins.mini{width:30px;display:block}
.hv-ins.mini :is(.r-band,.r-gatt,.r-mote){stroke-width:46}
.hv-ins.mini .r-ring{display:none}
.hv-ins.mini .r-vis line{stroke-width:26;stroke-linecap:butt}
.hv-ins.mini :is(.r-upg,.r-order,.r-frist){display:none}
.hv-ins.kompakt{width:112px}
.hv-ins.kompakt .hv-mitt .k{font-size:17px}
.hv-ins.ark{--hv-ur:min(360px,42cqw)}

/* ---------- Genvägar och skrivrutan ---------- */
.hv-genv{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;max-width:760px}
.hv-chip{display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 12px;border-radius:10px;border:1px solid var(--hv-line-2);font-size:var(--hv-fs-2);font-weight:500;white-space:nowrap;transition:background-color var(--hv-t-snabb) var(--hv-ease),transform var(--hv-t-snabb) var(--hv-ease)}
.hv-chip small{font:500 var(--hv-fs-mono) var(--f-mono);color:var(--hv-ink-3)}
.hv-chip.ai{border-color:color-mix(in srgb,var(--hv-brand) 50%,transparent)}
@media (hover:hover){.hv-chip:hover{background:var(--hv-yta)}}
.hv-merv{position:relative}
.hv-mer{position:absolute;bottom:42px;right:0;min-width:200px;padding:6px;background:var(--hv-pop);border:1px solid var(--hv-line-2);border-radius:var(--hv-r2);box-shadow:var(--hv-shadow);animation:hvIn var(--hv-t) var(--hv-ease) both;z-index:6}
.hv-mer button{display:flex;width:100%;align-items:center;height:36px;padding:0 10px;border-radius:6px;font-size:var(--hv-fs-2)}
@media (hover:hover){.hv-mer button:hover{background:var(--hv-yta-2)}}
.hv-skriv{position:relative;width:100%;max-width:760px;background:var(--hv-pop);border:1px solid var(--hv-line-2);border-radius:var(--hv-r3);padding:12px 10px 8px 16px;box-shadow:var(--hv-shadow);transition:border-color var(--hv-t-snabb) var(--hv-ease)}
.hv-skriv:focus-within{border-color:var(--hv-brand)}
.hv-skriv textarea{display:block;width:100%;height:24px;max-height:160px;margin:0;padding:0;border:0;outline:0;resize:none;background:none;color:var(--hv-ink);font:400 var(--hv-fs-5)/1.5 var(--f-body)}
.hv-skriv textarea::placeholder{color:var(--hv-ink-3)}
.hv .hv-skriv textarea:focus-visible{outline:0}
.hv-srad{display:flex;align-items:center;gap:2px;margin-top:8px}
.hv-ik{width:32px;height:32px;border-radius:var(--hv-r1);display:grid;place-items:center;color:var(--hv-ink-2);transition:background-color var(--hv-t-snabb) var(--hv-ease),transform var(--hv-t-snabb) var(--hv-ease)}
.hv-ik[aria-pressed="true"]{background:var(--hv-brand-soft);color:var(--hv-brand-ink)}
@media (hover:hover){.hv-ik:hover{background:var(--hv-yta-2);color:var(--hv-ink)}}
.hv-tips{flex:1;min-width:0;height:32px;padding:0 6px;text-align:left;font-size:var(--hv-fs-2);color:var(--hv-ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:6px}
@media (hover:hover){.hv-tips:hover{color:var(--hv-ink-2)}}
.hv-kbd{font:500 var(--hv-fs-mono) var(--f-mono);color:var(--hv-ink-3);padding:0 8px}
.hv-send{width:32px;height:32px;border-radius:10px;display:grid;place-items:center;background:var(--hv-brand);color:var(--hv-on-brand);margin-left:4px;transition:transform var(--hv-t-snabb) var(--hv-ease)}
.hv-send.stopp{background:var(--hv-ink);color:var(--hv-base)}
.hv-send.stopp .hv-i{width:14px;height:14px}
.hv-bilagor{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.hv-bil{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 4px 0 10px;border-radius:6px;background:var(--hv-yta-2);font-size:var(--hv-fs-1)}
.hv-bil button{width:20px;height:20px;border-radius:4px;display:grid;place-items:center;color:var(--hv-ink-3)}
/* Medan man skriver: det som matchar i hemmet (regel) och frågan till Nav (AI), i samma lista. */
.hv-traff{width:100%;max-width:760px;padding:6px;background:var(--hv-pop);border:1px solid var(--hv-line-2);border-radius:var(--hv-r2);box-shadow:var(--hv-shadow);animation:hvIn var(--hv-t) var(--hv-ease) both}
.hv-traff p.hv-mono{padding:6px 10px 4px}
.hv-tr{display:grid;grid-template-columns:20px minmax(0,1fr) auto;align-items:center;gap:10px;width:100%;min-height:40px;padding:0 10px;border-radius:var(--hv-r1);text-align:left;font-size:var(--hv-fs-3)}
.hv-tr[aria-selected="true"]{background:var(--hv-yta-2)}
.hv-tr .hv-mono{white-space:nowrap}
.hv-tr mark{background:none;color:inherit;font-weight:600;text-decoration:underline;text-decoration-color:var(--hv-brand);text-underline-offset:3px}
.hv-tr .t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hv-tr .hv-i{color:var(--hv-ink-3)}
.hv-hint{font:500 var(--hv-fs-mono) var(--f-mono);color:var(--hv-ink-3);padding:6px 10px 2px;display:flex;gap:14px;flex-wrap:wrap}
.hv-toast{position:absolute;left:50%;bottom:calc(100% + 4px);transform:translateX(-50%);display:flex;align-items:center;gap:10px;min-height:40px;padding:4px 6px 4px 14px;background:var(--hv-pop);border:1px solid var(--hv-line-2);border-radius:var(--hv-r2);box-shadow:var(--hv-shadow);font-size:var(--hv-fs-2);white-space:nowrap;animation:hvIn var(--hv-t) var(--hv-ease) both}
.hv-toast .hv-ok{color:var(--hv-brand)}

/* ---------- Tråden ---------- */
.hv-trad{position:absolute;inset:0;overflow-y:auto;overscroll-behavior:contain;padding:var(--hv-s4) var(--hv-s6) var(--hv-s6)}
.hv-tcol{max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:var(--hv-s6)}
.hv-tur{display:flex;flex-direction:column;gap:var(--hv-s4)}
.hv-q{align-self:flex-end;max-width:80%;padding:10px 14px;border-radius:16px 16px 4px 16px;background:var(--hv-yta-2);font-size:var(--hv-fs-4);line-height:1.5}
.hv-q small{display:block;margin-top:4px;font:500 var(--hv-fs-mono) var(--f-mono);color:var(--hv-ink-3)}
.hv-navs{display:grid;grid-template-columns:24px minmax(0,1fr);gap:14px;align-items:start}
.hv-navs>svg{margin-top:1px}
.hv-navs>div{min-width:0;display:flex;flex-direction:column;gap:var(--hv-s3)}
.hv-svar p{font-size:var(--hv-fs-4);line-height:1.62;max-width:66ch}
.hv-svar p+p{margin-top:10px}
.hv-siffra{font:inherit;font-weight:500;color:var(--hv-ink);text-decoration:underline;text-decoration-color:var(--hv-brand);text-decoration-thickness:1.5px;text-underline-offset:3px;border-radius:3px;padding:0 1px}
.hv-siffra[aria-expanded="true"]{background:var(--hv-brand-soft)}
.hv-obel{background:none;color:inherit;text-decoration:underline dotted var(--hv-signal-ink);text-decoration-thickness:1.5px;text-underline-offset:3px}
.hv-talk{border-left:2px solid var(--hv-brand);padding:2px 0 2px 10px;animation:hvIn var(--hv-t) var(--hv-ease) both}
.hv-tank{font-size:var(--hv-fs-2);color:var(--hv-ink-3)}
.hv-stegk{display:inline-flex;align-items:center;gap:6px;height:24px;font-size:var(--hv-fs-1);color:var(--hv-ink-3);border-radius:6px;padding-right:6px}
.hv-stegk .hv-i{width:12px;height:12px;transition:transform var(--hv-t) var(--hv-ease)}
.hv-stegk[aria-expanded="true"] .hv-i{transform:rotate(90deg)}
@media (hover:hover){.hv-stegk:hover{color:var(--hv-ink-2)}}
.hv-tsteg{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.hv-tsteg li{display:grid;grid-template-columns:16px minmax(0,1fr) auto;gap:8px;align-items:start;font-size:var(--hv-fs-2);color:var(--hv-ink-2);animation:hvIn var(--hv-t-snabb) var(--hv-ease) both}
.hv-tsteg li>i{width:14px;height:14px;margin-top:2px;border-radius:50%;display:grid;place-items:center}
.hv-tsteg li.ok>i{color:var(--hv-brand)}
.hv-tsteg li.ok>i .hv-i{width:14px;height:14px}
.hv-tsteg li.gar>i{border:1.5px solid var(--hv-line-3)}
.hv-tsteg li.fel>i{border:1.5px solid var(--hv-danger)}
.hv-tsteg small{display:block;font:500 var(--hv-fs-mono) var(--f-mono);color:var(--hv-ink-3);margin-top:2px}
.hv-tsteg .num{font:500 var(--hv-fs-mono) var(--f-mono);color:var(--hv-ink-3)}
.hv-markor{display:inline-block;width:8px;height:1.05em;margin-left:2px;vertical-align:-2px;background:var(--hv-ink-3);border-radius:1px}
.hv-kalla{font:500 var(--hv-fs-mono) var(--f-mono);color:var(--hv-ink-3)}
.hv-atg{display:flex;align-items:center;flex-wrap:wrap;gap:2px 4px;margin-left:-8px}
.hv-atgk{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 8px;border-radius:6px;font-size:var(--hv-fs-1);font-weight:500;color:var(--hv-ink-2);transition:background-color var(--hv-t-snabb) var(--hv-ease),transform var(--hv-t-snabb) var(--hv-ease)}
.hv-atgk .hv-i{width:14px;height:14px}
@media (hover:hover){.hv-atgk:hover{background:var(--hv-yta);color:var(--hv-ink)}}
.hv-atgtid{margin-left:auto;font:500 var(--hv-fs-mono) var(--f-mono);color:var(--hv-ink-3)}
.hv-fel{display:flex;flex-direction:column;gap:10px}
/* Godkänn-kortet: vad som görs, i siffror ur kortet, inte ur AI:ns text. Inget görs förrän någon trycker. */
.hv-utk{border:1px solid var(--hv-line-2);border-radius:var(--hv-r2);background:var(--hv-yta);padding:14px 16px;display:flex;flex-direction:column;gap:12px}
.hv-utkh{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.hv-utkh b{font-size:var(--hv-fs-4);font-weight:600}
.hv-utkh .hv-mono{margin-left:auto}
.hv-utk ul{list-style:none;margin:0;padding:0;border-top:1px solid var(--hv-line)}
.hv-utk li{display:grid;grid-template-columns:18px minmax(0,1fr) auto;align-items:center;gap:8px;min-height:40px;border-bottom:1px solid var(--hv-line);font-size:var(--hv-fs-3)}
.hv-utk li small{font:500 var(--hv-fs-mono) var(--f-mono);color:var(--hv-ink-3)}
.hv-utk li .hv-ok{color:var(--hv-brand)}
.hv-utk li>i{width:14px;height:14px;border-radius:50%;border:1.5px solid var(--hv-line-3)}
.hv-utk li.gjord>i{border:0}
.hv-utkrad{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.hv-utkrad .hv-tank{margin-left:4px}
.hv-kvi{display:inline-flex;align-items:center;gap:8px;font-size:var(--hv-fs-3);font-weight:500}
.hv-kvi .hv-ok{width:20px;height:20px;border-radius:50%;background:var(--hv-brand);color:var(--hv-on-brand);display:grid;place-items:center;animation:hvKvitto var(--hv-t) var(--hv-ease) both}
.hv-kvi .hv-ok .hv-i{width:13px;height:13px}
.hv-nere{position:sticky;bottom:8px;align-self:center;display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:16px;background:var(--hv-pop);border:1px solid var(--hv-line-2);box-shadow:var(--hv-shadow);font-size:var(--hv-fs-1);font-weight:500;animation:hvIn var(--hv-t) var(--hv-ease) both}
.hv-nere .hv-i{width:12px;height:12px;transform:rotate(90deg)}
.hv-lista{border-top:1px solid var(--hv-line)}
.hv-sak{display:grid;grid-template-columns:28px minmax(0,1fr) auto;align-items:center;gap:10px;min-height:52px;padding:6px 0;border-bottom:1px solid var(--hv-line)}
.hv-sak b{display:block;font-weight:500}
.hv-sak small{display:block;font-size:var(--hv-fs-2);color:var(--hv-ink-3)}

/* ---------- Arken ---------- */
.hv-ark{position:absolute;inset:0;overflow-y:auto;overscroll-behavior:contain;padding:var(--hv-s3) var(--hv-s6) var(--hv-s5)}
.hv-arkin{max-width:1120px;margin:0 auto}
.hv-arkhuvud{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:14px;align-items:start;padding-bottom:var(--hv-s5)}
.hv-arkhuvud h2{font:600 22px/1.25 var(--f-display);letter-spacing:-.02em;max-width:40ch}
.hv-arkhuvud h2 b{font-weight:600;color:var(--hv-brand-ink)}
.hv-arkhuvud .hv-kn kbd{font:500 var(--hv-fs-mono) var(--f-mono);color:var(--hv-ink-3)}
.hv-dag{display:grid;grid-template-columns:auto minmax(0,1fr);gap:clamp(32px,5cqw,72px);align-items:start}
.hv-dag .hv-ins{position:sticky;top:0}
.hv-dlista{border-top:1px solid var(--hv-line)}
.hv-drad{display:grid;grid-template-columns:64px 14px minmax(0,1fr) auto;align-items:center;gap:12px;min-height:52px;padding:6px 8px;margin:0 -8px;border-bottom:1px solid var(--hv-line);border-radius:6px;transition:background-color var(--hv-t-snabb) var(--hv-ease),opacity var(--hv-t-snabb) var(--hv-ease)}
.hv-drad.hl{background:var(--hv-yta)}
.hv-drad.forbi .hv-vad b,.hv-drad.forbi .hv-kl{color:var(--hv-ink-3);font-weight:400}
.hv-drad.forbi .hv-pk{opacity:.45}
.hv-rad.hl .hv-radt b{color:var(--hv-brand-ink)}
.hv-kl{font:500 var(--hv-fs-2) var(--f-body);color:var(--hv-ink-2)}
.hv-kl small{display:block;font:500 var(--hv-fs-mono) var(--f-mono);color:var(--hv-ink-3)}
.hv-pk{width:12px;height:12px;justify-self:center}
.hv-drad.mote .hv-pk{background:var(--hv-mote);border-radius:2px}
.hv-drad.upg .hv-pk{height:4px;border-radius:2px;background:var(--hv-upg)}
.hv-drad.upg.het .hv-pk{background:var(--hv-signal)}
.hv-drad.utan .hv-pk{height:4px;border-radius:2px;background:var(--hv-line-3)}
.hv-vad b{display:block;font-weight:500;font-size:var(--hv-fs-4)}
.hv-vad small{display:block;font-size:var(--hv-fs-2);color:var(--hv-ink-3)}
.hv-dnu{display:flex;align-items:center;gap:10px;height:28px;font:500 var(--hv-fs-mono) var(--f-mono);color:var(--hv-ink)}
.hv-dnu::after{content:"";flex:1;height:2px;border-radius:1px;background:var(--hv-ink)}
.hv-arkfot{display:flex;align-items:center;gap:12px;flex-wrap:wrap;min-height:56px;margin-top:var(--hv-s4);font-size:var(--hv-fs-2);color:var(--hv-ink-2)}
.hv-arkfot .hv-end{margin-left:auto;display:flex;gap:8px}
.hv-grupp{display:flex;align-items:baseline;gap:8px;padding:var(--hv-s5) 0 8px;border-bottom:1px solid var(--hv-line);font-size:var(--hv-fs-2);font-weight:600;color:var(--hv-ink-2)}
.hv-grupp:first-child{padding-top:0}
.hv-grupp small{font:500 var(--hv-fs-mono) var(--f-mono);color:var(--hv-ink-3)}
.hv-vecka{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}
.hv-vdag{display:flex;flex-direction:column;gap:8px;min-height:220px;padding:12px;border:1px solid var(--hv-line);border-radius:var(--hv-r2);text-align:left;transition:background-color var(--hv-t-snabb) var(--hv-ease)}
.hv-vdag.idag{border-color:var(--hv-brand)}
.hv-vdag header{display:flex;align-items:baseline;gap:6px}
.hv-vdag header b{font-weight:600}
.hv-vdag header span{margin-left:auto;font:500 var(--hv-fs-mono) var(--f-mono);color:var(--hv-ink-3)}
.hv-vdag i{display:block;font-style:normal;font-size:var(--hv-fs-1);padding:4px 6px;border-left:2px solid var(--hv-mote);background:var(--hv-yta)}
@media (hover:hover){.hv-vdag:hover{background:var(--hv-yta)}}

/* ---------- Rörelse: återkoppling och det som tar plats. Bara transform och opacitet. ---------- */
@keyframes hvIn{from{opacity:0;transform:translateY(6px)}}
@keyframes hvTona{from{opacity:0}}
@keyframes hvRull{from{opacity:0;transform:translateY(5px)}}
@keyframes hvPop{from{opacity:0;transform:scale(.4)}}
@keyframes hvKvitto{from{opacity:0;transform:scale(.6)}}
.hv.in .an{animation:hvIn var(--hv-t) var(--hv-ease) both;animation-delay:calc(var(--i,0) * 30ms)}
.hv.in .hv-ins .m{animation:hvTona var(--hv-t) var(--hv-ease) both;animation-delay:calc(90ms + var(--i,0) * 24ms)}
.hv-ins .r-order.ny{animation:hvPop var(--hv-t) var(--hv-ease) both}
.hv .rull{display:inline-block;animation:hvRull var(--hv-t) var(--hv-ease) both}
.hv-lager-in{animation:hvIn var(--hv-t) var(--hv-ease) both}

/* ---------- Bredd: tre fält, två fält, en spalt ---------- */
@container hv (max-width:1180px){
  .hv-hemin{grid-template-columns:minmax(0,1fr) var(--hv-ur);grid-template-areas:"nu ur" "lage ur";row-gap:var(--hv-s6)}
  .hv-lage{padding-top:0}
}
@container hv (max-width:860px){
  .hv-meny{display:grid}
  .hv-topp{padding:0 var(--hv-s4);height:56px}
  .hv-lg{margin-left:0}
  .hv-lg .t,.hv-lgbar,.hv-datum{display:none}
  .hv-dra{left:var(--hv-s4)}
  .hv-hem,.hv-trad,.hv-ark{padding-left:var(--hv-s4);padding-right:var(--hv-s4)}
  .hv-hemin{display:block}
  .hv-urkol{display:none}
  .hv-hero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--hv-s4);align-items:start}
  .hv-hero .hv-ins.kompakt{display:block}
  .hv-hero h1{font-size:28px}
  .hv-hero>div>p{font-size:var(--hv-fs-4)}
  .hv-lage{margin-top:var(--hv-s6)}
  .hv-rad{grid-template-columns:18px minmax(0,1fr) auto}
  .hv-btn{height:40px}
  .hv-fot{padding:var(--hv-s2) 0 0}
  .hv-skriv{max-width:none;border-radius:var(--hv-r3) var(--hv-r3) 0 0;border-bottom:0;padding-bottom:calc(6px + env(safe-area-inset-bottom,0px))}
  .hv-genv{flex-wrap:nowrap;justify-content:flex-start;overflow-x:auto;max-width:100%;width:100%;padding:0 var(--hv-s2);scrollbar-width:none}
  .hv-genv::-webkit-scrollbar{display:none}
  .hv-chip{height:40px}
  .hv-skriv{padding-left:14px;padding-right:8px}
  .hv-ik,.hv-send{width:40px;height:40px}
  .hv-kbd{display:none}
  .hv-mer{right:auto;left:0;bottom:46px}
  .hv-dag{grid-template-columns:1fr}
  .hv-dag .hv-ins{position:relative;justify-self:center;--hv-ur:240px}
  .hv-vecka{grid-template-columns:1fr}
  .hv-vdag{min-height:0}
  .hv-arkhuvud h2{font-size:18px}
  .hv-dock .s{display:none}
  .hv-q{max-width:92%}
  .hv-mitt .k{font-size:28px}
}
@container hv (max-width:420px){
  .hv-stamp .lang{display:none}
  .hv-arkhuvud{grid-template-columns:minmax(0,1fr) auto}
  .hv-arkhuvud>svg{display:none}
}
@media (prefers-reduced-motion:reduce){
  .hv *,.hv *::before,.hv *::after{animation:none !important;transition:none !important}
}
`;
// Skissens stil i avsnitt (efter kommentarerna "---------- Namn ----------"), varje avsnitt i regler på översta nivån.
const skissAvsnitt = (() => {
  const ut = [];
  for (const del of SKISS_CSS.split(/\/\* -{10} ([^*]*?) -{10} \*\//).reduce((a, x, i, all) => (i % 2 ? a.push([x, all[i + 1]]) : 0, a), [])) {
    const [namn, text] = del, regler = [], t = utanKommentar(text);
    let d = 0, s = 0;
    for (let j = 0; j < t.length; j++) { if (t[j] === "{") d++; else if (t[j] === "}" && --d === 0) { regler.push(norm(t.slice(s, j + 1))); s = j + 1; } }
    ut.push([namn, regler.filter(Boolean)]);
  }
  return ut;
})();
rubrik("Menyraden går ihop med fönstrets topp (klickprovet 2026-11-16)", "MENYRAD");
{
  // Rälsen stod top:34px och 100vh − 34px för utkastets provremsa (.proto), som är dold i den riktiga Nav.
  // Rälsen slutade då 34 px under fönstrets överkant. Remsans höjd är nu en variabel som är noll i den riktiga Nav.
  ok("remsans höjd är en variabel: 34 px i utkastet, 0 i den riktiga Nav", /(?:^|[;\s])--proto-h:34px(?:;|\s|$)/.test(regel(":root") ?? "") && /(?:^|;)--proto-h:0px(?:;|$)/.test(regel("body.nd-riktig") ?? ""), regel("body.nd-riktig"));
  ok("rälsen står under remsan och fyller resten av höjden", /position:sticky;top:var\(--proto-h\);height:calc\(100vh - var\(--proto-h\)\)/.test(regel("#rail.rls") ?? "") && /position:sticky;top:var\(--proto-h\);height:calc\(100vh - var\(--proto-h\)\)/.test(regel(".rail") ?? ""));
  ok("den fästa att göra-panelen och hopplänken likaså", /top:var\(--proto-h\)/.test(regel("#todoPanel.pinned") ?? "") && /top:calc\(var\(--proto-h\) \+ 10px\)/.test(regel("#rail .rls-hopp") ?? ""));
  ok("inget annat räknar längre med remsans 34 px på bred skärm", !/(?:top:34px|100vh - 34px\))/.test(html.replace(/\.ol\{height:calc\(100vh - 34px - 64px\)\}/, "")));
}

rubrik("Skissens stil, tecken för tecken (kontraktet §2.2 och §3)", "MARKUP");
{
  // Varje regel i skissens stil.css rad 33–497 står i hemmets stil, med samma tecken. Mellanrum vid radbrytningar och
  // kommentarer räknas inte. .hv-nyckel och .hv-dagval får stå kvar som död stil eller utgå (§3); .hv-herok prövas för sig.
  const har = norm(hemCss);
  const valfri = (r) => /^(?:\.hv-nyckel|\.hv-dagval)\b/.test(r) || r.startsWith(".hv-herok{");
  for (const [namn, regler] of skissAvsnitt) {
    const saknas = regler.filter((r) => !valfri(r) && !har.includes(r));
    okM(`${namn}: ${regler.filter((r) => !valfri(r)).length} regler som i skissen`, hemCss.length > 0 && saknas.length === 0, saknas.slice(0, 3).join("  |  "));
  }
}

rubrik("Stilens ändringar mot skissen är bara kontraktets (§3)", "MARKUP");
{
  okM("urtavlans storlek följer fönstrets höjd, utan skissens reglagerad", (regel(".hv", hemCss) ?? "").includes("--hv-ur:clamp(232px, calc(100dvh - 292px), 432px);") && !/--sk-h|\.sk-|\.sk\{/.test(utanKommentar(hemCss)));
  okM("höjdregeln slår till vid 716 px, inte 760", /@media \(max-height:716px\)\{/.test(hemCss) && !hemCss.includes("(max-height:760px)"));
  okM("containerfrågorna 1180, 860 och 420 finns, 1240 och 960 inte", ["1180", "860", "420"].every((b) => hemCss.includes(`@container hv (max-width:${b}px){`)) && !/@container hv \(max-width:(?:1240|960)px\)/.test(hemCss));
  okM("ingen platshållare för menyraden i hemmets stil", !/\.hv-rail\b/.test(hemCss));
  okM("två fält under 1180: urtavlan till höger om hälsningen och läget", norm(cssBlock(hemCss, "@container hv (max-width:1180px)")) === norm(cssBlock(SKISS_CSS, "@container hv (max-width:1180px)")), cssBlock(hemCss, "@container hv (max-width:1180px)"));
  okM("en spalt under 860, och smalast under 420, som skissen", norm(cssBlock(hemCss, "@container hv (max-width:860px)")) === norm(cssBlock(SKISS_CSS, "@container hv (max-width:860px)")) && norm(cssBlock(hemCss, "@container hv (max-width:420px)")) === norm(cssBlock(SKISS_CSS, "@container hv (max-width:420px)")), cssBlock(hemCss, "@container hv (max-width:860px)").slice(0, 300));
  okM("låg skärm: mindre rubrik och tal, tätare avsnitt", norm(cssBlock(hemCss, "@media (max-height:716px)")) === norm(cssBlock(SKISS_CSS, "@media (max-height:716px)")), cssBlock(hemCss, "@media (max-height:716px)"));
  // v2: lägesmeningens länkar har inga streck under sig. De är fortfarande knappar.
  const herok = regel(".hv-herok", hemCss) ?? "";
  okM("v2: lägesmeningens länkar har ingen understrykning", /(?:^|;)text-decoration:none(?:;|$)/.test(herok) && !/text-decoration:underline/.test(herok) && !/\.hv-herok\{[^}]*text-decoration:underline/.test(hemCss), herok);
}

rubrik("Nästa att göra (punkt 28)", "MENYRAD");
{
  ok("ihopfälld är den 46 px och står 28 px från kanterna", regel("body.hvbody .todopill.min") === "right:28px;bottom:calc(28px + env(safe-area-inset-bottom,0px));padding:0;width:46px;height:46px;box-shadow:0 0 0 1px rgba(255,255,255,.14),0 8px 22px rgba(19,32,28,.22)", regel("body.hvbody .todopill.min"));
  ok("talet 600 11px", regel("body.hvbody .todopill.min .pmin") === "width:46px;height:46px;font:600 11px var(--f-body)");
  ok("ringen 38 px, 4 px in", regel("body.hvbody .todopill.min .pmin svg") === "inset:4px;width:38px;height:38px");
}

rubrik("Skiss A: fönstret, arken och tråden");
{
  okM("scenen tar ytan mellan överraden och foten", regel(".hv-scen", hemCss) === "flex:1;min-height:0;position:relative", regel(".hv-scen", hemCss));
  okM("tråden rullar i sig själv och fyller scenen", regel(".hv-trad", hemCss) === "position:absolute;inset:0;overflow-y:auto;overscroll-behavior:contain;padding:var(--hv-s4) var(--hv-s6) var(--hv-s6)", regel(".hv-trad", hemCss));
  okM("arket rullar i sig själv och fyller scenen", regel(".hv-ark", hemCss) === "position:absolute;inset:0;overflow-y:auto;overscroll-behavior:contain;padding:var(--hv-s3) var(--hv-s6) var(--hv-s5)" && regel(".hv-arkin", hemCss) === "max-width:1120px;margin:0 auto", regel(".hv-ark", hemCss));
  okR("ingen klistrad botten längre", !/\.hv-botten\{/.test(html));
  const g = hem({ chef: true });
  const h = g.hvHem();
  // Skissen har <main class="hv-scen">. I Nav står hemmet redan inne i <main class="main">, och två main i varandra är
  // ogiltig HTML, så <div class="hv-scen"> godtas också (en avvikelse som ska stå i .lyft/avvikelser.md).
  const scenA = h.search(/<(?:main|div) class="hv-scen">/), fotA = h.indexOf('<div class="hv-fot">');
  okM("på hemmet står genvägarna och skrivrutan i foten under scenen, inte i den", scenA >= 0 && scenA < fotA && !h.slice(scenA, fotA).includes('class="hv-genv"') && fotA < h.indexOf('class="hv-genv"') && h.indexOf('class="hv-genv"') < h.indexOf("data-hvskriv"));
  g.hvOppna("vantar");
  const a = g.hvHem();
  // Klickprovet 2026-11-16: Navs kbd-ruta gav esc ram och luft (knappen 102 px mot skissens 88), och raden var 30 px
  // mot skissens 34 (märket står i ett block som är 34 högt), så arket började 4 px för högt.
  okM("Stäng esc: esc är ren mono-text som i skissen", regel(".hv-arkhuvud .hv-kn kbd", hemCss) === "font:500 var(--hv-fs-mono) var(--f-mono);color:var(--hv-ink-3)", regel(".hv-arkhuvud .hv-kn kbd", hemCss));
  okM("arkhuvudet: märket, texten och Stäng i tre kolumner", regel(".hv-arkhuvud", hemCss) === "display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:14px;align-items:start;padding-bottom:var(--hv-s5)", regel(".hv-arkhuvud", hemCss));
  okM("ett ark har Navs märke, texten som rubrik och Stäng esc", /<div class="hv-arkhuvud an" style="--i:0"><svg[^>]*>[\s\S]*?<\/svg><h2 id="hvArktext">[\s\S]*?<\/h2><button class="hv-kn" data-hvstang>Stäng <kbd>esc<\/kbd><\/button><\/div>/.test(a), a.match(/<div class="hv-arkhuvud[\s\S]*?<\/div>/)?.[0]);
  okM("arket ligger i scenen, i full bredd", /<(?:main|div) class="hv-scen"><div class="hv-ark" id="hvArk"><div class="hv-arkin"><div class="hv-arkhuvud an"/.test(a));
  ok("i ett ark syns inga genvägar, men skrivrutan", !a.includes('class="hv-genv"') && a.includes("data-hvskriv"));
  okR("det gamla ‹ Hem finns inte", !/hv-arktopp|hv-bak/.test(html));
  const t = hem({ chef: true });
  t.hvOppna("team"); t.hvOppna("andrat");
  const th = t.hvHem();
  ok("Teamet och sedan Ändrat ligger båda i tråden, i den ordningen", t.S.hv.trad.map((x) => x.sort).join() === "team,andrat" && th.indexOf('data-hvinl="team"') < th.indexOf('data-hvinl="andrat"'), t.S.hv.trad.map((x) => x.sort).join());
  okM("överst i tråden: ← Hem, den dockade urtavlan med nästa möte, och hur mycket som brinner", utanIkon(th).includes(SK.T_topp) && /<header class="hv-topp"><button class="hv-meny"[^>]*>[\s\S]*?<\/button><button class="hv-kn" data-hvstang>/.test(th), utanIkon(th).match(/<header class="hv-topp">[\s\S]*?<\/header>/)?.[0]);
  t.hvStang();
  ok("Hem tömmer inte tråden", t.S.hv.ark === null && t.S.hv.trad.length === 2 && !t.hvHem().includes('class="hv-dock"'));
  const lugn = hem({ chef: true, rader: [] }); lugn.hvOppna("team");
  okM("inget som brinner: grön prick och Inget brinner", lugn.hvHem().includes(SK.T_lugn), lugn.hvHem().match(/<button class="hv-kn hv-brinn[\s\S]*?<\/button>/)?.[0]);
  ok("Escape går hem från tråden när rutan är tom", /if \(e\.key === 'Escape' && S\.hv\.ark && !hvOvanpa\(\) && !String\(S\.hv\.q \|\| ''\)\.trim\(\)\)/.test(html));
}

rubrik("Skiss A: genvägarna och Mer");
{
  const pa = hem({ chef: true }); pa.ND.hem.chatt = true;
  const gv = pa.hvHem().match(/<div class="hv-genv"[^>]*>[\s\S]*?<\/span><\/div>/)?.[0] ?? "";
  okM("chatten på och ett möte kvar i dag: Förbered först, med märket, sedan Min dag och Veckan", /^<div class="hv-genv" role="toolbar" aria-label="Genvägar"><button class="hv-chip ai" data-hvforbered="Förbered mitt möte 11\.00 med PEGU Byggservice" title="PEGU Byggservice"><svg[^>]*>[\s\S]*?<\/svg>Förbered 11\.00 · PEGU…<\/button><button class="hv-chip" data-hvark="dag">Min dag<\/button><button class="hv-chip" data-hvark="vecka">Veckan som kommer<\/button>/.test(gv), gv.slice(0, 400));
  const inget = hem({ chef: true }); inget.ND.hem.chatt = true; inget.ndHemKal = () => [];
  okM("inget möte kvar: Vem ska jag ringa nu?", /<button class="hv-chip ai" data-hvforbered="Vem ska jag ringa nu\?"><svg[^>]*>[\s\S]*?<\/svg>Vem ska jag ringa nu\?<\/button>/.test(inget.hvHem()), inget.hvHem().match(/<div class="hv-genv"[^>]*>[\s\S]{0,300}/)?.[0]);
  ok("chatten av: ingen av dem", !hem({ chef: true }).hvHem().includes("data-hvforbered"));
  const moten = (g, n) => Object.assign(g, { moSyns: () => true, ndMo: () => ({ kort: Array.from({ length: n + 2 }, (_x, i) => ({ v: i < n })) }), moAtt: (k) => k.v, moUtfall: () => false, moFoljIdag: () => false });
  const m = moten(hem({ chef: true }), 7);
  okM("Möten bär talet som Möten har i menyn", /<button class="hv-chip" data-go="\/moten">Möten <small>7<\/small><\/button>/.test(m.hvHem()), m.hvHem().match(/data-go="\/moten">[^<]*(<small[^<]*<\/small>)?/)?.[0]);
  const m0 = moten(hem({ chef: true }), 0);
  ok("inget tal när inget väntar", /data-go="\/moten">Möten<\/button>/.test(m0.hvHem()));
  okR("talet är menyns tal", /function hvMotenTal\(\)\{ return typeof moSyns === 'function' && moSyns\(\) \? ndMo\(\)\.kort\.filter\(k => moAtt\(k\) \|\| moUtfall\(k\) \|\| moFoljIdag\(k\)\)\.length : 0; \}/.test(html));
  const g = hem({ chef: true }); g.S.hv.mer = true;
  const mer = g.hvHem().match(/<div class="hv-mer[ "][\s\S]*?<\/div>/)?.[0] ?? "";
  ok("Mer har Golvet, Teamet i november och Coachning", /data-hvark="golvet">Golvet</.test(mer) && /data-hvark="team">Teamet i november</.test(mer) && /data-hvark="coachning">Coachning</.test(mer) && !/data-go=/.test(mer), mer);
  okM("Mer är skissens meny, tecken för tecken", mer === '<div class="hv-mer" role="menu" aria-label="Mer"><button role="menuitem" data-hvark="golvet">Golvet</button><button role="menuitem" data-hvark="team">Teamet i november</button><button role="menuitem" data-hvark="coachning">Coachning</button></div>' && g.hvHem().includes('<span class="hv-merv"><button class="hv-chip" data-hvmer aria-haspopup="menu" aria-expanded="true">Mer</button><div class="hv-mer"'), mer);
  g.hvOppna("coachning");
  ok("Coachning öppnas i tråden", g.S.hv.trad.some((x) => x.sort === "coachning") && g.hvHem().includes('data-hvinl="coachning"'));
  const s = hem({ chef: false }); s.S.hv.mer = true;
  const smer = s.hvHem().match(/<div class="hv-mer[ "][\s\S]*?<\/div>/)?.[0] ?? "";
  ok("säljaren har inget Teamet i Mer när laget inte går att läsa", !/data-hvark="team"/.test(smer) && /data-hvark="coachning"/.test(smer), smer);
}

rubrik("Skiss A: skrivrutan, Bifoga, Tala och tipset");
await (async () => {
  const g = hem({ chef: true }); g.ND.hem.chatt = true;
  const sk = g.hvSkriv();
  ok("platshållaren är skissens", sk.includes('placeholder="Fråga Nav eller be om något…"'));
  okM("raden: Bifoga, tipset, snedstrecket, Skicka", /<div class="hv-srad"><button type="button" class="hv-ik" data-hvbifoga aria-label="Bifoga"><svg[^>]*>[\s\S]*?<\/svg><\/button><button type="button" class="hv-tips" data-hvtips>Prova: Vad måste jag göra för att sälja mer\?<\/button><span class="hv-kbd" aria-hidden="true">\/<\/span><button type="submit" class="hv-send" aria-label="Skicka">/.test(sk), sk);
  okM("filväljaren tar bilder och PDF", /<input type="file" id="hvFil" hidden multiple accept="image\/png,image\/jpeg,image\/webp,application\/pdf"(?: data-hvfil)?>/.test(sk), sk.match(/<input type="file"[^>]*>/)?.[0]);
  okM("rutan som skissen: fältet med sin beskrivning för skärmläsaren", /<textarea id="hvQ" rows="1" placeholder="Fråga Nav eller be om något…" aria-label="Skriv till Nav" aria-describedby="hvQom"[^>]*>/.test(sk) && sk.includes('<span class="hv-dold" id="hvQom">Svaren skrivs av AI ur Navs tal. Enter skickar, Skift och Enter ger ny rad.</span>'), sk.match(/<textarea[\s\S]*?<\/span>/)?.[0]);
  ok("utan taligenkänning ingen Tala", !sk.includes("data-hvtala"));
  g.window.webkitSpeechRecognition = function () {};
  okM("med taligenkänning finns Tala, före Skicka", /<span class="hv-kbd" aria-hidden="true">\/<\/span><button type="button" class="hv-ik" data-hvtala aria-pressed="false" aria-label="Tala"><svg[^>]*>[\s\S]*?<\/svg><\/button><button type="submit" class="hv-send" aria-label="Skicka">/.test(g.hvSkriv()), g.hvSkriv().match(/<div class="hv-srad">[\s\S]*?<\/div>/)?.[0]);
  okM("raden som skissen", regel(".hv-srad", hemCss) === "display:flex;align-items:center;gap:2px;margin-top:8px", regel(".hv-srad", hemCss));
  okM("tipset står i skrivrutan i alla lägen, som i skissen", !/\.hv-tips\{visibility:hidden\}/.test(hemCss));
  g.S.hv.bilagor = [{ sort: "image/png", namn: "bild <1>.png", data: "AAAA" }];
  okM("en bilaga står som ett chip med ett kryss", /<div class="hv-bilagor"><span class="hv-bil">bild &lt;1&gt;\.png<button type="button" data-hvbilx="0" aria-label="Ta bort bild &lt;1&gt;\.png"><svg[^>]*>[\s\S]*?<\/svg><\/button><\/span><\/div>/.test(g.hvSkriv()), g.hvSkriv());
  // Tipset frågar chatten.
  const hamtat = [];
  g.fetch = async (url, o) => { hamtat.push(JSON.parse(o.body)); return { ok: false, status: 500, headers: { get: () => "application/json" }, json: async () => ({}) }; };
  g.hvKlick({ target: { closest: () => ({ dataset: { hvtips: "" } }) }, preventDefault() {}, stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 0));
  ok("tipset ställer frågan, med bilagan", hamtat[0]?.fraga === "Vad måste jag göra för att sälja mer?" && hamtat[0]?.bilagor?.length === 1, JSON.stringify(hamtat[0] ?? {}).slice(0, 200));
  ok("bilagan är skickad och borta ur rutan", (g.S.hv.bilagor || []).length === 0);
  ok("för stor fil: ett besked och inget läggs till", /function hvLaggFiler\(filer\)/.test(html) && /högst 3 MB/.test(html));
})();

rubrik("Skiss A: hela listan bakom Väntar på dig");
{
  const g = hem({ chef: true }); g.hvOppna("vantar");
  const a = g.hvHem();
  okM("rubriken som skissen: Fem saker väntar på dig. Två saker brinner.", a.includes('<h2 id="hvArktext">Fem saker väntar på dig. <b>Två saker brinner.</b></h2>'), a.match(/<h2 id="hvArktext">[\s\S]*?<\/h2>/)?.[0]);
  okM("grupperna Nu, Senare i dag och Kan vänta, med antal", a.includes('<div class="hv-grupp">Nu<small>2</small></div>') && a.includes('<div class="hv-grupp">Senare i dag<small>1</small></div>') && a.includes('<div class="hv-grupp">Kan vänta<small>2</small></div>'));
  okM("en rad per sak: punkt, text, varför och sort, och knapp", /<div class="hv-sak an" style="--i:0"[^>]*\bdata-m="r1"[^>]*><i class="hv-prk het" aria-hidden="true" style="justify-self:center"><\/i><div><b>Carl är sjukanmäld<\/b><small>Sjuk sedan i dag\. Ingen har bekräftat · Frånvaro<\/small><\/div><button class="hv-btn" data-hvgor="r1">Bekräfta<\/button><\/div>/.test(a), a.match(/<div class="hv-sak[\s\S]*?<\/div><button[\s\S]*?<\/button><\/div>/)?.[0]);
  okM("listan står i skissens spalt, med foten Alla uppgifter", a.includes('<div style="max-width:760px"><div class="hv-grupp">Nu') && /<div class="hv-arkfot" aria-live="polite"><span><\/span><span class="hv-end"><button class="hv-btn" data-[a-z]+="[^"]*">Alla uppgifter<\/button><\/span><\/div><\/div>/.test(a), a.match(/<div class="hv-arkfot"[\s\S]*?<\/div>/)?.[0]);
  ok("ingen tid när något som brinner saknar uppskattning", !a.includes("tar ungefär"));
  ok("inget Lyssna, ingen Sedan du tittade, ingen radmeny", !a.includes("data-listen") && !a.includes("I natt och i morse") && !a.includes("data-hvmeny") && !a.includes("Stämmer inte"));
  const m = hem({ chef: true, rader: [
    { id: "upg-7", nar: "nu", heat: 5, bkind: "uppgift", t: "Ring Mälarö", why: "Frist i dag", act: { l: "Klar", check: true } },
    { id: "upg-8", nar: "nu", heat: 4, bkind: "uppgift", t: "Skicka offert", why: "Frist i dag", act: { l: "Klar", check: true } },
  ] });
  m.TASKS = [{ id: "7", est: 10, ndNytt: [] }, { id: "8", est: 15, ndNytt: [] }];
  m.hvOppna("vantar");
  okM("när allt som brinner har en uppskattning: tiden står i foten", m.hvHem().includes('<div class="hv-arkfot" aria-live="polite"><span>Det som brinner tar ungefär 25 min.</span>'), m.hvHem().match(/<div class="hv-arkfot"[\s\S]*?<\/div>/)?.[0]);
  const tom = hem({ chef: true, rader: [] }); tom.hvOppna("vantar");
  okM("tom lista: Inget väntar på dig just nu., med bocken", tom.hvHem().includes('<h2 id="hvArktext">Inget väntar på dig just nu.</h2>') && /<div style="max-width:760px"><div class="hv-lugn"><svg[^>]*>[\s\S]*?<\/svg>Inget väntar på dig just nu\.<\/div>/.test(tom.hvHem()));
  okR("radmenyns CSS krockar inte med Mer", !/\.hv-mer\{width:30px/.test(html));
}

rubrik("Skiss A: Min dag, med urtavlan bredvid listan");
{
  // Skissens planera läser uppgiftens egen tid: utan tid är den null (dagPlan sätter r.tid ?? null), så också här.
  const P = (x) => { const p = { moten: [], uppgifter: [], nu: 581, start: 480, slut: 1020, rast: 60, ...x }; return { ...p, uppgifter: p.uppgifter.map((u) => ({ tid: null, ...u })) }; };
  const g0 = hem({ chef: true });
  const p1 = g0.hvPlaneraDag(P({ moten: [{ a: 540, b: 570, namn: "Nordic" }, { a: 590, b: 620, namn: "Möte" }], uppgifter: [{ id: "u1", namn: "A", min: 5, brinner: true }, { id: "u2", namn: "B", min: 20 }] }));
  ok("mötena står på sina tider, uppgifterna läggs i luckorna efter nu", JSON.stringify(p1.rader.map((r) => [r.a, r.b, r.typ])) === JSON.stringify([[540, 570, "mote"], [581, 586, "upg"], [590, 620, "mote"], [620, 640, "upg"]]), JSON.stringify(p1.rader.map((r) => [r.a, r.b, r.typ])));
  ok("luften: slut − nu − rast − det som är kvar", p1.luft === 1020 - 581 - 60 - 30 - 25, p1.luft);
  const p2 = g0.hvPlaneraDag(P({ uppgifter: [{ id: "u1", namn: "A", min: 600 }] }));
  ok("en uppgift som inte ryms före slut ligger inte i dagen", p2.rader.length === 0 && p2.ryms === false && p2.luft < 0);
  const p3 = g0.hvPlaneraDag(P({ uppgifter: [{ id: "u1", namn: "A", min: null }] }));
  ok("en uppgift utan tid: ingen luft", p3.utanTid.length === 1 && p3.luft === null);
  ok("utan schema: ingen luft", g0.hvPlaneraDag(P({ start: null, slut: null })).luft === null);
  // Skiss A: en uppgift med egen tid är en frist och står på sin tid. De andra läggs i luckorna efter nu, runt den.
  const p4 = g0.hvPlaneraDag(P({ moten: [{ a: 840, b: 870, namn: "Veckomöte" }], uppgifter: [{ id: "u1", namn: "A", min: 15, tid: 900 }, { id: "u2", namn: "B", min: 20 }] }));
  ok("en uppgift med egen tid står på sin tid, som en frist, och de andra läggs i luckorna", JSON.stringify((p4?.rader ?? []).map((r) => [r.id ?? r.namn, r.a, r.b, r.typ, !!r.fast])) === JSON.stringify([["u2", 581, 601, "upg", false], ["Veckomöte", 840, 870, "mote", false], ["u1", 900, 915, "upg", true]]) && p4.luft === 1020 - 581 - 60 - 20 - 30 - 15, JSON.stringify(p4?.rader));
  const p5 = g0.hvPlaneraDag(P({ uppgifter: [{ id: "u1", namn: "A", min: 30, tid: 600 }, { id: "u2", namn: "B", min: 30 }] }));
  ok("en uppgift i luckan krockar aldrig med en frist", JSON.stringify((p5?.rader ?? []).map((r) => [r.id, r.a, r.b])) === JSON.stringify([["u2", 630, 660], ["u1", 600, 630]].sort((x, y) => x[1] - y[1])), JSON.stringify(p5?.rader));

  const g = hem({ chef: true, rader: [
    { id: "upg-7", nar: "nu", heat: 5, bkind: "uppgift", t: "Ring Mälarö", why: "Frist i dag", act: { l: "Klar", check: true } },
    { id: "upg-8", nar: "idag", heat: 2, bkind: "uppgift", t: "Skicka offert", why: "Frist i dag", act: { l: "Klar", check: true } },
    { id: "r5", nar: "vanta", heat: 1, bkind: "utbildning", t: "Kursen", why: "Del 2", act: { l: "Öppna" } },
  ] });
  g.TASKS = [{ id: "7", est: 5, ndNytt: [] }, { id: "8", est: 20, ndNytt: [] }];
  g.now = () => 581;
  g.ndHemKal = () => [{ s: 540, e: 570, t: "Nordic Grön & Mark", id: "k1" }, { s: 660, e: 705, t: "PEGU Byggservice", id: "k2" }, { s: 810, e: 855, t: "Veckomöte", id: "k3" }];
  g.ND.hem.dag = { start: 480, slut: 1020, rast: 60 };
  g.ND.hem.chatt = true;
  okM("Min dag öppnar arket", /<button class="hv-chip" data-hvark="dag">Min dag<\/button>/.test(g.hvHem()));
  g.hvOppna("dag");
  const a = g.hvHem();
  okM("rubriken: möten kvar, saker som väntar och luften", a.includes('<h2 id="hvArktext">Två möten kvar och två saker som väntar. <b>Allt ryms, med 4 h 24 min över.</b></h2>'), a.match(/<h2 id="hvArktext">[\s\S]*?<\/h2>/)?.[0]);
  okM("urtavlan i arket bredvid listan, i stället för stapeln", a.includes('<div class="hv-dag"><div class="hv-ins ark" data-flip="ur" role="group" aria-label="Dagen 08.00 till 17.00, klockan 09.41. Två möten kvar, en sak brinner">') && !a.includes("hv-dbar") && !a.includes("hv-dskala"), a.match(/<div class="hv-dag">[\s\S]{0,200}/)?.[0]);
  okM("en rad per sak med sin tid och sin not, nu-linjen mellan", a.includes('<div class="hv-dnu" aria-label="Klockan 09.41">09.41 nu</div>') && a.includes('<div class="hv-drad upg het an" style="--i:2" data-m="upg-7"><span class="hv-kl num">09.41</span><i class="hv-pk" aria-hidden="true"></i><span class="hv-vad"><b>Ring Mälarö</b><small>5 min, lagt i en lucka · brinner</small></span>') && a.includes('<div class="hv-drad mote forbi an" style="--i:1" data-m="k1"><span class="hv-kl num">09.00</span><i class="hv-pk" aria-hidden="true"></i><span class="hv-vad"><b>Nordic Grön &amp; Mark</b><small>09.00–09.30</small></span></div>'), a.match(/<div class="hv-dlista">[\s\S]{0,600}/)?.[0]);
  okM("nästa möte kan förberedas", /<button class="hv-btn" data-hvforbered="Förbered mitt möte 11\.00 med PEGU Byggservice">Förbered<\/button>/.test(a));
  okM("foten: det som kan vänta, och Boka tiden i kalendern", /<div class="hv-arkfot" aria-live="polite"><button class="hv-lank" data-hvark="vantar">En sak kan vänta och ligger inte i dag(?:<svg[^>]*>[\s\S]*?<\/svg>)?<\/button><span class="hv-end"><button class="hv-btn" data-hvboka>Boka tiden i kalendern<\/button><\/span><\/div>/.test(a), a.match(/<div class="hv-arkfot"[\s\S]*?<\/div>/)?.[0]);
  okM("arket är skissens, tecken för tecken (ikonerna jämförs som ⟨svg⟩)", utanIkon(a).includes(SK.G_dag), utanIkon(a).slice(utanIkon(a).indexOf("hv-arkhuvud") - 12, utanIkon(a).indexOf("hv-arkhuvud") + 600));

  // Klickprovet 2026-11-16: klockan har sekunder (now() = 498,8), och raden stod "om 41.19933333333336 min".
  const s = hem({ chef: true, rader: [] });
  s.now = () => 618.8;
  s.ndHemKal = () => [{ s: 660, e: 705, t: "PEGU Byggservice" }, { s: 810, e: 855, t: "Veckomöte" }];
  s.ND.hem.dag = { start: 480, slut: 1020, rast: 60 };
  s.hvOppna("dag");
  const sa = s.hvHem();
  // Klockan visas i hela minuter (10.18), och allt räknas från den minuten, som skissens S.nu (trad.js rad 131,
  // langd(r.a - nu)): 11.00 − 10.18 = 42 min, i raden och i urtavlans mitt. Förut räknades från 10.18,8 och avrundades (41).
  ok("med sekunder i klockan: hela minuter till nästa", sa.includes('<div class="hv-dnu" aria-label="Klockan 10.18">10.18 nu</div>') && sa.includes('<span class="hv-kl num">11.00<small>om 42 min</small></span>') && sa.includes('<span class="s" data-roll="mitt-s-ark">om 42 min</span>') && !/om \d+[.,]\d/.test(sa) && !/\d\.\d{4,}/.test(sa), sa.match(/<small>om [^<]*<\/small>/)?.[0]);

  // Riktig data 2026-11-17: med nästa möte fyra timmar bort stod "om 4 h 42 min" på två rader i tidskolumnen (64 px).
  // Från en timme skrivs minuterna utan enhet i kolumnen, på en rad. Urtavlans mitt har plats för hela formen.
  const s4 = hem({ chef: true, rader: [] });
  s4.now = () => 618;
  s4.ndHemKal = () => [{ s: 900, e: 945, t: "Kundmöte" }, { s: 1000, e: 1015, t: "Avstämning" }];
  s4.ND.hem.dag = { start: 480, slut: 1020, rast: 60 };
  s4.hvOppna("dag");
  const sa4 = s4.hvHem();
  ok("över en timme till nästa: minuterna utan enhet i tidskolumnen, hela formen i urtavlans mitt", sa4.includes('<span class="hv-kl num">15.00<small>om 4 h 42</small></span>') && sa4.includes('om 4 h 42 min</span>') && !/<small>om [^<]*min<\/small>/.test(sa4), sa4.match(/<small>om [^<]*<\/small>/)?.[0]);
  ok("jämna timmar till nästa står utan minuter", (() => { s4.now = () => 660; return s4.hvHem().includes('<span class="hv-kl num">15.00<small>om 4 h</small></span>'); })());
  ok("och hela minuter i luften", sa.includes("<b>Allt ryms, med 4 h 12 min över.</b>"), sa.match(/<b>Allt ryms[^<]*<\/b>/)?.[0]);
}

rubrik("Skrivrutan är en enda fri ruta, utan ram inuti (beställaren 2026-11-16)", "REGEL");
{
  // Beställarens skärmbild: när man skrev fick textfältet en grön ring inne i rutan. Hemvyns allmänna
  // fokusregel (.hv :is(…,[tabindex]):focus-visible, tyngd 0,3,0) slog rutans egen outline:0 (0,1,1).
  // I skiss 9 vinner rutans outline:0, och ingen ring syns.
  const fri = regel(".hv .hv-skriv textarea:focus-visible");
  ok("textfältet i skrivrutan får ingen ring när man skriver", fri !== null && /(^|;)outline:0(;|$)/.test(fri), fri);
  ok("knapparna i hemvyn behåller sin fokusring", (regel(".hv :is(button,textarea,input,[tabindex],a):focus-visible", hemCss) || "").includes("outline:2px solid var(--hv-brand)"));
}

rubrik("Teamet i månaden i tråden (skissens inlTeam, med produktens kedja, mål och underlag)", "MARKUP");
{
  const RAD = (x) => ({ id: "p", namn: "X Prov", fornamn: "X", mal: 12, order: 7, status: "Före sitt mål", led: ["n", null, "u", "n", "u"], orsak: null, forklaring: "Bokade möten: över sitt eget spann två veckor i rad.", kommentar: null, ...x });
  const g = hem({ chef: true });
  g.S.hv.data.team = { team: { kort: TEAM, utrakning: "19 order på 10 arbetsdagar, gånger månadens 21 arbetsdagar, blir ungefär 40.", personer: [{ id: "p1", namn: "Carl Prov", bokade: 8, hallna: 5, uteblivna: 1, order: 6 }], oppna: null, takten: [], serInte: "Det här ser jag inte: order som inte är inlagda i Nav.", kalla: "Räknat av regler",
    rader: [RAD({ id: "p1", namn: "Carl Prov", fornamn: "Carl" }), RAD({ id: "p2", namn: "Edvin Prov", fornamn: "Edvin", mal: 11, order: 4, status: "Efter sitt mål", led: ["n", null, "n", "d", "n"], orsak: "Möten uteblir", forklaring: "Ringer och bokar som vanligt. 9 av 20 möten uteblev, mot 5 av 40 före. Varför vet jag inte." }), RAD({ id: "p3", namn: "Mick Prov", fornamn: "Mick", mal: null, order: 2, status: null, led: [null, null, null, null, null], forklaring: "Inget sticker ut." })],
    saknarUtfall: 3, tillMalet: { kvar: 27, dagar: 11, perDag: 2.5, hittills: 1.9 } } };
  g.hvOppna("team");
  const t = g.hvHem();
  // Skissens inlTeam (trad.js rad 83–84): meningen, taktens facit som en hv-tank-rad, källraden, en hv-sak per person.
  ok("inledningen: läget, takten och hur många som ligger efter", t.includes("<p>19 av 46 order efter 10 av 21 arbetsdagar, och 1 är makulerad. I samma takt blir det ungefär 40. Det är en uträkning på takten, inget löfte. En ligger efter sitt mål.</p>"), t.match(/<p>19 av 46[\s\S]*?<\/p>/)?.[0]);
  ok("takten och målet står i meningen, med taktens facit under (skissens inlTeam har ingen mätare)", t.includes("<p>19 av 46 order efter 10 av 21 arbetsdagar") && t.includes("I samma takt blir det ungefär 40.") && t.includes('<p class="hv-tank">Efter 10 dagar sa takten 38 i oktober (det blev 44).</p><p class="hv-kalla">Räknat av regler · 19 order på 10 arbetsdagar, gånger månadens 21 arbetsdagar, blir ungefär 40.</p>') && !t.slice(t.search(/data-hvinl="team"/)).includes("hv-matare"));
  ok("en rad per person med kedjan i fem led", (t.match(/<div class="hv-sak(?: oppen)?" role="button" tabindex="0" aria-expanded="(?:true|false)" data-hvperson="p\d"><span class="hv-av" aria-hidden="true">[A-ZÅÄÖ]<\/span><div><b>[^<]+<\/b><small>[^<]*<\/small><div class="hv-tv"><span class="hv-kedja">(?:<i class="(?:|upp|ned)" title="[^"]*"><\/i>){5}<\/span>/g) || []).length === 3 && /<span class="hv-kedja"><i class="" title="Samtal: som vanligt"><\/i><i class="" title="Svar: ser jag inte"><\/i><i class="upp" title="Bokade möten: över sitt eget spann"><\/i>/.test(t) && /(^|;)display:none(;|$)/.test(regel(".hv-tv", hemCss) ?? "") && regel(".hv-sak.oppen .hv-tv", hemCss) === "display:block", t.match(/<span class="hv-kedja">[\s\S]*?<\/span>/)?.[0]);
  ok("eget mål: 7 av 12 och läget", /<div class="hv-sak" role="button" tabindex="0" aria-expanded="false" data-hvperson="p1"><span class="hv-av" aria-hidden="true">C<\/span><div><b>Carl<\/b><small>7 av 12 order · Före sitt mål<\/small>[\s\S]*?<\/div><\/div><span class="hv-mono">58 %<\/span><\/div>/.test(t));
  ok("orsaken står efter läget, och raden är utfälld med förklaringen", /<div class="hv-sak oppen" role="button" tabindex="0" aria-expanded="true" data-hvperson="p2">[\s\S]*?<small>4 av 11 order · Efter sitt mål · Möten uteblir<\/small><div class="hv-tv">[\s\S]*?<\/span>Ringer och bokar som vanligt\. 9 av 20 möten uteblev, mot 5 av 40 före\. Varför vet jag inte\.<\/div>/.test(t));
  ok("utan eget mål: bara antalet, inget läge", /data-hvperson="p3"><span class="hv-av" aria-hidden="true">M<\/span><div><b>Mick<\/b><small>2 order<\/small><div class="hv-tv">[\s\S]*?<\/div><\/div><span class="hv-mono"><\/span><\/div>/.test(t));
  ok("kedjans förklaring", t.includes("Kedjan: samtal · svar · bokade · hållna · order. Färg = utanför eget spann två veckor i rad."));
  ok("det Nav inte ser, och mötena utan utfall", /<p class="hv-tank">Det här ser jag inte: vad som sägs i samtalen, och om ett samtal blev besvarat\. 3 möten saknar utfall\. <button class="hv-lank" data-go="\/moten">Visa dem<\/button><\/p>/.test(t));
  // Taktens facit månad för månad står i underlaget, bakom Visa underlaget (produkten har, skissen saknar).
  ok("facit: takten sa och det blev, efter lika många dagar", (() => { g.S.hv.underlag = true; const u = g.hvHem(); g.S.hv.underlag = undefined; return /<p class="hv-tank">Så har takten träffat, efter 10 arbetsdagar:<\/p><div class="hv-lista"><div class="hv-or"><span class="num">[^<]{3}<\/span><div>Takten sa 38<small>Det blev 44<\/small><\/div><span class="hv-kr num">6 fler<\/span><\/div><\/div>/.test(u); })() && !t.includes("Så har takten träffat"));
  ok("Till målet, med decimalkomma", t.includes("<b>Till målet.</b> 27 order på 11 arbetsdagar, ungefär 2,5 om dagen. Hittills har det varit 1,9 om dagen."));
  ok("Visa underlaget fäller ut antalen per person", t.includes("data-hvunderlag") && !t.includes("Uteblivna</span>"));
  g.S.hv.underlag = true;
  ok("underlaget: bokade, hållna, uteblivna och order per person", /Uteblivna<\/span>/.test(g.hvHem()) && g.hvHem().includes("Carl Prov"));
  ok("inget facit per val längre", !t.includes("Navs facit per val") && !/hvHamtaFacit\(\)/.test(html));
  const k = kort(hem({ chef: true, team: { ...TEAM, mal: null, text: { ...TEAM.text, stort: "19 order", malrad: "Inget mål satt för november." } } }).hvHem(), "Teamet i november");
  okM("avsnittet utan mål: bara antalet, ingen mätare, och raden att inget mål är satt (skiss A)", /<b class="num" data-roll="netto">19<\/b><span>order<\/span>/.test(k) && k.includes("<p>Inget mål satt för november.</p>") && !k.includes("hv-mat"), k);
}

rubrik("Skiss A: telefonen (containerfrågan 860)");
{
  // Skiss A: telefonen styrs av containerfrågan på .hv (under 860 px), inte av skärmens bredd.
  const M = cssBlock(hemCss, "@container hv (max-width:860px)");
  const mob = (sel) => M.match(new RegExp(`[\\s}]${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\{([^}]*)\\}`))?.[1] ?? "";
  okM("en spalt: urtavlan i mitten göms, den lilla står bredvid hälsningen", mob(".hv-hemin") === "display:block" && mob(".hv-urkol") === "display:none" && mob(".hv-hero .hv-ins.kompakt") === "display:block" && mob(".hv-hero") === "display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--hv-s4);align-items:start", M.slice(0, 400));
  okM("skrivrutan längst ned i full bredd, bara övre hörnen rundade, säker kant", mob(".hv-skriv") === "max-width:none;border-radius:var(--hv-r3) var(--hv-r3) 0 0;border-bottom:0;padding-bottom:calc(6px + env(safe-area-inset-bottom,0px))", mob(".hv-skriv"));
  okM("genvägarna rullar i sidled på en rad", mob(".hv-genv") === "flex-wrap:nowrap;justify-content:flex-start;overflow-x:auto;max-width:100%;width:100%;padding:0 var(--hv-s2);scrollbar-width:none", mob(".hv-genv"));
  okM("menyknappen syns i telefonen, överraden är lägre", mob(".hv-meny") === "display:grid" && mob(".hv-topp") === "padding:0 var(--hv-s4);height:56px");
  okM("Min dag och Veckan i en spalt", mob(".hv-dag") === "grid-template-columns:1fr" && mob(".hv-vecka") === "grid-template-columns:1fr");
  ok("gamla mobilreglerna borta: en kolumn och 96 px luft", !hemCss.includes("grid-template-columns:1fr;gap:12px;margin-top:20px") && !hemCss.includes("padding:14px 16px 96px"));
  ok("skrivfältet 16 px, så att telefonen inte zoomar", /font:400 var\(--hv-fs-5\)\/1\.5 var\(--f-body\)/.test(regel(".hv-skriv textarea", hemCss) ?? "") && /--hv-fs-5:16px;/.test(regel(".hv", hemCss) ?? ""), regel(".hv-skriv textarea", hemCss));
  ok("hemmet rullar om det inte ryms", /overflow-y:auto;overscroll-behavior:contain/.test(regel(".hv-hem", hemCss) ?? ""), regel(".hv-hem", hemCss));
  // Som i Claude: ingen flikrad nere, en menyknapp uppe till vänster som öppnar Navs meny.
  ok("Navs flikrad döljs på hemmet i telefonen, menyknappen syns", /@media \(max-width:900px\)\{body\.hvbody \.bnav\{display:none\}\.hv-meny\{display:inline-grid\}\}/.test(html));
  okM("menyknappen är dold på datorn", regel(".hv-meny", hemCss) === "display:none;width:36px;height:36px;border-radius:var(--hv-r1);place-items:center", regel(".hv-meny", hemCss));
  const g = hem({ chef: true });
  const h = g.hvHem();
  ok("menyknappen först i överraden", /<header class="hv-topp"><button class="hv-meny" data-rlsmer aria-haspopup="dialog" aria-expanded="false" aria-label="Meny"><svg/.test(h), h.slice(h.indexOf("hv-topp") - 12, h.indexOf("hv-topp") + 200));
  g.S.rlsMer = true;
  ok("menyknappen säger när menyn är öppen", g.hvHem().includes('class="hv-meny" data-rlsmer aria-haspopup="dialog" aria-expanded="true"'));
  ok("ikonen: två streck", /<button class="hv-meny" data-rlsmer aria-haspopup="dialog" aria-expanded="(?:true|false)" aria-label="Meny"><svg class="hv-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h16M4 16h16"\/><\/svg><\/button>/.test(g.hvHem()));
  ok("menyn stängs med fokus på den knapp som syns", /function rlsArkStang\(\)\{ S\.rlsMer = false; rlsArkRita\(\); const m = \[\.\.\.document\.querySelectorAll\('\[data-rlsmer\]'\)\]\.find\(b => b\.offsetParent\);/.test(html));
  ok("Mer rullar fram de nya valen i raden", /if \(d\.hvmer !== undefined\)\{ S\.hv\.mer = !S\.hv\.mer; render\(\); if \(S\.hv\.mer\) requestAnimationFrame\(\(\) => \{ const r = document\.querySelector\('\.hv-genv'\); if \(r && r\.scrollWidth > r\.clientWidth\) r\.scrollLeft = r\.scrollWidth; const f = document\.querySelector\('\.hv-mer \[role="menuitem"\]'\); if \(f\) f\.focus\(\); \}\); return; \}/.test(html));
}

rubrik("Stilen: täckande ytor, få tider, tydliga lägen (skiss A)", "REGEL");
{
  const css = hemCss;
  const tokens = regel(".hv", css) ?? "";
  ok("klasserna har en betydelse var: stegmätaren äger steg, lyssna-rutan hv-stopp, och Laget har en färg per läge", !/class="hv-steg"/.test(html) && !/\.hv-steg[ {]/.test(css.replace(/\.hv-matare\.hv-steg/g, "")) && !/hv-send hv-stopp"/.test(html) && /--hv-p-ej:#5E7068;/.test(tokens) && /--hv-p-ej:#A9B5AD;/.test(regel('.hv[data-hvtema="ljus"]', css) ?? ""));
  ok("inget glas: ingen backdrop-filter i hemmets stil", css.length > 0 && !/backdrop-filter/.test(css));
  ok("ingen :has på body, hvbody ligger på body i stället", !/body:has\(/.test(css) && /document\.body\.classList\.toggle\('hvbody', hvNytt\)/.test(html));
  ok("urtavlan står still: ingen evig rörelse", css.length > 0 && !/hvrot|infinite/.test(css) && !/\.hv-dial g\{/.test(css));
  ok("bakgrunden är platt: ingen gradient alls", css.length > 0 && !/gradient\(/.test(css));
  ok("tokens som skissen: typsteg, avstånd, radie och tider", /--hv-fs-1:12px; --hv-fs-2:13px; --hv-fs-3:14px; --hv-fs-4:15px; --hv-fs-5:16px;/.test(tokens) && /--hv-s1:4px; --hv-s2:8px; --hv-s3:12px; --hv-s4:16px; --hv-s5:24px; --hv-s6:32px; --hv-s7:48px;/.test(tokens) && /--hv-r1:8px; --hv-r2:12px; --hv-r3:16px;/.test(tokens) && /--hv-t-snabb:120ms; --hv-t:180ms; --hv-t-lugn:250ms;/.test(tokens), tokens.slice(0, 300));
  // Trappans fördröjning (animation-delay, 30 och 24 ms per steg) är skissens. Längderna går bara genom tokens.
  const tider = utanKommentar(css).replace(/animation-delay:[^;}]*/g, "").replace(/var\(--hv-t[a-z-]*\)/g, "").replace(/visibility 0s/g, "");
  ok("ingen transition: all och inga längder utanför tokens 120 till 250 ms", !/transition:\s*all/.test(css) && !/(?:transition|animation)[^;}]*\s\.?\d*\.?\d+m?s(?![\w-])[^;}]*/.test(tider), (tider.match(/(?:transition|animation):[^;}]*/g) || []).filter((x) => /\d(?:ms|s)\b/.test(x)).join(" | "));
  // Hover bara där en mus finns. Skissens enda undantag: märkets förklaring visas vid :hover eller fokus (.hv-pin:is(:hover,:focus-visible)).
  let utanHover = utanKommentar(css), antalHover = 0;
  for (let b; (b = cssBlock(utanHover, "@media (hover:hover)")); ) { antalHover += (b.match(/:hover/g) || []).length; utanHover = utanHover.replace(b, ""); }
  const losa = utanHover.replace(/\.hv-pin:is\(:hover,:focus-visible\) \.hv-tip/g, "");
  ok("hover bara där en mus finns", antalHover > 10 && !/:hover/.test(losa), (losa.match(/[^}]*:hover[^{]*/g) || []).join(" | ").slice(0, 300));
  ok("tryck: scale(.97) på knappar, chips och märken", css.includes(".hv :is(.hv-btn,.hv-chip,.hv-ik,.hv-send,.hv-stamp,.hv-kn,.hv-pin,.hv-atgk):active:not(:disabled){transform:scale(.97)}"));
  ok("skrivrutan visar fokus på hela rutan", /\.hv-skriv:focus-within\{border-color:var\(--hv-brand\)\}/.test(css));
  ok("hemmet lämnar tabbordningen när man skriver", /\.hv-skriver \.hv-hem\{opacity:0;visibility:hidden;pointer-events:none;/.test(css) && !/\.hv-skriver \.hv-hem\{[^}]*transform/.test(css));
  ok("fältkanten har 3:1 mot ytan", /--hv-line-3:#5E7068/.test(tokens) && /--hv-line-3:#85938B/.test(regel('.hv[data-hvtema="ljus"]', css) ?? "") && /\.hv-egen input,\.hv-form :is\(input,select,textarea\)\{[^}]*border:1px solid var\(--hv-line-3\)/.test(css));
  ok("signalfärgen som text har egen, läsbar ton i ljust läge", /--hv-signal-ink:#8A5200/.test(regel('.hv[data-hvtema="ljus"]', css) ?? "") && !/(?<![-\w])color:var\(--hv-signal\)/.test(css));
  ok("tal står tabulärt och rubriker balanseras", /font-variant-numeric:tabular-nums/.test(tokens) && css.includes(".hv :is(h1,h2,h3){text-wrap:balance;margin:0}") && css.includes(".hv p{margin:0;text-wrap:pretty}"));
  ok("knapparna i hemvyn har sin fokusring", css.includes(".hv :is(button,textarea,input,[tabindex],a):focus-visible{outline:2px solid var(--hv-brand);outline-offset:2px}"));
  const M = cssBlock(css, "@container hv (max-width:860px)");
  // Skissens telefonregler (containerfrågan 860) och produktens egna fält (Din egen rad, formuläret för en ändring),
  // som skissen saknar: de står kvar på 40 px i produktens telefonregel.
  ok("telefon: tryckytorna är minst 40 px", /[\s}]\.hv-btn\{height:40px\}/.test(M) && /[\s}]\.hv-chip\{height:40px\}/.test(M) && /[\s}]\.hv-ik,\.hv-send\{width:40px;height:40px\}/.test(M) && /min-height:40px/.test(regel(".hv-prow", css) ?? "") && /@media \(max-width:860px\)\{[^@]*?\.hv-egen input,\.hv-form :is\(input,select,textarea\)\{min-height:40px\}/.test(css), M.slice(0, 200));
  ok("inget märke på urtavlan är mindre än 28 px", /width:28px;height:28px/.test(regel(".hv-pin", css) ?? ""), regel(".hv-pin", css));
}

rubrik("Menyraden (punkt 42)", "MENYRAD");
{
  const R = (sel) => html.match(new RegExp(`\\n${sel.replace(/[.*+?^${}()|[\]\\#]/g, "\\$&")}\\{([^}]*)\\}`))?.[1] ?? "";
  ok("rälsen: 14 12 10 i kant", /padding:14px 12px 10px/.test(R("#rail.rls")), R("#rail.rls"));
  ok("raden: 33 px, 14 px text, radie 8", /height:33px;padding:0 10px;border-radius:8px;color:var\(--ink-2\);font-size:14px/.test(R("#rail .rls-i")), R("#rail .rls-i"));
  ok("antalen i mono 11 px", /font:500 11px var\(--f-mono\)/.test(R("#rail .rls-n")), R("#rail .rls-n"));
  ok("sökrutan: 30 px, ram line-2, radie 8", /height:30px;padding:0 8px 0 10px;border-radius:8px;border:1px solid var\(--line-2\)/.test(R("#rail .rls-sok")) && /font:11px var\(--f-mono\);color:var\(--ink-3\);border:1px solid var\(--line\);border-radius:5px;padding:1px 5px/.test(R("#rail .rls-sok kbd")), R("#rail .rls-sok"));
  ok("märket: nav i 600 20px", /font:600 20px\/1 var\(--f-display\);letter-spacing:-\.02em/.test(R("#rail .rls-wm b")) && /font-size:11\.5px/.test(R("#rail .rls-wm small")));
  ok("klockans tal som skissen", /top:-4px;right:-5px;min-width:17px;height:17px;padding:0 4px;border-radius:9px/.test(R("#rail .rls-b")), R("#rail .rls-b"));
  ok("profilen längst ned i rälsen på det nya hemmet: bokstav, namn, roll och upp/ned", /S\.view === 'hem' && typeof hvPa === 'function' && hvPa\(\) \? rlsProfil\(\) : ''/.test(html) && /class="rls-prof" id="prfKnapp"[^>]*data-prfmeny/.test(html) && /<i aria-hidden="true">\$\{esc\(String\(vis\)\[0\] \|\| ''\)\}<\/i><span>\$\{esc\(vis\)\}<small>/.test(html));
  ok("profilmenyn öppnas uppåt från rälsen", /if \(k\.closest\('#rail'\)\)\{ el\.style\.top = \(r\.top \+ scrollY - el\.offsetHeight - 6\) \+ 'px'; el\.style\.left = r\.left \+ 'px'; return; \}/.test(html));
}

rubrik("Menyraden exakt som skiss 9, utfälld och smal (klickprovet 2026-11-16, skissen rad 53–113)", "MENYRAD");
{
  const R = (sel) => html.match(new RegExp(`\\n${sel.replace(/[.*+?^${}()|[\]\\#]/g, "\\$&")}\\{([^}]*)\\}`))?.[1] ?? "";
  // Rälsens block (det finns fler @media (min-width:901px) i filen).
  const bred = (() => { const start = html.indexOf("@media (min-width:901px){\n  body:is(.prf-rail-hopfalld,.prf-rail-hovra) .app"); if (start < 0) return ""; let d = 0, j = start; for (; j < html.length; j++) { if (html[j] === "{") d++; else if (html[j] === "}") { d--; if (d === 0) break; } } return html.slice(start, j + 1); })();
  const X = ":is(body.prf-rail-hopfalld #rail,body.prf-rail-hovra #rail:not(.rls-ut)) ";
  const S = (sel) => bred.match(new RegExp(`\\n\\s*${(X + sel).replace(/[.*+?^${}()|[\]\\#]/g, "\\$&")}\\{([^}]*)\\}`))?.[1] ?? null;
  // Utfälld: mätt i skissen mot previewn. Märket 18,18, klockan 194,13 30×30, sökrutan 12,67, listan från 107 med rader
  // kant i kant (33 px), gruppens rubrik 36 px, profilen 38 och raden Sidopanel 31 px med 6 över.
  ok("rälsen: inget mellanrum mellan delarna, skissens bakgrund och hovring", /;gap:0;/.test(R("#rail.rls")) && /--rls-bg:var\(--surface-2\)/.test(html) && /--rls-hov:var\(--line\)/.test(html) && !/--rls-hov:color-mix/.test(html), R("#rail.rls"));
  ok("märket: 6 px in, 12 px under, ordbilden 20 + 21 px hög", R("#rail .rls-topp") === "display:flex;align-items:center;padding:0 2px 12px 6px" && /margin-bottom:6px/.test(R("#rail .rls-brand svg")) && /display:block;font-size:11\.5px;line-height:21px/.test(R("#rail .rls-wm small")) && /^display:block;/.test(R("#rail .rls-wm")), R("#rail .rls-topp"));
  ok("klockan: 30 px, 194 från vänster och 13 från toppen", /^position:absolute;left:194px;top:13px;width:30px;height:30px;border-radius:8px$/.test(R("#rail .rls-bell")), R("#rail .rls-bell"));
  ok("sökrutan: 10 px till listan", /margin-bottom:10px/.test(R("#rail .rls-sok")), R("#rail .rls-sok"));
  ok("listan: ingen rullist, raderna kant i kant, markeringen i rälsens kant", /margin:0 -12px;padding:0 12px 8px;display:flex;flex-direction:column;gap:0;/.test(R("#rail .rls-lista")) && /scrollbar-width:none/.test(R("#rail .rls-lista")) && R("#rail .rls-lista::-webkit-scrollbar") === "display:none" && /gap:0$/.test(R("#rail .rls-g")) && /gap:0;padding-top:0$/.test(R("#rail .rls-gin")), R("#rail .rls-lista"));
  ok("gruppens rubrik: 36 px, 14 8 5 10 i kant, 11,5 px i 500", /height:36px;padding:14px 8px 5px 10px;[^}]*font-size:11\.5px;font-weight:500;line-height:17px/.test(R("#rail .rls-gh")), R("#rail .rls-gh"));
  ok("raden i 400, den aktiva i 550 med ikonen i bläck", /font-weight:400;/.test(R("#rail .rls-i")) && /font-weight:550;/.test(R("#rail .rls-i.rls-akt")) && R("#rail .rls-i.rls-akt svg") === "color:var(--ink)");
  ok("pricken 6 px i radens kant", /margin:0 0 0 auto;width:6px;height:6px/.test(R("#rail .rls-p")), R("#rail .rls-p"));
  ok("markeringen: 19 px hög, mitt för raden", /height:19px/.test(R("#rail .rls-pip")) && html.includes("(m.offsetHeight - 19) / 2"));
  ok("raden Sidopanel: 6 px över, 8 7 0 8 i kant (rutorna på 128, 160, 192), 12 px text", /^display:flex;align-items:center;gap:8px;padding:8px 7px 0 8px;margin-top:6px;border-top:1px solid var\(--line\);font-size:12px;color:var\(--ink-3\)$/.test(R("#rail .rls-fot")) && R("#rail .rls-ft") === "flex:1", R("#rail .rls-fot"));
  ok("lägena som tre små rutor med ett streck", /width:24px;height:22px;border-radius:5px;border:1px solid var\(--line-2\)/.test(R("#rail .rls-lage button")) && R("#rail .rls-lage svg") === "display:none" && /width:8px/.test(R('#rail .rls-lage [data-rlslage="utfalld"]::after')) && /box-shadow:5px 0 0 var\(--line-2\)/.test(R('#rail .rls-lage [data-rlslage="hovra"]::after')) && /background:var\(--surface\);border-color:var\(--ink-3\)/.test(R('#rail .rls-lage button[aria-checked="true"]')), R("#rail .rls-lage button"));
  ok("Hovra fälls ut som skissen", /transition:width \.22s var\(--ease\) \.04s,box-shadow \.22s/.test(bred) && /box-shadow:14px 0 36px -22px rgba\(6,20,16,\.55\)/.test(bred));
  // Smal: märket står kvar, klockan 17,52, sökrutan 12,107 40×30 med ram, raderna 40×33 med ikonen 22 in, antalen
  // dolda, 36 px luft där gruppens rubrik står, profilen 40×38 längst ned och raden Sidopanel osynlig men på sin plats.
  ok("smal: märket står kvar, klockan 17 från vänster och 52 från toppen", S(".rls-brand") === "min-height:41px" && S(".rls-bell") === "left:17px;top:52px" && S(".rls-topp") === null && S(".rls-ib") === null, S(".rls-bell"));
  ok("smal: sökrutan en ruta med ram, 40 bred, 40 px under märket", S(".rls-sok") === "width:40px;margin-top:40px" && S(".rls-sok svg") === null, S(".rls-sok"));
  ok("smal: raderna 40 breda med ikonen kvar på sin plats, antal och prickar dolda", S(".rls-i") === "width:40px" && S(":is(.rls-n,.rls-p)") === "opacity:0" && S(".rls-i svg") === null, S(".rls-i"));
  ok("smal: grupperna skiljs med luft, inga streck", S(".rls-gh") === "visibility:hidden" && !/border-top:1px solid var\(--line\)\}\n[^\n]*rls-snabb/.test(bred) && !/\.rls-g\+\.rls-g\{/.test(bred) && !/\.rls-snabb\{padding-top:8px/.test(bred));
  ok("smal: profilen 40 bred, knappen Fäll ut i Hopfälld 40 × 22", S(".rls-prof") === "width:40px;padding:0 7px" && S(".rls-fu") === "width:40px;height:22px" && S(".rls-fot") === "padding:8px 0 0");
  ok("smal Hovra: raden Sidopanel syns inte men tar sin plats", /\n\s*body\.prf-rail-hovra #rail:not\(\.rls-ut\) \.rls-fot\{opacity:0;pointer-events:none\}/.test(bred));
}

rubrik("Lyftet: korten räknar ur samma mängd, och allt man ser leder vidare");
{
  // Ett mål som svarar olika på olika väljare, som en riktig DOM-nod (closest ger null när väljaren inte träffar).
  const mal = (traff, dataset = {}) => ({ closest: (sel) => (sel.split(",").some((s) => traff.includes(s.trim())) ? { dataset } : null) });
  const klick = (g, target) => g.hvKlick({ target, preventDefault() {}, stopPropagation() {} });

  // js-kort-3: talet i huvudet räknar det som syns (nu och i dag), utan det bortvalda.
  const g = hem({ chef: true });
  const k = kort(g.hvHem(), "Väntar på dig");
  ok("talet i huvudet är det som ska göras nu och i dag (3), inte allt (5)", /<h2>Väntar på dig<\/h2><span class="hv-n" data-roll="vantar-n">3<\/span>/.test(k), k.slice(0, 300));
  const dold = hem({ chef: true }); dold.S.flagged = new Set(["r1"]); dold.S.hiddenKinds = new Set(["utbildning"]);
  const dk = kort(dold.hvHem(), "Väntar på dig"), dh = dold.hvHem();
  ok("det bortvalda räknas inte: 2 i huvudet, och foten räknar ur samma mängd", /<span class="hv-n" data-roll="vantar-n">2<\/span>/.test(dk) && /data-hvark="vantar">1 till som kan vänta</.test(dk) && !dk.includes("Carl är sjukanmäld"), dk);
  ok("hälsningen säger samma sak som kortet", dh.includes('<b data-roll="lage">En sak brinner.</b>'), dh.match(/<div class="hv-hero">[\s\S]*?<\/p>/)?.[0]);
  dold.S.hv.ark = "vantar";
  const da = dold.hvHem();
  ok("hela listan visar allt, räknar som hemmet och säger hur mycket som är dolt", da.includes('<h2 id="hvArktext">Tre saker väntar på dig. <b>En sak brinner.</b> Två rader är dolda på hemmet.</h2>') && da.includes('data-id="r1"') && da.includes('data-id="r5"'), da.match(/<h2 id="hvArktext">[\s\S]*?<\/h2>/)?.[0]);
  const bara = hem({ chef: true, rader: [{ id: "v1", nar: "vanta", heat: 1, bkind: "rutin", t: "Granska rutinen", act: { l: "Granska" } }, { id: "v2", nar: "vanta", heat: 1, bkind: "rutin", t: "Läs kursen", act: { l: "Öppna" } }] });
  const bk = kort(bara.hvHem(), "Väntar på dig");
  ok("bara sådant som kan vänta: ingen siffra, en mening som fakta och foten 2 kan vänta", /<span class="hv-n" data-roll="vantar-n"><\/span>/.test(bk) && bk.includes("Inget brinner och inget ska göras i dag.") && /data-hvark="vantar">2 kan vänta</.test(bk), bk);
  const manga = Array.from({ length: 120 }, (_x, i) => ({ id: `m${i}`, nar: "nu", heat: 1, bkind: "uppgift", t: `Sak ${i}`, act: { l: "Klar" } }));
  ok("över 99 står 99+", /<span class="hv-n" data-roll="vantar-n">99\+<\/span>/.test(kort(hem({ chef: true, rader: manga }).hvHem(), "Väntar på dig")));

  // js-kort-1: raden går att trycka på också där knappen inte får plats, och öppnar hela listan vid raden.
  ok("varje rad i kortet har en titel som är en knapp", (k.match(/<button class="hv-radt" data-hvrad="r[0-9]" aria-label="[^"]*">/g) || []).length === 3);
  okM("titelknappen bär titeln och varför, och kapas med … på en rad", regel(".hv-radt b", hemCss) === "display:block;font-size:var(--hv-fs-4);font-weight:500;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" && regel(".hv-radt small", hemCss) === "display:block;margin-top:2px;font-size:var(--hv-fs-2);color:var(--hv-ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap", regel(".hv-radt b", hemCss));
  okM("raden har punkten, titeln och knappen i tre spalter", /^display:grid;grid-template-columns:18px minmax\(0,1fr\) auto;align-items:center;column-gap:10px;min-height:60px;/.test(regel(".hv-rad", hemCss) ?? ""), regel(".hv-rad", hemCss));
  const r = hem({ chef: true });
  klick(r, mal(["[data-hvrad]"], { hvrad: "r4" }));
  ok("ett tryck på raden öppnar hela listan med raden vald", r.S.hv.ark === "vantar" && r.S.selRad === "r4" && /class="hv-sak[^"]*\bsel\b[^"]*"[^>]*\bdata-id="r4"/.test(r.hvHem()));

  // js-kort-7 och forskningens punkt 18: hälsningen bär kortens tal och leder dit den handlar om.
  const h = hem({ chef: true }).hvHem();
  okM("läget i hälsningen öppnar Väntar på dig, mötet öppnar Min dag", h.includes('<button class="hv-herok" data-hvark="vantar"><b data-roll="lage">Två saker brinner.</b></button>') && /<button class="hv-herok" data-hvark="dag" data-m="k1">nästa 11\.00 med PEGU Byggservice\.<\/button>(?!\.)/.test(h), h.match(/<div class="hv-hero">[\s\S]*?<\/p>/)?.[0]);
  const idag = hem({ chef: true, rader: [{ id: "i1", nar: "idag", heat: 1, bkind: "uppgift", t: "Ring", act: { l: "Klar" } }] }).hvHem();
  ok("inget brinner men något ska göras i dag: det står", idag.includes('<b data-roll="lage">En sak väntar i dag.</b>'));
  const utanKal = hem({ chef: true }); utanKal.ndKopplad = (vy) => vy !== "kalender";
  const uh = utanKal.hvHem().match(/<div class="hv-hero">[\s\S]*?<\/p>/)?.[0] ?? "";
  ok("utan kalendern påstås inget om möten", !/möte/i.test(uh.replace(/<button class="hv-lyssna[\s\S]*$/, "")), uh);
  okM("på smal skärm står hälsningen bredvid den lilla urtavlan, och läget i full storlek", norm(cssBlock(hemCss, "@container hv (max-width:860px)")).includes(".hv-hero .hv-ins.kompakt{display:block}.hv-hero h1{font-size:28px}.hv-hero>div>p{font-size:var(--hv-fs-4)}"));
  ok("hemmets stil ligger i stilblocket och använder ingen backdrop-filter", hemStart.length > 0 && Math.min(...hemStart) < html.indexOf("</style>") && !/backdrop-filter/.test(hemCss));

  // js-kort-9: ett kort som är en knapp bär sina tal i namnet.
  const cg = hem({ chef: true }); cg.frKort = frKortRiktig;
  const c = cg.hvHem();
  ok("Teamet: namnet bär talet, dagen och motvikten", namnet(kort(c, "Teamet i november")) === "Teamet i november: 19 av 46 order, dag 10 av 21, 1 väntar · 1 makulerad. Visa uträkningen", namnet(kort(c, "Teamet i november")));
  ok("Det som ändrats: namnet bär talen och meningen", namnet(kort(c, "Det som ändrats")) === "Det som ändrats: 4 följs · nästa dom 27 nov. 2 av 52 möten uteblev. Carl ringer före 10. En annan ändring ser sämre ut. Visa översynen", namnet(kort(c, "Det som ändrats")));

  // js-kort-10: Mer och Laget stängs med Escape och av ett klick utanför, och Mer är en meny.
  const m = hem({ chef: true }); m.S.hv.mer = true;
  const mh = m.hvHem();
  ok("Mer är en meny med val", /data-hvmer aria-haspopup="menu" aria-expanded="true">Mer</.test(mh) && (mh.match(/role="menuitem" data-hvark=/g) || []).length === 3);
  m.hvTangent({ key: "Escape", target: {}, preventDefault() {} });
  ok("Escape stänger Mer", m.S.hv.mer === false);
  const d = hem({ chef: true }); d.S.hv.dra = true;
  d.hvTangent({ key: "Escape", target: {}, preventDefault() {} });
  ok("Escape stänger Laget", d.S.hv.dra === false);
  const u = hem({ chef: true }); u.S.hv.mer = true;
  klick(u, mal([]));
  ok("ett klick utanför stänger Mer", u.S.hv.mer === false);
  const i = hem({ chef: true }); i.S.hv.dra = true;
  klick(i, mal([".hv-dra"]));
  ok("ett klick i lagrutan stänger den inte", i.S.hv.dra === true);
  const a = hem({ chef: true }); Object.assign(a.S.hv, { ark: "andrat", mer: true });
  a.hvTangent({ key: "Escape", target: {}, preventDefault() {} });
  ok("Escape stänger Mer först, inte arket under", a.S.hv.mer === false && a.S.hv.ark === "andrat");

  // js-kort-2: ett inlägg som inte är öppet fastnar aldrig på Laddar.
  const t = hem({ chef: true });
  const losa = {};
  t.ndLas = (url) => new Promise((klar) => { losa[/las=team/.test(url) ? "team" : "andrat"] = klar; });
  let ritat = 0; t.render = () => { ritat++; };
  t.hvOppna("team"); t.hvOppna("andrat");
  losa.andrat({ ok: true, data: { farLaget: true, krets: null, kalla: "Räknat av regler", matt: [], andrat: [] } });
  await Promise.resolve(); await Promise.resolve();
  const fore = ritat;
  losa.team({ ok: false, data: { fel: "Lagets tal gick inte att läsa." } });
  await Promise.resolve(); await Promise.resolve();
  const th = t.hvHem(), team = th.match(/<div class="hv-tur" data-hvnr="\d+" data-hvinl="team">[\s\S]*?(?=<div class="hv-tur")/)?.[0] ?? "";
  ok("svaret för ett inlägg som inte är öppet ritas ändå", ritat > fore);
  ok("och dess fel står i inlägget, med Försök igen", team.includes("Lagets tal gick inte att läsa.") && team.includes("data-hvigen") && !team.includes("Läser order"), team.slice(0, 400));
  ok("det öppna inlägget har inget fel", !t.S.hv.fel);

  const f = hem({ chef: false, forslag: 2 });
  const fl = {};
  f.ndLas = (url) => new Promise((klar) => { fl[url.match(/id=(\w+)/)[1]] = klar; });
  f.hvOppna("forslag", "f0"); f.hvOppna("forslag", "f1");
  fl.f1({ ok: true, data: { forslag: { ...FORSLAG(2)[1], lage: "oppet", mitt: true } } });
  fl.f0({ ok: true, data: { forslag: { ...FORSLAG(2)[0], lage: "oppet", mitt: true } } });
  await Promise.resolve(); await Promise.resolve();
  const fh = f.hvHem();
  ok("två förslag i tråden visar var sitt möte, inget står kvar på Hämtar", !fh.includes("Hämtar mötet") && (fh.match(/data-hvinl="forslag"/g) || []).length === 2, fh.match(/Hämtar mötet/g)?.length);

  // Valet i det äldre av två förslag gäller det förslagets möte, inte det som hämtades sist.
  const flytt = [];
  Object.assign(f, { ndMo: () => ({ kort: [{ mote: { id: "m0" } }, { mote: { id: "m1" } }] }), moGa: () => {}, ndMoDialog: (_v, k2) => { flytt.push(k2.mote.id); } });
  Object.assign(f.S.hv, { ark: "forslag", id: "f0" });
  f.S.hv.data.forslag = f.S.hv.data["forslag:f1"];   // f1 hämtades sist
  ok("båda förslagen ligger kvar under sina id", f.S.hv.data["forslag:f0"].forslag.mote === "m0" && f.S.hv.data["forslag:f1"].forslag.mote === "m1");
  await f.hvValj("flytta");
  ok("Flytta i det äldre förslaget öppnar just det mötet", flytt.join() === "m0", flytt.join());

  // Ett klick i skrivrutan stänger också Mer (och ritar om i nästa bildruta, med fokus kvar).
  const q = hem({ chef: true }); q.S.hv.mer = true;
  klick(q, { closest: (sel) => (/textarea/.test(sel) ? {} : null) });
  ok("ett klick i skrivrutan stänger Mer", q.S.hv.mer === false);
  ok("omritningen behåller fokus och markör", /function hvRitaBehall\(\)\{[\s\S]*?b\.focus\(\); if \(pos !== null && b\.setSelectionRange\) b\.setSelectionRange\(pos, pos\);/.test(block) && block.includes("requestAnimationFrame(hvRitaBehall)"));

  // Forskningens punkt 16: J och K flyttar mellan raderna i kortet, utan att röra Navs vanliga tangenter.
  const jk = hem({ chef: true });
  const knappar = [0, 1, 2].map((n) => ({ n, focus() { jk.document.activeElement = this; } }));
  jk.document = { ...jk.document, activeElement: null, querySelectorAll: (sel) => (sel === ".hv-radt" ? knappar : []) };
  const tang = (key, extra = {}) => { let stopp = false; jk.hvTangent({ key, target: { matches: () => false }, preventDefault() { stopp = true; }, ...extra }); return stopp; };
  tang("j");
  ok("J ger fokus åt första raden", jk.document.activeElement === knappar[0]);
  tang("j"); tang("j"); tang("j");
  ok("J stannar på sista raden", jk.document.activeElement === knappar[2]);
  tang("k");
  ok("K går upp", jk.document.activeElement === knappar[1]);
  ok("Cmd+K är paletten, inte en rad", tang("k", { metaKey: true }) === false && jk.document.activeElement === knappar[1]);
  jk.S.hv.ark = "vantar";
  ok("i hela listan lämnas J åt Navs vanliga tangenter", tang("j") === false && jk.document.activeElement === knappar[1]);

  // Forskningens punkt 13: rullningen följer personens val om rörelse.
  ok("tråden glider bara när rörelse är tillåten", /const hvGlid = \(\) => typeof window\.matchMedia === 'function' && window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches \? 'auto' : 'smooth';/.test(html) && !/behavior:'smooth'/.test(block));
}

rubrik("Lyftet: chattens klient (stopp, försök igen, stegen, rullningen och strömmen)");
{
  const enc = new TextEncoder();
  const rad = (h) => `data: ${JSON.stringify(h)}\n\n`;
  // En ström av färdiga bitar (godtyckligt kapade), som rutten skickar dem.
  const bitar = (delar) => ({ ok: true, status: 200, headers: { get: () => "text/event-stream; charset=utf-8" }, body: { getReader() { let i = 0; return { read: async () => (i < delar.length ? { done: false, value: enc.encode(delar[i++]) } : { done: true }) }; } } });
  // En ström som ger ett steg och sedan väntar tills frågan stoppas, som fetch gör: läsningen kastar när signalen avbryts.
  const hanger = (init) => ({ ok: true, status: 200, headers: { get: () => "text/event-stream" }, body: { getReader() { let i = 0; return { read: () => (i++ === 0 ? Promise.resolve({ done: false, value: enc.encode(rad({ h: "hamtar", text: "Hämtar det som väntar på dig.", anrop: 1, verktyg: "las_vantar" })) }) : new Promise((_ja, nej) => { init.signal.addEventListener("abort", () => nej(Object.assign(new Error("Aborted"), { name: "AbortError" }))); })) }; } } });
  const SV = { h: "svar", text: "Du har ⟦t1:3⟧ saker som väntar.", tal: [{ id: "t1", varde: 3, om: "Väntar på dig · data per 2026-11-16" }], obelagda: 0, kalla: "Skrivet av AI ur Navs tal", kort: [] };
  const vanta = (ms = 5) => new Promise((k) => setTimeout(k, ms));
  const chatt = () => { const g = hem({ chef: false }); g.ND.hem.chatt = true; return g; };

  // Strömmens tolkning: \r\n, en händelse kapad mitt i, och den sista utan avslutande tom rad.
  const d = chatt();
  const del1 = d.hvSseDela('data: {"h":"hamtar","text":"A"}\r\n\r\ndata: {"h":"kla', false);
  ok("strömmen delas på \\r\\n\\r\\n, och en kapad händelse väntar på resten", del1.ut.length === 1 && del1.ut[0].text === "A" && del1.rest === 'data: {"h":"kla', JSON.stringify(del1));
  const del2 = d.hvSseDela(del1.rest + 'rt","anrop":1,"ok":true}\n\ndata: {"h":"svar","text":"B"}', true);
  ok("när strömmen är slut tolkas också det sista, utan tom rad efter", del2.ut.length === 2 && del2.ut[0].h === "klart" && del2.ut[1].text === "B" && del2.rest === "", JSON.stringify(del2));
  ok("en rad som inte är JSON hoppas över, utan att resten faller", d.hvSseDela("data: {trasig\n\ndata: {\"h\":\"svar\",\"text\":\"C\"}\n\n", false).ut.map((x) => x.text).join() === "C");
  d.fetch = async () => bitar([rad({ h: "hamtar", text: "Hämtar det som väntar på dig.", anrop: 1, verktyg: "las_vantar" }).slice(0, 20), rad({ h: "hamtar", text: "Hämtar det som väntar på dig.", anrop: 1, verktyg: "las_vantar" }).slice(20) + rad({ h: "klart", anrop: 1, ok: true, text: "Väntar på dig · data per 2026-11-16", ms: 420 }), JSON.stringify(SV).replace(/^/, "data: ")]);
  d.S.hv.q = "Vad väntar?";
  await d.hvFraga();
  const dh = d.hvHem();
  ok("ett svar utan tom rad sist och en händelse kapad över två bitar ger ändå svaret", d.S.hv.chatt[0].svar && !d.S.hv.chatt[0].fel && dh.includes('data-hvtal="0:t1"'), d.S.hv.chatt[0].fel);

  // Stegen: öppna medan frågan pågår, en rad när svaret kommit, som fälls ut med källraden.
  ok("när svaret kommit står stegen som en enda rad med antal och tid", /<button class="hv-stegk" data-hvchattsteg="0" aria-expanded="false"><svg[^>]*>[\s\S]*?<\/svg><span>Ett steg( · \d+,\d s)?<\/span><\/button>/.test(dh), dh.slice(dh.indexOf("hv-stegrad"), dh.indexOf("hv-stegrad") + 300));
  ok("och stegens text ligger inte kvar som lös text ovanför svaret", !dh.includes("Hämtar det som väntar på dig."));
  d.hvKlick({ target: { closest: () => ({ dataset: { hvchattsteg: "0" } }) }, preventDefault() {}, stopPropagation() {} });
  const dut = d.hvHem();
  ok("ett tryck fäller ut stegen, med källraden och data per", dut.includes('aria-expanded="true"') && dut.includes("Hämtar det som väntar på dig.") && dut.includes("Väntar på dig · data per 2026-11-16") && dut.includes("0,4 s"));
  ok("under svaret: Kopiera, Försök igen och en väg till det svaret läste", dut.includes('data-hvchattkop="0"') && dut.includes('data-hvchattigen="0"') && dut.includes('<button class="hv-atgk" data-hvark="vantar">Öppna Väntar på dig</button>'));

  // Kopiera tar texten utan Navs märken.
  const kopierat = [];
  d.navigator = { clipboard: { writeText: async (t) => { kopierat.push(t); } } };
  await d.hvKopiera(0);
  ok("Kopiera tar svarets text utan märken, och knappen säger Kopierat", kopierat[0] === "Du har 3 saker som väntar." && d.hvHem().includes("Kopierat"), JSON.stringify(kopierat));

  // Stopp: Skicka blir Stopp medan svaret pågår, och Esc stoppar.
  const s = chatt();
  let signal = null;
  const stopp = [];
  s.fetch = async (_url, init) => { if (JSON.parse(init.body).stoppa){ stopp.push(init); return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => ({ ok: true }) }; } signal = init.signal; return hanger(init); };
  s.S.hv.q = "Vad väntar på mig?";
  const p = s.hvFraga();
  await vanta();
  const under = s.hvHem();
  ok("medan svaret pågår är Skicka en Stopp-knapp, och tråden är upptagen", /<button type="button" class="hv-send stopp" data-hvstopp aria-label="Stoppa svaret" title="Stoppa svaret \(esc\)">/.test(under) && !under.includes('aria-label="Skicka"') && under.includes('aria-busy="true"'));
  ok("medan verktyget kör står steget öppet, med en ring för det som pågår", /<ol class="hv-tsteg" aria-label="Det Nav gör">(?:<li class="[a-z]*">[\s\S]*?<\/li>)*<li class="gar">/.test(under) && under.includes("Hämtar det som väntar på dig."));
  s.toast = (t) => s.anrop.push(["toast", t]);
  s.S.hv.q = "en till";
  s.hvFraga();
  ok("en ny fråga medan svaret pågår skickas inte, och rutan säger hur man stoppar", s.S.hv.chatt.length === 1 && s.anrop.some((a) => a[0] === "toast" && /Esc stoppar svaret/.test(a[1])));
  let hindrad = false;
  s.hvTangent({ key: "Escape", target: { id: "hvQ", value: "en till" }, preventDefault() { hindrad = true; } });
  await p; await vanta();
  const efter = s.hvHem(), st = s.S.hv.chatt[0];
  ok("Esc stoppar svaret: hämtningen avbryts och turen säger det, utan nätfel", hindrad && signal.aborted && st.stoppad && !st.laddar && efter.includes("Du stoppade svaret.") && !/Nav svarade inte/.test(efter), JSON.stringify({ hindrad, ab: signal && signal.aborted, st: { stoppad: st.stoppad, laddar: st.laddar, fel: st.fel } }));
  ok("stoppet sägs också till rutten, så att frågan inte spärrar nästa", stopp.length === 1 && stopp[0].keepalive === true && stopp[0].signal === undefined);
  ok("efter stoppet är Skicka tillbaka, och tråden är inte upptagen", efter.includes('<button type="submit" class="hv-send" aria-label="Skicka">') && !efter.includes("data-hvstopp") && efter.includes('aria-busy="false"') && s.S.hv.strom === null);
  ok("efter stoppet står Esc åt arket igen (tråden stängs inte av samma tryck)", s.S.hv.ark === "chatt");
  st.stegOppen = true;
  const stegEfter = s.hvHem();
  ok("ett steg som aldrig blev klart får ingen bock efter stoppet", stegEfter.includes('<li class="ej">') && stegEfter.includes("Blev inte klart.") && !stegEfter.includes('<li class="ok">'), stegEfter.slice(stegEfter.indexOf("hv-stegrad"), stegEfter.indexOf("hv-stegrad") + 500));
  st.stegOppen = false;

  // Går man hem medan svaret pågår ritas hemmet ändå om när svaret kommit, så att Stopp blir Skicka igen.
  const hemma = chatt();
  let gr2; const grind2 = new Promise((k2) => { gr2 = k2; });
  hemma.fetch = async () => ({ ok: true, status: 200, headers: { get: () => "text/event-stream" }, body: { getReader() { let i = 0; return { read: async () => { if (i === 1) await grind2; return i++ < 1 ? { done: false, value: enc.encode(rad(SV)) } : { done: true }; } }; } } });
  let ritat = 0;
  hemma.render = () => { ritat++; };
  hemma.S.hv.q = "Vad väntar?";
  const ph = hemma.hvFraga();
  hemma.S.hv.ark = null; hemma.S.hv.id = null;
  const fore = ritat;
  gr2(); await ph;
  ok("svaret ritar om hemmet också när man har gått hem under tiden", ritat > fore && hemma.S.hv.strom === null && hemma.hvSkriv().includes('aria-label="Skicka"'));
  ok("ett dubbelklick på Skicka stoppar inte frågan det just skickade", /if \(S\.hv\.strom && Date\.now\(\) - S\.hv\.strom\.tur\.start > 400\) hvChattStopp\(\);/.test(block));

  // Försök igen: samma tur, inget nytt inlägg, och samtalet före turen följer med (men inte turen själv).
  const skickat = [];
  s.fetch = async (_url, init) => { skickat.push(JSON.parse(init.body)); return bitar([rad(SV)]); };
  s.hvKlick({ target: { closest: () => ({ dataset: { hvchattigen: "0" } }) }, preventDefault() {}, stopPropagation() {} });
  await vanta();
  const igen = s.hvHem();
  ok("Försök igen ställer samma fråga i samma tur, utan dubblett", skickat.length === 1 && skickat[0].fraga === "Vad väntar på mig?" && skickat[0].historia.length === 0 && s.S.hv.chatt.length === 1 && (igen.match(/class="hv-tur"/g) || []).length === 1 && s.S.hv.trad.filter((t) => t.sort === "chatt").length === 1 && igen.includes('data-hvtal="0:t1"') && !igen.includes("Du stoppade svaret."), JSON.stringify(skickat));

  // Filerna sparas på turen och följer med Försök igen.
  const f = chatt();
  const fskick = [];
  f.fetch = async (_url, init) => { fskick.push(JSON.parse(init.body)); return fskick.length === 1 ? { ok: false, status: 503, headers: { get: () => "application/json" }, json: async () => ({ fel: "Chatten är tillfälligt upptagen. Försök igen om en stund.", kod: "tillfalligt" }) } : bitar([rad(SV)]); };
  f.S.hv.bilagor = [{ sort: "image/png", namn: "kvitto.png", data: "AAAA" }];
  f.S.hv.q = "Vad står här?";
  await f.hvFraga();
  const ff = f.hvHem();
  ok("ett tillfälligt fel (503) erbjuder både Försök igen och Sök i stället (N4), och säger vad som hände", ff.includes("Chatten är tillfälligt upptagen.") && ff.includes('data-hvchattigen="0"') && ff.includes('data-hvchattsok="0"'), ff.slice(ff.indexOf("hv-tur"), ff.indexOf("hv-tur") + 700));
  await f.hvChattIgen(0);
  ok("Försök igen skickar samma filer igen", fskick.length === 2 && fskick[1].bilagor?.length === 1 && fskick[1].bilagor[0].namn === "kvitto.png" && f.S.hv.chatt.length === 1 && f.S.hv.chatt[0].svar);
  ok("Försök igen går inte när ett svar pågår eller på en äldre tur", (() => { f.S.hv.chatt.push({ ...f.S.hv.chatt[0], lage: [] }); const n = fskick.length; f.hvChattIgen(0); return fskick.length === n; })());
  f.S.hv.chatt.pop();

  // Felkoderna avgör knappen.
  const kod = async (k, text) => { const g = chatt(); g.fetch = async () => bitar([rad({ h: "fel", text, kod: k })]); g.S.hv.q = "fråga"; await g.hvFraga(); return g.hvHem(); };
  const langt = await kod("langt", "Svaret blev för långt och bröts. Försök med en smalare fråga.");
  ok("för långt: Ändra frågan, inte samma fråga igen", langt.includes('data-hvchattandra="0"') && !langt.includes('data-hvchattigen="0"') && langt.includes('<p role="alert">Svaret blev för långt'));
  const tomt = await kod("tomt", "Jag fick inget svar. Försök igen.");
  ok("inget svar: Försök igen", tomt.includes('data-hvchattigen="0"') && !tomt.includes("data-hvchattsok"));
  const ai = await kod("ai", "Chatten svarar inte just nu. Sök i stället ger svar ur Navs sökruta.");
  ok("AI svarar inte: Sök i stället", ai.includes('data-hvchattsok="0"') && !ai.includes('data-hvchattigen'));
  const json = async (status, data) => { const g = chatt(); g.fetch = async () => ({ ok: false, status, headers: { get: () => "application/json" }, json: async () => data }); g.S.hv.q = "fråga"; await g.hvFraga(); return g.hvHem(); };
  const tak = await json(429, { fel: "Du har använt månadens AI-utrymme. Det fylls på den 1:a.", tak: true, kod: "tak" });
  ok("gränsen nådd (kod tak): bara Sök i stället", tak.includes('data-hvchattsok="0"') && !tak.includes("data-hvchattigen") && !tak.includes("data-hvchattandra"));
  const pagar = await json(429, { fel: "Din förra fråga pågår fortfarande. Försök igen när den är klar.", kod: "pagar" });
  ok("förra frågan pågår (kod pagar): bara Försök igen", pagar.includes('data-hvchattigen="0"') && !pagar.includes("data-hvchattsok") && pagar.includes("Din förra fråga pågår fortfarande."));
  const a = chatt();
  a.fetch = async () => bitar([rad({ h: "fel", text: "Frågan blev för stor för chatten.", kod: "for-stor" })]);
  a.S.hv.bilagor = [{ sort: "application/pdf", namn: "stor.pdf", data: "AAAA" }];
  a.S.hv.q = "Läs den här";
  await a.hvFraga();
  a.hvKlick({ target: { closest: () => ({ dataset: { hvchattandra: "0" } }) }, preventDefault() {}, stopPropagation() {} });
  ok("Ändra frågan lägger frågan i rutan igen, utan filen som var för stor", a.S.hv.q === "Läs den här" && (a.S.hv.bilagor || []).length === 0);
  const nat = chatt();
  nat.fetch = async () => { throw new Error("nätet"); };
  nat.S.hv.q = "hej";
  await nat.hvFraga();
  ok("nätfel: rutan säger det och erbjuder samma fråga igen", /Nav svarade inte/.test(nat.hvHem()) && nat.hvHem().includes('data-hvchattigen="0"') && nat.S.hv.chatt[0].kod === "nat");

  // Rullningen: följer bara vid botten, och tangenterna uppåt i tråden släpper.
  ok("vid botten inom 50 px", d.hvVidBotten({ scrollHeight: 1000, scrollTop: 900, clientHeight: 60 }) === true && d.hvVidBotten({ scrollHeight: 1000, scrollTop: 800, clientHeight: 60 }) === false && d.hvVidBotten(null) === false);
  d.S.hv.folj = true;
  d.hvTangent({ key: "PageUp", target: { closest: (sel) => (sel === "#hvTrad" ? {} : null), matches: () => false }, preventDefault() {} });
  ok("Page Up i tråden släpper följandet", d.S.hv.folj === false);
  d.S.hv.q = "en fråga till";
  d.fetch = async () => bitar([rad(SV)]);
  await d.hvFraga();
  ok("en ny fråga följer igen", d.S.hv.folj === true);
  // Skissen ritar Nytt svar bara när något kommit under (trad.js rad 117, app.js rad 114–115). Stilen ger knappen display,
  // så den läggs till och tas bort (hvNere) i stället för att döljas med hidden.
  ok("Nytt svar finns i tråden men är dold tills något kommit under", !/class="hv-nere"/.test(d.hvHem()) && /function hvNere\(pa\)\{[\s\S]{0,200}if \(!pa\)\{ if \(b\) b\.remove\(\); return; \}/.test(html));
  d.S.hv.nere = true;
  ok("och syns när läsaren står ovanför det som kommit", /<button class="hv-nere" data-hvnere><svg class="hv-i" viewBox="0 0 24 24"[^>]*><path d="M9\.5 6l6 6-6 6"\/><\/svg>Nytt svar<\/button><\/div><\/div>/.test(d.hvHem()));
  ok("Nytt svar och Stopp går att klicka (väljaren i hvKlick)", /\[data-hvstopp\], \[data-hvnere\], \[data-hvchattigen\], \[data-hvchattandra\], \[data-hvchattkop\], \[data-hvchattsteg\]/.test(block));

  // Skrivrutan: Enter under en ordkomposition skickar inte, och pil upp tar fram den senaste frågan.
  const e = chatt();
  let ehamtat = 0;
  e.fetch = async () => { ehamtat++; return bitar([rad(SV)]); };
  e.S.hv.q = "hej";
  e.hvTangent({ key: "Enter", keyCode: 229, target: { id: "hvQ" }, preventDefault() {} });
  ok("Enter medan ett ord sätts ihop (IME) skickar inte", ehamtat === 0 && e.S.hv.q === "hej");
  await e.hvTangent({ key: "Enter", target: { id: "hvQ" }, preventDefault() {} });
  await vanta();
  const falt = { id: "hvQ", value: "", style: {}, classList: { toggle() {} } };
  e.hvTangent({ key: "ArrowUp", target: falt, preventDefault() {} });
  ok("Enter skickar, och pil upp i en tom ruta tar fram frågan", ehamtat === 1 && falt.value === "hej" && e.S.hv.q === "hej");
  ok("utan chatt säger rutan att den söker, utan Bifoga och tips", (() => { const g = hem({ chef: false }); const sk = g.hvSkriv(); return sk.includes('placeholder="Sök i Nav…"') && !sk.includes("data-hvbifoga") && !sk.includes("data-hvtips") && !sk.includes('id="hvFil"'); })());

  // Godkänn: ett kast i rutten släpper knappen, felet står på kortet och raderna säger var det stannade.
  const KORT2 = { rubrik: "Lägg upp 2 uppgifter", klart: "Uppgifterna är upplagda.", varning: null, rader: [{ text: "Ring A", dag: null, not: "" }, { text: "Ring B", dag: null, not: "" }],
    steg: [{ vag: "/nav2/uppgifter", body: { handling: "skapa", titel: "Ring A" }, angra: null }, { vag: "/nav2/uppgifter", body: { handling: "skapa", titel: "Ring B" }, angra: null }] };
  const k = chatt();
  k.fetch = async () => bitar([rad({ h: "svar", text: "Förberett.", tal: [], obelagda: 0, kalla: "Skrivet av AI", kort: [KORT2] })]);
  let kn = 0;
  k.ndSkriv = async () => { kn++; if (kn === 2) throw new Error("nätet"); return { ok: "Sparat.", id: "x" + kn }; };
  k.ndSvar = (x) => x; k.ndOmlas = () => Promise.resolve(true); k.NDOMLAS = {};
  k.S.hv.q = "Lägg upp det";
  await k.hvFraga();
  await k.hvChattGodkann(0, 0);
  const kh = k.hvHem(), lage = k.S.hv.chatt[0].lage[0];
  ok("kastar rutten släpps knappen, och kortet säger vilket steg som inte gick", lage.gor === false && kh.includes("1 av 2 är gjorda.") && kh.includes("Steg 2 av 2 gick inte: Det gick inte att spara.") && kh.includes(">Gör resten<") && !kh.includes("disabled"), kh.slice(kh.indexOf("hv-utk"), kh.indexOf("hv-utk") + 900));
  // Skissens rader i kortet (trad.js rad 64). Produkten ger bocken namnet Gjord och raden som stannade namnet Gick inte.
  ok("kvittot per rad: den första är gjord, den andra stannade", /<li class="gjord"><span class="hv-ok" role="img" aria-label="Gjord"><svg[^>]*>[\s\S]*?<\/svg><\/span><span>Ring A<\/span><small><\/small><\/li>/.test(kh) && /<li class="fel"><i role="img" aria-label="Gick inte"><\/i><span>Ring B<\/span><small><\/small><\/li>/.test(kh), kh.match(/<ul><li[\s\S]*?<\/ul>/)?.[0]);
  ok("Försök igen erbjuds inte när ett kort har börjat göras", !kh.includes('data-hvchattigen="0"'));
  await k.hvChattGodkann(0, 0);
  ok("nästa tryck gör resten och felet försvinner", kn === 3 && k.S.hv.chatt[0].lage[0].slut === "klart" && !k.hvHem().includes("gick inte"));

  // Dubbelklick: ett andra tryck medan det första sparar gör ingenting.
  const gr = hem({ chef: true });
  let gratt = 0, slapp;
  gr.ndHemPost = (h) => { if (h === "grattis") gratt++; return new Promise((r) => { slapp = () => r({ ok: "Grattis skickat." }); }); };
  const g1 = gr.hvGrattis("o1"), g2 = gr.hvGrattis("o1");
  slapp(); await g1; await g2;
  ok("Grattis två gånger i rad skickas en gång", gratt === 1);
  gr.ndHemPost = async (h) => { if (h === "grattis") gratt++; return { ok: "Grattis tillbakatagen." }; };
  await gr.hvGrattis("o1");
  ok("och spärren släpps när svaret kommit", gratt === 2);

  // Min dag: kvittot säger hur många som blev bokade, och Ångra hur många som ångrades.
  const md = hem({ chef: false });
  md.TASKS = [{ id: "7", due: null, tid: null }, { id: "8", due: "2026-11-18", tid: "10:00" }, { id: "9", due: null, tid: null }];
  md.S.hv.dagPlan = [{ id: "7", tid: "09:00" }, { id: "8", tid: "10:00" }, { id: "9", tid: "11:00" }];
  let mdn = 0;
  md.ndUpgPost = async () => (++mdn === 3 ? { fel: "nej" } : { ok: true });
  await md.hvBokaDag();
  ok("stannar bokningen halvvägs säger kvittot 2 av 3", md.S.hv.kvitto && md.S.hv.kvitto.text === "2 av 3 uppgifter är bokade i din kalender. Resten gick inte att boka." && md.S.hv.dagBokad.length === 2, JSON.stringify(md.S.hv.kvitto));
  mdn = 0;
  md.ndUpgPost = async () => (++mdn === 2 ? null : { ok: true });
  await md.hvAngraDag();
  ok("går Ångra bara delvis står det, och Ångra gäller det som är kvar", /^Ångrade 1 av 2\. En uppgift har kvar den nya tiden\.$/.test(md.S.hv.kvitto?.text || "") && md.S.hv.dagBokad.length === 1, JSON.stringify(md.S.hv.kvitto));

  // Språket står på ett ställe.
  ok("taligenkänningen, dollarbeloppen och namnordningen använder HVLOK", block.includes("r.lang = HVLOK.sprak") && block.includes("toLocaleString(HVLOK.sprak, {minimumFractionDigits") && block.includes("localeCompare(String(b.namn), HVLOK.sprak)") && !/'sv-SE'\)|, 'sv'\)/.test(block.replace("const HVLOK = {sprak:'sv-SE'", "")));
}

/* ------------------------------------------------------------------------ */
/* Skiss A v2: urtavlan, hälsningen och kvällen                              */
/* ------------------------------------------------------------------------ */

// Den stora urtavlan i hemmets mitt, ur hemmets markup (mellan hv-urkol och hv-lage), med ikonerna som ⟨svg⟩.
const urtavlan = (h) => { const i = h.indexOf('<div class="hv-ins stor"'), j = h.indexOf('<div class="hv-lage">'); return i < 0 || j < i ? "" : utanIkon(h.slice(i, j).replace(/<\/div>\s*$/, "")); };
const utanLyssna = (s) => s.replace(/<button class="hv-lyssna[\s\S]*?<\/button>/, "⟨lyssna⟩");
const SCHEMA = { start: 480, slut: 1020, rast: 45 };
// En uppgift med egen tid (15.00, 15 min): i Uppgifter står tiden på uppgiften (TASKS.tid), på raden i minuter.
const FRISTRAD = { id: "upg-9", nar: "idag", heat: 2, bkind: "uppgift", kind: "Uppgift", bt: "{Skicka offert till Solbacken} i dag 15:00.", t: "Skicka offert till Solbacken", why: "i dag 15:00", act: { l: "Klar", check: true }, tid: 900, gor: () => {}, ga: () => {} };
const heldag = (x = {}) => {
  const g = hem({ chef: true, dag: SCHEMA, nu: 630, ...x });
  g.ndHemRad = [...g.ndHemRad, FRISTRAD];
  g.TASKS = [...g.TASKS, { id: "9", t: "Skicka offert till Solbacken", tid: "15:00", est: 15, due: "2026-11-16", ndDue: "2026-11-16", ndNytt: [] }];
  return g;
};

rubrik("Urtavlan: arbetsdagen som en båge från schemats början till dess slut (skiss A)");
{
  const g = hem({ chef: true });
  const v = (min, ram = { T0: 480, T1: 1020 }) => g.hvUrVink(min, ram);
  ok("vinkeln för en tid: ramens början -150 grader, slutet 150, 10.00 i en dag 08–17 är -83,3", v(480) === -150 && v(1020) === 150 && typeof v(600) === "number" && Math.abs(v(600) + 83.3333) < 0.001 && v(750, { T0: 420, T1: 1080 }) === 0, [v(480), v(600), v(1020)].join(" "));
  ok("före och efter ramen står vinkeln vid kanten", v(300) === -150 && v(1200) === 150);
  // hvUrRam ger {T0,T1}. Kontraktet säger inte om den tar dagen som argument; provet frågar på de sätt skissen gör.
  const ram = (gg, dag = "idag") => { for (const f of [() => gg.hvUrRam(gg.hvD(), dag), () => gg.hvUrRam(dag), () => gg.hvUrRam(undefined, dag), () => gg.hvUrRam()]) { try { const r = f(); if (r && Number.isFinite(r.T0) && Number.isFinite(r.T1)) return { T0: r.T0, T1: r.T1 }; } catch { /* nästa sätt */ } } return null; };
  ok("utan schema är ramen 08–17", JSON.stringify(ram(g)) === '{"T0":480,"T1":1020}', JSON.stringify(ram(g)));
  const s = hem({ chef: true, dag: { start: 450, slut: 990, rast: 0 } });
  ok("med schema är ramen schemat, utdraget till hela timmar", JSON.stringify(ram(s)) === '{"T0":420,"T1":1020}', JSON.stringify(ram(s)));
  const t = hem({ chef: true, kal: [{ s: 435, e: 465, t: "Tidigt", id: "k9" }] });
  ok("ett möte före ramen drar ut den till en hel timme", JSON.stringify(ram(t)) === '{"T0":420,"T1":1020}', JSON.stringify(ram(t)));

  const a = urtavlan(g.hvHem());
  okM("chefen 08.00 utan schema: urtavlan är skissens, tecken för tecken", a === SK.A_ur, a.slice(0, 600));
  okM("urtavlan säger i ord det den ritar", a.startsWith('<div class="hv-ins stor" data-flip="ur" role="group" aria-label="Dagen utan schema, klockan 08.00. Två möten kvar, två saker brinner">'), a.slice(0, 200));
  okM("utan schema ritas 08 till 17", /<text class="r-siffra ande" [^>]*>08<\/text>/.test(a) && /<text class="r-siffra ande" [^>]*>17<\/text>/.test(a) && (a.match(/<text class="r-siffra/g) || []).length === 10, (a.match(/<text[^>]*>\d\d<\/text>/g) || []).join(""));

  const b = heldag(), bu = urtavlan(b.hvHem());
  okM("hela dagen (schema, 10.30, en frist, en order): urtavlan är skissens, tecken för tecken", bu === SK.B_ur, bu.slice(0, 600));
  const moten = SK.B_ur.match(/<path class="m r-mote[^>]*>/g) ?? [];
  okM("mötena är breda bågar på sina tider", moten.length === 2 && moten.every((m) => bu.includes(m)), moten.join(" "));
  okM("en uppgift med egen tid står som frist, ett streck på sin minut", bu.includes(SK.B_ur.match(/<line class="m r-frist[^>]*>/)?.[0] ?? "∅") && bu.includes('aria-label="Frist 15.00 · Skicka offert till Solbacken. 15 min · Öppna Min dag"'), bu.match(/<line class="m r-frist[^>]*>/)?.[0]);
  const vinkel = +(bu.match(/<g class="r-vis" data-vis="stor" data-vinkel="(-?[\d.]+)" style="transform:rotate\((-?[\d.]+)deg\)">/)?.[1] ?? NaN);
  const brinn = bu.match(/<button class="hv-pin brinn" style="left:([\d.]+)%;top:([\d.]+)%" data-m="brinn" data-hvark="vantar" aria-label="Två saker brinner nu\. Öppna Väntar på dig"><span data-roll="brinn-stor">2<\/span>/);
  const pa = (r, gr) => [((200 + r * Math.sin(gr * Math.PI / 180)) / 4).toFixed(1), ((200 - r * Math.cos(gr * Math.PI / 180)) / 4).toFixed(1)];
  ok("det som brinner sitter på visaren, med antalet", !!brinn && Math.abs(vinkel - (-150 + (630 - 480) / 540 * 300)) < 0.06 && brinn[1] === pa(126, vinkel)[0] && brinn[2] === pa(126, vinkel)[1], `vinkel ${vinkel}, märket ${brinn?.slice(1, 3)}`);
  ok("dagens order är en prick på ringen vid sin tid, och leder till Golvet", /<circle class="m r-order" data-m="o1" style="--i:\d+" cx="28\.7" cy="159\.4" r="4\.5"\/>/.test(bu) && /<button class="hv-pin" style="[^"]*" data-m="o1" data-hvark="golvet" aria-label="10[.:]12 · Mick Prov signerade Hagmans Rör\. Stor, 36 månader · Öppna Golvet">/.test(bu), bu.match(/<circle[^>]*>/)?.[0]);
  ok("en order senare än nu syns inte än", !bu.includes('data-m="o2"'));
  const lyssnar = html.match(/e\.target\.closest\('(\[data-hvtr\][^']*)'\)/)?.[1].match(/data-[a-z]+/g) ?? [];
  const pins = [...bu.matchAll(/<button class="hv-pin[^"]*"([^>]*)>/g)].map((m) => m[1]);
  ok("varje märke på urtavlan är en knapp med ett namn och ett mål", pins.length === (SK.B_ur.match(/<button class="hv-pin/g) || []).length && pins.every((p) => /aria-label="[^"]{8,}"/.test(p) && lyssnar.some((x) => new RegExp(`\\b${x}=`).test(p))), pins.join(" | ").slice(0, 400));
  ok("mitten säger nästa sak med nedräkning, och leder till Min dag", bu.includes('<button class="hv-mitt" data-hvark="dag" data-m="k1" aria-label="11.00 PEGU Byggservice. Öppna Min dag"><span class="l">Nästa</span><span class="k num" data-roll="mitt-k-stor">11.00</span><span class="v">PEGU Byggservice</span><span class="s" data-roll="mitt-s-stor">om 30 min</span></button>'), bu.match(/<(button|div) class="hv-mitt[\s\S]*$/)?.[0]);
}

rubrik("Utan schema och utan kalender: urtavlan lovar inget den inte vet (skiss A)");
{
  // Den egna ordern (du) står med säljarens namn här, som i skissen: hur produkten skriver "Du" prövas i Golvet.
  const golv = { ...GOLVET, idag: GOLVET.idag.map((o) => ({ ...o, du: false })) };
  const e = urtavlan(hem({ chef: true, nu: 930, golvet: golv }).hvHem());
  okM("utan schema, efter dagens möten: urtavlan är skissens", e === SK.E_ur, e.slice(e.indexOf("hv-mitt") - 12));
  ok("utan schema lovar mitten inget om arbetsdagens slut", !e.includes("Arbetsdagen slutar") && e.includes('<span class="l">Klockan</span><span class="k num" data-roll="mitt-k-stor">15.30</span><span class="v">Inga fler möten i dag</span>'), e.slice(e.indexOf("hv-mitt") - 12));
  const e2 = urtavlan(hem({ chef: true, nu: 930, dag: SCHEMA, golvet: golv }).hvHem());
  ok("med schema säger mitten när arbetsdagen slutar", e2 === SK.E2_ur && e2.includes('<span class="v">Arbetsdagen slutar</span><span class="s" data-roll="mitt-s-stor">1 h 30 min kvar</span>'), e2.slice(e2.indexOf("hv-mitt") - 12));
  const fg = hem({ chef: true, kalender: false, kal: [], kalImorgon: [] }), fh = fg.hvHem(), f = urtavlan(fh);
  const lyssnar = html.match(/e\.target\.closest\('(\[data-hvtr\][^']*)'\)/)?.[1].match(/data-[a-z]+/g) ?? [];
  const koppla = f.match(/<button class="hv-lank" (data-[a-z]+)(?:="[^"]*")?>Koppla kalendern<\/button><\/div><\/div>$/);
  ok("utan kalender säger mitten det, och ger en väg dit", f.includes('<div class="hv-mitt"><span class="l">Klockan</span><span class="k num">08.00</span><span class="s">Kalendern är inte kopplad</span><button class="hv-lank" ') && !!koppla && (lyssnar.includes(koppla[1]) || /^data-(?:go|view)$/.test(koppla[1])), f.slice(f.indexOf("hv-mitt") - 12));
  okM("utan kalender: bågen, timmarna och visaren som skissen, inga möten", f.slice(0, f.indexOf('<div class="hv-mitt">')) === SK.F_ur.slice(0, SK.F_ur.indexOf('<div class="hv-mitt">')) && !f.includes("r-mote"), f.slice(0, 300));
}

rubrik("Kvällen visar i morgon (skiss A)");
{
  const g = heldag({ nu: 1080 });
  const h = g.hvHem(), u = urtavlan(h);
  let vis = null; for (const f of [() => g.hvVisadDag(g.hvD()), () => g.hvVisadDag(), () => g.hvVisadDag("idag")]) { try { const x = f(); if (typeof x === "string") { vis = x; break; } } catch { /* nästa */ } }
  ok("efter arbetsdagen är den visade dagen i morgon", vis === "imorgon", vis);
  okM("urtavlan visar i morgon: mötena, ingen visare, och mitten leder till Veckan", u === SK.C_ur && !u.includes("r-vis") && u.includes('data-hvark="vecka" aria-label="I morgon: första mötet 09.00 med Morgonmöte Team Nord. Öppna Veckan som kommer"'), u.slice(0, 300));
  okM("hälsningen säger God kväll och när morgondagen börjar", h.includes('<h1 class="an" style="--i:0">God kväll, Zen</h1>') && h.includes(SK.C_heroP), h.match(/<div class="hv-hero">[\s\S]*?<\/p>/)?.[0]);
  const fore = urtavlan(heldag({ nu: 1019 }).hvHem());
  ok("före arbetsdagens slut visar urtavlan i dag", fore.includes("r-vis") && !fore.includes("Urtavlan visar i morgon"));
}

rubrik("Hälsningen och lägesmeningen (skiss A v2)");
{
  const g = hem({ chef: true });
  const svar = [599, 600, 719, 720, 1079, 1080].map((n) => { try { return g.hvHalsning(n); } catch { return null; } });
  ok("hälsningen följer skissens gränser: God morgon, God förmiddag, God eftermiddag, God kväll", JSON.stringify(svar) === JSON.stringify(SK.halsning.map((x) => x[1])), JSON.stringify(svar));
  ok("och hemmet hälsar efter klockan", [[600, "God förmiddag"], [720, "God eftermiddag"], [1080, "God kväll"]].every(([nu, t]) => hem({ chef: true, nu }).hvHem().includes(`<h1 class="an" style="--i:0">${t}, Zen</h1>`)));
  const h = g.hvHem();
  okM("hälsningen är skissens, med den lilla urtavlan för telefonen (Lyssna prövas för sig)", utanLyssna(utanIkon(h.match(/<div class="hv-hero">[\s\S]*?(?=<section class="hv-sek)/)?.[0] ?? "")) === utanLyssna(SK.A_hero), utanIkon(h.match(/<div class="hv-hero">[\s\S]*?<\/p>/)?.[0] ?? ""));
  ok("lägesmeningens länkar är knappar", (h.match(/<button class="hv-herok" data-hvark="(?:vantar|dag)"/g) || []).length === 2);
  okM("v2: ingen förklaringsrad under urtavlan, och ingen dagväxel", [h, heldag({ nu: 1080 }).hvHem(), hem({ chef: true, nu: 930 }).hvHem()].every((x) => !/hv-nyckel|hv-dagval|data-hvdag=/.test(x) && !x.includes("Inget schema, 08–17 visas")));
}

// ---------- Granskningen av push 1 (.lyft/granska-push1.md): varje rättning prövad på vad den gör ----------
// Provens låtsas-DOM: bara det hemmet frågar efter. En nod har slag, klasser och attribut, och en väljare
// "slag.klass[attr="v"]" (eller bara "[attr="v"]") träffar som i webbläsaren.
const passar = (x, sel) => { const m = /^([a-z]*)(?:\.([\w-]+))?\[([\w-]+)="([^"]*)"\]$/.exec(sel); return !!m && (!m[1] || x.tagName.toLowerCase() === m[1]) && (!m[2] || x.classList.includes(m[2])) && x.attrs[m[3]] === m[4]; };
const nod = (slag, klass, attrs, ut) => ({ tagName: slag.toUpperCase(), classList: klass.split(" "), attrs, id: "", hasAttribute: (a) => a in attrs, getAttribute: (a) => attrs[a], focus() { ut.fokus = this; } });
const klassLista = () => { const k = new Set(); return { k, adds: 0, add(c) { k.add(c); this.adds += c === "in" ? 1 : 0; }, remove(c) { k.delete(c); }, contains: (c) => k.has(c), toggle() {} }; };
const NDDAG_PROV = ["", "Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag", "Söndag"];
// En vecka där nästa arbetsdag är måndag 23 november: idag är fredag 20, lördag 21 eller söndag 22.
const vecka = (idag, x = {}) => {
  const g = heldag(x);
  g.kIdag = () => idag; g.ndHemNasta = () => "2026-11-23"; g.ndHemDagNamn = (d) => NDDAG_PROV[new Date(`${d}T12:00:00Z`).getUTCDay() || 7];
  g.ndHemKal = (d) => (d === "2026-11-23" ? [{ s: 540, e: 570, t: "Morgonmöte Team Nord", id: "k3" }] : d === idag ? [{ s: 660, e: 690, t: "PEGU Byggservice", id: "k1" }, { s: 840, e: 870, t: "Veckomöte", id: "k2" }] : []);
  return g;
};

rubrik("Granskningen, fynd 1: nästa arbetsdag heter I morgon bara när den är i morgon");
{
  const g = vecka("2026-11-20", { nu: 1080 }), h = g.hvHem(), u = urtavlan(h);
  ok("fredag kväll: lägesmeningen säger På måndag börjar du", h.includes("På måndag börjar du 09.00 med Morgonmöte Team Nord.") && !/I morgon/i.test(h.match(/<div class="hv-hero">[\s\S]*?<\/p>/)?.[0] + u), h.match(/<p class="an" style="--i:1">[\s\S]*?<\/p>/)?.[0]);
  ok("urtavlans mitt och dess aria-text säger Måndag", u.includes('<span class="l">Måndag</span>') && u.includes('aria-label="Måndag: första mötet 09.00 med Morgonmöte Team Nord. Öppna Veckan som kommer"') && u.includes('aria-label="Urtavlan visar måndag"'), u.slice(0, 200));
  ok("märket på urtavlan säger Måndag · Öppna Veckan", u.includes("Måndag · Öppna Veckan") && !u.includes("I morgon · Öppna Veckan"));
  const kom = g.hvUrtavla(g.hvD(), { storlek: "kompakt" });
  ok("den lilla urtavlans aria-text säger Måndag", kom.includes('aria-label="Måndag. Öppna Min dag"'), kom.match(/aria-label="[^"]*"/)?.[0]);
  g.S.hv.q = "morgonmöte";
  const tr = g.hvTraffar().filter((x) => x.sort === "mote").map((x) => x.t);
  ok("träffraden säger Måndag 09.00, hela fredagen", tr.join() === "Måndag 09.00 Morgonmöte Team Nord", tr.join());
  const lor = vecka("2026-11-21", { nu: 600 }); lor.hvHem(); lor.S.hv.q = "morgonmöte";
  ok("lördag: också Måndag", lor.hvTraffar().some((x) => x.t === "Måndag 09.00 Morgonmöte Team Nord"));
  const son = vecka("2026-11-22", { nu: 1080 }), hs = son.hvHem();
  ok("söndag kväll: I morgon, för då är det i morgon", hs.includes("I morgon börjar du 09.00 med Morgonmöte Team Nord.") && urtavlan(hs).includes('<span class="l">I morgon</span>'));
}

rubrik("Granskningen, fynd 4: ett möte i dag efter schemats slut håller urtavlan kvar på i dag");
{
  const kal = [{ s: 660, e: 690, t: "PEGU Byggservice", id: "k1" }, { s: 1080, e: 1110, t: "Kundmöte Lindvik", id: "k9" }];
  const g = heldag({ nu: 1050, kal }), h = g.hvHem(), u = urtavlan(h);
  ok("17.30 med ett kundmöte 18.00: urtavlan visar i dag", g.hvVisadDag(g.hvD()) === "idag" && u.includes("r-vis") && u.includes('<span class="l">Nästa</span>'), g.hvVisadDag(g.hvD()));
  ok("och lägesmeningen säger samma sak", h.includes("Ett möte kvar i dag") && !h.includes("börjar du"));
  const pa = heldag({ nu: 1095, kal }), hp = pa.hvHem();
  ok("medan mötet pågår: i dag, Pågår till", pa.hvVisadDag(pa.hvD()) === "idag" && urtavlan(hp).includes('<span class="l">Pågår till</span>') && !hp.includes("börjar du"));
  const ef = heldag({ nu: 1111, kal });
  ok("när mötet är slut: nästa arbetsdag, i både urtavlan och meningen", ef.hvVisadDag(ef.hvD()) === "imorgon" && ef.hvHem().includes("I morgon börjar du 09.00"));
}

rubrik("Granskningen, fynd 12: ett schema som slutar när det börjar eller före är som inget schema");
{
  const utan = urtavlan(hem({ chef: true, nu: 600 }).hvHem());
  for (const [namn, dag] of [["över midnatt (22–06)", { start: 1320, slut: 360, rast: 0 }], ["start lika med slut", { start: 480, slut: 480, rast: 0 }]]) {
    const g = hem({ chef: true, nu: 600, dag }), h = g.hvHem(), u = urtavlan(h);
    ok(`${namn}: inget NaN, urtavlan som utan schema`, !/NaN|Infinity/.test(h) && u === utan && g.hvD().dag === null, (h.match(/.{40}NaN.{40}/) || [""])[0]);
  }
}

rubrik("Granskningen, fynd 3: Min dag följer klockan varje minut, utan omritning");
{
  const g = heldag({ nu: 630 });
  // En uppgift utan egen tid läggs i en lucka efter nu, och Boka tiden bokar den där.
  g.ndHemRad = [...g.ndHemRad, { id: "upg-10", nar: "idag", heat: 2, bkind: "uppgift", kind: "Uppgift", bt: "{Skriv offert}.", t: "Skriv offert", why: "i dag", act: { l: "Klar", check: true }, gor: () => {}, ga: () => {} }];
  g.TASKS = [...g.TASKS, { id: "10", t: "Skriv offert", est: 20, ndDue: "2026-11-16", ndNytt: [] }];
  g.hvHem(); g.S.hv.ark = "dag"; g.hvArk(g.hvD());
  const planFore = JSON.stringify(g.S.hv.dagPlan);
  let ritat = 0; g.render = () => { ritat++; };
  const h2 = { innerHTML: "" }, ny = { focus() { ut.fokus = this; } }, ut = {};
  const fokus = nod("button", "hv-btn", { "data-hvgor": "upg-9" }, ut);
  const lst = { innerHTML: "", contains: (x) => x === fokus, querySelectorAll: (s) => (s === 'button.hv-btn[data-hvgor="upg-9"]' ? [ny] : []), querySelector: () => null };
  const arkRull = { scrollTop: 140 };
  const el = { dataset: { hvlage: "ark" }, classList: klassLista(), querySelector: (s) => (s === ".hv-dlista" ? lst : s === "#hvArktext" ? h2 : null), querySelectorAll: () => [] };
  g.document = { ...g.document, hidden: false, activeElement: null, body: {}, querySelector: (s) => (s === ".hv" ? el : null), getElementById: (id) => (id === "hvArk" ? arkRull : null) };
  g.hvMinut();
  ok("samma minut som ritningen: listan skrivs inte om", lst.innerHTML === "" && h2.innerHTML === "");
  g.now = () => 635; g.document.activeElement = fokus;
  g.hvMinut();
  const nu = g.hvArk(g.hvD());
  ok("minuter senare: nu-linjen står på 10.35, och uppgiften i luckan flyttar med", lst.innerHTML.includes('<div class="hv-dnu" aria-label="Klockan 10.35">10.35 nu</div><div class="hv-drad upg an" style="--i:1" data-m="upg-10"><span class="hv-kl num">10.35</span>') && !lst.innerHTML.includes("10.30 nu"), lst.innerHTML.slice(0, 300));
  ok("listan är exakt vad Min dag ritar 10.35", nu.includes(`<div class="hv-dlista">${lst.innerHTML}</div>`));
  const rubrikIn = (x) => x.match(/<h2 id="hvArktext">([\s\S]*?)<\/h2>/)[1];
  g.now = () => 695; g.hvMinut();
  const planTick = JSON.stringify(g.S.hv.dagPlan), efter = g.hvArk(g.hvD());
  ok("Boka tiden bokar det listan visar nu, inte det den visade vid ritningen", planTick === JSON.stringify(g.S.hv.dagPlan) && planTick !== planFore && planTick.includes("upg") === false && planTick.length > 2, `${planFore} → ${planTick}`);
  ok("när ett möte gått över skrivs rubriken om (ett möte färre kvar), som Min dag ritar den", h2.innerHTML === rubrikIn(efter) && rubrikIn(efter) !== rubrikIn(nu) && lst.innerHTML.includes("11.35 nu"), h2.innerHTML);
  ok("tickaren anropar inte render()", ritat === 0, ritat);
  ok("fokus står kvar på samma knapp i listan, och rullningen där den var", ut.fokus === ny && arkRull.scrollTop === 140);
}

{
  // Utan något i luckan är nästa sak mötet 11.00: nedräkningen följer klockan.
  const g = heldag({ nu: 630 }); g.hvHem(); g.S.hv.ark = "dag"; g.hvArk(g.hvD());
  const h2 = { innerHTML: "" }, lst = { innerHTML: "", contains: () => false, querySelectorAll: () => [], querySelector: () => null };
  const el = { dataset: { hvlage: "ark" }, classList: klassLista(), querySelector: (s) => (s === ".hv-dlista" ? lst : s === "#hvArktext" ? h2 : null), querySelectorAll: () => [] };
  g.document = { ...g.document, hidden: false, activeElement: null, body: {}, querySelector: (s) => (s === ".hv" ? el : null), getElementById: () => null };
  const fore = g.hvArk(g.hvD());
  g.now = () => 635; g.hvMinut();
  ok("nedräkningen i listan går från om 30 min till om 25 min", fore.includes("<small>om 30 min</small>") && lst.innerHTML.includes("<small>om 25 min</small>") && lst.innerHTML.includes("10.35 nu"), lst.innerHTML.slice(0, 200));
}

rubrik("Granskningen, fynd 15: fokus efter omritning hamnar på samma element");
{
  const g = hem({ chef: true }); g.hvHem();
  const ut = {};
  const herok = nod("button", "hv-herok", { "data-hvark": "dag", "data-m": "k1" }, ut), hela = nod("button", "hv-lank hv-end", { "data-hvark": "vantar" }, ut);
  const pin = nod("button", "hv-pin", { "data-m": "k1", "data-hvark": "dag" }, ut), mitt = nod("button", "hv-mitt", { "data-hvark": "dag", "data-m": "k1" }, ut);
  const tva = nod("button", "hv-lank", { "data-hvark": "vantar" }, ut), kompakt = nod("button", "hv-ins kompakt", { "data-hvark": "dag" }, ut);
  const alla = [herok, hela, kompakt, pin, mitt, tva];
  const el = { dataset: { hvlage: "hem" }, classList: klassLista(), contains: (x) => alla.includes(x), querySelector: (s) => alla.find((x) => passar(x, s)) || null, querySelectorAll: (s) => alla.filter((x) => passar(x, s)) };
  g.document = { ...g.document, activeElement: null, body: {}, querySelector: (s) => (s === ".hv" ? el : null), getElementById: () => null };
  const efter = (x) => { ut.fokus = null; g.document.activeElement = x; g.hvForeMat(); g.document.activeElement = null; g.hvFlip(); return ut.fokus; };
  ok("märket på urtavlan behåller fokus (inte lägesmeningens länk med samma data-m)", efter(pin) === pin);
  ok("urtavlans mitt behåller fokus", efter(mitt) === mitt);
  ok("den lilla urtavlan behåller fokus (inte mittens data-hvark)", efter(kompakt) === kompakt);
  ok("\"2 till som kan vänta\" behåller fokus (inte Hela listan)", efter(tva) === tva);
  ok("och lägesmeningens länk står kvar där den var", efter(herok) === herok);
}

rubrik("Granskningen, fynd 14 och 7b: trappan, minuttickaren och en enda timer");
{
  const g = hem({ chef: true }); g.hvHem();
  let ritat = 0; g.render = () => { ritat++; };
  const kl = klassLista();
  const el = { dataset: { hvlage: "hem" }, classList: kl, querySelector: () => null, querySelectorAll: () => [] };
  g.document = { ...g.document, hidden: false, activeElement: null, body: {}, querySelector: (s) => (s === ".hv" ? el : null), getElementById: () => null };
  const timrar = () => g.anrop.filter((a) => a[0] === "setInterval" && a[1] === 1000).length;
  g.hvEfterRita();
  ok("första ritningen: trappan går", kl.adds === 1);
  g.hvEfterRita(); g.hvEfterRita();
  ok("Navs omritningar i samma läge: ingen ny trappa", kl.adds === 1, kl.adds);
  ok("minuttickaren startas en gång, hur många ritningar det än blir", timrar() === 1, timrar());
  el.dataset.hvlage = "ark"; g.S.hv.ark = "dag"; g.hvEfterRita();
  ok("hemmet till Min dag: trappan går", kl.adds === 2, kl.adds);
  g.S.hv.ark = "vecka"; g.hvEfterRita();
  ok("Min dag till Veckan: trappan går också, som skissens lage()", kl.adds === 3, kl.adds);
  g.hvEfterRita();
  ok("och inte igen när Veckan ritas om", kl.adds === 3, kl.adds);
  el.dataset.hvlage = "hem"; g.S.hv.ark = null;
  g.now = () => 481; g.hvMinut(); g.now = () => 482; g.hvMinut();
  ok("tickaren anropar inte render()", ritat === 0, ritat);
  g.S.view = "uppgifter"; g.hvMinut();
  ok("tickaren stannar när hemmet lämnas", g.anrop.some((a) => a[0] === "clearInterval"));
  g.S.view = "hem"; g.hvEfterRita();
  ok("och startar igen, en gång, när hemmet ritas", timrar() === 2, timrar());
}

rubrik("Granskningen, fynd 7b: pilarna och Enter i träffarna");
{
  const g = hem({ chef: true }); g.hvHem();
  const plats = { innerHTML: "" };
  g.document = { ...g.document, activeElement: null, body: {}, querySelector: () => null, getElementById: (id) => (id === "hvTraffPlats" ? plats : null) };
  g.S.hv.q = "morgon";
  const L = g.hvTraffar();
  ok("träffarna: frågan först, sedan mötet nästa arbetsdag", L.length >= 2 && L[1].sort === "mote" && L[1].gor === "vecka", JSON.stringify(L));
  let stopp = 0;
  const tang = (key) => g.hvTangent({ key, target: { id: "hvQ", value: "morgon", matches: () => false }, preventDefault() { stopp++; } });
  tang("ArrowDown");
  ok("pil ned väljer nästa träff och ritar bara träffarna", g.S.hv.sel === 1 && plats.innerHTML.includes('id="hvTr1" aria-selected="true"') && stopp === 1);
  tang("ArrowUp"); tang("ArrowUp");
  ok("pil upp från den första går runt till den sista", g.S.hv.sel === L.length - 1, g.S.hv.sel);
  tang("ArrowDown"); tang("ArrowDown");
  ok("pil ned från den sista går runt till den första och vidare", g.S.hv.sel === 1, g.S.hv.sel);
  tang("Enter");
  ok("Enter tar den valda träffen: Veckan öppnas och rutan töms", g.S.hv.ark === "vecka" && g.S.hv.q === "" && g.S.hv.sel === 0, JSON.stringify({ ark: g.S.hv.ark, q: g.S.hv.q }));
}

rubrik("Granskningen, fynd 8: en toast med Ångra byts inte ut av en senare utan Ångra");
{
  const g = hem({ chef: true }); g.hvHem();
  const fot = { querySelector: () => null, insertAdjacentHTML() {} };
  g.document = { ...g.document, activeElement: null, body: {}, querySelector: (s) => (s === ".hv-fot" ? fot : null), getElementById: () => null };
  let angrat = 0;
  g.toastActs("Klar: Ring tillbaka Mälarö Frakt.", [["Ångra", () => { angrat++; }]], 60);
  g.toastActs("Mick signerade Hagmans Rör.", [], 60);
  ok("den senare byter inte ut toasten med Ångra innan dess tid gått", g.S.hv.toast && g.S.hv.toast.text === "Klar: Ring tillbaka Mälarö Frakt." && g.S.hv.toast.acts.length === 1, g.S.hv.toast && g.S.hv.toast.text);
  ok("och går inte heller till Navs vanliga toaster", !g.anrop.some((a) => a[0] === "navtoast"));
  await new Promise((r) => setTimeout(r, 90));
  ok("när Ångra-tiden gått kommer den senare, i hemmets fot", g.S.hv.toast && g.S.hv.toast.text === "Mick signerade Hagmans Rör.", g.S.hv.toast && g.S.hv.toast.text);
  g.toastActs("Sparat.", [], 60); g.toastActs("Klar: Säljsamtal.", [["Ångra", () => {}]], 60);
  ok("en toast med Ångra tar alltid över direkt", g.S.hv.toast.text === "Klar: Säljsamtal.");
  await new Promise((r) => setTimeout(r, 90));
}

rubrik("Granskningen, fynd 18: kvittot har Ångra för varje sort som går att ångra");
{
  const g = hem({ chef: true }); g.hvHem();
  g.S.hv.ark = "vantar";
  const med = (k) => { g.S.hv.kvitto = { text: "Gjort.", ...k }; return g.hvArk(g.hvD()); };
  ok("Stämmer inte ångras (data-hvangra)", med({ angra: "r1" }).includes('<button class="hv-btn" data-hvangra="r1">Ångra</button>'));
  ok("Visa inte här ångras (data-hvvisa)", med({ angra: null, visa: "rutin" }).includes('<button class="hv-btn" data-hvvisa="rutin">Ångra</button>'));
  ok("Boka tiden ångras (data-hvangradag)", med({ dag: true }).includes('<button class="hv-btn" data-hvangradag>Ångra</button>'));
  ok("Klar ångras (data-hvkvittoangra)", med({ fn: () => {} }).includes('<button class="hv-btn" data-hvkvittoangra>Ångra</button>'));
  ok("ett kvitto utan något att ångra har ingen knapp", !med({ angra: null }).includes(">Ångra</button>"));
  g.S.hv.kvitto = null;
}

/* ------------------------------------------------------------------------ */
/* Kontrollens fynd på rättningarna av granska-push1                         */
/* ------------------------------------------------------------------------ */

// En låtsas-.hv med det minuttickaren rör: en urtavla (visare, båge, mitt), lägesmeningen och raden vid den dockade
// urtavlan. Det som skrivs sparas på noderna, så att proven kan jämföra med det Nav ritar.
const tickDom = ({ lage = "hem", dock = false, dag = false } = {}) => {
  const vis = { dataset: { vis: "stor", vinkel: "0" }, style: {}, vilar: null, classList: { toggle(_c, v) { vis.vilar = v; } } };
  const gatt = { d: null, setAttribute(_k, v) { gatt.d = v; } };
  const mitt = { ut: null, contains: () => false, set outerHTML(v) { mitt.ut = v; } };
  const u = { querySelector: (s) => (s === "[data-vis]" ? vis : s === ".r-gatt" ? gatt : s === ":scope > .hv-mitt" ? mitt : null), querySelectorAll: () => [] };
  const p = { contains: () => false, innerHTML: "" };
  const s = { borta: false, remove() { s.borta = true; } };
  const dk = { rad: null, querySelector: () => s, insertAdjacentHTML(_w, h) { dk.rad = h; } };
  const lst = { innerHTML: "", contains: () => false, querySelectorAll: () => [], querySelector: () => null };
  const h2 = { innerHTML: "" }, slut = { innerHTML: "", knapp: true, querySelector: (q) => (q === "[data-hvboka]" && slut.knapp ? {} : null) };
  const el = {
    dataset: { hvlage: lage }, classList: klassLista(),
    querySelectorAll: (q) => (q === ".hv-ins" ? [u] : []),
    querySelector: (q) => (q === ".hv-hero p" ? p : q === ".hv-dock" ? (dock ? dk : null) : q === ".hv-dlista" ? (dag ? lst : null) : q === "#hvArktext" ? (dag ? h2 : null) : q === ".hv-arkfot .hv-end" ? (dag ? slut : null) : null),
  };
  return { el, vis, gatt, mitt, p, dk, s, lst, h2, slut };
};
const tickDoc = (g, el) => { g.document = { ...g.document, hidden: false, activeElement: null, body: {}, querySelector: (q) => (q === ".hv" ? el : null), getElementById: () => null }; };

rubrik("Kontrollen, fynd 3: urtavlan, bågen, mitten och meningen följer klockan, utan omritning");
{
  const g = heldag({ nu: 630 }); g.hvHem();
  let ritat = 0; g.render = () => { ritat++; };
  const d = tickDom({ dock: true }); tickDoc(g, d.el);
  g.hvMinut();
  const fore = { vinkel: d.vis.dataset.vinkel, mening: d.p.innerHTML };
  g.now = () => 695; g.hvMinut();
  const D = g.hvD(), P = g.hvDagPlan(D), R = g.hvUrRam(D, "idag");
  ok("visaren står på klockans vinkel, och står i transform och data-vinkel", Math.abs(+d.vis.dataset.vinkel - g.hvUrVink(695, R)) < 0.06 && d.vis.style.transform === `rotate(${d.vis.dataset.vinkel}deg)` && d.vis.dataset.vinkel !== fore.vinkel, `${fore.vinkel} → ${d.vis.dataset.vinkel}`);
  ok("den gångna bågen är den Nav ritar vid klockan", d.gatt.d === g.hvUrBage(150, -150, g.hvUrVink(Math.min(695, R.T1), R)) && !!d.gatt.d, d.gatt.d);
  ok("urtavlans mitt skrivs om till det Nav ritar vid klockan (efter 11.00-mötet)", d.mitt.ut === g.hvUrMitt(D, "idag", P, "stor") && d.mitt.ut.includes("Nästa"), d.mitt.ut && d.mitt.ut.slice(0, 160));
  ok("lägesmeningen skrivs om till den Nav ritar, och är en annan än vid ritningen", d.p.innerHTML === g.hvHeroRad(D) && d.p.innerHTML !== "" && d.p.innerHTML !== fore.mening, d.p.innerHTML.slice(0, 120));
  ok("raden vid den dockade urtavlan byts mot den Nav ritar", d.s.borta && d.dk.rad === g.hvDockRad(D, P) && !!d.dk.rad, d.dk.rad);
  ok("och ingenting av det går via render()", ritat === 0, ritat);
  const mening = d.p.innerHTML, mittNu = d.mitt.ut; d.mitt.ut = null; d.p.innerHTML = "";
  g.hvMinut();
  ok("samma minut en gång till: ingenting skrivs om", d.mitt.ut === null && d.p.innerHTML === "" && mening !== "" && mittNu !== "");
}

rubrik("Kontrollen, fynd 3 och 19: byter urtavlan dag ritas hemmet om, så att meningen och urtavlan säger samma sak");
{
  const g = heldag({ nu: 1000 }); g.hvHem();
  ok("klockan 16.40 visar urtavlan i dag", g.hvVisadDag(g.hvD()) === "idag" && g.S.hv.dagRitad === g.hvDagNyckel(g.hvD()), g.S.hv.dagRitad);
  let ritat = 0; g.render = () => { ritat++; g.hvHem(); };
  const d = tickDom(); tickDoc(g, d.el);
  g.now = () => 1001; g.hvMinut();
  ok("en vanlig minut ritar inte om", ritat === 0 && d.p.innerHTML !== "", ritat);
  g.now = () => 1030; g.hvMinut();
  ok("när arbetsdagen tagit slut och inget möte återstår byter urtavlan till nästa arbetsdag: en omritning, och meningen skrivs inte först", ritat === 1 && g.hvVisadDag(g.hvD()) === "imorgon" && !/börjar du/.test(d.p.innerHTML), `${ritat} ${g.hvVisadDag(g.hvD())}`);
  g.now = () => 1031; g.hvMinut();
  ok("och nästa minut är en vanlig igen (ritningen har tagit in dagen)", ritat === 1, ritat);
  g.now = () => 5; g.kIdag = () => "2026-11-17"; g.hvMinut();
  ok("efter midnatt (nytt datum, tidigt på dagen) ritas hemmet om", ritat === 2 && g.hvVisadDag(g.hvD()) === "idag", `${ritat} ${g.hvVisadDag(g.hvD())}`);
  const n = heldag({ nu: 600 }); n.hvHem();
  let r3 = 0; n.render = () => { r3++; n.hvHem(); }; const d3 = tickDom(); tickDoc(n, d3.el);
  n.now = () => 601; n.hvMinut();
  ok("en vanlig minut mitt på dagen ritar inte om", r3 === 0, r3);
  n.kIdag = () => "2026-11-17"; n.now = () => 602; n.hvMinut();
  ok("ett nytt datum ritar om hemmet även när urtavlan visar i dag både före och efter", r3 === 1 && n.hvVisadDag(n.hvD()) === "idag", r3);
  const h = heldag({ nu: 1030 }); h.hvHem(); h.S.hv.dagval = "idag"; h.hvHem();
  let r2 = 0; h.render = () => { r2++; }; const d2 = tickDom(); tickDoc(h, d2.el);
  h.now = () => 1040; h.hvMinut();
  ok("har personen själv valt dag ändras ingenting av klockan", r2 === 0, r2);
}

rubrik("Kontrollen, fynd 3: Boka tiden i kalendern följer listan, och ett klick utan något att boka säger det");
{
  const g = heldag({ nu: 630 }); g.ndHemRad = [...g.ndHemRad, { id: "upg-10", nar: "idag", heat: 2, bkind: "uppgift", kind: "Uppgift", bt: "{Skriv offert}.", t: "Skriv offert", why: "i dag", act: { l: "Klar", check: true }, gor: () => {}, ga: () => {} }];
  g.TASKS = [...g.TASKS, { id: "10", t: "Skriv offert", est: 20, ndDue: "2026-11-16", ndNytt: [] }];
  g.hvHem(); g.S.hv.ark = "dag";
  const h = g.hvArk(g.hvD());
  ok("med något att boka står knappen i arkfoten", h.includes('<span class="hv-end"><button class="hv-btn" data-hvboka>Boka tiden i kalendern</button></span>'));
  g.render = () => {};
  const d = tickDom({ lage: "ark", dag: true }); tickDoc(g, d.el);
  g.now = () => 640; g.hvMinut();
  ok("så länge något återstår rörs knappen inte", d.slut.innerHTML === "", d.slut.innerHTML);
  g.S.hv.dagPlan = [];
  g.hvBokaDag();
  const sagt = [];
  g.toast = (m) => { sagt.push(m); };
  g.hvBokaDag();
  ok("ett klick när planen är tom ger en rad, inte tystnad", sagt.length === 1 && /återstår att boka/.test(sagt[0]), sagt.join("|"));
  // Sent på dagen: inget får plats efter nu. Knappen byts då mot ingenting, och kommer tillbaka om något återstår.
  g.now = () => 1015; g.S.hv.dagSist = null; g.hvMinut();
  const planSent = g.S.hv.dagPlan.length;
  ok("när inget återstår att boka tas knappen bort ur arkfoten (planen är tom)", planSent === 0 && d.slut.innerHTML === "", `${planSent} ${d.slut.innerHTML}`);
  d.slut.knapp = false; g.now = () => 640; g.hvMinut();
  ok("och kommer tillbaka när något återstår igen", g.S.hv.dagPlan.length > 0 && d.slut.innerHTML === '<button class="hv-btn" data-hvboka>Boka tiden i kalendern</button>', d.slut.innerHTML);
}

rubrik("Kontrollen, fynd 14: en omritning medan trappan går får trappan tillbaka, och den tas bort när tiden gått");
{
  const g = hem({ chef: true }); g.hvHem();
  const gammal = Date.now; let t = 1000000; Date.now = () => t;
  try {
    const stil = () => { const v = {}; return { v, setProperty: (k, x) => { v[k] = x; }, removeProperty: (k) => { delete v[k]; } }; };
    const ny = () => ({ dataset: { hvlage: "hem" }, classList: klassLista(), style: stil(), querySelector: () => null, querySelectorAll: () => [] });
    let el = ny();
    g.document = { ...g.document, hidden: false, activeElement: null, body: {}, querySelector: (s) => (s === ".hv" ? el : null), getElementById: () => null };
    g.hvEfterRita();
    ok("första ritningen: trappan går, från början", el.classList.k.has("in") && el.style.v["--hv-gatt"] === undefined);
    t += 200; el = ny(); g.hvEfterRita();
    ok("en andra ritning 200 ms in får klassen igen, med de 200 ms som gått", el.classList.k.has("in") && el.style.v["--hv-gatt"] === "200ms", JSON.stringify(el.style.v));
    ok("och räknas inte som ett nytt lägesbyte", g.S.hv.trappaFran === 1000000);
    t += 400; el = ny(); g.hvEfterRita();
    ok("en ritning efter att trappan gått ut (600 ms) står still: ingen klass", !el.classList.k.has("in") && el.style.v["--hv-gatt"] === undefined, JSON.stringify(el.style.v));
    el = ny(); el.dataset.hvlage = "ark"; g.S.hv.ark = "dag"; t += 10; g.hvEfterRita();
    ok("ett lägesbyte startar trappan om, från noll", el.classList.k.has("in") && el.style.v["--hv-gatt"] === undefined && g.S.hv.trappaFran === t);
    // Timern tar bort klassen och förskjutningen från den .hv som då står där.
    const kvar = ny(); kvar.classList.add("in"); kvar.style.setProperty("--hv-gatt", "200ms");
    el = kvar; await new Promise((r) => setTimeout(r, 560));
    ok("när tiden gått tas klassen och förskjutningen bort från det som står där", !kvar.classList.k.has("in") && kvar.style.v["--hv-gatt"] === undefined);
  } finally { Date.now = gammal; }
  ok("stilen har regeln som läser förskjutningen", /\.hv\.in \.an\{animation-delay:calc\(var\(--i,0\) \* 30ms - var\(--hv-gatt,0ms\)\)\}/.test(html) && /\.hv\.in \.hv-ins \.m\{animation-delay:calc\(90ms \+ var\(--i,0\) \* 24ms - var\(--hv-gatt,0ms\)\)\}/.test(html));
}

rubrik("Kontrollen, fynd 3 och 15: fokus står kvar på varje sorts knapp, och på rätt element när något försvunnit");
{
  const g = hem({ chef: true }); g.hvHem();
  const ut = {};
  const sorter = [["data-hvforbered", "Förbered mitt möte 11:00 med X"], ["data-hvboka", ""], ["data-hvga", "/moten"], ["data-hvkvittoangra", ""], ["data-hvangradag", ""], ["data-hvstang", ""], ["data-hvnasta", "1"], ["data-hvtala", ""]];
  for (const [a, v] of sorter) {
    const b = nod("button", "hv-btn", { [a]: v }, ut); b.getAttributeNames = () => [a];
    const n = g.hvFokusNyckel(b, { querySelectorAll: () => [b] });
    ok(`${a}: knappen får en nyckel (och fokus kan alltså hittas igen)`, Array.isArray(n) && n[0] === `button.hv-btn[${a}="${v}"]` && n[1] === 0, JSON.stringify(n));
  }
  const lage = nod("div", "hv", { "data-hvlage": "hem" }, ut); lage.getAttributeNames = () => ["data-hvlage"];
  ok("ett element utan knappattribut (och .hv självt) får ingen nyckel", g.hvFokusNyckel(lage, null) === null);
  // Två lika knappar, och ett annat element före dem som delar värdet: slaget och indexet håller isär dem.
  const a1 = nod("button", "hv-pin", { "data-m": "k1" }, ut), a2 = nod("button", "hv-pin", { "data-m": "k1" }, ut), extra = nod("span", "hv-hl", { "data-m": "k1" }, ut);
  let alla = [a1, a2];
  const el = { dataset: { hvlage: "hem" }, classList: klassLista(), contains: (x) => alla.includes(x), querySelector: (s) => alla.find((x) => passar(x, s)) || null, querySelectorAll: (s) => alla.filter((x) => passar(x, s)) };
  g.document = { ...g.document, activeElement: null, body: {}, querySelector: (s) => (s === ".hv" ? el : null), getElementById: () => null };
  const efter = (fore, x, ny) => { ut.fokus = null; alla = fore; g.document.activeElement = x; g.hvForeMat(); alla = ny; g.document.activeElement = null; g.hvFlip(); return ut.fokus; };
  ok("den andra av två lika knappar behåller fokus (inte den första)", efter([a1, a2], a2, [a1, a2]) === a2);
  ok("ett annat slags element före, med samma värde, flyttar inte fokus", efter([a1, a2], a2, [extra, a1, a2]) === a2);
  ok("försvinner en av två lika (den första) hamnar fokus på den som finns, inte på ingenting", efter([a1, a2], a2, [a2]) === a2);
  const a3 = nod("button", "hv-pin", { "data-m": "k1" }, ut);
  ok("försvinner den sista tas den närmaste, i stället för den första", efter([a1, a2, a3], a3, [a1, a2]) === a2);
}

rubrik("Kontrollen, fynd 8: toaster som väntar på Ångra visas en i taget, var och en sin tid");
{
  const g = hem({ chef: true }); g.hvHem();
  const fot = { querySelector: () => null, insertAdjacentHTML() {} };
  g.document = { ...g.document, activeElement: null, body: {}, querySelector: (s) => (s === ".hv-fot" ? fot : null), getElementById: () => null };
  const text = () => g.S.hv.toast && g.S.hv.toast.text;
  g.toastActs("Klar: Ring Frakt.", [["Ångra", () => {}]], 80);
  g.toastActs("Första.", [], 80); g.toastActs("Andra.", [], 80); g.toastActs("Tredje.", [], 80);
  ok("de tre som kommer under Ångra väntar, och toasten med Ångra står kvar", text() === "Klar: Ring Frakt.");
  await new Promise((r) => setTimeout(r, 120));
  ok("när tiden gått kommer den första, och ingen av de andra har ersatt den", text() === "Första.", text());
  await new Promise((r) => setTimeout(r, 80));
  ok("sedan den andra, efter den förstas hela tid", text() === "Andra.", text());
  await new Promise((r) => setTimeout(r, 80));
  ok("sedan den tredje", text() === "Tredje.", text());
  await new Promise((r) => setTimeout(r, 80));
  ok("och sist töms platsen", g.S.hv.toast === null);
  g.toastActs("Klar: A.", [["Ångra", () => {}]], 60);
  for (let i = 1; i <= 8; i++) g.toastActs(`Väntar ${i}.`, [], 50);
  await new Promise((r) => setTimeout(r, 90));
  ok("kön tar högst fem: de äldsta går först bort när fler kommer", text() === "Väntar 4.", text());
  g.toastActs("Klar: B.", [["Ångra", () => {}]], 40);
  ok("en ny toast med Ångra tar över direkt, och kön står kvar bakom den", text() === "Klar: B.");
  await new Promise((r) => setTimeout(r, 60));
  ok("och kommer sedan i ordning", text() === "Väntar 5.", text());
  await new Promise((r) => setTimeout(r, 200));
  ok("kön töms till slut", g.S.hv.toast === null);
}

rubrik("Kontrollen, fynd 8: kvittot för Klar i arket står kvar tills nästa Klar tar dess plats (skissens klar, ingen tid)");
{
  const g = hem({ chef: true }); g.hvHem(); g.S.hv.ark = "vantar"; g.render = () => {};
  g.document = { ...g.document, activeElement: null, body: {}, querySelector: (s) => (s === ".hv-fot" || s === ".hv-ark .hv-arkfot" ? { querySelector: () => null, insertAdjacentHTML() {} } : null), getElementById: () => null };
  const angrat = [];
  g.toastActs("Klar: Första.", [["Ångra", () => angrat.push(1)]]);
  ok("Klar i Väntar på dig ger ett kvitto i arket, ingen toast", g.S.hv.kvitto && g.S.hv.kvitto.text === "Klar: Första." && g.S.hv.toast === null);
  await new Promise((r) => setTimeout(r, 30));
  ok("kvittot har ingen tid: det står kvar", g.S.hv.kvitto && g.S.hv.kvitto.text === "Klar: Första.");
  g.toastActs("Klar: Andra.", [["Ångra", () => angrat.push(2)]]);
  g.S.hv.kvitto.fn();
  ok("nästa Klar tar kvittots plats, och Ångra gäller då bara den", g.S.hv.kvitto.text === "Klar: Andra." && angrat.join() === "2");
}

rubrik("Kontrollen, fynd 7b: träffarna går att välja, för varje sort");
{
  const g = hem({ chef: true }); g.render = () => {};
  const g2 = heldag({ nu: 630 }); g2.hvHem();
  const sagt = []; for (const x of [g, g2]) { x.ndGa = (u) => { sagt.push(u); }; x.requestAnimationFrame = (f) => { x.raf = f; }; }
  const val = (x, q, sort, id) => {
    x.hvHem(); x.S.hv.ark = null; x.S.hv.q = q; x.S.hv.sel = 0;
    const L = x.hvTraffar(), k = L.findIndex((t) => t.sort === sort && (id === undefined || t.id === id));
    if (k < 0) return { k, L };
    x.hvValjTraff(k); return { k, ark: x.S.hv.ark, id: x.S.hv.id, q: x.S.hv.q };
  };
  let r = val(g2, "morgon", "mote");
  ok("ett möte nästa arbetsdag öppnar Veckan, och rutan töms", r.ark === "vecka" && r.q === "", JSON.stringify(r));
  r = val(g2, "pegu", "mote");
  ok("ett möte i dag öppnar Min dag", r.ark === "dag" && r.q === "", JSON.stringify(r));
  r = val(g, "hagby", "forslag");
  ok("ett förslag öppnar förslaget (med sitt id)", r.ark === "forslag" && r.id === "f0" && r.q === "", JSON.stringify(r));
  r = val(g, "golv", "genv", "golvet");
  ok("en genväg öppnar sin plats", r.ark === "golvet" && r.q === "", JSON.stringify(r));
  r = val(g, "möten", "genv", "moten");
  ok("genvägen Möten går till Möten via Nav (ndGa), och hemmet ritas om först", sagt.includes("/moten") && r.q === "", JSON.stringify([r, sagt]));
  r = val(g2, "skicka offert", "rad");
  ok("en rad öppnar Väntar på dig vid raden", r.ark === "vantar" && g2.S.selRad === "upg-9" && r.q === "", JSON.stringify(r));
  const knapp = { focus(o) { knapp.fokus = o; } }, rad = { dataset: { id: "upg-9" }, scrollIntoView() { rad.rullad = true; }, querySelector: (s) => (s === "[data-hvgor]" ? knapp : null) };
  g2.document = { ...g2.document, querySelectorAll: () => [rad] };
  g2.raf();
  ok("och raden rullas fram med fokus på dess knapp", rad.rullad === true && knapp.fokus && knapp.fokus.preventScroll === true);
}

rubrik("Kontrollen, fynd 7b: märken och rader lyser upp tillsammans, och stegklockan räknar sekunder");
{
  const g = hem({ chef: true }); g.hvHem();
  const mk = () => ({ klass: {}, classList: { toggle(c, v) { this.t = [c, v]; } } });
  const a = mk(), b = mk(), ur = { klass: null, classList: { toggle(c, v) { ur.t = [c, v]; } }, querySelector: (s) => (s === '.m[data-m="k1"]' ? {} : null) }, ur2 = { classList: { toggle(c, v) { ur2.t = [c, v]; } }, querySelector: () => null };
  g.document = { ...g.document, querySelectorAll: (s) => (s === '.hv [data-m="k1"]' ? [a, b] : s === ".hv .hv-ins" ? [ur, ur2] : []) };
  const e = { target: { closest: (s) => (s === ".hv [data-m]" ? { dataset: { m: "k1" } } : null) } };
  g.hvLys(e, true);
  ok("över ett märke lyser alla med samma id (hl)", JSON.stringify(a.classList.t) === '["hl",true]' && JSON.stringify(b.classList.t) === '["hl",true]');
  ok("och urtavlan som har märket får har-hl, den utan märket inte", JSON.stringify(ur.t) === '["har-hl",true]' && JSON.stringify(ur2.t) === '["har-hl",false]');
  g.hvLys(e, false);
  ok("när musen lämnar släcks det igen", JSON.stringify(a.classList.t) === '["hl",false]' && JSON.stringify(ur.t) === '["har-hl",false]');
  a.classList.t = null; g.hvLys({ target: { closest: () => null } }, true);
  ok("ett element utan data-m gör ingenting", a.classList.t === null);
  g.S.view = "uppgifter"; g.hvLys(e, true);
  ok("utanför hemmet gör det ingenting heller", a.classList.t === null);
  g.S.view = "hem";

  const gammal = Date.now; Date.now = () => 10000;
  try {
    const x1 = { dataset: { hvt0: "7500" }, textContent: "0,0 s" }, x2 = { dataset: { hvt0: "9990" }, textContent: "x" };
    const el = { dataset: { hvlage: "hem" }, classList: klassLista(), querySelector: () => null, querySelectorAll: () => [] };
    g.document = { ...g.document, hidden: false, activeElement: null, body: {}, querySelector: (s) => (s === ".hv" ? el : null), getElementById: () => null, querySelectorAll: (s) => (s === ".hv [data-hvt0]" ? [x1, x2] : []) };
    g.S.hv.strom = true; g.hvEfterRita();
    ok("medan svaret pågår startar en klocka på 100 ms, en gång", g.anrop.filter((a) => a[0] === "setInterval" && a[1] === 100).length === 1);
    g.hvStegKlocka();
    ok("steget som pågår räknar sina sekunder i text (2,5 s efter 2 500 ms, 0,0 s när t0 ligger framför)", /^2,5\s?s$/.test(x1.textContent) && /^0,0\s?s$/.test(x2.textContent), `${x1.textContent} ${x2.textContent}`);
    const fore = g.anrop.filter((a) => a[0] === "clearInterval").length;
    g.S.hv.strom = false; g.hvStegKlocka();
    ok("när svaret är klart stannar klockan", g.anrop.filter((a) => a[0] === "clearInterval").length === fore + 1);
  } finally { Date.now = gammal; }
}

{
  rubrik("Hemmets läge står inte kvar i en annan vy (hvLageSynk)");
  const g = hem({ chef: true });
  const klasser = (namn) => { const s = new Set(namn); return { toggle: (k, pa) => { if (pa) s.add(k); else s.delete(k); }, har: (k) => s.has(k) }; };
  const main = { classList: klasser(["main", "hvmode"]) }, body = { classList: klasser(["hvbody"]) };
  g.document = { ...g.document, body, getElementById: (id) => (id === "main" ? main : null) };
  g.hvHem();
  g.S.view = "moten"; g.hvLageSynk();
  ok("i Möten, som ritar sig själv, slås hemmets läge av på main och body", !main.classList.har("hvmode") && !body.classList.har("hvbody") && main.classList.har("main"));
  g.S.view = "hem"; g.hvLageSynk();
  ok("tillbaka i hemmet slås det på igen", main.classList.har("hvmode") && body.classList.har("hvbody"));
  g.ND.hem.nytt = false; g.hvLageSynk();
  ok("den som inte har det nya hemmet får aldrig hemmets läge", !main.classList.har("hvmode") && !body.classList.har("hvbody"));
  ok("varje väg som ritar en vy går genom renderPill, och den synkar läget först", /function renderPill\(\)\{\n  hvLageSynk\(\);/.test(html));
  const mo = html.slice(html.indexOf("const _ndMoRender = render;"), html.indexOf("const _ndMoRender = render;") + 900);
  ok("Mötens egen ritning anropar renderPill", /if \(S\.view === 'moten' && ndMo\(\)\)\{[\s\S]*?renderPill\(\);[\s\S]*?return;/.test(mo));
}

{
  rubrik("Ett stort fönster: hemmet förstoras som skissen och står kvar på samma ställen (hvSkala)");
  const g = hem({ chef: true });
  const p = {}, attr = new Set(), obs = [];
  let satt = 0;
  const forald = { clientWidth: 1380 };
  const el = { parentElement: forald };
  g.ResizeObserver = class { constructor(f) { this.f = f; obs.push(this); this.sedda = []; } observe(x) { this.sedda.push(x); } unobserve() {} };
  g.document = { ...g.document,
    documentElement: { style: { setProperty: (k, v) => { p[k] = v; satt++; }, removeProperty: (k) => { delete p[k]; } }, setAttribute: (k) => attr.add(k), removeAttribute: (k) => attr.delete(k) },
    querySelector: (s) => (s === ".main.hvmode .wrap>.hv" ? el : null) };
  const fonster = (b, h) => { forald.clientWidth = b - 64; g.window = { ...g.window, innerWidth: b, innerHeight: h }; g.hvSkala(); };
  const px = (k) => parseFloat(p[k]);
  fonster(1444, 856);
  ok("i skissens storlek (1380 x 856 utan menyraden) förstoras ingenting och stilen är skissens", !Object.keys(p).length && !attr.has("data-hvskala"), JSON.stringify(p));
  fonster(2560, 1170);
  const z = +p["--hv-z"];
  ok("2560 x 1170: förstoringen är höjden delad med skissens 856, eftersom fönstret är bredare än ramen", Math.abs(z - 1170 / 856) < 0.0001 && z <= 1170 / 856, p["--hv-z"]);
  ok("och det förstorade hemmet är aldrig högre än fönstret", z * px("--hv-vh") <= 1170 && 1170 - z * px("--hv-vh") < 0.1, p["--hv-vh"]);
  const r = 2496 / z / 1380;
  ok("den extra bredden: spalternas yta växer med andelen (1280 x r) och luften mellan dem tar hela tillskottet", Math.abs(px("--hv-hemin") - 1280 * r) < 0.01 && Math.abs(px("--hv-spridd") - 640 * (r - 1)) < 0.01, `${p["--hv-hemin"]} ${p["--hv-spridd"]}`);
  ok("arket breddas på samma sätt", Math.abs(px("--hv-arkin") - 1120 * r) < 0.01, p["--hv-arkin"]);
  ok("vw räknas som i skissens fönster: menyraden plus 1380 px", p["--hv-vw"] === "1444.00px", p["--hv-vw"]);
  ok("och stilen slås på med data-hvskala", attr.has("data-hvskala"));
  fonster(1600, 1200);
  ok("ett högt fönster förstoras efter bredden, och spalterna breddas inte", p["--hv-z"] === String(Math.floor(1536 / 1380 * 10000) / 10000) && Math.abs(px("--hv-spridd")) < 0.01, `${p["--hv-z"]} ${p["--hv-spridd"]}`);
  fonster(1920, 800);
  ok("ett brett men lågt fönster förstoras inte, men hälsningen och läget står ändå kvar vid kanterna", p["--hv-z"] === "1" && px("--hv-hemin") > 1280 && attr.has("data-hvskala"), `${p["--hv-z"]} ${p["--hv-hemin"]}`);
  const fore = satt; fonster(1920, 800);
  ok("samma fönster en gång till skriver ingenting", satt === fore);
  fonster(1280, 900);
  ok("ett fönster som är smalare än skissen tar bort allt, och stilen är skissens igen", !Object.keys(p).length && !attr.has("data-hvskala"), JSON.stringify(p));
  ok("bredden bevakas (menyraden kan fällas ut utan att fönstret ändras), med en enda bevakare", obs.length === 1 && obs[0].sedda.length === 1 && obs[0].sedda[0] === forald, `${obs.length} ${obs[0] && obs[0].sedda.length}`);
  g.document = { ...g.document, querySelector: () => null }; const f2 = satt; g.window = { ...g.window, innerWidth: 2560, innerHeight: 1170 }; g.hvSkala();
  ok("utanför hemmet rör den ingenting", satt === f2);

  // FLIP i ett förstorat hem: rektanglarna är i skärmens bildpunkter, flytten i hemmets.
  const h = hem({ chef: true }); h.hvHem();
  let n = 0; const rekt = [{ left: 300, top: 200, width: 100, height: 20 }, { left: 260, top: 160, width: 100, height: 20 }];
  const x = { dataset: { flip: "k" }, style: {}, currentCSSZoom: 2, getBoundingClientRect: () => rekt[Math.min(n++, 1)] };
  const hv = { dataset: { hvlage: "hem" }, classList: klassLista(), contains: () => false, querySelector: () => null, querySelectorAll: (s) => (s === "[data-flip]" ? [x] : []) };
  h.document = { ...h.document, activeElement: null, body: {}, querySelector: (s) => (s === ".hv" ? hv : null), getElementById: () => null };
  h.S.hv.flipTill = Date.now() + 10000;
  h.hvForeMat(); let satt2 = null;
  Object.defineProperty(x.style, "transform", { get: () => satt2 ?? "", set: (v) => { if (satt2 === null) satt2 = v; }, configurable: true });
  h.hvFlip();
  ok("glidningen vid zoom 2 flyttar hälften så många av hemmets bildpunkter som skärmens", satt2 === "translate(20px,20px) scale(1)", satt2);
}

/* ---------- Funktionsvarvet K1: chattens ström och minne (A1-1, A1-2, A1-7, A1-8) ---------- */
// En ström som provet styr: ge(h) skickar en händelse, slut() stänger. Läsningen väntar tills något har getts.
const k1Enc = new TextEncoder();
const k1Strom = () => {
  const ko = []; let vantar = null, stangd = false;
  const puffa = () => { if (vantar && (ko.length || stangd)){ const v = vantar; vantar = null; v(ko.length ? { done: false, value: k1Enc.encode(ko.shift()) } : { done: true }); } };
  return {
    res: { ok: true, status: 200, headers: { get: () => "text/event-stream; charset=utf-8" }, body: { getReader: () => ({ read: () => new Promise((k) => { vantar = k; puffa(); }) }) } },
    ge(h) { ko.push(`data: ${JSON.stringify(h)}\n\n`); puffa(); },
    slut() { stangd = true; puffa(); },
  };
};
const k1Vanta = (ms = 5) => new Promise((k) => setTimeout(k, ms));
const K1RAD = "0b3c1e9a-6f1d-4c55-9a51-2d3f6c7b8e90";
const K1SV = { h: "svar", text: "Du har ⟦t1:3⟧ saker som väntar.", tal: [{ id: "t1", varde: 3, om: "Väntar på dig · data per 2026-11-17" }], obelagda: 0, kalla: "Skrivet av AI ur Navs tal", kallor: [{ verktyg: "las_vantar", anrop: 1, text: "Väntar på dig · data per 2026-11-17" }], kort: [], nasta: [], ja: false };
const k1Lager = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
// En chatt med en egen ström per fråga, lagring i fliken och en skärmläsarnod som minns vad den sagt.
const k1Chatt = ({ lager = k1Lager(), jag = null } = {}) => {
  const g = hem({ chef: false }); g.ND.hem.chatt = true; if (jag) g.ND.jag = { ...g.ND.jag, id: jag };
  const strommar = [], stopp = [], sagt = [], fokus = [];
  g.fetch = async (url, init) => { const b = JSON.parse(init.body); if (b.stoppa){ stopp.push({ b, keepalive: init.keepalive }); return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => ({ ok: true }) }; } const st = k1Strom(); strommar.push({ b, st }); init.signal.addEventListener("abort", () => st.slut()); return st.res; };
  const sr = { id: "hvSr", _t: "", get textContent() { return this._t; }, set textContent(v) { this._t = v; sagt.push(v); }, setAttribute() {} };
  let srFinns = false;
  const statusrad = { focus: () => fokus.push("kortst") };
  g.document = { ...g.document, getElementById: (id) => (id === "hvSr" && srFinns ? sr : null), createElement: () => { srFinns = true; return sr; }, body: { appendChild() {} }, querySelector: (q) => (/data-hvkortst="0:0"/.test(q) ? statusrad : null), querySelectorAll: () => [] };
  g.requestAnimationFrame = (f) => f();
  g.sessionStorage = lager;
  g.toast = (t) => g.anrop.push(["toast", t]);
  return { g, strommar, stopp, sagt, fokus, lager };
};

rubrik("Funktionsvarvet K1, A1-1: svaret skrivs fram mening för mening, och slutsvaret ersätter alltid utkastet");
{
  const { g, strommar } = k1Chatt();
  g.S.hv.q = "Vad väntar på mig?";
  const p = g.hvFraga(); await k1Vanta();
  const st = strommar[0].st;
  st.ge({ h: "rad", id: K1RAD });
  st.ge({ h: "hamtar", text: "Hämtar det som väntar på dig.", anrop: 1, verktyg: "las_vantar" }); await k1Vanta();
  const steget = g.hvHem();
  ok("steget som pågår visar sekunderna som går (data-hvt0), och stegklockan startas en gång", steget.includes("data-hvt0=") && g.anrop.filter((a) => a[0] === "setInterval" && a[1] === 100).length <= 1);
  st.ge({ h: "klart", anrop: 1, ok: true, text: "Väntar på dig · data per 2026-11-17", ms: 300 });
  st.ge({ h: "text", text: "Du har ⟦t1:3⟧ saker som väntar.", tal: [{ id: "t1", varde: 3 }] }); await k1Vanta();
  const utk = g.hvHem(), tur = g.S.hv.chatt[0];
  ok("utkastet ritas medan svaret skrivs, utan att läsas upp (aria-hidden), med markören sist", /<div class="hv-svar" aria-hidden="true"><p>Du har <span class="num">3<\/span> saker som väntar\.<i class="hv-markor"/.test(utk), utk.slice(utk.indexOf("hv-svar") - 20, utk.indexOf("hv-svar") + 300));
  ok("i utkastet är talen inga knappar, och Kopiera, Försök igen och korten finns inte än", !utk.includes('data-hvtal="0:t1"') && !utk.includes("data-hvchattkop") && !utk.includes("data-hvchattigen") && !utk.includes("hv-utk\""));
  st.ge({ h: "hamtar", text: "Kontrollerar talen i svaret." }); await k1Vanta();
  const ton = g.hvHem();
  ok("skrivs svaret om tonas utkastet ned med Talen kontrolleras", ton.includes('<div class="hv-svar hv-tonad" aria-hidden="true">') && ton.includes('<p class="hv-tank">Talen kontrolleras.</p>'));
  st.ge(K1SV); await k1Vanta();
  const klar = g.hvHem();
  ok("slutsvaret ersätter utkastet: inget tonat, talet är en knapp, Kopiera och Försök igen står under", !klar.includes("hv-tonad") && !klar.includes("Talen kontrolleras") && klar.includes('data-hvtal="0:t1"') && klar.includes('data-hvchattkop="0"') && klar.includes('data-hvchattigen="0"') && !klar.includes('aria-hidden="true"><p>Du har'));
  ok("efter svaret släpps låset direkt (Skicka är tillbaka), men strömmen läses till slutet", g.S.hv.strom === null && tur.oppen === true && !tur.laddar && klar.includes('aria-label="Skicka"'));
  // En ny fråga medan den förra läses klart väntar: annars svarar rutten 429 pagar.
  g.S.hv.q = "Och i morgon?";
  const p2 = g.hvFraga(); await k1Vanta();
  ok("en ny fråga medan den förra läses klart skickas först när strömmen är stängd", strommar.length === 1);
  st.slut(); await p; await k1Vanta();
  ok("när strömmen stängts är turen stängd och nästa fråga skickas", tur.oppen === false && strommar.length === 2);
  const st2 = strommar[1].st; st2.ge({ h: "rad", id: K1RAD }); st2.ge(K1SV); st2.slut(); await p2;

  // Tom text tar tillbaka utkastet; en ström som stängs före svaret säger var det bröts.
  const b = k1Chatt();
  b.g.S.hv.q = "Hur gick veckan?";
  const pb = b.g.hvFraga(); await k1Vanta();
  const sb = b.strommar[0].st;
  sb.ge({ h: "rad", id: K1RAD }); sb.ge({ h: "text", text: "Ett utkast.", tal: [] }); await k1Vanta();
  ok("utkastet står när text kommit", b.g.hvHem().includes("Ett utkast."));
  sb.ge({ h: "text", text: "", tal: [] }); await k1Vanta();
  ok("tom text tar tillbaka utkastet", !b.g.hvHem().includes("Ett utkast.") && b.g.S.hv.chatt[0].utkast === null);
  sb.ge({ h: "text", text: "Första meningen står.", tal: [] }); await k1Vanta();
  sb.slut(); await pb;
  const brott = b.g.hvHem(), bt = b.g.S.hv.chatt[0];
  ok("bryts strömmen före svaret står utkastet kvar (nu läsbart, nedtonat) och felet säger Svaret bröts här, med Försök igen", brott.includes('<div class="hv-svar hv-tonad"><p>Första meningen står.</p></div>') && brott.includes("Svaret bröts här.") && brott.includes('data-hvchattigen="0"') && bt.kod === "ofullstandigt" && !brott.includes("data-hvchattkop"), brott.slice(brott.indexOf("hv-svar") - 20, brott.indexOf("hv-svar") + 400));
  ok("utan svar visas inga kort och ingen källrad", !brott.includes("hv-kalla"));

  // Det som kommer efter slutsvaret ritas inte.
  const c = k1Chatt();
  c.g.S.hv.q = "Vad väntar på mig?";
  const pc = c.g.hvFraga(); await k1Vanta();
  const sc = c.strommar[0].st; sc.ge({ h: "rad", id: K1RAD }); sc.ge(K1SV); sc.ge({ h: "text", text: "Sent utkast.", tal: [] }); sc.ge({ h: "fel", text: "Sent fel.", kod: "ai" }); sc.slut(); await pc;
  const ct = c.g.S.hv.chatt[0], ch = c.g.hvHem();
  ok("en händelse efter slutsvaret ändrar ingenting", !ct.fel && !ct.utkast && !ch.includes("Sent utkast.") && !ch.includes("Sent fel."));
}

rubrik("Funktionsvarvet K1, A1-2: tråden överlever en omladdning, och en omladdning mitt i ett svar spärrar inte nästa fråga");
{
  const lager = k1Lager();
  const a = k1Chatt({ lager });
  a.g.S.hv.q = "Vad väntar på mig?";
  const pa = a.g.hvFraga(); await k1Vanta();
  const sa = a.strommar[0].st;
  sa.ge({ h: "rad", id: K1RAD }); await k1Vanta();
  ok("rad-händelsen sparas på turen", a.g.S.hv.chatt[0].rad === K1RAD);
  const nyckel = `nav2-hvutkast-trad:${a.g.ND.jag.id}`;
  ok("tråden sparas i fliken under nav2-hvutkast-trad:<person>, också medan svaret pågår", lager.m.has(nyckel) && JSON.parse(lager.m.get(nyckel)).turer[0].laddar === true);
  a.g.hvChattStopp(); await pa;
  ok("Stopp skickar radens id: bara den här frågan stoppas", a.stopp.length === 1 && a.stopp[0].b.stoppa === true && a.stopp[0].b.rad === K1RAD && a.stopp[0].keepalive === true, JSON.stringify(a.stopp));

  // Sidan stängs mitt i ett svar: stoppet går med keepalive och radens id, och tråden sparas som den står.
  const b = k1Chatt({ lager: k1Lager() });
  b.g.S.hv.q = "Hur går månaden?";
  const pb = b.g.hvFraga(); await k1Vanta();
  const sb = b.strommar[0].st; sb.ge({ h: "rad", id: K1RAD }); sb.ge({ h: "hamtar", text: "Läser din månad.", anrop: 1, verktyg: "las_provision" }); await k1Vanta();
  b.g.hvSidanGar();
  ok("pagehide stoppar frågan som pågår med keepalive och radens id", b.stopp.length === 1 && b.stopp[0].keepalive === true && b.stopp[0].b.rad === K1RAD);
  ok("och lyssnaren är satt på pagehide", /window\.addEventListener\('pagehide', hvSidanGar\);/.test(block));
  // Omladdningen: en ny flik med samma lagring.
  const sparat = b.lager;
  const c = k1Chatt({ lager: sparat });
  const ch = c.g.hvHem();
  const ct = c.g.S.hv.chatt[0];
  ok("efter omladdningen står turen kvar, och den som pågick säger det med koden omladdad och Försök igen", ct && ct.kod === "omladdad" && !ct.laddar && /Sidan laddades om innan svaret var klart/.test(ct.fel) && c.g.S.hv.trad.length === 1, JSON.stringify(ct && { kod: ct.kod, fel: ct.fel }));
  c.g.S.hv.ark = "chatt"; c.g.S.hv.id = "0";
  const chT = c.g.hvHem();
  ok("felraden för en omladdad tur erbjuder Försök igen", chT.includes("Sidan laddades om innan svaret var klart") && chT.includes('data-hvchattigen="0"'));
  ok("Skicka är fri efter omladdningen (inget lås följer med)", c.g.S.hv.strom === null || c.g.S.hv.strom === undefined);
  sb.slut(); await pb;

  // Ett kort som gjordes när sidan laddades om får ingen Godkänn, och säger att det ska kontrolleras.
  const KORT = { rubrik: "Lägg upp 1 uppgift", rader: [{ text: "Ring A" }], steg: [{ vag: "/nav2/uppgifter", body: { handling: "ny" } }], klart: "Klart." };
  const l2 = k1Lager();
  const d = k1Chatt({ lager: l2 });
  d.g.S.hv.chatt = [{ fraga: "Lägg upp", filer: ["offert.pdf"], bilagor: [{ namn: "offert.pdf", data: "QUJD" }], steg: [], svar: { ...K1SV, kort: [KORT] }, fel: "", kod: "", laddar: false, lage: [{ gjorda: [], gor: true, slut: "" }], narMin: d.g.now() }];
  d.g.hvTradSpara();
  const rad2 = l2.m.get(`nav2-hvutkast-trad:${d.g.ND.jag.id}`);
  ok("filerna sparas aldrig, bara deras namn", !rad2.includes("QUJD") && !rad2.includes("bilagor") && rad2.includes("offert.pdf"));
  const e = k1Chatt({ lager: l2 });
  e.g.hvHem(); e.g.S.hv.ark = "chatt"; e.g.S.hv.id = "0";
  const eh = e.g.hvHem();
  ok("ett kort som höll på att göras: Sidan laddades om medan kortet gjordes, utan Godkänn", eh.includes("Sidan laddades om medan kortet gjordes. Se efter i Uppgifter först.") && !eh.includes("data-hvchattgodkann"));
  let skrivet = 0; e.g.ndSkriv = async () => { skrivet++; return { ok: true }; };
  await e.g.hvChattGodkann(0, 0);
  ok("och det går inte att godkänna det igen", skrivet === 0);
  ok("Försök igen erbjuds inte på en tur vars kort kan ha gjorts", !eh.includes('data-hvchattigen="0"'));

  // Personen: nästa person på samma dator får inte den förras tråd.
  const f = k1Chatt({ lager: l2, jag: "annan-person" });
  f.g.hvHem();
  ok("tråden är per person: en annan inloggad får ingen tråd", f.g.S.hv.chatt.length === 0);
  // Utloggningen rensar allt som börjar med nav2-hvutkast, och trådens nyckel gör det.
  ok("utloggningen rensar tråden (nyckeln börjar med nav2-hvutkast)", html.includes("Object.keys(sessionStorage).filter(k => k.indexOf('nav2-hvutkast') === 0)") && /const HVTRAD = 'nav2-hvutkast-trad'/.test(block));
  // Högst 20 turer sparas.
  const m = k1Chatt({ lager: k1Lager() });
  m.g.S.hv.chatt = Array.from({ length: 25 }, (_, i) => ({ fraga: `Fråga ${i}`, filer: [], steg: [], svar: K1SV, fel: "", kod: "", laddar: false, lage: [], narMin: m.g.now() }));
  m.g.hvTradSpara();
  const mt = JSON.parse(m.lager.m.get(`nav2-hvutkast-trad:${m.g.ND.jag.id}`)).turer;
  ok("högst 20 turer sparas, de senaste", mt.length === 20 && mt[0].fraga === "Fråga 5" && mt[19].fraga === "Fråga 24");
  // En tur från i går tas inte tillbaka: dagens minut går inte att räkna för den.
  const y = k1Lager(); const yg = k1Chatt({ lager: y });
  y.setItem(`nav2-hvutkast-trad:${yg.g.ND.jag.id}`, JSON.stringify({ oppen: true, turer: [{ fraga: "I går", filer: [], steg: [], svar: K1SV, nar: Date.now() - 26 * 3600e3, lage: [] }] }));
  yg.g.hvHem();
  ok("en tur från en tidigare dag tas inte tillbaka", yg.g.S.hv.chatt.length === 0);
  // Var tråden öppen står den öppen igen.
  const o = k1Lager(); const og = k1Chatt({ lager: o });
  o.setItem(`nav2-hvutkast-trad:${og.g.ND.jag.id}`, JSON.stringify({ oppen: true, turer: [{ fraga: "Vad väntar?", filer: [], steg: [], svar: K1SV, nar: Date.now(), lage: [] }] }));
  og.g.hvHem();
  ok("var tråden öppen när sidan laddades om står den öppen igen, på den sista turen", og.g.S.hv.ark === "chatt" && og.g.S.hv.id === "0");
  // Utan lagring (privat fönster) fungerar chatten ändå.
  const u = k1Chatt({ lager: { getItem() { throw new Error("nej"); }, setItem() { throw new Error("nej"); }, removeItem() { throw new Error("nej"); } } });
  let kastat = false; try { u.g.hvHem(); u.g.S.hv.chatt = [{ fraga: "x", filer: [], steg: [], svar: K1SV, lage: [] }]; u.g.hvTradSpara(); } catch (_) { kastat = true; }
  ok("utan lagring kastar ingenting", !kastat);
  // Försök igen efter omladdning med filer: filerna finns inte kvar, så frågan läggs i rutan i stället.
  const fl = k1Lager(); const fg = k1Chatt({ lager: fl });
  fl.setItem(`nav2-hvutkast-trad:${fg.g.ND.jag.id}`, JSON.stringify({ oppen: true, turer: [{ fraga: "Läs filen", filer: ["kvitto.png"], steg: [], svar: null, laddar: true, nar: Date.now(), lage: [] }] }));
  fg.g.hvHem(); fg.g.hvChattIgen(0);
  ok("Försök igen efter omladdning med filer skickar inte utan filerna: frågan står i rutan och toasten säger varför", fg.strommar.length === 0 && fg.g.S.hv.q === "Läs filen" && fg.g.anrop.some((x) => x[0] === "toast" && /Filerna finns inte kvar/.test(x[1])));
}

rubrik("Funktionsvarvet K1, A1-7: skärmläsare, tangentbord och två flikar");
{
  const { g, strommar, sagt } = k1Chatt();
  const h0 = g.hvHem();
  g.S.hv.q = "Vad väntar på mig?";
  const p = g.hvFraga(); await k1Vanta();
  const tr = g.hvHem();
  ok("trådkolumnen har ingen aria-live (den ritas om under strömmen), men är upptagen medan svaret pågår", tr.includes('<div class="hv-tcol" aria-busy="true">') && !/hv-tcol"[^>]*aria-live/.test(tr));
  const st = strommar[0].st;
  st.ge({ h: "rad", id: K1RAD });
  st.ge({ h: "hamtar", text: "Hämtar det som väntar på dig.", anrop: 1, verktyg: "las_vantar" });
  st.ge({ h: "klart", anrop: 1, ok: true, text: "Väntar på dig", ms: 200 });
  st.ge({ h: "hamtar", text: "Hämtar dagen.", anrop: 2, verktyg: "las_dag" });
  st.ge({ h: "text", text: "Ett utkast som inte ska läsas upp.", tal: [] });
  st.ge(K1SV); st.slut(); await p;
  ok("skärmläsaren får det första steget och Svar klart, en gång var, och aldrig utkastet", JSON.stringify(sagt) === JSON.stringify(["Hämtar det som väntar på dig.", "Svar klart."]), JSON.stringify(sagt));
  // Felet sägs också.
  const f = k1Chatt();
  f.g.S.hv.q = "Vad väntar?";
  const pf = f.g.hvFraga(); await k1Vanta();
  const sf = f.strommar[0].st; sf.ge({ h: "rad", id: K1RAD }); sf.ge({ h: "fel", text: "Jag fick inget svar. Försök igen.", kod: "tomt" }); sf.slut(); await pf;
  ok("ett fel sägs av skärmläsaren", f.sagt[f.sagt.length - 1] === "Jag fick inget svar. Försök igen.", JSON.stringify(f.sagt));

  // Efter Godkänn och Avbryt står fokus på kortets statusrad.
  const KORT = { rubrik: "Lägg upp 1 uppgift", rader: [{ text: "Ring A" }], steg: [{ vag: "/nav2/uppgifter", body: { handling: "ny" } }], klart: "Klart." };
  const k = k1Chatt();
  k.g.S.hv.chatt = [{ fraga: "Lägg upp", filer: [], bilagor: [], steg: [], svar: { ...K1SV, kort: [KORT] }, fel: "", kod: "", laddar: false, lage: [], narMin: k.g.now() }];
  k.g.S.hv.trad = [{ sort: "chatt", id: "0", nr: 1 }]; k.g.S.hv.ark = "chatt"; k.g.S.hv.id = "0";
  const kh = k.g.hvHem();
  ok("kortets statusrad kan ta fokus (tabindex=-1)", kh.includes('<span class="hv-tank" role="status" tabindex="-1" data-hvkortst="0:0">Inget är gjort än.</span>'));
  k.g.ndSkriv = async () => ({ ok: true }); k.g.ndSvar = (r) => r;
  await k.g.hvChattGodkann(0, 0);
  ok("efter Godkänn flyttas fokus till statusraden, där kvittot står", k.fokus.length === 1 && k.g.hvHem().includes('<span class="hv-kvi" tabindex="-1" data-hvkortst="0:0">'));
  const k2 = k1Chatt();
  k2.g.S.hv.chatt = [{ fraga: "Lägg upp", filer: [], bilagor: [], steg: [], svar: { ...K1SV, kort: [KORT] }, fel: "", kod: "", laddar: false, lage: [], narMin: k2.g.now() }];
  k2.g.hvChattAvbryt(0, 0);
  ok("efter Avbryt flyttas fokus till statusraden", k2.fokus.length === 1);

  // "/" lägger fokus i skrivrutan när fokus inte står i ett fält.
  const sl = k1Chatt(); let fq = 0, hindrat = false;
  sl.g.document = { ...sl.g.document, getElementById: (id) => (id === "hvQ" ? { focus: () => fq++ } : null) };
  sl.g.hvTangent({ key: "/", target: { matches: () => false }, preventDefault() { hindrat = true; }, stopImmediatePropagation() {} });
  ok("/ lägger fokus i skrivrutan", fq === 1 && hindrat);

  // Två flikar: kanalen säger när en fråga startar och slutar, och den andra fliken skickar inte.
  const kanaler = [];
  class Kanal { constructor(n) { this.namn = n; this.skickat = []; kanaler.push(this); } postMessage(d) { this.skickat.push(d.sort); } }
  const a = k1Chatt(); a.g.BroadcastChannel = Kanal;
  a.g.S.hv.q = "Vad väntar?";
  const pa = a.g.hvFraga(); await k1Vanta();
  const sa = a.strommar[0].st; sa.ge({ h: "rad", id: K1RAD }); sa.ge(K1SV); sa.slut(); await pa;
  ok("kanalen heter nav2-chatt:<person> och säger start och slut", kanaler[0].namn === `nav2-chatt:${a.g.ND.jag.id}` && JSON.stringify(kanaler[0].skickat) === '["start","slut"]', JSON.stringify(kanaler[0] && kanaler[0].skickat));
  const b = k1Chatt(); b.g.BroadcastChannel = Kanal;
  b.g.hvAnnanFlik(); kanaler[1].onmessage({ data: { sort: "start" } });
  b.g.S.hv.q = "En fråga till";
  b.g.hvFraga();
  ok("svarar Nav i en annan flik skickas ingenting: toasten säger det och frågan står kvar i rutan", b.strommar.length === 0 && b.g.S.hv.q === "En fråga till" && b.g.anrop.some((x) => x[0] === "toast" && x[1].startsWith("Nav svarar i en annan flik")));
  kanaler[1].onmessage({ data: { sort: "slut" } });
  ok("när den andra fliken är klar går frågan att skicka", b.g.hvAnnanFlik() === false);
  b.g.S.hv.annanFlik = Date.now() - 131000;
  ok("ett start som aldrig fick sitt slut gäller inte längre än en fråga kan pågå", b.g.hvAnnanFlik() === false);
  ok("utan BroadcastChannel fungerar chatten ändå", (() => { const c = k1Chatt(); c.g.BroadcastChannel = undefined; return c.g.hvAnnanFlik() === false; })());
}

rubrik("Funktionsvarvet K1, A1-8: det chatten säger när den inte vet syns som det det är");
{
  const vy = (svar, steg = []) => { const c = k1Chatt(); c.g.S.hv.chatt = [{ fraga: "Fråga", filer: [], bilagor: [], steg, svar, fel: "", kod: "", laddar: false, lage: [] }]; c.g.S.hv.trad = [{ sort: "chatt", id: "0", nr: 1 }]; c.g.S.hv.ark = "chatt"; c.g.S.hv.id = "0"; return c.g.hvHem(); };
  const utan = vy({ ...K1SV, text: "Det vet jag inte.", tal: [], kalla: "Skrivet av AI, inte ur Navs tal eller kunskapsbasen", kallor: [] });
  ok("utan källor står Ingen källa först, i signalfärgen", utan.includes('<p class="hv-kalla hv-ingen"><b>Ingen källa</b> · Skrivet av AI, inte ur Navs tal eller kunskapsbasen</p>'));
  const med = vy(K1SV, [{ nr: 1, verktyg: "las_vantar", text: "Hämtar.", ok: true, ms: 100, kalla: "Väntar på dig" }]);
  ok("med källor står källraden som förut", med.includes('<p class="hv-kalla">Skrivet av AI ur Navs tal</p>') && !med.includes("Ingen källa") && !med.includes("Navs data gick inte att läsa"));
  const { kallor: _k, ...utanFalt } = K1SV;
  ok("saknas fältet ritas inget nytt (ingen gissning)", !vy(utanFalt).includes("Ingen källa"));
  const foll = vy({ ...K1SV, kallor: [] }, [{ nr: 1, verktyg: "las_vantar", text: "Hämtar.", ok: false, ms: 100, kalla: "Det gick inte att läsa just nu." }, { nr: 2, verktyg: "las_dag", text: "Hämtar dagen.", ok: false, ms: 80, kalla: "Det gick inte att läsa just nu." }, { nr: null, verktyg: "", text: "Kontrollerar talen i svaret.", ok: null, ms: 0, kalla: "" }]);
  ok("föll alla verktyg står Navs data gick inte att läsa ovanför svaret", foll.includes('<p class="hv-tank hv-ingen">Navs data gick inte att läsa.</p><div class="hv-svar"'));
  const ettOk = vy(K1SV, [{ nr: 1, verktyg: "las_vantar", text: "Hämtar.", ok: false, ms: 100, kalla: "x" }, { nr: 2, verktyg: "las_dag", text: "Hämtar.", ok: true, ms: 100, kalla: "y" }]);
  ok("svarade ett verktyg står den raden inte", !ettOk.includes("Navs data gick inte att läsa"));
  ok("signalfärgen är skissens token, i ljust och mörkt", /\.hv-ingen\{color:var\(--hv-signal-ink\)\}/.test(html));
  ok("utkastets toning är 120–250 ms opacity och av vid prefers-reduced-motion", /\.hv-svar\.hv-tonad\{opacity:\.55;transition:opacity var\(--hv-t,200ms\)/.test(html) && /@media \(prefers-reduced-motion:reduce\)\{\.hv-svar\.hv-tonad\{transition:none\}\}/.test(html));
}

/* ---------- Funktionsvarvet K2: chattens svar leder vidare (A1-3, A1-4, A1-5, funktion 3 och 6) ---------- */
const k2Klick = (g, attr) => g.hvKlick({ target: { closest: () => ({ dataset: attr }) }, preventDefault() {}, stopPropagation() {} });
// En chatt där provet styr strömmen, och där varje skrivning (ndSkriv) bokförs och får det svar provet ger.
const k2Chatt = async (svar, { svara = null, slut = true } = {}) => {
  const c = k1Chatt(); const { g, strommar } = c;
  const skrivet = [];
  g.ndSkriv = async (url, data) => { skrivet.push([url, JSON.parse(JSON.stringify(data))]); const s = svara ? svara(url, data, skrivet.length) : null; return s ?? (data.utfall || data.handling === "flagga" ? { ok: true, status: 200, data: { ok: "Skickat till den som förvaltar Nav, med frågan och svaret." } } : { ok: "Sparat.", id: `ny${skrivet.length}` }); };
  g.ndSvar = (x) => x; g.ndOmlas = () => Promise.resolve(true); g.NDOMLAS = {};
  g.upgTolkaDag = (q) => ({ fre: "2026-11-20", "25/11": "2026-11-25", ingen: "", "": null })[String(q).trim()];
  g.S.hv.q = "Fråga"; g.hvFraga(); await k1Vanta();
  const st = strommar[0].st; st.ge({ h: "rad", id: K1RAD }); st.ge({ h: "svar", ...svar }); await k1Vanta();
  if (slut) { st.slut(); await k1Vanta(); }
  return { ...c, st, skrivet };
};
let ek2Sett = 0;
const K2SV = (x = {}) => ({ text: "Klart.", tal: [], obelagda: 0, kalla: "Skrivet av AI ur Navs tal", kallor: [{ verktyg: "las_matt", anrop: 1, text: "x" }], kort: [], nasta: [], ja: false, ...x });

rubrik("Funktionsvarvet K2, A1-3: följdfrågorna ur serverns nasta, högst två, och ett klick ställer frågan");
{
  const N = [{ text: "Hur gick lagets hållna möten förra veckan?", knapp: "Förra veckan" }, { text: "Hur gick <b>mina</b> möten?", knapp: "Bara jag" }, { text: "En tredje?", knapp: "Tredje" }];
  const { g, strommar } = await k2Chatt(K2SV({ nasta: N }));
  const ut = g.hvHem();
  ok("högst två följdfrågor står under svaret, med knappens ord och hela frågan som namn", (ut.match(/data-hvchattnasta=/g) || []).length === 2 && ut.includes('aria-label="Fråga: Hur gick lagets hållna möten förra veckan?"') && ut.includes(">Förra veckan</button>") && !ut.includes("Tredje"));
  ok("följdfrågans text kan inte bli kod", ut.includes("Hur gick &lt;b&gt;mina&lt;/b&gt; möten?") && !ut.includes("<b>mina</b>"));
  ok("följdfrågorna står efter svarets åtgärder och källrad", ut.indexOf("data-hvchattnasta") > ut.indexOf('data-hvchattkop="0"') && ut.indexOf("data-hvchattnasta") > ut.indexOf("hv-kalla"));
  k2Klick(g, { hvchattnasta: "0:0" }); await k1Vanta();
  ok("ett klick ställer frågan som en vanlig fråga, med texten servern skrev", strommar.length === 2 && strommar[1].b.fraga === "Hur gick lagets hållna möten förra veckan?" && g.S.hv.chatt.length === 2);
  strommar[1].st.ge({ h: "rad", id: K1RAD }); strommar[1].st.ge({ h: "svar", ...K2SV({ nasta: [] }) }); strommar[1].st.slut(); await k1Vanta();
  const tva = g.hvHem();
  ok("bara det sista svaret har följdfrågor, och en tom lista ger ingen rad", !tva.includes("data-hvchattnasta") && !tva.includes("hv-nasta"));
  const av = await k2Chatt(K2SV({ nasta: N })); av.g.ND.hem.chatt = false;
  ok("med chatten av står inga följdfrågor", !av.g.hvHem().includes("data-hvchattnasta"));
  const utan = await k2Chatt(K2SV({ nasta: undefined }));
  ok("utan fältet nasta ritas inget", !utan.g.hvHem().includes("hv-nasta"));
  ok("ingen Ja-knapp ritas (B4), också när servern säger ja", !(await k2Chatt(K2SV({ ja: true }))).g.hvHem().includes("Ja, gör det"));
}

rubrik("Funktionsvarvet K2, A1-4: talet leder till sin vy, listor är listor och underlaget ligger ett klick bort");
{
  const { g } = await k2Chatt(K2SV({ text: "Tre saker väntar:\n- Ring ⟦t1:3⟧ kunder\n- Skicka offerten\n\nSedan är det klart.", tal: [{ id: "t1", varde: 3, kalla: { verktyg: "las_vantar", anrop: 1, falt: "antal" }, om: "Väntar på dig · data per 2026-11-17", ser: null, motvikt: null, forFa: false }] }));
  const ut = g.hvHem();
  ok("rader som börjar med - blir en lista, efter stycket de står i, och talet i listan är en knapp", /<p>Tre saker väntar:<\/p><ul><li>Ring <button class="hv-siffra num" data-hvtal="0:t1"[^>]*>3<\/button> kunder<\/li><li>Skicka offerten<\/li><\/ul><p>Sedan är det klart\.<\/p>/.test(ut), ut.slice(ut.indexOf("hv-svar"), ut.indexOf("hv-svar") + 400));
  k2Klick(g, { hvtal: "0:t1" });
  const kl = g.hvHem();
  ok("källraden får talets väg vidare sist: Öppna Väntar på dig", /<p class="hv-talk hv-mono" id="hvTalk0">Väntar på dig · data per 2026-11-17<button class="hv-lank" data-hvtalvidare="0:t1">Öppna Väntar på dig<\/button><\/p>/.test(kl), kl.slice(kl.indexOf("hv-talk") - 20, kl.indexOf("hv-talk") + 300));
  k2Klick(g, { hvtalvidare: "0:t1" });
  ok("ett klick öppnar vyn verktyget läste", g.S.hv.ark === "vantar");
  const vy = (verktyg, x = {}) => { const h = hem({ chef: x.chef ?? false }); Object.assign(h, x.g || {}); h.S.hv.chatt = [{ fraga: "F", filer: [], steg: [], svar: K2SV({ text: "⟦t1:1⟧", tal: [{ id: "t1", varde: 1, kalla: { verktyg, anrop: 1, falt: "antal" }, om: "Källa" }] }), lage: [], visa: "t1", laddar: false }]; h.S.hv.trad = [{ sort: "chatt", id: "0", nr: 1 }]; h.S.hv.ark = "chatt"; h.S.hv.id = "0"; return h.hvHem(); };
  ok("las_dag öppnar Min dag, las_affarer Möten", vy("las_dag").includes(">Öppna Min dag<") && vy("las_affarer").includes(">Öppna Möten<"));
  ok("las_matt: chefen får Min statistik, säljaren Möten", vy("las_matt", { chef: true, g: { ndMsChef: () => "" } }).includes(">Öppna Min statistik<") && vy("las_matt").includes(">Öppna Möten<"));
  ok("utan Möten kopplat står ingen väg för las_matt och las_affarer", !vy("las_matt", { g: { ndKopplad: () => false } }).includes("data-hvtalvidare") && !vy("las_affarer", { g: { ndKopplad: () => false } }).includes("data-hvtalvidare"));
  ok("Kunskapsbasen bara för den som förvaltar den", vy("sok_kunskap", { g: { kunFar: () => true, prfGa: () => {} } }).includes(">Öppna Kunskapsbasen<") && !vy("sok_kunskap", { g: { kunFar: () => false, prfGa: () => {} } }).includes("data-hvtalvidare"));
  ok("ett verktyg utan vy har ingen väg vidare", !vy("forbered_uppgifter").includes("data-hvtalvidare"));

  const U = { anrop: 1, verktyg: "las_affarer", rubrik: "Öppna affärer · Ditt lag · data per 2026-11-17", kolumner: ["Bolag", "Steg", "Nästa", "Belopp"], rader: [["Hagby <b>Glas</b>", "Offert", null, 36000], ["Åkes Bygg", "Möte", "2026-11-20", null]], totalt: 23 };
  const u = await k2Chatt(K2SV({ underlag: U }));
  let uu = u.g.hvHem();
  ok("underlaget ligger bakom en knapp, stängt", uu.includes('data-hvchattulag="0" aria-expanded="false" aria-controls="hvUlag0">Visa underlaget</button>') && !uu.includes("<table"));
  k2Klick(u.g, { hvchattulag: "0" }); uu = u.g.hvHem();
  ok("ett klick fäller ut raderna med serverns rubrik och kolumner", uu.includes('aria-expanded="true"') && uu.includes(">Dölj underlaget<") && uu.includes('<div class="hv-ulag" id="hvUlag0"><p class="hv-mono">Öppna affärer · Ditt lag · data per 2026-11-17</p>') && uu.includes('<th scope="col">Bolag</th><th scope="col">Steg</th><th scope="col">Nästa</th><th scope="col">Belopp</th>'));
  ok("ett tomt fält är tomt, aldrig 0, och ett tal står med svenska siffror", uu.includes("<td>Offert</td><td></td>") && uu.includes(`<td class="num">${(36000).toLocaleString("sv-SE")}</td>`) && uu.includes("<td>2026-11-20</td><td></td></tr>"));
  ok("raderna kan inte bli kod", uu.includes("Hagby &lt;b&gt;Glas&lt;/b&gt;") && !uu.includes("<b>Glas</b>"));
  ok("verktygets eget antal säger hur många som inte visas", uu.includes('<p class="hv-tank">Visar 2 av 23.</p>'));
  const mycket = await k2Chatt(K2SV({ underlag: { ...U, kolumner: ["a", "b", "c", "d", "e", "f"], rader: Array.from({ length: 15 }, (_x, i) => [i, 1, 2, 3, 4, 5]), totalt: null } }));
  k2Klick(mycket.g, { hvchattulag: "0" }); const mm = mycket.g.hvHem();
  ok("mycket data: högst 10 rader och 4 kolumner, och utan totalt ingen Visar-rad", (mm.match(/<tr>/g) || []).length === 11 && !mm.includes('scope="col">e<') && !mm.includes("Visar "));
  ok("utan underlag eller med tomma rader står ingen knapp", !(await k2Chatt(K2SV())).g.hvHem().includes("data-hvchattulag") && !(await k2Chatt(K2SV({ underlag: { ...U, rader: [] } }))).g.hvHem().includes("data-hvchattulag"));
}

rubrik("Funktionsvarvet K2, funktion 3: motvikten vid talet, först efter klicket");
{
  const T1 = { id: "t1", varde: 2, kalla: { verktyg: "las_matt", anrop: 1, falt: "antal" }, om: "Hållna möten · Ditt lag · förra veckan · data per 2026-11-17", ser: "Ser inte möten som saknar utfall, och inte om mötet ledde till något.", motvikt: { text: "uteblivna möten", antal: 1, av: 3 }, forFa: true };
  const T2 = { id: "t2", varde: 6, kalla: { verktyg: "las_matt", anrop: 2, falt: "antal" }, om: "Order netto · laget · november · data per 2026-11-16", ser: "Ser inte order som inte är godkända än.", motvikt: { text: "makulerade order", antal: 1, av: null }, forFa: false };
  const T3 = { id: "t3", varde: 1, kalla: { verktyg: "sok_kunskap", anrop: 3, falt: "traffar" }, om: "Dokument i kunskapsbasen som matchade · data per 2026-11-17", ser: null, motvikt: null, forFa: false };
  const { g } = await k2Chatt(K2SV({ text: "Laget höll ⟦t1:2⟧ möten och har ⟦t2:6⟧ order. ⟦t3:1⟧ dokument. Ungefär ⟦obelagt:63 %⟧.", tal: [T1, T2, T3] }));
  const fore = g.hvHem();
  ok("före klicket syns ingen motvikt, inget för få och inget ser inte", !fore.includes("Motvikt:") && !fore.includes("För få") && !fore.includes("Ser inte möten"));
  k2Klick(g, { hvtal: "0:t1" }); const m = g.hvHem();
  const i = (s) => m.indexOf(s);
  ok("efter klicket: källan, Motvikt, För få, Ser inte och vägen vidare, i den ordningen", i("Hållna möten · Ditt lag") > 0 && i("Hållna möten · Ditt lag") < i("Motvikt:") && i("Motvikt:") < i("För få för att jämföra.") && i("För få för att jämföra.") < i("Ser inte möten som saknar utfall") && i("Ser inte möten som saknar utfall") < i(">Öppna Möten<"), m.slice(i("hv-talk"), i("hv-talk") + 600));
  ok("ett mötesmått står som 1 av 3, aldrig som procent, var rad för sig", m.includes('<span class="hv-mono">Motvikt: uteblivna möten 1 av 3</span>') && !/Motvikt:[^<]*%/.test(m));
  ok("talet är en knapp med aria-expanded", /data-hvtal="0:t1" aria-expanded="true"/.test(m));
  k2Klick(g, { hvtal: "0:t2" }); const o = g.hvHem();
  ok("ett ordermått har bara antalet, och utan För få står ingen sådan rad", o.includes('<span class="hv-mono">Motvikt: makulerade order 1</span>') && !o.includes("För få") && o.includes('<span class="hv-mono">Ser inte order som inte är godkända än.</span>'));
  g.kunFar = () => false; k2Klick(g, { hvtal: "0:t3" }); const k = g.hvHem();
  ok("fält som är null eller falska ritas inte: bara källraden", /<p class="hv-talk hv-mono" id="hvTalk0">Dokument i kunskapsbasen som matchade · data per 2026-11-17<\/p>/.test(k) && !k.includes("Motvikt"));
  ok("ett obelagt tal är ingen knapp och har inga rader", /<mark class="hv-obel"[^>]*>63 %<\/mark>/.test(k) && !k.includes('data-hvtal="0:obelagt"'));
  const fel = await k2Chatt(K2SV({ text: "⟦t1:2⟧", tal: [{ ...T1, ser: null, motvikt: null, forFa: false }] }));
  k2Klick(fel.g, { hvtal: "0:t1" });
  ok("ett verktyg som svarade med fel (fälten null) ger bara källraden", !fel.g.hvHem().includes('<span class="hv-mono">'));
  let kopierat = null; g.navigator = { clipboard: { writeText: async (t) => { kopierat = t; } } }; g.hvKopiera(0); await k1Vanta();
  ok("Kopiera tar inte med raderna under talet", typeof kopierat === "string" && kopierat.startsWith("Laget höll 2 möten") && !kopierat.includes("Motvikt") && !kopierat.includes("Ser inte"), kopierat);
}

rubrik("Funktionsvarvet K2, A1-5: Stämmer inte, kortens utfall och avläsningen");
{
  const s = await k2Chatt(K2SV(), { slut: false });
  let ut = s.g.hvHem();
  ok("Stämmer inte står under svaret när rutten sagt loggens rad", ut.includes('data-hvchattstammer="0">Stämmer inte</button>'));
  k2Klick(s.g, { hvchattstammer: "0" }); await k1Vanta();
  ok("medan strömmen läses klart skickas inget, och knappen går inte att trycka igen", s.skrivet.length === 0 && s.g.hvHem().includes('data-hvchattstammer="0" disabled>Skickar…'));
  k2Klick(s.g, { hvchattstammer: "0" });
  s.st.slut(); await k1Vanta(20);
  ok("när strömmen är slut skickas bara raden, en gång", s.skrivet.length === 1 && s.skrivet[0][0] === "/nav2/hem" && JSON.stringify(s.skrivet[0][1]) === JSON.stringify({ handling: "flagga", var: "chatt", rad: K1RAD }), JSON.stringify(s.skrivet));
  ut = s.g.hvHem();
  ok("efteråt står serverns kvitto där knappen stod", ut.includes('<span class="hv-tank" role="status">Skickat till den som förvaltar Nav, med frågan och svaret.</span>') && !ut.includes("data-hvchattstammer"));
  ok("kvittot sparas med tråden", JSON.parse(s.lager.getItem(`nav2-hvutkast-trad:${s.g.ND.jag.id}`)).turer[0].flagg.klar.startsWith("Skickat"));
  const ek = await k2Chatt(K2SV(), { svara: (_u, _d, n) => (n === 1 ? { ok: false, status: 409, data: { kod: "ej-klar" }, fel: "Svaret sparas fortfarande. Försök igen om en stund." } : null) });
  k2Klick(ek.g, { hvchattstammer: "0" }); await k1Vanta(1100);
  ok("ej-klar prövas en gång till efter en sekund", ek.skrivet.length === 2 && ek.g.hvHem().includes("Skickat till den som förvaltar Nav"));
  const ff = await k2Chatt(K2SV(), { svara: () => ({ ok: false, status: 500, data: null, fel: "Det gick inte att spara." }) });
  k2Klick(ff.g, { hvchattstammer: "0" }); await k1Vanta(20);
  ut = ff.g.hvHem();
  ok("fel: serverns text som alert, och knappen går att trycka igen", ff.skrivet.length === 1 && ut.includes('role="alert">Det gick inte att spara.</span>') && ut.includes('data-hvchattstammer="0">Stämmer inte</button>'));
  const ingenRad = hem({ chef: false }); ingenRad.ND.hem.chatt = true;
  ingenRad.S.hv.chatt = [{ fraga: "F", filer: [], steg: [], svar: K2SV(), lage: [], laddar: false }]; ingenRad.S.hv.trad = [{ sort: "chatt", id: "0", nr: 1 }]; ingenRad.S.hv.ark = "chatt"; ingenRad.S.hv.id = "0";
  const igen = await k2Chatt(K2SV());
  k2Klick(igen.g, { hvchattstammer: "0" }); await k1Vanta(20); k2Klick(igen.g, { hvchattulag: "0" });
  igen.g.hvChattIgen(0); await k1Vanta();
  ok("Försök igen ger ett nytt svar utan det förra svarets kvitto", igen.g.S.hv.chatt[0].flagg === null && igen.g.S.hv.chatt[0].ulag === false);
  ok("utan loggens rad (en äldre tråd) står ingen Stämmer inte", !ingenRad.hvHem().includes("data-hvchattstammer"));

  const KU = { rubrik: "Lägg upp en uppgift", klart: "Uppgiften är upplagd.", varning: null, rader: [{ text: "Ring Ekdala", dag: "2026-11-17", not: "" }], steg: [{ vag: "/nav2/uppgifter", body: { handling: "skapa", titel: "Ring Ekdala", dag: "2026-11-17" }, angra: { handling: "avbryt", id: "$id" } }], anrop: 2, verktyg: "forbered_uppgifter", input: { uppgifter: [{ titel: "Ring Ekdala", dag: "2026-11-17", till: "jag" }] } };
  const ut2 = (c) => c.skrivet.filter((x) => x[1].utfall).map((x) => x[1].utfall);
  const gk = await k2Chatt(K2SV({ kort: [KU] }));
  await gk.g.hvChattGodkann(0, 0); await k1Vanta();
  ok("Godkänn ger utfallet godkant mot kortets anrop, och ett orört kort skickar inget andrat", JSON.stringify(ut2(gk)) === JSON.stringify([{ rad: K1RAD, anrop: 2, lage: "godkant" }]), JSON.stringify(ut2(gk)));
  await gk.g.hvChattAngra(0, 0); await k1Vanta();
  ok("Ångra ger angrat", ut2(gk).length === 2 && ut2(gk)[1].lage === "angrat");
  const ab = await k2Chatt(K2SV({ kort: [KU] }), { slut: false });
  ab.g.hvChattAvbryt(0, 0); await k1Vanta();
  ok("Avbryt medan strömmen läses: utfallet väntar på slutet (R1)", ut2(ab).length === 0);
  ab.st.slut(); await k1Vanta();
  ok("och skickas sedan som avbrutet", ut2(ab).length === 1 && ut2(ab)[0].lage === "avbrutet");
  const KU2 = { ...KU, rubrik: "Lägg upp 2 uppgifter", rader: [KU.rader[0], { text: "Skicka offerten", dag: null, not: "utan dag" }], steg: [KU.steg[0], { vag: "/nav2/uppgifter", body: { handling: "skapa", titel: "Skicka offerten", dag: null }, angra: { handling: "avbryt", id: "$id" } }], input: { uppgifter: [KU.input.uppgifter[0], { titel: "Skicka offerten", dag: "", till: "jag" }] } };
  const dv = await k2Chatt(K2SV({ kort: [KU2] }), { svara: (u, d, n) => (n === 2 && !d.utfall ? { fel: "Det sparades inte." } : null) });
  await dv.g.hvChattGodkann(0, 0); await k1Vanta();
  ok("ett kort där bara en del gick ger delvis", ut2(dv).length === 1 && ut2(dv)[0].lage === "delvis", JSON.stringify(ut2(dv)));
  const ek2 = await k2Chatt(K2SV({ kort: [KU] }), { svara: (_u, d) => (d.utfall && !ek2Sett++ ? { ok: false, status: 409, data: { kod: "ej-klar" }, fel: "Svaret sparas fortfarande." } : null) });
  await ek2.g.hvChattGodkann(0, 0); await k1Vanta(1100);
  ok("ett utfall som får ej-klar skickas en gång till efter en sekund, sedan inte mer", ut2(ek2).length === 2 && ut2(ek2)[1].lage === "godkant", JSON.stringify(ut2(ek2)));
  const ingenAnrop = await k2Chatt(K2SV({ kort: [{ ...KU, anrop: undefined }] }));
  await ingenAnrop.g.hvChattGodkann(0, 0); await k1Vanta();
  ok("ett kort utan anrop skickar inget utfall", ut2(ingenAnrop).length === 0);

  const lage = (C) => { const h = hem({ chef: true }); h.ND.hem.chattLage = { pa: true, skal: null, modell: "m", utrymme: null, allas: [], ...C }; return h.hvChattLage(); };
  const A = { manad: "2026-11", dataPer: "2026-11-17", rad: "Kort i månaden: 5 visade, 1 godkända … · Stämmer inte: 2 · data per 2026-11-17", serInte: "Ser inte <i>varför</i>." };
  const al = lage({ avlasning: A });
  ok("avläsningen står för den som ser allas, med serverns rad och vad den inte ser", al.includes("Så gick chattens kort") && al.includes("Stämmer inte: 2 · data per 2026-11-17") && al.includes("Ser inte &lt;i&gt;varför&lt;/i&gt;."));
  ok("går den inte att läsa säger den det", lage({ avlasning: null }).includes("Avläsningen gick inte att läsa just nu."));
  ok("den som inte ser allas får ingen avläsning", !lage({ allas: null, avlasning: null }).includes("Så gick chattens kort"));
}

rubrik("Funktionsvarvet K2, funktion 6: rätta kortet före Godkänn");
{
  const KU = { rubrik: "Lägg upp en uppgift", klart: "Uppgiften är upplagd.", varning: null, rader: [{ text: "Följ upp Ekdala", dag: "2026-11-17", not: "" }], steg: [{ vag: "/nav2/uppgifter", body: { handling: "skapa", titel: "Följ upp Ekdala", dag: "2026-11-17" }, angra: { handling: "avbryt", id: "$id" } }], anrop: 3, verktyg: "forbered_uppgifter", input: { uppgifter: [{ titel: "Följ upp Ekdala", dag: "2026-11-17", till: "jag" }] } };
  const UF = { rubrik: "Ändra dagen för uppföljningen", klart: "Uppföljningen är ändrad.", varning: null, rader: [{ text: "Solbacken", dag: "2026-11-20", not: "förut 2026-11-12" }], steg: [{ vag: "/nav2/moten", body: { handling: "uppfoljning_andra" }, angra: null }], anrop: 4, verktyg: "forbered_uppfoljning", input: { bolag: "Solbacken", dag: "2026-11-20" } };
  const NY = { ...KU, rader: [{ text: "Följ upp Ekdala", dag: "2026-11-20", not: "" }], steg: [{ ...KU.steg[0], body: { ...KU.steg[0].body, dag: "2026-11-20" } }], anrop: undefined, input: { uppgifter: [{ titel: "Följ upp Ekdala", dag: "2026-11-20", till: "jag" }] } };
  const c = await k2Chatt(K2SV({ kort: [KU, UF] }), { svara: (u, d) => (d.kommando ? (d.kommando.input.uppgifter && d.kommando.input.uppgifter[0].till === "Okänd" ? { ok: false, status: 422, data: { fel: "Här går det bara att lägga uppgifter åt sig själv och åt sitt eget lag." }, fel: "Här går det bara att lägga uppgifter åt sig själv och åt sitt eget lag." } : { ok: true, status: 200, data: { kort: { ...NY, input: d.kommando.input } } }) : null) });
  const { g } = c;
  let ut = g.hvHem();
  ok("ett kort som inte är avgjort: titel, dag och åt är knappar", ut.includes('data-hvkortratta="0:0:0:titel"') && ut.includes('data-hvkortratta="0:0:0:dag" aria-label="Ändra dagen: 17 nov">17 nov</button>') && ut.includes('data-hvkortratta="0:0:0:till" aria-label="Ändra vem som gör den: åt dig">åt dig</button>'));
  const at = await k2Chatt(K2SV({ kort: [{ ...KU, rader: [{ ...KU.rader[0], not: "åt Sara Lind" }], input: { uppgifter: [{ ...KU.input.uppgifter[0], till: "sara" }] } }] }));
  ok("åt står som servern skrev raden (namnet den hittade), inte som AI:n skrev input", at.g.hvHem().includes(">åt Sara Lind</button>") && !at.g.hvHem().includes("åt sara"));
  at.g.hvKortRattaOppna(0, 0, 0, "till");
  ok("fältet för åt fylls med det AI:n skrev, så att det går att rätta", at.g.S.hv.ratta && at.g.S.hv.ratta.v === "sara");
  ok("en uppföljning: bara dagen går att ändra, bolaget är text", ut.includes('data-hvkortratta="0:1:0:dag"') && !ut.includes('data-hvkortratta="0:1:0:titel"') && ut.includes("<span>Solbacken</span>") && ut.includes("förut 2026-11-12"));
  g.hvKortRattaOppna(0, 0, 0, "dag"); ut = g.hvHem();
  ok("ett klick på dagen gör den till ett fält med dagen ifylld och hjälp att läsa", /<input id="hvKortRatta" data-hvkortin autocomplete="off" aria-label="Ny dag för Följ upp Ekdala" aria-describedby="hvKortRattaH" value="17\/11">/.test(ut) && ut.includes("Enter bygger om kortet, Esc avbryter."));
  g.S.hv.ratta.v = "fre"; const esc1 = { key: "Escape", target: { id: "hvKortRatta" }, preventDefault() {}, stopPropagation() {} }; g.hvTangent(esc1);
  ok("Esc lämnar allt som det var: inget skickas och kortet är orört", g.S.hv.ratta === null && c.skrivet.length === 0 && g.hvHem().includes(">17 nov</button>") && !g.hvHem().includes("ändrat av dig"));
  g.hvKortRattaOppna(0, 0, 0, "dag"); g.S.hv.ratta.v = "blabla"; g.hvTangent({ ...esc1, key: "Enter" }); await k1Vanta();
  ok("en dag som inte går att tolka säger det under fältet, utan att fråga servern", c.skrivet.length === 0 && g.hvHem().includes('role="alert">Det förstod jag inte. Prova tor, 25/11 eller om 2 veckor.</span>'));
  g.S.hv.ratta.v = "fre"; g.hvTangent({ ...esc1, key: "Enter" }); await k1Vanta();
  ok("Enter bygger om kortet på servern med bara verktyget och input, med den nya dagen", c.skrivet.length === 1 && c.skrivet[0][0] === "/nav2/chatt" && JSON.stringify(c.skrivet[0][1]) === JSON.stringify({ kommando: { verktyg: "forbered_uppgifter", input: { uppgifter: [{ titel: "Följ upp Ekdala", dag: "2026-11-20", till: "jag" }] } } }), JSON.stringify(c.skrivet));
  const k0 = g.S.hv.chatt[0].svar.kort[0]; ut = g.hvHem();
  ok("det ombyggda kortet har samma anrop, den nya dagen och foten säger ändrat av dig", k0.anrop === 3 && k0.rader[0].dag === "2026-11-20" && ut.includes("Förberett av AI · ändrat av dig · görs när du godkänner") && g.S.hv.ratta === null);
  ok("det andra kortet är orört", ut.includes("<span class=\"hv-mono\">Förberett av AI · görs när du godkänner</span>"));
  ok("skärmläsaren får veta att kortet är ombyggt", c.sagt.includes("Kortet är ombyggt. Det görs när du godkänner."));
  ok("det ändrade kortet och fälten sparas med tråden (A1-2)", (() => { const d = JSON.parse(c.lager.getItem(`nav2-hvutkast-trad:${g.ND.jag.id}`)); return d.turer[0].svar.kort[0].rader[0].dag === "2026-11-20" && d.turer[0].lage[0].andrat[0] === "dag"; })());
  g.hvKortRattaOppna(0, 0, 0, "till"); g.S.hv.ratta.v = "Okänd"; await g.hvKortBygg();
  ut = g.hvHem();
  ok("fel vid ombyggnaden: serverns egen text under fältet, och kortet är oförändrat", ut.includes('role="alert">Här går det bara att lägga uppgifter åt sig själv och åt sitt eget lag.</span>') && g.S.hv.chatt[0].svar.kort[0].input.uppgifter[0].till === "jag" && g.S.hv.ratta && g.S.hv.ratta.falt === "till");
  g.hvKortRattaStang();
  await g.hvChattGodkann(0, 0); await k1Vanta();
  const utf = c.skrivet.filter((x) => x[1].utfall).map((x) => x[1].utfall);
  ok("kortets FÖRSTA utfall efter rättningen bär andrat", utf.length === 1 && utf[0].lage === "godkant" && utf[0].anrop === 3 && JSON.stringify(utf[0].andrat) === JSON.stringify(["dag"]), JSON.stringify(utf));
  ok("Godkänn gör det ombyggda kortets steg", c.skrivet.some((x) => x[0] === "/nav2/uppgifter" && x[1].dag === "2026-11-20"));
  ut = g.hvHem();
  ok("ett gjort kort går inte att ändra: raderna är text", !ut.includes('data-hvkortratta="0:0:') && ut.includes("<span>Följ upp Ekdala</span>"));
  g.hvKortRattaOppna(0, 0, 0, "dag");
  ok("och fältet går inte att öppna", g.S.hv.ratta === null);
  await g.hvChattAngra(0, 0); await k1Vanta();
  const utf2 = c.skrivet.filter((x) => x[1].utfall).map((x) => x[1].utfall);
  ok("nästa utfall bär inget andrat", utf2.length === 2 && utf2[1].lage === "angrat" && !("andrat" in utf2[1]));
  g.hvKortRattaOppna(0, 1, 0, "titel");
  ok("en uppföljnings bolag går inte att öppna som fält", g.S.hv.ratta === null);
  g.hvKortRattaOppna(0, 1, 0, "dag"); g.S.hv.ratta.v = "ingen"; await g.hvKortBygg();
  ok("en uppföljning måste ha en dag", g.hvHem().includes('role="alert">Skriv en dag, till exempel fre eller 25/11.</span>'));
  g.S.hv.ratta.v = "20/11"; await g.hvKortBygg();
  ok("samma värde som förut stänger fältet utan att fråga servern", g.S.hv.ratta === null && !c.skrivet.some((x) => x[1].kommando && x[1].kommando.verktyg === "forbered_uppfoljning"));

  const gar = await k2Chatt(K2SV({ kort: [KU] }), { slut: false });
  gar.g.S.hv.chatt[0].lage[0] = { gjorda: [], gor: true, slut: "" };
  ok("ett kort som görs just nu har inga fält", !gar.g.hvHem().includes("data-hvkortratta"));
  const gammal = await k2Chatt(K2SV({ kort: [{ ...KU, verktyg: undefined, input: undefined }] }));
  ok("ett kort utan verktyg och input (äldre tråd) är text som förut", !gammal.g.hvHem().includes("data-hvkortratta"));
  ok("fältet tar radens hela bredd, också i 400 px", /\.hv-kratt\{grid-column:2\/-1;/.test(html) && /\.hv-kratt input\{width:100%;/.test(html));
  ok("markören i fältet står kvar efter en omritning", html.includes("sel:a && (a.id === 'hvQ' || a.id === 'hvKortRatta')"));
}

rubrik("Funktionsvarvet K3, funktion 1: hemmet säger när det inte vet");
{
  const f = hem({ chef: true }); f.ND.hem.lasfel = { forslag: true }; f.ND.hem.forslag = null;
  let h = f.hvHem();
  ok("lasfel.forslag: Nav föreslår är skissens radknapp med Gick inte att läsa och Försök igen", /<button class="hv-andr an" style="--i:4" data-hvater aria-busy="false" aria-label="Nav föreslår: gick inte att läsa 08\.00\. Försök igen"><span class="hv-mark">[\s\S]*?<\/span><span><b>Nav föreslår<\/b> &nbsp;Gick inte att läsa 08\.00 · Försök igen<\/span><\/button>/.test(h), h.slice(h.indexOf("Nav föreslår") - 200, h.indexOf("Nav föreslår") + 200));
  ok("och aldrig tomtexten Inga förslag just nu", !h.includes("Inga förslag just nu"));
  ok("Det som ändrats säger samma sak, inte Berätta om en ändring", h.includes("<b>Det som ändrats</b> &nbsp;Gick inte att läsa 08.00 · Försök igen") && !h.includes("Berätta om en ändring"));
  const tom = hem({ chef: true, forslag: 0 }); tom.ND.hem.lasfel = {};
  ok("utan lasfel är ett tomt kort skissens tomtext, utan Försök igen", tom.hvHem().includes("Inga förslag just nu.") && !tom.hvHem().includes("data-hvater"));

  const c = hem({ chef: true }); c.ND.hem.team = null; c.ND.hem.lasfel = { team: true };
  h = c.hvHem();
  ok("lasfel.team hos ledaren: Teamet i november · Talen gick inte att läsa · Försök igen", h.includes("<b>Teamet i november</b> &nbsp;Talen gick inte att läsa 08.00 · Försök igen"));
  ok("inget tal visas, inte heller Din månad i stället", !h.includes('class="hv-man'));
  const s = hem({ chef: false }); s.ND.hem.lasfel = { team: true };
  ok("säljaren ser aldrig teamraden", !s.hvHem().includes("Talen gick inte att läsa"));

  const gv = hem({ chef: true, golvet: null }); gv.ND.hem.lasfel = { golvet: true }; gv.hvHem(); gv.S.hv.mer = true;
  ok("Golvet står i Mer också när läsningen föll", gv.hvHem().includes('data-hvark="golvet">Golvet</button>'));
  const ag = gv.hvArkGolvet();
  ok("Golvet: Golvet gick inte att läsa just nu., med Försök igen", ag.includes("<p>Golvet gick inte att läsa just nu.</p>") && ag.includes('data-hvater aria-busy="false">Försök igen</button>'));
  const gv2 = hem({ chef: true, golvet: null }); gv2.hvHem();
  ok("utan lasfel.golvet (inget lag) står skissens text, utan Försök igen", !gv2.hvArkGolvet().includes("data-hvater"));

  const ud = hem({ chef: true, nu: 1000, kal: [{ s: 600, e: 630, t: "Veckomöte", id: "k1" }] }); ud.ND.hem.lasfel = { dag: true };
  ok("lasfel.dag utan schema: mitten säger Schemat gick inte att läsa", urtavlan(ud.hvHem()).includes('<span class="s" data-roll="mitt-s-stor">Schemat gick inte att läsa</span>'));
  const ud2 = hem({ chef: true, nu: 1000, kal: [{ s: 600, e: 630, t: "Veckomöte", id: "k1" }] });
  ok("utan lasfel.dag står ingen schematext i mitten", !/Schemat|Inget schema/.test(urtavlan(ud2.hvHem())));
  const ud3 = hem({ chef: true, nu: 1100, kal: [{ s: 600, e: 630, t: "Veckomöte", id: "k1" }], kalImorgon: [] }); ud3.ND.hem.lasfel = { dag: true };
  ok("efter dagens slut: Dagen är slut och Schemat gick inte att läsa", urtavlan(ud3.hvHem()).includes('<span class="s" data-roll="mitt-s-stor">Schemat gick inte att läsa</span>'));

  // Försök igen: hvater, tyst. Faller det står raden kvar med tiden för det senaste försöket, och sidan laddas inte om.
  const oml = []; f.ndOmlas = (vy, x) => { oml.push([vy, x]); return Promise.resolve(false); }; f.now = () => 504;
  k2Klick(f, { hvater: "" }); await k1Vanta();
  ok("Försök igen kör ndOmlas('hvater', {tyst:true})", oml.length === 1 && oml[0][0] === "hvater" && oml[0][1].tyst === true, JSON.stringify(oml));
  ok("faller det igen står raden kvar med det senaste försöket", f.hvHem().includes("Gick inte att läsa 08.24 · Försök igen"));
  f.S.hv.laserOm = true;
  ok("medan det läses säger raden det, och är upptagen", f.hvHem().includes('aria-busy="true"') && f.hvHem().includes("Läser om …"));
  f.S.hv.laserOm = false;
  f.ndOmlas = () => Promise.resolve(true); f.ND.hem.skriv = true; f.ND.hem.lasfel = {}; f.ND.hem.forslag = hem({ chef: true }).ND.hem.forslag;
  await f.hvLasOm();
  ok("en lyckad omläsning sätter hamtad på nytt och säger sett en gång", Date.now() - f.S.hv.hamtad < 1000 && f.S.hv.hamtadKl === 504 && f.anrop.filter((x) => x[0] === "sett").length === 1);
  ok("och raden blir kortet igen", !f.hvHem().includes("Gick inte att läsa"));

  // Ny sedan: bilden när man gick, och det som kom till sedan.
  const n = hem({ chef: true }); n.hvHem();
  n.S.hv.bild = { t: Date.now() - 60e3, kl: 710, ids: ["r1", "r3", "r5", "upg-gammal"] };
  n.ndOmlas = () => Promise.resolve(true);
  await n.hvLasOm();
  h = n.hvHem();
  ok("en rad som kommit till sedan bilden får Ny sedan först i sin grå rad", h.includes("<small>Ny sedan 11.50 · Frist i dag</small>"));
  ok("en rad som fanns får ingen", h.includes("<small>Sjuk sedan i dag. Ingen har bekräftat</small>"));
  n.hvOppna("vantar"); h = n.hvHem();
  ok("arket Väntar säger Sedan du tittade här, med nya och inte längre i listan", h.includes("Sedan du tittade här 11.50: 2 nya, 1 inte längre i listan."));
  ok("Ny sedan står också i hela listan", h.includes("<small>Ny sedan 11.50 · Frist i dag · Uppgift</small>"));
  n.S.hv.synts = Date.now() - 5000; n.hvBildTa();
  const n2 = hem({ chef: true }); n2.hvHem(); n2.S.hv.synts = Date.now() - 2000; n2.hvBildTa();
  ok("hemmet som synts kortare än 4 s tar ingen bild", !n2.S.hv.bild);
  ok("en ny bild (hemmet dolt efter minst 4 s) tar bort märkena", !n.hvHem().includes("Ny sedan") && n.S.hv.bild.ids.length === 5);
  const d1 = hem({ chef: true }); d1.hvHem(); d1.S.hv.bild = null; d1.ndOmlas = () => Promise.resolve(true); await d1.hvLasOm();
  ok("dag ett, utan bild: inga märken", !d1.hvHem().includes("Ny sedan") && !d1.hvHem().includes("Sedan du tittade"));

  // Gamla tal.
  const t = hem({ chef: true }); t.hvHem(); t.S.hv.hamtadKl = 492;
  t.S.hv.hamtad = Date.now() - 31 * 60e3; h = t.hvHem();
  ok("31 minuter gamla tal: veckan blir knappen Talen från", h.includes('<button class="hv-lank" data-hvater aria-label="Talen är från 08.12. Läs om">Talen från 08.12</button>') && !h.includes("<small>v."));
  t.hvOppna("vantar");
  ok("arket Väntar har samma knapp efter sin mening", /brinner\.<\/b>[^<]*<button class="hv-lank" data-hvater[^>]*>Talen från 08\.12<\/button>/.test(t.hvHem()));
  t.hvStang(); t.S.hv.hamtad = Date.now() - 29 * 60e3; h = t.hvHem();
  ok("29 minuter: veckan som i skissen", h.includes("<small>v.") && !h.includes("Talen från"));

  // Lyssnaren: synlig igen eller fokus.
  const l = hem({ chef: true }); l.hvHem(); const lo = []; l.ndOmlas = (vy) => { lo.push(vy); return Promise.resolve(true); };
  Object.assign(l, { NDAPP_OMLADDNING_MIN: 20, ndAppLagerOppet: () => false, ndAppOsparat: () => true, navigator: { onLine: true } });
  l.S.hv.hamtad = Date.now() - 25 * 60e3;
  l.S.hv.strom = { tur: { start: 0 } }; l.hvTillbaka(0);
  ok("lyssnaren läser inte om under en ström", lo.length === 0);
  l.S.hv.strom = null; l.S.hv.chatt = [{ lage: { 0: { gor: true } } }]; l.hvTillbaka(0);
  ok("och inte medan ett kort görs", lo.length === 0);
  l.S.hv.chatt = []; l.navigator = { onLine: false }; l.hvTillbaka(0);
  ok("och inte utan nät", lo.length === 0);
  l.navigator = { onLine: true }; l.hvTillbaka(25 * 60e3); await k1Vanta();
  ok("med fokus i skrivrutan och 25 minuter dold körs hvater", lo.length === 1 && lo[0] === "hvater");
  l.hvTillbaka(0);
  ok("högst en gång per tio minuter", lo.length === 1);
  const u = hem({ chef: true }); u.hvHem(); const uo = []; u.ndOmlas = (vy) => { uo.push(vy); return Promise.resolve(true); };
  Object.assign(u, { NDAPP_OMLADDNING_MIN: 20, ndAppLagerOppet: () => false, ndAppOsparat: () => false, navigator: { onLine: true } });
  u.S.hv.hamtad = Date.now() - 25 * 60e3; u.hvTillbaka(25 * 60e3);
  ok("med fokus utanför ett fält och 25 minuter dold körs den inte, eftersom Nav laddar om", uo.length === 0);
  u.hvTillbaka(0);
  ok("och fönstrets fokus strax efter läser inte heller", uo.length === 0);
  u.S.hv.hamtad = Date.now() - 5 * 60e3; u.hvTillbaka(0);
  ok("fem minuter gamla tal läses inte om", uo.length === 0);
  u.S.hv.hamtad = Date.now() - 11 * 60e3; u.S.view = "uppgifter"; u.hvTillbaka(0);
  ok("bara när hemmet syns", uo.length === 0);
  u.S.view = "hem"; u.S.hv.hoppa = 0; u.hvTillbaka(0); await k1Vanta();
  ok("tillbaka efter elva minuter på hemmet: hvater", uo.length === 1 && uo[0] === "hvater");
  ok("hvater har de elva delarna och läser in hem", /ndOmlasAnmal\('hvater', \{delar:\['hem', 'uppgifter', 'moten', 'kalender', 'order', 'tid', 'franvaro', 'arenden', 'rutiner', 'utbildning', 'notiser'\], laser:\['hem'\]\}\);/.test(block));
  ok("hv har kvar sina fyra delar", block.includes("ndOmlasAnmal('hv', {delar:['hem', 'uppgifter', 'moten', 'kalender']});"));
  ok("en tyst läsning som faller laddar inte om sidan (ndOmlasKor)", /if \(!s\.ok \|\| !s\.data \|\| !s\.data\.data\)\{ if \(ndOmlasTyst\(ko\)\) return false; ndOmlasReserv\(ko\); return false; \}/.test(html));
  ok("Lyssna läser samma mening som arket", block.includes("DELTA[S.role === 'chef' ? 'chef' : 'saljare'][S.mode] = sedan;"));
}

rubrik("Funktionsvarvet K3, funktion 2: mötet bakom märket");
{
  const KUND = (x = {}) => ({ s: 900, e: 945, t: "Möte: Bäckström Revision AB", id: "k9", kund: { bolag: "Bäckström Revision AB", mote: "m1" }, ...x });
  const mk = ({ nu = 960, kal = [KUND()], kort = [{ kedja: "c1", fas: "hos_saljaren", mote: { id: "m1", hallsAv: "jag", langd: 45 } }], moten = true, chatt = false } = {}) => {
    const g = hem({ chef: true, nu, kal, dag: { start: 480, slut: 1020, rast: 0 } });
    g.ND.moten.kort = kort; g.ND.hem.chatt = chatt;
    if (!moten) g.ndKopplad = (vy) => vy !== "moten";
    g.moUtfall = (k) => k.fas === "hos_saljaren";
    g.toasts = []; g.toast = (m) => g.toasts.push(m);
    g.moGa = () => { g.S.view = "moten"; }; g.ndMoDialog = (typ, k) => { g.S.moDlg = { typ, kedja: k.kedja }; };
    return g;
  };
  let g = mk(), h = g.hvHem(), u = urtavlan(h);
  ok("ett passerat kopplat möte utan utfall bleknar inte (inte forbi)", /<path class="m r-mote" data-m="k9"/.test(u), u.slice(0, 300));
  ok("märket bär kedjan, bolaget och Utfall saknas · Registrera i Möten", /<button class="hv-pin" [^>]*data-m="k9" data-hvark="dag" data-hvutfall="c1" aria-label="15\.00–15\.45 · Bäckström Revision AB\. Utfall saknas · Registrera i Möten">/.test(u));
  ok("mitten blir knappen till utfallet, med skissens l, k och v", /<button class="hv-mitt" data-hvutfall="c1" data-hvark="dag" aria-label="Utfall saknas: Bäckström Revision AB\. Registrera i Möten"><span class="l">Inga fler möten<\/span><span class="k num"[^>]*>17\.00<\/span><span class="v">Arbetsdagen slutar<\/span><span class="s"[^>]*>Utfall saknas: Bäckström Revision AB<\/span><\/button>/.test(u));
  k2Klick(g, { hvutfall: "c1", hvark: "dag" });
  ok("klicket öppnar Möten med Mötens utfallsruta för rätt kedja", g.S.view === "moten" && g.S.moDlg.typ === "utfall" && g.S.moDlg.kedja === "c1");

  g = mk({ kort: [{ kedja: "c1", fas: "avgjort", mote: { id: "m1", hallsAv: "jag" } }] }); u = urtavlan(g.hvHem());
  ok("med fas avgjort är bågen forbi, och mitten är skissens", /<path class="m r-mote forbi" data-m="k9"/.test(u) && !/class="hv-mitt" data-hvutfall/.test(u));
  g = mk({ kal: [{ s: 600, e: 630, t: "Veckomöte", id: "k1" }, KUND()] }); u = urtavlan(g.hvHem());
  ok("ett internt möte är oförändrat", /<path class="m r-mote forbi" data-m="k1"/.test(u) && !/data-m="k1" data-hvark="dag" data-hvutfall/.test(u));
  g = mk({ kort: [{ kedja: "c1", fas: "hos_saljaren", mote: { id: "m1", hallsAv: "p1" } }] }); u = urtavlan(g.hvHem());
  ok("en kollegas möte kopplas inte: bara egna", !u.includes("data-hvutfall") && /r-mote forbi" data-m="k9"/.test(u));
  g = mk({ moten: false }); u = urtavlan(g.hvHem());
  ok("Möten avstängt: urtavlan är skissens", !u.includes("data-hvutfall") && u.includes("15.00–15.45 · Möte: Bäckström Revision AB"));
  g = mk({ kal: [{ ...KUND(), kund: { bolag: "Bäckström Revision AB", mote: null } }] });
  ok("kund.mote null (inte med på posten): som i dag", !g.hvHem().includes("data-hvutfall"));

  // Före mötets slut öppnar märket Min dag. Samma märke efter slutet, utan ny ritning, öppnar utfallet.
  g = mk({ nu: 920, kort: [{ kedja: "c1", fas: "bokat", mote: { id: "m1", hallsAv: "jag" } }] }); u = urtavlan(g.hvHem());
  ok("före slutet bär märket kedjan men säger Pågår", /data-hvutfall="c1" aria-label="15\.00–15\.45 · Bäckström Revision AB\. Pågår · Öppna Min dag"/.test(u));
  k2Klick(g, { hvutfall: "c1", hvark: "dag" });
  ok("klick före slutet öppnar Min dag", g.S.view === "hem" && g.S.hv.ark === "dag");
  g.hvStang(); g.ND.moten.kort[0].fas = "hos_saljaren";
  k2Klick(g, { hvutfall: "c1", hvark: "dag" });
  ok("samma märke efter slutet, utan ny ritning, öppnar utfallet", g.S.view === "moten" && g.S.moDlg.typ === "utfall");

  g = mk({ kal: [KUND(), { s: 950, e: 1000, t: "Intern genomgång", id: "k2" }] }); h = g.hvHem();
  ok("mittens prioritet: ett pågående möte går före utfallet", urtavlan(h).includes('<span class="l">Pågår till</span>') && !/class="hv-mitt" data-hvutfall/.test(h));
  g = mk({ kal: [KUND({ s: 700, e: 730, id: "k7", kund: { bolag: "Hagby Glas", mote: "m3" } }), KUND({ s: 800, e: 830, id: "k8", kund: { bolag: "Mälarö Frakt", mote: "m2" } }), KUND()],
    kort: [{ kedja: "c3", fas: "avgjort", mote: { id: "m3", hallsAv: "jag" } }, { kedja: "c2", fas: "hos_saljaren", mote: { id: "m2", hallsAv: "jag" } }, { kedja: "c1", fas: "hos_saljaren", mote: { id: "m1", hallsAv: "jag" } }] });
  u = urtavlan(g.hvHem());
  ok("flera saknar utfall: 2 av 3 möten saknar utfall, och knappen öppnar det första", u.includes(">2 av 3 möten saknar utfall</span>") && /class="hv-mitt" data-hvutfall="c2"/.test(u));
  g = mk();
  ok("den lilla urtavlan har ingen ny knapp", !g.hvUrtavla(g.hvD(), { storlek: "kompakt" }).includes("data-hvutfall") && !g.hvUrtavla(g.hvD(), { storlek: "mini", dag: "idag" }).includes("data-hvutfall"));
  g.hvOppna("dag"); h = g.hvHem();
  ok("Min dag: raden får knappen Utfall och bleknar inte", h.includes('<button class="hv-btn" data-hvutfall="c1" aria-label="Utfall för Bäckström Revision AB: registrera i Möten">Utfall</button>') && /<div class="hv-drad mote an"[^>]*data-m="k9"/.test(h));
  g.ND.moten.kort[0].fas = "avgjort"; k2Klick(g, { hvutfall: "c1" });
  ok("Utfall när utfallet hunnit sparas: säger det, och Möten öppnas inte", g.S.view === "hem" && g.toasts.includes("Utfallet är redan sparat i Möten."));
  g = mk({ nu: 1290 });
  ok("kvällen: urtavlan visar i morgon och har inget märke för utfallet", g.hvVisadDag(g.hvD()) === "imorgon" && !urtavlan(g.hvHem()).includes("data-hvutfall"));
  g.hvOppna("dag");
  ok("men raden i Min dag har kvar Utfall", g.hvHem().includes('data-hvutfall="c1"'));

  // Lägesmeningen och chipet använder serverns bolag.
  g = mk({ nu: 840, chatt: true }); h = g.hvHem();
  ok("lägesmeningen: nästa 15.00 med bolaget, inte med Möte:", h.includes(">nästa 15.00 med Bäckström Revision AB.</button>") && !h.includes("med Möte:"));
  ok("chipet: Förbered 15.00 med bolaget, och frågan om samma möte", h.includes('data-hvforbered="Förbered mitt möte 15.00 med Bäckström Revision AB"') && h.includes('title="Bäckström Revision AB">') && h.includes("Förbered 15.00 med Bäckström</button>"));
  g = mk({ nu: 700, chatt: true, kal: [{ s: 780, e: 810, t: "1:1 med Fredrik", id: "k5" }] }); h = g.hvHem();
  ok("utan bolag: hela rubriken efter en punkt, och inget med framför", h.includes("Förbered 13.00 · 1:1 med Fredrik</button>") && !h.includes("Förbered 13.00 med 1:1"));
  g = mk({ nu: 700, chatt: true, kal: [{ s: 780, e: 810, t: "Genomgång av offerten för Hagby Glas och Mälarö Frakt", id: "k5" }] }); h = g.hvHem();
  ok("en lång rubrik kapas vid ett ord med …, och står hel i title", h.includes('title="Genomgång av offerten för Hagby Glas och Mälarö Frakt"') && h.includes("Förbered 13.00 · Genomgång av…</button>"));
}

rubrik("Funktionsvarvet K3: Klar går att ångra, också med riktig data");
{
  const RADER = [{ id: "upg-7", nar: "idag", heat: 2, bkind: "uppgift", kind: "Uppgift", bt: "{Ring Hagby} i dag.", t: "Ring Hagby", why: "Frist i dag", act: { l: "Klar", done: true, check: true }, gor: () => {} },
    { id: "sjuk-1", nar: "nu", heat: 5, bkind: "frånvaro", kind: "Sjukanmälan", bt: "{Carl} är sjukanmäld.", t: "Carl är sjukanmäld", why: "Sedan i dag", act: { l: "Bekräfta" }, gor: () => {} }];
  const mk = (svar, task = {}) => {
    const g = hem({ chef: true, rader: RADER, tasks: [{ id: "7", t: "Ring Hagby", lage: "oppen", ndNytt: [], ...task }] }); g.hvHem();
    const x = { g, upg: [], toasts: [], fel: [], oml: [], klar: [] };
    Object.assign(g, { ndUpgNav: () => true, ndUpgPost: async (hl, d, o) => { x.upg.push([hl, d, o]); return svar[hl]; }, toastActs: (m, acts) => x.toasts.push([m, acts]), toast: (m) => x.toasts.push([m, []]),
      ndSkrivFel: (s) => x.fel.push(s), ndOmlas: (vy) => { x.oml.push(vy); return Promise.resolve(true); }, complete: (id) => x.klar.push(id) });
    return x;
  };
  const a = mk({ bocka: { ok: "Klar." }, ateroppna: { ok: "Öppnad igen." } });
  k2Klick(a.g, { hvgor: "upg-7" }); await k1Vanta();
  ok("Klar på en uppgift skickar bocka med uppgiftens id", a.upg.length === 1 && a.upg[0][0] === "bocka" && a.upg[0][1].id === "7" && a.upg[0][2].tyst === true, JSON.stringify(a.upg));
  ok("och ger skissens bock med Ångra", a.toasts.length === 1 && a.toasts[0][0] === "Klar: Ring Hagby" && a.toasts[0][1].length === 1 && a.toasts[0][1][0][0] === "Ångra");
  a.toasts[0][1][0][1](); await k1Vanta();
  ok("Ångra skickar ateroppna med radens id", a.upg[1] && a.upg[1][0] === "ateroppna" && a.upg[1][1].id === "7");
  ok("och säger serverns svar och läser om hemmet", a.toasts.some((t) => t[0] === "Öppnad igen.") && a.oml.includes("hv"));
  const b = mk({ bocka: { ok: "Klar." }, ateroppna: { fel: "Uppgiften går inte att öppna igen." } });
  k2Klick(b.g, { hvgor: "upg-7" }); await k1Vanta(); b.toasts[0][1][0][1](); await k1Vanta();
  ok("ett fel från servern säger vad som hände, och hemmet läses inte om (raden står kvar som klar)", b.fel.length === 1 && b.fel[0].fel === "Uppgiften går inte att öppna igen." && !b.oml.includes("hv"));
  const c = mk({ bocka: { ok: "Klar." } });
  k2Klick(c.g, { hvgor: "sjuk-1" }); await k1Vanta();
  ok("en rad utan väg tillbaka (sjukanmälan) går sin väg som förut, utan Ångra", c.klar.includes("sjuk-1") && c.upg.length === 0 && c.toasts.length === 0);
  const d = mk({ bocka: { ok: "Inlämnad för godkännande." } });
  k2Klick(d.g, { hvgor: "upg-7" }); await k1Vanta();
  ok("Inlämnad för godkännande får ingen Ångra", d.toasts.length === 1 && d.toasts[0][0] === "Inlämnad för godkännande." && d.toasts[0][1].length === 0);
  const e = mk({ bocka: { ok: "Klar." } }, { ae: "x1" });
  k2Klick(e.g, { hvgor: "upg-7" }); await k1Vanta();
  ok("en punkt i personallistan (ae) går sin egen väg", e.klar.includes("upg-7") && e.upg.length === 0);
  const f = mk({ bocka: { fel: "Uppgiften finns inte längre." } });
  k2Klick(f.g, { hvgor: "upg-7" }); await k1Vanta();
  ok("ett fel på Klar säger serverns text och ger ingen Ångra", f.fel.length === 1 && f.toasts.length === 0);
}

rubrik("Funktionsvarvet K3: en väg tillbaka för dolda rader, och Stämmer inte om en rad");
{
  const g = hem({ chef: true }); g.hvHem(); g.hvOppna("vantar");
  let h = g.hvHem();
  ok("utan markerad rad är hela listan skissens: inga nya knappar", !h.includes("data-hvflagga") && !h.includes("data-hvdolj") && !h.includes("data-hvvisa"));
  g.S.selRad = "r2"; h = g.hvHem();
  const rad = h.match(/data-id="r2">[\s\S]*?<button class="hv-btn" data-hvgor="r2"/)?.[0] ?? "";
  ok("den markerade raden får Stämmer inte och Visa inte på hemmet, före sin vanliga knapp", rad.includes('<span class="hv-atg"><button class="hv-atgk" data-hvflagga="r2" aria-label="Stämmer inte: Ring tillbaka Mälarö Frakt">Stämmer inte</button><button class="hv-atgk" data-hvdolj="uppgift" aria-label="Visa inte uppgifter på hemmet">Visa inte på hemmet</button></span>'), rad.slice(0, 600));
  ok("bara den raden", (h.match(/data-hvflagga=/g) || []).length === 1);
  k2Klick(g, { hvflagga: "r2" }); await k1Vanta();
  ok("Stämmer inte skickar raden till hemmets rutt", g.anrop.some((x) => x[0] === "flagga" && x[1].rad === "r2"));
  h = g.hvHem();
  ok("och raden säger att den är markerad, utan en knapp som lovar en väg tillbaka", h.includes('<span class="hv-mono">Markerad som fel</span>') && !h.includes('data-hvflagga="r2"'));
  ok("kvittot står i arkets fot", h.includes("Markerad som fel. Raden blir underlag för att rätta sammanfattningen."));
  k2Klick(g, { hvdolj: "uppgift" }); await k1Vanta();
  ok("Visa inte på hemmet döljer sorten", g.anrop.some((x) => x[0] === "dolj" && x[1].sort === "uppgift") && g.S.hiddenKinds.has("uppgift"));
  h = g.hvHem();
  ok("en dold sort får Visa på hemmet", h.includes('<button class="hv-atgk" data-hvvisa="uppgift" aria-label="Visa uppgifter på hemmet igen">Visa på hemmet</button>'));
  k2Klick(g, { hvvisa: "uppgift" }); await k1Vanta();
  ok("Visa på hemmet visar sorten igen", g.anrop.some((x) => x[0] === "visa" && x[1].sort === "uppgift") && !g.S.hiddenKinds.has("uppgift"));
  g.S.selRad = "r4"; h = g.hvHem();
  ok("en rad vars sort inte går att dölja får bara Stämmer inte", h.includes('data-hvflagga="r4"') && !h.includes('data-hvdolj="möten"'));
  const tom = hem({ chef: true }); tom.hvHem(); tom.S.hiddenKinds.add("order"); tom.hvOppna("vantar");
  ok("en dold sort utan rader just nu har ändå en väg tillbaka i arkets fot", tom.hvHem().includes('<button class="hv-lank" data-hvvisa="order">Visa order på hemmet igen</button>'));
  ok("och utan dolda sorter står ingen sådan knapp", !hem({ chef: true }).hvArkVantar().includes("data-hvvisa"));
  ok("J och K ritar om hela listan, så att den markerade raden får sina handlingar", /S\.selRad = rows\[sel\]\.dataset\.id;[\s\S]{0,260}if \(rows\[sel\]\.classList\.contains\('hv-sak'\)\)\{ render\(\); const ny = document\.querySelector\('\.hv-sak\.sel'\); if \(ny\) ny\.scrollIntoView\(\{block:'nearest'\}\); \}/.test(html));
  g.hvKlick({ target: { closest: (sel) => (sel.includes(".hv-sak[data-id]") ? { dataset: { id: "r1" } } : null) }, preventDefault() {}, stopPropagation() {} });
  ok("ett klick på en rad i listan markerar den", g.S.selRad === "r1" && g.hvHem().includes('data-hvflagga="r1"'));
}

rubrik("Funktionsvarvet K4, funktion 4: skrivrutan hittar i hela Nav");
{
  // Paletten (ndPalSok, NDPAL.sok och palInnehall) står utanför hv-blocket: provet fyller NDPAL.sok som servern hade gjort.
  const NAV = [
    { l: "Ny uppgift: kalix", p: "Ny uppgift", run: () => {} },
    { i: "mote", l: "Kalix Bygg", p: "Möte · Bokat", run: () => {} },
    { i: "kal", l: "Kalix Bygg", p: "17 nov 09.00", run: () => {} },
    { l: "Kalix Bygg · #1042", p: "Signerad", run: () => {} },
    { l: "Ring Kalix om avtalet", p: "Uppgift", run: () => {} },
    { l: "Kalix Rör", p: "Möte · Ny", run: () => {} },
    { l: "Kalixkunder", p: "Rutin", run: () => {} },
    { l: "Kalix Fönster", p: "Möte · Bokat", run: () => {} },
  ];
  const mk = (o = {}) => {
    const g = hem({ chef: true, kalImorgon: [{ s: 540, e: 570, t: "Kalix Bygg", id: "k9" }], ...o });
    const sok = new Map(), sokt = [], korda = [];
    g.norm = (t) => String(t).toLowerCase();
    g.NDPAL = { sok };
    g.ndPalSok = (nq, q) => { sokt.push([nq, q]); };
    g.palInnehall = (nq) => (sok.get(nq) || []).map((x) => ({ ...x, run: () => korda.push(x.l) }));
    const plats = { innerHTML: "" };
    g.document = { ...g.document, getElementById: (id) => (id === "hvTraffPlats" ? plats : null) };
    g.ND.hem.chatt = true; g.hvHem(); g.S.hv.q = "Kalix";
    return { g, sok, sokt, korda, plats };
  };
  const { g, sok, sokt, korda, plats } = mk();
  let L = g.hvTraffar();
  ok("från två tecken frågas paletten med rutans råa text", sokt.length === 1 && sokt[0][0] === "kalix" && sokt[0][1] === "Kalix", JSON.stringify(sokt));
  ok("innan svaret: AI-raden och hemmets träffar, ingen laddningsrad och inget I Nav", L[0].sort === "ai" && L.every((x) => x.sort !== "nav") && !/Laddar|Söker|Hämtar/.test(g.hvTraffVy()) && !g.hvTraffVy().includes("I Nav"));
  sok.set("kalix", NAV);
  const forut = sokt.length; g.hvTraffar(); g.hvTraffVy();
  ok("med svaret i NDPAL.sok frågas paletten inte igen", sokt.length === forut);
  g.ndPalOmrita("kalix");
  ok("när svaret kommer ritas skrivrutans träffar om", plats.innerHTML.includes("<p class=\"hv-mono\">I Nav</p>"), plats.innerHTML.slice(0, 300));
  L = g.hvTraffar();
  ok("I Nav står efter I hemmet, med högst 6 rader och AI-raden först", L.length === 6 && L[0].sort === "ai" && L[1].sort === "mote" && L.slice(2).every((x) => x.sort === "nav"), JSON.stringify(L.map((x) => x.sort + ":" + x.t)));
  ok("kortet i Möten står under I Nav fast hemmet har mötet", L.some((x) => x.sort === "nav" && x.t === "Kalix Bygg" && x.mark === "Möte · Bokat"));
  const vy = g.hvTraffVy();
  ok("rubrikerna i ordning, I Nav med skissens markup", vy.indexOf('<p class="hv-mono">I hemmet</p>') > 0 && vy.indexOf('<p class="hv-mono">I Nav</p>') > vy.indexOf('<p class="hv-mono">I hemmet</p>'));
  ok("ingen träff börjar med Ny uppgift", !L.some((x) => /^Ny uppgift/.test(x.t)));
  ok("palettens kalenderpost för samma möte tas bort", !L.some((x) => x.mark === "17 nov 09.00") && L.some((x) => x.t === "Kalix Bygg · #1042"));
  ok("raden visar palettens sort, och texten går genom esc", vy.includes('<span class="hv-mono">Signerad</span>') && vy.includes("Ring <mark>Kalix</mark> om avtalet"));
  g.S.hv.q = "Kalix"; plats.innerHTML = "";
  g.ndPalOmrita("annat");
  ok("ett svar på en äldre fråga ritar inte om", plats.innerHTML === "");
  const iNav = L.findIndex((x) => x.t === "Ring Kalix om avtalet");
  g.S.hv.sel = iNav; g.window = { ...g.window, matchMedia: () => ({ matches: false }) };
  g.hvTangent({ key: "Enter", target: { id: "hvQ", value: "Kalix" }, preventDefault() {}, stopPropagation() {} });
  ok("Enter på en nav-träff kör den och tömmer rutan", korda.length === 1 && korda[0] === "Ring Kalix om avtalet" && g.S.hv.q === "" && g.S.hv.sel === 0, JSON.stringify({ korda, q: g.S.hv.q }));

  const f = mk(); f.sok.set("kalix", []);
  L = f.g.hvTraffar();
  ok("tomt konto eller fel: inga I Nav-rader, AI-raden och hemmets träffar står kvar", L.length === 2 && L[0].sort === "ai" && L[1].sort === "mote" && !f.g.hvTraffVy().includes("I Nav"));
  const k = mk(); k.g.S.hv.q = "K"; k.g.hvTraffar();
  ok("ett tecken frågar inte paletten", k.sokt.length === 0);
  const av = mk(); av.g.ND.hem.chatt = false; av.sok.set("kalix", NAV);
  L = av.g.hvTraffar();
  ok("med chatten av finns ingen AI-rad, och sökrutan står överst", L[0].sort === "sok" && !L.some((x) => x.sort === "ai") && L.some((x) => x.sort === "nav"));
  // Markeringen står kvar: hemmet har högst tre rader, så palettens svar flyttar dem inte.
  const ms = mk({ kal: [{ s: 600, e: 630, t: "Kalix 1", id: "q1" }, { s: 700, e: 730, t: "Kalix 2", id: "q2" }, { s: 800, e: 830, t: "Kalix 3", id: "q3" }, { s: 900, e: 930, t: "Kalix 4", id: "q4" }] });
  const fore = ms.g.hvTraffar(); ms.g.S.hv.sel = 3; const vald = fore[3].t;
  ms.sok.set("kalix", NAV); ms.g.ndPalOmrita("kalix");
  const efter = ms.g.hvTraffar();
  ok("högst tre ur hemmet, och den markerade raden är samma när svaret kommer", fore.filter((x) => x.sort !== "ai" && x.sort !== "nav").length === 3 && efter[3].t === vald && ms.plats.innerHTML.includes('aria-selected="true" data-hvtr="3"'), JSON.stringify({ fore: fore.map((x) => x.t), efter: efter.map((x) => x.t) }));
  const bara = mk({ kalImorgon: [] }); bara.sok.set("kalix", NAV);
  L = bara.g.hvTraffar(); const bv = bara.g.hvTraffVy();
  ok("utan träff i hemmet står I Nav direkt under frågan, utan rubriken I hemmet", L[1].sort === "nav" && !bv.includes("I hemmet") && bv.includes("I Nav"));

  // Paletten ritar fortfarande om #palIn: skalet kör originalet först.
  const p = hem({ chef: true }); const ritat = [];
  p.ndPalOmrita = (nq) => ritat.push(nq);
  kor(block, p, ["hvHem"]);
  p.ndPalOmrita("kalix");
  ok("paletten ritar fortfarande om #palIn när den är öppen (originalet körs)", ritat.length === 1 && ritat[0] === "kalix");
  // Kalendern läses när skrivrutan får fokus.
  const fk = hem({ chef: true }); const lyss = []; let kal = 0;
  fk.document = { ...fk.document, addEventListener: (typ, fn) => lyss.push([typ, fn]) };
  fk.ndPalKal = () => { kal++; };
  kor(block, fk, ["hvHem"]); fk.hvHem();
  for (const [typ, fn] of lyss) if (typ === "focusin") { try { fn({ target: { id: "hvQ" } }); } catch {} }
  ok("ndPalKal körs när #hvQ får fokus", kal === 1, String(kal));
}

rubrik("Funktionsvarvet K4, funktion 5: Navs facit bakom förslagen");
{
  const FACIT_LAG = { per: { "ringer-sjalv": { n: 14, av: 18 } }, text: "När någon har ringt själv har 14 av 18 möten hållits. Låt stå: 9 av 15. Ingen valde: 3 av 6. För få för att skilja från slump.", trodde: "Jag räknade med att 31 av 40 skulle hållas. Det blev 29.", kalla: "Räknat av regler", dataPer: "2026-11-17", vem: "laget", dom: { sort: "for-fa" } };
  const FACIT_DIG = { text: "Dina val: ringt själv 3 av 4 hölls, låt stå 2 av 3, ingen valde 1 av 2. Det här är bara dina möten, så jag säger inte vilket val som fungerar bäst. Siffrorna visar inte att samtalet gjorde skillnaden.", trodde: null, kalla: "Räknat av regler", dataPer: "2026-11-17", vem: "dig" };
  // Dörr 1: källan i huvudet.
  const ett = kort(hem({ chef: false }).hvHem(), "Nav föreslår");
  ok("källan är en knapp till facit med samma text", ett.includes('<button class="hv-mono hv-end" data-hvark="facit" aria-label="Räknat av regler: så har det gått">Räknat av regler</button>'), ett);
  ok("källan i vila ser ut som förut, länkens färg vid hovring och fokus, utan rörelse på färgen (bara transform och opacity rör sig)", !html.includes(".hv-sekh>button.hv-mono{transition") && !/\.hv-kfalt\{[^}]*transition/.test(html) && html.includes(".hv-sekh>button.hv-mono:hover{color:var(--hv-ink)}") && html.includes(".hv-sekh>button.hv-mono:focus-visible{color:var(--hv-ink)}"));
  // Dörr 2: tomraden, bara med dömda förslag.
  const tom = kort(hem({ chef: true, forslag: 0 }).hvHem(), "Nav föreslår");
  ok("tomraden är en knapp till facit när det finns dömda förslag", tom.startsWith('<button class="hv-andr an" style="--i:4" data-hvark="facit"') && tom.includes("Inga förslag just nu."), tom);
  const dag1 = kort(hem({ chef: true, forslag: 0, andrat: [] }).hvHem(), "Nav föreslår");
  ok("dag ett, utan dömda: ingen dörr", dag1.startsWith('<div class="hv-andr') && !dag1.includes("data-hvark"));
  const odomd = kort(hem({ chef: true, forslag: 0, andrat: [{ ...ANDRAT[0], stangd: false }, { ...ANDRAT[0], id: "a2", sort: "andring", stangd: true }] }).hvHem(), "Nav föreslår");
  ok("ett ej dömt förslag eller en dömd ändring öppnar ingen dörr", !odomd.includes("data-hvark"));
  const fel = hem({ chef: true, forslag: 0 }); fel.ND.hem.lasfel = { forslag: true }; fel.ND.hem.forslag = null;
  ok("med lasfel.forslag står felraden, ingen dörr", !kort(fel.hvHem(), "Nav föreslår").includes('data-hvark="facit"'));

  // Inlägget: hämtas, laddar, svar och fel.
  const mk = (chef, svar) => {
    const g = hem({ chef }); g.hvHem(); const hamtat = []; let losa;
    g.ndLas = (url) => { hamtat.push(url); return new Promise((k) => { losa = k; }); };
    g.hvOppna("facit");
    return { g, hamtat, svara: (s) => losa(s) };
  };
  const L = mk(true);
  ok("dörren öppnar ett inlägg i tråden och hämtar las=facit", L.hamtat.length === 1 && L.hamtat[0] === "/nav2/forslag?las=facit" && L.g.S.hv.trad.some((t) => t.sort === "facit"));
  ok("medan det hämtas: Hämtar facit…", L.g.hvArkFacit().includes('<p class="hv-tank" role="status">Hämtar facit…</p>'));
  L.svara({ ok: true, data: { facit: FACIT_LAG } }); await k1Vanta();
  let a = L.g.hvArkFacit();
  ok("ledaren: serverns mening, och vad Nav räknade med", a.includes(`<p>${esc(FACIT_LAG.text)}</p>`) && a.includes("<p>Jag räknade med att 31 av 40 skulle hållas. Det blev 29.</p>"));
  ok("källraden med data per", /<p class="hv-kalla">Räknat av regler · data per 17 nov<\/p>/.test(a), a.match(/hv-kalla">[^<]*/)?.[0]);
  ok("de dömda förslagen står under, med Hela översynen", a.includes("<b>Hagby Glas: du valde att låta mötet stå. Mötet hölls. Mötet blev aldrig bekräftat.</b>") && a.includes('<button class="hv-lank" data-hvark="andrat">Hela översynen'));
  const fem = mk(true); fem.g.ND.hem.forslag.andrat = Array.from({ length: 8 }, (_x, i) => ({ ...ANDRAT[0], id: "a" + i, text: "Rad " + i }));
  fem.svara({ ok: true, data: { facit: FACIT_LAG } }); await k1Vanta();
  ok("högst de fem senaste", (fem.g.hvArkFacit().match(/<b>Rad \d<\/b>/g) || []).length === 5);
  ok("i tråden ritas inlägget genom HVINL", L.g.hvHem().includes('data-hvinl="facit"') && L.g.hvHem().includes("Jag räknade med att 31 av 40"));
  const u20 = mk(true); u20.svara({ ok: true, data: { facit: { ...FACIT_LAG, trodde: null } } }); await k1Vanta();
  ok("under 20 avgjorda möten: ingen rad om vad Nav räknade med", !u20.g.hvArkFacit().includes("räknade med"));
  const S0 = mk(false); S0.svara({ ok: true, data: { facit: FACIT_DIG } }); await k1Vanta();
  a = S0.g.hvArkFacit();
  ok("säljaren: bara sina egna val i antal, utan dom, utan lagets rader och utan översynen", a.includes(`<p>${esc(FACIT_DIG.text)}</p>`) && !/slump|räknade med/.test(a) && !a.includes("hv-lista") && !a.includes("Hela översynen"));
  const tomt = mk(false); tomt.svara({ ok: true, data: { facit: { ...FACIT_DIG, text: "Inget facit än. Det kommer när de första mötena har fått ett utfall." } } }); await k1Vanta();
  ok("förslag men inget dömt: Inget facit än", tomt.g.hvArkFacit().includes("<p>Inget facit än. Det kommer när de första mötena har fått ett utfall.</p>"));
  const ff = mk(true); const fore = ff.g.hvHem().replace(/<div class="hv-trad"[\s\S]*$/, "");
  ff.svara({ ok: true, data: { fel: "Det gick inte att läsa just nu. Försök igen. Felkod 7611b.", felkod: "7611b" } }); await k1Vanta();
  a = ff.g.hvArkFacit();
  ok("fel: serverns text med Försök igen", a.includes('<p role="alert">Det gick inte att läsa just nu. Försök igen. Felkod 7611b.</p>') && a.includes("data-hvigen>Försök igen</button>"));
  ok("och hemmet är orört", ff.g.hvHem().replace(/<div class="hv-trad"[\s\S]*$/, "") === fore);
  ff.g.ndLas = async (url) => { ff.hamtat.push(url); return { ok: true, data: { facit: FACIT_LAG } }; };
  k2Klick(ff.g, { hvigen: "" }); await k1Vanta();
  ok("Försök igen hämtar facit på nytt", ff.hamtat.length === 2 && ff.hamtat[1] === "/nav2/forslag?las=facit" && ff.g.hvArkFacit().includes("Jag räknade med"));

  // Förslagets inlägg: ledarens rad före valet, dörr 3 efter valet.
  const fs = (forslag) => { const g = hem({ chef: true }); g.hvHem(); Object.assign(g.S.hv, { ark: "forslag", id: "f0", data: { forslag: { id: "f0", forslag: { ...FORSLAG(1)[0], mitt: true, valt: null, domsDag: "på onsdag", dom: null, kommentar: null, ...forslag } } } }); return g.hvArkForslag(); };
  const KORT = "Ringt själv 14 av 18 hölls, låt stå 9 av 15, ingen valde 3 av 6. För få för att säga något, tidigast vid runt 110 möten.";
  let h = fs({ lage: "oppet", facitKort: KORT });
  ok("ledaren: raden står före valknapparna", h.includes(`<p class="hv-tank">${esc(KORT)}</p>`) && h.indexOf(esc(KORT)) < h.indexOf("data-hvval"), h.slice(0, 600));
  ok("och källraden säger vilken dag talen gäller", fs({ lage: "oppet", facitKort: KORT, dataPer: "2026-11-17" }).includes('<p class="hv-kalla">Räknat av regler · data per 17 nov</p>'));
  ok("utan ledarens rad står skissens källrad", fs({ lage: "oppet", facitKort: null, dataPer: "2026-11-17" }).includes('<p class="hv-kalla">Räknat av regler</p>'));
  h = fs({ lage: "oppet", facitKort: null });
  ok("säljaren (facitKort null) får ingen rad", !h.includes("tidigast vid runt"));
  h = fs({ lage: "valt", valt: "lat-sta", facitKort: KORT });
  ok("efter valet: ingen ledarrad, och Så har det gått efter meningen om valet", !h.includes(esc(KORT)) && /Valet är gjort: [^<]*\. Jag säger hur det gick på onsdag\. <button class="hv-lank" data-hvark="facit">Så har det gått<\/button><\/p>/.test(h), h.match(/Valet är gjort[^]*?<\/p>/)?.[0]);
  ok("ett öppet förslag har ingen Så har det gått", !fs({ lage: "oppet" }).includes("Så har det gått"));
}

rubrik("Funktionsvarvet, granskningens fynd: chattens fel, utkastet som blev kvar, utfallens ordning och skärmläsaren");
{
  // N4: tillfalligt i strömmen visar både Försök igen och Sök i stället.
  const tf = k1Chatt(); tf.g.S.hv.q = "Vad väntar?"; const tp = tf.g.hvFraga(); await k1Vanta();
  tf.strommar[0].st.ge({ h: "fel", text: "Chatten är tillfälligt upptagen. Försök igen om en stund.", kod: "tillfalligt" }); tf.strommar[0].st.slut(); await tp; await k1Vanta();
  const tfh = tf.g.hvHem();
  ok("tillfalligt i strömmen: både Försök igen och Sök i stället (N4)", tfh.includes('data-hvchattigen="0"') && tfh.includes('data-hvchattsok="0"'), tfh.slice(tfh.indexOf("hv-fel"), tfh.indexOf("hv-fel") + 300));
  // Brottet: utkastet tonas, talet öppnar sin källa ur utkastets tal, ett tal utan rad är obelagt.
  const UT = { h: "text", text: "Du har ⟦t1:3⟧ saker och ⟦t2:7⟧ möten.", tal: [{ id: "t1", varde: 3, om: "Väntar på dig · data per 2026-11-17" }] };
  const br = k1Chatt(); br.g.S.hv.q = "Vad väntar?"; const bp = br.g.hvFraga(); await k1Vanta();
  br.strommar[0].st.ge({ h: "rad", id: K1RAD }); br.strommar[0].st.ge(UT); await k1Vanta();
  ok("medan svaret skrivs är utkastets tal inte knappar (kontroll)", !br.g.hvHem().includes("data-hvtal="));
  br.strommar[0].st.slut(); await bp; await k1Vanta();
  let bh = br.g.hvHem();
  ok("strömmen bröts: utkastet står nedtonat och läsbart, talet med källa är en knapp, talet utan är obelagt", bh.includes('<div class="hv-svar hv-tonad"><p>Du har <button class="hv-siffra num" data-hvtal="0:t1"') && bh.includes('<mark class="hv-obel"') && bh.includes("Svaret bröts här.") && !bh.includes('<span class="num">'), bh.slice(bh.indexOf("hv-svar") - 12, bh.indexOf("hv-svar") + 400));
  br.g.hvKlick({ target: { closest: () => ({ dataset: { hvtal: "0:t1" } }) }, preventDefault() {}, stopPropagation() {} });
  bh = br.g.hvHem();
  ok("och klicket på talet visar källan ur utkastets tal", bh.includes("Väntar på dig · data per 2026-11-17"), bh.slice(bh.indexOf("hv-talk") - 20, bh.indexOf("hv-talk") + 200));
  // Stopp mitt i ett utkast: samma sak.
  const sp = k1Chatt(); sp.g.S.hv.q = "Vad väntar?"; const spp = sp.g.hvFraga(); await k1Vanta();
  sp.strommar[0].st.ge({ h: "rad", id: K1RAD }); sp.strommar[0].st.ge(UT); await k1Vanta();
  sp.g.hvChattStopp(); await spp.catch(() => null); await k1Vanta();
  const sph = sp.g.hvHem();
  ok("Stopp mitt i ett utkast: utkastet tonas, talen har källa eller märks obelagda, och Du stoppade svaret står", sph.includes('<div class="hv-svar hv-tonad"><p>Du har <button class="hv-siffra num" data-hvtal="0:t1"') && sph.includes('<mark class="hv-obel"') && sph.includes("Du stoppade svaret.") && !sph.includes('<span class="num">'), sph.slice(sph.indexOf("hv-svar") - 12, sph.indexOf("hv-svar") + 400));
  // Skärmläsaren: samma text två gånger i rad sägs två gånger.
  const sr = k1Chatt();
  for (const q of ["Fråga ett", "Fråga två"]){ sr.g.S.hv.q = q; const p = sr.g.hvFraga(); await k1Vanta(); const st = sr.strommar[sr.strommar.length - 1].st; st.ge({ h: "rad", id: K1RAD }); st.ge(K1SV); st.slut(); await p; await k1Vanta(); }
  await k1Vanta(150);
  ok("två svar utan hamtar i rad: Svar klart. sägs båda gångerna (noden töms och fylls igen)", sr.sagt.filter((x) => x === "Svar klart.").length === 2 && sr.sagt.includes(""), JSON.stringify(sr.sagt));
  // Kopiera: sägs i skärmläsarnoden, och ett andra klick nollställer inte för tidigt.
  const kp = k1Chatt(); kp.g.S.hv.q = "Vad väntar?"; const kpp = kp.g.hvFraga(); await k1Vanta();
  kp.strommar[0].st.ge({ h: "rad", id: K1RAD }); kp.strommar[0].st.ge(K1SV); kp.strommar[0].st.slut(); await kpp; await k1Vanta();
  kp.g.navigator = { clipboard: { writeText: async () => {} } };
  ok("Kopiera-knappen bär ingen aria-live (kontroll)", !kp.g.hvHem().includes('data-hvchattkop="0" aria-live'));
  await kp.g.hvKopiera(0); await k1Vanta(1000); await kp.g.hvKopiera(0); await k1Vanta(700);
  ok("Kopiera: Kopierat. sägs av skärmläsarnoden, och ett andra klick får sina egna 1,5 s", kp.sagt.includes("Kopierat.") && kp.g.S.hv.chatt[0].kopierat === true, JSON.stringify([kp.sagt, kp.g.S.hv.chatt[0].kopierat]));
}
{
  // Utfallen för ett kort går i följd: delvis (som får 503 och prövas igen) kommer fram före godkänt.
  const KU = { rubrik: "Lägg upp en uppgift", anrop: 2, verktyg: "forbered_uppgifter", rader: [{ text: "Ring Ekdala", dag: "2026-11-17" }], steg: [{ vag: "/nav2/uppgifter", body: { handling: "skapa", titel: "Ring Ekdala", dag: "2026-11-17" } }], input: { uppgifter: [{ titel: "Ring Ekdala", dag: "2026-11-17", till: "jag" }] } };
  const c = k1Chatt(); c.g.S.hv.q = "Lägg upp"; const p = c.g.hvFraga(); await k1Vanta();
  c.strommar[0].st.ge({ h: "rad", id: K1RAD }); c.strommar[0].st.ge({ ...K1SV, kort: [KU] }); c.strommar[0].st.slut(); await p; await k1Vanta();
  const fram = []; let n = 0;
  c.g.ndSkriv = async (_u, d) => { const nr = ++n; if (nr === 1){ await k1Vanta(30); return { ok: false, status: 503, data: null }; } fram.push(JSON.parse(JSON.stringify(d.utfall))); return { ok: true, status: 200, data: { ok: true } }; };
  c.g.hvKortFor(0, 0).l.andrat = ["dag"];
  c.g.hvKortUtfall(0, 0, "delvis"); c.g.hvKortUtfall(0, 0, "godkant");
  await k1Vanta(1200);
  ok("delvis följt av godkänt: delvis prövas om och kommer fram först, godkänt sist, och bara delvis bär andrat", JSON.stringify(fram) === JSON.stringify([{ rad: K1RAD, anrop: 2, lage: "delvis", andrat: ["dag"] }, { rad: K1RAD, anrop: 2, lage: "godkant" }]), JSON.stringify(fram));
}
{
  // En ny fråga väntar på hela den förra strömmen, inte 5 s: annars svarar rutten 429 pagar.
  const c = k1Chatt(); c.g.S.hv.q = "Fråga ett"; const p1 = c.g.hvFraga(); await k1Vanta();
  c.strommar[0].st.ge({ h: "rad", id: K1RAD }); c.strommar[0].st.ge(K1SV); await k1Vanta();
  const riktig = globalThis.setTimeout; globalThis.setTimeout = (f, ms, ...r) => (ms === 5000 ? riktig(f, 0) : riktig(f, ms, ...r));
  c.g.S.hv.q = "Fråga två"; const p2 = c.g.hvFraga(); await k1Vanta(30);
  ok("den förra strömmen hänger kvar: nästa fråga skickas inte förrän den är läst", c.strommar.length === 1, String(c.strommar.length));
  globalThis.setTimeout = riktig;
  c.strommar[0].st.slut(); await p1; await k1Vanta(30);
  ok("och skickas när den förra är läst till slutet", c.strommar.length === 2 && c.strommar[1].b.fraga === "Fråga två", String(c.strommar.length));
  c.strommar[1].st.ge(K1SV); c.strommar[1].st.slut(); await p2;
}
{
  // Rättafältet: det som skrivs sparas i S och står kvar efter en omritning.
  const g = hem({ chef: false }); g.hvHem();
  const lyss = []; g.document = { ...g.document, addEventListener: (typ, f) => lyss.push([typ, f]) };
  const kod2 = html.slice(html.indexOf("document.addEventListener('input', e => { if (e.target && e.target.id === 'hvKortRatta'"));
  const rad1 = kod2.slice(0, kod2.indexOf("\n"));
  new Function("g", "with (g) { " + rad1 + " }")(g);
  g.S.hv.ratta = { i: 0, n: 0, r: 0, falt: "dag", v: "17/11" };
  for (const [typ, f] of lyss) if (typ === "input") f({ target: { id: "hvKortRatta", value: "fre" } });
  ok("det som skrivs i rättafältet sparas i S vid input", g.S.hv.ratta.v === "fre", JSON.stringify(g.S.hv.ratta));
  // Omläsningen: bara tysta läsningar i kön töms tyst; en sparning i kön går den gamla vägen.
  const okod = html.slice(html.indexOf("const NDOMLAS = {}, NDOMLASKO"), html.indexOf("/* ---------- Skrivvägen slut"));
  const om = new Function("g", "const ND = {hem:{}}, S = {}; const render = () => {}; " + okod + "; return { ndOmlasTyst, NDOMLASKO };")({});
  g.ndOmlasTyst = om.ndOmlasTyst;
  ok("tysta läsningar i kön: tyst (sidan laddas inte om)", g.ndOmlasTyst(new Map([["a", { tyst: true }], ["b", { tyst: true }]])) === true);
  ok("en sparning blandad med en tyst: inte tyst, sidan laddas om som förut", g.ndOmlasTyst(new Map([["a", { tyst: true }], ["b", { tyst: false }]])) === false);
}
{
  // Facit: utan serverns kalla ritas ingen källrad.
  const g = hem({ chef: true }); g.hvHem();
  Object.assign(g.S.hv, { ark: "facit", fel: null, data: { facit: { facit: { vem: "jag", text: "Dina val: 3 av 4 hölls." } } } });
  const u = g.hvArkFacit();
  ok("facit utan kalla: ingen källrad, ingen egen reservtext", !u.includes("Räknat av regler") && !u.includes("hv-kalla") && u.includes("Dina val: 3 av 4 hölls."), u);
  g.S.hv.data.facit.facit.kalla = "Räknat av regler"; g.S.hv.data.facit.facit.dataPer = "2026-11-17";
  ok("med kalla står serverns källrad (kontroll)", g.hvArkFacit().includes("Räknat av regler · data per 17 nov"));
}

console.log("\nKontroller per sort:");
for (const [s, t] of Object.entries(tally)) console.log(`  ${s.padEnd(9)} ${String(t.ja + t.nej).padStart(4)}  (${t.ja} går igenom, ${t.nej} faller)`);
if (process.env.PER_RUBRIK) for (const r of perRubrik) console.log(`  ${r.nej ? "✗" : "✓"} ${String(r.ja).padStart(3)}/${String(r.ja + r.nej).padEnd(3)} ${r.t}`);
console.log(fel ? `\n\x1b[31m${fel} prov föll.\x1b[0m` : "\n\x1b[32mAlla prov gick igenom.\x1b[0m");
process.exit(fel ? 1 : 0);
