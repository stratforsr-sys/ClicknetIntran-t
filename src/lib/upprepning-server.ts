import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { svensktDatum } from "./klocka.ts";
import {
  TAK_PER_KORNING,
  fonster,
  forekomster,
  type Monster,
  type Serieregel,
} from "./upprepning.ts";

/**
 * FÖDSELN: regeln blir riktiga rader i `task` och `coaching_task`.
 *
 * =============================================================================
 * TVÅ ANROPARE, OCH DET ÄR DÄRFÖR IDEMPOTENSEN ÄR VIKTIGARE ÄN DEN SER UT
 *
 *   NATTJOBBET fyller på horisonten var natt (`api/jobb/natt`), så en serie som
 *   löper vidare alltid är född åtta veckor framåt.
 *
 *   SKAPANDET föder första fönstret direkt (`skapaSerie`), så att den som
 *   lägger upp en rutin ser den i kalendern innan hon hunnit stänga
 *   formuläret. Att vänta till natten hade betytt att en beställning som
 *   uttryckligen handlade om att SE sina upprepningar inte visade någonting
 *   första dagen.
 *
 * Två skribenter på samma rad är två chanser att skriva den två gånger. Skyddet
 * är därför inte en kontroll utan ett unikindex plus `on conflict do nothing` —
 * se `task_serieforekomst_unik` i 0062. Den som läser koden nedan ska inte
 * behöva lita på att läsningen och skrivningen sker i samma andetag.
 * =============================================================================
 */

/** Kolumnerna serien behöver för att kunna föda. Ett ställe, fyra frågor. */
export const SERIEFALT =
  "id, slag, monster, veckodagar, starts_on, ends_on, title, description_md, " +
  "due_time, estimate_minutes, assignee_id, created_by, priority, project_id, " +
  "kind, verify_by, evidence, partner_id, course_id, module_id, document_id, " +
  "materialized_to, ended_at";

export type Serie = {
  id: string;
  slag: "uppgift" | "coachningsuppgift";
  monster: Monster;
  veckodagar: number[] | null;
  starts_on: string;
  ends_on: string | null;
  title: string;
  description_md: string;
  due_time: string | null;
  estimate_minutes: number | null;
  assignee_id: string;
  created_by: string;
  priority: number | null;
  project_id: string | null;
  kind: string | null;
  verify_by: string | null;
  evidence: string | null;
  partner_id: string | null;
  course_id: string | null;
  module_id: string | null;
  document_id: string | null;
  materialized_to: string | null;
  ended_at: string | null;
};

export function regelUr(serie: Serie): Serieregel {
  return {
    monster: serie.monster,
    veckodagar: serie.veckodagar ?? [],
    starts_on: serie.starts_on,
    ends_on: serie.ends_on,
  };
}

export type Seriutfall = {
  /** Hur många levande serier som prövades. */
  provade: number;
  /** Hur många förekomster som faktiskt skrevs. */
  fodda: number;
  /** Serier som hoppades över för att den ansvariga slutat. */
  vilande: number;
  fel: string[];
};

/**
 * Lägg upp en regel och föd första fönstret direkt.
 *
 * DEN HÄR FUNKTIONEN GÖR INGEN BEHÖRIGHETSKONTROLL, och det är inte ett
 * förbiseende — det är samma linje som resten av `*-server.ts` i navet. Vem som
 * får lägga upp en uppgift åt sig själv (`uppgifter/actions.ts`) och vem som
 * får lägga upp en coachningsuppgift åt någon annan (`kravCoach()` +
 * `arChefFor()` i `coachning/actions.ts`) är två olika frågor med två olika
 * svar, och båda är redan besvarade på var sitt ställe. Ett tredje svar här
 * hade blivit det som glöms bort när det första ändras.
 *
 * FÖDSELN SKER MED EN GÅNG. Den som lägger upp "varje måndag 09:00" ska se
 * åtta måndagar i kalendern innan hon hunnit stänga formuläret — att vänta till
 * natten hade betytt att en beställning som uttryckligen handlade om att SE
 * sina upprepningar inte visade någonting första dagen.
 */
export async function skapaSerie(
  db: SupabaseClient,
  falt: Record<string, unknown>,
  idag: string,
): Promise<{ id: string; fodda: number }> {
  const { data, error } = await db.from("task_series").insert(falt).select(SERIEFALT).single();

  if (error || !data) {
    throw new Error(`Rutinen sparades inte: ${error?.message ?? "okänt fel"}`);
  }

  const serie = data as unknown as Serie;

  /**
   * FÖDSELN FÅR FALLA UTAN ATT TA REGELN MED SIG.
   *
   * Regeln är sparad när vi kommer hit. Kastas ett fel ur födseln har
   * användaren en rutin utan förekomster — irriterande, men självläkande:
   * nattjobbet prövar samma serie igen om några timmar. Rullades regeln
   * tillbaka i stället vore felet permanent, och felmeddelandet ("kunde inte
   * skriva uppgift 3 av 8") hade handlat om något användaren inte bad om.
   */
  const fodda = await fodEnSerie(db, serie, idag);
  return { id: serie.id, fodda };
}

