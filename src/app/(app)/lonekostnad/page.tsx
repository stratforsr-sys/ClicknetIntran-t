import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notis } from "@/components/ui/Notis";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { getCurrentUser, fullName } from "@/lib/auth";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { kronor } from "@/lib/lonekostnad";
import { farSeLonekostnad } from "@/lib/lonekostnad-server";
import { Raknaknapp } from "./Raknaknapp";
import { GuideVard } from "@/components/guide/GuideVard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lönekostnad — Clicknet Nav" };

/**
 * ===========================================================================
 * E15 / M13, AC-13.1, K26.
 *
 * Sidan finns bara för den som har `payroll_cost_viewer`. Kontrollen står här
 * OCH i RLS: policyerna i 0025 ger noll rader utan behörigheten, så en glömd
 * kontroll hade gett en tom sida — men en tom sida är fel svar. Den som inte
 * får se lönekostnader ska inte veta att vyn finns, och skickas till startsidan.
 *
 * Rollen `finance` räcker inte. Kretsen som ser vad folk KOSTAR är mindre än
 * den som sköter löner, och det är hela skälet att behörigheten ligger i en
 * egen tabell sedan 0001.
 *
 * FRÅNVARON KOMMER UR `payroll_row.absence_minutes` (AC-3.26). Ingen fråga på
 * den här sidan rör `sick_report` — den ger ändå noll rader för den här
 * behörigheten, alltså tyst fel data i stället för ett fel.
 * ===========================================================================
 */
