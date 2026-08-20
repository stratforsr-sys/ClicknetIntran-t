"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";
import {
  aterinsjuknande,
  provaRegler,
  sjukfrister,
  varstaBemanningsdag,
  type Franvarotyp,
  type Regelverk,
  type Sjukanmalan,
} from "@/lib/franvaro";
import {
  farBesluta,
  hamtaProvunderlag,
  lederPersonen,
  REGELFALT,
  TYPFALT,
} from "@/lib/franvaro-server";

export type FranvaroState = { fel?: string; ok?: string };

/**
 * ===========================================================================
 * K35, AC-3.21: INGEN ORSAK, DIAGNOS ELLER SYMTOMBESKRIVNING.
 *
 * Ingen handling i den här filen läser ett fritextfält från den som ansöker
 * eller sjukanmäler sig. De två `String(form.get(...))` som hämtar text är
 * chefens motivering till ett avslag och till en överstyrning (AC-3.12,
 * AC-3.13) — båda handlar om beslutet mot regeln, aldrig om personen, och
 * ingen av dem finns på sjukvägen.
 *
 * Lägger du till ett fält här: läs rubriken i 0020 först.
 * ===========================================================================
 */

async function regelverk(): Promise<{ regler: Regelverk; typer: Franvarotyp[] }> {
  const db = supabaseAdmin();
  const [{ data: policy }, { data: typer }] = await Promise.all([
    db.from("absence_policy").select(REGELFALT).maybeSingle(),
    db.from("absence_type").select(TYPFALT).order("sort"),
  ]);
  return { regler: policy as Regelverk, typer: (typer ?? []) as Franvarotyp[] };
}

// =============================================================================
// Ansökan (E7.1)
// =============================================================================

export type Forhandsbesked = {
  brott: { kod: string; text: string }[];
  /** E7.2: hur många andra som är borta den värsta dagen, och vad taket är. */
  bemanning: { datum: string; andra: number; tak: number | null } | null;
};

/**
 * Vad som skulle hända om ansökan skickades in nu (E7.2, AC-3.2, AC-3.11).
 *
 * Anropas medan formuläret fylls i. Att räkna reglerna på servern och inte i
 * webbläsaren är inte en optimering: bemanningsräkningen behöver veta vilka i
 * teamet som är borta, och den som ansöker ska inte kunna läsa det. Härifrån
 * lämnar bara ett antal och ett datum.
 */
export async function forhandsgranska(
  typId: string,
  fran: string,
  till: string,
  deldagMinuter: number | null,
): Promise<Forhandsbesked> {
  const user = await getCurrentUser();
  if (!user?.employee) return { brott: [], bemanning: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fran) || !/^\d{4}-\d{2}-\d{2}$/.test(till) || till < fran)
    return { brott: [], bemanning: null };

  const { regler, typer } = await regelverk();
  const typ = typer.find((t) => t.id === typId && t.requestable && t.active);
  if (!typ) return { brott: [], bemanning: null };

  const underlag = await hamtaProvunderlag(user.employee.id, user.employee.team_id, typ, regler, fran, till);
  const ansokan = {
    employee_id: user.employee.id,
    type_id: typ.id,
    starts_on: fran,
    ends_on: till,
    part_day_minutes: deldagMinuter,
  };

  const varst = typ.counts_in_staffing ? varstaBemanningsdag(ansokan, underlag) : null;

  return {
    brott: provaRegler(ansokan, underlag).map((b) => ({ kod: b.kod, text: b.text })),
    bemanning: varst ? { datum: varst.datum, andra: varst.antal, tak: underlag.tak?.max_absent ?? null } : null,
  };
}

