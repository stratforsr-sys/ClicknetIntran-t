/**
 * Sen ankomst mot arbetsschemat.
 *
 * Modulen bedömer en färdig lista och bestämmer inte vad listan innehåller.
 * Enda importen är klockan: väggtiden måste räknas i Europe/Stockholm och inte
 * mot serverns tidszon. Se `klocka.ts` för vad som gick fel innan.
 *
 * ===========================================================================
 * Två regler som inte får ändras utan att någon tänkt efter:
 *
 *   1. TOLERANSEN LÄGGS TILL GRÄNSEN, ALDRIG DRAS IFRÅN. Den som stämplar in
 *      08:01 med en minuts tolerans är i tid. Varje gräns som kan tolkas åt
 *      två håll faller ut till den anställdas fördel — samma princip som i
 *      raster.ts.
 *
 *   2. DAGENS FÖRSTA INSTÄMPLING AVGÖR. Den som stämplar ut och in igen mitt
 *      på dagen kommer inte för sent en andra gång.
 * ===========================================================================
 */

import { svenskaMinuter } from "./klocka.ts";

/** Så mycket av en stämpling som modulen behöver veta. */
export type Instampling = { kind: string; occurred_at: string };

export type Arbetsdag = {
  /** "08:00" eller "08:00:00". Sekunder ignoreras. */
  start_time: string;
  tol_late: number;
  schedule_id?: string;
};

export type SenAnkomst = {
  minuter: number;
  ankom: string;
  schemalagd: string;
  tolerans: number;
  schedule_id?: string;
};

/** Minuter sedan midnatt ur "HH:MM" eller "HH:MM:SS". */
export function minutOnDagen(tid: string): number {
  const [h, m] = tid.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Var personen sen den här dagen?
 *
 * Lämnar tillbaka null när hen var i tid, när det inte finns någon
 * instämpling, eller när det saknas schema för dagen. Att sakna schema är
 * inte samma sak som att vara i tid — men det är inte heller något systemet
 * får gissa om, lika lite som det får hitta på en sluttid (AC-2.4).
 */
export function senAnkomst(
  handelser: Instampling[],
  schema: Arbetsdag | null,
): SenAnkomst | null {
  if (!schema) return null;

  const forsta = [...handelser]
    .filter((h) => h.kind === "in")
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))[0];

  if (!forsta) return null;

  const schemalagd = minutOnDagen(schema.start_time);
  const faktisk = svenskaMinuter(forsta.occurred_at);
  const minuter = faktisk - schemalagd;

  // Toleransen adderas till gränsen. Exakt på gränsen är i tid.
  if (minuter <= schema.tol_late) return null;

  return {
    minuter,
    ankom: forsta.occurred_at,
    schemalagd: schema.start_time.slice(0, 5),
    tolerans: schema.tol_late,
    schedule_id: schema.schedule_id,
  };
}

/** "12 min" respektive "1 h 5 min" — samma språk som resten av tidmodulen. */
export function forsening(minuter: number): string {
  if (minuter < 60) return `${minuter} min`;
  const h = Math.floor(minuter / 60);
  const m = minuter % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
