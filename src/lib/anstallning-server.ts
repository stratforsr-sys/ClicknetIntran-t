import { supabaseAdmin } from "@/lib/supabase/server";
import { riktarSigTill } from "@/lib/dokument";
import { gallandeSchema } from "@/lib/raster";
import { nyttTillfalligtLosenord } from "@/lib/losenord";
import { FLAGGA } from "@/lib/losenordsbyte";
import { ROLES, type Role } from "@/lib/roles";

/**
 * Att lagga upp en anstalld: konto, rad i personalregistret, roll, rutiner och
 * kurser.
 *
 * ===========================================================================
 * VARFOR DEN LIGGER HAR OCH INTE I EN SERVER ACTION
 *
 * Tva vagar leder hit. Chefen som lagger upp nagon for hand pa /personal/ny,
 * och rekryteringens anstallningsflode (E10.9) nar en kandidat gar till
 * `hired`. Bada maste skapa ett auth-konto.
 *
 * Skulle koden ligga i den ena av dem hade den andra antingen anropat en
 * server action fran en server action, eller — troligare — fatt en egen kopia.
 * Tva stallen som skapar inloggningar glider isar, och det ar den sortens
 * glidning som slutar med att det ena stallet glommer `byt_losenord`-flaggan.
 *
 * Filen bar INTE `"use server"`. Allt som exporteras ur en sadan blir en publik
 * andpunkt — se rubriken i src/lib/toast-server.ts. Har ar `laggUppAnstalld` en
 * vanlig funktion som bara nas av kod som redan kontrollerat behorigheten.
 * ===========================================================================
 *
 * BEHORIGHETEN KONTROLLERAS INTE HAR. Anroparen har redan gjort det — chefen
 * via `canManageEmployees`, rekryteringen via `far_rekrytera()`-kretsen — och
 * de tva kretsarna ar olika. En kontroll pa det har djupet hade darfor antingen
 * varit fel for den ena eller sa bred att den inte sagt nagot.
 */

export type Nyanstalld = {
  epost: string;
  fornamn: string;
  efternamn: string;
  roll: Role;
  anstallningsform: string;
  startdatum: string | null;
  anstallningsnummer: string | null;
  teamId: string | null;
};

export type Anstallningsresultat =
  | { fel: string }
  | {
      employeeId: string;
      /** Visas EN gang for den som lade upp personen. Sparas ingenstans. */
      losenord: string;
      /** Slugarna, for loggen och for kvittot till chefen. */
      rutiner: string[];
      kurser: string[];
      /**
       * Vilka veckodagar personen har en arbetstid pa fran dag ett.
       *
       * Tom lista betyder att INGET schema galler — se `schemaFor()`. Det ar
       * ett besked chefen behover, inte ett tomt varde att tiga om.
       */
      schemadagar: number[];
    };

async function logga(
  actorId: string,
  action: string,
  objectId: string,
  meta?: Record<string, unknown>,
) {
  await supabaseAdmin().from("audit_log").insert({
    actor_id: actorId,
    action,
    object_type: "employee",
    object_id: objectId,
    meta: meta ?? null,
  });
}

/**
 * AC-1.3: en anstalld laggs upp en gang och far allt tilldelat.
 *
 * Ordningen ar inte godtycklig. Auth-kontot forst, eftersom `employee.
 * auth_user_id` pekar pa det — och ett konto utan personalrad ar ofarligt
 * medan en personalrad utan konto ar nagon som inte kan logga in.
 */
export async function laggUppAnstalld(
  uppgifter: Nyanstalld,
  utfordAv: string,
): Promise<Anstallningsresultat> {
  const db = supabaseAdmin();
  const { epost, fornamn, efternamn, roll, teamId } = uppgifter;

  if (!epost || !fornamn || !efternamn) return { fel: "Namn och e-post måste fyllas i." };
  if (!ROLES.includes(roll)) return { fel: "Okänd roll." };

  const { data: fanns } = await db.from("employee").select("id").eq("email", epost).maybeSingle();
  if (fanns) return { fel: "Det finns redan en anställd med den e-postadressen." };

  // Auth-konto forst. Utan katalogtjanst ar navet identitetskallan (§1.7).
  //
  // Kontot far ett tillfalligt losenord direkt. Sa lange navet inte mejlar
  // finns ingen annan vag in: en magisk lank kraver ett fungerande utskick,
  // och ett konto utan losenord ar ett konto ingen kan logga in pa.
  const losenord = nyttTillfalligtLosenord();

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
    const { error: satFel } = await db.auth.admin.updateUserById(authUserId, { password: losenord });
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
      employment_type: uppgifter.anstallningsform,
      start_date: uppgifter.startdatum,
      employee_number: uppgifter.anstallningsnummer,
      team_id: teamId,
      status: "onboarding",
    })
    .select("id")
    .single();

  if (dbFel || !rad) return { fel: `Kunde inte spara: ${dbFel?.message ?? "okänt fel"}` };

  await db.from("employee_role").insert({
    employee_id: rad.id,
    role: roll,
    granted_by: utfordAv,
  });

  await logga(utfordAv, "employee.created", rad.id, { epost, roll, team: teamId });

  // AC-1.3: rutinerna tilldelas av malgruppen, inte av en kopia per person.
  // Det som saknades var beviset — utan en rad i loggen gar det inte att i
  // efterhand visa vad en nyanstalld faktiskt fick pa sig fran dag ett.
  const { data: dokument } = await db
    .from("document")
    .select("id, slug, audience_roles, audience_teams")
    .eq("status", "published")
    .eq("requires_ack", true);

  const rutiner = (dokument ?? []).filter((d) => riktarSigTill(d, [roll], teamId)).map((d) => d.slug);
  if (rutiner.length > 0) {
    await logga(utfordAv, "onboarding.documents_assigned", rad.id, {
      antal: rutiner.length,
      rutiner,
    });
  }

  // AC-6.4: kurserna foljer samma modell som rutinerna — malgruppen avgor,
  // och loggen ar beviset pa vad som gallde vid anstallningen.
  const { data: kurslista } = await db
    .from("course")
    .select("id, slug, audience_roles")
    .eq("status", "published");

  const kurser = (kurslista ?? [])
    .filter((k) => riktarSigTill({ audience_roles: k.audience_roles, audience_teams: [] }, [roll], teamId))
    .map((k) => k.slug);

  if (kurser.length > 0) {
    await logga(utfordAv, "onboarding.courses_assigned", rad.id, {
      antal: kurser.length,
      kurser,
    });
  }

  // E1.5 / AC-1.3: arbetstiden. Se `schemaFor()` for varfor ingen rad skrivs.
  const schema = await schemaFor(db, rad.id, teamId, uppgifter.startdatum);
  await logga(utfordAv, "onboarding.schedule_assigned", rad.id, schema.meta);

  return { employeeId: rad.id, losenord, rutiner, kurser, schemadagar: schema.dagar };
}

