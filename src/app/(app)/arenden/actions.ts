"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { frist, type Status } from "@/lib/arenden";
import { notifiera } from "@/lib/notishandelse-server";

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

  // Agaren och rubriken lases FORE skrivningen. Efterat gar det fortfarande,
  // men da har raden redan andrats och en trasig fraga hade gett en notis om
  // ett arende vi inte langre vet nagot om.
  const { data: arende } = await db
    .from("hr_case")
    .select("employee_id, subject, anonymous")
    .eq("id", id)
    .maybeSingle();

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

  /**
   * BESKEDET TILL DEN ARENDET GALLER.
   *
   * Ett svar i tråden har alltid gett en notis (`case_message`). En STATUSANDRING
   * har aldrig gjort det, och det ar den halvan som gor skillnad: ett arende som
   * avslutas utan ett sista meddelande avslutades i tysthet, och den som anmalde
   * fick veta det genom att sjalv ga in och titta.
   *
   * `anonymous` andrar ingenting har. Anonymiteten galler mot HANTERAREN —
   * anmalaren vet vem hon ar och har ratt att veta vad som hande med hennes
   * anmalan. Notisen gar till `employee_id`, som ar densamma oavsett.
   */
  if (arende && arende.employee_id) {
    await notifiera({
      till: arende.employee_id,
      av: user.employee.id,
      kalla: "arende-status",
      typ: "arende",
      rubrik:
        status === "resolved"
          ? `Ditt ärende är avslutat: ${arende.subject}`
          : `Ditt ärende: ${arende.subject}`,
      detalj:
        status === "resolved"
          ? (losning ?? "Läs vad som beslutades")
          : status === "in_progress"
            ? "Någon har börjat arbeta med det"
            : status === "waiting"
              ? "Väntar på komplettering"
              : "Statusen har ändrats",
      href: `/arenden/${id}`,
      objekt: { typ: "hr_case", id },
    });
  }

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

  /**
   * DEN SOM FICK ARENDET FAR VETA DET.
   *
   * Utan raden var tilldelningen en tyst kolumn: arendet dok upp i en lista
   * hanteraren kanske oppnade nagon gang, och fristen i `due_at` borjade ticka
   * pa nagon som inte visste om det. Det var det enda ovanfor `case_message`
   * som gick att gora AT en person utan att hon markte nagot.
   *
   * `till` ar null nar tilldelningen tas bort. Da finns ingen mottagare, och
   * det ar ratt: en fråntagen uppgift ar inte ett besked varre — den syns i
   * loggen for den som behover foljd den.
   */
  if (till) {
    const { data: arende } = await supabaseAdmin()
      .from("hr_case")
      .select("subject, due_at")
      .eq("id", id)
      .maybeSingle();

    await notifiera({
      till,
      av: user.employee.id,
      kalla: "arende-tilldelad",
      typ: "arende",
      rubrik: `Du har tilldelats ett ärende: ${arende?.subject ?? "ärende"}`,
      detalj: arende?.due_at
        ? `Ska vara besvarat ${String(arende.due_at).slice(0, 10)}`
        : "Öppna det och ta ställning",
      href: `/arenden/${id}`,
      objekt: { typ: "hr_case", id },
    });
  }

  revalidatePath(`/arenden/${id}`);
}
