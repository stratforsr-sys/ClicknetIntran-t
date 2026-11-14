#!/usr/bin/env node
/**
 * Uppgifter i Nav 2.0: kollegan i uppgiften (0298, beställaren 2026-11-13; rutan omgjord 2026-11-14).
 *
 * Provet läser modulblocket UPPGIFTER ur utkastet och kör det i en sandlåda där
 * utkastets egna funktioner är attrapper, som tests/nav2-uppgifter-lage.mjs.
 *
 *   node tests/nav2-uppgift-kollega.mjs
 *
 * Det provet svarar på:
 *   1. rutan ritar vilka som är med, vem som har bollen, och bara de knappar
 *      servern sagt att den inloggade får (`kan`),
 *   2. varje knapp skickar rätt handling till /nav2/uppgifter,
 *   3. "Sluta följa" skickar `lamna` utan person (H2),
 *   4. beskrivningen skickar texten den utgick från (H15),
 *   5. historiken läser som en mening när någon lades till eller flyttade.
 */
import { readFileSync } from "node:fs";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const html = readFileSync(process.env.UTKAST ?? new URL("../src/nav2/utkast.html", import.meta.url), "utf8");
const block = html.match(/\/\* =+\n {3}NAV 2\.0 I RIKTIGT LÄGE: UPPGIFTER[\s\S]*?NDKOPPLAD\.add\('uppgifter'\); \}/)?.[0];
ok("modulblocket UPPGIFTER finns i utkastet", !!block);
if (!block) process.exit(1);

