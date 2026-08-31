import type { Guide } from "./typer.ts";
import type { Role } from "../lib/roles.ts";
import { KOM_IGANG } from "./kom-igang.ts";
import { ARENDEN, FRANVARO, ORDER, PROVISION, RUTINER, STAMPLA } from "./moduler.ts";

/**
 * Registret. Varje guide som finns står här, och ingenting utanför listan går
 * att starta — `hamtaGuide()` är det enda uppslaget, och server actions slår
 * upp slugen här innan de skriver något.
 *
 * Att lägga till en guide: skriv filen, importera den, lägg den i listan, kör
 * `npm run test:guider`. Provet kontrollerar att varje ankare finns i
 * gränssnittet och att slugen är unik.
 *
 * ORDNINGEN I LISTAN ÄR ORDNINGEN I VYN. Startguiden först; därefter i den
 * ordning en ny anställd rimligen möter momenten. Det är inte en tvingande
 * kedja — beslutet 2026-08-31 var fri ordning efter startguiden — men en lista
 * i slumpmässig ordning ser ut som en hög.
 */
export const GUIDER: Guide[] = [
  KOM_IGANG,
  RUTINER,
  STAMPLA,
  FRANVARO,
  ORDER,
  PROVISION,
  ARENDEN,
];

export function hamtaGuide(slug: string): Guide | null {
  return GUIDER.find((g) => g.slug === slug) ?? null;
}

/**
 * Guiderna som gäller en roll. Tom `roller` betyder alla, samma konvention som
 * `course.audience_roles` i M6 — och samma skäl: det vanliga fallet ska inte
 * kräva att man räknar upp varenda roll och kommer ihåg att uppdatera listan
 * när en ny roll införs.
 */
export function guiderForRoller(
  roller: Role[] | null | undefined,
  /**
   * Stämplar personen? Räknas ut av anroparen som
   * `sparr.stampling && !stampelfri(user.roles)` — se `krav` i typer.ts för
   * varför svaret inte får härledas ur en rollista här.
   */
  stamplar = false,
): Guide[] {
  const mina = roller ?? [];
  return GUIDER.filter((g) => {
    if (g.krav === "stamplar" && !stamplar) return false;
    return g.roller.length === 0 || g.roller.some((r) => mina.includes(r));
  });
}

/** Guiden som hör till en modulsida, om det finns en. */
export function guideForModul(modul: string): Guide | null {
  return GUIDER.find((g) => g.modul === modul) ?? null;
}

/**
 * Den som startar av sig själv vid första inloggningen.
 *
 * Returnerar en enda guide och inte en lista, med flit. Två guider som båda
 * vill äga första inloggningen är inte en konfiguration utan ett misstag, och
 * det ska synas som ett — se provet.
 */
export function startguiden(): Guide | null {
  return GUIDER.find((g) => g.vidForstaInloggningen) ?? null;
}

export type { Guide, Steg, Handling, Lage } from "./typer.ts";
