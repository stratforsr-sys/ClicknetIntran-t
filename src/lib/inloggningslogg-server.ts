import "server-only";

import { headers } from "next/headers";

import { supabaseAdmin } from "@/lib/supabase/server";
import { skrivHandelse } from "@/lib/handelselogg-server";

/**
 * E6.1 / AC-12.1. Inloggningen var den enda handelsetyp som inte lamnade ett
 * enda spar i `audit_log`.
 *
 * ===========================================================================
 * VARFOR DET ATT SUPABASE LOGGAR INLOGGNINGAR INTE RACKER
 *
 * Supabase for sin egen auth-logg, och `employee.last_sign_in_at` sager nar
 * nagon var inne senast. Ingen av dem duger till det AC-12.1 ar till for:
 *
 *   - Supabases logg ligger utanfor navet, har en egen gallringstid som navet
 *     inte styr, och gar inte att lasa i samma vy som allt annat. En logg som
 *     kraver att man byter system mitt i en granskning ar en logg man inte
 *     anvander.
 *   - `last_sign_in_at` ar ETT varde som skrivs over. Den kan inte svara pa
 *     "hur ofta" eller "harifran", och en misslyckad inloggning syns inte alls.
 *
 * Handelseloggen ar dessutom det navet sjalvt kallar bevis (AC-12.1, K10), och
 * bevisvardet ligger i att allt star pa samma stalle med samma oforanderlighet.
 * ===========================================================================
 *
 * MISSLYCKADE FORSOK MOT EN OKAND ADRESS SPARAR INTE ADRESSEN.
 *
 * Den som skriver fel i e-postfaltet skriver ibland nagon ANNANS adress, och
 * ibland en adress som inte hor till bolaget alls. Att spara den hade lagt en
 * utomstaende persons uppgift i en logg som bevaras som bevis, utan att det
 * finns nagon som helst nytta med den: det man vill veta ar "nagon forsokte ta
 * sig in pa ett konto som finns", och det svaret kraver inte adressen.
 *
 * Ar adressen kand skrivs raden pa den anstalldas id i stallet, vilket ar bade
 * mer anvandbart och mindre uppgift.
 */

/** Vem adressen hor till, eller null. Service role: ingen ar inloggad an. */
async function anstalldFor(epost: string): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin()
      .from("employee")
      .select("id")
      .eq("email", epost)
      .maybeSingle();
    return data?.id ?? null;
  } catch {
    return null;
  }
}

/** Klientens adress, som `auth.step2_verified` redan skriver den. */
async function klientIp(): Promise<string | null> {
  try {
    const h = await headers();
    const vidarebefordrad = h.get("x-forwarded-for");
    return vidarebefordrad ? vidarebefordrad.split(",")[0].trim() : null;
  } catch {
    return null;
  }
}

export type Inloggningsmetod = "losenord" | "lank";

/** En lyckad inloggning. */
export async function loggaInloggning(epost: string, metod: Inloggningsmetod): Promise<void> {
  const id = await anstalldFor(epost);
  await skrivHandelse({
    actorId: id,
    action: "auth.login",
    objectType: "auth",
    // Ett konto utan employee-rad ska anda ge en rad. `okand` i stallet for
    // adressen, av samma skal som misslyckade forsok inte bar den.
    objectId: id ?? "okand",
    meta: { metod, ip: await klientIp() },
  });
}

/**
 * Ett misslyckat forsok.
 *
 * `orsak` ar navets egen, redan oversatta text — aldrig Supabases rautext, som
 * kan bara en adress i klartext.
 */
export async function loggaMisslyckadInloggning(
  epost: string,
  metod: Inloggningsmetod,
  orsak: string,
): Promise<void> {
  const id = await anstalldFor(epost);
  await skrivHandelse({
    actorId: id,
    action: "auth.login_failed",
    objectType: "auth",
    objectId: id ?? "okand",
    meta: { metod, orsak, kant_konto: id !== null, ip: await klientIp() },
  });
}

/** En utloggning. Den som loggar ut ar kand, sa raden bar alltid ett id. */
export async function loggaUtloggning(anstalldId: string): Promise<void> {
  await skrivHandelse({
    actorId: anstalldId,
    action: "auth.logout",
    objectType: "auth",
    objectId: anstalldId,
    meta: { ip: await klientIp() },
  });
}
