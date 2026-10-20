import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { dagarSedan, tackning, type Aktivitetsdag } from "@/lib/adoption";
import { nivaFor } from "./forma";

/**
 * Nav 2.0: Adoption (utkastets rlsAdoptionVy) ur repots adoption_*-funktioner (0029).
 *
 * ===========================================================================
 * RAKNAR PERSONER, ALDRIG VEM. Allt lases genom funktionerna i 0029, som svarar
 * med antal. `activity_day` har ingen lasepolicy och `search_miss` ingen
 * personkolumn, och inget har laser forbi dem. Det enda per rad ar en
 * sokstrang och en rutins namn.
 *
 * BARA SUPERADMIN (bestallaren 2026-10-20), alltsa VD och administrator. Det
 * ar snavare an 0029:s krets (som ocksa slapper in saljchefen), och for alla
 * andra skickas ingenting: utkastet far null och visar inte vyn alls.
 *
 * Besok i /nav2 raknas: mellanvaran stamplar varje inloggad begaran utom /api
 * (registrera_aktivitet), och /nav2 ar en sadan.
 * ===========================================================================
 */

const DAGAR = 30;
const GLOMD_EFTER = 90;

export type NdAdoption = {
  /** De senaste 30 dagarna, aldst forst. */
  dagar: Aktivitetsdag[];
  /** Anstallda som inte slutat (active och onboarding). Namnaren i andelen. */
  anstallda: number;
  /** WAU delat med antalet anstallda, i procent. Null utan namnare. */
  andel: number | null;
  /** Snittet av de fem senaste hela vardagarnas DAU delat med WAU den sista av dem. Null utan underlag. */
  aterkommer: number | null;
  /** Sokningar utan traff: texten och hur manga ganger, flest forst. */
  sokmissar: [string, number][];
  /** Publicerade rutiner ingen oppnat pa 90 dagar. `dagar` null = aldrig oppnad. */
  glomda: { id: string; t: string; dagar: number | null }[];
};

export async function byggAdoption(supabase: SupabaseClient, user: CurrentUser): Promise<NdAdoption | null> {
  if (nivaFor(user.roles) !== "superadmin") return null;

  const [akt, sok, nav2sok, glomda, anst, fragor] = await Promise.all([
    supabase.rpc("adoption_aktivitet", { p_dagar: DAGAR }),
    supabase.rpc("adoption_sokmissar", { p_antal: 20 }),
    // Nav 2.0:s egna sokningar utan traff (Rutiner, 0096). /sok och search_miss
    // forsvinner med nuvarande Nav, och annars hade listan slutat vaxa.
    supabase.from("document_search_miss").select("query").order("searched_at", { ascending: false }).limit(5000),
    supabase.rpc("adoption_glomda_dokument", { p_dagar: GLOMD_EFTER }),
    supabase.from("employee").select("id", { count: "exact", head: true }).neq("status", "offboarded"),
    // Palettens fragor utan svar (0125), alla veckor. Tabellen har ingen policy,
    // bara service role; villkoret ovan ar spärren.
    supabaseAdmin().from("nav_question_miss").select("q, occurrences").limit(5000),
  ]);

  const dagar = ((akt.data ?? []) as { dag: string; dau: number; wau: number }[]).map((d) => ({
    dag: String(d.dag).slice(0, 10),
    dau: Number(d.dau) || 0,
    wau: Number(d.wau) || 0,
  }));
  if (!dagar.length) return null;

  const anstallda = anst.count ?? 0;

  const missar = new Map<string, number>();
  for (const m of (sok.data ?? []) as { q: string; antal: number }[]) {
    const q = m.q.trim().toLowerCase();
    if (q) missar.set(q, (missar.get(q) ?? 0) + (Number(m.antal) || 0));
  }
  for (const m of (nav2sok.data ?? []) as { query: string }[]) {
    const q = String(m.query ?? "").trim().toLowerCase().slice(0, 100);
    if (q) missar.set(q, (missar.get(q) ?? 0) + 1);
  }
  for (const m of (fragor.data ?? []) as { q: string; occurrences: number }[]) {
    const q = String(m.q ?? "").trim().toLowerCase();
    if (q) missar.set(q, (missar.get(q) ?? 0) + (Number(m.occurrences) || 0));
  }

  return {
    dagar,
    anstallda,
    andel: tackning(dagar, anstallda),
    aterkommer: aterkommer(dagar),
    sokmissar: [...missar.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "sv")).slice(0, 20),
    glomda: ((glomda.data ?? []) as { slug: string; title: string; senast: string | null }[]).map((d) => ({
      id: d.slug,
      t: d.title,
      dagar: dagarSedan(d.senast),
    })),
  };
}

/**
 * "Aterkommer" (bestallaren 2026-10-20: "det som ar bast"): hur stor del av
 * veckans anvandare som ar inne en vanlig arbetsdag. Repots klibbighet() tar
 * dagens DAU, som ar lag pa morgonen och pa helgen. Har raknas snittet av de
 * fem senaste HELA vardagarna (i dag star utanfor), delat med WAU den sista
 * av dem.
 */
function aterkommer(dagar: Aktivitetsdag[]): number | null {
  const idag = dagar[dagar.length - 1]?.dag;
  const vard = dagar.filter((d) => d.dag !== idag && new Date(`${d.dag}T12:00:00Z`).getUTCDay() % 6 !== 0).slice(-5);
  const wau = vard[vard.length - 1]?.wau ?? 0;
  if (!vard.length || !wau) return null;
  return Math.round((vard.reduce((s, d) => s + d.dau, 0) / vard.length / wau) * 100);
}
