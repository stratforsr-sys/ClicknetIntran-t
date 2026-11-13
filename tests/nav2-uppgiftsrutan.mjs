#!/usr/bin/env node
/**
 * Uppgiftsrutan i Nav 2.0 (2026-11-13): tolkarna, rutan i alla lägen och det navet får.
 *
 * Förut sparade "Måndag" i dag + 3 dagar (rätt bara en fredag), bara fyra dagar och fem tidsåtgångar gick att
 * välja, granskare gick inte att sätta och en klar uppgift gick inte att öppna igen i rutan.
 *
 * Provet läser två block ur utkastet: utkastets ruta (tolkarna, rutan och handlarna) och navets modulblock
 * UPPGIFTER, och kör dem i sandlådor där resten av utkastet är attrapper. Kör det mot `src/nav2/utkast.html`
 * (eller filen i `UTKAST`).
 *
 *   node tests/nav2-uppgiftsrutan.mjs
 */
import { readFileSync } from "node:fs";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra && !villkor ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const html = readFileSync(process.env.UTKAST ?? new URL("../src/nav2/utkast.html", import.meta.url), "utf8");
const rutan = html.match(/\/\* -{10} Uppgiftsrutan: tolkarna[\s\S]*?(?=\n\/\* -{10} Att göra-listan: en panel)/)?.[0];
const modul = html.match(/\/\* =+\n {3}NAV 2\.0 I RIKTIGT LÄGE: UPPGIFTER[\s\S]*?NDKOPPLAD\.add\('uppgifter'\); \}/)?.[0];
ok("utkastets ruta finns i utkastet", !!rutan);
ok("modulblocket UPPGIFTER finns i utkastet", !!modul);
if (!rutan || !modul) {
  console.log(`\n\x1b[31m${fel} prov föll.\x1b[0m`);
  process.exit(1);
}

