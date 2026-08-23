/**
 * E10 M7: rekrytering. Ren logik, inga importer.
 *
 * Den tillatna ordningen mellan stegen finns pa TVA stallen med flit: har, sa
 * att granssnittet vet vilka knappar det ska rita, och i triggern
 * `candidate_stegbyte` i 0030, som ar den som faktiskt avgor. Glider de isar ar
 * det databasen som vinner — och da ritas en knapp som ger ett felmeddelande i
 * stallet for att slappa igenom nagot.
 *
 * `tests/rekrytering.mjs` provar att listan har stammer med triggern.
 */

export const STEG = [
  "new",
  "screening",
  "interview_1",
  "interview_2",
  "offer",
  "hired",
  "rejected",
] as const;

export type Steg = (typeof STEG)[number];

/** Stegen i tratten, i ordning. Avslag star utanfor — det ar inget steg framat. */
export const TRATTSTEG: Steg[] = ["new", "screening", "interview_1", "interview_2", "offer", "hired"];

export const STEG_ETIKETT: Record<Steg, string> = {
  new: "Ny",
  screening: "Screening",
  interview_1: "Intervju 1",
  interview_2: "Intervju 2",
  offer: "Erbjudande",
  hired: "Anställd",
  rejected: "Avslag",
};

/** Stegen dar en scorecard gar att fylla i (AC-7.6). */
export const BEDOMDA_STEG: Steg[] = ["screening", "interview_1", "interview_2"];

/**
 * Vart en kandidat kan flyttas harifran.
 *
 * Speglar `candidate_stegbyte` i 0030. Tva regler ar varda att lasa ut:
 *
 *   - Avslag gar fran varje oppet steg. Sa fungerar rekrytering.
 *   - `hired` gar BARA fran `offer`. Kunde man ga direkt fran screening vore
 *     scorecardvillkoret i AC-7.6 verkningslost.
 *
 * Tillbaka gar det aldrig. En kandidat som tas upp igen efter avslag ar en ny
 * ansokan och ska synas som en i tratten.
 */
export function nastaSteg(fran: Steg): Steg[] {
  switch (fran) {
    case "new":
      return ["screening", "rejected"];
    case "screening":
      return ["interview_1", "rejected"];
    case "interview_1":
      return ["interview_2", "offer", "rejected"];
    case "interview_2":
      return ["offer", "rejected"];
    case "offer":
      return ["hired", "rejected"];
    default:
      return [];
  }
}

/** En process som fortfarande pagar. */
export function arOppen(steg: Steg): boolean {
  return steg !== "hired" && steg !== "rejected";
}

export type Kandidat = {
  id: string;
  stage: Steg;
  source_slug: string;
  applied_at: string;
  closed_at: string | null;
};

export type Trattrad = {
  kalla: string;
  /** Hur manga som NAGON GANG passerat steget, inte hur manga som star dar nu. */
  per_steg: Record<Steg, number>;
  totalt: number;
  anstallda: number;
  avslag: number;
  kvar_90: number;
  kvar_180: number;
};

/**
 * AC-7.10: tratten per kalla.
 *
 * Det viktiga och lattaste att gora fel: ett steg raknar alla som KOMMIT SA
 * LANGT, inte alla som star dar just nu. En kandidat som ar anstalld har
 * passerat erbjudandet, och en tratt dar `offer` visar noll for att alla gick
 * vidare sager ingenting om hur manga erbjudanden som lamnades.
 *
 * Avslag raknas separat och aldrig som ett trattsteg — annars hade summan av
 * stegen blivit storre an antalet kandidater.
 */
export function tratt(kandidater: Kandidat[], nu: Date = new Date()): Trattrad[] {
  const per = new Map<string, Trattrad>();

  for (const k of kandidater) {
    let rad = per.get(k.source_slug);
    if (!rad) {
      rad = {
        kalla: k.source_slug,
        per_steg: Object.fromEntries(STEG.map((s) => [s, 0])) as Record<Steg, number>,
        totalt: 0,
        anstallda: 0,
        avslag: 0,
        kvar_90: 0,
        kvar_180: 0,
      };
      per.set(k.source_slug, rad);
    }

    rad.totalt += 1;
    if (k.stage === "hired") rad.anstallda += 1;
    if (k.stage === "rejected") rad.avslag += 1;

    // Ett avslag sager inte hur langt kandidaten kom — den uppgiften ligger i
    // stegloggen, inte pa raden. Har raknas den bara som ett avslag.
    if (k.stage !== "rejected") {
      const natt = TRATTSTEG.indexOf(k.stage);
      for (let i = 0; i <= natt; i++) rad.per_steg[TRATTSTEG[i]] += 1;
    }

    const dagar = dagarSedan(k.applied_at, nu);
    if (dagar !== null && dagar >= 90 && arOppen(k.stage)) rad.kvar_90 += 1;
    if (dagar !== null && dagar >= 180 && arOppen(k.stage)) rad.kvar_180 += 1;
  }

  return [...per.values()].sort((a, b) => b.totalt - a.totalt || a.kalla.localeCompare(b.kalla, "sv"));
}

/** Hela dagar sedan en tidpunkt. Null nar datumet saknas eller ar skrap. */
export function dagarSedan(datum: string | null, nu: Date = new Date()): number | null {
  if (!datum) return null;
  const t = new Date(datum);
  if (Number.isNaN(t.getTime())) return null;
  return Math.floor((nu.getTime() - t.getTime()) / 86_400_000);
}

/**
 * Hur lange en kandidat legat pa sitt nuvarande steg.
 *
 * En kandidat som stat i screening i sex veckor ar inte i en process — hen ar
 * glomd. Det ar den enda siffran i modulen som pekar pa NAGOT ATT GORA i dag.
 */
export function liggetid(stage_at: string, nu: Date = new Date()): number | null {
  return dagarSedan(stage_at, nu);
}
