import { NextResponse } from "next/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { hamtaRegisterutdrag } from "@/lib/registerutdrag-server";
import { svensktDatum } from "@/lib/klocka";

export const dynamic = "force-dynamic";

/**
 * AC-12.4, K25: registerutdrag som nedladdningsbar JSON.
 *
 * Tva som far hamta: personen sjalv, och den som forvaltar registret.
 * Teamledaren star utanfor med flit — hen ser sitt team i vardagen, men ett
 * registerutdrag ar hela innehallet inklusive lonerader och arenden.
 *
 * En route handler och inte en sida: utdraget ar en fil man sparar och laser
 * i lugn och ro, inte nagot man bladdrar i. Att rita 40 tabeller i HTML hade
 * dessutom gjort det svarare att kontrollera att inget saknas.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user?.employee) return new NextResponse("Nekad", { status: 401 });

  const egen = user.employee.id === id;

  // 404 och inte 403, samma val som AC-5.9 gor for dokument: ett nekande
  // bekraftar att raden finns, och det ar i sig en uppgift.
  if (!egen && !hasRole(user, "sales_manager", "ceo", "admin")) {
    return new NextResponse("Finns inte", { status: 404 });
  }

  const db = supabaseAdmin();
  const utdrag = await hamtaRegisterutdrag(db, id);
  if (!utdrag) return new NextResponse("Finns inte", { status: 404 });

  /**
   * Loggen skrivs FORE svaret skickas.
   *
   * Ett utdrag ar ett utlamnande av samtliga personuppgifter om en manniska.
   * Gar loggningen fel efterat har utlamnandet redan skett utan spar, och da
   * ar det hellre sa att hamtningen misslyckas an att den blir osynlig.
   */
  const { error: loggfel } = await db.from("audit_log").insert({
    actor_id: user.employee.id,
    action: "employee.data_export",
    object_type: "employee",
    object_id: id,
    meta: { egen, tabeller: Object.keys(utdrag.data).length },
  });
  if (loggfel) {
    return new NextResponse("Utdraget kunde inte loggas och lämnas därför inte ut.", {
      status: 500,
    });
  }

  return new NextResponse(JSON.stringify(utdrag, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Filnamnet bar bara datum. Namnet hade gjort filen sokbar i en
      // nedladdningsmapp som ofta ar delad eller synkad.
      "content-disposition": `attachment; filename="registerutdrag-${svensktDatum(new Date())}.json"`,
      "cache-control": "no-store",
    },
  });
}
