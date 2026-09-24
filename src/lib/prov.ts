/**
 * Det skriftliga provet (0067). Ren logik, inga importer utover systerfilen
 * `rollspel.ts` — samma skal som star overst i `utbildning.ts`: en modul med
 * "use server" exponerar varje export som en anropbar slutpunkt, och det har
 * ska ga att prova med `node tests/prov.mjs`.
 *
 * ===========================================================================
 * VAD SOM SKILJER DET HAR PROVET FRAN QUIZET
 *
 * Quizet (0007) har ett facit i databasen och rattas av servern i samma
 * sekund. Har finns inget facit alls: svaren ar fritext och EN MANNISKA satter
 * poangen. Det ar hela poangen med formen — fragorna nedan har inga fyra
 * alternativ dar ett ar ratt, de har svar som ar mer eller mindre genomtankta.
 *
 * Foljden ar att provet har ett TILLSTAND som quizet saknar. Ett quiz ar
 * antingen gjort eller inte; det har provet kan vara pabörjat, inlamnat,
 * tillbakaskickat for komplettering eller rattat, och alla fyra lagena betyder
 * olika saker for bade den som skrivit och den som ska ratta.
 * ===========================================================================
 */

import { procent } from "./rollspel.ts";

/**
 * Poangskalan per fraga: 0 fel, 1 delvis, 2 ratt.
 *
 * TVA POANG OCH INTE GODKANT/UNDERKANT, for att ett fritextsvar sallan ar
 * antingen eller. Den som svarar "att man har en ordning pa samtalet" har inte
 * fel — hon har halva svaret, och en skala som tvingar rattaren att kalla det
 * antingen ratt eller fel gor betyget till en slump beroende pa vem som rattar.
 *
 * Taket ar per fraga och gar att hoja i redaktoren: en fraga som ber om fyra
 * saker kan rimligen vara vard mer an en som ber om en. `MAX_PROVPOANG` ar
 * samma tak som rollspelets kriterier har, och av samma skal — en skala over
 * tio steg ar en skala ingen anvander hela.
 */
export const PROVPOANG_STANDARD = 2;
export const MAX_PROVPOANG = 10;

/** Fler an sa gar inte att ratta i ett svep, och ingen skriver dem heller. */
export const MAX_PROVFRAGOR = 40;

/**
 * Kortaste svar som raknas som ett svar.
 *
 * Inte ett kvalitetskrav — det ar rattarens sak — utan en sparr mot att lamna
 * in tjugo punkter. Den som skriver "ja" har inte svarat pa "Vad ar en
 * saljstruktur?", och ett prov med tomma rutor kostar en rattningsrunda att
 * upptacka.
 */
export const MINSTA_SVAR = 10;

export type Provfraga = {
  prompt: string;
  /**
   * Rattarstod. SYNS BARA FOR DEN SOM RATTAR, aldrig for den som skriver.
   *
   * Det ar skillnaden mot rollspelets `guidance`, som visas FORE inspelningen
   * med flit (AC-6.7). En rubrik talar om vad som bedoms; det har talar om vad
   * svaret ska innehalla, och det ar facit. Darfor ar `essay_question` stangd
   * for varje klientroll i 0067, precis som `quiz_option` ar det.
   */
  guidance: string | null;
  max_points: number;
};

/**
 * Fragorna skrivs som text i redaktoren, en per rad:
 *
 *   Vad ar en saljstruktur? | 2 | Namner ordningen OCH att varje del har ett syfte
 *   Vad vill du uppna med introt?
 *
 * Samma format som rollspelets rubrik (`tolkaKriterier`), och det ar inte en
 * slump: den som skriver en kurs ska inte behova lara sig tva format. Poangen
 * och rattarstodet ar valfria.
 */
export function tolkaProvfragor(text: string): { fragor: Provfraga[]; fel: string | null } {
  const rader = text
    .split("\n")
    .map((r) => r.trim())
    .filter(Boolean);

  if (rader.length === 0) return { fragor: [], fel: null };

  const fragor: Provfraga[] = [];

  for (const [i, rad] of rader.entries()) {
    const delar = rad.split("|").map((d) => d.trim());
    const prompt = delar[0];

    if (!prompt) return { fragor: [], fel: `Rad ${i + 1} saknar fråga.` };

    let max = PROVPOANG_STANDARD;
    if (delar[1]) {
      const tal = Number(delar[1]);
      if (!Number.isInteger(tal) || tal < 1 || tal > MAX_PROVPOANG) {
        return {
          fragor: [],
          fel: `Rad ${i + 1}: poängtaket ska vara ett heltal mellan 1 och ${MAX_PROVPOANG}.`,
        };
      }
      max = tal;
    }

    fragor.push({ prompt, guidance: delar[2] || null, max_points: max });
  }

  if (fragor.length > MAX_PROVFRAGOR) {
    return { fragor: [], fel: `Högst ${MAX_PROVFRAGOR} frågor i ett prov.` };
  }

  return { fragor, fel: null };
}

