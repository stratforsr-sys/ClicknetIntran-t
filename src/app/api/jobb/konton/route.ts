import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** AC-1.8, R11. Grasen ligger i PRD:n och andras inte utan att den andras. */
const DAGAR = 45;

/**
 * Schemalagt jobb: hamtar hem senaste inloggning fran auth och flaggar konton
 * som legat oanvanda for lange.
 *
 * Vercel skickar `Authorization: Bearer $CRON_SECRET` pa sina cron-anrop.
 * Saknas hemligheten i miljon svarar rutten 503 i stallet for att kora oskyddat
 * — en oppen rutt som skriver i personalregistret ar inget att ha.
 */
export async function GET(request: NextRequest) {
  const hemlighet = process.env.CRON_SECRET;
  if (!hemlighet) {
    return NextResponse.json({ fel: "CRON_SECRET saknas" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${hemlighet}`) {
    return NextResponse.json({ fel: "Nekad" }, { status: 401 });
  }

  const db = supabaseAdmin();

  // Senaste inloggning bor i auth, inte i personalregistret. Den speglas hit
  // sa att bade vyer och RLS kan rakna pa den utan admin-nyckel.
  const inloggningar = new Map<string, string | null>();
  for (let sida = 1; sida <= 20; sida++) {
    const { data, error } = await db.auth.admin.listUsers({ page: sida, perPage: 200 });
    if (error) return NextResponse.json({ fel: error.message }, { status: 500 });
    for (const u of data.users) inloggningar.set(u.id, u.last_sign_in_at ?? null);
    if (data.users.length < 200) break;
  }

  const { data: anstallda, error: lasFel } = await db
    .from("employee")
    .select("id, auth_user_id, first_name, last_name, created_at, last_sign_in_at, inactive_flagged_at, status")
    .neq("status", "offboarded");

  if (lasFel) return NextResponse.json({ fel: lasFel.message }, { status: 500 });

  const nu = Date.now();
  const grans = nu - DAGAR * 24 * 60 * 60 * 1000;
  let flaggade = 0;
  let avflaggade = 0;
  let speglade = 0;

  for (const a of anstallda ?? []) {
    const senast = a.auth_user_id ? (inloggningar.get(a.auth_user_id) ?? null) : null;

    if (senast !== a.last_sign_in_at) {
      await db.from("employee").update({ last_sign_in_at: senast }).eq("id", a.id);
      speglade++;
    }

    // Har kontot aldrig anvants raknas tiden fran upplagget. Annars hade en
    // nyanstalld flaggats direkt, och en som aldrig loggat in aldrig alls.
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
      flaggade++;
    } else if (!forGammalt && a.inactive_flagged_at) {
      await db.from("employee").update({ inactive_flagged_at: null }).eq("id", a.id);
      await db.from("audit_log").insert({
        actor_id: null,
        action: "account.unflagged",
        object_type: "employee",
        object_id: a.id,
        meta: { senaste_inloggning: senast },
      });
      avflaggade++;
    }
  }

  return NextResponse.json({
    granskade: (anstallda ?? []).length,
    speglade,
    flaggade,
    avflaggade,
  });
}
