/**
 * Säljtavlans kö och vad tavlan visar, som ren logik: en ny bild in, kön och det
 * tavlan ska visa vid varje bildruta ut.
 *
 * Ingen React, inga timers och ingen webbläsare, så att reglerna går att prova
 * med node (`tests/salesboard-ko.mjs`). Tavla.tsx håller tillståndet, timers och
 * mått, och frågar den här filen om allt den beslutar.
 *
 * ===========================================================================
 * TAVLAN BYTER NÄR KOMPOSITIONEN HAR VILAT KLART, OCH TALEN RULLAR SEDAN.
 *
 * Under ett firande visar tavlan den förra bilden. När kompositionens vila är
 * slut (`byt`) visar den det nya läget: topplistans rader byter plats, talen
 * rullar och grafen växer, medan kompositionen krymper in i raden i flödet. Den
 * raden döljs tills panelen landat på den, så att det som färdas är raden och
 * den aldrig står två gånger.
 *
 * Det som väntar i kön räknas aldrig: inte i laget, inte på säljarens rad och
 * inte i flödet. Annars hade en order syns på tavlan innan den firats.
 * ===========================================================================
 */

import { arDoldPa, samla, variantFor, type Firande, type Tagg } from "../../lib/salesboard/regler.ts";
import { iOrder, lopp, ordOrder, snittorder, type Lopp } from "../../lib/salesboard/tavling.ts";
import type { Ogonblick, Ordning, TavleOrder, TavlePerson, TavleTavling, TavleVinnare } from "../../lib/salesboard/typer.ts";
import { ip, SVEP } from "./motion/kurvor.ts";
import {
  HALVVAGS,
  SERIE_MAX,
  knuffLjud,
  knuffTider,
  tavlingTider,
  vinnareLjud,
  vinnareTider,
  maletLjud,
  maletTider,
  orderLjud,
  orderTider,
  serieLjud,
  serieTider,
  type Ljudpunkt,
  type OrderVariant,
  type Ordertider,
} from "./motion/tider.ts";
import { DOLD } from "./vy.ts";

const ms = (iso: string): number => Date.parse(iso);

// -----------------------------------------------------------------------------
// Nya bilder
// -----------------------------------------------------------------------------

/** Så mycket äldre en bild får vara och ändå räknas som ett svar i fel ordning. */
export const SKEV_MS = 60_000;

/**
 * Hur en ny bild tas emot.
 *
 * - "slapp": äldre än den förra med högst en minut. Ett svar i fel ordning (två
 *   serverinstanser med var sin cache på 2 s); den ändrar ingenting.
 * - "omstart": äldre med mer än en minut. Då var det den förra som hade fel klocka,
 *   och den nya tas emot som en start (`planera` med ingen förra bild): den visas
 *   och ingenting firas, så att en bild från framtiden aldrig kan frysa tavlan.
 * - "vanlig": allt annat.
 */
export function mottagning(senaste: Ogonblick, ny: Ogonblick): "slapp" | "vanlig" | "omstart" {
  const bakom = ms(senaste.nu) - ms(ny.nu);
  if (bakom > 0 && bakom <= SKEV_MS) return "slapp";
  return bakom > SKEV_MS ? "omstart" : "vanlig";
}

/** Den senare av två bilder. */
export const nyast = (a: Ogonblick, b: Ogonblick): Ogonblick => (ms(b.nu) > ms(a.nu) ? b : a);

// -----------------------------------------------------------------------------
// Kön
// -----------------------------------------------------------------------------

/** En post i kön: firandet och den bild som gällde när det samlades. */
export type Kopost = { firande: Firande; efter: Ogonblick };

/** Ordernycklarna ett firande landar med. */
export function nycklarFor(f: Firande): string[] {
  if (f.typ === "order") return [f.order.nyckel];
  if (f.typ === "serie") return f.order.map((o) => o.nyckel);
  return [];
}

