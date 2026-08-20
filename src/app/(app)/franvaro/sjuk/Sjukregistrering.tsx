"use client";

import { useActionState, useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { avslutaSjuk, registreraSjuk, type FranvaroState } from "../actions";

/**
 * Registrering EFTER samtalet (AC-3.6, AC-3.27).
 *
 * ===========================================================================
 * K35, AC-3.21: FORMULÄRET HAR TRE FÄLT OCH INGET AV DEM ÄR FRITEXT.
 *
 * Första sjukdagen, omfattningen, och vem samtalet gick till. Det finns inget
 * "meddelande till chefen"-fält och det ska inte läggas till: rutan skulle
 * fyllas med precis det K35 förbjuder, och den skulle fyllas i god tro av
 * någon som ville vara hjälpsam.
 * ===========================================================================
 *
 * Första sjukdagen står som ett eget fält och inte som "i dag". AC-3.16: den
 * som blir sjuk på lördagen och ringer på måndagen har varit sjuk sedan
 * lördagen, och fristerna i K37 räknas därifrån.
 */
export function Sjukregistrering({
  pagaende,
  mottagare,
  idag,
}: {
  pagaende: { id: string; forstaDag: string; omfattning: number; bekraftad: boolean } | null;
  mottagare: { vem: string; vad: string }[];
  idag: string;
}) {
  const [state, action, vantar] = useActionState<FranvaroState, FormData>(registreraSjuk, {});
  const [friskState, friskAction, avslutar] = useActionState<FranvaroState, FormData>(
    avslutaSjuk,
    {},
  );
  const [forstaDag, setForstaDag] = useState(idag);

  if (pagaende) {
    return (
      <Card status="info">
        <CardHeader
          titel="Du är sjukanmäld"
          beskrivning={`Sedan ${pagaende.forstaDag}${pagaende.omfattning < 100 ? `, ${pagaende.omfattning} procent` : ""}.`}
        />

        <p className="text-body text-ink-500">
          {pagaende.bekraftad
            ? "Din chef har bekräftat anmälan."
            : "Anmälan väntar på att din chef bekräftar den."}
        </p>

        <form action={friskAction} className="mt-5 flex flex-col gap-4">
          {friskState.fel && <Notis ton="danger">{friskState.fel}</Notis>}
          {friskState.ok && <Notis ton="ok">{friskState.ok}</Notis>}

          <input type="hidden" name="id" value={pagaende.id} />

          <Field
            label="Sista sjukdagen"
            namn="sista_dag"
            hjalp="Dagen innan du var tillbaka i arbete."
          >
            <Input
              namn="sista_dag"
              type="date"
              required
              defaultValue={idag}
              min={pagaende.forstaDag}
              max={idag}
            />
          </Field>

          <div>
            <Button type="submit" laddar={avslutar}>
              Anmäl frisk
            </Button>
          </div>
        </form>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        titel="Registrera efter samtalet"
        beskrivning="Fyll i det här när du har ringt, inte i stället för att ringa."
      />

      <form action={action} className="flex flex-col gap-5">
        {state.fel && <Notis ton="danger">{state.fel}</Notis>}
        {state.ok && <Notis ton="ok">{state.ok}</Notis>}

        <Field
          label="Första sjukdagen"
          namn="forsta_dag"
          hjalp="Den dag du blev sjuk — inte den dag du ringde. Fristerna räknas därifrån."
        >
          <Input
            namn="forsta_dag"
            type="date"
            required
            value={forstaDag}
            max={idag}
            onChange={(e) => setForstaDag(e.target.value)}
          />
        </Field>

        <Field
          label="Omfattning"
          namn="omfattning"
          hjalp="Hur stor del av din arbetstid. Uppgift om arbetstid, inget annat."
        >
          <Select namn="omfattning" defaultValue="100">
            <option value="100">Hela dagen</option>
            <option value="75">75 procent</option>
            <option value="50">Halva dagen</option>
            <option value="25">25 procent</option>
          </Select>
        </Field>

        {mottagare.length > 0 && (
          <div className="rounded-sm bg-canvas px-4 py-3">
            <p className="text-small font-semibold text-ink-700">Ringde du?</p>
            <p className="mt-1 text-small text-ink-500">
              Registreringen ersätter inte samtalet. Har du inte ringt än — gör det först, listan
              står överst på sidan.
            </p>
          </div>
        )}

        <div>
          <Button type="submit" laddar={vantar}>
            Registrera sjukanmälan
          </Button>
        </div>

        {/* K35 utskrivet for den som fyller i. Ett lofte som star i
            granssnittet ar lattare att halla an ett som bara star i en PRD. */}
        <p className="text-micro text-ink-500">
          Navet registrerar aldrig varför du är sjuk. Ingen orsak, ingen diagnos, inga symtom — det
          finns inget fält för det och ingen kolumn i databasen att spara det i.
        </p>
      </form>
    </Card>
  );
}
