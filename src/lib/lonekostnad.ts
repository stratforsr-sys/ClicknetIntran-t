/**
 * E15 / M13: vad en anstalld kostar, och hur mycket hen maste salja for att
 * bara sin egen kostnad.
 *
 * Ren logik, inga importer — samma skal som `franvaro.ts`: reglerna ska ga att
 * prova utan att starta Next och utan att fraga databasen.
 *
 * ===========================================================================
 * INGEN PROCENTSATS OCH INGEN ALDERSGRANS STAR I DEN HAR FILEN.
 *
 * E15.2 och §13.2. Varje sats kommer in som argument ur `cost_rate` (0025).
 * Det gor tva saker: en satsandring blir en rad i stallet for en deploy, och
 * `rates_used` kan bevara exakt vad en historisk siffra byggde pa (AC-13.8).
 *
 * Sok efter ett tal i den har filen och du ska bara hitta 0, 1, 12 och 100 —
 * noll, ett, antalet manader pa ett ar, och procentnamnaren.
 * ===========================================================================
 *
 * ===========================================================================
 * K27: FODELSEARET RACKER, OCH DET AR INTE EN KOMPROMISS.
 *
 * Bade ungdomsnedsattningen och nedsattningen for aldre utgar fran aldern VID
 * ARETS INGANG. Den som ar fodd ar B har den 1 januari ar Y fyllt exakt
 * Y - B - 1 ar, oavsett fodelsemanad. Fodelsearet ger alltsa ratt sats exakt,
 * inte ungefar, och ett fodelsedatum hade inte gjort svaret battre.
 *
 * Det som ar per kalendermanad i AC-13.5 ar TAKET: den lagre satsen for unga
 * galler upp till ett belopp per manad. En loneperiod over ett manadsskifte
 * maste darfor delas — se `manaderIPerioden()`.
 * ===========================================================================
 */

export type Satser = {
  /** Full arbetsgivaravgift, i procent. */
  standard: number;
  /** Endast alderspensionsavgift, i procent. Galler unga och aldre. */
  reducerad: number;
  /** Tak per kalendermanad for den lagre satsen. */
  reduceradTak: number;
  /** Fylld alder vid arets ingang, nedre och ovre grans for unga. */
  ungMin: number;
  ungMax: number;
  /** Fylld alder vid arets ingang for den aldre nedsattningen. */
  seniorMin: number;
  /**
   * Tackningsgrad i procent, for break-even (AC-13.7). Null nar ingen satt
   * den — och da raknas inget break-even. En pahittad tackningsgrad ger en
   * siffra som ser exakt ut och ar gissad.
   */
  tackningsgrad: number | null;
  /**
   * Hur stor del av lonen arbetsgivaren betalar anda under franvaron, per
   * franvarotyp och i procent. Saknas typen galler 100 — alltsa full kostnad.
   *
   * Hundra ar ratt hall att fela at: for ett break-even ar en underskattad
   * kostnad farlig och en overskattad bara forsiktig.
   */
  franvarofaktor: Record<string, number>;
};

/** Fylld alder den 1 januari det ar perioden ligger i. Se rubriken om K27. */
export function alderVidAretsIngang(ar: number, fodelsear: number): number {
  return ar - fodelsear - 1;
}

/**
 * Vilken sats som galler, och om den har ett manadstak.
 *
 * Bada nedsattningarna ger samma procentsats. Skillnaden ar att ungdomarnas ar
 * takad per manad och de aldres inte ar det.
 */
export function avgiftssats(
  alderVidIngang: number,
  satser: Satser,
): { procent: number; tak: number | null; grund: "standard" | "ung" | "senior" } {
  if (alderVidIngang >= satser.seniorMin) {
    return { procent: satser.reducerad, tak: null, grund: "senior" };
  }
  if (alderVidIngang >= satser.ungMin && alderVidIngang <= satser.ungMax) {
    return { procent: satser.reducerad, tak: satser.reduceradTak, grund: "ung" };
  }
  return { procent: satser.standard, tak: null, grund: "standard" };
}

export type Manadsdel = {
  ar: number;
  /** 1-12. */
  manad: number;
  /** Antal dagar av manaden som ligger i perioden. */
  dagar: number;
  /** Manadens totala antal dagar. */
  dagarIManaden: number;
};

/**
 * Delar en period pa kalendermanader.
 *
 * En loneperiod behover inte folja manadsskiftet, och taket i AC-13.5 ar per
 * kalendermanad. En period 16 mars-15 april med lon over taket ska inte ge en
 * enda takberakning pa hela beloppet — den ska ge tva.
 */
