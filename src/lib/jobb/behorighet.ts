import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Behorighetskontrollen for de fyra jobbrutterna under /api/jobb.
 *
 * ===========================================================================
 * VARFOR JAMFORELSEN INTE FAR VARA `!==`
 *
 * `a !== b` pa strangar avbryter vid forsta tecknet som skiljer. Tiden det tar
 * att fa nej berattar darfor hur langt fram i hemligheten gissningen stamde,
 * och den som far gissa fritt kan bygga hemligheten tecken for tecken i
 * stallet for att prova alla pa en gang.
 *
 * Skillnaden ar nanosekunder och rutterna ligger bakom natet, sa i praktiken
 * ar angreppet svart att genomfora har. Men en konstanttidsjamforelse kostar
 * ingenting, och ett `!==` pa en hemlighet ar den sortens rad som kopieras
 * vidare till nasta stalle dar den kostar mer.
 *
 * Hittad av sakerhetsgenomgangen 2026-08-23.
 * ===========================================================================
 *
 * `timingSafeEqual` KRAVER lika langa buffertar och kastar annars — och en
 * langdkontroll fore hade lackt langden. Darfor hashas bada sidorna forst:
 * sha256 ger alltid 32 byte, oavsett vad som kom in i headern.
 *
 * Lag INTE till fler exporter som ror hemligheten har. Filen importeras av
 * route handlers, inte av en `"use server"`-fil, sa den blir ingen andpunkt —
 * men samma disciplin galler.
 */
function sammaHemlighet(given: string, vantad: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(vantad).digest();
  return timingSafeEqual(a, b);
}

/**
 * Returnerar ett svar som ska skickas tillbaka direkt, eller `null` nar
 * anroparen ar godkand.
 *
 * Tva utfall, och de betyder olika saker:
 *
 *   503  CRON_SECRET ar inte satt i miljon. Det ar ett driftfel hos oss, inte
 *        ett nekat anrop, och ska inte se ut som ett.
 *   401  Fel eller saknad hemlighet.
 *
 * Vercels cron skickar `Authorization: Bearer <CRON_SECRET>`.
 */
export function kontrolleraCron(request: NextRequest): NextResponse | null {
  const hemlighet = process.env.CRON_SECRET;
  if (!hemlighet) return NextResponse.json({ fel: "CRON_SECRET saknas" }, { status: 503 });

  const given = request.headers.get("authorization") ?? "";
  if (!sammaHemlighet(given, `Bearer ${hemlighet}`))
    return NextResponse.json({ fel: "Nekad" }, { status: 401 });

  return null;
}
