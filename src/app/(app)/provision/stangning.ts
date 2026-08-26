"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";
import { giltigManad, manadFore, manadsnamn } from "@/lib/provision";
import {
  bokforingsposter,
  underlagForAlla,
  type Bonusniva,
  type KvIndata,
} from "@/lib/provision-motor";
import { gallandePolicy, kvManad, type KvPolicy, type KvSamtal } from "@/lib/kv";
import { hamtaKonsekvensPerPerson } from "@/lib/konsekvens-server";
import type { Order } from "@/lib/order";

export type StangningState = { fel?: string; ok?: string };

/**
 * E13 steg 3: periodstangningen.
 *
 * ===========================================================================
 * DET HAR AR OVERGANGEN MELLAN TVA SATT ATT SVARA PA SAMMA FRAGA.
 *
 * En OPPEN manad raknas live ur orderna. Den maste det: order elva hojer
 * bonusen pa order ett till tio, sa varje ny order andrar hela manadens
 * siffra. En vy som visade en bokford summa hade visat fel tal hela manaden.
 *
 * En STANGD manad ar bokford i `commission_entry` och raknas aldrig om. Den
 * maste det: annars andrar en ny bonusniva som satts i november vad nagon fick
 * betalt i augusti. Bestallaren har sagt uttryckligen att det inte far ske.
 *
 * Avsnitt 5.5 i PROVISION_SPEC.md. Efter stangningen ar huvudboken sanningen
 * om manaden, och motorn rors aldrig mer for den.
 * ===========================================================================
 */

/**
 * Vem som far faststalla en period. Saljchef, ekonomi och VD (avsnitt 5.6).
 *
 * Kretsen ar bredare an den som andrar reglerna — ekonomi far stanga men inte
 * bestamma vad som ska betalas ut. Kontrollen star bade har och i RLS; den har
 * hindrar skrivningen, som sker med service role och gar forbi RLS.
 */
async function kravAttestant() {
  const user = await getCurrentUser();
  if (!hasRole(user, "finance", "ceo", "sales_manager") || !user?.employee) {
    throw new Error("Bara saljchef, ekonomi och VD far faststalla en provisionsperiod.");
  }
  return user;
}

/** Sista dagen i manaden, som "2026-08-31". */
function sistaDagen(manad: string): string {
  const dag = new Date(`${manadFore(manad, -1)}T00:00:00Z`);
  dag.setUTCDate(dag.getUTCDate() - 1);
  return dag.toISOString().slice(0, 10);
}

/**
 * Faststaller en manad: bokfor motorns underlag och stanger perioden.
 *
 * ORDNINGEN AR MEDVETEN — posterna forst, perioden sedan.
 *
 * Faller det mitt i star manaden kvar som OPPEN med sina poster bokforda, och
 * ett nytt forsok kommer igenom: det partiella unika indexet pa
 * `(source, external_ref)` i 0031 nekar en andra bokforing av samma sak, och
 * den kollisionen behandlas har som "redan bokfort" i stallet for som ett fel.
 * Stangningen gar da fram i andra forsoket.
 *
 * Omvand ordning hade gett det motsatta: en stangd period utan poster, som
 * varken gar att rakna live eller att bokfora om.
 */
