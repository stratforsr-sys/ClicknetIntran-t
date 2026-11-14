import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { svensktDatum } from "@/lib/klocka";
import { sjukVidInstampling, type Sjukrad } from "@/lib/sjuk-instampling";

/**
 * Avslutar personens sjukanmälningar som en instämpling vid `instampladIso`
 * gör inaktuella. Regeln står i `sjuk-instampling.ts`.
 *
 * Anropas av instämplingen och av nattjobbet, som skyddsnät för stämplingar
 * som kommit in på annat sätt (en godkänd rättelse, en kö som tömts i
 * efterhand). Ingen notis: den som stämplar in vet att hen är tillbaka, och
 * chefen ser det på att raden försvinner ur sjuklistan.
 *
 * Returnerar hur många anmälningar som ändrades.
 */
export async function avslutaSjukVidInstampling(
  db: SupabaseClient,
  employeeId: string,
  instampladIso: string,
): Promise<number> {
  const { data: rader } = await db
    .from("sick_report")
    .select("id, first_sick_day, last_sick_day, cancelled_at, extent_percent, registered_at")
    .eq("employee_id", employeeId)
    .is("cancelled_at", null)
    .lte("first_sick_day", svensktDatum(instampladIso));

  let n = 0;
  for (const r of (rader ?? []) as (Sjukrad & { id: string })[]) {
    const atgard = sjukVidInstampling(r, instampladIso);
    if (!atgard) continue;

    if (atgard.typ === "avsluta") {
      const { error } = await db.from("sick_report").update({ last_sick_day: atgard.sista }).eq("id", r.id);
      if (error) continue;
      await db.from("audit_log").insert({
        actor_id: employeeId,
        action: "sick.closed",
        object_type: "sick_report",
        object_id: r.id,
        meta: { sista_dag: atgard.sista, orsak: "instämpling" },
      });
    } else {
      const { error } = await db
        .from("sick_report")
        .update({ cancelled_at: new Date().toISOString(), cancelled_by: employeeId })
        .eq("id", r.id);
      if (error) continue;
      await db.from("audit_log").insert({
        actor_id: employeeId,
        action: "sick.cancelled",
        object_type: "sick_report",
        object_id: r.id,
        meta: { orsak: "instämpling samma dag" },
      });
    }
    n++;
  }
  return n;
}
