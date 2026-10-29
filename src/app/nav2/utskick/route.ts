import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { medNyckel } from "@/lib/nav2/nyckel";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";
import { arSuperadmin, sparaUtskick, utskicksvy } from "@/lib/utskick-server";
import { standardFor } from "@/lib/utskick-standard";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0: Inställningar → Notiser (det egna lagret) och Inställningar →
 * Utskick (superadmin: bolaget, nivåerna och var och en). Utskicken, 0255.
 *
 *   GET: `Utskicksvy` — katalogen, mina lager, det superadmin låst för mig,
 *   och för superadmin hela bolaget.
 *
 *   POST, `{lager, niva?, employeeId?, kanal, nyckel, varde}`: en brytare.
 *   `varde` är true, false eller null (ärv). Svarar med lagrets nya regler.
 *
 * ===========================================================================
 * VEM FÅR VAD PRÖVAS I `sparaUtskick`, inte här, så att gamla Navs action
 * och den här rutten inte kan glida isär. Rutten prövar ursprunget först
 * (den tar kakor) och läsläget sedan. Allt går genom `medNyckel`.
 * ===========================================================================
 */

const svar = (data: Record<string, unknown>, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });

export async function GET() {
  const user = await getCurrentUser();
  if (!user?.employee) return svar({ fel: "Du måste vara inloggad." }, 401);
  try {
    return svar({ ...(await utskicksvy(user, standardFor)) });
  } catch (e) {
    console.error("nav2/utskick:", e instanceof Error ? e.message : e);
    return svar({ fel: "Inställningen gick inte att läsa." }, 500);
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return svar({ fel: "Du måste vara inloggad." }, 401);
  if (!sammaUrsprung(request)) return svar({ fel: "Fel ursprung." }, 403);

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return svar({ fel: "Ogiltig begäran." }, 400);
  }
  // Samma prov som i `sparaUtskick`, här för att 403 ska komma före läsläget (förebilden /nav2/satser).
  if ((b.lager ?? "egen") !== "egen" && !arSuperadmin(user)) return svar({ fel: "Bara en superadmin ställer in utskicken för andra." }, 403);
  if (!SKRIVLAGE.utskick) return svar({ fel: LASLAGE_TEXT, laslage: true }, 423);

  return medNyckel(request, user.employee.id, async () => {
    const u = await sparaUtskick(user, b);
    return u.ok ? svar({ ok: "Sparat.", regler: u.regler }) : svar({ fel: u.fel }, u.status);
  });
}