const plus = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const dow = (d) => ((new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;
const VD = ["", "mån", "tis", "ons", "tor", "fre", "lör", "sön"], MK = ["", "jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const kort = (s) => `${VD[dow(s)]} ${+s.slice(8)} ${MK[+s.slice(5, 7)]}`;
const inbyggda = new Set(["Object", "Array", "JSON", "Math", "Date", "Set", "Map", "String", "Number", "Boolean", "Promise", "RegExp", "Error", "Symbol", "parseInt", "parseFloat", "isNaN", "encodeURIComponent", "decodeURIComponent", "undefined", "NaN", "Infinity", "console", "setTimeout", "clearTimeout", "CSS"]);
const attrapp = () => new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => "" : attrapp()), apply: () => attrapp() });
// Blockets egna funktioner (deklarationer) läggs i g genom namnen; tilldelningar (navets omslag) hamnar där själva.
function kor(block, g, namn = []) {
  const sandlada = new Proxy(g, {
    has: (_, k) => typeof k === "string" && !inbyggda.has(k),
    get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? t[k] : attrapp()),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  new Function("sandlada", `with (sandlada) {\n${block}\n__ut = {${namn.join(", ")}};\n}`)(sandlada);
  return Object.assign(g, g.__ut);
}

// ---------- Utkastets ruta ----------
function utkastet(idag, tasks = []) {
  const g = {
    ND: null, S: { role: "saljare", panel: null }, TASKS: tasks, ME: { saljare: { namn: "Zen Test" } }, KOLLEGOR: ["Elin Berg", "Kim Lund", "Zen Test"],
    PROJEKT: { saljare: [["Mässan", "var(--info)", 2, 8]] }, role: () => "saljare", kIdag: () => idag, frPlus: plus, frDow: dow, frKort: kort,
    mine: () => g.TASKS, isDone: (t) => t.lage === "klar", minText: (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? " " + (m % 60) + " min" : ""}` : `${m} min`),
    esc: (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"), I: (n) => `<svg data-i="${n}"></svg>`,
    avatar: (n) => `<span class="av">${n}</span>`, note: () => "", hm: (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`, now: () => 600,
    upgOrdning: () => g.TASKS.map((t) => t.id), upgLankMal: () => () => {}, toasts: [], toast: (m, u) => g.toasts.push([m, u]), render: () => {},
    document: { addEventListener: () => {}, getElementById: () => null, querySelector: () => null }, window: { addEventListener: () => {} },
  };
  return kor(rutan, g, ["upgTolkaDag", "upgTolkaTid", "upgTolkaEst", "upgVecka", "upgPopHtml", "upgRutaHtml", "upgSatt"]);
}
const uppg = (o) => ({ id: "t1", vy: "egen", t: "Ring Lindqvist", d: 0, prio: 3, lage: "oppen", delar: [], links: [], chatt: [], skapad: "Du · 13 nov", ...o });

rubrik("Dagen som man skriver den (i dag fredag 13 november 2026)");
{
  const g = utkastet("2026-11-13");
  const fall = [["i dag", "2026-11-13"], ["i morgon", "2026-11-14"], ["imorgon", "2026-11-14"], ["måndag", "2026-11-16"], ["mån", "2026-11-16"], ["nästa vecka", "2026-11-16"],
    ["fredag", "2026-11-20"], ["tor", "2026-11-19"], ["nästa onsdag", "2026-11-18"], ["om 2 veckor", "2026-11-27"], ["om en vecka", "2026-11-20"], ["om 3 dagar", "2026-11-16"],
    ["25/11", "2026-11-25"], ["25.11", "2026-11-25"], ["25 nov", "2026-11-25"], ["25 november", "2026-11-25"], ["fre 20 nov", "2026-11-20"], ["den 20", "2026-11-20"],
    ["1/1", "2027-01-01"], ["12/11", "2027-11-12"], ["20", "2026-11-20"], ["5", "2026-12-05"], ["v 48", "2026-11-23"], ["v. 46", "2026-11-13"], ["vecka 2", "2027-01-11"],
    ["2026-12-24", "2026-12-24"], ["ingen", ""], ["Någon gång", ""], ["", null], ["31/2", undefined], ["2026-01-01", undefined], ["blaj", undefined], ["om 0 dagar", undefined]];
  for (const [q, vant] of fall) { const fatt = g.upgTolkaDag(q, "2026-11-13"); ok(`"${q}" → ${JSON.stringify(vant)}`, fatt === vant, `fick ${JSON.stringify(fatt)}`); }
  ok("veckan för 13 nov 2026 är 46", g.upgVecka("2026-11-13") === 46);
  ok("veckan för 1 jan 2027 är 53", g.upgVecka("2027-01-01") === 53);
}

rubrik("Klockslaget och tidsåtgången");
{
  const g = utkastet("2026-11-13");
  for (const [q, vant] of [["14", "14:00"], ["1430", "14:30"], ["930", "09:30"], ["9.15", "09:15"], ["9:15", "09:15"], ["kl 9", "09:00"], ["klockan 16.30", "16:30"], ["25", undefined], ["14:75", undefined], ["inget", ""], ["", null]])
    { const fatt = g.upgTolkaTid(q); ok(`tid "${q}" → ${JSON.stringify(vant)}`, fatt === vant, `fick ${JSON.stringify(fatt)}`); }
  for (const [q, vant] of [["20", 20], ["20 min", 20], ["45", 45], ["1 h", 60], ["1 h 20", 80], ["1h20min", 80], ["1,5 h", 90], ["1:30", 90], ["2 timmar", 120], ["ingen", 0], ["0", undefined], ["x", undefined], ["", null]])
    { const fatt = g.upgTolkaEst(q); ok(`tidsåtgång "${q}" → ${JSON.stringify(vant)}`, fatt === vant, `fick ${JSON.stringify(fatt)}`); }
}

rubrik("Måndag är nästa måndag, vilken dag det än är (förut i dag + 3)");
for (const idag of ["2026-11-11", "2026-11-13", "2026-11-15", "2026-11-16"]) {
  const g = utkastet(idag, [uppg({ d: 0 })]);
  const h = g.upgPopHtml(g.TASKS[0], "dag");
  const m = h.match(/data-upgsatt="t1\|dag\|(-?\d+)"[^>]*><span class="upg-ol">(Nästa måndag|Måndag)</);
  const vant = (() => { let s = plus(idag, 1); while (dow(s) !== 1) s = plus(s, 1); return s; })();
  // En söndag är I morgon redan måndag, och raden står inte två gånger.
  const morgon = h.match(/data-upgsatt="t1\|dag\|1"[^>]*><span class="upg-ol">I morgon</);
  if (dow(idag) === 7) ok(`${kort(idag)}: I morgon är måndag, ingen dubblett`, !m && !!morgon && plus(idag, 1) === vant);
  else ok(`${kort(idag)}: ${m && m[2]} = ${vant}`, !!m && plus(idag, +m[1]) === vant, m ? plus(idag, +m[1]) : "ingen måndag");
}

rubrik("Rutan ritas i varje läge");
{
  const lagen = {
    "öppen med allt": uppg({ d: 2, nar: "14:00", est: 45, prio: 1, proj: "Mässan", granskare: "Elin Berg", serie: "Varje vecka", nasta: "Hitta numret", besk: "Text", links: [["Kund", "Lindqvist"]], delar: [["Ett", true], ["Två", false]], chatt: [["Elin Berg", "Hej", "11:02"]] }),
    "utan dag": uppg({ d: null }),
    "försenad": uppg({ d: -2 }),
    "klar": uppg({ lage: "klar", klarTid: "14:32" }),
    "inlämnad": uppg({ lage: "granskas", granskare: "Elin Berg" }),
    "hos någon annan": uppg({ vy: "vantar", ansvarig: "Kim Lund" }),
  };
  for (const [namn, t] of Object.entries(lagen)) {
    const g = utkastet("2026-11-13", [t]);
    let h = "";
    try { h = g.upgRutaHtml(t); } catch (e) { h = "FEL " + e.message; }
    ok(`${namn}: ritas`, h.startsWith('<div class="upg-ruta"'), h.slice(0, 120));
    if (namn === "öppen med allt") {
      ok("Börja med syns, med raden som i listan", h.includes(">Börja med<") && h.includes("Börja med: <span data-upgminitext>Hitta numret"));
      ok("granskare: Klar blir Lämna in", h.includes("Lämna in"));
      ok("uppskattningen 45 min syns (förut ingen av knapparna)", h.includes("45 min"));
      ok("brådskande: bocken har färgen", /class="tick[^"]*upg-p1/.test(h));
      ok("aktiviteten har kommentaren och händelserna", h.includes("upg-bub") && h.includes("upg-ev"));
      ok("platsen för Med finns (kollega-grenen)", h.includes("<!--upg-med-->"));
      ok("kopplingen är en bricka", h.includes('class="upg-chip"'));
      for (const k of ["dag", "tid", "est", "prio", "proj", "ansv", "gransk", "mer"]) {
        g.S.upgPop = `t1|${k}`;
        let p = ""; try { p = g.upgRutaHtml(t); } catch (e) { p = "FEL " + e.message; }
        ok(`väljaren ${k} ritas`, p.includes(`data-upgpopfor="t1|${k}"`), p.slice(0, 80));
      }
      g.S.upgPop = null;
    }
    if (namn === "utan dag") ok("utan dag: Ingen deadline", h.includes("Ingen deadline") && h.includes("Ingen dag"));
    if (namn === "försenad") ok("försenad: röd rad", h.includes("Försenad 2 dagar"));
    if (namn === "klar") ok("klar: Öppna igen i foten och i bocken", (h.match(/data-upgsatt="t1\|oppna\|"/g) || []).length === 2);
    if (namn === "inlämnad") ok("inlämnad: ingen Klar, Elin godkänner", !h.includes("data-tick") && h.includes("Elin godkänner"));
    if (namn === "hos någon annan") ok("hos någon annan: Påminn och Ta tillbaka", h.includes("data-nudge") && h.includes("data-reclaim"));
  }
}

