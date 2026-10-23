import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Stänger en anställning: status, slutdatum, roller, sessioner, ärenden och
 * avslutslistan. Kärnan i repots `offboarda` (src/app/(app)/personal/actions.ts),
 * utbruten så att nattjobbet kan stänga ett avslut som registrerats i förväg
 * (granskningen 2026-10-22, F1-8): ett avslut med sista dag framåt stänger
 * inloggningen natten efter sista dagen, inte direkt. Samma kod i båda vägarna.
 *
 * `aktor` är den som avslutade (i nattjobbet: `employee.end_reason_by`).
 */

async function logga(
  db: SupabaseClient,
  actorId: string,
  action: string,
  objectType: string,
  objectId: string,
  meta?: Record<string, unknown>,
) {
  await db.from("audit_log").insert({ actor_id: actorId, action, object_type: objectType, object_id: objectId, meta: meta ?? null, reason: null });
}

export const CHECKLISTA = [
  "Konto i navet avslutat",
  "Inkio-behörighet borttagen",
  "Dialer-kö avslutad och kösegment frigjort",
  "E-postkonto avslutat eller vidarebefordrat",
  "Dator och kringutrustning återlämnad",
  "Telefon och SIM återlämnat",
  "Passerkort och nycklar återlämnade",
  "Slutlön och provisionsunderlag överlämnat till lön",
];

export async function stangAnstallning(
  db: SupabaseClient,
  aktor: string,
  employeeId: string,
  slutdatum: string,
): Promise<{ stangda: number; aterlamnade: number }> {
  const { data: anst } = await db
    .from("employee")
    .select("auth_user_id")
    .eq("id", employeeId)
    .single();

  await db
    .from("employee")
    .update({ status: "offboarded", end_date: slutdatum })
    .eq("id", employeeId);

  await db.from("employee_role").delete().eq("employee_id", employeeId);
  await db.from("employee_permission").delete().eq("employee_id", employeeId);

  if (anst?.auth_user_id) {
    // Stanger alla aktiva sessioner. Bannlysning hindrar nya tokens.
    await db.auth.admin
      .updateUserById(anst.auth_user_id, { ban_duration: "876000h" })
      .catch(() => null);
  }

  /**
   * E1.8: oppna arenden.
   *
   * Utan det har blev en avslutad anstalld kvar i inkorgen som en trad ingen
   * kan svara pa — kontot ar bannlyst i samma andetag — medan fristen fortsatte
   * ticka och drog med sig SLA-statistiken i AC-4.5.
   *
   * De stangs alltsa, men INTE tyst. `resolution` sager varfor, varje stangning
   * far en rad i loggen, och fanns det oppna arenden laggs en extra punkt i
   * checklistan. Den punkten ar hela poangen: AC-4.5:s statistik blir ren av att
   * traden stangs, men fragan i den kan mycket val leva vidare — ett arende om
   * provision pa en affar som ligger kvar hos kunden slutar inte existera for
   * att den som stallde fragan slutat. AC-1.7 later inte punkten hoppas over
   * utan motivering, och det ar den enda notis navet kan ge sa lange E0.8
   * saknas.
   */
  const { data: oppnaArenden } = await db
    .from("hr_case")
    .select("id, subject, status")
    .eq("employee_id", employeeId)
    .is("resolved_at", null);

  const antalOppna = (oppnaArenden ?? []).length;

  if (antalOppna > 0) {
    const nu = new Date().toISOString();
    await db
      .from("hr_case")
      .update({
        status: "resolved",
        resolved_at: nu,
        resolution: `Avslutades automatiskt ${slutdatum} när anställningen avslutades. Ingen åtgärd är därmed gjord — kontrollera offboardingchecklistan.`,
      })
      .eq("employee_id", employeeId)
      .is("resolved_at", null);

    for (const arende of oppnaArenden ?? []) {
      await logga(db, aktor, "case.closed_by_offboarding", "hr_case", arende.id, {
        employeeId,
        rubrik: arende.subject,
        tidigare_status: arende.status,
      });
    }
  }

  /**
   * Arenden som personen var handlaggare for gar tillbaka till inkorgen.
   *
   * De ror ANDRA anstallda och far darfor inte stangas — men de far inte
   * heller sta kvar tilldelade nagon som inte kan logga in. En tilldelning ar
   * det som avgor vem som anser sig ansvarig, och en kvarglomd sadan ar ett
   * arende som ingen tittar pa fast alla tror att nagon gor det.
   */
  const { data: tilldelade } = await db
    .from("hr_case")
    .select("id")
    .eq("assigned_to", employeeId)
    .is("resolved_at", null);

  if ((tilldelade ?? []).length > 0) {
    await db
      .from("hr_case")
      .update({ assigned_to: null })
      .eq("assigned_to", employeeId)
      .is("resolved_at", null);

    for (const arende of tilldelade ?? []) {
      await logga(db, aktor, "case.unassigned_by_offboarding", "hr_case", arende.id, {
        employeeId,
      });
    }
  }

  const { count } = await db
    .from("offboarding_task")
    .select("id", { count: "exact", head: true })
    .eq("employee_id", employeeId);

  if ((count ?? 0) === 0) {
    const punkter = [...CHECKLISTA];
    if (antalOppna > 0) {
      // Forst i listan. Den star dar for att den ar det enda i checklistan som
      // navet sjalvt har andrat pa, och det ska inte behova letas fram.
      punkter.unshift(
        `${antalOppna} öppet personalärende${antalOppna === 1 ? "" : "n"} stängdes automatiskt — kontrollera att inget kräver åtgärd`,
      );
    }
    await db.from("offboarding_task").insert(
      punkter.map((label, i) => ({ employee_id: employeeId, label, sort: i })),
    );
  }

  await logga(db, aktor, "employee.offboarded", "employee", employeeId, {
    slutdatum,
    stangda_arenden: antalOppna,
    aterlamnade_arenden: (tilldelade ?? []).length,
  });
  return { stangda: antalOppna, aterlamnade: (tilldelade ?? []).length };
}
