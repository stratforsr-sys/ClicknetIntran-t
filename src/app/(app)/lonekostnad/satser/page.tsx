import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Notis } from "@/components/ui/Notis";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, fullName } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { svensktDatum } from "@/lib/klocka";
import { farSeLonekostnad, hamtaSatser } from "@/lib/lonekostnad-server";
import { Satsformular, Loneformular, Intaktsformular } from "./Formular";

export const dynamic = "force-dynamic";
export const metadata = { title: "Satser och löner — Clicknet Nav" };

const SATSETIKETT: Record<string, string> = {
  employer_fee_standard: "Arbetsgivaravgift, full",
  employer_fee_reduced: "Arbetsgivaravgift, nedsatt",
  employer_fee_reduced_cap: "Månadstak för nedsättningen",
  young_age_min: "Ungdomsnedsättning, från ålder",
  young_age_max: "Ungdomsnedsättning, till ålder",
  senior_age_min: "Äldrenedsättning, från ålder",
  contribution_margin: "Täckningsgrad",
  absence_cost_factor: "Lön som betalas under frånvaro",
};

/**
 * E15.2 / §13.2: här bor varje sats lönekostnaden räknar med.
 *
 * Ingen procentsats står som literal i `src/lib/lonekostnad.ts` — varje gräns
 * kommer in som argument härifrån. Samma linje som `/franvaro/regler` drog för
 * frånvaroreglerna: en regeländring ska vara en rad, inte en deploy.
 *
 * K28 / E15.8: varje sats har en ägare och ett datum för översyn. En sats utan
 * namngiven ägare är en sats ingen uppdaterar, och en föråldrad
 * arbetsgivaravgift ger fel siffra utan att någonstans se fel ut.
 */
