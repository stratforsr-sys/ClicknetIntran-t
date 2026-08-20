"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import type { FranvaroState } from "../actions";

/**
 * E7.17 / AC-3.11: reglerna konfigureras i gränssnittet.
 *
 * Handlingarna här skriver till `absence_type`, `absence_policy`,
 * `absence_blackout` och `staffing_cap`. Det finns inget annat ställe där
 * reglerna kan ändras — ingen konstant i koden och ingen miljövariabel — och
 * det är hela poängen med E7.15.
 *
 * Varje ändring loggas. En frist som flyttades i somras förklarar varför en
 * ansökan i juli inte bröt mot något, och utan raden i loggen ser det ut som
 * att motorn räknade fel.
 */

function farAndra(user: Awaited<ReturnType<typeof getCurrentUser>>): boolean {
  return hasRole(user, "sales_manager", "ceo", "admin");
}

export async function sparaTyp(_prev: FranvaroState, form: FormData): Promise<FranvaroState> {
  const user = await getCurrentUser();
  if (!farAndra(user)) return { fel: "Reglerna ändras av säljchef, VD eller administratör." };

  const id = String(form.get("id") ?? "");
  const tal = (namn: string) => {
    const v = form.get(namn);
    return v === null || String(v).trim() === "" ? null : Number(v);
  };

  const notice = tal("notice_days") ?? 0;
  const maxDagar = tal("max_consecutive_days");
  const karens = tal("waiting_days") ?? 0;
  const niva = String(form.get("approval_level") ?? "manager");

  if (notice < 0 || karens < 0) return { fel: "Frister kan inte vara negativa." };
  if (maxDagar !== null && maxDagar <= 0) return { fel: "Maxlängden ska vara minst en dag." };
  if (!["manager", "sales_manager", "ceo"].includes(niva)) return { fel: "Okänd attestnivå." };

  const db = supabaseAdmin();
  const { data: fore } = await db.from("absence_type").select("*").eq("id", id).maybeSingle();
  if (!fore) return { fel: "Typen finns inte." };

  const { error } = await db
    .from("absence_type")
    .update({
      notice_days: notice,
      max_consecutive_days: maxDagar,
      waiting_days: karens,
      approval_level: niva,
      counts_in_staffing: form.get("counts_in_staffing") === "1",
      allows_part_day: form.get("allows_part_day") === "1",
      active: form.get("active") === "1",
    })
    .eq("id", id);

  if (error) return { fel: error.message };

  await db.from("audit_log").insert({
    actor_id: user!.employee!.id,
    action: "absence.type_changed",
    object_type: "absence_type",
    object_id: id,
    meta: { fore: { notice_days: fore.notice_days, approval_level: fore.approval_level }, efter: { notice_days: notice, approval_level: niva } },
  });

  revalidatePath("/franvaro/regler");
  revalidatePath("/franvaro/ny");
  return { ok: `Reglerna för ${fore.label} är sparade.` };
}

export async function sparaPolicy(_prev: FranvaroState, form: FormData): Promise<FranvaroState> {
  const user = await getCurrentUser();
  if (!farAndra(user)) return { fel: "Reglerna ändras av säljchef, VD eller administratör." };

  const tal = (namn: string, min: number, max: number) => {
    const v = Number(form.get(namn));
    return Number.isInteger(v) && v >= min && v <= max ? v : null;
  };

  const falt = {
    vacation_year_start_month: tal("vacation_year_start_month", 1, 12),
    vacation_year_start_day: tal("vacation_year_start_day", 1, 28),
    main_vacation_start_month: tal("main_vacation_start_month", 1, 12),
    main_vacation_start_day: tal("main_vacation_start_day", 1, 31),
    main_vacation_end_month: tal("main_vacation_end_month", 1, 12),
    main_vacation_end_day: tal("main_vacation_end_day", 1, 31),
    main_vacation_notice_days: tal("main_vacation_notice_days", 0, 365),
    saved_days_max_years: tal("saved_days_max_years", 1, 20),
    balance_stale_days: tal("balance_stale_days", 1, 365),
    sick_certificate_day: tal("sick_certificate_day", 1, 365),
    sick_fk_day: tal("sick_fk_day", 1, 365),
    sick_return_plan_day: tal("sick_return_plan_day", 1, 365),
    sick_confirm_hours: tal("sick_confirm_hours", 1, 720),
    relapse_days: tal("relapse_days", 1, 90),
    repeat_sick_count: tal("repeat_sick_count", 1, 50),
    repeat_sick_months: tal("repeat_sick_months", 1, 60),
    unregistered_reminder_hours: tal("unregistered_reminder_hours", 0, 720),
  };

  const saknas = Object.entries(falt).filter(([, v]) => v === null).map(([k]) => k);
  if (saknas.length > 0) return { fel: `Ogiltigt värde: ${saknas.join(", ")}.` };

  const db = supabaseAdmin();
  const { error } = await db
    .from("absence_policy")
    .update({ ...falt, updated_by: user!.employee!.id, updated_at: new Date().toISOString() })
    .eq("id", true);

  if (error) return { fel: error.message };

  await db.from("audit_log").insert({
    actor_id: user!.employee!.id,
    action: "absence.policy_changed",
    object_type: "absence_policy",
    object_id: "policy",
    meta: falt,
  });

  revalidatePath("/franvaro/regler");
  return { ok: "Reglerna är sparade." };
}

