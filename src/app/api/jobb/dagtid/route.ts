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
import { publiceraSchemalagda } from "@/lib/nav2/nyheter-jobb";
import { korUtbildningsPaminnelser } from "@/lib/nav2/utbildning-paminnelser";
import { hamtaMorgonkvitto } from "@/lib/jobb/drift-server";
import { skrivFel } from "@/lib/fel-server";

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
  // Bakom SKRIVLAGE.hem (i funktionen). Söndagens anrop är cron-jobbet `nav-dagtid-sondag` (0235_hem_sondag).
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
  // Nav 2.0 (0098): Utbildnings påminnelser, repetitionen (Web Push + klockan) och certifikat
  // som går ut om en månad (klockan + mejl). Bakom SKRIVLAGE.utbildning (i funktionen).
  let utbildning: unknown = null;
  try {
    utbildning = await korUtbildningsPaminnelser(db);
  } catch (e) {
    utbildning = { fel: e instanceof Error ? e.message : String(e) };
  }
  // Nav 2.0 (0130): schemalagda inlägg i Nyheter ("I morgon 07:30"). Bakom SKRIVLAGE.nyheter (i funktionen).
  let nyheter: unknown = null;
  try {
    nyheter = await publiceraSchemalagda(db);
  } catch (e) {
    nyheter = { fel: e instanceof Error ? e.message : String(e) };
  }
  // Gul 24 (produktionsprovet 2026-10-30): morgonbrevets kvitto. Saknas det efter 06:30 UTC larmas det
  // i Fel, en rad per dag (digesten bär datumet), som den uteblivna natten. Jobbet går var 15:e minut,
  // så larmet skrivs bara om dagens rad inte redan finns: annars blev det ~50 förekomster per dag.
  let morgon: unknown = null;
  try {
    const k = await hamtaMorgonkvitto(db);
    morgon = k;
    const dag = new Date().toISOString().slice(0, 10);
    const digest = `morgon-kvitto-${dag}`;
    const { data: larmat } = k.saknas ? await db.from("error_report").select("id").eq("digest", digest).limit(1) : { data: null };
    if (k.saknas && !larmat?.length) {
      await skrivFel({
        kind: "automatic",
        path: "/api/jobb/morgon/kvitto",
        digest,
        message: `Morgonjobbet har inget kvitto i dag (${dag}). Det senaste är från ${k.senaste}.`,
        blocking: false,
      });
    }
  } catch (e) {
    morgon = { fel: e instanceof Error ? e.message : String(e) };
  }
  return NextResponse.json({ ...stampling, kalender, runda, tid, kvall, anstallda, utbildning, nyheter, morgon });
}

export async function POST(request: NextRequest) {
  return kor(request);
}

export async function GET(request: NextRequest) {
  return kor(request);
}
