"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";
import {
  MEDLEMSROLLER,
  PRIORITETER,
  arStangd,
  farArbeta,
  farBjudaIn,
  farGranska,
  farPlanera,
  farRedigera,
  lageAv,
  tolkaSnabbrad,
  type Handelsetyp,
  type Krets,
  type Medlemsroll,
  type Prioritet,
} from "@/lib/uppgifter";
import { granskaRegel, regelUrFormular, serietext } from "@/lib/upprepning";
import { skapaSerie } from "@/lib/upprepning-server";
import {
  arDelningsniva,
  farArbetaSomAgaren,
  farPlaneraOm,
  serDetaljer,
  type Delningsniva,
} from "@/lib/kalender";
import { notifiera, notifieraFlera } from "@/lib/notishandelse-server";

/**
 * Uppgiftsmodulens skrivningar.
 *
 * SKRIVNING GAR VIA SERVICE ROLE OCH FORBI RLS (D-T1), sa kontrollerna harinne
 * ar de enda som finns. `task_read` i 0054 galler lasningen och ingenting
 * annat — den som bara har `taskId` och en webblasare kommer hit, inte dit.
 *
 * Varje skrivande funktion borjar darfor med `kravKrets()`, som hamtar raden
 * med service role och svarar pa vem den inloggade AR i forhallande till den.
 * Beslutet fattas sedan av de rena funktionerna i `lib/uppgifter.ts`, som ar
 * provade var for sig.
 */

export type UppgiftState = { fel?: string; ok?: string; id?: string };

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

type Rad = {
  id: string;
  title: string;
  assignee_id: string | null;
  created_by: string;
  project_id: string | null;
  parent_id: string | null;
};

/**
 * Raden, den inloggade, och vad hen far gora med den.
 *
 * Hamtar OCKSA medlemsraderna, for rollen bland de inbjudna avgor tre av de
 * fyra behorighetsfragorna. Tva turer i stallet for en vore billigare i kod
 * och dyrare i praktiken: varje action harinne hade behovt bada anda.
 */
async function kravKrets(taskId: string): Promise<{
  user: Awaited<ReturnType<typeof kravInloggad>>;
  rad: Rad;
  krets: Krets;
  granskare: string[];
  /** 0057: nivan den ansvariga gett mig i sin kalender. Null nar ingen finns. */
  kalenderniva: Delningsniva | null;
}> {
  const user = await kravInloggad();
  const mig = user.employee!.id;
  const db = supabaseAdmin();

  const [{ data: rad }, { data: medlemmar }] = await Promise.all([
    db
      .from("task")
      .select("id, title, assignee_id, created_by, project_id, parent_id")
      .eq("id", taskId)
      .maybeSingle(),
    db.from("task_member").select("employee_id, role").eq("task_id", taskId),
  ]);

  if (!rad) throw new Error("Uppgiften finns inte.");

  const minRoll =
    ((medlemmar ?? []).find((m) => m.employee_id === mig)?.role as Medlemsroll | undefined) ?? null;

  const kalenderniva = await delningsniva((rad as Rad).assignee_id, mig);

  const krets: Krets = {
    mig,
    assignee_id: (rad as Rad).assignee_id,
    created_by: (rad as Rad).created_by,
    minRoll,
    somDelegat: farArbetaSomAgaren(kalenderniva),
  };

  /**
   * DEN SOM INTE SER RADEN FAR INTE HELLER VETA ATT DEN FINNS.
   *
   * Utan den har grenen svarar en godtycklig `taskId` med "du får inte ändra
   * uppgiften" i stallet for "uppgiften finns inte", och skillnaden ar att det
   * forsta bekraftar att raden existerar. I den har modulen ar existensen i sig
   * det kansliga — se rubriken i 0054.
   */
  const ser =
    krets.assignee_id === mig ||
    krets.created_by === mig ||
    minRoll !== null ||
    // 0057. Samma gren som `uppgift_synlig()` fick: en delning pa "alla
    // detaljer" eller mer oppnar raden. RLS och den har kontrollen maste saga
    // samma sak, annars svarar lasningen och skrivningen olika pa vem som ser.
    serDetaljer(kalenderniva) ||
    (await serViaForalder(db, (rad as Rad).parent_id, mig));

  if (!ser) throw new Error("Uppgiften finns inte.");

  return {
    user,
    rad: rad as Rad,
    krets,
    granskare: (medlemmar ?? []).filter((m) => m.role === "granskare").map((m) => m.employee_id as string),
    kalenderniva,
  };
}

/**
 * Nivan `agare` gett `lasare` i sin kalender, eller null.
 *
 * LASES MED SERVICE ROLE, och urvalet ar spärren precis som i `namnkarta()`:
 * fragan galler exakt ett par av id:n, och det ena ar den inloggade. Funktionen
 * kan alltsa bara svara pa "vad har den har personen gett MIG", aldrig blattra
 * i vem som delat med vem. Med anvandarens egen token hade svaret varit samma
 * — `calendar_share_read` i 0057 slapper fram just de tva hallen — men vagen
 * gar anda via admin, eftersom resten av filen skriver med service role och en
 * kontroll som byter klient mitt i ar en kontroll man laser fel.
 */
async function delningsniva(agare: string | null, lasare: string): Promise<Delningsniva | null> {
  if (!agare || agare === lasare) return null;

  const { data } = await supabaseAdmin()
    .from("calendar_share")
    .select("level")
    .eq("owner_id", agare)
    .eq("viewer_id", lasare)
    .maybeSingle();

  const niva = (data as { level?: string } | null)?.level;
  return arDelningsniva(niva) ? niva : null;
}

/** En deluppgift arvs av forlderns krets — samma gren som RLS-policyn har. */
async function serViaForalder(
  db: ReturnType<typeof supabaseAdmin>,
  parentId: string | null,
  mig: string,
): Promise<boolean> {
  if (!parentId) return false;

  const [{ data: far }, { data: medlemmar }] = await Promise.all([
    db.from("task").select("assignee_id, created_by").eq("id", parentId).maybeSingle(),
    db.from("task_member").select("employee_id").eq("task_id", parentId),
  ]);

  if (!far) return false;
  return (
    far.assignee_id === mig ||
    far.created_by === mig ||
    (medlemmar ?? []).some((m) => m.employee_id === mig)
  );
}

/** En rad i historiken. Allt som andrar laget gar igenom den har. */
async function skrivHandelse(
  taskId: string,
  typ: Handelsetyp,
  av: string,
  note?: string | null,
): Promise<void> {
  const db = supabaseAdmin();
  await db.from("task_event").insert({ task_id: taskId, type: typ, by_employee_id: av, note: note ?? null });
  // `updated_at` bar "hur lange har det statt still" i delegeringslistan. Den
  // satts har och inte av en trigger, sa att den alltid foljer med handelsen.
  await db.from("task").update({ updated_at: new Date().toISOString() }).eq("id", taskId);
}

