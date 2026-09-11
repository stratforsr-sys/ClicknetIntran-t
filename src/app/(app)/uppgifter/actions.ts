"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";
import {
  MEDLEMSROLLER,
  PRIORITETER,
  farArbeta,
  farBjudaIn,
  farGranska,
  farRedigera,
  lageAv,
  tolkaSnabbrad,
  type Handelsetyp,
  type Krets,
  type Medlemsroll,
  type Prioritet,
} from "@/lib/uppgifter";
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

  const krets: Krets = {
    mig,
    assignee_id: (rad as Rad).assignee_id,
    created_by: (rad as Rad).created_by,
    minRoll,
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
    (await serViaForalder(db, (rad as Rad).parent_id, mig));

  if (!ser) throw new Error("Uppgiften finns inte.");

  return {
    user,
    rad: rad as Rad,
    krets,
    granskare: (medlemmar ?? []).filter((m) => m.role === "granskare").map((m) => m.employee_id as string),
  };
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

export async function andraUppgift(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { krets } = await kravKrets(id);
    if (!farRedigera(krets)) return { fel: "Du får inte ändra den här uppgiften." };

    const titel = text(form, "title");
    if (!titel) return { fel: "Rubriken kan inte vara tom." };

    const due = valfritt(form, "due_date");
    const prioritet = Number(text(form, "priority") || "3");

    const { error } = await supabaseAdmin()
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
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) return { fel: `Ändringen sparades inte: ${error.message}` };

    uppdatera(id);
    return { ok: "Sparat." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
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
 * Finns for att vara den ENDA vagen som pass 2:s kalender behover: att dra en
 * uppgift till en tid ar precis det har anropet. Den star med redan nu sa att
 * planeringen gar att gora fran listan innan kalendern finns.
 */
export async function planera(_prev: UppgiftState, form: FormData): Promise<UppgiftState> {
  try {
    const id = text(form, "id");
    const { krets } = await kravKrets(id);
    if (!farRedigera(krets)) return { fel: "Du får inte ändra den här uppgiften." };

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