/** Baklanges, for redigeringsvyn. */
export function skrivProvfragor(fragor: Provfraga[]): string {
  return fragor
    .map((f) =>
      [f.prompt, String(f.max_points), f.guidance ?? ""].join(" | ").replace(/\s*\|\s*$/, ""),
    )
    .join("\n");
}

/**
 * Poang -> procent.
 *
 * SAMMA FUNKTION SOM ROLLSPELET, importerad och inte kopierad. Fragan ar
 * ordagrant densamma — delpoang mot ett tak, jamfort med `pass_threshold` som
 * ar en procentsats (0007) — och tva kopior av samma raknesatt ar tva stallen
 * att avrunda olika pa.
 */
export const provprocent = procent;

export type Provlage = "ej_paborjat" | "utkast" | "inlamnad" | "retur" | "godkant" | "underkant";

export const PROVLAGE_ETIKETT: Record<Provlage, string> = {
  ej_paborjat: "Inte påbörjat",
  utkast: "Påbörjat",
  inlamnad: "Väntar på rättning",
  retur: "Komplettera",
  godkant: "Godkänt",
  underkant: "Underkänt",
};

export const PROVLAGE_TON: Record<Provlage, "ok" | "warn" | "danger" | "neutral" | "brand"> = {
  ej_paborjat: "neutral",
  utkast: "brand",
  inlamnad: "warn",
  retur: "danger",
  godkant: "ok",
  underkant: "danger",
};

/** Statusarna som star i `essay_submission.status` (0067). */
export const PROVSTATUS = ["utkast", "inlamnad", "retur", "rattad"] as const;
export type Provstatus = (typeof PROVSTATUS)[number];

export type Inlamning = {
  status: string;
  passed: boolean | null;
  created_at: string;
};

/**
 * Laget for den senaste inlamningen.
 *
 * RAKNAS FRAM UR RADERNA och lagras ingenstans, precis som `lageFor()` gor for
 * rollspelet. Ett underkant prov skrivs aldrig over — ett nytt forsok ar en ny
 * rad — sa "vad galler nu" ar alltid en fraga om den senaste, och aldrig om ett
 * falt nagon kom ihag att uppdatera.
 */
export function provlage(inlamningar: Inlamning[]): Provlage {
  if (inlamningar.length === 0) return "ej_paborjat";

  const senast = [...inlamningar].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];

  if (senast.status === "utkast") return "utkast";
  if (senast.status === "inlamnad") return "inlamnad";
  if (senast.status === "retur") return "retur";
  return senast.passed ? "godkant" : "underkant";
}

/** Lagen dar den som skriver far andra i sina svar. */
export function farSkriva(lage: Provlage): boolean {
  return lage === "ej_paborjat" || lage === "utkast" || lage === "retur";
}

/**
 * Vilka fragor som annu inte har ett svar vart namnet.
 *
 * Ger tillbaka ORDNINGSNUMREN och inte id:na, eftersom det ar numret som star i
 * vyn — "fråga 4, 9 och 17 saknar svar" gar att handla pa, en lista uuid:n gor
 * det inte.
 */
export function saknadeSvar(
  fragor: { id: string; sort: number }[],
  svar: Record<string, string>,
): number[] {
  return fragor
    .filter((f) => (svar[f.id] ?? "").trim().length < MINSTA_SVAR)
    .map((f) => f.sort)
    .sort((a, b) => a - b);
}

/** Ordraknare for skrivvyn. Rakna tecken sager inget; ord gor det. */
export function ordrakning(text: string): number {
  const rensat = text.trim();
  if (!rensat) return 0;
  return rensat.split(/\s+/).length;
}

/**
 * Sammanfattningen under rattningen: hur langt rattaren kommit.
 *
 * Talen kommer ur poangen som SATTS, inte ur ett raknat klick — samma skal som
 * `stegantal()` i genomgangen: ett tal klienten skickar in ar en klickraknare
 * som ser ut som en matning.
 */
export function rattningslage(
  fragor: { id: string; max_points: number }[],
  poang: Record<string, number | null>,
): { satta: number; antal: number; summa: number; tak: number; klar: boolean } {
  const tak = fragor.reduce((s, f) => s + f.max_points, 0);
  const satta = fragor.filter((f) => typeof poang[f.id] === "number").length;
  const summa = fragor.reduce((s, f) => s + (poang[f.id] ?? 0), 0);
  return { satta, antal: fragor.length, summa, tak, klar: satta === fragor.length };
}
