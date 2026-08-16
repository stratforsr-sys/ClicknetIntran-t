import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, canManageEmployees, fullName } from "@/lib/auth";
import {
  EMPLOYMENT_TYPE_LABEL,
  ROLES,
  ROLE_LABEL,
  STATUS_LABEL,
  MFA_REQUIRED_ROLES,
  type Role,
} from "@/lib/roles";
import { supabaseServer } from "@/lib/supabase/server";
import { aktivera, andraRoll, kvitteraOffboarding, offboarda } from "../actions";

export const dynamic = "force-dynamic";

export default async function AnstalldSida({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const supabase = await supabaseServer();

  const { data: a } = await supabase
    .from("employee")
    .select(
      "id, first_name, last_name, email, status, employment_type, start_date, end_date, employee_number, created_at",
    )
    .eq("id", id)
    .maybeSingle();

  // AC-5.8-mönstret: ej behorig far 404, inte "atkomst nekad".
  if (!a) notFound();

  const { data: rollRader } = await supabase
    .from("employee_role")
    .select("role")
    .eq("employee_id", id);
  const roller = new Set((rollRader ?? []).map((r) => r.role as Role));

  const { data: checklista } = await supabase
    .from("offboarding_task")
    .select("id, label, state, skipped_reason, sort")
    .eq("employee_id", id)
    .order("sort");

  const farHantera = canManageEmployees(user);
  const avslutad = a.status === "offboarded";
  const kraverMfa = [...roller].some((r) => MFA_REQUIRED_ROLES.includes(r));

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href="/personal"
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Tillbaka till personal
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-display text-ink-900">{fullName(a)}</h1>
          <p className="mt-1 text-body text-ink-500">{a.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge ton={avslutad ? "neutral" : a.status === "active" ? "ok" : "warn"}>
            {STATUS_LABEL[a.status] ?? a.status}
          </Badge>
          {kraverMfa && !avslutad && <Badge ton="info">MFA krävs</Badge>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader titel="Anställning" />
          <dl className="grid gap-4 sm:grid-cols-2">
            <Rad etikett="Anställningsform" varde={EMPLOYMENT_TYPE_LABEL[a.employment_type] ?? a.employment_type} />
            <Rad etikett="Startdatum" varde={a.start_date ?? "Ej satt"} tnum />
            <Rad etikett="Anställningsnummer" varde={a.employee_number ?? "Ej satt"} tnum />
            <Rad etikett="Slutdatum" varde={a.end_date ?? "—"} tnum />
          </dl>

          {farHantera && a.status === "onboarding" && (
            <form action={aktivera} className="mt-6">
              <input type="hidden" name="employee_id" value={a.id} />
              <Button type="submit" size="sm">Markera som aktiv</Button>
            </form>
          )}
        </Card>

        <Card>
          <CardHeader titel="Roller" beskrivning="Varje ändring loggas med vem som beviljade." />
          {avslutad ? (
            <p className="text-small text-ink-500">
              Alla roller återkallades vid offboarding. Historiken finns kvar i händelseloggen.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {ROLES.map((r) => {
                const pa = roller.has(r);
                return (
                  <li key={r}>
                    <form action={andraRoll}>
                      <input type="hidden" name="employee_id" value={a.id} />
                      <input type="hidden" name="roll" value={r} />
                      <input type="hidden" name="pa" value={pa ? "0" : "1"} />
                      <button
                        type="submit"
                        disabled={!farHantera}
                        className={`flex min-h-11 w-full items-center gap-3 rounded-sm px-3 text-left text-body transition-colors duration-fast disabled:cursor-default ${
                          pa ? "bg-brand-tint text-brand-ink" : "text-ink-700 enabled:hover:bg-surface-alt"
                        }`}
                      >
                        <span
                          className={`grid size-5 shrink-0 place-items-center rounded-xs ${
                            pa ? "bg-brand-600 text-ink-inv" : "ring-1 ring-ink-300"
                          }`}
                        >
                          {pa && <Ikon namn="kontroll" className="size-3.5" />}
                        </span>
                        <span className="flex-1">{ROLE_LABEL[r]}</span>
                        {MFA_REQUIRED_ROLES.includes(r) && (
                          <span className="text-micro uppercase text-ink-500">MFA</span>
                        )}
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {/* AC-1.4 och AC-1.7 */}
      {farHantera && !avslutad && (
        <Card status="danger">
          <CardHeader
            titel="Avsluta anställning"
            beskrivning="Återkallar alla roller, stänger sessionerna omedelbart och skapar en offboarding-checklista. Historiken behålls."
          />
          <form action={offboarda} className="flex flex-wrap items-end gap-4">
            <input type="hidden" name="employee_id" value={a.id} />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="slutdatum" className="text-small font-semibold text-ink-700">
                Slutdatum
              </label>
              <input
                id="slutdatum"
                name="slutdatum"
                type="date"
                defaultValue={new Date().toISOString().slice(0, 10)}
                className="rounded-sm bg-surface px-4 py-2.5 text-body text-ink-900 shadow-elev-1 focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
            </div>
            <Button type="submit" variant="destruktiv">Avsluta anställningen</Button>
          </form>
        </Card>
      )}

      {avslutad && (checklista?.length ?? 0) > 0 && (
        <Card>
          <CardHeader
            titel="Offboarding-checklista"
            beskrivning="Ingen post kan hoppas över utan motivering."
          />
          <ul className="flex flex-col">
            {(checklista ?? []).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 border-b border-canvas py-3 last:border-0">
                <span className="flex-1 text-body text-ink-700">{t.label}</span>
                {t.state === "done" && <Badge ton="ok">Klar</Badge>}
                {t.state === "skipped" && (
                  <span className="flex items-center gap-2">
                    <Badge ton="warn">Hoppad</Badge>
                    <span className="text-small text-ink-500">{t.skipped_reason}</span>
                  </span>
                )}
                {t.state === "open" && farHantera && (
                  <div className="flex flex-wrap items-center gap-2">
                    <form action={kvitteraOffboarding}>
                      <input type="hidden" name="task_id" value={t.id} />
                      <input type="hidden" name="employee_id" value={a.id} />
                      <input type="hidden" name="hoppa" value="0" />
                      <Button type="submit" size="sm" variant="sekundar">Kvittera</Button>
                    </form>
                    <form action={kvitteraOffboarding} className="flex items-center gap-2">
                      <input type="hidden" name="task_id" value={t.id} />
                      <input type="hidden" name="employee_id" value={a.id} />
                      <input type="hidden" name="hoppa" value="1" />
                      <input
                        name="motivering"
                        required
                        placeholder="Motivering krävs"
                        aria-label={`Motivering för att hoppa över: ${t.label}`}
                        className="min-h-9 w-48 rounded-full bg-canvas px-4 text-small text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-brand-600"
                      />
                      <Button type="submit" size="sm" variant="diskret">Hoppa över</Button>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Rad({ etikett, varde, tnum }: { etikett: string; varde: string; tnum?: boolean }) {
  return (
    <div>
      <dt className="text-micro uppercase text-ink-500">{etikett}</dt>
      <dd className={`mt-1 text-body text-ink-900 ${tnum ? "tnum" : ""}`}>{varde}</dd>
    </div>
  );
}
