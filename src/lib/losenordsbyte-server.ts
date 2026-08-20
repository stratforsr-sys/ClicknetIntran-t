import "server-only";

import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";
import type { CurrentUser } from "@/lib/auth";
import { granska } from "@/lib/losenordskrav";
import { FLAGGA } from "@/lib/losenordsbyte";

/**
 * Sjalva bytet, pa ett stalle.
 *
 * Det finns tva vagar hit: profilsidan, dar man byter for att man vill, och
 * `/byt-losenord`, dit mellanvaran skickar den som maste. De ska stalla samma
 * krav. Lag de i var sin server action skulle de sluta gora det — det gjorde
 * de redan, profilen krävde bara langd och e-postadress medan den tvingade
 * sidan hade hela sparrlistan.
 */

/**
 * Kontrollerar det gamla losenordet utan att rora den pagaende sessionen.
 *
 * Det finns ingen "verifiera losenord"-endpoint i GoTrue, sa vi loggar in en
 * gang till och slanger svaret. Rak fetch och inte klienten fran
 * `supabaseServer()` — den skulle skriva nya kakor och byta ut sessionen mitt
 * i formularet.
 */
async function stammerGamla(epost: string, losenord: string): Promise<boolean> {
  try {
    const svar = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email: epost, password: losenord }),
    });
    return svar.ok;
  } catch {
    return false;
  }
}

export type Bytesresultat = { fel?: string[] };

export async function utforBytLosenord(
  user: CurrentUser,
  gammalt: string,
  nytt: string,
  upprepat: string,
): Promise<Bytesresultat> {
  if (!gammalt || !nytt) return { fel: ["Fyll i både det gamla och det nya lösenordet."] };
  if (nytt !== upprepat) return { fel: ["De två nya lösenorden är inte lika."] };

  if (!(await stammerGamla(user.email, gammalt))) {
    return { fel: ["Det nuvarande lösenordet stämmer inte."] };
  }

  const dom = granska(
    nytt,
    {
      fornamn: user.employee?.first_name,
      efternamn: user.employee?.last_name,
      epost: user.email,
    },
    gammalt,
  );
  if (!dom.ok) return { fel: dom.fel };

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.updateUser({ password: nytt });
  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes("same as the old") || m.includes("should be different")) {
      return { fel: ["Det nya lösenordet är samma som det gamla."] };
    }
    if (m.includes("rate limit") || m.includes("too many")) {
      return { fel: ["För många försök. Vänta en minut och försök igen."] };
    }
    return { fel: ["Lösenordet kunde inte bytas. Försök igen."] };
  }

  const db = supabaseAdmin();

  /**
   * Tvanget bort — om det fanns.
   *
   * Las-andra-skriv, och `app_metadata` och inte `user_metadata`: det senare
   * far anvandaren sjalv skriva i, och en spa­rr man kan stanga av sjalv ar
   * ingen spa­rr.
   *
   * Ordningen ar vald: losenordet byts forst, flaggan tas bort efterat. Gar
   * det andra steget fel star tvanget kvar och personen far byta igen —
   * trakigt, men ofarligt. Motsatt ordning hade slappt igenom nagon vars byte
   * misslyckades.
   */
  const { data: nu } = await db.auth.admin.getUserById(user.authUserId);
  if (nu?.user?.app_metadata?.[FLAGGA]) {
    await db.auth.admin.updateUserById(user.authUserId, {
      app_metadata: { ...nu.user.app_metadata, [FLAGGA]: false },
    });
  }

  // Ordet star aldrig i loggen. Bara att det byttes, av vem och nar.
  if (user.employee) {
    await db.from("audit_log").insert({
      actor_id: user.employee.id,
      action: "auth.password_changed",
      object_type: "auth",
      object_id: user.authUserId,
      meta: { tvingat: Boolean(nu?.user?.app_metadata?.[FLAGGA]) },
    });
  }

  return {};
}
