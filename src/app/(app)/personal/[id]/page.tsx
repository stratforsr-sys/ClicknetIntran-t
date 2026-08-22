import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, canManageEmployees, hasRole, fullName } from "@/lib/auth";
import {
  EMPLOYMENT_TYPE_LABEL,
  ROLES,
  ROLE_LABEL,
  STATUS_LABEL,
  MFA_REQUIRED_ROLES,
  PERMISSIONS,
  PERMISSION_LABEL,
  type Role,
} from "@/lib/roles";
import { supabaseServer } from "@/lib/supabase/server";
import { riktarSigTill } from "@/lib/dokument";
import { KONTROLL } from "@/components/ui/Field";
import {
  aktivera,
  andraBehorighet,
  andraRoll,
  kvitteraOffboarding,
  offboarda,
  sattOrganisation,
} from "../actions";
import { Inloggningskort } from "./Inloggningskort";
import { Saldon } from "./Saldon";
import { supabaseAdmin } from "@/lib/supabase/server";
import { svensktDatum } from "@/lib/klocka";
import { saldotArGammalt, type Regelverk } from "@/lib/franvaro";
import { REGELFALT } from "@/lib/franvaro-server";

export const dynamic = "force-dynamic";

export default async function AnstalldSida({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const supabase = await supabaseServer();

  const { data: a } = await supabase
    .from("employee")
    .select(
      `id, first_name, last_name, email, status, employment_type, start_date,
       end_date, employee_number, created_at, team_id, manager_id`,
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

  // Bada listorna behovs for valjarna nedan. En avslutad person ska inte ga
  // att peka ut som chef.
  const [{ data: teamLista }, { data: kollegor }] = await Promise.all([
    supabase.from("team").select("id, name").order("name"),
    supabase
      .from("employee")
      .select("id, first_name, last_name")
      .neq("status", "offboarded")
      .neq("id", id)
      .order("first_name"),
  ]);

  const { data: checklista } = await supabase
    .from("offboarding_task")
    .select("id, label, state, skipped_reason, sort")
    .eq("employee_id", id)
    .order("sort");

  // AC-13.13: lonekostnadsbehorigheten delas ut av saljchef och VD, inte av
  // den tekniska administratoren (PRD §1.4).
  const { data: behRader } = await supabase
    .from("employee_permission")
    .select("permission")
    .eq("employee_id", id);
  const behorigheter = new Set((behRader ?? []).map((b) => b.permission));
  const farDelaUtBehorighet = hasRole(user, "sales_manager", "ceo");

  // AC-1.3: vad personen faktiskt har pa sig. Fragan galler nagon annan an
  // den inloggade, sa malgruppen raknas ut har i stallet for av RLS — se
  // riktarSigTill(), tvillingen till matches_audience() i 0003.
  const farHantera = canManageEmployees(user);
  let attKvittera: { id: string; slug: string; title: string; klar: boolean }[] = [];
  if (farHantera) {
    const [{ data: dok }, { data: ack }] = await Promise.all([
      supabase
        .from("document")
        .select("id, slug, title, version, audience_roles, audience_teams")
        .eq("status", "published")
        .eq("requires_ack", true)
        .order("title"),
      supabase.from("document_ack").select("document_id, version").eq("employee_id", id),
    ]);
    const kvitterat = new Set((ack ?? []).map((k) => `${k.document_id}:${k.version}`));
    attKvittera = (dok ?? [])
      .filter((d) => riktarSigTill(d, [...roller], a.team_id))
      .map((d) => ({
        id: d.id,
        slug: d.slug,
        title: d.title,
        klar: kvitterat.has(`${d.id}:${d.version}`),
      }));
  }
  const avslutad = a.status === "offboarded";

  /**
   * E7.5: franvarosaldon. Lases med service role for att kunna visa HELA
   * historiken — `absence_balance_read` ger den anstallda sina egna rader, men
   * den har vyn ar chefens och ska visa vem som matade in vad och nar.
   *
   * Bara for den som far hantera personal. AC-2.17 och K5: navet raknar ingen
   * semesterratt, sa varje siffra har ar nagons pastaende.
   */
  const admin = supabaseAdmin();
  const idagDatum = svensktDatum();

  const [{ data: policyRad }, { data: franvarotyper }, { data: saldorader }] = farHantera
    ? await Promise.all([
        admin.from("absence_policy").select(REGELFALT).maybeSingle(),
        admin.from("absence_type").select("id, label, uses_balance").order("sort"),
        admin
          .from("absence_balance")
          .select("type_id, days, as_of, earned_year, entered_at, entered_by")
          .eq("employee_id", id)
          .order("as_of", { ascending: false })
          .order("entered_at", { ascending: false }),
      ])
    : [{ data: null }, { data: null }, { data: null }];

  const policy = policyRad as Regelverk | null;
  const typetikett = new Map((franvarotyper ?? []).map((t) => [t.id, t.label]));

  const inmatare = [...new Set((saldorader ?? []).map((r) => r.entered_by))];
  const { data: inmatarnamn } = inmatare.length
    ? await admin.from("employee").select("id, first_name, last_name").in("id", inmatare)
    : { data: [] };
  const inmatarkarta = new Map((inmatarnamn ?? []).map((p) => [p.id, fullName(p)]));

  // Senaste raden per typ och intjanandear galler. Aldre rader ar historik och
  // star kvar att lasa — se triggern i 0019.
  const senaste = new Map<string, (typeof saldorader extends null ? never : NonNullable<typeof saldorader>[number])>();
  for (const r of saldorader ?? []) {
    const nyckel = `${r.type_id}:${r.earned_year ?? "-"}`;
    if (!senaste.has(nyckel)) senaste.set(nyckel, r);
  }

  const saldoRader = [...senaste.values()].map((r) => ({
    type_id: r.type_id,
    label: typetikett.get(r.type_id) ?? r.type_id,
    days: Number(r.days),
    as_of: String(r.as_of).slice(0, 10),
    earned_year: r.earned_year,
    gammalt: policy ? saldotArGammalt(String(r.as_of).slice(0, 10), policy, idagDatum) : false,
  }));

  const saldoHistorik = (saldorader ?? [])
    .filter((r) => !senaste.has(`${r.type_id}:${r.earned_year ?? "-"}`) || senaste.get(`${r.type_id}:${r.earned_year ?? "-"}`) !== r)
    .map((r) => ({
      type_id: r.type_id,
      days: Number(r.days),
      as_of: String(r.as_of).slice(0, 10),
      entered_at: r.entered_at,
      namn: inmatarkarta.get(r.entered_by) ?? "Okänd",
    }));
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

          {/* E9.1. Vagen till avtalet gar via personen, for det ar har man ar
              nar man lagger upp nagon. Listan over alla avtal ligger pa /avtal. */}
          {farHantera && !avslutad && (
            <p className="mt-6 text-small text-ink-500">
              <Link
                href={`/avtal/nytt?person=${a.id}`}
                className="text-brand-700 underline underline-offset-2"
              >
                Skapa anställningsavtal
              </Link>
            </p>
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

      {farHantera && !avslutad && (
        <Inloggningskort anstalldId={a.id} namn={fullName(a)} />
      )}

      {/* AC-1.3: rutinerna foljer roll och team — ingen kopia per person. */}
      {farHantera && !avslutad && attKvittera.length > 0 && (
        <Card>
          <CardHeader
            titel="Obligatoriska rutiner"
            beskrivning={`${attKvittera.filter((d) => d.klar).length} av ${attKvittera.length} kvitterade. Följer av rollen och teamet.`}
          />
          <ul className="flex flex-col gap-1">
            {attKvittera.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/rutiner/${d.slug}`}
                  className="flex min-h-11 items-center gap-3 rounded-sm px-3 text-body text-ink-700 transition-colors duration-fast hover:bg-surface-alt hover:text-ink-900"
                >
                  <span
                    className={`grid size-5 shrink-0 place-items-center rounded-xs ${
                      d.klar ? "bg-ok text-ink-inv" : "ring-1 ring-ink-300"
                    }`}
                  >
                    {d.klar && <Ikon namn="kontroll" className="size-3.5" />}
                  </span>
                  <span className="flex-1">{d.title}</span>
                  {!d.klar && <Badge ton="warn">Ej kvitterad</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* AC-13.13: behorigheten ges per person, oberoende av roll. */}
      {farDelaUtBehorighet && !avslutad && (
        <Card>
          <CardHeader
            titel="Särskild behörighet"
            beskrivning="Ges per person, aldrig per roll. Varje ändring loggas med vem som beviljade."
          />
          <ul className="flex flex-col gap-1">
            {PERMISSIONS.map((b) => {
              const pa = behorigheter.has(b);
              return (
                <li key={b}>
                  <form action={andraBehorighet}>
                    <input type="hidden" name="employee_id" value={a.id} />
                    <input type="hidden" name="behorighet" value={b} />
                    <input type="hidden" name="pa" value={pa ? "0" : "1"} />
                    <button
                      type="submit"
                      className={`flex min-h-11 w-full items-center gap-3 rounded-sm px-3 text-left text-body transition-colors duration-fast ${
                        pa ? "bg-accent-tint text-accent-ink" : "text-ink-700 hover:bg-surface-alt"
                      }`}
                    >
                      <span
                        className={`grid size-5 shrink-0 place-items-center rounded-xs ${
                          pa ? "bg-accent text-ink-inv" : "ring-1 ring-ink-300"
                        }`}
                      >
                        {pa && <Ikon namn="kontroll" className="size-3.5" />}
                      </span>
                      <span className="flex-1">{PERMISSION_LABEL[b]}</span>
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-small text-ink-500">
            Ser vad kollegorna kostar. Ge den till dig och VD — inte till en teknisk
            administratör, som annars ser allas ersättning på köpet.
          </p>
        </Card>
      )}

      {/* E1.13: team och chef avgor vem som ser personens uppgifter. */}
      {farHantera && !avslutad && (
        <Card>
          <CardHeader
            titel="Organisation"
            beskrivning="Teamledaren och närmaste chef ser den här personens uppgifter. Ändringen loggas."
          />
          <form action={sattOrganisation} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="employee_id" value={a.id} />

            <label className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
              <span className="text-small font-semibold text-ink-700">Team</span>
              <select
                name="team_id"
                defaultValue={a.team_id ?? ""}
                className={`${KONTROLL} appearance-none pr-10`}
              >
                <option value="">Inget team</option>
                {(teamLista ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
              <span className="text-small font-semibold text-ink-700">Närmaste chef</span>
              <select
                name="manager_id"
                defaultValue={a.manager_id ?? ""}
                className={`${KONTROLL} appearance-none pr-10`}
              >
                <option value="">Ingen chef</option>
                {(kollegor ?? []).map((k) => (
                  <option key={k.id} value={k.id}>
                    {fullName(k)}
                  </option>
                ))}
              </select>
            </label>

            <Button type="submit" size="sm">
              Spara
            </Button>
          </form>

          {(teamLista ?? []).length === 0 && (
            <p className="mt-3 text-small text-ink-500">
              Det finns inga team än.{" "}
              <Link href="/personal/team" className="underline hover:text-ink-900">
                Skapa ett
              </Link>
              .
            </p>
          )}
        </Card>
      )}

      {/* E7.5: saldon matas in for hand och rors aldrig av navets egna
          berakningar — for det finns inga. Kortet ligger fore avslutskortet
          eftersom det anvands lopande, medan avslutet anvands en gang. */}
      {farHantera && !avslutad && policy && (
        <Saldon
          employeeId={a.id}
          rader={saldoRader}
          historik={saldoHistorik}
          typer={(franvarotyper ?? []) as { id: string; label: string; uses_balance: boolean }[]}
          idag={idagDatum}
          fristDagar={policy.balance_stale_days}
        />
      )}

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
