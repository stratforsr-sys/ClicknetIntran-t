"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import {
  sparaKonsekvenssteg,
  sparaNiva,
  stangNiva,
  taBortKonsekvenssteg,
  type ReglerState,
} from "./actions";

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

// -----------------------------------------------------------------------------
// E13 steg 6: konsekvenstrappan
// -----------------------------------------------------------------------------

const ATGARDSVAL = [
  { varde: "varning", etikett: "Varning" },
  { varde: "skriftlig_erinran", etikett: "Skriftlig erinran" },
  { varde: "bonusforlust", etikett: "Bonusförlust innevarande månad" },
  { varde: "arende", etikett: "Personalärende" },
];

/**
 * Ett steg i konsekvenstrappan.
 *
 * INGET VERKANSVAL, till skillnad fran volymtrappan ovan. Skalet ar att
 * frysningen sker pa handelsen och inte pa regeln: en beslutad handelse bar
 * sitt trappsteg for evigt, sa en andring har galler framat av sig sjalv. Ett
 * "gäller denna månad"-val hade darfor varit ett val utan innebord.
 */
export function KonsekvensSteg({ steg }: { steg?: Konsekvensteg }) {
  const [state, action, vantar] = useActionState<ReglerState, FormData>(sparaKonsekvenssteg, {});

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}

      <div className="grid gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Steg</span>
          <input
            name="ordning"
            required
            inputMode="numeric"
            defaultValue={steg?.ordning ?? ""}
            placeholder="1"
            className={KONTROLL}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Vid antal händelser</span>
          <input
            name="antal_handelser"
            required
            inputMode="numeric"
            defaultValue={steg?.antal_handelser ?? ""}
            placeholder="1"
            className={KONTROLL}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Inom antal månader</span>
          <input
            name="periodlangd_manader"
            required
            inputMode="numeric"
            defaultValue={steg?.periodlangd_manader ?? 3}
            placeholder="3"
            className={KONTROLL}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Åtgärd</span>
          <select name="atgard" defaultValue={steg?.atgard ?? "varning"} className={KONTROLL}>
            {ATGARDSVAL.map((a) => (
              <option key={a.varde} value={a.varde}>
                {a.etikett}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex items-center gap-2 text-small text-ink-700">
        <input type="checkbox" name="notifiera" defaultChecked={steg?.notifiera ?? true} />
        Skicka notis till den det gäller
      </label>

      <div>
        <Button type="submit" variant="sekundar" size="sm" disabled={vantar}>
          Spara steget
        </Button>
      </div>
    </form>
  );
}

export type Konsekvensteg = {
  ordning: number;
  antal_handelser: number;
  periodlangd_manader: number;
  atgard: string;
  notifiera: boolean;
};

export function TaBortSteg({ ordning }: { ordning: number }) {
  const [state, action, vantar] = useActionState<ReglerState, FormData>(
    taBortKonsekvenssteg,
    {},
  );

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="ordning" value={ordning} />
      <Button type="submit" variant="diskret" size="sm" disabled={vantar}>
        Ta bort
      </Button>
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}
    </form>
  );
}
