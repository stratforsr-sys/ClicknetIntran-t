"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { skrivFel } from "@/lib/fel-server";
import { MAX_BODY, type Felstatus } from "@/lib/fel";
import { sattKvitto } from "../angra/actions";

export type FelState = { fel?: string };

/** Kon lases och atgardas av samma krets som handelseloggen (0026). */
function farHantera(user: Awaited<ReturnType<typeof getCurrentUser>>) {
  return hasRole(user, "sales_manager", "ceo", "admin");
}

/**
 * E0.6. Knappen som ar hela poangen med epicet.
 *
 * Kraven ar lagt satta med flit: en mening racker. Ett formular som kraver
 * rubrik, kategori och steg for att aterskapa ar ett formular som halva
 * piloten struntar i, och da har man bytt tio slarviga rapporter mot noll
 * noggranna.
 */
export async function rapporteraFel(_prev: FelState, form: FormData): Promise<FelState> {
  const user = await getCurrentUser();
  if (!user?.employee) return { fel: "Du måste vara inloggad för att rapportera." };

  const text = String(form.get("text") ?? "").trim();
  if (text.length < 5) return { fel: "Skriv några ord om vad som hände." };
  if (text.length > MAX_BODY) return { fel: "Beskrivningen är för lång. Korta ner den." };

  const ok = await skrivFel({
    kind: "manual",
    // Sidan personen var pa nar det gick fel, inte sidan formularet ligger pa.
    path: String(form.get("sida") ?? "/"),
    digest: String(form.get("digest") ?? "") || null,
    body: text,
    blocking: form.get("blockerande") === "1",
    reporterId: user.employee.id,
  });

  if (!ok) return { fel: "Rapporten kunde inte sparas. Försök igen." };

  revalidatePath("/fel");
  redirect("/fel?tack=1");
}

/**
 * Byter status pa en rapport.
 *
 * `handled_by` och `handled_at` skrivs vid varje byte och inte bara forsta
 * gangen: det intressanta ar vem som senast rorde raden, inte vem som forst
 * tittade pa den.
 */
export async function sattStatus(form: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user?.employee || !farHantera(user)) throw new Error("Du saknar behörighet.");

  const id = String(form.get("fel_id") ?? "");
  const status = String(form.get("status") ?? "") as Felstatus;
  if (!["new", "ack", "closed"].includes(status)) throw new Error("Okänd status.");

  const db = supabaseAdmin();
  await db
    .from("error_report")
    .update({
      status,
      handled_by: user.employee.id,
      handled_at: new Date().toISOString(),
      resolution: String(form.get("resolution") ?? "").trim() || null,
    })
    .eq("id", id);

  /**
   * Loggas i audit_log. En felrapport ar inte persondata i sig, men "vem
   * bestamde att det har inte var ett fel" ar en uppgift som en pilot behover
   * kunna ga tillbaka till — det ar halva skalet att mata den alls.
   */
  await db.from("audit_log").insert({
    actor_id: user.employee.id,
    action: `error.${status}`,
    object_type: "error_report",
    object_id: id,
  });

  // E5.7. Bara avslutet far en angra-knapp. "Tittar pa den" och "oppna igen"
  // ar inte atgarder man rakar gora — avslut ar det, och det ar det som gor en
  // rapport osynlig i kon.
  if (status === "closed") {
    await sattKvitto({ text: "Felrapporten är avslutad.", angra: { handling: "fel.avslutad", id } });
  }

  revalidatePath("/fel");
}
