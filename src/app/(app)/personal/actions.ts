"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { Referens } from "@/lib/personal-radering";
import { getCurrentUser, canManageEmployees, hasRole } from "@/lib/auth";
import { ROLES, PERMISSIONS, ROLE_LABEL, PERMISSION_LABEL, type Role, type Permission } from "@/lib/roles";
import { nyttTillfalligtLosenord } from "@/lib/losenord";
import { kravByte, laggUppAnstalld as laggUpp } from "@/lib/anstallning-server";
import { notifiera } from "@/lib/notishandelse-server";

export type FormState = {
  fel?: string;
  ok?: string;
  /** Visas en gang for chefen och sparas ingenstans. Se laggUppAnstalld. */
  losenord?: string;
  anstalldId?: string;
  /**
   * E1.5: en varning nar personen INTE har nagon arbetstid att matas mot.
   * Tyst tom betyder att allt ser rätt ut i varje vy medan ingenting bedoms.
   */
  utanSchema?: boolean;
};

/**
 * Skrivningar gar via service role, aldrig via klientens RLS. Skalet ar att
 * varje skrivning ska kunna loggas i samma svep — och att behorighetsregeln
 * for "far lagga upp anstallda" ar mer an en radnivakontroll.
 */
async function kravChef() {
  const user = await getCurrentUser();
  if (!canManageEmployees(user) || !user?.employee) {
    throw new Error("Du saknar behörighet för den här åtgärden.");
  }
  return user;
}

async function logga(
  actorId: string,
  action: string,
  objectType: string,
  objectId: string,
  meta?: Record<string, unknown>,
  reason?: string,
) {
  await supabaseAdmin().from("audit_log").insert({
    actor_id: actorId,
    action,
    object_type: objectType,
    object_id: objectId,
    meta: meta ?? null,
    reason: reason ?? null,
  });
}

/**
 * AC-1.3: en anstalld laggs upp en gang och far allt tilldelat.
 *
 * Sjalva upplaggningen ligger i src/lib/anstallning-server.ts, eftersom
 * rekryteringens anstallningsflode (E10.9) gar samma vag. Det har ar formularets
 * halva: las falten, kontrollera behorigheten, visa svaret.
 */
export async function laggUppAnstalld(_prev: FormState, form: FormData): Promise<FormState> {
  let nyId: string;
  let namn: string;
  let losenord: string;
  let utanSchema = false;
  try {
    const user = await kravChef();

    const fornamn = String(form.get("fornamn") ?? "").trim();
    const efternamn = String(form.get("efternamn") ?? "").trim();

    const svar = await laggUpp(
      {
        epost: String(form.get("epost") ?? "").trim().toLowerCase(),
        fornamn,
        efternamn,
        roll: String(form.get("roll") ?? "salesperson") as Role,
        anstallningsform: String(form.get("anstallningsform") ?? "permanent"),
        startdatum: String(form.get("startdatum") ?? "") || null,
        anstallningsnummer: String(form.get("anstallningsnummer") ?? "").trim() || null,
        teamId: String(form.get("team_id") ?? "") || null,
      },
      user.employee!.id,
    );

    if ("fel" in svar) return { fel: svar.fel };

    nyId = svar.employeeId;
    losenord = svar.losenord;
    utanSchema = svar.schemadagar.length === 0;
    namn = `${fornamn} ${efternamn}`;
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }

  revalidatePath("/personal");

  // Ingen omdirigering langre. Losenordet visas en gang, och det gar inte att
  // gora pa nasta sida utan att skicka ordet i en URL — dar det hamnar i
  // webbhistorik, i Vercels loggar och i varje mellanliggande proxy.
  return { ok: `${namn} är upplagd.`, losenord, anstalldId: nyId, utanSchema };
}

export type LosenordState = { fel?: string; losenord?: string };

/**
 * Nytt tillfalligt losenord at nagon som star utanfor sitt konto.
 *
 * Sjalva ordet skrivs aldrig i loggen — bara att det byttes, av vem och for
 * vem. En logg som innehaller losenord ar en losenordslista med tidsstampel.
 */
