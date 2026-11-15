import type { SupabaseClient } from "@supabase/supabase-js";
import { farSlasPa, lasChattInst, lasUtrymme, provNyckel, type Utrymme } from "./chattforma.ts";
import { avtryck } from "./systemtext.ts";

/** Frågans och svarets text sparas så här länge (designdokumentet, Loggen). */
export const CHATT_TEXT_DAGAR = 90;

/**
 * Nattjobbet: nollar frågans och svarets text i loggrader äldre än 90 dagar.
 * Raden står kvar med modell, token, verktyg och kostnad: det är dem gränserna
 * och kvalitetsmåttet räknas på.
 */
export async function rensaChattText(db: SupabaseClient, nu: Date = new Date()): Promise<{ nollade: number }> {
  const fore = new Date(nu.getTime() - CHATT_TEXT_DAGAR * 86_400_000).toISOString();
  const { data, error } = await db.from("nav_chatt_logg").update({ fraga: null, svar: null }).lt("nar", fore).not("fraga", "is", null).select("id");
  if (error) throw new Error(error.message);
  return { nollade: (data ?? []).length };
}

/** Miljön en loggrad hör till. Gränserna räknas per miljö: en preview drar aldrig av produktionens utrymme. */
export const chattMiljo = (): string => process.env.VERCEL_ENV ?? "lokal";

export type ChattLage = {
  pa: boolean;
  skal: string | null;
  modell: string;
  /** Vad personen och företaget använt i månaden, och gränserna. Null när det inte gick att läsa. */
  utrymme: Utrymme | null;
  /** Allas förbrukning i månaden. Bara för den som får se den. */
  allas: { namn: string; usd: number; fragor: number }[] | null;
};

/**
 * Chattens läge: är den påslagen, och får den vara det? Samma prövning som
 * rutten gör vid varje fråga (`farSlasPa`), så att skrivrutan bara frågar
 * Claude när rutten kommer att svara. Med läget följer månadens utrymme för
 * personen, och allas förbrukning för den som sätter gränserna.
 */
export async function chattLage(db: SupabaseClient, mig: string, allas: boolean): Promise<ChattLage> {
  const miljo = chattMiljo();
  const [{ data: rader }, { data: prov }, { data: utr }, { data: lista }] = await Promise.all([
    db.from("nav_setting").select("key, value").like("key", "chatt.%").limit(50),
    db.from("nav_chatt_prov").select("modell, avtryck, godkand").eq("godkand", true).limit(200),
    db.rpc("nav_chatt_utrymme", { p_miljo: miljo, p_employee: mig }),
    allas ? db.rpc("nav_chatt_forbrukning_alla", { p_miljo: miljo }) : Promise.resolve({ data: null }),
  ]);
  const inst = lasChattInst((rader ?? []) as { key: string; value: unknown }[]);
  const far = farSlasPa({
    nyckel: !!process.env.ANTHROPIC_API_KEY, avtal: inst.avtal, modell: inst.modell, avtryck: avtryck(),
    godkandaProv: ((prov ?? []) as { modell: string; avtryck: string; godkand: boolean }[]).filter((p) => p.godkand === true).map((p) => provNyckel(p.modell, p.avtryck)),
  });
  const folk = Array.isArray(lista)
    ? (lista as Record<string, unknown>[]).flatMap((x) => (typeof x?.namn === "string" && typeof x.usd === "number" && typeof x.fragor === "number" ? [{ namn: x.namn, usd: x.usd, fragor: x.fragor }] : []))
    : null;
  return { pa: inst.pa, skal: far.ok ? null : far.skal, modell: inst.modell, utrymme: lasUtrymme(utr), allas: allas ? folk : null };
}
