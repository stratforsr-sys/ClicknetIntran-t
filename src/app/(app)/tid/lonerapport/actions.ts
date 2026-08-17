"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser, hasRole, fullName, type CurrentUser } from "@/lib/auth";
import { gallande, RAST_AKTIV, type Handelse } from "@/lib/tid";
import { blockeringar, type Blockering } from "@/lib/lonerapport";

export type PeriodState = { fel?: string; ok?: string; blockeringar?: Blockering[] };

/**
 * AC-2.15, K5b: attesten är en människas underskrift, och underskriften ska
 * kunna knytas till någon som får skriva under. Ekonomi får läsa och exportera
 * men inte attestera sitt eget underlag.
 */
async function kravAttestant(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!hasRole(user, "sales_manager", "ceo", "admin") || !user?.employee) {
    throw new Error("Du saknar behörighet för den här åtgärden.");
  }
  return user;
}

async function logga(
  actorId: string,
  action: string,
  objectId: string,
  meta?: Record<string, unknown>,
) {
  await supabaseAdmin().from("audit_log").insert({
    actor_id: actorId,
    action,
    object_type: "payroll_period",
    object_id: objectId,
    meta: meta ?? null,
  });
}

export async function skapaPeriod(_prev: PeriodState, form: FormData): Promise<PeriodState> {
  try {
    const user = await kravAttestant();
    const db = supabaseAdmin();

    const start = String(form.get("period_start") ?? "");
    const slut = String(form.get("period_end") ?? "");
    if (!start || !slut) return { fel: "Fyll i både start och slut." };
    if (slut < start) return { fel: "Perioden slutar innan den börjar." };

    const { data, error } = await db
      .from("payroll_period")
      .insert({ period_start: start, period_end: slut })
      .select("id")
      .single();

    if (error) {
      return {
        fel: error.code === "23505" ? "Perioden finns redan." : `Kunde inte skapa: ${error.message}`,
      };
    }

    await logga(user.employee!.id, "payroll.period_created", data.id, { start, slut });
    revalidatePath("/tid/lonerapport");
    return { ok: "Perioden är skapad. Generera underlaget när dagarna är avslutade." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Läser ihop allt som kan blockera perioden. Samma funktion används både före
 * generering och före attest — en period som var ren när underlaget skrevs kan
 * ha fått en ny rättelse under tiden.
 */
async function samlaBlockeringar(start: string, slut: string): Promise<Blockering[]> {
  const db = supabaseAdmin();
  const fran = `${start}T00:00:00.000Z`;
  const till = `${slut}T23:59:59.999Z`;

  const [{ data: personal }, { data: handelser }, { data: avvikelser }] = await Promise.all([
    db.from("employee").select("id, first_name, last_name").neq("status", "offboarded"),
    db
      .from("time_event")
      .select("id, employee_id, kind, occurred_at, source, supersedes_id, correction_state")
      .gte("occurred_at", fran)
      .lte("occurred_at", till),
    RAST_AKTIV
      ? db
          .from("break_deviation")
          .select("employee_id, work_date, kind")
          .gte("work_date", start)
          .lte("work_date", slut)
          .is("resolved_at", null)
      : Promise.resolve({ data: [] as { employee_id: string; work_date: string; kind: string }[] }),
  ]);

  const perPerson = new Map<string, Handelse[]>();
  for (const h of handelser ?? []) {
    perPerson.set(h.employee_id, [...(perPerson.get(h.employee_id) ?? []), h]);
  }

  // Gallringen sker har, inte i modulen: den bedomer en fardig lista.
  const giltiga: (Handelse & { employee_id: string })[] = [];
  for (const [id, egna] of perPerson) {
    for (const h of gallande(egna)) giltiga.push({ ...h, employee_id: id });
  }

  return blockeringar({
    personal: (personal ?? []).map((p) => ({ id: p.id, namn: fullName(p) })),
    handelser: giltiga,
    vantandeRattelser: (handelser ?? [])
      .filter((h) => h.correction_state === "pending")
      .map((h) => ({ employee_id: h.employee_id, occurred_at: h.occurred_at })),
    oavslutadeAvvikelser: avvikelser ?? [],
  });
}

/**
 * AC-2.13, AC-2.14. Underlaget skrivs bara om perioden är ren. Är den det inte
 * lämnas listan tillbaka — inte ett nej utan förklaring.
 */
export async function generera(_prev: PeriodState, form: FormData): Promise<PeriodState> {
  try {
    const user = await kravAttestant();
    const db = supabaseAdmin();

    const periodId = String(form.get("period_id") ?? "");
    const { data: period } = await db
      .from("payroll_period")
      .select("id, period_start, period_end, status")
      .eq("id", periodId)
      .maybeSingle();

    if (!period) return { fel: "Perioden finns inte." };
    if (period.status === "attested") return { fel: "Perioden är attesterad och kan inte skrivas om." };

    const hinder = await samlaBlockeringar(period.period_start, period.period_end);
    if (hinder.length > 0) {
      return {
        fel: `${hinder.length} sak${hinder.length === 1 ? "" : "er"} måste redas ut först.`,
        blockeringar: hinder,
      };
    }

    const fran = `${period.period_start}T00:00:00.000Z`;
    const till = `${period.period_end}T23:59:59.999Z`;

    const [{ data: personal }, { data: journal }, { data: avvikelser }] = await Promise.all([
      db.from("employee").select("id").neq("status", "offboarded"),
      db
        .from("work_time_journal")
        .select("employee_id, worked_minutes, break_minutes, auto_closed")
        .gte("work_date", period.period_start)
        .lte("work_date", period.period_end),
      db
        .from("break_deviation")
        .select("employee_id")
        .gte("work_date", period.period_start)
        .lte("work_date", period.period_end),
    ]);

    // Journalen ar kallan for avslutade dagar (AC-2.6, AC-2.7). Den skrivs av
    // nattjobbet nar dygnet ar over, sa den innehaller inte dagens rader — och
    // en period som inte ar slut ska inte heller sammanfattas.
    const summa = new Map<string, { arbetat: number; rast: number; autoStangda: number }>();
    for (const j of journal ?? []) {
      const f = summa.get(j.employee_id) ?? { arbetat: 0, rast: 0, autoStangda: 0 };
      f.arbetat += j.worked_minutes;
      f.rast += j.break_minutes;
      if (j.auto_closed) f.autoStangda += 1;
      summa.set(j.employee_id, f);
    }

    const antalAvvikelser = new Map<string, number>();
    for (const a of avvikelser ?? []) {
      antalAvvikelser.set(a.employee_id, (antalAvvikelser.get(a.employee_id) ?? 0) + 1);
    }

    await db.from("payroll_row").delete().eq("period_id", period.id);

    const rader = (personal ?? []).map((p) => {
      const f = summa.get(p.id) ?? { arbetat: 0, rast: 0, autoStangda: 0 };
      return {
        period_id: period.id,
        employee_id: p.id,
        worked_minutes: f.arbetat,
        break_minutes: f.rast,
        auto_closed_days: f.autoStangda,
        deviation_count: antalAvvikelser.get(p.id) ?? 0,
      };
    });

    if (rader.length > 0) {
      const { error } = await db.from("payroll_row").insert(rader);
      if (error) return { fel: `Underlaget kunde inte skrivas: ${error.message}` };
    }

    await db
      .from("payroll_period")
      .update({ generated_at: new Date().toISOString(), generated_by: user.employee!.id })
      .eq("id", period.id);

    await logga(user.employee!.id, "payroll.generated", period.id, {
      rader: rader.length,
      period: `${period.period_start} – ${period.period_end}`,
    });

    revalidatePath(`/tid/lonerapport/${period.id}`);
    return { ok: `Underlaget är skrivet för ${rader.length} personer.` };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/** AC-2.15: attesten låser perioden. Efter den går inget att skriva om. */
export async function attestera(_prev: PeriodState, form: FormData): Promise<PeriodState> {
  try {
    const user = await kravAttestant();
    const db = supabaseAdmin();

    const periodId = String(form.get("period_id") ?? "");
    const { data: period } = await db
      .from("payroll_period")
      .select("id, period_start, period_end, status, generated_at")
      .eq("id", periodId)
      .maybeSingle();

    if (!period) return { fel: "Perioden finns inte." };
    if (period.status === "attested") return { fel: "Perioden är redan attesterad." };
    if (!period.generated_at) return { fel: "Generera underlaget innan du attesterar." };

    // Kontrollen gors om. Underlaget kan ha skrivits i tisdags och en rattelse
    // ha kommit in i onsdags — attesten galler laget nu, inte da.
    const hinder = await samlaBlockeringar(period.period_start, period.period_end);
    if (hinder.length > 0) {
      return {
        fel: "Något har tillkommit sedan underlaget skrevs. Reda ut och generera om.",
        blockeringar: hinder,
      };
    }

    const { error } = await db
      .from("payroll_period")
      .update({
        status: "attested",
        attested_at: new Date().toISOString(),
        attested_by: user.employee!.id,
      })
      .eq("id", period.id);

    if (error) return { fel: `Attesten gick inte igenom: ${error.message}` };

    await logga(user.employee!.id, "payroll.attested", period.id, {
      period: `${period.period_start} – ${period.period_end}`,
    });

    revalidatePath(`/tid/lonerapport/${period.id}`);
    return { ok: "Perioden är attesterad och låst." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/** AC-2.16: efter attest rättas ingenting — det läggs till bredvid. */
export async function laggJustering(_prev: PeriodState, form: FormData): Promise<PeriodState> {
  try {
    const user = await kravAttestant();
    const db = supabaseAdmin();

    const periodId = String(form.get("period_id") ?? "");
    const employeeId = String(form.get("employee_id") ?? "");
    const minuter = Number(form.get("minuter") ?? 0);
    const motivering = String(form.get("motivering") ?? "").trim();

    if (!employeeId) return { fel: "Välj vem justeringen gäller." };
    if (!Number.isInteger(minuter) || minuter === 0)
      return { fel: "Ange ett antal minuter, positivt eller negativt." };
    if (motivering.length < 5) return { fel: "Skriv en motivering. Den blir kvar." };

    const { error } = await db.from("payroll_adjustment").insert({
      period_id: periodId,
      employee_id: employeeId,
      minutes: minuter,
      reason: motivering,
      created_by: user.employee!.id,
    });

    if (error) return { fel: `Justeringen gick inte att spara: ${error.message}` };

    await logga(user.employee!.id, "payroll.adjusted", periodId, {
      employee_id: employeeId,
      minuter,
    });

    revalidatePath(`/tid/lonerapport/${periodId}`);
    return { ok: "Justeringen är bokförd." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * AC-2.29, K31: att avsluta en avvikelse är att kvittera att den är
 * omhändertagen. Ingen konsekvens hänger i den här knappen, och det ska den
 * heller aldrig göra.
 */
export async function avslutaAvvikelse(form: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!hasRole(user, "sales_manager", "ceo", "admin", "team_lead") || !user?.employee) {
    throw new Error("Du saknar behörighet för den här åtgärden.");
  }

  const db = supabaseAdmin();
  const id = String(form.get("avvikelse_id") ?? "");
  const anteckning = String(form.get("anteckning") ?? "").trim() || null;

  await db
    .from("break_deviation")
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: user.employee.id,
      resolution: anteckning,
    })
    .eq("id", id)
    .is("resolved_at", null);

  await supabaseAdmin().from("audit_log").insert({
    actor_id: user.employee.id,
    action: "deviation.resolved",
    object_type: "break_deviation",
    object_id: id,
    meta: anteckning ? { anteckning } : null,
  });

  revalidatePath("/tid/avvikelser");
}
