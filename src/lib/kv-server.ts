import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { gallandePolicy, kvManad, type KvKriterium, type KvPolicy, type KvSamtal } from "@/lib/kv";
import type { KvIndata } from "@/lib/provision-motor";

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

/**
 * Manadens K&V-utfall per person, som provisionsmotorn behover det.
 *
 * ===========================================================================
 * DEN HAR FUNKTIONEN AR TVILLING TILL `hamtaKvPerPerson` i `stangning.ts`, OCH
 * DE FAR INTE SLAS IHOP.
 *
 * Skillnaden ar VEMS TOKEN som laser, och den foljer av vad de tva gor:
 *
 *   Stangningen BOKFOR. Den maste se allt, ocksa det den attesterande chefen
 *   av nagot skal inte far se, annars far nagon for lite betalt utan att nagot
 *   ser fel ut. Den laser darfor med service role.
 *
 *   Den har funktionen VISAR. Den ska se exakt det RLS slapper fram — en
 *   saljare sina egna veckor, chefen allas — for en vy som visar mer an
 *   policyn tillater ar en lacka oavsett hur ratt talet ar.
 *
 * DET DE MASTE VARA ENSE OM ar rakningen, och den ligger i `kvManad()` i
 * `kv.ts`. Bada anropar den. Skulle nagon frestas att rakna veckor for hand i
 * en av dem: det ar da de borjar saga olika saker om samma manad.
 * ===========================================================================
 *
 * SAMTALEN HAMTAS FRAN EN VECKA FORE TILL EN VECKA EFTER MANADEN. En ISO-vecka
 * hor till den manad dar dess TORSDAG ligger (O9), sa en vecka som raknas i
 * september kan innehalla samtal fran den 31 augusti. Hamtas bara september blir
 * randveckorna halva, och en halv vecka ar per definition inte fullstandigt
 * bedomd — foljden hade varit en tyst utebliven bonus i randen av varje manad.
 * `kvManad` filtrerar sjalv bort de veckor som inte hor till manaden.
 */
export async function hamtaKvPerPerson(manad: string): Promise<Map<string, KvIndata>> {
  const rls = await supabaseServer();

  const fran = new Date(`${manad}T00:00:00Z`);
  fran.setUTCDate(fran.getUTCDate() - 7);
  const till = new Date(`${manad}T00:00:00Z`);
  till.setUTCMonth(till.getUTCMonth() + 1);
  till.setUTCDate(till.getUTCDate() + 7);

  const [{ data: samtal }, policyer] = await Promise.all([
    rls
      .from("kv_call")
      .select("id, employee_id, call_date, customer, kv_assessment(kv_score(points))")
      .gte("call_date", fran.toISOString().slice(0, 10))
      .lte("call_date", till.toISOString().slice(0, 10)),
    hamtaPolicyer(),
  ]);

  // Ingen policy for manaden betyder att K&V inte gallde da. Ingen bonus, inget
  // fel — samma linje som en tom volymtrappa ger noll volymbonus.
  const policy = gallandePolicy(policyer, manad);
  if (!policy) return new Map();

  const rader: KvSamtal[] = ((samtal ?? []) as unknown as Record<string, unknown>[]).map((r) => {
    const bedomning = (r.kv_assessment ?? null) as Record<string, unknown> | null;
    const poang = ((bedomning?.kv_score ?? []) as Record<string, unknown>[]).reduce(
      (s, p) => s + Number(p.points),
      0,
    );

    return {
      id: String(r.id),
      employee_id: String(r.employee_id),
      call_date: String(r.call_date),
      customer: String(r.customer),
      // NULL nar samtalet inte ar bedomt, aldrig 0. Skillnaden ar hela regeln i
      // avsnitt 6.2: en obedomd vecka hoppas over, en bedomd vecka med noll
      // poang ar underkand.
      poang: bedomning ? poang : null,
    };
  });

  const ut = new Map<string, KvIndata>();
  for (const person of new Set(rader.map((r) => r.employee_id))) {
    const m = kvManad(
      rader.filter((r) => r.employee_id === person),
      manad,
      policy,
    );
    // Noll procent ar ingen post. En K&V-rad pa noll kronor i underlaget hade
    // pastatt att bonusen raknats och blivit noll, nar den inte gallde alls.
    if (m.procent > 0) {
      ut.set(person, { godkanda: m.godkanda, bedomda: m.bedomda, procent: m.procent });
    }
  }

  return ut;
}
