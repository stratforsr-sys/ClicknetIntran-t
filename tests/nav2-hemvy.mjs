#!/usr/bin/env node
/**
 * Det nya hemmet i Nav 2.0 (prefix hv): fyra kort, tomma lägen, genomgångarna och rutan i Inställningar.
 *
 * Provet läser blocket NYA HEMMET ur utkastet och kör det i en sandlåda där resten av utkastet är attrapper,
 * med två fasta ND: en chef och en säljare. Det som prövas är det som aldrig får gå fel i hemmet:
 *   - fyra kort, och rätt kort för rätt person (Teamet i månaden för den som leder, Din månad för säljaren);
 *   - tomma lägen säger vad som gäller i stället för att vara tomma;
 *   - Din månad visar bara det provisionsmotorn har räknat: väntande order står som antal, aldrig som kronor
 *     i kortets tal, och utan provisionsregel visas inga kronor alls;
 *   - varje genomgång säger hur texten kom till ("Räknat av regler") och vad Nav inte ser;
 *   - inget hv-namn finns två gånger (utkastet är ett enda namnrum).
 *
 *   node tests/nav2-hemvy.mjs
 */
import { readFileSync } from "node:fs";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra && !villkor ? "  " + String(extra).slice(0, 400) : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const html = readFileSync(process.env.UTKAST ?? new URL("../src/nav2/utkast.html", import.meta.url), "utf8");
const block = html.match(/\/\* =+\n {3}NAV 2\.0 I RIKTIGT LÄGE: NYA HEMMET \(prefix hv\)[\s\S]*?\/\* -{10} Nya hemmet slut -{10} \*\//)?.[0];
ok("blocket NYA HEMMET finns i utkastet", !!block);
if (!block) {
  console.log(`\n\x1b[31m${fel} prov föll.\x1b[0m`);
  process.exit(1);
}

rubrik("Utkastet är ett namnrum");
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
}));
const TEAM = {
  manad: "2026-11", manadsnamn: "november", netto: 19, vantar: 1, makulerade: 1, mal: 46, utanMal: 0, takt: { gatt: 10, totalt: 21, prognos: 40 },
  facit: [{ manad: "2026-10", gatt: 10, sa: 38, blev: 44, efterhand: false }],
  text: { stort: "19 av 46 order", rad: "I samma takt blir det ungefär 40. Det är en uträkning på takten, inget löfte.", malrad: null, facit: "Efter 10 dagar sa takten 38 i oktober (det blev 44)." },
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
function hem({ chef, forslag = 1, andrat = ANDRAT, rader = null, team = TEAM, underlag = "med", vantar = 1, pa = true, inst = null, golvet = GOLVET, mode = "morgon" } = {}) {
  const anrop = [];
  const U = {
    rader: [{ slag: "order", text: "#11 Hagmans Rör", sub: "Stor, 36 månader", dag: "2026-11-03", belopp: 6500 }, { slag: "order", text: "#12 Åkes Bygg", sub: "Mellan, 36 månader", dag: "2026-11-05", belopp: 8000 }],
    antal: { signerade: 2, makulerade: 0, netto: 2 }, bonusantal: 2, summa: 14500, niva: null, nasta: { niva: { t: 5, a: 500 }, kvar: 3 }, moten: null,
    vantar: Array.from({ length: vantar }, (_x, i) => ({ id: `v${i}`, nr: 20 + i, bolag: "Björks Åkeri", prov: 2000, st: "inskickad" })), utkast: [],
  };
  const g = {
    ND: {
      jag: { id: "jag" },
      hem: {
        nytt: true, inst,
        forslag: { pa, oppna: FORSLAG(forslag), kortrad: forslag ? `${forslag} ${forslag === 1 ? "möte i morgon är obekräftat" : "möten i morgon är obekräftade"}` : null, andrat, trend: { har: 11, behover: 60 }, trendrad: "För att jämföra laget med sig självt behöver jag 60 avgjorda möten. Jag har 11." },
        team: chef ? team : null,
        golvet, push: { nyckel: "n", enheter: 1, ledare: !!chef },
      },
      uppgifter: { klara: [{ at: "2026-11-16T09:00:00Z" }, { at: "2026-11-16T13:00:00Z" }, { at: "2026-11-13T13:00:00Z" }] },
      provision: { jagId: "jag", underlag: { "2026-11": underlag === "med" ? { jag: {} } : {} }, moten: null },
      moten: { kort: [], saljare: [{ id: "p1", namn: "Edvin Prov" }], offertPaket: [] },
      tid: { stamplar: true },
    },
    S: { view: "hem", role: chef ? "chef" : "saljare", mode, events: [], hv: undefined, flagged: new Set(), hiddenKinds: new Set(), done: new Set(), speaking: false },
    MODES: { morgon: { halsning: "God morgon", dag: "Måndag 16 november" }, slut: { halsning: "Bra jobbat i dag", dag: "Måndag 16 november" } },
    KIND_LABEL: { rutin: "rutiner", uppgift: "uppgifter", "frånvaro": "frånvaro" },
    DELTA: { chef: { morgon: "I natt och i morse: 2 nya poster i klockan, senast Order #31 är godkänd.", slut: "I dag: inget nytt i klockan." }, saljare: { morgon: "I natt och i morse: inget nytt i klockan.", slut: "I dag: inget nytt i klockan." } },
    FRMAN: ["", "januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"],
    TMR: { chef: { kal: [["09:00", "Morgonmöte Team Nord"]], uppg: ["Ring Solbacken"], borta: [["Mick Prov", "semester"]], beslut: [["Carls ledighet", "börjar 18 nov, beslut innan dess"]] }, saljare: { kal: [["09:00", "Morgonmöte Team Nord"], ["13:30", "PEGU Byggservice"]], uppg: ["Skicka offert till Solbacken"] } },
    WEEK: { chef: { dagar: [["mån", "16", ["Morgonmöte 09:00"], null, "2026-11-16"], ["tis", "17", ["2 i kalendern", "Mick semester"], ["Besluta Carls ledighet", "danger"], "2026-11-17"], ["ons", "18", ["Inget inbokat"], null, "2026-11-18"]], klart: ["Ring Solbacken", "Bokför novemberprovisionen, {PV}"] },
            saljare: { dagar: [["mån", "16", ["PEGU Byggservice 11:00"], null, "2026-11-16"], ["tis", "17", ["Inget inbokat"], null, "2026-11-17"]], klart: ["Skicka offert till Solbacken"] } },
    ndHemTmrSynk: () => "2026-11-17", ndHemVecka: () => ({ man: "2026-11-16", fre: "2026-11-20" }), ndHemNasta: () => "2026-11-17", ndHemDagNamn: () => "Tisdag", ndVecka: () => 47, frPeriod: () => "16–20 nov",
    hemPvPoster: () => ({ n: 4, summa: 12000 }), ndHemPushRad: () => "På för den här enheten.", ndHemLive: () => { anrop.push(["live"]); },
    ndHemPost: async (handling, data) => { anrop.push([handling, data]); return { ok: handling === "flagga" ? "Markerad som fel. Raden blir underlag för att rätta sammanfattningen." : handling === "grattis" ? "Grattis skickat. Säljaren får en pling." : "Sparat." }; },
    INBOX: [{ id: "r1", nar: "nu" }, { id: "r2", nar: "idag" }, { id: "r3", nar: "vanta" }],
    ndUp: () => true, TASKS: [{ id: "7", ndNytt: [{ sort: "kommentar" }] }, { id: "8", ndNytt: [] }], ndNyPrick: (t) => `<span class="upg-nyprick" title="Nytt på uppgift ${t.id}"></span>`, ME: { chef: { fornamn: "Zen", namn: "Zen Prov" }, saljare: { fornamn: "Edvin", namn: "Edvin Prov" } },
    esc, kr, oKr: kr, I: (n) => `<svg data-i="${n}"></svg>`, hubMark: (s) => `<svg data-nav="${s}"></svg>`,
    ndHemRad: rader ?? [
      { id: "r1", nar: "nu", heat: 5, bkind: "frånvaro", bt: "{Carl} är sjukanmäld.", t: "Carl är sjukanmäld", why: "Sjuk sedan i dag. Ingen har bekräftat", act: { l: "Bekräfta" }, gor: () => {} },
      { id: "r2", nar: "idag", heat: 2, bkind: "uppgift", bt: "{Ring tillbaka Mälarö Frakt} i dag.", t: "Ring tillbaka Mälarö Frakt", why: "Frist i dag", act: { l: "Klar", check: true }, gor: () => {}, ga: () => {} },
      { id: "r3", nar: "vanta", heat: 1, bkind: "rutin", bt: "{Säljsamtal} ska granskas.", t: "Rutinen Säljsamtal ska granskas", why: "Granskningen var 12 nov", act: { l: "Granska" }, ga: () => {} },
      { id: "r4", nar: "nu", heat: 3, bkind: "möten", bt: "Sätt utfall på {2 möten}.", t: "Sätt utfall på 2 möten", why: "Hölls i fredags", act: { l: "Öppna" }, ga: () => {} },
      { id: "r5", nar: "vanta", heat: 1, bkind: "utbildning", bt: "{Släpp inte kunden för tidigt}.", t: "Kursen Släpp inte kunden för tidigt", why: "Del 2 av 3", act: { l: "Öppna" }, ga: () => {} },
    ],
    ndHemSynk: () => {}, complete: () => {}, teamNow: () => (chef ? [["Carl Prov", "inne", "sedan 07:58"], ["Mick Prov", "sjuk", "sjuk sedan i dag"], ["Edvin Prov", "ej", "schemat börjar 08:00"]] : []),
    LAGE: { inne: { l: "Inne" }, sjuk: { l: "Sjuk" }, ledig: { l: "Ledig" }, ej: { l: "Ej instämplad" } },
    stampLage: () => "ute", hm: (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`, now: () => 480,
    kIdag: () => "2026-11-16", ndHemLangt: (d) => (d === "2026-11-17" ? "Tisdag 17 november" : "Måndag 16 november"), ndHemKal: () => [{ s: 660, t: "PEGU Byggservice" }, { s: 840, t: "Veckomöte" }],
    ndKopplad: () => true, ndP: () => g.ND.provision, pvSt: () => {}, PVMAN: "2026-11", pvManNamn: () => "november", pvUnderlag: () => U,
    pvTakt: () => ({ prognos: { totalt: 30500 } }), oProv: (o) => o.prov, oDat: (d) => `${+d.slice(8)} nov`, frKort: (d) => `${+d.slice(8)} nov`,
    ndOmlasAnmal: () => {}, ndOmlas: () => Promise.resolve(true), render: () => {}, toast: () => {},
    document: { addEventListener: () => {}, getElementById: () => null, querySelector: () => null }, window: { addEventListener: () => {}, scrollTo: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
  };
  kor(block, g, ["hvHem", "hvVantar", "hvForeslar", "hvTeam", "hvDinManad", "hvAndrat", "hvArk", "hvSkriv", "hvInstRuta", "hvPa", "hvFlagga", "hvDolj", "hvVisa", "hvGrattis", "hvHamta", "hvOppna", "hvValj", "hvTangent"]);
  g.anrop = anrop;
  return g;
}
const kort = (h, etikett) => h.match(new RegExp(`<section class="hv-card[^"]*" aria-label="${etikett}"[\\s\\S]*?</section>`))?.[0] ?? "";
const stor = (k) => k.match(/<div class="hv-stor">([\s\S]*?)<\/div>/)?.[1] ?? "";

rubrik("Chefens hem: fyra kort");
{
  const g = hem({ chef: true });
  const h = g.hvHem();
  ok("hemmet ritas för den som har det nya hemmet", g.hvPa() === true && h.includes('class="hv"'));
  ok("fyra kort", (h.match(/<section class="hv-card/g) || []).length === 4, (h.match(/aria-label="[^"]*"/g) || []).join(" "));
  ok("Väntar på dig", !!kort(h, "Väntar på dig"));
  ok("Nav föreslår", !!kort(h, "Nav föreslår"));
  ok("Teamet i november, inte Din månad", !!kort(h, "Teamet i november") && !h.includes("Din november"));
  ok("Det som ändrats", !!kort(h, "Det som ändrats"));
  ok("hälsningen och en rad om läget", h.includes("<h1>God morgon, Zen</h1>") && h.includes("Två saker brinner.") && h.includes("nästa 11.00 PEGU Byggservice"), h.match(/<div class="hv-hero">[\s\S]*?<\/div>/)?.[0]);
  ok("överraden: på plats, datum och Stämpla in", h.includes("1<small>/3</small>") && h.includes("Måndag 16 november") && /data-act="in"[^>]*>[^<]*Stämpla in/.test(h), h.match(/<div class="hv-topp">[\s\S]*?<\/div>/)?.[0]);
  ok("skrivrutan finns, och säger att svaren inte kommer från AI", h.includes("data-hvskriv") && /Svaren kommer ur Navs sökruta, inte från AI/.test(h));
  ok("genvägarna Min dag, Veckan och Golvet", /data-todo[^>]*>Min dag/.test(h) && /data-hvark="vecka"[^>]*>Veckan/.test(h) && /data-hvark="golvet"[^>]*>Golvet/.test(h));
  ok("utan Golvets data finns ingen genväg dit", !hem({ chef: true, golvet: null }).hvHem().includes('data-hvark="golvet"'));
}

rubrik("Väntar på dig: samma lista som i dag, det som brinner först");
{
  const g = hem({ chef: true });
  const k = kort(g.hvHem(), "Väntar på dig");
  const titlar = [...k.matchAll(/<b>([^<]*)<\/b><button/g)].map((m) => m[1]);
  ok("högst fyra rader, de som brinner först och hetast överst", titlar.length === 4 && titlar[0] === "Carl är sjukanmäld" && titlar[1] === "Sätt utfall på 2 möten" && titlar[2] === "Ring tillbaka Mälarö Frakt", titlar.join(" | "));
  ok("en varm punkt på det som brinner, och bara där", (k.match(/hv-heat hot/g) || []).length === 2);
  ok("ett klick löser saken: knappen bär radens id", k.includes('data-hvgor="r1"') && k.includes(">Bekräfta</button>"));
  ok("resten ligger ett klick bort", /data-hvark="vantar"[^>]*>1 till</.test(k), k.match(/<button class="hv-kfot[\s\S]*?<\/button>/)?.[0]);
  const tom = kort(hem({ chef: true, rader: [] }).hvHem(), "Väntar på dig");
  ok("tomt läge: Inget väntar på dig.", tom.includes("Inget väntar på dig.") && !tom.includes("data-hvgor"), tom);
}

rubrik("Nav föreslår");
{
  const ett = kort(hem({ chef: false }).hvHem(), "Nav föreslår");
  ok("ett förslag: talet och saken", /<b class="num">1<\/b><span>möte i morgon är obekräftat<\/span>/.test(stor(ett)), stor(ett));
  ok("vilket möte det gäller, och en knapp som öppnar det", ett.includes("Hagby Glas 0 i morgon 09.00") && ett.includes('data-hvforslag="f0"'), ett);
  ok("ingen bläddring när det bara finns ett", !ett.includes("data-hvnasta"));
  const tre = kort(hem({ chef: false, forslag: 3 }).hvHem(), "Nav föreslår");
  ok("tre förslag: 1 av 3, och 2 till", tre.includes("1 av 3") && /data-hvnasta[^>]*>2 till</.test(tre) && /<b class="num">3<\/b><span>möten i morgon är obekräftade<\/span>/.test(stor(tre)), tre);
  const tom = kort(hem({ chef: false, forslag: 0 }).hvHem(), "Nav föreslår");
  ok("tomt läge: Inget att föreslå just nu, och hur långt trendregeln har kvar", tom.includes("Inget att föreslå just nu.") && tom.includes("behöver jag 60 avgjorda möten. Jag har 11."), tom);
  const av = kort(hem({ chef: true, forslag: 0, pa: false, inst: { pa: false, farBrytare: true } }).hvHem(), "Nav föreslår");
  ok("den som får ändra inställningarna ser att förslagen är avstängda", av.includes("Förslagen är avstängda"), av);
  const avSalj = kort(hem({ chef: false, forslag: 0, pa: false }).hvHem(), "Nav föreslår");
  ok("säljaren får ingen hänvisning till en inställning hen inte når", !avSalj.includes("avstängda"), avSalj);
}

rubrik("Teamet i månaden");
{
  const k = kort(hem({ chef: true }).hvHem(), "Teamet i november");
  ok("det stora talet är det säkra: order av målet", /<b class="num">19<\/b><span>av 46 order<\/span>/.test(stor(k)), stor(k));
  ok("takten står som en uträkning, med sitt facit bredvid", k.includes("I samma takt blir det ungefär 40. Det är en uträkning på takten, inget löfte.") && k.includes("Efter 10 dagar sa takten 38 i oktober (det blev 44)."), k);
  ok("väntande och makulerade står som antal", k.includes("1 väntar") && k.includes("1 makulerad"), k);
  ok("mätaren har takten som ett streck", /class="nu" style="width:41\.3%"/.test(k) && /class="takt" style="left:87\.0%"/.test(k), k.match(/<div class="hv-matare[\s\S]*?<\/div>/)?.[0]);
  ok("kortet öppnar genomgången", k.includes('data-hvark="team"') && k.includes("Visa uträkningen"));
  const utan = kort(hem({ chef: true, team: { ...TEAM, mal: null, text: { ...TEAM.text, stort: "19 order", malrad: "Inget mål satt för november." } } }).hvHem(), "Teamet i november");
  ok("inget mål satt: kortet säger det och visar takten utan avstånd", utan.includes("Inget mål satt för november.") && /<b class="num">19<\/b><span>order<\/span>/.test(stor(utan)) && !utan.includes("hv-matare"), utan);
  const tidigt = kort(hem({ chef: true, team: { ...TEAM, takt: { gatt: 0, totalt: 21, prognos: null }, text: { ...TEAM.text, rad: "För tidigt för en takt. Den kommer när månadens första arbetsdag har gått.", facit: "" } } }).hvHem(), "Teamet i november");
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
  ok("avståndet till nästa steg står i order", k.includes("3 order till nästa steg.") && !/500 kr/.test(k), k);
  ok("mätaren har ett fack per order, och den väntande är ljusare", (k.match(/<i class="pa"><\/i>/g) || []).length === 2 && (k.match(/<i class="vant"><\/i>/g) || []).length === 1 && (k.match(/<i class=""><\/i>/g) || []).length === 2, k.match(/<div class="hv-matare[\s\S]*?<\/div>/)?.[0]);
  ok("prognosen i kronor står inte på kortet", !/30[\s ]500/.test(k) && !/[Pp]rognos/.test(k), k);
  ok("aldrig du förlorar, aldrig en jämförelse med kollegor", !/förlorar|kollegor|före månadsskiftet/i.test(k));
  const utan = kort(hem({ chef: false, underlag: "utan" }).hvHem(), "Din november");
  ok("utan provisionsregel visas inga kronor", !!utan && !/\bkr\b/.test(utan) && /<b class="num">2<\/b><span>order i november<\/span>/.test(stor(utan)), utan);
}

rubrik("Det som ändrats");
{
  const k = kort(hem({ chef: false }).hvHem(), "Det som ändrats");
  ok("det senaste som fått en dom", k.includes("Hagby Glas: du valde att låta mötet stå. Mötet hölls.") && k.includes('data-hvark="andrat"'), k);
  ok("en rad om läsaren själv står som hos dig", k.includes(">hos dig<"), k);
  const inst = kort(hem({ chef: false, andrat: [{ ...ANDRAT[0], sort: "andring", text: "Bekräftelsen öppnar 1 arbetsdag före mötet i stället för 2.", fran: "installning", galler: "alla", dom: "Inget före att jämföra med." }] }).hvHem(), "Det som ändrats");
  ok("en inställning som gäller alla står aldrig som hos dig", inst.includes(">hela företaget<") && !inst.includes("hos dig") && inst.includes("Inget före att jämföra med."), inst);
  const lag = kort(hem({ chef: true, andrat: [{ ...ANDRAT[0], sort: "andring", text: "Vi ringer kunden dagen före.", fran: "person", galler: "laget" }] }).hvHem(), "Det som ändrats");
  ok("en ändring för laget står som laget", lag.includes(">laget<") && !lag.includes("hos dig"), lag);
  const annan = kort(hem({ chef: true, andrat: [{ ...ANDRAT[0], vem: "Hanna", galler: "person" }] }).hvHem(), "Det som ändrats");
  ok("en rad om någon annan bär personens förnamn", annan.includes(">Hanna<") && !annan.includes("hos dig"), annan);
  const tom = kort(hem({ chef: false, andrat: [] }).hvHem(), "Det som ändrats");
  ok("tomt läge: Inget har ändrats än. Berätta om en ändring.", tom.includes("Inget har ändrats än.") && tom.includes("Berätta om en ändring"), tom);
}

rubrik("Ett öppnat kort tar ytan");
{
  const g = hem({ chef: false });
  g.S.hv.ark = "vantar";
  const v = g.hvHem();
  ok("korten viker undan", !v.includes('<div class="hv-kort">') && v.includes("data-hvstang"));
  ok("hela listan i grupperna Nu, Senare i dag och Kan vänta", />Nu</.test(v) && />Senare i dag</.test(v) && />Kan vänta</.test(v) && (v.match(/class="hv-sak"/g) || []).length === 5, v.match(/class="hv-grupp">[^<]*/g)?.join(" "));
  ok("varje sak har en rad om varför", v.includes("Sjuk sedan i dag. Ingen har bekräftat") && v.includes("Granskningen var 12 nov"));
  ok("skrivrutan står kvar under arket", v.includes("data-hvskriv"));

  Object.assign(g.S.hv, { ark: "forslag", id: "f0", data: { forslag: { id: "f0", forslag: { ...FORSLAG(1)[0], lage: "oppet", mitt: true, valt: null, domsDag: "på onsdag", dom: null, kommentar: null } } } });
  const f = g.hvHem();
  ok("förslaget: Nav talar först, med sina tre rader", f.includes("Mötet med Hagby Glas 0 i morgon 09.00 är inte bekräftat.") && f.includes("Hittills har 1 av 4 obekräftade möten hållits.") && f.includes("Det här ser jag inte: om kunden har hört av sig på annat sätt."), f);
  ok("tre lika val", (f.match(/class="hv-vl"/g) || []).length === 3 && ["ringer-sjalv", "flytta", "lat-sta"].every((v2) => f.includes(`data-hvval="${v2}"`)) && f.includes("Jag ringer själv") && f.includes("Flytta mötet") && f.includes("Låt stå"));
  ok("källraden säger hur texten kom till", f.includes("Räknat av regler"));
  ok("Nav kontaktar aldrig kunden, och det står där", f.includes("Nav ringer eller skriver aldrig till kunden."));
  ok("personens egen rad går att skriva", f.includes('data-hvkommentar="f0"') && f.includes('maxlength="200"'));
  g.S.hv.kvitto = { text: "Klart. Mötet står kvar som det är. På onsdag säger jag hur det gick.", angra: "f0" };
  g.S.hv.data.forslag.forslag.lage = "valt"; g.S.hv.data.forslag.forslag.valt = "lat-sta";
  const kv = g.hvHem();
  ok("kvittot och Ångra står i ytans fot", /class="hv-arkfot"[\s\S]*Klart\. Mötet står kvar som det är\.[\s\S]*data-hvangra="f0"/.test(kv), kv.match(/<div class="hv-arkfot"[\s\S]*?<\/div>/)?.[0]);
  ok("efter valet finns inga val kvar att trycka på", !kv.includes("data-hvval"));
  g.S.hv.data.forslag.forslag = { ...g.S.hv.data.forslag.forslag, mitt: false, lage: "oppet", valt: null };
  g.S.hv.kvitto = null;
  ok("den som inte håller mötet får inga val", !g.hvHem().includes("data-hvval"));

  Object.assign(g.S.hv, { ark: "manad", kvitto: null });
  const m = g.hvHem();
  ok("uträkningen: order för order", m.includes("#11 Hagmans Rör") && m.includes("#12 Åkes Bygg") && /6[\s ]500 kr/.test(m) && /14[\s ]500 kr/.test(m), m);
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
  ok("teamets genomgång: lagets öppna rader överst", t.indexOf("Obekräftade möten i morgon: 3, varav 1 utan val.") > 0 && t.indexOf("Obekräftade möten i morgon: 3") < t.indexOf("Carl Prov"), t);
  ok("en rad per person: antal, utan dom", t.includes("Carl Prov") && t.includes("Edvin Prov") && />8<\/span><span class="num">5<\/span><span class="num">1<\/span><span class="num">6</.test(t), t.match(/<div class="hv-tr">[\s\S]*?<\/div>/)?.[0]);
  ok("uträkningen bakom takten", t.includes("19 order på 10 arbetsdagar, gånger månadens 21 arbetsdagar, blir ungefär 40."));
  ok("taktens facit: varje avslutad månad, också den som räknats i efterhand", t.includes("blev 44") && t.includes("blev 24") && t.includes("Räknat i efterhand ur orderna"), t);
  ok("lagets facit per val", t.includes("När någon har ringt själv har 5 av 7 möten hållits."));
  ok("det Nav inte ser, och källraden", t.includes("Det här ser jag inte: order som inte är inlagda i Nav") && t.includes("Räknat av regler"));

  Object.assign(g.S.hv, {
    ark: "andrat",
    data: { andrat: { farLaget: true, kalla: "Räknat av regler", matt: [{ nyckel: "moten.uteblivna", text: "Uteblivna möten av hållna och uteblivna.", serInte: "Ser inte varför." }],
      andrat: [
        { id: "a1", sort: "andring", text: "Vi ringer kunden dagen före.", dom: "Ser bra ut. Hela laget ändrade sig samtidigt, så jag har inget att jämföra med.", tal: "0 av 20 uteblev. Bokade per vecka: 6 före, 7 efter.", ton: "upp", nar: "2026-11-13T07:00:00Z", vem: null, kommentar: null, fran: "person", mitt: false, kalla: "Räknat av regler" },
        { id: "a2", sort: "forslag", text: "Hagby Glas: Edvin valde att låta mötet stå. Kunden uteblev. Mötet blev aldrig bekräftat.", dom: null, tal: null, ton: "vet", nar: "2026-11-12T07:00:00Z", vem: "Edvin", kommentar: "Kunden bad om ny tid.", fran: "regel", mitt: false, kalla: "Räknat av regler" },
      ] } },
  });
  const a = g.hvHem();
  ok("det som ändrats: varje rad med källa, tal och dom", a.includes("Vi ringer kunden dagen före.") && a.includes("0 av 20 uteblev. Bokade per vecka: 6 före, 7 efter.") && a.includes("Ser bra ut.") && a.includes("Någon berättade") && a.includes("Nav såg det"), a);
  ok("personens egen rad står bredvid, som personens ord", a.includes("”Kunden bad om ny tid.”"));
  ok("Berätta om en ändring och Pröva med laget", a.includes("data-hvform=\"beratta\"") && a.includes("data-hvform=\"prova\"") && a.includes("Berätta om en ändring") && a.includes("Pröva med laget"));
  ok("källraden", a.includes("Räknat av regler"));
  g.S.hv.form = { typ: "beratta", text: "", om: "jag", fran: "2026-11-16", matt: "moten.uteblivna", fel: "" };
  const fo = g.hvHem();
  ok("formuläret har fyra fält: vad, vem, från vilken dag och vilket mått", fo.includes('data-hvfalt="text"') && fo.includes('data-hvfalt="om"') && fo.includes('data-hvfalt="fran"') && fo.includes('data-hvfalt="matt"') && fo.includes("data-hvandring"), fo.match(/<form class="hv-form"[\s\S]*?<\/form>/)?.[0]);
  ok("chefen kan välja laget eller en person, säljaren bara sig själv", fo.includes('value="laget"') && fo.includes('value="p1"'));
  const s = hem({ chef: false });
  Object.assign(s.S.hv, { ark: "andrat", data: { andrat: { farLaget: false, kalla: "Räknat av regler", matt: [{ nyckel: "moten.uteblivna", text: "x", serInte: "y" }], andrat: [] } }, form: { typ: "beratta", text: "", om: "jag", fran: "2026-11-16", matt: "moten.uteblivna", fel: "" } });
  const sf = s.hvHem();
  ok("säljaren berättar bara om sig själv, och prövar inte med laget", !sf.includes('value="laget"') && !sf.includes('data-hvform="prova"') && sf.includes("Inget har ändrats än."), sf.match(/<form class="hv-form"[\s\S]*?<\/form>/)?.[0]);
}

rubrik("Det gamla hemmets saker har en plats: Väntar på dig");
{
  const g = hem({ chef: true });
  g.S.hv.ark = "vantar";
  const v = g.hvHem();
  ok("Sedan du tittade står överst i listan", v.includes("I natt och i morse: 2 nya poster i klockan, senast Order #31 är godkänd."), v.slice(0, 900));
  ok("listan går att få uppläst", /data-listen[^>]*aria-pressed="false"[^>]*>[\s\S]{0,60}Lyssna/.test(v));
  ok("en rad med en källa går att öppna, också när knappen gör något annat", v.includes('data-hvga="r2"') && v.includes('data-hvga="r3"') && !v.includes('data-hvga="r1"'), v.match(/data-hvga="[^"]*"/g)?.join(" "));
  ok("varje rad har en meny", ["r1", "r2", "r3", "r4", "r5"].every((id) => v.includes(`data-hvmeny="${id}"`)) && !v.includes("data-hvflagga"));
  g.S.hv.meny = "r3";
  const m = g.hvHem();
  ok("menyn: Stämmer inte, och Visa inte rutiner på hemmet", m.includes('data-hvflagga="r3"') && m.includes(">Stämmer inte<") && m.includes('data-hvdolj="rutin"') && m.includes("Visa inte rutiner på hemmet") && (m.match(/data-hvflagga=/g) || []).length === 1, m.match(/<div class="hv-meny">[\s\S]*?<\/div>/)?.[0]);
  ok("raderna går att nå med tangentbordet (J, K, E, Enter)", (m.match(/class="hv-sak[^"]*" data-id="/g) || []).length === 5 && html.includes("document.querySelectorAll('.irow, .hv-sak[data-id]')") && html.includes("querySelector('[data-row], [data-hvgor]')"));

  await g.hvFlagga("r1");
  ok("Stämmer inte går till kön för fel med raden i klartext", JSON.stringify(g.anrop[0]) === JSON.stringify(["flagga", { rad: "r1", text: "Carl är sjukanmäld." }]) && g.S.flagged.has("r1"), JSON.stringify(g.anrop));
  ok("kvittot står i ytans fot", /class="hv-arkfot"[\s\S]*Markerad som fel\./.test(g.hvHem()));
  const f = g.hvHem();
  ok("den flaggade raden står kvar i listan, märkt, utan knappen Stämmer inte", f.includes("Carl är sjukanmäld") && f.includes("Markerad som fel") && !f.includes('data-hvmeny="r1"'), f.match(/data-id="r1"[\s\S]*?<\/div>\s*<\/div>/)?.[0]);
  g.S.hv.ark = null;
  const h = g.hvHem();
  ok("på hemmet räknas den inte längre: kortet och hälsningen hoppar över den", !kort(h, "Väntar på dig").includes("Carl är sjukanmäld") && h.includes("En sak brinner."), kort(h, "Väntar på dig"));

  await g.hvDolj("rutin");
  ok("Visa inte här sparas som förut", JSON.stringify(g.anrop.at(-1)) === JSON.stringify(["dolj", { sort: "rutin" }]) && g.S.hiddenKinds.has("rutin"), JSON.stringify(g.anrop));
  ok("kvittot har Ångra", g.S.hv.kvitto?.visa === "rutin" && /data-hvvisa="rutin"/.test((g.S.hv.ark = "vantar", g.hvHem())));
  const d = g.hvHem();
  ok("sorten står kvar i hela listan, och går att ta tillbaka", d.includes("Rutinen Säljsamtal ska granskas") && d.includes("Visas inte på hemmet: rutiner") && d.includes('data-hvvisa="rutin"'), d.match(/<div class="hv-lf">[\s\S]*?<\/div>/)?.[0]);
  g.S.hv.ark = null;
  const k = kort(g.hvHem(), "Väntar på dig");
  ok("kortet visar inte sorten, men säger hur många som finns i listan", !k.includes("Rutinen Säljsamtal") && k.includes("Sätt utfall på 2 möten") && /2 till/.test(k), k);
  await g.hvVisa("rutin");
  ok("Visa igen tar tillbaka sorten", JSON.stringify(g.anrop.at(-1)) === JSON.stringify(["visa", { sort: "rutin" }]) && !g.S.hiddenKinds.has("rutin"));

  const allt = hem({ chef: false });
  allt.S.hiddenKinds = new Set(["frånvaro", "uppgift", "rutin", "möten", "utbildning"]);
  const tomt = kort(allt.hvHem(), "Väntar på dig");
  ok("allt bortvalt: kortet säger det, och listan går fortfarande att öppna", tomt.includes("Det som väntar har du valt bort från hemmet.") && tomt.includes('data-hvark="vantar"') && !tomt.includes("Inget väntar på dig."), tomt);
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

rubrik("Det gamla hemmets saker har en plats: Veckan");
{
  const g = hem({ chef: true });
  g.S.hv.ark = "vecka";
  const v = g.hvHem();
  ok("nästa arbetsdag: kalendern, borta, beslut med frist och uppgifter", v.includes("Tisdag 17 november") && v.includes("Morgonmöte Team Nord") && v.includes("09:00") && v.includes("Mick Prov") && v.includes("semester") && v.includes("Carls ledighet") && v.includes("Ring Solbacken"), v);
  ok("veckan dag för dag, från i dag", v.includes("v.47") && v.includes("16–20 nov") && v.includes("2 i kalendern") && v.includes("Besluta Carls ledighet"), v);
  ok("att få klart i veckan, med provisionen att bokföra", v.includes("Att få klart i veckan") && v.includes("Bokför novemberprovisionen, 4 order") && !v.includes("{PV}"));
  ok("kalendern är ett klick bort", /data-view="kalender"[^>]*>Öppna kalendern/.test(v));
  ok("kvällsnotisen har sin plats hos den som leder: när den skickas, och på eller av för enheten", v.includes("Kvällsnotisen") && v.includes("vardagar kl. 17") && v.includes("söndagar kl. 18") && v.includes("På för den här enheten."), v.match(/Kvällsnotisen[\s\S]{0,400}/)?.[0]);
  ok("källraden", v.includes("Räknat av regler"));

  const s = hem({ chef: false, mode: "slut" });
  s.S.hv.ark = "vecka";
  const sv = s.hvHem();
  ok("säljaren ser sin egen dag, utan vilka som är borta", sv.includes("PEGU Byggservice") && sv.includes("Skicka offert till Solbacken") && !sv.includes("Mick Prov") && !sv.includes("Kvällsnotisen"), sv);
  ok("dagens slut: vad som blev klart i dag och vad som är kvar", sv.includes("I dag blev 2 uppgifter klara.") && sv.includes("2 saker är kvar."), sv.match(/I dag blev[^<]*/)?.[0]);
  const morgon = hem({ chef: false });
  morgon.S.hv.ark = "vecka";
  ok("på morgonen står inget om dagens slut", !morgon.hvHem().includes("I dag blev"));
}

rubrik("Det gamla hemmets saker har en plats: Golvet och Grattis");
{
  const g = hem({ chef: false });
  g.S.hv.ark = "golvet";
  const v = g.hvHem();
  ok("dagens signerade order, med antal och summa", v.includes("3 signerade") && /80[\s ]000 kr/.test(v) && v.includes("Hagmans Rör") && v.includes("Mick Prov") && /36[\s ]000 kr/.test(v) && v.includes("10:12"), v);
  ok("månaden för laget, order netto mot målet", v.includes("Team Nord") && v.includes("november") && v.includes("19 order av 46"), v);
  ok("Grattis går att skicka till en kollega", /data-hvgratt="o1"[^>]*aria-pressed="false"/.test(v) && v.includes("Grattis"));
  ok("på den egna ordern står hur många som gratulerat, utan knapp", !v.includes('data-hvgratt="o2"') && v.includes("2 grattis") && v.includes("<b>Du</b> signerade"), v);
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
  const lyssnar = html.match(/e\.target\.closest\('(\[data-hvstang\][^']*)'\)/)?.[1].match(/data-[a-z]+/g) ?? [];
  ok("klicklyssnarens väljare går att läsa ur koden", lyssnar.length > 15 && lyssnar.includes("data-hvton") && lyssnar.includes("data-hvark"), lyssnar.join(" "));
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
  ok("fönstrets ton står i ett eget attribut", /<div class="hv" data-hvtema="mork"/.test(sidor[0]) && /\.hv\[data-hvtema="ljus"\]\{/.test(html) && !/\.hv\[data-hvton=/.test(html));

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
  ok("den som saknar brytaren får inte höra att hen kan slå på förslagen", utan.includes("Förslagen är avstängda.") && !utan.includes("slås på i Inställningar"), utan);
  const med = kort(hem({ chef: true, forslag: 0, pa: false, inst: { ...INST, farBrytare: true } }).hvHem(), "Nav föreslår");
  ok("den som har brytaren får veta var den finns", med.includes("De slås på i Inställningar, under Nya hemmet."), med);

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
  ok("samma sak när vyn Provision inte är kopplad", kort(ej.hvHem(), "Din november").includes("Provisionen går inte att läsa just nu."));

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

console.log(fel ? `\n\x1b[31m${fel} prov föll.\x1b[0m` : "\n\x1b[32mAlla prov gick igenom.\x1b[0m");
process.exit(fel ? 1 : 0);
