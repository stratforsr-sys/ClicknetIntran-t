import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { statistik, manaden, forslagOmRutin, FORSLAGSGRANS } from "@/lib/arenden";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ärendestatistik — Clicknet Nav" };

function Tabell({
  rubrik,
  rader,
  etikett,
}: {
  rubrik: string;
  rader: { nyckel: string; antal: number; medianTimmar: number | null; overTiden: number }[];
  etikett?: Map<string, string>;
}) {
  return (
    <Card>
      <CardHeader titel={rubrik} />
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-ink-200 text-micro uppercase tracking-wide text-ink-500">
            <th className="py-2 pr-4 font-semibold">{rubrik.includes("månad") ? "Månad" : "Grupp"}</th>
            <th className="py-2 pr-4 text-right font-semibold">Antal</th>
            <th className="py-2 pr-4 text-right font-semibold">Median</th>
            <th className="py-2 text-right font-semibold">Över tiden</th>
          </tr>
        </thead>
        <tbody>
          {rader.map((r) => (
            <tr key={r.nyckel} className="border-b border-ink-100 last:border-0">
              <td className="py-2 pr-4 text-body text-ink-900">{etikett?.get(r.nyckel) ?? r.nyckel}</td>
              <td className="tnum py-2 pr-4 text-right text-body text-ink-900">{r.antal}</td>
              <td className="tnum py-2 pr-4 text-right text-small text-ink-700">
                {r.medianTimmar === null ? "—" : `${r.medianTimmar} h`}
              </td>
              <td className="tnum py-2 text-right text-small text-ink-500">{r.overTiden || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/**
 * AC-4.5. Median och inte medelvärde: ett enda ärende som låg öppet över
 * semestern drar upp ett medelvärde tills det inte beskriver någonting.
 */
export default async function StatistikSida() {
  const user = await getCurrentUser();
  if (!hasRole(user, "sales_manager", "ceo") || !user?.employee) redirect("/arenden");

  const supabase = await supabaseServer();
  const [{ data: arenden }, { data: kategorier }, { data: team }, { data: personal }] =
    await Promise.all([
      supabase
        .from("hr_case")
        .select("category, employee_id, created_at, due_at, resolved_at")
        .order("created_at", { ascending: false })
        .limit(1000),
      supabase.from("case_category").select("id, label").order("sort"),
      supabase.from("team").select("id, name"),
      supabase.from("employee").select("id, team_id"),
    ]);

  const etikett = new Map((kategorier ?? []).map((k) => [k.id, k.label]));
  const teamNamn = new Map((team ?? []).map((t) => [t.id, t.name]));
  const teamFor = new Map((personal ?? []).map((p) => [p.id, p.team_id]));

  const rader = (arenden ?? []).map((a) => ({
    category: a.category,
    team_id: teamFor.get(a.employee_id) ?? null,
    created_at: a.created_at,
    due_at: a.due_at,
    resolved_at: a.resolved_at,
  }));

  const forslag = forslagOmRutin(rader);

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href="/arenden"
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Tillbaka till ärenden
      </Link>

      <div>
        <h1 className="text-display text-ink-900">Ärendestatistik</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Antal och mediantid till lösning. Konfidentiella ärenden räknas med i siffrorna men
          rubrikerna syns inte här.
        </p>
      </div>

      {rader.length === 0 ? (
        <Card>
          <EmptyState rubrik="Inget att räkna på än" text="Statistiken fylls när ärendena börjar komma in." />
        </Card>
      ) : (
        <>
          {/* AC-4.7: tre liknande fragor pa nittio dagar ar en rutin som saknas. */}
          {forslag.length > 0 && (
            <Card status="brand">
              <CardHeader
                titel="Skriv en rutin i stället"
                beskrivning={`Samma sorts fråga har kommit minst ${FORSLAGSGRANS} gånger på 90 dagar. En rutin svarar en gång för alla.`}
              />
              <ul className="flex flex-col gap-3">
                {forslag.map((f) => (
                  <li key={f.kategori} className="flex flex-wrap items-center gap-3">
                    <Badge ton="brand">{f.antal} ärenden</Badge>
                    <span className="text-body text-ink-900">{etikett.get(f.kategori) ?? f.kategori}</span>
                    <ButtonLink href="/rutiner/ny" size="sm" className="ml-auto">
                      Skapa rutin
                    </ButtonLink>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Tabell rubrik="Per kategori" rader={statistik(rader, (a) => a.category)} etikett={etikett} />
          <Tabell
            rubrik="Per team"
            rader={statistik(rader, (a) => a.team_id ?? "utan-team")}
            etikett={new Map([...teamNamn, ["utan-team", "Utan team"]])}
          />
          <Tabell rubrik="Per månad" rader={statistik(rader, (a) => manaden(a.created_at))} />
        </>
      )}
    </div>
  );
}