rubrik("Utkastets val: kvitto med Ångra");
{
  const g = utkastet("2026-11-13", [uppg({ d: null, est: 30 })]);
  const t = g.TASKS[0];
  g.upgSatt("t1", "tid", "14:30");
  ok("en tid utan dag lägger den i dag", t.d === 0 && t.nar === "14:30", JSON.stringify(t));
  ok("kvittot säger det", g.toasts.at(-1)[0] === "Klockan 14:30, i dag.", g.toasts.at(-1)[0]);
  g.toasts.at(-1)[1]();
  ok("Ångra tar tillbaka", t.d === null && !t.nar);
  g.upgSatt("t1", "est", 50);
  ok("egen tidsåtgång (50 min)", t.est === 50);
}

// ---------- Navet ----------
function navet() {
  const skickat = [], toasts = [];
  const nd = (id, o) => ({ id, vy: "egen", t: "Uppgift " + id, due: null, tid: null, est: null, prio: 3, klarAt: null, links: [], proj: null, delar: [], granskare: null, ansvarig: "Zen Test",
    serie: null, besk: "", skapadAv: "Zen Test", skapadAt: "2026-10-20T08:00:00Z", stilla: false, minRoll: null, handelser: [], lage: "ej_paborjad", farRed: true, farStryk: true, ...o });
  const g = {
    ND: { jag: { id: "mig", namn: "Zen Test" }, uppgifter: {
      uppgifter: [nd("a"), nd("b", { granskare: "Kim Lund" }), nd("c", { lage: "klar", klarAt: "2026-10-23T09:00:00Z" }),
        nd("d", { handelser: [{ typ: "skapad", av: "Zen Test", at: "2026-10-20T08:00:00Z" }, { typ: "kommentar", av: "Elin Berg", note: "Hej", at: "2026-10-23T09:30:00Z" }] })],
      projekt: [{ id: "p1", namn: "Mässan", farg: "info", klara: 1, antal: 3 }], mallar: [], kollegor: ["Elin Berg", "Kim Lund"], klara: [], fokus: [], forstaSteg: {},
      personer: [{ id: "p-elin", namn: "Elin Berg" }, { id: "p-kim", namn: "Kim Lund" }], skriv: true,
    } },
    TASKS: [], PROJEKT: {}, MALLAR: [], KOLLEGOR: [], MOTEN: {}, HIST: {}, KLARA_FORR: {}, S: {}, NDKOPPLAD: new Set(), NDOMLAS: {},
    role: () => "saljare", kIdag: () => "2026-10-23", frKort: (d) => d, frPlus: plus, frDow: dow, ndDagAv: (at) => at.slice(0, 10), ndKl: (at) => at.slice(11, 16),
    ndMandag: (d) => { let x = d; while (dow(x) !== 1) x = plus(x, -1); return x; },
    isDone: (t) => t.lage === "klar", toast: (m) => toasts.push([m]), toastActs: (m, a) => toasts.push([m, a]), render: () => {}, esc: (s) => String(s),
    ndSkriv: async (url, data) => { skickat.push(data); return { ok: true, status: 200, data: { ok: "Sparat." } }; },
    ndSvar: (s) => s.data, ndSkrivFel: () => {}, ndOmlas: () => {},
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, location: { reload: () => {} },
    document: { addEventListener: () => {}, getElementById: () => null, querySelector: () => null },
    upgRutaHtml: () => "", upgAkt: () => [], upgFarStyra: () => true, upgNyttProjekt: () => {}, upgKvitto: (vad) => `kvitto ${vad}`,
    upgSatt: () => { throw new Error("utkastets upgSatt anropades för en uppgift i navet"); },
    stryk: () => {}, lamnaOver: () => {},
  };
  kor(modul, g);
  return { g, skickat, toasts, vanta: () => new Promise((r) => setTimeout(r, 0)) };
}

