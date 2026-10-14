import "server-only";

import type { CurrentUser } from "@/lib/auth";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { hamtaNotiser } from "@/lib/notiser-server";
import type { Notis } from "@/lib/notiser";
import { svensktDatum } from "@/lib/klocka";
import { MFA_REQUIRED_ROLES } from "@/lib/roles";
import { byggTid, type NdTid } from "./tid";
import { byggFranvaro, type NdFranvaro } from "./franvaro";
import { byggUppgifter, type NdUppgifter } from "./uppgifter";
import {
  formaLon,
  formaPerson,
  formaSats,
  heltNamn,
  nivaFor,
  type NdLon,
  type NdPerson,
  type NdSats,
  type Niva,
  type RaLon,
  type RaPerson,
  type RaSats,
} from "./forma";

/**
 * Nav 2.0: allt utkastet behover for den som ar inloggad, i en enda last.
 *
 * ===========================================================================
 * LASES MED ANVANDARENS EGEN TOKEN. RLS avgor vad som syns, precis som pa
 * varje annan sida i navet — en saljare far sin egen rad i `employee`, en chef
 * hela registret, och satser och loner bara den med `payroll_cost_viewer`.
 * Det utkastet visar ar alltsa aldrig mer an det navet redan visar.
 *
 * Det enda undantaget ar chefens NAMN for den som inte far lasa chefens rad.
 * Navet visar det redan pa flera stallen (ringordningen vid sjukanmalan, "Vantar
 * pa"), och utkastet behover det for att kunna saga vem som ska svara. Bara
 * for- och efternamn, och bara for den chef som star pa den egna raden.
 * ===========================================================================
 *
 * Skrivningar finns inte har. Utkastet ar i lasläge tills bestallaren sager ja,
 * vy for vy (beslut 2026-10-14).
 */

export type Nav2Data = {
  v: 1;
  /** Serverns tid, sa att klienten kan se om dess klocka gar fel. */
  nu: string;
  idag: string;
  jag: NdPerson & { niva: Niva; behorigheter: string[]; chefFornamn: string | null; kodKravs: boolean };
  personer: NdPerson[];
  /** Null = ingen behorighet att lasa satser (K26). Tom lista = behorighet men inga rader. */
  satser: NdSats[] | null;
  loner: NdLon[] | null;
  notiser: Notis[];
  tid: NdTid;
  franvaro: NdFranvaro;
  uppgifter: NdUppgifter;
};

const PERSONKOLUMNER =
  "id, first_name, last_name, email, status, employment_type, start_date, end_date, employee_number, last_sign_in_at, birth_year, team_id, manager_id," +
  " employee_role!employee_role_employee_id_fkey(role)";

export async function byggNav2Data(user: CurrentUser): Promise<Nav2Data | null> {
  if (!user.employee) return null;
  const supabase = await supabaseServer();

  const [{ data: personRader }, { data: teamRader }, { data: satsRader, error: satsFel }, { data: lonRader, error: lonFel }, notiser, tid, franvaro, uppgifter] =
    await Promise.all([
      supabase.from("employee").select(PERSONKOLUMNER).order("first_name"),
      supabase.from("team").select("id, name"),
      supabase
        .from("cost_rate")
        .select("id, kind, applies_to, unit, value, valid_from, valid_to, owner_id, review_due, note, created_at, created_by")
        .order("kind")
        .order("valid_from", { ascending: false }),
      supabase
        .from("salary_basis")
        .select("id, employee_id, monthly_salary, valid_from, entered_at, entered_by")
        .order("valid_from", { ascending: false }),
      hamtaNotiser(user),
      byggTid(supabase, user),
      byggFranvaro(supabase, user),
      byggUppgifter(supabase, user),
    ]);

  const ra: RaPerson[] = ((personRader ?? []) as unknown as (Omit<RaPerson, "roller"> & {
    employee_role: { role: string }[] | null;
  })[]).map((p) => ({ ...p, roller: (p.employee_role ?? []).map((r) => r.role) }));

  const team = new Map((teamRader ?? []).map((t) => [t.id as string, t.name as string]));
  const namn = new Map(ra.map((p) => [p.id, heltNamn(p.first_name, p.last_name)]));

  // Chefens namn for den som inte ser chefens rad. Se rubriken.
  const egen = ra.find((p) => p.id === user.employee!.id);
  let chefFornamn: string | null = null;
  if (egen?.manager_id) {
    if (!namn.has(egen.manager_id)) {
      const { data: chef } = await supabaseAdmin()
        .from("employee")
        .select("id, first_name, last_name")
        .eq("id", egen.manager_id)
        .maybeSingle();
      if (chef) namn.set(chef.id, heltNamn(chef.first_name, chef.last_name));
      chefFornamn = chef ? (chef.first_name ?? "").trim() || null : null;
    } else {
      chefFornamn = (ra.find((p) => p.id === egen.manager_id)?.first_name ?? "").trim() || null;
    }
  }

  const personer = ra.map((p) => formaPerson(p, team, namn));
  const jagPerson =
    personer.find((p) => p.id === user.employee!.id) ??
    formaPerson(
      {
        id: user.employee.id,
        first_name: user.employee.first_name,
        last_name: user.employee.last_name,
        email: user.employee.email,
        status: user.employee.status,
        employment_type: user.employee.employment_type,
        start_date: user.employee.start_date,
        end_date: null,
        employee_number: null,
        last_sign_in_at: null,
        birth_year: null,
        team_id: user.employee.team_id,
        manager_id: null,
        roller: user.roles,
      },
      team,
      namn,
    );

  return {
    v: 1,
    nu: new Date().toISOString(),
    idag: svensktDatum(),
    jag: {
      ...jagPerson,
      niva: nivaFor(user.roles),
      behorigheter: user.permissions,
      chefFornamn,
      // Samma regel som mellanvarans behoverSteg2(): en tom lista betyder att kravet ar avstangt for alla.
      kodKravs:
        MFA_REQUIRED_ROLES.length > 0 &&
        (user.roles.some((r) => (MFA_REQUIRED_ROLES as string[]).includes(r)) || user.permissions.includes("payroll_cost_viewer")),
    },
    personer,
    // RLS ger noll rader utan behorigheten och ett fel ar ett fel — inget av
    // dem far se ut som "inga satser". Null sager att listan inte gick att lasa.
    satser: satsFel || !user.permissions.includes("payroll_cost_viewer") ? null : ((satsRader ?? []) as RaSats[]).map((r) => formaSats(r, namn)),
    loner: lonFel || !user.permissions.includes("payroll_cost_viewer") ? null : ((lonRader ?? []) as RaLon[]).map((r) => formaLon(r, namn)),
    notiser,
    tid,
    franvaro,
    uppgifter,
  };
}
