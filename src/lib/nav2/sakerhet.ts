import "server-only";

import { cookies } from "next/headers";
import type { CurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { kraverMfa, kvittoGiltigt, STEG2_KAKA } from "@/lib/mfa";
import { svenskDygnsstart, svenskKlocka, svensktDatum } from "@/lib/klocka";
import { SKRIVLAGE } from "./skrivlage";

/**
 * Nav 2.0, Inställningar → Säkerhet: lösenordet och Kod vid inloggning, som
 * `/profil/sakerhet` i nuvarande Nav (`SakerhetSektion`).
 *
 *   kodKravs  Repots `kraverMfa()`: rollerna i MFA_REQUIRED_ROLES eller
 *             behörigheten payroll_cost_viewer. Listan är tom sedan
 *             2026-08-16, så kravet är av för alla tills den fylls.
 *   enhet     Den här enheten är bekräftad: kvittot i kakan `nav_steg2` är
 *             giltigt för kontot. `till` är dagen kvittot går ut (30 dygn).
 *   bytt      Klockslaget för ett lösenordsbyte i dag (audit_log
 *             `auth.password_changed`), som utkastets "Bytt i dag 14:05".
 *             Den egna raden läses med service role, bara tidpunkten:
 *             loggen läser annars bara ledningen.
 *
 * Bytet, koden och "Glöm den här enheten" går till /nav2/sakerhet.
 */
export type NdSakerhet = {
  far: boolean;
  kodKravs: boolean;
  enhet: { till: string } | null;
  bytt: string | null;
};

export async function byggSakerhet(user: CurrentUser): Promise<NdSakerhet> {
  const ut: NdSakerhet = { far: SKRIVLAGE.sakerhet, kodKravs: kraverMfa(user), enhet: null, bytt: null };
  if (!user.employee) return ut;

  // Ett fel här får aldrig fälla resten av datan: då står enheten som obekräftad.
  let kvitto: string | undefined;
  try {
    kvitto = (await cookies()).get(STEG2_KAKA)?.value;
  } catch {
    kvitto = undefined;
  }
  if (kvitto && (await kvittoGiltigt(kvitto, user.authUserId))) {
    // Kvittot är <auth-id>.<utgång i ms>.<signatur>; kvittoGiltigt har just kontrollerat det.
    const utgang = Number(kvitto.split(".")[1]);
    ut.enhet = { till: svensktDatum(new Date(utgang)) };
  }

  const { data } = await supabaseAdmin()
    .from("audit_log")
    .select("ts")
    .eq("actor_id", user.employee.id)
    .eq("action", "auth.password_changed")
    .gte("ts", svenskDygnsstart())
    .order("ts", { ascending: false })
    .limit(1);
  const rad = ((data ?? []) as { ts: string }[])[0];
  if (rad) ut.bytt = svenskKlocka(rad.ts);
  return ut;
}
