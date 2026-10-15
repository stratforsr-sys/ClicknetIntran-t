/**
 * Nav 2.0: Fel i den form utkastet ritar. Ren logik, inga importer utom typer.
 *
 * Raderna är `error_report` som /fel läser dem, med det 0082 lade till för det
 * utkastet har och navet saknade: vad personen pekade på, vem som tar felet,
 * svaren i tråden, "fungerar det nu?", de som har samma fel, kända fel med
 * råd för alla, och träffar per dag. Rubriken för en automatisk
 * rapport utan meddelande är repots `rubrikFor` (felkoden, inte ett påhittat
 * meddelande). Nattjobbets steg läses ur kvittots `meta.resultat` och
 * `meta.fel`, med de namn stegen har i `/api/jobb/natt`. Filen är ren så att
 * samma kod körs i Next och i provet lokalt mot riktig data.
 */

import type { Driftlage } from "../jobb/larm.ts";

export type NdFelrad = {
  id: string;
  kind: "automatic" | "manual";
  digest: string | null;
  path: string;
  /** Repots rubrikFor för en automatisk rad, aldrig null. */
  rubrik: string;
  message: string | null;
  /** Bara för den som hanterar kön (samma krets som ser meddelandet på /fel). */
  stack: string | null;
  body: string | null;
  blocking: boolean;
  ant: number;
  forst: string;
  senast: string;
  status: "new" | "ack" | "closed";
  vemId: string | null;
  handId: string | null;
  handAt: string | null;
  losning: string | null;
  release: string | null;
  ua: string | null;
  /** 0082: vad personen pekade på, i ord. */
  pek: string | null;
  /** 0082: den som tagit felet ("Jag tar den"). */
  tarId: string | null;
  /** 0082: "Fungerar det nu?" — null tills den som rapporterade svarat. */
  bekraftad: { at: string; ok: boolean } | null;
  /** 0082: rubriken och rådet för alla, när kön gjort felet till ett känt fel. */
  titel: string | null;
  kant: string | null;
  /** 0082: svaren i tråden. */
  svar: { avId: string | null; at: string; text: string }[];
  /** 0082: om läsaren själv sagt att den har samma fel, och hur många som sagt det (null = får inte se). */
  foljer: boolean;
  foljare: number | null;
  /** 0082: träffar per dag de senaste sex dagarna och antal personer. Null = förekomsterna loggas inte än. */
  dagar: number[] | null;
  pers: number | null;
};

export type NdKantFel = { id: string; kind: string; status: string; path: string; titel: string; kant: string; drabbade: number; foljer: boolean };

export type NdFelstat = {
  sedan: string;
  lagade: number;
  automatiska: number;
  mina: number;
  medianDagar: number | null;
  medianDagarStoppande: number | null;
  lagade30: number;
};

export type NdFelsteg = { namn: string; l: string; ok: boolean; text: string };

export type NdDrift = {
  lage: Driftlage;
  timmar: number | null;
  ts: string | null;
  helt: boolean;
  sekunder: number | null;
  steg: NdFelsteg[];
};

export type NdFel = {
  /** sales_manager, ceo och admin: kön och driftkortet, som på /fel. */
  hanterar: boolean;
  /** För- och efternamn för de personer som står på läsarens rader (se fel.ts). */
  namn: Record<string, string>;
  /** Den här utgåvans commit, som `utgava()` i fel-server.ts. */
  release: string | null;
  rader: NdFelrad[];
  /** 0082 `kanda_fel()`: öppna fel med rubrik och råd som alla får se. */
  kanda: NdKantFel[];
  /** 0082 `fel_statistik()`: antal och mediantider, för alla. */
  stat: NdFelstat | null;
  drift: NdDrift | null;
  /** Sparar vyn (SKRIVLAGE.fel)? Annars svarar /nav2/fel med läsläge. */
  skriv: boolean;
};

export type RaFelrad = {
  id: string;
  kind: string;
  digest: string | null;
  path: string;
  message: string | null;
  stack?: string | null;
  body: string | null;
  blocking: boolean;
  occurrences: number;
  first_seen_at: string;
  last_seen_at: string;
  status: string;
  reporter_id: string | null;
  handled_by: string | null;
  handled_at: string | null;
  release: string | null;
  resolution: string | null;
  user_agent?: string | null;
  pointed_at?: string | null;
  assigned_to?: string | null;
  confirmed_at?: string | null;
  confirmed_ok?: boolean | null;
  public_title?: string | null;
  workaround?: string | null;
};

