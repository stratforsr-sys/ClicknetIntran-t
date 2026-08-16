import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCurrentUser, canManageEmployees, hasRole } from "@/lib/auth";
import { ROLE_LABEL, STATUS_LABEL } from "@/lib/roles";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * UI-PRD §7: startsidan har ingen hero och ingen illustration.
 * Forsta skarmen ska ge handling, inte valkomnande.
 *
 * Just nu ar M1 den enda levererade modulen, sa "Att gora" och "Nytt sedan
 * sist" har inga kallor an. De laggs till i takt med att modulerna byggs.
 */
export default async function Startsida() {
  const user = await getCurrentUser();
  if (!user?.employee) return null;

  const supabase = await supabaseServer();
  const { count: antalAktiva } = await supabase
    .from("employee")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");
  const { count: antalOnboarding } = await supabase
    .from("employee")
    .select("id", { count: "exact", head: true })
    .eq("status", "onboarding");

  const chef = canManageEmployees(user) || hasRole(user, "ceo", "team_lead");

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <h1 className="text-display text-ink-900">
          Hej {user.employee.first_name}
        </h1>
        <p className="mt-1 text-body text-ink-500">
          {user.roles.length
            ? user.roles.map((r) => ROLE_LABEL[r]).join(" · ")
            : "Din roll är inte satt än."}{" "}
          · {STATUS_LABEL[user.employee.status] ?? user.employee.status}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            titel="Att göra"
            beskrivning="Kvittenser, kurser och ärenden som väntar på dig."
          />
          <EmptyState
            rubrik="Ingenting väntar på dig"
            text="Här samlas rutiner du inte kvitterat, kurser som pågår och ärenden med svar. Listan fylls när de modulerna är byggda."
          />
        </Card>

        <div className="flex flex-col gap-4">
          {chef && (
            <Card status="brand">
              <CardHeader titel="Personalen" />
              <dl className="flex flex-col gap-3">
                <Rad etikett="Aktiva" varde={antalAktiva ?? 0} />
                <Rad etikett="Under onboarding" varde={antalOnboarding ?? 0} />
              </dl>
              <div className="mt-5">
                <ButtonLink href="/personal" size="sm">
                  Öppna personalregistret
                </ButtonLink>
              </div>
            </Card>
          )}

          <Card>
            <CardHeader titel="Byggstatus" beskrivning="Vad som finns i navet idag." />
            <ul className="flex flex-col gap-2.5 text-small">
              <Modul namn="Identitet och behörighet" ton="ok" status="I drift" />
              <Modul namn="Rutinbibliotek" ton="neutral" status="Näst på tur" />
              <Modul namn="Personalärenden" ton="neutral" status="Planerad" />
              <Modul namn="Utbildning" ton="neutral" status="Planerad" />
              <Modul namn="Stämpling" ton="neutral" status="Planerad" />
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Rad({ etikett, varde }: { etikett: string; varde: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-small text-ink-500">{etikett}</dt>
      <dd className="tnum text-h1 text-ink-900">{varde}</dd>
    </div>
  );
}

function Modul({
  namn,
  status,
  ton,
}: {
  namn: string;
  status: string;
  ton: "ok" | "neutral";
}) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="text-ink-700">{namn}</span>
      <Badge ton={ton}>{status}</Badge>
    </li>
  );
}
