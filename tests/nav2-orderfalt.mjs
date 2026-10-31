#!/usr/bin/env node
/**
 * Granskningen S08 (K4/D1, D3): fälten Nav 2.0:s orderformulär skickar ska nå
 * repots actions.
 *
 * `/nav2/order` släpper bara igenom de fält som står i `FALT` (route.ts). Fram
 * till S08 skickade klienten `finans_ritad`, `har_utkop_ritad`,
 * `fri_order_ritad` och `fri_skal`, men rutten kastade dem: finansen
 * försvann på varje ny order, och säljarens fria order blev en paketorder.
 *
 * Provet läser tre källor och jämför dem:
 *
 * - **klienten:** nycklarna som `ndOrdFalt` sätter i det byggda utkastet
 *   (objektliteralen, `f.<nyckel> =` och `f[… ? 'a' : 'b']`), plus de som
 *   `ndOrdSkicka` lägger till (`falt.<nyckel> =`)
 * - **rutten:** `FALT` i `src/app/nav2/order/route.ts`
 * - **actionen:** vad `skapaOrder`, `redigeraOgodkand` och `redigeraOrder`
 *   läser ur formuläret (`form.get/has`, och hjälparna de anropar)
 *
 * För varje handling ska varje nyckel klienten skickar stå i `FALT` eller i
 * `IGNORERAS` nedan, och en nyckel i `IGNORERAS` får inte läsas av actionen
 * (då hör den hemma i `FALT`). Dessutom (D3): ett kryssfält som actionen
 * jämför med `"on"` ska få värdet `"on"`, både från klienten och från rutten.
 *
 * Kör efter `ndpatch.py`, mot `src/nav2/utkast.html` (eller filen i `UTKAST`).
 *
 *   node tests/nav2-orderfalt.mjs
 */
import { readFileSync } from "node:fs";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const las = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const html = readFileSync(process.env.UTKAST ?? new URL("../src/nav2/utkast.html", import.meta.url), "utf8");
const rutt = las("src/app/nav2/order/route.ts");
const act = las("src/app/(app)/order/actions.ts");

