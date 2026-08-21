/**
 * E8.7 / AC-6.7: rollspelscertifiering.
 *
 * Ren logik, inga importer. Rubriken skrivs som text i redigeringsvyn, precis
 * som quizfragorna (`tolkaFragor` i utbildning.ts) — ett formular med rader
 * som gar att lagga till och ta bort hade varit tre ganger sa mycket kod for
 * en sak som skrivs en gang per kurs.
 *
 * Format, ett kriterium per rad:
 *
 *   Behovsanalys | 5 | Staller minst tre oppna fragor innan losning namns
 *   Invandningar | 3 | Bemoter utan att avbryta
 *
 * Poangtaket ar valfritt och blir 5 om det utelamnas. Vagledningen ar ocksa
 * valfri — men den ar det som gor rubriken till en rubrik i stallet for en
 * lista med ord, och den syns for den som ska bedomas.
 */

export type Kriterium = { label: string; guidance: string | null; max_points: number };

export const STANDARDPOANG = 5;
export const MAX_POANG = 10;

export function tolkaKriterier(text: string): { kriterier: Kriterium[]; fel: string | null } {
  const rader = text
    .split("\n")
    .map((r) => r.trim())
    .filter(Boolean);

  if (rader.length === 0) return { kriterier: [], fel: null };

  const kriterier: Kriterium[] = [];

  for (const [i, rad] of rader.entries()) {
    const delar = rad.split("|").map((d) => d.trim());
    const label = delar[0];

    if (!label) return { kriterier: [], fel: `Rad ${i + 1} saknar rubrik.` };

    let max = STANDARDPOANG;
    if (delar[1]) {
      const tal = Number(delar[1]);
      if (!Number.isInteger(tal) || tal < 1 || tal > MAX_POANG) {
        return {
          kriterier: [],
          fel: `Rad ${i + 1}: poängtaket ska vara ett heltal mellan 1 och ${MAX_POANG}.`,
        };
      }
      max = tal;
    }

    kriterier.push({ label, guidance: delar[2] || null, max_points: max });
  }

  if (kriterier.length > 20) return { kriterier: [], fel: "Högst 20 kriterier." };

  return { kriterier, fel: null };
}

/** Baklanges, for redigeringsvyn. */
export function skrivKriterier(kriterier: Kriterium[]): string {
  return kriterier
    .map((k) => [k.label, String(k.max_points), k.guidance ?? ""].join(" | ").replace(/\s*\|\s*$/, ""))
    .join("\n");
}

/**
 * Poang -> procent.
 *
 * Procent och inte rapoang, eftersom `course_attempt.score` ar 0-100 for bade
 * quiz och rollspel (0007) och `course.pass_threshold` ar en procentsats.
 * Rubriker med olika manga kriterier ska kunna jamforas mot samma grans.
 *
 * En rubrik utan kriterier ger noll och inte hundra. Det ar ratt hall att fela
 * at: ett rollspel som blir godkant for att ingen skrivit rubriken ar varre an
 * ett som inte gar att bedoma.
 */
export function procent(
  kriterier: { id: string; max_points: number }[],
  poang: Record<string, number>,
): number {
  const tak = kriterier.reduce((s, k) => s + k.max_points, 0);
  if (tak === 0) return 0;

  const summa = kriterier.reduce((s, k) => {
    const p = poang[k.id] ?? 0;
    return s + Math.min(Math.max(p, 0), k.max_points);
  }, 0);

  return Math.round((summa / tak) * 100);
}

export type Rollspelslage = "ej_inlamnat" | "vantar" | "godkant" | "underkant";

export const LAGE_ETIKETT: Record<Rollspelslage, string> = {
  ej_inlamnat: "Inte inlämnat",
  vantar: "Väntar på bedömning",
  godkant: "Godkänt",
  underkant: "Underkänt",
};

export const LAGE_TON: Record<Rollspelslage, "ok" | "warn" | "danger" | "neutral"> = {
  ej_inlamnat: "neutral",
  vantar: "warn",
  godkant: "ok",
  underkant: "danger",
};

/**
 * Laget for den senaste inlamningen.
 *
 * Ett underkant rollspel skrivs aldrig over — varje inlamning ar en egen rad,
 * som `course_attempt` ar en logg och inte ett tillstand (0007). Laget raknas
 * darfor fram ur den senaste, inte ur ett falt nagon uppdaterar.
 */
export function lageFor(
  inlamningar: { submitted_at: string; graded_at: string | null; passed: boolean | null }[],
): Rollspelslage {
  if (inlamningar.length === 0) return "ej_inlamnat";

  const senast = [...inlamningar].sort((a, b) => (a.submitted_at < b.submitted_at ? 1 : -1))[0];
  if (!senast.graded_at) return "vantar";
  return senast.passed ? "godkant" : "underkant";
}
