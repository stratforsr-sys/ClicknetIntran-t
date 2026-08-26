import { NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { giltigManad } from "@/lib/provision";
import { hamtaUnderlag } from "@/lib/provisionsunderlag-server";
import { csvUnderlag, filnamn } from "@/lib/provisionsunderlag";

export const dynamic = "force-dynamic";

/**
 * E13 steg 7, fraga 59: provisionsunderlaget som fil.
 *
 * ===========================================================================
 * KRETSEN AR SNAVARE AN SIDANS, med flit.
 *
 * `/provision/underlag/[manad]` visar det RLS slapper fram, sa en saljare som
 * oppnar den far ett underlag med bara sig sjalv i. Det ar ratt i en vy.
 *
 * En FIL ar nagot annat. Den lamnar navet, lever vidare utanfor det och gar
 * inte att ta tillbaka — och ett dokument som heter "provisionsunderlag" ser ut
 * att vara hela bolagets aven nar det bara innehaller en rad. Uttaget ar darfor
 * forbehallet den krets som ska lamna det vidare till lonekorningen, och det
 * LOGGAS: en fil som gatt ut ska ga att se att den gatt ut.
 * ===========================================================================
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ manad: string }> },
) {
  const { manad } = await params;

  const user = await getCurrentUser();
  if (!hasRole(user, "sales_manager", "ceo", "finance") || !user?.employee) {
    return NextResponse.json({ fel: "Nekad" }, { status: 403 });
  }

  if (!giltigManad(manad)) {
    return NextResponse.json({ fel: "Manaden ar inte giltig" }, { status: 400 });
  }

  const dok = await hamtaUnderlag(manad);

  await supabaseAdmin().from("audit_log").insert({
    actor_id: user.employee.id,
    action: "commission.exported",
    object_type: "commission_period",
    object_id: manad,
    meta: {
      period_month: manad,
      personer: dok.personer.length,
      belopp: dok.summa,
      faststalld: dok.faststalld,
    },
  });

  return new NextResponse(csvUnderlag(dok), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filnamn(dok)}"`,
      "Cache-Control": "no-store",
    },
  });
}