export function manaderIPerioden(start: string, slut: string): Manadsdel[] {
  const forsta = new Date(`${start}T00:00:00Z`);
  const sista = new Date(`${slut}T00:00:00Z`);
  if (sista < forsta) return [];

  const ut: Manadsdel[] = [];
  let ar = forsta.getUTCFullYear();
  let manad = forsta.getUTCMonth() + 1;

  while (ar < sista.getUTCFullYear() || (ar === sista.getUTCFullYear() && manad <= sista.getUTCMonth() + 1)) {
    const dagarIManaden = new Date(Date.UTC(ar, manad, 0)).getUTCDate();
    const manadStart = new Date(Date.UTC(ar, manad - 1, 1));
    const manadSlut = new Date(Date.UTC(ar, manad - 1, dagarIManaden));

    const fran = manadStart > forsta ? manadStart : forsta;
    const till = manadSlut < sista ? manadSlut : sista;
    const dagar = Math.round((till.getTime() - fran.getTime()) / 86_400_000) + 1;

    ut.push({ ar, manad, dagar, dagarIManaden });

    manad += 1;
    if (manad > 12) {
      manad = 1;
      ar += 1;
    }
  }

  return ut;
}

export type Underlag = {
  /** Manadslonen som galler i perioden. */
  manadslon: number;
  fodelsear: number | null;
  periodStart: string;
  periodSlut: string;
  /** Ur payroll_row.absence_minutes. AC-3.26: aldrig ur sick_report. */
  franvarominuter: Record<string, number>;
  /** Ur payroll_row.worked_minutes. */
  arbetadeMinuter: number;
  /** Manuellt inmatad intakt for perioden, eller null nar ingen finns. */
  intakt: number | null;
};

export type Berakning = {
  manadslon: number;
  franvaroavdrag: number;
  bruttolon: number;
  arbetsgivaravgift: number;
  totalkostnad: number;
  /** Null nar tackningsgraden inte ar satt. */
  breakEven: number | null;
  intakt: number | null;
  /** Null nar ingen intakt matats in. Noll och null betyder olika saker. */
  tackningsbidrag: number | null;
  /** Per kalendermanad, for att kunna visa varfor summan blev som den blev. */
  manader: {
    ar: number;
    manad: number;
    andel: number;
    lonedel: number;
    procent: number;
    grund: string;
    avgift: number;
  }[];
  /** AC-13.8. Bevaras pa raden sa att siffran gar att forklara i efterhand. */
  ratesUsed: Record<string, unknown>;
  /** Det som gor siffran osaker, i klartext for den som laser vyn. */
  anmarkningar: string[];
};

/**
 * Berakningsordningen.
 *
 *   1. manadslon ur `salary_basis`
 *   2. franvaroavdrag: minuter per typ mot total redovisad tid, gangrat med
 *      hur stor del av lonen arbetsgivaren INTE betalar under den franvaron
 *   3. bruttolon = manadslon - avdrag
 *   4. arbetsgivaravgift per kalendermanad, med aldersregel och manadstak
 *   5. totalkostnad = bruttolon + avgift
 *   6. break-even = totalkostnad / tackningsgrad
 *   7. tackningsbidrag = intakt - totalkostnad, bara om en intakt finns
 *
 * Pension och forsakring finns inte i kedjan. Bolaget har inga (besked
 * 2026-08-21), och en sats pa noll i vyn hade sett ut som en kostnad nagon
 * glomt fylla i.
 */
