/**
 * E13 steg 5: K&V-protokollet. Ren logik — inga anrop, inga hemligheter.
 *
 * Samma linje som `raster.ts`, `order.ts` och `provision-motor.ts`: filen ska
 * ga att prova utan att starta Next. Se `tests/kv.mjs`.
 *
 * ===========================================================================
 * INGEN POANG OCH INGEN PROCENTSATS STAR I DEN HAR FILEN.
 *
 * Sok efter ett tal harunder och du hittar 0, 1, 4, 7, 100 och 12 — veckodagar,
 * procentnamnaren och manadstal. Troskeln, procenten per godkand vecka, taket
 * och maxpoangen per omrade ligger i `kv_policy` och `kv_criterion` (0036) och
 * kommer hit som argument.
 *
 * AC-10.1 kraver det, men skalet ar praktiskt: O4 var obesvarad i ett dygn och
 * hade tre lasningar med maxpoang 200, 400 och 2 400. En sats i koden hade
 * betytt en deploy per lasning.
 * ===========================================================================
 */

import { manadsnyckel } from "./provision.ts";

// -----------------------------------------------------------------------------
// Formen pa det databasen bar. Speglar 0036 utan att veta om databasen.
// -----------------------------------------------------------------------------

export type KvPolicy = {
  id: string;
  calls_per_week: number;
  threshold_points: number;
  percent_per_week: number;
  cap_percent: number;
  valid_from: string;
  valid_to: string | null;
};

export type KvKriterium = {
  id: string;
  label: string;
  /** null = EJ SATT. Utan den gar inget samtal att bedoma. */
  max_points: number | null;
  sort: number;
  active: boolean;
};

export type KvSamtal = {
  id: string;
  employee_id: string;
  call_date: string;
  customer: string;
  /** Summan av bedomningens poang, eller null nar samtalet inte ar bedomt. */
  poang: number | null;
};

// -----------------------------------------------------------------------------
// Veckan
// -----------------------------------------------------------------------------

/**
 * Mandagen i datumets ISO-vecka, som "2026-08-24".
 *
 * Nyckeln ar ett datum och inte ett veckonummer med flit: "2026-W01" sorterar
 * fel over ett arsskifte, och ISO-veckonumret hor till torsdagens ar och inte
 * alltid till datumets. Ett datum sorterar ratt av sig sjalvt.
 *
 * Klockan 12:00 UTC och inte 00:00. Ett datum tolkat som midnatt UTC och sedan
 * flyttat med `setUTCDate` ar sarbart for varje sommartidsantagande nagon
 * senare lagger till; mitt pa dagen finns ingen sadan kant att ramla over.
 */
export function veckostart(datum: string): string {
  const d = new Date(`${datum}T12:00:00Z`);
  const dag = d.getUTCDay() || 7; // 1 = mandag ... 7 = sondag
  d.setUTCDate(d.getUTCDate() - (dag - 1));
  return d.toISOString().slice(0, 10);
}

/** Torsdagen i datumets ISO-vecka. */
export function veckansTorsdag(datum: string): string {
  const d = new Date(`${datum}T12:00:00Z`);
  const dag = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + (4 - dag));
  return d.toISOString().slice(0, 10);
}

/**
 * Manaden en vecka hor till (O9).
 *
 * ===========================================================================
 * VECKAN HOR TILL DEN MANAD DAR DESS TORSDAG LIGGER.
 *
 * En ISO-vecka spanner ofta over ett manadsskifte, och da maste nagon regel
 * avgora vilken manads bonus den raknas i. Torsdagsregeln ar ISO-standardens
 * egen, den ar deterministisk, och den ger alltid fyra eller fem veckor per
 * manad utan overlapp och utan glapp.
 *
 * Alternativen ar samre pa ett satt som inte syns forrans det gor ont:
 * "manaden dar veckan borjar" ger nagra ar tretton veckor pa ett kvartal och
 * elva pa nasta, och "dela veckan" gor att en vecka kan bli godkand i bada
 * manaderna pa halva poangen var.
 *
 * O9 ar ett FORSLAG som galler tills bestallaren sager annat.
 * ===========================================================================
 */
export function manadForVecka(datum: string): string {
  return manadsnyckel(veckansTorsdag(datum));
}

/** ISO-veckonumret, for visning. Hor till torsdagens ar. */
export function veckonummer(datum: string): number {
  const torsdag = new Date(`${veckansTorsdag(datum)}T12:00:00Z`);
  const nyar = new Date(Date.UTC(torsdag.getUTCFullYear(), 0, 1, 12));
  const dygn = Math.round((torsdag.getTime() - nyar.getTime()) / 86400000);
  return Math.floor(dygn / 7) + 1;
}

