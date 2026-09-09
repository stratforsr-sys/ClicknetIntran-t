"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { kronor } from "@/lib/provision";
import { sparaChefssats, type ReglerState } from "./actions";

/**
 * Saljchefens tva satser.
 *
 * ===========================================================================
 * RAKNEEXEMPLET AR INTE PYNT. Det ar formularets viktigaste del.
 *
 * "10 %" sager ingenting om vad nagon far. "10 % av 10 440 kr = 1 044 kr pa ett
 * Paket 1 over tolv manader" sager det, och den som skriver in en siffra ser
 * genast om hen menade den.
 *
 * Samma resonemang som K&V-installningen foljer nar den raknar ut vad troskeln
 * motsvarar i procent medan man skriver (avsnitt 6.1): en konfiguration vars
 * verkan bara syns i efterhand ar en konfiguration folk stallar fel.
 * ===========================================================================
 *
 * VERKANSVALET AR ALDRIG FORVALT till "denna manad". Det valet raknar om en
 * manad som redan pagar, och det ska vara ett aktivt beslut — samma linje som
 * volymtrappans formular i `Trappa.tsx`.
 *
 * OBS: en satsandring slar bara igenom pa order som godkanns DAREFTER. Redan
 * godkanda order bar sitt overtack fruset i `order_manager_commission` (0050),
 * precis som provisionen ar frusen pa ordern. Texten under knappen sager det.
 */

const VERKAN = [
  { varde: "nasta_manad", etikett: "Från och med nästa månad" },
  { varde: "nu", etikett: "Från och med nu" },
  { varde: "denna_manad", etikett: "Allt intjänat denna månad" },
];

export function Chefssatsformular({
  personer,
  nuvarande,
  /** Ett paket att rakna exemplet pa. Lagsta priset och kortaste tiden. */
  exempel,
}: {
  personer: { id: string; namn: string }[];
  nuvarande: {
    employee_id: string;
    override_percent: number;
    own_sale_percent: number;
  } | null;
  exempel: { ordervarde: number; provision: number; text: string } | null;
}) {
  const [state, action, vantar] = useActionState<ReglerState, FormData>(sparaChefssats, {});

  const [overtack, setOvertack] = useState(String(nuvarande?.override_percent ?? ""));
  const [egen, setEgen] = useState(String(nuvarande?.own_sale_percent ?? ""));

  const tal = (text: string): number | null => {
    const rensat = text.replace(/[\s ]/g, "").replace(",", ".");
    if (!rensat) return null;
    const n = Number(rensat);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
  };

  const overtackTal = tal(overtack);
  const egenTal = tal(egen);

  const restpost = exempel ? Math.max(0, exempel.ordervarde - exempel.provision) : null;
  const overtackKr =
    restpost !== null && overtackTal !== null ? Math.round((restpost * overtackTal) / 100) : null;
  const egenKr =
    exempel && egenTal !== null ? Math.round((exempel.ordervarde * egenTal) / 100) : null;

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}

      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor="employee_id" className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-micro text-ink-500">Vem får övertäcket</span>
          <select
            id="employee_id"
            name="employee_id"
            required
            defaultValue={nuvarande?.employee_id ?? ""}
            className={KONTROLL}
          >
            <option value="" disabled>
              Välj person
            </option>
            {personer.map((p) => (
              <option key={p.id} value={p.id}>
                {p.namn}
              </option>
            ))}
          </select>
          <span className="text-small text-ink-500">
            En person i taget. Byts mottagaren står redan bokförda övertäck kvar på den förra —
            de är frusna på sina order.
          </span>
        </label>

        <label htmlFor="override_percent" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Övertäck på andras order</span>
          <input
            id="override_percent"
            name="override_percent"
            required
            inputMode="decimal"
            placeholder="10"
            className={KONTROLL}
            value={overtack}
            onChange={(e) => setOvertack(e.target.value)}
          />
          <span className="text-small text-ink-500">
            Procent på det som blir över när säljarens provision dragits av ordervärdet.
          </span>
        </label>

        <label htmlFor="own_sale_percent" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Egen försäljning</span>
          <input
            id="own_sale_percent"
            name="own_sale_percent"
            required
            inputMode="decimal"
            placeholder="40"
            className={KONTROLL}
            value={egen}
            onChange={(e) => setEgen(e.target.value)}
          />
          <span className="text-small text-ink-500">
            Procent på hela ordervärdet. Ersätter paketmatrisen på egna order — kommer inte utöver
            den.
          </span>
        </label>

        <label htmlFor="chefsverkan" className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-micro text-ink-500">Gäller från</span>
          <select id="chefsverkan" name="verkan" required className={KONTROLL}>
            {VERKAN.map((v) => (
              <option key={v.varde} value={v.varde}>
                {v.etikett}
              </option>
            ))}
          </select>
        </label>
      </div>

      {exempel && (
        <dl className="grid gap-x-6 gap-y-3 rounded-sm bg-surface-alt p-4 sm:grid-cols-2">
          <p className="text-micro uppercase text-ink-500 sm:col-span-2">
            Så blir det på {exempel.text}
          </p>

          <div>
            <dt className="text-small text-ink-500">Säljaren tecknar</dt>
            <dd className="tnum mt-1 text-body text-ink-900">
              {kronor(exempel.ordervarde)} − {kronor(exempel.provision)} ={" "}
              {kronor(restpost ?? 0)} kvar
            </dd>
            <p className="tnum mt-1 text-h2 text-ink-900">
              {overtackKr === null ? "—" : kronor(overtackKr)}
            </p>
            <p className="text-micro text-ink-500">till säljchefen</p>
          </div>

          <div>
            <dt className="text-small text-ink-500">Säljchefen tecknar själv</dt>
            <dd className="tnum mt-1 text-body text-ink-900">
              {egenTal ?? "—"} % av {kronor(exempel.ordervarde)}
            </dd>
            <p className="tnum mt-1 text-h2 text-ink-900">
              {egenKr === null ? "—" : kronor(egenKr)}
            </p>
            <p className="text-micro text-ink-500">till säljchefen, och inget övertäck</p>
          </div>
        </dl>
      )}

      <div>
        <Button type="submit" laddar={vantar} disabled={vantar}>
          Spara satserna
        </Button>
      </div>

      <p className="max-w-[70ch] text-small text-ink-500">
        Ändringen slår igenom på order som godkänns därefter. Redan godkända order bär sitt
        övertäck fruset — samma regel som provisionen på ordern, och av samma skäl: en sats som
        ändras i november får inte ändra vad någon fick i september. En stängd månad rörs aldrig.
      </p>
    </form>
  );
}
