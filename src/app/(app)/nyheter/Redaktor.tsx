"use client";

import { useActionState, useState } from "react";
import dynamicImport from "next/dynamic";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { ROLES, ROLE_LABEL } from "@/lib/roles";
import { skapaNyhet, type NyhetState } from "./actions";

// Markdown-parsern ar 48 kB och behovs forst nar nagon trycker
// Forhandsgranska. Samma val som i rutinredaktoren.
const Forhandsvisning = dynamicImport(() => import("../rutiner/Forhandsvisning"), { ssr: false });

const TOM: NyhetState = {};

/**
 * AC-11.2. Ett inlagg, en malgrupp, ett tryck.
 *
 * Malgruppen ar kryssrutor och inte en flervalslista: den som skriver ska se
 * hela mottagarkretsen samtidigt utan att scrolla i en <select>, for det ar
 * det enda valet i formularet som inte gar att gora ogjort efter publicering.
 *
 * Ingen ruta ikryssad = alla. Det star utskrivet under rutorna i stallet for
 * att losas med en "Alla"-ruta som styr de andra — en sadan ruta har tre
 * lagen i praktiken, och det tredje forklarar ingen.
 */
export function Redaktor({ team }: { team: { id: string; name: string }[] }) {
  const [state, skicka, vantar] = useActionState(skapaNyhet, TOM);
  const [text, setText] = useState("");
  const [visar, setVisar] = useState(false);
  const [roller, setRoller] = useState<string[]>([]);
  const [valdaTeam, setValdaTeam] = useState<string[]>([]);

  const vaxla = (lista: string[], satt: (v: string[]) => void, varde: string) =>
    satt(lista.includes(varde) ? lista.filter((v) => v !== varde) : [...lista, varde]);

  const narAlla = roller.length === 0 && valdaTeam.length === 0;

  return (
    <form action={skicka} className="flex flex-col gap-4 pt-2">
      <div>
        <h1 className="text-display text-ink-900">Nytt inlägg</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Ett publicerat inlägg dyker upp i klockan hos alla i målgruppen. Spara
          som utkast om du vill läsa igenom det en gång till först.
        </p>
      </div>

      {state.fel && <Notis ton="danger">{state.fel}</Notis>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="flex flex-col gap-4">
          <Field label="Rubrik" namn="rubrik">
            <Input namn="rubrik" required maxLength={140} placeholder="Nya provisionsregler från 1 september" />
          </Field>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor="text" className="text-small font-semibold text-ink-700">
                Innehåll
              </label>
              <button
                type="button"
                onClick={() => setVisar((v) => !v)}
                className="text-small font-semibold text-brand-700 hover:text-brand-900"
              >
                {visar ? "Redigera" : "Förhandsgranska"}
              </button>
            </div>

            {visar ? (
              <div className="min-h-[18rem] max-w-[70ch] rounded-sm bg-surface p-4 shadow-elev-1">
                <Forhandsvisning text={text} />
              </div>
            ) : (
              <textarea
                id="text"
                name="text"
                required
                rows={14}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={"Skriv med markdown.\n\n## Rubrik\n- Punkt\n**Fet text**"}
                className={`${KONTROLL} font-mono-data resize-y`}
              />
            )}
            {/* Textrutan doljs vid forhandsgranskning, och ett dolt falt
                skickas inte in av webblasaren. Varde far darfor foljas med. */}
            {visar && <input type="hidden" name="text" value={text} />}
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader titel="Målgrupp" />
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">Roller</legend>
              {ROLES.map((r) => (
                <label key={r} className="flex min-h-11 items-center gap-3 text-body text-ink-900">
                  <input
                    type="checkbox"
                    name="roller"
                    value={r}
                    checked={roller.includes(r)}
                    onChange={() => vaxla(roller, setRoller, r)}
                    className="size-5 rounded-xs accent-brand-700"
                  />
                  {ROLE_LABEL[r]}
                </label>
              ))}
            </fieldset>

            {team.length > 0 && (
              <fieldset className="mt-4 flex flex-col gap-2 border-t border-canvas pt-4">
                <legend className="text-small font-semibold text-ink-700">Team</legend>
                {team.map((t) => (
                  <label key={t.id} className="flex min-h-11 items-center gap-3 text-body text-ink-900">
                    <input
                      type="checkbox"
                      name="team"
                      value={t.id}
                      checked={valdaTeam.includes(t.id)}
                      onChange={() => vaxla(valdaTeam, setValdaTeam, t.id)}
                      className="size-5 rounded-xs accent-brand-700"
                    />
                    {t.name}
                  </label>
                ))}
              </fieldset>
            )}

            <p className="mt-4 text-small text-ink-500">
              {narAlla
                ? "Ingen ruta ikryssad: inlägget når alla i navet."
                : "Bara den som matchar det du kryssat i ser inlägget."}
            </p>
          </Card>

          <Card>
            <CardHeader titel="Publicering" />
            <label className="flex min-h-11 items-center gap-3 text-body text-ink-900">
              <input type="checkbox" name="pinned" value="1" className="size-5 rounded-xs accent-brand-700" />
              Fäst överst
            </label>
            <p className="mt-1 text-small text-ink-500">
              För besked som ska stå kvar tills de inte behövs längre.
            </p>

            <div className="mt-5 flex flex-col gap-2">
              <Button type="submit" name="publicera" value="1" laddar={vantar}>
                Publicera
              </Button>
              <Button type="submit" name="publicera" value="0" variant="sekundar" laddar={vantar}>
                Spara som utkast
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </form>
  );
}
