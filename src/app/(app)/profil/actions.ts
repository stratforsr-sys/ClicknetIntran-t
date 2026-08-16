"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth";
import { skapaKvitto, STEG2_KAKA, STEG2_DYGN } from "@/lib/mfa";

export type ProfilState = { fel?: string; ok?: string };

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
// Steg tva: engangskod till e-posten
// -----------------------------------------------------------------------------

/**
 * Skickar koden. Adressen tas ur sessionen, aldrig ur formularet — annars vore
 * det en vag att be navet mejla vem som helst.
 */
export async function skickaKod(_prev: ProfilState, _form: FormData): Promise<ProfilState> {
  const user = await getCurrentUser();
  if (!user) return { fel: "Du måste vara inloggad." };

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email: user.email,
    options: { shouldCreateUser: false },
  });

  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes("rate") || m.includes("too many") || m.includes("seconds"))
      return { fel: "En kod är redan skickad. Vänta en minut innan du begär en ny." };
    return { fel: "Koden kunde inte skickas. Kontrollera mejlutskicket i Supabase." };
  }

  return { ok: `Kod skickad till ${user.email}. Den gäller i en timme.` };
}

/**
 * Kontrollerar koden och skriver kvittot. Att kvittot satts har, efter att
 * Supabase sagt ja, ar hela spärren: mellanvaran tittar bara pa kvittot och
 * behover darfor ingen egen kunskap om koder.
 */
export async function verifieraKod(_prev: ProfilState, form: FormData): Promise<ProfilState> {
  const user = await getCurrentUser();
  if (!user) return { fel: "Du måste vara inloggad." };

  const kod = String(form.get("kod") ?? "").replace(/\s/g, "");
  if (!kod) return { fel: "Skriv in koden från mejlet." };

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.verifyOtp({
    email: user.email,
    token: kod,
    type: "email",
  });

  if (error || !data.user) {
    if (user.employee) {
      await logga(user.employee.id, "auth.step2_failed", user.authUserId, { ip: await klientIp() });
    }
    const m = (error?.message ?? "").toLowerCase();
    if (m.includes("expired")) return { fel: "Koden har gått ut. Begär en ny." };
    return { fel: "Koden stämmer inte. Kontrollera att du tagit den senaste." };
  }

  // Koden kom till ratt brevlada, men verifyOtp slapper igenom vilket konto
  // som helst som adressen pekar pa. Kontrollen ar billig och stanger frangan.
  if (data.user.id !== user.authUserId) return { fel: "Koden hör till ett annat konto." };

  const { varde, utgang } = await skapaKvitto(user.authUserId);
  const kakor = await cookies();
  kakor.set(STEG2_KAKA, varde, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: utgang,
  });

  if (user.employee) {
    await logga(user.employee.id, "auth.step2_verified", user.authUserId, {
      dygn: STEG2_DYGN,
      ip: await klientIp(),
    });
  }
  return { ok: "Klart." };
}

/** Kvittot bort fran den har enheten. Nasta inloggning kraver en ny kod. */
export async function glomEnheten(): Promise<void> {
  const user = await getCurrentUser();
  const kakor = await cookies();
  kakor.delete(STEG2_KAKA);
  if (user?.employee) await logga(user.employee.id, "auth.step2_forgotten", user.authUserId);
  revalidatePath("/profil");
}