/**
 * Samlar om kön som helhet med `samla`, så att tre order som väntar blir en serie
 * och ingen står i kö längre än en serie tar. Varje firande behåller sin bild; en
 * ny serie får den senaste bilden bland dem den slog ihop.
 */
export function samlaKo(poster: readonly Kopost[], senaste: Ogonblick): Kopost[] {
  const samlade = samla(poster.map((p) => p.firande));
  return samlade.map((firande) => {
    const egen = poster.find((p) => p.firande === firande);
    if (egen) return { firande, efter: egen.efter };
    const efter = poster
      .filter((p) => p.firande.typ === "order" || p.firande.typ === "serie")
      .reduce((a, p) => nyast(a, p.efter), poster[0]?.efter ?? senaste);
    return { firande, efter };
  });
}

/** Tävlingens scener: de spelas över tavlan och landar ingen order. */
export const TAVLINGSSCENER = ["tavling", "knuff", "grans", "vinnare"] as const;
export const arTavlingsscen = (typ: string): boolean => (TAVLINGSSCENER as readonly string[]).includes(typ);

/** Har laget ett mål i kronor, och står värdet på minst `andel` av det? */
const vidMal = (bild: Ogonblick, andel: number): boolean => {
  const mal = bild.manad.mal;
  return mal !== null && mal > 0 && bild.manad.varde >= mal * andel;
};

/**
 * Posten som den ska spelas nu, eller null när den inte längre är sann (spec §2:
 * tavlan firar aldrig en order som försvunnit). En order som makulerats medan den
 * väntade spelas inte; en serie spelar de som finns kvar, och blir det en enda spelas
 * den som en order (R34); målet och halvvägs bara om ordervärdet fortfarande är där
 * (R35). Testhändelser spelas alltid.
 */
export function aktuell(post: Kopost, senaste: Ogonblick): Kopost | null {
  const f = post.firande;
  const finns = new Set(senaste.order.map((o) => o.nyckel));
  if (f.typ === "order") return finns.has(f.order.nyckel) ? post : null;
  if (f.typ === "serie") {
    const kvar = f.order.filter((o) => finns.has(o.nyckel));
    if (kvar.length === 0) return null;
    if (kvar.length === f.order.length && kvar.length > 1) return post;
    if (kvar.length === 1) {
      // En ensam order är ingen serie: den spelas som den ordern, som om den kommit ensam.
      const o = kvar[0];
      const variant = variantFor(o, senaste.installningar.firande.forstaOrdern, arDoldPa(senaste, o));
      return { firande: { typ: "order", order: o, variant, taggar: [] }, efter: post.efter };
    }
    return { firande: { typ: "serie", order: kvar }, efter: post.efter };
  }
  if (f.typ === "malet") return vidMal(senaste, 1) ? post : null;
  if (f.typ === "halvvags") return vidMal(senaste, 0.5) ? post : null;
  // Tävlingen: brytaren av tar bort allt som väntar, och en knuff eller gräns som inte längre
  // är sann (en makulering medan den väntade) spelas inte.
  const t = senaste.tavling;
  if (f.typ === "tavling") return t ? post : null;
  if (f.typ === "vinnare") return senaste.vinnare ? post : null;
  if (f.typ === "grans" || f.typ === "knuff") {
    const rad = t ? senaste.saljare.find((x) => x.person === f.person) : undefined;
    if (!t || !rad) return null;
    if (f.typ === "grans") return t.grans !== null && rad.varde >= t.grans ? post : null;
    const topp = Math.max(...senaste.saljare.map((x) => x.varde));
    const snitt = snittorder(senaste.manad.varde, senaste.manad.antal);
    return rad.varde < topp && topp - rad.varde <= snitt ? post : null;
  }
  return post;
}

// -----------------------------------------------------------------------------
// Talen på tavlan
// -----------------------------------------------------------------------------

/** En rad i topplistan som tavlan visar den. */
export type Radtal = { person: string; antal: number; varde: number; vecka: number[]; idag: number };

