import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, fullName, hasRole } from "@/lib/auth";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Skriftliga prov — Clicknet Nav" };

/**
 * 0067: kon av skriftliga prov.
 *
 * ===========================================================================
 * ALLA CHEFER SER ALLA PROV
 *
 * Det skiljer sidan fran rollspelskon, som visar dem man leder. Valet ar
 * bestallarens, och skalet ar att ett skriftligt prov ar ett underlag for
 * saljledningen som helhet: den som rattar behover kunna jamfora tio svar pa
 * samma fraga for att veta vad tva poang ar vart. En ko som bara visar det egna
 * laget hade dessutom betytt att en saljare vars chef ar sjukskriven aldrig far
 * sitt prov rattat.
 *
 * Behorigheten star i policyn `essay_submission_read` (0067) och kontrolleras
 * en gang till har — inte for att RLS skulle svika, utan for att en saljare som
 * hittar hit ska mota "sidan ar inte for dig" i stallet for en tom lista som
 * ser trasig ut.
 * ===========================================================================
 */
export default async function Provko() {
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");
  if (!hasRole(user, "sales_manager", "team_lead", "admin", "ceo")) redirect("/utbildning");

  const supabase = await supabaseServer();
  const db = supabaseAdmin();

  const { data: rader } = await supabase
    .from("essay_submission")
    .select(
      `id, employee_id, status, submitted_at, graded_at, attempt_id, updated_at,
       course_module(title),
       course(title, slug, pass_threshold)`,
    )
    .neq("status", "utkast")
    .order("submitted_at", { ascending: true });

  const lista = rader ?? [];

  // Namnen slas upp med service role, som i rollspelskon: `employee` ar inte
  // lasbar for varje roll, och en ko med uuid:n gar inte att arbeta i.
  const namnIds = [...new Set(lista.map((r) => r.employee_id))];
  const { data: personer } = namnIds.length
    ? await db.from("employee").select("id, first_name, last_name").in("id", namnIds)
    : { data: [] };
  const namn = new Map((personer ?? []).map((p) => [p.id, fullName(p)]));

  const forsoksIds = lista.map((r) => r.attempt_id).filter(Boolean) as string[];
  const { data: forsok } = forsoksIds.length
    ? await supabase.from("course_attempt").select("id, score, passed").in("id", forsoksIds)
    : { data: [] };
  const perForsok = new Map((forsok ?? []).map((f) => [f.id, f]));

  const attRatta = lista.filter((r) => r.status === "inlamnad");
  const returnerade = lista.filter((r) => r.status === "retur");
  const rattade = lista
    .filter((r) => r.status === "rattad")
    .sort((a, b) => (a.graded_at ?? "").localeCompare(b.graded_at ?? ""))
    .reverse()
    .slice(0, 15);

  const titel = (r: (typeof lista)[number]) => {
    const kurs = r.course as unknown as { title: string } | null;
    const modul = r.course_module as unknown as { title: string } | null;
    return `${kurs?.title ?? "Kurs"} · ${modul?.title ?? "Modul"}`;
  };

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href="/utbildning"
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Tillbaka till utbildning
      </Link>

      <div>
        <h1 className="text-display text-ink-900">Skriftliga prov</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Prov med fritextsvar, rättade för hand. Du sätter poäng fråga för fråga och skriver
          tillbaka — eller skickar provet tillbaka för komplettering om ett svar säger för lite
          för att gå att bedöma.
        </p>
      </div>

      <Card>
        <CardHeader
          titel="Att rätta"
          beskrivning={
            attRatta.length === 0
              ? undefined
              : `${attRatta.length} ${attRatta.length === 1 ? "prov väntar" : "prov väntar"} · äldst först`
          }
        />
        {attRatta.length === 0 ? (
          <EmptyState
            rubrik="Inget väntar"
            text="Inlämnade skriftliga prov hamnar här, oavsett vem som lämnat in dem."
          />
        ) : (
          <ul className="flex flex-col">
            {attRatta.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/utbildning/prov/${r.id}`}
                  className="flex min-h-11 flex-wrap items-baseline gap-x-3 gap-y-1 rounded-sm border-b border-canvas px-3 py-3 transition-colors duration-fast last:border-0 hover:bg-surface-alt"
                >
                  <span className="text-body font-semibold text-ink-900">
                    {namn.get(r.employee_id) ?? "Okänd"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-small text-ink-500">
                    {titel(r)}
                  </span>
                  <span className="tnum text-small text-ink-500">
                    inlämnat {r.submitted_at?.slice(0, 10) ?? "—"}
                  </span>
                  <Badge ton="warn">Rätta</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {returnerade.length > 0 && (
        <Card>
          <CardHeader
            titel="Tillbaka hos säljaren"
            beskrivning="Skickade för komplettering. De kommer tillbaka hit när de lämnas in igen."
          />
          <ul className="flex flex-col">
            {returnerade.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-canvas px-3 py-2.5 last:border-0"
              >
                <span className="text-body text-ink-900">
                  {namn.get(r.employee_id) ?? "Okänd"}
                </span>
                <span className="min-w-0 flex-1 truncate text-small text-ink-500">{titel(r)}</span>
                <span className="tnum text-small text-ink-500">{r.updated_at.slice(0, 10)}</span>
                <Badge ton="neutral">Kompletteras</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {rattade.length > 0 && (
        <Card>
          <CardHeader
            titel="Rättade"
            beskrivning="De femton senaste. Betyget står kvar i historiken och går inte att ändra."
          />
          <ul className="flex flex-col">
            {rattade.map((r) => {
              const f = r.attempt_id ? perForsok.get(r.attempt_id) : undefined;
              return (
                <li key={r.id}>
                  <Link
                    href={`/utbildning/prov/${r.id}`}
                    className="flex min-h-11 flex-wrap items-baseline gap-x-3 gap-y-1 rounded-sm border-b border-canvas px-3 py-2.5 transition-colors duration-fast last:border-0 hover:bg-surface-alt"
                  >
                    <span className="text-body text-ink-900">
                      {namn.get(r.employee_id) ?? "Okänd"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-small text-ink-500">
                      {titel(r)}
                    </span>
                    <span className="tnum text-small text-ink-500">
                      {r.graded_at?.slice(0, 10)}
                    </span>
                    {f && <span className="tnum text-small text-ink-700">{f.score} %</span>}
                    <Badge ton={f?.passed ? "ok" : "danger"}>
                      {f?.passed ? "Godkänt" : "Underkänt"}
                    </Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
