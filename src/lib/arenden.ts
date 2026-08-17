/**
 * M4 Personalärenden. Ren logik — inga importer, av samma skäl som
 * avvikelsemotorn: den ska gå att prova utan att starta något annat.
 *
 * AC-4.6: anonyma ärenden är förberedda i datamodellen men avstängda här.
 * Visselblåsarlagen träder in vid 50 anställda. En anonym kanal som byggs i
 * efterhand går alltid att spåra bakåt i loggarna — och då är den inte anonym.
 */

export const ANONYMA_ARENDEN = false;

export type Kategori =
  | "pay"
  | "equipment"
  | "schedule"
  | "work_env"
  | "conflict"
  | "development"
  | "other";

export type Status = "new" | "in_progress" | "waiting" | "resolved";

export const STATUS_ETIKETT: Record<Status, string> = {
  new: "Ny",
  in_progress: "Pågår",
  waiting: "Väntar på svar",
  resolved: "Löst",
};

/** AC-4.2: färgad kant i inkorgen. Grön betyder inte "bra", bara "i tid". */
export type SlaLage = "i_tid" | "snart" | "over" | "klart";

export const SLA_ETIKETT: Record<SlaLage, string> = {
  i_tid: "I tid",
  snart: "Snart förfallen",
  over: "Över tiden",
  klart: "Avslutad",
};

/**
 * Var ärendet står mot sin frist.
 *
 * "Snart" börjar på den sista fjärdedelen av fristen i stället för ett fast
 * antal timmar: ett dygnsärende och ett veckoärende har inte samma sista
 * chans, och en varning som kommer för sent är ingen varning.
 */
export function slaLage(
  arende: { due_at: string; resolved_at: string | null; sla_hours: number },
  nu: Date = new Date(),
): SlaLage {
  if (arende.resolved_at) return "klart";

  const kvar = Date.parse(arende.due_at) - nu.getTime();
  if (kvar <= 0) return "over";

  const varning = (arende.sla_hours * 3600_000) / 4;
  return kvar <= varning ? "snart" : "i_tid";
}

/** Fristen räknas från upplägget och fryses där (AC-4.2). */
export function frist(skapad: Date, slaTimmar: number): string {
  return new Date(skapad.getTime() + slaTimmar * 3600_000).toISOString();
}

export function timmarKvar(due_at: string, nu: Date = new Date()): number {
  return Math.round((Date.parse(due_at) - nu.getTime()) / 3600_000);
}

// -----------------------------------------------------------------------------
// AC-4.5 Statistik
// -----------------------------------------------------------------------------

/**
 * Median, inte medelvärde. Ett enda ärende som låg öppet över semestern drar
 * upp ett medelvärde så att det inte längre beskriver någonting.
 */
export function median(tal: number[]): number | null {
  if (tal.length === 0) return null;
  const sorterat = [...tal].sort((a, b) => a - b);
  const mitt = Math.floor(sorterat.length / 2);
  return sorterat.length % 2 === 1
    ? sorterat[mitt]
    : Math.round((sorterat[mitt - 1] + sorterat[mitt]) / 2);
}

export type Statistikrad = {
  nyckel: string;
  antal: number;
  medianTimmar: number | null;
  overTiden: number;
};

export type Arende = {
  category: string;
  team_id: string | null;
  created_at: string;
  due_at: string;
  resolved_at: string | null;
};

function timmarTillLosning(a: Arende): number | null {
  if (!a.resolved_at) return null;
  return Math.round((Date.parse(a.resolved_at) - Date.parse(a.created_at)) / 3600_000);
}

/** Grupperar på valfri nyckel: kategori, team eller månad (AC-4.5). */
export function statistik(
  arenden: Arende[],
  nyckelAv: (a: Arende) => string,
): Statistikrad[] {
  const grupper = new Map<string, Arende[]>();
  for (const a of arenden) {
    const k = nyckelAv(a);
    grupper.set(k, [...(grupper.get(k) ?? []), a]);
  }

  return [...grupper.entries()]
    .map(([nyckel, rader]) => ({
      nyckel,
      antal: rader.length,
      medianTimmar: median(
        rader.map(timmarTillLosning).filter((t): t is number => t !== null),
      ),
      // Ett löst ärende kan ha passerat fristen innan det löstes. Det räknas.
      overTiden: rader.filter((r) =>
        r.resolved_at
          ? Date.parse(r.resolved_at) > Date.parse(r.due_at)
          : Date.now() > Date.parse(r.due_at),
      ).length,
    }))
    .sort((a, b) => b.antal - a.antal);
}

export function manaden(iso: string): string {
  return iso.slice(0, 7);
}

/**
 * AC-4.7: tre liknande frågor är en rutin som saknas.
 *
 * "Liknande" avgörs av kategorin och inte av textlikhet. En stavfelstolerant
 * jämförelse hade gett förslag som ingen förstår grunden för, och ett förslag
 * som inte går att förstå följs inte.
 */
export const FORSLAGSGRANS = 3;

export function forslagOmRutin(
  arenden: { category: string; created_at: string }[],
  dagar = 90,
  nu: Date = new Date(),
): { kategori: string; antal: number }[] {
  const grans = nu.getTime() - dagar * 24 * 3600_000;
  const antal = new Map<string, number>();

  for (const a of arenden) {
    if (Date.parse(a.created_at) < grans) continue;
    antal.set(a.category, (antal.get(a.category) ?? 0) + 1);
  }

  return [...antal.entries()]
    .filter(([, n]) => n >= FORSLAGSGRANS)
    .map(([kategori, n]) => ({ kategori, antal: n }))
    .sort((a, b) => b.antal - a.antal);
}
