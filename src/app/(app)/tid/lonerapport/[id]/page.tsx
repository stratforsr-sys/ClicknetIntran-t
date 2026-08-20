import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, hasRole, fullName } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { timmarOchMinuter } from "@/lib/tid";
import { Generera, Attestera, Justering } from "./Atgarder";

export const dynamic = "force-dynamic";
export const metadata = { title: "Löneperiod — Clicknet Nav" };

export default async function PeriodSida({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!hasRole(user, "sales_manager", "ceo", "finance", "admin") || !user?.employee) redirect("/");

  const supabase = await supabaseServer();
  const { data: period } = await supabase
    .from("payroll_period")
    .select("id, period_start, period_end, status, generated_at, attested_at, attested_by")
    .eq("id", id)
    .maybeSingle();

  if (!period) notFound();

  const [{ data: rader }, { data: justeringar }, { data: personal }] = await Promise.all([
    supabase
      .from("payroll_row")
      .select("employee_id, worked_minutes, break_minutes, auto_closed_days, deviation_count, absence_minutes")
      .eq("period_id", period.id),
    supabase
      .from("payroll_adjustment")
      .select("id, employee_id, minutes, reason, created_at")
      .eq("period_id", period.id)
      .order("created_at"),
    supabase.from("employee").select("id, first_name, last_name").order("first_name"),
  ]);

  // E7.4: etiketterna kommer ur absence_type, inte ur en lista i den har filen.
  // Byter nagon namn pa en franvarotyp ska rapporten folja med.
  const { data: typer } = await supabase.from("absence_type").select("id, label").order("sort");
  const typnamn = new Map((typer ?? []).map((t) => [t.id, t.label]));

  const namn = new Map((personal ?? []).map((p) => [p.id, fullName(p)]));

  const justeringPerPerson = new Map<string, number>();
  for (const j of justeringar ?? []) {
    justeringPerPerson.set(j.employee_id, (justeringPerPerson.get(j.employee_id) ?? 0) + j.minutes);
  }

  const lista = (rader ?? [])
    .map((r) => ({
      ...r,
      namn: namn.get(r.employee_id) ?? "Okänd",
      justering: justeringPerPerson.get(r.employee_id) ?? 0,
    }))
    .sort((a, b) => a.namn.localeCompare(b.namn, "sv"));

  const last = period.status === "attested";
  const farAttestera = hasRole(user, "sales_manager", "ceo", "admin");
  const summa = lista.reduce((s, r) => s + r.worked_minutes + r.justering, 0);

  // Vilka typer som faktiskt forekommer i perioden. En kolumn per typ som
  // alltid ar tom gor tabellen bredare utan att saga nagot.
  const franvarotyper = [...new Set(lista.flatMap((r) => Object.keys(r.absence_minutes ?? {})))].sort(
    (a, b) => (typnamn.get(a) ?? a).localeCompare(typnamn.get(b) ?? b, "sv"),
  );

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href="/tid/lonerapport"
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Tillbaka till perioder
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-display tnum text-ink-900">
            {period.period_start} – {period.period_end}
          </h1>
          <p className="mt-1 text-body text-ink-500">
            {last
              ? `Attesterad ${new Date(period.attested_at!).toLocaleDateString("sv-SE")} av ${namn.get(period.attested_by!) ?? "okänd"}.`
              : period.generated_at
                ? "Underlaget är skrivet men inte attesterat."
                : "Underlaget är inte skrivet ännu."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge ton={last ? "ok" : period.generated_at ? "info" : "neutral"}>
            {last ? "Attesterad" : period.generated_at ? "Underlag skrivet" : "Tom"}
          </Badge>
          {period.generated_at && (
            <ButtonLink href={`/tid/lonerapport/${period.id}/csv`} size="sm">
              Exportera CSV
            </ButtonLink>
          )}
        </div>
      </div>

      {farAttestera && !last && <Generera periodId={period.id} harUnderlag={!!period.generated_at} />}

      {lista.length > 0 && (
        <Card>
          <CardHeader
            titel="Underlag"
            beskrivning="Arbetad tid enligt arbetstidsjournalen. Inga belopp — lönen räknas i lönesystemet (AC-2.17)."
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left">
              <thead>
                <tr className="border-b border-ink-200 text-micro uppercase tracking-wide text-ink-500">
                  <th className="py-2 pr-4 font-semibold">Person</th>
                  <th className="py-2 pr-4 text-right font-semibold">Arbetad tid</th>
                  <th className="py-2 pr-4 text-right font-semibold">Rast</th>
                  <th className="py-2 pr-4 text-right font-semibold">Justering</th>
                  <th className="py-2 pr-4 text-right font-semibold">Stängda av navet</th>
                  <th className="py-2 text-right font-semibold">Avvikelser</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((r) => (
                  <tr key={r.employee_id} className="border-b border-ink-100 last:border-0">
                    <td className="py-2 pr-4 text-body text-ink-900">{r.namn}</td>
                    <td className="tnum py-2 pr-4 text-right text-body text-ink-900">
                      {timmarOchMinuter(r.worked_minutes)}
                    </td>
                    <td className="tnum py-2 pr-4 text-right text-small text-ink-500">
                      {timmarOchMinuter(r.break_minutes)}
                    </td>
                    <td className="tnum py-2 pr-4 text-right text-small text-ink-700">
                      {r.justering === 0 ? "—" : `${r.justering > 0 ? "+" : ""}${r.justering} min`}
                    </td>
                    <td className="tnum py-2 pr-4 text-right text-small text-ink-500">
                      {r.auto_closed_days || "—"}
                    </td>
                    <td className="tnum py-2 text-right text-small text-ink-500">
                      {r.deviation_count || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink-200">
                  <td className="py-2 pr-4 text-small font-semibold text-ink-700">
                    Summa inklusive justeringar
                  </td>
                  <td className="tnum py-2 pr-4 text-right text-body font-semibold text-ink-900">
                    {timmarOchMinuter(summa)}
                  </td>
                  <td colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* E7.4 / AC-2.13: franvaro per typ. Kolumnen stod tom fran 0012 till
              E7 byggdes, med kommentaren att {} betyder "inte matt" och inte
              "ingen franvaro". Skillnaden galler fortfarande. */}
          <div className="mt-6">
            <h3 className="text-h2 text-ink-900">Frånvaro per typ</h3>
            {franvarotyper.length === 0 ? (
              <p className="mt-2 max-w-[70ch] text-small text-ink-500">
                Ingen registrerad frånvaro i perioden. Underlaget är genererat, så det här är noll
                — inte omätt.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[36rem] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-canvas">
                      <th className="py-2 pr-4 text-small font-semibold text-ink-500">Person</th>
                      {franvarotyper.map((t) => (
                        <th key={t} className="py-2 pr-4 text-right text-small font-semibold text-ink-500">
                          {typnamn.get(t) ?? t}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lista
                      .filter((r) => Object.keys(r.absence_minutes ?? {}).length > 0)
                      .map((r) => (
                        <tr key={r.employee_id} className="border-b border-canvas last:border-0">
                          <td className="py-2 pr-4 text-body text-ink-900">{r.namn}</td>
                          {franvarotyper.map((t) => (
                            <td key={t} className="tnum py-2 pr-4 text-right text-body text-ink-900">
                              {r.absence_minutes?.[t]
                                ? timmarOchMinuter(r.absence_minutes[t])
                                : "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 max-w-[70ch] text-micro text-ink-500">
              Minuter, aldrig belopp (AC-2.17, K5). Sjukfrånvaro står med som minuter eftersom
              sjuklöneperioden är arbetsgivarens — men själva sjukanmälan når varken ekonomi eller
              lönekostnadsvyn (AC-3.26).
            </p>
          </div>
        </Card>
      )}

      {farAttestera && !last && period.generated_at && <Attestera periodId={period.id} />}

      {last && farAttestera && (
        <Justering
          periodId={period.id}
          personal={lista.map((r) => ({ id: r.employee_id, namn: r.namn }))}
        />
      )}

      {(justeringar ?? []).length > 0 && (
        <Card>
          <CardHeader titel="Justeringsposter" beskrivning="Ligger bredvid underlaget, aldrig i det." />
          <ul className="flex flex-col gap-3">
            {(justeringar ?? []).map((j) => (
              <li key={j.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="tnum text-body font-semibold text-ink-900">
                  {j.minutes > 0 ? "+" : ""}
                  {j.minutes} min
                </span>
                <span className="text-body text-ink-700">{namn.get(j.employee_id) ?? "Okänd"}</span>
                <span className="text-small text-ink-500">{j.reason}</span>
                <span className="tnum ml-auto text-micro text-ink-500">
                  {new Date(j.created_at).toLocaleDateString("sv-SE")}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
