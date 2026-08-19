import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { korArendejobbet } from "@/lib/jobb/arenden";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Arendejobbet for sig. Kors normalt av `/api/jobb/natt`. */
export async function GET(request: NextRequest) {
  const hemlighet = process.env.CRON_SECRET;
  if (!hemlighet) return NextResponse.json({ fel: "CRON_SECRET saknas" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${hemlighet}`)
    return NextResponse.json({ fel: "Nekad" }, { status: 401 });

  return NextResponse.json(await korArendejobbet(supabaseAdmin()));
}
