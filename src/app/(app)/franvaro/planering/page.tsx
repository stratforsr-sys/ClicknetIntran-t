import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, fullName, hasRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { svensktDatum } from "@/lib/klocka";
import {
  dagarna,
  datumPlus,
  iHuvudsemesterfonstret,
  semesteraret,
  semesteraretsEtikett,
  type Regelverk,
} from "@/lib/franvaro";
import { REGELFALT } from "@/lib/franvaro-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Semesterplanering — Clicknet Nav" };

/**
 * E7.18 / AC-3.14: årsvy med luckor och överlapp.
 *
 * En vecka per kolumn och en person per rad. Veckor och inte dagar: en årsvy
 * med 365 kolumner går inte att läsa på en skärm, och beslutet chefen fattar
 * här — "vem är borta samtidigt i juli" — avgörs på veckonivå.
 *
 * Sjukfrånvaro finns inte i vyn. Det här är en PLANERINGSVY, och sjukdom går
 * inte att planera; att lägga in den hade dessutom gjort en semesterkarta till
 * en hälsokarta som varje teamledare bläddrar i (AC-3.26).
 */
export default async function Planering({
  searchParams,
}: {
  searchParams: Promise<{ ar?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");
  if (!hasRole(user, "sales_manager", "ceo", "team_lead")) redirect("/franvaro");

  const { ar } = await searchParams;
  const supabase = await supabaseServer();
  const idag = svensktDatum();

  const { data: policy } = await supabase.from("absence_policy").select(REGELFALT).maybeSingle();
  const regler = policy as Regelverk | null;
  if (!regler) redirect("/franvaro");

  // Semesteråret som visas. Utan val: det som gäller i dag.
  const utgang = ar && /^\d{4}$/.test(ar) ? `${ar}-${String(regler.vacation_year_start_month).padStart(2, "0")}-${String(regler.vacation_year_start_day).padStart(2, "0")}` : idag;
  const { start, slut } = semesteraret(utgang, regler);
  const etikett = semesteraretsEtikett(start, regler);

  const [{ data: perioder }, { data: typer }] = await Promise.all([
    // RLS avgör vilka personer som kommer med: teamledaren sitt team,
    // ledningen alla. Vyn behöver inget eget filter ovanpå det.
    supabase
      .from("absence_request")
      .select("id, employee_id, type_id, starts_on, ends_on, part_day_minutes")
      .eq("status", "approved")
      .lte("starts_on", slut)
      .gte("ends_on", start),
    supabase.from("absence_type").select("id, label, uses_balance"),
  ]);

  const berorda = [...new Set((perioder ?? []).map((p) => p.employee_id))];
  const { data: personer } = await supabase
    .from("employee")
    .select("id, first_name, last_name, team_id")
    .neq("status", "offboarded")
    .order("first_name");

  const typkarta = new Map((typer ?? []).map((t) => [t.id, t]));

  // Veckorna. Måndagar från semesterårets start till dess slut.
  const veckor: string[] = [];
  let m = start;
  // Backa till närmaste måndag så att kolumnerna börjar på en veckogräns.
  while (new Date(`${m}T00:00:00Z`).getUTCDay() !== 1) m = datumPlus(m, -1);
  while (m <= slut) {
    veckor.push(m);
    m = datumPlus(m, 7);
  }

  const ledigDagar = new Map<string, Set<string>>();
  for (const p of perioder ?? []) {
    // Del av dag markerar inte hela veckan som ledig — den syns inte i årsvyn
    // alls. Ett läkarbesök på en förmiddag är ingen bemanningsfråga.
    if (p.part_day_minutes !== null) continue;
    const set = ledigDagar.get(p.employee_id) ?? new Set<string>();
    for (const d of dagarna(p.starts_on, p.ends_on)) set.add(d);
    ledigDagar.set(p.employee_id, set);
  }

  const rader = (personer ?? []).filter((p) => ledigDagar.has(p.id) || berorda.length === 0);
  const visade = rader.length > 0 ? rader : (personer ?? []);

  const arNu = +start.slice(0, 4);

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href="/franvaro"
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Tillbaka till frånvaro
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-display text-ink-900">Semesterplanering {etikett}</h1>
          <p className="mt-1 max-w-[70ch] text-body text-ink-500">
            Godkänd ledighet, en vecka per kolumn. Sjukfrånvaro visas inte — den går inte att
            planera, och en planeringsvy ska inte bli en hälsokarta.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/franvaro/planering?ar=${arNu - 1}`}
            className="text-small font-semibold text-brand-700 hover:text-brand-900"
          >
            ← {arNu - 1}/{String(arNu).slice(2)}
          </Link>
          <Link
            href={`/franvaro/planering?ar=${arNu + 1}`}
            className="text-small font-semibold text-brand-700 hover:text-brand-900"
          >
            {arNu + 1}/{String(arNu + 2).slice(2)} →
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader
          titel="Året i veckor"
          beskrivning={`${start} till ${slut}. Skuggat fält är huvudsemesterfönstret.`}
        />

        {visade.length === 0 ? (
          <EmptyState rubrik="Ingen personal att visa" text="Vyn fylls när det finns godkänd ledighet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] border-separate border-spacing-0 text-micro">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-surface py-2 pr-3 text-left font-semibold text-ink-500">
                    Person
                  </th>
                  {veckor.map((v) => (
                    <th key={v} className="w-4 px-0 py-2 text-center font-normal text-ink-300">
                      {/* Bara var fjarde vecka far en siffra. Alla 52 blir en grot. */}
                      {veckonummer(v) % 4 === 1 ? veckonummer(v) : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visade.map((p) => {
                  const mina = ledigDagar.get(p.id) ?? new Set<string>();
                  return (
                    <tr key={p.id}>
                      <td className="sticky left-0 z-10 whitespace-nowrap bg-surface py-1.5 pr-3 text-small text-ink-900">
                        {fullName(p)}
                      </td>
                      {veckor.map((v) => {
                        const dagar = dagarna(v, datumPlus(v, 6));
                        const antal = dagar.filter((d) => mina.has(d)).length;
                        const huvud = dagar.some((d) => iHuvudsemesterfonstret(d, regler));
                        return (
                          <td key={v} className="px-px py-1.5">
                            <span
                              title={`${v} — ${antal} ${antal === 1 ? "dag" : "dagar"} ledig`}
                              className={`block h-5 rounded-xs ${
                                antal >= 5
                                  ? "bg-brand-600"
                                  : antal > 0
                                    ? "bg-brand-300"
                                    : huvud
                                      ? "bg-canvas"
                                      : "bg-surface-alt"
                              }`}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-4 text-micro text-ink-500">
          <span className="flex items-center gap-2">
            <span className="size-3 rounded-xs bg-brand-600" /> Hela veckan
          </span>
          <span className="flex items-center gap-2">
            <span className="size-3 rounded-xs bg-brand-300" /> Del av veckan
          </span>
          <span className="flex items-center gap-2">
            <span className="size-3 rounded-xs bg-canvas" /> Huvudsemesterfönstret
          </span>
        </div>
      </Card>

      <Card>
        <CardHeader titel="Veckor där flera är borta samtidigt" beskrivning="Överlappen, i ordning." />
        <Overlapp veckor={veckor} ledigDagar={ledigDagar} personer={personer ?? []} />
      </Card>

      <Card>
        <CardHeader titel="Ledighet per typ" />
        <ul className="flex flex-wrap gap-2">
          {[...typkarta.values()].map((t) => {
            const antal = (perioder ?? []).filter((p) => p.type_id === t.id).length;
            if (antal === 0) return null;
            return (
              <li key={t.id}>
                <Badge ton={t.uses_balance ? "brand" : "neutral"}>
                  {t.label}: {antal}
                </Badge>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

function Overlapp({
  veckor,
  ledigDagar,
  personer,
}: {
  veckor: string[];
  ledigDagar: Map<string, Set<string>>;
  personer: { id: string; first_name: string; last_name: string }[];
}) {
  const namn = new Map(personer.map((p) => [p.id, fullName(p)]));
  const rader: { vecka: string; folk: string[] }[] = [];

  for (const v of veckor) {
    const dagar = dagarna(v, datumPlus(v, 6));
    const folk = [...ledigDagar.entries()]
      .filter(([, set]) => dagar.some((d) => set.has(d)))
      .map(([id]) => namn.get(id) ?? "Okänd");
    if (folk.length >= 2) rader.push({ vecka: v, folk });
  }

  if (rader.length === 0)
    return <p className="text-small text-ink-500">Ingen vecka har fler än en person borta.</p>;

  return (
    <ul className="flex flex-col">
      {rader.map((r) => (
        <li key={r.vecka} className="flex flex-wrap items-baseline gap-3 border-b border-canvas py-2 last:border-0">
          <span className="w-32 shrink-0 text-small font-semibold text-ink-900">
            Vecka {veckonummer(r.vecka)}
          </span>
          <span className="text-small text-ink-500">
            {r.folk.length} personer: {r.folk.join(", ")}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** ISO 8601-veckonummer. Torsdagen i veckan avgör vilket år veckan hör till. */
function veckonummer(datum: string): number {
  const d = new Date(`${datum}T00:00:00Z`);
  const dag = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dag + 3);
  const forstaTorsdag = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const skift = (forstaTorsdag.getUTCDay() + 6) % 7;
  forstaTorsdag.setUTCDate(forstaTorsdag.getUTCDate() - skift + 3);
  return 1 + Math.round((d.getTime() - forstaTorsdag.getTime()) / (7 * 86_400_000));
}
