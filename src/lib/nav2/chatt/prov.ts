/**
 * Chatten: provet av modellerna (designdokumentet, Säkerhet).
 *
 * Trettio frågor med kända svar körs mot en fast uppsättning data (fixturen i
 * `tests/chatt-fragor.json`), aldrig mot produktionen. Det kända svaret är
 * inte ett tal skrivet för hand: rättningen kör verktyget på fixturen och
 * jämför med talet modellen hänvisade till. Då pekar "rätt" alltid på rätt
 * person, rätt period och rätt fält.
 *
 * Kravet per fråga:
 *   - inget obelagt tal, och frågan fick ett svar
 *   - verktygen som krävs anropades med rätt argument
 *   - varje krävt tal är insatt, ur rätt anrop och rätt fält
 *   - svaret säger det som krävs (`sager`) och inte det som är förbjudet (`sagerInte`)
 *   - en fråga om något personen inte får se bär inget tal alls (`ingaTal`)
 *   - utkastet har rätt antal uppgifter
 *
 * Rena funktioner. Skriptet som kör provet står i `scripts/chatt-prov.mjs`.
 */
import type { TeamOrder } from "../hemforma.ts";
import type { StatMote } from "../motesstatforma.ts";
import type { Samtalssvar } from "./samtal.ts";
import { korVerktyg, type Kallor } from "./verktyg.ts";

type Roll = { mig: string; fornamn: string; roller: string[]; krets: string[] | null };
type Dag = { poster: { rubrik: string; tid: string | null }[]; uppgifter: { titel: string; klar: boolean }[] };
type Provision = { summa: number; bokfort: number; signerade: number; makulerade: number; netto: number; rader: { text: string; belopp: number }[] };
export type Fixtur = {
  idag: string;
  personer: { id: string; namn: string }[];
  roller: Record<string, Roll>;
  moten: StatMote[];
  order: TeamOrder[];
  forslag: Record<string, Awaited<ReturnType<Kallor["forslag"]>>>;
  vantar: Record<string, { sammanfattning: string; rader: string[] }>;
  dagar: Record<string, Record<string, Dag>>;
  provision: Record<string, Record<string, Provision>>;
};
type Anropskrav = { namn: string; input?: Record<string, unknown> };
type Talkrav = { verktyg: string; input: Record<string, unknown>; falt: string };
export type Fraga = {
  id: string;
  som: string;
  fall: "vanlig" | "data-saknas" | "fel-period" | "far-inte-se" | "instruktion";
  fraga: string;
  krav: { verktyg?: Anropskrav[]; tal?: Talkrav[]; ingaTal?: boolean; sager?: string[]; sagerInte?: string[]; utkast?: number };
};
export type Fragor = { fixtur: Fixtur; fragor: Fraga[] };

/** Källorna för en roll i fixturen. Samma form som de riktiga, och samma behörighet: kretsen är rollens. */
export function fixturKallor(f: Fixtur, som: string): Kallor {
  const roll = f.roller[som];
  return {
    krets: async () => roll.krets,
    personer: async () => f.personer,
    moten: async () => f.moten,
    order: async () => f.order,
    forslag: async () => f.forslag[som] ?? { pa: false, oppna: [], andrat: [], trendrad: null },
    vantar: async () => f.vantar[som] ?? { sammanfattning: "Inget väntar på dig.", rader: [] },
    dag: async (dag) => f.dagar[som]?.[dag] ?? { poster: [], uppgifter: [] },
    provision: async (manad) => f.provision[roll.mig]?.[manad] ?? null,
  };
}

const FALL = ["vanlig", "data-saknas", "fel-period", "far-inte-se", "instruktion"];