rubrik("Navet får rätt handling för varje val");
{
  const { g, skickat, toasts, vanta } = navet();
  const sista = () => skickat.at(-1) || {};
  g.upgSatt("a", "dag", 3); await vanta();
  ok("dag: planera med datumet (fre 23 okt + 3 = mån 26 okt)", sista().handling === "planera" && sista().dag === "2026-10-26", JSON.stringify(sista()));
  ok("kvittot har Ångra", toasts.at(-1)?.[1]?.[0]?.[0] === "Ångra", JSON.stringify(toasts.at(-1)));
  g.upgSatt("a", "dag", 40); await vanta();
  ok("vilken dag som helst (40 dagar fram)", sista().dag === plus("2026-10-23", 40), JSON.stringify(sista()));
  g.upgSatt("a", "dag", null); await vanta();
  ok("ingen dag: datum och klockslag bort", sista().dag === null && sista().tid === null, JSON.stringify(sista()));
  g.upgSatt("a", "tid", "14:30"); await vanta();
  ok("tid utan dag: i dag med klockslaget", sista().handling === "planera" && sista().dag === "2026-10-23" && sista().tid === "14:30", JSON.stringify(sista()));
  g.upgSatt("a", "est", 45); await vanta();
  ok("tidsåtgång 45 min", sista().handling === "planera" && sista().est === 45 && !("dag" in sista()), JSON.stringify(sista()));
  g.upgSatt("a", "est", 0); await vanta();
  ok("tidsåtgången bort", sista().est === null, JSON.stringify(sista()));
  g.upgSatt("a", "prio", 1); await vanta();
  ok("prioritet: andra med priority", sista().handling === "andra" && sista().falt?.priority === 1, JSON.stringify(sista()));
  g.upgSatt("a", "proj", "Mässan"); await vanta();
  ok("projekt: andra med projektets id", sista().handling === "andra" && sista().falt?.project_id === "p1", JSON.stringify(sista()));
  skickat.length = 0;
  g.upgSatt("a", "gransk", "Elin Berg"); await vanta(); await vanta();
  ok("granskare: bjudin med rollen granskare", skickat.length === 1 && skickat[0].handling === "bjudin" && skickat[0].person === "p-elin" && skickat[0].roll === "granskare", JSON.stringify(skickat));
  skickat.length = 0;
  g.upgSatt("b", "gransk", "Elin Berg"); await vanta(); await vanta(); await vanta();
  ok("byt granskare: Kim tas bort, Elin bjuds in", skickat.map((x) => `${x.handling}:${x.person}`).join(",") === "lamna:p-kim,bjudin:p-elin", JSON.stringify(skickat));
  {
    const n2 = navet();
    n2.g.upgSatt("b", "gransk", ""); await n2.vanta(); await n2.vanta();
    ok("ingen granskare: Kim tas bort", n2.skickat.map((x) => `${x.handling}:${x.person}`).join(",") === "lamna:p-kim", JSON.stringify(n2.skickat));
  }
  g.upgSatt("c", "oppna", null); await vanta();
  ok("klar: Öppna igen skickar ateroppna", sista().handling === "ateroppna" && sista().id === "c", JSON.stringify(sista()));
  g.stryk("a"); await vanta();
  ok("stryk: avbryt", sista().handling === "avbryt", JSON.stringify(sista()));
  const angra = toasts.at(-1)?.[1]?.[0];
  ok("stryk har Ångra", angra?.[0] === "Ångra");
  if (angra) { angra[1](); await vanta(); }
  ok("Ångra öppnar den igen", sista().handling === "ateroppna" && sista().id === "a", JSON.stringify(sista()));
}

rubrik("Aktiviteten ur navets händelser");
{
  const { g } = navet();
  const t = g.TASKS.find((x) => x.id === "d");
  const a = g.upgAkt(t);
  ok("händelsen och kommentaren i tidsordning", a.length === 2 && a[0].k === "h" && a[0].text === "Skapad" && a[1].k === "k" && a[1].text === "Hej" && a[1].vem === "Elin Berg", JSON.stringify(a));
  // ndKl räknar om till svensk tid: 09:30 UTC är 11:30 den 23 oktober (sommartid).
  ok("i dag visas som klockslaget, utan datum", a[1].nar === "11:30", a[1].nar);
  ok("titeln har datum och klockslag", a[1].titel === "2026-10-23 11:30", a[1].titel);
}

console.log(fel ? `\n\x1b[31m${fel} prov föll.\x1b[0m` : "\n\x1b[32mAlla prov gick igenom.\x1b[0m");
process.exit(fel ? 1 : 0);
