import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { tolkaLager } from "@/lib/lagring";
import { taBort } from "@/lib/lagring-server";
import { forsvunna, type Lagringsrad } from "@/lib/personal-radering";
import { delaUpp, iTur, lasSidvis } from "@/lib/sidvis";

/**
 * S09 (F1-5, C7): lagringen nar en person tas bort helt.
 *
 * `ta_bort_anstalld()` raderar rader men nar inte lagringen. Lakarintyget
 * foljer sjukanmalan i kaskad och ärendebilagan foljer arendet (och med 0224
 * aven rollspel, coachningsfiler och inspelningar utan order), och filen lag
 * kvar i bucketen utan nagon rad som pekade pa den.
 *
 * Darfor: samla personens filer FORE anropet, och ta efterat bort innehallet
 * for de rader som inte langre finns. Det som star kvar ar foretagets underlag
 * (0170) och rors inte. Ordningen ar avsiktlig: faller raderingen i databasen
 * finns alla rader kvar, och ingen fil tas bort.
 */
type Rad = Record<string, unknown>;

export async function filerForeRadering(db: SupabaseClient, employeeId: string): Promise<Lagringsrad[]> {
  const filer = await lasSidvis<Rad>((fran, till) =>
    db
      .from("file_object")
      .select("id, store, bucket, path")
      .eq("subject_employee_id", employeeId)
      .is("removed_at", null)
      .order("id")
      .range(fran, till),
  );
  const arenden = await lasSidvis<Rad>((fran, till) =>
    db.from("hr_case").select("id").eq("employee_id", employeeId).order("id").range(fran, till),
  );
  const bilagor: Rad[] = [];
  for (const omgang of delaUpp(arenden.map((a) => String(a.id)), 100)) {
    bilagor.push(
      ...(await lasSidvis<Rad>((fran, till) =>
        db.from("hr_case_attachment").select("id, store, bucket, path").in("case_id", omgang).order("id").range(fran, till),
      )),
    );
  }
  const rad = (tabell: Lagringsrad["tabell"]) => (r: Rad): Lagringsrad => ({
    id: String(r.id),
    tabell,
    store: String(r.store),
    bucket: String(r.bucket),
    path: String(r.path),
  });
  return [...filer.map(rad("file_object")), ...bilagor.map(rad("hr_case_attachment"))];
}

/** Tar bort innehallet for raderna som forsvann. Kastar aldrig: ett fel blir en rad i `fel`. */
export async function stadaLagringEfterRadering(
  db: SupabaseClient,
  fore: Lagringsrad[],
): Promise<{ borttagna: number; fel: string[] }> {
  const fel: string[] = [];
  const kvar = new Set<string>();
  for (const tabell of ["file_object", "hr_case_attachment"] as const) {
    const ids = fore.filter((r) => r.tabell === tabell).map((r) => r.id);
    for (const omgang of delaUpp(ids, 100)) {
      const { data, error } = await db.from(tabell).select("id").in("id", omgang);
      // Gick det inte att se vad som star kvar tas ingenting bort for den omgangen.
      if (error) {
        fel.push(`${tabell}: ${error.message}`);
        for (const id of omgang) kvar.add(`${tabell}|${id}`);
        continue;
      }
      for (const r of data ?? []) kvar.add(`${tabell}|${r.id}`);
    }
  }
  // Tio at gangen: med 0224 kan en person ha over tusen filer.
  const lista = forsvunna(fore, kvar);
  const svar = await iTur(lista, 10, (r) => taBort({ lager: tolkaLager(r.store), bucket: r.bucket, path: r.path }));
  let borttagna = 0;
  svar.forEach((s, i) => {
    if (s.ok) borttagna++;
    else fel.push(`${lista[i].path}: ${s.fel}`);
  });
  return { borttagna, fel };
}
