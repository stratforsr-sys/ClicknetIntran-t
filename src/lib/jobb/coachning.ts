import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { ARENDE_EFTER_DAGAR, TYP_ETIKETT, arSjalvsann, lageFor, type Handelse, type Uppgiftstyp } from "@/lib/coachning";

/**
 * Coachningsuppgiften som gick over fristen.
 *
 * ===========================================================================
 * VARFOR ETT ARENDE OCH INTE EN NOTIS
 *
 * Klockan sager redan till om det som statt still i tre dygn, och den som ska
 * gora uppgiften har fatt sin paminnelse for lange sedan. Fjorton dagar OVER
 * fristen ar av en annan sort: det ar inte langre nagot som glomts bort, det ar
 * nagot ingen tagit tag i. Ett arende har en handlaggare, en frist och en
 * kvittens. En notis har inget av det och forsvinner nar nagon klickar pa den.
 *
 * Samma val som G6 gjorde for onboardingen, och av samma skal.
 * ===========================================================================
 *
 * ARENDET GAR TILL CHEFEN, INTE TILL PERSONEN. Den som ar sen har redan en rad
 * i sin klocka; att dessutom fa ett arende om sig sjalv ar en tillsagelse med
 * diarienummer.
 *
 * ETT ARENDE PER UPPGIFT, INTE PER NATT. Referensen bar uppgiftens id, sa nasta
 * natt hittar raden och hoppar over. Blir uppgiften klar senare stangs arendet
 * av en manniska — jobbet stanger det inte at nagon, for da hade "det loste
 * sig" och "ingen hann titta" sett likadana ut.
 *
 * DE SJALVSANNA TYPERNA STAR UTANFOR. En forsenad kurs har redan sin egen
 * uppfoljning i M6, och ett arende till hade betytt tva kanaler for samma
 * forsening — den dagen de sager olika vet ingen vilken som galler.
 */
export async function korCoachningsjobbet(
  db: SupabaseClient,
): Promise<{ granskade: number; forsenade: number; arenden: number }> {
  const idag = new Date();
  const grans = new Date(idag);
  grans.setDate(grans.getDate() - ARENDE_EFTER_DAGAR);
  const gransdatum = grans.toISOString().slice(0, 10);

  /**
   * Fragan filtrerar pa fristen i DATABASEN, inte i minnet. En modul som vaxer
   * till tusen uppgifter ska inte lasa in dem alla varje natt for att sedan
   * kasta nittionio procent.
   */
  const { data: uppgifter, error } = await db
    .from("coaching_task")
    .select("id, title, kind, assignee_id, created_by, due_date")
    .is("cancelled_at", null)
    .not("due_date", "is", null)
    .lte("due_date", gransdatum);

  if (error) throw new Error(error.message);
  if (!uppgifter || uppgifter.length === 0) return { granskade: 0, forsenade: 0, arenden: 0 };

  const manskliga = uppgifter.filter((u) => !arSjalvsann(u.kind as Uppgiftstyp));
  if (manskliga.length === 0) return { granskade: uppgifter.length, forsenade: 0, arenden: 0 };

  const [{ data: handelser }, { data: personal }, { data: rollrader }] = await Promise.all([
    db.from("coaching_task_event").select("task_id, type, at").in("task_id", manskliga.map((u) => u.id)),
    db.from("employee").select("id, first_name, last_name, status, manager_id").neq("status", "offboarded"),
    db.from("employee_role").select("employee_id, role"),
  ]);

  const perUppgift = new Map<string, Handelse[]>();
  for (const h of handelser ?? []) {
    perUppgift.set(h.task_id, [...(perUppgift.get(h.task_id) ?? []), { type: h.type as Handelse["type"], at: h.at }]);
  }

  const personPer = new Map((personal ?? []).map((p) => [p.id, p]));

  // Fallback nar narmaste chef saknas. Forsta aktiva saljchefen, precis som i
  // guide- och satsjobbet: en lucka i organisationen far inte bli tystnad.
  const fallback =
    (rollrader ?? [])
      .filter((r) => r.role === "sales_manager")
      .map((r) => r.employee_id)
      .find((id) => personPer.has(id)) ?? null;

  let forsenade = 0;
  let arenden = 0;

  for (const u of manskliga) {
    const lage = lageFor({
      kind: u.kind as Uppgiftstyp,
      handelser: perUppgift.get(u.id) ?? [],
    });
    if (lage === "klar" || lage === "avbruten") continue;

    const person = personPer.get(u.assignee_id);
    // Den som avslutats har inga coachningsuppgifter kvar att bli klar med, och
    // ett arende om henne ar bara brus i kon.
    if (!person) continue;
    forsenade += 1;

    const mottagare = person.manager_id ?? fallback;
    // Ingen chef och ingen saljchef: det ar ett organisationsproblem, inte nagot
    // det har jobbet kan losa. Battre tyst an ett arende till personen sjalv om
    // att hon ar sen.
    if (!mottagare || mottagare === person.id) continue;

    const referens = `coachning:${u.id}`;
    const { data: fanns } = await db
      .from("hr_case")
      .select("id")
      .eq("employee_id", mottagare)
      .eq("category", "other")
      .ilike("subject", `%${referens}%`)
      .limit(1)
      .maybeSingle();

    if (fanns) continue;

    const namn = `${person.first_name} ${person.last_name}`.trim();
    const dagarOver = Math.floor((Date.now() - Date.parse(`${u.due_date}T23:59:59Z`)) / 86_400_000);

    const { data: arende } = await db
      .from("hr_case")
      .insert({
        employee_id: mottagare,
        created_by: mottagare,
        category: "other",
        subject: `${namn} har en coachningsuppgift ${dagarOver} dagar över fristen — ${referens}`,
        assigned_to: mottagare,
      })
      .select("id")
      .single();

    if (!arende) continue;

    await db.from("case_message").insert({
      case_id: arende.id,
      author_id: mottagare,
      body: [
        `"${u.title}" (${TYP_ETIKETT[u.kind as Uppgiftstyp]}) skulle varit klar ${u.due_date}.`,
        `Läget är "${lage}". Fristen passerades för ${dagarOver} dagar sedan.`,
        "",
        "Coachningen låser ingenting — det här är en signal, inte en spärr.",
        `Uppgiften: /coachning/uppgift/${u.id}`,
        `Personens kort: /coachning/${person.id}`,
        "",
        "Påminnelsen kommer från nattjobbet (coachning).",
      ].join("\n"),
    });

    await db.from("audit_log").insert({
      actor_id: mottagare,
      action: "coaching_task.overdue",
      object_type: "coaching_task",
      object_id: u.id,
      meta: { assignee_id: person.id, due_date: u.due_date, dagar_over: dagarOver, lage },
    });

    arenden += 1;
  }

  return { granskade: uppgifter.length, forsenade, arenden };
}
