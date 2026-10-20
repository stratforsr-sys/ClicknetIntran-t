import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fullName, hasRole, type CurrentUser } from "@/lib/auth";
import { hamtaLage } from "@/lib/sparrar";
import { stampelfri } from "@/lib/stampelfri";
import { svensktDatum } from "@/lib/klocka";
import { guiderForRoller } from "@/guider";
import { guideLage, personlage, type GuideLage, type Progress } from "@/lib/guider";
import type { Permission, Role } from "@/lib/roles";

/**
 * Nav 2.0: systemguiderna (beställaren 2026-10-20, svar 9), i Utbildning.
 *
 * Turerna står i registret (`src/guider/nav2.ts`), och framstegen i
 * `guide_progress` som förut (0040). Personen får turerna för sin roll, med
 * samma villkor som gamla Nav: `stamplar` = stämplingen påslagen och rollen
 * inte stämpelfri, och behörigheten för Satser och löner.
 *
 * Teamets läge (för knuffen i Teamet) räknas som gamla översikten: alla som
 * den inloggade ser enligt RLS, med var och ens egna turer som nämnare. Bara
 * för chefsrollerna, som gamla `/utbildning/oversikt/systemguider`.
 */

export type NdGuide = {
  slug: string;
  titel: string;
  besk: string;
  min: number;
  version: number;
  modul: string | null;
  start: boolean;
  lage: GuideLage;
  /** Steg avklarade i den fullständiga listan (guide_progress.steg). */
  sparat: number;
  steg: { ankare: string | null; mobil: string | null; rubrik: string; text: string; handling: string; bara: string | null; vag: string | null }[];
};

export type NdGuider = {
  lista: NdGuide[];
  team: null | { id: string; namn: string; klara: number; av: number; stilla: number | null; knuffad: boolean }[];
};

export async function byggGuider(supabase: SupabaseClient, user: CurrentUser): Promise<NdGuider> {
  const mig = user.employee!.id;
  const chef = hasRole(user, "sales_manager", "admin", "ceo", "team_lead");
  const idag = svensktDatum();
  const [lage, { data: rader }, teamRader] = await Promise.all([
    hamtaLage(),
    supabase.from("guide_progress").select("employee_id, guide_slug, version, steg, completed_at, updated_at"),
    chef
      ? Promise.all([
          supabase.from("employee").select("id, first_name, last_name, start_date, status").neq("status", "offboarded"),
          supabase.from("employee_role").select("employee_id, role"),
          supabase.from("employee_permission").select("employee_id, permission"),
          supabase.from("guide_nudge").select("employee_id, nudged_by, nudged_at").eq("nudged_by", mig),
        ])
      : null,
  ]);
  const alla = (rader ?? []) as (Progress & { employee_id: string })[];
  const mina = alla.filter((r) => r.employee_id === mig);
  const guider = guiderForRoller(user.roles, { stamplar: lage.stampling && !stampelfri(user.roles), behorigheter: user.permissions });
  const lista = guider.map((g): NdGuide => {
    const p = mina.find((r) => r.guide_slug === g.slug) ?? null;
    return {
      slug: g.slug,
      titel: g.titel,
      besk: g.beskrivning,
      min: g.minuter,
      version: g.version,
      modul: g.modul ?? null,
      start: Boolean(g.vidForstaInloggningen),
      lage: guideLage(g, p),
      sparat: p?.steg ?? 0,
      steg: g.steg.map((s) => ({ ankare: s.ankare ?? null, mobil: s.ankare_mobil ?? null, rubrik: s.rubrik, text: s.text, handling: s.handling, bara: s.bara ?? null, vag: s.vag ?? null })),
    };
  });
  if (!teamRader) return { lista, team: null };

  const [{ data: personal }, { data: roller }, { data: behorigheter }, { data: knuffar }] = teamRader;
  const rollPer = new Map<string, Role[]>();
  for (const r of (roller ?? []) as { employee_id: string; role: string }[]) rollPer.set(r.employee_id, [...(rollPer.get(r.employee_id) ?? []), r.role as Role]);
  const behPer = new Map<string, Permission[]>();
  for (const b of (behorigheter ?? []) as { employee_id: string; permission: string }[]) behPer.set(b.employee_id, [...(behPer.get(b.employee_id) ?? []), b.permission as Permission]);
  const knuffadIdag = new Set(((knuffar ?? []) as { employee_id: string; nudged_at: string }[]).filter((k) => svensktDatum(k.nudged_at) === idag).map((k) => k.employee_id));
  const team = ((personal ?? []) as { id: string; first_name: string; last_name: string; start_date: string | null; status: string }[])
    .filter((p) => p.id !== mig)
    .map((p) => {
      const r = rollPer.get(p.id) ?? [];
      const deras = guiderForRoller(r, { stamplar: lage.stampling && !stampelfri(r), behorigheter: behPer.get(p.id) ?? [] });
      const l = personlage(deras, alla.filter((x) => x.employee_id === p.id), p.start_date);
      return { id: p.id, namn: fullName(p), klara: l.klara, av: l.av, stilla: l.stillestand, knuffad: knuffadIdag.has(p.id), onboardad: l.onboardad };
    })
    .filter((p) => !p.onboardad && p.av > 0)
    .map(({ onboardad: _o, ...p }) => p)
    .sort((a, b) => a.namn.localeCompare(b.namn, "sv"));
  return { lista, team };
}
