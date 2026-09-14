import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { kommandeposter } from "@/lib/kalender-server";

export const dynamic = "force-dynamic";

/**
 * Vad som är på väg att hända — plingets enda fråga.
 *
 * =============================================================================
 * EN ROUTE HANDLER OCH INTE EN SERVER ACTION, OCH DET ÄR INTE EN SMAKSAK
 *
 * Next kör server actions i en SERIELL KÖ per session. En pollning var femte
 * minut skulle därmed dela kö med användarens klick, och den som bockar av en
 * uppgift i samma ögonblick som rastret går får vänta på rastret först. Samma
 * slutsats som `/api/jobb/*` drog: det som drivs av en timer och inte av en
 * människa hör hemma i en route handler.
 *
 * =============================================================================
 * INGEN HEMLIGHET I ADRESSEN, OCH INGEN BEHÖVS
 *
 * Till skillnad från `/api/jobb/*` (`CRON_SECRET`) och `/api/ical/[token]`
 * (hemlig URL) står den här bakom vanlig inloggning: `getCurrentUser()` läser
 * sessionen, och svaret bär uteslutande den inloggades egna uppgifter. Det
 * finns ingen parameter att ändra — man kan inte fråga efter någon annans dag,
 * eftersom frågan inte tar emot något.
 *
 * `no-store` är inte artighet. Utan den kan Vercels kant spara ett svar och
 * lämna samma lista till nästa person som frågar.
 * =============================================================================
 */
export async function GET() {
  const user = await getCurrentUser();

  // Ingen session, inget läckage och inget fel heller: en flik som stått öppen
  // över en utloggning ska sluta plinga, inte börja larma.
  if (!user?.employee) return svar([]);

  const poster = await kommandeposter(user);

  return svar(
    poster.map((p) => ({
      id: p.id,
      rubrik: p.rubrik,
      tid: p.tid,
      minuter: p.minuter,
      href: p.href,
    })),
  );
}

function svar(poster: unknown[]): NextResponse {
  return NextResponse.json(
    { poster },
    {
      headers: {
        "Cache-Control": "no-store, private",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}