/** Texten från `start` till den parentes/klammer som stänger den första öppnande efter start. */
function balanserat(text, start, oppna = "{", stang = "}") {
  const i = text.indexOf(oppna, start);
  if (i < 0) return null;
  let djup = 0;
  for (let j = i; j < text.length; j++) {
    if (text[j] === oppna) djup++;
    else if (text[j] === stang && --djup === 0) return text.slice(i, j + 1);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rutten: FALT
// ---------------------------------------------------------------------------
const faltText = /const FALT = (\{[\s\S]*?\}) as const;/.exec(rutt)?.[1];
ok("FALT finns i rutten", !!faltText);
const FALT = faltText ? Function(`return ${faltText}`)() : {};

// ---------------------------------------------------------------------------
// Klienten: ndOrdFalt och ndOrdSkicka
// ---------------------------------------------------------------------------
const ndStart = html.indexOf("function ndOrdFalt(n){");
const nd = ndStart >= 0 ? balanserat(html, ndStart) : null;
ok("ndOrdFalt finns i utkastet", !!nd);
const skStart = html.indexOf("async function ndOrdSkicka(utkast){");
const sk = skStart >= 0 ? balanserat(html, skStart) : null;
ok("ndOrdSkicka finns i utkastet", !!sk);

/** Nycklarna i objektliteralen `const f = {…}`, utan det som står i JSON.stringify(…). */
function literalNycklar(kropp) {
  const s = kropp.indexOf("const f = {");
  if (s < 0) return [];
  let lit = balanserat(kropp, s);
  // Tjänsternas egna fält är JSON i ett fält, inte formulärfält.
  for (;;) {
    const j = lit.indexOf("JSON.stringify(");
    if (j < 0) break;
    const inre = balanserat(lit, j, "(", ")");
    lit = lit.slice(0, j) + "null" + lit.slice(j + "JSON.stringify".length + inre.length);
  }
  return [...lit.matchAll(/(?:^|[{,\s])([a-z][a-z0-9_]*):/g)].map((m) => m[1]);
}

/** Nyckel → värdena klienten sätter (literaler; `null` = ett uttryck). */
const klientVarden = new Map();
const satt = (k, v) => {
  if (!klientVarden.has(k)) klientVarden.set(k, new Set());
  klientVarden.get(k).add(v);
};
if (nd) {
  for (const k of literalNycklar(nd)) satt(k, null);
  for (const m of nd.matchAll(/\bf\.([a-z][a-z0-9_]*)\s*=\s*('([^']*)')?/g)) satt(m[1], m[2] ? m[3] : null);
  for (const m of nd.matchAll(/\bf\[[^\]]*?'([a-z_]+)'\s*:\s*'([a-z_]+)'\]/g)) {
    satt(m[1], null);
    satt(m[2], null);
  }
}
// Objektliteralens markörer: värdet ur literalen.
if (nd) for (const m of nd.matchAll(/([a-z_]+_ritad):'([^']*)'/g)) satt(m[1], m[2]);

const skickaExtra = new Map();
if (sk) for (const m of sk.matchAll(/\bfalt\.([a-z][a-z0-9_]*)\s*=\s*('([^']*)')?/g)) {
  if (!skickaExtra.has(m[1])) skickaExtra.set(m[1], new Set());
  skickaExtra.get(m[1]).add(m[2] ? m[3] : null);
}

rubrik("Klienten skickar markörerna (K4)");
for (const k of ["finans_ritad", "har_utkop_ritad", "fri_order_ritad", "fri_skal", "pris_ritad", "monthly_amount", "rabatt_skal"]) {
  ok(`ndOrdFalt sätter ${k}`, klientVarden.has(k));
}

// ndOrdFalt körd: en paketorder skickar priset med markören, en fri order inte.
rubrik("ndOrdFalt körd (K5, B2)");
{
  const vm = await import("node:vm");
  const ctx = { S: { role: "saljare" }, ndVemId: () => null, ndNarmastePaket: () => 2, ndTal: (v) => +String(v ?? "").replace(/\s/g, "").replace(",", ".") || 0, String, Math, JSON };
  vm.createContext(ctx);
  vm.runInContext(`${nd ? nd.replace(/^\{/, "function ndOrdFalt(n){") : ""}; this.ndOrdFalt = ndOrdFalt;`, ctx);
  const bas = { bolag: "X AB", org: "556677-8899", kontakt: "K", tel: "070", mejl: "", adress: "", postnr: "", ort: "", sign: "2026-10-20", start: "2026-10-20", note: "", tj: [], lop: 24 };
  const paket = ctx.ndOrdFalt({ ...bas, p: 2, man: "1 295", o7rabatt: "Kampanj" });
  ok("paketorder: pris_ritad = '1'", paket.pris_ritad === "1");
  ok("paketorder: monthly_amount = '1295'", paket.monthly_amount === "1295", String(paket.monthly_amount));
  ok("paketorder: rabattens skäl följer med", paket.rabatt_skal === "Kampanj");
  ok("paketorder: ingen fri order", paket.fri_order === undefined);
  const lista = ctx.ndOrdFalt({ ...bas, p: 2, man: "1495" });
  ok("paketorder på listpris: priset går med, inget skäl", lista.monthly_amount === "1495" && lista.rabatt_skal === undefined);
  const fri = ctx.ndOrdFalt({ ...bas, p: 0, lop: "24", friVarde: "48000", friSkal: "Specialaffär", friTyp: "kr", friProv: "3000" });
  ok("fri order: ingen prismarkör", fri.pris_ritad === undefined && fri.fri_order === "on" && fri.monthly_amount === "2000");
  const friTom = ctx.ndOrdFalt({ ...bas, p: 0, lop: "24", friVarde: "48000", friSkal: "x", friTyp: "kr", friProv: "" });
  ok("fri order utan provision: inget 0 skickas", friTom.commission_amount === undefined && friTom.commission_percent === undefined);

  // Paketbytet (granskningen I3): priset följer med när det stod på det förra paketets listpris.
  const i = html.indexOf("document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-onp]')");
  ok("paketbytets lyssnare finns", i >= 0);
  if (i >= 0) {
    const kod = html.slice(i, html.indexOf("}, true);", i) + "}, true);".length);
    let lyss = null;
    const c2 = { S: { ordNy: null }, OPAKET: { 1: { pris: 995 }, 2: { pris: 1495 }, 3: { pris: 1995 } }, ndO: () => ({}), ndTal: ctx.ndTal, String, document: { addEventListener: (_t, f) => { lyss = f; } } };
    vm.createContext(c2);
    vm.runInContext(kod, c2);
    const tryck = (p) => lyss({ target: { closest: () => ({ dataset: { onp: String(p) } }) } });
    c2.S.ordNy = { p: 2, man: "1495" }; tryck(3);
    ok("paket 2 på listpris → paket 3: 1 995 kr", c2.S.ordNy.man === "1995", c2.S.ordNy.man);
    c2.S.ordNy = { p: 2, man: "1 295" }; tryck(3);
    ok("eget pris står kvar vid byte", c2.S.ordNy.man === "1 295");
    c2.S.ordNy = { p: null, man: "" }; tryck(2);
    ok("första valet: utkastets hanterare sätter priset", c2.S.ordNy.man === "");
    c2.S.ordNy = { p: 3, man: "1995" }; tryck(0);
    ok("byte till fri order rör inte priset", c2.S.ordNy.man === "1995");
  }
}

// ---------------------------------------------------------------------------
// Actionen: vad den läser
// ---------------------------------------------------------------------------
const HJALPARE = {
  "finansUrFormular(form)": ["finans_ritad", "finans"],
  "utkopUrFormular(form)": ["har_utkop", "buyout_amount"],
  "tjansterUrFormular(form)": ["tjanster"],
  "angivenProvision(form)": ["provision_form", "commission_percent", "commission_amount"],
  "medAngivenProvision(form": ["provision_form", "commission_percent", "commission_amount"],
  "raknaFramProvision(": ["provision_form", "commission_percent", "commission_amount"],
  "rabattUrFormular(form": ["pris_ritad", "monthly_amount"],
  "rattelsePris(form": ["pris_ritad", "monthly_amount"],
  "rattelseProvision(form": ["provision_form", "commission_percent", "commission_amount"],
};
function laser(fn) {
  const s = act.indexOf(`export async function ${fn}(`);
  if (s < 0) return null;
  const e = act.indexOf("\nexport async function ", s + 10);
  const kropp = act.slice(s, e < 0 ? undefined : e);
  const falt = new Set([...kropp.matchAll(/form\.(?:get|has)\("([a-z_]+)"\)/g)].map((m) => m[1]));
  for (const [anrop, nycklar] of Object.entries(HJALPARE)) if (kropp.includes(anrop)) nycklar.forEach((x) => falt.add(x));
  return falt;
}

// ---------------------------------------------------------------------------
// Handlingarna
// ---------------------------------------------------------------------------
/**
 * Nycklar klienten skickar som actionen medvetet inte läser. Varje rad säger
 * varför. Läser actionen nyckeln faller provet: då ska den stå i FALT.
 */
const IGNORERAS = {
  skapa: {},
  // Avtalet (avtal_*) och Godkänn direkt (godkann) skickar ndOrdSkicka bara för en ny order.
  rattaOgodkand: {
    // Förlängningen kopplas bara när en NY order läggs (`skapaOrder`).
    forlanger_id: "kopplas bara på en ny order",
  },
  rattaGodkand: {
    forlanger_id: "kopplas bara på en ny order",
    // En godkänd orders adress rättas inte i repot (redigeraOrder läser den inte); Inkio har adressen.
    customer_street: "redigeraOrder rättar inte adressen",
    customer_postal_code: "redigeraOrder rättar inte adressen",
    customer_city: "redigeraOrder rättar inte adressen",
    // Fri eller paket avgörs av den godkända orderns order_value_source, inte av formuläret.
    fri_order: "orderns order_value_source avgör",
    fri_order_ritad: "orderns order_value_source avgör",
    fri_skal: "skälet sattes när ordern lades",
  },
};
const HANDLINGAR = [
  // Säljsamtalet som valdes i formuläret följer bara med en NY order; en rättad kopplas med `koppla` (2026-10-31).
  ["skapa", "skapaOrder", ["godkann", "avtal_fil_id", "avtal_store", "avtal_filnamn", "samtal_id"]],
  ["rattaOgodkand", "redigeraOgodkand", []],
  ["rattaGodkand", "redigeraOrder", ["reason"]],
];

for (const [h, fn, extra] of HANDLINGAR) {
  rubrik(`${h} → ${fn}`);
  const slapps = new Set(FALT[h] ?? []);
  const ign = IGNORERAS[h] ?? {};
  const lasta = laser(fn);
  ok(`${fn} finns`, !!lasta);
  const klient = new Set([...klientVarden.keys(), ...extra.filter((k) => skickaExtra.has(k))]);
  const tappas = [...klient].filter((k) => !slapps.has(k) && !(k in ign));
  ok("varje nyckel klienten skickar står i FALT eller IGNORERAS", tappas.length === 0, tappas.join(", "));
  const borde = Object.keys(ign).filter((k) => lasta?.has(k));
  ok("ingen nyckel i IGNORERAS läses av actionen", borde.length === 0, borde.join(", "));
  const okand = Object.keys(ign).filter((k) => !klient.has(k));
  ok("IGNORERAS nämner bara nycklar klienten skickar", okand.length === 0, okand.join(", "));
}

// ---------------------------------------------------------------------------
// D3: kryssfältens värde
// ---------------------------------------------------------------------------
rubrik("Kryssfälten får värdet \"on\" (D3)");
const KRYSS = new Set([...act.matchAll(/form\.get\("([a-z_]+)"\)\s*[!=]==\s*"on"/g)].map((m) => m[1]));
ok("actions.ts har kryssfält", KRYSS.size >= 5, [...KRYSS].join(", "));
ok("makulera_i_inkio är ett kryssfält", KRYSS.has("makulera_i_inkio"));

for (const k of KRYSS) {
  for (const v of klientVarden.get(k) ?? []) if (v !== null) ok(`klienten: ${k} = '${v}'`, v === "on");
  for (const v of skickaExtra.get(k) ?? []) if (v !== null) ok(`ndOrdSkicka: ${k} = '${v}'`, v === "on");
}

// Rutten: varje `k: <uttryck>` för ett kryssfält i ett form({…})-anrop får bara literalerna "" och "on".
let ruttKryss = 0;
for (const m of rutt.matchAll(/\bform\(\{/g)) {
  const lit = balanserat(rutt, m.index + 4);
  for (const k of KRYSS) {
    const r = new RegExp(`\\b${k}\\s*:\\s*([^,}]+)`).exec(lit);
    if (!r) continue;
    ruttKryss++;
    const literaler = [...r[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
    ok(`rutten: ${k} får bara "" eller "on"`, literaler.every((x) => x === "" || x === "on"), r[1].trim());
  }
}
ok("rutten sätter minst ett kryssfält själv (makulera_i_inkio)", ruttKryss >= 1);

// ---------------------------------------------------------------------------
// S10b: klientens nya delar
// ---------------------------------------------------------------------------
{
  const vm = await import("node:vm");
  rubrik("ndTal läser svenska belopp (S08:s mindre fynd D17, S10b)");
  const rad = /^const ndTal = .*$/m.exec(html)?.[0];
  ok("ndTal finns i utkastet", !!rad);
  const c = { String };
  vm.createContext(c);
  vm.runInContext(`${rad ?? "const ndTal = () => NaN;"}; this.ndTal = ndTal;`, c);
  for (const [in_, ut] of [["10.000", 10000], ["10 000", 10000], ["1 295", 1295], ["1 295,50", 1295.5], ["1.295,50", 1295.5], ["1295.50", 1295.5], ["12,5", 12.5], ["995", 995], ["", 0], ["abc", 0], [null, 0], ["1 295", 1295]]) {
    ok(`ndTal(${JSON.stringify(in_)}) = ${ut}`, c.ndTal(in_) === ut, String(c.ndTal(in_)));
  }

  rubrik("Rätta på en godkänd order är påslagen (D10, B12)");
  ok("NDORD_RATTA_GODKAND = true", /const NDORD_RATTA_GODKAND = true;/.test(html));

  rubrik("Ta bort en bilaga och Bevaka igen (D23, B12)");
  const a = html.indexOf("const ndOrdKanTaBort = ");
  const b = html.indexOf("/* ---------- Skrivningar: /nav2/order ---------- */", a);
  ok("klientens block finns", a > 0 && b > a);
  if (a > 0 && b > a) {
    const kod = html.slice(a, b);
    const filrad = (namn, las) => `<div class="kkfil"><i></i><span><b>${namn}</b><small class="muted">1 kB</small></span><button class="btn btn-s btn-sm" data-kkoppnafil="${namn}">Öppna</button>${las ? '<button class="btn btn-s btn-sm" data-kklas="1">Läs ur avtalet</button>' : ""}</div>`;
    const c2 = {
      S: { role: "saljare" }, ME: { saljare: { namn: "Sara" } }, ndO: () => ({ varselDagar: 90, hanterare: true }), esc: (x) => String(x),
      oDagarTillSlut: (x) => x.dagar,
      kkBilagor: (_o, alla) => `<section class="kksek"><h3>Avtal och bilagor</h3>${alla.map((x) => `<div class="kkbilg"><p class="kkdag">#${x.nr}</p>${x.bilagor.map((f) => filrad(f.namn, x.st === "inskickad")).join("")}<label class="ondrop">x</label></div>`).join("")}<p class="muted kkhj">Varje öppning loggas, som för samtalen. En godkänd order går inte att ändra, därför finns Läs ur avtalet bara före godkännandet.</p></section>`,
      oLoperUt: (x) => ["signerad", "betald"].includes(x.st) && !x.fornyelse && x.dagar <= 90,
      kkOversikt: (_o, _d, _alla, bar) => (c2.oLoperUt(bar) ? (bar.fornyAvslag ? `<p class="frb danger"><svg></svg><span><b>Kunden förlänger inte.</b> ${bar.fornyAvslag}</span></p>` : '<div class="kkforny">Dags att förlänga</div>') : ""),
    };
    vm.createContext(c2);
    vm.runInContext(`${kod}; this.kkBilagor = kkBilagor; this.kkOversikt = kkOversikt;`, c2);
    const alla = [
      { nr: 11, st: "inskickad", vem: "Sara", bilagor: [{ id: "f11", namn: "Avtal-11.pdf" }] },
      { nr: 12, st: "signerad", vem: "Sara", bilagor: [{ id: "f12", namn: "Avtal-12.pdf" }, { id: "f12b", namn: "Bild.png" }] },
      { nr: 13, st: "makulerad", vem: "Sara", bilagor: [{ id: "f13", namn: "Avtal-13.pdf" }] },
    ];
    const salj = c2.kkBilagor({}, alla);
    ok("säljaren: Ta bort på sin inskickade order, efter Läs ur avtalet", /Läs ur avtalet<\/button><button class="btn btn-s btn-sm" data-ndordbort="11\|f11">Ta bort<\/button><\/div>/.test(salj));
    ok("säljaren: inget Ta bort på en godkänd eller makulerad order", !/data-ndordbort="1[23]\|/.test(salj));
    c2.S.role = "chef";
    const chef = c2.kkBilagor({}, alla);
    ok("chefen: Ta bort på varje fil på den godkända ordern, med rätt id", chef.includes('data-ndordbort="12|f12"') && chef.includes('data-ndordbort="12|f12b"'));
    ok("chefen: inget Ta bort på en makulerad order", !chef.includes('data-ndordbort="13|'));
    ok("texten om godkända order stämmer med Rätta", chef.includes("En godkänd order rättas bara av säljchef, VD och ekonomi") && !chef.includes("går inte att ändra"));
    ok("samma knappstil som Läs ur avtalet", (chef.match(/<button class="btn btn-s btn-sm" data-ndordbort=/g) ?? []).length === 3);

    const bar = { nr: 12, st: "signerad", dagar: 40, fornyAvslag: "Bytte till konkurrent", fornyelse: { utfall: "avslutad" } };
    const ov = c2.kkOversikt({}, {}, alla, bar);
    ok("efter omladdningen står Kunden förlänger inte kvar", ov.includes("<b>Kunden förlänger inte.</b> Bytte till konkurrent"));
    ok("chefen: Bevaka igen i raden", /<\/span><button class="btn btn-s btn-sm" data-ndordbevaka="12">Bevaka igen<\/button><\/p>/.test(ov));
    ok("oLoperUt är återställd efteråt", c2.oLoperUt(bar) === false);
    c2.S.role = "saljare";
    ok("säljaren: raden utan Bevaka igen (Ångra i kvittot i tio minuter)", !c2.kkOversikt({}, {}, alla, bar).includes("Bevaka igen") && c2.kkOversikt({}, {}, alla, bar).includes("Kunden förlänger inte."));
    ok("utan utfall: kortet som förut", c2.kkOversikt({}, {}, alla, { nr: 12, st: "signerad", dagar: 40, fornyAvslag: null, fornyelse: null }).includes("Dags att förlänga"));
  }
  ok("klicket Ta bort frågar först (toastActs) och skickar bilaga-bort", /ds\.ndordbort[\s\S]{0,400}toastActs\([\s\S]{0,200}'bilaga-bort'/.test(html));
  ok("klicket Bevaka igen skickar ateruppta", /ds\.ndordbevaka[\s\S]{0,120}'ateruppta'/.test(html));
}

// S10b omgång 2 (granskarens fynd)
rubrik("Granskarens fynd i klienten (S10b omgång 2)");
{
  const sk = html.slice(html.indexOf("async function ndOrdSkicka("), html.indexOf("const NDORD_RATTA_GODKAND"));
  ok("V3: en godkänd rättelse stoppas inte av avtal eller säljsamtal", /godkandRatta[\s\S]{0,200}'avtal'[\s\S]{0,40}'samtal'/.test(sk));
  ok("V2: bara ett riktigt samtals-id kopplas, aldrig efter en godkänd rättelse", /const samtalId = n\.samtal && \/\^\[0-9a-f-\]\{36\}\$\/\.test\(n\.samtal\) && !godkandRatta/.test(sk));
  // 2026-10-31: kopplades samtalet efter inskicket nekade spärren först, och valet hjälpte bara när numret stämde.
  ok("säljsamtalet kopplas före inskicket av ett rättat utkast", /koppla\(ratta\.id\)[\s\S]{0,120}'skicka-in'/.test(sk));
  ok("en ny order tar säljsamtalet med sig till servern", /falt\.samtal_id = samtalId[\s\S]{0,80}'skapa'/.test(sk));
  ok("M7: rättelsen tar med orderns tilläggsmärke", /fran && fran\.ratta[\s\S]{0,160}addon/.test(html));
  ok("M8: knapparna kräver hanterare", /ndOrdKanTaBort = x => [^\n]*ndO\(\)\.hanterare/.test(html) && /S\.role === 'chef' && ndO\(\)\.hanterare \? h\.replace/.test(html));
  ok("Boka i kundkortet: Kalendern sparar (S15:s text)", /kkboka:'Boka samtalet i Kalendern\.'/.test(html));
}

console.log(fel ? `\n\x1b[31m${fel} prov föll.\x1b[0m` : "\n\x1b[32mAlla prov gick igenom.\x1b[0m");
process.exit(fel ? 1 : 0);
