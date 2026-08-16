"use server";

import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/env";

export type LoginState = { fel?: string; skickat?: boolean };

/** AC-1.1: inloggning med magisk lank. */
export async function skickaMagiskLank(_prev: LoginState, form: FormData): Promise<LoginState> {
  const epost = String(form.get("epost") ?? "").trim().toLowerCase();
  if (!epost) return { fel: "Fyll i din e-postadress." };

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email: epost,
    options: { emailRedirectTo: `${siteUrl()}/auth/bekrafta` },
  });

  if (error) return { fel: oversatt(error.message) };
  return { skickat: true };
}

/** AC-1.1: inloggning med losenord. */
export async function loggaInMedLosenord(_prev: LoginState, form: FormData): Promise<LoginState> {
  const epost = String(form.get("epost") ?? "").trim().toLowerCase();
  const losenord = String(form.get("losenord") ?? "");
  if (!epost || !losenord) return { fel: "Fyll i både e-post och lösenord." };

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email: epost, password: losenord });

  if (error) return { fel: oversatt(error.message) };
  redirect("/");
}

/** Svenska genomgaende, aven i felmeddelanden (UI-PRD §8). */
function oversatt(meddelande: string): string {
  const m = meddelande.toLowerCase();
  if (m.includes("invalid login credentials")) return "Fel e-post eller lösenord.";
  if (m.includes("email not confirmed")) return "E-postadressen är inte bekräftad än.";
  if (m.includes("rate limit") || m.includes("too many"))
    return "För många försök. Vänta en minut och försök igen.";
  if (m.includes("signups not allowed") || m.includes("not authorized"))
    return "Adressen saknar konto. Be din chef lägga upp dig i navet.";
  return "Inloggningen misslyckades. Försök igen.";
}
