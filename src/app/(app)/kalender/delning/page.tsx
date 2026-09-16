import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { Ikon } from "@/components/shell/Ikon";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCurrentUser } from "@/lib/auth";
import { hamtaDelningar } from "@/lib/kalender-server";
import { GRUNDNIVA, NIVA_ETIKETT, NIVA_FORKLARING } from "@/lib/kalender";
import { Delningspanel } from "./Delningspanel";

export const dynamic = "force-dynamic";

export const metadata = { title: "Kalenderdelning" };

/**
 * Vem som ser min kalender.
 *
 * =============================================================================
 * SIDAN BÖRJAR MED VAD SOM REDAN GÄLLER, INTE MED EN VÄLJARE
 *
 * Grundläget — alla ser att jag är upptagen — är den viktigaste upplysningen på
 * hela sidan, och den enda som gäller utan att någon gjort något. Står den
 * längst ned som en fotnot kommer var och en att upptäcka den genom att någon
 * nämner att hen såg att man var upptagen på tisdag, och då känns det som en
 * läcka i stället för som en inställning.
 *
 * Den står därför överst, som en mening, före allt annat.
 * =============================================================================
 */
export default async function Delningssidan() {
  const user = await getCurrentUser();
  if (!user?.employee) {
    return <EmptyState rubrik="Kalenderdelning" text="Ditt konto är inte kopplat till en anställd än." />;
  }

  const { utat, inat, kollegor } = await hamtaDelningar(user);

  return (
    <div className="flex flex-col gap-6 pt-2">
      <nav aria-label="Brödsmula" className="flex items-center gap-1 text-small text-ink-500">
        <Link href="/kalender" className="transition-colors duration-fast hover:text-brand-700">
          Kalender
        </Link>
        <Ikon namn="fram" className="size-3 text-ink-300" />
        <span className="text-ink-700">Delning</span>
      </nav>

      <header className="flex flex-col gap-1">
        <h1 className="text-display text-ink-900">Vem ser min kalender</h1>
        <p className="text-body text-ink-500">
          Alla i navet ser när du är upptagen. Det går inte att stänga av — och det är hela poängen
          med en delad kalender. Vad tiden <em>gäller</em> ser bara den du säger till.
        </p>
      </header>

      <Card>
        <CardHeader
          titel="Jag delar med"
          beskrivning="Välj en nivå per person. Nivån går att sänka eller ta bort när som helst."
        />
        <div className="pt-4">
          <Delningspanel kollegor={kollegor} nuvarande={utat} />
        </div>
      </Card>

      <Card>
        <CardHeader
          titel="Delas med mig"
          beskrivning="Det här har kollegor gett dig utöver grundläget."
        />
        <div className="pt-4">
          {inat.length === 0 ? (
            <p className="text-small text-ink-500">
              Ingen har delat mer än ledig/upptagen med dig. Du ser ändå allas upptagenhet i
              kalendern.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {inat.map((d) => (
                <li
                  key={d.employee_id}
                  className="flex flex-wrap items-baseline justify-between gap-2 rounded-sm bg-canvas px-3 py-2"
                >
                  <Link
                    href={`/kalender?person=${d.employee_id}`}
                    className="text-body text-ink-900 transition-colors duration-fast hover:text-brand-700"
                  >
                    {d.namn}
                  </Link>
                  <span className="text-small text-ink-500">{NIVA_ETIKETT[d.niva]}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader titel="Vad nivåerna betyder" />
        <dl className="flex flex-col gap-3 pt-4">
          {/*
            Grundläget står med i listan trots att det inte går att välja bort.
            Utan raden ser fyra nivåer ut som hela skalan, och den som läser
            undrar vad som gäller för alla andra.
          */}
          <div className="flex flex-col gap-0.5 rounded-sm bg-canvas px-3 py-2">
            <dt className="text-small font-semibold text-ink-700">
              {NIVA_ETIKETT[GRUNDNIVA]} <span className="font-normal text-ink-500">— grundläge</span>
            </dt>
            <dd className="text-small text-ink-500">{NIVA_FORKLARING[GRUNDNIVA]}</dd>
          </div>
          {(["rubriker", "detaljer", "redigera", "delegat"] as const).map((n) => (
            <div key={n} className="flex flex-col gap-0.5 px-3">
              <dt className="text-small font-semibold text-ink-700">{NIVA_ETIKETT[n]}</dt>
              <dd className="text-small text-ink-500">{NIVA_FORKLARING[n]}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-4 rounded-sm bg-warn-tint px-3 py-2 text-small text-warn-ink">
          Från <strong>Kan se alla detaljer</strong> och uppåt kommer personen in i uppgifterna
          själva — beskrivning, historik och vilka som är inbjudna. Det är den enda vägen in i någon
          annans uppgiftslista i hela navet, och bara du kan öppna den.
        </p>
      </Card>
    </div>
  );
}
