"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { MAX_MOMENT, momentdatum, tolkaMoment, type Mallmoment } from "@/lib/mallar";

/**
 * Uppgiftsmallarnas skrivningar.
 *
 * ===========================================================================
 * KRETSEN LÄSES MED ANVÄNDARENS EGEN TOKEN, SKRIVNINGEN GÅR VIA SERVICE ROLE
 *
 * Samma tvådelning som resten av modulen (D-T1): `task_template_read` i 0066 är
 * den enda platsen där "vem ser mallen" står, och varje handling härinne börjar
 * med att LÄSA mallen genom `supabaseServer()`. Går den inte att läsa finns den
 * inte, och det är hela behörighetskontrollen — inget andra villkor i
 * TypeScript som kan glida isär från policyn.
 *
 * Det är ett annat mönster än `kravKrets()` i uppgifter/actions.ts, och
 * skillnaden är att uppgiftens krets inte går att uttrycka i en enda policy —
 * den skiljer på att se, planera, arbeta och granska. En mall har två lägen:
 * man ser den eller inte, och man äger den eller inte.
 * ===========================================================================
 */

export type MallState = { fel?: string; ok?: string; id?: string };

async function kravInloggad() {
  const user = await getCurrentUser();
  if (!user?.employee) throw new Error("Du måste vara inloggad.");
  return user;
}

function text(form: FormData, namn: string): string {
  return String(form.get(namn) ?? "").trim();
}

function valfritt(form: FormData, namn: string): string | null {
  return text(form, namn) || null;
}

/**
 * Mallen jag äger, eller ett kastat fel.
 *
 * TVÅ FRÅGOR OCH INTE EN. Först läses raden med användarens egen token — ser
 * hon den inte ska svaret vara att den inte finns, inte att hon saknar
 * behörighet, för det andra svaret bekräftar att den existerar. Sedan jämförs
 * `created_by`: en delad mall är läsbar för alla och ändringsbar för en.
 */
async function kravAgare(mallId: string, mig: string) {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("task_template")
    .select("id, name, created_by, archived_at")
    .eq("id", mallId)
    .maybeSingle();

  if (!data) throw new Error("Mallen finns inte.");
  if ((data as { created_by: string }).created_by !== mig) {
    throw new Error("Bara den som skrev mallen kan ändra den.");
  }

  return data as { id: string; name: string; created_by: string; archived_at: string | null };
}

/** Momenten skrivs om från grunden vid varje ändring — se rubriken i `andra`. */
async function skrivMoment(mallId: string, moment: Mallmoment[]): Promise<string | null> {
  const db = supabaseAdmin();

  await db.from("task_template_item").delete().eq("template_id", mallId);

  const { error } = await db.from("task_template_item").insert(
    moment.map((m) => ({
      template_id: mallId,
      sort: m.sort,
      title: m.title,
      offset_days: m.offset_days,
      due_time: m.due_time,
      estimate_minutes: m.estimate_minutes,
      priority: m.priority,
    })),
  );

  return error ? error.message : null;
}

// =============================================================================
// Skriva mallen
// =============================================================================

