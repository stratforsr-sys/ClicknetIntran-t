import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { hasRole, type CurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { svensktDatum } from "@/lib/klocka";
import { SKRIVLAGE } from "./skrivlage";
import { dag, formaAvtal, type NdAvtal, type NdAvtalet, type RaAvtal } from "./avtalforma";

export type { NdAvtal } from "./avtalforma";

/**
 * Nav 2.0, Avtal: anställningsavtalen och mallarna, med den inloggades token.
 *
 * RLS i 0028 avgör vad som syns, som på `/avtal`: den som hanterar avtal ser
 * alla, och den anställda sina egna först när de är utfärdade. Filen (0073)
 * ärver avtalets läsrätt. Mallarna ser bara den som hanterar avtal.
 *
 * Två läsningar går med service role, och båda är smala:
 *   - Påminnelserna om påskriften är notiser till den anställda
 *     (`avtal-paminnelse`), som bara hen själv läser. Den som hanterar avtal får
 *     dagarna, inget annat, så att "påmint <datum>" och en om dagen går att visa.
 *   - Den egna månadslönen. `salary_basis` läses annars bara med
 *     lönekostnadsbehörighet; beställaren 2026-10-19: den anställda ser sin egen
 *     lön under Mitt avtal. Bara den egna raden, bara beloppet och från när.
 */
export async function byggAvtal(supabase: SupabaseClient, user: CurrentUser): Promise<NdAvtal> {
  const hanterar = hasRole(user, "sales_manager", "ceo", "admin");
  const mig = user.employee?.id ?? null;
  const db = supabaseAdmin();

  const [{ data: rader }, { data: filer }, { data: pam }, { data: mallar }, { data: lon }] = await Promise.all([
    supabase
      .from("contract")
      .select("id, employee_id, title, template_slug, source, body_md, variables, status, created_at, issued_at, withdrawn_at, withdrawn_reason")
      .order("created_at", { ascending: true })
      .limit(500),
    supabase
      .from("file_object")
      .select("id, contract_id, filename, mime_type, size_bytes")
      .eq("purpose", "employment_contract")
      .is("removed_at", null),
    hanterar
      ? db.from("notification_event").select("object_id, created_at").eq("kalla", "avtal-paminnelse").eq("object_type", "contract").order("created_at", { ascending: true })
      : Promise.resolve({ data: null }),
    hanterar
      ? supabase.from("contract_template").select("id, slug, title, status, employment_type, updated_at").neq("status", "archived").order("title")
      : Promise.resolve({ data: null }),
    mig
      ? db
          .from("salary_basis")
          .select("monthly_salary, valid_from")
          .eq("employee_id", mig)
          .lte("valid_from", svensktDatum())
          .order("valid_from", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const filPer = new Map<string, NdAvtalet["fil"]>();
  for (const f of (filer ?? []) as { id: string; contract_id: string | null; filename: string | null; mime_type: string | null; size_bytes: number | string | null }[]) {
    if (f.contract_id) filPer.set(f.contract_id, { id: f.id, namn: f.filename ?? "Avtalet", storlek: Number(f.size_bytes ?? 0), typ: f.mime_type ?? "" });
  }
  const pamPer = new Map<string, string[]>();
  for (const p of (pam ?? []) as { object_id: string | null; created_at: string }[]) {
    const d = dag(p.created_at);
    if (!d || !p.object_id) continue;
    const l = pamPer.get(p.object_id) ?? ([] as string[]);
    if (!l.includes(d)) l.push(d);
    pamPer.set(p.object_id, l);
  }
  const egen = lon as { monthly_salary: number | string | null; valid_from: string } | null;

  return {
    hanterar,
    avtal: ((rader ?? []) as RaAvtal[]).map((r) => formaAvtal(r, filPer.get(r.id) ?? null, pamPer.get(r.id) ?? [])),
    mallar: mallar
      ? (mallar as { id: string; slug: string; title: string; status: string; employment_type: string | null; updated_at: string }[]).map((m) => ({
          id: m.id,
          titel: m.title,
          slug: m.slug,
          status: m.status,
          andrad: dag(m.updated_at) ?? "",
          form: m.employment_type,
        }))
      : null,
    minLon: egen && Number(egen.monthly_salary) > 0 ? { belopp: Number(egen.monthly_salary), fran: egen.valid_from } : null,
    skriv: SKRIVLAGE.avtal,
  };
}
