import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCurrentUser, canManageEmployees, fullName } from "@/lib/auth";
import { EMPLOYMENT_TYPE_LABEL, ROLE_LABEL, STATUS_LABEL, type Role } from "@/lib/roles";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const STATUS_TON = { active: "ok", onboarding: "warn", offboarded: "neutral" } as const;

export default async function Personal() {
  const user = await getCurrentUser();
  const supabase = await supabaseServer();

  // RLS avgor vad som kommer tillbaka. Ingen filtrering i UI:t.
  const { data: anstallda } = await supabase
    .from("employee")
    .select("id, first_name, last_name, email, status, employment_type, start_date")
    .order("status")
    .order("first_name");

  const { data: roller } = await supabase.from("employee_role").select("employee_id, role");
  const rollPer = new Map<string, Role[]>();
  for (const r of roller ?? []) {
    rollPer.set(r.employee_id, [...(rollPer.get(r.employee_id) ?? []), r.role as Role]);
  }

  const lista = anstallda ?? [];
  const farHantera = canManageEmployees(user);

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display text-ink-900">Personal</h1>
          <p className="mt-1 text-body text-ink-500">
            {lista.length} {lista.length === 1 ? "person" : "personer"} i registret.
          </p>
        </div>
        {farHantera && <ButtonLink href="/personal/ny" variant="primar">Lägg upp anställd</ButtonLink>}
      </div>

      {lista.length === 0 ? (
        <Card>
          <EmptyState
            rubrik="Registret är tomt"
            text="Lägg upp den första anställda så skapas konto, roll och behörighet i ett steg."
            handling={
              farHantera ? <ButtonLink href="/personal/ny" variant="primar">Lägg upp anställd</ButtonLink> : undefined
            }
          />
        </Card>
      ) : (
        <Card className="p-0 md:p-0">
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
                      <span className="font-semibold text-ink-900">{fullName(a)}</span>
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
