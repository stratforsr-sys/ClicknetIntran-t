"use client";

import { useActionState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { BLOCKERING_ETIKETT } from "@/lib/lonerapport";
import { generera, attestera, laggJustering, type PeriodState } from "../actions";

type Person = { id: string; namn: string };

/**
 * AC-2.14: spärren ska förklara sig. Listan visar vad som blockerar, vem det
 * gäller och vilken dag — så att chefen kan gå och åtgärda i stället för att
 * gissa varför knappen inte gör något.
 */
function Hinder({ state }: { state: PeriodState }) {
  if (!state.blockeringar?.length) return null;

  return (
    <ul className="mt-3 flex flex-col gap-2">
      {state.blockeringar.map((b, i) => (
        <li
          key={`${b.employee_id}-${b.datum}-${i}`}
          className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-sm bg-surface-alt px-3 py-2"
        >
          <span className="text-micro font-semibold uppercase tracking-wide text-ink-500">
            {BLOCKERING_ETIKETT[b.typ]}
          </span>
          <span className="text-small text-ink-900">{b.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function Generera({ periodId, harUnderlag }: { periodId: string; harUnderlag: boolean }) {
  const [state, action, vantar] = useActionState<PeriodState, FormData>(generera, {});

  return (
    <Card>
      <CardHeader
        titel={harUnderlag ? "Generera om" : "Generera underlag"}
        beskrivning="Läser arbetstidsjournalen för perioden. Skrivs om från grunden varje gång."
      />

      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}
      <Hinder state={state} />

      <form action={action} className="mt-4">
        <input type="hidden" name="period_id" value={periodId} />
        <Button type="submit" variant={harUnderlag ? "sekundar" : "primar"} laddar={vantar}>
          {harUnderlag ? "Generera om" : "Generera underlag"}
        </Button>
      </form>
    </Card>
  );
}

export function Attestera({ periodId }: { periodId: string }) {
  const [state, action, vantar] = useActionState<PeriodState, FormData>(attestera, {});

  return (
    <Card status="warn">
      <CardHeader
        titel="Attestera perioden"
        beskrivning="Attesten låser underlaget. Därefter går inget att skriva om — bara att lägga justeringsposter bredvid."
      />

      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      <Hinder state={state} />

      <form action={action} className="mt-4">
        <input type="hidden" name="period_id" value={periodId} />
        <Button type="submit" laddar={vantar}>
          Attestera och lås
        </Button>
      </form>
    </Card>
  );
}

export function Justering({ periodId, personal }: { periodId: string; personal: Person[] }) {
  const [state, action, vantar] = useActionState<PeriodState, FormData>(laggJustering, {});

  return (
    <Card>
      <CardHeader
        titel="Justeringspost"
        beskrivning="Perioden är låst. En korrigering läggs till bredvid underlaget, med motivering som står kvar."
      />

      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}

      <form action={action} className="mt-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="period_id" value={periodId} />

        <Field label="Person" namn="employee_id">
          <Select namn="employee_id" defaultValue="" required>
            <option value="">Välj</option>
            {personal.map((p) => (
              <option key={p.id} value={p.id}>
                {p.namn}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Minuter" namn="minuter" hjalp="Negativt tal drar ifrån.">
          <Input namn="minuter" type="number" step="1" required className="w-32" />
        </Field>

        <Field label="Motivering" namn="motivering">
          <Input namn="motivering" required className="min-w-[18rem]" />
        </Field>

        <Button type="submit" variant="sekundar" laddar={vantar}>
          Bokför justering
        </Button>
      </form>
    </Card>
  );
}