/** Allt tavlan räknar: raderna och laget. */
export type Siffror = {
  rader: Radtal[];
  lag: { antal: number; varde: number; idagAntal: number; idagSumma: number; storsta: number | null };
};

/**
 * Talen i en bild utan de order som väntar i kön (`utesluten`). En väntande order
 * dras av där den räknas: i dag alltid, i månaden bara om den signerades i den
 * (`manaden`). Var den väntande ordern månadens största visas `reservStorsta`, det
 * som tavlan visade förut, så att "största affären" inte avslöjar den i förväg.
 */
export function siffror(bild: Ogonblick, utesluten: ReadonlySet<string>, reservStorsta: number | null = null): Siffror {
  const rader = bild.saljare.map((r) => ({ person: r.person, antal: r.antal, varde: r.varde, vecka: [...r.vecka], idag: r.idag }));
  const lag = { antal: bild.manad.antal, varde: bild.manad.varde, idagAntal: bild.idag.antal, idagSumma: bild.idag.summa, storsta: bild.manad.storsta };
  const dag = bild.idag.datum;
  const vd = bild.idag.veckodag;
  let storstaVantar = false;
  for (const o of bild.order) {
    if (o.dag !== dag || !utesluten.has(o.nyckel)) continue;
    const belopp = o.belopp ?? 0;
    lag.idagAntal = Math.max(0, lag.idagAntal - 1);
    lag.idagSumma = Math.max(0, lag.idagSumma - belopp);
    if (o.manaden) {
      lag.antal -= 1;
      lag.varde -= belopp;
      if (lag.storsta !== null && belopp >= lag.storsta) storstaVantar = true;
    }
    const rad = rader.find((r) => r.person === o.person);
    if (rad) {
      rad.idag = Math.max(0, rad.idag - 1);
      if (vd !== null) rad.vecka[vd] = Math.max(0, rad.vecka[vd] - 1);
      if (o.manaden) {
        rad.antal -= 1;
        rad.varde -= belopp;
      }
    }
  }
  if (storstaVantar) lag.storsta = reservStorsta;
  return { rader, lag };
}

/**
 * Topplistans ordning: efter ordervärde (och antalet vid lika), eller efter antal
 * (och värdet vid lika). Vid helt lika avgör nyckeln, så att två lika rader aldrig
 * byter plats mellan två bilder.
 */
export function rangordna<T extends { person: string; antal: number; varde: number }>(rader: readonly T[], ordning: Ordning): T[] {
  const nyckel = (a: T, b: T) => (a.person < b.person ? -1 : a.person > b.person ? 1 : 0);
  return [...rader].sort((a, b) =>
    ordning === "varde" ? b.varde - a.varde || b.antal - a.antal || nyckel(a, b) : b.antal - a.antal || b.varde - a.varde || nyckel(a, b),
  );
}

const platsI = (tal: Siffror, person: string, ordning: Ordning): number | null => {
  const i = rangordna(tal.rader, ordning).findIndex((r) => r.person === person);
  return i < 0 ? null : i + 1;
};

// -----------------------------------------------------------------------------
// Förloppet: vad ett firande spelar
// -----------------------------------------------------------------------------

/** Påhittade säljare för testhändelser: de räknas aldrig och märks TEST. */
export const TESTPERSONER: readonly TavlePerson[] = [
  { nyckel: "test-a", namn: "Test A.", initialer: "TA", dold: false },
  { nyckel: "test-b", namn: "Test B.", initialer: "TB", dold: false },
  { nyckel: "test-c", namn: "Test C.", initialer: "TC", dold: false },
];

/** Tävlingen som ett test spelar: månadens om den är på, annars ett påhittat pris. */
const testTavling = (bild: Ogonblick): TavleTavling =>
  bild.tavling ?? { pris: "Testpriset", bild: null, grans: 120_000, dagarKvar: Math.max(0, bild.manad.dagar.totalt - bild.manad.dagar.gangna) };
