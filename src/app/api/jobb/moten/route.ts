import { NextResponse, type NextRequest } from "next/server";
import { kontrolleraCron } from "@/lib/jobb/behorighet";
import { supabaseAdmin } from "@/lib/supabase/server";
import { korMotenJobb } from "@/lib/nav2/moten-jobb";
import { skrivFel } from "@/lib/fel-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Möten (2026-11-12): påminnelserna efter mötet och reparationen av mötesprovisionens låsning, var kvart.
 *
 * `pg_cron` ringer via `kalla_jobb()` (0059, migration 0289): `nav-moten`, dygnet runt, eftersom påminnelsetiden
 * är en inställning per företag. Själva reglerna står i `motesflode.ts` (`vemPaminns`) och körningen i
 * `moten-jobb.ts`. Bara notiser, aldrig mejl.
 *
 * BÅDE POST OCH GET, som de andra jobben: `pg_net` postar, en människa med `curl` kör jobbet nu och ser kvittot.
 * Samma hemlighet (`CRON_SECRET`, Bearer) för båda.
 */
async function kor(request: NextRequest) {
  const nekad = kontrolleraCron(request);
  if (nekad) return nekad;
  try {
    return NextResponse.json(await korMotenJobb(supabaseAdmin()));
  } catch (e) {
    const fel = e instanceof Error ? e.message : String(e);
    await skrivFel({ kind: "automatic", path: "/api/jobb/moten", digest: "moten-jobb", message: `Möten-jobbet föll: ${fel}`, blocking: false });
    return NextResponse.json({ fel }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return kor(request);
}

export async function GET(request: NextRequest) {
  return kor(request);
}
