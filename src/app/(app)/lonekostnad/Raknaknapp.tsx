"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Notis } from "@/components/ui/Notis";
import { raknaPeriod, type KostnadState } from "./actions";

/** AC-13.8: en omräkning skriver nya rader. De gamla tas bort — se 0025. */
export function Raknaknapp({ periodId, finnsRader }: { periodId: string; finnsRader: boolean }) {
  const [state, action, vantar] = useActionState<KostnadState, FormData>(raknaPeriod, {});

  return (
    <div className="flex flex-col gap-3">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}
      <form action={action}>
        <input type="hidden" name="period_id" value={periodId} />
        <Button type="submit" size="sm" variant={finnsRader ? "sekundar" : "primar"} laddar={vantar}>
          {finnsRader ? "Räkna om perioden" : "Räkna perioden"}
        </Button>
      </form>
    </div>
  );
}
