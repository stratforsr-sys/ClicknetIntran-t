import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * AC-4.2: ärenden som passerat sin utlovade svarstid eskaleras.
 *
 * Eskaleringen är i det här läget en markering, inte ett mejl: navet skickar
 * ingen post än (E0.8 är pausad). Markeringen gör ändå jobbet den ska —
 * inkorgen färgar posten röd och räknaren överst visar hur många som ligger
 * över tiden. När notisspåret finns är det den här raden som utlöser mejlet.
 *
 * Jobbet är avsiktligt tyst mot den anställda. Att få ett automatiskt
 * "ditt ärende är försenat" hjälper ingen som redan väntar.
 */
export async function GET(request: NextRequest) {
  const hemlighet = process.env.CRON_SECRET;
  if (!hemlighet) return NextResponse.json({ fel: "CRON_SECRET saknas" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${hemlighet}`)
    return NextResponse.json({ fel: "Nekad" }, { status: 401 });

  const db = supabaseAdmin();
  const nu = new Date().toISOString();

  const { data: forsenade, error } = await db
    .from("hr_case")
    .select("id, category, due_at")
    .is("resolved_at", null)
    .is("escalated_at", null)
    .lt("due_at", nu);

  if (error) return NextResponse.json({ fel: error.message }, { status: 500 });

  for (const a of forsenade ?? []) {
    await db.from("hr_case").update({ escalated_at: nu }).eq("id", a.id);

    // Kategorin loggas, aldrig rubriken: ett konfidentiellt arende ska inte ga
    // att lasa ur handelseloggen av den som saknar behorighet till sjalva
    // arendet (AC-4.3).
    await db.from("audit_log").insert({
      actor_id: null,
      action: "case.escalated",
      object_type: "hr_case",
      object_id: a.id,
      meta: { kategori: a.category, frist: a.due_at },
    });
  }

  return NextResponse.json({ eskalerade: (forsenade ?? []).length });
}