export default async function Lonekostnadssida({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");
  if (!farSeLonekostnad(user)) redirect("/");

  const { period: valdPeriod } = await searchParams;
  const supabase = await supabaseServer();
  const db = supabaseAdmin();

  const { data: perioder } = await db
    .from("payroll_period")
    .select("id, period_start, period_end, status")
    .order("period_start", { ascending: false })
    .limit(12);

  const lista = perioder ?? [];
  const period = valdPeriod ? lista.find((p) => p.id === valdPeriod) : lista[0];

  if (!period) {
    return (
      <div className="flex flex-col gap-4 pt-2">
        <h1 className="text-display text-ink-900">Lönekostnad</h1>
        <Card>
          <EmptyState
            rubrik="Ingen löneperiod finns"
            text="Lönekostnaden räknas per löneperiod, eftersom frånvaron hämtas ur löneunderlaget. Skapa en period under Tid först."
          />
          <div className="mt-4">
            <ButtonLink href="/tid/lonerapport" size="sm">
              Till lönerapporten
            </ButtonLink>
          </div>
        </Card>
      </div>
    );
  }

  // Med användarens egen token: RLS avgör. Har hen inte behörigheten kommer
  // sidan aldrig hit, men frågan ska ändå vara den behöriga vägen.
  const { data: berakningar } = await supabase
    .from("cost_calculation")
    .select(
      `employee_id, monthly_salary, absence_deduction, gross_salary, employer_fee,
       total_cost, break_even_revenue, revenue, contribution, calculated_at`,
    )
    .eq("period_id", period.id);

  const rader = berakningar ?? [];

  const namnIds = rader.map((r) => r.employee_id);
  const { data: personer } = namnIds.length
    ? await db.from("employee").select("id, first_name, last_name, team_id").in("id", namnIds)
    : { data: [] };
  const person = new Map((personer ?? []).map((p) => [p.id, p]));

  const { data: team } = await db.from("team").select("id, name");
  const teamnamn = new Map((team ?? []).map((t) => [t.id, t.name]));

  const summa = (f: (r: (typeof rader)[number]) => number | null) =>
    rader.reduce((s, r) => s + (f(r) ?? 0), 0);

  const totalKostnad = summa((r) => Number(r.total_cost));
  const totalBreakEven = rader.every((r) => r.break_even_revenue === null)
    ? null
    : summa((r) => Number(r.break_even_revenue));
  const medIntakt = rader.filter((r) => r.revenue !== null);
  const totalIntakt = medIntakt.length ? summa((r) => Number(r.revenue)) : null;
  const totalBidrag = medIntakt.length ? summa((r) => Number(r.contribution)) : null;

  // AC-13.6: per säljare, team och bolag.
  const perTeam = new Map<string, { kostnad: number; antal: number }>();
  for (const r of rader) {
    const t = person.get(r.employee_id)?.team_id ?? "utan";
    const f = perTeam.get(t) ?? { kostnad: 0, antal: 0 };
    perTeam.set(t, { kostnad: f.kostnad + Number(r.total_cost), antal: f.antal + 1 });
  }

  return (
    <div className="flex flex-col gap-4 pt-2">
      <GuideVard slug="lonekostnad" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div data-guide="lonekostnad.rubrik">
          <h1 className="text-display text-ink-900">Lönekostnad</h1>
          <p className="mt-1 max-w-[70ch] text-body text-ink-500">
            Vad en säljare kostar, och hur mycket hon behöver sälja för att bära sin egen kostnad.
            Siffrorna är en uppskattning för beslut — inte ett löneunderlag.
          </p>
        </div>
        <ButtonLink href="/lonekostnad/satser" variant="sekundar" size="sm">
          Satser och löner
        </ButtonLink>
      </div>

      <Card guide="lonekostnad.period">
        <CardHeader titel="Period" beskrivning="Frånvaron hämtas ur löneunderlaget för perioden." />
        <div className="flex flex-wrap gap-2">
          {lista.map((p) => (
            <Link
              key={p.id}
              href={`/lonekostnad?period=${p.id}`}
              className={`tnum inline-flex min-h-9 items-center rounded-full px-4 text-small font-semibold transition-colors duration-fast ${
                p.id === period.id
                  ? "bg-brand-600 text-ink-inv"
                  : "bg-canvas text-ink-500 hover:text-ink-900"
              }`}
            >
              {p.period_start} — {p.period_end}
            </Link>
          ))}
        </div>
        <div className="mt-4">
          <Raknaknapp periodId={period.id} finnsRader={rader.length > 0} />
        </div>
      </Card>

      {rader.length === 0 ? (
        <Card>
          <EmptyState
            rubrik="Perioden är inte räknad"
            text="Tryck Räkna om perioden. Varje person som har en löneuppgift och en rad i löneunderlaget får en beräkning."
          />
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader titel="Hela bolaget" beskrivning={`${rader.length} personer i perioden`} />
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Nyckeltal etikett="Lönekostnad" varde={kronor(totalKostnad)} />
              <Nyckeltal
                etikett="Break-even i kronor sålt"
                varde={kronor(totalBreakEven)}
                hjalp={totalBreakEven === null ? "Täckningsgraden är inte satt" : undefined}
              />
              <Nyckeltal
                etikett="Intäkt"
                varde={kronor(totalIntakt)}
                hjalp={totalIntakt === null ? "Ingen intäkt inmatad" : undefined}
              />
              <Nyckeltal
                etikett="Täckningsbidrag"
                varde={kronor(totalBidrag)}
                hjalp={totalBidrag === null ? "Kräver inmatad intäkt" : undefined}
              />
            </dl>
          </Card>

          {perTeam.size > 1 && (
            <Card>
              <CardHeader titel="Per team" />
              <ul className="flex flex-col">
                {[...perTeam.entries()].map(([id, v]) => (
                  <li
                    key={id}
                    className="flex items-baseline justify-between gap-3 border-b border-canvas py-2.5 last:border-0"
                  >
                    <span className="text-body text-ink-900">
                      {id === "utan" ? "Utan team" : (teamnamn.get(id) ?? "Okänt team")}
                    </span>
                    <span className="text-small text-ink-500">{v.antal} personer</span>
                    <span className="tnum shrink-0 text-body font-semibold text-ink-900">
                      {kronor(v.kostnad)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader
              titel="Per person"
              beskrivning="Bruttolön efter eventuellt frånvaroavdrag, plus arbetsgivaravgift."
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-small">
                <thead>
                  <tr className="border-b border-canvas text-left text-micro uppercase text-ink-500">
                    <th className="py-2 pr-3 font-semibold">Person</th>
                    <th className="py-2 pr-3 text-right font-semibold">Bruttolön</th>
                    <th className="py-2 pr-3 text-right font-semibold">Arb.giv.avgift</th>
                    <th className="py-2 pr-3 text-right font-semibold">Kostnad</th>
                    <th className="py-2 pr-3 text-right font-semibold">Break-even</th>
                    <th className="py-2 text-right font-semibold">Täckningsbidrag</th>
                  </tr>
                </thead>
                <tbody>
                  {rader.map((r) => {
                    const p = person.get(r.employee_id);
                    const bidrag = r.contribution === null ? null : Number(r.contribution);
                    return (
                      <tr key={r.employee_id} className="border-b border-canvas last:border-0">
                        <td className="py-2.5 pr-3 text-ink-900">{p ? fullName(p) : "Okänd"}</td>
                        <td className="tnum py-2.5 pr-3 text-right text-ink-700">
                          {kronor(Number(r.gross_salary))}
                        </td>
                        <td className="tnum py-2.5 pr-3 text-right text-ink-700">
                          {kronor(Number(r.employer_fee))}
                        </td>
                        <td className="tnum py-2.5 pr-3 text-right font-semibold text-ink-900">
                          {kronor(Number(r.total_cost))}
                        </td>
                        <td className="tnum py-2.5 pr-3 text-right text-ink-700">
                          {kronor(r.break_even_revenue === null ? null : Number(r.break_even_revenue))}
                        </td>
                        <td className="tnum py-2.5 text-right">
                          {bidrag === null ? (
                            <span className="text-ink-300">—</span>
                          ) : (
                            <Badge ton={bidrag >= 0 ? "ok" : "danger"}>{kronor(bidrag)}</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <Notis ton="info">
        Lönerapporten räknar fortfarande ingen lön (K5, AC-2.17). Den redovisar tid och lämnar navet
        som underlag. Den här vyn är något annat: ett beslutsunderlag som stannar här, med en egen
        behörighet. Håll isär dem.
      </Notis>
    </div>
  );
}

function Nyckeltal({
  etikett,
  varde,
  hjalp,
}: {
  etikett: string;
  varde: string;
  hjalp?: string;
}) {
  return (
    <div>
      <dt className="text-micro uppercase text-ink-500">{etikett}</dt>
      <dd className="tnum mt-1 text-h2 text-ink-900">{varde}</dd>
      {hjalp && <p className="mt-0.5 text-micro text-ink-300">{hjalp}</p>}
    </div>
  );
}