/**
 * E1.5 / AC-1.3: vilket schema som galler for en nyanstalld.
 *
 * ===========================================================================
 * INGEN RAD SKRIVS, OCH DET AR SJALVA TILLDELNINGEN
 *
 * ROADMAP sa lange att schemadelen av E1.5 "vantar pa E4". Nar E4 val fanns
 * visade det sig att det inte fanns nagot att bygga: `work_schedule` har
 * scope `company`, `team` och `employee`, och `gallandeSchema()` valjer den
 * mest specifika som finns. Bolagsschemat galler alltsa varje nyanstalld fran
 * dag ett utan att nagon rad kopieras.
 *
 * Det ar samma modell som rutinerna: malgruppen avgor, inte en kopia per
 * person. En rad per anstalld hade dessutom varit direkt skadlig — ett schema
 * andras genom att en NY rad laggs med nytt `valid_from` (AC-2.35), och
 * tjugofem personliga kopior hade gjort en andring till tjugofem andringar
 * som glider isar.
 *
 * DET SOM SAKNADES VAR BEVISET. Rutiner och kurser skriver var sin rad i
 * loggen med motiveringen att det annars inte gar att i efterhand visa vad en
 * nyanstalld faktiskt fick pa sig fran dag ett. Arbetstiden — den enda av de
 * fyra som far loneeffekt — skrev ingenting alls.
 *
 * OCH TOMMA LISTAN AR ETT BESKED. Finns inget bolagsschema har personen ingen
 * arbetstid att matas mot: ingen sen ankomst, ingen utebliven instampling,
 * inga rastavvikelser. Det ser i varje vy ut som att allt ar i sin ordning.
 * Darfor skrivs raden aven da, med `dagar: []`, och chefen far se det pa
 * kvittot.
 * ===========================================================================
 */
async function schemaFor(
  db: ReturnType<typeof supabaseAdmin>,
  employeeId: string,
  teamId: string | null,
  startdatum: string | null,
): Promise<{ dagar: number[]; meta: Record<string, unknown> }> {
  // Fran startdatumet om det finns — ett schema som borjar gälla senare an
  // personens forsta dag ar inte hennes schema. Annars i dag.
  const datum = startdatum ?? new Date().toISOString().slice(0, 10);

  const { data } = await db
    .from("work_schedule")
    .select("scope, employee_id, team_id, weekday, start_time, end_time, valid_from")
    .lte("valid_from", datum);

  const rader = data ?? [];
  const dagar: number[] = [];
  let scope: string | null = null;
  let tider: string | null = null;

  // En veckodag i taget: `gallandeSchema()` valjer mest specifika niva, och
  // den kan skilja sig mellan dagarna.
  for (const weekday of [1, 2, 3, 4, 5, 6, 7]) {
    const traff = gallandeSchema(
      rader.filter((r) => r.weekday === weekday),
      employeeId,
      teamId,
      datum,
    )[0];
    if (!traff) continue;
    dagar.push(weekday);
    scope ??= traff.scope;
    tider ??= `${String(traff.start_time).slice(0, 5)}-${String(traff.end_time).slice(0, 5)}`;
  }

  return {
    dagar,
    meta: { dagar, scope, tider, galler_fran: datum, antal: dagar.length },
  };
}

/**
 * Markerar att kontot maste byta losenord vid nasta inloggning.
 *
 * Las-andra-skriv i stallet for en rak skrivning: GoTrue slar visserligen
 * ihop nycklarna i `app_metadata`, men dar ligger ocksa `provider` och
 * `providers` som auth sjalv ager. Skulle beteendet nagon gang bli "ersatt"
 * i stallet for "sla ihop" vore priset ett konto som inte gar att logga in
 * pa, och det ar inte vart att spara en fraga pa.
 */
export async function kravByte(db: ReturnType<typeof supabaseAdmin>, authUserId: string) {
  const { data } = await db.auth.admin.getUserById(authUserId);
  await db.auth.admin.updateUserById(authUserId, {
    app_metadata: { ...(data?.user?.app_metadata ?? {}), [FLAGGA]: true },
  });
}
