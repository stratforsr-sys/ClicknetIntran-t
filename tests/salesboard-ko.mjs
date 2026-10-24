#!/usr/bin/env node
/**
 * Säljtavlans kö och vad tavlan visar (src/app/salesboard/ko.ts). Tavla.tsx håller
 * tillståndet och timers; allt den beslutar kommer härifrån och provas här:
 *
 *   1. NYA BILDER: ett svar i fel ordning släpps, en bild från framtiden fryser inte
 *      tavlan.
 *   2. KÖN: en skur blir en serie, en order som försvunnit firas inte, bara ett
 *      riktigt mål styr om en landning, och testhändelser rör aldrig tavlan.
 *   3. FÖRLOPPET: lagets antal utan det som väntar, testernas klocka, en dold säljare
 *      och de tysta raderna.
 *   4. BILDRUTAN: tavlan byter under täckningen, raden byter text när talen rullar
 *      (aldrig före), och målet lämnar aldrig en tom rad.
 *
 *   TZ=UTC node --experimental-strip-types tests/salesboard-ko.mjs
 */
import {
  SKEV_MS,
  aktuell,
  forlopp,
  mottagning,
  rangordna,
  samlaKo,
  siffror,
  tavlansRorelse,
  visning,
} from "../src/app/salesboard/ko.ts";
import { STANDARD } from "../src/lib/salesboard/installningar.ts";
import { CHING, KRYMP, MALET_VANTA, STOR_VILA, VANLIG_VILA, vanligL } from "../src/app/salesboard/motion/tider.ts";
import { RULL, matarText } from "../src/app/salesboard/vy.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const avsnitt = (namn) => console.log(`\n${namn}`);
const lika = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// -----------------------------------------------------------------------------
// Byggare
// -----------------------------------------------------------------------------

const DAG = "2026-10-23";
const NU = "2026-10-23T12:32:00Z";
const plus = (iso, s) => new Date(Date.parse(iso) + s * 1000).toISOString();

const personer = {
  amira: { nyckel: "amira", namn: "Amira H.", initialer: "AH", dold: false },
  elin: { nyckel: "elin", namn: "Elin B.", initialer: "EB", dold: false },
  jonas: { nyckel: "jonas", namn: "Jonas K.", initialer: "JK", dold: false },
  dold: { nyckel: "dold", namn: "En säljare", initialer: "·", dold: true },
};

const ord = (nyckel, over = {}) => ({
  nyckel,
  person: "amira",
  tid: plus(NU, -60),
  dag: DAG,
  paket: "Hemsida Pro",
  bindning: 24,
  belopp: 10_000,
  niva: "vanlig",
  efterreg: false,
  forstaNagonsin: false,
  saljarensDagsantal: 1,
  saljarensBasta: 1,
  manaden: true,
  ...over,
});

/**
 * En bild där varje order i `order` räknas: laget har 300 000 kr och 15 order före
 * dem, målet är 550 000 kr. Elin leder på värde, Amira har flest order.
 */
const bild = ({ nu = NU, order = [], mal = 550_000, bas = 300_000, natt = null } = {}) => {
  const { lag, mal: _m, ...inst } = structuredClone(STANDARD);
  const egna = (p) => order.filter((o) => o.person === p && o.manaden);
  const rad = (person, antal, varde) => ({
    person,
    antal: antal + egna(person).length,
    varde: varde + egna(person).reduce((s, o) => s + o.belopp, 0),
    vecka: [1, 0, 1, 0, order.filter((o) => o.person === person).length],
    idag: order.filter((o) => o.person === person).length,
  });
  return {
    v: 1,
    nu,
    bygge: "abc",
    lag: "Team",
    skarm: null,
    installningar: inst,
    manad: {
      nyckel: "2026-10",
      namn: "Oktober",
      antal: 15 + order.filter((o) => o.manaden).length,
      varde: bas + order.filter((o) => o.manaden).reduce((s, o) => s + o.belopp, 0),
      mal,
      forvantat: 425_000,
      prognos: 480_000,
      dagar: { gangna: 17, totalt: 22 },
      natt,
      storsta: Math.max(38_600, ...order.map((o) => o.belopp)),
    },
    idag: { datum: DAG, veckodag: 4, antal: order.length, summa: order.reduce((s, o) => s + o.belopp, 0), bastaDag: 9 },
    saljare: [rad("amira", 8, 90_000), rad("elin", 5, 150_000), rad("jonas", 2, 60_000)],
    historik: [],
    order: [...order].sort((a, b) => Date.parse(b.tid) - Date.parse(a.tid)),
    personer,
    handelser: [],
  };
};

