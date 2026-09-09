import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser, hasRole, fullName } from "@/lib/auth";

/**
 * Underlag till redaktorsformularet. Ligger utanfor actions.ts med flit: en
 * "use server"-fil exponerar varje export som en anropbar endpoint, och listan
 * over samtliga anstallda ska inte ga att hamta pa det sattet. Har kravs i
 * stallet att anroparen ar en serverkomponent som redan passerat kravRedaktor.
 */
export async function redaktorsunderlag(): Promise<{
  agare: { id: string; namn: string }[];
  personer: { id: string; namn: string }[];
  kategorier: string[];
}> {
  const user = await getCurrentUser();
  if (!user?.employee) return { agare: [], personer: [], kategorier: [] };

  const db = supabaseAdmin();
  const jag = user.employee.id;

  // Bara ledningen far valja nagon annan an sig sjalv som agare. En agare som
  // redigerar sitt eget dokument ska inte kunna skjuta over ansvaret pa en
  // kollega utan att den som styr dokumenten vet om det.
  const fullVy = hasRole(user, "sales_manager", "admin", "ceo");
  const arTeamledare = hasRole(user, "team_lead");

  // Listan hamtas ocksa for en teamledare, som inte har full vy. Den lamnar
  // aldrig servern osallad — nedan gallras den till hennes egna, precis som
  // `leads_employee()` i 0001 gor i databasen.
  const { data: aktiva } =
    fullVy || arTeamledare
      ? await db
          .from("employee")
          .select("id, first_name, last_name, team_id, manager_id")
          .eq("status", "active")
          .order("first_name")
      : { data: null };

  const agare = fullVy
    ? (aktiva ?? []).map((a) => ({ id: a.id, namn: fullName(a) }))
    : [{ id: jag, namn: fullName(user.employee) }];

  /**
   * Vem som gar att peka ut som personlig mottagare.
   *
   * Ledningen far peka ut vem som helst. En TEAMLEDARE far peka ut sina egna —
   * och det ar inte en generositet utan hela poangen med funktionen: manuset
   * ar det en teamledare skriver at en saljare hon coachar. Regeln ar samma som
   * `leads_employee()` i 0001: den man ar chef for, eller den som sitter i ett
   * team man leder.
   *
   * Alla andra far en tom lista. En agare utan chefsroll som redigerar sitt eget
   * dokument ska inte kunna rikta om det till nagon annan — och redaktorn later
   * da personvalet sta orort i stallet for att tomma det, se Redaktor.tsx.
   */
  let personer: { id: string; namn: string }[] = [];
  if (fullVy) {
    personer = (aktiva ?? []).map((a) => ({ id: a.id, namn: fullName(a) }));
  } else if (arTeamledare) {
    const { data: team } = await db.from("team").select("id").eq("lead_id", jag);
    const minaTeam = new Set((team ?? []).map((t) => t.id));
    personer = (aktiva ?? [])
      .filter((a) => a.manager_id === jag || (a.team_id && minaTeam.has(a.team_id)))
      .map((a) => ({ id: a.id, namn: fullName(a) }));
  }

  const { data: kat } = await db
    .from("document")
    .select("category_path")
    .neq("category_path", "")
    .order("category_path");

  return {
    agare,
    personer,
    kategorier: [...new Set((kat ?? []).map((k) => k.category_path).filter(Boolean))],
  };
}

/**
 * Namn pa anstallda som redan star i ett dokument anroparen fatt lasa — agaren,
 * och sedan 0051 ocksa den personliga malgruppen. En saljare far via RLS bara
 * lasa sin egen employee-rad, sa utan den har genvagen skulle listan sta "okand
 * agare" for alla utom en, och da vet ingen vem man ska fraga.
 *
 * BARA NAMNET lamnas ut, och bara for id:n anroparen redan har. Funktionen ar
 * darfor inte en vag till personallistan for den som inte far se den — men den
 * far heller aldrig anropas med id:n som kommer fran klienten.
 *
 * Het `namnFor` och inte `agarnamn` sedan 2026-09-09: den slar upp mottagare
 * ocksa, och ett namn som ljuger om vad funktionen gor blir forr eller senare
 * ett anrop nagon undviker for att det lat fel.
 */
export async function namnFor(ids: string[]): Promise<Map<string, string>> {
  const unika = [...new Set(ids.filter(Boolean))];
  if (unika.length === 0) return new Map();
  const { data } = await supabaseAdmin()
    .from("employee")
    .select("id, first_name, last_name")
    .in("id", unika);
  return new Map((data ?? []).map((a) => [a.id, fullName(a)]));
}

/**
 * AC-12.5: rakna visningar, inte logga varje oppning.
 *
 * ===========================================================================
 * VARFOR DEN LIGGER HAR OCH INTE I actions.ts
 *
 * Den lag dar till 2026-08-26, och var darmed en PUBLIK ANDPUNKT — allt som
 * exporteras ur en `"use server"`-fil far ett id och tar emot anrop fran
 * webblasaren. Signaturen var `(dokumentId, employeeId)` och kroppen skrev med
 * service role utan en enda kontroll.
 *
 * Foljden: vem som helst kunde skriva en rad som pastod att VILKEN anstalld som
 * helst last VILKET dokument som helst, och rakna upp raknaren hur mycket som
 * helst. `document_view` ar inte en likgiltig tabell — den heter "Lasta rutiner"
 * i registerutdraget (artikel 15) och ar underlaget for `adoption_glomda_dokument`.
 * En arbetsmiljorutin som ser last ut for att nagon skickat ett anrop ar precis
 * det uppgiften finns for att motbevisa.
 *
 * Det ar tredje gangen samma fel: `skrivFel` 22 augusti, `sattKvitto` natten
 * till 24 augusti. Mottet ar detsamma bada gangerna — flytta ut ur
 * `"use server"`-filen — och den har filen fanns redan for just det andamalet.
 *
 * PERSONEN KOMMER NU UR SESSIONEN och inte ur ett argument. Aven om nagon
 * exporterar den harifran till en actions-fil igen gar den inte att peka mot
 * nagon annan.
 * ===========================================================================
 */
export async function registreraVisning(dokumentId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user?.employee) return;
  const employeeId = user.employee.id;

  const db = supabaseAdmin();
  const { data } = await db
    .from("document_view")
    .select("views")
    .eq("document_id", dokumentId)
    .eq("employee_id", employeeId)
    .maybeSingle();

  if (data) {
    await db
      .from("document_view")
      .update({ last_seen: new Date().toISOString(), views: data.views + 1 })
      .eq("document_id", dokumentId)
      .eq("employee_id", employeeId);
  } else {
    await db.from("document_view").insert({ document_id: dokumentId, employee_id: employeeId });
  }
}
