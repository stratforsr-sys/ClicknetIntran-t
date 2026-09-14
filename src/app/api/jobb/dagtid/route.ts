import { NextResponse, type NextRequest } from "next/server";
import { kontrolleraCron } from "@/lib/jobb/behorighet";
import { supabaseAdmin } from "@/lib/supabase/server";
import { korDagtidsjobbet } from "@/lib/jobb/dagtid";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Dagtidsjobbet. DEN ENDA JOBBRUTT SOM INTE RINGS UPP AV VERCEL.
 *
 * Hobby-planens två cron-poster är slut (natt 02:30, morgon 05:30 UTC), och en
 * post som kör en gång per dygn hade ändå inte kunnat påminna någon en kvart
 * efter att skiftet började. `pg_cron` i Supabase ringer i stället var kvart —
 * se migration 0059 och rubriken i `src/lib/jobb/dagtid.ts`.
 *
 * BÅDE POST OCH GET, och de två har olika anropare:
 *
 *   POST  är `pg_net`, som alltid postar.
 *   GET   är en människa med `curl` som vill köra jobbet nu och se kvittot.
 *
 * Samma behörighetskontroll för båda — `CRON_SECRET` i en Bearer-header. Den
 * är alltså inte öppnare för att den tar emot två metoder, och `pg_net` har
 * ingen väg in som en nyfiken saknar.
 */
async function kor(request: NextRequest) {
  const nekad = kontrolleraCron(request);
  if (nekad) return nekad;

  return NextResponse.json(await korDagtidsjobbet(supabaseAdmin()));
}

export async function POST(request: NextRequest) {
  return kor(request);
}

export async function GET(request: NextRequest) {
  return kor(request);
}
