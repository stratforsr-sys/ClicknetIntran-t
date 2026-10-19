import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { hasRole, type CurrentUser } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";
import { prefixfraga } from "@/lib/dokument";
import { ilikeMonster, orVillkor } from "@/lib/sokning";
import { hamtaKalposter, type NdPost } from "./kalender";
import { SKRIVLAGE } from "./skrivlage";

/**
 * Nav 2.0: paletten ("Sök, gör eller fråga Nav"), läsningen.
 *
 * ===========================================================================
 * SÖKNINGEN GÅR MED ANVÄNDARENS EGEN TOKEN, som /sok. RLS avgör vilka
 * uppgifter, rutiner, kurser, order och ärenden som finns att hitta, och
 * kalendern läses med `hamtaKalposter` — samma funktion som Kalendern, med
 * delningsnivåerna och privata möten ("Privat", "Upptagen") redan tillämpade.
 * Ett eget filter här hade varit ett andra svar på samma fråga.
 *
 * Källorna är utkastets (`palInnehall`): uppgifter, rutiner, kurser, kommande
 * kalenderposter, order och ärenden. Klienten skickar vilka vyer som är
 * kopplade, och bara de söks: en träff ska gå att öppna i utkastet.
 *
 * Kalendern söks inte per tangenttryck. Två månader ur `hamtaLeveranskalender`
 * är den tyngsta läsningen i navet, så de kommande posterna hämtas en gång när
 * paletten öppnas (`palettKalender`) och jämförs i klienten.
 *
 * Rutinerna söks i två led: navets fulltext (`document.search`, med bilagornas
 * text sedan 0023) med `prefixfraga` som på /sok, och rubrik och synonymer
 * (0095, `routine_meta.syn`) som utkastet. Synonymerna finns inte i
 * fulltexten, och rutinerna är få nog att jämföras här.
 *
 * Matchningen i texten här (`har`) är utkastets: gemener och utan accenter.
 * Mot databasen gäller `ilike` med repots escapning (`sokning.ts`).
 * ===========================================================================
 *
 * Fritt skrivna frågor besvaras inte: det kräver en AI-tjänst som inte är
 * kopplad. Veckans frågor utan svar (0125) läses här för chefen.
 */

export const PAL_VYER = ["uppgifter", "rutiner", "utbildning", "order", "arenden"] as const;
export type PalVy = (typeof PAL_VYER)[number];

export type NdPalTraff =
  | { typ: "uppgift"; id: string; t: string }
  | { typ: "rutin"; id: string; t: string }
  | { typ: "kurs"; id: string; t: string }
  | { typ: "order"; nr: number; bolag: string }
  | { typ: "arende"; id: string; t: string };

export type NdPalSok = { q: string; traffar: NdPalTraff[] };

