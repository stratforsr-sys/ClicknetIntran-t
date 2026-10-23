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
  "meeting_event_id",
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

/**
 * Ett steg på ett lead som ingen fått (granskningen F2-1). Fördelarna får
 * spara ett utfall på vilket lead som helst, men ett otilldelat lead som blev
 * `contacted` utan säljare försvann ur alla listor: Att fördela tar bara
 * `new`, och ingen säljare såg det. Därför får fördelaren som sparar steget
 * leadet, i samma villkorade uppdatering som steget. Null = ingen ändring av
 * vem som har leadet.
 */
export function nyTilldelning(
  lead: { assigned_to: string | null },
  aktor: string,
  arFordelare: boolean,
  nu: string,
): { assigned_to: string; assigned_at: string } | null {
  if (lead.assigned_to || !arFordelare) return null;
  return { assigned_to: aktor, assigned_at: nu };
}

/** Beroendena för `tilldelaVillkorat`, så att samma regel gäller i repots action, i rutten och i automatiken. */
export type TilldelaBeroenden<L extends { assigned_to: string | null }> = {
  las: (id: string) => Promise<L | null>;
  /** Uppdatera med villkoret att leadet fortfarande har `vantad` (null = ingen säljare). Antal ändrade rader. */
  uppdatera: (id: string, till: string | null, vantad: string | null) => Promise<number>;
  namn: (id: string) => Promise<string | null>;
  /** Händelseloggen, steget, notisen och mejlet: bara när en rad ändrats. */
  efter: (lead: L, fran: string | null) => Promise<void>;
};

/**
 * Att ge ett lead till någon (granskningen F2-2): en villkorad uppdatering
 * som säger om den lyckades. `fore` är den säljare klienten såg (null = ingen);
 * `undefined` (gamla Nav, som inte skickar något) betyder det som läses här.
 * Har någon annan hunnit före, eller automatiken gett bort leadet sedan sidan
 * laddades, blir svaret "Leadet har redan getts till <förnamn>." och ingen
 * notis eller mejl går ut.
 */
export async function tilldelaVillkorat<L extends { assigned_to: string | null }>(
  dep: TilldelaBeroenden<L>,
  id: string,
  till: string | null,
  fore: string | null | undefined,
): Promise<{ fel?: string; andrad: boolean }> {
  const redan = async (vem: string | null) => {
    const n = vem ? await dep.namn(vem) : null;
    return n
      ? `Leadet har redan getts till ${n.split(" ")[0]}.`
      : "Leadet har ändrats av någon annan sedan sidan laddades. Ladda om och försök igen.";
  };
  const lead = await dep.las(id);
  if (!lead) return { fel: "Leadet finns inte.", andrad: false };
  const vantad = fore === undefined ? lead.assigned_to : fore;
  if (lead.assigned_to !== vantad) return { fel: await redan(lead.assigned_to), andrad: false };
  if (lead.assigned_to === till) return { andrad: false };
  const antal = await dep.uppdatera(id, till, vantad);
  if (antal === 0) {
    const nu = await dep.las(id);
    return { fel: await redan(nu?.assigned_to ?? null), andrad: false };
  }
  await dep.efter(lead, vantad);
  return { andrad: true };
}

/** Hur länge ett andra "Möte bokat" på samma lead av samma person nekas (granskningen F2-3). */
export const MOTE_SPARR_SEK = 60;

/**
 * Har samma person bokat ett möte på leadet nyss? Då är ett nytt "Möte bokat"
 * ett dubbeltryck eller en omsändning med en ny nyckel, och det ska inte bli
 * ett andra möte med en andra inbjudan till kunden.
 */
export function moteNyss(
  steg: { kind: string; outcome: string | null; actor_id: string | null; at: string }[],
  aktor: string,
  nu: number,
): boolean {
  return steg.some(
    (s) => s.kind === "forsok" && s.outcome === "mote" && s.actor_id === aktor && nu - Date.parse(s.at) < MOTE_SPARR_SEK * 1000,
  );
}
