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
function hem({ chef, forslag = 1, andrat = ANDRAT, andratKort = AKORT, rader = null, team = TEAM, underlag = "med", vantar = 1, pa = true, inst = null, golvet = GOLVET, mode = "morgon", hvton = null } = {}) {
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
    localStorage: { getItem: (k) => (k === "nav2-hvton" ? hvton : null), setItem: () => {} },
    openPal: () => { anrop.push(["pal"]); }, TextDecoder,
  };
  kor(block, g, ["hvHem", "hvVantar", "hvForeslar", "hvTeam", "hvDinManad", "hvAndrat", "hvArk", "hvSkriv", "hvInstRuta", "hvPa", "hvFlagga", "hvDolj", "hvVisa", "hvGrattis", "hvHamta", "hvOppna", "hvValj", "hvTangent", "hvFraga", "hvChattLagg", "hvKlick", "hvStang", "hvPlaneraDag"]);
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
  ok("hälsningen och en rad om läget", h.includes("<h1>God morgon, Zen</h1>") && h.includes("Två saker brinner.") && h.includes("nästa 11.00 med PEGU Byggservice"), h.match(/<div class="hv-hero">[\s\S]*?<\/div>/)?.[0]);
  ok("överraden: på plats, datum och Stämpla in", h.includes("1<small>/3</small>") && h.includes("Måndag 16 november") && /data-act="in"[^>]*>[^<]*Stämpla in/.test(h), h.match(/<div class="hv-topp">[\s\S]*?<\/div>/)?.[0]);
  ok("skrivrutan finns, och säger (i rutans titel) att svaren inte kommer från AI", h.includes("data-hvskriv") && /title="Svaren kommer ur Navs sökruta, inte från AI\./.test(h));
  ok("genvägarna Min dag och Veckan som kommer", /data-hvark="dag"[^>]*>Min dag/.test(h) && /data-hvark="vecka"[^>]*>Veckan som kommer/.test(h));
  ok("utan Golvets data finns ingen genväg dit", !hem({ chef: true, golvet: null }).hvHem().includes('data-hvark="golvet"'));
}

