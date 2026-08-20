"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser, canManageEmployees, hasRole } from "@/lib/auth";
import { ROLES, PERMISSIONS, type Role, type Permission } from "@/lib/roles";
import { riktarSigTill } from "@/lib/dokument";
import { nyttTillfalligtLosenord } from "@/lib/losenord";
import { FLAGGA } from "@/lib/losenordsbyte";

/**
 * Markerar att kontot maste byta losenord vid nasta inloggning.
 *
 * Las-andra-skriv i stallet for en rak skrivning: GoTrue slar visserligen
 * ihop nycklarna i `app_metadata`, men dar ligger ocksa `provider` och
 * `providers` som auth sjalv ager. Skulle beteendet nagon gang bli "ersatt"
 * i stallet for "sla ihop" vore priset ett konto som inte gar att logga in
 * pa, och det ar inte vart att spara en fraga pa.
 */
async function kravByte(db: ReturnType<typeof supabaseAdmin>, authUserId: string) {
  const { data } = await db.auth.admin.getUserById(authUserId);
  await db.auth.admin.updateUserById(authUserId, {
    app_metadata: { ...(data?.user?.app_metadata ?? {}), [FLAGGA]: true },
  });
}

export type FormState = {
  fel?: string;
  ok?: string;
  /** Visas en gang for chefen och sparas ingenstans. Se laggUppAnstalld. */
  losenord?: string;
  anstalldId?: string;
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

/** AC-1.3: en anstalld laggs upp en gang och far allt tilldelat. */
export async function laggUppAnstalld(_prev: FormState, form: FormData): Promise<FormState> {
  let nyId: string;
  let namn: string;
  let losenord: string;
  try {
    const user = await kravChef();
    const db = supabaseAdmin();

    const epost = String(form.get("epost") ?? "").trim().toLowerCase();
    const fornamn = String(form.get("fornamn") ?? "").trim();
    const efternamn = String(form.get("efternamn") ?? "").trim();
    const roll = String(form.get("roll") ?? "salesperson") as Role;
    const anstallningsform = String(form.get("anstallningsform") ?? "permanent");
    const startdatum = String(form.get("startdatum") ?? "") || null;
    const anstallningsnummer = String(form.get("anstallningsnummer") ?? "").trim() || null;
    const teamId = String(form.get("team_id") ?? "") || null;

    if (!epost || !fornamn || !efternamn) return { fel: "Namn och e-post måste fyllas i." };
    if (!ROLES.includes(roll)) return { fel: "Okänd roll." };

    const { data: fanns } = await db.from("employee").select("id").eq("email", epost).maybeSingle();
    if (fanns) return { fel: "Det finns redan en anställd med den e-postadressen." };

    // Auth-konto forst. Utan katalogtjanst ar navet identitetskallan (§1.7).
    //
    // Kontot far ett tillfalligt losenord direkt. Sa lange navet inte mejlar
    // finns ingen annan vag in: en magisk lank kraver ett fungerande utskick,
    // och ett konto utan losenord ar ett konto ingen kan logga in pa.
    losenord = nyttTillfalligtLosenord();

    const { data: skapad, error: authFel } = await db.auth.admin.createUser({
      email: epost,
      password: losenord,
      email_confirm: true,
      user_metadata: { fornamn, efternamn },
      // Ordet gar fran chef till anstalld muntligt. Det ar alltsa kant av tva
      // fran forsta sekunden, och da ar det inte ett losenord an — det ar en
      // nyckel till dorren dar man byter las.
      app_metadata: { [FLAGGA]: true },
    });

    let authUserId = skapad?.user?.id ?? null;
    if (authFel) {
      const { data: lista } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
      authUserId = lista?.users.find((u) => u.email?.toLowerCase() === epost)?.id ?? null;
      if (!authUserId) return { fel: `Kontot kunde inte skapas: ${authFel.message}` };

      // Kontot fanns redan i auth utan att ha en rad i personalregistret.
      // Losenordet maste sattas anda, annars visar vi ett ord som inte gar in.
      const { error: satFel } = await db.auth.admin.updateUserById(authUserId, {
        password: losenord,
      });
      if (satFel) return { fel: `Lösenordet kunde inte sättas: ${satFel.message}` };
      await kravByte(db, authUserId);
    }

    const { data: rad, error: dbFel } = await db
      .from("employee")
      .insert({
        auth_user_id: authUserId,
        email: epost,
        first_name: fornamn,
        last_name: efternamn,
        employment_type: anstallningsform,
        start_date: startdatum,
        employee_number: anstallningsnummer,
        team_id: teamId,
        status: "onboarding",
      })
      .select("id")
      .single();

    if (dbFel || !rad) return { fel: `Kunde inte spara: ${dbFel?.message ?? "okänt fel"}` };

    await db.from("employee_role").insert({
      employee_id: rad.id,
      role: roll,
      granted_by: user.employee!.id,
    });

    await logga(user.employee!.id, "employee.created", "employee", rad.id, { epost, roll, team: teamId });

    // AC-1.3: rutinerna tilldelas av malgruppen, inte av en kopia per person.
    // Det som saknades var beviset — utan en rad i loggen gar det inte att i
    // efterhand visa vad en nyanstalld faktiskt fick pa sig fran dag ett.
    const { data: dokument } = await db
      .from("document")
      .select("id, slug, audience_roles, audience_teams")
      .eq("status", "published")
      .eq("requires_ack", true);

    const tilldelade = (dokument ?? []).filter((d) => riktarSigTill(d, [roll], teamId));
    if (tilldelade.length > 0) {
      await logga(user.employee!.id, "onboarding.documents_assigned", "employee", rad.id, {
        antal: tilldelade.length,
        rutiner: tilldelade.map((d) => d.slug),
      });
    }

    // AC-6.4: kurserna foljer samma modell som rutinerna — malgruppen avgor,
    // och loggen ar beviset pa vad som gallde vid anstallningen.
    const { data: kurser } = await db
      .from("course")
      .select("id, slug, audience_roles")
      .eq("status", "published");

    const kursTilldelade = (kurser ?? []).filter((k) =>
      riktarSigTill({ audience_roles: k.audience_roles, audience_teams: [] }, [roll], teamId),
    );
    if (kursTilldelade.length > 0) {
      await logga(user.employee!.id, "onboarding.courses_assigned", "employee", rad.id, {
        antal: kursTilldelade.length,
        kurser: kursTilldelade.map((k) => k.slug),
      });
    }

    nyId = rad.id;
    namn = `${fornamn} ${efternamn}`;
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }

  revalidatePath("/personal");

  // Ingen omdirigering langre. Losenordet visas en gang, och det gar inte att
  // gora pa nasta sida utan att skicka ordet i en URL — dar det hamnar i
  // webbhistorik, i Vercels loggar och i varje mellanliggande proxy.
  return { ok: `${namn} är upplagd.`, losenord, anstalldId: nyId };
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
  revalidatePath(`/personal/${employeeId}`);
}

export async function aktivera(form: FormData): Promise<void> {
  const user = await kravChef();
  const db = supabaseAdmin();
  const employeeId = String(form.get("employee_id"));

  await db.from("employee").update({ status: "active" }).eq("id", employeeId);
  await logga(user.employee!.id, "employee.activated", "employee", employeeId);
  revalidatePath(`/personal/${employeeId}`);
}

/**
 * AC-1.4: offboarding satter status och end_date, aterkallar alla roller,
 * invaliderar samtliga sessioner omedelbart och behaller historiken.
 * AC-1.7: checklista med kvittens genereras automatiskt.
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

  const { count } = await db
    .from("offboarding_task")
    .select("id", { count: "exact", head: true })
    .eq("employee_id", employeeId);

  if ((count ?? 0) === 0) {
    await db.from("offboarding_task").insert(
      CHECKLISTA.map((label, i) => ({ employee_id: employeeId, label, sort: i })),
    );
  }

  await logga(user.employee!.id, "employee.offboarded", "employee", employeeId, { slutdatum });
  revalidatePath(`/personal/${employeeId}`);
  revalidatePath("/personal");
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
  revalidatePath(`/personal/${employeeId}`);
}
