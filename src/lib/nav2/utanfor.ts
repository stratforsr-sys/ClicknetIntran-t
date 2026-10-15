import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { gallande, type Handelse } from "@/lib/tid";
import { gallandeSchema } from "@/lib/raster";
import { svensktDatum, svenskaMinuter, svenskTidpunkt, svenskDygnsslut, svenskVeckodag } from "@/lib/klocka";

/**
 * Nav 2.0 (0094): "Utanför schemat (min)" — instämplad tid före schemats start
 * eller efter dess slut, och all instämplad tid en dag utan schema.
 *
 * Samma källor som resten av Tid: de gällande stämplingarna (`gallande`, en
 * väntande rättelse räknas inte) och schemat som gällde DEN dagen
 * (`gallandeSchema`, person före team före bolag). Minuter, aldrig belopp
 * (AC-2.17). Ett pass som fortfarande är öppet räknas inte.
 *
 * Läses sidvis: Supabase-API:t kapar tyst vid 1000 rader.
 */
type Rad = Handelse & { employee_id: string };
type Schemarad = { scope: string; employee_id: string | null; team_id: string | null; weekday: number; start_time: string; end_time: string; valid_from: string };

async function stamplingar(db: SupabaseClient, start: string, slut: string): Promise<Rad[]> {
  const ut: Rad[] = [];
  for (let fran = 0; ; fran += 1000) {
    const { data } = await db
      .from("time_event")
      .select("id, employee_id, kind, occurred_at, source, supersedes_id, correction_state")
      .in("kind", ["in", "out"])
      .gte("occurred_at", svenskTidpunkt(start, "00:00").toISOString())
      .lte("occurred_at", svenskDygnsslut(slut))
      .order("occurred_at")
      .range(fran, fran + 999);
    ut.push(...((data ?? []) as unknown as Rad[]));
    if (!data || data.length < 1000) return ut;
  }
}

const minuter = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};

export async function utanforSchemat(db: SupabaseClient, start: string, slut: string): Promise<Map<string, number>> {
  const [rader, { data: scheman }, { data: personal }] = await Promise.all([
    stamplingar(db, start, slut),
    db.from("work_schedule").select("scope, employee_id, team_id, weekday, start_time, end_time, valid_from"),
    db.from("employee").select("id, team_id"),
  ]);
  const team = new Map(((personal ?? []) as { id: string; team_id: string | null }[]).map((p) => [p.id, p.team_id]));
  const sch = (scheman ?? []) as Schemarad[];

  const perDag = new Map<string, Rad[]>();
  for (const r of rader) {
    const k = `${r.employee_id}|${svensktDatum(r.occurred_at)}`;
    perDag.set(k, [...(perDag.get(k) ?? []), r]);
  }

  const ut = new Map<string, number>();
  for (const [k, hs] of perDag) {
    const [pid, datum] = k.split("|");
    const veckodag = svenskVeckodag(svenskTidpunkt(datum, "12:00"));
    const s = gallandeSchema(sch.filter((x) => x.weekday === veckodag), pid, team.get(pid) ?? null, datum)[0] ?? null;
    const a = s ? minuter(String(s.start_time)) : null;
    const b = s ? minuter(String(s.end_time)) : null;
    let inne: number | null = null;
    let summa = 0;
    for (const h of gallande(hs)) {
      const m = svenskaMinuter(h.occurred_at);
      if (h.kind === "in") {
        if (inne === null) inne = m;
      } else if (h.kind === "out" && inne !== null) {
        const pass = Math.max(0, m - inne);
        const inom = a !== null && b !== null ? Math.max(0, Math.min(m, b) - Math.max(inne, a)) : 0;
        summa += pass - inom;
        inne = null;
      }
    }
    if (summa > 0) ut.set(pid, (ut.get(pid) ?? 0) + summa);
  }
  return ut;
}
