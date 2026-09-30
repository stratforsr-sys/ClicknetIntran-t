import { NextResponse, type NextRequest } from "next/server";
import { kontrolleraCron } from "@/lib/jobb/behorighet";
import { supabaseAdmin } from "@/lib/supabase/server";
import { tomUtkorgen } from "@/lib/utkorg-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Utkorgens reservtömning (0069). `pg_cron` ringer varje minut via `pg_net`,
 * precis som dagtidsjobbet i 0059 — `vercel.json` rörs inte (två poster är
 * Hobby-planens tak, och en tredje stoppar alla tre).
 *
 * Den vanliga vägen är `after()` i den action som skrev raderna. Den här tar
 * det som blev kvar när en funktion dog innan ångerfönstret gått ut, och den
 * lägger först uppgifternas påminnelser i utkorgen (`lk_uppgiftspaminnelser`),
 * så att de töms i samma svep.
 *
 * JOBBET SKAPAS AVSTÄNGT i 0069 och slås på när grenen mergats: `job_target`
 * pekar på produktionen, och där finns rutten först efter mergen.
 *
 * POST för `pg_net`, GET för en människa med `curl`. Samma `CRON_SECRET`.
 */
async function kor(request: NextRequest) {
  const nekad = kontrolleraCron(request);
  if (nekad) return nekad;

  const { data: paminnelser, error } = await supabaseAdmin().rpc("lk_uppgiftspaminnelser");
  const tomning = await tomUtkorgen(200);

  return NextResponse.json({
    paminnelser: error ? `fel: ${error.message}` : paminnelser,
    ...tomning,
  });
}

export async function POST(request: NextRequest) {
  return kor(request);
}

export async function GET(request: NextRequest) {
  return kor(request);
}
