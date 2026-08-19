/**
 * Avvikelsemotorn för raster (AC-2.23–2.26). Ren logik, inga anrop.
 *
 * Den här filen avgör om en människa gjorde fel. Därför är varje regel skriven
 * så att den går att läsa högt för den som blir bedömd, och varje gräns som
 * kan tolkas åt två håll faller ut till den anställdas fördel.
 *
 * Filen har med flit inga importer. Vilka händelser som RÄKNAS — rättelser,
 * ersatta rader — avgörs av `gallande()` i tid.ts och sker hos den som anropar.
 * Motorn ska bedöma en färdig lista, inte också bestämma vad listan innehåller.
 * Det gör den möjlig att prova utan att starta något annat.
 */

import { svenskaMinuter } from "./klocka.ts";

export type Handelse = {
  id: string;
  kind: "in" | "out" | "break_start" | "break_end";
  occurred_at: string;
};

export type Avvikelsetyp = "early_start" | "overrun" | "missing" | "unscheduled";

export const AVVIKELSE_ETIKETT: Record<Avvikelsetyp, string> = {
  early_start: "Rast började tidigt",
  overrun: "Rast blev längre",
  missing: "Ingen rast",
  unscheduled: "Extra rast",
};

/**
 * AC-2.29, K31: `missing` är en arbetsmiljösignal, inte en förseelse. Texten
 * följer med i gränssnittet så att tonen inte kan glida över tid.
 */
export const AVVIKELSE_FORKLARING: Record<Avvikelsetyp, string> = {
  early_start: "Rasten började före tidsfönstret.",
  overrun: "Rasten blev längre än den schemalagda.",
  missing: "Mer än fem timmar sammanhängande arbete utan rast. Följs upp som arbetsmiljöfråga, inte som en förseelse.",
  unscheduled: "Fler raster än schemat anger.",
};

export type Rastschema = {
  id: string;
  sort: number;
  window_start: string;      // "11:30"
  window_end: string;        // "13:00" — senaste ÖNSKADE starttid
  duration_minutes: number;
  tol_early_start: number;
  tol_overrun: number;
  tol_missing: number;
};

export type Avvikelse = {
  kind: Avvikelsetyp;
  minutes: number;
  schedule_id: string | null;
};

/** Minuter sedan midnatt, ur en tid på formen "HH:MM" eller "HH:MM:SS". */
export function minuterFranTid(tid: string): number {
  const [h, m] = tid.split(":").map(Number);
  return h * 60 + (m || 0);
}

/**
 * Rasten bedoms mot svensk vaggtid. `getHours()` hade gett serverns zon, och pa
 * Vercel ar den UTC — se `klocka.ts`.
 */
const minuterPaDygnet = svenskaMinuter;

/** Rasterna som faktiskt togs. Listan ska redan vara filtrerad och tidsordnad. */
export function tagnaRaster(giltiga: Handelse[]): { start: string; slut: string | null }[] {
  const raster: { start: string; slut: string | null }[] = [];
  let start: string | null = null;

  for (const h of giltiga) {
    if (h.kind === "break_start") start = h.occurred_at;
    else if (h.kind === "break_end" && start) {
      raster.push({ start, slut: h.occurred_at });
      start = null;
    } else if (h.kind === "out" && start) {
      // Utstampling mitt i en rast. Rasten raknas som pagaende till dess —
      // att lata den vara oppen hade gjort den oandligt lang.
      raster.push({ start, slut: h.occurred_at });
      start = null;
    }
  }
  if (start) raster.push({ start, slut: null });

  return raster;
}

/** Längsta sammanhängande arbetspass i minuter, rasterna borträknade. */
export function langstaPass(giltiga: Handelse[], nu: Date = new Date()): number {
  let langst = 0;
  let start: number | null = null;

  for (const h of giltiga) {
    const t = Date.parse(h.occurred_at);
    if (h.kind === "in" || h.kind === "break_end") {
      if (start === null) start = t;
    } else if (start !== null) {
      langst = Math.max(langst, t - start);
      start = null;
    }
  }
  if (start !== null) langst = Math.max(langst, nu.getTime() - start);

  return Math.round(langst / 60000);
}

