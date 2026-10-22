import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * För- och efternamn ur personalregistret, för hälsningen och för kontot som
 * enheten minns. Service role: vid inloggningen är sessionen bara sekunder
 * gammal, och under ett tvingat lösenordsbyte ger kontots egen token noll
 * rader (migration 0017). Bara namnet läses, och bara för kontot självt.
 */
export async function namnFor(authUserId: string): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin()
      .from("employee")
      .select("first_name, last_name")
      .eq("auth_user_id", authUserId)
      .maybeSingle();
    const namn = data ? `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim() : "";
    return namn || null;
  } catch {
    return null;
  }
}
