import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Notis } from "@/components/ui/Notis";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, fullName } from "@/lib/auth";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { svensktDatum, svenskKlocka } from "@/lib/klocka";
import {
  omfattning,
  periodtext,
  STATUS_ETIKETT,
  STATUS_TON,
  type Ansokningsstatus,
} from "@/lib/franvaro";
import { farBesluta, lederPersonen } from "@/lib/franvaro-server";
import { Beslutspanel } from "./Beslutspanel";

export const dynamic = "force-dynamic";

/**
 * En ansökan.
 *
 * RLS avgör om raden syns: egen alltid, chefens folk via `leads_employee`,
 * ledningen alltid. Ger frågan noll rader blir det 404 och inte "åtkomst
 * nekad" — samma linje som AC-5.8 drog för rutinerna. Ett nekande avslöjar att
 * raden finns.
 */
export default async function Ansokanssida({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");

  const supabase = await supabaseServer();
  const { data: a } = await supabase
    .from("absence_request")
    // En enda strang och inte tva hopslagna: Supabase harleder radens typ ur
    // select-strangen, och en konkatenering ar ingen strangliteral.
    .select(
      "id, employee_id, type_id, starts_on, ends_on, part_day_minutes, status, submitted_at, decided_by, decided_at, decision_note, rules_broken, override_reason, withdrawn_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (!a) notFound();

  const db = supabaseAdmin();
  const [{ data: typ }, { data: personer }] = await Promise.all([
    db.from("absence_type").select("id, label, approval_level").eq("id", a.type_id).maybeSingle(),
    db.from("employee").select("id, first_name, last_name").in("id", [a.employee_id, a.decided_by].filter(Boolean) as string[]),
  ]);

  const namn = new Map((personer ?? []).map((p) => [p.id, fullName(p)]));
  const egen = a.employee_id === user.employee.id;
  const ledare = await lederPersonen(user, a.employee_id);
  const beslutare = !egen && farBesluta(user, typ?.approval_level ?? "manager", ledare);

  const status = a.status as Ansokningsstatus;
  const brutna = (a.rules_broken ?? []) as string[];
  const idag = svensktDatum();

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href={beslutare ? "/franvaro/attest" : "/franvaro"}
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        {beslutare ? "Tillbaka till kön" : "Tillbaka till frånvaro"}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-display text-ink-900">{typ?.label ?? a.type_id}</h1>
          <p className="mt-1 text-body text-ink-500">
            {egen ? "Din ansökan" : namn.get(a.employee_id) ?? "Okänd"} ·{" "}
            {periodtext(a.starts_on, a.ends_on)} · {omfattning(a)}
          </p>
        </div>
        <Badge ton={STATUS_TON[status]}>{STATUS_ETIKETT[status]}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card status={status === "approved" ? "ok" : status === "rejected" ? "danger" : undefined}>
            <CardHeader titel="Beslutet" />

            {status === "submitted" && (
              <p className="text-body text-ink-500">
                Väntar på {typ?.approval_level === "ceo" ? "VD" : typ?.approval_level === "sales_manager" ? "säljchefen" : "din närmaste chef"}.
                Inskickad {a.submitted_at?.slice(0, 10)}.
              </p>
            )}

            {(status === "approved" || status === "rejected") && (
              <dl className="flex flex-col gap-3 text-body">
                <Rad
                  etikett={status === "approved" ? "Godkänd av" : "Avslagen av"}
                  varde={`${namn.get(a.decided_by!) ?? "Okänd"} ${a.decided_at ? `· ${a.decided_at.slice(0, 10)} ${svenskKlocka(a.decided_at)}` : ""}`}
                />
                {a.decision_note && <Rad etikett="Motivering" varde={a.decision_note} />}
                {a.override_reason && (
                  <Rad etikett="Godkänd trots reglerna, därför att" varde={a.override_reason} />
                )}
              </dl>
            )}

            {status === "withdrawn" && (
              <p className="text-body text-ink-500">
                Ansökan drogs tillbaka {a.withdrawn_at?.slice(0, 10)} innan någon beslutat om den.
              </p>
            )}

            {status === "cancelled" && (
              <p className="text-body text-ink-500">
                Ledigheten godkändes men ställdes in {a.withdrawn_at?.slice(0, 10)}. Beslutet står
                kvar ovan — en inställd ledighet raderar inte att den var beviljad.
              </p>
            )}
          </Card>

          {brutna.length > 0 && (
            <Card status="warn">
              <CardHeader
                titel="Ansökan bröt mot reglerna"
                beskrivning="Som de såg ut när ansökan skickades in."
              />
              <ul className="flex list-disc flex-col gap-2 pl-5 text-small text-ink-700">
                {brutna.map((k) => (
                  <li key={k}>{BROTT_TEXT[k] ?? k}</li>
                ))}
              </ul>
              <p className="mt-4 text-micro text-ink-500">
                Listan är frusen sedan inskicket. Ändras en frist i morgon gör det inte den här
                ansökan regelvidrig i efterhand — och den blir inte heller regelrätt i efterhand.
              </p>
            </Card>
          )}

          {beslutare && status === "submitted" && (
            <Beslutspanel id={a.id} brutna={brutna.map((k) => BROTT_TEXT[k] ?? k)} />
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader titel="Uppgifter" />
            <dl className="flex flex-col gap-3">
              <Rad etikett="Period" varde={periodtext(a.starts_on, a.ends_on)} />
              <Rad etikett="Omfattning" varde={omfattning(a)} />
              <Rad etikett="Inskickad" varde={a.submitted_at?.slice(0, 10) ?? "—"} />
            </dl>

            {/* K35: här finns inget skäl att visa, för inget skäl har begärts. */}
            <p className="mt-4 text-micro text-ink-300">
              Navet registrerar aldrig varför någon söker ledigt.
            </p>
          </Card>

          {(egen || beslutare) && status === "approved" && a.ends_on >= idag && (
            <Card>
              <CardHeader titel="Ställa in" beskrivning="Om ledigheten inte blir av." />
              <Beslutspanel id={a.id} brutna={[]} lageInstall />
            </Card>
          )}

          {egen && status === "submitted" && (
            <Card>
              <CardHeader titel="Ångra" beskrivning="Du kan ta tillbaka ansökan tills den är beslutad." />
              <Beslutspanel id={a.id} brutna={[]} lageDra />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Koderna lagras i databasen, texterna hör hemma i gränssnittet. En kod som
 * skrevs i mars ska gå att förklara i september även om formuleringen bytts.
 */
const BROTT_TEXT: Record<string, string> = {
  frist: "Ansökningsfristen var inte uppfylld.",
  huvudsemester: "Perioden ligger i huvudsemesterfönstret, som har längre frist.",
  sparrperiod: "Perioden krockade med en spärrperiod.",
  maxlangd: "Perioden var längre än typens maxlängd.",
  bemanning: "Bemanningstaket var redan nått någon av dagarna.",
  saldo: "Ansökan var längre än det inmatade saldot.",
  overlapp: "Perioden krockade med annan frånvaro.",
  deldag: "Typen söks för hela dagar.",
  bakat: "Perioden registrerades bakåt i tiden.",
};

function Rad({ etikett, varde }: { etikett: string; varde: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-small text-ink-500">{etikett}</dt>
      <dd className="text-body text-ink-900">{varde}</dd>
    </div>
  );
}
