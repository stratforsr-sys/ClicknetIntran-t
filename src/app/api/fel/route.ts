import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { skrivFel } from "@/lib/fel-server";
import { siteUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * E0.6. Klientens felgrans rapporterar hit.
 *
 * Rutten tar emot lite: en digest, en sokvag och hogst en rad text. Den tar
 * INTE emot en stack fran klienten — den vore obekraftad text fran utsidan i
 * en tabell som lases av chefen, och den riktiga stacken har servern redan
 * skrivit sjalv via onRequestError. Klientens uppgift ar att beratta att
 * NAGON SAG felet, inte vad felet var.
 *
 * Rutten kraver inte inloggning. Ett fel kan intraffa pa inloggningssidan, och
 * da ar det viktigare att raden finns an att den har en avsandare. Skyddet mot
 * skrap ar i stallet tre saker:
 *
 *   1. samma ursprung kravs — en annan sajt kan inte posta hit,
 *   2. kroppen klipps innan den lases,
 *   3. det unika indexet i 0026 gor att upprepningar av samma (digest, path)
 *      blir en rad med en raknare, inte tusen rader.
 *
 * Det ar inte ett skydd mot nagon som verkligen vill fylla tabellen. Det ar
 * ett internt nav med tjugofem konton bakom inloggning, och en tabell med
 * skrap i ar ett problem som gar att stada. Ett fel som ingen fick veta om ar
 * det inte.
 */
export async function POST(request: NextRequest) {
  try {
    const ursprung = request.headers.get("origin");
    if (ursprung && !samstammigt(ursprung, request)) {
      return NextResponse.json({ fel: "Fel ursprung" }, { status: 403 });
    }

    const ratext = (await request.text()).slice(0, 4000);
    let kropp: { digest?: unknown; path?: unknown };
    try {
      kropp = JSON.parse(ratext);
    } catch {
      return NextResponse.json({ fel: "Trasig kropp" }, { status: 400 });
    }

    // Kan misslyckas om felet intraffade fore inloggning, och det ar i sin
    // ordning. En rapport utan avsandare ar battre an ingen rapport.
    let reporterId: string | null = null;
    try {
      const user = await getCurrentUser();
      reporterId = user?.employee?.id ?? null;
    } catch {
      reporterId = null;
    }

    await skrivFel({
      kind: "automatic",
      path: typeof kropp.path === "string" ? kropp.path : "/",
      digest: typeof kropp.digest === "string" ? kropp.digest.slice(0, 100) : null,
      reporterId,
      userAgent: request.headers.get("user-agent"),
    });

    // Svaret sager alltid ok. Klienten ar mitt i en felsida och har inget att
    // gora med beskedet — och ett felmeddelande fran felrapporteringen pa en
    // felsida ar bara forvirrande.
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}

function samstammigt(ursprung: string, request: NextRequest): boolean {
  const tillatna = new Set([siteUrl(), request.nextUrl.origin]);
  return tillatna.has(ursprung);
}
