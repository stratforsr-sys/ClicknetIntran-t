/**
 * Hur ett samtal ser ut för en människa. Ren formatering, inga importer.
 *
 * Ligger för sig därför att tre vyer visar samma sak — ordersidan, samtalslistan
 * och (så småningom) coachningskortet — och tre översättningar av `okant` till
 * svenska hade hunnit bli tre olika ord.
 */

export type Inspelningslage = "ingen" | "hos_vaxeln" | "hamtad" | "misslyckad" | "gallrad";

export type Samtalsrad = {
  id: string;
  direction: "in" | "ut" | "okand";
  outcome: string;
  counterpartE164: string | null;
  counterpartRaw: string | null;
  startedAt: string | null;
  durationSeconds: number | null;
  talkSeconds: number | null;
  recordingState: Inspelningslage;
  recordingFileId: string | null;
  recordingError: string | null;
  /** Satt = en människa kopplade samtalet till affären. */
  orderLinkedBy: string | null;
  employeeId: string | null;
  /** Ifylld av vyn när namnet är känt. */
  namn?: string | null;
};

export const RIKTNING_ETIKETT: Record<Samtalsrad["direction"], string> = {
  in: "Inkommande",
  ut: "Utgående",
  okand: "Okänd riktning",
};

/**
 * Vad som står i stället för spelaren.
 *
 * INGEN AV TEXTERNA ÄR TOM, och det är hela poängen. Ett samtal utan ljud ska
 * säga varför det saknas — "hämtades aldrig", "gallrad", "misslyckades" — så att
 * den som undrar slipper gissa om det är ett fel eller ett val. Ett tomt fält
 * ser likadant ut oavsett vilket.
 */
export const INSPELNING_ETIKETT: Record<Inspelningslage, string> = {
  ingen: "Ingen inspelning",
  hos_vaxeln: "Hämtas …",
  hamtad: "Inspelning",
  misslyckad: "Inspelningen kunde inte hämtas",
  gallrad: "Inspelningen är gallrad",
};

/** `2662` → `44:22`. Sekunder är rätt i en databas och fel på en sida. */
export function langd(sekunder: number | null): string {
  if (sekunder === null) return "–";
  const m = Math.floor(sekunder / 60);
  const s = sekunder % 60;
  if (m < 60) return `${m}:${String(s).padStart(2, "0")}`;
  const t = Math.floor(m / 60);
  return `${t}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Klockslag på svenskt vis, utan sekunder. `null` blir "utan tidpunkt". */
export function klockslag(iso: string | null): string {
  if (!iso) return "utan tidpunkt";
  return new Date(iso).toLocaleString("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Stockholm",
  });
}

/**
 * Numret som det ska läsas.
 *
 * Det normaliserade går före råvärdet: `+46701234567` är samma nummer varje
 * gång, medan växelns råtext varierar. Saknas båda står det ut — ett samtal
 * utan motpart är ovanligt nog att vara värt att undra över.
 */
export function motpart(rad: Pick<Samtalsrad, "counterpartE164" | "counterpartRaw">): string {
  return rad.counterpartE164 ?? rad.counterpartRaw ?? "okänt nummer";
}

/** Summering för en lista: antal och total taltid. */
export function summering(rader: Samtalsrad[]): { antal: number; sekunder: number } {
  return {
    antal: rader.length,
    sekunder: rader.reduce((s, r) => s + (r.talkSeconds ?? r.durationSeconds ?? 0), 0),
  };
}
