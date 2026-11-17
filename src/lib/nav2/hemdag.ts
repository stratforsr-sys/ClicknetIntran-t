/**
 * Min dag i det nya hemmet (skiss 9): dagens ram ur schemat och rasterna.
 *
 * Ramen är arbetsdagens start och slut och hur många minuter rast schemat har i dag, i minuter från midnatt.
 * Samma regel som Tid: den mest specifika nivån gäller (person, lag, företag), och den senaste raden som har
 * trätt i kraft. Utan ett schema för dagen finns ingen ram, och då säger Min dag inte hur mycket som ryms.
 * Ren logik, inga anrop.
 */
import { gallandeSchema } from "../raster.ts";

export type SchemaRad = { scope: string; employee_id: string | null; team_id: string | null; weekday: number; start_time: string; end_time: string; valid_from: string };
export type RastRad = { scope: string; employee_id: string | null; team_id: string | null; weekday: number; sort: number; duration_minutes: number; valid_from: string };
export type NdDag = { start: number; slut: number; rast: number };

const min = (t: string): number => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };

export function dagensRam(schema: readonly SchemaRad[], raster: readonly RastRad[], mig: string, team: string | null, datum: string, veckodag: number): NdDag | null {
  const s = gallandeSchema(schema.filter((r) => r.weekday === veckodag), mig, team, datum)[0];
  if (!s) return null;
  const r = gallandeSchema(raster.filter((x) => x.weekday === veckodag), mig, team, datum);
  return { start: min(s.start_time), slut: min(s.end_time), rast: r.reduce((a, x) => a + x.duration_minutes, 0) };
}
