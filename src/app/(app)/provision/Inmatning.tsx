"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { bokforProvision, type ProvisionState } from "./actions";

type Person = { id: string; namn: string };

/**
 * Inmatningen. Rakt <input> och inte <Input>: sidan har flera formular och
 * hade annars delat id — samma skal som i satsformularet i E15.
 *
 * Manaderna kommer fardiga fran servern i stallet for en <input type="month">.
 * Fyra skal: framtida manader gar inte att valja alls, formatet kan inte bli
 * fel, listan visar med ord vilken manad det galler, och webblasarens egen
 * manadsvaljare ser olika ut i varje webblasare.
 */
export function Inmatning({
  personer,
  manader,
}: {
  personer: Person[];
  manader: { nyckel: string; etikett: string }[];
}) {
  const [state, action, vantar] = useActionState<ProvisionState, FormData>(bokforProvision, {});

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}

      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor="employee_id" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Person</span>
          <select id="employee_id" name="employee_id" required className={KONTROLL}>
            {personer.map((p) => (
              <option key={p.id} value={p.id}>
                {p.namn}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="period_month" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Intjänandemånad</span>
          <select id="period_month" name="period_month" required className={KONTROLL}>
            {manader.map((m) => (
              <option key={m.nyckel} value={m.nyckel}>
                {m.etikett}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="amount" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Belopp</span>
          <input
            id="amount"
            name="amount"
            required
            inputMode="decimal"
            placeholder="12 400"
            className={KONTROLL}
          />
        </label>

        <label htmlFor="deals" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Antal affärer (valfritt)</span>
          <input id="deals" name="deals" inputMode="numeric" placeholder="—" className={KONTROLL} />
        </label>
      </div>

      <label htmlFor="note" className="flex flex-col gap-1">
        <span className="text-micro text-ink-500">Anteckning (valfritt)</span>
        <input
          id="note"
          name="note"
          placeholder="Vad posten avser, eller vad som rättas"
          className={KONTROLL}
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" laddar={vantar}>
          Bokför posten
        </Button>
        <p className="text-small text-ink-500">
          En post skrivs aldrig om. En rättelse bokförs som ett negativt belopp, till exempel{" "}
          <span className="tnum">-2 000</span>.
        </p>
      </div>
    </form>
  );
}