export async function skickaAnsokan(_prev: FranvaroState, form: FormData): Promise<FranvaroState> {
  let nyId: string;

  try {
    const user = await getCurrentUser();
    if (!user?.employee) return { fel: "Du måste vara inloggad." };

    const typId = String(form.get("typ") ?? "");
    const fran = String(form.get("fran") ?? "");
    const till = String(form.get("till") ?? "") || fran;
    const deldag = form.get("deldag") === "1";
    const minuter = Number(form.get("minuter") ?? 0);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(fran)) return { fel: "Välj ett startdatum." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(till)) return { fel: "Välj ett slutdatum." };
    if (till < fran) return { fel: "Slutdatumet ligger före startdatumet." };

    const { regler, typer } = await regelverk();
    const typ = typer.find((t) => t.id === typId && t.active);
    if (!typ) return { fel: "Välj en typ av ledighet." };

    // AC-3.6: sjukfrånvaro söks aldrig. Databasen hindrar att typen görs
    // ansökningsbar; det här hindrar att någon skickar in den ändå genom att
    // posta formuläret för hand.
    if (!typ.requestable) return { fel: "Sjukfrånvaro registreras efter samtal, den söks inte." };

    if (deldag && fran !== till) return { fel: "Del av dag gäller en enda dag." };
    if (deldag && (!Number.isInteger(minuter) || minuter <= 0 || minuter > 1440))
      return { fel: "Ange hur många minuter ledigheten gäller." };

    const underlag = await hamtaProvunderlag(user.employee.id, user.employee.team_id, typ, regler, fran, till);
    const brott = provaRegler(
      {
        employee_id: user.employee.id,
        type_id: typ.id,
        starts_on: fran,
        ends_on: till,
        part_day_minutes: deldag ? minuter : null,
      },
      underlag,
    );

    const db = supabaseAdmin();
    const { data: rad, error } = await db
      .from("absence_request")
      .insert({
        employee_id: user.employee.id,
        created_by: user.employee.id,
        type_id: typ.id,
        starts_on: fran,
        ends_on: till,
        part_day_minutes: deldag ? minuter : null,
        // AC-3.11: brotten fryses vid inskicket. Ändras en frist i morgon får
        // det inte göra gårdagens ansökan regelvidrig i efterhand.
        rules_broken: brott.map((b) => b.kod),
      })
      .select("id")
      .single();

    if (error || !rad) return { fel: `Ansökan kunde inte skickas: ${error?.message ?? "okänt fel"}` };

    await db.from("audit_log").insert({
      actor_id: user.employee.id,
      action: "absence.requested",
      object_type: "absence_request",
      object_id: rad.id,
      meta: { typ: typ.id, fran, till, regelbrott: brott.map((b) => b.kod) },
    });

    nyId = rad.id;
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }

  revalidatePath("/franvaro");
  revalidatePath("/franvaro/attest");
  revalidatePath("/");
  redirect(`/franvaro/${nyId}`);
}

