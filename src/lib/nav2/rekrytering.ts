import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fullName, type CurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { svensktDatum } from "@/lib/klocka";
import { utskickslage, type Utskickslage } from "./rekrytering-utskick";
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
 * Service role används för fyra saker, och bara för namn, antal och slutorsak:
 *   - kretsen som kan sitta med på en intervju (namnen, för "Med på intervjun"),
 *   - CV-filens namn,
 *   - säljarens egna tips: namnet på den hen tipsat om och vilket läge
 *     processen är i, aldrig bedömningarna, och hur många tips som kommit in
 *     och lett till en anställning (utkastets "Tipsa om en säljare"),
 *   - varför anställningen tog slut för dem som slutat de senaste nio
 *     månaderna (0110 `end_reason`), för företrädesrätten (LAS 25 §).
 * ===========================================================================
 *
 * 0110 körs tillsammans med resten av Nav 2.0 (beställaren 2026-10-18). Tills
 * dess läses 0030 som vanligt, det nya är tomt och `utan0110` säger det.
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
  /** Målet för perioden vi är i: en gång till ett datum, eller den här månaden eller kvartalet. */
  mal: { namn: string; egetNamn: string; antal: number; senast: string | null; fran: string; period: "engang" | "manad" | "kvartal" } | null;
  /** Varför anställningen tog slut, per person som slutat (0110). */
  slutorsak: Record<string, string>;
  /** Säljchef, VD och admin sätter slutorsaken. */
  kanSattaOrsak: boolean;
  /** Mejlen till kandidater: på i produktionen, aldrig i förhandsvisningen. */
  utskick: Utskickslage;
  tipsBett: string | null;
  vecka: [number, number][];
  kallor: [string, string][];
  rekryterare: { id: string; namn: string }[];
  /** För den som inte rekryterar: de egna tipsen, bara namn och läge. */
  minaTips: { namn: string; steg: RxSteg; sokte: string }[];
  tipsStat: { totalt: number; anst: number } | null;
};

const MANAD = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const sistaDagen = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
type RaMal = { name: string | null; headcount: number; period: "engang" | "manad" | "kvartal"; starts_on: string; ends_on: string | null };
/** Målet för den period vi är i. Ett periodiskt mål börjar om varje månad eller kvartal. */
export function malNu(g: RaMal, idag: string): NonNullable<NdRekrytering["mal"]> {
  const y = +idag.slice(0, 4), m = +idag.slice(5, 7);
  const egetNamn = g.name ?? "";
  if (g.period === "engang") return { namn: g.name || "Rekryteringen", egetNamn, antal: g.headcount, senast: g.ends_on, fran: g.starts_on, period: g.period };
  if (g.period === "manad") {
    const namn = MANAD[m - 1][0].toUpperCase() + MANAD[m - 1].slice(1);
    return { namn: g.name ? `${g.name}, ${MANAD[m - 1]}` : namn, egetNamn, antal: g.headcount, senast: sistaDagen(y, m), fran: `${idag.slice(0, 7)}-01`, period: g.period };
  }
  const q = Math.floor((m - 1) / 3), forsta = q * 3 + 1;
  return { namn: g.name ? `${g.name}, kvartal ${q + 1}` : `Kvartal ${q + 1}`, egetNamn, antal: g.headcount, senast: sistaDagen(y, forsta + 2), fran: `${y}-${String(forsta).padStart(2, "0")}-01`, period: g.period };
}

const saknas = (e: { message?: string } | null) => !!e && /does not exist|schema cache|could not find/i.test(e.message ?? "");

export function farRekrytera(user: CurrentUser): boolean {
  return user.roles.some((r) => ["sales_manager", "ceo", "admin"].includes(r)) || user.permissions.includes("recruiter");
}

export async function byggRekrytering(supabase: SupabaseClient, user: CurrentUser): Promise<NdRekrytering> {
  const admin = supabaseAdmin();
  const mig = user.employee?.id ?? "";
  const far = farRekrytera(user);
  const kanSattaOrsak = user.roles.some((r) => ["sales_manager", "ceo", "admin"].includes(r));
  const tom: NdRekrytering = { far, utan0110: false, kand: [], tider: [], tj: [], mallar: {}, jobbet: null, gallringManader: null, mal: null, slutorsak: {}, kanSattaOrsak, utskick: utskickslage(), tipsBett: null, vecka: [], kallor: [], rekryterare: [], minaTips: [], tipsStat: null };

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

  const idag = svensktDatum();
  const nioManader = new Date(Date.parse(idag + "T12:00:00Z") - 275 * 864e5).toISOString().slice(0, 10);
  const [kand, hand, sc, kallor, pol, noter, bok, tider, medd, meriter, malet, tjanster, mallar, personer, roller, beh, slutade] = await Promise.all([
    supabase.from("candidate").select("*").order("applied_at"),
    supabase.from("candidate_stage_event").select("candidate_id, from_stage, to_stage, at, by_employee, note").order("at"),
    supabase.from("interview_scorecard").select("*").order("created_at"),
    supabase.from("recruitment_source").select("slug, label, sort, active").order("sort"),
    supabase.from("recruitment_policy").select("*").maybeSingle(),
    supabase.from("candidate_note").select("candidate_id, kind, body, by_employee, at").order("at"),
    supabase.from("candidate_booking").select("id, candidate_id, slot_id, kind, day, start_min, end_min, place, attendees, status, calendar_event_id, created_at, cancelled_at").order("day"),
    supabase.from("interview_slot").select("id, day, start_min, end_min, place").gte("day", idag).order("day"),
    supabase.from("candidate_message").select("candidate_id, booking_id, template, channel, status, created_at, sent_at, send_after, error").order("created_at"),
    supabase.from("candidate_merit_request").select("candidate_id, requested_at, answered_at"),
    supabase.from("recruitment_goal").select("name, headcount, period, starts_on, ends_on").is("closed_at", null).maybeSingle(),
    supabase.from("recruitment_position").select("id, title, short_title, headcount, start_date, opened_at, platsbanken_until, linkedin_until, closed_at").is("closed_at", null).order("opened_at"),
    supabase.from("recruitment_template").select("slug, body"),
    supabase.from("employee").select("id, first_name, last_name, status"),
    admin.from("employee_role").select("employee_id, role").in("role", ["sales_manager", "ceo", "admin"]),
    admin.from("employee_permission").select("employee_id").eq("permission", "recruiter"),
    admin.from("employee").select("id, end_reason").eq("status", "offboarded").gte("end_date", nioManader),
  ]);

  const utan0110 = [noter, bok, tider, medd, meriter, malet, tjanster, mallar, slutade].some((r) => saknas(r.error));
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
    mal: malet.data ? malNu(malet.data as unknown as RaMal, idag) : null,
    slutorsak: Object.fromEntries(((slutade.data ?? []) as { id: string; end_reason: string | null }[]).filter((e) => e.end_reason).map((e): [string, string] => [e.id, e.end_reason as string])),
    kanSattaOrsak,
    utskick: utskickslage(),
    tipsBett: p?.tips_asked_at ? svensktDatum(p.tips_asked_at) : null,
    vecka: perVecka(kandidater, idag),
    kallor: ((kallor.data ?? []) as { slug: string; label: string; active: boolean }[]).filter((k) => k.active).map((k) => [k.slug, k.label]),
    rekryterare,
    minaTips: kandidater.filter((k) => k.tipped_by === mig).map((k) => ({ namn: `${k.first_name} ${k.last_name}`.trim(), steg: k.stage, sokte: k.applied_at })),
    tipsStat: null,
  };
}
