import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCurrentUser, canManageEmployees, fullName } from "@/lib/auth";
import { EMPLOYMENT_TYPE_LABEL, ROLE_LABEL, STATUS_LABEL, type Role } from "@/lib/roles";
import { supabaseServer } from "@/lib/supabase/server";
import { GuideVard } from "@/components/guide/GuideVard";

export const dynamic = "force-dynamic";

const STATUS_TON = { active: "ok", onboarding: "warn", offboarded: "neutral" } as const;

export default async function Personal() {
  const user = await getCurrentUser();
  const supabase = await supabaseServer();

  // RLS avgor vad som kommer tillbaka. Ingen filtrering i UI:t.
  const { data: anstallda } = await supabase
    .from("employee")
    .select(
      "id, first_name, last_name, email, status, employment_type, start_date, inactive_flagged_at",
    )
    .order("status")
    .order("first_name");

  const { data: roller } = await supabase.from("employee_role").select("employee_id, role");
  const rollPer = new Map<string, Role[]>();
  for (const r of roller ?? []) {
    rollPer.set(r.employee_id, [...(rollPer.get(r.employee_id) ?? []), r.role as Role]);
  }

  const lista = anstallda ?? [];
  const farHantera = canManageEmployees(user);
  const flaggade = lista.filter((a) => a.inactive_flagged_at && a.status !== "offboarded");

  return (
    <div className="flex flex-col gap-4 pt-2">
      <GuideVard slug="personal-och-anstallning" />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div data-guide="personal.rubrik">
          <h1 className="text-display text-ink-900">Personal</h1>
          <p className="mt-1 text-body text-ink-500">
            {lista.length} {lista.length === 1 ? "person" : "personer"} i registret.
          </p>
        </div>
        {farHantera && (
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/personal/team" variant="sekundar">Team</ButtonLink>
            <ButtonLink href="/personal/ny" variant="primar">Lägg upp anställd</ButtonLink>
          </div>
        )}
      </div>

      {/* AC-1.8, R11: utan katalogtjanst finns ingen annan som marker att ett
          konto blivit kvarglomt. */}
      {farHantera && flaggade.length > 0 && (
        <Card status="warn">
          <p className="text-body text-ink-900">
            {flaggade.length === 1
              ? "Ett konto har inte använts på 45 dagar."
              : `${flaggade.length} konton har inte använts på 45 dagar.`}{" "}
            <span className="text-ink-500">
              Granska om personen slutat utan att avslutas i navet.
            </span>
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {flaggade.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/personal/${a.id}`}
                  className="inline-flex min-h-9 items-center rounded-full bg-warn-tint px-3 text-small text-warn-ink hover:brightness-95"
                >
                  {fullName(a)}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {lista.length === 0 ? (
        <Card guide="personal.lista">
          <EmptyState
            rubrik="Registret är tomt"
            text="Lägg upp den första anställda så skapas konto, roll och behörighet i ett steg."
            handling={
              farHantera ? <ButtonLink href="/personal/ny" variant="primar">Lägg upp anställd</ButtonLink> : undefined
            }
          />
        </Card>
      ) : (
        <Card className="p-0 md:p-0" guide="personal.lista">
          {/* UI-PRD §5.6: ingen zebrarandning. Pa mobil blir varje rad ett kort. */}
          <table className="hidden w-full border-collapse md:table">
            <thead>
              <tr className="border-b border-canvas">
                <Th>Namn</Th>
                <Th>Roll</Th>
                <Th>Anställning</Th>
                <Th>Startdatum</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {lista.map((a) => (
                <tr
                  key={a.id}
                  className="border-b border-canvas transition-colors duration-fast last:border-0 hover:bg-surface-alt"
                >
                  <td className="px-6 py-2">
                    {/* Hela cellen ar traffyta, inte bara textraden (AC-U5.5). */}
                    <Link
                      href={`/personal/${a.id}`}
                      className="flex min-h-11 flex-col justify-center rounded-xs"
                    >
                      <span className="font-semibold text-ink-900">
                        {fullName(a)}
                        {a.inactive_flagged_at && a.status !== "offboarded" && (
                          <span className="ml-2 align-middle">
                            <Badge ton="warn">Oanvänt konto</Badge>
                          </span>
                        )}
                      </span>
                      <span className="text-small text-ink-500">{a.email}</span>
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-small text-ink-700">
                    {(rollPer.get(a.id) ?? []).map((r) => ROLE_LABEL[r]).join(", ") || "—"}
                  </td>
                  <td className="px-6 py-4 text-small text-ink-700">
                    {EMPLOYMENT_TYPE_LABEL[a.employment_type] ?? a.employment_type}
                  </td>
                  <td className="tnum px-6 py-4 text-small text-ink-700">{a.start_date ?? "—"}</td>
                  <td className="px-6 py-4">
                    <Badge ton={STATUS_TON[a.status as keyof typeof STATUS_TON] ?? "neutral"}>
                      {STATUS_LABEL[a.status] ?? a.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="flex flex-col gap-3 p-4 md:hidden">
            {lista.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/personal/${a.id}`}
                  className="lift block rounded-sm bg-surface-alt p-4 shadow-elev-1"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink-900">{fullName(a)}</p>
                      <p className="truncate text-small text-ink-500">{a.email}</p>
                    </div>
                    <Badge ton={STATUS_TON[a.status as keyof typeof STATUS_TON] ?? "neutral"}>
                      {STATUS_LABEL[a.status] ?? a.status}
                    </Badge>
                  </div>
                  <p className="mt-2 text-small text-ink-700">
                    {(rollPer.get(a.id) ?? []).map((r) => ROLE_LABEL[r]).join(", ") || "Ingen roll satt"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="px-6 py-3 text-left text-micro uppercase text-ink-500">
      {children}
    </th>
  );
}
