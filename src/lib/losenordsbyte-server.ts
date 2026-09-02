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

  // Reglerna star i `losenordskrav.ts` och ar sedan 2026-09-02 tva: minst atta
  // tecken och minst en siffra. Profilen och den tvingade sidan gar bada
  // harigenom, sa de kan inte glida isar.
  const dom = granska(nytt, gammalt);
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
    /**
     * GoTrue har ETT EGET losenordskrav i projektinstallningarna, och det
     * kravet ar inte det har i koden. Star det pa tolv tecken dar nekas ett
     * attateckensord som `granska()` just slappte igenom, och anvandaren far
     * ett fel som inte gar att atgarda. Sag darfor vad GoTrue sa i stallet for
     * "forsok igen" — da syns det direkt att spa­rren sitter i Supabase
     * (Authentication -> Policies -> Password Requirements) och inte har.
     */
    if (m.includes("password")) {
      return { fel: [`Inloggningstjänsten nekade lösenordet: ${error.message}`] };
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
  const metadata = nu?.user?.app_metadata ?? {};
  const hadeTvang = Boolean(metadata[FLAGGA]);

  if (hadeTvang) {
    await db.auth.admin.updateUserById(user.authUserId, {
      app_metadata: { ...metadata, [FLAGGA]: false },
    });

    /**
     * TOKENEN MASTE FORNYAS HAR. UTAN DEN HAR RADEN LANDAR VARJE NYANSTALLD
     * PA "Vantar pa aktivering" DIREKT EFTER SITT FORSTA LOSENORDSBYTE.
     *
     * Raden ovan andrar `app_metadata` hos Auth. Den ror INTE den token
     * anvandaren redan har i sin kaka — den ar signerad, lever i en timme och
     * bar kvar `byt_losenord: true`.
     *
     * Da sager de tva spa­rrarna fran migration 0017 olika saker om samma
     * person:
     *
     *   mellanvaran  fragar Auth med getUser() -> falskt -> slapper in
     *   databasen    laser claimen ur TOKENEN  -> sant   -> noll rader
     *
     * `kraver_losenordsbyte()` ar med i `employee_read`, sa personen far inte
     * ens ut sin EGEN rad. `getCurrentUser()` ser `employee: null`, och
     * (app)-layouten tolkar det som AC-1.2: inte upplagd som anstalld. Det
     * gick over av sig sjalvt nar tokenen forfoll — efter upp till en timme,
     * eller nar personen loggade ut och in igen.
     *
     * Fornyelsen hamtar en NY token, och GoTrue bygger claimsen ur
     * anvandarraden som den ser ut nu. Kakorna skrivs av `supabaseServer()`,
     * och eftersom det har ar en server action gar det — omdirigeringen
     * efterat bar dem med sig.
     *
     * Fallbacken finns for att ett losenordsbyte kan hinna aterkalla den
     * gamla refresh-tokenen. Da loggar vi in med det ord anvandaren just satt
     * i stallet; bada vagarna slutar med en giltig session och farska claims,
     * och den som misslyckas med bada ar anda inloggad — bara med gammal
     * token, alltsa exakt lika illa som forr och inte varre.
     */
    const { error: fornyelsefel } = await supabase.auth.refreshSession();
    if (fornyelsefel) {
      await supabase.auth.signInWithPassword({ email: user.email, password: nytt });
    }
  }

  // Ordet star aldrig i loggen. Bara att det byttes, av vem och nar.
  if (user.employee) {
    await db.from("audit_log").insert({
      actor_id: user.employee.id,
      action: "auth.password_changed",
      object_type: "auth",
      object_id: user.authUserId,
      meta: { tvingat: hadeTvang },
    });
  }

  return {};
}
