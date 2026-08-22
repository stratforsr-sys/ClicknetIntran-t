"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { EMPLOYMENT_TYPE_LABEL } from "@/lib/roles";
import { VARIABLER, hittaPlatshallare, okandaPlatshallare, trasigaKlamrar } from "@/lib/avtal";
import { sparaMall, type AvtalState } from "../actions";

const TOM: AvtalState = {};

/**
 * E9.1. Mallredigeraren.
 *
 * Faltlistan star bredvid texten och gar att klicka in. Att skriva
 * {{manadslon}} for hand ar den enda platsen dar ett stavfel kostar nagot, sa
 * det ska inte behova goras for hand.
 *
 * Kontrollen av okanda falt gors bade har och i server action. Den har ar
 * hjalpen — den visar felet medan man skriver. Den i actions.ts ar sparren, och
 * det ar den som galler: en klientkontroll gar att ga forbi.
 */
export function Redaktor({
  mall,
}: {
  mall?: { id: string; title: string; body_md: string; employment_type: string | null };
}) {
  const [state, skicka, vantar] = useActionState(sparaMall, TOM);
  const [text, setText] = useState(mall?.body_md ?? "");

  const anvanda = hittaPlatshallare(text);
  const okanda = okandaPlatshallare(text);
  const trasigt = trasigaKlamrar(text);

  function laggTill(nyckel: string) {
    setText((t) => `${t}{{${nyckel}}}`);
  }

  return (
    <form action={skicka} className="flex flex-col gap-4 pt-2">
      <div>
        <h1 className="text-display text-ink-900">{mall ? "Redigera mall" : "Ny avtalsmall"}</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Skriv avtalstexten som vanligt och sätt in fält där uppgiften skiljer
          sig mellan personer. Fälten fylls i när avtalet skapas.
        </p>
      </div>

      {state.fel && <Notis ton="danger">{state.fel}</Notis>}

      {mall && <input type="hidden" name="mall_id" value={mall.id} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="flex flex-col gap-4">
          <Field label="Rubrik" namn="rubrik">
            <Input
              namn="rubrik"
              required
              maxLength={140}
              defaultValue={mall?.title}
              placeholder="Anställningsavtal, tillsvidare"
            />
          </Field>

          <Field
            label="Avtalstext"
            namn="text"
            hjalp="Markdown. Rubriker med #, fetstil med **. Fält skrivs som {{fornamn}}."
          >
            <textarea
              id="text"
              name="text"
              required
              rows={22}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className={`${KONTROLL} font-mono text-small`}
            />
          </Field>

          {trasigt && (
            <Notis ton="warn">
              Det finns en ofullständig platshållare i texten. Varje fält skrivs
              med två klamrar i båda ändar: {"{{fornamn}}"}.
            </Notis>
          )}

          {okanda.length > 0 && (
            <Notis ton="danger">
              Texten använder fält som inte finns: {okanda.join(", ")}. De skulle
              lämna ett hål i avtalet, så mallen går inte att spara så här.
            </Notis>
          )}

          <div>
            <Button type="submit" laddar={vantar} disabled={okanda.length > 0 || trasigt}>
              Spara mallen
            </Button>
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <h2 className="text-h2 text-ink-900">Anställningsform</h2>
            <p className="text-small text-ink-500">
              Styr bara vilken mall som föreslås först. Alla mallar går alltid
              att välja.
            </p>
            <Select namn="anstallningsform" defaultValue={mall?.employment_type ?? ""}>
              <option value="">Alla</option>
              {Object.entries(EMPLOYMENT_TYPE_LABEL).map(([v, etikett]) => (
                <option key={v} value={v}>
                  {etikett}
                </option>
              ))}
            </Select>
          </Card>

          <Card className="flex flex-col gap-3">
            <h2 className="text-h2 text-ink-900">Fält</h2>
            <p className="text-small text-ink-500">
              Klicka för att lägga till sist i texten. Fält märkta{" "}
              <em>ur registret</em> fylls i av navet.
            </p>
            <ul className="flex flex-col gap-1">
              {VARIABLER.map((v) => {
                const anvands = anvanda.includes(v.nyckel);
                return (
                  <li key={v.nyckel}>
                    <button
                      type="button"
                      onClick={() => laggTill(v.nyckel)}
                      className="flex w-full items-baseline justify-between gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-surface-alt"
                    >
                      <code className={`text-small ${anvands ? "text-brand-700" : "text-ink-700"}`}>
                        {`{{${v.nyckel}}}`}
                      </code>
                      <span className="text-micro text-ink-500">
                        {v.fran === "employee" ? "ur registret" : "fylls i"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {/*
              Personnummer star inte i listan, och det ar ett beslut som
              behover forklaras dar nagon letar efter det — annars laggs det
              till i brodtexten for hand.
            */}
            <p className="mt-2 border-t border-canvas pt-3 text-small text-ink-500">
              Det finns inget fält för personnummer. Navet lagrar inga
              personnummer alls, så lämna en rad i texten där det fylls i för
              hand på utskriften.
            </p>
          </Card>
        </div>
      </div>
    </form>
  );
}
