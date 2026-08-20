"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { MIN_TECKEN } from "@/lib/losenordskrav";
import { bytLosenord, type ProfilState } from "./actions";

const TOM: ProfilState = {};

export function Losenord() {
  const [state, skicka, vantar] = useActionState(bytLosenord, TOM);

  return (
    <form action={skicka} className="flex max-w-md flex-col gap-4">
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}

      <Field label="Nuvarande lösenord" namn="nuvarande">
        <Input namn="nuvarande" type="password" autoComplete="current-password" required />
      </Field>

      <Field
        label="Nytt lösenord"
        namn="nytt"
        hjalp={`Minst ${MIN_TECKEN} tecken. En mening du minns slår ett kort krångligt ord.`}
      >
        <Input
          namn="nytt"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_TECKEN}
        />
      </Field>

      <Field label="Upprepa nytt lösenord" namn="upprepa">
        <Input namn="upprepa" type="password" autoComplete="new-password" required />
      </Field>

      <div>
        <Button type="submit" laddar={vantar}>
          Byt lösenord
        </Button>
      </div>
    </form>
  );
}
