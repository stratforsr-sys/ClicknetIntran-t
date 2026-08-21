"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { sparaFodelsear, sparaIntakt, sparaLon, sparaSats, type KostnadState } from "../actions";

type Person = { id: string; namn: string };

/**
 * Formulären för E15:s konfiguration.
 *
 * Rakt <input> och inte <Input>: flera formulär på samma sida hade annars delat
 * id — samma skäl som i Chefshandlingar på sjuksidan.
 */

const SATSVAL: { kind: string; etikett: string; unit: string }[] = [
  { kind: "employer_fee_standard", etikett: "Arbetsgivaravgift, full", unit: "percent" },
  { kind: "employer_fee_reduced", etikett: "Arbetsgivaravgift, nedsatt", unit: "percent" },
  { kind: "employer_fee_reduced_cap", etikett: "Månadstak för nedsättningen", unit: "amount" },
  { kind: "young_age_min", etikett: "Ungdomsnedsättning, från ålder", unit: "years" },
  { kind: "young_age_max", etikett: "Ungdomsnedsättning, till ålder", unit: "years" },
  { kind: "senior_age_min", etikett: "Äldrenedsättning, från ålder", unit: "years" },
  { kind: "contribution_margin", etikett: "Täckningsgrad", unit: "percent" },
  { kind: "absence_cost_factor", etikett: "Lön som betalas under frånvaro", unit: "percent" },
];

