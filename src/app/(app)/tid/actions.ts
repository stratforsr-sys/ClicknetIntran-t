"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { getCurrentUser, canManageEmployees } from "@/lib/auth";
import {
  dygnetsStart,
  lageNu,
  tillaten,
  type Handelse,
  type Stamptyp,
} from "@/lib/tid";
import { hamtaLage } from "@/lib/sparrar";

export type TidState = { fel?: string; ok?: string };

const TYPER: Stamptyp[] = ["in", "out", "break_start", "break_end"];

async function logga(
  actorId: string,
  action: string,
  objectId: string,
  meta?: Record<string, unknown>,
) {
  await supabaseAdmin().from("audit_log").insert({
    actor_id: actorId,
    action,
    object_type: "time_event",
    object_id: objectId,
    meta: meta ?? null,
  });
}

/** Dagens händelser för en person, lästa via RLS. */
async function dagens(employeeId: string): Promise<Handelse[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("time_event")
    .select("id, kind, occurred_at, source, supersedes_id, correction_state")
    .eq("employee_id", employeeId)
    .gte("occurred_at", dygnetsStart())
    .order("occurred_at");
  return data ?? [];
}

/**
 * AC-2.1. Knappen skickar bara VAD som hände — tiden sätts av servern och
 * läget räknas fram där. En klient som ljuger om sitt läge kommer alltså inte
 * längre än till ett nej.
 *
 * AC-2.9: ingen position efterfrågas, tas emot eller lagras. Enda spåret av
 * var någon befann sig är `source`, och det säger 'app' eller 'kiosk'.
 */
export async function stampla(_prev: TidState, form: FormData): Promise<TidState> {
  const sparr = await hamtaLage();
  if (!sparr.stampling) return { fel: "Stämplingen är avstängd just nu." };

  const user = await getCurrentUser();
  if (!user?.employee) return { fel: "Du måste vara inloggad." };
  if (user.employee.status === "offboarded") return { fel: "Anställningen är avslutad." };

  const typ = String(form.get("typ") ?? "") as Stamptyp;
  if (!TYPER.includes(typ)) return { fel: "Okänd stämpling." };
  if (!sparr.rast && (typ === "break_start" || typ === "break_end"))
    return { fel: "Raststämpling är inte påslagen." };

  const handelser = await dagens(user.employee.id);
  const lage = lageNu(handelser);
  if (!tillaten(lage, typ, sparr.rast)) {
    return { fel: "Det gick inte — sidan visade ett annat läge. Ladda om och försök igen." };
  }

  // AC-2.2: en stampling som gjorts utan nat behaller sin ursprungliga tid.
  // Den far ligga hogst ett dygn tillbaka och aldrig i framtiden — annars vore
  // faltet en vag att skriva vilken tid som helst.
  const koad = String(form.get("skedde_vid") ?? "").trim();
  const nu = new Date();
  let skedde = nu;
  let kalla: "app" | "offline_queue" = "app";

  if (koad) {
    const t = new Date(koad);
    const rimlig =
      !Number.isNaN(t.getTime()) &&
      t <= nu &&
      nu.getTime() - t.getTime() <= 24 * 60 * 60 * 1000;
    if (rimlig) {
      skedde = t;
      kalla = "offline_queue";
    }
  }

  const { data: rad, error } = await supabaseAdmin()
    .from("time_event")
    .insert({
      employee_id: user.employee.id,
      kind: typ,
      occurred_at: skedde.toISOString(),
      source: kalla,
    })
    .select("id")
    .single();

  if (error || !rad) return { fel: "Stämplingen gick inte igenom. Försök igen." };

  await logga(user.employee.id, `time.${typ}`, rad.id, {
    kalla,
    i_efterhand: kalla === "offline_queue" ? Math.round((nu.getTime() - skedde.getTime()) / 1000) : 0,
  });

  revalidatePath("/tid", "layout");
  revalidatePath("/");
  return { ok: "Registrerat." };
}

/**
 * AC-2.5, första ledet: den anställda begär en rättelse. Den skapas som en ny
 * rad som pekar på den gamla — den gamla rörs inte, och båda syns i
 * historiken.
 */
