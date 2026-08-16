import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser, hasRole, fullName } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { riktarSigTill } from "@/lib/dokument";
import { kursLage, LAGE_ETIKETT, LAGE_TON, type KursLage } from "@/lib/utbildning";

export const dynamic = "force-dynamic";
export const metadata = { title: "Utbildningsprogress — Clicknet Nav" };

/**
 * AC-6.6. Vyn visar bara dem RLS slapper igenom: en teamledare ser sitt team,
 * ledningen ser alla. Filtreringen sker alltsa i databasen, inte har.
 */
export default async function OversiktSida() {
  const user = await getCurrentUser();
  if (!hasRole(user, "sales_manager", "admin", "ceo", "team_lead")) redirect("/utbildning");

  const supabase = await supabaseServer();

  const [{ data: personal }, { data: kurser }, { data: moduler }, { data: progress }, { data: cert }, { data: roller }] =
    await Promise.all([
      supabase
        .from("employee")
        .select("id, first_name, last_name, start_date, team_id, status")
        .neq("status", "offboarded")
        .order("first_name"),
      supabase
        .from("course")
        .select("id, slug, title, audience_roles, due_days")
        .eq("status", "published")
        .order("title"),
      supabase.from("course_module").select("id, course_id"),
      supabase.from("module_progress").select("employee_id, module_id"),
      supabase
        .from("certification")
        .select("employee_id, course_id, issued_at, expires_at")
        .order("issued_at", { ascending: false }),
      supabase.from("employee_role").select("employee_id, role"),
    ]);

  const rollPer = new Map<string, string[]>();
  for (const r of roller ?? []) {
    rollPer.set(r.employee_id, [...(rollPer.get(r.employee_id) ?? []), r.role]);
  }

  const modulerPer = new Map<string, string[]>();
  for (const m of moduler ?? []) {
    modulerPer.set(m.course_id, [...(modulerPer.get(m.course_id) ?? []), m.id]);
  }

  const klaraPer = new Map<string, Set<string>>();
  for (const p of progress ?? []) {
    const s = klaraPer.get(p.employee_id) ?? new Set<string>();
    s.add(p.module_id);
    klaraPer.set(p.employee_id, s);
  }

  const certPer = new Map<string, { issued_at: string; expires_at: string | null }>();
  for (const c of cert ?? []) {
    const nyckel = `${c.employee_id}:${c.course_id}`;
    if (!certPer.has(nyckel)) certPer.set(nyckel, c);
  }

  const rader = (personal ?? []).map((p) => {
    const personRoller = rollPer.get(p.id) ?? [];
    const mina = (kurser ?? []).filter((k) =>
      riktarSigTill({ audience_roles: k.audience_roles, audience_teams: [] }, personRoller, p.team_id),
    );

    return {
      person: p,
      kurser: mina.map((k) => {
        const modulIds = modulerPer.get(k.id) ?? [];
        const klara = klaraPer.get(p.id) ?? new Set<string>();
        return {
          ...k,
          lage: kursLage({
            certifikat: certPer.get(`${p.id}:${k.id}`) ?? null,
            klaraModuler: modulIds.filter((id) => klara.has(id)).length,
            antalModuler: modulIds.length,
            startDatum: p.start_date,
            fristDagar: k.due_days,
          }),
        };
      }),
    };
  });

  const summa: Record<KursLage, number> = {
    certifierad: 0,
    pagar: 0,
    ej_paborjad: 0,
    forsenad: 0,
    utgangen: 0,
  };
  for (const r of rader) for (const k of r.kurser) summa[k.lage]++;

  const kraverAtgard = summa.forsenad + summa.utgangen;

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
        <h1 className="text-display text-ink-900">Utbildningsprogress</h1>
        <p className="mt-1 text-body text-ink-500">
          {kraverAtgard > 0
            ? `${kraverAtgard} kräver åtgärd — försenade eller utgångna.`
            : "Inget försenat eller utgånget."}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(summa) as KursLage[])
          .filter((l) => summa[l] > 0)
          .map((l) => (
            <span key={l} className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 shadow-elev-1">
              <Badge ton={LAGE_TON[l]}>{LAGE_ETIKETT[l]}</Badge>
              <span className="tnum text-small text-ink-700">{summa[l]}</span>
            </span>
          ))}
      </div>

      {rader.length === 0 || (kurser ?? []).length === 0 ? (
        <Card>
          <EmptyState
            rubrik="Inget att visa än"
            text="Vyn fylls när det finns publicerade kurser och personer som de riktar sig till."
          />
        </Card>
      ) : (
        <Card className="p-0 md:p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse">
              <thead>
                <tr className="border-b border-canvas">
                  <th scope="col" className="px-6 py-3 text-left text-micro uppercase text-ink-500">
                    Person
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-micro uppercase text-ink-500">
                    Kurser
                  </th>
                </tr>
              </thead>
              <tbody>
                {rader.map((r) => (
                  <tr key={r.person.id} className="border-b border-canvas last:border-0">
                    <td className="px-6 py-3 align-top">
                      <Link
                        href={`/personal/${r.person.id}`}
                        className="font-semibold text-ink-900 hover:underline"
                      >
                        {fullName(r.person)}
                      </Link>
                    </td>
                    <td className="px-6 py-3">
                      {r.kurser.length === 0 ? (
                        <span className="text-small text-ink-500">Inga kurser riktade hit</span>
                      ) : (
                        <ul className="flex flex-wrap gap-2">
                          {r.kurser.map((k) => (
                            <li key={k.id}>
                              <Link
                                href={`/utbildning/${k.slug}`}
                                className="inline-flex items-center gap-2 rounded-full bg-canvas px-3 py-1 text-small text-ink-700 hover:bg-surface-alt"
                              >
                                {k.title}
                                <Badge ton={LAGE_TON[k.lage]}>{LAGE_ETIKETT[k.lage]}</Badge>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
