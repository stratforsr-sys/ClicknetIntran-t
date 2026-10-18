import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fullName, type CurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { svensktDatum } from "@/lib/klocka";
import {
  formaKandidat,
  formaTider,
  formaTjanst,
  perVecka,
  type Indata,
  type NdRxKand,
  type NdRxTid,
  type NdRxTjanst,
  type RaBokning,
  type RaHandelse,
  type RaKandidat,
  type RaLank,
  type RaMeddelande,
  type RaMerit,
  type RaNot,
  type RaPolicy,
  type RaScore,
  type RaTid,
  type RaTjanst,
  type RxSteg,
} from "./rekryteringforma";

/**
 * Nav 2.0: Rekrytering i utkastets former.
 *
 * ===========================================================================
 * LÄSES MED ANVÄNDARENS TOKEN. `candidate_read` och resten i 0030 och 0110
 * släpper in kretsen `far_rekrytera()` (säljchef, VD, admin och den som har
 * behörigheten Rekryterare) och ingen annan. Repots sida gör likadant.
 *
 * Service role används för tre saker, och bara för namn och antal:
 *   - kretsen som kan sitta med på en intervju (namnen, för "Med på intervjun"),
 *   - CV-filens namn,
 *   - säljarens egna tips: namnet på den hen tipsat om och vilket läge
 *     processen är i, aldrig bedömningarna, och hur många tips som kommit in
 *     och lett till en anställning (utkastets "Tipsa om en säljare").
 * ===========================================================================
 *
 * 0110 är skriven men inte körd förrän beställaren säger ja. Så länge den inte
 * är det läses 0030 som vanligt, det nya är tomt och `utan0110` säger det.
 */

export type NdRekrytering = {
  far: boolean;
  utan0110: boolean;
  kand: NdRxKand[];
  tider: NdRxTid[];
  tj: NdRxTjanst[];
  mallar: Record<string, string>;
  jobbet: string | null;
  gallringManader: number | null;
  mal: { namn: string; antal: number; senast: string | null } | null;
  tipsBett: string | null;
  vecka: [number, number][];
  kallor: [string, string][];
  rekryterare: { id: string; namn: string }[];
  /** För den som inte rekryterar: de egna tipsen, bara namn och läge. */
  minaTips: { namn: string; steg: RxSteg; sokte: string }[];
  tipsStat: { totalt: number; anst: number } | null;
};

const saknas = (e: { message?: string } | null) => !!e && /does not exist|schema cache|could not find/i.test(e.message ?? "");

export function farRekrytera(user: CurrentUser): boolean {
  return user.roles.some((r) => ["sales_manager", "ceo", "admin"].includes(r)) || user.permissions.includes("recruiter");
}

