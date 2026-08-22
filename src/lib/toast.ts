/**
 * E5.7 / UI-PRD §5.7: kvittot nere till hoger, med angra.
 *
 * Ren logik, inga importer. Sjalva kakan skrivs i en server action och lases i
 * (app)-layouten.
 *
 * ===========================================================================
 * ANGRA AR EN VERKLIG INVERS ATGARD, INTE EN FORDROJD SKRIVNING.
 *
 * Det vanliga monstret ar att vanta atta sekunder med att utfora nagot och
 * avbryta om nagon trycker angra. Det gar sonder pa forsta kontakten med
 * verkligheten: anvandaren stanger fliken, natet dor, eller servern skalas ned
 * — och atgarden hon TRODDE var gjord blev aldrig av. Ett tyst uteblivet
 * arkiverande ar varre an ett arkiverande hon far angra.
 *
 * Har sker atgarden direkt. Angra kor motsatsen, och bada raderna hamnar i
 * audit_log. Det gor att bara atgarder med en AKTA invers far en angra-knapp:
 *
 *   arkivera nyhet   -> publicera igen        JA
 *   avsluta felrapport -> oppna igen          JA
 *   arkivera avtalsmall -> publicera igen     JA
 *
 *   publicera nyhet                           NEJ, gar inte att ta ur nagons
 *                                             minne — spärren star redan i
 *                                             nyheternas actions.ts
 *   stampling                                 NEJ, AC-2.3 forbjuder andring
 *   utfarda avtal                             NEJ, det ar "dra tillbaka" och
 *                                             det kraver ett skal
 *   radera fil                                NEJ, filen ar borta
 * ===========================================================================
 */

export const TOAST_KAKA = "nav_kvitto";

/** Vad angra-knappen anropar. Stangd lista — se dispatchern i angra/actions.ts. */
export const ANGRABARA = [
  "nyhet.arkiverad",
  "fel.avslutad",
  "mall.arkiverad",
] as const;

export type Angrabar = (typeof ANGRABARA)[number];

export type Kvitto = {
  /** Vad som hande. Kort, i preteritum, utan utropstecken. */
  text: string;
  /** Utan detta blir det en ren bekraftelse utan knapp. */
  angra?: { handling: Angrabar; id: string };
};

/**
 * Hur lange kvittot star kvar.
 *
 * Atta sekunder ar langre an de fem som brukar anvandas. Skalet ar att kvittot
 * har inte bara bekraftar utan bar en handling — och en knapp som forsvinner
 * innan man hunnit lasa vad den gor ar samre an ingen knapp.
 *
 * Det ar ocksa darfor kvittot INTE forsvinner medan pekaren ar over det, och
 * inte alls om nagon tabbat sig in i det.
 */
export const SEKUNDER = 8;

/** Kakan bar lite och kort. En lang kaka foljer med varje request. */
export function tillKaka(kvitto: Kvitto): string {
  return encodeURIComponent(
    JSON.stringify({
      t: kvitto.text.slice(0, 160),
      ...(kvitto.angra ? { a: kvitto.angra.handling, i: kvitto.angra.id } : {}),
    }),
  );
}

/**
 * Lasningen litar inte pa innehallet.
 *
 * Kakan gar att skriva i webblasaren, sa `handling` maste finnas i den stangda
 * listan och id:t maste se ut som ett id. Utan det hade knappen kunnat
 * fabriceras — och aven om dispatchern kontrollerar behorigheten i alla fall,
 * ska en trasig kaka ge ingen toast i stallet for en trasig sida.
 */
export function franKaka(raKaka: string | undefined): Kvitto | null {
  if (!raKaka) return null;
  try {
    const o = JSON.parse(decodeURIComponent(raKaka)) as { t?: unknown; a?: unknown; i?: unknown };
    const text = typeof o.t === "string" ? o.t.trim() : "";
    if (!text) return null;

    const handling = typeof o.a === "string" ? o.a : null;
    const id = typeof o.i === "string" ? o.i : null;

    if (handling && id && (ANGRABARA as readonly string[]).includes(handling) && arId(id)) {
      return { text, angra: { handling: handling as Angrabar, id } };
    }
    return { text };
  } catch {
    return null;
  }
}

/** Uuid eller slug. Inget annat far ta sig in i dispatchern. */
export function arId(varde: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,80}$/i.test(varde);
}
