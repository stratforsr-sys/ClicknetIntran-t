import type { Instrumentation } from "next";

/**
 * E0.6. Serversidans fangst av fel.
 *
 * `onRequestError` ar exakt den krok Sentry och motsvarande hakar i, och den
 * finns i ramverket. Det ar hela skalet att inte ta in ett beroende for att
 * komma at den.
 *
 * ===========================================================================
 * DEN HAR FILEN AR ENDA STALLET DAR MEDDELANDET FINNS.
 *
 * I produktion ger Next klienten BARA `error.digest`, aldrig texten — med
 * flit, eftersom ett felmeddelande kan beratta hur systemet ar byggt. Det
 * betyder att klientens felgrans kan saga "nagot gick sonder pa den har
 * sidan" och ingenting mer.
 *
 * Digesten ar densamma pa bada sidor. Servern skriver raden med text, klienten
 * skriver samma digest, och `registrera_fel` lagger ihop dem till en rad i
 * stallet for tva. Utan den har filen hade kon bestatt av rader som sager
 * "fel pa /franvaro (a1b2c3d4)" och inget mer.
 * ===========================================================================
 *
 * Importen av skrivningen ar dynamisk. Kroken kors i Node-runtimen men filen
 * laddas tidigt, och en toppniva-import av `server-only`-kod har gjort att
 * hela Supabase-klienten drogs in i varje kallstart aven nar inget fel intraffar.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context,
) => {
  try {
    const { skrivFel } = await import("@/lib/fel-server");

    const fel = err as { message?: string; stack?: string; digest?: string };

    await skrivFel({
      kind: "automatic",
      path: request.path,
      // Digesten ar kopplingen till klientens rapport. Saknas den — vilket den
      // gor for fel utanfor en renderad sida, till exempel i ett nattjobb —
      // skriver `skrivFel` anda raden med en egen nyckel.
      digest: fel.digest ?? null,
      message: fel.message ?? String(err),
      stack: fel.stack ?? null,
      // Vem som drabbades gar inte att veta har utan att lasa sessionen, och
      // att gora ett Supabase-anrop mitt i en felhantering ar ett satt att fa
      // tva fel i stallet for ett. Klientens rapport bar avsandaren.
      reporterId: null,
      userAgent: laesRubrik(request.headers, "user-agent"),
    });

    // Sa att felet syns i Vercels logg ocksa, med samma digest att soka pa.
    console.error(
      `[fel] ${context.routerKind} ${request.path} digest=${fel.digest ?? "-"}`,
      err,
    );
  } catch {
    // Se rubriken i fel-server.ts: felhanteringen far aldrig bli felet.
  }
};

function laesRubrik(headers: unknown, namn: string): string | null {
  if (!headers || typeof headers !== "object") return null;
  const h = headers as Record<string, string | string[] | undefined>;
  const v = h[namn];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}
