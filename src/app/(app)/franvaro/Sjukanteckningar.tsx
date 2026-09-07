"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { ANTECKNING_MAX } from "@/lib/franvaro";
import { laggSjukanteckning, type FranvaroState } from "./actions";

export type Anteckning = { id: string; text: string; av: string; nar: string };

/**
 * ============================================================================
 * CHEFENS ANTECKNINGAR PÅ EN SJUKPERIOD (D-E7.11).
 *
 * Beställaren tittade 2026-09-07 på en pågående sjukanmälan och frågade varför
 * personen var borta. Navet kunde inte svara, och skulle inte kunna det: ett
 * orsaksfält på en sjukanmälan är ett diagnosfält.
 *
 * Det som saknades var inte orsaken utan LÄGET. Någon hade pratat med honom,
 * och det visste ingen annan. Rutan nedan bär den uppgiften.
 *
 * FYRA SAKER SOM STÅR I GRÄNSSNITTET OCH INTE BARA I KODEN:
 *
 *   - Hjälptexten säger rakt ut att hälsa inte hör hemma här. Det är det enda
 *     ett fritextfält kan göra åt vad någon skriver i det.
 *   - "Går inte att ändra" står vid knappen, inte i ett felmeddelande efteråt.
 *   - Vem som skrev och när står vid varje rad. En anonym anteckning om en
 *     människa är inte ett arbetsmaterial, det är ett rykte.
 *   - Att den anställda kan begära ut texten står under listan. Intern betyder
 *     "inte i gränssnittet" — aldrig "hen får inte veta".
 * ============================================================================
 */
export function Sjukanteckningar({
  rapportId,
  anteckningar,
  egenAnmalan,
}: {
  rapportId: string;
  anteckningar: Anteckning[];
  /** Sant när den inloggade är den anmälan gäller. Då finns ingen ruta. */
  egenAnmalan: boolean;
}) {
  const [state, action, sparar] = useActionState<FranvaroState, FormData>(laggSjukanteckning, {});
  const [text, setText] = useState("");
  const [oppen, setOppen] = useState(false);

  return (
    <div className="mt-3 border-t border-canvas pt-3">
      <p className="text-small font-semibold text-ink-700">
        Anteckningar {anteckningar.length > 0 && `(${anteckningar.length})`}
      </p>

      {anteckningar.length === 0 ? (
        <p className="mt-1 text-small text-ink-500">
          Ingen har antecknat något om läget än.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {anteckningar.map((a) => (
            <li key={a.id} className="rounded-sm bg-canvas px-3 py-2">
              <p className="whitespace-pre-line text-small text-ink-900">{a.text}</p>
              <p className="mt-1 text-micro text-ink-500">
                {a.av} · {a.nar.slice(0, 10)} {a.nar.slice(11, 16)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {egenAnmalan ? (
        <p className="mt-2 text-micro text-ink-300">
          Anteckningar skrivs av den som ansvarar för dig, inte av dig själv.
        </p>
      ) : (
        <div className="mt-2">
          {state.fel && <Notis ton="danger">{state.fel}</Notis>}
          {state.ok && <Notis ton="ok">{state.ok}</Notis>}

          {!oppen ? (
            <Button type="button" size="sm" variant="diskret" onClick={() => setOppen(true)}>
              Lägg till anteckning
            </Button>
          ) : (
            <form action={action} className="flex flex-col gap-2">
              <input type="hidden" name="id" value={rapportId} />
              <label htmlFor={`anteckning-${rapportId}`} className="sr-only">
                Anteckning om läget
              </label>
              {/* Rakt <textarea>: sidan visar flera anmälningar, och `Field`
                  sätter id ur `namn`. Samma undantag som `Chefshandlingar`. */}
              <textarea
                id={`anteckning-${rapportId}`}
                name="text"
                rows={2}
                required
                maxLength={ANTECKNING_MAX}
                value={text}
                onChange={(e) => setText(e.target.value)}
                className={KONTROLL}
                placeholder="Till exempel: pratat med honom i dag, räknar med att vara tillbaka på måndag."
              />
              <p className="text-micro text-ink-500">
                Skriv om läget och om arbetet — aldrig om diagnos, symtom eller behandling. Texten
                går inte att ändra efteråt, och den ingår i personens registerutdrag.
              </p>
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" laddar={sparar} disabled={!text.trim()}>
                  Spara anteckning
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setOppen(false);
                    setText("");
                  }}
                  className="text-small font-semibold text-ink-500 hover:text-ink-900"
                >
                  Avbryt
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
