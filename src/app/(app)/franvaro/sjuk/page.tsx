import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notis } from "@/components/ui/Notis";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, fullName, hasRole } from "@/lib/auth";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { svensktDatum } from "@/lib/klocka";
import { ROLE_LABEL, type Role } from "@/lib/roles";
import {
  FRIST_ETIKETT,
  FRIST_TEXT,
  dagarMellan,
  periodtext,
  upprepadKorttid,
  type Fristtyp,
  type Regelverk,
  type Sjukanmalan,
} from "@/lib/franvaro";
import { REGELFALT } from "@/lib/franvaro-server";
import { Sjukregistrering } from "./Sjukregistrering";
import { Chefshandlingar } from "./Chefshandlingar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sjukfrånvaro — Clicknet Nav" };

/**
 * ===========================================================================
 * AC-3.6, AC-3.27: DET FINNS INGEN SJUKANMÄLNINGSKNAPP PÅ DEN HÄR SIDAN.
 *
 * Sidans första och största element är telefonlistan. En sjukanmälan börjar
 * med ett samtal till en människa — det är den enda punkten på hela dagen då
 * någon märker att en kollega inte mår bra, och en knapp hade tagit bort den.
 *
 * Registreringsformuläret ligger under listan och heter "Registrera efter
 * samtalet". Ordningen i trädet är hela kravet och får inte kastas om med CSS.
 *
 * K35: formuläret tar emot datum och omfattning. Ingenting annat, och det
 * finns ingen kolumn att skicka något annat till (0020).
 * ===========================================================================
 */
