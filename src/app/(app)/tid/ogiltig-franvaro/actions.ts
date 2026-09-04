"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";
import { manadsnamn } from "@/lib/provision";
import { frist } from "@/lib/arenden";
import {
  MINSTA_MINUTER,
  manadFor,
  trappstegFor,
  type Handelse,
  type Konsekvensregel,
} from "@/lib/konsekvens";
import { notifiera } from "@/lib/notishandelse-server";

export type Handelsestate = { fel?: string; ok?: string; varning?: string };

/**
 * E13 steg 6: besluten om en ogiltig franvaro.
 *
 * ===========================================================================
 * TVA STEG, ALLTID. Motorn FORESLAR, en manniska BESLUTAR.
 *
 * Navet kan inte se skillnad pa "kom inte" och "var har men glomde stampla".
 * Bestallarens svar pa O15 var att den som varit har raknas ALDRIG, och den
 * enda som vet vilket det var ar chefen. Darfor finns det ingen vag i den har
 * filen som gor en handelse godkand utan att en inloggad manniska tryckt.
 *
 * Det ar ocksa vad som haller D-K12:s linje: sen ankomst nar inte provisionen,
 * for en sen ankomst blir aldrig ens ett forslag (se `uteblivenInstampling`).
 * ===========================================================================
 */

async function kravInloggad(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user?.employee) throw new Error("Du måste vara inloggad.");
  return user;
}

/**
 * Far den inloggade besluta om just den har personen?
 *
 * ===========================================================================
 * FRAGAN STALLS TILL DATABASEN, inte till en kopia av regeln har.
 *
 * `far_godkanna_franvaro_for(uuid)` i 0037 ar den enda definitionen: sales_manager
 * och ceo far besluta om alla, den som har behorigheten `attendance_approver`
 * far besluta om sitt EGET team och ingen annans. Samma funktion star i
 * RLS-policyn som avgor vad chefen ser.
 *
 * Skrivs regeln av har i TypeScript blir det tva definitioner, och den dagen de
 * glider isar ser sidan ut att fungera medan den slapper igenom fel person.
 * Anropet gar med ANVANDARENS EGEN TOKEN — funktionen ar `security definer` och
 * laser `current_employee_id()` ur sessionen, sa ett argument gar inte att ljuga
 * med.
 * ===========================================================================
 */
async function farBesluta(mal: string): Promise<boolean> {
  const rls = await supabaseServer();
  const { data, error } = await rls.rpc("far_godkanna_franvaro_for", { mal });
  if (error) return false;
  return data === true;
}

async function kravBeslutare(mal: string): Promise<CurrentUser> {
  const user = await kravInloggad();
  if (!(await farBesluta(mal))) {
    throw new Error("Du får inte besluta om den här personens frånvaro.");
  }
  return user;
}

async function hamtaRad(id: string) {
  const { data } = await supabaseAdmin()
    .from("attendance_incident")
    .select("id, employee_id, occurred_on, minutes, status")
    .eq("id", id)
    .maybeSingle();
  return data;
}

async function logga(
  user: CurrentUser,
  action: string,
  id: string,
  meta: Record<string, unknown>,
) {
  await supabaseAdmin().from("audit_log").insert({
    actor_id: user.employee!.id,
    action,
    object_type: "attendance_incident",
    object_id: id,
    meta,
  });
}

function uppdatera() {
  revalidatePath("/tid/ogiltig-franvaro");
  revalidatePath("/provision");
  revalidatePath("/");
}

/**
 * Godkanner ett forslag: chefen intygar att personen faktiskt inte var pa plats.
 *
 * Det ar HAR trappsteget bestams, och det FRYSES pa raden. Samma modell som
 * provisionssatsen pa ordern (0034): andras trappan i morgon behaller garden
 * handelse sin atgard. Utan frysningen hade en ny regel skrivit om vad som
 * redan drabbat nagon.
 */
