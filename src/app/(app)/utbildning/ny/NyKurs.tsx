"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { Ikon } from "@/components/shell/Ikon";
import { skapaKurs, type KursState } from "../actions";

const TOM: KursState = {};

/** Bara titeln. Allt annat sätts i redigeringsvyn, dit den här leder vidare. */
export function NyKurs() {
  const [state, skicka, vantar] = useActionState(skapaKurs, TOM);

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href="/utbildning"
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Tillbaka till utbildning
      </Link>

      <div>
        <h1 className="text-display text-ink-900">Ny kurs</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Kursen skapas som utkast. Moduler, prov och målgrupp lägger du till i nästa steg, och
          den syns för ingen förrän du publicerar den.
        </p>
      </div>

      <Card className="max-w-[36rem]">
        <form action={skicka} className="flex flex-col gap-5">
          {state.fel && <Notis ton="danger">{state.fel}</Notis>}

          <Field label="Titel" namn="titel" fel={state.fel}>
            <Input namn="titel" required autoFocus placeholder="Introduktion till försäljning" fel={state.fel} />
          </Field>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" laddar={vantar}>
              Skapa och fortsätt
            </Button>
            <Link href="/utbildning">
              <Button type="button" variant="diskret">
                Avbryt
              </Button>
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
}
