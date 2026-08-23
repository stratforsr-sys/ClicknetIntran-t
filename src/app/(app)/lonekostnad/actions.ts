"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { raknaLonekostnad, type Underlag } from "@/lib/lonekostnad";
import { farSeLonekostnad, hamtaLonerFor, hamtaSatser } from "@/lib/lonekostnad-server";

export type KostnadState = { fel?: string; ok?: string };

/**
 * ===========================================================================
 * K26: VARJE HANDLING I DEN HAR FILEN FRAGAR EFTER `payroll_cost_viewer`.
 *
 * Skrivningarna gar med service role, som gar forbi RLS. Policyerna i 0025
 * skyddar alltsa lasningen men inte det som skrivs harifran — kontrollen maste
 * sta i varje handling, och den star forst i var och en.
 *
 * AC-13.13: varje andring av vem som HAR behorigheten loggas redan i E1.15.
 * Det som loggas har ar i stallet vad behorigheten anvands till.
 * ===========================================================================
 */
async function kravBehorighet() {
  const user = await getCurrentUser();
  if (!user?.employee) return { fel: "Du måste vara inloggad." as const, user: null };
  if (!farSeLonekostnad(user))
    return { fel: "Lönekostnad kräver behörigheten payroll_cost_viewer." as const, user: null };
  return { fel: null, user };
}

async function logga(actorId: string, action: string, objectId: string, meta?: unknown) {
  await supabaseAdmin().from("audit_log").insert({
    actor_id: actorId,
    action,
    object_type: "cost",
    object_id: objectId,
    meta: meta ?? null,
  });
}

// =============================================================================
// Satserna (E15.2, E15.8)
// =============================================================================

export async function sparaSats(_prev: KostnadState, form: FormData): Promise<KostnadState> {
  const { fel, user } = await kravBehorighet();
  if (fel || !user) return { fel: fel ?? "Nekad." };

  const kind = String(form.get("kind") ?? "");
  const appliesTo = String(form.get("applies_to") ?? "").trim() || null;
  const unit = String(form.get("unit") ?? "percent");
  const varde = Number(form.get("value"));
  const validFrom = String(form.get("valid_from") ?? "");
  const reviewDue = String(form.get("review_due") ?? "").trim() || null;
  const agare = String(form.get("owner_id") ?? "").trim() || null;
  const note = String(form.get("note") ?? "").trim() || null;

  if (!kind || !validFrom) return { fel: "Sats och giltighetsdatum måste anges." };
  if (!Number.isFinite(varde) || varde < 0) return { fel: "Värdet måste vara ett tal som inte är negativt." };

  const db = supabaseAdmin();

  // En ny sats ersatter inte den gamla, den efterfoljer den. Historiken maste
  // sta kvar for att en gammal berakning ska ga att rakna om (AC-13.8).
  const { error } = await db.from("cost_rate").upsert(
    {
      kind,
      applies_to: appliesTo,
      unit,
      value: varde,
      valid_from: validFrom,
      owner_id: agare,
      review_due: reviewDue,
      note,
      created_by: user.employee!.id,
    },
    { onConflict: "kind,applies_to,valid_from" },
  );

  if (error) return { fel: error.message };

  await logga(user.employee!.id, "cost.rate_set", kind, {
    varde,
    enhet: unit,
    galler_fran: validFrom,
    galler: appliesTo,
  });

  revalidatePath("/lonekostnad", "layout");
  return { ok: "Satsen är sparad. Den gäller från och med angivet datum." };
}

// =============================================================================
// Lonen (AC-13.2)
// =============================================================================

