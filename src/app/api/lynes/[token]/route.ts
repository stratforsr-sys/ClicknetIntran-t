import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { taEmotSamtal } from "@/lib/samtal-server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Växelns webhook. Lynes postar hit ett samtal.
 *
 * ===========================================================================
 * VARFÖR HEMLIGHETEN LIGGER I ADRESSEN OCH INTE BARA I EN HEADER
 *
 * `/api/jobb/*` kräver `Authorization: Bearer <CRON_SECRET>`, och det är rätt
 * där: avsändaren är Vercels cron, som vi styr över. Lynes är vi inte
 * avsändare för. Den anpassade webhooken slås på av deras support, och om den
 * kan bära en egen header vet vi inte förrän den är påslagen.
 *
 * En adress vi kan ge dem oavsett vad deras formulär tillåter är alltså det
 * enda som säkert fungerar — samma lösning som kalenderflödet i
 * `/api/ical/[token]` (0021), och av exakt samma skäl.
 *
 * En header godtas ÄVEN, för den dagen Lynes kan skicka en. Då kan adressen
 * bytas ut mot en intetsägande och hemligheten flytta in i headern, utan att
 * den här filen behöver ändras.
 *
 * ===========================================================================
 * VARFÖR CRON_SECRET INTE ÅTERANVÄNDS
 *
 * Den nyckeln kan starta nattjobbet. En hemlighet som lämnas ut till en
 * tredje part ska inte kunna göra något annat än det den lämnades ut för —
 * och `LYNES_WEBHOOK_SECRET` kan bara lämna ett samtal.
 *
 * ===========================================================================
 * VAD SVARET BETYDER FÖR VÄXELN
 *
 * En webhook som får fel svar skickar om. Därför tre lägen och inte två:
 *
 *   401  fel hemlighet. Ska inte skickas om — det hjälper inte.
 *   500  vi kunde inte skriva ner påsen. SKA skickas om.
 *   200  påsen ligger i `call_ingest`. Även när tolkningen föll: raden finns,
 *        och en omleverans hade gett samma resultat en gång till. Kroppen
 *        säger `tolkat: false` så att det syns i växelns egen leveranslogg.
 */

const MAX_KROPP = 200_000;

function sammaHemlighet(given: string, vantad: string): boolean {
  // Hashas först — `timingSafeEqual` kräver lika långa buffertar, och en
  // längdkontroll före hade läckt längden. Samma resonemang som
  // `src/lib/jobb/behorighet.ts`, och det står utskrivet där.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(vantad).digest();
  return timingSafeEqual(a, b);
}

function slapper(token: string, request: NextRequest): NextResponse | null {
  const hemlighet = process.env.LYNES_WEBHOOK_SECRET;

  // 503 och inte 401: att vi inte satt miljövariabeln är ett driftfel hos oss
  // och ska inte se ut som ett nekat anrop. Samma skillnad som jobbrutterna gör.
  if (!hemlighet) return NextResponse.json({ fel: "LYNES_WEBHOOK_SECRET saknas" }, { status: 503 });

  if (token && sammaHemlighet(token, hemlighet)) return null;

  const header = request.headers.get("authorization") ?? "";
  if (header && sammaHemlighet(header, `Bearer ${hemlighet}`)) return null;

  return NextResponse.json({ fel: "Nekad" }, { status: 401 });
}

/**
 * Verifieringsanropet. Många webhookformulär gör en GET mot adressen innan de
 * sparar den, och en 405 där ser ut som en trasig adress.
 *
 * Svaret bär ingenting om navet. Den som har hemligheten får veta att den är
 * rätt, ingenting mer.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const nekad = slapper(token, _request);
  if (nekad) return nekad;
  return NextResponse.json({ ok: true, redo: true });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const nekad = slapper(token, request);
  if (nekad) return nekad;

  // Klipps före tolkning. En påse på tvåhundra kilobyte är inte ett samtal, och
  // gränsen ska gå innan vi lagt minne på den.
  const ratext = (await request.text()).slice(0, MAX_KROPP);

  if (!ratext.trim()) {
    // Tom kropp är inte ett fel som ska skickas om, men den ska inte heller
    // bli en rad i radloggen. Då fylls den av tomma påsar från en felställd
    // webhook, och arbetslistan över otolkade blir oläsbar.
    return NextResponse.json({ ok: true, mottaget: false, skal: "tom kropp" });
  }

  const svar = await taEmotSamtal(ratext, request.headers);

  if (!svar.mottaget) {
    return NextResponse.json({ ok: false, mottaget: false }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    mottaget: true,
    tolkat: svar.tolkat,
    id: svar.callId,
  });
}