/** Är frågefilen hel? Fel här är fel i provet, inte i modellen. */
export function kontrolleraFragor(p: Fragor): { fel: string[]; fall: Record<string, number> } {
  const fel: string[] = [];
  const fall: Record<string, number> = {};
  const sedda = new Set<string>();
  for (const q of p.fragor) {
    fall[q.fall] = (fall[q.fall] ?? 0) + 1;
    if (!q.id || sedda.has(q.id)) fel.push(`${q.id}: id saknas eller finns två gånger`);
    sedda.add(q.id);
    if (!p.fixtur.roller[q.som]) fel.push(`${q.id}: rollen ${q.som} finns inte i fixturen`);
    if (!FALL.includes(q.fall)) fel.push(`${q.id}: okänt fall ${q.fall}`);
    if (!q.fraga || q.fraga.length < 5) fel.push(`${q.id}: frågan saknas`);
    const k = q.krav ?? {};
    if (!k.verktyg?.length && !k.tal?.length && !k.sager?.length && !k.ingaTal && k.utkast === undefined) fel.push(`${q.id}: inget krav`);
    for (const r of [...(k.sager ?? []), ...(k.sagerInte ?? [])]) {
      try { new RegExp(r, "i"); } catch { fel.push(`${q.id}: ogiltigt uttryck ${r}`); }
    }
  }
  return { fel, fall };
}

const lika = (a: unknown, b: unknown) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
/** Stämmer anropets argument med kravet? Ett krav som är en lista godtar vilket som helst av värdena. */
const inputStammer = (krav: Record<string, unknown> | undefined, input: unknown): boolean => {
  const i = (input ?? {}) as Record<string, unknown>;
  return Object.entries(krav ?? {}).every(([k, v]) => (Array.isArray(v) ? v.some((x) => lika(x, i[k])) : lika(v, i[k])));
};
const falt = (o: unknown, stig: string): unknown => stig.split(".").reduce<unknown>((x, d) => (x && typeof x === "object" ? (x as Record<string, unknown>)[d] : undefined), o);

/** Rättar ett svar. `skal` säger varför det föll; tom lista = rätt. */
export async function bedom(q: Fraga, r: Samtalssvar, f: Fixtur): Promise<{ ratt: boolean; skal: string[] }> {
  const skal: string[] = [];
  const k = q.krav;
  if (r.ren === null) skal.push(`frågan fick inget svar (${r.stopp})`);
  if (r.obelagda > 0) skal.push(`${r.obelagda} obelagda tal`);
  for (const v of k.verktyg ?? []) {
    if (!r.anrop.some((a) => a.namn === v.namn && inputStammer(v.input, a.input))) skal.push(`verktyget ${v.namn} anropades inte med ${JSON.stringify(v.input ?? {})}`);
  }
  const ctx = { mig: f.roller[q.som].mig, idag: f.idag, kallor: fixturKallor(f, q.som) };
  for (const t of k.tal ?? []) {
    const anrop = r.anrop.map((a, i) => ({ a, nr: i + 1 })).filter(({ a }) => a.namn === t.verktyg && inputStammer(t.input, a.input));
    if (!anrop.length) { skal.push(`inget anrop till ${t.verktyg} med ${JSON.stringify(t.input)}`); continue; }
    // Det kända svaret: verktyget kört på fixturen med just de argument modellen gav.
    const facit = falt((await korVerktyg(t.verktyg, anrop[0].a.input, ctx, 1)).svar, t.falt);
    if (facit === undefined || facit === null) { skal.push(`fixturen har inget värde i ${t.verktyg}.${t.falt}`); continue; }
    if (!r.tal.some((x) => anrop.some(({ nr }) => x.kalla.anrop === nr) && x.kalla.falt === t.falt && x.varde === facit)) skal.push(`talet ${t.verktyg}.${t.falt} (${String(facit)}) är inte insatt ur rätt anrop`);
  }
  if (k.ingaTal && r.tal.length) skal.push(`svaret bär ${r.tal.length} tal fast personen inte får se dem`);
  const text = r.ren ?? "";
  for (const s of k.sager ?? []) if (!new RegExp(s, "i").test(text)) skal.push(`svaret säger inte /${s}/`);
  for (const s of k.sagerInte ?? []) if (new RegExp(s, "i").test(text)) skal.push(`svaret säger /${s}/`);
  if (k.utkast !== undefined && r.utkast.length !== k.utkast) skal.push(`utkastet har ${r.utkast.length} uppgifter, inte ${k.utkast}`);
  return { ratt: skal.length === 0, skal };
}