export async function begarRattelse(_prev: TidState, form: FormData): Promise<TidState> {
  const sparr = await hamtaLage();
  if (!sparr.stampling) return { fel: "Stämplingen är avstängd just nu." };

  const user = await getCurrentUser();
  if (!user?.employee) return { fel: "Du måste vara inloggad." };

  const ersatter = String(form.get("ersatter") ?? "");
  const tid = String(form.get("tid") ?? "").trim();
  const motivering = String(form.get("motivering") ?? "").trim();

  if (!ersatter || !tid) return { fel: "Fyll i vilken tid det skulle ha varit." };
  if (!motivering) return { fel: "Skriv varför tiden behöver rättas." };

  const rls = await supabaseServer();
  const { data: original } = await rls
    .from("time_event")
    .select("id, employee_id, kind, occurred_at")
    .eq("id", ersatter)
    .maybeSingle();

  // Egna stamplingar, och bara egna. Chefen rattar inte at nagon annan i tysthet.
  if (!original || original.employee_id !== user.employee.id)
    return { fel: "Stämplingen hittades inte." };

  const ny = new Date(tid);
  if (Number.isNaN(ny.getTime()) || ny > new Date())
    return { fel: "Tiden är inte giltig, eller ligger i framtiden." };

  const { data: rad, error } = await supabaseAdmin()
    .from("time_event")
    .insert({
      employee_id: user.employee.id,
      kind: original.kind,
      occurred_at: ny.toISOString(),
      source: "correction",
      supersedes_id: original.id,
      correction_state: "pending",
      requested_by: user.employee.id,
      note: motivering,
    })
    .select("id")
    .single();

  if (error || !rad) return { fel: "Begäran kunde inte skickas." };

  await logga(user.employee.id, "time.correction_requested", rad.id, {
    ersatter: original.id,
    fran: original.occurred_at,
    till: ny.toISOString(),
  });

  revalidatePath("/tid", "layout");
  return { ok: "Skickat till din chef." };
}

