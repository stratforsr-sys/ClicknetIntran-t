import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** AC-1.8, R11. Grasen ligger i PRD:n och andras inte utan att den andras. */
const DAGAR = 45;

const tidpunkt = (v: string | null) => (v ? Date.parse(v) : null);

export type Kontoutfall = {
  granskade: number;
  speglade: number;
  flaggade: number;
  avflaggade: number;
};

/**
 * Hamtar hem senaste inloggning fran auth och flaggar konton som legat
 * oanvanda for lange.
 */
export async function korKontojobbet(db: SupabaseClient): Promise<Kontoutfall> {
  const utfall: Kontoutfall = { granskade: 0, speglade: 0, flaggade: 0, avflaggade: 0 };

  // Senaste inloggning bor i auth, inte i personalregistret. Den speglas hit
  // sa att bade vyer och RLS kan rakna pa den utan admin-nyckel.
  const inloggningar = new Map<string, string | null>();
  for (let sida = 1; sida <= 20; sida++) {
    const { data, error } = await db.auth.admin.listUsers({ page: sida, perPage: 200 });
    if (error) throw new Error(error.message);
    for (const u of data.users) inloggningar.set(u.id, u.last_sign_in_at ?? null);
    if (data.users.length < 200) break;
  }

  const { data: anstallda, error: lasFel } = await db
    .from("employee")
    .select("id, auth_user_id, created_at, last_sign_in_at, inactive_flagged_at, status")
    .neq("status", "offboarded");

  if (lasFel) throw new Error(lasFel.message);

  const nu = Date.now();
  const grans = nu - DAGAR * 24 * 60 * 60 * 1000;
  utfall.granskade = (anstallda ?? []).length;

  for (const a of anstallda ?? []) {
    const senast = a.auth_user_id ? (inloggningar.get(a.auth_user_id) ?? null) : null;

    // Jamfor som tidpunkt, inte som text. Auth svarar "...555Z" och Postgres
    // "...555+00:00" — samma ogonblick, olika strangar.
    if (tidpunkt(senast) !== tidpunkt(a.last_sign_in_at)) {
      await db.from("employee").update({ last_sign_in_at: senast }).eq("id", a.id);
      utfall.speglade++;
    }

    // Har kontot aldrig anvants raknas tiden fran upplagget.
    const referens = senast ? Date.parse(senast) : Date.parse(a.created_at);
    const forGammalt = referens < grans;

    if (forGammalt && !a.inactive_flagged_at) {
      await db
        .from("employee")
        .update({ inactive_flagged_at: new Date(nu).toISOString() })
        .eq("id", a.id);
      await db.from("audit_log").insert({
        actor_id: null,
        action: "account.flagged_inactive",
        object_type: "employee",
        object_id: a.id,
        meta: { dagar: DAGAR, senaste_inloggning: senast },
      });
      utfall.flaggade++;
    } else if (!forGammalt && a.inactive_flagged_at) {
      await db.from("employee").update({ inactive_flagged_at: null }).eq("id", a.id);
      await db.from("audit_log").insert({
        actor_id: null,
        action: "account.unflagged",
        object_type: "employee",
        object_id: a.id,
        meta: { senaste_inloggning: senast },
      });
      utfall.avflaggade++;
    }
  }

  return utfall;
}