export type RaFelExtra = {
  meddelanden: { error_id: string; author_id: string | null; body: string; created_at: string }[];
  foljare: { error_id: string; employee_id: string }[];
  /** Null när förekomsterna inte loggas än (ingen rad alls) eller läsaren inte får se dem. */
  forekomster: { error_id: string; employee_id: string | null; seen_at: string }[] | null;
  mig: string;
  /** Dagens datum i svensk tid, YYYY-MM-DD. */
  idag: string;
};

const svenskDag = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
function dagarBakat(idag: string, n: number): string[] {
  const d = new Date(`${idag}T12:00:00Z`);
  return Array.from({ length: n }, (_, i) => {
    const x = new Date(d);
    x.setUTCDate(d.getUTCDate() - (n - 1 - i));
    return x.toISOString().slice(0, 10);
  });
}

/** Repots rubrikFor (src/lib/fel.ts) för en automatisk rad utan meddelande. */
export function felRubrik(r: Pick<RaFelrad, "kind" | "message" | "body" | "digest" | "path">): string {
  if (r.kind === "manual") {
    const forsta = (r.body ?? "").split("\n")[0].trim();
    return forsta.length > 90 ? `${forsta.slice(0, 90)}…` : forsta || r.path;
  }
  if (r.message) {
    const forsta = r.message.split("\n")[0].trim();
    return forsta.length > 90 ? `${forsta.slice(0, 90)}…` : forsta;
  }
  return `Fel på ${r.path}${r.digest ? ` (${r.digest.slice(0, 8)})` : ""}`;
}

export function formaFelrad(r: RaFelrad, hanterar: boolean, x?: RaFelExtra): NdFelrad {
  const egna = x?.foljare.filter((f) => f.error_id === r.id) ?? [];
  const forek = x?.forekomster ? x.forekomster.filter((f) => f.error_id === r.id) : null;
  const sex = x ? dagarBakat(x.idag, 6) : [];
  return {
    id: r.id,
    kind: r.kind === "manual" ? "manual" : "automatic",
    digest: r.digest,
    path: r.path,
    rubrik: felRubrik(r),
    message: r.message,
    stack: hanterar ? (r.stack ?? null) : null,
    body: r.body,
    blocking: Boolean(r.blocking),
    ant: Number(r.occurrences) || 1,
    forst: r.first_seen_at,
    senast: r.last_seen_at,
    status: r.status === "ack" || r.status === "closed" ? r.status : "new",
    vemId: r.reporter_id,
    handId: r.handled_by,
    handAt: r.handled_at,
    losning: r.resolution,
    release: r.release,
    ua: r.user_agent ?? null,
    pek: r.pointed_at ?? null,
    tarId: r.assigned_to ?? null,
    bekraftad: r.confirmed_at ? { at: r.confirmed_at, ok: Boolean(r.confirmed_ok) } : null,
    titel: r.public_title ?? null,
    kant: r.workaround ?? null,
    svar: (x?.meddelanden ?? []).filter((m) => m.error_id === r.id).map((m) => ({ avId: m.author_id, at: m.created_at, text: m.body })),
    foljer: Boolean(x && egna.some((f) => f.employee_id === x.mig)),
    foljare: hanterar ? egna.length : null,
    dagar: forek && forek.length ? sex.map((d) => forek.filter((f) => svenskDag(f.seen_at) === d).length) : null,
    pers: forek && forek.length ? new Set(forek.map((f) => f.employee_id).filter(Boolean)).size : null,
  };
}

/** `fel_statistik()` i klientens namn. */
export function formaStat(s: unknown): NdFelstat | null {
  if (!s || typeof s !== "object") return null;
  const o = s as Record<string, unknown>;
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    sedan: String(o.sedan ?? ""),
    lagade: Number(o.lagade ?? 0),
    automatiska: Number(o.automatiska ?? 0),
    mina: Number(o.mina ?? 0),
    medianDagar: n(o.median_dagar),
    medianDagarStoppande: n(o.median_dagar_stoppande),
    lagade30: Number(o.lagade_30 ?? 0),
  };
}