// -----------------------------------------------------------------------------
// Konfigurationen
// -----------------------------------------------------------------------------

/**
 * Reglerna som galler for en MANAD. Samma uppslag som volymtrappan i
 * `provision-motor.ts` och av samma skal: K&V-bonusen ar en egenskap hos hela
 * manaden, inte hos ett enskilt samtal. Se O16.
 */
export function gallandePolicy(policyer: KvPolicy[], manad: string): KvPolicy | null {
  const traffar = policyer.filter(
    (p) => p.valid_from <= manad && (p.valid_to === null || p.valid_to > manad),
  );
  if (traffar.length === 0) return null;
  return traffar.sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1))[0];
}

/**
 * Maxpoangen en vecka kan ge: summan av omradenas tak gange antalet samtal.
 *
 * `null` sa fort ETT aktivt omrade saknar maxpoang. Att rakna med de omraden
 * som ar ifyllda hade gett ett tak som ser ratt ut och ar for lagt, och da hade
 * troskeln sett omojlig ut av fel skal.
 */
export function maxpoangPerVecka(kriterier: KvKriterium[], policy: KvPolicy): number | null {
  const aktiva = kriterier.filter((k) => k.active);
  if (aktiva.length === 0) return null;
  if (aktiva.some((k) => k.max_points === null)) return null;

  const perSamtal = aktiva.reduce((s, k) => s + (k.max_points ?? 0), 0);
  return perSamtal * policy.calls_per_week;
}

/**
 * Vad troskeln motsvarar i procent av maxpoangen.
 *
 * DET HAR ar kontrollen O4 handlade om. Bestallaren svarade "200", och samma
 * troskel — 160 — betydde 6,7 %, 40 % eller 80 % beroende pa vilken 200 som
 * menades. Installningssidan visar talet medan man skriver, sa att en skala som
 * gor troskeln meningslos eller omojlig syns innan den sparas.
 */
export function troskelIProcent(
  kriterier: KvKriterium[],
  policy: KvPolicy,
): number | null {
  const max = maxpoangPerVecka(kriterier, policy);
  if (max === null || max === 0) return null;
  return (policy.threshold_points / max) * 100;
}

/**
 * Vad som ar fel i konfigurationen, pa svenska, eller null nar den haller.
 *
 * Returnerar en TEXT och inte en boolean: formularet ska kunna saga VAD som ar
 * fel, och samma mening ska kunna visas bade nar nagon sparar och nar nagon
 * bara tittar.
 */
export function konfigurationsfel(
  kriterier: KvKriterium[],
  policy: KvPolicy,
): string | null {
  const aktiva = kriterier.filter((k) => k.active);
  if (aktiva.length === 0) return "Inga områden är aktiva. Ingenting går att bedöma.";

  const utan = aktiva.filter((k) => k.max_points === null);
  if (utan.length > 0) {
    return `Maxpoäng saknas för ${utan.map((k) => k.label).join(", ")}. Fyll i den innan något bedöms.`;
  }

  const max = maxpoangPerVecka(kriterier, policy);
  if (max === null || max === 0) return "Maxpoängen går inte att räkna ut.";

  if (policy.threshold_points > max) {
    return `Tröskeln ${policy.threshold_points} poäng går inte att nå — maxpoängen för en vecka är ${max}.`;
  }

  return null;
}

// -----------------------------------------------------------------------------
// Veckorna och bonusen
// -----------------------------------------------------------------------------

export type Vecka = {
  /** Mandagen, som datum. Sorterar ratt. */
  start: string;
  nummer: number;
  samtal: KvSamtal[];
  /** Antal samtal som faktiskt ar bedomda. */
  bedomda: number;
  /** Summan av de bedomda samtalens poang. */
  poang: number;
  /**
   * Ar veckan bedomd enligt reglerna, alltsa har samtliga samtal veckan kraver
   * blivit bedomda? Se `veckorFor` for varfor det inte racker med ett.
   */
  fullstandig: boolean;
  /** Godkand vecka: fullstandig OCH over troskeln. */
  godkand: boolean;
};

