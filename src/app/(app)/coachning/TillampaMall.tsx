"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { tillampaMall, type MallState } from "../mallar/actions";

/**
 * Tillamper en mall pa den har personen.
 *
 * STARTDATUMET GAR ATT ANDRA, och forvalet ar personens egen anstallningsdag
 * nar den finns. Den som laggs upp i navet tre veckor efter sin forsta dag ska
 * inte fa en rampplan vars alla frister redan gatt ut.
 */
export function TillampaMall({
  assigneeId,
  mallar,
  forvaltDatum,
}: {
  assigneeId: string;
  mallar: { id: string; name: string; moment: number }[];
  forvaltDatum: string;
}) {
  const [state, action, vantar] = useActionState<MallState, FormData>(tillampaMall, {});

  if (mallar.length === 0) return null;

  return (
    <form action={action} className="flex flex-col gap-3">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}

      <input type="hidden" name="assignee_id" value={assigneeId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor="template_id" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Mall</span>
          <select id="template_id" name="template_id" required className={KONTROLL}>
            {mallar.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.moment} moment)
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="start_date" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Räkna fristerna från</span>
          <input
            id="start_date"
            name="start_date"
            type="date"
            required
            defaultValue={forvaltDatum}
            className={KONTROLL}
          />
        </label>
      </div>

      <div>
        <Button type="submit" variant="sekundar" laddar={vantar} disabled={vantar}>
          Lägg upp mallens uppgifter
        </Button>
      </div>
    </form>
  );
}
