"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Notis } from "@/components/ui/Notis";
import { faststallPeriod, markeraUtbetald, type StangningState } from "./stangning";

/**
 * Knapparna for periodstangningen.
 *
 * Tva olika atgarder med tva olika kretsar bakom sig — se `stangning.ts`. Bada
 * ar formular och inte onClick: atgarden ska ga igenom aven for den som stangt
 * av javascript, och den ska lamna ett spar i `audit_log` oavsett.
 */

export function Faststall({ manad }: { manad: string }) {
  const [state, action, vantar] = useActionState<StangningState, FormData>(faststallPeriod, {});

  return (
    <form action={action} className="flex flex-col gap-2">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}
      <input type="hidden" name="period_month" value={manad} />
      <Button type="submit" size="sm" laddar={vantar} disabled={vantar}>
        Fastställ
      </Button>
    </form>
  );
}

export function Utbetald({ manad }: { manad: string }) {
  const [state, action, vantar] = useActionState<StangningState, FormData>(markeraUtbetald, {});

  return (
    <form action={action} className="flex flex-col gap-2">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}
      <input type="hidden" name="period_month" value={manad} />
      <Button type="submit" variant="sekundar" size="sm" laddar={vantar} disabled={vantar}>
        Markera utbetald
      </Button>
    </form>
  );
}