export function Satsformular({
  personer,
  franvarotyper,
  idag,
}: {
  personer: Person[];
  franvarotyper: { id: string; label: string }[];
  idag: string;
}) {
  const [state, action, vantar] = useActionState<KostnadState, FormData>(sparaSats, {});
  const [kind, setKind] = useState(SATSVAL[0].kind);
  const vald = SATSVAL.find((s) => s.kind === kind)!;

  return (
    <form action={action} className="mt-5 flex flex-col gap-3 border-t border-canvas pt-5">
      <h3 className="text-small font-semibold text-ink-700">Ny eller ändrad sats</h3>

      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}

      <div className="flex flex-wrap items-end gap-3">
        <label htmlFor="sats_kind" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Sats</span>
          <select
            id="sats_kind"
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className={`${KONTROLL} max-w-72`}
          >
            {SATSVAL.map((s) => (
              <option key={s.kind} value={s.kind}>
                {s.etikett}
              </option>
            ))}
          </select>
        </label>

        <input type="hidden" name="unit" value={vald.unit} />

        {kind === "absence_cost_factor" && (
          <label htmlFor="sats_applies" className="flex flex-col gap-1">
            <span className="text-micro text-ink-500">Frånvarotyp</span>
            <select id="sats_applies" name="applies_to" className={`${KONTROLL} max-w-56`} required>
              {franvarotyper.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <label htmlFor="sats_value" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">
            Värde {vald.unit === "percent" ? "(%)" : vald.unit === "amount" ? "(kr)" : "(år)"}
          </span>
          <input
            id="sats_value"
            name="value"
            type="number"
            step={vald.unit === "years" ? "1" : "0.01"}
            min="0"
            required
            className={`${KONTROLL} tnum max-w-32`}
          />
        </label>

        <label htmlFor="sats_from" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Gäller från</span>
          <input
            id="sats_from"
            name="valid_from"
            type="date"
            defaultValue={idag}
            required
            className={`${KONTROLL} max-w-44`}
          />
        </label>

        <label htmlFor="sats_owner" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Ägare (K28)</span>
          <select id="sats_owner" name="owner_id" className={`${KONTROLL} max-w-56`}>
            <option value="">Ingen</option>
            {personer.map((p) => (
              <option key={p.id} value={p.id}>
                {p.namn}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="sats_review" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Ses över senast</span>
          <input id="sats_review" name="review_due" type="date" className={`${KONTROLL} max-w-44`} />
        </label>

        <Button type="submit" size="sm" laddar={vantar}>
          Spara satsen
        </Button>
      </div>

      <label htmlFor="sats_note" className="flex flex-col gap-1">
        <span className="text-micro text-ink-500">Anteckning — varifrån kommer siffran?</span>
        <input
          id="sats_note"
          name="note"
          placeholder="Skatteverket, arbetsgivaravgifter 2027"
          className={`${KONTROLL} max-w-[32rem] text-small`}
        />
      </label>

      <p className="text-micro text-ink-500">
        En ny sats ersätter inte den gamla, den efterföljer den. Historiken måste stå kvar för att
        en gammal beräkning ska gå att räkna om (AC-13.8).
      </p>
    </form>
  );
}

export function Loneformular({
  personer,
  idag,
}: {
  personer: (Person & { fodelsear: number | null })[];
  idag: string;
}) {
  const [lonState, lonAction, lonVantar] = useActionState<KostnadState, FormData>(sparaLon, {});
  const [arState, arAction, arVantar] = useActionState<KostnadState, FormData>(sparaFodelsear, {});

  return (
    <div className="mt-5 flex flex-col gap-5 border-t border-canvas pt-5">
      <form action={lonAction} className="flex flex-col gap-3">
        <h3 className="text-small font-semibold text-ink-700">Ny månadslön</h3>
        {lonState.fel && <Notis ton="danger">{lonState.fel}</Notis>}
        {lonState.ok && <Notis ton="ok">{lonState.ok}</Notis>}

        <div className="flex flex-wrap items-end gap-3">
          <label htmlFor="lon_person" className="flex flex-col gap-1">
            <span className="text-micro text-ink-500">Person</span>
            <select id="lon_person" name="employee_id" required className={`${KONTROLL} max-w-56`}>
              {personer.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.namn}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="lon_belopp" className="flex flex-col gap-1">
            <span className="text-micro text-ink-500">Månadslön (kr)</span>
            <input
              id="lon_belopp"
              name="monthly_salary"
              type="number"
              min="0"
              step="1"
              required
              className={`${KONTROLL} tnum max-w-40`}
            />
          </label>

          <label htmlFor="lon_from" className="flex flex-col gap-1">
            <span className="text-micro text-ink-500">Gäller från</span>
            <input
              id="lon_from"
              name="valid_from"
              type="date"
              defaultValue={idag}
              required
              className={`${KONTROLL} max-w-44`}
            />
          </label>

          <Button type="submit" size="sm" laddar={lonVantar}>
            Spara lönen
          </Button>
        </div>
        <p className="text-micro text-ink-500">
          Löneuppgiften skrivs aldrig om. En löneändring är en ny rad med ett nytt datum — annars
          går en historisk lönekostnad inte längre att förklara.
        </p>
      </form>

      <form action={arAction} className="flex flex-col gap-3">
        <h3 className="text-small font-semibold text-ink-700">Födelseår</h3>
        {arState.fel && <Notis ton="danger">{arState.fel}</Notis>}
        {arState.ok && <Notis ton="ok">{arState.ok}</Notis>}

        <div className="flex flex-wrap items-end gap-3">
          <label htmlFor="ar_person" className="flex flex-col gap-1">
            <span className="text-micro text-ink-500">Person</span>
            <select id="ar_person" name="employee_id" required className={`${KONTROLL} max-w-56`}>
              {personer.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.namn}
                  {p.fodelsear ? ` (${p.fodelsear})` : ""}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="ar_varde" className="flex flex-col gap-1">
            <span className="text-micro text-ink-500">År</span>
            <input
              id="ar_varde"
              name="birth_year"
              type="number"
              min="1930"
              max="2011"
              step="1"
              placeholder="1995"
              required
              className={`${KONTROLL} tnum max-w-28`}
            />
          </label>

          <Button type="submit" size="sm" variant="sekundar" laddar={arVantar}>
            Spara året
          </Button>
        </div>
      </form>
    </div>
  );
}

export function Intaktsformular({
  personer,
  perioder,
}: {
  personer: Person[];
  perioder: { id: string; etikett: string }[];
}) {
  const [state, action, vantar] = useActionState<KostnadState, FormData>(sparaIntakt, {});

  if (perioder.length === 0) {
    return <p className="mt-3 text-small text-ink-500">Ingen löneperiod finns att koppla en intäkt till.</p>;
  }

  return (
    <form action={action} className="mt-4 flex flex-col gap-3">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}

      <div className="flex flex-wrap items-end gap-3">
        <label htmlFor="int_period" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Period</span>
          <select id="int_period" name="period_id" required className={`${KONTROLL} max-w-64`}>
            {perioder.map((p) => (
              <option key={p.id} value={p.id}>
                {p.etikett}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="int_person" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Person</span>
          <select id="int_person" name="employee_id" required className={`${KONTROLL} max-w-56`}>
            {personer.map((p) => (
              <option key={p.id} value={p.id}>
                {p.namn}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="int_belopp" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Intäkt (kr)</span>
          <input
            id="int_belopp"
            name="amount"
            type="number"
            min="0"
            step="1"
            required
            className={`${KONTROLL} tnum max-w-40`}
          />
        </label>

        <Button type="submit" size="sm" variant="sekundar" laddar={vantar}>
          Spara intäkten
        </Button>
      </div>
    </form>
  );
}
