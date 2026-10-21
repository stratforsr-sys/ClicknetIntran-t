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

export type NdSatsdata = {
  /** Superadmin med payroll_cost_viewer: utkastets formulär öppnas. */
  andra: boolean;
  /** SKRIVLAGE.satser. Annars svarar /nav2/satser 423. */
  skriv: boolean;
  ersatta: NdErsatt[];
  ersattaSaknas: boolean;
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

  return {
    andra: nivaFor(user.roles) === "superadmin",
    skriv: SKRIVLAGE.satser,
    ersatta,
    ersattaSaknas: !!error,
  };
}
