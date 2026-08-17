"use client";

import { useActionState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { skapaPeriod, type PeriodState } from "./actions";

/** Föregående månad — den period man i praktiken alltid skapar. */
function forraManaden() {
  const nu = new Date();
  const start = new Date(nu.getFullYear(), nu.getMonth() - 1, 1);
  const slut = new Date(nu.getFullYear(), nu.getMonth(), 0);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start: iso(start), slut: iso(slut) };
}

export function NyPeriod() {
  const [state, action, vantar] = useActionState<PeriodState, FormData>(skapaPeriod, {});
  const { start, slut } = forraManaden();

  return (
    <Card>
      <CardHeader
        titel="Ny period"
        beskrivning="Förslaget är förra månaden. Går att ändra för avvikande löneperioder."
      />

      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}

      <form action={action} className="mt-4 flex flex-wrap items-end gap-3">
        <Field label="Från" namn="period_start">
          <Input namn="period_start" type="date" defaultValue={start} required />
        </Field>
        <Field label="Till" namn="period_end">
          <Input namn="period_end" type="date" defaultValue={slut} required />
        </Field>
        <Button type="submit" variant="sekundar" laddar={vantar}>
          Skapa period
        </Button>
      </form>
    </Card>
  );
}