const FEM_TIMMAR = 5 * 60;

/**
 * Bedömer en avslutad dag mot det schema som gällde då.
 *
 * `schema` är tom lista när inget schema gäller — och då genereras **inga**
 * avvikelser alls (AC-2.23). Det är inte ett specialfall utan huvudregeln:
 * utan uttalad regel finns inget att avvika från.
 */
export function avvikelser(
  giltiga: Handelse[],
  schema: Rastschema[],
  nu: Date = new Date(),
): Avvikelse[] {
  if (schema.length === 0) return [];

  const ut: Avvikelse[] = [];
  const raster = tagnaRaster(giltiga).filter((r) => r.slut !== null);
  const ordnat = [...schema].sort((a, b) => a.sort - b.sort);

  raster.forEach((rast, i) => {
    const regel = ordnat[i];

    // AC-2.24, `unscheduled`: fler raster an schemat anger.
    if (!regel) {
      ut.push({ kind: "unscheduled", minutes: 0, schedule_id: null });
      return;
    }

    const startMin = minuterPaDygnet(rast.start);
    const fonsterStart = minuterFranTid(regel.window_start);

    // AC-2.25: `window_end` las aldrig har, och det ar avsikten. En rast som
    // borjar EFTER onskad senaste starttid ger ingen avvikelse alls —
    // bestallarens uttryckliga regel. Faltet finns for att kunna visa onskad
    // tid i granssnittet, inte for att doma nagon.
    if (startMin < fonsterStart - regel.tol_early_start) {
      ut.push({
        kind: "early_start",
        minutes: fonsterStart - startMin,
        schedule_id: regel.id,
      });
    }

    const langd = Math.round((Date.parse(rast.slut!) - Date.parse(rast.start)) / 60000);
    if (langd > regel.duration_minutes + regel.tol_overrun) {
      ut.push({
        kind: "overrun",
        minutes: langd - regel.duration_minutes,
        schedule_id: regel.id,
      });
    }
  });

  // AC-2.24, `missing`: mer an fem timmar sammanhangande arbete utan rast.
  // Toleransen laggs till gransen, inte dras ifran — den som arbetat 5 h och
  // 3 minuter har inte gjort nagot fel.
  const pass = langstaPass(giltiga, nu);
  const tol = ordnat[0]?.tol_missing ?? 5;
  if (raster.length === 0 && pass > FEM_TIMMAR + tol) {
    ut.push({ kind: "missing", minutes: pass - FEM_TIMMAR, schedule_id: ordnat[0]?.id ?? null });
  }

  return ut;
}

/**
 * Vilket schema som gäller för en person en viss dag. Mest specifik nivå
 * vinner, och inom nivån den senaste som hunnit träda i kraft.
 */
export function gallandeSchema<
  T extends { scope: string; employee_id: string | null; team_id: string | null; valid_from: string; sort?: number },
>(rader: T[], employeeId: string, teamId: string | null, datum: string): T[] {
  const ikraft = rader.filter((r) => r.valid_from <= datum);

  for (const niva of ["employee", "team", "company"] as const) {
    const traff = ikraft.filter(
      (r) =>
        r.scope === niva &&
        (niva !== "employee" || r.employee_id === employeeId) &&
        (niva !== "team" || (teamId !== null && r.team_id === teamId)),
    );
    if (traff.length === 0) continue;

    // Senaste valid_from per plats i ordningen. Aldre rader ar historik.
    const senaste = new Map<number, T>();
    for (const r of traff) {
      const plats = r.sort ?? 1;
      const fore = senaste.get(plats);
      if (!fore || r.valid_from > fore.valid_from) senaste.set(plats, r);
    }
    return [...senaste.values()];
  }

  return [];
}