export default async function Sjuksida() {
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");

  const supabase = await supabaseServer();
  const db = supabaseAdmin();
  const mig = user.employee.id;
  const idag = svensktDatum();

  const [{ data: policy }, { data: ordning }, { data: anmalningar }, { data: frister }] =
    await Promise.all([
      supabase.from("absence_policy").select(REGELFALT).maybeSingle(),
      supabase
        .from("absence_call_order")
        .select("id, sort, target_kind, role, employee_id, phone, team_id")
        .eq("active", true)
        .order("sort"),
      // RLS: egna alltid, chefens folk via leads_employee, ledningen alla.
      supabase
        .from("sick_report")
        .select(
          "id, employee_id, first_sick_day, last_sick_day, registered_at, registered_by, reported_to, extent_percent, confirmed_at, confirmed_by, escalated_at, previous_report_id, certificate_received_on, cancelled_at",
        )
        .is("cancelled_at", null)
        .order("first_sick_day", { ascending: false })
        .limit(60),
      supabase
        .from("sick_deadline")
        .select("id, report_id, kind, due_on, completed_at, completed_by")
        .order("due_on"),
    ]);

  const regler = policy as Regelverk | null;

  // Vem den anställda ska ringa. `manager` slås upp per person; en anställd
  // utan chef hoppar över platsen och nästa i ordningen blir den man ringer —
  // det är chefsfallbacken i AC-3.18, inbyggd i ordningen i stället för som
  // ett undantag i koden.
  const { data: jag } = await db
    .from("employee")
    .select("manager_id, team_id")
    .eq("id", mig)
    .maybeSingle();

  const rollpersoner = (ordning ?? []).filter((o) => o.target_kind === "role").map((o) => o.role!);
  const [{ data: chefen }, { data: medRoll }] = await Promise.all([
    jag?.manager_id
      ? db.from("employee").select("id, first_name, last_name").eq("id", jag.manager_id).maybeSingle()
      : Promise.resolve({ data: null }),
    rollpersoner.length
      ? db
          .from("employee_role")
          .select("role, employee!inner(id, first_name, last_name, status)")
          .in("role", rollpersoner)
      : Promise.resolve({ data: [] }),
  ]);

  const perRoll = new Map<string, { id: string; first_name: string; last_name: string }[]>();
  for (const r of (medRoll ?? []) as unknown as {
    role: string;
    employee: { id: string; first_name: string; last_name: string; status: string };
  }[]) {
    if (r.employee.status === "offboarded") continue;
    perRoll.set(r.role, [...(perRoll.get(r.role) ?? []), r.employee]);
  }

  const utpekade = (ordning ?? []).filter((o) => o.target_kind === "person").map((o) => o.employee_id!);
  const { data: namngivna } = utpekade.length
    ? await db.from("employee").select("id, first_name, last_name").in("id", utpekade)
    : { data: [] };
  const namngiven = new Map((namngivna ?? []).map((p) => [p.id, p]));

  const ringlista = (ordning ?? [])
    .filter((o) => o.team_id === null || o.team_id === jag?.team_id)
    .map((o) => {
      if (o.target_kind === "manager")
        return chefen ? { sort: o.sort, vem: fullName(chefen), vad: "Din närmaste chef", telefon: o.phone } : null;
      if (o.target_kind === "role") {
        const folk = perRoll.get(o.role!) ?? [];
        return folk.length
          ? { sort: o.sort, vem: folk.map(fullName).join(", "), vad: ROLE_LABEL[o.role as Role] ?? o.role!, telefon: o.phone }
          : null;
      }
      const p = namngiven.get(o.employee_id!);
      return p ? { sort: o.sort, vem: fullName(p), vad: "Utpekad mottagare", telefon: o.phone } : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const alla = (anmalningar ?? []) as (Sjukanmalan & {
    registered_by: string;
    reported_to: string | null;
    confirmed_by: string | null;
    extent_percent: number;
    previous_report_id: string | null;
    certificate_received_on: string | null;
  })[];

  const mina = alla.filter((a) => a.employee_id === mig);
  const andras = alla.filter((a) => a.employee_id !== mig);
  const minPagaende = mina.find((a) => a.last_sick_day === null) ?? null;

  const namnIds = [...new Set(alla.map((a) => a.employee_id))];
  const { data: personer } = namnIds.length
    ? await db.from("employee").select("id, first_name, last_name").in("id", namnIds)
    : { data: [] };
  const namn = new Map((personer ?? []).map((p) => [p.id, fullName(p)]));

  const fristPerRapport = new Map<string, typeof frister>();
  for (const f of frister ?? []) {
    fristPerRapport.set(f.report_id, [...(fristPerRapport.get(f.report_id) ?? []), f]);
  }

  const chef = andras.length > 0 || hasRole(user, "sales_manager", "ceo", "team_lead");

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
        <h1 className="text-display text-ink-900">Sjukanmälan</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Ring först. Registreringen görs efteråt, av dig eller av den du pratade med.
        </p>
      </div>

      {/* Telefonlistan star forst i tradet. AC-3.6. */}
      <Card status="brand">
        <CardHeader
          titel="Ring i den här ordningen"
          beskrivning="Får du inte tag på den första, gå vidare till nästa."
        />
        {ringlista.length === 0 ? (
          <Notis ton="warn">
            Ingen mottagarordning är uppsatt. Ring din närmaste chef och be säljchefen lägga in
            ordningen under Regler.
          </Notis>
        ) : (
          <ol className="flex flex-col">
            {ringlista.map((r) => (
              <li key={r.sort} className="flex min-h-14 items-center gap-4 border-b border-canvas py-3 last:border-0">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-small font-semibold text-brand-ink">
                  {r.sort}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-body text-ink-900">{r.vem}</span>
                  <span className="block text-small text-ink-500">{r.vad}</span>
                </span>
                {r.telefon && (
                  <a
                    href={`tel:${r.telefon.replace(/\s/g, "")}`}
                    className="shrink-0 text-body font-semibold text-brand-700 hover:text-brand-900"
                  >
                    {r.telefon}
                  </a>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Sjukregistrering
            pagaende={
              minPagaende
                ? {
                    id: minPagaende.id,
                    forstaDag: minPagaende.first_sick_day,
                    omfattning: minPagaende.extent_percent,
                    bekraftad: Boolean(minPagaende.confirmed_at),
                  }
                : null
            }
            mottagare={ringlista.map((r) => ({ vem: r.vem, vad: r.vad }))}
            idag={idag}
          />

          {chef && (
            <Card>
              <CardHeader
                titel="Sjukanmälningar att hantera"
                beskrivning="Bara dem du ansvarar för. Datum och omfattning — aldrig något om orsak."
              />
              {andras.length === 0 ? (
                <EmptyState rubrik="Ingen sjukanmälan" text="Anmälningar från dem du leder visas här." />
              ) : (
                <ul className="flex flex-col gap-4">
                  {andras.map((a) => (
                    <li key={a.id} className="border-b border-canvas pb-4 last:border-0 last:pb-0">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-body text-ink-900">{namn.get(a.employee_id) ?? "Okänd"}</p>
                          <p className="text-small text-ink-500">
                            {a.last_sick_day
                              ? periodtext(a.first_sick_day, a.last_sick_day)
                              : `Sedan ${periodtext(a.first_sick_day, a.first_sick_day)}, pågår`}
                            {a.extent_percent < 100 ? ` · ${a.extent_percent} %` : ""}
                            {a.previous_report_id ? " · återinsjuknande" : ""}
                          </p>
                        </div>
                        {a.confirmed_at ? (
                          <Badge ton="ok">Bekräftad</Badge>
                        ) : a.escalated_at ? (
                          <Badge ton="danger">Eskalerad</Badge>
                        ) : (
                          <Badge ton="accent">Obekräftad</Badge>
                        )}
                      </div>

                      <Frister
                        frister={(fristPerRapport.get(a.id) ?? []) as { id: string; kind: string; due_on: string; completed_at: string | null }[]}
                        idag={idag}
                        intygMottaget={a.certificate_received_on}
                      />

                      <Chefshandlingar
                        id={a.id}
                        bekraftad={Boolean(a.confirmed_at)}
                        avslutad={Boolean(a.last_sick_day)}
                        forstaDag={a.first_sick_day}
                        idag={idag}
                        frister={(fristPerRapport.get(a.id) ?? [])
                          .filter((f) => !f.completed_at)
                          .map((f) => ({ id: f.id, etikett: FRIST_ETIKETT[f.kind as Fristtyp] }))}
                      />

                      {regler &&
                        (() => {
                          const signal = upprepadKorttid(
                            alla.filter((x) => x.employee_id === a.employee_id),
                            regler,
                            idag,
                          );
                          return signal ? (
                            <div className="mt-3">
                              <Notis ton="info">
                                {signal.antal} sjuktillfällen sedan {signal.sedan}. Arbetsgivaren har
                                en utredningsskyldighet vid upprepad korttidsfrånvaro (30 kap. 6 §
                                socialförsäkringsbalken). Det här är en påminnelse om rehabilitering
                                — inte ett underlag för ett samtal om prestation.
                              </Notis>
                            </div>
                          ) : null;
                        })()}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader titel="Dina sjukperioder" />
            {mina.length === 0 ? (
              <p className="text-small text-ink-500">Ingen registrerad sjukfrånvaro.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {mina.map((a) => (
                  <li key={a.id} className="flex items-baseline justify-between gap-3">
                    <span className="text-small text-ink-700">
                      {a.last_sick_day
                        ? periodtext(a.first_sick_day, a.last_sick_day)
                        : `${a.first_sick_day} — pågår`}
                    </span>
                    <span className="shrink-0 text-micro text-ink-300">
                      {a.extent_percent < 100 ? `${a.extent_percent} %` : "Heltid"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {regler && (
            <Card>
              <CardHeader titel="Fristerna" beskrivning="Räknas från första sjukdagen." />
              <ul className="flex flex-col gap-3 text-small">
                <li>
                  <span className="font-semibold text-ink-900">Dag {regler.sick_certificate_day}</span>
                  <span className="block text-ink-500">{FRIST_TEXT.certificate}</span>
                </li>
                <li>
                  <span className="font-semibold text-ink-900">Dag {regler.sick_fk_day}</span>
                  <span className="block text-ink-500">{FRIST_TEXT.fk_notice}</span>
                </li>
                <li>
                  <span className="font-semibold text-ink-900">Dag {regler.sick_return_plan_day}</span>
                  <span className="block text-ink-500">{FRIST_TEXT.return_plan}</span>
                </li>
              </ul>
              <p className="mt-4 text-micro text-ink-500">
                Läkarintyget kvitteras som mottaget. Filen kan inte laddas upp i navet än — se
                ROADMAP E7.10.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Frister({
  frister,
  idag,
  intygMottaget,
}: {
  frister: { id: string; kind: string; due_on: string; completed_at: string | null }[];
  idag: string;
  intygMottaget: string | null;
}) {
  if (frister.length === 0) return null;

  return (
    <ul className="mt-3 flex flex-wrap gap-2">
      {frister.map((f) => {
        const kvar = dagarMellan(idag, f.due_on);
        const klar = Boolean(f.completed_at);
        const ton = klar ? "ok" : kvar < 0 ? "danger" : kvar <= 3 ? "warn" : "neutral";

        return (
          <li key={f.id}>
            <Badge ton={ton}>
              {FRIST_ETIKETT[f.kind as Fristtyp]}
              {klar
                ? f.kind === "certificate" && intygMottaget
                  ? ` · mottaget ${intygMottaget}`
                  : " · klar"
                : kvar < 0
                  ? ` · ${-kvar} d försenad`
                  : kvar === 0
                    ? " · i dag"
                    : ` · ${f.due_on}`}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}
