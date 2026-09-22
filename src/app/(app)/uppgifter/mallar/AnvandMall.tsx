"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { PRIORITET_ETIKETT, tidstext, type Prioritet } from "@/lib/uppgifter";
import { dagKort } from "@/lib/kalender";
import { forhandsbild, mallsammanfattning, momentdatum, type Mallmoment } from "@/lib/mallar";
import { anvandUppgiftsmall, type MallState } from "./actions";

export type Valbarmall = { id: string; name: string; description_md: string; moment: Mallmoment[] };

/**
 * Formuläret som tillämpar en mall.
 *
 * ===========================================================================
 * FÖRHANDSBILDEN ÄR HELA POÄNGEN MED ATT DEN HÄR ÄR EN KLIENTKOMPONENT
 *
 * Utan den är "Använd" en knapp som skapar sex rader någonstans i framtiden, och
 * den enda platsen där en mall med ett moment på dag 365 avslöjar sig är i
 * någons lista ett år senare. Med den står datumen utskrivna INNAN knappen
 * trycks, och de ändrar sig när man byter startdag.
 *
 * Datumen räknas av `momentdatum()` — samma funktion som servern använder när
 * raderna faktiskt skrivs. En egen uträkning i webbläsaren hade varit en andra
 * datumräkning, och en förhandsbild som visar fel dag är värre än ingen.
 * ===========================================================================
 */
export function AnvandMall({
  mallar,
  personer,
  projekt,
  mig,
  idag,
}: {
  mallar: Valbarmall[];
  personer: { id: string; namn: string }[];
  projekt: { id: string; name: string }[];
  mig: string;
  idag: string;
}) {
  const [state, action, vantar] = useActionState<MallState, FormData>(anvandUppgiftsmall, {});
  const [valdId, setValdId] = useState<string>(mallar[0]?.id ?? "");
  const [start, setStart] = useState<string>(idag);

  const vald = mallar.find((m) => m.id === valdId) ?? null;
  const bild = vald ? forhandsbild(vald.moment, start) : null;

  if (mallar.length === 0) {
    return (
      <p className="rounded-sm bg-canvas px-4 py-6 text-center text-small text-ink-500">
        Det finns ingen mall att använda än. Skriv den första längre ner.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Mall</span>
          <select
            name="template_id"
            value={valdId}
            onChange={(e) => setValdId(e.target.value)}
            className={`${KONTROLL} appearance-none pr-10`}
          >
            {mallar.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Startdag</span>
          <input
            type="date"
            name="start_date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            required
            className={KONTROLL}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Ansvarig</span>
          <select name="assignee_id" defaultValue={mig} className={`${KONTROLL} appearance-none pr-10`}>
            {personer.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id === mig ? `${p.namn} (jag)` : p.namn}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Projekt (valfritt)</span>
          <select name="project_id" defaultValue="" className={`${KONTROLL} appearance-none pr-10`}>
            <option value="">— inget —</option>
            {projekt.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {vald && vald.description_md && <p className="text-small text-ink-500">{vald.description_md}</p>}

      {vald && (
        <div className="flex flex-col gap-2 rounded-sm bg-canvas px-4 py-3">
          <p className="text-small font-semibold text-ink-700">
            {bild
              ? `${bild.antal} ${bild.antal === 1 ? "uppgift" : "uppgifter"} skapas · ${dagKort(bild.forsta)} – ${dagKort(bild.sista)}`
              : "Mallen har inga moment."}
          </p>
          <ol className="flex flex-col gap-1">
            {vald.moment.map((m) => (
              <li key={m.sort} className="flex flex-wrap items-baseline gap-x-3 text-small text-ink-700">
                <span className="tnum w-24 shrink-0 text-ink-500">{dagKort(momentdatum(start, m))}</span>
                <span className="min-w-0 flex-1">{m.title}</span>
                <span className="tnum text-micro text-ink-500">
                  {[
                    m.due_time,
                    tidstext(m.estimate_minutes),
                    m.priority === 3 ? null : PRIORITET_ETIKETT[m.priority as Prioritet],
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ol>
          <p className="text-micro text-ink-500">{mallsammanfattning(vald.moment)}</p>
        </div>
      )}

      <div>
        <Button type="submit" laddar={vantar} disabled={vantar || !vald}>
          Skapa uppgifterna
        </Button>
      </div>
    </form>
  );
}
