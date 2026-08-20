"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { avslutaSjuk, bekraftaSjuk, kvitteraFrist, stallInSjuk, type FranvaroState } from "../actions";

/**
 * Chefens knappar på en sjukanmälan.
 *
 * AC-3.17: bekräftelsen är hela poängen. En anmälan som ingen kvitterar
 * eskalerar efter fristen i `absence_policy` — och den eskaleringen är inte en
 * tillsägelse till chefen utan en försäkring för den sjuke: någon ska ha sett
 * anmälan.
 *
 * K36/E7.10: "Intyg mottaget" kvitterar dag 8-fristen utan att bära filen.
 * Knappen lovar alltså mindre än K36 kräver, och det är avsiktligt — se
 * ROADMAP E7.10.
 */
export function Chefshandlingar({
  id,
  bekraftad,
  avslutad,
  forstaDag,
  idag,
  frister,
}: {
  id: string;
  bekraftad: boolean;
  avslutad: boolean;
  forstaDag: string;
  idag: string;
  frister: { id: string; etikett: string }[];
}) {
  const [bekState, bekAction, bekraftar] = useActionState<FranvaroState, FormData>(bekraftaSjuk, {});
  const [fristState, fristAction] = useActionState<FranvaroState, FormData>(kvitteraFrist, {});
  const [slutState, slutAction, avslutar] = useActionState<FranvaroState, FormData>(avslutaSjuk, {});
  const [inState, inAction] = useActionState<FranvaroState, FormData>(stallInSjuk, {});

  const fel = bekState.fel ?? fristState.fel ?? slutState.fel ?? inState.fel;
  const ok = bekState.ok ?? fristState.ok ?? slutState.ok ?? inState.ok;

  return (
    <div className="mt-3 flex flex-col gap-3">
      {fel && <Notis ton="danger">{fel}</Notis>}
      {ok && <Notis ton="ok">{ok}</Notis>}

      <div className="flex flex-wrap items-center gap-2">
        {!bekraftad && (
          <form action={bekAction}>
            <input type="hidden" name="id" value={id} />
            <Button type="submit" size="sm" laddar={bekraftar}>
              Bekräfta mottagen
            </Button>
          </form>
        )}

        {frister.map((f) => (
          <form key={f.id} action={fristAction}>
            <input type="hidden" name="id" value={f.id} />
            <Button type="submit" size="sm" variant="sekundar">
              {f.etikett} klar
            </Button>
          </form>
        ))}

        <form action={inAction}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit" size="sm" variant="diskret">
            Ställ in anmälan
          </Button>
        </form>
      </div>

      {!avslutad && (
        <form action={slutAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={id} />
          {/* Rakt <input> och inte <Input>: den senare satter id fran `namn`,
              och flera anmalningar pa samma sida hade da delat id. */}
          <label htmlFor={`sista_dag_${id}`} className="flex flex-col gap-1">
            <span className="text-micro text-ink-500">Sista sjukdagen</span>
            <input
              id={`sista_dag_${id}`}
              name="sista_dag"
              type="date"
              min={forstaDag}
              max={idag}
              className={`${KONTROLL} max-w-44`}
            />
          </label>
          <Button type="submit" size="sm" variant="sekundar" laddar={avslutar}>
            Avsluta perioden
          </Button>
        </form>
      )}
    </div>
  );
}
