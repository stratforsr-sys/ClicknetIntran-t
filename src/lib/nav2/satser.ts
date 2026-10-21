import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CurrentUser } from "@/lib/auth";
import { farSeLonekostnad } from "@/lib/lonekostnad-server";
import { nivaFor } from "./forma";
import { SKRIVLAGE } from "./skrivlage";

/**
 * Nav 2.0: det Satser och löner behöver utöver satserna och lönerna (som
 * `data.ts` läser till `ND.satser` och `ND.loner`).
 *
 * ===========================================================================
 * VEM SOM ÄNDRAR: SAMMA KRETS SOM I DAG, OCH SUPERADMIN SOM I UTKASTET.
 * Repots actions (`sparaSats`, `sparaLon`, `sparaFodelsear`) kräver
 * `payroll_cost_viewer`. Utkastets behörighetsmatris ger "Ändra satser, se och
 * ändra månadslöner" bara till superadmin. Formulären öppnas därför för den
 * som har båda, och /nav2/satser frågar om båda.
 * ===========================================================================
 *
 * "Ersatta" (0190, `cost_rate_replaced`): en sats som rättats samma dag, eller
 * som Skatteverkets rättelse tog bort. Läses med den inloggades token, och
 * tabellen finns inte förrän 0190 körts — då är listan tom och `ersattaSaknas`
 * sant, och ingenting annat påverkas.
 *
 * Null för den som inte har behörigheten för lönekostnad.
 */

export type NdErsatt = {
  id: string;
  kind: string;
  applies: string | null;
  unit: string;
  value: number;
  fran: string;
  till: string | null;
  agareId: string | null;
  oversyn: string | null;
  note: string | null;
  skapad: string;
  avId: string | null;
  ersattD: string;
  ersattAvId: string | null;
  ersattSkal: string | null;
};

/**
 * Gamla Nav G steg 3 (svar 14): intäkterna och täckningsgraden per löneperiod,
 * som gamla /lonekostnad. `personer` är de som har en rad i löneunderlaget
 * (`payroll_row`, det `raknaPeriod` räknar på), `intakter` det som matats in
 * (`revenue_entry`) och `rader` den senaste beräkningen (`cost_calculation`).
 */
export type NdLonperiod = {
  id: string;
  fran: string;
  till: string;
  personer: string[];
  intakter: Record<string, number>;
  rader: { vemId: string; kostnad: number; intakt: number | null; bidrag: number | null; breakEven: number | null }[];
  raknad: string | null;
};

export type NdSatsdata = {
  /** Superadmin med payroll_cost_viewer: utkastets formulär öppnas. */
  andra: boolean;
  /** SKRIVLAGE.satser. Annars svarar /nav2/satser 423. */
  skriv: boolean;
  ersatta: NdErsatt[];
  ersattaSaknas: boolean;
  /** De sex senaste löneperioderna, nyast först. */
  perioder: NdLonperiod[];
};

type RaErsatt = {
  id: string;
  kind: string;
  applies_to: string | null;
  unit: string;
  value: number | string;
  valid_from: string;
  valid_to: string | null;
  owner_id: string | null;
  review_due: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  replaced_at: string;
  replaced_by: string | null;
  reason: string | null;
};

const dag = (v: unknown) => (v ? String(v).slice(0, 10) : null);

export async function byggSatser(supabase: SupabaseClient, user: CurrentUser): Promise<NdSatsdata | null> {
  if (!farSeLonekostnad(user)) return null;

  const { data, error } = await supabase
    .from("cost_rate_replaced")
    .select("id, kind, applies_to, unit, value, valid_from, valid_to, owner_id, review_due, note, created_by, created_at, replaced_at, replaced_by, reason")
    .order("replaced_at", { ascending: false });

  const ersatta = error
    ? []
    : ((data ?? []) as unknown as RaErsatt[]).map((r) => ({
        id: r.id,
        kind: r.kind,
        applies: r.applies_to,
        unit: r.unit,
        value: Number(r.value),
        fran: dag(r.valid_from)!,
        till: dag(r.valid_to),
        agareId: r.owner_id,
        oversyn: dag(r.review_due),
        note: r.note,
        skapad: dag(r.created_at) ?? "",
        avId: r.created_by,
        ersattD: dag(r.replaced_at) ?? "",
        ersattAvId: r.replaced_by,
        ersattSkal: r.reason,
      }));

  const { data: periodrader } = await supabase
    .from("payroll_period")
    .select("id, period_start, period_end")
    .order("period_start", { ascending: false })
    .limit(6);
  const per = (periodrader ?? []) as unknown as { id: string; period_start: string; period_end: string }[];
  const ids = per.map((p) => p.id);
  const [{ data: lonrader }, { data: intaktrader }, { data: berakningar }] = ids.length
    ? await Promise.all([
        supabase.from("payroll_row").select("period_id, employee_id").in("period_id", ids),
        supabase.from("revenue_entry").select("period_id, employee_id, amount").in("period_id", ids),
        supabase.from("cost_calculation").select("period_id, employee_id, total_cost, revenue, contribution, break_even_revenue, calculated_at").in("period_id", ids),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const tal = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const perioder: NdLonperiod[] = per.map((p) => {
    const b = ((berakningar ?? []) as unknown as { period_id: string; employee_id: string; total_cost: number | string; revenue: number | string | null; contribution: number | string | null; break_even_revenue: number | string | null; calculated_at: string }[]).filter((x) => x.period_id === p.id);
    return {
      id: p.id,
      fran: dag(p.period_start)!,
      till: dag(p.period_end)!,
      personer: [...new Set(((lonrader ?? []) as unknown as { period_id: string; employee_id: string }[]).filter((x) => x.period_id === p.id).map((x) => x.employee_id))],
      intakter: Object.fromEntries(((intaktrader ?? []) as unknown as { period_id: string; employee_id: string; amount: number | string }[]).filter((x) => x.period_id === p.id).map((x) => [x.employee_id, Number(x.amount)])),
      rader: b.map((x) => ({ vemId: x.employee_id, kostnad: Number(x.total_cost), intakt: tal(x.revenue), bidrag: tal(x.contribution), breakEven: tal(x.break_even_revenue) })),
      raknad: b.length ? dag(b.map((x) => x.calculated_at).sort().slice(-1)[0]) : null,
    };
  });

  return {
    perioder,
    andra: nivaFor(user.roles) === "superadmin",
    skriv: SKRIVLAGE.satser,
    ersatta,
    ersattaSaknas: !!error,
  };
}