export default async function Satssida() {
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");
  if (!farSeLonekostnad(user)) redirect("/");

  const db = supabaseAdmin();
  const idag = svensktDatum();

  const [{ data: satser }, { data: anstallda }, { data: loner }, { data: perioder }, { data: typer }] =
    await Promise.all([
      db
        .from("cost_rate")
        .select("id, kind, applies_to, unit, value, valid_from, valid_to, review_due, owner_id, note")
        .order("kind")
        .order("valid_from", { ascending: false }),
      db
        .from("employee")
        .select("id, first_name, last_name, birth_year, status")
        .neq("status", "offboarded")
        .order("first_name"),
      db
        .from("salary_basis")
        .select("id, employee_id, monthly_salary, valid_from, entered_at")
        .order("valid_from", { ascending: false }),
      db
        .from("payroll_period")
        .select("id, period_start, period_end")
        .order("period_start", { ascending: false })
        .limit(6),
      db.from("absence_type").select("id, label").order("sort"),
    ]);

  const galler = await hamtaSatser(db, idag);
  const namn = new Map((anstallda ?? []).map((p) => [p.id, fullName(p)]));

  const senasteLon = new Map<string, { monthly_salary: number; valid_from: string }>();
  for (const l of loner ?? []) {
    if (!senasteLon.has(l.employee_id) && l.valid_from <= idag) {
      senasteLon.set(l.employee_id, { monthly_salary: Number(l.monthly_salary), valid_from: l.valid_from });
    }
  }

  const forfallna = (satser ?? []).filter((s) => s.review_due && s.review_due < idag);
  const utanAgare = (satser ?? []).filter((s) => !s.owner_id && !s.valid_to);

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href="/lonekostnad"
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Tillbaka till lönekostnad
      </Link>

      <div>
        <h1 className="text-display text-ink-900">Satser och löner</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Varje sats som lönekostnaden räknar med står här. Ingen av dem finns i koden, så en
          ändring gäller i samma stund — även för en omräkning av en gammal period.
        </p>
      </div>

      {galler.tackningsgrad === null && (
        <Notis ton="warn">
          Täckningsgraden är inte satt, så break-even i kronor sålt går inte att räkna. Den är
          medvetet inte förifylld: en gissad täckningsgrad ger en siffra som ser exakt ut, och den
          siffran är hela skälet att vyn finns.
        </Notis>
      )}

      {forfallna.length > 0 && (
        <Notis ton="danger">
          {forfallna.length} {forfallna.length === 1 ? "sats har" : "satser har"} passerat sitt
          datum för översyn. En föråldrad sats ger fel siffra utan att se fel ut.
        </Notis>
      )}

      {utanAgare.length > 0 && (
        <Notis ton="info">
          {utanAgare.length} gällande {utanAgare.length === 1 ? "sats saknar" : "satser saknar"}{" "}
          ägare (K28). Sätt en ägare och ett datum för översyn — annars är det ingen som uppdaterar
          dem.
        </Notis>
      )}

      <Card>
        <CardHeader
          titel="Gällande satser"
          beskrivning="Den senaste raden med ett giltighetsdatum som redan passerat gäller."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] text-small">
            <thead>
              <tr className="border-b border-canvas text-left text-micro uppercase text-ink-500">
                <th className="py-2 pr-3 font-semibold">Sats</th>
                <th className="py-2 pr-3 text-right font-semibold">Värde</th>
                <th className="py-2 pr-3 font-semibold">Gäller från</th>
                <th className="py-2 pr-3 font-semibold">Ägare</th>
                <th className="py-2 font-semibold">Översyn</th>
              </tr>
            </thead>
            <tbody>
              {(satser ?? []).map((s) => (
                <tr key={s.id} className="border-b border-canvas last:border-0">
                  <td className="py-2.5 pr-3 text-ink-900">
                    {SATSETIKETT[s.kind] ?? s.kind}
                    {s.applies_to && <span className="text-ink-500"> · {s.applies_to}</span>}
                    {s.note && <span className="block text-micro text-ink-300">{s.note}</span>}
                  </td>
                  <td className="tnum py-2.5 pr-3 text-right text-ink-900">
                    {Number(s.value).toLocaleString("sv-SE")}
                    {s.unit === "percent" ? " %" : s.unit === "amount" ? " kr" : " år"}
                  </td>
                  <td className="tnum py-2.5 pr-3 text-ink-500">{s.valid_from}</td>
                  <td className="py-2.5 pr-3 text-ink-500">
                    {s.owner_id ? (namn.get(s.owner_id) ?? "Okänd") : <span className="text-ink-300">—</span>}
                  </td>
                  <td className="tnum py-2.5 text-ink-500">
                    {s.review_due ? (
                      <span className={s.review_due < idag ? "text-danger-ink" : ""}>{s.review_due}</span>
                    ) : (
                      <span className="text-ink-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Satsformular
          personer={(anstallda ?? []).map((p) => ({ id: p.id, namn: fullName(p) }))}
          franvarotyper={(typer ?? []).map((t) => ({ id: t.id, label: t.label }))}
          idag={idag}
        />
      </Card>

      <Card>
        <CardHeader
          titel="Månadslöner"
          beskrivning="Matas in för hand. Navet räknar ingen lön och förhandlar ingen — det tar emot ett tal någon annan bestämt."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-small">
            <thead>
              <tr className="border-b border-canvas text-left text-micro uppercase text-ink-500">
                <th className="py-2 pr-3 font-semibold">Person</th>
                <th className="py-2 pr-3 text-right font-semibold">Månadslön</th>
                <th className="py-2 pr-3 font-semibold">Gäller från</th>
                <th className="py-2 font-semibold">Födelseår</th>
              </tr>
            </thead>
            <tbody>
              {(anstallda ?? []).map((p) => {
                const lon = senasteLon.get(p.id);
                return (
                  <tr key={p.id} className="border-b border-canvas last:border-0">
                    <td className="py-2.5 pr-3 text-ink-900">{fullName(p)}</td>
                    <td className="tnum py-2.5 pr-3 text-right text-ink-900">
                      {lon ? (
                        Number(lon.monthly_salary).toLocaleString("sv-SE") + " kr"
                      ) : (
                        <span className="text-ink-300">saknas</span>
                      )}
                    </td>
                    <td className="tnum py-2.5 pr-3 text-ink-500">{lon?.valid_from ?? "—"}</td>
                    <td className="tnum py-2.5 text-ink-500">
                      {p.birth_year ?? <span className="text-ink-300">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-micro text-ink-500">
          K27: navet lagrar <strong>bara året</strong>, aldrig ett födelsedatum och aldrig ett
          personnummer. Året räcker — både ungdoms- och äldrenedsättningen utgår från åldern vid
          årets ingång, och den är exakt känd av året allena. Saknas året används full
          arbetsgivaravgift, vilket är den försiktiga riktningen.
        </p>

        <Loneformular
          personer={(anstallda ?? []).map((p) => ({
            id: p.id,
            namn: fullName(p),
            fodelsear: p.birth_year,
          }))}
          idag={idag}
        />
      </Card>

      <Card>
        <CardHeader
          titel="Intäkt per person och period"
          beskrivning="Krävs för täckningsbidrag (AC-13.7). Matas in för hand tills E11 och E13 finns."
        />
        <p className="text-small text-ink-500">
          Ingen inmatad intäkt är ett giltigt läge. Vyn visar då inget täckningsbidrag i stället för
          ett negativt — <em>ingen uppgift</em> och <em>noll kronor</em> är inte samma sak.
        </p>
        <Intaktsformular
          personer={(anstallda ?? []).map((p) => ({ id: p.id, namn: fullName(p) }))}
          perioder={(perioder ?? []).map((p) => ({
            id: p.id,
            etikett: `${p.period_start} — ${p.period_end}`,
          }))}
        />
      </Card>
    </div>
  );
}
