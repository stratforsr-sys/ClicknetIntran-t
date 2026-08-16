/**
 * Delade regler for M6. Ligger i lib och inte i en server action-fil eftersom
 * en "use server"-modul exponerar varje export som en anropbar slutpunkt.
 */

export type KursLage = "certifierad" | "pagar" | "ej_paborjad" | "forsenad" | "utgangen";

export const LAGE_ETIKETT: Record<KursLage, string> = {
  certifierad: "Klar",
  pagar: "Pågår",
  ej_paborjad: "Ej påbörjad",
  forsenad: "Försenad",
  utgangen: "Utgången",
};

export const LAGE_TON: Record<KursLage, "ok" | "warn" | "danger" | "neutral"> = {
  certifierad: "ok",
  pagar: "warn",
  ej_paborjad: "neutral",
  forsenad: "danger",
  utgangen: "danger",
};

export type Certifikat = { expires_at: string | null; issued_at: string };

/**
 * AC-6.6. Ordningen ar inte godtycklig: ett utganget certifikat vager tyngre
 * an att personen sitter mitt i en omtagning, och en overskriden frist vager
 * tyngre an att hon inte borjat. Vyn ska visa det som kraver atgard.
 */
export function kursLage(args: {
  certifikat: Certifikat | null;
  klaraModuler: number;
  antalModuler: number;
  startDatum: string | null;
  fristDagar: number | null;
  nu?: Date;
}): KursLage {
  const nu = args.nu ?? new Date();

  if (args.certifikat) {
    const gar_ut = args.certifikat.expires_at ? new Date(args.certifikat.expires_at) : null;
    if (!gar_ut || gar_ut > nu) return "certifierad";
    return "utgangen";
  }

  if (forsenad(args.startDatum, args.fristDagar, nu)) return "forsenad";
  if (args.klaraModuler > 0) return "pagar";
  return "ej_paborjad";
}

export function forfallodag(startDatum: string | null, fristDagar: number | null): Date | null {
  if (!startDatum || !fristDagar) return null;
  const d = new Date(startDatum);
  d.setDate(d.getDate() + fristDagar);
  return d;
}

function forsenad(startDatum: string | null, fristDagar: number | null, nu: Date): boolean {
  const forfaller = forfallodag(startDatum, fristDagar);
  return forfaller !== null && forfaller < nu;
}

/** AC-6.3. Null in betyder ett certifikat som aldrig gar ut. */
export function utgangsdatum(giltigManader: number | null, fran: Date = new Date()): string | null {
  if (!giltigManader) return null;
  const d = new Date(fran);
  d.setMonth(d.getMonth() + giltigManader);
  return d.toISOString();
}

/**
 * AC-6.2. Returnerar nar nasta forsok tidigast far goras, eller null om det ar
 * fritt fram. Bara underkanda forsok sparrar — den som klarat kursen behover
 * ingen vantetid, hon behover inget forsok alls.
 */
export function sparrTill(
  senasteUnderkanda: string | null,
  vantetimmar: number,
): Date | null {
  if (!senasteUnderkanda || vantetimmar <= 0) return null;
  const oppnar = new Date(senasteUnderkanda);
  oppnar.setHours(oppnar.getHours() + vantetimmar);
  return oppnar > new Date() ? oppnar : null;
}

export function tidkvar(till: Date, nu: Date = new Date()): string {
  const minuter = Math.max(1, Math.ceil((till.getTime() - nu.getTime()) / 60000));
  if (minuter < 60) return `${minuter} minuter`;
  const timmar = Math.ceil(minuter / 60);
  if (timmar < 24) return `${timmar} ${timmar === 1 ? "timme" : "timmar"}`;
  const dagar = Math.ceil(timmar / 24);
  return `${dagar} ${dagar === 1 ? "dag" : "dagar"}`;
}

// -----------------------------------------------------------------------------
// Fragor skrivs som text, inte i ett formular med knappar per alternativ.
//
// Skalet ar att den som skriver en kurs skriver den i ett svep, ofta genom att
// klistra in fran ett underlag. Ett formular med "lagg till alternativ" tre
// ganger per fraga gor samma arbete tio ganger langsammare.
//
//   Vad galler vid sjukanmalan?
//   * Ring chefen samma dag
//   - Mejla veckan efter
//
// Stjarna = ratt svar. Tom rad skiljer fragorna at.
// -----------------------------------------------------------------------------

export type Fraga = { prompt: string; alternativ: { label: string; ratt: boolean }[] };

export function tolkaFragor(text: string): { fragor: Fraga[]; fel: string | null } {
  const block = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  if (block.length === 0) return { fragor: [], fel: null };

  const fragor: Fraga[] = [];

  for (const [i, b] of block.entries()) {
    const rader = b.split("\n").map((r) => r.trim()).filter(Boolean);
    const prompt = rader[0];
    const alternativ = rader.slice(1).map((r) => ({
      label: r.replace(/^[*-]\s*/, "").trim(),
      ratt: r.startsWith("*"),
    }));

    if (rader.slice(1).some((r) => !/^[*-]/.test(r))) {
      return { fragor: [], fel: `Fråga ${i + 1}: varje svarsalternativ måste börja med * eller -.` };
    }
    if (alternativ.length < 2) {
      return { fragor: [], fel: `Fråga ${i + 1} behöver minst två svarsalternativ.` };
    }
    if (!alternativ.some((a) => a.ratt)) {
      return { fragor: [], fel: `Fråga ${i + 1} saknar rätt svar. Markera det med *.` };
    }
    if (alternativ.some((a) => !a.label)) {
      return { fragor: [], fel: `Fråga ${i + 1} har ett tomt svarsalternativ.` };
    }

    fragor.push({ prompt, alternativ });
  }

  return { fragor, fel: null };
}

/** Baklanges, for redigeringsvyn. Ratt svar visas bara for den som far redigera. */
export function skrivFragor(fragor: Fraga[]): string {
  return fragor
    .map((f) => [f.prompt, ...f.alternativ.map((a) => `${a.ratt ? "*" : "-"} ${a.label}`)].join("\n"))
    .join("\n\n");
}
