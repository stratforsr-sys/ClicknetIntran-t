import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Notis } from "@/components/ui/Notis";
import { Field, Select, KONTROLL } from "@/components/ui/Field";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, hasRole, fullName } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { slaLage, timmarKvar, STATUS_ETIKETT, type Status } from "@/lib/arenden";
import { svara, andraStatus, tilldela } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ärende — Clicknet Nav" };

/**
 * AC-4.4: den anställda ser hela dialogen. Det finns ingen intern anteckning
 * här och ska inte läggas till — ett fält som chefen kan skriva i utan att den
 * berörda ser det gör ärendet till något annat än det utger sig för att vara.
 */
export default async function ArendetSida({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");

  const supabase = await supabaseServer();

  // RLS gor jobbet: ar arendet inte ditt och du inte far hantera det, kommer
  // det tillbaka tomt — och sidan blir 404, inte "atkomst nekad" (AC-5.8:s anda).
  const { data: arende } = await supabase
    .from("hr_case")
    .select("id, employee_id, subject, category, status, confidential, assigned_to, sla_hours, due_at, resolved_at, resolution, created_at")
    .eq("id", id)
    .maybeSingle();

  if (!arende) notFound();

  const [{ data: meddelanden }, { data: kategorier }, { data: personal }] = await Promise.all([
    supabase
      .from("case_message")
      .select("id, author_id, body, created_at")
      .eq("case_id", id)
      .order("created_at"),
    supabase.from("case_category").select("id, label"),
    supabase.from("employee").select("id, first_name, last_name").neq("status", "offboarded"),
  ]);

  const namn = new Map((personal ?? []).map((p) => [p.id, fullName(p)]));
  const etikett = new Map((kategorier ?? []).map((k) => [k.id, k.label]));
  const hanterare = hasRole(user, "sales_manager", "ceo");
  const lage = slaLage(arende);
  const kvar = timmarKvar(arende.due_at);

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href="/arenden"
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Tillbaka till ärenden
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-display text-ink-900">{arende.subject}</h1>
          <p className="mt-1 text-body text-ink-500">
            {etikett.get(arende.category) ?? arende.category} ·{" "}
            {namn.get(arende.employee_id) ?? "Okänd"} ·{" "}
            {new Date(arende.created_at).toLocaleDateString("sv-SE")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {arende.confidential && <Badge ton="info">Konfidentiellt</Badge>}
          <Badge ton="neutral">{STATUS_ETIKETT[arende.status as Status]}</Badge>
          <Badge ton={lage === "over" ? "danger" : lage === "snart" ? "warn" : lage === "klart" ? "neutral" : "ok"}>
            {arende.resolved_at
              ? `Löst ${new Date(arende.resolved_at).toLocaleDateString("sv-SE")}`
              : lage === "over"
                ? `${Math.abs(kvar)} h över utlovad tid`
                : `Svar utlovat inom ${kvar} h`}
          </Badge>
        </div>
      </div>

      {arende.confidential && (
        <Notis ton="info">
          Ärendet är konfidentiellt. Det syns för dig som skrev det, för säljchefen och för VD —
          ingen annan, oavsett roll.
        </Notis>
      )}

      <Card>
        <CardHeader titel="Dialog" beskrivning="Allt som skrivs här ser båda parter. Inget går att ändra i efterhand." />

        <ol className="flex flex-col gap-4">
          {(meddelanden ?? []).map((m) => {
            const egen = m.author_id === user.employee!.id;
            return (
              <li
                key={m.id}
                className={`max-w-[46rem] rounded-md px-4 py-3 ${egen ? "ml-auto bg-brand-tint" : "bg-surface-alt"}`}
              >
                <p className="text-micro font-semibold uppercase tracking-wide text-ink-500">
                  {namn.get(m.author_id ?? "") ?? "Okänd"} ·{" "}
                  {new Date(m.created_at).toLocaleString("sv-SE", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-body text-ink-900">{m.body}</p>
              </li>
            );
          })}
        </ol>

        {!arende.resolved_at && (
          <form action={svara} className="mt-6 flex flex-col gap-3">
            <input type="hidden" name="arende_id" value={arende.id} />
            <label htmlFor="text" className="text-small font-semibold text-ink-700">
              Svara
            </label>
            <textarea id="text" name="text" rows={4} required className={KONTROLL} />
            <div>
              <Button type="submit" size="sm">
                Skicka svar
              </Button>
            </div>
          </form>
        )}
      </Card>

      {arende.resolution && (
        <Card status="ok">
          <CardHeader titel="Lösning" />
          <p className="whitespace-pre-wrap text-body text-ink-900">{arende.resolution}</p>
        </Card>
      )}

      {hanterare && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader titel="Handläggning" beskrivning="Statusen följer samtalet automatiskt, men går att sätta här." />
            <form action={andraStatus} className="flex flex-col gap-3">
              <input type="hidden" name="arende_id" value={arende.id} />
              <Field label="Status" namn="status">
                <Select namn="status" defaultValue={arende.status}>
                  {(Object.keys(STATUS_ETIKETT) as Status[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_ETIKETT[s]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Lösning" namn="losning" hjalp="Fylls i när du markerar ärendet som löst.">
                <textarea id="losning" name="losning" rows={3} className={KONTROLL} />
              </Field>
              <div>
                <Button type="submit" variant="sekundar" size="sm">
                  Spara
                </Button>
              </div>
            </form>
          </Card>

          <Card>
            <CardHeader titel="Tilldelning" beskrivning="Den tilldelade ser ärendet även utan chefsroll — men aldrig ett konfidentiellt." />
            <form action={tilldela} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="arende_id" value={arende.id} />
              <Field label="Handläggare" namn="assigned_to">
                <Select namn="assigned_to" defaultValue={arende.assigned_to ?? ""}>
                  <option value="">Ingen</option>
                  {(personal ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {fullName(p)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="submit" variant="sekundar" size="sm">
                Tilldela
              </Button>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