async function nuvarandeLage(taskId: string) {
  const { data } = await supabaseAdmin()
    .from("task_event")
    .select("type")
    .eq("task_id", taskId)
    .order("at");
  return lageAv((data ?? []) as { type: Handelsetyp }[]);
}

function uppdatera(id: string) {
  revalidatePath("/uppgifter");
  revalidatePath(`/uppgifter/${id}`);
  // 0057. Kalendern ritar samma rader, sa den ska inte kunna visa gardagens
  // plan efter en avbockning. Den star HAR och inte i varje action av samma
  // skal som de tre ovan: en ny handling som glommer raden ar en vy som slutar
  // stamma, och det syns forst nar nagon undrar varfor uppgiften ar kvar.
  revalidatePath("/kalender");
  revalidatePath("/");
}

// =============================================================================
// Skapa
// =============================================================================

/**
 * En ny uppgift, fran snabbraden eller fran det utfallda formularet.
 *
 * SNABBRADEN TOLKAS HAR OCH INTE I WEBBLASAREN. Klienten visar en forhandsbild
 * av vad den tror att raden betyder, men det ar den har tolkningen som sparas —
 * annars hade en gammal flik kunnat posta ett datum som tolken inte langre
 * skulle ha gett, och forhandsbilden hade varit en gissning om nagot annat an
 * det som hander.
 *
 * `#projekt` och `@person` slas upp mot namn. HITTAS DE INTE BLIR DE TITEL
 * IGEN: en uppgift som tyst tappar sitt projekt ar samre an en vars rubrik
 * innehaller ordet, for det andra gar att se och rata.
 */
