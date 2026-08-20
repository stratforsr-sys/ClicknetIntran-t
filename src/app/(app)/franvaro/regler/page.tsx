import Link from "next/link";
import { redirect } from "next/navigation";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, fullName, hasRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { ROLES, ROLE_LABEL } from "@/lib/roles";
import { REGELFALT, TYPFALT } from "@/lib/franvaro-server";
import type { Franvarotyp, Regelverk } from "@/lib/franvaro";
import { Regelvyer } from "./Regelvyer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Frånvaroregler — Clicknet Nav" };

/**
 * E7.17 / AC-3.11: reglerna konfigureras i gränssnittet.
 *
 * Det här är den enda platsen där frånvaroreglerna kan ändras. Det finns
 * ingen konstant i koden och ingen miljövariabel — se E7.15 och rubriken i
 * migration 0019. Ändrar du något här ändras vad regelmotorn dömer efter i
 * samma stund, och den anställda ser den nya texten på ansökningssidan.
 */
export default async function Reglersida() {
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
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href="/franvaro"
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Tillbaka till frånvaro
      </Link>

      <div>
        <h1 className="text-display text-ink-900">Frånvaroregler</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Reglerna bor i databasen och inte i koden. Ändrar du ett tal här gäller det direkt, både
          för regelmotorn och för texten den anställda ser innan hen skickar in. Varje ändring
          hamnar i händelseloggen.
        </p>
        <p className="mt-2 max-w-[70ch] text-small text-ink-500">
          Värdena som står nu är <strong>semesterlagens och LAS miniminivå</strong>. A2 besvarades
          2026-08-20 med att kollektivavtal saknas. Tecknas ett avtal är det de här raderna som ska
          ändras.
        </p>
      </div>

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