export async function faststallPeriod(
  _prev: StangningState,
  form: FormData,
): Promise<StangningState> {
  try {
    const user = await kravAttestant();
    const manad = String(form.get("period_month") ?? "").trim();

    if (!giltigManad(manad)) return { fel: "Manaden ar inte giltig, eller ligger i framtiden." };

    const sista = sistaDagen(manad);
    if (svensktDatum(new Date()) < sista) {
      return { fel: `${manadsnamn(manad)} kan faststallas tidigast ${sista}.` };
    }

    const db = supabaseAdmin();

    const { data: redan } = await db
      .from("commission_period")
      .select("period_month")
      .eq("period_month", manad)
      .maybeSingle();

    if (redan) return { fel: `${manadsnamn(manad)} ar redan faststalld.` };

    // LASES MED SERVICE ROLE, inte med attestantens token. Bokforingen maste
    // vara fullstandig; en RLS-vy som av nagot skal saknar en rad hade gett en
    // person for lite betalt utan att nagot sag fel ut.
    // KONSEKVENSERNA MASTE MED I BOKFORINGEN. En bonusforlust verkar genom att
    // motorn raknar om manaden — utelamnas laget har bokfors en volymbonus som
    // trappan sagt ska falla, och den posten gar sedan inte att skriva om:
    // huvudboken ar append-only, sa rattelsen blir en negativ post nagon maste
    // upptacka och skriva for hand.
    const [order, nivaer, kvPerPerson, konsekvensPerPerson] = await Promise.all([
      hamtaAllaOrder(manad),
      hamtaAllaNivaer(),
      hamtaKvPerPerson(manad),
      hamtaKonsekvensPerPerson(manad),
    ]);

    const rader = underlagForAlla(order, manad, nivaer, kvPerPerson, konsekvensPerPerson).flatMap((u) =>
      bokforingsposter(u).map((p) => ({
        employee_id: u.employee_id,
        period_month: manad,
        amount: p.belopp,
        deals: p.antal,
        source: "motor",
        // DETERMINISTISK REFERENS. Det ar den som gor stangningen idempotent:
        // samma manad, person och slag kan aldrig bokforas tva ganger.
        external_ref: `${manad}:${u.employee_id}:${p.slag}`,
        note: p.text,
        entered_by: user.employee!.id,
      })),
    );

    if (rader.length > 0) {
      const { error } = await db.from("commission_entry").insert(rader);

      // 23505 = unique_violation. Posterna finns redan, alltsa har ett tidigare
      // forsok kommit halvvags. Ratt atgard ar att fortsatta och stanga
      // perioden, inte att avbryta — annars star manaden kvar halvfardig.
      if (error && error.code !== "23505") {
        return { fel: `Posterna bokfordes inte: ${error.message}` };
      }
    }

    const { error: periodfel } = await db.from("commission_period").insert({
      period_month: manad,
      closed_by: user.employee!.id,
    });

    if (periodfel) return { fel: `Perioden stangdes inte: ${periodfel.message}` };

    await db.from("audit_log").insert({
      actor_id: user.employee!.id,
      action: "commission_period.closed",
      object_type: "commission_period",
      object_id: manad,
      meta: {
        period_month: manad,
        poster: rader.length,
        belopp: rader.reduce((s, r) => s + r.amount, 0),
      },
    });

    revalidatePath("/provision");
    revalidatePath("/order");
    revalidatePath("/");

    return {
      ok: `${manadsnamn(manad)} ar faststalld. ${rader.length} ${
        rader.length === 1 ? "post" : "poster"
      } bokförda.`,
    };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Nagot gick fel." };
  }
}

/**
 * Markerar en faststalld period som utbetald. Utbetalning sker manaden efter
 * intjanandemanaden (fraga 58).
 *
 * Kretsen ar smalare an attestens: den som gjort lonekorningen vet att pengarna
 * gatt ivag, och det ar ekonomi och VD.
 */
export async function markeraUtbetald(
  _prev: StangningState,
  form: FormData,
): Promise<StangningState> {
  try {
    const user = await getCurrentUser();
    if (!hasRole(user, "finance", "ceo") || !user?.employee) {
      return { fel: "Bara ekonomi och VD far markera en period som utbetald." };
    }

    const manad = String(form.get("period_month") ?? "").trim();
    if (!giltigManad(manad)) return { fel: "Manaden ar inte giltig." };

    const db = supabaseAdmin();
    const { error } = await db
      .from("commission_period")
      .update({
        status: "utbetald",
        paid_by: user.employee.id,
        paid_at: new Date().toISOString(),
      })
      .eq("period_month", manad)
      .eq("status", "faststalld");

    if (error) return { fel: `Perioden markerades inte: ${error.message}` };

    await db.from("audit_log").insert({
      actor_id: user.employee.id,
      action: "commission_period.paid",
      object_type: "commission_period",
      object_id: manad,
      meta: { period_month: manad },
    });

    revalidatePath("/provision");
    return { ok: `${manadsnamn(manad)} ar markerad som utbetald.` };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Nagot gick fel." };
  }
}

/**
 * ALLT SOM ROR MANADEN, inte bara det som signerades i den.
 *
 * En order fran mars som makulerats i augusti belastar AUGUSTI, sa fragan maste
 * fanga bada. `or` med tva villkor i stallet for tva fragor: motorn behover
 * dem i samma material anda.
 */
