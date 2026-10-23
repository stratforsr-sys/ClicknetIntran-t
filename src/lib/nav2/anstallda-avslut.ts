import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { stangAnstallning } from "@/lib/offboarding-server";
import { attStangaINatt, type PlaneratAvslut } from "./avslutforma.ts";

/**
 * Nattjobbet (granskningen F1-8): ett avslut som registrerats med sista dag
 * framåt stängs natten efter sista dagen, med repots offboarding-kärna
 * (`stangAnstallning`). Fram till dess kan personen logga in, stämpla och se
 * sitt. Den som avslutade står som aktör (`employee.end_reason_by`).
 *
 * Ingen spärr på läsläget: markören (avslutslista + sista dag passerad + inte
 * avslutad) finns bara när ett avslut registrerats, och ett registrerat avslut
 * ska stängas även om Anställda skulle slås tillbaka till läsläge. Ett fel för en
 * person stoppar inte de andra; det står i nattkvittot.
 */
export async function stangPlaneradeAvslut(db: SupabaseClient, idag: string): Promise<{ stangda: number; fel: string[] }> {
  const ut = { stangda: 0, fel: [] as string[] };
  const { data: pers, error } = await db
    .from("employee")
    .select("id, status, end_date, end_reason_by")
    .neq("status", "offboarded")
    .not("end_date", "is", null)
    .lt("end_date", idag);
  if (error) throw new Error(`Personalen kunde inte läsas: ${error.message}`);
  const kandidater = (pers ?? []) as unknown as PlaneratAvslut[];
  if (!kandidater.length) return ut;
  const { data: listor, error: listfel } = await db.from("offboarding_task").select("employee_id").in("employee_id", kandidater.map((p) => p.id));
  if (listfel) throw new Error(`Avslutslistorna kunde inte läsas: ${listfel.message}`);
  const medLista = new Set(((listor ?? []) as { employee_id: string }[]).map((r) => r.employee_id));

  for (const p of attStangaINatt(kandidater, medLista, idag)) {
    if (!p.end_reason_by) {
      ut.fel.push(`${p.id}: ingen står som den som avslutade`);
      continue;
    }
    let r: { stangda: number; aterlamnade: number };
    try {
      r = await stangAnstallning(db, p.end_reason_by, p.id, p.end_date as string);
      const { data: efter } = await db.from("employee").select("status").eq("id", p.id).maybeSingle();
      if ((efter as { status?: string } | null)?.status !== "offboarded") throw new Error("kontot stängdes inte");
    } catch (e) {
      ut.fel.push(`${p.id}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    await db
      .from("offboarding_task")
      .update({ state: "done", handled_by: p.end_reason_by, handled_at: new Date().toISOString() })
      .eq("employee_id", p.id)
      .eq("kind", "konto")
      .eq("state", "open");
    if (r.stangda > 0)
      await db
        .from("offboarding_task")
        .update({ note: `${r.stangda} öppet personalärende${r.stangda === 1 ? "" : "n"} stängdes automatiskt. Kontrollera att inget kräver åtgärd.` })
        .eq("employee_id", p.id)
        .eq("item_key", "arenden");
    ut.stangda++;
  }
  return ut;
}
