import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, fullName, hasRole } from "@/lib/auth";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { svensktDatum } from "@/lib/klocka";
import { dagarMellan, omfattning, periodtext } from "@/lib/franvaro";
import { farBesluta } from "@/lib/franvaro-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Att besluta — Clicknet Nav" };

/**
 * Chefens kö (E7.1, AC-3.12).
 *
 * Vilka rader som syns avgörs av RLS: teamledaren ser sitt folk genom
 * `leads_employee`, ledningen ser alla. Filtret nedan tar bort det som ligger
 * över den inloggades attestnivå — en teamledare ska inte se studieledighet
 * som VD ska besluta om, för den posten går hen ändå inte att göra något åt,
 * och en kö med rader man inte kan röra slutar man titta i.
 *
 * Den egna ansökan filtreras bort. Ingen beslutar om sin egen ledighet, och
 * det är en spärr i handlingen också.
 */
export default async function Attestko() {
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");

  const supabase = await supabaseServer();
  const db = supabaseAdmin();

  const [{ data: ansokningar }, { data: typer }] = await Promise.all([
    supabase
      .from("absence_request")
      .select("id, employee_id, type_id, starts_on, ends_on, part_day_minutes, submitted_at, rules_broken")
      .eq("status", "submitted")
      .order("starts_on"),
    supabase.from("absence_type").select("id, label, approval_level"),
  ]);

  const typkarta = new Map((typer ?? []).map((t) => [t.id, t]));

  // Vem den inloggade leder. Samma fråga som `leads_employee()`, men i en
  // enda fråga i stället för en per rad.
  const [{ data: minaTeam }, { data: minaDirekt }] = await Promise.all([
    db.from("team").select("id").eq("lead_id", user.employee.id),
    db.from("employee").select("id").eq("manager_id", user.employee.id),
  ]);

  const teamIds = new Set((minaTeam ?? []).map((t) => t.id));
  const direkt = new Set((minaDirekt ?? []).map((e) => e.id));

  const berorda = [...new Set((ansokningar ?? []).map((a) => a.employee_id))];
  const { data: personer } = berorda.length
    ? await db.from("employee").select("id, first_name, last_name, team_id").in("id", berorda)
    : { data: [] };

  const person = new Map((personer ?? []).map((p) => [p.id, p]));

  const min = (ansokningar ?? []).filter((a) => {
    if (a.employee_id === user.employee!.id) return false;
    const typ = typkarta.get(a.type_id);
    if (!typ) return false;
    const p = person.get(a.employee_id);
    const ledare = Boolean(p && (direkt.has(p.id) || (p.team_id && teamIds.has(p.team_id))));
    return farBesluta(user, typ.approval_level as "manager" | "sales_manager" | "ceo", ledare);
  });

  const idag = svensktDatum();
  const ledning = hasRole(user, "sales_manager", "ceo");

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
        <h1 className="text-display text-ink-900">Att besluta</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          {ledning
            ? "Alla ansökningar som väntar. Sorterade efter när ledigheten börjar, inte efter när de kom in — den som söker för nästa vecka behöver svar först."
            : "Ansökningar från dem du leder, sorterade efter när ledigheten börjar."}
        </p>
      </div>

      <Card>
        <CardHeader titel={`${min.length} ${min.length === 1 ? "ansökan" : "ansökningar"}`} />

        {min.length === 0 ? (
          <EmptyState
            rubrik="Kön är tom"
            text="Ansökningar som väntar på ditt beslut hamnar här."
          />
        ) : (
          <ul className="flex flex-col">
            {min.map((a) => {
              const p = person.get(a.employee_id);
              const kvar = dagarMellan(idag, a.starts_on);
              const brutna = ((a.rules_broken ?? []) as string[]).length;

              return (
                <li key={a.id} className="border-b border-canvas last:border-0">
                  <Link
                    href={`/franvaro/${a.id}`}
                    className="group flex min-h-14 flex-wrap items-center gap-3 py-3"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-body text-ink-900 group-hover:text-brand-700">
                        {p ? fullName(p) : "Okänd"} · {typkarta.get(a.type_id)?.label ?? a.type_id}
                      </span>
                      <span className="block text-small text-ink-500">
                        {periodtext(a.starts_on, a.ends_on)} · {omfattning(a)} ·{" "}
                        {kvar < 0
                          ? "har redan börjat"
                          : kvar === 0
                            ? "börjar i dag"
                            : `om ${kvar} ${kvar === 1 ? "dag" : "dagar"}`}
                      </span>
                    </span>
                    {brutna > 0 && (
                      <Badge ton="warn">
                        {brutna === 1 ? "1 regelbrott" : `${brutna} regelbrott`}
                      </Badge>
                    )}
                    <Badge ton="accent">Besluta</Badge>
                    <Ikon namn="tillbaka" className="size-4 rotate-180 text-ink-300" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
