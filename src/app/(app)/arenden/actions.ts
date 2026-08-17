"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { frist, type Status } from "@/lib/arenden";

export type ArendeState = { fel?: string; ok?: string };

/**
 * AC-4.3: den som får hantera andras ärenden är säljchef och VD. Ingen annan —
 * administratörsrollen är teknisk, och ett konfliktärende är inget driftärende.
 */
function farHantera(user: Awaited<ReturnType<typeof getCurrentUser>>): boolean {
  return hasRole(user, "sales_manager", "ceo");
}

/** Läser ärendet med samma gräns som RLS, men på servern. */
async function hamtaArende(id: string, employeeId: string, hanterare: boolean) {
  const { data } = await supabaseAdmin()
    .from("hr_case")
    .select("id, employee_id, assigned_to, confidential, status, subject")
    .eq("id", id)
    .maybeSingle();

  if (!data) return null;
  if (data.employee_id === employeeId) return data;
  if (data.confidential) return hanterare ? data : null;
  if (data.assigned_to === employeeId) return data;
  return hanterare ? data : null;
}

export async function skapaArende(_prev: ArendeState, form: FormData): Promise<ArendeState> {
  let nyId: string;
  try {
    const user = await getCurrentUser();
    if (!user?.employee) return { fel: "Du måste vara inloggad." };

    const db = supabaseAdmin();
    const kategori = String(form.get("kategori") ?? "");
    const rubrik = String(form.get("rubrik") ?? "").trim();
    const text = String(form.get("text") ?? "").trim();
    const konfidentiellt = form.get("konfidentiellt") === "1";

    if (!rubrik) return { fel: "Skriv en rubrik." };
    if (text.length < 5) return { fel: "Beskriv ärendet med några ord." };

    const { data: kat } = await db
      .from("case_category")
      .select("id, sla_hours")
      .eq("id", kategori)
      .maybeSingle();

    if (!kat) return { fel: "Välj en kategori." };

    const nu = new Date();
    const { data: rad, error } = await db
      .from("hr_case")
      .insert({
        employee_id: user.employee.id,
        created_by: user.employee.id,
        category: kat.id,
        subject: rubrik,
        confidential: konfidentiellt,
        sla_hours: kat.sla_hours,
        due_at: frist(nu, kat.sla_hours),
      })
      .select("id")
      .single();

    if (error || !rad) return { fel: `Ärendet kunde inte skapas: ${error?.message ?? "okänt fel"}` };

    await db.from("case_message").insert({
      case_id: rad.id,
      author_id: user.employee.id,
      body: text,
    });

    // AC-4.3: loggen bär aldrig rubriken på ett konfidentiellt ärende. Den som
    // läser händelseloggen ska se att ett ärende skapades, inte vad det gällde.
    await db.from("audit_log").insert({
      actor_id: user.employee.id,
      action: "case.created",
      object_type: "hr_case",
      object_id: rad.id,
      meta: { kategori: kat.id, konfidentiellt },
    });

    nyId = rad.id;
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }

  revalidatePath("/arenden");
  redirect(`/arenden/${nyId}`);
}

export async function svara(form: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user?.employee) throw new Error("Du måste vara inloggad.");

  const id = String(form.get("arende_id") ?? "");
  const text = String(form.get("text") ?? "").trim();
  if (!text) return;

  const arende = await hamtaArende(id, user.employee.id, farHantera(user));
  if (!arende) throw new Error("Ärendet finns inte, eller så är det inte ditt.");

  const db = supabaseAdmin();
  await db.from("case_message").insert({ case_id: id, author_id: user.employee.id, body: text });

  // Ett svar från handläggaren sätter ärendet i "väntar på svar", ett svar från
  // den anställda tar det tillbaka till "pågår". Statusen ska följa samtalet
  // utan att någon behöver komma ihåg att ändra den.
  const nyStatus: Status =
    arende.employee_id === user.employee.id
      ? arende.status === "new"
        ? "new"
        : "in_progress"
      : "waiting";

  if (arende.status !== "resolved" && nyStatus !== arende.status) {
    await db.from("hr_case").update({ status: nyStatus }).eq("id", id);
  }

  revalidatePath(`/arenden/${id}`);
}

export async function andraStatus(form: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user?.employee || !farHantera(user)) throw new Error("Du saknar behörighet.");

  const id = String(form.get("arende_id") ?? "");
  const status = String(form.get("status") ?? "") as Status;
  if (!["new", "in_progress", "waiting", "resolved"].includes(status)) return;

  const db = supabaseAdmin();
  const losning = String(form.get("losning") ?? "").trim() || null;

  await db
    .from("hr_case")
    .update({
      status,
      resolved_at: status === "resolved" ? new Date().toISOString() : null,
      resolution: status === "resolved" ? losning : null,
    })
    .eq("id", id);

  await db.from("audit_log").insert({
    actor_id: user.employee.id,
    action: status === "resolved" ? "case.resolved" : "case.status_changed",
    object_type: "hr_case",
    object_id: id,
    meta: { status },
  });

  revalidatePath(`/arenden/${id}`);
  revalidatePath("/arenden");
}

export async function tilldela(form: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user?.employee || !farHantera(user)) throw new Error("Du saknar behörighet.");

  const id = String(form.get("arende_id") ?? "");
  const till = String(form.get("assigned_to") ?? "") || null;

  await supabaseAdmin().from("hr_case").update({ assigned_to: till }).eq("id", id);
  await supabaseAdmin().from("audit_log").insert({
    actor_id: user.employee.id,
    action: "case.assigned",
    object_type: "hr_case",
    object_id: id,
    meta: { till },
  });

  revalidatePath(`/arenden/${id}`);
}
