/**
 * Nav 2.0: vilka vyer som får spara.
 *
 * Beställarens beslut 2026-10-14: läsläge tills hen säger ja, vy för vy. Varje
 * skrivande rutt under /nav2 frågar här först. Står vyn på `false` svarar
 * rutten 423 och sparar ingenting — knappen i utkastet säger det.
 *
 * Att slå på en vy är att ändra raden nedan i en egen commit, efter beställarens
 * uttryckliga ja.
 */
export const SKRIVLAGE = {
  arenden: false,
  fel: false,
  order: false,
  provision: false,
  kalender: false,
} as const;

export type Skrivvy = keyof typeof SKRIVLAGE;

export const LASLAGE_TEXT = "Läsläge: det här sparas när beställaren slår på vyn. Ingenting ändrades.";

/** Samma ursprung som sidan. Rutterna tar kakor, så en annan sajt får inte posta hit. */
export function sammaUrsprung(request: Request): boolean {
  const ursprung = request.headers.get("origin");
  if (!ursprung) return false;
  try {
    return new URL(ursprung).host === new URL(request.url).host;
  } catch {
    return false;
  }
}
