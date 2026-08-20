"use client";

import { useActionState, useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Notis } from "@/components/ui/Notis";
import { skapaFlode, rotaFlode, type FranvaroState } from "./actions";

type Flode = { scope: string; token: string; revoked_at: string | null; read_count: number };

/**
 * E7.3 / AC-3.3: kalenderflöde med hemlig, roterbar URL.
 *
 * Texten under adressen är inte en artighet. Ett iCal-flöde är en URL utan
 * inloggning, och den som klistrar in den i Google Calendar har därmed lagt
 * innehållet hos Google. Den som inte får veta det kan inte välja.
 *
 * Flödet bär aldrig sjukfrånvaro och aldrig frånvarotyp — se `src/lib/ical.ts`.
 */
export function Kalenderflode({ floden }: { floden: Flode[] }) {
  const [state, action, vantar] = useActionState<FranvaroState, FormData>(skapaFlode, {});
  const [rotState, rotAction] = useActionState<FranvaroState, FormData>(rotaFlode, {});
  const [kopierat, setKopierat] = useState<string | null>(null);

  const bas = typeof window === "undefined" ? "" : window.location.origin;
  const levande = floden.filter((f) => !f.revoked_at);

  return (
    <Card>
      <CardHeader
        titel="Kalenderflöde"
        beskrivning="Din ledighet i din egen kalender, utan att logga in."
      />

      {(state.fel || rotState.fel) && <Notis ton="danger">{state.fel ?? rotState.fel}</Notis>}
      {(state.ok || rotState.ok) && <Notis ton="ok">{state.ok ?? rotState.ok}</Notis>}

      {levande.length === 0 ? (
        <form action={action} className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="scope" value="mine" />
          <p className="text-small text-ink-500">
            Adressen är hemlig och går att byta när som helst. Flödet är enkelriktat: ingenting du
            gör i kalendern kommer tillbaka hit.
          </p>
          <Button type="submit" size="sm" variant="sekundar" laddar={vantar}>
            Skapa adress
          </Button>
        </form>
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          {levande.map((f) => {
            const url = `${bas}/api/ical/${f.token}`;
            return (
              <div key={f.scope} className="flex flex-col gap-2">
                <span className="text-small font-semibold text-ink-700">
                  {f.scope === "team" ? "Ditt team" : "Din egen ledighet"}
                </span>
                <code className="block overflow-x-auto rounded-sm bg-canvas px-3 py-2 text-micro text-ink-700">
                  {url}
                </code>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="sekundar"
                    onClick={() => {
                      navigator.clipboard.writeText(url);
                      setKopierat(f.scope);
                    }}
                  >
                    {kopierat === f.scope ? "Kopierat" : "Kopiera"}
                  </Button>
                  <form action={rotAction}>
                    <input type="hidden" name="scope" value={f.scope} />
                    <Button type="submit" size="sm" variant="diskret">
                      Byt adress
                    </Button>
                  </form>
                  <form action={rotAction}>
                    <input type="hidden" name="scope" value={f.scope} />
                    <input type="hidden" name="stang" value="1" />
                    <Button type="submit" size="sm" variant="diskret">
                      Stäng flödet
                    </Button>
                  </form>
                </div>
                <p className="text-micro text-ink-300">
                  Hämtad {f.read_count} {f.read_count === 1 ? "gång" : "gånger"} sedan adressen
                  skapades. Ser du fler hämtningar än du väntar dig — byt adress.
                </p>
              </div>
            );
          })}

          <p className="text-micro text-ink-500">
            Flödet visar namn, datum och ordet Ledig. Aldrig vilken sorts ledighet, och aldrig
            sjukfrånvaro.
          </p>
        </div>
      )}
    </Card>
  );
}
