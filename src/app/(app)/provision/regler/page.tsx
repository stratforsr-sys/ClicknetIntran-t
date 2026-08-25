import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { hamtaNivaer } from "@/lib/bonus-server";
import { kronor, manadsnamn, manadsnyckel } from "@/lib/provision";
import { gallandeNivaer, type Bonusniva } from "@/lib/provision-motor";
import { NyNiva, TaBortNiva } from "./Trappa";

export const dynamic = "force-dynamic";

/**
 * E13 steg 3: volymtrappan som installning.
 *
 * INGET AR SEEDAT. Bestallaren har satt nivaerna 5/10/15/20/25/30 men inte vad
 * de ar varda (avsnitt 5.1, fraga 18). Sidan fods darfor tom, och tills nagon
 * fyller i den ger motorn noll bonus — aldrig en gissad. Samma linje som
 * tackningsgraden i 0025: en nolla i vyn syns, ett standardvarde gor det inte.
 *
 * SALJCHEF OCH VD. Ekonomi ser provisionen men andrar inte reglerna
 * (avsnitt 2). Kontrollen star bade har och i actionen — den har gommer sidan,
 * actionen ar det som faktiskt hindrar skrivningen.
 */

/** Bestallarens trappa, som FORSLAG i inmatningen. Inte som varden. */
const TROSKELFORSLAG = [5, 10, 15, 20, 25, 30];

export default async function Reglersida() {
  const user = await getCurrentUser();
  if (!user?.employee) return null;
  if (!hasRole(user, "sales_manager", "ceo")) notFound();

  const alla = await hamtaNivaer();
  const manad = manadsnyckel();

  const gallande = gallandeNivaer(alla, manad);
  const kommande = alla.filter((n) => n.valid_to === null && n.valid_from > manad);
  const historik = alla
    .filter((n) => n.valid_to !== null)
    .sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1));

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <h1 className="text-display text-ink-900">Volymtrappan</h1>
        <p className="mt-1 text-body text-ink-500">
          Vad en månads ordervolym är värd. Reglerna är inställningar, inte kod — en ändring här
          slår igenom utan att något behöver byggas om.
        </p>
      </div>

      <Card status={gallande.length === 0 ? "warn" : "brand"}>
        <CardHeader
          titel={`Gäller i ${manadsnamn(manad)}`}
          beskrivning="Nivån bestäms av hela månadens ordervolym, och bonusen gäller samtliga order i månaden — inte bara de över tröskeln."
        />
        {gallande.length === 0 ? (
          <EmptyState
            rubrik="Trappan är tom"
            text="Ingen volymbonus räknas ut förrän en nivå är satt. Nav gissar aldrig ett belopp — en gissad siffra ser rätt ut och blir tyst sanning."
          />
        ) : (
          <ul className="flex flex-col">
            {gallande.map((n) => (
              <li
                key={n.id}
                className="flex flex-wrap items-center gap-3 border-b border-canvas py-3 last:border-0"
              >
                <span className="w-28 text-body text-ink-900">{n.threshold} order</span>
                <span className="tnum flex-1 text-body font-semibold text-ink-900">
                  {beskrivBelopp(n)}
                </span>
                <span className="text-small text-ink-500">från {n.valid_from}</span>
                <TaBortNiva troskel={n.threshold} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {kommande.length > 0 && (
        <Card>
          <CardHeader
            titel="Träder i kraft senare"
            beskrivning="Ändringar som ännu inte gäller. Trappan slås upp på månadens första dag."
          />
          <ul className="flex flex-col">
            {kommande.map((n) => (
              <li
                key={n.id}
                className="flex flex-wrap items-center gap-3 border-b border-canvas py-3 last:border-0"
              >
                <span className="w-28 text-body text-ink-900">{n.threshold} order</span>
                <span className="tnum flex-1 text-body text-ink-900">{beskrivBelopp(n)}</span>
                <Badge>från {n.valid_from}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader
          titel="Sätt eller ändra en nivå"
          beskrivning="En ändring är en ny rad, aldrig en överskrivning. Den gamla står kvar som svar på frågan vilken trappa som gällde när."
        />
        <NyNiva troskelforslag={TROSKELFORSLAG} />
        <p className="mt-4 text-small text-ink-500">
          Trappan står still över 30 order. Utöver den kan du bokföra en övrig bonus för hand på{" "}
          <Link href="/provision" className="underline">
            provisionssidan
          </Link>
          . En stängd månad påverkas aldrig av en ändring här.
        </p>
      </Card>

      {historik.length > 0 && (
        <Card>
          <CardHeader titel="Historik" beskrivning="Rader som inte gäller längre." />
          <ul className="flex flex-col">
            {historik.map((n) => (
              <li
                key={n.id}
                className="flex flex-wrap items-center gap-3 border-b border-canvas py-2 text-small text-ink-500 last:border-0"
              >
                <span className="w-28">{n.threshold} order</span>
                <span className="tnum flex-1">{beskrivBelopp(n)}</span>
                <span>
                  {n.valid_from} – {n.valid_to}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** Beloppet med sin form. Formen ar inte kosmetisk — den avgor hur mycket det blir. */
function beskrivBelopp(n: Bonusniva): string {
  switch (n.unit) {
    case "percent":
      return `${n.amount} % av månadens grundprovision`;
    case "amount_per_order":
      return `${kronor(n.amount)} per order`;
    default:
      return kronor(n.amount);
  }
}
