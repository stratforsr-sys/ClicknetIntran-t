"use client";

import { useActionState, useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { mataInSaldo, type FranvaroState } from "../../franvaro/actions";

type Rad = {
  type_id: string;
  label: string;
  days: number;
  as_of: string;
  earned_year: number | null;
  gammalt: boolean;
};

/**
 * E7.5 / AC-3.5: frånvarosaldon matas in för hand.
 *
 * ===========================================================================
 * NAVET RÄKNAR INGEN SEMESTERRÄTT. AC-2.17 och K5 gäller här lika mycket som i
 * löneunderlaget: en siffra i den här vyn är någons påstående, med namn och
 * datum, inte en beräkning. Så fort navet börjar räkna fram dagar har det
 * blivit ett lönesystem, med allt vad det innebär av ansvar för att siffran är
 * rätt.
 * ===========================================================================
 *
 * Raderna läggs till, aldrig om (trigger i 0019). En rättad siffra ska gå att
 * se bredvid den den ersatte — ett saldo som ändrats i tysthet går inte att
 * ifrågasätta, och det är precis vad en anställd ska kunna göra med sina dagar.
 */
export function Saldon({
  employeeId,
  rader,
  historik,
  typer,
  idag,
  fristDagar,
}: {
  employeeId: string;
  rader: Rad[];
  historik: { type_id: string; days: number; as_of: string; entered_at: string; namn: string }[];
  typer: { id: string; label: string; uses_balance: boolean }[];
  idag: string;
  fristDagar: number;
}) {
  const [state, action, sparar] = useActionState<FranvaroState, FormData>(mataInSaldo, {});
  const [typ, setTyp] = useState(typer[0]?.id ?? "vacation");

  return (
    <Card>
      <CardHeader
        titel="Frånvarosaldon"
        beskrivning={`Matas in för hand. Äldre än ${fristDagar} dagar märks som inaktuellt.`}
      />

      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}

      {rader.length === 0 ? (
        <p className="text-small text-ink-500">
          Inget saldo är inmatat. Den anställda kan söka ledigt ändå — navet påstår då ingenting om
          antalet dagar, vilket är riktigare än att påstå noll.
        </p>
      ) : (
        <ul className="flex flex-col">
          {rader.map((r) => (
            <li
              key={`${r.type_id}:${r.earned_year ?? "-"}`}
              className="flex items-baseline justify-between gap-4 border-b border-canvas py-2 last:border-0"
            >
              <span className="min-w-0">
                <span className="block text-body text-ink-900">
                  {r.label}
                  {r.earned_year !== null && (
                    <span className="text-ink-500"> · intjänat {r.earned_year}</span>
                  )}
                </span>
                <span className="block text-micro text-ink-500">Gällde {r.as_of}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {r.gammalt && <Badge ton="warn">Inaktuellt</Badge>}
                <span className="tnum text-h2 text-ink-900">{r.days}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <form action={action} className="mt-5 flex flex-col gap-3 rounded-sm bg-canvas p-4">
        <input type="hidden" name="employee_id" value={employeeId} />

        <div className="grid gap-3 sm:grid-cols-2">
          <label htmlFor="saldo_typ" className="flex flex-col gap-1">
            <span className="text-micro text-ink-500">Typ</span>
            <select
              id="saldo_typ"
              name="typ"
              value={typ}
              onChange={(e) => setTyp(e.target.value)}
              className={`${KONTROLL} appearance-none py-2 text-small`}
            >
              {typer
                .filter((t) => t.uses_balance)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
            </select>
          </label>

          <label htmlFor="saldo_dagar" className="flex flex-col gap-1">
            <span className="text-micro text-ink-500">Antal dagar</span>
            <input
              id="saldo_dagar"
              name="dagar"
              type="number"
              min={0}
              step={0.5}
              required
              className={`${KONTROLL} py-2 text-small`}
            />
          </label>

          <label htmlFor="saldo_datum" className="flex flex-col gap-1">
            <span className="text-micro text-ink-500">Siffran gällde</span>
            <input
              id="saldo_datum"
              name="as_of"
              type="date"
              required
              defaultValue={idag}
              max={idag}
              className={`${KONTROLL} py-2 text-small`}
            />
          </label>

          {/* Bara sparade dagar behover aret, och da behover de det verkligen:
              utan det gar femarsvarningen i AC-3.9 inte att rakna ut. */}
          {typ === "saved_vacation" && (
            <label htmlFor="saldo_ar" className="flex flex-col gap-1">
              <span className="text-micro text-ink-500">Intjänandeår</span>
              <input
                id="saldo_ar"
                name="intjanandear"
                type="number"
                min={2000}
                max={2100}
                placeholder="t.ex. 2023"
                className={`${KONTROLL} py-2 text-small`}
              />
              <span className="text-micro text-ink-300">
                Året semesteråret började. Utan det ges ingen femårsvarning.
              </span>
            </label>
          )}
        </div>

        <div>
          <Button type="submit" size="sm" variant="sekundar" laddar={sparar}>
            Mata in saldo
          </Button>
        </div>

        <p className="text-micro text-ink-500">
          Datumet är när siffran gällde, inte när du skriver in den. Matar du in junisaldot i
          augusti är det junisiffran som är två månader gammal.
        </p>
      </form>

      {historik.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-small font-semibold text-ink-500 hover:text-ink-900">
            Tidigare inmatningar ({historik.length})
          </summary>
          <ul className="mt-3 flex flex-col gap-2">
            {historik.map((h, i) => (
              <li key={i} className="text-micro text-ink-500">
                <span className="tnum text-ink-700">{h.days}</span> dagar gällde {h.as_of} —
                inmatat av {h.namn} {h.entered_at.slice(0, 10)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
