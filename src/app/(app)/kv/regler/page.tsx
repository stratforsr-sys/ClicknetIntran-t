import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { hamtaKriterier, hamtaPolicyer } from "@/lib/kv-server";
import { gallandePolicy, konfigurationsfel } from "@/lib/kv";
import { manadsnyckel } from "@/lib/provision";
import { Omraden, Reglerna } from "./Regler";

export const dynamic = "force-dynamic";

/**
 * K&V-installningarna. Saljchef och VD (avsnitt 2).
 *
 * OMRADENA ar seedade med bestallarens egna ord, men MAXPOANGEN ar det inte.
 * O4 sager att 200 ar maxpoangen totalt for bada samtalen — inte hur de 200
 * fordelas pa sex omraden, och den fordelningen ska inte gissas.
 */
export default async function KvReglersida() {
  const user = await getCurrentUser();
  if (!user?.employee) return null;
  if (!hasRole(user, "sales_manager", "ceo")) notFound();

  const [kriterier, policyer] = await Promise.all([hamtaKriterier(), hamtaPolicyer()]);

  const manad = manadsnyckel();
  const policy = gallandePolicy(policyer, manad);
  const fel = policy ? konfigurationsfel(kriterier, policy) : "Inga regler gäller för den här månaden.";

  const historik = policyer.filter((p) => p.valid_to !== null);

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <h1 className="text-display text-ink-900">K&amp;V-inställningar</h1>
        <p className="mt-1 text-body text-ink-500">
          Vad ett samtal bedöms på, vad som krävs för en godkänd vecka och vad en godkänd vecka är
          värd. Allt är inställningar — en ändring här slår igenom utan att något byggs om.
        </p>
      </div>

      <Card status={fel ? "warn" : "brand"}>
        <CardHeader
          titel="Områdena och maxpoängen"
          beskrivning="Tröskeln räknas på summan av veckans samtal. Områdena behöver inte väga lika mycket."
        />
        <Omraden kriterier={kriterier} policy={policy} />
      </Card>

      <Card>
        <CardHeader
          titel="Reglerna"
          beskrivning="En ändring är en ny rad, aldrig en överskrivning. Reglerna slås upp på månadens första dag, precis som volymtrappan."
        />
        <Reglerna policy={policy} />
        <p className="mt-4 text-small text-ink-500">
          En stängd månad påverkas aldrig av en ändring här. Volymtrappan sätts under{" "}
          <Link href="/provision/regler" className="underline">
            Volymtrappan
          </Link>
          .
        </p>
      </Card>

      {historik.length > 0 && (
        <Card>
          <CardHeader titel="Historik" beskrivning="Regler som inte gäller längre." />
          <ul className="flex flex-col">
            {historik.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-3 border-b border-canvas py-2 text-small text-ink-500 last:border-0"
              >
                <span className="flex-1">
                  {p.calls_per_week} samtal, tröskel {p.threshold_points} p, {p.percent_per_week} % per
                  vecka, tak {p.cap_percent} %
                </span>
                <Badge>
                  {p.valid_from} – {p.valid_to}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