const TESTLOPP: Lopp = {
  snitt: 18_400,
  topp: 121_300,
  rader: [
    { person: "test-a", varde: 121_300, leder: true, bakom: 0, over: true, text: "leder" },
    { person: "test-b", varde: 112_900, leder: false, bakom: 1, over: false, text: "en order bakom" },
    { person: "test-c", varde: 94_600, leder: false, bakom: 2, over: false, text: "två order bakom" },
  ],
};

function testorder(i: number, nu: string, dag: string, stor: boolean, forsta: boolean): TavleOrder {
  return {
    nyckel: `test-${i}-${nu}`,
    person: TESTPERSONER[i % 3].nyckel,
    tid: nu,
    dag,
    paket: stor ? "Hemsida Pro + SEO" : "Hemsida Pro",
    bindning: stor ? 36 : 24,
    belopp: stor ? 52_800 : 12_900 + i * 2_400,
    niva: stor ? "stor" : "vanlig",
    efterreg: false,
    forstaNagonsin: forsta,
    saljarensDagsantal: 1,
    saljarensBasta: 1,
    manaden: true,
  };
}

/** Lagets steg i en komposition: från, till och målet, i kronor. */
export type Lagsteg = { fran: { varde: number; antal: number }; till: { varde: number; antal: number }; mal: number | null };

/** Det kompositionen berättar om säljaren. Null för en dold säljare, som inte har någon rad. */
export type Orderfakta = { nr: number | null; idag: number | null; platsFore: number | null; plats: number | null; storsta: boolean };

export type Forloppsdata =
  | {
      typ: "order";
      order: TavleOrder;
      person: TavlePerson;
      variant: OrderVariant;
      taggar: Tagg[];
      /** "oktober". */
      manad: string;
      fakta: Orderfakta;
      lag: Lagsteg;
    }
  | { typ: "serie"; order: TavleOrder[]; personer: Record<string, TavlePerson>; manad: string; lag: Lagsteg }
  | {
      typ: "malet";
      manad: string;
      mal: number;
      varde: number;
      antal: number;
      dagarKvar: number;
      laget: { namn: string; antal: number; varde: number }[];
      /** Den vars order tog laget över målet, eller null (dold säljare, test, okänd). */
      avgorande: string | null;
      /** Rekordmånaden de elva före, när månaden inte slagit den än. */
      rekord: number | null;
    }
  | { typ: "halvvags" }
  | {
      typ: "tavling";
      tavling: TavleTavling;
      /** "oktober". */
      manad: string;
      lopp: Lopp;
      personer: Record<string, TavlePerson>;
    }
  | {
      typ: "knuff";
      person: TavlePerson;
      tavling: TavleTavling;
      /** "en order": avståndet till ledaren. */
      avstand: string;
      /** Har säljaren nått gränsen? Annars är det ledningen och inte priset hen är nära. */
      over: boolean;
      /** "Anna L." eller "Anna L. och Sara E." */
      ledare: string;
      /** Ledarens försprång i kronor. */
      forsprang: number;
      tid: string;
    }
  | {
      typ: "grans";
      person: TavlePerson;
      tavling: TavleTavling;
      manad: string;
      varde: number;
      /** Platsen i loppet på ordervärde, 1 för den som leder. */
      plats: number;
      tid: string;
    }
  | { typ: "vinnare"; vinnare: TavleVinnare; namn: string[] };

export type Forlopp = {
  data: Forloppsdata;
  test: boolean;
  tider: Ordertider;
  varaktighet: number;
  spar: Ljudpunkt[];
  fore: Ogonblick;
  efter: Ogonblick;
  /** Order som landar i förloppet. */
  nycklar: string[];
};

const lagUr = (t: Siffror) => ({ varde: t.lag.varde, antal: t.lag.antal });

/**
 * Bygger förloppet för en post. `fore` är det tavlan visar nu, `senaste` den senaste
 * bilden, `vantande` allt som väntar efter posten (kön och det som samlas), `nuIso`
 * servertiden (testhändelsernas klocka) och `ordning` topplistans ordning just nu.
 *
 * En dold säljare får inget personligt (R23) också här, som ett andra skydd: ingen
 * personbästa-tagg och ingen "första ordern".
 */
