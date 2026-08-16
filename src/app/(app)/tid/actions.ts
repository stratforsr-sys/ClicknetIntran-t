"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { getCurrentUser, canManageEmployees } from "@/lib/auth";
import {
  M2_AKTIV,
  RAST_AKTIV,
  dygnetsStart,
  lageNu,
  tillaten,
  type Handelse,
  type Stamptyp,
} from "@/lib/tid";

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
  if (!M2_AKTIV) return { fel: "Stämplingen är inte påslagen än." };

  const user = await getCurrentUser();
  if (!user?.employee) return { fel: "Du måste vara inloggad." };
  if (user.employee.status === "offboarded") return { fel: "Anställningen är avslutad." };

  const typ = String(form.get("typ") ?? "") as Stamptyp;
  if (!TYPER.includes(typ)) return { fel: "Okänd stämpling." };
  if (!RAST_AKTIV && (typ === "break_start" || typ === "break_end"))
    return { fel: "Raststämpling är inte påslagen." };

  const handelser = await dagens(user.employee.id);
  const lage = lageNu(handelser);
  if (!tillaten(lage, typ)) {
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
  if (!M2_AKTIV) return { fel: "Stämplingen är inte påslagen än." };

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
