import "server-only";

import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { getCurrentUser, hasRole, type CurrentUser } from "@/lib/auth";
import { utgangsdatum } from "@/lib/utbildning";

/**
 * M6:s delade skrivregler.
 *
 * ===========================================================================
 * VARFOR DE BOR HAR OCH INTE I EN actions.ts
 *
 * Fram till 0067 lag `certifieraPerson()` och `farTaModul()` som privata
 * funktioner i src/app/(app)/utbildning/actions.ts. Det holl sa lange modulen
 * hade en enda actions-fil. Det skriftliga provet rattas i en annan vy, av en
 * annan person, i en annan fil — och da fanns tva vagar framat: kopiera de tva
 * reglerna, eller flytta dem hit.
 *
 * Kopian ar den dyra. "Far jag ta den har modulen?" och "ar kursen klar nu?" ar
 * exakt de tva fragor som blir farliga nar de besvaras pa tva stallen: den ena
 * kopian far en rattelse, den andra inte, och skillnaden syns forst som ett
 * certifikat nagon inte borde ha.
 *
 * FILEN BAR INTE "use server". Allt som exporteras ur en sadan fil blir en
 * publik andpunkt, och `certifieraPerson()` tar en anstalld och en kurs som
 * argument — den hade alltsa latit vem som helst dela ut vilket certifikat som
 * helst till vem som helst. Samma skal som star i `notishandelse-server.ts`.
 * ===========================================================================
 */

/** Kretsen som far skriva kurser. Samma som far skriva rutiner (PRD §5.2). */
export function farRedigeraKurs(user: CurrentUser | null): boolean {
  return hasRole(user, "sales_manager", "admin", "ceo", "team_lead");
}

export async function kravKursredaktor() {
  const user = await getCurrentUser();
  if (!farRedigeraKurs(user) || !user?.employee) {
    throw new Error("Du saknar behörighet att redigera kurser.");
  }
  return user;
}

export async function loggaKurs(
  actorId: string,
  action: string,
  objectId: string,
  meta?: Record<string, unknown>,
) {
  await supabaseAdmin().from("audit_log").insert({
    actor_id: actorId,
    action,
    object_type: "course",
    object_id: objectId,
    meta: meta ?? null,
  });
}

/**
 * Kursen ar klar nar varje modul ar det, och certifikatet skrivs HAR och ingen
 * annanstans — sa att det bara kan uppsta som foljd av en faktiskt genomford
 * kurs.
 *
 * Tar en utpekad person och inte den inloggade, eftersom bade rollspelet och
 * det skriftliga provet bedoms av NAGON ANNAN. Att utga fran den inloggade hade
 * gett chefen ett certifikat pa en kurs hon inte gatt.
 */
export async function certifieraPerson(employeeId: string, kursId: string): Promise<boolean> {
  const db = supabaseAdmin();

  const [{ data: moduler }, { data: klara }, { data: kurs }] = await Promise.all([
    db.from("course_module").select("id").eq("course_id", kursId),
    db.from("module_progress").select("module_id").eq("employee_id", employeeId),
    db.from("course").select("valid_months").eq("id", kursId).maybeSingle(),
  ]);

  const alla = (moduler ?? []).map((m) => m.id);
  if (alla.length === 0) return false;

  const klaraSet = new Set((klara ?? []).map((k) => k.module_id));
  if (!alla.every((id) => klaraSet.has(id))) return false;

  const { data: redan } = await db
    .from("certification")
    .select("id, expires_at")
    .eq("employee_id", employeeId)
    .eq("course_id", kursId)
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Ett giltigt certifikat racker. Ett utganget ersatts av ett nytt.
  if (redan && (!redan.expires_at || new Date(redan.expires_at) > new Date())) return false;

  await db.from("certification").insert({
    employee_id: employeeId,
    course_id: kursId,
    expires_at: utgangsdatum(kurs?.valid_months ?? null),
  });

  await loggaKurs(employeeId, "course.certified", kursId, {
    giltig_manader: kurs?.valid_months ?? null,
  });
  return true;
}

/** AC-6.1: modulerna tas i ordning. Att hoppa over ar inte ett alternativ. */
export async function farTaModul(user: CurrentUser, modulId: string): Promise<boolean> {
  const rls = await supabaseServer();
  const { data: modul } = await rls
    .from("course_module")
    .select("id, course_id, sort")
    .eq("id", modulId)
    .maybeSingle();
  if (!modul) return false;

  const { data: tidigare } = await rls
    .from("course_module")
    .select("id")
    .eq("course_id", modul.course_id)
    .lt("sort", modul.sort);

  if ((tidigare ?? []).length === 0) return true;

  const { data: klara } = await rls
    .from("module_progress")
    .select("module_id")
    .eq("employee_id", user.employee!.id)
    .in(
      "module_id",
      (tidigare ?? []).map((t) => t.id),
    );

  return (klara ?? []).length === (tidigare ?? []).length;
}
