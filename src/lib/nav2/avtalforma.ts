/**
 * Nav 2.0, Avtal: navets avtal i den form utkastet ritar.
 *
 * Ren logik, inga importer. Filen körs både av servern och av provet lokalt.
 *
 * ===========================================================================
 * INGENTING I AVTALET HITTAS PÅ.
 *
 * Utkastets "Mitt avtal" har elva paragrafer med fast text (Göteborg, 25
 * dagar, 40 timmar, en månads uppsägning). I riktigt läge kommer paragraferna
 * ur avtalets egen text (`body_md`, ett mallavtal), och kortens siffror ur de
 * värden avtalet skapades med (`variables`). Ett uppladdat avtal (0073) har
 * ingen text i navet, bara filen: då är paragraferna tomma och villkoren
 * saknas, och utkastet säger att de står i filen.
 * ===========================================================================
 */

export type NdParagraf = {
  /** Utkastets nyckel när rubriken känns igen (lon, semester, …), annars p<n>. */
  id: string;
  rubrik: string;
  text: string;
};

export type NdAvtalLage = "utkast" | "utfardat" | "signerat" | "tillbaka";

export type NdAvtalet = {
  id: string;
  personId: string;
  titel: string;
  kalla: "mall" | "fil";
  mallSlug: string | null;
  lage: NdAvtalLage;
  skapad: string;
  utfardad: string | null;
  tillbaka: { d: string; skal: string } | null;
  fil: { id: string; namn: string; storlek: number; typ: string } | null;
  /** Mallavtalets text. Null för ett uppladdat. */
  text: string | null;
  paragrafer: NdParagraf[];
  /** Ur `variables`: befattning, manadslon, arbetstid, arbetsort, semesterdagar, uppsagningstid, provanstallning. */
  villkor: Record<string, string>;
  /** Dagarna det påmints om påskriften (notisen `avtal-paminnelse`), äldst först. */
  pamint: string[];
};

export type NdAvtalMall = { id: string; titel: string; slug: string; status: string; andrad: string; form: string | null };

export type NdAvtal = {
  /** Säljchef, VD och admin (`far_hantera_avtal()` i 0028). */
  hanterar: boolean;
  /** Det RLS släppte fram: alla för den som hanterar, annars egna utfärdade. */
  avtal: NdAvtalet[];
  /** Null för den som inte får läsa mallar. */
  mallar: NdAvtalMall[] | null;
  /**
   * Den inloggades egen månadslön ur `salary_basis`, den som gäller i dag.
   * Beställaren 2026-10-19: den anställda ser sin egen lön under Mitt avtal.
   */
  minLon: { belopp: number; fran: string } | null;
  /** SKRIVLAGE.avtal. */
  skriv: boolean;
};

export type RaAvtal = {
  id: string;
  employee_id: string;
  title: string;
  template_slug: string | null;
  source: string;
  body_md: string | null;
  variables: Record<string, unknown> | null;
  status: string;
  created_at: string;
  issued_at: string | null;
  withdrawn_at: string | null;
  withdrawn_reason: string | null;
};

const VILLKOR = ["befattning", "manadslon", "arbetstid", "arbetsort", "semesterdagar", "uppsagningstid", "provanstallning"];

/** Rubriken i avtalet → utkastets paragrafnyckel. Den första som passar vinner. */
const NYCKLAR: [string, RegExp][] = [
  ["parter", /^parter/i],
  ["befattning", /befattning|arbetsuppgift|tjänst\b/i],
  ["form", /anställningsform|provanställ|anställningens (form|längd)|anställningstid/i],
  ["tid", /arbetstid/i],
  ["provision", /provision/i],
  ["lon", /lön|ersättning/i],
  ["semester", /semester/i],
  ["sjuk", /sjuk/i],
  ["uppsagning", /uppsägning/i],
  ["sekretess", /sekretess|tystnad|personuppgift/i],
  ["ort", /arbetsort|arbetsplats|placering/i],
];