/** AC-2.5, andra ledet: chefen beslutar. Beslutet är slutgiltigt. */
export async function beslutaRattelse(form: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!canManageEmployees(user) || !user?.employee) {
    throw new Error("Bara chef får besluta om en rättelse.");
  }

  const id = String(form.get("rattelse_id"));
  const godkann = String(form.get("beslut")) === "godkann";
  if (!id) return;

  const { error } = await supabaseAdmin()
    .from("time_event")
    .update({
      correction_state: godkann ? "approved" : "rejected",
      decided_by: user.employee.id,
      decided_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("correction_state", "pending");

  if (error) return;

  await logga(user.employee.id, godkann ? "time.correction_approved" : "time.correction_rejected", id);
  revalidatePath("/tid", "layout");
}

// -----------------------------------------------------------------------------
// Scheman (AC-2.34, AC-2.35, AC-2.36)
//
// Ett schema ändras aldrig. Varje ändring är en NY rad med nytt `valid_from`,
// och den gamla står kvar. Utan det kan en ändring i efterhand skapa
// avvikelser för någon som följde reglerna som gällde då — AC-2.35 kallar det
// ett hårt krav, och det är den enda regeln i M2 som inte går att mjuka upp.
// -----------------------------------------------------------------------------

async function kravSchemaansvarig() {
  const user = await getCurrentUser();
  if (!canManageEmployees(user) || !user?.employee) {
    throw new Error("Bara säljchef och administratör får ändra scheman.");
  }
  return user;
}

function niva(form: FormData) {
  const scope = String(form.get("scope") ?? "company");
  const id = String(form.get("scope_id") ?? "") || null;
  return {
    scope,
    employee_id: scope === "employee" ? id : null,
    team_id: scope === "team" ? id : null,
  };
}

export async function sparaArbetsschema(_prev: TidState, form: FormData): Promise<TidState> {
  const user = await kravSchemaansvarig();
  const { scope, employee_id, team_id } = niva(form);

  const veckodagar = form.getAll("veckodag").map(Number).filter((d) => d >= 1 && d <= 7);
  const start = String(form.get("start_time") ?? "");
  const slut = String(form.get("end_time") ?? "");
  const galler = String(form.get("valid_from") ?? "") || new Date().toISOString().slice(0, 10);
  const tolLate = Number(form.get("tol_late") ?? 1);

  if (veckodagar.length === 0) return { fel: "Välj minst en veckodag." };
  if (!start || !slut) return { fel: "Fyll i både start och slut." };
  if (slut <= start) return { fel: "Sluttiden måste ligga efter starttiden." };
  // Noll slapps inte igenom. Sekundskillnader mellan telefon och server hade
  // gjort systemet till en logg over folk som var i tid.
  if (!Number.isInteger(tolLate) || tolLate < 1)
    return { fel: "Toleransen för sen ankomst måste vara minst 1 minut." };
  if (scope !== "company" && !(employee_id ?? team_id))
    return { fel: "Välj vem schemat gäller." };

  const { error } = await supabaseAdmin()
    .from("work_schedule")
    .insert(
      veckodagar.map((weekday) => ({
        scope,
        employee_id,
        team_id,
        weekday,
        start_time: start,
        end_time: slut,
        tol_late: tolLate,
        valid_from: galler,
        created_by: user.employee!.id,
      })),
    );

  if (error) return { fel: "Schemat kunde inte sparas." };

  await logga(user.employee!.id, "schedule.work_set", employee_id ?? team_id ?? "company", {
    scope,
    veckodagar,
    start,
    slut,
    tolerans_sen: tolLate,
    galler_fran: galler,
  });
  revalidatePath("/tid", "layout");
  return { ok: `Sparat. Gäller från ${galler}.` };
}

export async function sparaRastschema(_prev: TidState, form: FormData): Promise<TidState> {
  const user = await kravSchemaansvarig();
  const { scope, employee_id, team_id } = niva(form);

  const veckodagar = form.getAll("veckodag").map(Number).filter((d) => d >= 1 && d <= 7);
  const fonsterStart = String(form.get("window_start") ?? "");
  const fonsterSlut = String(form.get("window_end") ?? "");
  const langd = Number(form.get("duration_minutes") ?? 30);
  const ordning = Number(form.get("sort") ?? 1);
  const galler = String(form.get("valid_from") ?? "") || new Date().toISOString().slice(0, 10);

  // AC-2.26 sager minst fem minuter. Sankt till en pa bestallning 2026-08-17 —
  // en medveten avvikelse fran PRD:n, se migration 0014. Gransen ligger i
  // databasen ocksa.
  const tol = Math.max(1, Number(form.get("tolerans") ?? 1));

  if (veckodagar.length === 0) return { fel: "Välj minst en veckodag." };
  if (!fonsterStart || !fonsterSlut) return { fel: "Fyll i tidsfönstret." };
  if (fonsterSlut < fonsterStart) return { fel: "Fönstret slutar före det börjar." };
  if (!Number.isFinite(langd) || langd < 1) return { fel: "Rastens längd måste vara minst en minut." };
  if (scope !== "company" && !(employee_id ?? team_id))
    return { fel: "Välj vem schemat gäller." };

  const { error } = await supabaseAdmin()
    .from("scheduled_break")
    .insert(
      veckodagar.map((weekday) => ({
        scope,
        employee_id,
        team_id,
        weekday,
        sort: ordning,
        window_start: fonsterStart,
        window_end: fonsterSlut,
        duration_minutes: Math.round(langd),
        tol_early_start: tol,
        tol_overrun: tol,
        tol_missing: tol,
        valid_from: galler,
        created_by: user.employee!.id,
      })),
    );

  if (error) return { fel: "Rastschemat kunde inte sparas." };

  await logga(user.employee!.id, "schedule.break_set", employee_id ?? team_id ?? "company", {
    scope,
    veckodagar,
    fonster: `${fonsterStart}–${fonsterSlut}`,
    langd,
    tolerans: tol,
    galler_fran: galler,
  });
  revalidatePath("/tid", "layout");
  return { ok: `Sparat. Gäller från ${galler}. Avvikelser börjar först när berörda kvitterat.` };
}

/** AC-2.36: utan kvittens bedöms ingenting. Tystnad är inte ett godkännande. */
export async function kvitteraRastschema(form: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user?.employee) return;

  const schemaId = String(form.get("schema_id"));
  if (!schemaId) return;

  // Bara scheman som faktiskt galler den inloggade — RLS avgor.
  const rls = await supabaseServer();
  const { data: schema } = await rls
    .from("scheduled_break")
    .select("id")
    .eq("id", schemaId)
    .maybeSingle();
  if (!schema) return;

  await supabaseAdmin()
    .from("break_schedule_ack")
    .upsert(
      { schedule_id: schemaId, employee_id: user.employee.id },
      { onConflict: "schedule_id,employee_id" },
    );

  await logga(user.employee.id, "schedule.break_acked", schemaId);
  revalidatePath("/tid", "layout");
}

/** AC-2.28: den anställda ser sina avvikelser i sin helhet och kan kommentera. */
export async function kommenteraAvvikelse(form: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user?.employee) return;

  const id = String(form.get("avvikelse_id"));
  const text = String(form.get("kommentar") ?? "").trim();
  if (!id || !text) return;

  await supabaseAdmin()
    .from("break_deviation")
    .update({ employee_comment: text })
    .eq("id", id)
    .eq("employee_id", user.employee.id);

  await logga(user.employee.id, "deviation.commented", id);
  revalidatePath("/tid", "layout");
}
