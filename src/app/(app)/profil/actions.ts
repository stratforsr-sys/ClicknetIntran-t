"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth";
import { kraverMfa, harVerifieradFaktor, genereraKoder, hashaKod, ANTAL_KODER } from "@/lib/mfa";

export type ProfilState = { fel?: string; ok?: string };
export type KodState = ProfilState & { koder?: string[] };

const MIN_LOSENORD = 12;

async function logga(
  actorId: string,
  action: string,
  objectId: string,
  meta?: Record<string, unknown>,
) {
  await supabaseAdmin().from("audit_log").insert({
    actor_id: actorId,
    action,
    object_type: "auth",
    object_id: objectId,
    meta: meta ?? null,
  });
}

async function klientIp(): Promise<string | null> {
  const h = await headers();
  const vidarebefordrad = h.get("x-forwarded-for");
  return vidarebefordrad ? vidarebefordrad.split(",")[0].trim() : null;
}

// -----------------------------------------------------------------------------
// Losenord
// -----------------------------------------------------------------------------

/**
 * AC-1.7. Det nuvarande losenordet kravs aven om sessionen redan ar giltig:
 * en olast dator ska inte racka for att lasa ut agaren ur sitt eget konto.
 * Kontrollen gors mot en engangsklient sa att den palogade sessionen inte rors.
 */
export async function bytLosenord(_prev: ProfilState, form: FormData): Promise<ProfilState> {
  const user = await getCurrentUser();
  if (!user?.employee) return { fel: "Du måste vara inloggad." };

  const nuvarande = String(form.get("nuvarande") ?? "");
  const nytt = String(form.get("nytt") ?? "");
  const upprepa = String(form.get("upprepa") ?? "");

  if (!nuvarande || !nytt) return { fel: "Fyll i både nuvarande och nytt lösenord." };
  if (nytt !== upprepa) return { fel: "De två nya lösenorden är inte lika." };
  if (nytt.length < MIN_LOSENORD)
    return { fel: `Lösenordet behöver vara minst ${MIN_LOSENORD} tecken.` };
  if (nytt === nuvarande) return { fel: "Det nya lösenordet är samma som det gamla." };
  if (nytt.toLowerCase().includes(user.email.split("@")[0].toLowerCase()))
    return { fel: "Lösenordet får inte innehålla din e-postadress." };

  const kontroll = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: felIn } = await kontroll.auth.signInWithPassword({
    email: user.email,
    password: nuvarande,
  });
  if (felIn) return { fel: "Det nuvarande lösenordet stämmer inte." };
  await kontroll.auth.signOut();

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.updateUser({ password: nytt });
  if (error) {
    if (error.message.toLowerCase().includes("weak") || error.message.includes("password"))
      return { fel: "Lösenordet är för svagt. Välj ett längre och mer unikt." };
    return { fel: "Lösenordet kunde inte bytas. Försök igen." };
  }

  await logga(user.employee.id, "auth.password_changed", user.authUserId);
  return { ok: "Lösenordet är bytt." };
}

// -----------------------------------------------------------------------------
// Tvafaktor
// -----------------------------------------------------------------------------

/**
 * Anropas nar klienten verifierat sin nya faktor. Att servern raknar faktorer
 * sjalv, i stallet for att tro pa klientens ord, ar hela poangen: koderna far
 * bara skapas till nagon som faktiskt kommit hela vagen genom inskrivningen.
 *
 * Aldre oanvanda koder tas bort. Tio giltiga listor kan inte finnas samtidigt.
 */
