/**
 * M2 Tid och närvaro. Ren logik — inga anrop, inga hemligheter.
 *
 * ===========================================================================
 * VAD SOM ÄR PÅSLAGET AVGÖRS INTE HÄR LÄNGRE.
 *
 * Läget ligger i tabellen `compliance_gate` och läses med `hamtaLage()` i
 * `src/lib/sparrar.ts`. Raststämplingen kan inte slås på förrän K12 är daterad,
 * K14 kvitterad och ett rastschema finns — och det villkoret kontrolleras av en
 * trigger i databasen, inte av den som råkar redigera den här filen.
 *
 * Kvar här finns bara nödstoppen. De är enkelriktade: de stänger av något som
 * databasen säger är på, aldrig tvärtom. Sätt en till true och deploya om något
 * måste stoppas omedelbart.
 *
 * Raststämpling är övervakning av när en människa äter lunch. Den avvägningen
 * ska vara gjord på papper INNAN den första rasten stämplas — inte efteråt, när
 * det redan finns data att förklara.
 *
 * Utan påslagen rast drar navet inga raster från arbetad tid. Tiden som
 * redovisas är från instämpling till utstämpling.
 * ===========================================================================
 */

import { svenskDygnsstart, svenskKlocka } from "./klocka.ts";

export const NODSTOPP_STAMPLING = false;
export const NODSTOPP_RAST = false;

/**
 * Datum då raststämplingen slogs på. Behövs för K20: den ska omprövas sex
 * månader efter påslaget, och en omprövning utan startdatum blir aldrig av.
 * Sätts av `slaPa()` i spärrvyn, men står här tills notisspåret kan påminna.
 */
export const RAST_PASLAGET: string | null = null;

/** K20. */
export const OMPROVNING_MANADER = 6;

/** Sista dag för omprövning, eller null när rasten inte är påslagen. */
export function omprovningSenast(paslaget: string | null = RAST_PASLAGET): string | null {
  if (!paslaget) return null;
  const d = new Date(paslaget);
  d.setMonth(d.getMonth() + OMPROVNING_MANADER);
  return d.toISOString().slice(0, 10);
}

/**
 * AC-2.22: en rättelse som blivit liggande ska lyftas till säljchefen.
 *
 * Notisen är i det här läget tyst på riktigt — navet mejlar inte än (E0.8 är
 * pausad), så den syns som en markering i chefens kö och som en rad i
 * händelseloggen. Det är samma gräns som utlöser mejlet den dag posten finns.
 */
export const RATTELSE_FRIST_TIMMAR = 48;

export function harVantatForLange(
  begard: string,
  nu: Date = new Date(),
  timmar: number = RATTELSE_FRIST_TIMMAR,
): boolean {
  return nu.getTime() - Date.parse(begard) > timmar * 3600_000;
}

export type Stamptyp = "in" | "out" | "break_start" | "break_end";

export type Handelse = {
  id: string;
  kind: Stamptyp;
  occurred_at: string;
  source: string;
  supersedes_id?: string | null;
  correction_state?: string | null;
};

export const TYP_ETIKETT: Record<Stamptyp, string> = {
  in: "Stämplade in",
  out: "Stämplade ut",
  break_start: "Rast började",
  break_end: "Rast slutade",
};

export type Lage = "ute" | "inne" | "rast";

/**
 * Var står personen just nu? Räknas fram ur händelserna i stället för att
 * lagras. En sparad status kan hamna ur fas med raderna den bygger på —
 * och raderna är sanningen, eftersom de aldrig ändras (AC-2.3).
 *
 * Rättelser som ännu inte beslutats räknas inte: det som väntar på chefen är
 * ett förslag, inte ett faktum.
 */
export function lageNu(handelser: Handelse[]): Lage {
  const giltiga = gallande(handelser);
  if (giltiga.length === 0) return "ute";

  const senaste = giltiga[giltiga.length - 1];
  if (senaste.kind === "in" || senaste.kind === "break_end") return "inne";
  if (senaste.kind === "break_start") return "rast";
  return "ute";
}

/**
 * Händelserna som faktiskt gäller, i tidsordning. En rad som ersatts av en
 * godkänd rättelse räknas bort, och en rättelse räknas först när den är
 * godkänd — men BÅDA finns kvar att läsa i historiken (AC-2.5).
 */
export function gallande(handelser: Handelse[]): Handelse[] {
  const ersatta = new Set(
    handelser
      .filter((h) => h.correction_state === "approved" && h.supersedes_id)
      .map((h) => h.supersedes_id as string),
  );

  return handelser
    .filter((h) => !ersatta.has(h.id))
    .filter((h) => h.correction_state == null || h.correction_state === "approved")
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
}

/**
 * Vilka knappar som får tryckas. AC-2.1: högst två tryck, aldrig ett felval.
 *
 * `rastPa` skickas in i stället för att läsas ur en konstant — läget bor i
 * databasen och den som ritar knapparna har redan hämtat det.
 */
export function tillatna(lage: Lage, rastPa: boolean): Stamptyp[] {
  if (lage === "ute") return ["in"];
  if (lage === "inne") return rastPa ? ["break_start", "out"] : ["out"];
  return ["break_end"];
}

/** Är övergången giltig? Samma regel som knapparna, men på servern. */
export function tillaten(lage: Lage, typ: Stamptyp, rastPa: boolean): boolean {
  return tillatna(lage, rastPa).includes(typ);
}

/**
 * Arbetad tid i minuter, med rasterna borträknade. Öppen stämpling räknas
 * fram till `nu` — en pågående dag är inte fel, den är bara inte slut.
 */
export function arbetadeMinuter(handelser: Handelse[], nu: Date = new Date()): number {
  const giltiga = gallande(handelser);
  let summa = 0;
  let start: number | null = null;

  for (const h of giltiga) {
    const t = Date.parse(h.occurred_at);
    if (h.kind === "in" || h.kind === "break_end") {
      if (start === null) start = t;
    } else if (start !== null) {
      summa += t - start;
      start = null;
    }
  }
  if (start !== null) summa += nu.getTime() - start;

  return Math.max(0, Math.round(summa / 60000));
}

export function timmarOchMinuter(minuter: number): string {
  const h = Math.floor(minuter / 60);
  const m = minuter % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Klockslag utan datum, för listor där dagen redan är given. Svensk väggtid. */
export function klockan(iso: string): string {
  return svenskKlocka(iso);
}

/**
 * Dygnets gräns i svensk tid, som ISO. Stämplingar hör till det svenska dygn
 * de skedde — inte till serverns. Med serverns midnatt hamnade allt mellan
 * 00:00 och 02:00 svensk tid på gårdagen i vyn.
 */
export function dygnetsStart(nu: Date = new Date()): string {
  return svenskDygnsstart(nu);
}
