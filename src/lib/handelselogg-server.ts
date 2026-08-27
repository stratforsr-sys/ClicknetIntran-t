import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * E6.1. Skrivvagen for handelser som inte hor hemma i en enskild modul.
 *
 * ===========================================================================
 * DEN HAR FUNKTIONEN FAR ALDRIG KASTA
 *
 * Samma skal som `skrivFel()`: den anropas fran inloggningen, och en logg som
 * faller far inte hindra nagon fran att komma in i navet. Ett try/catch som
 * svaljer, och returvardet sager om det gick.
 *
 * Undantaget som INTE galler har: `/filer/[id]` skriver `file_access_log` FORE
 * den utfardar en URL, och dar faller funktionen med flit om loggen inte gar
 * att skriva (K36). Skillnaden ar att dar ar loggen sjalva kravet for att
 * uppgiften ska lamnas ut — har ar den ett spar av nagot som redan hant.
 * ===========================================================================
 *
 * Filen bar INTE "use server". Allt som exporteras ur en sadan fil blir en
 * publik andpunkt, och det har har gatt fel tre ganger i det har repot
 * (`skrivFel`, `sattKvitto`, `registreraVisning`).
 */
export async function skrivHandelse(inlagg: {
  actorId: string | null;
  action: string;
  objectType: string;
  objectId: string;
  meta?: Record<string, unknown> | null;
  reason?: string | null;
}): Promise<boolean> {
  try {
    // IP:t ligger i `meta` och inte i kolumnen `ip`, precis som
    // `auth.step2_verified` redan gor det. Kolumnen ar av typen `inet`, och en
    // strang som inte gar att tolka som en adress faller hela insertet — alltsa
    // hade en trasig proxy-rubrik tystat sjalva inloggningsloggen.
    const { error } = await supabaseAdmin().from("audit_log").insert({
      actor_id: inlagg.actorId,
      action: inlagg.action,
      object_type: inlagg.objectType,
      object_id: inlagg.objectId,
      meta: inlagg.meta ?? null,
      reason: inlagg.reason ?? null,
    });
    return !error;
  } catch {
    return false;
  }
}
