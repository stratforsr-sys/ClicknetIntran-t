import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import type { KvKriterium, KvPolicy, KvSamtal } from "@/lib/kv";

/**
 * Hamtningarna for K&V (0036).
 *
 * Laser med ANVANDARENS EGEN TOKEN. RLS avgor vad som syns: saljaren ser sina
 * egna samtal och sina egna bedomningar INKLUSIVE fritexten (fraga 38),
 * cheferna ser allas. Teamledaren star utanfor, samma linje som provisionen.
 *
 * Skriv inget rollfilter har.
 */

export type Omradespoang = {
  criterion_id: string;
  points: number;
  note: string | null;
};

export type Samtalsrad = KvSamtal & {
  source: string;
  bedomd_av: string | null;
  bedomd_nar: string | null;
  kommentar: string | null;
  omraden: Omradespoang[];
};

const FALT =
  "id, employee_id, call_date, customer, source," +
  " kv_assessment(assessed_by, assessed_at, comment, kv_score(criterion_id, points, note))";

/**
 * numeric kommer tillbaka som STRANG ur PostgREST, och `poang` blir da en
 * strangkonkatenering i stallet for en summa. Samma falla som `order-server.ts`
 * och `provision-server.ts` redan gatt i.
 *
 * `poang` ar NULL nar samtalet inte ar bedomt, aldrig 0. Skillnaden ar hela
 * regeln i avsnitt 6.2: en obedomd vecka hoppas over, medan en bedomd vecka med
 * noll poang ar underkand.
 */
function tolka(rader: unknown[]): Samtalsrad[] {
  return (rader as Record<string, unknown>[]).map((r) => {
    const bedomning = (r.kv_assessment ?? null) as Record<string, unknown> | null;
    const poangrader = ((bedomning?.kv_score ?? []) as Record<string, unknown>[]).map((s) => ({
      criterion_id: String(s.criterion_id),
      points: Number(s.points),
      note: (s.note as string | null) ?? null,
    }));

    return {
      id: String(r.id),
      employee_id: String(r.employee_id),
      call_date: String(r.call_date),
      customer: String(r.customer),
      source: String(r.source),
      poang: bedomning ? poangrader.reduce((s, p) => s + p.points, 0) : null,
      bedomd_av: (bedomning?.assessed_by as string | null) ?? null,
      bedomd_nar: (bedomning?.assessed_at as string | null) ?? null,
      kommentar: (bedomning?.comment as string | null) ?? null,
      omraden: poangrader,
    };
  });
}

/** Samtal fran och med ett datum. RLS avgor vems. */
export async function hamtaSamtal(franOchMed: string): Promise<Samtalsrad[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("kv_call")
    .select(FALT)
    .gte("call_date", franOchMed)
    .order("call_date", { ascending: false });

  return tolka(data ?? []);
}

/** Ett enskilt samtal. Null nar det inte finns eller inte far ses. */
export async function hamtaSamtalet(id: string): Promise<Samtalsrad | null> {
  const rls = await supabaseServer();
  const { data } = await rls.from("kv_call").select(FALT).eq("id", id).maybeSingle();

  return data ? (tolka([data])[0] ?? null) : null;
}

export async function hamtaKriterier(): Promise<KvKriterium[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("kv_criterion")
    .select("id, label, max_points, sort, active")
    .order("sort");

  return (data ?? []).map((k) => ({
    ...k,
    max_points: k.max_points === null ? null : Number(k.max_points),
  })) as KvKriterium[];
}

/**
 * HELA historiken, inte bara den oppna raden. Uppslaget sker pa den manad som
 * visas, inte pa dagens datum — en stangd rad ar svaret pa vilka regler som
 * gallde i juni. Samma skal som `hamtaSatser` och `hamtaNivaer`.
 */
export async function hamtaPolicyer(): Promise<KvPolicy[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("kv_policy")
    .select("id, calls_per_week, threshold_points, percent_per_week, cap_percent, valid_from, valid_to")
    .order("valid_from", { ascending: false });

  return (data ?? []).map((p) => ({
    ...p,
    threshold_points: Number(p.threshold_points),
    percent_per_week: Number(p.percent_per_week),
    cap_percent: Number(p.cap_percent),
  })) as KvPolicy[];
}
