"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Ikon } from "@/components/shell/Ikon";
import { Flikrad, Grupprubrik, Sifferrad, TomFlik } from "@/components/ui/Flikar";

export type Koomrade = "franvaro" | "tid" | "arenden" | "utbildning";

/** En sammanfattande rad: "3 ledighetsansökningar att besluta". */
export type Kopost = {
  nyckel: string;
  omrade: Koomrade;
  href: string;
  text: string;
  detalj: string;
  ton: "danger" | "warn" | "neutral";
};

/** En faktisk sak, med en frist. Bara sådana kan rangordnas. */
export type Bradskande = {
  nyckel: string;
  omrade: Koomrade;
  href: string;
  titel: string;
  detalj: string;
  /** Färdig text: "har redan börjat", "om 2 dagar", "svarstiden passerad". */
  frist: string;
  ton: "danger" | "warn";
};

const OMRADE_ORD: Record<Koomrade, string> = {
  franvaro: "Frånvaro",
  tid: "Tid",
  arenden: "Ärenden",
  utbildning: "Utbildning",
};

/**
 * ============================================================================
 * DIN KÖ — områden som flikar, och de tre som brådskar överst.
 *
 * Kön var en lista med antal: "3 ledighetsansökningar att besluta", "2 rollspel
 * att bedöma". Den svarade på HUR MYCKET men aldrig på VAD, och beställaren
 * kunde inte se om något var akut utan att öppna varje länk.
 *
 * ----------------------------------------------------------------------------
 * BARA DET SOM HAR EN FRIST GÅR ATT RANGORDNA
 *
 * "De tre mest brådskande" kräver att brådskan går att jämföra mellan ett
 * ärende och en semesteransökan. Det gör den bara om båda har ett datum att
 * mäta mot, och därför står bara sådant i toppen:
 *
 *   - Ärendet har `due_at`, alltså sin SLA-frist.
 *   - Ansökan har `starts_on`: ett besked som kommer efter att ledigheten
 *     börjat är inget besked.
 *
 * En tidsrättelse och ett rollspel har ingen frist alls. De rangordnas därför
 * INTE — de står kvar som antal längre ner. Att hitta på en frist åt dem för
 * att få dem sorterbara hade gjort ordningen till en gissning, och en ordning
 * ingen kan förklara är värre än ingen ordning.
 *
 * OBEKRÄFTAD SJUKANMÄLAN GÅR FÖRE ALLT. Den regeln är inte ny här: AC-3.17 och
 * kön före den lade den överst av samma skäl. Fristen är mot en människa som
 * anmält sig sjuk och ännu inte hört något — inte mot ett datum.
 *
 * ----------------------------------------------------------------------------
 * FLIKARNA ÄR OMRÅDEN OCH INTE TID
 *
 * Till skillnad från Dagens läge. Kön har inget tidsfönster — allt i den gäller
 * nu — så det som byter fråga här är VILKEN DEL AV NAVET man tar itu med. Den
 * som ska gå igenom frånvaron vill inte scrolla förbi rollspel.
 * ============================================================================
 */
export function Kokort({
  poster,
  bradskande,
}: {
  poster: Kopost[];
  bradskande: Bradskande[];
}) {
  const [omrade, setOmrade] = useState<string>("alla");

  const iOmrade = (o: string, p: { omrade: Koomrade }) => o === "alla" || p.omrade === o;
  const synliga = poster.filter((p) => iOmrade(omrade, p));
  const synligaBradskande = bradskande.filter((b) => iOmrade(omrade, b));

  const omraden = (["franvaro", "tid", "arenden", "utbildning"] as Koomrade[]).filter((o) =>
    poster.some((p) => p.omrade === o),
  );

  const flikar = [
    { id: "alla", etikett: "Allt", antal: poster.length },
    ...omraden.map((o) => ({
      id: o,
      etikett: OMRADE_ORD[o],
      antal: poster.filter((p) => p.omrade === o).length,
    })),
  ];

  const akut = bradskande.filter((b) => b.ton === "danger").length;

  return (
    <Card status={akut > 0 ? "danger" : undefined}>
      <CardHeader titel="Din kö" beskrivning="Det som väntar på ditt beslut." />

      {poster.length === 0 ? (
        <TomFlik text="Inget ärende, ingen ansökan och ingen rättelse väntar på dig." />
      ) : (
        <div className="flex flex-col gap-4">
          <Sifferrad
            tal={[
              { id: "allt", varde: poster.length, etikett: "Poster i kön" },
              { id: "akut", varde: akut, etikett: "Passerad frist", kraverHandling: true },
              { id: "brad", varde: bradskande.length, etikett: "Med frist" },
              {
                id: "omr",
                varde: omraden.length,
                etikett: omraden.length === 1 ? "Område" : "Områden",
              },
            ]}
          />

          <Flikrad etikett="Område" flikar={flikar} valt={omrade} onVal={setOmrade} />

          {/* Brådskan först. Den som öppnar kön klockan åtta ska se det som
              inte tål att vänta innan hen ser hur mycket det är totalt. */}
          {synligaBradskande.length > 0 && (
            <div>
              <Grupprubrik text="Brådskar" antal={synligaBradskande.length} />
              <ul className="mt-1 flex flex-col">
                {synligaBradskande.slice(0, 3).map((b) => (
                  <li key={b.nyckel} className="border-b border-canvas last:border-0">
                    <Link
                      href={b.href}
                      className="group flex min-h-14 items-center gap-3 py-3 transition-colors duration-fast"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-body text-ink-900 group-hover:text-brand-700">
                          {b.titel}
                        </span>
                        <span className="block text-small text-ink-500">{b.detalj}</span>
                      </span>
                      <Badge ton={b.ton}>{b.frist}</Badge>
                      <Ikon namn="tillbaka" className="size-4 rotate-180 text-ink-300" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {synliga.length === 0 ? (
            <TomFlik text={`Inget väntar under ${OMRADE_ORD[omrade as Koomrade] ?? "det området"}.`} />
          ) : (
            <div>
              <Grupprubrik text="Allt som väntar" antal={synliga.length} />
              <ul className="mt-1 flex flex-col">
                {synliga.map((p) => (
                  <li key={p.nyckel} className="border-b border-canvas last:border-0">
                    <Link
                      href={p.href}
                      className="group flex min-h-14 items-center gap-3 py-3 transition-colors duration-fast"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-body text-ink-900 group-hover:text-brand-700">
                          {p.text}
                        </span>
                        <span className="block text-small text-ink-500">{p.detalj}</span>
                      </span>
                      {p.ton !== "neutral" && <Badge ton={p.ton}>Öppna</Badge>}
                      <Ikon namn="tillbaka" className="size-4 rotate-180 text-ink-300" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
