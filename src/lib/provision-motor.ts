/**
 * E13 steg 2: raknemotorn.
 *
 * Ren logik — inga anrop, inga hemligheter, ingen import av Supabase. Samma
 * linje som `raster.ts`, `lonekostnad.ts` och `order.ts`: motorn ska ga att
 * prova utan att starta Next. Se `tests/provision-motor.mjs`.
 *
 * ===========================================================================
 * MOTORN RETURNERAR ETT UNDERLAG, INTE ETT TAL.
 *
 * Bestallarens krav (PROVISION_SPEC.md avsnitt 12): bade saljaren och chefen
 * ska kunna se VARFOR en summa blev som den blev. En funktion som svarar
 * `12400` gar inte att ifragasatta och darmed inte att lita pa — den forsta
 * gangen nagon tycker att siffran ar fel finns det ingenting att peka pa.
 *
 * Darfor ar `Underlag.rader` det egentliga svaret och `summa` bara deras
 * summa. Vyn VISAR raderna. Den raknar aldrig om nagot sjalv, och den lagger
 * aldrig till en post som motorn inte kanner till.
 * ===========================================================================
 *
 * INGEN SATS OCH INGET BONUSBELOPP STAR I DEN HAR FILEN.
 *
 * Sok efter ett tal harunder och du hittar 0, 1 och 2. Grundprovisionen ligger
 * frusen pa ordern (0034), och bonusniverna kommer i steg 3 som argument.
 * AC-10.1 kraver att provisionsreglerna ar konfiguration och inte kod.
 */

import {
  grundprovision,
  makuleradeIPeriod,
  orderIPeriod,
  type Order,
} from "./order.ts";

// -----------------------------------------------------------------------------
// Underlaget
// -----------------------------------------------------------------------------

/**
 * Slagen av rader ett underlag kan bara.
 *
 * `volymbonus`, `kv_bonus`, `ovrig_bonus` och `avdrag` fylls av steg 3, 5 och
 * 6. De star med redan nu for att vyn och periodstangningen ska kunna skrivas
 * mot en form som inte andrar sig under fotterna pa dem — en rad som byter
 * namn efter att den bokforts i `commission_entry` gor historiken olasbar.
 */
export const RADSLAG = [
  "order",
  "makulering",
  "volymbonus",
  "kv_bonus",
  "ovrig_bonus",
  "avdrag",
] as const;

export type Radslag = (typeof RADSLAG)[number];

export type Underlagsrad = {
  slag: Radslag;
  /** Vad raden ar, pa svenska. Samma text i vyn, i exporten och i huvudboken. */
  text: string;
  /** Signerat. Ett avdrag ar ett negativt belopp, aldrig ett positivt med flagga. */
  belopp: number;
  /** Ordern raden kommer ur, nar den kommer ur en order. */
  order_id?: string;
};

export type Underlag = {
  employee_id: string;
  manad: string;

  /** Hela svaret. `summa` ar deras summa och ingenting mer. */
  rader: Underlagsrad[];

  /**
   * Ordervolymen manaden raknas pa.
   *
   * `netto` kan bli NEGATIVT och det ar avsiktligt — makuleras fler order an
   * som tecknats i manaden ar saldot minus. Volymtrappan i steg 3 ger da niva
   * noll, aldrig en negativ niva, men provisionsavdraget sker anda.
   */
  antal: { signerade: number; makulerade: number; netto: number };

  grundprovision: number;
  summa: number;
};

// -----------------------------------------------------------------------------
// Avrundning
// -----------------------------------------------------------------------------

/**
 * Hela kronor, matematiskt.
 *
 * `Math.round` ensamt duger inte: den avrundar mot plus oandligheten, sa
 * -0,5 blir -0 i stallet for -1. Halvor ska ga BORT fran nollan at bada hallen,
 * annars ar ett avdrag pa 1500,50 kr systematiskt snallare mot bolaget an ett
 * tillagg pa lika mycket.
 *
 * AVRUNDA EN GANG, PA DEN FARDIGA RADEN (avsnitt 5.4). Aldrig per order pa
 * vagen: trettio orebelopp som avrundas var for sig blir upp till trettio
 * kronors avvikelse mot samma tal avrundat till sist.
 */
