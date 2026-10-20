/**
 * Nav 2.0, Leads: det som räknas ur ett leads steg. Ren logik utan importer,
 * så att servern (leads.ts), rutten och mottagaren (leads-server.ts) räknar
 * likadant.
 */

/** Utkastets fem skäl (LDSKAL). Samma lista som `lead_skal` i 0135. */
export const SKAL = ["Har redan en byrå", "För dyrt", "Inte nu", "Fel kontaktperson", "Annat"] as const;
export const PLATSER = ["Hos kunden", "Video", "Telefon", "På kontoret"] as const;
export const UTFALL = ["svar", "pratade", "mote", "nej"] as const;
export type Utfall = (typeof UTFALL)[number] | "kund";

/** Hur länge Ångra gäller, som i Coachning (beställaren 2026-10-19: "Ångra överallt"). */
export const ANGRA_MIN = 10;

/** Leadets läge före ett steg (`lead_event.fore`): det Ångra lägger tillbaka. */
export const FORE_KOLUMNER = [
  "status",
  "status_changed_at",
  "assigned_to",
  "assigned_at",
  "next_call_at",
  "meeting_at",
  "meeting_place",
  "lost_reason",
  "order_id",
] as const;
export type Fore = Partial<Record<(typeof FORE_KOLUMNER)[number], string | null>>;

export function median(tal: number[]): number | null {
  if (!tal.length) return null;
  const s = [...tal].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

type Steg = { lead_id: string; at: string; kind: string; actor_id: string | null; outcome: string | null };
type Rad = { id: string; assigned_to: string | null; assigned_at: string | null; status: string; duplicate_of: string | null };

/**
 * Svarstiden: minuter från att säljaren fick leadet till första samtalet
 * efter det, minst en (utkastets `ldSiffror`). Null när inget samtal finns.
 */
export function svarstid(l: Rad, steg: Steg[]): number | null {
  if (!l.assigned_at) return null;
  const fran = Date.parse(l.assigned_at);
  const forsta = steg.find((s) => s.lead_id === l.id && s.kind === "forsok" && Date.parse(s.at) >= fran);
  return forsta ? Math.max(1, Math.round((Date.parse(forsta.at) - fran) / 60_000)) : null;
}

/**
 * En säljares senaste 30 dagar, i utkastets form (`LDSTAT`): antal leads man
 * fått, svarstiden (median), bokade möten och kunder.
 */
export function trettioDagar(
  saljare: string,
  leads: (Rad & { kundAt: string | null })[],
  steg: Steg[],
  nu: number,
): [number, number | null, number, number] {
  const sedan = nu - 30 * 864e5;
  const mina = leads.filter((l) => l.assigned_to === saljare && l.status !== "spam" && !l.duplicate_of);
  const fatt = mina.filter((l) => l.assigned_at && Date.parse(l.assigned_at) >= sedan);
  const svar = fatt.map((l) => svarstid(l, steg)).filter((x): x is number => x !== null);
  const moten = steg.filter((s) => s.kind === "forsok" && s.outcome === "mote" && s.actor_id === saljare && Date.parse(s.at) >= sedan).length;
  const kunder = mina.filter((l) => l.status === "won" && l.kundAt && Date.parse(l.kundAt) >= sedan).length;
  return [fatt.length, median(svar), moten, kunder];
}

/**
 * Förslaget på vem som ska få leadet (utkastets `ldForslag`): säljare som är
 * på plats, minst öppna leads först, sedan den som brukar svara snabbast.
 * Utan känd svarstid sist bland de lika.
 */
export function forslag<T extends { id: string; namn: string; oppna: number; svar: number | null }>(paPlats: T[]): T[] {
  return [...paPlats].sort(
    (a, b) => a.oppna - b.oppna || (a.svar ?? Infinity) - (b.svar ?? Infinity) || a.namn.localeCompare(b.namn, "sv"),
  );
}
