"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { begarRattelse, type TidState } from "./actions";
import type { Handelse } from "@/lib/tid";

const TOM: TidState = {};

/** AC-2.5: den anställda begär, chefen beslutar. Ingen rättar rakt i loggen. */
export function Rattelse({ handelse }: { handelse: Handelse }) {
  const [oppen, setOppen] = useState(false);
  const [state, skicka, vantar] = useActionState(begarRattelse, TOM);

  if (handelse.correction_state === "pending") {
    return <span className="text-small text-ink-500">Väntar på beslut</span>;
  }

  if (!oppen) {
    return (
      <button
        type="button"
        onClick={() => setOppen(true)}
        className="text-small text-ink-500 underline hover:text-ink-900"
      >
        Fel tid?
      </button>
    );
  }

  if (state.ok) {
    return <span className="text-small text-ok-ink">{state.ok}</span>;
  }

  // Datetime-local vill ha lokal tid utan zon.
  const lokal = new Date(handelse.occurred_at);
  const forval = new Date(lokal.getTime() - lokal.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);

  return (
    <form action={skicka} className="flex w-full flex-col gap-2 rounded-sm bg-canvas p-3">
      <input type="hidden" name="ersatter" value={handelse.id} />

      {state.fel && <Notis ton="danger">{state.fel}</Notis>}

      <label className="flex flex-col gap-1.5">
        <span className="text-small font-semibold text-ink-700">Rätt tid</span>
        <input
          type="datetime-local"
          name="tid"
          defaultValue={forval}
          required
          className={KONTROLL}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-small font-semibold text-ink-700">Varför</span>
        <input
          name="motivering"
          required
          placeholder="Glömde stämpla ut när jag gick"
          className={KONTROLL}
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" laddar={vantar}>
          Skicka till chefen
        </Button>
        <Button type="button" size="sm" variant="diskret" onClick={() => setOppen(false)}>
          Avbryt
        </Button>
      </div>
    </form>
  );
}
