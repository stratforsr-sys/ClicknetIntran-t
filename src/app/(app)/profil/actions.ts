"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { skapaKvitto, STEG2_KAKA, STEG2_DYGN } from "@/lib/mfa";
import { utforBytLosenord } from "@/lib/losenordsbyte-server";
import { skickaKodmejl } from "@/lib/kodmejl-server";
import { sparaUtskick, utskicksvy, type Andring, type Sparat, type Utskicksvy } from "@/lib/utskick-server";
import { standardFor } from "@/lib/utskick-standard";

export type ProfilState = { fel?: string; ok?: string };

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
 *
 * Sjalva bytet ligger i `utforBytLosenord` och delas med `/byt-losenord`.
 * Tidigare krävde den har vagen bara langd och att e-postadressen inte stod i
 * ordet, medan den tvingade sidan hade hela sparrlistan. Tva vagar in i samma
 * konto med olika krav ar detsamma som att bara ha det svagare kravet.
 */
export async function bytLosenord(_prev: ProfilState, form: FormData): Promise<ProfilState> {
  const user = await getCurrentUser();
  if (!user?.employee) return { fel: "Du måste vara inloggad." };

  const resultat = await utforBytLosenord(
    user,
    String(form.get("nuvarande") ?? ""),
    String(form.get("nytt") ?? ""),
    String(form.get("upprepa") ?? ""),
  );

  // Profilen visar en rad. Star det flera fel far de sta pa samma rad hellre
  // an att bara det forsta visas — nasta forsok ska inte behova gissa.
  if (resultat.fel) return { fel: resultat.fel.join(" ") };
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

  // Navets eget mejl, som vid inloggningen. En kod som gick hit för mindre än
  // en minut sedan gäller fortfarande, så spärren är inget fel.
  const utfall = await skickaKodmejl(user.email, "steg2");
  if (utfall === "mejlgrans") return { fel: "Navet har skickat många mejl den senaste stunden. Försök igen om en stund." };
  if (utfall !== "skickad" && utfall !== "sparr") return { fel: "Koden kunde inte skickas just nu. Försök igen om en stund." };

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
    // GoTrue svarar "Token has expired or is invalid" både för fel kod och
    // för en kod som gått ut, så de två går inte att skilja på här.
    return { fel: "Koden stämmer inte eller har gått ut. Kontrollera att du tog den senaste." };
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


// -----------------------------------------------------------------------------
// Utskick (0255): vem som far vad, i vilken kanal
// -----------------------------------------------------------------------------

/**
 * Vyn for den inloggade. Superadmin far dessutom bolagets lager och alla
 * personer. Funktionen tar INGET id: vems vy det ar avgors av sessionen.
 */
export async function hamtaUtskick(): Promise<Utskicksvy | null> {
  const user = await getCurrentUser();
  if (!user?.employee) return null;
  return utskicksvy(user, standardFor);
}

/**
 * En brytare. Vem som far andra vad prövas i `sparaUtskick` och ingen annanstans:
 * det egna lagret bara for den inloggade sjalv, de tre andra bara for superadmin.
 * Argumentet ar obetrott (en server action ar en publik adress) och valideras dar.
 */
export async function sparaUtskickAction(andring: Andring): Promise<Sparat> {
  const user = await getCurrentUser();
  if (!user?.employee) return { ok: false, fel: "Du måste vara inloggad.", status: 401 };
  const svar = await sparaUtskick(user, andring);
  if (svar.ok) {
    revalidatePath("/profil");
    revalidatePath("/utskick");
  }
  return svar;
}