export function raknaLonekostnad(underlag: Underlag, satser: Satser): Berakning {
  const anmarkningar: string[] = [];

  // --- Steg 2: franvaroavdrag -----------------------------------------------
  const franvarominuter = Object.values(underlag.franvarominuter).reduce((s, m) => s + m, 0);
  const redovisadTid = underlag.arbetadeMinuter + franvarominuter;

  let franvaroavdrag = 0;
  if (redovisadTid > 0) {
    for (const [typ, minuter] of Object.entries(underlag.franvarominuter)) {
      if (minuter <= 0) continue;
      const faktor = satser.franvarofaktor[typ] ?? 100;
      const andel = minuter / redovisadTid;
      franvaroavdrag += underlag.manadslon * andel * ((100 - faktor) / 100);
    }
  } else if (Object.keys(underlag.franvarominuter).length === 0) {
    // `{}` betyder "inte matt", inte "ingen franvaro" — se 0012.
    anmarkningar.push(
      "Löneperioden har ingen mätt tid, så ingen frånvaro är avräknad. Kostnaden är hel månadslön.",
    );
  }

  const bruttolon = Math.max(underlag.manadslon - franvaroavdrag, 0);

  // --- Steg 4: arbetsgivaravgift per kalendermanad --------------------------
  const delar = manaderIPerioden(underlag.periodStart, underlag.periodSlut);
  const totaltDagar = delar.reduce((s, d) => s + d.dagar, 0);

  if (underlag.fodelsear === null) {
    anmarkningar.push(
      "Födelseår saknas, så full arbetsgivaravgift används. Fyll i året på personalkortet om personen omfattas av en nedsättning.",
    );
  }

  const manader: Berakning["manader"] = [];
  let arbetsgivaravgift = 0;

  for (const del of delar) {
    const andel = totaltDagar > 0 ? del.dagar / totaltDagar : 0;
    const lonedel = bruttolon * andel;

    const alder =
      underlag.fodelsear === null ? null : alderVidAretsIngang(del.ar, underlag.fodelsear);
    const sats =
      alder === null
        ? { procent: satser.standard, tak: null, grund: "standard" as const }
        : avgiftssats(alder, satser);

    // Taket ar per kalendermanad och galler den del av ERSATTNINGEN som ligger
    // under det. Over taket full sats — inte lagre sats pa hela beloppet.
    let avgift: number;
    if (sats.tak !== null && lonedel > sats.tak) {
      avgift = (sats.tak * sats.procent) / 100 + ((lonedel - sats.tak) * satser.standard) / 100;
      anmarkningar.push(
        `${del.ar}-${String(del.manad).padStart(2, "0")}: lönen överstiger månadstaket för den lägre satsen, så delen över taket har full avgift.`,
      );
    } else {
      avgift = (lonedel * sats.procent) / 100;
    }

    arbetsgivaravgift += avgift;
    manader.push({
      ar: del.ar,
      manad: del.manad,
      andel,
      lonedel,
      procent: sats.procent,
      grund: sats.grund,
      avgift,
    });
  }

  const totalkostnad = bruttolon + arbetsgivaravgift;

  // --- Steg 6 och 7 ---------------------------------------------------------
  let breakEven: number | null = null;
  if (satser.tackningsgrad !== null && satser.tackningsgrad > 0) {
    breakEven = totalkostnad / (satser.tackningsgrad / 100);
  } else {
    anmarkningar.push(
      "Täckningsgraden är inte satt, så break-even går inte att räkna. Sätt den under Satser.",
    );
  }

  const tackningsbidrag = underlag.intakt === null ? null : underlag.intakt - totalkostnad;
  if (underlag.intakt === null) {
    anmarkningar.push(
      "Ingen intäkt är inmatad för perioden, så täckningsbidraget är inte räknat. Det är inte samma sak som noll.",
    );
  }

  return {
    manadslon: avrunda(underlag.manadslon),
    franvaroavdrag: avrunda(franvaroavdrag),
    bruttolon: avrunda(bruttolon),
    arbetsgivaravgift: avrunda(arbetsgivaravgift),
    totalkostnad: avrunda(totalkostnad),
    breakEven: breakEven === null ? null : avrunda(breakEven),
    intakt: underlag.intakt,
    tackningsbidrag: tackningsbidrag === null ? null : avrunda(tackningsbidrag),
    manader: manader.map((m) => ({
      ...m,
      lonedel: avrunda(m.lonedel),
      avgift: avrunda(m.avgift),
    })),
    ratesUsed: {
      standard: satser.standard,
      reducerad: satser.reducerad,
      reduceradTak: satser.reduceradTak,
      ungMin: satser.ungMin,
      ungMax: satser.ungMax,
      seniorMin: satser.seniorMin,
      tackningsgrad: satser.tackningsgrad,
      franvarofaktor: satser.franvarofaktor,
      // Underlaget hor ocksa hit: en sats forklarar ingenting utan talet den
      // tillampades pa.
      manadslon: underlag.manadslon,
      fodelsear: underlag.fodelsear,
      period: [underlag.periodStart, underlag.periodSlut],
      franvarominuter: underlag.franvarominuter,
      arbetadeMinuter: underlag.arbetadeMinuter,
    },
    anmarkningar: [...new Set(anmarkningar)],
  };
}

function avrunda(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Kronor for en manniska att lasa. 48 320,50 kr, inte 48320.5. */
export function kronor(v: number | null): string {
  if (v === null) return "—";
  return `${v.toLocaleString("sv-SE", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} kr`;
}
