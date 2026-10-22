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
  // Beställarens ja 2026-10-21 (Gamla Nav G): allt i Provision sparar, också chefens sats, konsekvenstrappan och Utbetald.
  provision: true,
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
  // Beställarens ja 2026-10-20 (Gamla Nav P): lösenordsbytet och Kod vid inloggning i Inställningar → Säkerhet.
  sakerhet: true,
  // Beställarens ja 2026-10-21 (Gamla Nav G): Satser och löner sparar genom /nav2/satser. 0190 körd samma dag.
  satser: true,
} as const;

export type Skrivvy = keyof typeof SKRIVLAGE;

/**
 * BRON (K6, granskningen 2026-10-22): i produktionen visas en vy i Nav 2.0
 * först när den får spara. En vy i läsläge kan inte stämpla, lägga order eller
 * söka ledighet, så tills den slås på öppnas den i nuvarande Nav: mellanvaran
 * skickar inte om dess gamla adresser (vagar.ts), och skalet i utkastet öppnar
 * den där i stället för att rita den (`ND.iNuvarande`, moduler/nd.js).
 *
 * PREVIEWEN VISAR ALLT, som förut, så att beställaren kan prova vyerna i
 * läsläge. Bron följer `VERCEL_ENV` och kan tvingas med `NAV2_BRO=1` eller `0`.
 * Den dag en rad ovan slås på flyttar vyn över av sig själv.
 */
export const BRO: boolean =
  process.env.NAV2_BRO === "1" ? true : process.env.NAV2_BRO === "0" ? false : process.env.VERCEL_ENV === "production";

/** Om vyn visas i Nav 2.0. Vyer utan rad ovan (startsidans grund, sökningen, loggen …) påverkas inte av bron. */
export function visasINav2(vy: string): boolean {
  if (!BRO) return true;
  return Object.hasOwn(SKRIVLAGE, vy) ? SKRIVLAGE[vy as Skrivvy] : true;
}

/** Vyerna som med bron öppnas i nuvarande Nav. Tom utan bron. */
export function iNuvarande(): Skrivvy[] {
  return BRO ? (Object.keys(SKRIVLAGE) as Skrivvy[]).filter((k) => !SKRIVLAGE[k]) : [];
}

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
