"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { Card, CardHeader } from "@/components/ui/Card";
import { beslutaAnsokan, draTillbaka, stallInLedighet, type FranvaroState } from "../actions";

/**
 * Chefens beslut, plus de två enkla vägarna bort från en ansökan.
 *
 * AC-3.12 och AC-3.13: både ett avslag och ett godkännande som överstyr en
 * regel kräver en motivering. Rutan under knapparna byter etikett efter vilket
 * av de två som gäller, för det är två olika saker att skriva: varför det inte
 * går, respektive varför det går ändå.
 *
 * K35: rutan handlar om BESLUTET mot regeln, aldrig om personen. Hjälptexten
 * säger det rakt ut, eftersom det är den enda plats i hela modulen där någon
 * kan skriva fritt om en annan människa.
 */
export function Beslutspanel({
  id,
  brutna,
  lageDra = false,
  lageInstall = false,
}: {
  id: string;
  brutna: string[];
  lageDra?: boolean;
  lageInstall?: boolean;
}) {
  const [beslutState, beslutAction, beslutar] = useActionState<FranvaroState, FormData>(
    beslutaAnsokan,
    {},
  );
  const [draState, draAction, drar] = useActionState<FranvaroState, FormData>(draTillbaka, {});
  const [stallState, stallAction, staller] = useActionState<FranvaroState, FormData>(
    stallInLedighet,
    {},
  );
  const [beslut, setBeslut] = useState<"godkann" | "avsla">("godkann");

  if (lageDra) {
    return (
      <form action={draAction} className="flex flex-col gap-3">
        {draState.fel && <Notis ton="danger">{draState.fel}</Notis>}
        {draState.ok && <Notis ton="ok">{draState.ok}</Notis>}
        <input type="hidden" name="id" value={id} />
        <Button type="submit" size="sm" variant="sekundar" laddar={drar}>
          Dra tillbaka ansökan
        </Button>
      </form>
    );
  }

  if (lageInstall) {
    return (
      <form action={stallAction} className="flex flex-col gap-3">
        {stallState.fel && <Notis ton="danger">{stallState.fel}</Notis>}
        {stallState.ok && <Notis ton="ok">{stallState.ok}</Notis>}
        <input type="hidden" name="id" value={id} />
        <Button type="submit" size="sm" variant="sekundar" laddar={staller}>
          Ställ in ledigheten
        </Button>
      </form>
    );
  }

  const kraverMotivering = beslut === "avsla" || brutna.length > 0;

  return (
    <Card status="brand">
      <CardHeader
        titel="Ditt beslut"
        beskrivning={
          brutna.length > 0
            ? "Ansökan bryter mot minst en regel. Godkänner du den måste du skriva varför."
            : "Ansökan följer reglerna."
        }
      />

      <form action={beslutAction} className="flex flex-col gap-4">
        {beslutState.fel && <Notis ton="danger">{beslutState.fel}</Notis>}
        {beslutState.ok && <Notis ton="ok">{beslutState.ok}</Notis>}

        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="beslut" value={beslut} />

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-small font-semibold text-ink-700">Beslut</legend>
          {(
            [
              ["godkann", "Godkänn ledigheten"],
              ["avsla", "Avslå ansökan"],
            ] as const
          ).map(([varde, text]) => (
            <label key={varde} className="flex items-center gap-3">
              <input
                type="radio"
                name="val"
                value={varde}
                checked={beslut === varde}
                onChange={() => setBeslut(varde)}
                className="size-5"
              />
              <span className="text-body text-ink-900">{text}</span>
            </label>
          ))}
        </fieldset>

        <Field
          label={beslut === "avsla" ? "Varför avslås ansökan?" : "Varför godkänns den trots reglerna?"}
          namn="motivering"
          hjalp={
            kraverMotivering
              ? "Den anställda ser texten. Skriv om beslutet och reglerna — aldrig om någons hälsa eller privatliv."
              : "Frivilligt när ansökan följer reglerna."
          }
        >
          <textarea
            id="motivering"
            name="motivering"
            rows={3}
            required={kraverMotivering}
            className={KONTROLL}
            placeholder={
              beslut === "avsla"
                ? "Till exempel: tre i teamet är redan lediga den veckan."
                : "Till exempel: bemanningen löses med vikarie."
            }
          />
        </Field>

        <div>
          <Button type="submit" laddar={beslutar} variant={beslut === "avsla" ? "sekundar" : "primar"}>
            {beslut === "avsla" ? "Avslå" : "Godkänn"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
