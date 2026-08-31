import type { Guide, Lage, Steg } from "../guider/typer.ts";

/**
 * Reglerna för en guidad tur. Ren logik utan databas och utan React, så att
 * `npm run test:guider` kan pröva dem utan att starta något.
 *
 * Ligger i lib och inte i en "use server"-fil av samma skäl som
 * `src/lib/utbildning.ts`: varje export ur en sådan modul blir en anropbar
 * slutpunkt.
 */

/** Raden i `guide_progress`, så som resten av navet ser den. */
export type Progress = {
  guide_slug: string;
  version: number;
  /** Hur många steg i guidens FULLSTÄNDIGA lista som är avklarade. Se nedan. */
  steg: number;
  completed_at: string | null;
};

/** Ett synligt steg, med sin plats i den fullständiga listan. */
export type SynligtSteg = { steg: Steg; full: number };

/**
 * ===========================================================================
 * VARFÖR PROGRESSEN RÄKNAS I DEN FULLSTÄNDIGA LISTAN OCH INTE I DEN SYNLIGA
 *
 * En guide innehåller steg som bara finns i ett av lägena: "tryck på Mer" finns
 * bara på telefonen, "panelen står kvar" bara på datorn. Den synliga listan är
 * alltså inte samma lista på en telefon som på en dator.
 *
 * Sparade vi "hon har gjort fem synliga steg" skulle en person som börjar i
 * telefonen på bussen och fortsätter vid skrivbordet hoppa över ett steg eller
 * få ett i repris — beroende på åt vilket håll bytet gick. Det är exakt den
 * sortens fel ingen rapporterar och alla tappar förtroendet av.
 *
 * Därför bär `steg` ett index i den fullständiga listan, som är densamma
 * överallt, och den synliga positionen räknas fram vid varje uppslag.
 * ===========================================================================
 */

/** Stegen som gäller i det här läget, med sina platser i originallistan. */
export function synligaSteg(guide: Guide, lage: Lage): SynligtSteg[] {
  return guide.steg
    .map((steg, full) => ({ steg, full }))
    .filter(({ steg }) => !steg.bara || steg.bara === lage);
}

/**
 * Ankaret som gäller i det här läget. `ankare_mobil` vinner på telefonen när
 * det finns; annars är `ankare` gemensamt, vilket är det vanliga.
 */
export function ankareFor(steg: Steg, lage: Lage): string | undefined {
  if (lage === "mobil" && steg.ankare_mobil) return steg.ankare_mobil;
  return steg.ankare;
}

/**
 * Var i den synliga listan turen ska återupptas.
 *
 * KLÄMMER I BÅDA ÄNDAR, och gör det med flit. `steg` i databasen är ett tal som
 * inte kan vara en främmande nyckel mot någonting (se 0040), och en guide som
 * krympt lämnar rader som pekar förbi slutet. Ett kastat fel här hade blivit en
 * anställd som inte kommer in i navet för att hennes gamla rad pekar på steg
 * åtta i en tur som numera har sex. Vi visar sista steget i stället.
 */
export function startSteg(guide: Guide, lage: Lage, sparat: number | null | undefined): number {
  const synliga = synligaSteg(guide, lage);
  if (synliga.length === 0) return 0;
  const gjorda = Math.max(0, sparat ?? 0);
  const position = synliga.filter(({ full }) => full < gjorda).length;
  return Math.min(position, synliga.length - 1);
}

/**
 * Vad som ska sparas när det synliga steget på plats `position` är gjort.
 * Alltid uttryckt i den fullständiga listan — se rubriken ovan.
 */
export function sparvarde(guide: Guide, lage: Lage, position: number): number {
  const synliga = synligaSteg(guide, lage);
  const rad = synliga[position];
  if (!rad) return guide.steg.length;
  return rad.full + 1;
}

/**
 * Är personen klar med guiden så som den ser ut NU?
 *
 * En avklarad tur räcker, utom när guiden höjts med `omtag` — då är ett gammalt
 * genomförande inte längre ett bevis på att hon kan det som gäller i dag. Det är
 * den enda skillnaden mellan en textputs och en riktig ändring, och den ligger
 * hos den som ändrar koden.
 */
export function arKlar(guide: Guide, progress: Progress | null | undefined): boolean {
  if (!progress?.completed_at) return false;
  if (guide.omtag && progress.version < guide.version) return false;
  return true;
}

/** Klar en gång, men momentet har ändrats sedan dess. */
export function behoverOmtag(guide: Guide, progress: Progress | null | undefined): boolean {
  return Boolean(progress?.completed_at) && Boolean(guide.omtag) && (progress?.version ?? 0) < guide.version;
}

export type GuideLage = "klar" | "pagar" | "ej_paborjad" | "omtag";

export const GUIDE_ETIKETT: Record<GuideLage, string> = {
  klar: "Klar",
  pagar: "Pågår",
  ej_paborjad: "Ej påbörjad",
  omtag: "Gör om",
};

/** Tonerna följer `Badge`. Samma uppdelning som `LAGE_TON` i utbildning.ts. */
export const GUIDE_TON: Record<GuideLage, "ok" | "brand" | "neutral" | "warn"> = {
  klar: "ok",
  pagar: "brand",
  ej_paborjad: "neutral",
  omtag: "warn",
};

/**
 * Ett läge per guide, för listan och för chefsöversikten senare.
 *
 * Ordningen är inte godtycklig: `omtag` vägar tyngre än `klar`, eftersom raden
 * ska visa det som kräver något av personen. Samma resonemang som `kursLage()`
 * i src/lib/utbildning.ts.
 */
export function guideLage(guide: Guide, progress: Progress | null | undefined): GuideLage {
  if (behoverOmtag(guide, progress)) return "omtag";
  if (arKlar(guide, progress)) return "klar";
  if ((progress?.steg ?? 0) > 0) return "pagar";
  return "ej_paborjad";
}

/** Hur långt, i hela procent. Noll steg är inte noll procent utan ingen guide. */
export function procent(guide: Guide, progress: Progress | null | undefined): number {
  const av = guide.steg.length;
  if (av === 0) return 0;
  if (arKlar(guide, progress)) return 100;
  return Math.min(100, Math.round(((progress?.steg ?? 0) / av) * 100));
}