export async function byggRekrytering(supabase: SupabaseClient, user: CurrentUser): Promise<NdRekrytering> {
  const admin = supabaseAdmin();
  const mig = user.employee?.id ?? "";
  const far = farRekrytera(user);
  const tom: NdRekrytering = { far, utan0110: false, kand: [], tider: [], tj: [], mallar: {}, jobbet: null, gallringManader: null, mal: null, tipsBett: null, vecka: [], kallor: [], rekryterare: [], minaTips: [], tipsStat: null };

  if (!far) {
    // Säljarens vy: de egna tipsen. Se rubriken.
    const [{ data: mina, error: minaFel }, { data: alla, error: allaFel }] = await Promise.all([
      admin.from("candidate").select("first_name, last_name, stage, applied_at").eq("tipped_by", mig).order("applied_at", { ascending: false }),
      admin.from("candidate").select("stage").eq("source_slug", "tips"),
    ]);
    const tips = (alla ?? []) as { stage: string }[];
    return {
      ...tom,
      utan0110: saknas(minaFel),
      minaTips: ((mina ?? []) as { first_name: string; last_name: string; stage: RxSteg; applied_at: string }[]).map((k) => ({ namn: `${k.first_name} ${k.last_name}`.trim(), steg: k.stage, sokte: k.applied_at })),
      tipsStat: allaFel ? null : { totalt: tips.length, anst: tips.filter((t) => t.stage === "hired").length },
    };
  }

  const [kand, hand, sc, kallor, pol, noter, bok, tider, medd, meriter, lankar, tjanster, mallar, personer, roller, beh] = await Promise.all([
    supabase.from("candidate").select("*").order("applied_at"),
    supabase.from("candidate_stage_event").select("candidate_id, from_stage, to_stage, at, by_employee, note").order("at"),
    supabase.from("interview_scorecard").select("*").order("created_at"),
    supabase.from("recruitment_source").select("slug, label, sort, active").order("sort"),
    supabase.from("recruitment_policy").select("*").maybeSingle(),
    supabase.from("candidate_note").select("candidate_id, kind, body, by_employee, at").order("at"),
    supabase.from("candidate_booking").select("id, candidate_id, slot_id, kind, day, start_min, end_min, place, attendees, status, booked_by_candidate, calendar_event_id, created_at, cancelled_at").order("day"),
    supabase.from("interview_slot").select("id, day, start_min, end_min, place").gte("day", svensktDatum()).order("day"),
    supabase.from("candidate_message").select("candidate_id, booking_id, template, channel, status, created_at, sent_at").order("created_at"),
    supabase.from("candidate_merit_request").select("candidate_id, requested_at, answered_at"),
    supabase.from("candidate_booking_link").select("candidate_id, kind, attendees, created_at").is("used_at", null).is("cancelled_at", null),
    supabase.from("recruitment_position").select("id, slug, title, short_title, headcount, start_date, opened_at, platsbanken_until, linkedin_until, page_open, closed_at").is("closed_at", null).order("opened_at"),
    supabase.from("recruitment_template").select("slug, body"),
    supabase.from("employee").select("id, first_name, last_name, status"),
    admin.from("employee_role").select("employee_id, role").in("role", ["sales_manager", "ceo", "admin"]),
    admin.from("employee_permission").select("employee_id").eq("permission", "recruiter"),
  ]);

  const utan0110 = [noter, bok, tider, medd, meriter, lankar, tjanster, mallar].some((r) => saknas(r.error));
  const namn = new Map(((personer.data ?? []) as { id: string; first_name: string; last_name: string }[]).map((p) => [p.id, fullName(p)]));

  // Kretsen som kan sitta med. Namnen på dem RLS inte visar hämtas med service role.
  const kretsIds = [...new Set([...((roller.data ?? []) as { employee_id: string }[]).map((r) => r.employee_id), ...((beh.data ?? []) as { employee_id: string }[]).map((r) => r.employee_id)])];
  const okanda = kretsIds.filter((id) => !namn.has(id));
  if (okanda.length) {
    const { data } = await admin.from("employee").select("id, first_name, last_name").in("id", okanda);
    for (const p of (data ?? []) as { id: string; first_name: string; last_name: string }[]) namn.set(p.id, fullName(p));
  }
  const aktiva = new Set(((personer.data ?? []) as { id: string; status: string }[]).filter((p) => p.status !== "offboarded").map((p) => p.id));
  const rekryterare = kretsIds.filter((id) => id !== mig && (aktiva.has(id) || !namn.has(id))).map((id) => ({ id, namn: namn.get(id) ?? "" })).filter((p) => p.namn).sort((a, b) => a.namn.localeCompare(b.namn, "sv"));

  const kandidater = (kand.data ?? []) as RaKandidat[];
  const cvIds = kandidater.map((k) => k.cv_file_id).filter((v): v is string => !!v);
  const cvNamn = new Map<string, string>();
  if (cvIds.length) {
    const { data } = await admin.from("file_object").select("id, filename").in("id", cvIds).is("removed_at", null);
    for (const f of (data ?? []) as { id: string; filename: string }[]) cvNamn.set(f.id, f.filename);
  }

  const bokningar = (bok.data ?? []) as RaBokning[];
  const p = (pol.data ?? null) as RaPolicy | null;
  const indata: Indata = {
    kandidater,
    handelser: (hand.data ?? []) as RaHandelse[],
    scores: (sc.data ?? []) as RaScore[],
    noter: (noter.data ?? []) as RaNot[],
    bokningar,
    tider: (tider.data ?? []) as RaTid[],
    meddelanden: (medd.data ?? []) as RaMeddelande[],
    meriter: (meriter.data ?? []) as RaMerit[],
    lankar: (lankar.data ?? []) as RaLank[],
    tjanster: (tjanster.data ?? []) as RaTjanst[],
    policy: p,
    namn,
    cvNamn,
  };

  return {
    far,
    utan0110,
    kand: kandidater.map((k) => formaKandidat(k, indata)),
    tider: formaTider(indata.tider, bokningar),
    tj: indata.tjanster.map(formaTjanst),
    mallar: Object.fromEntries(((mallar.data ?? []) as { slug: string; body: string }[]).map((m) => [m.slug, m.body])),
    jobbet: p?.job_text ?? null,
    gallringManader: p?.purge_after_days ? Math.round(p.purge_after_days / 30.44) : null,
    mal: p?.goal_count ? { namn: p.goal_name || "Rekryteringen", antal: p.goal_count, senast: p.goal_by ?? null } : null,
    tipsBett: p?.tips_asked_at ? svensktDatum(p.tips_asked_at) : null,
    vecka: perVecka(kandidater, svensktDatum()),
    kallor: ((kallor.data ?? []) as { slug: string; label: string; active: boolean }[]).filter((k) => k.active).map((k) => [k.slug, k.label]),
    rekryterare,
    minaTips: kandidater.filter((k) => k.tipped_by === mig).map((k) => ({ namn: `${k.first_name} ${k.last_name}`.trim(), steg: k.stage, sokte: k.applied_at })),
    tipsStat: null,
  };
}
