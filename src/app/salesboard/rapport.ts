/**
 * Tavlans fel till navets felrapporter (`/salesboard/fel`, som läser skärmens kaka
 * eller den inloggades session). En tv har ingen konsol som någon läser, så ett fel
 * som bara loggas där finns inte. Bara webbläsaren: inget här får dra in servern.
 */

/** Senaste rapporten per digest: ett fel som upprepas varje bildruta skickas en gång i minuten. */
const RAPPORTERAT = new Map<string, number>();

/**
 * Ett fel eller en mätning till navets felrapporter (`/salesboard/fel`). Tyst om det
 * inte går: rapporteringen får aldrig själv bli ett fel på en tv.
 */
export function rapportera(digest: string, message: string, stack: string | null): void {
  const nu = Date.now();
  if (nu - (RAPPORTERAT.get(digest) ?? -Infinity) < 60_000) return;
  RAPPORTERAT.set(digest, nu);
  try {
    void fetch("/salesboard/fel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ digest, message, stack }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Ingen fetch, eller en som kastar direkt: inget att göra.
  }
}

export const felText = (fel: unknown): string => (fel instanceof Error ? `${fel.name}: ${fel.message}` : String(fel));
