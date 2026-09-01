import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { TYP_ETIKETT, type Uppgiftstyp } from "@/lib/coachning";
import { farCoacha, fokusomraden } from "@/lib/coachning-server";
import { NyMall } from "./NyMall";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coachningsmallar — Clicknet Nav" };

/**
 * U1. Mallarna.
 *
 * En rampplan for en ny saljare ar tolv moment. Skrivs de for hand tolv ganger
 * per anstallning skrivs de i praktiken noll ganger — det ar samma erfarenhet
 * som `course.due_days` bygger pa, och skalet till att den har vyn finns.
 */
export default async function MallarSida() {
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");
  if (!farCoacha(user)) redirect(`/coachning/${user.employee.id}`);

  const supabase = await supabaseServer();
  const [{ data: mallar }, { data: poster }, fokus] = await Promise.all([
    supabase.from("coaching_template").select("id, name, description_md, active").order("name"),
    supabase.from("coaching_template_item").select("template_id, sort, kind, title, offset_days").order("sort"),
    fokusomraden(),
  ]);

  const perMall = new Map<string, NonNullable<typeof poster>>();
  for (const p of poster ?? []) {
    perMall.set(p.template_id, [...(perMall.get(p.template_id) ?? []), p]);
  }

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href="/coachning"
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Tillbaka till coachning
      </Link>

      <div>
        <h1 className="text-display text-ink-900">Coachningsmallar</h1>
        <p className="mt-1 text-body text-ink-500">
          En mall blir uppgifter med datum räknade från den dag den används. Mallen tillämpas från personens kort.
        </p>
      </div>

      {(mallar ?? []).length === 0 ? (
        <Card>
          <EmptyState
            rubrik="Ingen mall än"
            text="En mall är en rampplan: momenten skrivs en gång och läggs upp på en knapptryckning för varje ny person."
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {(mallar ?? []).map((m) => {
            const mina = perMall.get(m.id) ?? [];
            return (
              <Card key={m.id}>
                <CardHeader
                  titel={m.name}
                  beskrivning={`${mina.length} moment${mina.length > 0 ? ` · sista efter ${Math.max(...mina.map((p) => p.offset_days))} dagar` : ""}`}
                  handling={m.active ? undefined : <Badge ton="neutral">Vilande</Badge>}
                />
                <ol className="flex flex-col gap-1.5">
                  {mina.map((p) => (
                    <li key={`${m.id}-${p.sort}`} className="flex flex-wrap items-center gap-2 text-small">
                      <span className="tnum w-16 shrink-0 text-ink-500">
                        {p.offset_days === 0 ? "dag 1" : `dag ${p.offset_days + 1}`}
                      </span>
                      <span className="text-ink-900">{p.title}</span>
                      <Badge ton="info">{TYP_ETIKETT[p.kind as Uppgiftstyp]}</Badge>
                    </li>
                  ))}
                </ol>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader titel="Ny mall" beskrivning="Ett moment per rad." />
        <NyMall fokus={fokus.map((f) => f.label)} />
      </Card>
    </div>
  );
}
