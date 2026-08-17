import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCurrentUser, hasRole, fullName } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { slaLage, timmarKvar, STATUS_ETIKETT, SLA_ETIKETT, type Status, type SlaLage } from "@/lib/arenden";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ärenden — Clicknet Nav" };

/** UI-PRD: inkorgsmönster. SLA-läget är en färgad kant, inte en röd siffra. */
const KANT: Record<SlaLage, string> = {
  i_tid: "border-l-ok",
  snart: "border-l-warn",
  over: "border-l-danger",
  klart: "border-l-ink-300",
};

const TON: Record<SlaLage, "ok" | "warn" | "danger" | "neutral"> = {
  i_tid: "ok",
  snart: "warn",
  over: "danger",
  klart: "neutral",
};

export default async function ArendeSida() {
  const user = await getCurrentUser();
  if (!user?.employee) redirect("/");

  const hanterare = hasRole(user, "sales_manager", "ceo");
  const supabase = await supabaseServer();

  // RLS avgor vad som kommer tillbaka: den anstallda ser sina egna, saljchefen
  // och VD ser alla, och konfidentiella arenden nar ingen annan.
  const [{ data: arenden }, { data: kategorier }, { data: personal }] = await Promise.all([
    supabase
      .from("hr_case")
      .select("id, employee_id, subject, category, status, confidential, due_at, resolved_at, sla_hours, created_at")
      .order("resolved_at", { ascending: true, nullsFirst: true })
      .order("due_at", { ascending: true })
      .limit(200),
    supabase.from("case_category").select("id, label").order("sort"),
    supabase.from("employee").select("id, first_name, last_name"),
  ]);

  const etikett = new Map((kategorier ?? []).map((k) => [k.id, k.label]));
  const namn = new Map((personal ?? []).map((p) => [p.id, fullName(p)]));
  const lista = arenden ?? [];
  const oppna = lista.filter((a) => !a.resolved_at);

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-display text-ink-900">Ärenden</h1>
          <p className="mt-1 max-w-[70ch] text-body text-ink-500">
            {hanterare
              ? "Frågor från personalen med svarstid per kategori. Konfidentiella ärenden syns bara för dig och VD."
              : "Dina frågor till ledningen. Du ser hela dialogen och när svar utlovats."}
          </p>
        </div>
        <ButtonLink href="/arenden/nytt" variant="primar">
          Nytt ärende
        </ButtonLink>
      </div>

      {hanterare && oppna.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Badge ton="neutral">{oppna.length} öppna</Badge>
          <Badge ton="danger">
            {oppna.filter((a) => slaLage(a) === "over").length} över tiden
          </Badge>
          <Badge ton="warn">
            {oppna.filter((a) => slaLage(a) === "snart").length} snart förfallna
          </Badge>
          <Link
            href="/arenden/statistik"
            className="ml-auto text-small font-semibold text-brand-700 hover:text-brand-900"
          >
            Statistik
          </Link>
        </div>
      )}

      {lista.length === 0 ? (
        <Card>
          <EmptyState
            rubrik="Inga ärenden"
            text="Här hamnar frågor om lön, utrustning, schema, arbetsmiljö och allt annat som annars försvinner i en chatt."
            handling={<ButtonLink href="/arenden/nytt">Skriv det första</ButtonLink>}
          />
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {lista.map((a) => {
            const lage = slaLage(a);
            const kvar = timmarKvar(a.due_at);
            return (
              <li key={a.id}>
                <Link href={`/arenden/${a.id}`} className="block">
                  <div
                    className={`lift flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border-l-[3px] bg-surface p-4 shadow-elev-1 ${KANT[lage]}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-semibold text-ink-900">{a.subject}</p>
                      <p className="mt-0.5 text-small text-ink-500">
                        {etikett.get(a.category) ?? a.category}
                        {hanterare && ` · ${namn.get(a.employee_id) ?? "Okänd"}`}
                      </p>
                    </div>

                    {a.confidential && <Badge ton="info">Konfidentiellt</Badge>}
                    <Badge ton="neutral">{STATUS_ETIKETT[a.status as Status]}</Badge>
                    <Badge ton={TON[lage]}>
                      {lage === "klart"
                        ? SLA_ETIKETT.klart
                        : lage === "over"
                          ? `${Math.abs(kvar)} h över`
                          : `${kvar} h kvar`}
                    </Badge>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
