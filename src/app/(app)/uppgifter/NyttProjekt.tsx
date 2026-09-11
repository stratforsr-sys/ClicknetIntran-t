"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { cn } from "@/components/ui/cn";
import { skapaProjekt, type UppgiftState } from "./actions";

const FARGER = [
  { id: "brand", etikett: "Grön", klass: "bg-brand-500" },
  { id: "info", etikett: "Blå", klass: "bg-info" },
  { id: "accent", etikett: "Orange", klass: "bg-accent" },
  { id: "ok", etikett: "Mörkgrön", klass: "bg-ok" },
  { id: "warn", etikett: "Gul", klass: "bg-warn" },
  { id: "danger", etikett: "Röd", klass: "bg-danger" },
];

/**
 * Nytt projekt.
 *
 * FÄLLS UT, LIGGER INTE PÅ EN EGEN SIDA. Ett projekt är tre uppgifter med en
 * hatt på, och ett formulär man navigerar till för det är ett formulär man
 * avstår från — då blir uppgifterna liggande löst i stället, vilket är precis
 * vad hatten fanns för.
 *
 * Bara namnet krävs. Färg och deadline är det man lägger till när projektet
 * visat sig leva.
 */
export function NyttProjekt() {
  const [oppet, setOppet] = useState(false);
  const [state, action, vantar] = useActionState<UppgiftState, FormData>(skapaProjekt, {});
  const [farg, setFarg] = useState("brand");

  useEffect(() => {
    if (state.ok) setOppet(false);
  }, [state.ok]);

  if (!oppet) {
    return (
      <Button type="button" variant="sekundar" size="sm" onClick={() => setOppet(true)}>
        Nytt projekt
      </Button>
    );
  }

  return (
    <form
      action={action}
      className="flex w-full max-w-md flex-col gap-3 rounded-md bg-surface p-4 shadow-elev-2"
    >
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}

      <Field label="Namn" namn="name">
        <Input namn="name" required autoFocus maxLength={120} placeholder="Mässan i november" />
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-small font-semibold text-ink-700">Färg</legend>
        <input type="hidden" name="color" value={farg} />
        <div className="flex flex-wrap gap-2">
          {FARGER.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={farg === f.id}
              aria-label={f.etikett}
              onClick={() => setFarg(f.id)}
              className={cn(
                "size-8 rounded-full transition-transform duration-fast",
                f.klass,
                farg === f.id ? "ring-2 ring-ink-900 ring-offset-2" : "hover:scale-110",
              )}
            />
          ))}
        </div>
      </fieldset>

      <Field label="Deadline (valfri)" namn="due_date">
        <Input namn="due_date" type="date" />
      </Field>

      <div className="flex gap-2">
        <Button type="submit" size="sm" laddar={vantar} disabled={vantar}>
          Skapa
        </Button>
        <Button type="button" variant="diskret" size="sm" onClick={() => setOppet(false)}>
          Avbryt
        </Button>
      </div>
    </form>
  );
}