/** Så många per källa. Klienten visar färre (utkastets 3/3/2/2/3/2) efter sina egna urval. */
const PER = 8;

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export async function sokPaletten(supabase: SupabaseClient, user: CurrentUser, fraga: string, vyer: PalVy[]): Promise<NdPalSok> {
  const q = fraga.trim().slice(0, 100);
  if (q.length < 2 || !user.employee) return { q, traffar: [] };
  const vill = new Set(vyer);
  const nq = norm(q);
  const har = (s: string | null | undefined) => norm(s ?? "").includes(nq);
  const monster = ilikeMonster(q);
  const tom = Promise.resolve([] as NdPalTraff[]);

  const [uppgifter, rutiner, kurser, order, arenden] = await Promise.all([
    // Uppgifterna: rubriken. Klienten visar bara de som står öppna i listan (utkastets mine()).
    vill.has("uppgifter")
      ? supabase
          .from("task")
          .select("id, title")
          .ilike("title", monster)
          .order("updated_at", { ascending: false })
          .limit(PER * 3)
          .then((r) => ((r.data ?? []) as { id: string; title: string }[]).map((x): NdPalTraff => ({ typ: "uppgift", id: x.id, t: x.title })))
      : tom,

    vill.has("rutiner")
      ? (async () => {
          const pf = prefixfraga(q);
          const [alla, snav, brett] = await Promise.all([
            supabase.from("document").select("slug, title, routine_meta").neq("status", "archived").order("title").limit(500),
            supabase.from("document").select("slug, title").neq("status", "archived").textSearch("search", q, { type: "websearch", config: "swedish" }).limit(PER),
            pf ? supabase.from("document").select("slug, title").neq("status", "archived").textSearch("search", pf, { config: "swedish" }).limit(PER) : Promise.resolve({ data: null }),
          ]);
          const ut = new Map<string, string>();
          for (const d of (alla.data ?? []) as { slug: string; title: string; routine_meta: { syn?: unknown } | null }[]) {
            const syn = Array.isArray(d.routine_meta?.syn) ? (d.routine_meta!.syn as unknown[]).map(String) : [];
            if (har(d.title) || syn.some((s) => har(s))) ut.set(d.slug, d.title);
          }
          const text = ((snav.data?.length ? snav.data : brett.data) ?? []) as { slug: string; title: string }[];
          for (const d of text) if (!ut.has(d.slug)) ut.set(d.slug, d.title);
          return [...ut].slice(0, PER).map(([id, t]): NdPalTraff => ({ typ: "rutin", id, t }));
        })()
      : tom,

    // Kurserna: som /sok, publicerade, rubrik och beskrivning.
    vill.has("utbildning")
      ? supabase
          .from("course")
          .select("slug, title")
          .eq("status", "published")
          .or(orVillkor(["title", "description_md"], q))
          .order("title")
          .limit(PER)
          .then((r) => ((r.data ?? []) as { slug: string; title: string }[]).map((x): NdPalTraff => ({ typ: "kurs", id: x.slug, t: x.title })))
      : tom,

    // Order: bolaget, eller numret med eller utan #.
    vill.has("order")
      ? (async () => {
          const nr = /^#?\d{1,9}$/.test(q) ? Number(q.replace("#", "")) : null;
          const f = supabase.from("sales_order").select("order_number, company_name");
          const { data } = await (nr !== null ? f.or(`${orVillkor(["company_name"], q)},order_number.eq.${nr}`) : f.ilike("company_name", monster))
            .order("created_at", { ascending: false })
            .limit(PER);
          return ((data ?? []) as { order_number: number | null; company_name: string | null }[])
            .filter((o) => o.order_number !== null)
            .map((o): NdPalTraff => ({ typ: "order", nr: Number(o.order_number), bolag: o.company_name ?? "" }));
        })()
      : tom,

    // Ärenden: egna alltid, andras för den som handlägger; konfidentiella avgör policyn (0013).
    vill.has("arenden")
      ? supabase
          .from("hr_case")
          .select("id, subject")
          .ilike("subject", monster)
          .order("created_at", { ascending: false })
          .limit(PER)
          .then((r) => ((r.data ?? []) as { id: string; subject: string }[]).map((x): NdPalTraff => ({ typ: "arende", id: x.id, t: x.subject })))
      : tom,
  ]);

  return { q, traffar: [...uppgifter, ...rutiner, ...kurser, ...order, ...arenden] };
}

/** Kommande poster i den egna kalendern, den här månaden och nästa, med rubrik. */
export async function palettKalender(user: CurrentUser): Promise<{ poster: NdPost[] }> {
  const idag = svensktDatum();
  const nasta = new Date(`${idag.slice(0, 7)}-15T12:00:00Z`);
  nasta.setUTCMonth(nasta.getUTCMonth() + 1);
  const [a, b] = await Promise.all([
    hamtaKalposter(user, "manad", idag, []),
    hamtaKalposter(user, "manad", `${nasta.toISOString().slice(0, 7)}-01`, []),
  ]);
  // Månadsrutorna överlappar: samma post kan komma i båda. "Upptagen" (rubrik null) går inte att söka på.
  const unika = new Map<string, NdPost>();
  for (const p of [...(a?.poster ?? []), ...(b?.poster ?? [])]) if (p.dag >= idag && p.rubrik !== null) unika.set(p.id, p);
  return { poster: [...unika.values()].sort((x, y) => x.dag.localeCompare(y.dag) || (x.start ?? -1) - (y.start ?? -1)) };
}

export type NdPalObesvarade = {
  /** Säljchef, VD och admin: samma krets som läser Adoptions sökningar utan träff. */
  farSe: boolean;
  /** Bokförs frågorna (SKRIVLAGE.paletten)? I läsläge fylls listan inte. */
  sparas: boolean;
  fragor: { q: string; antal: number; senast: string }[];
};

/** Veckans frågor utan svar (0125), utan namn. */
export async function palettObesvarade(supabase: SupabaseClient, user: CurrentUser): Promise<NdPalObesvarade> {
  const farSe = hasRole(user, "sales_manager", "ceo", "admin");
  const sparas = SKRIVLAGE.paletten;
  if (!farSe) return { farSe, sparas, fragor: [] };
  const { data, error } = await supabase.rpc("palett_obesvarade", { p_antal: 50 });
  if (error) throw new Error(`Frågorna utan svar gick inte att läsa: ${error.message}`);
  return {
    farSe,
    sparas,
    fragor: ((data ?? []) as { q: string; antal: number; senast: string }[]).map((r) => ({ q: r.q, antal: Number(r.antal), senast: String(r.senast) })),
  };
}