const plus = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const dow = (d) => ((new Date(d + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;

const KAN_AGARE = { laggaTill: true, styra: true, lamna: false, passa: true };
const KAN_MED = { laggaTill: true, styra: false, lamna: true, passa: true };
const KAN_SER = { laggaTill: false, styra: false, lamna: true, passa: false };

function uppgift(id, over = {}) {
  return {
    id, lage: "ej_paborjad", vy: "egen", t: "Uppgift " + id, due: "2026-11-13", tid: null, est: null, prio: 3, klarAt: null,
    links: [], proj: null, delar: [], granskare: null, ansvarig: "Zen Test", serie: null, besk: "Gammal text",
    skapadAv: "Zen Test", skapadAt: "2026-11-10T08:00:00Z", stilla: 0, minRoll: null, handelser: [],
    med: [], bollenId: "mig", skapareId: "mig", delad: false, kan: KAN_AGARE, klarAv: null, farRed: true, farStryk: true,
    ...over,
  };
}

const UPPGIFTER = () => [
  // Min egen, ingen annan med.
  uppgift("egen"),
  // Min, Simon är med.
  uppgift("delad", { delad: true, med: [{ id: "simon", namn: "Simon Ek", roll: "redigerare" }], delar: [["Hitta numret", true, "d1", "Simon"], ["Ring", false, "d2", null]],
    handelser: [
      { typ: "skapad", av: "Zen Test", avId: "mig", note: null, at: "2026-11-10T08:00:00Z" },
      { typ: "krets", av: "Zen Test", avId: "mig", note: "la till Simon Ek", at: "2026-11-10T08:01:00Z" },
      { typ: "andrad", av: "Simon Ek", avId: "simon", note: "flyttade till mån 16 nov", at: "2026-11-11T09:00:00Z" },
      { typ: "tilldelad", av: "Simon Ek", avId: "simon", note: "passade till Zen Test", at: "2026-11-11T09:05:00Z" },
    ] }),
  // Simons, jag är med.
  uppgift("simons", { delad: true, ansvarig: "Simon Ek", bollenId: "simon", skapareId: "simon", skapadAv: "Simon Ek", minRoll: "redigerare",
    med: [{ id: "mig", namn: "Zen Test", roll: "redigerare" }], kan: KAN_MED, farStryk: false }),
  // Simons, jag kan bara se.
  uppgift("ser", { vy: "delat", ansvarig: "Simon Ek", bollenId: "simon", skapareId: "simon", minRoll: "visare",
    med: [{ id: "mig", namn: "Zen Test", roll: "visare" }], kan: KAN_SER, farRed: false, farStryk: false }),
  // Jag la upp den åt Simon och är inte med själv (Väntar på andra).
  uppgift("vantar", { vy: "vantar", ansvarig: "Simon Ek", bollenId: "simon", skapareId: "mig" }),
  // En förekomst i en rutin.
  uppgift("rutin", { serie: "Varje fredag" }),
];

function varld() {
  const skickat = [];
  const lyssnare = [];
  const g = {
    ND: { jag: { id: "mig", namn: "Zen Test" }, uppgifter: {
      uppgifter: UPPGIFTER(), projekt: [], mallar: [], kollegor: ["Simon Ek", "Anna Berg", "Simon Lind"], klara: [], fokus: [], forstaSteg: {},
      personer: [{ id: "simon", namn: "Simon Ek" }, { id: "anna", namn: "Anna Berg" }, { id: "simon2", namn: "Simon Lind" }], skriv: true,
    } },
    TASKS: [], PROJEKT: {}, MALLAR: [], KOLLEGOR: [], MOTEN: {}, HIST: {}, KLARA_FORR: {}, S: { view: "uppgifter" }, NDKOPPLAD: new Set(),
    NAR_VAL: [],
    role: () => "saljare", kIdag: () => "2026-11-13", frKort: (d) => d, frPlus: plus, frDow: dow, isDone: (t) => t.lage === "klar",
    ndMandag: (d) => { let x = d; while (dow(x) !== 1) x = plus(x, -1); return x; },
    toast: () => {}, render: () => {}, esc: (s) => String(s), I: () => "", avatar: (n) => `<span class="av">${String(n)[0]}</span>`,
    ndSkriv: async (url, data) => { skickat.push({ url, data }); return { ok: true, status: 200, data: { ok: "Sparat." } }; },
    ndSvar: (s) => s.data, ndSkrivFel: () => {}, ndOmlas: () => Promise.resolve(true),
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location: { reload: () => {} },
    document: { addEventListener: (typ, fn) => lyssnare.push([typ, fn]), getElementById: () => null, hidden: false, activeElement: null },
    // Utkastets ruta, så som den ser ut där modulen byter i den.
    upgRutaHtml: (t) =>
      `<p class="upg-rstatus"><span class="upg-dot ">Ej påbörjad</span></p><ul class="sub upg-sub">${t.delar.map(([x, k]) => `<li><span class="${k ? "st" : ""}">${x}</span></li>`).join("")}</ul>` +
      `<ul class="upg-hist"></ul><div class="upg-chat"></div><dl class="upg-props"><div class="upg-prad"><dt>Ansvarig</dt><dd>${t.ansvarig}</dd></div></dl>` +
      `<footer><button type="button" class="btn btn-s btn-sm upg-stryk" data-strike="${t.id}">Stryk</button>` +
      (g.S.overFor === t.id ? `<div class="whenpick upg-val" role="group" aria-label="Lämna över till"><span>Till vem?</span><button type="button" data-overto="${t.id}|Simon Ek">Simon</button></div>` : "") + `</footer>`,
    lamnaOver: () => {},
    // Rutans hjälpare (uppgiftsrutan, utanför modulblocket) som navets delar anropar.
    upgMig: () => "Zen Test", upgIk: (n) => `<i data-ik="${n}"></i>`,
    upgNotisTill: (t) => [...new Set([t.skapadAv, t.ansvarig].filter((n) => n && n !== "Zen Test"))],
    upgLista: (a) => (a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} och ${a[a.length - 1]}`),
  };
  const inbyggda = new Set(["Object", "Array", "JSON", "Math", "Date", "Set", "Map", "String", "Number", "Boolean", "Promise", "RegExp", "Error", "Symbol", "parseInt", "parseFloat", "isNaN", "encodeURIComponent", "decodeURIComponent", "setTimeout", "clearTimeout", "console", "undefined", "NaN", "Infinity"]);
  const attrapp = () => new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => "" : attrapp()), apply: () => attrapp() });
  const sandlada = new Proxy(g, {
    has: (_, k) => typeof k === "string" && !inbyggda.has(k),
    get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? t[k] : attrapp()),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  new Function("sandlada", `with (sandlada) {\n${block}\n__ut = {ndMedRad, ndMedPop, ndAnsvPop, ndGaMedKnapp};\n}`)(sandlada);
  Object.assign(g, g.__ut);
  const t = (id) => g.TASKS.find((x) => x.id === id);
  /** Ett tryck på en knapp med de här data-attributen, genom modulens egna lyssnare. */
  const tryck = async (dataset, iValet = null) => {
    const valet = iValet ? { dataset: { upgpopfor: iValet } } : null;
    const knapp = { dataset, closest: (sel) => (sel === ".upg-pop" ? valet : knapp) };
    const e = { target: knapp, preventDefault() {}, stopImmediatePropagation() { e.stoppad = true; }, stopPropagation() {} };
    for (const [typ, fn] of lyssnare) { if (typ !== "click" || e.stoppad) continue; fn(e); }
    await new Promise((r) => setTimeout(r, 5));
  };
  const andra = async (dataset, value) => {
    const e = { target: { dataset, value }, stopImmediatePropagation() { e.stoppad = true; } };
    for (const [typ, fn] of lyssnare) { if (typ !== "change" || e.stoppad) continue; fn(e); }
    await new Promise((r) => setTimeout(r, 5));
  };
  return { g, skickat, t, tryck, andra };
}

const sista = (skickat) => skickat[skickat.length - 1]?.data;

// Rutans rad för en egenskap, som upgRutaHtml skriver den (etiketten, och en knapp som öppnar valet när man får).
const radAv = (t) => (k, etikett, varde, text, far = true, titel = "") =>
  `<div class="upg-pr"><span class="upg-pl">${etikett}</span>${far ? `<button type="button" class="upg-pv" data-upgpop="${t.id}|${k}" aria-label="${etikett}: ${text}"${titel ? ` title="${titel}"` : ""}>${varde}</button>` : `<span class="upg-pv">${varde}</span>`}</div>`;
const medRad = (g, t, kan = true) => g.ndMedRad(t, radAv(t), kan);

rubrik("Rutan ger plats åt kollegan (uppgiftsrutan, main 36831fb)");
{
  ok("Med står under Ansvarig, där rutan lämnat plats", /\$\{rad\('ansv', 'Ansvarig'[^\n]*\n\s*\$\{ndMedRad\(t, rad, kan\)\}<!--upg-med-->/.test(html));
  ok("Ansvarig säger vem som har bollen i en delad uppgift", html.includes(`\${t.ndDelad ? '<span class="upg-boll">har bollen</span>' : ''}`));
  ok("den som bara är med får öppna Lämna över för att ge bollen", html.includes("kan && (upgFarStyra(t) || !!(t.ndDelad && (t.ndKan || {}).passa))"));
  ok("det bockade steget säger vem som bockade", html.includes("${ok && t.ndDelad && (t.ndDelAv || [])[j] ? `<span class=\"upg-delav\">"));
  ok("Stryk står bara för den som får styra", html.includes("${upgFarStyra(t) ? `<div class=\"upg-sep\"></div>\n      <button type=\"button\" class=\"upg-opt upg-fara\""));
  ok("Gå med själv står i foten på det jag lagt på någon annan", html.includes("Ta tillbaka</button>${ndGaMedKnapp(t)}`"));
  ok("valen Med och Lämna över ritas av navet", html.includes("upgPopHtml = function(t, k){"));
}

rubrik("Rutan: min egen uppgift, ingen annan med");
{
  const { g, t } = varld();
  const h = medRad(g, t("egen"));
  ok("raden Med finns och säger Ingen", h.includes('<span class="upg-pl">Med</span>') && h.includes('<span class="v upg-mut">Ingen</span>'));
  ok("den öppnar valet Lägg till kollegor", h.includes('data-upgpop="egen|med"') && h.includes('title="Lägg till kollegor"'));
  ok("ingen tagg har bollen när ingen annan är med", !h.includes("har bollen"));
  const v = g.upgPopHtml(t("egen"), "med");
  ok("valet är rutans egen ram", v.includes('data-upgpopfor="egen|med"') && v.includes(">Lägg till kollegor<"));
  ok("valet visar kollegorna med hela namnet", v.includes('data-ndmedlagg="egen|simon"') && v.includes('data-ndmedlagg="egen|anna"') && v.includes(">Simon Ek<") && v.includes(">Simon Lind<") && v.includes(">Anna Berg<"));
  ok("ingen är ibockad", !v.includes('aria-checked="true"'));
  ok("jag, som har bollen, står inte i valet", !v.includes("egen|mig"));
  ok("Stryk står kvar för den som får", g.upgFarStyra(t("egen")) === true);
}

rubrik("Rutan: Simon är med i min uppgift");
{
  const { g, t } = varld();
  const h = medRad(g, t("delad"));
  ok("raden visar Simon med bild och förnamn", h.includes('class="upg-medst"') && h.includes('<span class="v">Simon</span>'));
  const v = g.upgPopHtml(t("delad"), "med");
  ok("Simon är ibockad, och att bocka ur tar bort honom", /aria-checked="true" data-ndmedbort="delad\|simon">/.test(v));
  ok("Anna går att lägga till", v.includes('data-ndmedlagg="delad|anna"'));
  ok("valet säger hur många som är med", v.includes("<span>1 med</span>"));
  ok("kommentaren når Simon, som är med (förut: Ingen annan är med)", JSON.stringify(g.upgNotisTill(t("delad"))) === '["Simon Ek"]', JSON.stringify(g.upgNotisTill(t("delad"))));
  ok("och i min egen bara de som rutan räknade förut", g.upgNotisTill(t("egen")).length === 0);
  const a = g.upgPopHtml(t("delad"), "ansv");
  ok("Lämna över: Simon är med, så han får bollen (passa)", a.includes('data-ndpassa="delad|simon"') && a.includes(">med</span>"));
  ok("Lämna över: Anna är inte med, så uppgiften lämnas över", a.includes('data-upgsatt="delad|ansv|Anna Berg"'));
  ok("valet är rutans egen ram", a.includes('data-upgpopfor="delad|ansv"') && a.includes(">Lämna över till<"));
}

rubrik("Rutan: jag är med i Simons uppgift");
{
  const { g, t } = varld();
  const h = medRad(g, t("simons"));
  ok("raden säger du", h.includes('<span class="v">du</span>'));
  const v = g.upgPopHtml(t("simons"), "med");
  ok("jag är ibockad, och att bocka ur lämnar uppgiften", /aria-checked="true" data-ndlamna="simons">/.test(v) && v.includes("Zen Test (du)"));
  ok("jag får lägga till en kollega (B4)", v.includes('data-ndmedlagg="simons|anna"'));
  ok("men inte ta bort någon", !v.includes("data-ndmedbort"));
  ok("Simon, som har bollen, står inte i valet", !v.includes("simons|simon\""));
  const a = g.upgPopHtml(t("simons"), "ansv");
  ok("Lämna över blir Ge bollen, inom kretsen", a.includes(">Ge bollen till<") && a.includes('data-ndpassa="simons|mig"') && !a.includes("data-upgsatt"));
  ok("och jag är kvar som med", a.includes("Du är kvar som med."));
  ok("och ser ingen Stryk", g.upgFarStyra(t("simons")) === false);
}

rubrik("Rutan: jag kan bara se");
{
  const { g, t } = varld();
  ok("ingen rad Med, ingen väg att lägga till", medRad(g, t("ser"), false) === "");
  ok("inget Gå med själv", g.ndGaMedKnapp(t("ser")) === "");
}

rubrik("Rutan: det jag lagt på någon annan (B9)");
{
  const { g, t, skickat, tryck } = varld();
  const k = g.ndGaMedKnapp(t("vantar"));
  ok("Gå med själv finns", k.includes('data-ndmedlagg="vantar|mig"') && k.includes(">Gå med själv<"));
  ok("inte i min egen uppgift", g.ndGaMedKnapp(t("egen")) === "");
  ok("inte när jag redan är med", g.ndGaMedKnapp(t("simons")) === "");
  await tryck({ ndmedlagg: "vantar|mig" });
  ok("knappen skickar med-lagg med mig själv", sista(skickat)?.handling === "med-lagg" && sista(skickat).person === "mig", JSON.stringify(sista(skickat)));
}

rubrik("Rutan: en förekomst i en rutin säger att det gäller den här gången (B7)");
{
  const { g, t } = varld();
  ok("texten står i valet", g.upgPopHtml(t("rutin"), "med").includes("Gäller den här gången."));
  ok("och inte annars", !g.upgPopHtml(t("egen"), "med").includes("Gäller den här gången."));
}

rubrik("Rutan: den som har bollen och lämnar över får frågan om hen är kvar (B5)");
{
  const { g, t } = varld();
  ok("valet finns i Lämna över", /role="menuitemcheckbox" aria-checked="false" data-ndstanna>/.test(g.upgPopHtml(t("delad"), "ansv")));
  ok("inte för den som inte har bollen", !g.upgPopHtml(t("simons"), "ansv").includes("data-ndstanna"));
  g.S.ndStanna = true;
  const a = g.upgPopHtml(t("delad"), "ansv");
  ok("påslaget: ibockat, och texten säger att jag är kvar", a.includes('aria-checked="true" data-ndstanna>') && a.includes("du är kvar som med"));
}

rubrik("Historiken läser som en mening");
{
  const { g, t } = varld();
  const akt = g.upgAkt(t("delad"));
  const texter = akt.map((x) => x.text);
  ok("la till", texter.includes("Du la till Simon Ek"), JSON.stringify(texter));
  ok("flyttade", texter.includes("Simon flyttade till mån 16 nov"));
  ok("passade", texter.includes("Simon passade till Zen Test"));
  const s = akt.find((x) => x.text === "Skapad");
  ok("det gamla formatet står kvar för resten", !!s && s.vem === "Zen Test" && !s.note);
  ok("en mening har ingen dubblett av vem och anteckningen", akt.filter((x) => x.text.startsWith("Simon ")).every((x) => !x.vem && !x.note));
}

rubrik("Knapparna skickar rätt handling");
{
  const { skickat, tryck } = varld();
  await tryck({ ndmedlagg: "egen|anna" });
  ok("ett namn skickar med-lagg", sista(skickat)?.handling === "med-lagg" && sista(skickat).id === "egen" && sista(skickat).person === "anna", JSON.stringify(sista(skickat)));
}
{
  const { skickat, tryck } = varld();
  await tryck({ ndmedbort: "delad|simon" });
  ok("krysset skickar med-bort", sista(skickat)?.handling === "med-bort" && sista(skickat).person === "simon", JSON.stringify(sista(skickat)));
}
{
  const { skickat, tryck } = varld();
  await tryck({ ndpassa: "delad|simon" });
  ok("Passa skickar passa", sista(skickat)?.handling === "passa" && sista(skickat).till === "simon" && sista(skickat).id === "delad", JSON.stringify(sista(skickat)));
}
{
  const { skickat, tryck } = varld();
  await tryck({ ndlamna: "simons" });
  ok("Lämna skickar lamna utan person", sista(skickat)?.handling === "lamna" && sista(skickat).id === "simons" && !("person" in sista(skickat)), JSON.stringify(sista(skickat)));
}
{
  const { skickat, tryck } = varld();
  await tryck({ unfollow: "ser" });
  ok("H2: Sluta följa skickar lamna utan person", sista(skickat)?.handling === "lamna" && sista(skickat).id === "ser" && !("person" in sista(skickat)), JSON.stringify(sista(skickat)));
}
{
  const { skickat, tryck } = varld();
  await tryck({ reclaim: "simons" });
  ok("Ta tillbaka släpper den som hade uppgiften", sista(skickat)?.handling === "tilldela" && sista(skickat).till === "mig" && sista(skickat).slapp === true, JSON.stringify(sista(skickat)));
}

rubrik("Valen står kvar öppna för det man bockar (rutan stänger valet vid varje val)");
{
  const { g, tryck } = varld();
  g.S.upgPop = null;
  await tryck({ ndstanna: "" }, "delad|ansv");
  ok("Jag är kvar: valet Lämna över står kvar öppet", g.S.upgPop === "delad|ansv" && g.S.ndStanna === true);
  g.S.upgPop = null;
  await tryck({ ndmedlagg: "delad|anna" }, "delad|med");
  ok("Lägg till kollegor: valet står kvar öppet för nästa", g.S.upgPop === "delad|med");
  g.S.upgPop = null;
  await tryck({ ndpassa: "delad|simon" }, "delad|ansv");
  ok("att ge bollen stänger valet", g.S.upgPop === null);
  await tryck({ ndmedlagg: "vantar|mig" });
  ok("Gå med själv i foten öppnar inget val", g.S.upgPop === null);
}

rubrik("Lämna över: kvar eller inte");
{
  const { g, skickat, tryck } = varld();
  g.S.panel = "delad";
  await tryck({ ndstanna: "" });
  ok("knappen slår på valet", g.S.ndStanna === true);
  g.lamnaOver("delad", "Simon Ek");
  await new Promise((r) => setTimeout(r, 5));
  ok("valet följer med till Nav", sista(skickat)?.handling === "tilldela" && sista(skickat).till === "simon" && sista(skickat).stanna === true, JSON.stringify(sista(skickat)));
  ok("och nollställs", g.S.ndStanna === false);
  g.lamnaOver("egen", "Simon Ek");
  await new Promise((r) => setTimeout(r, 5));
  ok("utan valet lämnar man som förut", sista(skickat)?.stanna === false, JSON.stringify(sista(skickat)));
}

rubrik("Beskrivningen och rubriken skickar texten de utgick från (H15)");
{
  const { g, skickat, andra } = varld();
  await andra({ upgbesk: "delad" }, "Ny text ");
  const d = sista(skickat);
  ok("beskrivningen: ny text och basen", d?.handling === "andra" && d.falt.description_md === "Ny text" && d.bas?.description_md === "Gammal text", JSON.stringify(d));
  await andra({ upgbesk: "delad" }, "Ännu nyare");
  ok("efter en sparning är basen det som sparades", sista(skickat)?.bas?.description_md === "Ny text", JSON.stringify(sista(skickat)));
  await andra({ ptitle: "delad" }, "Ny rubrik");
  ok("rubriken: basen är navets rubrik", sista(skickat)?.falt.title === "Ny rubrik" && sista(skickat).bas?.title === "Uppgift delad", JSON.stringify(sista(skickat)));
  // En konflikt: basen får inte flyttas, och uppgiften läses om.
  let omlast = 0;
  g.ndOmlas = () => { omlast++; return Promise.resolve(true); };
  g.ndSkriv = async (url, data) => { skickat.push({ url, data }); return { ok: false, status: 409, data: { fel: "Någon annan ändrade beskrivningen nyss.", konflikt: { falt: "description_md", nu: "Simons text" } } }; };
  g.ndSvar = (s) => ({ ...s.data });
  await andra({ upgbesk: "delad" }, "Min text");
  ok("vid 409 läses uppgiften om", omlast === 1, String(omlast));
  ok("och basen står kvar", g.ND.uppgifter.uppgifter.find((x) => x.id === "delad").besk === "Ännu nyare");
}

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m" : `\n\x1b[31m${fel} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
