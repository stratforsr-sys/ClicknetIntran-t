"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { BEDOMDA_STEG, nastaSteg, type Steg } from "@/lib/rekrytering";

export type RekryteringState = { fel?: string };

/**
 * E10. Samma krets som `far_rekrytera()` i 0030.
 *
 * Villkoret star pa tva stallen: har, sa att sidan kan neka innan den skriver,
 * och i RLS, som ar det som faktiskt avgor vad som gar att lasa. Skulle de
 * glida isar ar det databasen som vinner.
 */
function farRekrytera(user: Awaited<ReturnType<typeof getCurrentUser>>) {
  return (
    hasRole(user, "sales_manager", "ceo", "admin") ||
    Boolean(user?.permissions.includes("recruiter"))
  );
}

async function kravRekryterare() {
  const user = await getCurrentUser();
  if (!user?.employee || !farRekrytera(user)) throw new Error("Du saknar behörighet.");
  return user;
}

/**
 * AC-7.2: en ny kandidat.
 *
 * Kallan ar obligatorisk. Den gar inte att rekonstruera i efterhand, och utan
 * den ar E10.10 trattrapporten en tabell med en enda rad som heter "okant".
 */
export async function nyKandidat(_prev: RekryteringState, form: FormData): Promise<RekryteringState> {
  const user = await kravRekryterare();

  const fornamn = String(form.get("fornamn") ?? "").trim();
  const efternamn = String(form.get("efternamn") ?? "").trim();
  const epost = String(form.get("epost") ?? "").trim().toLowerCase();
  const kalla = String(form.get("kalla") ?? "").trim();

  if (!fornamn || !efternamn) return { fel: "Fyll i namnet." };
  if (!epost.includes("@")) return { fel: "Fyll i en e-postadress." };
  if (!kalla) return { fel: "Välj varifrån ansökan kom." };

  const { data, error } = await supabaseAdmin()
    .from("candidate")
    .insert({
      first_name: fornamn,
      last_name: efternamn,
      email: epost,
      phone: String(form.get("telefon") ?? "").trim() || null,
      source_slug: kalla,
      role_title: String(form.get("roll") ?? "").trim() || "Säljare",
      notes: String(form.get("anteckning") ?? "").trim() || null,
      created_by: user.employee!.id,
    })
    .select("id")
    .single();

  // K27-villkoret i 0030 slar till pa en anteckning som bar ett personnummer.
  // Meddelandet ska saga VAD som ar fel, inte "det gick inte".
  if (error) {
    return {
      fel: error.message.includes("personnummer")
        ? "Anteckningen ser ut att innehålla ett personnummer. Navet lagrar inga (K27)."
        : "Kandidaten kunde inte sparas. Försök igen.",
    };
  }

  revalidatePath("/rekrytering");
  redirect(`/rekrytering/${data.id}`);
}

/**
 * AC-7.3: flyttar kandidaten ett steg.
 *
 * Kontrollen av vilket steg som ar tillatet ligger i triggern
 * `candidate_stegbyte` — den har bara ritar ratt knappar. Ett fel darifran
 * skickas vidare i klartext, eftersom det sager exakt vad som var fel
 * ("Steget offer gar inte att na fran screening").
 */
export async function flyttaSteg(form: FormData): Promise<void> {
  await kravRekryterare();

  const id = String(form.get("id") ?? "");
  const till = String(form.get("till") ?? "") as Steg;
  const fran = String(form.get("fran") ?? "") as Steg;

  if (!nastaSteg(fran).includes(till)) throw new Error("Det steget går inte härifrån.");

  const rad: Record<string, unknown> = { stage: till };
  if (till === "rejected") {
    rad.rejected_reason = String(form.get("skal") ?? "").trim() || null;
  }

  const { error } = await supabaseAdmin().from("candidate").update(rad).eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/rekrytering");
  revalidatePath(`/rekrytering/${id}`);
}

/**
 * AC-7.6: en scorecard per intervju och intervjuare.
 *
 * `upsert` och inte `insert`: en intervjuare som fyller i samma steg igen
 * rattar sitt omdome. Tva rader fran samma person om samma intervju ar inte
 * tva omdomen, det ar ett omdome och en angerknapp.
 */
export async function sparaScorecard(
  _prev: RekryteringState,
  form: FormData,
): Promise<RekryteringState> {
  const user = await kravRekryterare();

  const id = String(form.get("id") ?? "");
  const steg = String(form.get("steg") ?? "") as Steg;
  const rekommendation = String(form.get("rekommendation") ?? "");

  if (!BEDOMDA_STEG.includes(steg)) return { fel: "Det steget bedöms inte." };
  if (!["yes", "no", "maybe"].includes(rekommendation)) return { fel: "Välj en rekommendation." };

  const { error } = await supabaseAdmin()
    .from("interview_scorecard")
    .upsert(
      {
        candidate_id: id,
        stage: steg,
        interviewer_id: user.employee!.id,
        recommendation: rekommendation,
        strengths: String(form.get("styrkor") ?? "").trim() || null,
        concerns: String(form.get("tveksamheter") ?? "").trim() || null,
      },
      { onConflict: "candidate_id,stage,interviewer_id" },
    );

  if (error) {
    return {
      fel: error.message.includes("personnummer")
        ? "Anteckningen ser ut att innehålla ett personnummer. Navet lagrar inga (K27)."
        : "Scorecarden kunde inte sparas. Försök igen.",
    };
  }

  revalidatePath(`/rekrytering/${id}`);
  return {};
}

/**
 * AC-7.5: kandidaten kom inte till intervjun.
 *
 * En raknare och inte en flagga. Att nagon uteblev en gang och kom nasta gang
 * ar en annan uppgift an att hen uteblev tva ganger, och trattrapporten per
 * kalla behover den skillnaden.
 */
export async function registreraNoShow(form: FormData): Promise<void> {
  await kravRekryterare();
  const id = String(form.get("id") ?? "");

  const db = supabaseAdmin();
  const { data } = await db.from("candidate").select("no_show_count").eq("id", id).single();
  if (!data) throw new Error("Kandidaten finns inte.");

  const { error } = await db
    .from("candidate")
    .update({ no_show_count: (data.no_show_count ?? 0) + 1 })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/rekrytering/${id}`);
}

/**
 * AC-7.8: talangpoolen.
 *
 * Samtycket far ett datum i samma skrivning som flaggan. Villkoret i 0030
 * nekar annars raden — en talangpool utan samtycke ar bara ett register over
 * folk som sokt jobb.
 */
export async function sattTalangpool(form: FormData): Promise<void> {
  await kravRekryterare();

  const id = String(form.get("id") ?? "");
  const pa = form.get("pa") === "1";

  const { error } = await supabaseAdmin()
    .from("candidate")
    .update({
      talent_pool: pa,
      talent_pool_consent: pa ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/rekrytering/${id}`);
}
