"use client";

import { useActionState, useState, useTransition } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Notis } from "@/components/ui/Notis";
import { KONTROLL } from "@/components/ui/Field";
import { perTabell, type Referens } from "@/lib/personal-radering";
import { hamtaReferenser, taBortAnstalld, type RaderingState } from "../actions";

/**
 * Radering av en anstalld (0046).
 *
 * KORTET AR I TRE STEG, och det ar hela poangen med det. Offboardingen ovanfor
 * ar en knapp — den gar att angra genom att aktivera personen igen. Den har gar
 * inte att angra alls, sa vagen fram maste vara langre an en reflex:
 *
 *   1. En knapp som bara HAMTAR svaret pa "vad skulle det har ta med sig?".
 *      Inget raderas.
 *   2. Listan. Vad som forsvinner, och vad som star kvar med namnskylten.
 *   3. Personens namn skrivet for hand.
 *
 * Steg 1 ar ett eget klick eftersom svaret kostar en count-fraga per frammande
 * nyckel mot `employee` — 132 stycken. Det ar billigt en gang, dyrt pa varje
 * sidvisning.
 */
export function TaBort({ anstalldId, namn }: { anstalldId: string; namn: string }) {
  const [state, action, sparar] = useActionState<RaderingState, FormData>(taBortAnstalld, {});
  const [referenser, setReferenser] = useState<Referens[] | null>(null);
  const [fel, setFel] = useState<string | null>(null);
  const [hamtar, hamta] = useTransition();

  const raderas = referenser ? perTabell(referenser.filter((r) => r.atgard === "raderas")) : [];
  const behalls = referenser ? perTabell(referenser.filter((r) => r.atgard === "behalls")) : [];

  return (
    <Card status="danger">
      <CardHeader
        titel="Ta bort ur navet"
        beskrivning="Permanent. Kontot, e-posten och personens egna uppgifter raderas. Behöver företaget ha kvar rader personen godkänt står namnet kvar som en skylt."
      />

      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {fel && <Notis ton="danger">{fel}</Notis>}

      {referenser === null ? (
        <div className="flex flex-col gap-3">
          <p className="max-w-[70ch] text-small text-ink-500">
            Att avsluta anställningen räcker för den som har slutat — historiken finns kvar och
            personen går att slå upp. Det här är för den som lades upp av misstag eller aldrig
            började.
          </p>
          <div>
            <Button
              type="button"
              variant="sekundar"
              size="sm"
              laddar={hamtar}
              onClick={() => {
                setFel(null);
                hamta(async () => {
                  try {
                    setReferenser(await hamtaReferenser(anstalldId));
                  } catch (e) {
                    setFel(e instanceof Error ? e.message : "Kunde inte läsa vad som hänger i personen.");
                  }
                });
              }}
            >
              Visa vad som tas bort
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <Lista
            rubrik="Raderas permanent"
            tom={`Ingenting. ${namn} har inga uppgifter i navet, och raden försvinner helt.`}
            rader={raderas}
          />

          {behalls.length > 0 && (
            <Lista
              rubrik={`Står kvar, med "${namn} (borttagen anställd)"`}
              tom=""
              rader={behalls}
            />
          )}

          {behalls.length > 0 && (
            <Notis ton="warn">
              De här raderna är företagets, inte personens — en signerad kundorder eller en
              attesterad löneperiod kan inte stå utan den som godkände den. Därför raderas inte
              personalposten helt, utan töms på allt utom namnet.
            </Notis>
          )}

          <form action={action} className="flex flex-col gap-3">
            <input type="hidden" name="employee_id" value={anstalldId} />
            <label htmlFor="bekraftelse" className="text-small font-semibold text-ink-700">
              Skriv <span className="font-mono">{namn}</span> för att bekräfta
            </label>
            <input
              id="bekraftelse"
              name="bekraftelse"
              autoComplete="off"
              required
              className={`${KONTROLL} max-w-sm`}
            />
            <div className="flex gap-3">
              <Button type="submit" variant="destruktiv" laddar={sparar}>
                Ta bort {namn}
              </Button>
              <Button type="button" variant="diskret" onClick={() => setReferenser(null)}>
                Avbryt
              </Button>
            </div>
          </form>
        </div>
      )}
    </Card>
  );
}

function Lista({
  rubrik,
  tom,
  rader,
}: {
  rubrik: string;
  tom: string;
  rader: { tabell: string; antal: number }[];
}) {
  return (
    <div>
      <h3 className="mb-2 text-small font-semibold text-ink-700">{rubrik}</h3>
      {rader.length === 0 ? (
        <p className="text-small text-ink-500">{tom}</p>
      ) : (
        <ul className="flex flex-wrap gap-x-6 gap-y-1">
          {rader.map((r) => (
            <li key={r.tabell} className="text-small text-ink-500">
              {r.tabell} <span className="font-mono text-ink-900">{r.antal}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
