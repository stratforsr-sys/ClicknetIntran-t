"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { skapaTeam, type FormState } from "../actions";

const TOM: FormState = {};

export function NyttTeam() {
  const [state, skicka, vantar] = useActionState(skapaTeam, TOM);

  return (
    <form action={skicka} className="flex flex-col gap-4">
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}

      <Field
        label="Namn"
        namn="namn"
        fel={state.fel}
        hjalp="Teamledare och medlemmar sätter du efteråt."
      >
        <Input namn="namn" required placeholder="Team Nord" fel={state.fel} />
      </Field>

      <div>
        <Button type="submit" laddar={vantar}>
          Skapa team
        </Button>
      </div>
    </form>
  );
}
