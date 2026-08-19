"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";

export type SparrState = { fel?: string; ok?: string };

/**
 * Bara säljchef och VD rör spärrarna. Att slå på övervakning av raster är ett
 * arbetsgivarbeslut, inte en driftåtgärd — administratörsrollen är teknisk och
 * hör inte hemma här.
 */
async function kravBeslutsfattare() {
  const user = await getCurrentUser();
  if (!hasRole(user, "sales_manager", "ceo") || !user?.employee) {
    throw new Error("Bara säljchef och VD får ändra spärrarna.");
  }
  return user;
}

async function logga(actorId: string, action: string, key: string, meta?: Record<string, unknown>) {
  await supabaseAdmin().from("audit_log").insert({
    actor_id: actorId,
    action,
    object_type: "compliance_gate",
    object_id: key,
    meta: meta ?? null,
  });
}

/** Kopplar ett dokument ur rutinbiblioteket till spärren som dess underlag. */
export async function kopplaDokument(_prev: SparrState, form: FormData): Promise<SparrState> {
  try {
    const user = await kravBeslutsfattare();
    const key = String(form.get("key") ?? "");
    const falt = String(form.get("falt") ?? "");
    const dokumentId = String(form.get("dokument_id") ?? "") || null;

    if (!["interest_assessment_id", "staff_information_id"].includes(falt)) {
      return { fel: "Okänt fält." };
    }

    const { error } = await supabaseAdmin()
      .from("compliance_gate")
      .update({ [falt]: dokumentId })
      .eq("key", key);

    if (error) return { fel: `Kopplingen kunde inte sparas: ${error.message}` };

    await logga(user.employee!.id, "gate.document_linked", key, { falt, dokumentId });
    revalidatePath("/tid/sparrar");
    return { ok: "Kopplat." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Slår på spärren. Villkoren kontrolleras av triggern i databasen — den här
 * funktionen kan inte kringgå dem, och felet som kommer tillbaka är triggerns
 * eget så att listan alltid stämmer med vad som faktiskt saknas.
 */
export async function slaPa(_prev: SparrState, form: FormData): Promise<SparrState> {
  try {
    const user = await kravBeslutsfattare();
    const key = String(form.get("key") ?? "");

    const { error } = await supabaseAdmin()
      .from("compliance_gate")
      .update({
        enabled: true,
        enabled_at: new Date().toISOString(),
        enabled_by: user.employee!.id,
      })
      .eq("key", key);

    if (error) {
      return { fel: error.message.replace(/^.*Detta saknas: /, "Detta saknas: ") };
    }

    await logga(user.employee!.id, "gate.enabled", key, { datum: svensktDatum(new Date()) });
    revalidatePath("/tid", "layout");
    return { ok: "Påslagen. Ändringen gäller direkt för alla." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Slår av. Går alltid, utan villkor och utan motivering.
 *
 * En spärr ska aldrig vara svårare att stänga än att öppna: den dag något visar
 * sig fel ska vägen tillbaka vara ett klick, inte ett ärende.
 */
export async function slaAv(_prev: SparrState, form: FormData): Promise<SparrState> {
  try {
    const user = await kravBeslutsfattare();
    const key = String(form.get("key") ?? "");

    const { error } = await supabaseAdmin()
      .from("compliance_gate")
      .update({ enabled: false })
      .eq("key", key);

    if (error) return { fel: error.message };

    await logga(user.employee!.id, "gate.disabled", key);
    revalidatePath("/tid", "layout");
    return { ok: "Avstängd." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}
