"use client";

import { useActionState, useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Notis } from "@/components/ui/Notis";
import { skapaFlode, rotaFlode, type FranvaroState } from "./actions";

type Flode = { scope: string; token: string; revoked_at: string | null; read_count: number };

/** Sorterna i den ordning de visas. `team` skapas inte här — den finns bara där den redan skapats. */
const SORTER: { scope: string; rubrik: string; skapas: boolean; text: string }[] = [
  {
    scope: "mine",
    rubrik: "Din egen ledighet",
    skapas: true,
    text: "Flödet visar namn, datum och ordet Ledig. Aldrig vilken sorts ledighet, och aldrig sjukfrånvaro.",
  },
  {
    scope: "handelser",
    rubrik: "Dina möten",
    skapas: true,
    text: "Möten, 1:1:or och leveransposter du är med på, med rubrik, tid och plats. Aldrig agenda, anteckningar eller vilka andra som är med. På en leveranspost står kundens namn i rubriken.",
  },
  { scope: "team", rubrik: "Ditt team", skapas: false, text: "" },
];

/**
 * E7.3 / AC-3.3: kalenderflöde med hemlig, roterbar URL.
 *
 * Texten under adressen är inte en artighet. Ett iCal-flöde är en URL utan
 * inloggning, och den som klistrar in den i Google Calendar har därmed lagt
 * innehållet hos Google. Den som inte får veta det kan inte välja.
 *
 * Ledighetsflödet bär aldrig sjukfrånvaro och aldrig frånvarotyp — se
 * `src/lib/ical.ts`. Mötesflödet (Leveranskalendern, 0072) är ett eget flöde
 * med en egen adress, så att den som bara vill dela sin ledighet inte delar
 * sina möten.
 */
export function Kalenderflode({ floden }: { floden: Flode[] }) {
  const [state, action, vantar] = useActionState<FranvaroState, FormData>(skapaFlode, {});
  const [rotState, rotAction] = useActionState<FranvaroState, FormData>(rotaFlode, {});
  const [kopierat, setKopierat] = useState<string | null>(null);

  const bas = typeof window === "undefined" ? "" : window.location.origin;
  const levande = new Map(floden.filter((f) => !f.revoked_at).map((f) => [f.scope, f]));

  return (
    <Card>
      <CardHeader
        titel="Kalenderflöde"
        beskrivning="Din ledighet och dina möten i din egen kalender, utan att logga in."
      />

      {(state.fel || rotState.fel) && <Notis ton="danger">{state.fel ?? rotState.fel}</Notis>}
      {(state.ok || rotState.ok) && <Notis ton="ok">{state.ok ?? rotState.ok}</Notis>}

      <div className="mt-3 flex flex-col gap-5">
        {SORTER.map((sort) => {
          const f = levande.get(sort.scope);
          if (!f && !sort.skapas) return null;
          if (!f) {
            return (
              <form key={sort.scope} action={action} className="flex flex-col gap-2">
                <input type="hidden" name="scope" value={sort.scope} />
                <span className="text-small font-semibold text-ink-700">{sort.rubrik}</span>
                <p className="text-small text-ink-500">
                  Adressen är hemlig och går att byta när som helst. Flödet är enkelriktat: ingenting du
                  gör i kalendern kommer tillbaka hit. {sort.text}
                </p>
                <div>
                  <Button type="submit" size="sm" variant="sekundar" laddar={vantar}>
                    Skapa adress
                  </Button>
                </div>
              </form>
            );
          }
          const url = `${bas}/api/ical/${f.token}`;
          return (
            <div key={sort.scope} className="flex flex-col gap-2">
              <span className="text-small font-semibold text-ink-700">{sort.rubrik}</span>
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
              {sort.text && <p className="text-micro text-ink-500">{sort.text}</p>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
