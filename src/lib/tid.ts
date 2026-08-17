/**
 * M2 Tid och närvaro. Ren logik — inga anrop, inga hemligheter.
 *
 * ===========================================================================
 * TVÅ STRÖMBRYTARE, INTE EN. De vilar på olika grund.
 *
 *   M2_AKTIV   — in- och utstämpling. PÅSLAGEN 2026-08-17. Vilar på
 *                anställningsavtalet och på arbetstidslagens krav på förda
 *                anteckningar. Kräver inte K12.
 *   RAST_AKTIV — raststämpling. AVSTÄNGD. Kräver K12, intresseavvägningen,
 *                skriven och daterad, samt K14, informationen till personalen,
 *                och K29, det dokumenterade rastschemat.
 *
 * Raststämpling är övervakning av när en människa äter lunch. Den avvägningen
 * ska vara gjord på papper INNAN den första rasten stämplas — inte efteråt,
 * när det redan finns data att förklara. Att köra in och ut utan rast är
 * därför ett riktigt mellanläge, inte en genväg förbi K12.
 *
 * Utan rastschema drar navet inga raster från arbetad tid. Tiden som
 * redovisas är från instämpling till utstämpling, och rasten hanteras utanför
 * systemet tills K12 och K29 är på plats.
 * ===========================================================================
 */

export const M2_AKTIV = true;
export const RAST_AKTIV = false;

/**
 * Datum då respektive strömbrytare slogs på. Behövs för K20: raststämplingen
 * ska omprövas sex månader efter påslaget, och en omprövning utan startdatum
 * blir aldrig av. Sätt datumet i samma ändring som du sätter flaggan till true.
 */
export const M2_PASLAGET = "2026-08-17";
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

/** Vilka knappar som får tryckas. AC-2.1: högst två tryck, aldrig ett felval. */
export function tillatna(lage: Lage): Stamptyp[] {
  if (lage === "ute") return ["in"];
  if (lage === "inne") return RAST_AKTIV ? ["break_start", "out"] : ["out"];
  return ["break_end"];
}

/** Är övergången giltig? Samma regel som knapparna, men på servern. */
export function tillaten(lage: Lage, typ: Stamptyp): boolean {
  return tillatna(lage).includes(typ);
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

/** Klockslag utan datum, för listor där dagen redan är given. */
export function klockan(iso: string): string {
  return new Date(iso).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
}

/** Dagens gräns i lokal tid, som ISO. Stämplingar hör till dygnet de skedde. */
export function dygnetsStart(nu: Date = new Date()): string {
  const d = new Date(nu);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
