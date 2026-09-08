"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Notis } from "@/components/ui/Notis";
import { KONTROLL } from "@/components/ui/Field";
import { kronor } from "@/lib/provision";
import { sparaMal, type MalState } from "./actions";

/**
 * En rad per saljare. EN RAD ÄR ETT EGET FORMULÄR, och det är ett val.
 *
 * ===========================================================================
 * ALTERNATIVET VAR ETT ENDA FORMULÄR MED EN SPARA-KNAPP LÄNGST NER.
 *
 * Det hade skrivit tolv rader på ett klick, vilket låter effektivt och är det
 * inte: en chef som ändrar ETT mål hade då skrivit om elva rader hon inte rört,
 * med sitt eget namn i `set_by` och elva rader i `audit_log`. Loggen hade
 * därmed slutat kunna svara på vem som satte vad — alla ändringar hade sett
 * likadana ut.
 *
 * Ett formulär per rad skriver bara det som ändrades, och kvittot hamnar
 * bredvid den rad det gäller i stället för längst ner på sidan.
 * ===========================================================================
 *
 * `KONTROLL` i stället för `Field`: sidan har två identiska fält per rad gånger
 * antalet säljare, och `Field` sätter ett `id` per fält. Tolv fält med samma
 * `id` är trasig HTML och en etikett som pekar på fel ruta. Fälten bär därför
 * `aria-label` i stället, vilket är den formen som fungerar i en tabellrad.
 */
export function Malrad({
  person,
  manad,
  malOrder,
  malKronor,
  utfall,
}: {
  person: { id: string; namn: string };
  manad: string;
  malOrder: number | null;
  malKronor: number | null;
  /** Vad personen står på i månaden just nu. Ett mål satt blint är en gissning. */
  utfall: { order: number; kronor: number };
}) {
  const [state, action, vantar] = useActionState<MalState, FormData>(sparaMal, {});

  return (
    <li className="border-b border-canvas py-4 last:border-0">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="employee_id" value={person.id} />
        <input type="hidden" name="period_month" value={manad} />

        <div className="min-w-0 flex-1 basis-48">
          <p className="truncate text-body font-semibold text-ink-900">{person.namn}</p>
          <p className="tnum text-small text-ink-500">
            {utfall.order} order · {kronor(utfall.kronor)} hittills
          </p>
        </div>

        <label className="flex w-28 flex-col gap-1">
          <span className="text-micro uppercase text-ink-500">Order</span>
          <input
            type="number"
            name="target_orders"
            min={1}
            step={1}
            inputMode="numeric"
            defaultValue={malOrder ?? ""}
            aria-label={`Ordermål för ${person.namn}`}
            placeholder="—"
            className={`${KONTROLL} tnum`}
          />
        </label>

        <label className="flex w-36 flex-col gap-1">
          <span className="text-micro uppercase text-ink-500">Kronor</span>
          <input
            type="text"
            name="target_amount"
            inputMode="numeric"
            defaultValue={malKronor ?? ""}
            aria-label={`Kronmål för ${person.namn}`}
            placeholder="—"
            className={`${KONTROLL} tnum`}
          />
        </label>

        <Button type="submit" size="sm" variant="sekundar" laddar={vantar} disabled={vantar}>
          Spara
        </Button>
      </form>

      {state.fel && (
        <div className="mt-2">
          <Notis ton="danger">{state.fel}</Notis>
        </div>
      )}
      {state.ok && (
        <div className="mt-2">
          <Notis ton="ok">{state.ok}</Notis>
        </div>
      )}
    </li>
  );
}