/** Stegen i den ordning `/api/jobb/natt` kör dem, med vad de gör i klartext. */
export const NATTSTEG: [string, string][] = [
  ["tid", "Stänga dagar som ingen stämplat ut"],
  ["konsekvenser", "Förslag om utebliven instämpling"],
  ["serier", "Återkommande uppgifter"],
  ["konton", "Konton och behörigheter"],
  ["arenden", "Ärendenas frister"],
  ["franvaro", "Sjukfrister och påminnelser om frånvaro"],
  ["satser", "Satser som ska ses över"],
  ["guider", "Systemguiderna för nyanställda"],
  ["coachning", "Coachning som passerat fristen"],
  ["notiser", "Gallring av notiser äldre än 90 dagar"],
  ["samtalsomtag", "Samtal som inte tolkats"],
  ["samtalskoppling", "Samtal till sina order"],
  ["inspelningsgallring", "Gallring av inspelningar"],
  ["felrapportering", "Kontroll av felrapporteringen"],
];

const tal = (o: Record<string, unknown>, k: string): number => (typeof o[k] === "number" ? (o[k] as number) : 0);
const st = (n: number, en: string, flera: string) => `${n} ${n === 1 ? en : flera}`;

/** Vad ett steg gjorde, ur dess del av `meta.resultat`. */
export function stegText(namn: string, varde: unknown): string {
  if (!varde || typeof varde !== "object") return "inget att göra";
  const o = varde as Record<string, unknown>;
  if (typeof o.hoppade_over === "string") return `hoppades över: ${o.hoppade_over}`;
  switch (namn) {
    case "tid":
      return `${st(tal(o, "stangda"), "dag stängd", "dagar stängda")}, ${st(tal(o, "sena"), "sen ankomst", "sena ankomster")}`;
    case "konsekvenser":
      return `${st(tal(o, "foreslagna"), "förslag", "förslag")}`;
    case "serier":
      return `${st(tal(o, "fodda"), "ny uppgift", "nya uppgifter")}`;
    case "konton":
      return `${tal(o, "granskade")} granskade, ${tal(o, "flaggade")} flaggade`;
    case "arenden":
      return `${st(tal(o, "eskalerade"), "eskalerat", "eskalerade")}`;
    case "franvaro":
      return `${st(tal(o, "paminnelser"), "påminnelse", "påminnelser")}, ${tal(o, "eskalerade")} eskalerade`;
    case "satser":
      return `${tal(o, "forfallna")} förfallna`;
    case "guider":
    case "coachning":
      return `${tal(o, "forsenade")} försenade av ${tal(o, "granskade")}`;
    case "notiser":
      return `${tal(o, "raderade")} raderade`;
    case "samtalsomtag":
      return `${tal(o, "tolkade")} tolkade`;
    case "samtalskoppling":
      return `${tal(o, "kopplade")} kopplade`;
    case "inspelningsgallring":
      return `${tal(o, "gallrade")} gallrade`;
    case "felrapportering":
      return o.mottagen === true ? "provrapport togs emot" : "provrapporten kom inte fram";
    default:
      return "kördes";
  }
}

/**
 * Stegen ur kvittot. Ett steg som står i `meta.fel` föll, och dess text är
 * felet. Steg som kvittot inte nämner visas inte: kvittot är sanningen om vad
 * som kördes, inte listan i koden.
 */
export function formaSteg(meta: unknown): NdFelsteg[] {
  const m = (meta && typeof meta === "object" ? meta : {}) as { resultat?: unknown; fel?: unknown };
  const resultat = (m.resultat && typeof m.resultat === "object" ? m.resultat : {}) as Record<string, unknown>;
  const fel = (m.fel && typeof m.fel === "object" ? m.fel : {}) as Record<string, unknown>;
  const kanda = new Map(NATTSTEG);
  const namn = [...NATTSTEG.map(([n]) => n), ...Object.keys(resultat).filter((n) => !kanda.has(n)), ...Object.keys(fel).filter((n) => !kanda.has(n) && !(n in resultat))];
  return namn
    .filter((n) => n in resultat || n in fel)
    .map((n) => ({
      namn: n,
      l: kanda.get(n) ?? n,
      ok: !(n in fel),
      text: n in fel ? String(fel[n] ?? "föll") : stegText(n, resultat[n]),
    }));
}
