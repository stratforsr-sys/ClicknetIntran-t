import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, hasRole, fullName } from "@/lib/auth";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Ett fält i CSV. Semikolon som avgränsare — svensk Excel förväntar sig det. */
function falt(v: string | number | null): string {
  const s = String(v ?? "");
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * AC-2.6: journalen ska gå att hämta som CSV. Exporten går via RLS-klienten,
 * så den kan inte ge mer än vad sidan visar — och den loggas, eftersom en
 * uttagen fil lever vidare utanför navet.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!hasRole(user, "sales_manager", "admin") || !user?.employee) {
    return NextResponse.json({ fel: "Nekad" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const fran = sp.get("fran") ?? "1970-01-01";
  const till = sp.get("till") ?? new Date().toISOString().slice(0, 10);
  const person = sp.get("person");

  const supabase = await supabaseServer();
  let fraga = supabase
    .from("work_time_journal")
    .select(
      "employee_id, work_date, worked_minutes, break_minutes, on_call_minutes, overtime_minutes, extra_time_minutes, auto_closed",
    )
    .gte("work_date", fran)
    .lte("work_date", till)
    .order("work_date");

  if (person) fraga = fraga.eq("employee_id", person);

  const [{ data: rader }, { data: personal }] = await Promise.all([
    fraga,
    supabase.from("employee").select("id, first_name, last_name, employee_number"),
  ]);

  const per = new Map((personal ?? []).map((p) => [p.id, p]));

  const rubriker = [
    "Datum",
    "Anställningsnummer",
    "Namn",
    "Arbetad tid (minuter)",
    "Rast (minuter)",
    "Jourtid (minuter)",
    "Övertid (minuter)",
    "Mertid (minuter)",
    "Stängd av systemet",
  ];

  const kropp = (rader ?? []).map((r) => {
    const p = per.get(r.employee_id);
    return [
      r.work_date,
      p?.employee_number ?? "",
      p ? fullName(p) : "",
      r.worked_minutes,
      r.break_minutes,
      r.on_call_minutes,
      r.overtime_minutes,
      r.extra_time_minutes,
      r.auto_closed ? "ja" : "nej",
    ]
      .map(falt)
      .join(";");
  });

  await supabaseAdmin().from("audit_log").insert({
    actor_id: user.employee.id,
    action: "journal.exported",
    object_type: "work_time_journal",
    object_id: person ?? "alla",
    meta: { fran, till, rader: kropp.length },
  });

  // BOM forst, annars laser svensk Excel a, a och o som skrapmat.
  const csv = "﻿" + [rubriker.join(";"), ...kropp].join("\r\n");

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="arbetstid-${fran}-${till}.csv"`,
      "cache-control": "no-store",
    },
  });
}