/**
 * Nattjobbets steg: fyll på horisonten för varje levande serie.
 *
 * DE FLESTA NÄTTER SKRIVS EN RAD PER SERIE, eller ingen alls. En serie som är
 * född till horisonten behöver bara dagen som föll av i andra änden, och en
 * veckoserie behöver ingenting sex nätter av sju. Det är avsikten med
 * `materialized_to`: kostnaden ska följa vad som är NYTT, inte hur långt
 * fönstret är.
 */
export async function fodSerier(db: SupabaseClient, nu = new Date()): Promise<Seriutfall> {
  const utfall: Seriutfall = { provade: 0, fodda: 0, vilande: 0, fel: [] };
  const idag = svensktDatum(nu);

  const { data, error } = await db
    .from("task_series")
    .select(SERIEFALT)
    .is("ended_at", null)
    .or(`ends_on.is.null,ends_on.gte.${idag}`);

  if (error) {
    utfall.fel.push(`serierna kunde inte läsas: ${error.message}`);
    return utfall;
  }

  const serier = (data ?? []) as unknown as Serie[];
  if (serier.length === 0) return utfall;

  /**
   * DEN SOM SLUTAT FÅR INGA NYA UPPGIFTER.
   *
   * `on delete cascade` tar hand om den som RADERAS ur registret, men en
   * avslutad anställning raderar ingen — raden står kvar som `offboarded` av
   * goda skäl (lönehistorik, registerutdrag). Utan den här frågan hade
   * måndagsrutinen fortsatt föda uppgifter på någon som slutat i mars, och de
   * hade dykt upp i chefens delegeringslista som "väntar sedan 90 dagar".
   *
   * Serien avslutas INTE automatiskt. Att sluta föda är en paus; att avsluta
   * regeln är ett beslut, och det fattas av en människa.
   */
  const { data: personer } = await db
    .from("employee")
    .select("id, status")
    .in("id", [...new Set(serier.map((s) => s.assignee_id))]);

  const itjanst = new Set(
    ((personer ?? []) as { id: string; status: string }[])
      .filter((p) => p.status !== "offboarded")
      .map((p) => p.id),
  );

  for (const serie of serier) {
    if (!itjanst.has(serie.assignee_id)) {
      utfall.vilande++;
      continue;
    }

    utfall.provade++;
    try {
      utfall.fodda += await fodEnSerie(db, serie, idag);
    } catch (e) {
      utfall.fel.push(`${serie.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return utfall;
}

/**
 * En serie, ett fönster.
 *
 * Returnerar antalet rader som FAKTISKT skrevs — inte antalet datum regeln gav.
 * Skillnaden är de som redan fanns, och den skillnaden ska synas i kvittot:
 * "37 datum, 0 skrivna" natt efter natt betyder att `materialized_to` inte
 * flyttas, och det är ett fel som annars ser ut som ett lugnt jobb.
 */
export async function fodEnSerie(db: SupabaseClient, serie: Serie, idag: string): Promise<number> {
  const rutan = fonster(regelUr(serie), idag, serie.materialized_to);
  if (!rutan) return 0;

  const datum = forekomster(regelUr(serie), rutan.fran, rutan.till);

  /**
   * INGA DATUM ÄR OCKSÅ ETT SVAR, och `materialized_to` ska flyttas ändå.
   *
   * En måndagsserie vars fönster bara innehåller tisdag till söndag ger noll
   * datum. Flyttades inte fältet skulle samma sex dagar räknas om varje natt i
   * all evighet — billigt, men det döljer också att jobbet gör något: en serie
   * vars `materialized_to` står stilla ser likadan ut som en trasig.
   */
  if (datum.length === 0) {
    await flyttaFram(db, serie.id, rutan.till);
    return 0;
  }

  const skrivna =
    serie.slag === "uppgift"
      ? await fodUppgifter(db, serie, datum)
      : await fodCoachningsuppgifter(db, serie, datum);

  /**
   * Taket slår aldrig i praktiken — fönstret är 56 dagar och den tätaste
   * regeln ger 57 datum. Slår det ändå till är listan avhuggen, och då får
   * `materialized_to` bara gå till sista datumet vi faktiskt skrev. Annars
   * hoppas resten av fönstret över för alltid.
   */
  const till = datum.length >= TAK_PER_KORNING ? datum[datum.length - 1] : rutan.till;
  await flyttaFram(db, serie.id, till);

  return skrivna;
}

async function flyttaFram(db: SupabaseClient, serieId: string, till: string): Promise<void> {
  const { error } = await db
    .from("task_series")
    .update({ materialized_to: till, updated_at: new Date().toISOString() })
    .eq("id", serieId)
    // BARA FRAMÅT. Villkoret gör satsen ofarlig att köra ur ordning: kör
    // nattjobbet och skapandet om vartannat ska den som hunnit längst vinna,
    // och en sen skrivning får inte dra tillbaka horisonten så att allt föds om.
    .or(`materialized_to.is.null,materialized_to.lt.${till}`);

  if (error) throw new Error(`horisonten kunde inte flyttas: ${error.message}`);
}

async function fodUppgifter(db: SupabaseClient, serie: Serie, datum: string[]): Promise<number> {
  const rader = datum.map((dag) => ({
    title: serie.title,
    description_md: serie.description_md,
    project_id: serie.project_id,
    assignee_id: serie.assignee_id,
    created_by: serie.created_by,
    due_date: dag,
    due_time: serie.due_time,
    estimate_minutes: serie.estimate_minutes,
    priority: serie.priority ?? 3,
    series_id: serie.id,
    series_on: dag,
  }));

  const { data, error } = await db
    .from("task")
    .upsert(rader, { onConflict: "series_id,series_on", ignoreDuplicates: true })
    .select("id");

  if (error) throw new Error(`uppgifterna kunde inte skrivas: ${error.message}`);

  const nya = (data ?? []) as { id: string }[];
  if (nya.length === 0) return 0;

  /**
   * HISTORIKEN SKRIVS ÄVEN FÖR DEN SOM FÖDDES AV ETT JOBB.
   *
   * `lageAv()` klarar sig utan raden — en uppgift utan händelser är
   * `ej_paborjad` ändå. Men uppgiftssidan visar historiken som en historik, och
   * "ingenting har hänt" på en rad som någon faktiskt la upp i går är fel på
   * samma sätt som rubriken i coachningens `skapaUppgift` beskriver.
   *
   * `by_employee_id` ÄR SERIENS SKAPARE OCH INTE NULL. Kolumnen kräver en
   * människa, och det är rätt människa: jobbet tryckte på knappen, men beslutet
   * att det skulle ske varje måndag var hennes.
   */
  const { error: hfel } = await db.from("task_event").insert(
    nya.map((r) => ({
      task_id: r.id,
      type: "skapad",
      by_employee_id: serie.created_by,
      note: "Förekomst i en återkommande serie",
    })),
  );

  if (hfel) throw new Error(`historiken kunde inte skrivas: ${hfel.message}`);

  return nya.length;
}

async function fodCoachningsuppgifter(
  db: SupabaseClient,
  serie: Serie,
  datum: string[],
): Promise<number> {
  const rader = datum.map((dag) => ({
    title: serie.title,
    description_md: serie.description_md,
    kind: serie.kind,
    assignee_id: serie.assignee_id,
    partner_id: serie.partner_id,
    created_by: serie.created_by,
    verify_by: serie.verify_by,
    evidence: serie.evidence,
    course_id: serie.course_id,
    module_id: serie.module_id,
    document_id: serie.document_id,
    due_date: dag,
    due_time: serie.due_time,
    estimate_minutes: serie.estimate_minutes,
    series_id: serie.id,
    series_on: dag,
  }));

  const { data, error } = await db
    .from("coaching_task")
    .upsert(rader, { onConflict: "series_id,series_on", ignoreDuplicates: true })
    .select("id");

  if (error) throw new Error(`coachningsuppgifterna kunde inte skrivas: ${error.message}`);

  const nya = (data ?? []) as { id: string }[];
  if (nya.length === 0) return 0;

  const { error: hfel } = await db.from("coaching_task_event").insert(
    nya.map((r) => ({
      task_id: r.id,
      type: "tilldelad",
      by_employee_id: serie.created_by,
    })),
  );

  if (hfel) throw new Error(`historiken kunde inte skrivas: ${hfel.message}`);

  /**
   * FOKUSOMRÅDENA FÖLJER INTE MED, och det är en känd lucka och inget förbisett.
   *
   * `coaching_task_focus` sätts av formuläret när uppgiften läggs upp för hand.
   * Serien bär dem inte, eftersom fokusområdena är en bedömning av vad en
   * SÄRSKILD träning ska öva — och en rutin som stämplar samma tre områden på
   * femtiotvå veckors uppgifter gör mätningen av dem meningslös.
   *
   * Ska det ändras är vägen en `task_series_focus`-tabell, inte en rad här.
   */

  await db.from("audit_log").insert(
    nya.map((r) => ({
      actor_id: serie.created_by,
      action: "coaching_task.created",
      object_type: "coaching_task",
      object_id: r.id,
      meta: { assignee_id: serie.assignee_id, kind: serie.kind, series_id: serie.id },
    })),
  );

  return nya.length;
}
