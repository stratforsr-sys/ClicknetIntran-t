import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notis } from "@/components/ui/Notis";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { svensktDatum } from "@/lib/klocka";
import {
  femarsvarning,
  omfattning,
  periodtext,
  saldoFor,
  saldotArGammalt,
  STATUS_ETIKETT,
  STATUS_TON,
  type Ansokningsstatus,
  type Regelverk,
  type Saldo,
} from "@/lib/franvaro";
import { REGELFALT } from "@/lib/franvaro-server";
import { Kalenderflode } from "./Kalenderflode";
import { GuideVard } from "@/components/guide/GuideVard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Frånvaro — Clicknet Nav" };

/**
 * Min frånvaro.
 *
 * Sidan visar ledighet, saldon och pågående sjukperiod — allt läst med
 * användarens egen token, så RLS avgör vad som kommer med. En chef ser sina
 * egna rader här och sitt folks under Att besluta; att blanda dem hade gjort
 * sidan till två sidor ovanpå varandra.
 */
export default async function Franvarosida() {
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");

  const supabase = await supabaseServer();
  const mig = user.employee.id;
  const idag = svensktDatum();

  const [
    { data: policy },
    { data: typer },
    { data: ansokningar },
    { data: saldorader },
    { data: sjuk },
    { data: floden },
  ] = await Promise.all([
    supabase.from("absence_policy").select(REGELFALT).maybeSingle(),
    supabase.from("absence_type").select("id, label, requestable, active").order("sort"),
    supabase
      .from("absence_request")
      .select("id, type_id, starts_on, ends_on, part_day_minutes, status, decision_note, submitted_at")
      .eq("employee_id", mig)
      .order("starts_on", { ascending: false })
      .limit(40),
    supabase.from("absence_balance").select("type_id, days, as_of, earned_year").eq("employee_id", mig),
    supabase
      .from("sick_report")
      .select("id, first_sick_day, last_sick_day, extent_percent, confirmed_at, cancelled_at")
      .eq("employee_id", mig)
      .is("cancelled_at", null)
      .order("first_sick_day", { ascending: false })
      .limit(10),
    supabase.from("calendar_feed").select("scope, token, revoked_at, read_count").eq("employee_id", mig),
  ]);

  const regler = policy as Regelverk | null;
  const etikett = new Map((typer ?? []).map((t) => [t.id, t.label]));
  const saldon: Saldo[] = ((saldorader ?? []) as { type_id: string; days: string | number; as_of: string; earned_year: number | null }[]).map(
    (s) => ({ ...s, days: Number(s.days) }),
  );

  const kommande = (ansokningar ?? []).filter((a) => a.status === "approved" && a.ends_on >= idag);
  const vantar = (ansokningar ?? []).filter((a) => a.status === "submitted");
  const historik = (ansokningar ?? []).filter((a) => !kommande.includes(a) && !vantar.includes(a));

  const pagaende = (sjuk ?? []).find((s) => s.last_sick_day === null) ?? null;

  // AC-3.9. Utan känt intjänandeår ges ingen varning — se `femarsvarning`.
  const forfaller = regler ? femarsvarning(saldon, regler, idag) : [];

  const saldotyper = (typer ?? []).filter((t) => saldoFor(saldon, t.id) !== null);
  const chef = hasRole(user, "sales_manager", "ceo", "team_lead");

  return (
    <div className="flex flex-col gap-4 pt-2">
      <GuideVard slug="franvaro" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-display text-ink-900">Frånvaro</h1>
          <p className="mt-1 max-w-[70ch] text-body text-ink-500">
            Ledighet söker du här. Sjukfrånvaro ringer du in först och registrerar efteråt.
          </p>
        </div>
        <div data-guide="franvaro.ansok" className="flex flex-wrap gap-2">
          <ButtonLink href="/franvaro/ny" variant="primar">
            Söka ledigt
          </ButtonLink>
          <ButtonLink href="/franvaro/sjuk">Sjukanmälan</ButtonLink>
        </div>
      </div>

      {pagaende && (
        <Notis ton="info">
          Du är sjukanmäld sedan {periodtext(pagaende.first_sick_day, pagaende.first_sick_day)}
          {pagaende.extent_percent < 100 ? `, ${pagaende.extent_percent} procent` : ""}.{" "}
          {pagaende.confirmed_at ? "Din chef har bekräftat anmälan." : "Väntar på att din chef bekräftar."}{" "}
          <Link href="/franvaro/sjuk" className="font-semibold underline">
            Anmäl dig frisk
          </Link>
        </Notis>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card guide="franvaro.vantar">
            <CardHeader
              titel="Väntar på beslut"
              beskrivning="Ansökningar som ingen tagit ställning till än."
            />
            {vantar.length === 0 ? (
              <EmptyState
                rubrik="Ingenting väntar"
                text="Ansökningar du skickat in ligger här tills chefen beslutat."
                handling={<ButtonLink href="/franvaro/ny" size="sm">Söka ledigt</ButtonLink>}
              />
            ) : (
              <ul className="flex flex-col">
                {vantar.map((a) => (
                  <Rad key={a.id} a={a} etikett={etikett} />
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader titel="Kommande ledighet" beskrivning="Godkänt och inbokat." />
            {kommande.length === 0 ? (
              <EmptyState rubrik="Ingen ledighet inbokad" text="Godkänd ledighet framåt i tiden visas här." />
            ) : (
              <ul className="flex flex-col">
                {kommande.map((a) => (
                  <Rad key={a.id} a={a} etikett={etikett} />
                ))}
              </ul>
            )}
          </Card>

          {historik.length > 0 && (
            <Card>
              <CardHeader titel="Tidigare" />
              <ul className="flex flex-col">
                {historik.slice(0, 12).map((a) => (
                  <Rad key={a.id} a={a} etikett={etikett} />
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              titel="Dina saldon"
              beskrivning="Matas in för hand. Navet räknar ingen semesterrätt."
            />
            {saldotyper.length === 0 ? (
              <p className="text-small text-ink-500">
                Inget saldo är inmatat. Du kan söka ledigt ändå — chefen ser samma sak som du och
                beslutar utifrån det. Fråga säljchefen om du vill ha dina dagar inlagda.
              </p>
            ) : (
              <dl className="flex flex-col gap-4">
                {saldotyper.map((t) => {
                  const s = saldoFor(saldon, t.id)!;
                  const gammalt = regler ? saldotArGammalt(s.as_of, regler, idag) : false;
                  return (
                    <div key={t.id} className="flex items-baseline justify-between gap-4">
                      <dt className="min-w-0">
                        <span className="block text-small text-ink-500">{t.label}</span>
                        <span className={`block text-micro ${gammalt ? "text-warn-ink" : "text-ink-300"}`}>
                          {gammalt ? `Inmatat ${s.as_of} — kan vara inaktuellt` : `Inmatat ${s.as_of}`}
                        </span>
                      </dt>
                      <dd className="tnum shrink-0 text-h1 text-ink-900">{s.days}</dd>
                    </div>
                  );
                })}
              </dl>
            )}

            {forfaller.length > 0 && (
              <div className="mt-4">
                <Notis ton="warn">
                  {forfaller.map((f) => (
                    <span key={f.earned_year} className="block">
                      {f.days} sparade dagar från {f.earned_year} förfaller {f.forfaller} (18 §
                      semesterlagen).
                    </span>
                  ))}
                </Notis>
              </div>
            )}
          </Card>

          <Kalenderflode floden={floden ?? []} />

          {chef && (
            <Card>
              <CardHeader titel="Som chef" />
              <ul className="flex flex-col gap-2 text-small">
                <li>
                  <Link href="/franvaro/attest" className="font-semibold text-brand-700 hover:text-brand-900">
                    Ansökningar att besluta
                  </Link>
                </li>
                <li>
                  <Link href="/franvaro/planering" className="font-semibold text-brand-700 hover:text-brand-900">
                    Semesterplanering
                  </Link>
                </li>
                <li>
                  <Link href="/franvaro/sjuk" className="font-semibold text-brand-700 hover:text-brand-900">
                    Sjukanmälningar och frister
                  </Link>
                </li>
                {hasRole(user, "sales_manager", "ceo", "admin") && (
                  <li>
                    <Link href="/franvaro/regler" className="font-semibold text-brand-700 hover:text-brand-900">
                      Regler och spärrperioder
                    </Link>
                  </li>
                )}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Rad({
  a,
  etikett,
}: {
  a: {
    id: string;
    type_id: string;
    starts_on: string;
    ends_on: string;
    part_day_minutes: number | null;
    status: string;
  };
  etikett: Map<string, string>;
}) {
  const status = a.status as Ansokningsstatus;
  return (
    <li className="border-b border-canvas last:border-0">
      <Link
        href={`/franvaro/${a.id}`}
        className="group flex min-h-14 items-center gap-3 py-3 transition-colors duration-fast"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-body text-ink-900 group-hover:text-brand-700">
            {etikett.get(a.type_id) ?? a.type_id}
          </span>
          <span className="block text-small text-ink-500">
            {periodtext(a.starts_on, a.ends_on)} · {omfattning(a)}
          </span>
        </span>
        <Badge ton={STATUS_TON[status]}>{STATUS_ETIKETT[status]}</Badge>
      </Link>
    </li>
  );
}
