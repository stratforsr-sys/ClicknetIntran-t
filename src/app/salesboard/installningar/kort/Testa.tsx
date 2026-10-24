import type { Testtyp } from "@/lib/salesboard/typer";
import type { Skarm } from "@/lib/salesboard/skrivning";
import { Kort, Lugn, Pil, ansluten, useNu } from "../delar";
import type { Kvitto } from "../skrivvag";

/**
 * 06 Testa tavlan: ett påhittat ögonblick på alla skärmar, märkt TEST, och en
 * länk till tavlan. Klientkod.
 */

/** Knapparna, med färgen panelen får på TV:n: mint för en order, bärnsten för en stor affär. */
const TESTER: { typ: Testtyp; etikett: string; farg: "mint" | "barnsten" }[] = [
  { typ: "order", etikett: "Ny order", farg: "mint" },
  { typ: "stor", etikett: "Stor affär", farg: "barnsten" },
  { typ: "forsta", etikett: "Första ordern", farg: "mint" },
  { typ: "serie", etikett: "Tre order", farg: "mint" },
  { typ: "malet", etikett: "Målet nått", farg: "mint" },
];

export function Testkort({
  installerad,
  skarmar,
  forskjutning,
  k,
  onTesta,
}: {
  installerad: boolean;
  skarmar: Skarm[];
  forskjutning: number;
  k: Record<string, Kvitto>;
  onTesta: (typ: Testtyp, etikett: string) => void;
}) {
  const fel = TESTER.map((t) => k[`test:${t.typ}`]).find((x) => x?.typ === "fel");
  return (
    <Kort nr="07" rubrik="Testa tavlan" text="Ett påhittat ögonblick på alla skärmar, märkt TEST. Det räknas aldrig.">
      {!installerad ? (
        <Lugn />
      ) : (
        <div className="si-test">
          <div className="si-testknappar">
            {TESTER.map((t) => {
              const kv = k[`test:${t.typ}`];
              return (
                <button key={t.typ} type="button" className="si-knapp si-testknapp" data-farg={t.farg} onClick={() => onTesta(t.typ, t.etikett)}>
                  <i aria-hidden="true" />
                  {kv?.typ === "sparat" ? "Skickat" : t.etikett}
                </button>
              );
            })}
          </div>
          <div className="si-test-fot">
            <Anslutna skarmar={skarmar} forskjutning={forskjutning} />
            <a className="si-knapp" href="/salesboard" target="_blank" rel="noopener">
              Öppna tavlan
              <Pil />
            </a>
          </div>
          {fel ? <p className="si-felrad">{fel.text}</p> : null}
        </div>
      )}
    </Kort>
  );
}

/** Hur många skärmar som spelar testet, omräknat var tionde sekund. */
function Anslutna({ skarmar, forskjutning }: { skarmar: Skarm[]; forskjutning: number }) {
  const nu = useNu(10_000, forskjutning);
  const anslutna = skarmar.filter((s) => ansluten(s, nu)).length;
  return (
    <span className="si-hjalptext">
      {anslutna === 0
        ? "Ingen skärm är ansluten just nu, så inget syns förrän en ansluter."
        : anslutna === 1
          ? "1 skärm är ansluten nu och spelar testet inom några sekunder."
          : `${anslutna} skärmar är anslutna nu och spelar testet inom några sekunder.`}
    </span>
  );
}
