/**
 * Leveranskalenderns regler. Ren logik, inga importer.
 *
 * Ligger i lib av samma skäl som `kalender.ts`: en "use server"-fil exponerar
 * varje export, och provet (`tests/leveranskalender.mjs`) ska kunna läsa allt
 * härinne utan att dra in Next.
 *
 * =============================================================================
 * PROTOTYPEN ÄR FACIT
 *
 * Varje funktion här har en motsvarighet i `docs/leveranskalender/prototyp.html`
 * och heter efter den i kommentaren: `layout()`, `daySum()`, `autopick()`,
 * `isFree()`. Där de skiljer sig från `kalender.ts` vinner prototypen, och
 * därför står de HÄR och inte som ändringar i `laggUt()` eller `dagssumma()`,
 * som Planeringsvyn fortsätter att använda oförändrade (D-K2).
 *
 * Två skillnader mot kalender.ts, och båda är med flit:
 *   1. Poster ritas på EXAKT minut. `slut()` där avrundar till halvtimmar.
 *   2. Dagsumman räknar ALLA ogjorda bokningar — möten, uppgifter, leverans —
 *      inte bara uppgifter och coachning.
 * =============================================================================
 */

// -----------------------------------------------------------------------------
// Mått. Samma tal som prototypens konstanter.
// -----------------------------------------------------------------------------

/** 06:00 och 20:00 i minuter. Rutnätets fönster. */
export const DAY_START = 6 * 60;
export const DAY_END = 20 * 60;
/** Halvtimmesrad. */
export const SLOT = 30;
/** Höjden på en halvtimme i px (`SH`). */
export const SH = 26;
/** Arbetstid. Utanför den tonas rutnätet. */
export const WORK_S = 8 * 60;
export const WORK_E = 17 * 60;
/** Vad en dag rymmer, som `DAGSTAK` i kalender.ts. */
export const DAGSTAK = 6 * 60;
/** Ångerfönstret. Utkorgen skickar inget före det. */
export const ANGER_SEKUNDER = 10;
/** Kvittot med Ångra står minst så här länge. */
export const KVITTO_MS = 8000;

// -----------------------------------------------------------------------------
// Datum. Svenska kalenderdatum som strängar, räknade i UTC så att sommartid
// aldrig flyttar en dag.
// -----------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");
const D = (s: string) => {
  const [a, m, d] = s.split("-").map(Number);
  return Date.UTC(a, m - 1, d);
};
const F = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

export const plus = (s: string, n: number) => F(D(s) + n * 864e5);
/** 1 = måndag … 7 = söndag. */
export const wd = (s: string) => ((new Date(D(s)).getUTCDay() + 6) % 7) + 1;
export const monday = (s: string) => plus(s, 1 - wd(s));
export const weekno = (s: string) => {
  const th = plus(s, 4 - wd(s));
  const y = +th.slice(0, 4);
  return Math.floor((D(th) - D(`${y}-01-01`)) / 864e5 / 7) + 1;
};
export const isWeekend = (s: string) => wd(s) >= 6;
export const dd = (s: string) => +s.slice(8, 10);
export const mm = (s: string) => +s.slice(5, 7);
export const dagarMellan = (a: string, b: string) => Math.round((D(b) - D(a)) / 864e5);
export const foreDag = (a: string, b: string) => D(a) < D(b);