const ordFirande = (o, variant = "vanlig", taggar = []) => ({ typ: "order", order: o, variant, taggar });
const post = (firande, efter) => ({ firande, efter });
const fl = (p, fore, o = {}) => forlopp(p, { fore, senaste: p.efter, vantande: [], nuIso: NU, ordning: "varde", ...o });

// -----------------------------------------------------------------------------
avsnitt("nya bilder");
// -----------------------------------------------------------------------------

{
  const a = bild({ nu: NU });
  ok("en senare bild är vanlig", mottagning(a, bild({ nu: plus(NU, 5) })) === "vanlig");
  ok("samma tid är vanlig", mottagning(a, bild({ nu: NU })) === "vanlig");
  ok("en bild 2 s äldre släpps (svar i fel ordning)", mottagning(a, bild({ nu: plus(NU, -2) })) === "slapp");
  ok("exakt en minut äldre släpps", mottagning(a, bild({ nu: plus(NU, -SKEV_MS / 1000) })) === "slapp");
  ok("mer än en minut äldre är en omstart: den förra hade fel klocka", mottagning(a, bild({ nu: plus(NU, -61) })) === "omstart");
}

// -----------------------------------------------------------------------------
avsnitt("kön");
// -----------------------------------------------------------------------------

{
  const A = ord("A", { tid: plus(NU, -30) });
  const B = ord("B", { tid: plus(NU, -20) });
  const C = ord("C", { tid: plus(NU, -10) });
  const s1 = bild({ order: [A] });
  const s2 = bild({ order: [A, B], nu: plus(NU, 2) });
  const s3 = bild({ order: [A, B, C], nu: plus(NU, 4) });

  const tva = samlaKo([post(ordFirande(A), s1), post(ordFirande(B), s2)], s2);
  ok("två order i en skur spelas var för sig", tva.length === 2 && tva.every((p) => p.firande.typ === "order"));
  ok("och behåller var sin bild", tva[0].efter === s1 && tva[1].efter === s2);
  const tre = samlaKo([...tva, post(ordFirande(C), s3)], s3);
  ok("en tredje medan två väntar gör en serie av alla tre", tre.length === 1 && tre[0].firande.typ === "serie" && tre[0].firande.order.length === 3);
  ok("och serien får den senaste bilden", tre[0].efter === s3);
  const medMal = samlaKo([post(ordFirande(A), s1), post({ typ: "malet", natt: NU }, s1), post(ordFirande(B), s2), post(ordFirande(C), s3)], s3);
  ok("målet hamnar efter serien", medMal.map((p) => p.firande.typ).join() === "serie,malet");
}

{
  const A = ord("A");
  const B = ord("B");
  const med = bild({ order: [A, B] });
  const utanA = bild({ order: [B], nu: plus(NU, 3) });
  ok("en order som försvunnit spelas inte", aktuell(post(ordFirande(A), med), utanA) === null);
  ok("men en som finns kvar spelas", aktuell(post(ordFirande(B), med), utanA) !== null);
  const serie = aktuell(post({ typ: "serie", order: [A, B, ord("C")] }, med), bild({ order: [B, ord("C")], nu: plus(NU, 3) }));
  ok("en serie spelar de order som finns kvar", serie?.firande.typ === "serie" && serie.firande.order.map((o) => o.nyckel).join() === "B,C");
  const ensam = aktuell(post({ typ: "serie", order: [A, B, ord("C")] }, med), bild({ order: [B], nu: plus(NU, 3) }));
  ok("R34: en serie med en enda order kvar spelas som den ordern", ensam?.firande.typ === "order" && ensam.firande.order.nyckel === "B", JSON.stringify(ensam?.firande.typ));
  ok("en serie där alla försvunnit spelas inte", aktuell(post({ typ: "serie", order: [A] }, med), bild({ order: [] })) === null);
  // R35: målet och halvvägs gäller ordervärdet.
  ok("målet spelas inte om värdet inte längre är där", aktuell(post({ typ: "malet", natt: NU }, med), bild({ bas: 529_999 })) === null);
  ok("men spelas när värdet är kvar över målet", aktuell(post({ typ: "malet", natt: NU }, med), bild({ bas: 550_000 })) !== null);
  ok("halvvägs spelas inte under halva värdemålet", aktuell(post({ typ: "halvvags" }, med), bild({ bas: 274_999 })) === null);
  ok("men över det", aktuell(post({ typ: "halvvags" }, med), bild({ bas: 275_000 })) !== null);
  ok("testhändelser spelas alltid", aktuell(post({ typ: "test", testtyp: "order", id: 3 }, med), bild({ order: [] })) !== null);
}

