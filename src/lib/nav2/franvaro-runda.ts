import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { notifieraFlera } from "@/lib/notishandelse-server";
import { svensktDatum } from "@/lib/klocka";

/**
 * Nav 2.0 (0093): önskemålsrundans utskick.
 *
 * När en runda nått sitt `send_on` får var och en i teamet (eller alla aktiva,
 * när rundan saknar team) en uppgift: ansök om sina sommarveckor i Frånvaro
 * senast `answer_by`. Uppgiften skrivs som repots `skapaUppgift` skriver den
 * (raden och händelsen `skapad`), med den som startade rundan som avsändare,
 * och personen får en notis. Rundan markeras skickad, så att ingen får två.
 *
 * Anropas av dagtidsjobbet bara när Frånvaro i Nav 2.0 får spara
 * (SKRIVLAGE.franvaro).
 */
export async function skickaRundor(db: SupabaseClient): Promise<{ rundor: number; uppgifter: number }> {
  const idag = svensktDatum();
  const { data: rundor } = await db
    .from("vacation_wish_round")
    .select("id, summer_year, team_id, answer_by, created_by")
    .lte("send_on", idag)
    .is("sent_at", null);
  let uppgifter = 0;
  for (const r of rundor ?? []) {
    // Markera först: en körning som faller halvvägs ska inte skicka två gånger.
    const { data: tagen } = await db.from("vacation_wish_round").update({ sent_at: new Date().toISOString() }).eq("id", r.id).is("sent_at", null).select("id");
    if (!tagen?.length) continue;
    let q = db.from("employee").select("id").in("status", ["active", "onboarding"]);
    if (r.team_id) q = q.eq("team_id", r.team_id);
    const { data: personer } = await q;
    const mottagare: string[] = [];
    for (const p of personer ?? []) {
      if (p.id === r.created_by) continue;
      const { data: t } = await db
        .from("task")
        .insert({
          title: `Önska tre sommarveckor ${r.summer_year}`,
          description_md: `Ansök om de veckor du vill vara ledig i sommar, i Frånvaro. Önskemålen ska vara inne senast ${r.answer_by}.`,
          assignee_id: p.id,
          created_by: r.created_by,
          due_date: r.answer_by,
          priority: 2,
        })
        .select("id")
        .single();
      if (!t) continue;
      await db.from("task_event").insert({ task_id: t.id, type: "skapad", by_employee_id: r.created_by, note: null });
      mottagare.push(p.id as string);
      uppgifter++;
    }
    await notifieraFlera(mottagare, {
      av: r.created_by as string | null,
      kalla: "uppgift-tilldelad",
      typ: "uppgift",
      rubrik: `Önska tre sommarveckor ${r.summer_year}`,
      detalj: `senast ${r.answer_by}`,
      href: "/franvaro",
    });
  }
  return { rundor: (rundor ?? []).length, uppgifter };
}