async function hamtaAllaOrder(manad: string): Promise<Order[]> {
  const { data } = await supabaseAdmin()
    .from("sales_order")
    .select(
      "id, salesperson_id, package_id, term_months, signed_on, period_month, status," +
        " is_addon, commission_amount, cancel_period_month",
    )
    .or(`period_month.eq.${manad},cancel_period_month.eq.${manad}`);

  // numeric kommer tillbaka som STRANG ur PostgREST. Utan Number() blir
  // summeringen en strangkonkatenering, och 1500 + 2500 blir "15002500". Samma
  // falla som `order-server.ts` och `provision-server.ts` redan gatt i.
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((o) => ({
    ...o,
    commission_amount: o.commission_amount === null ? null : Number(o.commission_amount),
  })) as unknown as Order[];
}

/**
 * Manadens K&V-utfall per person.
 *
 * ===========================================================================
 * SAMTALEN HAMTAS FRAN EN VECKA FORE OCH EN VECKA EFTER MANADEN.
 *
 * En ISO-vecka hor till den manad dar dess TORSDAG ligger (O9), sa en vecka som
 * raknas i augusti kan innehalla samtal fran den 31 juli — och en vecka vars
 * samtal ligger den 31 augusti hor till september. Hamtas bara augusti blir
 * randveckorna halva, och en halv vecka ar per definition inte fullstandigt
 * bedomd. Foljden hade varit en tyst utebliven bonus i randen av varje manad.
 *
 * `kvManad` filtrerar sjalv bort de veckor som inte hor till manaden.
 * ===========================================================================
 */
async function hamtaKvPerPerson(manad: string): Promise<Map<string, KvIndata>> {
  const db = supabaseAdmin();

  const fran = new Date(`${manad}T00:00:00Z`);
  fran.setUTCDate(fran.getUTCDate() - 7);
  const till = new Date(`${manadFore(manad, -1)}T00:00:00Z`);
  till.setUTCDate(till.getUTCDate() + 7);

  const [{ data: samtal }, { data: policyer }] = await Promise.all([
    db
      .from("kv_call")
      .select("id, employee_id, call_date, customer, kv_assessment(kv_score(points))")
      .gte("call_date", fran.toISOString().slice(0, 10))
      .lte("call_date", till.toISOString().slice(0, 10)),
    db
      .from("kv_policy")
      .select("id, calls_per_week, threshold_points, percent_per_week, cap_percent, valid_from, valid_to"),
  ]);

  const policy = gallandePolicy(
    ((policyer ?? []) as unknown as Record<string, unknown>[]).map((p) => ({
      ...p,
      threshold_points: Number(p.threshold_points),
      percent_per_week: Number(p.percent_per_week),
      cap_percent: Number(p.cap_percent),
    })) as unknown as KvPolicy[],
    manad,
  );

  // Ingen policy for manaden betyder att K&V inte galler da. Ingen bonus, inget
  // fel — samma linje som en tom volymtrappa.
  if (!policy) return new Map();

  const rader = ((samtal ?? []) as unknown as Record<string, unknown>[]).map((r) => {
    const bedomning = (r.kv_assessment ?? null) as Record<string, unknown> | null;
    const poang = ((bedomning?.kv_score ?? []) as Record<string, unknown>[]).reduce(
      (s, p) => s + Number(p.points),
      0,
    );

    return {
      id: String(r.id),
      employee_id: String(r.employee_id),
      call_date: String(r.call_date),
      customer: String(r.customer),
      poang: bedomning ? poang : null,
    } as KvSamtal;
  });

  const ut = new Map<string, KvIndata>();
  for (const person of new Set(rader.map((r) => r.employee_id))) {
    const m = kvManad(
      rader.filter((r) => r.employee_id === person),
      manad,
      policy,
    );
    if (m.procent > 0) ut.set(person, { godkanda: m.godkanda, bedomda: m.bedomda, procent: m.procent });
  }

  return ut;
}

async function hamtaAllaNivaer(): Promise<Bonusniva[]> {
  const { data } = await supabaseAdmin()
    .from("commission_bonus_level")
    .select("id, threshold, amount, unit, valid_from, valid_to");

  return (data ?? []).map((n) => ({ ...n, amount: Number(n.amount) })) as Bonusniva[];
}
