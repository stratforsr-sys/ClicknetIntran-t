import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fullName, hasRole, type CurrentUser } from "@/lib/auth";

/**
 * Nav 2.0: Ärenden, med samma läsningar som /arenden och /arenden/[id].
 *
 * `hr_case` och `case_message` läses med användarens token: RLS (`hr_case_read`)
 * ger personen sina egna ärenden, och säljchef och VD de övriga — de
 * konfidentiella bara till dem. Kategorierna med svarstid och förval för
 * konfidentiellt är `case_category`, fristen är `due_at` som fryses vid
 * upplägget. Inget läskvitto finns i navet, och inget sådant visas.
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
};

export type NdArenden = {
  hanterare: boolean;
  kategorier: { id: string; l: string; h: number; konf: boolean }[];
  arenden: NdArende[];
  /** Namnen läsaren får se (RLS), för avsändare, handläggare och "Lägg upp åt någon". */
  personer: { id: string; namn: string }[];
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
  const { data: meddelanden } = ids.length
    ? await supabase.from("case_message").select("case_id, author_id, body, created_at").in("case_id", ids).order("created_at")
    : { data: [] as { case_id: string; author_id: string; body: string; created_at: string }[] };

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
    })),
    personer: (personal ?? []).map((p) => ({ id: p.id as string, namn: fullName(p) })).sort((a, b) => a.namn.localeCompare(b.namn, "sv")),
  };
}
