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
  antalDagar,
  brottext,
  omfattning,
  periodtext,
  startlage,
  STATUS_ETIKETT,
  STATUS_TON,
  type Ansokningsstatus,
} from "@/lib/franvaro";
import { BESLUTSFALT, farBesluta, lederPersonen } from "@/lib/franvaro-server";
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
    .select(BESLUTSFALT)
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
            {status === "submitted" || status === "approved"
              ? ` · ${startlage(a.starts_on, idag).text}`
              : ""}
          </p>
        </div>
        <Badge ton={STATUS_TON[status]}>{STATUS_ETIKETT[status]}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {/**
           * SKÄLET STÅR FÖRST, FÖRE BESLUTET.
           *
           * Ordningen är hela poängen: den som ska besluta läser varför innan
           * hen läser knapparna. Kortet syns för den sökande själv, för den som
           * leder hen och för ledningen — RLS på `absence_request` har redan
           * dragit den kretsen (0019), och den här sidan vidgar den inte.
           *
           * Den tomma varianten är inte en lucka utan en tidsuppgift: fältet
           * fanns inte före 0048, och en ansökan från augusti ska inte se ut som
           * om någon vägrat svara.
           */}
          <Card>
            <CardHeader
              titel={egen ? "Ditt skäl" : "Skälet"}
              beskrivning={egen ? "Som du skrev det när du skickade in." : "Som den sökande skrev det."}
            />
            {a.reason ? (
              <p className="whitespace-pre-line text-body text-ink-900">{a.reason}</p>
            ) : (
              <p className="text-body text-ink-500">
                Ansökan skickades in innan navet började fråga efter ett skäl. Perioden, typen och
                reglerna nedan är det som fanns att besluta på.
              </p>
            )}
          </Card>

          <Card status={status === "approved" ? "ok" : status === "rejected" ? "danger" : undefined}>
            <CardHeader titel="Beslutet" />

            {status === "submitted" && (
              <p className="text-body text-ink-500">
                Väntar på {typ?.approval_level === "ceo" ? "VD" : typ?.approval_level === "sales_manager" ? "säljchefen" : "din närmaste chef"}.
                Inskickad {a.submitted_at ? periodtext(a.submitted_at.slice(0, 10), a.submitted_at.slice(0, 10)) : "—"}.
              </p>
            )}

            {(status === "approved" || status === "rejected") && (
              <dl className="flex flex-col gap-3 text-body">
                <Rad
                  etikett={status === "approved" ? "Godkänd av" : "Avslagen av"}
                  varde={`${namn.get(a.decided_by!) ?? "Okänd"}${a.decided_at ? ` · ${periodtext(a.decided_at.slice(0, 10), a.decided_at.slice(0, 10))} kl ${svenskKlocka(a.decided_at)}` : ""}`}
                />
                {a.decision_note && <Rad etikett="Motivering" varde={a.decision_note} />}
                {a.override_reason && (
                  <Rad etikett="Godkänd trots reglerna, därför att" varde={a.override_reason} />
                )}
              </dl>
            )}

            {status === "withdrawn" && (
              <p className="text-body text-ink-500">
                Ansökan drogs tillbaka{" "}
                {a.withdrawn_at ? periodtext(a.withdrawn_at.slice(0, 10), a.withdrawn_at.slice(0, 10)) : ""} innan
                någon beslutat om den.
              </p>
            )}

            {status === "cancelled" && (
              <p className="text-body text-ink-500">
                Ledigheten godkändes men ställdes in{" "}
                {a.withdrawn_at ? periodtext(a.withdrawn_at.slice(0, 10), a.withdrawn_at.slice(0, 10)) : ""}. Beslutet står
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
                  <li key={k}>{brottext(k)}</li>
                ))}
              </ul>
              <p className="mt-4 text-micro text-ink-500">
                Listan är frusen sedan inskicket. Ändras en frist i morgon gör det inte den här
                ansökan regelvidrig i efterhand — och den blir inte heller regelrätt i efterhand.
              </p>
            </Card>
          )}

          {beslutare && status === "submitted" && (
            <Beslutspanel id={a.id} brutna={brutna.map(brottext)} />
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader titel="Uppgifter" />
            <dl className="flex flex-col gap-3">
              <Rad etikett="Första dagen" varde={periodtext(a.starts_on, a.starts_on)} />
              <Rad
                etikett="Sista dagen"
                varde={
                  a.part_day_minutes !== null
                    ? `${periodtext(a.ends_on, a.ends_on)} (del av dagen)`
                    : periodtext(a.ends_on, a.ends_on)
                }
              />
              <Rad
                etikett="Omfattning"
                varde={
                  a.part_day_minutes !== null
                    ? omfattning(a)
                    : `${omfattning(a)} · ${antalDagar(a.starts_on, a.ends_on) === 1 ? "en kalenderdag" : "kalenderdagar, helger inräknade"}`
                }
              />
              <Rad
                etikett="Inskickad"
                varde={a.submitted_at ? periodtext(a.submitted_at.slice(0, 10), a.submitted_at.slice(0, 10)) : "—"}
              />
            </dl>
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

function Rad({ etikett, varde }: { etikett: string; varde: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-small text-ink-500">{etikett}</dt>
      <dd className="text-body text-ink-900">{varde}</dd>
    </div>
  );
}
