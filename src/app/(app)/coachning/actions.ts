"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import {
  UPPGIFTSTYPER,
  KVITTERARE,
  BEVIS,
  TYP_KRAVER_KALLA,
  arSjalvsann,
  bevisSaknas,
  laggTill,
  farAvbryta,
  farKvittera,
  type Bevis,
  type Kvitterare,
  type Uppgiftstyp,
} from "@/lib/coachning";
import { arChefFor, farCoacha } from "@/lib/coachning-server";

export type CoachState = { fel?: string; ok?: string };

/**
 * Coachningsmodulens skrivningar.
 *
 * SKRIVNING GAR VIA SERVICE ROLE OCH FORBI RLS (D-T1), sa kontrollerna harinne
 * ar de enda som finns. Databasens check-villkor och triggern i 0043 star kvar
 * som ett andra lager — men de svarar pa fragan "ar raden mojlig", inte pa
 * "far den har personen skriva den".
 */

async function kravInloggad() {
  const user = await getCurrentUser();
  if (!user?.employee) throw new Error("Du måste vara inloggad.");
  return user;
}

/**
 * Vem som far LAGGA UPP en uppgift. Bestallarens beslut 2026-09-01: teamledare,
 * saljchef och VD. Ingen peer-coachning i fas 1.
 */
async function kravCoach() {
  const user = await kravInloggad();
  if (!farCoacha(user)) throw new Error("Bara teamledare, säljchef och VD lägger upp coachningsuppgifter.");
  return user;
}

function text(form: FormData, namn: string): string {
  return String(form.get(namn) ?? "").trim();
}

// -----------------------------------------------------------------------------