export async function godkannHandelse(
  _prev: Handelsestate,
  form: FormData,
): Promise<Handelsestate> {
  try {
    const id = String(form.get("id") ?? "").trim();
    const rad = await hamtaRad(id);
    if (!rad) return { fel: "Händelsen finns inte." };
    if (rad.status !== "foreslagen") return { fel: "Händelsen är redan beslutad." };

    const user = await kravBeslutare(String(rad.employee_id));
    const db = supabaseAdmin();
    const dag = String(rad.occurred_on).slice(0, 10);

    // Trappan och personens tidigare GODKANDA handelser. Den som beslutas nu
    // star inte med — `trappstegFor` raknar den som en, sjalv.
    const [{ data: regler }, { data: tidigare }] = await Promise.all([
      db
        .from("consequence_rule")
        .select("id, ordning, antal_handelser, periodlangd_manader, atgard, omfattning, notifiera")
        .order("ordning"),
      db
        .from("attendance_incident")
        .select("id, employee_id, occurred_on, minutes, status, ordningsnummer, atgard, period_month")
        .eq("employee_id", rad.employee_id)
        .eq("status", "godkand"),
    ]);

    const steg = trappstegFor(
      (regler ?? []) as Konsekvensregel[],
      ((tidigare ?? []) as unknown as Handelse[]).map((h) => ({
        ...h,
        occurred_on: String(h.occurred_on).slice(0, 10),
      })),
      dag,
    );

    if (!steg) {
      return {
        fel:
          "Konsekvenstrappan är tom eller når inte första steget. Fyll i den under" +
          " Provision → Regler innan händelser godkänns.",
      };
    }

    const manad = manadFor({ occurred_on: dag });

    const { error } = await db
      .from("attendance_incident")
      .update({
        status: "godkand",
        decided_by: user.employee!.id,
        decided_at: new Date().toISOString(),
        decision_note: String(form.get("anteckning") ?? "").trim() || null,
        rule_id: steg.id,
        ordningsnummer: steg.ordning,
        atgard: steg.atgard,
        period_month: manad,
      })
      .eq("id", id)
      .eq("status", "foreslagen");

    if (error) return { fel: `Händelsen godkändes inte: ${error.message}` };

    if (steg.atgard === "arende") await skapaArende(db, user, String(rad.employee_id), id, dag);

    await logga(user, "attendance_incident.approved", id, {
      employee_id: rad.employee_id,
      datum: dag,
      minuter: rad.minutes,
      ordning: steg.ordning,
      atgard: steg.atgard,
      period_month: manad,
    });

    uppdatera();

    // ===================================================================
    // EN STANGD MANAD SKRIVS ALDRIG OM, och chefen ska fa veta det HAR.
    //
    // En bonusforlust verkar genom att motorn raknar om manaden. En stangd
    // manad laser sin siffra ur `commission_entry` och fragar aldrig motorn
    // (avsnitt 5.5), sa forlusten far ingen verkan bakat. Det ar ratt — men
    // det ar inte uppenbart, och en chef som tror att bonusen fallit och
    // sedan ser den utbetald har blivit vilseledd av tystnad.
    // ===================================================================
    let varning: string | undefined;
    if (steg.atgard === "bonusforlust") {
      const { data: stangd } = await db
        .from("commission_period")
        .select("period_month")
        .eq("period_month", manad)
        .maybeSingle();

      if (stangd) {
        varning =
          `${manadsnamn(manad)} är redan fastställd och skrivs aldrig om.` +
          " Bonusförlusten är registrerad men får ingen verkan på den månadens utbetalning.";
      }
    }

    return {
      ok: `Händelsen ${dag} är godkänd. Åtgärd: ${ETIKETT[steg.atgard]} (steg ${steg.ordning}).`,
      varning,
    };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

const ETIKETT: Record<string, string> = {
  varning: "varning",
  skriftlig_erinran: "skriftlig erinran",
  bonusforlust: "bonusförlust innevarande månad",
  arende: "personalärende",
};

/**
 * Avvisar ett forslag: personen var har, eller franvaron hade ett giltigt skal.
 *
 * Raden STAR KVAR som `avvisad` i stallet for att raderas. Ett forslag som
 * forsvinner ar ett forslag som laggs igen nasta natt — det unika indexet pa
 * (person, dag) i 0037 ar det som gor att samma dag inte foreslas tva ganger,
 * och det kraver att raden finns.
 */
export async function avvisaHandelse(
  _prev: Handelsestate,
  form: FormData,
): Promise<Handelsestate> {
  try {
    const id = String(form.get("id") ?? "").trim();
    const rad = await hamtaRad(id);
    if (!rad) return { fel: "Händelsen finns inte." };
    if (rad.status !== "foreslagen") return { fel: "Händelsen är redan beslutad." };

    const user = await kravBeslutare(String(rad.employee_id));

    const { error } = await supabaseAdmin()
      .from("attendance_incident")
      .update({
        status: "avvisad",
        decided_by: user.employee!.id,
        decided_at: new Date().toISOString(),
        decision_note: String(form.get("anteckning") ?? "").trim() || null,
      })
      .eq("id", id)
      .eq("status", "foreslagen");

    if (error) return { fel: `Händelsen avvisades inte: ${error.message}` };

    await logga(user, "attendance_incident.rejected", id, {
      employee_id: rad.employee_id,
      datum: String(rad.occurred_on).slice(0, 10),
    });

    uppdatera();
    return { ok: "Förslaget är avvisat. Det räknas inte, och det kommer inte tillbaka." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Haver en godkand handelse (fraga 46).
 *
 * SKALET AR FRIVILLIGT MEN FALTET FINNS, och havningen loggas. Bestallarens
 * svar var att chefen ska kunna hava utan att motivera sig — men en hävning
 * utan spar hade gjort trappan omojlig att granska i efterhand.
 *
 * En havd handelse RAKNAR FOR INGENTING (se `raknas()` i `konsekvens.ts`), och
 * bada spar star kvar: godkannandet och hävningen. Triggern i 0037 nekar att en
 * havd handelse vacks till liv igen — ar hävningen fel godkanns dagen pa nytt
 * som en egen handelse.
 */
export async function havHandelse(
  _prev: Handelsestate,
  form: FormData,
): Promise<Handelsestate> {
  try {
    const id = String(form.get("id") ?? "").trim();
    const rad = await hamtaRad(id);
    if (!rad) return { fel: "Händelsen finns inte." };
    if (rad.status !== "godkand") return { fel: "Bara en godkänd händelse går att häva." };

    const user = await kravBeslutare(String(rad.employee_id));

    const { error } = await supabaseAdmin()
      .from("attendance_incident")
      .update({
        status: "havd",
        revoked_by: user.employee!.id,
        revoked_at: new Date().toISOString(),
        revoke_reason: String(form.get("skal") ?? "").trim() || null,
      })
      .eq("id", id)
      .eq("status", "godkand");

    if (error) return { fel: `Händelsen hävdes inte: ${error.message}` };

    await logga(user, "attendance_incident.revoked", id, {
      employee_id: rad.employee_id,
      datum: String(rad.occurred_on).slice(0, 10),
      skal: String(form.get("skal") ?? "").trim() || null,
    });

    /**
     * HAVNINGEN AR DEN ENDA GODA NYHETEN I MODULEN, OCH DEN VAR TYST.
     *
     * `franvaro-konsekvens` — beskedet om varningen eller bonusavdraget —
     * raknas fram ur `status = 'godkand'`. Nar beslutet havs blir statusen
     * `havd`, harledningen slutar tracka, och posten forsvinner ur klockan utan
     * ett ord. Den som fatt veta att hon fick en varning far alltsa inte veta
     * att den ar borta; hon ser bara att raden inte langre ar dar.
     *
     * Bonusen raknas om nasta gang manaden visas, och det star i notisen —
     * annars ar nasta fraga "men pengarna da?".
     */
    await notifiera({
      till: String(rad.employee_id),
      av: user.employee!.id,
      kalla: "franvaro-havd",
      typ: "franvaro",
      rubrik: `Den ogiltiga frånvaron ${String(rad.occurred_on).slice(0, 10)} är hävd`,
      detalj:
        "Den räknas inte längre i trappan, och en bonus som fallit på grund av den räknas om.",
      href: "/provision",
      objekt: { typ: "attendance_incident", id },
    });

    uppdatera();
    return {
      ok:
        "Händelsen är hävd. Den räknas inte längre i trappan, och en bonus som fallit" +
        " på grund av den räknas om nästa gång månaden visas.",
    };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Lagger upp en handelse for hand.
 *
 * Behovs for att motorn bara ser dagar med SCHEMA och bara letar fjorton dygn
 * bakat. Raden far `source = 'manuell'` och gar in som ett FORSLAG — aven nar
 * det ar chefen sjalv som lagger den. Tva steg ar tva steg: den som lagger upp
 * en dag och den som beslutar om den ska vara samma tryck bara nar nagon
 * medvetet gor bada.
 */
export async function laggUppHandelse(
  _prev: Handelsestate,
  form: FormData,
): Promise<Handelsestate> {
  try {
    const employee_id = String(form.get("employee_id") ?? "").trim();
    const datum = String(form.get("datum") ?? "").trim();
    const minuter = Number(String(form.get("minuter") ?? "").trim());

    if (!employee_id) return { fel: "Välj en person." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return { fel: "Datumet är inte giltigt." };
    if (datum > svensktDatum(new Date())) return { fel: "Dagen ligger i framtiden." };
    if (!Number.isFinite(minuter) || minuter < MINSTA_MINUTER) {
      return { fel: `Omfattningen måste vara minst ${MINSTA_MINUTER} minuter (Ö15).` };
    }

    const user = await kravBeslutare(employee_id);

    const { error } = await supabaseAdmin().from("attendance_incident").insert({
      employee_id,
      occurred_on: datum,
      minutes: Math.round(minuter),
      status: "foreslagen",
      source: "manuell",
      created_by: user.employee!.id,
    });

    // 23505 = unique_violation. En rad per person och dag.
    if (error?.code === "23505") {
      return { fel: "Det finns redan en händelse för den personen den dagen." };
    }
    if (error) return { fel: `Händelsen lades inte upp: ${error.message}` };

    await supabaseAdmin().from("audit_log").insert({
      actor_id: user.employee!.id,
      action: "attendance_incident.created",
      object_type: "employee",
      object_id: employee_id,
      meta: { datum, minuter: Math.round(minuter), source: "manuell" },
    });

    uppdatera();
    return { ok: `Händelsen ${datum} ligger nu som förslag. Godkänn den för att den ska räknas.` };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/**
 * Tredje gangen: ett arende i den befintliga personalarendemodulen (0013).
 *
 * KATEGORIN AR `other` OCH ARENDET AR KONFIDENTIELLT.
 *
 * `development` ("Utveckling") ar den kategori en anstalld sjalv anvander for
 * ett samtal om sin egen utveckling. Att lagga ett disciplinart arende dar hade
 * forgiftat AC-4.5-statistiken: median och antal per kategori hade blandat ihop
 * tva helt olika sorters samtal.
 *
 * `confidential` narmar chefskretsen till sales_manager och ceo — en teamledare
 * med `attendance_approver` far besluta om sin egen grupps franvaro men laser
 * inte ett arende om nagons anstallning. RLS-policyn `hr_case_read` i 0013
 * borjar med `employee_id = current_employee_id()`, sa DEN DET GALLER SER SITT
 * EGET arende aven nar det ar konfidentiellt. Det ar en forutsattning: fraga 49
 * sager att saljaren ska godkanna svaret.
 *
 * Faller arendeskapandet ar handelsen anda godkand. Det ar ratt ordning —
 * beslutet ar taget, och ett uteblivet arende ar nagot en manniska kan lagga
 * upp for hand. Det omvanda hade gett ett arende utan handelse bakom sig.
 */
async function skapaArende(
  db: ReturnType<typeof supabaseAdmin>,
  user: CurrentUser,
  employee_id: string,
  handelse_id: string,
  dag: string,
) {
  const { data: kategori } = await db
    .from("case_category")
    .select("id, sla_hours")
    .eq("id", "other")
    .maybeSingle();

  const slaTimmar = Number(kategori?.sla_hours ?? 72);
  const nu = new Date();

  const { data: arende, error } = await db
    .from("hr_case")
    .insert({
      employee_id,
      created_by: user.employee!.id,
      category: "other",
      subject: "Ser över anställningen",
      confidential: true,
      assigned_to: user.employee!.id,
      sla_hours: slaTimmar,
      due_at: frist(nu, slaTimmar),
    })
    .select("id")
    .maybeSingle();

  if (error || !arende) return;

  // Ett arende utan forsta meddelande syns inte i notisklockan — den raknar
  // fram sina poster ur `case_message` (se `notiser-server.ts`).
  await db.from("case_message").insert({
    case_id: arende.id,
    author_id: user.employee!.id,
    body:
      `Tredje registrerade ogiltiga frånvaron, senast ${dag}.\n\n` +
      "Enligt konsekvenstrappan ses anställningen över. Skriv resultatet av samtalet" +
      " här; det är det svaret du ska godkänna.",
  });

  await db
    .from("attendance_incident")
    .update({ hr_case_id: arende.id })
    .eq("id", handelse_id);
}
