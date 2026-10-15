import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fullName, hasRole, type CurrentUser } from "@/lib/auth";
import { SKRIVLAGE } from "./skrivlage";

/**
 * Nav 2.0: Ärenden, med samma läsningar som /arenden och /arenden/[id].
 *
 * `hr_case` och `case_message` läses med användarens token: RLS (`hr_case_read`)
 * ger personen sina egna ärenden, och säljchef och VD de övriga — de
 * konfidentiella bara till dem. Kategorierna med svarstid och förval för
 * konfidentiellt är `case_category`, fristen är `due_at` som fryses vid
 * upplägget. Läskvittot, "löste det?", påminnelser, kopplingar, bilagor och
 * vad ärenden lett till är 0081.
 */

export type NdArende = {
  id: string;
  vemId: string;
  kat: string;
  rubrik: string;
  status: "new" | "in_progress" | "waiting" | "resolved";
  konf: boolean;
  tillId: string | null;
  skapad: string;
  due: string;
  lost: string | null;
  losning: string | null;
  eskalerad: boolean;
  msg: { avId: string; at: string; text: string }[];
  /** 0081: vem som läst och när. */
  lasta: { avId: string; at: string }[];
  /** 0081: personens svar på "Löste det här ditt ärende?", eller null. */
  bekraftat: { lost: boolean; at: string } | null;
  /** 0081: chefens påminnelser, senaste först. */
  paminnelser: string[];
  /** 0081: det ärendet gäller — en order, provisionen, ett bokat samtal. */
  kopplingar: { kind: string; ref: string; label: string }[];
  /** 0081: bilagor. Öppnas via /nav2/arenden (handling "visa"). */
  bilagor: { id: string; namn: string; kb: number; avId: string; at: string }[];
};

export type NdArenden = {
  hanterare: boolean;
  kategorier: { id: string; l: string; h: number; konf: boolean }[];
  arenden: NdArende[];
  /** Namnen läsaren får se (RLS), för avsändare, handläggare och "Lägg upp åt någon". */
  personer: { id: string; namn: string }[];
  /** 0081: det ledningen ändrat efter ärenden. Alla anställda ser listan. */
  utfall: { fraga: string; utfall: string; at: string }[];
  /** Om vyn får spara (src/lib/nav2/skrivlage.ts). */
  skriv: boolean;
};

export async function byggArenden(supabase: SupabaseClient, user: CurrentUser): Promise<NdArenden> {
  const hanterare = hasRole(user, "sales_manager", "ceo");
  const [{ data: arenden }, { data: kategorier }, { data: personal }] = await Promise.all([
    supabase
      .from("hr_case")
      .select("id, employee_id, subject, category, status, confidential, assigned_to, due_at, resolved_at, resolution, escalated_at, created_at")
      .order("resolved_at", { ascending: true, nullsFirst: true })
      .order("due_at", { ascending: true })
      .limit(200),
    supabase.from("case_category").select("id, label, sla_hours, default_confidential").order("sort"),
    supabase.from("employee").select("id, first_name, last_name").neq("status", "offboarded"),
  ]);
  const ids = (arenden ?? []).map((a) => a.id as string);
  const tom = { data: [] as Record<string, unknown>[] };
  const [{ data: meddelanden }, { data: lasta }, { data: bekr }, { data: pam }, { data: lankar }, { data: bilagor }, { data: utfall }] = await Promise.all([
    ids.length ? supabase.from("case_message").select("case_id, author_id, body, created_at").in("case_id", ids).order("created_at") : tom,
    ids.length ? supabase.from("hr_case_read").select("case_id, employee_id, read_at").in("case_id", ids) : tom,
    ids.length ? supabase.from("hr_case_confirmation").select("case_id, solved, confirmed_at").in("case_id", ids) : tom,
    ids.length ? supabase.from("hr_case_reminder").select("case_id, sent_at").in("case_id", ids).order("sent_at", { ascending: false }) : tom,
    ids.length ? supabase.from("hr_case_link").select("case_id, kind, ref, label").in("case_id", ids) : tom,
    ids.length ? supabase.from("hr_case_attachment").select("id, case_id, filename, size_bytes, uploaded_by, uploaded_at").in("case_id", ids).order("uploaded_at") : tom,
    supabase.from("case_outcome").select("fraga, utfall, created_at").order("created_at", { ascending: false }).limit(20),
  ]);

  return {
    hanterare,
    kategorier: (kategorier ?? []).map((k) => ({ id: k.id as string, l: k.label as string, h: Number(k.sla_hours), konf: Boolean(k.default_confidential) })),
    arenden: (arenden ?? []).map((a) => ({
      id: a.id as string,
      vemId: a.employee_id as string,
      kat: a.category as string,
      rubrik: a.subject as string,
      status: a.status as NdArende["status"],
      konf: Boolean(a.confidential),
      tillId: (a.assigned_to as string | null) ?? null,
      skapad: a.created_at as string,
      due: a.due_at as string,
      lost: (a.resolved_at as string | null) ?? null,
      losning: (a.resolution as string | null) ?? null,
      eskalerad: Boolean(a.escalated_at),
      msg: (meddelanden ?? [])
        .filter((m) => m.case_id === a.id)
        .map((m) => ({ avId: m.author_id as string, at: m.created_at as string, text: m.body as string })),
      lasta: (lasta ?? []).filter((r) => r.case_id === a.id).map((r) => ({ avId: r.employee_id as string, at: r.read_at as string })),
      bekraftat: (() => { const r = (bekr ?? []).find((x) => x.case_id === a.id); return r ? { lost: Boolean(r.solved), at: r.confirmed_at as string } : null; })(),
      paminnelser: (pam ?? []).filter((r) => r.case_id === a.id).map((r) => r.sent_at as string),
      kopplingar: (lankar ?? []).filter((r) => r.case_id === a.id).map((r) => ({ kind: r.kind as string, ref: r.ref as string, label: r.label as string })),
      bilagor: (bilagor ?? []).filter((r) => r.case_id === a.id).map((r) => ({ id: r.id as string, namn: r.filename as string, kb: Math.max(1, Math.round(Number(r.size_bytes) / 1024)), avId: r.uploaded_by as string, at: r.uploaded_at as string })),
    })),
    personer: (personal ?? []).map((p) => ({ id: p.id as string, namn: fullName(p) })).sort((a, b) => a.namn.localeCompare(b.namn, "sv")),
    utfall: (utfall ?? []).map((u) => ({ fraga: u.fraga as string, utfall: u.utfall as string, at: u.created_at as string })),
    skriv: SKRIVLAGE.arenden,
  };
}
