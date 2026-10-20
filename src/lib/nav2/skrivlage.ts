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
  // Beställarens ja 2026-10-20 ("Ska Kalendern få spara nu?" – "Ja"). 0088–0091 körda 2026-10-15.
  kalender: true,
  uppgifter: false,
  franvaro: false,
  tid: false,
  rutiner: false,
  utbildning: false,
  // Beställarens ja 2026-10-19: ladda upp och ta bort avtal, påminn om påskrift, tillsvidare.
  avtal: true,
  // Beställarens ja 2026-10-18: Grattis, Stämmer inte, Visa inte här, Sedan du tittade och lagets mål.
  hem: true,
  rekrytering: false,
  coachning: false,
  anstallda: false,
  // Beställarens ja 2026-10-20: frågor utan svar bokförs utan namn.
  paletten: true,
  profil: false,
  // Beställarens svar 2026-10-20 ("det som är bäst"), efter att 0135 körts: fördela, efter samtalet, möten med inbjudan, Ångra.
  leads: true,
  nyheter: true,
  // Gamla Nav P: lösenordsbytet och Kod vid inloggning i Inställningar → Säkerhet.
  sakerhet: false,
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
