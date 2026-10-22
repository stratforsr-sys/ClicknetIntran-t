"use server";

import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { ATERSTALL_KAKA, aterstallningGiltig, skapaAterstallning } from "@/lib/aterstallning";
import { BYTESVAG } from "@/lib/losenordsbyte";
import { utforBytLosenord, utforNyttLosenord } from "@/lib/losenordsbyte-server";
import { skickaKodmejl } from "@/lib/kodmejl-server";
import { TEXT, tolkaAuthFel } from "@/lib/inloggning";

/**
 *   klar     lösenordet är bytt; sidan går vidare in i navet
 *   utgatt   sidan ritades med kvittot från koden, men det hann gå ut
 *   ut       sessionen är borta (utloggad i en annan flik)
 */
export type BytState = { fel?: string[]; klar?: boolean; utgatt?: boolean; ut?: boolean };

export type KodState = { fel?: string; skickat?: boolean; ok?: boolean };

/**
 * Tvingat byte, "Glömt lösenordet?" och ett frivilligt byte. Samma kontroller
 * som på profilsidan: de bor i `losenordsbyte-server.ts` just för att vägarna
 * inte ska glida isär.
 *
 * Det gamla lösenordet krävs, utom när kvittot från engångskoden gäller för
 * just det här kontot. Kvittot läses ur kakan och inte ur formuläret: ett dolt
 * fält "efter kod" hade vem som helst kunnat skicka med. Formulärets `orsak`
 * säger bara vad sidan visade, så att ett kvitto som gått ut under tiden blir
 * ett besked och inte ett krav på ett lösenord som inte står på sidan.
 */
export async function bytLosenord(_prev: BytState, form: FormData): Promise<BytState> {
  const user = await getCurrentUser();
  if (!user) return { ut: true };

  const kakor = await cookies();
  const efterKod = await aterstallningGiltig(kakor.get(ATERSTALL_KAKA)?.value, user.authUserId);
  if (form.get("orsak") === "glomt" && !efterKod) return { utgatt: true };

  const nytt = String(form.get("nytt") ?? "");
  const upprepat = String(form.get("upprepat") ?? "");
  const resultat = efterKod
    ? await utforNyttLosenord(user, nytt, upprepat)
    : await utforBytLosenord(user, String(form.get("gammalt") ?? ""), nytt, upprepat);
  if (resultat.fel) return resultat;

  // Kvittot är förbrukat. Det ska inte gå att byta en gång till på det.
  if (efterKod) kakor.delete({ name: ATERSTALL_KAKA, path: BYTESVAG });
  return { klar: true };
}

/** "Glömt det?" mitt i bytet: en kod till den inloggades egen adress. */
export async function skickaKodForByte(_prev: KodState, _form: FormData): Promise<KodState> {
  const user = await getCurrentUser();
  if (!user) return { fel: TEXT.utloggad };

  const utfall = await skickaKodmejl(user.email, "byte");
  // Spärren per person: en kod gick hit för mindre än en minut sedan, och
  // den gäller fortfarande.
  if (utfall === "skickad" || utfall === "sparr") return { skickat: true };
  return { fel: utfall === "mejlgrans" ? TEXT.mejlgrans : TEXT.ejSkickad };
}

/**
 * Koden från mejlet, i stället för det gamla lösenordet. Godkänd ger den
 * samma kvitto som "Glömt lösenordet?" vid inloggningen, och sidan laddas om
 * utan fältet för det gamla.
 */
export async function bekraftaKodForByte(_prev: KodState, form: FormData): Promise<KodState> {
  const user = await getCurrentUser();
  if (!user) return { fel: TEXT.utloggad };

  const kod = String(form.get("kod") ?? "").replace(/\D/g, "");
  if (!kod) return { fel: "Skriv in koden från mejlet." };

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.verifyOtp({ email: user.email, token: kod, type: "email" });
  if (error || !data.user) {
    const orsak = error ? tolkaAuthFel(error) : { typ: "kod" as const };
    return { fel: orsak.typ === "sparr" ? TEXT.kodSparr : orsak.typ === "tjanst" ? TEXT.tjanst : TEXT.kodFel };
  }
  // verifyOtp släpper igenom vilket konto adressen än pekar på. Kontrollen är
  // billig och stänger frågan, som i profilens steg två.
  if (data.user.id !== user.authUserId) return { fel: "Koden hör till ett annat konto." };

  const { varde, utgang } = await skapaAterstallning(user.authUserId);
  (await cookies()).set(ATERSTALL_KAKA, varde, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: BYTESVAG,
    expires: utgang,
  });
  return { ok: true };
}