export async function skapaUppgift(_prev: CoachState, form: FormData): Promise<CoachState> {
  try {
    const user = await kravCoach();
    const db = supabaseAdmin();

    const assignee = text(form, "assignee_id");
    const titel = text(form, "title");
    const kind = text(form, "kind") as Uppgiftstyp;
    const verifyBy = (text(form, "verify_by") || "sjalv") as Kvitterare;
    const evidence = (text(form, "evidence") || "ingen") as Bevis;
    const partner = text(form, "partner_id") || null;
    const due = text(form, "due_date") || null;

    if (!assignee) return { fel: "Välj vem uppgiften gäller." };
    if (!titel) return { fel: "Skriv en rubrik." };
    if (!UPPGIFTSTYPER.includes(kind)) return { fel: "Okänd uppgiftstyp." };
    if (!KVITTERARE.includes(verifyBy)) return { fel: "Okänd kvitterare." };
    if (!BEVIS.includes(evidence)) return { fel: "Okänt beviskrav." };

    /**
     * TEAMLEDAREN LAGGER UPP AT SITT EGET FOLK, INTE AT VEM SOM HELST.
     *
     * RLS slapper igenom LASNINGEN av hela registret for en teamledare i vissa
     * lagen, sa utan den har raden hade hon kunnat posta ett assignee_id fran
     * ett annat team rakt in i formularet. Ledningen star utanfor kontrollen —
     * `arChefFor` svarar ja for dem overallt, vilket ar samma krets som
     * `can_read_all_employees()` i RLS.
     */
    if (!(await arChefFor(user, assignee))) {
      return { fel: "Du kan bara lägga upp uppgifter för personer du är chef för." };
    }

    if (partner === assignee) return { fel: "Motparten kan inte vara samma person som uppgiften gäller." };
    if (verifyBy === "motpart" && !partner) return { fel: "Välj en motpart, eller låt någon annan kvittera." };

    // Speglar `coaching_task_kalla` i 0043. Kontrollen star har OCKSA for att
    // felmeddelandet ska namna vad som saknas i stallet for ett villkorsnamn.
    const kravs = TYP_KRAVER_KALLA[kind];
    const course = text(form, "course_id") || null;
    const modul = text(form, "module_id") || null;
    const dokument = text(form, "document_id") || null;

    if (kravs === "course_id" && !course) return { fel: "Välj vilken kurs uppgiften gäller." };
    if (kravs === "module_id" && !modul) return { fel: "Välj vilken rollspelsmodul uppgiften gäller." };
    if (kravs === "document_id" && !dokument) return { fel: "Välj vilket dokument som ska läsas." };

    // En sjalvsann typ med en annan kvitterare an `sjalv` lovar en bock som
    // triggern i 0043 aldrig slapper igenom.
    if (arSjalvsann(kind) && verifyBy !== "sjalv") {
      return { fel: "Den här uppgiftstypen kvitteras inte för hand — läget hämtas ur certifikatet, bedömningen eller kvittensen." };
    }

    const { data: rad, error } = await db
      .from("coaching_task")
      .insert({
        title: titel,
        description_md: text(form, "description_md"),
        kind,
        assignee_id: assignee,
        partner_id: partner,
        created_by: user.employee!.id,
        verify_by: verifyBy,
        evidence,
        course_id: kravs === "course_id" ? course : null,
        module_id: kravs === "module_id" ? modul : null,
        document_id: kravs === "document_id" ? dokument : null,
        starts_on: text(form, "starts_on") || null,
        due_date: due,
      })
      .select("id")
      .single();

    if (error || !rad) return { fel: `Uppgiften sparades inte: ${error?.message ?? "okänt fel"}` };

    const fokus = form.getAll("focus_id").map(String).filter(Boolean);
    if (fokus.length > 0) {
      await db.from("coaching_task_focus").insert(fokus.map((f) => ({ task_id: rad.id, focus_id: f })));
    }

    /**
     * `tilldelad` skrivs som en handelse och inte bara som en rad i tabellen.
     * Skalet ar att historiken ska ga att lasa som en historik: utan den star
     * det "ingenting hant" pa en uppgift som nagon faktiskt lade upp i gar.
     *
     * Den raknas daremot INTE som coachning i lagvyn — se `RAKNAS_SOM_COACHNING`.
     */
    await db.from("coaching_task_event").insert({
      task_id: rad.id,
      type: "tilldelad",
      by_employee_id: user.employee!.id,
    });

    await db.from("audit_log").insert({
      actor_id: user.employee!.id,
      action: "coaching_task.created",
      object_type: "coaching_task",
      object_id: rad.id,
      meta: { assignee_id: assignee, kind, due_date: due },
    });

    revalidatePath("/coachning");
    revalidatePath(`/coachning/${assignee}`);
    return { ok: `Uppgiften "${titel}" är upplagd.` };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

// -----------------------------------------------------------------------------

/** Hamtar uppgiften och svarar pa om betraktaren ar chef over den ansvariga. */
async function laddaFor(taskId: string) {
  const user = await kravInloggad();
  const db = supabaseAdmin();
  const { data } = await db
    .from("coaching_task")
    .select("id, kind, assignee_id, partner_id, created_by, verify_by, evidence, due_date, cancelled_at")
    .eq("id", taskId)
    .maybeSingle();

  if (!data) throw new Error("Uppgiften finns inte.");
  return { user, db, uppgift: data, arChef: await arChefFor(user, data.assignee_id) };
}

/**
 * Markerar uppgiften som paborjad.
 *
 * CHEFEN FAR OCKSA TRYCKA, sedan 2026-09-02. Fram till dess var knappen
 * ansvarigs ensam, och det gav en kö som ljog: en teamledare som gjort ett
 * live-rollspel med nagon vid skrivbordet kunde inte anteckna att arbetet var
 * igang, sa uppgiften stod kvar som "Ej påbörjad" tills saljaren rakade oppna
 * navet och trycka pa en knapp om nagot som redan hant.
 *
 * DET AR INTE SAMMA SAK SOM ATT KVITTERA, och gransen ar avsiktlig. "Paborjad"
 * ar en anteckning om att nagot har borjat; en kvittering ar ett pastaende om
 * att det ar GJORT. Chefen far det forsta och aldrig det andra at nagon annan —
 * se `farKvittera()`, dar `verify_by = 'sjalv'` haller ute aven chefen.
 *
 * Loggen bar VEM som tryckte (`by_employee_id`), sa uppgiftssidan skriver ut
 * "Påbörjad av Anna" och inte bara "Påbörjad". Utan det hade chefens anteckning
 * sett ut som saljarens egen.
 */
export async function paborjaUppgift(_prev: CoachState, form: FormData): Promise<CoachState> {
  try {
    const id = text(form, "task_id");
    const { user, db, uppgift, arChef } = await laddaFor(id);

    if (user.employee!.id !== uppgift.assignee_id && !arChef) {
      return { fel: "Bara den uppgiften gäller eller dennes chef kan markera den som påbörjad." };
    }
    if (uppgift.cancelled_at) return { fel: "Uppgiften är avbruten." };

    /**
     * En gang, inte tva.
     *
     * Knappen visas bara pa `ej_paborjad`, men nu kan TVA personer se den
     * samtidigt — saljaren pa sin telefon och chefen vid sitt skrivbord. Utan
     * den har fragan hade bada kunnat trycka och loggen fatt tva
     * `paborjad`-rader med olika avsandare, och da svarar historiken tvetydigt
     * pa vem som antecknade att arbetet borjade.
     *
     * Svaret ar `ok` och inte `fel`: den som trycker har fatt det den ville ha.
     */
    const { data: redanIgang } = await db
      .from("coaching_task_event")
      .select("id")
      .eq("task_id", id)
      .eq("type", "paborjad")
      .limit(1);

    if ((redanIgang ?? []).length > 0) {
      return { ok: "Uppgiften är redan markerad som påbörjad." };
    }

    await db.from("coaching_task_event").insert({
      task_id: id,
      type: "paborjad",
      by_employee_id: user.employee!.id,
    });

    /**
     * LAGVYN MASTE MED, sedan 2026-09-02.
     *
     * Fram till dess visade `/coachning` bara ett ANTAL oppna uppgifter per
     * person, och det antalet andras inte av att nagon paborjar en. Nu star
     * uppgifternas lage pa personkorten, sa en sida som inte rensas visar
     * "Ej påbörjad" bredvid en uppgift som ar igang.
     */
    revalidatePath("/coachning");
    revalidatePath(`/coachning/uppgift/${id}`);
    revalidatePath(`/coachning/${uppgift.assignee_id}`);
    return { ok: "Markerad som påbörjad." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Lamnar in for nagon annans kvittering.
 *
 * Steget finns bara nar NAGON ANNAN ska kvittera. Ar `verify_by = 'sjalv'` ar
 * inlamning och kvittering samma handling, och tva knappar for en handling hade
 * bara gjort kon langre.
 */
export async function lamnaIn(_prev: CoachState, form: FormData): Promise<CoachState> {
  try {
    const id = text(form, "task_id");
    const { user, db, uppgift } = await laddaFor(id);

    if (user.employee!.id !== uppgift.assignee_id) {
      return { fel: "Bara den uppgiften gäller kan lämna in den." };
    }
    if (uppgift.cancelled_at) return { fel: "Uppgiften är avbruten." };
    if (uppgift.verify_by === "sjalv") return { fel: "Den här uppgiften kvitterar du själv." };

    const kommentar = text(form, "note") || null;
    const saknas = bevisSaknas(uppgift.evidence as Bevis, { kommentar, fil_id: null });
    if (saknas) return { fel: saknas };

    await db.from("coaching_task_event").insert({
      task_id: id,
      type: "inlamnad",
      by_employee_id: user.employee!.id,
      note: kommentar,
    });

    // Samma skal som i `paborjaUppgift`, och skarpare har: en inlamning ar
    // just det lagvyn ska lyfta som "vantar pa din bock".
    revalidatePath("/coachning");
    revalidatePath(`/coachning/uppgift/${id}`);
    revalidatePath(`/coachning/${uppgift.assignee_id}`);
    return { ok: "Inlämnad. Väntar på kvittering." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Kvitterar eller underkanner.
 *
 * TVA UTFALL I EN ACTION, med flit. Godkant och underkant ar samma handling
 * utford av samma person med samma behorighet — tva actions hade betytt tva
 * stallen att halla `farKvittera()` lika pa.
 */
export async function kvittera(_prev: CoachState, form: FormData): Promise<CoachState> {
  try {
    const id = text(form, "task_id");
    const godkanns = text(form, "utfall") !== "underkand";
    const { user, db, uppgift, arChef } = await laddaFor(id);

    if (!farKvittera(uppgift as never, user.employee!.id, arChef)) {
      return {
        fel: arSjalvsann(uppgift.kind as Uppgiftstyp)
          ? "Den här uppgiften kvitteras inte för hand — läget hämtas ur certifikatet, bedömningen eller kvittensen."
          : "Du får inte kvittera den här uppgiften.",
      };
    }

    const kommentar = text(form, "note") || null;

    // Beviskravet galler den som GOR uppgiften, inte den som underkanner den.
    // En underkannande utan motivering ar daremot varre an ingen alls, sa den
    // kraver alltid en kommentar.
    if (godkanns) {
      const saknas = bevisSaknas(uppgift.evidence as Bevis, { kommentar, fil_id: null });
      if (saknas) return { fel: saknas };
    } else if (!kommentar) {
      return { fel: "Skriv vad som saknades. En underkänd uppgift utan motivering går inte att göra om." };
    }

    const { error } = await db.from("coaching_task_event").insert({
      task_id: id,
      type: godkanns ? "kvitterad" : "underkand",
      by_employee_id: user.employee!.id,
      note: kommentar,
    });

    // Triggern i 0043 ar den som faktiskt vaktar de sjalvsanna typerna. Faller
    // den har ar det den som talat, och dess text ar battre an var egen.
    if (error) return { fel: error.message };

    await db.from("audit_log").insert({
      actor_id: user.employee!.id,
      action: godkanns ? "coaching_task.completed" : "coaching_task.rejected",
      object_type: "coaching_task",
      object_id: id,
      meta: { assignee_id: uppgift.assignee_id, kind: uppgift.kind },
    });

    revalidatePath("/coachning");
    revalidatePath(`/coachning/uppgift/${id}`);
    revalidatePath(`/coachning/${uppgift.assignee_id}`);
    return { ok: godkanns ? "Kvitterad." : "Underkänd. Personen får en notis." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * NODUTGANGEN. Se `farAvbryta()` i coachning.ts: chefen far avbryta men aldrig
 * godkanna at nagon annan. Ett avbrott ar arligt, en kvittering i nagon annans
 * namn ar det inte.
 */
export async function avbrytUppgift(_prev: CoachState, form: FormData): Promise<CoachState> {
  try {
    const id = text(form, "task_id");
    const { user, db, uppgift, arChef } = await laddaFor(id);

    if (!farAvbryta(uppgift as never, user.employee!.id, arChef)) {
      return { fel: "Du får inte avbryta den här uppgiften." };
    }

    const skal = text(form, "reason");
    if (!skal) return { fel: "Skriv varför uppgiften avbryts." };

    const nu = new Date().toISOString();
    const { error } = await db
      .from("coaching_task")
      .update({ cancelled_at: nu, cancelled_by: user.employee!.id, cancel_reason: skal })
      .eq("id", id);

    if (error) return { fel: `Uppgiften avbröts inte: ${error.message}` };

    await db.from("coaching_task_event").insert({
      task_id: id,
      type: "avbruten",
      by_employee_id: user.employee!.id,
      note: skal,
    });

    await db.from("audit_log").insert({
      actor_id: user.employee!.id,
      action: "coaching_task.cancelled",
      object_type: "coaching_task",
      object_id: id,
      meta: { assignee_id: uppgift.assignee_id, reason: skal },
    });

    revalidatePath("/coachning");
    revalidatePath(`/coachning/uppgift/${id}`);
    revalidatePath(`/coachning/${uppgift.assignee_id}`);
    return { ok: "Uppgiften är avbruten." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

// -----------------------------------------------------------------------------
// U4. Coachningssamtalet (GROW)
// -----------------------------------------------------------------------------

/**
 * Sparar ett coachningssamtal och gor atagandena till riktiga uppgifter.
 *
 * ===========================================================================
 * DET FJARDE FALTET AR HELA POANGEN
 *
 * G, R och O — mal, lage, alternativ — ar anteckningar. W, atagandet, blir
 * UPPGIFTER med ansvarig och datum. Det ar skillnaden mellan ett protokoll och
 * en anteckningsbok, och underlaget ar entydigt pa punkten: nar atagandena inte
 * foljs upp lar sig den som coachas att coachningen ar frivillig.
 *
 * Atagandena skrivs som text, ett per rad, med valfritt antal dagar efter ett
 * lodstreck — samma idiom som mallarna och quizfragorna.
 *
 *   Ring tio bolag med den nya oppningen | 7
 *   Lyssna igenom tisdagens samtal | 3
 * ===========================================================================
 *
 * SAMTALET AR LASBART FOR DEN DET GALLER. Inga privata chefsanteckningar — se
 * laspolicyn pa `coaching_session` i 0043.
 */
export async function skapaSamtal(_prev: CoachState, form: FormData): Promise<CoachState> {
  try {
    const user = await kravCoach();
    const db = supabaseAdmin();

    const employeeId = text(form, "employee_id");
    if (!employeeId) return { fel: "Välj vem samtalet gäller." };
    if (employeeId === user.employee!.id) return { fel: "Ett coachningssamtal förs med någon annan." };
    if (!(await arChefFor(user, employeeId))) {
      return { fel: "Du kan bara föra samtal med personer du är chef för." };
    }

    const hallet = text(form, "held_on");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(hallet)) return { fel: "Datumet är inte giltigt." };

    // Ett samtal som inte agt rum ar inte ett protokoll utan en plan. Samma
    // gransdragning som K&V-samtalen gor.
    const idag = new Date().toISOString().slice(0, 10);
    if (hallet > idag) return { fel: "Samtalet kan inte ligga i framtiden." };

    const goal = text(form, "goal_md");
    const reality = text(form, "reality_md");
    const options = text(form, "options_md");
    const will = text(form, "will_md");

    if (!goal && !reality && !options && !will) return { fel: "Skriv något i protokollet." };

    // Atagandena tolkas FORE samtalet sparas. Ett fel i en rad ska inte lamna
    // efter sig ett samtal utan atagandena det handlade om.
    const atagandeText = text(form, "atagande");
    const ataganden: { title: string; dagar: number }[] = [];
    for (const [i, rad] of atagandeText.split("\n").map((r) => r.trim()).filter(Boolean).entries()) {
      const [titel, dagartext] = rad.split("|").map((d) => d.trim());
      if (!titel) return { fel: `Åtagande ${i + 1} saknar text.` };
      let dagar = 7;
      if (dagartext) {
        const tal = Number(dagartext);
        if (!Number.isInteger(tal) || tal < 0 || tal > 365) {
          return { fel: `Åtagande ${i + 1}: dagarna ska vara ett heltal mellan 0 och 365.` };
        }
        dagar = tal;
      }
      ataganden.push({ title: titel, dagar });
    }

    const { data: samtal, error } = await db
      .from("coaching_session")
      .insert({
        employee_id: employeeId,
        coach_id: user.employee!.id,
        created_by: user.employee!.id,
        held_on: hallet,
        goal_md: goal,
        reality_md: reality,
        options_md: options,
        will_md: will,
      })
      .select("id")
      .single();

    if (error || !samtal) return { fel: `Samtalet sparades inte: ${error?.message ?? "okänt fel"}` };

    if (ataganden.length > 0) {
      const ids = ataganden.map(() => crypto.randomUUID());
      const { error: uppgiftsfel } = await db.from("coaching_task").insert(
        ataganden.map((a, i) => ({
          id: ids[i],
          title: a.title,
          kind: "uppgift",
          assignee_id: employeeId,
          created_by: user.employee!.id,
          // Atagandet ar personens eget. Att lata chefen godkanna det hon sjalv
          // lovade att gora hade gjort atagandet till en order.
          verify_by: "sjalv",
          session_id: samtal.id,
          starts_on: hallet,
          due_date: laggTill(hallet, a.dagar),
        })),
      );

      if (uppgiftsfel) return { fel: `Samtalet sparades men åtagandena gjorde det inte: ${uppgiftsfel.message}` };

      await db
        .from("coaching_task_event")
        .insert(ids.map((id) => ({ task_id: id, type: "tilldelad", by_employee_id: user.employee!.id })));
    }

    await db.from("audit_log").insert({
      actor_id: user.employee!.id,
      action: "coaching_session.created",
      object_type: "coaching_session",
      object_id: samtal.id,
      meta: { employee_id: employeeId, held_on: hallet, ataganden: ataganden.length },
    });

    revalidatePath("/coachning");
    revalidatePath(`/coachning/${employeeId}`);
    return {
      ok:
        ataganden.length > 0
          ? `Samtalet är sparat och ${ataganden.length} åtagande${ataganden.length === 1 ? "" : "n"} lades upp som uppgifter.`
          : "Samtalet är sparat.",
    };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}
