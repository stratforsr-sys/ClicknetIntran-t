import { NextResponse } from "next/server";
import { getCurrentUser, hasRole, fullName } from "@/lib/auth";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { csv, type Exportkolumn, type Exportrad } from "@/lib/lonerapport";

export const dynamic = "force-dynamic";

/**
 * AC-2.18: filen mot lönesystemet. Kolumnerna kommer ur `payroll_export_column`
 * och inte ur den här filen — vilket system den ska in i är obesvarat (A3), och
 * ett format som kräver en driftsättning för att ändras är inget format.
 *
 * Exporten går via RLS-klienten och kan därför inte ge mer än vad sidan visar.
 * Uttaget loggas: en fil som lämnat navet lever vidare utanför det.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!hasRole(user, "sales_manager", "ceo", "finance", "admin") || !user?.employee) {
    return NextResponse.json({ fel: "Nekad" }, { status: 403 });
  }

  const supabase = await supabaseServer();

  const { data: period } = await supabase
    .from("payroll_period")
    .select("id, period_start, period_end, status")
    .eq("id", id)
    .maybeSingle();

  if (!period) return NextResponse.json({ fel: "Perioden finns inte" }, { status: 404 });

  const [{ data: rader }, { data: justeringar }, { data: personal }, { data: kolumner }] =
    await Promise.all([
      supabase
        .from("payroll_row")
        .select("employee_id, worked_minutes, break_minutes, auto_closed_days, deviation_count")
        .eq("period_id", period.id),
      supabase.from("payroll_adjustment").select("employee_id, minutes").eq("period_id", period.id),
      supabase.from("employee").select("id, first_name, last_name, email, employee_number"),
      supabase.from("payroll_export_column").select("sort, header, field, active").order("sort"),
    ]);

  const per = new Map((personal ?? []).map((p) => [p.id, p]));

  const justering = new Map<string, number>();
  for (const j of justeringar ?? []) {
    justering.set(j.employee_id, (justering.get(j.employee_id) ?? 0) + j.minutes);
  }

  const exportrader: Exportrad[] = (rader ?? [])
    .map((r) => {
      const p = per.get(r.employee_id);
      return {
        employee_number: p?.employee_number ?? null,
        name: p ? fullName(p) : "Okänd",
        email: p?.email ?? "",
        period_start: period.period_start,
        period_end: period.period_end,
        worked_minutes: r.worked_minutes,
        break_minutes: r.break_minutes,
        adjustment_minutes: justering.get(r.employee_id) ?? 0,
        auto_closed_days: r.auto_closed_days,
        deviation_count: r.deviation_count,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "sv"));

  await supabaseAdmin().from("audit_log").insert({
    actor_id: user.employee.id,
    action: "payroll.exported",
    object_type: "payroll_period",
    object_id: period.id,
    meta: { rader: exportrader.length, attesterad: period.status === "attested" },
  });

  const fil = csv((kolumner ?? []) as Exportkolumn[], exportrader);
  const namn = `lonerapport-${period.period_start}-${period.period_end}.csv`;

  return new NextResponse(fil, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${namn}"`,
      "Cache-Control": "no-store",
    },
  });
}