const RUBRIK = /^(?:#{1,4}\s+|\*\*)?\s*(?:§\s*(\d+)[.:]?\s*)?(.+?)\s*(?:\*\*)?$/;

/** Dagen i svensk tid, ur en tidsstämpel. */
export function dag(ts: string | null): string | null {
  if (!ts) return null;
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
}

/**
 * Avtalets text i paragrafer. En rubrik är en markdownrubrik (`## Lön`) eller
 * en rad som börjar med `§` (`§ 5 Lön`, `**§ 5 Lön**`). Den första rubriken på
 * nivå ett är avtalets titel och blir ingen paragraf. Text före första rubriken
 * hamnar i en paragraf utan rubrik, så att ingenting av texten tappas.
 */
export function paragrafer(md: string | null): NdParagraf[] {
  if (!md) return [];
  const ut: NdParagraf[] = [];
  let aktuell: NdParagraf | null = null;
  let forstaRubrik = true;
  const anvanda = new Set<string>();
  const nyckel = (rubrik: string): string => {
    for (const [id, re] of NYCKLAR) if (re.test(rubrik) && !anvanda.has(id)) return id;
    return `p${ut.length + 1}`;
  };
  for (const rad of md.replace(/\r/g, "").split("\n")) {
    const t = rad.trim();
    const arRubrik = /^#{1,4}\s+\S/.test(t) || /^(\*\*)?§\s*\d+/.test(t);
    if (arRubrik) {
      if (forstaRubrik && /^#\s/.test(t)) {
        forstaRubrik = false;
        continue;
      }
      forstaRubrik = false;
      const m = t.match(RUBRIK);
      const rubrik = (m?.[2] ?? t).replace(/^#+\s*/, "").replace(/\*\*/g, "").trim();
      const id = nyckel(rubrik);
      anvanda.add(id);
      aktuell = { id, rubrik, text: "" };
      ut.push(aktuell);
      continue;
    }
    if (!t && !aktuell) continue;
    if (!aktuell) {
      aktuell = { id: "inledning", rubrik: "", text: "" };
      ut.push(aktuell);
    }
    aktuell.text += (aktuell.text ? "\n" : "") + rad;
  }
  return ut.map((p) => ({ ...p, text: p.text.replace(/\n{3,}/g, "\n\n").trim() })).filter((p) => p.rubrik || p.text);
}

export function villkor(v: Record<string, unknown> | null): Record<string, string> {
  const ut: Record<string, string> = {};
  for (const k of VILLKOR) {
    const x = v?.[k];
    if (typeof x === "string" && x.trim() && x.trim() !== "-" && x.trim() !== "–") ut[k] = x.trim();
  }
  return ut;
}

/**
 * Utkastets läge. Ett uppladdat avtal är påskrivet när det laddas upp (0073:
 * "redan påskrivet på papper"). Ett utfärdat mallavtal väntar på påskrift, och
 * den påskrivna PDF:en laddas upp som ett eget avtal för personen.
 */
export function lage(r: Pick<RaAvtal, "status" | "source">): NdAvtalLage {
  if (r.status === "withdrawn") return "tillbaka";
  if (r.status === "draft") return "utkast";
  return r.source === "upload" ? "signerat" : "utfardat";
}

type AvtalVantar = Pick<RaAvtal, "employee_id" | "source" | "status" | "issued_at">;

/**
 * Väntar ett utfärdat mallavtal fortfarande på påskrift? Nej så snart personen
 * har ett uppladdat avtal (0073: påskrivet när det laddas upp) som gäller och
 * kom in samma stund som mallavtalet eller senare. Granskningen F1-3 och
 * beslut B3 (beställaren 2026-10-22): "Påskrivet digitalt" öppnar
 * uppladdningen av det påskrivna avtalet, som blir ett eget avtal. Ett
 * uppladdat avtal från före mallavtalet är ett äldre avtal och säger inget om
 * det nya. Påminnelsen (`paminn`) frågar den här.
 */
export function vantarPaPaskrift(mall: AvtalVantar, personensAvtal: AvtalVantar[]): boolean {
  if (mall.status !== "issued" || mall.source !== "template" || !mall.issued_at) return false;
  const fran = Date.parse(mall.issued_at);
  return !personensAvtal.some(
    (a) =>
      a.employee_id === mall.employee_id &&
      a.source === "upload" &&
      a.status === "issued" &&
      !!a.issued_at &&
      Date.parse(a.issued_at) >= fran,
  );
}

export function formaAvtal(
  r: RaAvtal,
  fil: NdAvtalet["fil"],
  pamint: string[],
): NdAvtalet {
  return {
    id: r.id,
    personId: r.employee_id,
    titel: r.title,
    kalla: r.source === "upload" ? "fil" : "mall",
    mallSlug: r.template_slug,
    lage: lage(r),
    skapad: dag(r.created_at)!,
    utfardad: dag(r.issued_at),
    tillbaka: r.status === "withdrawn" ? { d: dag(r.withdrawn_at) ?? dag(r.created_at)!, skal: r.withdrawn_reason ?? "" } : null,
    fil,
    text: r.source === "upload" ? null : r.body_md,
    paragrafer: r.source === "upload" ? [] : paragrafer(r.body_md),
    villkor: villkor(r.variables),
    pamint,
  };
}