export async function skapaUppgift(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const user = await kravInloggad();
    const mig = user.employee!.id;
    const db = supabaseAdmin();

    const snabbrad = text(form, "rad");
    const idag = svensktDatum();

    let titel = text(form, "title");
    let due = valfritt(form, "due_date");
    let tid = valfritt(form, "due_time");
    let minuter = valfritt(form, "estimate_minutes");
    let prioritet = Number(text(form, "priority") || "3");
    let projektId = valfritt(form, "project_id");
    let ansvarig = valfritt(form, "assignee_id");
    let rest = "";

    if (snabbrad) {
      const tolkad = tolkaSnabbrad(snabbrad, idag);
      titel = tolkad.titel;
      due = tolkad.due_date;
      tid = tolkad.due_time;
      minuter = tolkad.estimate_minutes ? String(tolkad.estimate_minutes) : null;
      prioritet = tolkad.priority;

      if (tolkad.projekt) {
        const { data } = await db
          .from("project")
          .select("id")
          .is("archived_at", null)
          .ilike("name", tolkad.projekt)
          .maybeSingle();
        if (data) projektId = data.id as string;
        else rest += ` #${tolkad.projekt}`;
      }

      if (tolkad.person) {
        const traff = await slaUppPerson(tolkad.person);
        if (traff) ansvarig = traff;
        else rest += ` @${tolkad.person}`;
      }

      titel = `${titel}${rest}`.trim();
    }

    if (!titel) return { fel: "Skriv vad som ska göras." };
    if (titel.length > 200) return { fel: "Rubriken får vara högst 200 tecken." };
    if (!PRIORITETER.includes(prioritet as Prioritet)) prioritet = 3;

    const foralder = valfritt(form, "parent_id");
    if (foralder) {
      // En deluppgift kraver att man far rora foraldern. Kontrollen ligger har
      // och inte i triggern: databasen vaktar DJUPET, inte vem som skriver.
      const { krets } = await kravKrets(foralder);
      if (!farRedigera(krets)) return { fel: "Du får inte lägga till i den uppgiften." };
    }

    /**
     * 0062: UPPREPNINGEN GRENAR AV HAR, OCH DEN SKRIVER INGEN `task` SJALV.
     *
     * Vagen ar `task_series` → `fodEnSerie()` → riktiga rader, alltsa samma
     * vag som nattjobbet gar. Ett specialfall som skrivit forsta forekomsten
     * for hand och overlatit resten till jobbet hade varit tva satt att fodas,
     * och skillnaden mellan dem hade synts forst i forekomst nummer tva.
     */
    const regel = due ? regelUrFormular(form, due) : null;
    if (regel) {
      if (foralder) return { fel: "En deluppgift kan inte återkomma. Lägg upp rutinen som en egen uppgift." };

      const klagomal = granskaRegel(regel);
      if (klagomal) return { fel: klagomal };

      return skapaSerieinternt(db, {
        regel,
        slag: "uppgift",
        mig,
        assignee_id: ansvarig ?? mig,
        title: titel,
        description_md: text(form, "description_md"),
        due_time: tid,
        estimate_minutes: minuter ? Number(minuter) : null,
        priority: prioritet,
        project_id: projektId,
      });
    }

    const { data: skapad, error } = await db
      .from("task")
      .insert({
        title: titel,
        description_md: text(form, "description_md"),
        project_id: foralder ? null : projektId,
        parent_id: foralder,
        // Ingen ansvarig = inkorgen. Den som skriver ner en tanke om sig sjalv
        // far den pa sig; den som inte pekar ut nagon lamnar den oppen.
        assignee_id: ansvarig ?? (form.has("till_inkorgen") ? null : mig),
        created_by: mig,
        starts_on: valfritt(form, "starts_on"),
        due_date: due,
        due_time: due ? tid : null,
        estimate_minutes: minuter ? Number(minuter) : null,
        priority: prioritet,
      })
      .select("id, assignee_id")
      .single();

    if (error || !skapad) return { fel: `Uppgiften sparades inte: ${error?.message ?? "okänt fel"}` };

    await skrivHandelse(skapad.id as string, "skapad", mig);

    uppdatera(skapad.id as string);
    return { ok: "Upplagd.", id: skapad.id as string };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Regeln in, ett svar en manniska kan lasa ut.
 *
 * SVARET NAMNER ANTALET, och det ar inte statistik. Den som kryssat i "varje
 * mandag" och far "Upplagd." vet inte om navet forstod att det skulle handa mer
 * an en gang. "Varje måndag · 8 förekomster upplagda" ar kvittot pa att regeln
 * blev en regel, och det ar det enda stallet dar skillnaden syns direkt.
 */
async function skapaSerieinternt(
  db: ReturnType<typeof supabaseAdmin>,
  falt: {
    regel: Parameters<typeof granskaRegel>[0];
    slag: "uppgift" | "coachningsuppgift";
    mig: string;
    assignee_id: string;
    title: string;
    description_md: string;
    due_time: string | null;
    estimate_minutes: number | null;
    priority: number;
    project_id: string | null;
  },
): Promise<UppgiftState> {
  const { regel, mig, ...mall } = falt;

  const { id, fodda } = await skapaSerie(
    db,
    {
      slag: mall.slag,
      monster: regel.monster,
      veckodagar: regel.veckodagar,
      starts_on: regel.starts_on,
      ends_on: regel.ends_on,
      title: mall.title,
      description_md: mall.description_md,
      due_time: mall.due_time,
      estimate_minutes: mall.estimate_minutes,
      assignee_id: mall.assignee_id,
      created_by: mig,
      priority: mall.priority,
      project_id: mall.project_id,
    },
    svensktDatum(),
  );

  /**
   * `uppdatera()` ANVANDS INTE HAR. Den revaliderar `/uppgifter/<id>`, och id:t
   * harinne ar SERIENS och inte en uppgifts — vagen finns inte. Listorna ar
   * anda det som andrats: en serie foder mellan noll och femtiosju rader, och
   * ingen av dem har en sida som redan var oppen.
   */
  revalidatePath("/uppgifter");
  revalidatePath("/kalender");
  revalidatePath("/");

  return {
    id,
    ok: `${serietext(regel)} · ${fodda} ${fodda === 1 ? "förekomst" : "förekomster"} upplagda.`,
  };
}

/**
 * `@Anna` till ett employee-id.
 *
 * Exakt fornamn forst, sedan hela namnet. EN ENTYDIG TRAFF KRAVS: finns det tva
 * Anna i huset ar det ratt att lamna ordet i rubriken och lata anvandaren peka
 * ut vem hon menade. Att valja den forsta hade lagt nagon annans uppgift pa fel
 * person, och det upptacks forst nar den blivit forsenad.
 */
async function slaUppPerson(namn: string): Promise<string | null> {
  const db = supabaseAdmin();
  const rent = namn.replace(/_/g, " ");

  const { data } = await db
    .from("employee")
    .select("id, first_name, last_name")
    .neq("status", "offboarded")
    .limit(50);

  const alla = (data ?? []) as { id: string; first_name: string; last_name: string }[];
  const lika = (a: string, b: string) => a.toLocaleLowerCase("sv") === b.toLocaleLowerCase("sv");

  const heltNamn = alla.filter((p) => lika(`${p.first_name} ${p.last_name}`, rent));
  if (heltNamn.length === 1) return heltNamn[0].id;

  const fornamn = alla.filter((p) => lika(p.first_name, rent));
  return fornamn.length === 1 ? fornamn[0].id : null;
}

// =============================================================================
// Ändra
// =============================================================================

/**
 * 0062: `serie_omfattning` avgor vem andringen galler.
 *
 * "bara" ar grundlaget och det enda svaret for en uppgift utan serie. "serie"
 * skriver om mallen och alla ofodda och framtida forekomster med — se
 * `andraHelaSerien()` langre ner.
 */
export async function andraUppgift(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { krets } = await kravKrets(id);
    if (!farRedigera(krets)) return { fel: "Du får inte ändra den här uppgiften." };

    const titel = text(form, "title");
    if (!titel) return { fel: "Rubriken kan inte vara tom." };

    const due = valfritt(form, "due_date");
    const prioritet = Number(text(form, "priority") || "3");

    const db = supabaseAdmin();

    /**
     * SERIETILLHORIGHETEN LASES UR RADEN, ALDRIG UR FORMULARET.
     *
     * Samma linje som utkopet pa ordern (0060): ett `series_id` i ett formular
     * ar en plats att skriva om NAGON ANNANS serie ifran. Kretsen provades mot
     * uppgiften, inte mot regeln.
     */
    const { data: serierad } = await db
      .from("task")
      .select("series_id, series_on")
      .eq("id", id)
      .maybeSingle();

    const serieId = (serierad as { series_id: string | null } | null)?.series_id ?? null;
    const helaSerien = serieId !== null && text(form, "serie_omfattning") === "serie";

    const { error } = await db
      .from("task")
      .update({
        title: titel,
        description_md: text(form, "description_md"),
        due_date: due,
        // Klockslaget faller med datumet. `task_tid_kraver_datum` i 0054 hade
        // annars avvisat hela uppdateringen med ett villkorsnamn i felrutan.
        due_time: due ? valfritt(form, "due_time") : null,
        starts_on: valfritt(form, "starts_on"),
        estimate_minutes: text(form, "estimate_minutes") ? Number(text(form, "estimate_minutes")) : null,
        priority: PRIORITETER.includes(prioritet as Prioritet) ? prioritet : 3,
        project_id: valfritt(form, "project_id"),
        /**
         * "BARA DEN HAR" LOSGOR FOREKOMSTEN.
         *
         * Utan raden hade nasta serieandring skrivit tillbaka det anvandaren
         * just andrade, och hon hade inte fatt veta det — raden bara ser ut som
         * den gjorde forut nasta gang hon tittar. Flaggan ar alltsa inte
         * bokforing utan hela skillnaden mellan de tva svaren pa fragan.
         *
         * Den satts BARA i den har grenen. En serieandring ska inte losgora
         * raderna den skriver; da hade nasta serieandring inte natt nagon.
         */
        ...(serieId && !helaSerien ? { series_losgjord: true } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) return { fel: `Ändringen sparades inte: ${error.message}` };

    if (helaSerien) {
      const svar = await andraHelaSerien(serieId!, form, {
        title: titel,
        description_md: text(form, "description_md"),
        due_time: due ? valfritt(form, "due_time") : null,
        estimate_minutes: text(form, "estimate_minutes") ? Number(text(form, "estimate_minutes")) : null,
        priority: PRIORITETER.includes(prioritet as Prioritet) ? prioritet : 3,
        project_id: valfritt(form, "project_id"),
      });
      if (svar.fel) return svar;

      uppdatera(id);
      return { ok: svar.ok };
    }

    uppdatera(id);
    return { ok: serieId ? "Sparat — bara den här förekomsten." : "Sparat." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * "HELA SERIEN": mallen skrivs om, och de framtida forekomsterna med den.
 *
 * =============================================================================
 * TRE URVAL, OCH VART OCH ETT HALLER NAGOT UTANFOR MED FLIT
 *
 *   FRAMTIDEN, INTE DET SOM VARIT. En rutin som byter rubrik i oktober har inte
 *   alltid hetat sa. Skrevs historiken om skulle septembers bockade rader saga
 *   att man gjort nagot man aldrig gjorde, och det ar en forfalskning aven nar
 *   den ar valmenande. Granen gar vid `due_date >= idag`.
 *
 *   INTE DE LOSGJORDA. Den som flyttat EN mandag till klockan tio har fattat
 *   ett beslut om just den, och ett serieklick ska inte tysta det.
 *
 *   INTE DE STANGDA. En bockad forekomst ar ett kvitto pa nagot som ar gjort.
 *   Urvalet gors i SQL pa `due_date` och i koden pa laget — `lageAv()` raknas
 *   fram ur handelserna och gar inte att fraga om i en `update`.
 *
 * DATUMET FOLJER INTE MED, och det ar den viktigaste raden i hela funktionen.
 * `due_date` ar VILKEN FOREKOMST raden ar; skrevs den over hade alla femtiotva
 * mandagar hamnat pa samma dag. Mallen bar klockslaget, inte dagen.
 * =============================================================================
 */
async function andraHelaSerien(
  serieId: string,
  form: FormData,
  mall: {
    title: string;
    description_md: string;
    due_time: string | null;
    estimate_minutes: number | null;
    priority: number;
    project_id: string | null;
  },
): Promise<UppgiftState> {
  const db = supabaseAdmin();
  const idag = svensktDatum();

  const { data: serie } = await db
    .from("task_series")
    .select("id, assignee_id, created_by, ended_at")
    .eq("id", serieId)
    .maybeSingle();

  if (!serie) return { fel: "Serien finns inte." };

  const { user } = await kravKrets(text(form, "id"));
  const mig = user.employee!.id;

  /**
   * REGELN AGS AV TVA PERSONER, precis som `task_series_read` i 0062 sager. Den
   * som bjudits in i EN forekomst far redigera den forekomsten — hon har
   * ingenting att gora med att andra alla framtida mandagar.
   */
  const s = serie as { assignee_id: string; created_by: string; ended_at: string | null };
  if (s.assignee_id !== mig && s.created_by !== mig) {
    return { fel: "Bara den som äger rutinen kan ändra hela serien." };
  }
  if (s.ended_at) return { fel: "Serien är avslutad. Ändringen gäller bara den här förekomsten." };

  const { error: serieFel } = await db
    .from("task_series")
    .update({ ...mall, updated_at: new Date().toISOString() })
    .eq("id", serieId);

  if (serieFel) return { fel: `Serien sparades inte: ${serieFel.message}` };

  // Kandidaterna: framtida, inte losgjorda. Laget sallas efter, i koden.
  const { data: kandidater } = await db
    .from("task")
    .select("id")
    .eq("series_id", serieId)
    .eq("series_losgjord", false)
    .gte("due_date", idag);

  const ids = ((kandidater ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length === 0) return { ok: "Serien är ändrad." };

  const { data: handelser } = await db
    .from("task_event")
    .select("task_id, type")
    .in("task_id", ids)
    .order("at");

  const per = new Map<string, { type: Handelsetyp }[]>();
  for (const h of (handelser ?? []) as { task_id: string; type: Handelsetyp }[]) {
    const lista = per.get(h.task_id);
    if (lista) lista.push(h);
    else per.set(h.task_id, [h]);
  }

  const oppna = ids.filter((id) => !arStangd(lageAv(per.get(id) ?? [])));
  if (oppna.length === 0) return { ok: "Serien är ändrad." };

  const { error: radFel } = await db
    .from("task")
    .update({ ...mall, updated_at: new Date().toISOString() })
    .in("id", oppna);

  if (radFel) return { fel: `Förekomsterna sparades inte: ${radFel.message}` };

  return {
    ok:
      oppna.length === 1
        ? "Serien och den kommande förekomsten är ändrade."
        : `Serien och ${oppna.length} kommande förekomster är ändrade.`,
  };
}

/**
 * Avsluta en rutin.
 *
 * =============================================================================
 * DET SOM VARIT STAR KVAR. DET SOM ALDRIG HANDE FORSVINNER.
 *
 * Serien slutar foda, och de framtida forekomster som ANNU INTE RORTS tas bort.
 * Bada halvorna av den meningen ar val:
 *
 *   ATT LATA DEM STA hade varit det forsiktiga valet och fel. Den som avslutar
 *   en rutin i september har sju veckors mandagar liggande i kalendern, och de
 *   ar inte langre nagot hon tanker gora. En kalender som visar sju mandagar
 *   ingen ska gora ar en kalender man slutar lita pa.
 *
 *   ATT RADERA ALLT hade varit varre. Gjorda forekomster ar historik —
 *   bockade, godkanda, kommenterade av manniskor — och de raderas aldrig av att
 *   nagon stanger av framtiden.
 *
 * Gransen gar vid `due_date > idag` OCH att ingenting hant utover `skapad`.
 * DAGENS FOREKOMST STAR ALLTSA KVAR, aven om den ar orord: den som stanger av
 * mandagsrutinen pa en mandag har antagligen redan planerat dagen efter den.
 *
 * REGELRADEN RADERAS INTE. `ended_at` satts i stallet, sa att de gjorda
 * raderna fortfarande kan svara pa varfor de lades upp. Se 0062.
 * =============================================================================
 */
export async function avslutaSerie(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const user = await kravInloggad();
    const mig = user.employee!.id;
    const db = supabaseAdmin();

    // Id:t tas ur UPPGIFTEN och inte ur formularet, av samma skal som
    // `andraUppgift` ovan: kretsen provas mot en rad, och raden bar serien.
    const uppgiftId = text(form, "id");
    const { krets } = await kravKrets(uppgiftId);
    if (!farRedigera(krets)) return { fel: "Du får inte ändra den här uppgiften." };

    const { data: rad } = await db
      .from("task")
      .select("series_id")
      .eq("id", uppgiftId)
      .maybeSingle();

    const serieId = (rad as { series_id: string | null } | null)?.series_id ?? null;
    if (!serieId) return { fel: "Uppgiften hör inte till någon serie." };

    const { data: serie } = await db
      .from("task_series")
      .select("id, assignee_id, created_by, ended_at")
      .eq("id", serieId)
      .maybeSingle();

    const s = serie as { assignee_id: string; created_by: string; ended_at: string | null } | null;
    if (!s) return { fel: "Serien finns inte." };
    if (s.assignee_id !== mig && s.created_by !== mig) {
      return { fel: "Bara den som äger rutinen kan avsluta den." };
    }
    if (s.ended_at) return { ok: "Serien är redan avslutad." };

    const { error } = await db
      .from("task_series")
      .update({ ended_at: new Date().toISOString(), ended_by: mig, updated_at: new Date().toISOString() })
      .eq("id", serieId);

    if (error) return { fel: `Serien avslutades inte: ${error.message}` };

    const bortplockade = await taBortOrordFramtid(serieId);

    uppdatera(uppgiftId);
    return {
      ok:
        bortplockade === 0
          ? "Rutinen är avslutad. Inga kommande förekomster fanns."
          : `Rutinen är avslutad och ${bortplockade} orörda förekomster är borttagna.`,
    };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Framtida forekomster som ingen rort. Returnerar antalet borttagna.
 *
 * "ORORD" BETYDER EXAKT EN HANDELSE, OCH DEN SKA VARA `skapad`. En uppgift som
 * nagon paborjat, kommenterat, bockat eller tilldelat nagon annan ar inte
 * langre en rad ett jobb skrev — da finns det en manniska i historiken, och det
 * som en manniska rort raderas inte av att en regel stangs av.
 */
async function taBortOrordFramtid(serieId: string): Promise<number> {
  const db = supabaseAdmin();
  const idag = svensktDatum();

  const { data: kandidater } = await db
    .from("task")
    .select("id")
    .eq("series_id", serieId)
    .eq("series_losgjord", false)
    .gt("due_date", idag);

  const ids = ((kandidater ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length === 0) return 0;

  const { data: handelser } = await db
    .from("task_event")
    .select("task_id, type")
    .in("task_id", ids);

  const antal = new Map<string, { flera: boolean; annat: boolean }>();
  for (const h of (handelser ?? []) as { task_id: string; type: string }[]) {
    const f = antal.get(h.task_id) ?? { flera: false, annat: false };
    if (antal.has(h.task_id)) f.flera = true;
    if (h.type !== "skapad") f.annat = true;
    antal.set(h.task_id, f);
  }

  const ororda = ids.filter((id) => {
    const f = antal.get(id);
    return !f || (!f.flera && !f.annat);
  });

  if (ororda.length === 0) return 0;

  /**
   * HANDELSERNA FORST. `task_event.task_id` har `on delete cascade` i 0054, sa
   * ordningen spelar ingen roll for databasen — men den gor det for den som
   * laser: raderingen ska se ut som den ar, alltsa att bada forsvinner.
   */
  await db.from("task_event").delete().in("task_id", ororda);
  const { error } = await db.from("task").delete().in("id", ororda);
  if (error) throw new Error(`förekomsterna kunde inte tas bort: ${error.message}`);

  return ororda.length;
}

/**
 * Byta ansvarig.
 *
 * EGEN ACTION OCH INTE ETT FALT I `andraUppgift`, for den skriver bade en
 * handelse och en notis. En omtilldelning som gomdes i en vanlig sparning hade
 * betytt att nagon fick en uppgift utan att fa veta det — och den harledda
 * "ny uppgift"-posten star bara nagra dygn efter att raden skapades.
 */
export async function tilldela(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { rad, krets, user } = await kravKrets(id);
    if (!farRedigera(krets)) return { fel: "Du får inte ändra den här uppgiften." };

    const till = valfritt(form, "assignee_id");
    if (till === rad.assignee_id) return { ok: "Oförändrad." };

    const { error } = await supabaseAdmin()
      .from("task")
      .update({ assignee_id: till, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) return { fel: `Gick inte att tilldela: ${error.message}` };

    await skrivHandelse(id, "tilldelad", krets.mig);

    if (till) {
      await notifiera({
        till,
        av: krets.mig,
        kalla: "uppgift-tilldelad",
        typ: "uppgift",
        rubrik: rad.title,
        detalj: `${user.employee!.first_name} la uppgiften på dig`,
        href: `/uppgifter/${id}`,
        objekt: { typ: "task", id },
      });
    }

    uppdatera(id);
    return { ok: till ? "Tilldelad." : "Lagd i inkorgen." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Datum, klockslag och tidsatgang i ett svep.
 *
 * =============================================================================
 * DEN HAR SKRIVER HELA PLANERINGEN. ETT FALT SOM INTE KOMMER MED AR "TA BORT".
 *
 * Det ar inte en bugg utan formen: planeringen ar TRE falt som hanger ihop, och
 * ett anrop som bara satte det man skickat hade gjort det omojligt att TA BORT
 * ett klockslag — "tomt" och "inte med" hade betytt samma sak.
 *
 * Priset ar att varje anropare maste bara med de andra tva. Det har kostat en
 * bugg per yta som byggts sedan dess:
 *
 *   - 2026-09-11: snabbknapparna "Idag"/"I morgon" i listan och i
 *     egenskapspanelen raderade tyst en tidsuppskattning nagon gjort.
 *   - 2026-09-14: kalendern drar uppgifter till klockslag, och varje drag ar
 *     ett anrop hit. `planeraTill()` i Planeringsvy.tsx bygger darfor alltid
 *     alla tre faltan ur postens NUVARANDE varden och andrar ett av dem.
 *
 * LAGG TILL EN NY KNAPP SOM Ror DATUM? Skicka `due_date`, `due_time` OCH
 * `estimate_minutes`. Alla tre, varje gang.
 *
 * =============================================================================
 * BEHORIGHETEN AR SNAVARE AN `andraUppgift` OCH BREDARE AN INGEN
 *
 * `farPlanera()` och inte `farRedigera()`: 0057 gav kalendern fem delningsnivaer,
 * och nivan "kan planera om" ger exakt det har anropet och inget mer. Den som
 * far stada i en overbokad dag ska inte darmed kunna skriva om rubriken pa
 * nagon annans anteckning.
 * =============================================================================
 */
export async function planera(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { krets, kalenderniva } = await kravKrets(id);
    if (!farPlanera(krets, farPlaneraOm(kalenderniva))) {
      return { fel: "Du får inte planera om den här uppgiften." };
    }

    const due = valfritt(form, "due_date");
    const minuter = text(form, "estimate_minutes");

    const { error } = await supabaseAdmin()
      .from("task")
      .update({
        due_date: due,
        due_time: due ? valfritt(form, "due_time") : null,
        estimate_minutes: minuter ? Number(minuter) : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) return { fel: `Gick inte att planera: ${error.message}` };

    uppdatera(id);
    return { ok: due ? "Planerad." : "Datumet togs bort." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

// =============================================================================
// Driva framåt
// =============================================================================

export async function paborja(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { krets } = await kravKrets(id);
    if (!farArbeta(krets)) return { fel: "Du får inte arbeta med den här uppgiften." };

    await skrivHandelse(id, "paborjad", krets.mig);
    uppdatera(id);
    return { ok: "Igång." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Bocken.
 *
 * EN KNAPP OCH TVA UTFALL, och det ar hela poangen med granskarrollen. Finns en
 * granskare blir bocken en INLAMNING och uppgiften vantar; finns ingen ar den
 * klar direkt. Tva knappar hade tvingat den som bockar att veta vilket som
 * gallde — och det ar uppgiftens sak att veta, inte hennes.
 */
export async function bocka(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { krets, granskare } = await kravKrets(id);
    if (!farArbeta(krets)) return { fel: "Du får inte bocka av den här uppgiften." };

    const lage = await nuvarandeLage(id);
    if (lage === "klar") return { ok: "Redan klar." };
    if (lage === "granskas") return { fel: "Den ligger redan hos granskaren." };

    /**
     * EN GRANSKARE SOM BOCKAR AV SIN EGEN UPPGIFT GODKANNER DEN.
     *
     * Utan den har grenen hamnar hon i en slinga: hon lamnar in till sig sjalv
     * och maste sedan godkanna sig sjalv i ett andra klick. Det ar inte en
     * kontroll, det ar en bekraftelsedialog utstrackt over tva sidladdningar.
     */
    const gransk = granskare.filter((g) => g !== krets.mig);

    if (gransk.length === 0) {
      await skrivHandelse(id, granskare.includes(krets.mig) ? "godkand" : "klar", krets.mig, valfritt(form, "note"));
      uppdatera(id);
      return { ok: "Klar." };
    }

    await skrivHandelse(id, "inlamnad", krets.mig, valfritt(form, "note"));

    /**
     * Ingen notis skrivs har. "Vantar pa MIN bock" ar HARLEDD ur laget
     * (`uppgift-granska` i notiser.ts) och star kvar tills nagon gor nagot at
     * den — en handelsepost hade legat kvar i klockan aven efter godkannandet.
     */
    uppdatera(id);
    return { ok: "Inlämnad för godkännande." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

export async function godkann(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { rad, krets, user } = await kravKrets(id);
    if (!farGranska(krets)) return { fel: "Bara en utpekad granskare kan godkänna." };

    const lage = await nuvarandeLage(id);
    if (lage !== "granskas") return { fel: "Uppgiften väntar inte på ett godkännande." };

    await skrivHandelse(id, "godkand", krets.mig, valfritt(form, "note"));

    /**
     * HANDELSE OCH INTE HARLEDNING — det tydligaste fallet i hela navet.
     *
     * En godkand uppgift ar bara `klar`, omojlig att skilja fran en som den
     * ansvariga bockade av sjalv. Utan den har raden fick den som lamnade in
     * aldrig veta hur det gick, vilket ar precis det 0047 byggdes for.
     */
    if (rad.assignee_id) {
      await notifiera({
        till: rad.assignee_id,
        av: krets.mig,
        kalla: "uppgift-godkand",
        typ: "uppgift",
        rubrik: `Godkänd: ${rad.title}`,
        detalj: `${user.employee!.first_name} godkände`,
        href: `/uppgifter/${id}`,
        objekt: { typ: "task", id },
      });
    }

    uppdatera(id);
    return { ok: "Godkänd." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Returnera med skal.
 *
 * Skalet ar obligatoriskt bade har och i databasen
 * (`task_event_retur_kraver_skal` i 0054). Tva stallen med flit: villkoret
 * gor raden omojlig, meddelandet harinne gor den begriplig.
 *
 * Ingen notis. `uppgift-returnerad` ar HARLEDD ur laget — se notiser.ts.
 */
export async function returnera(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { krets } = await kravKrets(id);
    if (!farGranska(krets)) return { fel: "Bara en utpekad granskare kan returnera." };

    const skal = text(form, "note");
    if (!skal) return { fel: "Skriv varför den skickas tillbaka." };

    const lage = await nuvarandeLage(id);
    if (lage !== "granskas") return { fel: "Uppgiften väntar inte på ett godkännande." };

    await skrivHandelse(id, "returnerad", krets.mig, skal);

    uppdatera(id);
    return { ok: "Returnerad." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

export async function ateroppna(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { krets } = await kravKrets(id);
    if (!farArbeta(krets)) return { fel: "Du får inte öppna den här uppgiften igen." };

    await skrivHandelse(id, "ateroppnad", krets.mig, valfritt(form, "note"));
    uppdatera(id);
    return { ok: "Öppen igen." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

export async function avbryt(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { rad, krets, user } = await kravKrets(id);
    if (!farBjudaIn(krets)) return { fel: "Bara den som la upp uppgiften eller är ansvarig kan avbryta den." };

    const skal = text(form, "note");
    if (!skal) return { fel: "Skriv varför den inte ska göras." };

    await skrivHandelse(id, "avbruten", krets.mig, skal);

    if (rad.assignee_id) {
      await notifiera({
        till: rad.assignee_id,
        av: krets.mig,
        kalla: "uppgift-avbruten",
        typ: "uppgift",
        rubrik: `Avbruten: ${rad.title}`,
        detalj: `${user.employee!.first_name}: ${skal}`,
        href: `/uppgifter/${id}`,
        objekt: { typ: "task", id },
      });
    }

    uppdatera(id);
    return { ok: "Avbruten." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

export async function kommentera(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { rad, krets, user } = await kravKrets(id);

    // ALLA I KRETSEN FAR KOMMENTERA, aven en visare. Det ar hela skillnaden
    // mellan att bjuda in nagon och att skicka en skarmbild — den som bara ska
    // se maste kunna svara, annars flyttar samtalet till chatten igen.
    const skal = text(form, "note");
    if (!skal) return { fel: "Skriv något först." };

    await skrivHandelse(id, "kommentar", krets.mig, skal);

    const { data: medlemmar } = await supabaseAdmin()
      .from("task_member")
      .select("employee_id")
      .eq("task_id", id);

    const kretsIds = [
      rad.assignee_id,
      rad.created_by,
      ...(medlemmar ?? []).map((m) => m.employee_id as string),
    ].filter((x): x is string => Boolean(x));

    await notifieraFlera(kretsIds, {
      av: krets.mig,
      kalla: "uppgift-kommentar",
      typ: "uppgift",
      rubrik: rad.title,
      detalj: `${user.employee!.first_name}: ${skal.slice(0, 120)}`,
      href: `/uppgifter/${id}`,
      objekt: { typ: "task", id },
    });

    uppdatera(id);
    return { ok: "Skickat." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

// =============================================================================
// Kretsen
// =============================================================================

export async function bjudIn(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { rad, krets } = await kravKrets(id);
    if (!farBjudaIn(krets)) return { fel: "Bara den som la upp uppgiften eller är ansvarig kan bjuda in." };

    const person = text(form, "employee_id");
    const roll = text(form, "role") as Medlemsroll;

    if (!person) return { fel: "Välj vem som ska bjudas in." };
    if (!MEDLEMSROLLER.includes(roll)) return { fel: "Okänd roll." };

    // Den ansvariga och den som la upp den ar redan inne. En rad till hade gett
    // en person tva roller i granssnittet och ett svar pa fragan "far hon
    // godkanna" som beror pa vilken rad man laser forst.
    if (person === rad.assignee_id || person === rad.created_by) {
      return { fel: "Personen är redan med i uppgiften." };
    }

    const { error } = await supabaseAdmin()
      .from("task_member")
      .upsert(
        { task_id: id, employee_id: person, role: roll, added_by: krets.mig },
        { onConflict: "task_id,employee_id" },
      );

    if (error) return { fel: `Inbjudan sparades inte: ${error.message}` };

    /**
     * Ingen notis. Att BLI INBJUDEN ar ett tillstand som star kvar sa lange
     * raden finns — uppgiften dyker upp i personens lista i samma sekund, och
     * en granskare far dessutom sin harledda post nar det finns nagot att
     * granska. En handelsepost hade legat kvar i klockan efter att hen redan
     * arbetat i uppgiften i en vecka.
     *
     * =======================================================================
     * DET STYCKET OVAN VAR RIKTIGT OCH PREMISSEN VAR FALSK, 0054 → 2026-09-23
     *
     * Uppgiften dok INTE upp i personens lista. Ingen av vyerna pa /uppgifter
     * fragade efter medlemskap — alla sex filtrerade pa `assignee_id` eller
     * `created_by` — sa den inbjudna fick varken rad, notis eller brev, och
     * enda vagen fram till uppgiften var adressen i klartext. Beskedet "hon
     * ser den direkt" var alltsa skalet till att hon inte fick veta nagot,
     * och ingenting gjorde att det markes.
     *
     * Hallet ar tatat pa ratt stalle: `mittAttGora()` och `delatTillMig()` i
     * `lib/uppgifter.ts` styr numera vyerna, och redigeraren far dessutom sin
     * HARLEDDA `uppgift-ny`-post i `uppgiftsnotiser()`. Darmed star
     * slutsatsen har kvar — men nu pa en premiss som finns.
     *
     * SKRIV INTE EN NOTISRAD HAR. Den skulle bli den enda i modulen som inte
     * kan falla bort av sig sjalv nar arbetet borjat.
     * =======================================================================
     */
    uppdatera(id);
    return { ok: "Inbjuden." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

export async function taBortMedlem(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { krets } = await kravKrets(id);
    if (!farBjudaIn(krets)) return { fel: "Du får inte ändra vilka som är med." };

    const person = text(form, "employee_id");
    if (!person) return { fel: "Vem?" };

    await supabaseAdmin().from("task_member").delete().eq("task_id", id).eq("employee_id", person);

    uppdatera(id);
    return { ok: "Borttagen." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

// =============================================================================
// Kopplingen
// =============================================================================

const KOLUMN: Record<string, string> = {
  order: "order_id",
  arende: "case_id",
  person: "employee_id",
  coachning: "coaching_task_id",
  kurs: "course_id",
  dokument: "document_id",
  kandidat: "candidate_id",
  avtal: "contract_id",
  samtal: "kv_call_id",
};

export async function koppla(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { krets } = await kravKrets(id);
    if (!farRedigera(krets)) return { fel: "Du får inte ändra den här uppgiften." };

    const slag = text(form, "slag");
    const mal = text(form, "mal");
    const kolumn = KOLUMN[slag];

    if (!kolumn) return { fel: "Okänt slag av koppling." };
    if (!mal) return { fel: "Välj vad uppgiften ska kopplas till." };

    /**
     * SYNLIGHETEN GALLER BARA PERSONKOPPLINGEN och ar av som grund.
     *
     * Se rubriken i 0054: en uppgift OM nagon ar en personuppgift aven nar den
     * ar dold, och dold i granssnittet betyder inte dold i registerutdraget.
     * Det omvanda grundlaget — att personen ser raden i samma sekund den
     * skrivs — hade gjort en halvfardig tanke till ett besked.
     */
    const synlig = slag === "person" && form.get("visible_to_subject") === "ja";

    const { error } = await supabaseAdmin()
      .from("task_link")
      .insert({ task_id: id, [kolumn]: mal, visible_to_subject: synlig, created_by: krets.mig });

    // 23505 ar unik-indexet: samma sak kopplad tva ganger ar en dubblett i
    // granssnittet, inte ett fel anvandaren behover se ett felnummer for.
    if (error && error.code !== "23505") return { fel: `Kopplingen sparades inte: ${error.message}` };

    uppdatera(id);
    return { ok: "Kopplad." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

export async function taBortKoppling(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { krets } = await kravKrets(id);
    if (!farRedigera(krets)) return { fel: "Du får inte ändra den här uppgiften." };

    const lank = text(form, "link_id");
    if (!lank) return { fel: "Vilken koppling?" };

    await supabaseAdmin().from("task_link").delete().eq("id", lank).eq("task_id", id);

    uppdatera(id);
    return { ok: "Borttagen." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

// =============================================================================
// Projekten
// =============================================================================

export async function skapaProjekt(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const user = await kravInloggad();
    const mig = user.employee!.id;

    const namn = text(form, "name");
    if (!namn) return { fel: "Ge projektet ett namn." };

    const farg = text(form, "color") || "brand";

    const { data, error } = await supabaseAdmin()
      .from("project")
      .insert({
        name: namn,
        description_md: text(form, "description_md"),
        owner_id: valfritt(form, "owner_id") ?? mig,
        created_by: mig,
        color: farg,
        due_date: valfritt(form, "due_date"),
      })
      .select("id")
      .single();

    if (error || !data) return { fel: `Projektet sparades inte: ${error?.message ?? "okänt fel"}` };

    revalidatePath("/uppgifter");
    return { ok: "Projektet finns.", id: data.id as string };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

export async function arkiveraProjekt(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const user = await kravInloggad();
    const mig = user.employee!.id;
    const id = text(form, "id");

    const db = supabaseAdmin();
    const { data: projekt } = await db.from("project").select("owner_id, created_by").eq("id", id).maybeSingle();

    if (!projekt) return { fel: "Projektet finns inte." };
    if (projekt.owner_id !== mig && projekt.created_by !== mig) {
      return { fel: "Bara ägaren kan arkivera projektet." };
    }

    const aterstall = form.get("aterstall") === "ja";

    /**
     * ARKIVERING TAR INTE BORT UPPGIFTERNA. De ligger kvar med sin
     * `project_id`, och det ar med flit: ett arkiverat projekt vars uppgifter
     * tappat sin hatt gar inte att plocka fram igen, och da ar "arkivera" bara
     * ett langsammare ord for radera.
     */
    await db
      .from("project")
      .update({ archived_at: aterstall ? null : new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id);

    revalidatePath("/uppgifter");
    return { ok: aterstall ? "Framplockat." : "Arkiverat." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Ändra projektet.
 *
 * ÄGAREN ELLER SKAPAREN, ingen annan — samma krets som arkiveringen. En
 * redigerare i projektet ändrar UPPGIFTERNA i det; att låta hen byta namn,
 * ägare och deadline på hatten hade betytt att den som bjöd in någon för att
 * hjälpa till också gav bort projektet.
 */
export async function andraProjekt(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const user = await kravInloggad();
    const mig = user.employee!.id;
    const id = text(form, "id");

    const db = supabaseAdmin();
    const { data: projekt } = await db.from("project").select("owner_id, created_by").eq("id", id).maybeSingle();

    if (!projekt) return { fel: "Projektet finns inte." };
    if (projekt.owner_id !== mig && projekt.created_by !== mig) {
      return { fel: "Bara ägaren kan ändra projektet." };
    }

    const namn = text(form, "name");
    if (!namn) return { fel: "Ge projektet ett namn." };

    const { error } = await db
      .from("project")
      .update({
        name: namn,
        description_md: text(form, "description_md"),
        color: text(form, "color") || "brand",
        due_date: valfritt(form, "due_date"),
        owner_id: valfritt(form, "owner_id") ?? projekt.owner_id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) return { fel: `Ändringen sparades inte: ${error.message}` };

    revalidatePath("/uppgifter");
    revalidatePath(`/uppgifter/projekt/${id}`);
    return { ok: "Sparat." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Bjud in till projektet.
 *
 * TVÅ ROLLER OCH INGEN GRANSKARE. Det är uppgifterna som godkänns, inte hatten
 * — se `project_member` i 0054. En projektmedlem ser projektets sida; vilka
 * UPPGIFTER hen ser avgörs fortfarande av varje uppgifts egen krets, och det är
 * med flit: att bli inbjuden till "Mässan" ska inte öppna någons anteckningar
 * om mässan.
 */
export async function bjudInProjekt(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const user = await kravInloggad();
    const mig = user.employee!.id;
    const id = text(form, "id");

    const db = supabaseAdmin();
    const { data: projekt } = await db.from("project").select("owner_id, created_by").eq("id", id).maybeSingle();

    if (!projekt) return { fel: "Projektet finns inte." };
    if (projekt.owner_id !== mig && projekt.created_by !== mig) {
      return { fel: "Bara ägaren kan bjuda in till projektet." };
    }

    const person = text(form, "employee_id");
    const roll = text(form, "role");

    if (!person) return { fel: "Välj vem som ska bjudas in." };
    if (roll !== "redigerare" && roll !== "visare") return { fel: "Okänd roll." };
    if (person === projekt.owner_id) return { fel: "Ägaren är redan med." };

    const { error } = await db
      .from("project_member")
      .upsert(
        { project_id: id, employee_id: person, role: roll, added_by: mig },
        { onConflict: "project_id,employee_id" },
      );

    if (error) return { fel: `Inbjudan sparades inte: ${error.message}` };

    revalidatePath(`/uppgifter/projekt/${id}`);
    return { ok: "Inbjuden." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

export async function taBortProjektmedlem(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const user = await kravInloggad();
    const mig = user.employee!.id;
    const id = text(form, "id");

    const db = supabaseAdmin();
    const { data: projekt } = await db.from("project").select("owner_id, created_by").eq("id", id).maybeSingle();

    if (!projekt) return { fel: "Projektet finns inte." };
    if (projekt.owner_id !== mig && projekt.created_by !== mig) {
      return { fel: "Du får inte ändra vilka som är med." };
    }

    const person = text(form, "employee_id");
    if (!person) return { fel: "Vem?" };

    await db.from("project_member").delete().eq("project_id", id).eq("employee_id", person);

    revalidatePath(`/uppgifter/projekt/${id}`);
    return { ok: "Borttagen." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

// =============================================================================
// Projektchatten (0055)
// =============================================================================

/**
 * Vem som far skriva i ett projekts chatt.
 *
 * AGAREN, SKAPAREN OCH REDIGERARNA. En `visare` far lasa men inte skriva —
 * det ar samma grans som rollen betyder overallt annars i modulen, och en
 * chatt dar alla som fatt en lank kan skriva ar inte langre projektets.
 */
async function kravChattkrets(projektId: string) {
  const user = await kravInloggad();
  const mig = user.employee!.id;
  const db = supabaseAdmin();

  const [{ data: projekt }, { data: medlemmar }] = await Promise.all([
    db.from("project").select("id, name, owner_id, created_by").eq("id", projektId).maybeSingle(),
    db.from("project_member").select("employee_id, role").eq("project_id", projektId),
  ]);

  if (!projekt) throw new Error("Projektet finns inte.");

  const min = (medlemmar ?? []).find((m) => m.employee_id === mig);
  const ser = projekt.owner_id === mig || projekt.created_by === mig || Boolean(min);

  // Samma linje som `kravKrets()`: den som inte ser raden far inte heller veta
  // att den finns.
  if (!ser) throw new Error("Projektet finns inte.");

  return {
    user,
    mig,
    projekt: projekt as { id: string; name: string; owner_id: string; created_by: string },
    medlemmar: (medlemmar ?? []) as { employee_id: string; role: string }[],
    farSkriva: projekt.owner_id === mig || projekt.created_by === mig || min?.role === "redigerare",
  };
}

export async function skrivProjektmeddelande(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { mig, farSkriva } = await kravChattkrets(id);

    if (!farSkriva) return { fel: "Du kan läsa samtalet men inte skriva i det." };

    const kropp = text(form, "body");
    if (!kropp) return { fel: "Skriv något först." };
    if (kropp.length > 4000) return { fel: "Repliken får vara högst 4000 tecken." };

    const { error } = await supabaseAdmin()
      .from("project_message")
      .insert({ project_id: id, author_id: mig, body: kropp });

    if (error) return { fel: `Repliken sparades inte: ${error.message}` };

    /**
     * INGEN NOTIS SKRIVS HAR.
     *
     * Olast raknas fram ur `project_message_read` — se `projektchattnotiser()`
     * i uppgifter-server.ts. Tio repliker i samma projekt blir da EN post med
     * en raknare i stallet for tio rader i klockan, och posten forsvinner av
     * sig sjalv nar mottagaren last traden.
     *
     * En handelsepost per replik hade dessutom legat kvar efter lasningen, och
     * en chatt vars notiser maste klickas bort en och en ar en chatt folk
     * stanger av.
     */
    revalidatePath(`/uppgifter/projekt/${id}`);
    return { ok: "Skickat." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * "Jag har last traden."
 *
 * Tar ett id och inte ett FormData: den anropas fran en effekt i
 * `Projektchatt.tsx` och inte fran ett formular, och ett pahittat FormData
 * bara for att matcha de andra hade varit ceremoni.
 *
 * SKRIVER ALLTID NU, aven om raden redan finns — `upsert` pa nyckeln. Att
 * hoppa over skrivningen nar tidpunkten redan ar satt hade betytt att den
 * forsta lasningen var den enda som raknades.
 */
export async function markeraProjektchattLast(projektId: string): Promise<void> {
  try {
    if (!projektId) return;
    const { mig } = await kravChattkrets(projektId);

    await supabaseAdmin()
      .from("project_message_read")
      .upsert(
        { project_id: projektId, employee_id: mig, seen_at: new Date().toISOString() },
        { onConflict: "project_id,employee_id" },
      );
  } catch {
    // Tyst. En misslyckad lasmarkering ska inte fella en sida som redan
    // renderats — foljden ar att notisen star kvar en stund till.
  }
}