export function forlopp(
  post: Kopost,
  o: { fore: Ogonblick; senaste: Ogonblick; vantande: readonly Kopost[]; nuIso: string; ordning: Ordning },
): Forlopp {
  const f = post.firande;
  const test = f.typ === "test";
  const fore = o.fore;
  const efter = test ? fore : nyast(nyast(post.efter, fore), o.senaste);
  const vantar = new Set(o.vantande.flatMap((p) => nycklarFor(p.firande)));
  const egna = nycklarFor(f);
  const foreTal = siffror(fore, new Set([...vantar, ...egna]));
  const efterTal = siffror(efter, vantar, foreTal.lag.storsta);
  const mal = efter.manad.mal;
  const manad = efter.manad.namn.toLowerCase();
  const dag = fore.idag.datum;
  const typ: Forloppsdata["typ"] =
    f.typ === "test"
      ? f.testtyp === "serie" || f.testtyp === "malet" || f.testtyp === "tavling" || f.testtyp === "knuff" || f.testtyp === "grans"
        ? f.testtyp
        : "order"
      : f.typ;
  const bas = { test, fore, efter };
  const steg = (till: Lagsteg["till"]): Lagsteg => ({ fran: lagUr(foreTal), till, mal });

  if (typ === "halvvags") {
    return { ...bas, data: { typ: "halvvags" }, tider: { byt: 0, slut: HALVVAGS }, varaktighet: HALVVAGS, spar: [], nycklar: [] };
  }

  // --- Tävlingen ----------------------------------------------------------------
  // Talen är de som syns på tavlan (`efterTal`, utan det som väntar), så att scenen och
  // topplistan bakom den aldrig säger olika saker. Testen spelar påhittade säljare.
  const testPersoner = Object.fromEntries(TESTPERSONER.map((p) => [p.nyckel, p]));
  if (typ === "tavling") {
    const t = test ? testTavling(efter) : efter.tavling!;
    const l = test ? TESTLOPP : lopp(efterTal.rader, efterTal.lag, t.grans);
    const tider = tavlingTider();
    return {
      ...bas,
      data: { typ: "tavling", tavling: t, manad, lopp: l ?? { rader: [], snitt: 0, topp: 0 }, personer: test ? testPersoner : efter.personer },
      tider,
      varaktighet: tider.slut,
      spar: [],
      nycklar: [],
    };
  }
  if (typ === "knuff" || typ === "grans") {
    const t = test ? testTavling(efter) : efter.tavling!;
    const vem = f.typ === "knuff" || f.typ === "grans" ? f.person : typ === "knuff" ? "test-b" : "test-a";
    const rader: readonly { person: string; varde: number }[] = test ? TESTLOPP.rader : rangordna(efterTal.rader, "varde");
    const personer = test ? testPersoner : efter.personer;
    const rad = rader.find((x) => x.person === vem);
    const varde = rad?.varde ?? 0;
    const topp = rader[0]?.varde ?? 0;
    const snitt = test ? TESTLOPP.snitt : snittorder(efterTal.lag.varde, efterTal.lag.antal);
    const namn = (k: string) => (personer[k] ?? DOLD).namn;
    const tider = knuffTider();
    if (typ === "knuff") {
      const ledare = rader.filter((x) => x.varde === topp && x.person !== vem).map((x) => namn(x.person));
      return {
        ...bas,
        data: {
          typ: "knuff",
          person: personer[vem] ?? DOLD,
          tavling: t,
          avstand: ordOrder(iOrder(topp - varde, snitt)),
          over: t.grans === null || varde >= t.grans,
          ledare: ledare.join(" och "),
          forsprang: Math.max(0, topp - varde),
          tid: o.nuIso,
        },
        tider,
        varaktighet: tider.slut,
        spar: knuffLjud("knuff"),
        nycklar: [],
      };
    }
    return {
      ...bas,
      data: {
        typ: "grans",
        person: personer[vem] ?? DOLD,
        tavling: t,
        manad,
        varde,
        plats: 1 + rader.filter((x) => x.varde > varde).length,
        tid: o.nuIso,
      },
      tider,
      varaktighet: tider.slut,
      spar: knuffLjud("grans"),
      nycklar: [],
    };
  }
  if (typ === "vinnare") {
    const v = efter.vinnare!;
    const tider = vinnareTider();
    return {
      ...bas,
      data: { typ: "vinnare", vinnare: v, namn: v.personer.map((k) => (efter.personer[k] ?? DOLD).namn) },
      tider,
      varaktighet: tider.slut,
      spar: vinnareLjud(v.personer.length > 0),
      nycklar: [],
    };
  }

  if (typ === "order") {
    let order: TavleOrder;
    let person: TavlePerson;
    let variant: OrderVariant;
    let taggar: Tagg[];
    if (f.typ === "order") {
      order = f.order;
      person = efter.personer[order.person] ?? DOLD;
      const dold = person.dold !== false;
      variant = dold && f.variant === "forsta" ? (order.niva === "stor" ? "stor" : "vanlig") : f.variant;
      taggar = dold ? f.taggar.filter((t) => t.typ !== "personbasta") : f.taggar;
    } else {
      const testtyp = f.typ === "test" ? f.testtyp : "order";
      variant = testtyp === "stor" ? "stor" : testtyp === "forsta" ? "forsta" : "vanlig";
      order = testorder(0, o.nuIso, dag, variant === "stor", variant === "forsta");
      person = TESTPERSONER[0];
      taggar = [];
    }
    const rad = test ? undefined : efterTal.rader.find((r) => r.person === order.person);
    const belopp = order.belopp ?? 0;
    const tider = orderTider(variant);
    return {
      ...bas,
      data: {
        typ: "order",
        order,
        person,
        variant,
        taggar,
        manad,
        fakta: {
          nr: rad ? rad.antal : null,
          idag: rad ? rad.idag : null,
          platsFore: rad ? platsI(foreTal, order.person, o.ordning) : null,
          plats: rad ? platsI(efterTal, order.person, o.ordning) : null,
          storsta: foreTal.lag.storsta !== null && belopp > foreTal.lag.storsta,
        },
        lag: steg(test ? { varde: foreTal.lag.varde + belopp, antal: foreTal.lag.antal + 1 } : lagUr(efterTal)),
      },
      tider,
      varaktighet: tider.slut,
      spar: orderLjud(variant, belopp),
      nycklar: test ? [] : [order.nyckel],
    };
  }

  if (typ === "serie") {
    const order = f.typ === "serie" ? f.order : [0, 1, 2].map((i) => testorder(i, o.nuIso, dag, false, false));
    const personer: Record<string, TavlePerson> = f.typ === "serie" ? efter.personer : Object.fromEntries(TESTPERSONER.map((p) => [p.nyckel, p]));
    const summa = order.reduce((s, x) => s + (x.belopp ?? 0), 0);
    const tider = serieTider(order.length);
    return {
      ...bas,
      data: {
        typ: "serie",
        order,
        personer,
        manad,
        lag: steg(test ? { varde: foreTal.lag.varde + summa, antal: foreTal.lag.antal + order.length } : lagUr(efterTal)),
      },
      tider,
      varaktighet: tider.slut,
      spar: serieLjud(Math.min(order.length, SERIE_MAX)),
      nycklar: test ? [] : order.map((x) => x.nyckel),
    };
  }

  // Målet nått: laget som det står, de som sålt i ordning.
  const laget = rangordna(efterTal.rader, o.ordning)
    .filter((r) => r.antal > 0)
    .map((r) => ({ namn: (efter.personer[r.person] ?? DOLD).namn, antal: r.antal, varde: r.varde }));
  // Ordern vars godkännande är målets tidpunkt tog laget över.
  const avgor = f.typ === "malet" ? efter.order.find((x) => x.tid === f.natt) : undefined;
  const avgorare = avgor ? efter.personer[avgor.person] : undefined;
  const basta = Math.max(0, ...efter.historik.slice(-11).map((m) => m.varde));
  const tider = maletTider();
  return {
    ...bas,
    data: {
      typ: "malet",
      manad,
      mal: mal ?? Math.max(1, efterTal.lag.varde),
      varde: efterTal.lag.varde,
      antal: efterTal.lag.antal,
      dagarKvar: Math.max(0, efter.manad.dagar.totalt - efter.manad.dagar.gangna),
      laget,
      avgorande: avgorare && avgorare.dold === false ? avgorare.namn : null,
      rekord: basta > efterTal.lag.varde ? basta : null,
    },
    tider,
    varaktighet: tider.slut,
    spar: maletLjud(),
    nycklar: [],
  };
}