export async function skapaAterstallningskoder(): Promise<KodState> {
  const user = await getCurrentUser();
  if (!user?.employee) return { fel: "Du måste vara inloggad." };

  if (!harVerifieradFaktor(user)) return { fel: "Aktivera tvåfaktor först." };

  const koder = genereraKoder();
  const admin = supabaseAdmin();

  await admin.from("mfa_recovery_code").delete().eq("employee_id", user.employee.id);
  const { error } = await admin.from("mfa_recovery_code").insert(
    koder.map((kod) => ({ employee_id: user.employee!.id, code_hash: hashaKod(kod) })),
  );
  if (error) return { fel: "Koderna kunde inte sparas. Försök igen." };

  await logga(user.employee.id, "mfa.recovery_codes_created", user.authUserId, {
    antal: ANTAL_KODER,
  });
  revalidatePath("/profil");
  return { koder, ok: "Spara koderna nu. De visas inte igen." };
}

/** Loggar inskrivningen. Sjalva verifieringen sker mot Supabase i webblasaren. */
export async function loggaInskrivenFaktor(): Promise<void> {
  const user = await getCurrentUser();
  if (!user?.employee || !harVerifieradFaktor(user)) return;
  await logga(user.employee.id, "mfa.enrolled", user.authUserId);
  revalidatePath("/profil");
}

/**
 * Den som maste ha tvafaktor far inte stanga av den sjalv. Regeln ligger har,
 * pa servern, och inte bara som en dold knapp i granssnittet.
 */
export async function stangAvTvafaktor(
  _prev: ProfilState,
  _form: FormData,
): Promise<ProfilState> {
  const user = await getCurrentUser();
  if (!user?.employee) return { fel: "Du måste vara inloggad." };
  if (kraverMfa(user))
    return { fel: "Din roll kräver tvåfaktor. Den går inte att stänga av." };

  const supabase = await supabaseServer();
  for (const faktor of user.factors) {
    await supabase.auth.mfa.unenroll({ factorId: faktor.id });
  }

  await supabaseAdmin().from("mfa_recovery_code").delete().eq("employee_id", user.employee.id);
  await logga(user.employee.id, "mfa.disabled", user.authUserId);
  revalidatePath("/profil");
  return { ok: "Tvåfaktor är avstängd." };
}

/**
 * Aterstallning ar ett steg-upp, inte en vag in i kontot: den som kommer hit
 * har redan bevisat sitt losenord eller sin magiska lank. Koden tar bort
 * faktorn och tvingar fram en ny inskrivning — den slapper alltsa inte in
 * nagon utan andra faktor, den byter ut telefonen.
 */
export async function anvandAterstallningskod(
  _prev: ProfilState,
  form: FormData,
): Promise<ProfilState> {
  const user = await getCurrentUser();
  if (!user?.employee) return { fel: "Du måste vara inloggad." };

  const kod = String(form.get("kod") ?? "").trim();
  if (!kod) return { fel: "Skriv in en av dina återställningskoder." };

  const admin = supabaseAdmin();
  const { data: rad } = await admin
    .from("mfa_recovery_code")
    .select("id")
    .eq("employee_id", user.employee.id)
    .eq("code_hash", hashaKod(kod))
    .is("used_at", null)
    .maybeSingle();

  if (!rad) {
    await logga(user.employee.id, "mfa.recovery_failed", user.authUserId, {
      ip: await klientIp(),
    });
    return { fel: "Koden gäller inte. Varje kod fungerar en gång." };
  }

  await admin
    .from("mfa_recovery_code")
    .update({ used_at: new Date().toISOString(), used_ip: await klientIp() })
    .eq("id", rad.id);

  const { data: faktorer } = await admin.auth.admin.mfa.listFactors({ userId: user.authUserId });
  for (const faktor of faktorer?.factors ?? []) {
    await admin.auth.admin.mfa.deleteFactor({ id: faktor.id, userId: user.authUserId });
  }

  await logga(user.employee.id, "mfa.recovered", user.authUserId, { ip: await klientIp() });

  // Token i handen namner fortfarande den borttagna faktorn. Utan en ny token
  // skickar mellanvaran anvandaren tillbaka hit i all evighet.
  const supabase = await supabaseServer();
  await supabase.auth.refreshSession();

  return { ok: "Tvåfaktorn är borttagen. Skriv in en ny app nu." };
}