export const WDK = ["", "mån", "tis", "ons", "tors", "fre", "lör", "sön"];
export const WDL = ["", "Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag", "Söndag"];
export const MK = ["", "jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
export const ML = ["", "januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];

/** 870 → "14:30". */
export const hm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
/** "14:30" → 870. */
export function minuter(tid: string | null | undefined): number | null {
  if (!tid) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(tid);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
/** 90 → "1 h 30 min". */
export const len = (m: number) => {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? (r ? `${h} h ${r} min` : `${h} h`) : `${r} min`;
};
/** "ons 30 sep". */
export const dayLabel = (s: string) => `${WDK[wd(s)]} ${dd(s)} ${MK[mm(s)]}`;
/** "Onsdag 30 september 2026". */
export const datumLang = (s: string) => `${WDL[wd(s)]} ${dd(s)} ${ML[mm(s)]} ${s.slice(0, 4)}`;

export function arDatum(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(D(v)) && F(D(v)) === v;
}

// -----------------------------------------------------------------------------
// Vyer
// -----------------------------------------------------------------------------

export const VYER = ["dag", "arbetsvecka", "vecka", "manad", "team", "agenda"] as const;
export type Vy = (typeof VYER)[number];
export const VY_ETIKETT: Record<Vy, string> = {
  dag: "Dag",
  arbetsvecka: "Arbetsvecka",
  vecka: "Vecka",
  manad: "Månad",
  team: "Teamet",
  agenda: "Agenda",
};
/** Siffran i vyknappen och kortkommandot. */
export const VY_SIFFRA: Record<Vy, number> = { dag: 1, arbetsvecka: 2, vecka: 3, manad: 4, team: 5, agenda: 6 };
/** `Ctrl+Alt+<siffra>` → vy. Läses från `event.code`. */
export const VY_TANGENT: Record<string, Vy> = {
  Digit1: "dag",
  Digit2: "arbetsvecka",
  Digit3: "vecka",
  Digit4: "manad",
  Digit5: "team",
  Digit6: "agenda",
  Numpad1: "dag",
  Numpad2: "arbetsvecka",
  Numpad3: "vecka",
  Numpad4: "manad",
  Numpad5: "team",
  Numpad6: "agenda",
};

/** Nivån i kalenderlistan, kort. */
export const NIVA_KORT: Record<string, string> = {
  upptagen: "upptagen",
  rubriker: "rubriker",
  detaljer: "detaljer",
  redigera: "planera om",
  delegat: "delegat",
};

export function arVy(v: unknown): v is Vy {
  return typeof v === "string" && (VYER as readonly string[]).includes(v);
}

/** Dagen vyn öppnar på: idag, eller måndagen efter en helg (`HOME`). */
export function hemdag(idag: string): string {
  return isWeekend(idag) ? plus(monday(idag), 7) : idag;
}

/** `daysForView()`. */
export function dagarForVy(vy: Vy, anchor: string): string[] {
  if (vy === "dag" || vy === "team") return [anchor];
  if (vy === "agenda") return [0, 1, 2, 3, 4, 5, 6].map((i) => plus(anchor, i));
  if (vy === "manad") return manadsrutor(anchor);
  const m = monday(anchor);
  return (vy === "vecka" ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4]).map((i) => plus(m, i));
}

/** Månadsvyns rutor: från måndagen före den första, fem eller sex veckor. */
export function manadsrutor(anchor: string): string[] {
  const start = monday(`${anchor.slice(0, 7)}-01`);
  const m = mm(anchor);
  const ut: string[] = [];
  for (let i = 0; i < 42; i++) {
    const d = plus(start, i);
    if (i === 35 && mm(d) !== m) break;
    ut.push(d);
  }
  return ut;
}

/** Datumen servern ska hämta för en vy, båda inklusive. Veckovyerna tar hela veckan. */
export function intervallForVy(vy: Vy, anchor: string): { fran: string; till: string } {
  // Teamet visar en dag för många, och hämtar bara den.
  if (vy === "team") return { fran: anchor, till: anchor };
  if (vy === "dag" || vy === "arbetsvecka" || vy === "vecka") {
    const m = monday(anchor);
    return { fran: m, till: plus(m, 6) };
  }
  const d = dagarForVy(vy, anchor);
  return { fran: d[0], till: d[d.length - 1] };
}

/** `step()`: föregående eller nästa period. Dagvyn hoppar över helgen. */
export function steg(vy: Vy, anchor: string, dir: 1 | -1): string {
  if (vy === "manad") {
    const [y, m] = anchor.split("-").map(Number);
    return F(Date.UTC(y, m - 1 + dir, 1));
  }
  if (vy === "agenda") return plus(anchor, 7 * dir);
  if (vy === "dag" || vy === "team") {
    let d = plus(anchor, dir);
    while (isWeekend(d)) d = plus(d, dir);
    return d;
  }
  return plus(anchor, 7 * dir);
}

/** Texten i verktygsraden. `renderTop()`. */
export function periodtext(vy: Vy, anchor: string): { text: string; liten: string | null } {
  if (vy === "manad") return { text: `${ML[mm(anchor)]} ${anchor.slice(0, 4)}`, liten: null };
  const ds = dagarForVy(vy, anchor);
  if (vy === "agenda") {
    const a = ds[0];
    const b = ds[6];
    return { text: `${dd(a)} ${mm(a) !== mm(b) ? MK[mm(a)] + " " : ""}– ${dd(b)} ${MK[mm(b)]}`, liten: "7 dagar" };
  }
  if (ds.length === 1) return { text: `${WDL[wd(anchor)]} ${dd(anchor)} ${ML[mm(anchor)]}`, liten: `v. ${weekno(anchor)}` };
  const a = ds[0];
  const b = ds[ds.length - 1];
  return {
    text: `${dd(a)} ${mm(a) !== mm(b) ? MK[mm(a)] + " " : ""}– ${dd(b)} ${MK[mm(b)]} ${b.slice(0, 4)}`,
    liten: `v. ${weekno(a)}`,
  };
}

// -----------------------------------------------------------------------------
// Posterna
// -----------------------------------------------------------------------------

/** Vad en post är. Möten ur `calendar_event`, resten ur navets andra källor. */
export const SLAG = [
  "mote",
  "enskilt",
  "leverans",
  "uppgift",
  "coachning",
  "ledig",
  "order",
  "frist",
] as const;
export type Slag = (typeof SLAG)[number];

/** Klassen i prototypens CSS. Coachningen ritas som ett samtal på tu man hand. */
export const SLAG_KLASS: Record<Slag, string> = {
  mote: "k-mote",
  enskilt: "k-enskilt",
  leverans: "k-lev",
  uppgift: "k-uppgift",
  coachning: "k-enskilt",
  ledig: "k-ledig",
  order: "k-order",
  frist: "k-order",
};

export const SLAG_ETIKETT: Record<Slag, string> = {
  mote: "Möte",
  enskilt: "1:1",
  leverans: "Leverans",
  uppgift: "Uppgift",
  coachning: "Coachning",
  ledig: "Ledig",
  order: "Orderfrist",
  frist: "Frist",
};

/** Mitt svar på posten. `org` = jag är organisatören. */
export type Svar = "org" | "vantar" | "ja" | "kanske" | "nej";

export const SVAR_ETIKETT: Record<Svar, string> = {
  org: "Organisatör",
  ja: "Ja",
  kanske: "Kanske",
  nej: "Nej",
  vantar: "Inte svarat",
};

export type Post = {
  /** Unik i vyn. */
  id: string;
  /** Raden posten kom ur: `calendar_event.id`, `task.id` … Null när nivån inte öppnar den. */
  ref: string | null;
  slag: Slag;
  /** Vems kalender den står i. */
  agare: string;
  dag: string;
  /** Startminut, eller null för heldag. */
  start: number | null;
  minuter: number | null;
  /** Null = "Upptagen". */
  rubrik: string | null;
  /** Ägarens svar. */
  svar: Svar | null;
  klar: boolean;
  href: string | null;
  organisator: string | null;
  /** Övriga deltagare (id), när läsaren får se dem. */
  deltagare: string[];
  serie: boolean;
  /** Serien posten är en förekomst i, när läsaren får veta det. */
  serieId: string | null;
  /** Leveranspostens steg (pass 3). */
  steg: Steg | null;
  /** Utfallet: genomförd eller ej svar. Bara leveransposter. */
  utfall: "genomford" | "ej_svar" | null;
  /** Försök nummer, för välkomstsamtalet. */
  forsok: number;
  /** Påminnelse i minuter före, för plinget. */
  paminnelse: number;
};

/** `endOf()`. Minst en kvart, utan längd en halvtimme. */
export const endOf = (p: { start: number | null; minuter: number | null }) =>
  (p.start ?? 0) + Math.max(15, p.minuter ?? 30);

/** `involves()`: posten tar personens tid. Nej räknas inte. */
export function tarTid(p: Post, person: string): boolean {
  if (p.agare !== person) return false;
  if (p.slag === "ledig" || p.slag === "order" || p.slag === "frist") return false;
  return p.svar !== "nej";
}

// -----------------------------------------------------------------------------
// Utläggning. `layout()` i prototypen, på exakt minut.
// -----------------------------------------------------------------------------

export type Utlagd<T> = { e: T; col: number; cols: number; cl: number };

export function layout<T extends { id: string; start: number | null; minuter: number | null }>(list: readonly T[]): Utlagd<T>[] {
  const t = [...list].sort(
    (a, b) => (a.start ?? 0) - (b.start ?? 0) || endOf(b) - endOf(a) || (a.id < b.id ? -1 : 1),
  );
  const out: Utlagd<T>[] = [];
  let cl: Utlagd<T>[] = [];
  let clEnd = -1;
  let ci = 0;
  const close = () => {
    const n = Math.max(1, ...cl.map((k) => k.col + 1));
    for (const k of cl) {
      k.cols = n;
      k.cl = ci;
    }
    ci++;
    out.push(...cl);
    cl = [];
    clEnd = -1;
  };
  for (const e of t) {
    const s = e.start ?? 0;
    if (cl.length && s >= clEnd) close();
    const used = new Set(cl.filter((k) => endOf(k.e) > s).map((k) => k.col));
    let c = 0;
    while (used.has(c)) c++;
    cl.push({ e, col: c, cols: 1, cl: 0 });
    clEnd = Math.max(clEnd, endOf(e));
  }
  if (cl.length) close();
  return out;
}

/** Högst så många kolumner sida vid sida: två i veckovyerna, sex i dagvyn. */
export const maxKolumner = (antalDagar: number) => (antalDagar === 1 ? 6 : 2);

// -----------------------------------------------------------------------------
// Upptagen tid, dagsumma och lediga tider
// -----------------------------------------------------------------------------

/** En persons upptagna tid en dag: block i minuter och om hon är ledig hela dagen. */
export type Upptaget = Record<string, Record<string, { block: { s: number; e: number; id: string | null }[]; ledig: boolean }>>;

/** `daySum()`: ogjorda bokningar med klockslag, i minuter. */
export function daySum(poster: readonly Post[], dag: string, person: string): number {
  return poster
    .filter((p) => p.dag === dag && p.start !== null && tarTid(p, person) && !p.klar)
    .reduce((s, p) => s + (p.minuter ?? 0), 0);
}

/** `isFree()`: alla i `personer` är lediga hela spannet. */
export function isFree(
  upptaget: Upptaget,
  personer: readonly string[],
  dag: string,
  s: number,
  m: number,
  skip: string | null = null,
): boolean {
  if (isWeekend(dag)) return false;
  return personer.every((p) => {
    const d = upptaget[p]?.[dag];
    if (!d) return true;
    if (d.ledig) return false;
    return !d.block.some((b) => b.id !== skip && b.s < s + m && b.e > s);
  });
}

/** Vilka av personerna som är upptagna. Krockrutan. */
export function upptagnaAv(
  upptaget: Upptaget,
  personer: readonly string[],
  dag: string,
  s: number,
  m: number,
  skip: string | null = null,
): string[] {
  return personer.filter((p) => !isFree(upptaget, [p], dag, s, m, skip));
}

/**
 * `autopick()`: första tiden där alla är lediga.
 *
 * I steg om 15 min inom arbetstid, aldrig över lunch 12–13, aldrig närmare än
 * 15 min från nu, aldrig på helg (isFree säger nej till helgen).
 */
export function autopick(
  upptaget: Upptaget,
  personer: readonly string[],
  fromD: string,
  fromMin: number,
  m: number,
  maxDays: number,
  idag: string,
  nuMin: number,
  skip: string | null = null,
): { d: string; s: number } | null {
  let d = fromD;
  for (let i = 0; i <= maxDays; i++, d = plus(d, 1)) {
    for (let s = WORK_S; s + m <= WORK_E; s += 15) {
      if (D(d) < D(idag) || (d === idag && s < nuMin + 15)) continue;
      if (d === fromD && s < fromMin) continue;
      if (s < 13 * 60 && s + m > 12 * 60) continue;
      if (isFree(upptaget, personer, d, s, m, skip)) return { d, s };
    }
  }
  return null;
}

// -----------------------------------------------------------------------------
// Avatarer
// -----------------------------------------------------------------------------

/** Samma person får alltid samma färg, 1–6 (`--color-av-N`). */
export function avatarfarg(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 6) + 1;
}

// -----------------------------------------------------------------------------
// Fel från databasen. Koderna kastas av `lk_*`-funktionerna i 0069.
// -----------------------------------------------------------------------------

export const LK_FEL: Record<string, string> = {
  behorighet: "Bara organisatören kan flytta. Du kan föreslå en ny tid.",
  vardag: "Välj en vardag.",
  rubrik: "Skriv en rubrik först.",
  finns_inte: "Händelsen finns inte längre.",
  installd: "Händelsen är redan inställd.",
  for_sent: "För sent att ångra. Beskedet har redan gått ut.",
  oforandrad: "Tiden är densamma som förut.",
  ogiltig: "Något i formuläret stämmer inte. Kontrollera tid och deltagare.",
  tagen: "Någon annan tog kunden precis. Välj nästa i kön.",
};

/** "lk:vardag" någonstans i ett felmeddelande → texten. Annat → null. */
export function felkod(meddelande: string | null | undefined): string | null {
  const m = /lk:([a-z_]+)/.exec(meddelande ?? "");
  return m && LK_FEL[m[1]] ? m[1] : null;
}

// -----------------------------------------------------------------------------
// Serier (pass 2)
// -----------------------------------------------------------------------------

/** Formulärets "Upprepa". */
export const UPPREPA = ["aldrig", "vardagar", "vecka", "varannan"] as const;
export type Upprepa = (typeof UPPREPA)[number];
export const UPPREPA_ETIKETT: Record<Upprepa, string> = {
  aldrig: "Upprepas inte",
  vardagar: "Varje vardag",
  vecka: "Varje vecka",
  varannan: "Varannan vecka",
};

/** Seriens regel ur formulärets val. "Upprepas inte" är en serie med en enda gång. */
export function serieregel(upprepa: Upprepa, dag: string): {
  monster: "vardagar" | "veckovis";
  intervall: 1 | 2;
  veckodag: number;
  starts_on: string;
  ends_on: string | null;
} {
  return {
    monster: upprepa === "vardagar" ? "vardagar" : "veckovis",
    intervall: upprepa === "varannan" ? 2 : 1,
    veckodag: wd(dag),
    starts_on: dag,
    ends_on: upprepa === "aldrig" ? dag : null,
  };
}

/** "varje vecka", "varannan vecka", "varje vardag", "en gång" — gemener, för en mening. */
export function regeltext(r: { monster: string; intervall: number; ends_on?: string | null; starts_on?: string }): string {
  if (r.ends_on && r.starts_on && r.ends_on === r.starts_on) return "en gång";
  if (r.monster === "vardagar") return "varje vardag";
  return r.intervall === 2 ? "varannan vecka" : "varje vecka";
}

/** "1:1 Elin" för de två, "1:1 Zen · Elin" för en tredje. `whenText()` i prototypen. */
export function enskildTitel(organisator: string, andra: string | null, mig: string, fornamn: (id: string) => string): string {
  if (!andra) return "1:1";
  if (mig === organisator) return `1:1 ${fornamn(andra)}`;
  if (mig === andra) return `1:1 ${fornamn(organisator)}`;
  return `1:1 ${fornamn(organisator)} · ${fornamn(andra)}`;
}

export function kvittoSerieFlyttad(dag: string, tid: number, vardagar: boolean, bekrafta: readonly string[]): string {
  const nar = vardagar ? "vardagar" : `${WDL[wd(dag)].toLowerCase()}ar`;
  return `Hela serien flyttad till ${nar} ${hm(tid)}.${bekrafta.length ? ` ${lista(bekrafta)} behöver bekräfta den nya tiden.` : ""}`;
}

export function kvittoSerieInbjudan(deltagare: readonly string[], regel: string): string {
  return `Inbjudan skickad till ${lista(deltagare) || "ingen"}${regel && regel !== "en gång" ? `. Serie ${regel}` : ""}.`;
}

// -----------------------------------------------------------------------------
// Leverans (pass 3)
// -----------------------------------------------------------------------------

export const STEG = ["valkomstsamtal", "tillgangar", "kickoff", "leveransstart", "avstamning_30", "avstamning_90"] as const;
export type Steg = (typeof STEG)[number];

/** Förinställningarna (SPEC AC 34): etikett, längd, glyf och om kunden bjuds in. */
export const FORINSTALLNINGAR: Record<Steg, { lab: string; minuter: number; ico: string; kund: boolean }> = {
  valkomstsamtal: { lab: "Välkomstsamtal", minuter: 30, ico: "☎", kund: false },
  tillgangar: { lab: "Tillgångar", minuter: 30, ico: "⚿", kund: false },
  kickoff: { lab: "Kickoff", minuter: 60, ico: "▶", kund: true },
  leveransstart: { lab: "Leveransstart", minuter: 90, ico: "◆", kund: false },
  avstamning_30: { lab: "30-dagarsavstämning", minuter: 30, ico: "✓", kund: false },
  avstamning_90: { lab: "90-dagarsgenomgång", minuter: 60, ico: "✓", kund: false },
};

export function arSteg(v: unknown): v is Steg {
  return typeof v === "string" && (STEG as readonly string[]).includes(v);
}

/** `slaInfo()`: nedräkningen i kön. Grön över 8 h, gul under, röd när försenad. */
export function slaInfo(dueIso: string, nuMs: number): { cls: "ok" | "warn" | "bad"; txt: string; pct: number } {
  const ms = Date.parse(dueIso) - nuMs;
  const h = ms / 36e5;
  const cls = h < 0 ? "bad" : h < 8 ? "warn" : "ok";
  const a = Math.abs(Math.round(ms / 6e4));
  const t = `${Math.floor(a / 60)} h ${pad(a % 60)} min`;
  return { cls, txt: h < 0 ? `Försenad ${t}` : `${t} kvar`, pct: Math.max(0, Math.min(100, (h / 24) * 100)) };
}

/** Överlämningens sex fält, i prototypens ordning. */
export const OVERLAMNING = [
  ["kontakt", "Kontaktperson"],
  ["telefon", "Telefon"],
  ["mal", "Kundens mål"],
  ["lovat", "Vad som lovades"],
  ["basta_tid", "Bästa tid att ringa"],
  ["risker", "Risker"],
] as const;

/** `handoff()`: hur många av sex, och vilka som saknas. */
export function overlamning(k: Partial<Record<(typeof OVERLAMNING)[number][0], string | null>>): {
  har: number;
  av: number;
  saknas: string[];
} {
  const saknas = OVERLAMNING.filter(([f]) => !String(k[f] ?? "").trim()).map(([, l]) => l);
  return { har: OVERLAMNING.length - saknas.length, av: OVERLAMNING.length, saknas };
}

/** "ons 7 okt kl 09:30" — påminnelsen 30 min före (`reminderText()`). */
export function paminnelsetext(dag: string, start: number): string {
  return `${WDK[wd(dag)]} ${dd(dag)} ${MK[mm(dag)]} kl ${hm(Math.max(0, start - 30))}`;
}

export function kvittoValkomst(kund: string, dag: string, tid: number, person: string, saljare: string): string {
  return `Välkomstsamtal med ${kund} bokat ${dayLabel(dag)} ${hm(tid)} hos ${person}.${saljare ? ` ${saljare} får en notis.` : ""}`;
}

export function kvittoForsok(n: number, dag: string, tid: number): string {
  return `Försök ${n} bokat ${dayLabel(dag)} ${hm(tid)}, på en annan tid på dagen.`;
}

export const KVITTO_TREDJE_FORSOKET = "Tredje försöket utan svar. Skicka sms och mejl med en bokningslänk.";
export const KVITTO_INGEN_TID_5 = "Ingen ledig tid de närmaste fem dagarna.";

export function kvittoKickoff(dag: string, tid: number, kontakt: string | null): string {
  return `Kickoff ${dayLabel(dag)} ${hm(tid)}.${kontakt ? ` ${kontakt} får inbjudan via mejl.` : ""}`;
}

// -----------------------------------------------------------------------------
// Kvitton. SPEC avsnitt 9, ordagrant. Förnamn i kvitton.
// -----------------------------------------------------------------------------

export const lista = (namn: readonly string[]) => namn.join(", ");

export function kvittoFlyttad(dag: string, tid: number, bekrafta: readonly string[], barGangen = false): string {
  return `Flyttad till ${dayLabel(dag)} ${hm(tid)}${barGangen ? ", bara den här gången" : ""}.${
    bekrafta.length ? ` ${lista(bekrafta)} behöver bekräfta den nya tiden.` : ""
  }`;
}

export function kvittoLangd(start: number, slut: number, bekrafta: readonly string[]): string {
  return `Nu ${hm(start)}–${hm(slut)}.${bekrafta.length ? ` ${lista(bekrafta)} behöver bekräfta den nya tiden.` : ""}`;
}

export function kvittoSvar(svar: "ja" | "kanske" | "nej", organisator: string, forekomstDag: string | null = null): string {
  return forekomstDag
    ? `Svar skickat för ${dayLabel(forekomstDag)}: ${svar}. ${organisator} ser det i sin klocka.`
    : `Svar skickat: ${svar}. ${organisator} ser det i sin klocka.`;
}

export function kvittoForslag(organisator: string, dag: string, s: number, m: number): string {
  return `Förslaget skickat till ${organisator}: ${dayLabel(dag)} ${hm(s)}–${hm(s + m)}.`;
}

export function kvittoInstallt(mottagare: readonly string[]): string {
  return `Inställt.${mottagare.length ? ` ${lista(mottagare)} får en notis och ett mejl.` : ""}`;
}

export function kvittoKopierad(dag: string, tid: number, medDeltagare: boolean): string {
  return `Kopierad till ${dayLabel(dag)} ${hm(tid)}.${medDeltagare ? " Inbjudan skickad igen." : ""}`;
}

export function kvittoInbjudan(deltagare: readonly string[]): string {
  return deltagare.length ? `Inbjudan skickad till ${lista(deltagare)}.` : "Mötet är sparat.";
}

export const KVITTO_ANGRAT = "Ångrat. Inget skickades.";
export const KVITTO_BARA_ORGANISATOREN = "Bara organisatören kan flytta. Du kan föreslå en ny tid.";
export const KVITTO_INGEN_TID_7 = "Ingen gemensam tid de närmaste 7 dagarna.";
export const KVITTO_INGEN_TID_14 = "Ingen gemensam tid de närmaste två veckorna.";

// -----------------------------------------------------------------------------
// Notistexter. Skrivs när utkorgen töms, ur en rad som säger vad som hände.
// -----------------------------------------------------------------------------

export type Notisrad = {
  kalla: string;
  mall: string;
  till: string;
  av: string | null;
  event_id?: string | null;
  task_id?: string | null;
  order_id?: string | null;
  data: Record<string, unknown>;
};

/** Det texten behöver veta om händelsen när raden töms. */
export type Notisunderlag = {
  avNamn: string | null;
  rubrik: string;
  dag: string;
  tid: string | null;
};

/** En notis för klockan. `null` = mallen finns inte, och raden skickas inte. */
export function notistext(
  rad: Notisrad,
  u: Notisunderlag,
): { rubrik: string; detalj: string; href: string } | null {
  const av = u.avNamn ?? "Någon";
  // En 1:1 heter "1:1" och står utan citattecken: "bjöd in dig till 1:1".
  const t = u.rubrik === "1:1" ? "1:1" : `“${u.rubrik}”`;
  const d = rad.data as Record<string, string | number | boolean | null | undefined>;
  const nyDag = typeof d.dag === "string" ? d.dag : u.dag;
  const nyTid = typeof d.tid === "string" ? d.tid : u.tid;
  const nar = `${dayLabel(nyDag)}${nyTid ? " " + nyTid : ""}`;
  const href = rad.event_id
    ? `/kalender?dag=${nyDag}&handelse=${rad.event_id}`
    : rad.task_id
      ? `/uppgifter/${rad.task_id}`
      : "/kalender";

  switch (rad.mall) {
    case "inbjudan":
      return { rubrik: `${av} bjöd in dig till ${t}`, detalj: nar, href };
    case "bokat-at-dig":
      return { rubrik: `${av} bokade ${t} åt dig`, detalj: nar, href };
    case "flyttad":
      return d.svara_igen
        ? {
            rubrik: `${av} flyttade ${t}. Svara igen`,
            detalj: `ny tid ${nar} · ditt tidigare svar gäller inte längre`,
            href,
          }
        : { rubrik: `${av} flyttade ${t}`, detalj: `ny tid ${nar}`, href };
    case "installd":
      return { rubrik: `${av} ställde in ${t}`, detalj: nar, href: "/kalender" };
    case "svar": {
      const svar = String(d.svar ?? "");
      const note = typeof d.note === "string" && d.note ? ` · “${d.note}”` : "";
      return {
        rubrik: `${av} svarade ${svar} på ${t}`,
        detalj: (d.hela_serien ? "gäller hela serien" : nar) + note,
        href,
      };
    }
    case "forslag": {
      const m = typeof d.minuter === "number" ? d.minuter : 30;
      const s = minuter(typeof d.tid === "string" ? d.tid : null) ?? 0;
      const note = typeof d.note === "string" && d.note ? ` · “${d.note}”` : "";
      return {
        rubrik: `${av} föreslår ny tid för ${t}`,
        detalj: `${dayLabel(nyDag)} ${hm(s)}–${hm(s + m)}${note}`,
        href,
      };
    }
    case "forslag-godkant":
      return { rubrik: `${av} godkände din föreslagna tid`, detalj: `${t} · ${nar}`, href };
    case "forslag-behallen":
      return { rubrik: `${av} behåller tiden för ${t}`, detalj: `${dayLabel(u.dag)}${u.tid ? " " + u.tid : ""}`, href };
    case "inbjudan-serie": {
      const regel = typeof d.regel === "string" && d.regel && d.regel !== "en gång" ? `, ${d.regel}` : "";
      return { rubrik: `${av} bjöd in dig till ${t}${regel}`, detalj: `${regel ? "första gången " : ""}${nar}`, href };
    }
    case "flyttad-serie": {
      const regel = typeof d.regel === "string" && d.regel ? d.regel : "ny tid";
      return d.svara_igen
        ? {
            rubrik: `${av} flyttade hela serien ${t}. Svara igen`,
            detalj: `nu ${regel} ${d.tid ?? ""} · ditt tidigare svar gäller inte längre`.replace("  ", " "),
            href,
          }
        : { rubrik: `${av} flyttade hela serien ${t}`, detalj: `nu ${regel} ${d.tid ?? ""}`.trim(), href };
    }
    case "punkt":
      return {
        rubrik: `${av} lade till en punkt på er 1:1`,
        detalj: typeof d.text === "string" ? `“${d.text}”` : "",
        href,
      };
    case "forbered-be":
      return { rubrik: `${av} vill att du förbereder er 1:1`, detalj: `${nar} · lägg till det du vill ta upp`, href };
    case "forberedelse":
      return { rubrik: "Inför er 1:1: lägg till det du vill ta upp", detalj: nar, href };
    case "leverans-ny":
      return { rubrik: `Ny kund i kön: ${u.rubrik}`, detalj: "välkomstsamtal inom 24 timmar", href: "/kalender?ko=1" };
    case "leverans-frist":
      return { rubrik: `${u.rubrik} har snart väntat 24 h`, detalj: "välkomstsamtal saknas · 4 h kvar", href: "/kalender?ko=1" };
    case "leverans-makulerad":
      return { rubrik: `${u.rubrik} är makulerad`, detalj: "välkomstsamtalet är bokat — ställ in det om det inte ska hållas", href: "/kalender" };
    case "leverans-bokad-agare":
      return { rubrik: `Välkomstsamtal med ${kundUr(u.rubrik)} bokat åt dig`, detalj: nar, href };
    case "leverans-bokad-saljare":
      return { rubrik: `${kundUr(u.rubrik)} välkomnas ${nar}`, detalj: `av ${d.ansvarigNamn ?? "leveransen"}`, href };
    case "leverans-komplettera":
      return {
        rubrik: `Komplettera överlämningen för ${u.rubrik}`,
        detalj: typeof d.saknas === "string" && d.saknas ? `Saknas: ${d.saknas}` : "Leveransen behöver mer",
        href: `/kalender/overlamning/${String(d.order_id ?? rad.order_id ?? "")}`,
      };
    case "leverans-studs":
      return { rubrik: `Påminnelsen till ${d.mottagare === "kund" ? "kunden" : "dig"} kom inte fram`, detalj: `${u.rubrik} · ${nar}`, href };
    case "uppgift-paminnelse":
      return { rubrik: u.rubrik, detalj: `Om tio minuter, kl ${nyTid ?? ""}`.trim(), href };
    default:
      return null;
  }
}

/** "Välkomstsamtal · Kvarnens Bageri" → "Kvarnens Bageri". */
function kundUr(rubrik: string): string {
  const i = rubrik.lastIndexOf(" · ");
  return i >= 0 ? rubrik.slice(i + 3) : rubrik;
}

/** Källorna som ger svarsknappar i klockan: den som bjudits in eller fått en ny tid. */
export const SVARSKALLOR = ["kalender-inbjudan", "kalender-flyttad", "kalender-flyttad-tyst"] as const;

// -----------------------------------------------------------------------------
// Kundens inbjudan (0072)
// -----------------------------------------------------------------------------

const liten = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Kundens brev med kickoffens `.ics` (pass 4). Kort, på svenska, och utan något
 * internt: rubriken är förinställningens namn och "med Clicknet", aldrig navets
 * egen rubrik med kundens namn i.
 */
export function kundbrev(a: {
  metod: "REQUEST" | "CANCEL";
  sekvens: number;
  rubrik: string;
  nar: string;
  kontakt: string | null;
  plats: string | null;
  url: string | null;
  avsandare: string;
}): { amne: string; text: string } {
  const halsning = a.kontakt ? `Hej ${a.kontakt},` : "Hej,";
  const var_ = [a.plats?.trim() ? `Plats: ${a.plats.trim()}` : "", a.url?.trim() ? `Länk: ${a.url.trim()}` : ""].filter(Boolean);
  const slut = ["", "Hälsningar,", `${a.avsandare}, Clicknet`];

  if (a.metod === "CANCEL") {
    return {
      amne: `Inställt: ${a.rubrik} ${a.nar}`,
      text: [halsning, "", `Vi har ställt in ${liten(a.rubrik)} ${a.nar}.`, "Den bifogade filen tar bort mötet ur din kalender. Vi hör av oss med en ny tid.", ...slut].join("\n"),
    };
  }
  if (a.sekvens > 0) {
    return {
      amne: `Ny tid: ${a.rubrik} ${a.nar}`,
      text: [halsning, "", `Vi har flyttat ${liten(a.rubrik)} till ${a.nar}.`, "Den bifogade inbjudan uppdaterar mötet i din kalender.", ...var_, ...slut].join("\n"),
    };
  }
  return {
    amne: `Inbjudan: ${a.rubrik} ${a.nar}`,
    text: [halsning, "", `Välkommen till ${liten(a.rubrik)} ${a.nar}.`, "Inbjudan ligger bifogad. Öppna den för att lägga in mötet i din kalender.", ...var_, ...slut].join("\n"),
  };
}
