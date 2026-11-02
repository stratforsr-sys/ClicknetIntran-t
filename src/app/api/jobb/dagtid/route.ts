import { NextResponse, type NextRequest } from "next/server";
import { kontrolleraCron } from "@/lib/jobb/behorighet";
import { supabaseAdmin } from "@/lib/supabase/server";
import { korKalendersteget } from "@/lib/jobb/kalender";
import { SKRIVLAGE } from "@/lib/nav2/skrivlage";
import { skickaRundor } from "@/lib/nav2/franvaro-runda";
import { korTidpaminnelser } from "@/lib/nav2/tid-paminnelser";
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
 * Hobby-planens två cron-poster är slut (natt 02:30, morgon 05:30 UTC), och
 * stegen här måste gå flera gånger om dagen (mötenas påminnelser, utkorgen,
 * kvällsnotisen). `pg_cron` i Supabase ringer i stället var kvart — se
 * migration 0059. Stämplingspåminnelsen som jobbet byggdes för är borttagen
 * (2026-11-01), men schemat och rutten står kvar för de andra stegen.
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
  // Påminnelsen "Du har inte stämplat in" är borta (beställaren 2026-11-01:
  // "skippa påminnelse om stämpling helt och hållet"). Den stod för nästan
  // hälften av klockan, och nio av tio följdes inte av en instämpling.

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
  if (SKRIVLAGE.tid) {
    try {
      tid = await korTidpaminnelser(db);
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
  // i Fel, en rad per dag (digesten bär datumet), som den uteblivna natten. Går kvittot inte att läsa
  // larmas det också (rättelserna 2026-11-02): förut såg en trasig kontroll ut som en lugn morgon.
  let morgon: unknown = null;
  const dag = new Date().toISOString().slice(0, 10);
  try {
    const k = await hamtaMorgonkvitto(db);
    morgon = k;
    if (k.saknas) await larmaEnGangOmDagen(db, `morgon-kvitto-${dag}`, `Morgonjobbet har inget kvitto i dag (${dag}). Det senaste är från ${k.senaste}.`);
  } catch (e) {
    const fel = e instanceof Error ? e.message : String(e);
    morgon = { fel };
    await larmaEnGangOmDagen(db, `morgon-kvitto-fel-${dag}`, fel);
  }
  return NextResponse.json({ kalender, runda, tid, kvall, anstallda, utbildning, nyheter, morgon });
}

/**
 * Ett larm per dag och digest. Jobbet går var 15:e minut, så utan kontrollen blev det ~50 förekomster
 * per dag av samma sak. `skrivFel` kastar aldrig, och går kontrollen inte att göra skrivs larmet ändå.
 */
async function larmaEnGangOmDagen(db: ReturnType<typeof supabaseAdmin>, digest: string, message: string): Promise<void> {
  const { data: larmat } = await db.from("error_report").select("id").eq("digest", digest).limit(1);
  if (larmat?.length) return;
  await skrivFel({ kind: "automatic", path: "/api/jobb/morgon/kvitto", digest, message, blocking: false });
}

export async function POST(request: NextRequest) {
  return kor(request);
}

export async function GET(request: NextRequest) {
  return kor(request);
}
