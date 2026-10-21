import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { frist } from "@/lib/arenden";

/**
 * E15.8 / §13.3 / K28: arlig paminnelse om satsunderhall, med dokumenterad
 * agare.
 *
 * En arbetsgivaravgift som star kvar pa fjolarets siffra ger fel lonekostnad
 * utan att nagonstans se fel ut. Break-even blir for lagt, och det ar en siffra
 * nagon fattar beslut pa. Det ar precis den sortens fel som inte upptacks av
 * sig sjalvt — darav paminnelsen.
 *
 * PAMINNELSEN GAR TILL AGAREN, INTE TILL "nagon". K28 kraver en dokumenterad
 * agare, och en sats utan agare far darfor ett arende pa saljchefen i stallet
 * — inte tystnad. En sats som ingen ager ar sjalv problemet.
 *
 * Arendet ar navets enda satt att na nagon sa lange E0.8 ar pausat. Det ar
 * dessutom ratt plats: ett arende har en handlaggare, en frist och en
 * kvittens, vilket en notis inte har.
 */
export async function korSatsjobbet(
  db: SupabaseClient,
): Promise<{ forfallna: number; arenden: number }> {
  const idag = new Date().toISOString().slice(0, 10);

  const { data: satser, error } = await db
    .from("cost_rate")
    .select("id, kind, applies_to, value, unit, valid_from, valid_to, review_due, owner_id")
    .not("review_due", "is", null)
    .lte("review_due", idag);

  if (error) throw new Error(error.message);

  // Bara den sats som faktiskt GALLER ar vard en paminnelse. En gammal rad med
  // ett passerat `valid_to` ar historik och ska sta kvar orord.
  const gallande = (satser ?? []).filter((s) => !s.valid_to || s.valid_to >= idag);
  if (gallande.length === 0) return { forfallna: 0, arenden: 0 };

  // Saljchefen ar fallback nar ingen agare ar satt. Samma monster som
  // chefsfallbacken i sjukanmalans ringordning (AC-3.18): en lucka i
  // konfigurationen far inte bli tystnad.
  const { data: saljchefer } = await db
    .from("employee_role")
    .select("employee_id, employee!employee_role_employee_id_fkey(status)")
    .eq("role", "sales_manager");

  const fallback =
    (saljchefer ?? []).find(
      (r) => (r.employee as unknown as { status: string }).status !== "offboarded",
    )?.employee_id ?? null;

  // Svarstiden kommer fran kategorin, som for ett arende lagt for hand.
  // `sla_hours` och `due_at` ar NOT NULL utan standardvarde: utan dem avvisar
  // databasen raden.
  const { data: kategori } = await db
    .from("case_category")
    .select("sla_hours")
    .eq("id", "other")
    .maybeSingle();
  const slaTimmar = Number(kategori?.sla_hours ?? 72);

  const nu = new Date();
  let arenden = 0;
  const felen: string[] = [];

  for (const sats of gallande) {
    const mottagare = sats.owner_id ?? fallback;
    if (!mottagare) continue;

    // Ett arende per sats och forfallodatum. Kors jobbet varje natt ska det
    // inte bli en ny rad varje natt — samma resonemang som `unique` pa
    // absence_reminder.
    const referens = `cost_rate:${sats.id}:${sats.review_due}`;
    const { data: fanns } = await db
      .from("hr_case")
      .select("id")
      .eq("employee_id", mottagare)
      .eq("category", "other")
      .ilike("subject", `%${referens}%`)
      .limit(1)
      .maybeSingle();

    if (fanns) continue;

    const { data: arende, error: felet } = await db
      .from("hr_case")
      .insert({
        employee_id: mottagare,
        created_by: mottagare,
        category: "other",
        subject: `Se över satsen ${sats.kind}${sats.applies_to ? ` (${sats.applies_to})` : ""} — ${referens}`,
        assigned_to: mottagare,
        sla_hours: slaTimmar,
        due_at: frist(nu, slaTimmar),
      })
      .select("id")
      .single();

    // Ett arende som inte gick att lagga far inte bli tystnad. Felet samlas och
    // kastas efter rundan, sa att kvittot visar steget som fallet.
    if (felet || !arende) {
      felen.push(felet?.message ?? "inget ärende tillbaka");
      continue;
    }

    await db.from("case_message").insert({
      case_id: arende.id,
      author_id: mottagare,
      body: [
        `Satsen ${sats.kind} står på ${sats.value} ${sats.unit === "percent" ? "%" : sats.unit === "amount" ? "kr" : "år"} och gäller från ${sats.valid_from}.`,
        `Datum för översyn var ${sats.review_due}.`,
        "",
        "Stäm av mot källan och lägg in en ny rad under Lönekostnad → Satser om siffran ändrats.",
        "En ny sats ersätter inte den gamla, den efterföljer den — historiken behövs för att gamla beräkningar ska gå att räkna om.",
        "",
        "Den här påminnelsen kommer från nattjobbet (E15.8, K28).",
      ].join("\n"),
    });

    await db.from("audit_log").insert({
      actor_id: mottagare,
      action: "cost.rate_review_due",
      object_type: "cost_rate",
      object_id: sats.id,
      meta: { sats: sats.kind, forfoll: sats.review_due, agare_satt: Boolean(sats.owner_id) },
    });

    arenden += 1;
  }

  if (felen.length > 0) {
    throw new Error(
      `${felen.length} av ${gallande.length} ärenden kunde inte läggas (${arenden} lades): ${felen[0]}`,
    );
  }

  return { forfallna: gallande.length, arenden };
}
