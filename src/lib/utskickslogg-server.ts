import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * UTSKICKSLOGGEN (0271): vad Nav faktiskt skickade.
 *
 * ===========================================================================
 * EN RAD PER FÖRSÖK, SKRIVEN DÄR ALLT PASSERAR
 *
 * Varje mejl går genom `skickaEpost()` (`epost.ts`) och varje push genom
 * `pushaTill()` (`nav2/push.ts`). Loggen skrivs där och ingen annanstans, så
 * att ett nytt utskick inte kan glömma den: brevet kräver en `logg` för att
 * kompilera, och pushen en sort.
 *
 * Före 0271 fanns inget spår alls. Resend-nyckeln är send-only, så deras logg
 * går inte att läsa i efterhand, och Google och Apple säger ingenting. Det
 * gick alltså inte att svara på hur många mejl en person fick i veckan, och
 * därmed inte att mäta om en ändring av utskicken hjälpte.
 * ===========================================================================
 *
 * KASTAR ALDRIG. Loggen är ett vittne, inte en del av utskicket: ett brev som
 * gått fram får inte rapporteras som misslyckat för att loggraden inte gick
 * att skriva.
 */

/** Det utskicket bär med sig till loggen. */
export type Utskicksmarkning = {
  /** Notiskällan, eller utskickets namn när det inte är en notis ('morgonbrev'). */
  sort: string;
  /** Mottagaren, när det är en anställd. */
  employeeId?: string | null;
  /** Notisen utskicket gällde, när det finns en. */
  notisId?: number | null;
};

export type Utskicksrad = Utskicksmarkning & {
  kanal: "mejl" | "push";
  ok: boolean;
  status?: number | null;
  fel?: string | null;
  /** Resends id för ett mejl, enhetens id för en push. */
  externId?: string | null;
};

export async function loggaUtskick(rader: readonly Utskicksrad[]): Promise<void> {
  if (rader.length === 0) return;
  try {
    await supabaseAdmin()
      .from("notification_delivery")
      .insert(
        rader.map((r) => ({
          kanal: r.kanal,
          sort: (r.sort || "okand").slice(0, 60),
          employee_id: r.employeeId ?? null,
          notification_id: r.notisId ?? null,
          ok: r.ok,
          status: r.status ?? null,
          fel: r.fel ? r.fel.slice(0, 300) : null,
          extern_id: r.externId ? r.externId.slice(0, 100) : null,
        })),
      );
  } catch {
    // Loggen är ett vittne. Utskicket har redan gått.
  }
}

/**
 * Nattjobbets gallring. Samma 90 dagar som notiserna (`rensaGamlaNotiser`):
 * loggen säger vad som gick ut, och längre än notisen själv behöver den inte
 * leva. Kastar vidare, som nattjobbets andra steg, så att felet syns i kvittot.
 */
export async function rensaGammalUtskickslogg(
  db: ReturnType<typeof supabaseAdmin>,
): Promise<{ raderade: number }> {
  const grans = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const { data, error } = await db.from("notification_delivery").delete().lt("created_at", grans).select("id");
  if (error) throw new Error(error.message);
  return { raderade: (data ?? []).length };
}
