import { redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCurrentUser, hasRole, fullName } from "@/lib/auth";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { timmarOchMinuter } from "@/lib/tid";

export const dynamic = "force-dynamic";
export const metadata = { title: "Arbetstidsjournal — Clicknet Nav" };

/**
 * AC-2.6: compliance-vy, dold i vardagen. Sidan är med flit inte länkad från
 * startsidan eller huvudmenyn — den som behöver den vet var den finns, och den
 * som inte behöver den ska inte snubbla in i den.
 *
 * Det är också den enda vy i navet där orden jourtid, övertid och mertid får
 * förekomma (AC-2.19–2.21). Överallt annars är de förbjudna, eftersom de i ett
 * vardagsgränssnitt lätt läses som ett omdöme i stället för en redovisning.
 *
 * AC-2.7: journalen bevaras i tre år och undantas gallringsjobbet.
 */
export default async function ArbetstidSida({
  searchParams,
}: {
  searchParams: Promise<{ fran?: string; till?: string; person?: string }>;
}) {
  const user = await getCurrentUser();
  if (!hasRole(user, "sales_manager", "admin") || !user?.employee) redirect("/");

  const sp = await searchParams;
  const idag = new Date();
  const standardFran = new Date(idag.getFullYear(), idag.getMonth(), 1).toISOString().slice(0, 10);
  const fran = sp.fran ?? standardFran;
  const till = sp.till ?? idag.toISOString().slice(0, 10);

  const supabase = await supabaseServer();
  let fraga = supabase
    .from("work_time_journal")
    .select("employee_id, work_date, worked_minutes, break_minutes, on_call_minutes, overtime_minutes, extra_time_minutes, auto_closed")
    .gte("work_date", fran)
    .lte("work_date", till)
    .order("work_date", { ascending: false });

  if (sp.person) fraga = fraga.eq("employee_id", sp.person);

  const [{ data: rader }, { data: personal }] = await Promise.all([
    fraga,
    supabase.from("employee").select("id, first_name, last_name").order("first_name"),
  ]);

  const namn = new Map((personal ?? []).map((p) => [p.id, fullName(p)]));
  const lista = rader ?? [];

  // K19-andan: en compliance-vy over andras arbetstid ar insyn, och insyn loggas.
  await supabaseAdmin().from("audit_log").insert({
    actor_id: user.employee.id,
    action: "journal.viewed",
    object_type: "work_time_journal",
    object_id: sp.person ?? "alla",
    meta: { fran, till, rader: lista.length },
  });

  const summa = lista.reduce(
    (s, r) => ({
      arbetat: s.arbetat + r.worked_minutes,
      rast: s.rast + r.break_minutes,
      jour: s.jour + r.on_call_minutes,
      over: s.over + r.overtime_minutes,
      mer: s.mer + r.extra_time_minutes,
    }),
    { arbetat: 0, rast: 0, jour: 0, over: 0, mer: 0 },
  );

  const csv = `/admin/arbetstid/csv?fran=${fran}&till=${till}${sp.person ? `&person=${sp.person}` : ""}`;

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <h1 className="text-display text-ink-900">Arbetstidsjournal</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Underlag för arbetstidslagens krav på förda anteckningar. Bevaras i tre år och gallras
          inte. Sidan är inte länkad från menyn.
        </p>
      </div>

      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-small font-semibold text-ink-700">Från</span>
            <input
              type="date"
              name="fran"
              defaultValue={fran}
              className="rounded-sm bg-surface px-4 py-2.5 text-body shadow-elev-1 focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-small font-semibold text-ink-700">Till</span>
            <input
              type="date"
              name="till"
              defaultValue={till}
              className="rounded-sm bg-surface px-4 py-2.5 text-body shadow-elev-1 focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-small font-semibold text-ink-700">Person</span>
            <select
              name="person"
              defaultValue={sp.person ?? ""}
              className="appearance-none rounded-sm bg-surface px-4 py-2.5 pr-10 text-body shadow-elev-1 focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              <option value="">Alla</option>
              {(personal ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {fullName(p)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="min-h-11 rounded-full bg-brand-600 px-6 text-body font-semibold text-ink-inv hover:bg-brand-700"
          >
            Visa
          </button>
          <a
            href={csv}
            className="min-h-11 rounded-full bg-surface px-6 py-2.5 text-body font-semibold text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50"
          >
            Hämta som CSV
          </a>
        </form>
      </Card>

      {lista.length === 0 ? (
        <Card>
          <EmptyState
            rubrik="Inga rader i perioden"
            text="Journalen skrivs av nattjobbet när ett dygn är avslutat. Är stämplingen nyss påslagen finns första raden i morgon."
          />
        </Card>
      ) : (
        <Card className="p-0 md:p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] border-collapse">
              <thead>
                <tr className="border-b border-canvas">
                  {["Datum", "Person", "Arbetad", "Rast", "Jourtid", "Övertid", "Mertid", ""].map((h) => (
                    <th key={h} scope="col" className="px-4 py-3 text-left text-micro uppercase text-ink-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lista.map((r) => (
                  <tr key={`${r.employee_id}-${r.work_date}`} className="border-b border-canvas last:border-0">
                    <td className="tnum px-4 py-2 text-small text-ink-700">{r.work_date}</td>
                    <td className="px-4 py-2 text-small text-ink-900">
                      {namn.get(r.employee_id) ?? "Okänd"}
                    </td>
                    <td className="tnum px-4 py-2 text-small text-ink-900">
                      {timmarOchMinuter(r.worked_minutes)}
                    </td>
                    <td className="tnum px-4 py-2 text-small text-ink-500">
                      {timmarOchMinuter(r.break_minutes)}
                    </td>
                    <td className="tnum px-4 py-2 text-small text-ink-500">{r.on_call_minutes}</td>
                    <td className="tnum px-4 py-2 text-small text-ink-500">{r.overtime_minutes}</td>
                    <td className="tnum px-4 py-2 text-small text-ink-500">{r.extra_time_minutes}</td>
                    <td className="px-4 py-2">
                      {r.auto_closed && <Badge ton="warn">Stängd av navet</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-canvas font-semibold">
                  <td className="px-4 py-3 text-small text-ink-900" colSpan={2}>
                    Summa
                  </td>
                  <td className="tnum px-4 py-3 text-small text-ink-900">
                    {timmarOchMinuter(summa.arbetat)}
                  </td>
                  <td className="tnum px-4 py-3 text-small text-ink-700">
                    {timmarOchMinuter(summa.rast)}
                  </td>
                  <td className="tnum px-4 py-3 text-small text-ink-700">{summa.jour}</td>
                  <td className="tnum px-4 py-3 text-small text-ink-700">{summa.over}</td>
                  <td className="tnum px-4 py-3 text-small text-ink-700">{summa.mer}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader titel="Om kolumnerna" />
        <p className="max-w-[70ch] text-small text-ink-500">
          Jourtid, övertid och mertid står åtskilda här eftersom lagen kräver det, och de står
          som noll tills arbetsschemat kan skilja dem åt. En gissad siffra i en compliance-vy är
          sämre än en tom. Orden förekommer inte någon annanstans i navet — i ett
          vardagsgränssnitt läses de lätt som ett omdöme i stället för en redovisning.
        </p>
      </Card>
    </div>
  );
}