// -----------------------------------------------------------------------------
avsnitt("talen på tavlan");
// -----------------------------------------------------------------------------

{
  const A = ord("A", { belopp: 18_900 });
  const S = ord("S", { person: "elin", belopp: 12_000, manaden: false });
  const b = bild({ order: [A, S] });
  const alla = siffror(b, new Set());
  ok("utan väntande är talen bildens", alla.lag.varde === 318_900 && alla.lag.antal === 16 && alla.lag.idagAntal === 2 && alla.lag.idagSumma === 30_900);
  const utanA = siffror(b, new Set(["A"]));
  ok("en väntande order räknas inte i laget", utanA.lag.varde === 300_000 && utanA.lag.antal === 15 && utanA.lag.idagAntal === 1, JSON.stringify(utanA.lag));
  const amira = utanA.rader.find((r) => r.person === "amira");
  ok("och inte på säljarens rad", amira.antal === 8 && amira.varde === 90_000 && amira.idag === 0 && amira.vecka[4] === 0, JSON.stringify(amira));
  const utanS = siffror(b, new Set(["S"]));
  ok("en order som inte räknas i månaden dras bara av dagen", utanS.lag.varde === 318_900 && utanS.lag.idagAntal === 1 && utanS.lag.idagSumma === 18_900);
  const storst = siffror(bild({ order: [ord("X", { belopp: 71_820 })] }), new Set(["X"]), 38_600);
  ok("månadens största utan den väntande är den som visades förut", storst.lag.storsta === 38_600, String(storst.lag.storsta));
}

{
  const rader = [
    { person: "a", antal: 8, varde: 90_000 },
    { person: "b", antal: 5, varde: 150_000 },
    { person: "c", antal: 5, varde: 90_000 },
  ];
  ok("efter ordervärde, och antalet vid lika värde", lika(rangordna(rader, "varde").map((r) => r.person), ["b", "a", "c"]));
  ok("efter antal, och värdet vid lika antal", lika(rangordna(rader, "antal").map((r) => r.person), ["a", "b", "c"]));
  ok("rangordningen ändrar inte listan", rader[0].person === "a");
}

// -----------------------------------------------------------------------------
avsnitt("förloppet");
// -----------------------------------------------------------------------------

{
  const fore = bild();
  const A = ord("A", { person: "jonas", belopp: 18_900 });
  const efter = bild({ order: [A], nu: plus(NU, 2) });
  const f = fl(post(ordFirande(A), efter), fore);
  const d = f.data;
  ok("en vanlig order byter tavlan när vilan är slut och krymper sedan", f.tider.byt === VANLIG_VILA && f.varaktighet === VANLIG_VILA + KRYMP);
  ok("fakta: säljarens tredje order i månaden och första i dag", d.fakta.nr === 3 && d.fakta.idag === 1, JSON.stringify(d.fakta));
  ok("Jonas går från tredje till tredje plats på värde", d.fakta.platsFore === 3 && d.fakta.plats === 3, JSON.stringify(d.fakta));
  ok("18 900 kr är inte månadens största", d.fakta.storsta === false);
  ok("lagets mätare går från före till efter, i kronor", lika(d.lag, { fran: { varde: 300_000, antal: 15 }, till: { varde: 318_900, antal: 16 }, mal: 550_000 }), JSON.stringify(d.lag));
  const kassa = f.spar.find((p) => p.ljud === "kassa");
  ok("kassans ching landar på värdet", kassa?.f === Math.round(vanligL(18_900) - CHING * 60), String(kassa?.f));
  ok("hornet strax efter, med spärrtiden", f.spar.some((p) => p.ljud === "horn" && p.sparr === true && p.f === vanligL(18_900) + 4));
  ok("nycklarna landar med förloppet", lika(f.nycklar, ["A"]));

  const B = ord("B", { person: "jonas", belopp: 100_000, niva: "stor" });
  const stor = fl(post(ordFirande(B, "stor"), bild({ order: [B], nu: plus(NU, 2) })), fore);
  ok("en stor affär är längre och har cymbalen", stor.tider.byt === STOR_VILA && stor.spar.some((p) => p.ljud === "trumvirvel"));
  ok("Jonas tar ledningen med den", stor.data.fakta.plats === 1 && stor.data.fakta.platsFore === 3 && stor.data.fakta.storsta === true, JSON.stringify(stor.data.fakta));

  const D = ord("D", { person: "dold", forstaNagonsin: true });
  const dold = fl(post(ordFirande(D, "forsta", [{ typ: "personbasta", antal: 3 }, { typ: "dagensForsta" }]), bild({ order: [D], nu: plus(NU, 2) })), fore);
  ok("en dold säljare får ingen första order (R23)", dold.data.variant === "vanlig");
  ok("och inget personbästa, men lagets tagg står kvar", lika(dold.data.taggar, [{ typ: "dagensForsta" }]));
  ok("och ingen plats eller räkning", dold.data.fakta.plats === null && dold.data.fakta.nr === null);

  const test = fl(post({ typ: "test", testtyp: "order", id: 4 }, fore), fore);
  ok("ett test ändrar inte tavlan", test.test && test.efter === fore && test.nycklar.length === 0);
  ok("men visar mätaren röra sig", test.data.lag.till.varde > test.data.lag.fran.varde);
}