/** Den anställda tar tillbaka sin egen ansökan innan beslut. */
export async function draTillbaka(_prev: FranvaroState, form: FormData): Promise<FranvaroState> {
  const user = await getCurrentUser();
  if (!user?.employee) return { fel: "Du måste vara inloggad." };

  const id = String(form.get("id") ?? "");
  const db = supabaseAdmin();

  const { data: ansokan } = await db
    .from("absence_request")
    .select("id, employee_id, status")
    .eq("id", id)
    .maybeSingle();

  if (!ansokan || ansokan.employee_id !== user.employee.id) return { fel: "Ansökan finns inte." };
  if (ansokan.status !== "submitted") return { fel: "Ansökan är redan beslutad." };

  const { error } = await db
    .from("absence_request")
    .update({ status: "withdrawn", withdrawn_by: user.employee.id, withdrawn_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { fel: error.message };

  await db.from("audit_log").insert({
    actor_id: user.employee.id,
    action: "absence.withdrawn",
    object_type: "absence_request",
    object_id: id,
  });

  revalidatePath("/franvaro");
  revalidatePath("/franvaro/attest");
  return { ok: "Ansökan är tillbakadragen." };
}

/**
 * Beslut (AC-3.12, AC-3.13).
 *
 * Ett avslag kräver en motivering och en överstyrning av en bruten regel kräver
 * en. Båda villkoren står också i databasen, så en handling som glömmer dem
 * misslyckas i stället för att skriva en rad ingen kan förklara.
 */
export async function beslutaAnsokan(_prev: FranvaroState, form: FormData): Promise<FranvaroState> {
  const user = await getCurrentUser();
  if (!user?.employee) return { fel: "Du måste vara inloggad." };

  const id = String(form.get("id") ?? "");
  const beslut = String(form.get("beslut") ?? "");
  const motivering = String(form.get("motivering") ?? "").trim();

  if (beslut !== "godkann" && beslut !== "avsla") return { fel: "Okänt beslut." };

  const db = supabaseAdmin();
  const { data: ansokan } = await db
    .from("absence_request")
    .select("id, employee_id, type_id, starts_on, ends_on, status, rules_broken")
    .eq("id", id)
    .maybeSingle();

  if (!ansokan) return { fel: "Ansökan finns inte." };
  if (ansokan.status !== "submitted") return { fel: "Ansökan är redan beslutad." };
  if (ansokan.employee_id === user.employee.id)
    return { fel: "Du kan inte besluta om din egen ledighet." };

  const { typer } = await regelverk();
  const typ = typer.find((t) => t.id === ansokan.type_id);
  const ledare = await lederPersonen(user, ansokan.employee_id);
  if (!typ || !farBesluta(user, typ.approval_level, ledare))
    return { fel: "Du har inte behörighet att besluta om den här ledigheten." };

  if (beslut === "avsla" && !motivering)
    return { fel: "Ett avslag utan skäl går inte att bemöta. Skriv en motivering." };

  const brutna = (ansokan.rules_broken ?? []) as string[];
  if (beslut === "godkann" && brutna.length > 0 && !motivering)
    return {
      fel: "Ansökan bryter mot en regel. Skriv varför du godkänner den ändå (AC-3.12).",
    };

  const { error } = await db
    .from("absence_request")
    .update({
      status: beslut === "godkann" ? "approved" : "rejected",
      decided_by: user.employee.id,
      decided_at: new Date().toISOString(),
      decision_note: beslut === "avsla" ? motivering : null,
      override_reason: beslut === "godkann" && brutna.length > 0 ? motivering : null,
    })
    .eq("id", id);

  if (error) return { fel: error.message };

  await db.from("audit_log").insert({
    actor_id: user.employee.id,
    action: beslut === "godkann" ? "absence.approved" : "absence.rejected",
    object_type: "absence_request",
    object_id: id,
    reason: motivering || null,
    meta: { typ: ansokan.type_id, regelbrott: brutna },
  });

  revalidatePath("/franvaro");
  revalidatePath("/franvaro/attest");
  revalidatePath(`/franvaro/${id}`);
  revalidatePath("/");
  return { ok: beslut === "godkann" ? "Ledigheten är godkänd." : "Ansökan är avslagen." };
}

/** En godkänd ledighet som ställs in. Beslutet står kvar bredvid inställningen. */
export async function stallInLedighet(_prev: FranvaroState, form: FormData): Promise<FranvaroState> {
  const user = await getCurrentUser();
  if (!user?.employee) return { fel: "Du måste vara inloggad." };

  const id = String(form.get("id") ?? "");
  const db = supabaseAdmin();

  const { data: ansokan } = await db
    .from("absence_request")
    .select("id, employee_id, type_id, status")
    .eq("id", id)
    .maybeSingle();

  if (!ansokan || ansokan.status !== "approved") return { fel: "Ingen godkänd ledighet att ställa in." };

  const { typer } = await regelverk();
  const typ = typer.find((t) => t.id === ansokan.type_id);
  const ledare = await lederPersonen(user, ansokan.employee_id);
  const egen = ansokan.employee_id === user.employee.id;

  if (!egen && !(typ && farBesluta(user, typ.approval_level, ledare)))
    return { fel: "Du har inte behörighet att ställa in den här ledigheten." };

  const { error } = await db
    .from("absence_request")
    .update({ status: "cancelled", withdrawn_by: user.employee.id, withdrawn_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { fel: error.message };

  await db.from("audit_log").insert({
    actor_id: user.employee.id,
    action: "absence.cancelled",
    object_type: "absence_request",
    object_id: id,
  });

  revalidatePath("/franvaro");
  revalidatePath(`/franvaro/${id}`);
  return { ok: "Ledigheten är inställd." };
}

// =============================================================================
// Sjukfrånvaro (E7.6, E7.7)
// =============================================================================

/**
 * Registrering EFTER samtalet (AC-3.6, AC-3.27).
 *
 * Handlingen tar emot datum och omfattning. Den tar inte emot något skäl, och
 * det finns inget fält att skicka ett i.
 *
 * Både den sjuke och den som tog samtalet får registrera. En chef som tar emot
 * ett samtal klockan sju ska kunna knappa in det direkt i stället för att vänta
 * på att den sjuke orkar logga in.
 */
export async function registreraSjuk(_prev: FranvaroState, form: FormData): Promise<FranvaroState> {
  const user = await getCurrentUser();
  if (!user?.employee) return { fel: "Du måste vara inloggad." };

  const forId = String(form.get("for") ?? "") || user.employee.id;
  const forstaDag = String(form.get("forsta_dag") ?? "");
  const omfattning = Number(form.get("omfattning") ?? 100);
  const mottagare = String(form.get("mottagare") ?? "");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(forstaDag)) return { fel: "Ange första sjukdagen." };
  if (![25, 50, 75, 100].includes(omfattning)) return { fel: "Välj omfattning." };

  // En första sjukdag i framtiden är inte en sjukanmälan, det är en gissning.
  const idag = svensktDatum();
  if (forstaDag > idag) return { fel: "Första sjukdagen kan inte ligga i framtiden." };

  const egen = forId === user.employee.id;
  if (!egen) {
    const ledare = await lederPersonen(user, forId);
    if (!ledare && !hasRole(user, "sales_manager", "ceo"))
      return { fel: "Du kan bara registrera en sjukanmälan för dig själv eller för dem du leder." };
  }

  const db = supabaseAdmin();
  const { regler } = await regelverk();

  // AC-3.24: hör den här dagen ihop med en period som nyss avslutades?
  const { data: tidigare } = await db
    .from("sick_report")
    .select("id, employee_id, first_sick_day, registered_at, confirmed_at, escalated_at, last_sick_day, cancelled_at")
    .eq("employee_id", forId)
    .order("first_sick_day", { ascending: false })
    .limit(20);

  const foregaende = aterinsjuknande(forstaDag, (tidigare ?? []) as Sjukanmalan[], regler);

  const { data: rad, error } = await db
    .from("sick_report")
    .insert({
      employee_id: forId,
      first_sick_day: forstaDag,
      registered_by: user.employee.id,
      reported_to: mottagare || null,
      extent_percent: omfattning,
      previous_report_id: foregaende?.id ?? null,
    })
    .select("id")
    .single();

  if (error || !rad) {
    // Exclusion-villkoret i 0020 talar postgresiska. Den som registrerar ska
    // få veta vad som hände, inte se ett villkorsnamn.
    if (error?.message.includes("sick_report_ingen_dubbel"))
      return { fel: "Det finns redan en sjukanmälan som täcker den dagen." };
    return { fel: `Anmälan kunde inte registreras: ${error?.message ?? "okänt fel"}` };
  }

  // K37: fristerna sätts direkt, inte av nattjobbet. En anmälan som kommer in
  // på morgonen ska visa dag 8 samma förmiddag — chefen ska kunna planera, inte
  // vänta till nästa dygn på att systemet räknar.
  await db.from("sick_deadline").insert(
    sjukfrister(forstaDag, regler).map((f) => ({ report_id: rad.id, kind: f.kind, due_on: f.due_on })),
  );

  // Loggen bär datum och omfattning. Inget annat finns att bära.
  await db.from("audit_log").insert({
    actor_id: user.employee.id,
    action: "sick.registered",
    object_type: "sick_report",
    object_id: rad.id,
    meta: {
      forsta_dag: forstaDag,
      omfattning,
      egen,
      aterinsjuknande: Boolean(foregaende),
    },
  });

  revalidatePath("/franvaro");
  revalidatePath("/franvaro/sjuk");
  revalidatePath("/");
  return { ok: "Sjukanmälan är registrerad." };
}

/** AC-3.17: chefen bekräftar att anmälan är mottagen. */
export async function bekraftaSjuk(_prev: FranvaroState, form: FormData): Promise<FranvaroState> {
  const user = await getCurrentUser();
  if (!user?.employee) return { fel: "Du måste vara inloggad." };

  const id = String(form.get("id") ?? "");
  const db = supabaseAdmin();

  const { data: anmalan } = await db
    .from("sick_report")
    .select("id, employee_id, confirmed_at, cancelled_at")
    .eq("id", id)
    .maybeSingle();

  if (!anmalan || anmalan.cancelled_at) return { fel: "Anmälan finns inte." };
  if (anmalan.confirmed_at) return { fel: "Anmälan är redan bekräftad." };
  if (anmalan.employee_id === user.employee.id)
    return { fel: "Din egen sjukanmälan bekräftas av din chef." };

  const ledare = await lederPersonen(user, anmalan.employee_id);
  if (!ledare && !hasRole(user, "sales_manager", "ceo"))
    return { fel: "Du har inte behörighet att bekräfta den här anmälan." };

  const { error } = await db
    .from("sick_report")
    .update({ confirmed_by: user.employee.id, confirmed_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { fel: error.message };

  await db.from("audit_log").insert({
    actor_id: user.employee.id,
    action: "sick.confirmed",
    object_type: "sick_report",
    object_id: id,
  });

  revalidatePath("/franvaro/sjuk");
  revalidatePath("/");
  return { ok: "Anmälan är bekräftad." };
}

/** Sista sjukdagen. Perioden stängs, och först då kan ett återinsjuknande knytas till den. */
export async function avslutaSjuk(_prev: FranvaroState, form: FormData): Promise<FranvaroState> {
  const user = await getCurrentUser();
  if (!user?.employee) return { fel: "Du måste vara inloggad." };

  const id = String(form.get("id") ?? "");
  const sistaDag = String(form.get("sista_dag") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sistaDag)) return { fel: "Ange sista sjukdagen." };

  const db = supabaseAdmin();
  const { data: anmalan } = await db
    .from("sick_report")
    .select("id, employee_id, first_sick_day, last_sick_day, cancelled_at")
    .eq("id", id)
    .maybeSingle();

  if (!anmalan || anmalan.cancelled_at) return { fel: "Anmälan finns inte." };
  if (anmalan.last_sick_day) return { fel: "Perioden är redan avslutad." };
  if (sistaDag < anmalan.first_sick_day) return { fel: "Sista sjukdagen ligger före den första." };
  if (sistaDag > svensktDatum()) return { fel: "Sista sjukdagen kan inte ligga i framtiden." };

  const egen = anmalan.employee_id === user.employee.id;
  const ledare = await lederPersonen(user, anmalan.employee_id);
  if (!egen && !ledare && !hasRole(user, "sales_manager", "ceo"))
    return { fel: "Du har inte behörighet att avsluta den här perioden." };

  const { error } = await db.from("sick_report").update({ last_sick_day: sistaDag }).eq("id", id);
  if (error) return { fel: error.message };

  // Frister som inte hunnit förfalla när personen är tillbaka är inte längre
  // aktuella. De tas inte bort — de kvitteras som ohanterade genom att
  // perioden är slut, och raden står kvar att läsa.
  await db.from("audit_log").insert({
    actor_id: user.employee.id,
    action: "sick.closed",
    object_type: "sick_report",
    object_id: id,
    meta: { sista_dag: sistaDag },
  });

  revalidatePath("/franvaro");
  revalidatePath("/franvaro/sjuk");
  return { ok: "Sjukperioden är avslutad." };
}

/** En anmälan som blev fel. Tas aldrig bort — databasen vägrar. */
export async function stallInSjuk(_prev: FranvaroState, form: FormData): Promise<FranvaroState> {
  const user = await getCurrentUser();
  if (!user?.employee) return { fel: "Du måste vara inloggad." };

  const id = String(form.get("id") ?? "");
  const db = supabaseAdmin();

  const { data: anmalan } = await db
    .from("sick_report")
    .select("id, employee_id, cancelled_at")
    .eq("id", id)
    .maybeSingle();

  if (!anmalan || anmalan.cancelled_at) return { fel: "Anmälan finns inte." };

  const egen = anmalan.employee_id === user.employee.id;
  const ledare = await lederPersonen(user, anmalan.employee_id);
  if (!egen && !ledare && !hasRole(user, "sales_manager", "ceo"))
    return { fel: "Du har inte behörighet att ställa in den här anmälan." };

  const { error } = await db
    .from("sick_report")
    .update({ cancelled_by: user.employee.id, cancelled_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { fel: error.message };

  await db.from("audit_log").insert({
    actor_id: user.employee.id,
    action: "sick.cancelled",
    object_type: "sick_report",
    object_id: id,
  });

  revalidatePath("/franvaro");
  revalidatePath("/franvaro/sjuk");
  return { ok: "Anmälan är inställd." };
}

/**
 * En frist kvitteras (K37).
 *
 * För dag 8 sätts också `certificate_received_on`. Det är det E7.10 kan ge
 * utan Storage: navet vet ATT ett intyg kommit in och när, men bär inte filen.
 * K36:s krav på att varje öppning loggas gäller filen, och den finns inte —
 * se ROADMAP E7.10.
 */
export async function kvitteraFrist(_prev: FranvaroState, form: FormData): Promise<FranvaroState> {
  const user = await getCurrentUser();
  if (!user?.employee) return { fel: "Du måste vara inloggad." };

  const id = String(form.get("id") ?? "");
  const db = supabaseAdmin();

  const { data: frist } = await db
    .from("sick_deadline")
    .select("id, kind, completed_at, sick_report!inner(id, employee_id)")
    .eq("id", id)
    .maybeSingle<{ id: string; kind: string; completed_at: string | null; sick_report: { id: string; employee_id: string } }>();

  if (!frist) return { fel: "Fristen finns inte." };
  if (frist.completed_at) return { fel: "Fristen är redan kvitterad." };

  const ledare = await lederPersonen(user, frist.sick_report.employee_id);
  if (!ledare && !hasRole(user, "sales_manager", "ceo"))
    return { fel: "Frister kvitteras av chefen." };

  const nu = new Date().toISOString();
  const { error } = await db
    .from("sick_deadline")
    .update({ completed_by: user.employee.id, completed_at: nu })
    .eq("id", id);

  if (error) return { fel: error.message };

  if (frist.kind === "certificate") {
    await db
      .from("sick_report")
      .update({ certificate_received_on: svensktDatum() })
      .eq("id", frist.sick_report.id)
      .is("certificate_received_on", null);
  }

  await db.from("audit_log").insert({
    actor_id: user.employee.id,
    action: "sick.deadline_done",
    object_type: "sick_deadline",
    object_id: id,
    meta: { frist: frist.kind },
  });

  revalidatePath("/franvaro/sjuk");
  revalidatePath("/");
  return { ok: "Fristen är kvitterad." };
}

// =============================================================================
// Saldon (E7.5) — matas in för hand, räknas aldrig fram
// =============================================================================

export async function mataInSaldo(_prev: FranvaroState, form: FormData): Promise<FranvaroState> {
  const user = await getCurrentUser();
  if (!user?.employee) return { fel: "Du måste vara inloggad." };

  // AC-2.17 och K5: navet räknar ingen semesterrätt. Ett saldo är någons
  // påstående, och därför får bara den som ansvarar för personalen skriva det.
  if (!hasRole(user, "sales_manager", "ceo", "admin"))
    return { fel: "Saldon matas in av säljchef, VD eller administratör." };

  const employeeId = String(form.get("employee_id") ?? "");
  const typId = String(form.get("typ") ?? "");
  const dagar = Number(form.get("dagar") ?? -1);
  const asOf = String(form.get("as_of") ?? "");
  const intjanandear = String(form.get("intjanandear") ?? "").trim();

  if (!employeeId) return { fel: "Ingen person vald." };
  if (!Number.isFinite(dagar) || dagar < 0) return { fel: "Ange antal dagar." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return { fel: "Ange vilket datum saldot gällde." };
  if (asOf > svensktDatum()) return { fel: "Saldot kan inte gälla ett datum i framtiden." };

  const ar = intjanandear ? Number(intjanandear) : null;
  if (intjanandear && (!Number.isInteger(ar) || ar! < 2000 || ar! > 2100))
    return { fel: "Intjänandeåret ska vara ett årtal." };
  if (ar !== null && typId !== "saved_vacation")
    return { fel: "Intjänandeår anges bara för sparade semesterdagar." };

  const db = supabaseAdmin();
  const { error } = await db.from("absence_balance").insert({
    employee_id: employeeId,
    type_id: typId,
    days: dagar,
    as_of: asOf,
    earned_year: ar,
    entered_by: user.employee.id,
  });

  if (error) return { fel: error.message };

  await db.from("audit_log").insert({
    actor_id: user.employee.id,
    action: "absence.balance_entered",
    object_type: "employee",
    object_id: employeeId,
    meta: { typ: typId, dagar, as_of: asOf, intjanandear: ar },
  });

  revalidatePath(`/personal/${employeeId}`);
  revalidatePath("/franvaro");
  return { ok: "Saldot är inmatat." };
}

// =============================================================================
// Kalenderflöde (E7.3)
// =============================================================================

function nyToken(): string {
  return randomBytes(24).toString("base64url");
}

export async function skapaFlode(_prev: FranvaroState, form: FormData): Promise<FranvaroState> {
  const user = await getCurrentUser();
  if (!user?.employee) return { fel: "Du måste vara inloggad." };

  const scope = String(form.get("scope") ?? "mine");
  if (scope !== "mine" && scope !== "team") return { fel: "Okänd sorts flöde." };

  const db = supabaseAdmin();

  // Ett teamflöde skapas bara åt någon som faktiskt leder folk. Kontrollen
  // görs om vid varje läsning också — slutar man vara chef ska flödet sina.
  if (scope === "team" && !hasRole(user, "sales_manager", "ceo")) {
    const [{ count: leder }, { count: team }] = await Promise.all([
      db.from("employee").select("id", { count: "exact", head: true }).eq("manager_id", user.employee.id),
      db.from("team").select("id", { count: "exact", head: true }).eq("lead_id", user.employee.id),
    ]);
    if ((leder ?? 0) === 0 && (team ?? 0) === 0)
      return { fel: "Ett teamflöde kräver att du leder någon." };
  }

  const { error } = await db
    .from("calendar_feed")
    .upsert(
      { employee_id: user.employee.id, scope, token: nyToken(), revoked_at: null, revoked_by: null },
      { onConflict: "employee_id,scope" },
    );

  if (error) return { fel: error.message };

  await db.from("audit_log").insert({
    actor_id: user.employee.id,
    action: "calendar.feed_created",
    object_type: "calendar_feed",
    object_id: user.employee.id,
    meta: { scope },
  });

  revalidatePath("/franvaro");
  return { ok: "Flödet är skapat. Kopiera adressen och lägg in den i din kalender." };
}

/** Rotation och återkallande. Samma handling — den som misstänker en läcka vill ofta ha båda. */
export async function rotaFlode(_prev: FranvaroState, form: FormData): Promise<FranvaroState> {
  const user = await getCurrentUser();
  if (!user?.employee) return { fel: "Du måste vara inloggad." };

  const scope = String(form.get("scope") ?? "mine");
  const stang = form.get("stang") === "1";
  const db = supabaseAdmin();

  const { error } = await db
    .from("calendar_feed")
    .update(
      stang
        ? { revoked_at: new Date().toISOString(), revoked_by: user.employee.id }
        : { token: nyToken(), rotated_at: new Date().toISOString(), read_count: 0, revoked_at: null, revoked_by: null },
    )
    .eq("employee_id", user.employee.id)
    .eq("scope", scope);

  if (error) return { fel: error.message };

  await db.from("audit_log").insert({
    actor_id: user.employee.id,
    action: stang ? "calendar.feed_revoked" : "calendar.feed_rotated",
    object_type: "calendar_feed",
    object_id: user.employee.id,
    meta: { scope },
  });

  revalidatePath("/franvaro");
  return {
    ok: stang
      ? "Flödet är stängt. Den gamla adressen ger inget mer."
      : "Ny adress skapad. Den gamla slutade fungera i samma stund.",
  };
}
