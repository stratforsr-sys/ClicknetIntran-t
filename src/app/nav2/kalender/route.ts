import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { arDatum, arVy } from "@/lib/leveranskalender";
import { hamtaKalposter, kalDetalj } from "@/lib/nav2/kalender";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Nav 2.0: kalenderns poster när utkastet bläddrar eller visar en kollega.
 *
 *   ?vy=manad|team|vecka&dag=YYYY-MM-DD&visa=<id>,<id>   posterna, som /kalender
 *   ?detalj=<calendar_event.id>                           en händelse i sin helhet
 *
 * BARA LASNING, med samma funktioner och samma delningsnivaer som sidan
 * (`hamtaLeveranskalender`, `hamtaHandelsedetalj`).
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return NextResponse.json({ fel: "Inte inloggad." }, { status: 401 });
  const url = new URL(request.url);
  const svar = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });

  const detalj = url.searchParams.get("detalj");
  if (detalj) {
    if (!UUID.test(detalj)) return svar({ fel: "Okänd händelse." }, 400);
    const d = await kalDetalj(user, detalj);
    return d ? svar(d) : svar({ fel: "Händelsen finns inte, eller så får du inte se detaljerna." }, 404);
  }

  const vy = url.searchParams.get("vy");
  const dag = url.searchParams.get("dag");
  if (!arVy(vy) || !arDatum(dag)) return svar({ fel: "Okänd vy eller dag." }, 400);
  const visa = (url.searchParams.get("visa") ?? "").split(",").filter((id) => UUID.test(id));
  const data = await hamtaKalposter(user, vy, dag, visa);
  return data ? svar(data) : svar({ fel: "Ingen kalender." }, 404);
}
