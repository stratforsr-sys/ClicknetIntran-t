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
  kategorier: string[];
}> {
  const user = await getCurrentUser();
  if (!user?.employee) return { agare: [], kategorier: [] };

  const db = supabaseAdmin();

  // Bara ledningen far valja nagon annan an sig sjalv som agare. En agare som
  // redigerar sitt eget dokument ska inte kunna skjuta over ansvaret pa en
  // kollega utan att den som styr dokumenten vet om det.
  const fullVy = hasRole(user, "sales_manager", "admin", "ceo");

  const { data: anstallda } = fullVy
    ? await db
        .from("employee")
        .select("id, first_name, last_name")
        .eq("status", "active")
        .order("first_name")
    : { data: [{ id: user.employee.id, first_name: user.employee.first_name, last_name: user.employee.last_name }] };

  const { data: kat } = await db
    .from("document")
    .select("category_path")
    .neq("category_path", "")
    .order("category_path");

  return {
    agare: (anstallda ?? []).map((a) => ({ id: a.id, namn: fullName(a) })),
    kategorier: [...new Set((kat ?? []).map((k) => k.category_path).filter(Boolean))],
  };
}

/**
 * Namn pa dokumentagare. En saljare far via RLS bara lasa sin egen
 * employee-rad, sa utan den har genvagen skulle listan sta "okand agare" for
 * alla utom en — och da vet ingen vem man ska fraga. Bara namnet lamnas ut,
 * och bara for id:n som redan finns i dokument anroparen har fatt lasa.
 */
export async function agarnamn(ids: string[]): Promise<Map<string, string>> {
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
