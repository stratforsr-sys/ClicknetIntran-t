import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { hamtaLage } from "@/lib/sparrar";
import { korTidjobbet } from "@/lib/jobb/tid";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Tidjobbet for sig. Sjalva arbetet ligger i `src/lib/jobb/tid.ts` och kors
 * normalt av `/api/jobb/natt` — den har rutten finns for att kunna kora bara
 * tidjobbet manuellt nar nagot ska redas ut.
 */
export async function GET(request: NextRequest) {
  const hemlighet = process.env.CRON_SECRET;
  if (!hemlighet) return NextResponse.json({ fel: "CRON_SECRET saknas" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${hemlighet}`)
    return NextResponse.json({ fel: "Nekad" }, { status: 401 });

  const lage = await hamtaLage();
  if (!lage.stampling) return NextResponse.json({ hoppade_over: "stämplingen är avstängd" });

  return NextResponse.json(await korTidjobbet(supabaseAdmin(), lage.rast));
}