/**
 * Veckorna i en manad for en person.
 *
 * ===========================================================================
 * EN VECKA RAKNAS FORST NAR ALLA SAMTAL DEN KRAVER AR BEDOMDA.
 *
 * Foljer av avsnitt 6.1 och 6.2 tillsammans. Troskeln ar definierad som
 * SUMMAN AV BADA SAMTALEN (fraga 29), sa den betyder ingenting for en vecka dar
 * bara ett samtal bedomts: med maxpoang 100 per samtal ar troskeln 160 omojlig
 * pa ett samtal, och veckan hade blivit UNDERKAND av ett skal som ar chefens
 * och inte saljarens.
 *
 * Avsnitt 6.2 sager att en vecka utan bedomning hoppas over, "oavsett skal:
 * sjukdom, semester, nollvecka, eller att chefen inte hann". En halvbedomd
 * vecka ar samma sak — chefen hann halva vagen — och behandlas darfor likadant:
 * varken for eller emot.
 *
 * Regeln foljer av specifikationen men star inte utskriven i den. Den ar
 * inarbetad i avsnitt 6.2 2026-08-25.
 * ===========================================================================
 */
export function veckorFor(
  samtal: KvSamtal[],
  manad: string,
  policy: KvPolicy,
): Vecka[] {
  const per = new Map<string, KvSamtal[]>();

  for (const s of samtal) {
    if (manadForVecka(s.call_date) !== manad) continue;
    const start = veckostart(s.call_date);
    per.set(start, [...(per.get(start) ?? []), s]);
  }

  return [...per.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([start, ivecka]) => {
      const bedomda = ivecka.filter((s) => s.poang !== null);
      const poang = bedomda.reduce((sum, s) => sum + (s.poang ?? 0), 0);
      const fullstandig = bedomda.length >= policy.calls_per_week;

      return {
        start,
        nummer: veckonummer(start),
        samtal: ivecka,
        bedomda: bedomda.length,
        poang,
        fullstandig,
        godkand: fullstandig && poang >= policy.threshold_points,
      };
    });
}

/**
 * Procentsatsen manadens godkanda veckor ger.
 *
 * TAKET GALLER AVEN I EN MANAD MED FEM VECKOR (fraga 32). Med 1,25 % per vecka
 * och tak 5 % betyder det hogst fyra godkanda veckor — den femte ger ingenting,
 * och det ar avsiktligt.
 */
export function kvProcent(godkandaVeckor: number, policy: KvPolicy): number {
  return Math.min(godkandaVeckor * policy.percent_per_week, policy.cap_percent);
}

export type KvManad = {
  veckor: Vecka[];
  godkanda: number;
  /** Veckor med en fullstandig bedomning, godkanda eller ej. */
  bedomda: number;
  procent: number;
};

/** Manadens K&V-utfall for en person. Underlaget motorn far. */
export function kvManad(samtal: KvSamtal[], manad: string, policy: KvPolicy): KvManad {
  const veckor = veckorFor(samtal, manad, policy);
  const godkanda = veckor.filter((v) => v.godkand).length;

  return {
    veckor,
    godkanda,
    bedomda: veckor.filter((v) => v.fullstandig).length,
    procent: kvProcent(godkanda, policy),
  };
}

// -----------------------------------------------------------------------------
// Utvecklingskurvan
// -----------------------------------------------------------------------------

export type Poangrad = { call_date: string; criterion_id: string; points: number };

export type Kurvpunkt = { manad: string; snitt: number; antal: number };

/**
 * Snittpoangen per omrade och manad, aldst forst. Saljarens utvecklingskurva
 * (avsnitt 6.6).
 *
 * SNITT OCH INTE SUMMA. En manad med fem bedomda samtal ger en hogre summa an
 * en med tre utan att nagot blivit battre, och en kurva som stiger nar man
 * jobbar mer ar inte en utvecklingskurva.
 *
 * Manaden raknas med torsdagsregeln, samma som bonusen — annars kan en punkt i
 * kurvan ligga i en annan manad an den vecka som gav bonusen.
 */
export function kurvaPerOmrade(rader: Poangrad[]): Map<string, Kurvpunkt[]> {
  const per = new Map<string, Map<string, number[]>>();

  for (const r of rader) {
    const manad = manadForVecka(r.call_date);
    const omrade = per.get(r.criterion_id) ?? new Map<string, number[]>();
    omrade.set(manad, [...(omrade.get(manad) ?? []), r.points]);
    per.set(r.criterion_id, omrade);
  }

  const ut = new Map<string, Kurvpunkt[]>();
  for (const [criterion_id, manader] of per) {
    ut.set(
      criterion_id,
      [...manader.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([manad, poang]) => ({
          manad,
          snitt: poang.reduce((s, p) => s + p, 0) / poang.length,
          antal: poang.length,
        })),
    );
  }

  return ut;
}
