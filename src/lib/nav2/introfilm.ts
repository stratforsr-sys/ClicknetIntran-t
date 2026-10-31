import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CurrentUser } from "@/lib/auth";
import { lagerForNyaFiler } from "@/lib/lagring-server";
import { introBeslut, type Introrad, type NdIntrofilm } from "./introfilmforma";

export type { NdIntrofilm } from "./introfilmforma";

/**
 * Introfilmen i /nav2:s data: om grinden ska visas för den inloggade (0270).
 *
 * En fråga mot den egna raden, med den inloggades klient (RLS). Delen kastar
 * aldrig: ett fel här får inte göra att navet inte går att läsa, och utan
 * svar visas ingen film. Ingen blir utestängd.
 *
 * Utan R2 i miljön finns ingen film att spela, och då visas ingen grind.
 */
export async function byggIntrofilm(supabase: SupabaseClient, user: CurrentUser): Promise<NdIntrofilm | null> {
  if (!user.employee || lagerForNyaFiler() !== "r2") return null;
  try {
    const { data, error } = await supabase
      .from("introfilm")
      .select("sedd_at, varje_gang")
      .eq("employee_id", user.employee.id)
      .maybeSingle();
    if (error) return null;
    return introBeslut((data as Introrad | null) ?? null);
  } catch {
    return null;
  }
}
