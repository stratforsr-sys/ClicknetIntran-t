import { NextResponse, type NextRequest } from "next/server";
import { kontrolleraCron } from "@/lib/jobb/behorighet";
import { supabaseAdmin } from "@/lib/supabase/server";
import { korArendejobbet } from "@/lib/jobb/arenden";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Arendejobbet for sig. Kors normalt av `/api/jobb/natt`. */
export async function GET(request: NextRequest) {
  const nekad = kontrolleraCron(request);
  if (nekad) return nekad;

  return NextResponse.json(await korArendejobbet(supabaseAdmin()));
}