export async function aterstallLosenord(
  _prev: LosenordState,
  form: FormData,
): Promise<LosenordState> {
  try {
    const user = await kravChef();
    const db = supabaseAdmin();

    const anstalldId = String(form.get("employee_id") ?? "");
    const { data: a } = await db
      .from("employee")
      .select("id, email, auth_user_id, status")
      .eq("id", anstalldId)
      .maybeSingle();

    if (!a) return { fel: "Personen finns inte." };
    if (!a.auth_user_id) return { fel: "Personen saknar inloggningskonto." };

    // AC-1.4: ett avslutat konto ar bannlyst. Ett nytt losenord dit vore att
    // tyst oppna en dorr som offboardingen stangde.
    if (a.status === "offboarded") return { fel: "Kontot är avslutat och ska inte öppnas igen." };

    const losenord = nyttTillfalligtLosenord();
    const { error } = await db.auth.admin.updateUserById(a.auth_user_id, { password: losenord });
    if (error) return { fel: `Lösenordet kunde inte sättas: ${error.message}` };

    // Ett aterstallt losenord ar lika kant som ett nyss utdelat. Samma tvang.
    await kravByte(db, a.auth_user_id);

    await logga(user.employee!.id, "auth.temp_password_set", "employee", a.id, { epost: a.email });

    /**
     * ETT ATERSTALLT LOSENORD SKA ALLTID SYNAS FOR KONTOTS AGARE.
     *
     * Sjalva ordet star inte i notisen, av samma skal som det inte star i
     * loggen: en notis med ett losenord i ar en losenordslista med tidsstampel.
     * Det som star ar ATT det hant och NAR — och det ar den upplysningen som
     * gor skillnad, for den som inte bad om ett nytt losenord ska kunna reagera.
     */
    await notifiera({
      till: a.id,
      av: user.employee!.id,
      kalla: "konto-losenord",
      typ: "konto",
      rubrik: "Ditt lösenord har återställts",
      detalj: "Du får byta det vid nästa inloggning. Bad du inte om det — säg till.",
      href: "/profil",
      objekt: { typ: "employee", id: a.id },
    });

    return { losenord };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

/** AC-1.5: rollbyte loggas med vem som beviljade. */
export async function andraRoll(form: FormData): Promise<void> {
  const user = await kravChef();
  const db = supabaseAdmin();
  const employeeId = String(form.get("employee_id"));
  const roll = String(form.get("roll")) as Role;
  const pa = String(form.get("pa")) === "1";

  if (!ROLES.includes(roll)) return;

  if (pa) {
    await db.from("employee_role").upsert({
      employee_id: employeeId,
      role: roll,
      granted_by: user.employee!.id,
    });
  } else {
    await db.from("employee_role").delete().eq("employee_id", employeeId).eq("role", roll);
  }

  await logga(user.employee!.id, pa ? "role.granted" : "role.revoked", "employee", employeeId, {
    roll,
  });

  // En roll avgor vad man ser och far gora i hela navet. Att den andras utan
  // besked ar sattet att fa nagon att tro att navet gatt sonder — menyn ser
  // annorlunda ut och ingenting forklarar varfor.
  await notifiera({
    till: employeeId,
    av: user.employee!.id,
    kalla: "konto-roll",
    typ: "konto",
    rubrik: pa ? `Du har fått rollen ${ROLE_LABEL[roll]}` : `Rollen ${ROLE_LABEL[roll]} är borttagen`,
    detalj: pa ? "Nya vyer kan ha dykt upp i menyn" : "Vissa vyer kan ha försvunnit ur menyn",
    href: `/personal/${employeeId}`,
    objekt: { typ: "employee", id: employeeId },
  });

  revalidatePath(`/personal/${employeeId}`);
}

export async function aktivera(form: FormData): Promise<void> {
  const user = await kravChef();
  const db = supabaseAdmin();
  const employeeId = String(form.get("employee_id"));

  // En namnskylt efter en radering ar inte en person att vacka. Kontot,
  // e-posten och allt annat ar borta — det som star kvar ar bara namnet pa
  // rader som foretaget maste ha kvar. Se 0046.
  const { data: skylt } = await db
    .from("employee")
    .select("removed_at")
    .eq("id", employeeId)
    .maybeSingle();
  if (skylt?.removed_at) return;

  await db.from("employee").update({ status: "active" }).eq("id", employeeId);
  await logga(user.employee!.id, "employee.activated", "employee", employeeId);

  await notifiera({
    till: employeeId,
    av: user.employee!.id,
    kalla: "konto-aktiverad",
    typ: "konto",
    rubrik: "Ditt konto är aktiverat",
    detalj: "Onboardingen är avslutad. Hela navet är öppet för dig.",
    href: "/",
    objekt: { typ: "employee", id: employeeId },
  });

  revalidatePath(`/personal/${employeeId}`);
}

/**
 * AC-1.4: offboarding satter status och end_date, aterkallar alla roller,
 * invaliderar samtliga sessioner omedelbart och behaller historiken.
 * AC-1.7: checklista med kvittens genereras automatiskt.
 * E1.8: oppna arenden stangs, och tilldelningar gar tillbaka till inkorgen.
 *
 * Sessionerna stangs pa tva satt: signOut global via admin-API:t, och
 * middleware som slar tillbaka pa status. Det forsta kan misslyckas mot ett
 * natverksfel — det andra kan inte kringgas.
 */
const CHECKLISTA = [
  "Konto i navet avslutat",
  "Inkio-behörighet borttagen",
  "Dialer-kö avslutad och kösegment frigjort",
  "E-postkonto avslutat eller vidarebefordrat",
  "Dator och kringutrustning återlämnad",
  "Telefon och SIM återlämnat",
  "Passerkort och nycklar återlämnade",
  "Slutlön och provisionsunderlag överlämnat till lön",
];

export async function offboarda(form: FormData): Promise<void> {
  const user = await kravChef();
  const db = supabaseAdmin();
  const employeeId = String(form.get("employee_id"));
  const slutdatum = String(form.get("slutdatum") ?? "") || new Date().toISOString().slice(0, 10);

  const { data: anst } = await db
    .from("employee")
    .select("auth_user_id")
    .eq("id", employeeId)
    .single();

  await db
    .from("employee")
    .update({ status: "offboarded", end_date: slutdatum })
    .eq("id", employeeId);

  await db.from("employee_role").delete().eq("employee_id", employeeId);
  await db.from("employee_permission").delete().eq("employee_id", employeeId);

  if (anst?.auth_user_id) {
    // Stanger alla aktiva sessioner. Bannlysning hindrar nya tokens.
    await db.auth.admin
      .updateUserById(anst.auth_user_id, { ban_duration: "876000h" })
      .catch(() => null);
  }

  /**
   * E1.8: oppna arenden.
   *
   * Utan det har blev en avslutad anstalld kvar i inkorgen som en trad ingen
   * kan svara pa — kontot ar bannlyst i samma andetag — medan fristen fortsatte
   * ticka och drog med sig SLA-statistiken i AC-4.5.
   *
   * De stangs alltsa, men INTE tyst. `resolution` sager varfor, varje stangning
   * far en rad i loggen, och fanns det oppna arenden laggs en extra punkt i
   * checklistan. Den punkten ar hela poangen: AC-4.5:s statistik blir ren av att
   * traden stangs, men fragan i den kan mycket val leva vidare — ett arende om
   * provision pa en affar som ligger kvar hos kunden slutar inte existera for
   * att den som stallde fragan slutat. AC-1.7 later inte punkten hoppas over
   * utan motivering, och det ar den enda notis navet kan ge sa lange E0.8
   * saknas.
   */
  const { data: oppnaArenden } = await db
    .from("hr_case")
    .select("id, subject, status")
    .eq("employee_id", employeeId)
    .is("resolved_at", null);

  const antalOppna = (oppnaArenden ?? []).length;

  if (antalOppna > 0) {
    const nu = new Date().toISOString();
    await db
      .from("hr_case")
      .update({
        status: "resolved",
        resolved_at: nu,
        resolution: `Avslutades automatiskt ${slutdatum} när anställningen avslutades. Ingen åtgärd är därmed gjord — kontrollera offboardingchecklistan.`,
      })
      .eq("employee_id", employeeId)
      .is("resolved_at", null);

    for (const arende of oppnaArenden ?? []) {
      await logga(user.employee!.id, "case.closed_by_offboarding", "hr_case", arende.id, {
        employeeId,
        rubrik: arende.subject,
        tidigare_status: arende.status,
      });
    }
  }

  /**
   * Arenden som personen var handlaggare for gar tillbaka till inkorgen.
   *
   * De ror ANDRA anstallda och far darfor inte stangas — men de far inte
   * heller sta kvar tilldelade nagon som inte kan logga in. En tilldelning ar
   * det som avgor vem som anser sig ansvarig, och en kvarglomd sadan ar ett
   * arende som ingen tittar pa fast alla tror att nagon gor det.
   */
  const { data: tilldelade } = await db
    .from("hr_case")
    .select("id")
    .eq("assigned_to", employeeId)
    .is("resolved_at", null);

  if ((tilldelade ?? []).length > 0) {
    await db
      .from("hr_case")
      .update({ assigned_to: null })
      .eq("assigned_to", employeeId)
      .is("resolved_at", null);

    for (const arende of tilldelade ?? []) {
      await logga(user.employee!.id, "case.unassigned_by_offboarding", "hr_case", arende.id, {
        employeeId,
      });
    }
  }

  const { count } = await db
    .from("offboarding_task")
    .select("id", { count: "exact", head: true })
    .eq("employee_id", employeeId);

  if ((count ?? 0) === 0) {
    const punkter = [...CHECKLISTA];
    if (antalOppna > 0) {
      // Forst i listan. Den star dar for att den ar det enda i checklistan som
      // navet sjalvt har andrat pa, och det ska inte behova letas fram.
      punkter.unshift(
        `${antalOppna} öppet personalärende${antalOppna === 1 ? "" : "n"} stängdes automatiskt — kontrollera att inget kräver åtgärd`,
      );
    }
    await db.from("offboarding_task").insert(
      punkter.map((label, i) => ({ employee_id: employeeId, label, sort: i })),
    );
  }

  await logga(user.employee!.id, "employee.offboarded", "employee", employeeId, {
    slutdatum,
    stangda_arenden: antalOppna,
    aterlamnade_arenden: (tilldelade ?? []).length,
  });
  revalidatePath(`/personal/${employeeId}`);
  revalidatePath("/personal");
  revalidatePath("/arenden");
}

// -----------------------------------------------------------------------------
// Radering (0046)
//
// Offboarding och radering ar tva olika beslut och ska forbli det.
// Offboarding stanger dorren och behaller allt — det ar ratt for nagon som
// slutat. Radering tar bort personen — det ar ratt for nagon som lades upp av
// misstag eller aldrig borjade.
//
// Sjalva arbetet ligger i databasen, eftersom det maste ske i EN transaktion
// och behover sla av de 29 sparrtriggrarna pa vagen. Har ligger bara
// behorigheten, bekraftelsen och loggen.
// -----------------------------------------------------------------------------

/**
 * Vad en radering skulle ta med sig.
 *
 * Hamtas nar chefen oppnar rutan, inte nar sidan renderas: svaret kostar en
 * count-fraga per frammande nyckel mot `employee`, och det ar 132 stycken. Att
 * betala det pa varje sidvisning for en knapp som nastan aldrig trycks vore
 * slosaktigt.
 */
export async function hamtaReferenser(employeeId: string): Promise<Referens[]> {
  await kravChef();
  const { data, error } = await supabaseAdmin().rpc("referenser_till_anstalld", {
    p_employee: employeeId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as Referens[];
}

export type RaderingState = { fel?: string };

/**
 * Raderar en anstalld permanent.
 *
 * Bekraftelsen ar personens namn, skrivet for hand. Det ar inte en formalitet:
 * knappen star pa samma sida som "Avsluta anstallning", den gar inte att angra,
 * och for nagon med data bakom sig tar den med sig stamplingar och kursframsteg.
 * En ja/nej-ruta hade klickats bort av samma reflex som oppnade den.
 */
export async function taBortAnstalld(
  _prev: RaderingState,
  form: FormData,
): Promise<RaderingState> {
  try {
    const user = await kravChef();
    const db = supabaseAdmin();

    const employeeId = String(form.get("employee_id") ?? "");
    const bekraftelse = String(form.get("bekraftelse") ?? "");

    const { data: a } = await db
      .from("employee")
      .select("id, first_name, last_name, email, auth_user_id, removed_at")
      .eq("id", employeeId)
      .maybeSingle();

    if (!a) return { fel: "Personen finns inte." };
    if (a.removed_at) return { fel: "Personen är redan borttagen." };

    // Den som raderar sig sjalv loggas ut mitt i sin egen atgard och kan inte
    // sta for den i loggen. `kravChef` slapper igenom det, sa det stoppas har.
    if (a.id === user.employee!.id) return { fel: "Du kan inte ta bort dig själv." };

    const namn = `${a.first_name} ${a.last_name}`.replace(/\s+/g, " ").trim();
    const skrivet = bekraftelse.replace(/\s+/g, " ").trim();
    if (skrivet.toLowerCase() !== namn.toLowerCase()) {
      return { fel: `Skriv ${namn} exakt som det står för att bekräfta.` };
    }

    const { data: svar, error } = await db.rpc("ta_bort_anstalld", { p_employee: employeeId });
    if (error) return { fel: `Personen kunde inte tas bort: ${error.message}` };

    // Kontot i auth tas bort EFTERAT. Gors det forst och raderingen sedan
    // faller star personen kvar i navet utan inloggning och utan nagon rad som
    // forklarar varfor.
    if (a.auth_user_id) {
      await db.auth.admin.deleteUser(a.auth_user_id).catch(() => null);
    }

    /**
     * Loggas efter, och med NAMNET I `meta`.
     *
     * `audit_log.object_id` ar en text utan frammande nyckel och pekar efter
     * det har pa ett id som inte langre finns i `employee`. Loggraden ar
     * alltsa det enda stallet dar det gar att se vem som togs bort, av vem och
     * vad som foljde med. Star namnet inte har star det ingenstans.
     */
    await logga(user.employee!.id, "employee.deleted", "employee", employeeId, {
      namn,
      epost: a.email,
      raderades_helt: svar?.raderades_helt ?? null,
      kvarvarande: svar?.kvarvarande ?? null,
      fore: svar?.fore ?? null,
    });
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }

  // Utanfor try: redirect fungerar genom att kasta, och ett catch runt den
  // hade svalt omdirigeringen och visat ett fel for nagot som lyckades.
  revalidatePath("/personal");
  redirect("/personal");
}

/** AC-1.7: ingen post kan hoppas over utan motivering. */
export async function kvitteraOffboarding(form: FormData): Promise<void> {
  const user = await kravChef();
  const db = supabaseAdmin();
  const taskId = String(form.get("task_id"));
  const employeeId = String(form.get("employee_id"));
  const hoppa = String(form.get("hoppa")) === "1";
  const motivering = String(form.get("motivering") ?? "").trim();

  if (hoppa && !motivering) return;

  await db
    .from("offboarding_task")
    .update({
      state: hoppa ? "skipped" : "done",
      skipped_reason: hoppa ? motivering : null,
      handled_by: user.employee!.id,
      handled_at: new Date().toISOString(),
    })
    .eq("id", taskId);

  await logga(
    user.employee!.id,
    hoppa ? "offboarding.skipped" : "offboarding.done",
    "offboarding_task",
    taskId,
    { employeeId },
    hoppa ? motivering : undefined,
  );
  revalidatePath(`/personal/${employeeId}`);
}

// -----------------------------------------------------------------------------
// Team och organisation (E1.13)
//
// Ett team ar inte bara en etikett. `leads_employee()` i databasen slapper in
// en teamledare pa medlemmarnas rader, sa varje andring har verkar direkt pa
// vem som ser vems personuppgifter. Darfor loggas alla fyra atgarderna.
// -----------------------------------------------------------------------------

export async function skapaTeam(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await kravChef();
  const db = supabaseAdmin();

  const namn = String(form.get("namn") ?? "").trim();
  if (!namn) return { fel: "Teamet behöver ett namn." };

  const { data: fanns } = await db.from("team").select("id").ilike("name", namn).maybeSingle();
  if (fanns) return { fel: "Det finns redan ett team med det namnet." };

  const { data: rad, error } = await db
    .from("team")
    .insert({ name: namn })
    .select("id")
    .single();
  if (error || !rad) return { fel: "Teamet kunde inte skapas." };

  await logga(user.employee!.id, "team.created", "team", rad.id, { namn });
  revalidatePath("/personal/team");
  return { ok: `Teamet ${namn} är skapat.` };
}

/** Namn och teamledare i ett svep — bada ar egenskaper hos teamet. */
export async function sparaTeam(form: FormData): Promise<void> {
  const user = await kravChef();
  const db = supabaseAdmin();

  const teamId = String(form.get("team_id"));
  const namn = String(form.get("namn") ?? "").trim();
  const ledare = String(form.get("lead_id") ?? "") || null;
  if (!teamId || !namn) return;

  await db.from("team").update({ name: namn, lead_id: ledare }).eq("id", teamId);
  await logga(user.employee!.id, "team.updated", "team", teamId, { namn, ledare });
  revalidatePath("/personal/team");
}

/**
 * Bara tomma team gar att ta bort. Alternativet — att slanga ut medlemmarna
 * med teamet — ar en tyst andring av vem som ser vem, och sadant ska man
 * behova gora med berat mod, en person i taget.
 */
export async function taBortTeam(form: FormData): Promise<void> {
  const user = await kravChef();
  const db = supabaseAdmin();

  const teamId = String(form.get("team_id"));
  if (!teamId) return;

  const { count } = await db
    .from("employee")
    .select("id", { count: "exact", head: true })
    .eq("team_id", teamId);
  if ((count ?? 0) > 0) return;

  await db.from("team").delete().eq("id", teamId);
  await logga(user.employee!.id, "team.deleted", "team", teamId);
  revalidatePath("/personal/team");
}

/** Team och narmaste chef for en person. */
export async function sattOrganisation(form: FormData): Promise<void> {
  const user = await kravChef();
  const db = supabaseAdmin();

  const employeeId = String(form.get("employee_id"));
  const teamId = String(form.get("team_id") ?? "") || null;
  const chefId = String(form.get("manager_id") ?? "") || null;
  if (!employeeId) return;

  // En chefskedja som gar i ring later databasen sig gladeligen skriva, och
  // sedan snurrar varje vy som foljer kedjan uppat tills den ger upp.
  if (chefId === employeeId) return;
  if (chefId && (await ledsAv(db, chefId, employeeId))) return;

  await db.from("employee").update({ team_id: teamId, manager_id: chefId }).eq("id", employeeId);
  await logga(user.employee!.id, "employee.org_changed", "employee", employeeId, {
    team: teamId,
    chef: chefId,
  });

  /**
   * EN NY CHEF ANDRAR VEM SOM BESLUTAR OM DIN LEDIGHET.
   *
   * `manager_id` och `team_id` ar inte etiketter pa ett personkort. De styr
   * `leads_employee()` i 0001, alltsa vem som ser dina franvaroansokningar, dina
   * coachningsuppgifter, dina stamplingar och dina rastavvikelser. Att flytta
   * nagon mellan team ar att flytta hela hennes chefsled — och fram till
   * 2026-09-04 markte hon det forst nar nagon annan svarade.
   */
  const [nyChef, nyttTeam] = await Promise.all([
    chefId
      ? db.from("employee").select("first_name, last_name").eq("id", chefId).maybeSingle()
      : Promise.resolve({ data: null }),
    teamId ? db.from("team").select("name").eq("id", teamId).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  await notifiera({
    till: employeeId,
    av: user.employee!.id,
    kalla: "konto-organisation",
    typ: "konto",
    rubrik: nyChef.data
      ? `${nyChef.data.first_name} ${nyChef.data.last_name} är din nya chef`
      : "Din organisationstillhörighet har ändrats",
    detalj: nyttTeam.data?.name
      ? `Team ${nyttTeam.data.name} · din chef beslutar om ledighet och coachning`
      : "Se personkortet för vem som är din chef",
    href: `/personal/${employeeId}`,
    objekt: { typ: "employee", id: employeeId },
  });

  revalidatePath(`/personal/${employeeId}`);
  revalidatePath("/personal/team");
}

/** Leder `rot` till slut fram till `sokt` uppat i chefskedjan? */
async function ledsAv(
  db: ReturnType<typeof supabaseAdmin>,
  start: string,
  sokt: string,
): Promise<boolean> {
  let aktuell: string | null = start;
  for (let steg = 0; aktuell && steg < 20; steg++) {
    if (aktuell === sokt) return true;
    const svar: { data: { manager_id: string | null } | null } = await db
      .from("employee")
      .select("manager_id")
      .eq("id", aktuell)
      .maybeSingle();
    aktuell = svar.data?.manager_id ?? null;
  }
  return false;
}

/**
 * AC-13.13. Lonekostnadsbehorigheten ges per person, aldrig per roll — PRD
 * §1.4 varnar uttryckligen for att knyta den till `admin`, eftersom den som
 * far hjalpa till med IT da automatiskt ser allas ersattning.
 *
 * Darfor racker det inte att fa hantera personal: bara saljchef och VD far
 * dela ut den. En teknisk administrator kan alltsa inte ge den till sig sjalv.
 */
export async function andraBehorighet(form: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!hasRole(user, "sales_manager", "ceo") || !user?.employee) {
    throw new Error("Bara säljchef och VD får dela ut lönekostnadsbehörigheten.");
  }

  const db = supabaseAdmin();
  const employeeId = String(form.get("employee_id"));
  const behorighet = String(form.get("behorighet"));
  const pa = String(form.get("pa")) === "1";

  if (!PERMISSIONS.includes(behorighet as Permission)) return;

  if (pa) {
    await db.from("employee_permission").upsert({
      employee_id: employeeId,
      permission: behorighet,
      granted_by: user.employee.id,
    });
  } else {
    await db
      .from("employee_permission")
      .delete()
      .eq("employee_id", employeeId)
      .eq("permission", behorighet);
  }

  await logga(
    user.employee.id,
    pa ? "permission.granted" : "permission.revoked",
    "employee",
    employeeId,
    { behorighet },
  );

  // Samma skal som rollbytet ovan. Lonekostnadsbehorigheten oppnar en vy med
  // andras loner i — den som far den ska veta om det, och den som blir av med
  // den ska veta varfor vyn forsvann.
  await notifiera({
    till: employeeId,
    av: user.employee.id,
    kalla: "konto-behorighet",
    typ: "konto",
    rubrik: pa
      ? `Du har fått behörigheten ${PERMISSION_LABEL[behorighet as Permission]}`
      : `Behörigheten ${PERMISSION_LABEL[behorighet as Permission]} är borttagen`,
    detalj: pa ? "Den öppnar en ny vy för dig" : "Vyn den öppnade är stängd igen",
    href: `/personal/${employeeId}`,
    objekt: { typ: "employee", id: employeeId },
  });

  revalidatePath(`/personal/${employeeId}`);
}

/**
 * E10.9 / AC-1.7: ingen post i onboarding-checklistan kan hoppas over utan
 * motivering. Tvillingen till `kvitteraOffboarding` ovan.
 *
 * Kretsen ar chefens och inte rekryterarens. Punkterna handlar om utrustning,
 * behorigheter och introduktion — det ar personalansvar, inte rekrytering, och
 * en `recruiter` utan ledningsroll har inget dar att gora.
 */
export async function kvitteraOnboarding(form: FormData): Promise<void> {
  const user = await kravChef();
  const db = supabaseAdmin();
  const taskId = String(form.get("task_id"));
  const employeeId = String(form.get("employee_id"));
  const hoppa = String(form.get("hoppa")) === "1";
  const motivering = String(form.get("motivering") ?? "").trim();

  if (hoppa && !motivering) return;

  await db
    .from("onboarding_task")
    .update({
      state: hoppa ? "skipped" : "done",
      skipped_reason: hoppa ? motivering : null,
      handled_by: user.employee!.id,
      handled_at: new Date().toISOString(),
    })
    .eq("id", taskId);

  await logga(
    user.employee!.id,
    hoppa ? "onboarding.skipped" : "onboarding.done",
    "onboarding_task",
    taskId,
    { employeeId },
    hoppa ? motivering : undefined,
  );
  revalidatePath(`/personal/${employeeId}`);
}