export async function skapaUppgiftsmall(_prev: MallState, form: FormData): Promise<MallState> {
  try {
    const user = await kravInloggad();
    const mig = user.employee!.id;

    const namn = text(form, "name");
    if (!namn) return { fel: "Ge mallen ett namn." };
    if (namn.length > 80) return { fel: "Namnet får vara högst 80 tecken." };

    const { moment, fel } = tolkaMoment(text(form, "moment"));
    if (fel) return { fel };
    if (moment.length === 0) return { fel: "En mall behöver minst ett moment." };

    const db = supabaseAdmin();
    const { data: mall, error } = await db
      .from("task_template")
      .insert({
        name: namn,
        description_md: text(form, "description_md"),
        created_by: mig,
        // Kryssrutan står ikryssad i formuläret. Saknas den helt i posten är
        // det en avbockad ruta, inte ett glömt fält — se rubriken i 0066.
        shared: form.get("shared") !== null,
      })
      .select("id")
      .single();

    if (error || !mall) return { fel: `Mallen sparades inte: ${error?.message ?? "okänt fel"}` };

    const momentfel = await skrivMoment(mall.id as string, moment);
    if (momentfel) return { fel: `Momenten sparades inte: ${momentfel}` };

    await db.from("audit_log").insert({
      actor_id: mig,
      action: "task_template.created",
      object_type: "task_template",
      object_id: mall.id,
      meta: { name: namn, moment: moment.length },
    });

    revalidatePath("/uppgifter/mallar");
    return { ok: `Mallen "${namn}" är sparad med ${moment.length} moment.`, id: mall.id as string };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Ändrar en mall.
 *
 * ===========================================================================
 * MOMENTEN SKRIVS OM FRÅN GRUNDEN, OCH DET ÄR TRYGGT HÄR
 *
 * `delete` följt av `insert` är i de flesta tabeller ett sätt att tappa
 * historik. Här är det tvärtom det säkra: ett moment är ren malltext utan egen
 * identitet utåt, ingenting pekar på `task_template_item.id`, och de uppgifter
 * mallen redan fött pekar på MALLEN (`task.template_id`) och inte på momentet.
 *
 * Alternativet — att para ihop gamla och nya rader på `sort` — hade krävt tre
 * vägar (ändrad, tillagd, borttagen) för att uppnå exakt samma sluttillstånd.
 *
 * ÄNDRINGEN RÖR INTE DET SOM REDAN SKAPATS. En mall föder en gång och släpper
 * taget; den som rättar ett stavfel i "Skicka avtalet" rättar det för nästa
 * kund, inte i tolv gamla uppgifter som kanske redan är avbockade.
 * ===========================================================================
 */
export async function andraUppgiftsmall(_prev: MallState, form: FormData): Promise<MallState> {
  try {
    const user = await kravInloggad();
    const mig = user.employee!.id;

    const mallId = text(form, "template_id");
    await kravAgare(mallId, mig);

    const namn = text(form, "name");
    if (!namn) return { fel: "Ge mallen ett namn." };

    const { moment, fel } = tolkaMoment(text(form, "moment"));
    if (fel) return { fel };
    if (moment.length === 0) return { fel: "En mall behöver minst ett moment." };

    const db = supabaseAdmin();
    const { error } = await db
      .from("task_template")
      .update({
        name: namn,
        description_md: text(form, "description_md"),
        shared: form.get("shared") !== null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", mallId);

    if (error) return { fel: `Mallen sparades inte: ${error.message}` };

    const momentfel = await skrivMoment(mallId, moment);
    if (momentfel) return { fel: `Momenten sparades inte: ${momentfel}` };

    revalidatePath("/uppgifter/mallar");
    return { ok: `"${namn}" är uppdaterad — ${moment.length} moment.` };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Arkiverar mallen. RADERAR DEN INTE.
 *
 * `task.template_id` pekar hit från varje uppgift mallen fött, och en
 * borttagning hade satt dem till null — alltså tyst klippt bandet mellan tolv
 * uppgifter och beskedet om varifrån de kom. Samma val som `task_series.ended_at`
 * gjorde i 0062, och av samma skäl: "varför står det här i min lista" är en
 * fråga någon kommer att ställa.
 */
export async function arkiveraUppgiftsmall(_prev: MallState, form: FormData): Promise<MallState> {
  try {
    const user = await kravInloggad();
    const mig = user.employee!.id;

    const mallId = text(form, "template_id");
    const mall = await kravAgare(mallId, mig);
    const lagg = mall.archived_at === null;

    const { error } = await supabaseAdmin()
      .from("task_template")
      .update({
        archived_at: lagg ? new Date().toISOString() : null,
        archived_by: lagg ? mig : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", mallId);

    if (error) return { fel: `Gick inte att arkivera: ${error.message}` };

    revalidatePath("/uppgifter/mallar");
    return { ok: lagg ? `"${mall.name}" är arkiverad.` : `"${mall.name}" är tillbaka.` };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

// =============================================================================
// Använda mallen
// =============================================================================

/**
 * Tillämpar en mall och föder riktiga uppgifter.
 *
 * ===========================================================================
 * ALLA UPPGIFTER SKAPAS I EN ENDA INSERT
 *
 * Faller den skapas ingen. En halv checklista är värre än ingen alls, eftersom
 * ingen kan se vilken halva som saknas — och hela poängen med en mall är att
 * ingen ska glömma steg fyra.
 *
 * ID:NA GENERERAS I FÖRVÄG, av samma skäl som `tillampaMall()` i coachningen
 * skriver ut i sin egen rubrik: PostgREST lovar inte att `.select()` efter en
 * insert ger raderna i samma ordning som de skickades, och historikraderna
 * nedan måste hamna på rätt uppgift.
 *
 * ===========================================================================
 * FRISTEN RÄKNAS FRÅN STARTDAGEN SOM ANGES, INTE FRÅN I DAG
 *
 * Samma mall ska fungera för kunden som startar i mars och för den som lades
 * upp i efterhand tre veckor efter sin första dag. `momentdatum()` i
 * lib/mallar.ts räknar, och den är provad utan databas.
 * ===========================================================================
 */
export async function anvandUppgiftsmall(_prev: MallState, form: FormData): Promise<MallState> {
  try {
    const user = await kravInloggad();
    const mig = user.employee!.id;

    const mallId = text(form, "template_id");
    const start = text(form, "start_date");
    if (!mallId) return { fel: "Välj en mall." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return { fel: "Startdagen är inte ett giltigt datum." };

    const supabase = await supabaseServer();

    /**
     * BÅDA LÄSNINGARNA GÅR MED ANVÄNDARENS EGEN TOKEN, och det är
     * behörighetskontrollen. Mallen släpps fram av `task_template_read` bara
     * om den är delad eller min egen; momenten ärver den kretsen.
     */
    const [{ data: mall }, { data: moment }] = await Promise.all([
      supabase
        .from("task_template")
        .select("id, name, archived_at")
        .eq("id", mallId)
        .maybeSingle(),
      supabase
        .from("task_template_item")
        .select("id, sort, title, description_md, offset_days, due_time, estimate_minutes, priority")
        .eq("template_id", mallId)
        .order("sort"),
    ]);

    if (!mall) return { fel: "Mallen finns inte." };

    /**
     * RADERNA TYPAS OM EN GÅNG, HÄR. Samma grepp som `hamtaUppgiftsbild()`
     * använder för länkraderna: Supabase-klientens typparser ger inga
     * användbara typer för de här kolumnerna, och en cast vid varje användning
     * blir fem ställen som måste hållas lika.
     */
    const rubrik = mall as unknown as { id: string; name: string; archived_at: string | null };
    const poster = (moment ?? []) as unknown as {
      id: string;
      sort: number;
      title: string;
      description_md: string | null;
      offset_days: number;
      due_time: string | null;
      estimate_minutes: number | null;
      priority: number;
    }[];

    if (rubrik.archived_at) return { fel: "Mallen är arkiverad. Ta fram den igen först." };
    if (poster.length === 0) return { fel: "Mallen har inga moment." };
    if (poster.length > MAX_MOMENT) return { fel: "Mallen har fler moment än som får skapas på en gång." };

    /**
     * ANSVARIG OCH PROJEKT KONTROLLERAS MOT DET ANVÄNDAREN FAKTISKT SER.
     *
     * Väljarna fylls av samma två frågor och följer alltså `employee_read`
     * (0001/0002) respektive projektets egen policy. Kontrollen här upprepar
     * frågan mot databasen i stället för att lita på att posten kom från
     * väljaren: ett formulär är en plats att skriva ett godtyckligt uuid i, och
     * utan den här raden hade en mall kunnat lägga sex uppgifter på en kollega
     * man inte ens får se namnet på.
     */
    const ansvarig = valfritt(form, "assignee_id") ?? mig;
    if (ansvarig !== mig) {
      const { data: person } = await supabase
        .from("employee")
        .select("id")
        .eq("id", ansvarig)
        .maybeSingle();
      if (!person) return { fel: "Du kan inte lägga uppgifter på den personen." };
    }

    const projektId = valfritt(form, "project_id");
    if (projektId) {
      const { data: projekt } = await supabase
        .from("project")
        .select("id")
        .eq("id", projektId)
        .maybeSingle();
      if (!projekt) return { fel: "Projektet finns inte, eller så får du inte lägga uppgifter i det." };
    }

    const db = supabaseAdmin();
    const rader = poster.map((m) => ({
      id: crypto.randomUUID(),
      title: m.title,
      description_md: m.description_md ?? "",
      project_id: projektId,
      assignee_id: ansvarig,
      created_by: mig,
      due_date: momentdatum(start, { offset_days: m.offset_days }),
      due_time: m.due_time,
      estimate_minutes: m.estimate_minutes,
      priority: m.priority,
      template_id: mallId,
    }));

    const { error } = await db.from("task").insert(rader);
    if (error) return { fel: `Uppgifterna skapades inte: ${error.message}` };

    /**
     * Historikraden per uppgift, i EN insert. `skrivHandelse()` i
     * uppgifter/actions.ts gör en skrivning per rad plus en uppdatering av
     * `updated_at` — sex moment hade blivit tolv turer till databasen för något
     * som är en enda handling. `updated_at` sätts av tabellens eget förval vid
     * skapandet och behöver inte röras.
     */
    await db
      .from("task_event")
      .insert(rader.map((r) => ({ task_id: r.id, type: "skapad", by_employee_id: mig })));

    await db.from("audit_log").insert({
      actor_id: mig,
      action: "task_template.applied",
      object_type: "task_template",
      object_id: mallId,
      meta: { assignee_id: ansvarig, start_date: start, project_id: projektId, uppgifter: rader.length },
    });

    revalidatePath("/uppgifter");
    revalidatePath("/uppgifter/mallar");
    revalidatePath("/kalender");
    revalidatePath("/");

    const datum = rader.map((r) => r.due_date).sort();
    return {
      ok: `${rader.length} uppgifter upplagda från "${rubrik.name}" — ${datum[0]} till ${datum[datum.length - 1]}.`,
    };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}