{
  const fore = bild();
  const malBild = bild({ bas: 560_000, nu: plus(NU, 2) });
  const m = fl(post({ typ: "malet", natt: NU }, malBild), fore);
  ok("målet väntar 650 ms och har sitt eget spår", m.tider.byt === MALET_VANTA && m.spar.map((p) => p.ljud).join() === "small,fanfar,arena");
  ok("laget som chips, efter värde, bara de som sålt", lika(m.data.laget.map((x) => x.namn), ["Elin B.", "Amira H.", "Jonas K."]));
  ok("med fem arbetsdagar kvar", m.data.dagarKvar === 5 && m.data.mal === 550_000 && m.data.varde === 560_000);

  const tre = [ord("A"), ord("B", { person: "elin" }), ord("C", { person: "jonas" })];
  const s = fl(post({ typ: "serie", order: tre }, bild({ order: tre, nu: plus(NU, 2) })), fore);
  ok("en serie bär sina order och lagets steg", s.data.order.length === 3 && s.data.lag.till.varde === 330_000);
}

// -----------------------------------------------------------------------------
avsnitt("vad tavlan visar");
// -----------------------------------------------------------------------------

{
  const fore = bild();
  const A = ord("A", { person: "jonas", belopp: 18_900 });
  const B = ord("B", { person: "elin", belopp: 5_000, tid: plus(NU, -10) });
  const efter = bild({ order: [A, B], nu: plus(NU, 2) });
  const f = fl(post(ordFirande(A), efter), fore, { vantande: [post(ordFirande(B), efter)] });
  const v = (r) => visning({ visad: fore, vantande: [post(ordFirande(B), efter)], spel: f, r });
  ok("under kompositionen visar tavlan det förra", v(f.tider.byt - 1).tal.lag.varde === 300_000 && v(f.tider.byt - 1).bild === fore);
  ok("vid bytet det nya, utan det som väntar", v(f.tider.byt).tal.lag.varde === 318_900 && v(f.tider.byt).bild === f.efter);
  ok("raden i flödet döljs tills panelen landat", v(f.tider.byt).dolda.has("A") && !v(f.varaktighet).dolda.has("A"));
  ok("den väntande syns inte i flödet", v(f.tider.byt).utesluten.has("B"));
  const vila = visning({ visad: efter, vantande: [], spel: null, r: 0 });
  ok("i vila är det bildens tal", vila.tal.lag.varde === 323_900 && vila.dolda.size === 0);

  const r0 = tavlansRorelse(f, 0);
  const r23 = tavlansRorelse(f, 23);
  ok("tavlan backar undan när svepet kommer", r0.dy === 0 && r0.skala === 1 && r23.dy === -40 && Math.abs(r23.skala - 0.97) < 1e-9, JSON.stringify(r23));
  ok("och står tillbaka när kompositionen krymper", lika(tavlansRorelse(f, f.tider.byt), { dy: 0, skala: 1 }));
}

{
  // R31, nu i kronor: raden i målkortet beskriver talet som syns, och byter när det landat.
  const fran = { varde: 540_000, mal: 550_000, forvantat: 425_000, prognos: 600_000, natt: null };
  const till = { varde: 558_900, mal: 550_000, forvantat: 425_000, prognos: 620_000, natt: "2026-10-23T12:31:00Z" };
  ok("medan talet rullar står det som gällde", matarText(fran, till, RULL - 1).status === matarText(fran, fran, 0).status);
  ok("när talet landat står Målet nått", matarText(fran, till, RULL).status === "Målet nått", matarText(fran, till, RULL).status);
  ok("och raden säger hur mycket över", JSON.stringify(matarText(fran, till, RULL).fakta).includes("+8\u00a0900"), JSON.stringify(matarText(fran, till, RULL).fakta));
}

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m` : "\n\x1b[32mallt gick igenom\x1b[0m");
process.exit(fel ? 1 : 0);
