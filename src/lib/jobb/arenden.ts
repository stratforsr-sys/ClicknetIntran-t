import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * AC-4.2: ärenden som passerat sin utlovade svarstid eskaleras.
 *
 * Eskaleringen är en markering, inte ett mejl: navet skickar ingen post än.
 * Markeringen gör ändå jobbet — inkorgen färgar posten röd och räknaren visar
 * hur många som ligger över tiden. När notisspåret finns är det den här raden
 * som utlöser mejlet.
 *
 * Jobbet är avsiktligt tyst mot den anställda. Ett automatiskt "ditt ärende är
 * försenat" hjälper ingen som redan väntar.
 */
export async function korArendejobbet(db: SupabaseClient): Promise<{ eskalerade: number }> {
  const nu = new Date().toISOString();

  const { data: forsenade, error } = await db
    .from("hr_case")
    .select("id, category, due_at")
    .is("resolved_at", null)
    .is("escalated_at", null)
    .lt("due_at", nu);

  if (error) throw new Error(error.message);

  for (const a of forsenade ?? []) {
    await db.from("hr_case").update({ escalated_at: nu }).eq("id", a.id);

    // Kategorin loggas, aldrig rubriken: ett konfidentiellt arende ska inte ga
    // att lasa ur handelseloggen av den som saknar behorighet (AC-4.3).
    await db.from("audit_log").insert({
      actor_id: null,
      action: "case.escalated",
      object_type: "hr_case",
      object_id: a.id,
      meta: { kategori: a.category, frist: a.due_at },
    });
  }

  return { eskalerade: (forsenade ?? []).length };
}
