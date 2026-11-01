import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { bedomDrift, type Driftbesked } from "@/lib/jobb/larm";

/**
 * E0.7. Nattjobbets senaste kvitto, last ur `audit_log`.
 *
 * ===========================================================================
 * KLIENTEN SKICKAS IN, DEN SKAPAS INTE HAR
 *
 * Det ar med flit, och det ar hela behorighetsresonemanget. Tva anropare med
 * olika ratt laser samma rad:
 *
 *   - NATTJOBBET skickar in service role. Det har ingen anvandare, och det
 *     ska se sitt eget kvitto oavsett vem som rakar vara inloggad.
 *   - VYERNA pa `/fel` och startsidan skickar in ANVANDARENS EGEN TOKEN.
 *     `audit_log_read` slapper in sales_manager, ceo och admin — exakt samma
 *     krets som `hanterar` pa `/fel`. RLS har alltsa redan svarat pa fragan
 *     "far den har personen se det", och ett eget rollfilter i den har filen
 *     hade blivit ett andra svar pa samma fraga. Se rubriken i
 *     `notiser-server.ts`.
 *
 * Hade funktionen skapat sin egen klient hade den behovt valja en av dem, och
 * det valet hade blivit service role — alltsa kvittot utlast forbi RLS pa en
 * sida vem som helst kan oppna.
 * ===========================================================================
 *
 * FOLJDEN FOR VYERNA: noll rader betyder tva saker. Antingen har jobbet aldrig
 * kort, eller sa far den som laser inte se handelseloggen. Darfor ritar bada
 * vyerna kvittot bara for den krets `audit_log_read` slapper in. Det ar inget
 * andra rollfilter — kretsen kan inte bli vidare an RLS anda — det ar bara
 * skillnaden mellan "det finns inget kvitto" och "det ar inte din sak".
 */

/** Kvittot skrivs med en av tva actions, beroende pa om nagot steg fallit. */
export const KVITTO_ACTIONS = ["job.night_ok", "job.night_partial"] as const;

export type Kvitto = {
  /** Nar jobbet skrev kvittot. */
  ts: string;
  /** `job.night_ok`. Falskt betyder att minst ett steg foll. */
  helt: boolean;
  sekunder: number | null;
  /** Namnen pa de steg som foll, ur `meta.fel`. */
  fallnaSteg: string[];
};

export type Drift = {
  besked: Driftbesked;
  kvitto: Kvitto | null;
};

/** Gul 24 (produktionsprovet 2026-10-30): morgonjobbets kvitto, skrivet av `api/jobb/morgon`. */
export const MORGON_KVITTO_ACTIONS = ["job.morning_ok", "job.morning_partial"] as const;

/** Vercel kör morgonposten någon gång under timmen 05 UTC. 06:30 ger en halvtimmes marginal efter det. */
const MORGON_SENAST_MINUT_UTC = 6 * 60 + 30;

export type Morgonkvitto = { senaste: string | null; saknas: boolean };

/**
 * Har morgonjobbet kvitterat i dag? `saknas` blir sant först efter 06:30 UTC och
 * bara om ett kvitto någon gång funnits: som för natten är "aldrig" inte ett fel,
 * eftersom det första kvittot skrivs först morgonen efter att koden gått ut.
 */
export async function hamtaMorgonkvitto(db: SupabaseClient, nu: Date = new Date()): Promise<Morgonkvitto> {
  const { data } = await db
    .from("audit_log")
    .select("ts")
    .eq("object_type", "job")
    .eq("object_id", "morgon")
    .in("action", [...MORGON_KVITTO_ACTIONS])
    .order("ts", { ascending: false })
    .limit(1);
  const senaste = (data?.[0]?.ts as string | undefined) ?? null;
  const dygnet = Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), nu.getUTCDate());
  const efterGransen = nu.getTime() >= dygnet + MORGON_SENAST_MINUT_UTC * 60_000;
  return { senaste, saknas: efterGransen && senaste !== null && new Date(senaste).getTime() < dygnet };
}

export async function hamtaDrift(db: SupabaseClient, nu: Date = new Date()): Promise<Drift> {
  const { data } = await db
    .from("audit_log")
    .select("ts, action, meta")
    .eq("object_type", "job")
    .eq("object_id", "natt")
    .in("action", [...KVITTO_ACTIONS])
    .order("ts", { ascending: false })
    .limit(1);

  const rad = data?.[0] ?? null;
  if (!rad) return { besked: bedomDrift({ senaste: null, nu }), kvitto: null };

  const meta = (rad.meta ?? {}) as { sekunder?: unknown; fel?: unknown };
  const felObjekt =
    meta.fel && typeof meta.fel === "object" ? (meta.fel as Record<string, unknown>) : {};

  return {
    besked: bedomDrift({ senaste: rad.ts, nu }),
    kvitto: {
      ts: rad.ts,
      helt: rad.action === "job.night_ok",
      sekunder: typeof meta.sekunder === "number" ? meta.sekunder : null,
      fallnaSteg: Object.keys(felObjekt),
    },
  };
}