export async function sparaLon(_prev: KostnadState, form: FormData): Promise<KostnadState> {
  const { fel, user } = await kravBehorighet();
  if (fel || !user) return { fel: fel ?? "Nekad." };

  const employeeId = String(form.get("employee_id") ?? "");
  const lon = Number(form.get("monthly_salary"));
  const validFrom = String(form.get("valid_from") ?? "");
  const note = String(form.get("note") ?? "").trim() || null;

  if (!employeeId || !validFrom) return { fel: "Person och datum måste anges." };
  if (!Number.isFinite(lon) || lon < 0) return { fel: "Lönen måste vara ett tal som inte är negativt." };

  const db = supabaseAdmin();
  const { error } = await db.from("salary_basis").insert({
    employee_id: employeeId,
    monthly_salary: lon,
    valid_from: validFrom,
    entered_by: user.employee!.id,
    note,
  });

  // Append-only: samma person och datum tva ganger ar en omskrivning, och
  // triggern i 0025 slapper inte igenom en update.
  if (error) {
    return {
      fel: error.message.includes("duplicate")
        ? "Det finns redan en löneuppgift från det datumet. Lägg en ny rad med ett senare datum."
        : error.message,
    };
  }

  await logga(user.employee!.id, "cost.salary_set", employeeId, { galler_fran: validFrom });
  revalidatePath("/lonekostnad", "layout");
  return { ok: "Löneuppgiften är sparad." };
}

/** K27: bara aret. Ligger har och inte pa personalkortet, eftersom det bara ar
 *  lonekostnaden som behover det. */
export async function sparaFodelsear(_prev: KostnadState, form: FormData): Promise<KostnadState> {
  const { fel, user } = await kravBehorighet();
  if (fel || !user) return { fel: fel ?? "Nekad." };

  const employeeId = String(form.get("employee_id") ?? "");
  const ar = Number(form.get("birth_year"));
  if (!employeeId) return { fel: "Person saknas." };
  if (!Number.isInteger(ar)) return { fel: "Ange ett årtal, till exempel 1995." };

  const { error } = await supabaseAdmin()
    .from("employee")
    .update({ birth_year: ar })
    .eq("id", employeeId);

  if (error) {
    return {
      fel: error.message.includes("employee_fodelsear_rimligt")
        ? "Året ser inte rimligt ut. Det ska vara ett fyrsiffrigt årtal för någon som är minst 15 år."
        : error.message,
    };
  }

  await logga(user.employee!.id, "cost.birth_year_set", employeeId, { ar });
  revalidatePath("/lonekostnad", "layout");
  return { ok: "Födelseåret är sparat. Navet lagrar bara året." };
}

// =============================================================================
// Intakten (AC-13.7)
// =============================================================================

export async function sparaIntakt(_prev: KostnadState, form: FormData): Promise<KostnadState> {
  const { fel, user } = await kravBehorighet();
  if (fel || !user) return { fel: fel ?? "Nekad." };

  const periodId = String(form.get("period_id") ?? "");
  const employeeId = String(form.get("employee_id") ?? "");
  const belopp = Number(form.get("amount"));

  if (!periodId || !employeeId) return { fel: "Period och person måste anges." };
  if (!Number.isFinite(belopp) || belopp < 0) return { fel: "Beloppet måste vara ett tal som inte är negativt." };

  const { error } = await supabaseAdmin().from("revenue_entry").upsert(
    {
      period_id: periodId,
      employee_id: employeeId,
      amount: belopp,
      entered_by: user.employee!.id,
    },
    { onConflict: "period_id,employee_id" },
  );

  if (error) return { fel: error.message };

  await logga(user.employee!.id, "cost.revenue_set", employeeId, { period: periodId, belopp });
  revalidatePath("/lonekostnad", "layout");
  return { ok: "Intäkten är sparad." };
}

// =============================================================================
// Berakningen (AC-13.8)
// =============================================================================

/**
 * Raknar om hela perioden.
 *
 * Raderna ar oforanderliga (0025), sa en omrakning tar bort de gamla och
 * skriver nya. Det ar avsiktligt enklare an lonerapportens justeringsposter:
 * en lonekostnad ar ett beslutsunderlag som stannar i navet, inte ett underlag
 * som lamnats till nagon. Att skriva om den ar inte samma sak som att andra
 * ett attesterat lonebesked.
 */
