"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { registreraSamtal, type KvState } from "./actions";

/**
 * Registrerar ett samtal for bedomning.
 *
 * URVALET SKER UTANFOR NAVET tills dialer-API:t finns (steg 8). Chefen valjer
 * vilket samtal som ska bedomas; navet bar bara vem, nar och vilken kund.
 * Sommen ligger redan i `kv_call.source` och `external_ref`, sa den dagen
 * dialern kopplas in behover den har vyn inte roras.
 */
export function Registrera({ personer }: { personer: { id: string; namn: string }[] }) {
  const [state, action, vantar] = useActionState<KvState, FormData>(registreraSamtal, {});

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}

      <div className="grid gap-3 sm:grid-cols-3">
        <label htmlFor="employee_id" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Säljare</span>
          <select id="employee_id" name="employee_id" required className={KONTROLL}>
            {personer.map((p) => (
              <option key={p.id} value={p.id}>
                {p.namn}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="call_date" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Datum</span>
          <input id="call_date" name="call_date" type="date" required className={KONTROLL} />
        </label>

        <label htmlFor="customer" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Kund</span>
          <input id="customer" name="customer" required placeholder="Kund AB" className={KONTROLL} />
        </label>
      </div>

      <div>
        <Button type="submit" laddar={vantar} disabled={vantar}>
          Registrera samtalet
        </Button>
      </div>
    </form>
  );
}