// -----------------------------------------------------------------------------
// Vad tavlan visar vid en bildruta
// -----------------------------------------------------------------------------

/** Allt tavlan i vila behöver för att rita sig vid en bildruta. */
export type Visning = {
  /** Bilden vars flöde, graf, dagar och personer syns. */
  bild: Ogonblick;
  /** Talen som syns: bildens, utan det som väntar. */
  tal: Siffror;
  /** Order som väntar i kön: de syns inte i flödet och räknas inte. */
  utesluten: ReadonlySet<string>;
  /** Rader i flödet som panelen ännu inte landat på: platsen hålls, raden syns inte. */
  dolda: ReadonlySet<string>;
  /** Halvvägs i målkortet: bildrutan i dess förlopp, eller null. */
  halvvags: number | null;
};

const TOM: ReadonlySet<string> = new Set();

/**
 * Vad tavlan visar vid bildrutan `r` i förloppet `spel` (null i vila). `vantande` är
 * kön och det som samlas.
 */
export function visning(o: { visad: Ogonblick; vantande: readonly Kopost[]; spel: Forlopp | null; r: number }): Visning {
  const utesluten = new Set(o.vantande.flatMap((p) => nycklarFor(p.firande)));
  const spel = o.spel;
  if (!spel || spel.test || spel.data.typ === "malet" || spel.data.typ === "halvvags" || arTavlingsscen(spel.data.typ)) {
    return {
      bild: o.visad,
      tal: siffror(o.visad, utesluten),
      utesluten,
      dolda: TOM,
      halvvags: spel?.data.typ === "halvvags" ? o.r : null,
    };
  }
  const egna = new Set(spel.nycklar);
  if (o.r < spel.tider.byt) {
    return { bild: spel.fore, tal: siffror(spel.fore, new Set([...utesluten, ...egna])), utesluten: new Set([...utesluten, ...egna]), dolda: TOM, halvvags: null };
  }
  const storsta = siffror(spel.fore, new Set([...utesluten, ...egna])).lag.storsta;
  return {
    bild: spel.efter,
    tal: siffror(spel.efter, utesluten, storsta),
    utesluten,
    dolda: o.r < spel.varaktighet ? egna : TOM,
    halvvags: null,
  };
}

/**
 * Tavlans motrörelse när svepet kommer, i u (1 u = 1 px på 1920×1080): en vanlig
 * order och en serie lyfter tavlan 40 u och skalar den till 0,97; en stor affär
 * skalar den till 0,92 när springan öppnar sig. När kompositionen krymper står
 * tavlan tillbaka, och det är den som syns runt panelen.
 */
export function tavlansRorelse(spel: Forlopp | null, r: number): { dy: number; skala: number } {
  if (!spel || spel.data.typ === "malet" || spel.data.typ === "halvvags" || arTavlingsscen(spel.data.typ) || r >= spel.tider.byt) return { dy: 0, skala: 1 };
  if (spel.data.typ === "order" && spel.data.variant === "stor") return { dy: 0, skala: ip(r, [0, 28], [1, 0.92], SVEP) };
  return { dy: ip(r, [0, 23], [0, -40], SVEP), skala: ip(r, [0, 23], [1, 0.97], SVEP) };
}
