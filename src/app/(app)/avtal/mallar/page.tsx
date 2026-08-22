import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { EMPLOYMENT_TYPE_LABEL } from "@/lib/roles";
import { MALLSTATUS_ETIKETT, type Mallstatus } from "@/lib/avtal";

export const dynamic = "force-dynamic";

const TON: Record<Mallstatus, "warn" | "ok" | "neutral"> = {
  draft: "warn",
  published: "ok",
  archived: "neutral",
};

export default async function Mallar() {
  const user = await getCurrentUser();
  // RLS ger anda noll rader, men en tom lista ser ut som "det finns inga
  // mallar". En 404 sager sanningen: sidan ar inte din.
  if (!hasRole(user, "sales_manager", "ceo", "admin")) notFound();

  const supabase = await supabaseServer();
  const { data: mallar } = await supabase
    .from("contract_template")
    .select("id, slug, title, status, employment_type, updated_at")
    .order("status")
    .order("title");

  const rader = mallar ?? [];

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-display text-ink-900">Avtalsmallar</h1>
          <p className="mt-1 max-w-[70ch] text-body text-ink-500">
            Texten skrivs en gång och fylls i per person. Bara en publicerad
            mall går att skapa avtal ur.
          </p>
        </div>
        <ButtonLink href="/avtal/mallar/ny" variant="primar">
          Ny mall
        </ButtonLink>
      </div>

      <Card className="p-0 md:p-0">
        {rader.length === 0 ? (
          <div className="p-6">
            <EmptyState
              rubrik="Ingen mall skriven"
              text="En mall är avtalstexten med fält som {{fornamn}} och {{manadslon}}. Fälten fylls i när avtalet skapas."
              handling={<ButtonLink href="/avtal/mallar/ny">Skriv den första</ButtonLink>}
            />
          </div>
        ) : (
          <ul className="flex flex-col">
            {rader.map((m) => (
              <li key={m.id} className="border-b border-canvas last:border-0">
                <Link
                  href={`/avtal/mallar/${m.slug}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-4 hover:bg-surface-alt"
                >
                  <Badge ton={TON[m.status as Mallstatus]}>
                    {MALLSTATUS_ETIKETT[m.status as Mallstatus]}
                  </Badge>
                  <span className="min-w-0 flex-1 text-body text-ink-900">{m.title}</span>
                  <span className="text-small text-ink-500">
                    {m.employment_type
                      ? EMPLOYMENT_TYPE_LABEL[m.employment_type] ?? m.employment_type
                      : "Alla anställningsformer"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
