/**
 * E2.13: den globala sokningen i toppraden.
 *
 * Ren logik, inga importer. Sjalva fragorna stalls i `/sok/page.tsx` med
 * ANVANDARENS EGEN TOKEN — malgruppsstyrningen, konfidentiella arenden och
 * vem som far se vilka i personalregistret sitter i RLS, och ett eget filter
 * hade blivit ett andra svar pa samma fraga.
 */

/** Kallorna i den ordning de visas. Ordningen ar inte alfabetisk utan
 *  sannolikhetsordnad: den som soker i navet letar oftast efter en rutin. */
export const KALLOR = ["rutin", "nyhet", "kurs", "person", "arende"] as const;

export type Kalltyp = (typeof KALLOR)[number];

export const KALLA_ETIKETT: Record<Kalltyp, string> = {
  rutin: "Rutiner och dokument",
  nyhet: "Nyheter",
  kurs: "Utbildning",
  person: "Personal",
  arende: "Personalärenden",
};

export type Traff = {
  typ: Kalltyp;
  titel: string;
  under: string | null;
  href: string;
};

/** Hogst sa manga per kalla pa traffsidan. Fler an sa och den som letade
 *  efter en person maste scrolla forbi trettio rutiner for att hitta hen. */
export const PER_KALLA = 6;

/**
 * Escapar en fritextstrang for `ilike`.
 *
 * `%` och `_` ar jokertecken i SQL. Utan det har blir en sokning pa "50 %" en
 * sokning pa allt, och en sokning pa "a_b" traffar "axb".
 */
export function ilikeMonster(q: string): string {
  return `%${q.replace(/[\\%_]/g, (t) => `\\${t}`)}%`;
}

/**
 * Samma monster, men citerat for att kunna sta inuti `.or(...)`.
 *
 * PostgREST separerar villkoren i en `or` med KOMMATECKEN, och tolkar dem
 * innan Postgres ser dem. Ett osskyddat kommatecken i sokrutan ger darfor
 * HTTP 400 — inte noll traffar, utan ett fel som slar ut hela traffsidan.
 * Provat skarpt: `first_name.ilike.%a,b%` svarar 400, samma monster inom
 * citattecken svarar 200.
 *
 * Citattecken och bakstreck maste i sin tur escapas inuti citaten, annars
 * flyttas problemet bara ett steg.
 */
export function orMonster(q: string): string {
  return `"${ilikeMonster(q).replace(/["\\]/g, (t) => `\\${t}`)}"`;
}

/** Bygger hela `or`-uttrycket for ett antal kolumner. */
export function orVillkor(kolumner: string[], q: string): string {
  const m = orMonster(q);
  return kolumner.map((k) => `${k}.ilike.${m}`).join(",");
}

/**
 * Korta ned en text till ett sammanhang runt traffen.
 *
 * Den som soker vill se VARFOR nagot ar en traff. En bodytext som klipps av
 * efter hundra tecken fran borjan visar oftast rubriken en gang till.
 */
export function utdrag(text: string | null, q: string, langd = 120): string | null {
  if (!text) return null;
  const ren = text.replace(/[#*_`>\-]/g, " ").replace(/\s+/g, " ").trim();
  if (!ren) return null;

  const plats = ren.toLowerCase().indexOf(q.toLowerCase());
  if (plats < 0) return ren.slice(0, langd) + (ren.length > langd ? " …" : "");

  const start = Math.max(0, plats - Math.floor(langd / 3));
  const slut = Math.min(ren.length, start + langd);
  return (start > 0 ? "… " : "") + ren.slice(start, slut).trim() + (slut < ren.length ? " …" : "");
}