export async function raknaPeriod(_prev: KostnadState, form: FormData): Promise<KostnadState> {
  const { fel, user } = await kravBehorighet();
  if (fel || !user) return { fel: fel ?? "Nekad." };

  const periodId = String(form.get("period_id") ?? "");
  if (!periodId) return { fel: "Period saknas." };

  const db = supabaseAdmin();
  const { data: period } = await db
    .from("payroll_period")
    .select("id, period_start, period_end")
    .eq("id", periodId)
    .maybeSingle();

  if (!period) return { fel: "Perioden finns inte." };

  // AC-3.26: franvaron kommer HARIFRAN. `sick_report` rors aldrig.
  const { data: rader } = await db
    .from("payroll_row")
    .select("employee_id, worked_minutes, absence_minutes")
    .eq("period_id", periodId);

  if (!rader || rader.length === 0)
    return { fel: "Löneperioden har inga rader än. Generera lönerapporten först." };

  const satser = await hamtaSatser(db, period.period_start);
  const { data: intakter } = await db
    .from("revenue_entry")
    .select("employee_id, amount")
    .eq("period_id", periodId);
  const intaktPer = new Map((intakter ?? []).map((i) => [i.employee_id, Number(i.amount)]));

  const { data: personer } = await db
    .from("employee")
    .select("id, birth_year")
    .in("id", rader.map((r) => r.employee_id));
  const aretPer = new Map((personer ?? []).map((p) => [p.id, p.birth_year]));

  await db.from("cost_calculation").delete().eq("period_id", periodId);

  /**
   * Lonerna hamtas EN gang for hela perioden, och raderna skrivs i EN insert.
   *
   * Loopen gjorde tidigare tva turer till databasen per anstalld — en for lonen
   * och en for raden — och de gick efter varandra. Med tjugofem anstallda var
   * det femtio vantetider i rad for en knapptryckning.
   *
   * Berakningen sjalv ar oforandrad. Det som andrats ar nar databasen fragas,
   * inte vad den svarar: `hamtaLonerFor` tillampar samma regel som `hamtaLon`,
   * och `raknaLonekostnad` far exakt samma underlag som forut.
   */
  const lonPer = await hamtaLonerFor(db, rader.map((r) => r.employee_id), period.period_start);

  const attSkriva: Record<string, unknown>[] = [];
  let utanLon = 0;

  for (const rad of rader) {
    const lon = lonPer.get(rad.employee_id) ?? null;

    // Utan manadslon finns ingen kostnad att rakna. Att skriva en rad pa noll
    // hade sett ut som en gratis saljare.
    if (lon === null) {
      utanLon += 1;
      continue;
    }

    const underlag: Underlag = {
      manadslon: lon,
      fodelsear: aretPer.get(rad.employee_id) ?? null,
      periodStart: period.period_start,
      periodSlut: period.period_end,
      franvarominuter: (rad.absence_minutes ?? {}) as Record<string, number>,
      arbetadeMinuter: rad.worked_minutes ?? 0,
      intakt: intaktPer.get(rad.employee_id) ?? null,
    };

    const b = raknaLonekostnad(underlag, satser);

    attSkriva.push({
      period_id: periodId,
      employee_id: rad.employee_id,
      monthly_salary: b.manadslon,
      absence_deduction: b.franvaroavdrag,
      gross_salary: b.bruttolon,
      employer_fee: b.arbetsgivaravgift,
      total_cost: b.totalkostnad,
      break_even_revenue: b.breakEven,
      revenue: b.intakt,
      contribution: b.tackningsbidrag,
      rates_used: b.ratesUsed,
      calculated_by: user.employee!.id,
    });
  }

  if (attSkriva.length > 0) {
    const { error: skrivfel } = await db.from("cost_calculation").insert(attSkriva);
    // De gamla raderna ar redan borta. Gar skrivningen fel ska det synas, inte
    // sluta med en tom period som ser ut som en berakning utan trafffar.
    if (skrivfel) return { fel: `Beräkningen kunde inte sparas: ${skrivfel.message}` };
  }

  const skrivna = attSkriva.length;
  await logga(user.employee!.id, "cost.calculated", periodId, { rader: skrivna, utan_lon: utanLon });
  revalidatePath("/lonekostnad", "layout");

  return {
    ok:
      utanLon > 0
        ? `${skrivna} rader räknade. ${utanLon} hoppades över — de saknar löneuppgift.`
        : `${skrivna} rader räknade.`,
  };
}