export async function sparaSparrperiod(_prev: FranvaroState, form: FormData): Promise<FranvaroState> {
  const user = await getCurrentUser();
  if (!farAndra(user)) return { fel: "Spärrperioder sätts av säljchef, VD eller administratör." };

  const taBort = String(form.get("ta_bort") ?? "");
  const db = supabaseAdmin();

  if (taBort) {
    const { error } = await db.from("absence_blackout").delete().eq("id", taBort);
    if (error) return { fel: error.message };

    await db.from("audit_log").insert({
      actor_id: user!.employee!.id,
      action: "absence.blackout_removed",
      object_type: "absence_blackout",
      object_id: taBort,
    });

    revalidatePath("/franvaro/regler");
    return { ok: "Spärrperioden är borttagen." };
  }

  // Rubriken beskriver PERIODEN, aldrig en person. Se K35-rubriken i 0019.
  const label = String(form.get("label") ?? "").trim();
  const fran = String(form.get("starts_on") ?? "");
  const till = String(form.get("ends_on") ?? "");
  const typer = form.getAll("type_ids").map(String).filter(Boolean);
  const team = form.getAll("team_ids").map(String).filter(Boolean);

  if (!label) return { fel: "Ge perioden ett namn, till exempel „Kampanjvecka 45”." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fran) || !/^\d{4}-\d{2}-\d{2}$/.test(till))
    return { fel: "Ange både start och slut." };
  if (till < fran) return { fel: "Slutet ligger före starten." };

  const { error } = await db.from("absence_blackout").insert({
    label,
    starts_on: fran,
    ends_on: till,
    type_ids: typer,
    team_ids: team,
    created_by: user!.employee!.id,
  });

  if (error) return { fel: error.message };

  await db.from("audit_log").insert({
    actor_id: user!.employee!.id,
    action: "absence.blackout_added",
    object_type: "absence_blackout",
    object_id: label,
    meta: { fran, till, typer, team },
  });

  revalidatePath("/franvaro/regler");
  return { ok: "Spärrperioden är sparad." };
}

export async function sparaTak(_prev: FranvaroState, form: FormData): Promise<FranvaroState> {
  const user = await getCurrentUser();
  if (!farAndra(user)) return { fel: "Bemanningstak sätts av säljchef, VD eller administratör." };

  const teamId = String(form.get("team_id") ?? "") || null;
  const rad = String(form.get("max_absent") ?? "").trim();
  const db = supabaseAdmin();

  // Tomt fält betyder inget tak. Ett tak på noll är något annat: då varnar
  // systemet för varje ansökan, vilket är en giltig men annan sak att vilja.
  if (rad === "") {
    const q = db.from("staffing_cap").delete();
    const { error } = await (teamId ? q.eq("team_id", teamId) : q.is("team_id", null));
    if (error) return { fel: error.message };
    revalidatePath("/franvaro/regler");
    return { ok: "Taket är borttaget." };
  }

  const max = Number(rad);
  if (!Number.isInteger(max) || max < 0) return { fel: "Taket ska vara ett heltal." };

  // `upsert` duger inte: unikheten ligger i ett uttrycksindex over
  // coalesce(team_id, ...), och PostgREST kan inte peka pa ett sadant.
  const finns = teamId
    ? await db.from("staffing_cap").select("id").eq("team_id", teamId).maybeSingle()
    : await db.from("staffing_cap").select("id").is("team_id", null).maybeSingle();

  const { error } = finns.data
    ? await db.from("staffing_cap").update({ max_absent: max }).eq("id", finns.data.id)
    : await db.from("staffing_cap").insert({ team_id: teamId, max_absent: max, created_by: user!.employee!.id });

  if (error) return { fel: error.message };

  await db.from("audit_log").insert({
    actor_id: user!.employee!.id,
    action: "absence.cap_changed",
    object_type: "staffing_cap",
    object_id: teamId ?? "bolaget",
    meta: { max_absent: max },
  });

  revalidatePath("/franvaro/regler");
  return { ok: "Taket är sparat." };
}

export async function sparaRingordning(_prev: FranvaroState, form: FormData): Promise<FranvaroState> {
  const user = await getCurrentUser();
  if (!farAndra(user)) return { fel: "Mottagarordningen sätts av säljchef, VD eller administratör." };

  const db = supabaseAdmin();
  const taBort = String(form.get("ta_bort") ?? "");

  if (taBort) {
    const { error } = await db.from("absence_call_order").delete().eq("id", taBort);
    if (error) return { fel: error.message };
    revalidatePath("/franvaro/regler");
    revalidatePath("/franvaro/sjuk");
    return { ok: "Posten är borttagen." };
  }

  const sort = Number(form.get("sort") ?? 0);
  const kind = String(form.get("target_kind") ?? "");
  const roll = String(form.get("role") ?? "") || null;
  const person = String(form.get("employee_id") ?? "") || null;
  const telefon = String(form.get("phone") ?? "").trim() || null;

  if (!Number.isInteger(sort) || sort < 1) return { fel: "Ange vilken plats i ordningen." };
  if (!["manager", "role", "person"].includes(kind)) return { fel: "Välj vem som ska ringas." };
  if (kind === "role" && !roll) return { fel: "Välj en roll." };
  if (kind === "person" && !person) return { fel: "Välj en person." };

  const { error } = await db.from("absence_call_order").insert({
    sort,
    target_kind: kind,
    role: kind === "role" ? roll : null,
    employee_id: kind === "person" ? person : null,
    phone: telefon,
    created_by: user!.employee!.id,
  });

  if (error) {
    if (error.message.includes("absence_call_order_plats_idx"))
      return { fel: `Plats ${sort} är redan tagen.` };
    return { fel: error.message };
  }

  await db.from("audit_log").insert({
    actor_id: user!.employee!.id,
    action: "absence.call_order_changed",
    object_type: "absence_call_order",
    object_id: String(sort),
    meta: { kind, roll, person },
  });

  revalidatePath("/franvaro/regler");
  revalidatePath("/franvaro/sjuk");
  return { ok: "Mottagarordningen är uppdaterad." };
}
