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
import { alder, leadTitel, STATUSAR, STATUS_ETIKETT, STATUS_TON, type Leadstatus } from "@/lib/leads";
import { tilldelaLead, uppdateraLead } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lead — Clicknet Nav" };

type Lead = {
  id: string;
  created_at: string;
  source: string;
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  page_url: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  extra: Record<string, string> | null;
  status: Leadstatus;
  status_changed_at: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
  note: string | null;
  duplicate_of: string | null;
};

function tid(iso: string): string {
  return new Date(iso).toLocaleString("sv-SE", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Stockholm",
  });
}

/** En länk bara om adressen faktiskt är en webbadress — fältet kommer från en främling. */
function sakerLank(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function Rad({ etikett, children }: { etikett: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 py-1.5">
      <dt className="text-small font-semibold text-ink-500">{etikett}</dt>
      <dd className="min-w-0 break-words text-body text-ink-900">{children}</dd>
    </div>
  );
}

export default async function LeadSida({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");

  const supabase = await supabaseServer();

  // RLS gör jobbet: ett lead som inte är ditt och som du inte får fördela
  // kommer tillbaka tomt, och sidan blir 404 — inte "åtkomst nekad".
  const { data } = await supabase
    .from("lead")
    .select("id, created_at, source, name, company, email, phone, message, page_url, utm_source, utm_medium, utm_campaign, extra, status, status_changed_at, assigned_to, assigned_at, note, duplicate_of")
    .eq("id", id)
    .maybeSingle();

  const lead = data as unknown as Lead | null;
  if (!lead) notFound();

  const fordelar = hasRole(user, "sales_manager", "ceo", "team_lead");
  const minEgen = lead.assigned_to === user.employee.id;

  const [{ data: personal }, { data: dubbletter }] = await Promise.all([
    supabase.from("employee").select("id, first_name, last_name, status").neq("status", "offboarded").order("first_name"),
    supabase
      .from("lead")
      .select("id, created_at")
      .eq("duplicate_of", lead.id)
      .order("created_at"),
  ]);

  const namn = new Map((personal ?? []).map((p) => [p.id, fullName(p)]));
  const extra = Object.entries(lead.extra ?? {});
  const sida = sakerLank(lead.page_url);
  const utm = [lead.utm_source, lead.utm_medium, lead.utm_campaign].filter(Boolean).join(" / ");

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href="/leads"
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Tillbaka till leads
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-display text-ink-900">{leadTitel(lead)}</h1>
          <p className="mt-1 text-body text-ink-500">
            Kom in {tid(lead.created_at)} · för {alder(lead.created_at)} sedan · via {lead.source}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {lead.duplicate_of && <Badge ton="info">Dubblett</Badge>}
          <Badge ton={STATUS_TON[lead.status]}>{STATUS_ETIKETT[lead.status]}</Badge>
        </div>
      </div>

      {lead.duplicate_of && (
        <Notis ton="info">
          Samma kund skrev in tidigare under det senaste dygnet.{" "}
          <Link href={`/leads/${lead.duplicate_of}`} className="font-semibold underline">
            Öppna det första leadet
          </Link>{" "}
          — det är där det ska hanteras. Den här raden skickade ingen notis.
        </Notis>
      )}

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader titel="Kunden" beskrivning="Det som fylldes i på hemsidan." />
          <dl className="divide-y divide-canvas">
            {lead.name && <Rad etikett="Namn">{lead.name}</Rad>}
            {lead.company && <Rad etikett="Företag">{lead.company}</Rad>}
            {lead.phone && (
              <Rad etikett="Telefon">
                <a href={`tel:${lead.phone}`} className="font-semibold text-brand-700 hover:text-brand-900">
                  {lead.phone}
                </a>
              </Rad>
            )}
            {lead.email && (
              <Rad etikett="E-post">
                <a href={`mailto:${lead.email}`} className="font-semibold text-brand-700 hover:text-brand-900">
                  {lead.email}
                </a>
              </Rad>
            )}
            {lead.message && (
              <Rad etikett="Meddelande">
                <span className="whitespace-pre-wrap">{lead.message}</span>
              </Rad>
            )}
            {lead.page_url && (
              <Rad etikett="Sida">
                {sida ? (
                  <a href={sida} target="_blank" rel="noopener noreferrer nofollow" className="text-brand-700 hover:text-brand-900">
                    {lead.page_url}
                  </a>
                ) : (
                  lead.page_url
                )}
              </Rad>
            )}
            {utm && <Rad etikett="Kampanj">{utm}</Rad>}
          </dl>

          {extra.length > 0 && (
            <>
              <h2 className="mt-5 text-small font-semibold text-ink-700">Övriga fält</h2>
              <dl className="mt-1 divide-y divide-canvas">
                {extra.map(([k, v]) => (
                  <Rad key={k} etikett={k}>
                    <span className="whitespace-pre-wrap">{v}</span>
                  </Rad>
                ))}
              </dl>
            </>
          )}

          {(dubbletter ?? []).length > 0 && (
            <>
              <h2 className="mt-5 text-small font-semibold text-ink-700">Skrev in igen</h2>
              <ul className="mt-1 flex flex-col gap-1">
                {(dubbletter ?? []).map((d) => (
                  <li key={d.id}>
                    <Link href={`/leads/${d.id}`} className="text-small text-brand-700 hover:text-brand-900">
                      {tid(d.created_at)}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          {fordelar && (
            <Card>
              <CardHeader
                titel="Säljare"
                beskrivning={
                  lead.assigned_to && lead.assigned_at
                    ? `${namn.get(lead.assigned_to) ?? "Okänd"} sedan ${tid(lead.assigned_at)}.`
                    : "Ingen har leadet än. Den du väljer får ett mejl direkt."
                }
              />
              <form action={tilldelaLead} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="lead_id" value={lead.id} />
                <div className="min-w-[12rem] flex-1">
                  <Field label="Ge till" namn="assigned_to">
                    <Select namn="assigned_to" defaultValue={lead.assigned_to ?? ""}>
                      <option value="">Ingen</option>
                      {(personal ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {fullName(p)}
                          {p.id === user.employee!.id ? " (jag)" : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <Button type="submit" variant="sekundar" size="sm">
                  Spara
                </Button>
              </form>
            </Card>
          )}

          {(fordelar || minEgen) && (
            <Card>
              <CardHeader
                titel="Läge"
                beskrivning={
                  lead.status_changed_at
                    ? `Senast ändrat ${tid(lead.status_changed_at)}.`
                    : "Sätt status när du har ringt."
                }
              />
              <form action={uppdateraLead} className="flex flex-col gap-3">
                <input type="hidden" name="lead_id" value={lead.id} />
                <Field label="Status" namn="status">
                  <Select namn="status" defaultValue={lead.status}>
                    {STATUSAR.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_ETIKETT[s]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Anteckning" namn="anteckning" hjalp="Syns för dig och för dem som fördelar leads. Personnummer döljs automatiskt.">
                  <textarea id="anteckning" name="anteckning" rows={5} defaultValue={lead.note ?? ""} className={KONTROLL} />
                </Field>
                <div>
                  <Button type="submit" size="sm">
                    Spara
                  </Button>
                </div>
              </form>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
