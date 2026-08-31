import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { guiderForRoller } from "@/guider";
import { FRIST_DAGAR, personlage, type Progress } from "@/lib/guider";
import { stampelfri } from "@/lib/stampelfri";
import type { Permission, Role } from "@/lib/roles";

/**
 * G6: onboardingen som inte blev av.
 *
 * ===========================================================================
 * VARFÖR ETT ÄRENDE OCH INTE EN NOTIS
 *
 * Klockan säger till om det som går att göra nu. Den här signalen är av en
 * annan sort: någon har varit anställd i över två veckor utan att gå igenom
 * navet, och det är inte en påminnelse utan något någon ska ta tag i. Ett
 * ärende har en handläggare, en frist och en kvittens. En notis har inget av
 * det, och den försvinner när någon klickar på den.
 *
 * Samma val som `satser.ts` gjorde för föråldrade satser, och av samma skäl.
 * ===========================================================================
 *
 * ÄRENDET GÅR TILL CHEFEN, INTE TILL PERSONEN. Den som inte hunnit göra sina
 * guider har redan en påminnelse i klockan; att dessutom få ett ärende om sig
 * själv är en tillsägelse med diarienummer. Saknas närmaste chef går det till
 * säljchefen — en lucka i organisationen får inte bli tystnad, samma
 * fallback-mönster som i sjukanmälans ringordning (AC-3.18).
 *
 * ETT ÄRENDE PER PERSON, INTE PER NATT. Referensen bär personens id och
 * ingenting mer, så nästa natt hittar raden och hoppar över. Blir personen klar
 * senare stängs ärendet av en människa — jobbet stänger det inte åt någon, för
 * då hade "det löste sig" och "ingen hann titta" sett likadana ut.
 *
 * DEN SOM AVSLUTATS RÖRS INTE. En offboardad person har inget onboardingpaket
 * kvar att bli klar med, och ett ärende om henne är bara brus i kön.
 */
export async function korGuidejobbet(
  db: SupabaseClient,
  stamplingPa: boolean,
): Promise<{ granskade: number; forsenade: number; arenden: number }> {
  const { data: personal, error } = await db
    .from("employee")
    .select("id, first_name, last_name, start_date, status, manager_id")
    .neq("status", "offboarded");

  if (error) throw new Error(error.message);
  if (!personal || personal.length === 0) {
    return { granskade: 0, forsenade: 0, arenden: 0 };
  }

  const [{ data: rollrader }, { data: behrader }, { data: progress }] = await Promise.all([
    db.from("employee_role").select("employee_id, role"),
    db.from("employee_permission").select("employee_id, permission"),
    db.from("guide_progress").select("employee_id, guide_slug, version, steg, completed_at, updated_at"),
  ]);

  const rollPer = new Map<string, Role[]>();
  for (const r of rollrader ?? []) {
    rollPer.set(r.employee_id, [...(rollPer.get(r.employee_id) ?? []), r.role as Role]);
  }

  const behPer = new Map<string, Permission[]>();
  for (const b of behrader ?? []) {
    behPer.set(b.employee_id, [...(behPer.get(b.employee_id) ?? []), b.permission as Permission]);
  }

  const raderPer = new Map<string, Progress[]>();
  for (const r of progress ?? []) {
    raderPer.set(r.employee_id, [...(raderPer.get(r.employee_id) ?? []), r as Progress]);
  }

  // Fallback när närmaste chef saknas. Första aktiva säljchefen, precis som i
  // satsjobbet.
  const fallback =
    (rollrader ?? [])
      .filter((r) => r.role === "sales_manager")
      .map((r) => r.employee_id)
      .find((id) => personal.some((p) => p.id === id)) ?? null;

  const nu = new Date();
  let forsenade = 0;
  let arenden = 0;

  for (const person of personal) {
    const roller = rollPer.get(person.id) ?? [];
    const guider = guiderForRoller(roller, {
      stamplar: stamplingPa && !stampelfri(roller),
      behorigheter: behPer.get(person.id) ?? [],
    });
    if (guider.length === 0) continue;

    const lage = personlage(guider, raderPer.get(person.id) ?? [], person.start_date, nu);
    if (!lage.forsenad) continue;
    forsenade += 1;

    const mottagare = person.manager_id ?? fallback;
    // Ingen chef och ingen säljchef: det är ett organisationsproblem, inte
    // något det här jobbet kan lösa. Bättre tyst än ett ärende till personen
    // själv om att hon är sen.
    if (!mottagare || mottagare === person.id) continue;

    const referens = `guider:${person.id}`;
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
    const { data: arende } = await db
      .from("hr_case")
      .insert({
        employee_id: mottagare,
        created_by: mottagare,
        category: "other",
        subject: `${namn} har inte gått igenom sina systemguider — ${referens}`,
        assigned_to: mottagare,
      })
      .select("id")
      .single();

    if (!arende) continue;

    await db.from("case_message").insert({
      case_id: arende.id,
      author_id: mottagare,
      body: [
        `${namn} började ${person.start_date ?? "okänt datum"} och har ${lage.klara} av ${lage.av} systemguider klara.`,
        lage.pagar
          ? `Senast påbörjad tur: ${lage.pagar.titel}, steg ${lage.pagar.steg} av ${lage.pagar.av}.`
          : "Ingen tur är påbörjad.",
        lage.stillestand === null
          ? "Ingen aktivitet alls är bokförd."
          : `Senaste rörelsen var för ${lage.stillestand} dagar sedan.`,
        "",
        `Fristen är ${FRIST_DAGAR} dagar från startdatum. Guiderna låser ingenting — det här är en signal, inte en spärr.`,
        "Läget per person: Utbildning → Översikt → Systemguider. Därifrån går det att knuffa.",
        "",
        "Påminnelsen kommer från nattjobbet (G6).",
      ].join("\n"),
    });

    await db.from("audit_log").insert({
      actor_id: mottagare,
      action: "guide.onboarding_overdue",
      object_type: "employee",
      object_id: person.id,
      meta: { klara: lage.klara, av: lage.av, start_date: person.start_date },
    });

    arenden += 1;
  }

  return { granskade: personal.length, forsenade, arenden };
}