export function avrunda(belopp: number): number {
  return belopp < 0 ? -Math.round(-belopp) : Math.round(belopp);
}

/** Summan av rader. Det enda satt en summa far raknas fram pa. */
export function summaAv(rader: Underlagsrad[]): number {
  return rader.reduce((s, r) => s + r.belopp, 0);
}

// -----------------------------------------------------------------------------
// Radtexterna
//
// Texten byggs har och inte i vyn. Skalet ar att samma rad hamnar pa tre
// stallen — saljarens vy, chefens export och `commission_entry.note` nar
// perioden stangs — och tre formuleringar av samma post ar tre tillfallen att
// tro att de ar olika poster.
// -----------------------------------------------------------------------------

function ordertext(o: Order): string {
  const tillagg = o.is_addon ? ", tillägg" : "";
  return `Order ${o.signed_on}, paket ${o.package_id}, ${o.term_months} mån${tillagg}`;
}

function makuleringstext(o: Order): string {
  return `Makulerad order, tecknad ${o.signed_on}`;
}

// -----------------------------------------------------------------------------
// Motorn
// -----------------------------------------------------------------------------

/** Orderna som hor till en person. */
export function forSaljare(order: Order[], employee_id: string): Order[] {
  return order.filter((o) => o.salesperson_id === employee_id);
}

/**
 * Underlaget for en person och en manad.
 *
 * `order` far garna vara hela materialet — motorn plockar sjalv ut personens
 * rader och manadens. Skalet ar att chefens vy hamtar allas order i en fraga,
 * och ett filter som anroparen ansvarar for ar ett filter nagon glommer.
 *
 * TVA HANDELSER, INTE EN. En makulerad order bidrar bade i sin
 * SIGNERINGSMANAD (plus) och i sin MAKULERINGSMANAD (minus). Det ar det som
 * gor att en stangd period aldrig behover skrivas om — se `harGodkants` i
 * `order.ts` for felet som uppstar nar de tva blandas ihop.
 */
export function raknaUnderlag(
  employee_id: string,
  order: Order[],
  manad: string,
): Underlag {
  const mina = forSaljare(order, employee_id);

  const signerade = orderIPeriod(mina, manad);
  const makulerade = makuleradeIPeriod(mina, manad);

  const rader: Underlagsrad[] = [
    ...signerade.map((o) => ({
      slag: "order" as const,
      text: ordertext(o),
      // Beloppet tas fran ORDERN, inte ur matrisen. Ordern bar den frusna
      // satsen (0034), sa en sats som andras i november andrar inte vad nagon
      // tjanade i augusti. `?? 0` nas aldrig — villkoret
      // `sales_order_provision_satt` kraver ett belopp fran och med `signerad`
      // — men en tyst nolla ar battre an ett kastat fel i en lonevy.
      belopp: o.commission_amount ?? 0,
      order_id: o.id,
    })),
    ...makulerade.map((o) => ({
      slag: "makulering" as const,
      text: makuleringstext(o),
      belopp: -(o.commission_amount ?? 0),
      order_id: o.id,
    })),
  ];

  return {
    employee_id,
    manad,
    rader,
    antal: {
      signerade: signerade.length,
      makulerade: makulerade.length,
      netto: signerade.length - makulerade.length,
    },
    // Samma tal som raderna ger. Det star som eget falt for att steg 3 raknar
    // procentbonus PA det, och for att en avvikelse mellan de tva ar ett fel
    // som ska ga att se — provet kontrollerar att de aldrig glider isar.
    grundprovision: grundprovision(mina, manad),
    summa: summaAv(rader),
  };
}

/**
 * Underlag for samtliga saljare med rorelse i manaden. Chefens vy.
 *
 * Ordningen ar id-ordning och inte beloppsordning: en lista som sorterar
 * personer efter vad de tjanat blir en rangordning, och det ar inte vad vyn
 * ar till for. Sortering pa namn gors av vyn, som ar den som har namnen.
 */
export function underlagForAlla(order: Order[], manad: string): Underlag[] {
  const personer = new Set<string>();
  for (const o of [...orderIPeriod(order, manad), ...makuleradeIPeriod(order, manad)]) {
    personer.add(o.salesperson_id);
  }

  return [...personer].sort().map((id) => raknaUnderlag(id, order, manad));
}