rubrik("Väntar på dig: samma lista som i dag, det som brinner först");
{
  const g = hem({ chef: true });
  const k = kort(g.hvHem(), "Väntar på dig");
  const titlar = [...k.matchAll(/<b>([^<]*)<\/b><button/g)].map((m) => m[1]);
  ok("tre rader som i skissen: det som brinner och det senare i dag, hetast överst", titlar.length === 3 && titlar[0] === "Carl är sjukanmäld" && titlar[1] === "Sätt utfall på 2 möten" && titlar[2] === "Ring tillbaka Mälarö Frakt", titlar.join(" | "));
  ok("en varm punkt på det som brinner, och bara där", (k.match(/hv-heat hot/g) || []).length === 2);
  ok("ett klick löser saken: knappen bär radens id", k.includes('data-hvgor="r1"') && k.includes(">Bekräfta</button>"));
  ok("resten ligger ett klick bort", /data-hvark="vantar"[^>]*>2 till som kan vänta</.test(k), k.match(/<button class="hv-kfot[\s\S]*?<\/button>/)?.[0]);
  const tom = kort(hem({ chef: true, rader: [] }).hvHem(), "Väntar på dig");
  ok("tomt läge: Inget väntar på dig just nu.", tom.includes("Inget väntar på dig just nu.") && !tom.includes("data-hvgor"), tom);
}

rubrik("Nav föreslår (skiss 9, punkt 14 och 15)");
{
  const ett = kort(hem({ chef: false }).hvHem(), "Nav föreslår");
  ok("ett förslag: förslagets tal och vad det räknar", /<div class="hv-stor"><b class="num">1<\/b><span>möte i morgon är obekräftat<\/span><\/div>/.test(ett), ett);
  ok("en mening och förslagets egen knapp", ett.includes('<p class="hv-ftxt">Hagby Glas 0 09.00. Mick har ringt två gånger utan svar.</p>') && /data-hvforslag="f0">Välj vad som händer<\/button>/.test(ett), ett);
  ok("Navs märke i huvudet", ett.includes('<i class="hv-heat nav"><svg data-nav="15"></svg></i><h2>Nav föreslår</h2>'));
  ok("ingen bläddring när det bara finns ett", !ett.includes("data-hvnasta") && !ett.includes("1 av 1"));
  const tva = kort(hem({ chef: false, forslag: 2 }).hvHem(), "Nav föreslår");
  ok("två förslag: 1 av 2 och 1 förslag till", tva.includes(">1 av 2<") && /data-hvnasta>1 förslag till</.test(tva), tva);
  const tom = kort(hem({ chef: true, forslag: 0, pa: false, inst: { pa: false, farBrytare: true } }).hvHem(), "Nav föreslår");
  ok("tomt: bock och Inga förslag just nu., inget om avstängt", /<div class="hv-lugn"><svg data-i="check"><\/svg>Inga förslag just nu\.<\/div>/.test(tom) && !/avstängda|trendregeln|avgjorda möten/.test(tom), tom);
}

rubrik("Teamet i månaden");
{
  const k = kort(hem({ chef: true }).hvHem(), "Teamet i november");
  ok("det stora talet är det säkra: order av målet", /<b class="num">19<\/b><span>av 46 order<\/span>/.test(stor(k)), stor(k));
  ok("takten står med sitt facit bredvid, och leder till uträkningen", k.includes("I samma takt blir det ungefär 40. I oktober sa takten 38, det blev 44.") && k.includes("Visa uträkningen"), k);
  ok("väntande och makulerade står som antal", k.includes("1 väntar") && k.includes("1 makulerad"), k);
  ok("mätaren har takten som ett streck", /class="nu" style="width:41\.3%"/.test(k) && /class="takt" style="left:87\.0%"/.test(k), k.match(/<div class="hv-matare[\s\S]*?<\/div>/)?.[0]);
  ok("kortet öppnar genomgången", k.includes('data-hvark="team"') && k.includes("Visa uträkningen"));
  const utan = kort(hem({ chef: true, team: { ...TEAM, mal: null, text: { ...TEAM.text, stort: "19 order", malrad: "Inget mål satt för november." } } }).hvHem(), "Teamet i november");
  ok("inget mål satt: kortet visar takten utan avstånd, och ingen rad om målet", !utan.includes("Inget mål satt för november.") && /<b class="num">19<\/b><span>order<\/span>/.test(stor(utan)) && !utan.includes("hv-matare"), utan);
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
  ok("avståndet till nästa steg står i order", k.includes("3 order till nästa steg.") && !/500 kr/.test(k), k);
  ok("mätaren har ett fack per order, och den väntande är ljusare", (k.match(/<i class="pa"><\/i>/g) || []).length === 2 && (k.match(/<i class="vant"><\/i>/g) || []).length === 1 && (k.match(/<i class=""><\/i>/g) || []).length === 2, k.match(/<div class="hv-matare[\s\S]*?<\/div>/)?.[0]);
  ok("prognosen i kronor står inte på kortet", !/30[\s ]500/.test(k) && !/[Pp]rognos/.test(k), k);
  ok("aldrig du förlorar, aldrig en jämförelse med kollegor", !/förlorar|kollegor|före månadsskiftet/i.test(k));
  const utan = kort(hem({ chef: false, underlag: "utan" }).hvHem(), "Din november");
  ok("utan provisionsregel visas inga kronor", !!utan && !/\bkr\b/.test(utan) && /<b class="num">2<\/b><span>order i november<\/span>/.test(stor(utan)), utan);
}

rubrik("Det som ändrats (skiss 9, punkt 18 och 19)");
{
  const k = kort(hem({ chef: true }).hvHem(), "Det som ändrats");
  ok("hur många som följs står i huvudet", /<h2>Det som ändrats<\/h2><span class="hv-meta hv-end num">4 följs<\/span>/.test(k), k);
  ok("det mätta talet, stort", /<div class="hv-stor"><b class="num">2 av 52<\/b><span>möten uteblev<\/span><\/div>/.test(k), k);
  ok("texten och foten med nästa dom", k.includes('<p class="hv-ftxt">Carl ringer före 10. En annan ändring ser sämre ut.</p>') && /<span class="hv-kfot">Visa översynen<\/span><span class="hv-meta">nästa dom 27 nov<\/span>/.test(k), k);
  const utan = kort(hem({ chef: true, andratKort: { ...AKORT, stort: null, nastaDom: null } }).hvHem(), "Det som ändrats");
  ok("utan mätt tal: inget tal och ingen tom ruta", !utan.includes("hv-stor") && !utan.includes("nästa dom"), utan);
  const tom = kort(hem({ chef: true, andrat: [], andratKort: { foljs: 0, nastaDom: null, stort: null, text: "" } }).hvHem(), "Det som ändrats");
  ok("inget ändrat: bara rubriken och Berätta om en ändring", /<div class="hv-chead"><h2>Det som ändrats<\/h2><\/div>\s*<div class="hv-frad"><span class="hv-kfot">Berätta om en ändring<\/span><\/div>/.test(tom) && !tom.includes("hv-ftxt") && !tom.includes("hv-lugn"), tom);
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
  ok("kvittot och Ångra står under inlägget i tråden", /class="hv-kvitto"[\s\S]*Klart\. Mötet står kvar som det är\.[\s\S]*data-hvangra="f0"/.test(kv), kv.match(/<div class="hv-kvitto"[\s\S]*?<\/div>/)?.[0]);
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
  ok("lagets öppna rader står kvar i genomgången", t.includes("Obekräftade möten i morgon: 3, varav 1 utan val."));

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
  ok("Berätta om en ändring i foten, Pröva med laget på raden som ser bra ut", /<div class="hv-lf"><span class="hv-lbl">Har ni ändrat något som inte syns i Nav\?<\/span><button class="hv-kn hv-hoger" data-hvform="beratta">Berätta om en ändring<\/button><\/div>/.test(a) && /Vi ringer kunden dagen före\.[\s\S]*?<span class="hv-at"><button class="hv-btn" data-hvform="prova">Pröva med laget<\/button><\/span>/.test(a), a.match(/<div class="hv-lf">[\s\S]*?<\/div>/)?.[0]);
  ok("inledningen som i skissen, och huvudet med N följs och nästa dom", a.includes("<p>Jag följer en ändring. <b>Den ser bra ut</b> och går att ta vidare.") && /<h3>Det som ändrats<\/h3><span class="hv-marke">1 följs<\/span><span class="hv-end num">nästa dom 27 nov<\/span>/.test(a), a.slice(a.indexOf("hv-inl"), a.indexOf("hv-inl") + 700));
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
  ok("raderna går att nå med tangentbordet (J, K, E, Enter)", (v.match(/class="hv-sak[^"]*" data-id="/g) || []).length === 5 && html.includes("document.querySelectorAll('.irow, .hv-sak[data-id]')"));
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

rubrik("Skiss 9 exakt: Veckan (punkt 24)");
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
  ok("rubriken som skissen: veckonummer, i kalendern, borta och att få klart", v.includes('<p id="hvArktext">Veckan som kommer, <b>v.47</b>. 3 i kalendern, en borta, två saker att få klart.</p>'), v.match(/<p id="hvArktext">[\s\S]*?<\/p>/)?.[0]);
  ok("fem kolumner", (v.match(/class="hv-vdag/g) || []).length === 5);
  ok("i dag är märkt och öppnar Min dag", /<button class="hv-vdag idagen" data-hvark="dag"><header><b>Mån<\/b><small>i dag<\/small><span>16 nov<\/span><\/header><small>2 i kalendern<\/small>/.test(v), v.match(/<button class="hv-vdag idagen"[\s\S]*?<\/header>/)?.[0]);
  ok("posterna står på sin tid", /<i style="top:5\.9%">09:00 Nordic Grön &amp; Mark<\/i>/.test(v), v.match(/<div class="hv-tid">[\s\S]*?<\/div>/)?.[0]);
  ok("foten: Att få klart i veckan, med en knapp dit", v.includes('<span id="hvFotv">Att få klart i veckan: <b>Ring Solbacken</b> och 1 till</span>') && /<button class="hv-kn" data-view="uppgifter">Öppna Uppgifter<\/button>/.test(v), v.match(/<div class="hv-arkfot"[\s\S]*?<\/div>/)?.[0]);
  ok("inget annat: ingen nästa arbetsdag, ingen kvällsnotis", !v.includes("Nästa arbetsdag") && !v.includes("Kvällsnotisen") && !v.includes("I dag blev"));
  ok("kvällsnotisen hämtas inte längre när Veckan öppnas", !/function hvOppna\([^)]*\)\{[\s\S]{0,700}kvall=1/.test(html));
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
  ok("korten viker undan och frågan står kvar", pa.S.hv.ark === "chatt" && mitt.includes("Hur gick lagets möten förra veckan?") && !mitt.includes('class="hv-card'));
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

  // Ett utkast: Claude förbereder, personen lägger in.
  const u = hem({ chef: false });
  u.ND.hem.chatt = true;
  u.fetch = async () => strom([{ h: "hamtar", text: "Förbereder ett utkast till uppgifter." }, { h: "svar", text: "Jag har förberett två uppgifter.", tal: [], obelagda: 0, kalla: "Skrivet av AI ur Navs tal", utkast: [{ titel: "Ring <b>Hagby</b> Glas", dag: "2026-11-17" }, { titel: "Skicka offerten", dag: null }] }]);
  const skrivet = [];
  u.ndSkriv = async (url, data) => { skrivet.push([url, data]); return skrivet.length === 2 && u.__fall ? { fel: "Uppgiften sparades inte." } : { ok: "Uppgiften är upplagd." }; };
  u.ndSvar = (x) => x;
  const omlast = [];
  u.ndOmlas = (d) => { omlast.push(d); return Promise.resolve(true); };
  u.S.hv.q = "Lägg upp att jag ringer Hagby i morgon";
  await u.hvFraga();
  const ut = u.hvHem();
  ok("utkastet visas med knappen Lägg i min dag, och inget är skapat", ut.includes('data-hvchattlagg="0"') && ut.includes("Lägg i min dag") && ut.includes("Inget är skapat än") && skrivet.length === 0, ut.slice(ut.indexOf("hv-utk"), ut.indexOf("hv-utk") + 500));
  ok("utkastets titel kan inte bli kod, och en uppgift utan dag säger det", ut.includes("Ring &lt;b&gt;Hagby&lt;/b&gt; Glas") && ut.includes("utan dag"));
  u.__fall = true;
  await u.hvChattLagg(0);
  ok("faller den andra uppgiften står knappen kvar", skrivet.length === 2 && u.hvHem().includes('data-hvchattlagg="0"') && omlast.includes("upg"));
  u.__fall = false;
  await u.hvChattLagg(0);
  ok("ett nytt tryck lägger bara in den som saknas", skrivet.length === 3 && skrivet[2][1].titel === "Skicka offerten" && skrivet[2][1].dag === null && skrivet[0][0] === "/nav2/uppgifter" && skrivet[0][1].handling === "skapa" && skrivet[0][1].dag === "2026-11-17", JSON.stringify(skrivet));
  ok("sedan är knappen borta och rutan säger att det är tillagt", !u.hvHem().includes("data-hvchattlagg") && u.hvHem().includes("Tillagt i dina uppgifter"));
  await u.hvChattLagg(0);
  ok("ett tryck till skapar ingenting", skrivet.length === 3);

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
  a.fetch = async () => strom([{ h: "avbojt", text: "Modellen avböjde att svara på det här. Jag svarar som sökrutan i stället." }]);
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
  ok("Nästa att göra är ihopfälld i det nya hemmet, som i skissen", /const min = pillHv\(\) \? !S\.hvPillUt : S\.pillMin;/.test(html) && /if \(d\.pillmin !== undefined && pillHv\(\)\)\{ S\.hvPillUt = !S\.hvPillUt;/.test(html));
  ok("utfälld lyfts den över skrivrutan", /body:has\(\.main\.hvmode\) \.todopill:not\(\.min\)\{bottom:/.test(html));
  const tk = kort(h, "Teamet i november");
  ok("Teamets rubrik får plats på en rad: dagarna står kort", /<span class="hv-meta hv-end num"[^>]*>dag 10 av 21<\/span>/.test(tk) && tk.includes('title="10 av 21 arbetsdagar"'), tk.match(/<div class="hv-chead">[\s\S]*?<\/div>/)?.[0]);
  ok("veckonumret efter datumet", h.includes("Måndag 16 november<small>v.47</small>"));
  ok("Lyssna efter läget, med det gamla hemmets uppläsning", /<button class="hv-lyssna" data-listen[^>]*>[\s\S]*?Lyssna<\/button>/.test(h));
  ok("Teamets rad är skissens: takten och facit i en mening", tk.includes("I samma takt blir det ungefär 40. I oktober sa takten 38, det blev 44.") && !tk.includes("inget löfte"), tk);
  const genv = h.match(/<div class="hv-genv">[\s\S]*?<\/span><\/div>/)?.[0] ?? "";
  ok("genvägarna som i skissen: Min dag, Veckan som kommer, Möten, Min statistik, Mer", /data-hvark="dag"[^>]*>Min dag/.test(genv) && />Veckan som kommer</.test(genv) && /data-go="\/moten"[^>]*>Möten[ <]/.test(genv) && /data-hvmer[^>]*>Mer</.test(genv), genv);
  ok("Förbered står bara när chatten svarar", !genv.includes("data-hvforbered"));
}

rubrik("Skiss 9 exakt: tonen följer Nav (punkt 3)");
{
  ok("ingen egen tonknapp i hemvyn", !/nav2-hvton|hv-tonk|data-hvton|hvTon\b/.test(html));
  const tema = (theme, mork) => { const g = hem({ chef: true }); g.S.theme = theme; g.prfDatornMorkt = () => mork; return g.hvHem().match(/data-hvtema="([^"]*)"/)?.[1]; };
  ok("ljust i Inställningar ger ljust fönster", tema("light", true) === "ljus");
  ok("mörkt i Inställningar ger mörkt fönster", tema("dark", false) === "mork");
  ok("Automatiskt följer datorn", tema("auto", true) === "mork" && tema("auto", false) === "ljus");
  ok("hemmet ritas om när temat byts", /function prfTemaSynk\(\)\{ if \(S\.prfRuta \|\| S\.prfMeny \|\| \(S\.view === 'hem' && hvPa\(\)\)\) render\(\); \}/.test(html));
  ok("och när datorn byter, i läget Automatiskt", /matchMedia\('\(prefers-color-scheme: dark\)'\)\.addEventListener\('change', \(\) => \{ if \(S\.theme === 'auto'\) prfTemaSynk\(\); \}\)/.test(html));
}

rubrik("Skiss 9 exakt: överraden (punkt 1, 2 och 4)");
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
  ok("0/7 på plats med stapeln", h.includes("<b class=\"num\">0<small>/7</small></b>") && h.includes("hv-lgbar"), h.match(/<div class="hv-topp">[\s\S]*?<\/div>/)?.[0]);
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
rubrik("Menyraden går ihop med fönstrets topp (klickprovet 2026-11-16)");
{
  // Rälsen stod top:34px och 100vh − 34px för utkastets provremsa (.proto), som är dold i den riktiga Nav.
  // Rälsen slutade då 34 px under fönstrets överkant. Remsans höjd är nu en variabel som är noll i den riktiga Nav.
  ok("remsans höjd är en variabel: 34 px i utkastet, 0 i den riktiga Nav", /(?:^|[;\s])--proto-h:34px(?:;|\s|$)/.test(regel(":root") ?? "") && /(?:^|;)--proto-h:0px(?:;|$)/.test(regel("body.nd-riktig") ?? ""), regel("body.nd-riktig"));
  ok("rälsen står under remsan och fyller resten av höjden", /position:sticky;top:var\(--proto-h\);height:calc\(100vh - var\(--proto-h\)\)/.test(regel("#rail.rls") ?? "") && /position:sticky;top:var\(--proto-h\);height:calc\(100vh - var\(--proto-h\)\)/.test(regel(".rail") ?? ""));
  ok("den fästa att göra-panelen och hopplänken likaså", /top:var\(--proto-h\)/.test(regel("#todoPanel.pinned") ?? "") && /top:calc\(var\(--proto-h\) \+ 10px\)/.test(regel("#rail .rls-hopp") ?? ""));
  ok("inget annat räknar längre med remsans 34 px på bred skärm", !/(?:top:34px|100vh - 34px\))/.test(html.replace(/\.ol\{height:calc\(100vh - 34px - 64px\)\}/, "")));
}

rubrik("Skiss 9 exakt: hälsningen (punkt 6 och 7)");
{
  ok(".hv-hero p på en rad med gap 10", regel(".hv-hero p") === "display:flex;align-items:center;gap:10px;margin:8px 0 0;font-size:15.5px;color:var(--hv-ink-2);white-space:nowrap;overflow:hidden", regel(".hv-hero p"));
  ok(".hv-hero p>span klipps med …", regel(".hv-hero p>span") === "overflow:hidden;text-overflow:ellipsis", regel(".hv-hero p>span"));
  ok("låg skärm: padding-top 24", /\.hv-hero\{padding-top:24px\}/.test(media("(max-height:700px)")), media("(max-height:700px)"));
}

rubrik("Skiss 9 exakt: korten (punkt 8–12, 20, 39 och 40)");
{
  ok("korten följer innehållet", /min-height:0\}?$/.test(regel(".hv-card")) && !/\.hv-card\{min-height/.test(media("(max-height:700px)")), regel(".hv-card"));
  ok("kortets huvud på baslinjen", regel(".hv-chead") === "display:flex;align-items:baseline;gap:8px;margin-bottom:10px", regel(".hv-chead"));
  ok("Navs märke i huvudet centrerat", regel(".hv-chead .hv-heat.nav") === "align-self:center", regel(".hv-chead .hv-heat.nav"));
  ok("texten 14,5 px, högst 46 tecken bred", regel(".hv-ftxt") === "margin:12px 0 0;font-size:14.5px;line-height:1.5;color:var(--hv-ink-2);max-width:46ch", regel(".hv-ftxt"));
  ok("kortfoten är ink-3, i talkorten ink-2", /color:var\(--hv-ink-3\)/.test(regel(".hv-kfot")) && /color:var\(--hv-ink-2\)/.test(regel(".hv-tal .hv-frad .hv-kfot") || ""), regel(".hv-kfot"));
  ok("raderna 48 px, 44 på låg skärm", /height:48px/.test(regel(".hv-rad")) && /\.hv-rad\{min-height:44px;height:44px\}/.test(media("(max-height:700px)")));
  ok("låg skärm: texten närmare talet", /\.hv-ftxt\{margin-top:8px\}/.test(media("(max-height:700px)")));
  ok("två kolumner först under 860", !media("(max-width:1180px)").includes(".hv-kort") && (html.match(/\.hv-kort\{grid-template-columns:repeat\(2/g) || []).length === 1 && /\.hv-kort\{grid-template-columns:repeat\(2/.test(media("(max-width:860px)")));
  ok("det lugna läget: bock, linje överst, ingen egen höjd", regel(".hv-lugn") === "flex:1;display:flex;align-items:center;gap:10px;color:var(--hv-ink-2);border-top:1px solid var(--hv-line)", regel(".hv-lugn"));
  ok("mörka färger som skissen", /--hv-ink-3:#7C8E86;/.test(regel(".hv")) && /--hv-pop:rgba\(16,31,26,\.84\);/.test(regel(".hv")));
  const lj = regel('.hv[data-hvtema="ljus"]');
  ok("ljusa färger som skissen", /--hv-ink-3:#66746D;/.test(lj) && /--hv-pop:rgba\(255,255,255,\.88\);/.test(lj) && /--hv-signal:#D98A1C;/.test(lj) && /--hv-danger:#C4473C;/.test(lj), lj);
  const tom = kort(hem({ chef: true, rader: [] }).hvHem(), "Väntar på dig");
  ok("Väntar tomt: bock och skissens text", /<div class="hv-lugn"><svg data-i="check"><\/svg>Inget väntar på dig just nu\.<\/div>/.test(tom), tom);
}

rubrik("Skiss 9 exakt: Nästa att göra (punkt 28)");
{
  ok("ihopfälld är den 46 px och står 28 px från kanterna", regel("body:has(.main.hvmode) .todopill.min") === "right:28px;bottom:calc(28px + env(safe-area-inset-bottom,0px));padding:0;width:46px;height:46px;box-shadow:0 0 0 1px rgba(255,255,255,.14),0 8px 22px rgba(19,32,28,.22)", regel("body:has(.main.hvmode) .todopill.min"));
  ok("talet 600 11px", regel("body:has(.main.hvmode) .todopill.min .pmin") === "width:46px;height:46px;font:600 11px var(--f-body)");
  ok("ringen 38 px, 4 px in", regel("body:has(.main.hvmode) .todopill.min .pmin svg") === "inset:4px;width:38px;height:38px");
}

rubrik("Skiss 9 exakt: fönstret, arken och tråden (punkt 29, 30 och 37)");
{
  ok("fönstret är en skärm hög och rullar aldrig själv", /height:100dvh/.test(regel(".hv-fonster")) && /overflow:hidden/.test(regel(".hv-fonster")) && !/min-height:100dvh/.test(regel(".hv-fonster")), regel(".hv-fonster"));
  ok("scenen tar ytan mellan överraden och skrivrutan", regel(".hv-scen") === "flex:1;position:relative;min-height:0;z-index:1", regel(".hv-scen"));
  ok("tråden rullar i sig själv, ända ut till fönstrets kant", /position:absolute;top:-16px;bottom:-123px;left:0;right:0;overflow-y:auto/.test(regel(".hv-trad") || ""), regel(".hv-trad"));
  ok("arkets lista rullar inuti ytan", /overflow-y:auto/.test(regel(".hv-rull") || "") && /overflow:hidden/.test(regel(".hv-arkyta") || ""), regel(".hv-arkyta"));
  ok("ingen klistrad botten längre", !/\.hv-botten\{/.test(html));
  const g = hem({ chef: true });
  const h = g.hvHem();
  const scen = h.slice(h.indexOf('class="hv-scen"'), h.indexOf("data-hvskriv"));
  ok("på hemmet ligger genvägarna i scenen och skrivrutan efter den", scen.includes('class="hv-genv"') && h.indexOf('class="hv-scen"') < h.indexOf("data-hvskriv"));
  g.hvOppna("vantar");
  const a = g.hvHem();
  // Klickprovet 2026-11-16: Navs kbd-ruta gav esc ram och luft (knappen 102 px mot skissens 88), och raden var 30 px
  // mot skissens 34 (märket står i ett block som är 34 högt), så arket började 4 px för högt.
  ok("Stäng esc: esc är ren mono-text som i skissen, ingen ruta", /^font-family:var\(--f-mono\);padding:0;border:0;border-radius:0;background:none$/.test(regel(".hv-arkhuvud kbd") ?? ""), regel(".hv-arkhuvud kbd"));
  ok("arkhuvudet är 34 px högt med märket överst, som skissen", /grid-template-rows:minmax\(34px,auto\)/.test(regel(".hv-arkhuvud") ?? "") && regel(".hv-arkhuvud>svg") === "align-self:start", regel(".hv-arkhuvud"));
  ok("ett ark har Navs märke, texten och Stäng esc",/<div class="hv-arkhuvud"><svg data-nav="28"><\/svg><p id="hvArktext">[\s\S]*?<\/p><button class="hv-kn" data-hvstang>Stäng <kbd class="hv-mono">esc<\/kbd><\/button><\/div>/.test(a), a.match(/<div class="hv-arkhuvud">[\s\S]*?<\/div>/)?.[0]);
  ok("arkets yta är glas i full bredd", a.includes('<div class="hv-arkyta hv-glass">'));
  ok("i ett ark syns inga genvägar, men skrivrutan", !a.includes('class="hv-genv"') && a.includes("data-hvskriv"));
  ok("det gamla ‹ Hem finns inte", !/hv-arktopp|hv-bak/.test(html));
  const t = hem({ chef: true });
  t.hvOppna("team"); t.hvOppna("andrat");
  const th = t.hvHem();
  ok("Teamet och sedan Ändrat ligger båda i tråden, i den ordningen", t.S.hv.trad.map((x) => x.sort).join() === "team,andrat" && th.indexOf('data-hvinl="team"') < th.indexOf('data-hvinl="andrat"'), t.S.hv.trad.map((x) => x.sort).join());
  ok("överst i tråden: ← Hem och hur mycket som brinner", /<div class="hv-rumtop"><button class="hv-kn" data-hvstang><svg[^>]*>[\s\S]*?<\/svg>Hem<\/button><button class="hv-kn" data-hvstang><i><\/i><span>2 brinner<\/span><\/button><\/div>/.test(th), th.match(/<div class="hv-rumtop">[\s\S]*?<\/div>/)?.[0]);
  t.hvStang();
  ok("Hem tömmer inte tråden", t.S.hv.ark === null && t.S.hv.trad.length === 2 && !t.hvHem().includes("hv-rumtop"));
  const lugn = hem({ chef: true, rader: [] }); lugn.hvOppna("team");
  ok("inget som brinner: grön prick och Inget brinner", /<i style="background:var\(--hv-brand\)"><\/i><span>Inget brinner<\/span>/.test(lugn.hvHem()));
  ok("Escape går hem från tråden när rutan är tom", /if \(e\.key === 'Escape' && S\.hv\.ark && !hvOvanpa\(\) && !String\(S\.hv\.q \|\| ''\)\.trim\(\)\)/.test(html));
}

rubrik("Skiss 9 exakt: genvägarna och Mer (punkt 21, 22 och F2)");
{
  const pa = hem({ chef: true }); pa.ND.hem.chatt = true;
  const gv = pa.hvHem().match(/<div class="hv-genv">[\s\S]*?<\/span><\/div>/)?.[0] ?? "";
  ok("chatten på och ett möte kvar i dag: Förbered först, med märket", /^<div class="hv-genv"><button class="hv-chip hv-fraga" data-hvforbered="Förbered mitt möte 11\.00 med PEGU Byggservice"><span><svg data-nav="15"><\/svg><\/span><span>Förbered 11\.00 med PEGU<\/span><\/button>/.test(gv), gv.slice(0, 300));
  const inget = hem({ chef: true }); inget.ND.hem.chatt = true; inget.ndHemKal = () => [];
  ok("inget möte kvar: Vem ska jag ringa nu?", /data-hvforbered="Vem ska jag ringa nu\?"><span><svg data-nav="15"><\/svg><\/span><span>Vem ska jag ringa nu\?<\/span>/.test(inget.hvHem()));
  ok("chatten av: ingen av dem", !hem({ chef: true }).hvHem().includes("data-hvforbered"));
  const moten = (g, n) => Object.assign(g, { moSyns: () => true, ndMo: () => ({ kort: Array.from({ length: n + 2 }, (_x, i) => ({ v: i < n })) }), moAtt: (k) => k.v, moUtfall: () => false, moFoljIdag: () => false });
  const m = moten(hem({ chef: true }), 7);
  ok("Möten bär talet som Möten har i menyn", /data-go="\/moten">Möten <small class="num">7<\/small><\/button>/.test(m.hvHem()), m.hvHem().match(/data-go="\/moten">[^<]*(<small[^<]*<\/small>)?/)?.[0]);
  const m0 = moten(hem({ chef: true }), 0);
  ok("inget tal när inget väntar", /data-go="\/moten">Möten<\/button>/.test(m0.hvHem()));
  ok("talet är menyns tal", /function hvMotenTal\(\)\{ return typeof moSyns === 'function' && moSyns\(\) \? ndMo\(\)\.kort\.filter\(k => moAtt\(k\) \|\| moUtfall\(k\) \|\| moFoljIdag\(k\)\)\.length : 0; \}/.test(html));
  const g = hem({ chef: true }); g.S.hv.mer = true;
  const mer = g.hvHem().match(/<div class="hv-mer[\s\S]*?<\/div>/)?.[0] ?? "";
  ok("Mer har Golvet, Teamet i november och Coachning", /data-hvark="golvet">Golvet</.test(mer) && /data-hvark="team">Teamet i november</.test(mer) && /data-hvark="coachning">Coachning</.test(mer) && !/data-go=/.test(mer), mer);
  g.hvOppna("coachning");
  ok("Coachning öppnas i tråden", g.S.hv.trad.some((x) => x.sort === "coachning") && g.hvHem().includes('data-hvinl="coachning"'));
  const s = hem({ chef: false }); s.S.hv.mer = true;
  const smer = s.hvHem().match(/<div class="hv-mer[\s\S]*?<\/div>/)?.[0] ?? "";
  ok("säljaren har inget Teamet i Mer när laget inte går att läsa", !/data-hvark="team"/.test(smer) && /data-hvark="coachning"/.test(smer), smer);
}

rubrik("Skiss 9 exakt: skrivrutan, Bifoga, Tala och tipset (punkt 25–27)");
await (async () => {
  const g = hem({ chef: true }); g.ND.hem.chatt = true;
  const sk = g.hvSkriv();
  ok("platshållaren är skissens", sk.includes('placeholder="Fråga Nav eller be om något…"'));
  ok("raden: Bifoga, tipset, Skicka", /<div class="hv-srad"><button type="button" class="hv-ikonk" data-hvbifoga aria-label="Bifoga"><svg[^>]*>[\s\S]*?<\/svg><\/button><button type="button" class="hv-tips" data-hvtips>Prova: Vad måste jag göra för att sälja mer\?<\/button><button class="hv-send" aria-label="Skicka">/.test(sk), sk);
  ok("filväljaren tar bilder och PDF", /<input type="file" id="hvFil" hidden multiple accept="image\/png,image\/jpeg,image\/webp,application\/pdf" data-hvfil>/.test(sk));
  ok("utan taligenkänning ingen Tala", !sk.includes("data-hvtala"));
  g.window.webkitSpeechRecognition = function () {};
  ok("med taligenkänning finns Tala", /<button type="button" class="hv-ikonk" data-hvtala aria-label="Tala" aria-pressed="false">/.test(g.hvSkriv()));
  ok("raden börjar 8 px ut, som i skissen", regel(".hv-srad") === "display:flex;align-items:center;gap:6px;margin-top:8px;margin-left:-8px");
  ok("tipset syns bara på hemmet", /\.hv:not\(\[data-hvlage="hem"\]\) \.hv-tips\{visibility:hidden\}/.test(html));
  g.S.hv.bilagor = [{ sort: "image/png", namn: "bild <1>.png", data: "AAAA" }];
  ok("en bilaga står som ett chip med ×", /<div class="hv-bilagor"><span class="hv-bil">bild &lt;1&gt;\.png<button type="button" data-hvbilx="0" aria-label="Ta bort bild &lt;1&gt;\.png">×<\/button><\/span><\/div>/.test(g.hvSkriv()), g.hvSkriv());
  // Tipset frågar chatten.
  const hamtat = [];
  g.fetch = async (url, o) => { hamtat.push(JSON.parse(o.body)); return { ok: false, status: 500, headers: { get: () => "application/json" }, json: async () => ({}) }; };
  g.hvKlick({ target: { closest: () => ({ dataset: { hvtips: "" } }) }, preventDefault() {}, stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 0));
  ok("tipset ställer frågan, med bilagan", hamtat[0]?.fraga === "Vad måste jag göra för att sälja mer?" && hamtat[0]?.bilagor?.length === 1, JSON.stringify(hamtat[0] ?? {}).slice(0, 200));
  ok("bilagan är skickad och borta ur rutan", (g.S.hv.bilagor || []).length === 0);
  ok("för stor fil: ett besked och inget läggs till", /function hvLaggFiler\(filer\)/.test(html) && /högst 3 MB/.test(html));
})();

rubrik("Skiss 9 exakt: hela listan bakom Väntar på dig (punkt 31–33)");
{
  const g = hem({ chef: true }); g.hvOppna("vantar");
  const a = g.hvHem();
  ok("rubriken som skissen: Fem saker väntar på dig. Två saker brinner.", a.includes('<p id="hvArktext">Fem saker väntar på dig. <b>Två saker brinner.</b></p>'), a.match(/<p id="hvArktext">[\s\S]*?<\/p>/)?.[0]);
  ok("grupperna Nu, Senare i dag och Kan vänta, med antal", /<div class="hv-grupp">Nu<small class="num">2<\/small><\/div>/.test(a) && /<div class="hv-grupp">Senare i dag<small class="num">1<\/small><\/div>/.test(a) && /<div class="hv-grupp">Kan vänta<small class="num">2<\/small><\/div>/.test(a));
  ok("en rad per sak: punkt, text, varför och knapp", /<div class="hv-sak" data-id="r1"><i class="hv-heat hot" aria-hidden="true"><\/i><div><b>Carl är sjukanmäld<\/b><small>Sjuk sedan i dag. Ingen har bekräftat<\/small><\/div><button class="hv-btn" data-hvgor="r1">Bekräfta<\/button><\/div>/.test(a), a.match(/<div class="hv-sak"[\s\S]*?<\/div><button[\s\S]*?<\/button><\/div>/)?.[0]);
  ok("foten: Alla uppgifter, till Uppgifter", /<span class="hv-end"><button class="hv-kn" data-view="uppgifter">Alla uppgifter<\/button><\/span>/.test(a));
  ok("ingen tid när något som brinner saknar uppskattning", !a.includes("tar ungefär"));
  ok("inget Lyssna, ingen Sedan du tittade, ingen radmeny", !a.includes("data-listen") && !a.includes("I natt och i morse") && !a.includes("data-hvmeny") && !a.includes("Stämmer inte"));
  const m = hem({ chef: true, rader: [
    { id: "upg-7", nar: "nu", heat: 5, bkind: "uppgift", t: "Ring Mälarö", why: "Frist i dag", act: { l: "Klar", check: true } },
    { id: "upg-8", nar: "nu", heat: 4, bkind: "uppgift", t: "Skicka offert", why: "Frist i dag", act: { l: "Klar", check: true } },
  ] });
  m.TASKS = [{ id: "7", est: 10, ndNytt: [] }, { id: "8", est: 15, ndNytt: [] }];
  m.hvOppna("vantar");
  ok("när allt som brinner har en uppskattning: tiden står i foten", m.hvHem().includes('<span id="hvFotv">Det som brinner tar ungefär 25 min.</span>'), m.hvHem().match(/<span id="hvFotv">[\s\S]*?<\/span>/)?.[0]);
  const tom = hem({ chef: true, rader: [] }); tom.hvOppna("vantar");
  ok("tom lista: Inget väntar på dig just nu.", tom.hvHem().includes('<p id="hvArktext">Inget väntar på dig just nu.</p>') && /hv-rull hv-tom[\s\S]*Inget väntar på dig just nu\./.test(tom.hvHem()));
  ok("radmenyns CSS krockar inte med Mer", !/\.hv-mer\{width:30px/.test(html));
}

rubrik("Skiss 9 exakt: Min dag (punkt 23)");
{
  const P = (x) => ({ moten: [], uppgifter: [], nu: 581, start: 480, slut: 1020, rast: 60, ...x });
  const g0 = hem({ chef: true });
  const p1 = g0.hvPlaneraDag(P({ moten: [{ a: 540, b: 570, namn: "Nordic" }, { a: 590, b: 620, namn: "Möte" }], uppgifter: [{ id: "u1", namn: "A", min: 5, brinner: true }, { id: "u2", namn: "B", min: 20 }] }));
  ok("mötena står på sina tider, uppgifterna läggs i luckorna efter nu", JSON.stringify(p1.rader.map((r) => [r.a, r.b, r.typ])) === JSON.stringify([[540, 570, "mote"], [581, 586, "upg"], [590, 620, "mote"], [620, 640, "upg"]]), JSON.stringify(p1.rader.map((r) => [r.a, r.b, r.typ])));
  ok("luften: slut − nu − rast − det som är kvar", p1.luft === 1020 - 581 - 60 - 30 - 25, p1.luft);
  const p2 = g0.hvPlaneraDag(P({ uppgifter: [{ id: "u1", namn: "A", min: 600 }] }));
  ok("en uppgift som inte ryms före slut ligger inte i dagen", p2.rader.length === 0 && p2.ryms === false && p2.luft < 0);
  const p3 = g0.hvPlaneraDag(P({ uppgifter: [{ id: "u1", namn: "A", min: null }] }));
  ok("en uppgift utan tid: ingen luft", p3.utanTid.length === 1 && p3.luft === null);
  ok("utan schema: ingen luft", g0.hvPlaneraDag(P({ start: null, slut: null })).luft === null);

  const g = hem({ chef: true, rader: [
    { id: "upg-7", nar: "nu", heat: 5, bkind: "uppgift", t: "Ring Mälarö", why: "Frist i dag", act: { l: "Klar", check: true } },
    { id: "upg-8", nar: "idag", heat: 2, bkind: "uppgift", t: "Skicka offert", why: "Frist i dag", act: { l: "Klar", check: true } },
    { id: "r5", nar: "vanta", heat: 1, bkind: "utbildning", t: "Kursen", why: "Del 2", act: { l: "Öppna" } },
  ] });
  g.TASKS = [{ id: "7", est: 5, ndNytt: [] }, { id: "8", est: 20, ndNytt: [] }];
  g.now = () => 581;
  g.ndHemKal = () => [{ s: 540, e: 570, t: "Nordic Grön & Mark" }, { s: 660, e: 705, t: "PEGU Byggservice" }, { s: 810, e: 855, t: "Veckomöte" }];
  g.ND.hem.dag = { start: 480, slut: 1020, rast: 60 };
  g.ND.hem.chatt = true;
  ok("Min dag öppnar arket", /<button class="hv-chip" data-hvark="dag">Min dag<\/button>/.test(g.hvHem()));
  g.hvOppna("dag");
  const a = g.hvHem();
  ok("rubriken: möten kvar, saker som väntar och luften", a.includes('<p id="hvArktext">Två möten kvar och två saker som väntar. <b>Allt ryms, med 4 h 24 min över.</b></p>'), a.match(/<p id="hvArktext">[\s\S]*?<\/p>/)?.[0]);
  ok("stapeln och skalan 08–17", a.includes('<div class="hv-dbar">') && /<div class="hv-dskala">(<span[^>]*>\d\d<\/span>){10}<\/div>/.test(a));
  ok("strecket nu", /<u style="left:18\.7%"><\/u>/.test(a), a.match(/<u style="[^"]*"><\/u>/)?.[0]);
  ok("en rad per sak, nästa markerad, nu-linjen", /<div class="hv-dnu">09:41 nu<\/div>/.test(a) && /class="hv-drad upg nast het"/.test(a) && /class="hv-drad mote forbi"/.test(a));
  ok("nästa möte kan förberedas", /data-hvforbered="Förbered mitt möte 11\.00 med PEGU Byggservice">Förbered<\/button>/.test(a));
  ok("foten: det som kan vänta, och Boka tiden i kalendern", a.includes('<button class="hv-lank" data-hvark="vantar">En sak kan vänta och ligger inte i dag</button>') && a.includes('<button class="hv-kn" data-hvboka>Boka tiden i kalendern</button>'));

  // Klickprovet 2026-11-16: klockan har sekunder (now() = 498,8), och raden stod "om 41.19933333333336 min".
  const s = hem({ chef: true, rader: [] });
  s.now = () => 618.8;
  s.ndHemKal = () => [{ s: 660, e: 705, t: "PEGU Byggservice" }, { s: 810, e: 855, t: "Veckomöte" }];
  s.ND.hem.dag = { start: 480, slut: 1020, rast: 60 };
  s.hvOppna("dag");
  const sa = s.hvHem();
  ok("med sekunder i klockan: hela minuter till nästa", sa.includes("<small>om 41 min</small>"), sa.match(/<small>om [^<]*<\/small>/)?.[0]);
  ok("och hela minuter i luften", sa.includes("<b>Allt ryms, med 4 h 11 min över.</b>"), sa.match(/<b>Allt ryms[^<]*<\/b>/)?.[0]);
}

rubrik("Skiss 9 exakt: Teamet i månaden (punkt 16 och 34–36)");
{
  const RAD = (x) => ({ id: "p", namn: "X Prov", fornamn: "X", mal: 12, order: 7, status: "Före sitt mål", led: ["n", null, "u", "n", "u"], orsak: null, forklaring: "Bokade möten: över sitt eget spann två veckor i rad.", kommentar: null, ...x });
  const g = hem({ chef: true });
  g.S.hv.data.team = { team: { kort: TEAM, utrakning: "19 order på 10 arbetsdagar, gånger månadens 21 arbetsdagar, blir ungefär 40.", personer: [{ id: "p1", namn: "Carl Prov", bokade: 8, hallna: 5, uteblivna: 1, order: 6 }], oppna: null, takten: [], serInte: "Det här ser jag inte: order som inte är inlagda i Nav.", kalla: "Räknat av regler",
    rader: [RAD({ id: "p1", namn: "Carl Prov", fornamn: "Carl" }), RAD({ id: "p2", namn: "Edvin Prov", fornamn: "Edvin", mal: 11, order: 4, status: "Efter sitt mål", led: ["n", null, "n", "d", "n"], orsak: "Möten uteblir", forklaring: "Ringer och bokar som vanligt. 9 av 20 möten uteblev, mot 5 av 40 före. Varför vet jag inte." }), RAD({ id: "p3", namn: "Mick Prov", fornamn: "Mick", mal: null, order: 2, status: null, led: [null, null, null, null, null], forklaring: "Inget sticker ut." })],
    saknarUtfall: 3, tillMalet: { kvar: 27, dagar: 11, perDag: 2.5, hittills: 1.9 } } };
  g.hvOppna("team");
  const t = g.hvHem();
  ok("inledningen: läget, takten och hur många som ligger efter", t.includes("<p>Laget har <b>19 av 46 order</b> efter 10 av 21 arbetsdagar, och 1 är makulerad. I samma takt blir det ungefär 40. Det är en uträkning på takten, inget löfte. En ligger efter sitt mål.</p>"), t.match(/<p>Laget har[\s\S]*?<\/p>/)?.[0]);
  ok("mätaren och skalan med takten och målet", t.includes("hv-matare hv-bred") && /<b>19<\/b> order<\/span><span[^>]*><b>≈40<\/b> i samma takt · <b>46<\/b> mål/.test(t));
  ok("en rad per person med kedjan i fem led", (t.match(/class="hv-tr[ "]/g) || []).length === 3 && /<span class="hv-kedja"><i class="" title="Samtal: som vanligt"><\/i><i class="" title="Svar: ser jag inte"><\/i><i class="upp" title="Bokade möten: över sitt eget spann"><\/i>/.test(t), t.match(/<span class="hv-kedja">[\s\S]*?<\/span>/)?.[0]);
  ok("eget mål: 7 av 12 och läget", /<span class="o num">7 av 12<\/span><span class="l"><b>Före sitt mål<\/b><\/span>/.test(t));
  ok("orsaken står efter läget, och raden är utfälld med förklaringen", /class="hv-tr oppen"[^>]*>[\s\S]*?<b>Efter sitt mål<\/b> · Möten uteblir[\s\S]*?9 av 20 möten uteblev, mot 5 av 40 före\. Varför vet jag inte\./.test(t));
  ok("utan eget mål: bara antalet, inget läge", /<span class="o num">2<\/span><span class="l"><\/span>/.test(t));
  ok("kedjans förklaring", t.includes("Kedjan: samtal · svar · bokade · hållna · order. Färg = utanför eget spann två veckor i rad."));
  ok("det Nav inte ser, och mötena utan utfall", /Det här ser jag inte: vad som sägs i samtalen, och om ett samtal blev besvarat\. 3 möten saknar utfall\.<\/span><button data-go="\/moten">Visa dem<\/button>/.test(t));
  ok("facit: takten sa och det blev, efter lika många dagar", /<h3>Så har takten träffat<\/h3><span class="hv-marke">Facit<\/span><span class="hv-end num">efter 10 arbetsdagar<\/span>/.test(t) && /<div>Takten sa 38<small>Det blev 44<\/small><\/div><span class="hv-kr num">6 fler<\/span>/.test(t));
  ok("Till målet, med decimalkomma", t.includes("<b>Till målet.</b> 27 order på 11 arbetsdagar, ungefär 2,5 om dagen. Hittills har det varit 1,9 om dagen."));
  ok("Visa underlaget fäller ut antalen per person", t.includes("data-hvunderlag") && !t.includes("Uteblivna</span>"));
  g.S.hv.underlag = true;
  ok("underlaget: bokade, hållna, uteblivna och order per person", /Uteblivna<\/span>/.test(g.hvHem()) && g.hvHem().includes("Carl Prov"));
  ok("inget facit per val längre", !t.includes("Navs facit per val") && !/hvHamtaFacit\(\)/.test(html));
  const k = kort(hem({ chef: true, team: { ...TEAM, mal: null, text: { ...TEAM.text, stort: "19 order", malrad: "Inget mål satt för november." } } }).hvHem(), "Teamet i november");
  ok("kortet utan mål: bara antalet, ingen rad om målet", /<b class="num">19<\/b><span>order<\/span>/.test(k) && !k.includes("Inget mål satt") && !k.includes("hv-matare"), k);
}

rubrik("Skiss 9 exakt: mobil som Claude (punkt 41, F6)");
{
  const M = media("(max-width:860px)");
  const mob = (sel) => M.match(new RegExp(`[\\s}]${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\{([^}]*)\\}`))?.[1] ?? "";
  ok("fönstret: 100dvh kvar, kant 16 och ingen luft under skrivrutan", mob(".hv-fonster") === "padding:10px 16px 0", mob(".hv-fonster"));
  ok("skrivrutan längst ned i full bredd, bara övre hörnen rundade, säker kant", mob(".hv-skriv") === "max-width:none;width:auto;margin:6px -16px 0;border-radius:20px 20px 0 0;border-bottom:0;padding:12px 12px calc(10px + env(safe-area-inset-bottom)) 16px", mob(".hv-skriv"));
  ok("skrivfältet 16 px, så att telefonen inte zoomar", mob(".hv-skriv textarea") === "font-size:16px", mob(".hv-skriv textarea"));
  ok("genvägarna i en rad som går att svepa", /^overflow-x:auto;flex-wrap:nowrap;justify-content:flex-start;scrollbar-width:none;/.test(mob(".hv-genv")), mob(".hv-genv"));
  ok("genvägarnas rad går ut till kanten", /margin:0 -16px;padding:12px 16px 2px/.test(mob(".hv-genv")), mob(".hv-genv"));
  ok("ingen rullist under genvägarna", mob(".hv-genv::-webkit-scrollbar") === "display:none");
  ok("chippen krymper inte", /flex:none/.test(mob(".hv-chip")), mob(".hv-chip"));
  ok("Mer fälls ut i samma rad, inte som en ruta som klipps", mob(".hv-merv") === "display:contents" && mob(".hv-genv .hv-mer") === "position:static;flex-direction:row;gap:8px;min-width:0;padding:0;background:none;border:0;box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none", mob(".hv-genv .hv-mer"));
  ok("Mers val ser ut som chippen", /^flex:none;height:32px;padding:0 13px;border-radius:12px;/.test(mob(".hv-genv .hv-mer button")), mob(".hv-genv .hv-mer button"));
  ok("korten två och två, som på datorn fast mindre", mob(".hv-kort") === "grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:14px", mob(".hv-kort"));
  ok("korten: mindre kant och radie", mob(".hv-card") === "padding:11px 12px 10px;border-radius:14px", mob(".hv-card"));
  ok("rubriken 12 px", mob(".hv-chead h2") === "font-size:12px" && mob(".hv-chead") === "margin-bottom:6px;gap:6px");
  ok("det stora talet 34 px", mob(".hv-stor b") === "font-size:34px" && mob(".hv-stor span") === "font-size:12.5px" && mob(".hv-stor") === "gap:4px;margin-top:2px");
  ok("Väntar: rader 32 px, utan knappar", mob(".hv-rad") === "grid-template-columns:8px minmax(0,1fr);gap:8px;height:32px;min-height:32px" && mob(".hv-rad>b") === "font-size:13px" && mob(".hv-rad .hv-btn") === "display:none");
  ok("texten högst tre rader", mob(".hv-ftxt") === "margin-top:6px;font-size:12.5px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden", mob(".hv-ftxt"));
  ok("foten och knappen mindre", mob(".hv-frad") === "gap:8px;padding-top:8px;flex-wrap:wrap" && mob(".hv-frad .hv-btn") === "min-height:28px;padding:0 10px;font-size:12px" && mob(".hv-kfot") === "padding-top:6px;font-size:11.5px");
  ok("hälsningen mindre, fortfarande en rad", mob(".hv-hero") === "padding:14px 2px 0" && mob(".hv-hero h1") === "font-size:26px" && mob(".hv-hero p") === "margin-top:6px;font-size:13.5px");
  ok("hemmet rullar om det inte ryms", mob(".hv-hemlager") === "overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none");
  ok("Veckan blir en lista per dag", mob(".hv-vecka") === "grid-template-columns:1fr;gap:8px;overflow-y:auto;align-content:start" && mob(".hv-tid") === "min-height:0;margin:4px 0 0;border-left:0;display:flex;flex-direction:column;gap:4px" && mob(".hv-tid i") === "position:static;white-space:normal");
  ok("arket: mindre kant, inget esc", mob(".hv-arkyta") === "padding:14px" && mob(".hv-arkhuvud kbd") === "display:none");
  ok("tråden under skrivrutan", mob(".hv-trad") === "top:-10px;bottom:-96px" && mob(".hv-tcol") === "padding:52px 0 120px");
  ok("gamla mobilreglerna borta: en kolumn och 96 px luft", !M.includes("grid-template-columns:1fr;gap:12px;margin-top:20px") && !M.includes("padding:14px 16px 96px"));
  // Som i Claude: ingen flikrad nere, en menyknapp uppe till vänster som öppnar Navs meny.
  ok("Navs flikrad döljs på hemmet i telefonen, menyknappen syns", /@media \(max-width:900px\)\{body:has\(\.main\.hvmode\) \.bnav\{display:none\}\.hv-meny\{display:inline-grid\}\}/.test(html));
  ok("menyknappen är dold på datorn", regel(".hv-meny") === "display:none;place-items:center;width:36px;height:36px;margin-left:-8px;border-radius:10px;color:var(--hv-ink)", regel(".hv-meny"));
  const g = hem({ chef: true });
  const h = g.hvHem();
  ok("menyknappen först i överraden", /<div class="hv-topp"><button class="hv-meny" data-rlsmer aria-haspopup="dialog" aria-expanded="false" aria-label="Meny"><svg/.test(h), h.slice(h.indexOf("hv-topp") - 12, h.indexOf("hv-topp") + 200));
  g.S.rlsMer = true;
  ok("menyknappen säger när menyn är öppen", g.hvHem().includes('class="hv-meny" data-rlsmer aria-haspopup="dialog" aria-expanded="true"'));
  ok("ikonen: två streck", /P\.hvmeny = '<path d="M4 8h16M4 16h16"\/>';/.test(html));
  ok("menyn stängs med fokus på den knapp som syns", /function rlsArkStang\(\)\{ S\.rlsMer = false; rlsArkRita\(\); const m = \[\.\.\.document\.querySelectorAll\('\[data-rlsmer\]'\)\]\.find\(b => b\.offsetParent\);/.test(html));
  ok("Mer rullar fram de nya valen i raden", /if \(d\.hvmer !== undefined\)\{ S\.hv\.mer = !S\.hv\.mer; render\(\); if \(S\.hv\.mer\) requestAnimationFrame\(\(\) => \{ const r = document\.querySelector\('\.hv-genv'\); if \(r && r\.scrollWidth > r\.clientWidth\) r\.scrollLeft = r\.scrollWidth; \}\); return; \}/.test(html));
}

rubrik("Skiss 9 exakt: menyraden (punkt 42)");
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

rubrik("Menyraden exakt som skissen, utfälld och smal (klickprovet 2026-11-16, skissen rad 53–113)");
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


console.log(fel ? `\n\x1b[31m${fel} prov föll.\x1b[0m` : "\n\x1b[32mAlla prov gick igenom.\x1b[0m");
process.exit(fel ? 1 : 0);
