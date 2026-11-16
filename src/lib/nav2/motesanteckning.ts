/**
 * Möten: anteckningarna (0310). Reglerna utan databas, så att de går att prova rent.
 *
 * En tråd per kort (`mote_kedja`). Den som bokar lämnar en anteckning till den som håller mötet, och alla som är
 * med på kortet läser, svarar och får notis. INGENTING HÄR GÅR TILL KUNDEN: tråden ligger i en egen tabell som
 * utkorgen, ICS:en och kundbreven aldrig läser (tests/mote-anteckning-aldrig-kund.mjs).
 *
 * PRD: docs/superpowers/specs/2026-11-16-mote-anteckningar-design.md
 */

/** Längsta inlägg, i tecken efter trim. Samma gräns som CHECK-villkoret i 0310. */
export const ANTECKNING_MAX = 4000;
/** Hur många inlägg en läsning ger, de senaste. En tråd på ett kort är kort; gränsen skyddar svaret. */
export const TRAD_MAX = 300;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type Inlagg = {
  id: string;
  kedja_id: string;
  mote_id: string | null;
  av: string;
  text: string | null;
  skapad: string;
  andrad: string | null;
  borttagen: string | null;
};

/**
 * Texten som den ska sparas: radbrytningar som `\n`, inga styrtecken utom radbrytning och tabb, inget tomrum först
 * eller sist. Tomt eller för långt ger ett fel att visa vid rutan.
 */
export function textIndata(v: unknown): { ok: true; text: string } | { ok: false; fel: string } {
  if (typeof v !== "string") return { ok: false, fel: "Skriv något först." };
  // eslint-disable-next-line no-control-regex
  const text = v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (!text) return { ok: false, fel: "Skriv något först." };
  if (text.length > ANTECKNING_MAX) return { ok: false, fel: `Anteckningen är för lång, högst ${ANTECKNING_MAX.toLocaleString("sv-SE")} tecken.` };
  return { ok: true, text };
}

/** Ett id som webbläsaren satt (crypto.randomUUID). Gemener, som Postgres skriver det. */
export function idIndata(v: unknown): string | null {
  return typeof v === "string" && UUID.test(v.toLowerCase()) ? v.toLowerCase() : null;
}

/**
 * Vem som får notis om ett nytt inlägg: de som är med på kortet och alla som skrivit i tråden (en chef som svarat
 * följer den, som i HubSpot), utom den som skrev, de som tystat tråden och de som inte längre är aktiva.
 * Ordningen är stabil (deltagarna först), och varje person en gång.
 */
export function mottagare(p: {
  deltagare: readonly string[];
  forfattare: readonly string[];
  av: string;
  tysta: readonly string[];
  aktiva: ReadonlySet<string>;
}): string[] {
  const tysta = new Set(p.tysta);
  const ut: string[] = [];
  for (const id of [...p.deltagare, ...p.forfattare]) {
    if (!id || id === p.av || tysta.has(id) || !p.aktiva.has(id) || ut.includes(id)) continue;
    ut.push(id);
  }
  return ut;
}

/** Texten kortad till högst `max` tecken på en rad, med … när något klipptes. */
export function kort(text: string, max: number): string {
  const rad = text.replace(/\s+/g, " ").trim();
  if (rad.length <= max) return rad;
  const klipp = rad.slice(0, max - 1);
  const vid = klipp.lastIndexOf(" ");
  return (vid > max * 0.6 ? klipp.slice(0, vid) : klipp).replace(/[\s,.;:–-]+$/, "") + "…";
}

/** Notisen om ett nytt inlägg: "Carl om Nordic Grön AB", och början av texten. */
export function notisText(p: { fornamn: string; bolag: string; text: string }): { rubrik: string; detalj: string } {
  return { rubrik: `${p.fornamn || "En kollega"} om ${p.bolag}`, detalj: kort(p.text, 140) };
}

/** Bokningens notis bär anteckningens början, så att hållaren får en notis i stället för två. */
export function bokningsDetalj(grund: string, anteckning: string | null | undefined): string {
  const t = anteckning ? kort(anteckning, 90) : "";
  return t ? `${grund} · ”${t}”` : grund;
}

/** Trådens ordning: serverns tid, sedan id (två inlägg på samma mikrosekund får ändå en fast ordning). */
export function iOrdning<T extends { skapad: string; id: string }>(lista: readonly T[]): T[] {
  return [...lista].sort((a, b) => (a.skapad < b.skapad ? -1 : a.skapad > b.skapad ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const tid = (s: string | null | undefined): number => (s ? Date.parse(s) : NaN);

/** Antalet inlägg från andra, som inte är borttagna, skrivna efter `settTill`. Ingen sett-rad: allt från andra är nytt. */
export function antalNya(lista: readonly Pick<Inlagg, "av" | "skapad" | "borttagen">[], mig: string, settTill: string | null): number {
  const grans = tid(settTill);
  return lista.filter((a) => a.av !== mig && !a.borttagen && (!Number.isFinite(grans) || tid(a.skapad) > grans)).length;
}

/**
 * Hur långt jag läst, efter att ha sett tråden fram till `till` (det nyaste inlägget klienten visade). Flyttas aldrig
 * bakåt (en äldre flik som läser sent tar inte tillbaka det en nyare sett), och aldrig förbi nu (en klocka som går
 * fel i webbläsaren får inte göra framtida inlägg sedda). Null = ingen ändring.
 */
export function settFramat(forra: string | null, till: unknown, nu: Date): string | null {
  const t = typeof till === "string" ? Date.parse(till) : NaN;
  if (!Number.isFinite(t)) return null;
  const satt = Math.min(t, nu.getTime());
  const f = tid(forra);
  if (Number.isFinite(f) && satt <= f) return null;
  return new Date(satt).toISOString();
}

/** Ett inlägg som skickas till klienten: borttaget har ingen text, och vem som skrev står med namn. */
export type InlaggUt = {
  id: string;
  mote: string | null;
  av: string;
  avNamn: string;
  text: string | null;
  skapad: string;
  andrad: string | null;
  borttagen: boolean;
};

export function tillKlient(a: Inlagg, namn: ReadonlyMap<string, string>): InlaggUt {
  return {
    id: a.id,
    mote: a.mote_id,
    av: a.av,
    avNamn: namn.get(a.av) ?? "En kollega som slutat",
    text: a.borttagen ? null : a.text,
    skapad: a.skapad,
    andrad: a.borttagen ? null : a.andrad,
    borttagen: !!a.borttagen,
  };
}
