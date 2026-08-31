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
  /**
   * Senaste rörelsen. Valfri: personens egen vy behöver den inte, men chefens
   * bygger hela stillestånds­frågan på den. Hämtas därför bara där den används.
   */
  updated_at?: string | null;
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

/**
 * ===========================================================================
 * CHEFENS HALVA: HUR LÅNGT NÅGON KOMMIT, OCH NÄR DET ÄR VÄRT ATT SÄGA TILL
 *
 * Räknas fram ur samma rader som personen själv ser. Ingen egen bokföring, inga
 * beräknade kolumner i databasen — hade läget lagrats skulle det kunna bli
 * gammalt utan att någon märkte det, och en chefsvy som visar fel läge är
 * värre än ingen chefsvy alls.
 * ===========================================================================
 */

/** Så länge får en påbörjad tur stå stilla innan chefens vy markerar den. */
export const STILLASTAENDE_DAGAR = 3;

/**
 * Så lång tid har man på sig att gå igenom hela sitt paket, räknat från
 * startdatumet. Utan spärrar är den ingen gräns utan en signal: det är den här
 * siffran nattjobbet larmar på. Ändras den ändras den här.
 */
export const FRIST_DAGAR = 14;

const DYGN = 24 * 60 * 60 * 1000;

/** Hela dagar sedan tidpunkten. Null in ger null ut. */
export function dagarSedan(iso: string | null | undefined, nu: Date = new Date()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((nu.getTime() - t) / DYGN);
}

export type Personlage = {
  klara: number;
  av: number;
  /** Turen personen står mitt i, om någon. */
  pagar: { slug: string; titel: string; steg: number; av: number } | null;
  /** ISO för senaste rörelsen i någon guide. */
  senast: string | null;
  /** Dagar sedan senaste rörelsen. Null om ingenting påbörjats. */
  stillestand: number | null;
  /** Alla guider för personens roll är klara. */
  onboardad: boolean;
  /** Fristen har passerat och paketet är inte klart. */
  forsenad: boolean;
};

/**
 * Personens läge, räknat ur hennes rader och de guider som gäller HENNE.
 *
 * `guider` måste vara den lista `guiderForRoller()` gav för just den personen —
 * en säljare och en ekonom har inte samma nämnare, och "2 av 6" betyder
 * ingenting utan rätt sexa.
 *
 * STILLESTÅND RÄKNAS BARA PÅ DET SOM PÅBÖRJATS. Den som inte rört en enda
 * guide står inte still i en tur; hon har inte börjat, och det är ett annat
 * samtal. Därför är `stillestand` null i det fallet i stället för antalet dagar
 * sedan anställningen — vilket hade sett ut som ett larm om något som ingen
 * ännu haft en chans att göra fel.
 */
export function personlage(
  guider: Guide[],
  rader: Progress[],
  startdatum: string | null,
  nu: Date = new Date(),
): Personlage {
  const forSlug = new Map(rader.map((r) => [r.guide_slug, r]));

  let klara = 0;
  let pagar: Personlage["pagar"] = null;
  let senast: string | null = null;

  for (const guide of guider) {
    const rad = forSlug.get(guide.slug) ?? null;
    if (arKlar(guide, rad)) {
      klara += 1;
      continue;
    }
    // Den första påbörjade men oavslutade är den hon står i. Fler än en åt
    // gången går inte att ha — turerna startar en i taget.
    if (!pagar && rad && rad.steg > 0) {
      pagar = { slug: guide.slug, titel: guide.titel, steg: rad.steg, av: guide.steg.length };
    }
  }

  // Senaste rörelsen i NÅGON guide, inte bara i den som pågår: den som just
  // blev klar med en tur står inte still även om nästa inte är påbörjad.
  for (const rad of rader) {
    const t = rad.updated_at ?? null;
    if (t && (!senast || t > senast)) senast = t;
  }

  const onboardad = guider.length > 0 && klara === guider.length;
  const paborjad = rader.some((r) => r.steg > 0);
  const dagarKvarISysslan = dagarSedan(startdatum, nu);

  return {
    klara,
    av: guider.length,
    pagar,
    senast,
    stillestand: paborjad ? dagarSedan(senast, nu) : null,
    onboardad,
    forsenad:
      !onboardad && dagarKvarISysslan !== null && dagarKvarISysslan > FRIST_DAGAR,
  };
}

/** Markeras raden i chefens vy? */
export function starStilla(lage: Personlage): boolean {
  return (
    !lage.onboardad &&
    lage.stillestand !== null &&
    lage.stillestand >= STILLASTAENDE_DAGAR
  );
}
