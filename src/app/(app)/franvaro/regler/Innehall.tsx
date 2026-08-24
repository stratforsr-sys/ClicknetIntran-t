import { redirect } from "next/navigation";
import { getCurrentUser, fullName, hasRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { ROLES, ROLE_LABEL } from "@/lib/roles";
import { REGELFALT, TYPFALT } from "@/lib/franvaro-server";
import type { Franvarotyp, Regelverk } from "@/lib/franvaro";
import { Regelvyer } from "./Regelvyer";

/**
 * E7.17 / AC-3.11: reglerna konfigureras i gränssnittet.
 *
 * Det här är den enda platsen där frånvaroreglerna kan ändras. Det finns
 * ingen konstant i koden och ingen miljövariabel — se E7.15 och rubriken i
 * migration 0019. Ändrar du något här ändras vad regelmotorn dömer efter i
 * samma stund, och den anställda ser den nya texten på ansökningssidan.
 *
 * INNEHALLET, UTAN SIDHUVUD.
 *
 * Ligger for sig eftersom det ritas pa TVA stallen: som helsida pa
 * /franvaro/regler och som panel i installningsrutan. Rubriken och tillbakalanken
 * hor bara till sidan — i rutan star namnet redan i rutans topprad, och en
 * tillbakalank inne i en modal pekar at ett hall som inte finns.
 *
 * BEHORIGHETEN KONTROLLERAS HAR och inte hos anroparen. Bada vagarna in ar
 * publika adresser, och en kontroll som ligger i sidan ovanfor ar en
 * kontroll som nasta vag in glommer.
 */
export async function RegelInnehall() {
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");
  if (!hasRole(user, "sales_manager", "ceo", "admin")) redirect("/franvaro");

  const db = supabaseAdmin();

  const [{ data: policy }, { data: typer }, { data: sparrar }, { data: tak }, { data: team }, { data: ordning }, { data: personal }] =
    await Promise.all([
      db.from("absence_policy").select(REGELFALT).maybeSingle(),
      db.from("absence_type").select(TYPFALT).order("sort"),
      db.from("absence_blackout").select("id, label, starts_on, ends_on, type_ids, team_ids").order("starts_on"),
      db.from("staffing_cap").select("id, team_id, max_absent"),
      db.from("team").select("id, name").order("name"),
      db.from("absence_call_order").select("id, sort, target_kind, role, employee_id, phone, team_id").order("sort"),
      db.from("employee").select("id, first_name, last_name").neq("status", "offboarded").order("first_name"),
    ]);

  return (
    <div className="flex flex-col gap-4">
      <Regelvyer
        policy={policy as Regelverk}
        typer={(typer ?? []) as Franvarotyp[]}
        sparrar={sparrar ?? []}
        tak={tak ?? []}
        team={team ?? []}
        ordning={ordning ?? []}
        personal={(personal ?? []).map((p) => ({ id: p.id, namn: fullName(p) }))}
        roller={ROLES.map((r) => ({ id: r, label: ROLE_LABEL[r] }))}
      />
    </div>
  );
}
