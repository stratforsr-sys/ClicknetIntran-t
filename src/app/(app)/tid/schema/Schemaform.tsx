"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { sparaArbetsschema, sparaRastschema, type TidState } from "../actions";

const TOM: TidState = {};

const DAGAR = [
  { n: 1, kort: "Mån" },
  { n: 2, kort: "Tis" },
  { n: 3, kort: "Ons" },
  { n: 4, kort: "Tor" },
  { n: 5, kort: "Fre" },
  { n: 6, kort: "Lör" },
  { n: 7, kort: "Sön" },
];

type Val = { id: string; namn: string };

/**
 * AC-2.34. Samma formulär för arbetsschema och rastschema — de skiljer sig i
 * fälten men inte i hur de sparas: en ny rad med ett datum, aldrig en ändring
 * av en gammal.
 */
export function Schemaform({
  sort,
  personer,
  team,
}: {
  sort: "arbete" | "rast";
  personer: Val[];
  team: Val[];
}) {
  const [state, skicka, vantar] = useActionState(
    sort === "arbete" ? sparaArbetsschema : sparaRastschema,
    TOM,
  );
  const [scope, setScope] = useState("company");
  const idag = new Date().toISOString().slice(0, 10);
  const p = (f: string) => `${sort}-${f}`;

  return (
    <form action={skicka} className="flex flex-col gap-5">
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1.5">
          <span className="text-small font-semibold text-ink-700">Gäller</span>
          <select
            name="scope"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className={`${KONTROLL} appearance-none pr-10`}
          >
            <option value="company">Hela bolaget</option>
            <option value="team">Ett team</option>
            <option value="employee">En person</option>
          </select>
        </label>

        {scope !== "company" && (
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
            <span className="text-small font-semibold text-ink-700">
              {scope === "team" ? "Team" : "Person"}
            </span>
            <select name="scope_id" required className={`${KONTROLL} appearance-none pr-10`}>
              <option value="">Välj</option>
              {(scope === "team" ? team : personer).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.namn}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <fieldset>
        <legend className="mb-2 text-small font-semibold text-ink-700">Veckodagar</legend>
        <div className="flex flex-wrap gap-2">
          {DAGAR.map((d) => (
            <label
              key={d.n}
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full bg-canvas px-4 text-small text-ink-700 transition-colors duration-fast has-checked:bg-brand-tint has-checked:text-brand-ink"
            >
              <input
                type="checkbox"
                name="veckodag"
                value={d.n}
                defaultChecked={d.n <= 5}
                className="size-4 accent-brand-600"
              />
              {d.kort}
            </label>
          ))}
        </div>
      </fieldset>

      {sort === "arbete" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-small font-semibold text-ink-700">Arbetsdagen börjar</span>
            <input id={p("start")} type="time" name="start_time" defaultValue="08:00" required className={KONTROLL} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-small font-semibold text-ink-700">Arbetsdagen slutar</span>
            <input id={p("slut")} type="time" name="end_time" defaultValue="17:00" required className={KONTROLL} />
            <span className="text-small text-ink-500">
              Glömd utstämpling stängs här, och märks för rättelse.
            </span>
          </label>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-small font-semibold text-ink-700">Tidigast start</span>
              <input id={p("fs")} type="time" name="window_start" defaultValue="11:30" required className={KONTROLL} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-small font-semibold text-ink-700">Önskad senaste start</span>
              <input id={p("fe")} type="time" name="window_end" defaultValue="13:00" required className={KONTROLL} />
              <span className="text-small text-ink-500">
                Rast som börjar efter den här tiden ger ingen avvikelse.
              </span>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-small font-semibold text-ink-700">Längd (minuter)</span>
              <input id={p("len")} type="number" name="duration_minutes" min={1} defaultValue={30} required className={KONTROLL} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-small font-semibold text-ink-700">Tolerans (minuter)</span>
              <input id={p("tol")} type="number" name="tolerans" min={5} defaultValue={5} required className={KONTROLL} />
              <span className="text-small text-ink-500">Minst 5.</span>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-small font-semibold text-ink-700">Rast nummer</span>
              <input id={p("sort")} type="number" name="sort" min={1} defaultValue={1} required className={KONTROLL} />
              <span className="text-small text-ink-500">1 = dagens första.</span>
            </label>
          </div>
        </>
      )}

      <label className="flex max-w-xs flex-col gap-1.5">
        <span className="text-small font-semibold text-ink-700">Gäller från</span>
        <input id={p("from")} type="date" name="valid_from" defaultValue={idag} required className={KONTROLL} />
        <span className="text-small text-ink-500">
          Dagar före det här datumet bedöms mot det schema som gällde då.
        </span>
      </label>

      <div>
        <Button type="submit" laddar={vantar}>
          Spara schemat
        </Button>
      </div>
    </form>
  );
}
