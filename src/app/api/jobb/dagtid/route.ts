import { NextResponse, type NextRequest } from "next/server";
import { kontrolleraCron } from "@/lib/jobb/behorighet";
import { supabaseAdmin } from "@/lib/supabase/server";
import { korDagtidsjobbet } from "@/lib/jobb/dagtid";
import { korKalendersteget } from "@/lib/jobb/kalender";
import { SKRIVLAGE } from "@/lib/nav2/skrivlage";
import { skickaRundor } from "@/lib/nav2/franvaro-runda";
import { egnaPaminnelser, korTidpaminnelser } from "@/lib/nav2/tid-paminnelser";
import { skickaKvallsnotiser } from "@/lib/nav2/hem-kvall";
import { korAnstalldaPaminnelser } from "@/lib/nav2/anstallda-paminnelser";

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

  const db = supabaseAdmin();
  // Nav 2.0 (0094): var och ens val under "Påminn mig", bara när Tid i Nav 2.0 är påslagen.
  const val = SKRIVLAGE.tid ? await egnaPaminnelser(db) : null;
  const stampling = await korDagtidsjobbet(db, new Date(), val ? new Map([...val].map(([k, v]): [string, { pa: boolean; min: number }] => [k, v.in])) : undefined);
  // 0070: Leveranskalenderns serier, förberedelser och utkorg. Eget steg med
  // eget kvitto, så att ett fel i det ena inte döljer det andra.
  let kalender: unknown;
  try {
    kalender = await korKalendersteget(db);
  } catch (e) {
    kalender = { fel: e instanceof Error ? e.message : String(e) };
  }
  // Nav 2.0 (0093): önskemålsrundans utskick, bara när Frånvaro i Nav 2.0 får spara.
  let runda: unknown = null;
  if (SKRIVLAGE.franvaro) {
    try {
      runda = await skickaRundor(db);
    } catch (e) {
      runda = { fel: e instanceof Error ? e.message : String(e) };
    }
  }
  let tid: unknown = null;
  if (val) {
    try {
      tid = await korTidpaminnelser(db, val);
    } catch (e) {
      tid = { fel: e instanceof Error ? e.message : String(e) };
    }
  }
  // Nav 2.0 (0121, E5.8): kvällsnotisen till ledarna, vardagar från 17:00 och söndagar från 18:00.
  // Bakom SKRIVLAGE.hem (i funktionen). Söndagens anrop kräver supabase/vantar/hem_sondag.sql.
  let kvall: unknown = null;
  try {
    kvall = await skickaKvallsnotiser(db);
  } catch (e) {
    kvall = { fel: e instanceof Error ? e.message : String(e) };
  }
  // Nav 2.0 (0105): utskicksreglernas påminnelse och eskalering. Bakom SKRIVLAGE.anstallda (i funktionen).
  let anstallda: unknown = null;
  try {
    anstallda = await korAnstalldaPaminnelser(db);
  } catch (e) {
    anstallda = { fel: e instanceof Error ? e.message : String(e) };
  }
  return NextResponse.json({ ...stampling, kalender, runda, tid, kvall, anstallda });
}

export async function POST(request: NextRequest) {
  return kor(request);
}

export async function GET(request: NextRequest) {
  return kor(request);
}
