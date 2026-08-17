import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { NyPeriod } from "./NyPeriod";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lönerapport — Clicknet Nav" };

/**
 * E4b. Underlag till lönekörningen — inte en lönekörning.
 *
 * AC-2.17, K5: navet räknar ingen lön, redovisar inget belopp och tar inte
 * ställning till semesterrätt. Det som lämnas över är tid, och beslutet om vad
 * tiden är värd fattas i lönesystemet av någon som får fatta det.
 */
export default async function LonerapportSida() {
  const user = await getCurrentUser();
  if (!hasRole(user, "sales_manager", "ceo", "finance", "admin") || !user?.employee) redirect("/");

  const supabase = await supabaseServer();
  const { data: perioder } = await supabase
    .from("payroll_period")
    .select("id, period_start, period_end, status, generated_at, attested_at")
    .order("period_start", { ascending: false });

  const farSkapa = hasRole(user, "sales_manager", "ceo", "admin");

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <h1 className="text-display text-ink-900">Lönerapport</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Underlag per period och person: arbetad tid, justeringar och antal avvikelser. Inga
          belopp — navet räknar ingen lön, det redovisar tid.
        </p>
      </div>

      {farSkapa && <NyPeriod />}

      {(perioder ?? []).length === 0 ? (
        <EmptyState
          rubrik="Ingen period ännu"
          text="Skapa perioden när månaden är slut och nattjobbet hunnit skriva journalen."
        />
      ) : (
        <Card>
          <CardHeader titel="Perioder" beskrivning="Attesterade perioder är låsta." />
          <ul className="flex flex-col">
            {(perioder ?? []).map((p) => (
              <li key={p.id} className="border-b border-ink-100 last:border-0">
                <Link
                  href={`/tid/lonerapport/${p.id}`}
                  className="flex min-h-11 items-center justify-between gap-4 py-3 hover:text-brand-700"
                >
                  <span className="tnum text-body text-ink-900">
                    {p.period_start} – {p.period_end}
                  </span>
                  <Badge ton={p.status === "attested" ? "ok" : p.generated_at ? "info" : "neutral"}>
                    {p.status === "attested"
                      ? "Attesterad"
                      : p.generated_at
                        ? "Underlag skrivet"
                        : "Tom"}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
