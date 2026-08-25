"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { sparaNiva, stangNiva, type ReglerState } from "./actions";

/**
 * Formularen for volymtrappan.
 *
 * Rakt <input> och inte <Input>: sidan har flera formular och hade annars delat
 * id — samma skal som i inmatningen pa /provision.
 *
 * VERKANSVALET STAR PA BADA FORMULAREN och ar aldrig forvalt till "denna
 * manad". Det valet raknar om en manad som redan pagar, och det ska vara ett
 * aktivt beslut och inte ett standardvarde nagon klickar forbi.
 */

const VERKAN = [
  { varde: "nasta_manad", etikett: "Från och med nästa månad" },
  { varde: "nu", etikett: "Från och med nu" },
  { varde: "denna_manad", etikett: "Allt intjänat denna månad (räknar om månaden)" },
];

const ENHETER = [
  { varde: "amount_fixed", etikett: "Fast belopp när nivån nås" },
  { varde: "percent", etikett: "Procent på månadens grundprovision" },
  { varde: "amount_per_order", etikett: "Kronor per order, gäller samtliga order" },
];

export function NyNiva({ troskelforslag }: { troskelforslag: number[] }) {
  const [state, action, vantar] = useActionState<ReglerState, FormData>(sparaNiva, {});

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}

      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor="threshold" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Antal order</span>
          <input
            id="threshold"
            name="threshold"
            required
            inputMode="numeric"
            list="troskelforslag"
            placeholder="10"
            className={KONTROLL}
          />
          <datalist id="troskelforslag">
            {troskelforslag.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>

        <label htmlFor="amount" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Belopp</span>
          <input
            id="amount"
            name="amount"
            required
            inputMode="decimal"
            placeholder="5 000"
            className={KONTROLL}
          />
        </label>

        <label htmlFor="unit" className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-micro text-ink-500">Form</span>
          <select id="unit" name="unit" required defaultValue="amount_fixed" className={KONTROLL}>
            {ENHETER.map((e) => (
              <option key={e.varde} value={e.varde}>
                {e.etikett}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="verkan" className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-micro text-ink-500">Gäller från</span>
          <select id="verkan" name="verkan" required className={KONTROLL}>
            {VERKAN.map((v) => (
              <option key={v.varde} value={v.varde}>
                {v.etikett}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <Button type="submit" laddar={vantar} disabled={vantar}>
          Spara nivån
        </Button>
      </div>
    </form>
  );
}

export function TaBortNiva({ troskel }: { troskel: number }) {
  const [state, action, vantar] = useActionState<ReglerState, FormData>(stangNiva, {});

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      <input type="hidden" name="threshold" value={troskel} />
      <select
        name="verkan"
        required
        defaultValue="nasta_manad"
        aria-label={`Ta bort nivå ${troskel} från`}
        className={`${KONTROLL} max-w-[16rem]`}
      >
        {VERKAN.map((v) => (
          <option key={v.varde} value={v.varde}>
            {v.etikett}
          </option>
        ))}
      </select>
      <Button type="submit" variant="diskret" size="sm" laddar={vantar} disabled={vantar}>
        Ta bort
      </Button>
    </form>
  );
}
