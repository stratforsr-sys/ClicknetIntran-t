/**
 * Introfilmen i Nav 2.0 (0270): reglerna, utan beroenden, så att provet kan läsa dem rakt av.
 *
 * ===========================================================================
 * EN GÅNG PER PERSON, OCH ZEN VARJE GÅNG (beställaren 2026-10-31).
 *
 * Den som inte har sett filmen får den före första vyn. "Sedd" ligger i
 * databasen (`introfilm.sedd_at`), så att den följer med mellan dator, telefon
 * och appen. `varje_gang` visar den igen vid varje nytt besök; det är data,
 * aldrig en adress i koden, och slås av med en rad SQL (se 0270).
 *
 * Sedd = minst 95 % av filmen faktiskt uppspelad. Klienten räknar på
 * `video.played`, så att spolning till slutet aldrig räknas. "Senare" och
 * "Fortsätt utan film" räknas inte: filmen kommer igen nästa besök.
 * ===========================================================================
 */

export const FILM = {
  namn: "nav2-intro-v7",
  sekunder: 178,
  // Bucketen är navets egen i R2 (privat). Adressen signeras per hämtning.
  nycklar: {
    stor: "nav2/introfilm/nav2-intro-v7-1080p60.mp4",
    liten: "nav2/introfilm/nav2-intro-v7-720p60.mp4",
  },
} as const;

export type Filmstorlek = keyof typeof FILM.nycklar;

/** Så stor del av filmen som ska vara uppspelad för att den ska räknas som sedd. */
export const SEDD_ANDEL = 0.95;

/**
 * Hur länge den signerade adressen lever. Webbläsaren hämtar filmen i bitar
 * (Range) med samma adress medan den spelas, och en utgången adress ger 403 mitt
 * i. Tre timmar räcker för en film på tre minuter med paus, och spelaren hämtar
 * en ny adress om den ändå skulle gå ut.
 */
export const ADRESS_SEKUNDER = 3 * 3600;

/** Det som står i `#ndData.introfilm`. */
export type NdIntrofilm = {
  /** Visa grinden vid det här besöket. */
  visa: boolean;
  /** Har sett filmen minst en gång: får fortsätta direkt. */
  sedd: boolean;
  /** Visas vid varje nytt besök, också efter att den är sedd. */
  varjeGang: boolean;
  /** Filmens längd, andelen som ska vara uppspelad, och vilken film (spelarens kapitel). Samma tal som rutten provar mot. */
  sekunder: number;
  andel: number;
  film: string;
};

export type Introrad = { sedd_at: string | null; varje_gang: boolean | null };

export function introBeslut(rad: Introrad | null): NdIntrofilm {
  const sedd = Boolean(rad?.sedd_at);
  const varjeGang = rad?.varje_gang === true;
  return { visa: !sedd || varjeGang, sedd, varjeGang, sekunder: FILM.sekunder, andel: SEDD_ANDEL, film: FILM.namn };
}

/** `?k=` i hämtningen av adressen. */
export function filmstorlek(k: unknown): Filmstorlek | null {
  return k === "stor" || k === "liten" ? k : null;
}

/** Uppspelade sekunder enligt klienten. Lite marginal uppåt för avrundning, aldrig mer än filmen. */
export function arSedd(spelat: unknown): boolean {
  return typeof spelat === "number" && Number.isFinite(spelat) && spelat >= FILM.sekunder * SEDD_ANDEL && spelat <= FILM.sekunder + 2;
}

/** Raden efter att filmen setts. Första gången står kvar; `varje_gang` rörs aldrig här. */
export function seddRad(forra: { sedd_at: string | null; ganger: number | null } | null, nu: string) {
  return {
    sedd_at: forra?.sedd_at ?? nu,
    senast_sedd_at: nu,
    ganger: (forra?.ganger ?? 0) + 1,
    film: FILM.namn,
    andrad_at: nu,
  };
}
