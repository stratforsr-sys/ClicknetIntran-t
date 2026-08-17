"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { Ikon } from "@/components/shell/Ikon";
import { skapaArende, type ArendeState } from "../actions";

type Kategori = { id: string; label: string; sla_hours: number; default_confidential: boolean };

export function NyttArende({ kategorier }: { kategorier: Kategori[] }) {
  const [state, action, vantar] = useActionState<ArendeState, FormData>(skapaArende, {});
  const [vald, setVald] = useState(kategorier[0]?.id ?? "other");

  const kategori = kategorier.find((k) => k.id === vald);
  const timmar = kategori?.sla_hours ?? 48;

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href="/arenden"
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Tillbaka till ärenden
      </Link>

      <div>
        <h1 className="text-display text-ink-900">Nytt ärende</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Frågan hamnar hos säljchefen med en utlovad svarstid. Du ser hela dialogen och när den
          senast ska vara besvarad.
        </p>
      </div>

      <Card className="max-w-[46rem]">
        <form action={action} className="flex flex-col gap-5">
          {state.fel && <Notis ton="danger">{state.fel}</Notis>}

          <Field label="Vad gäller det?" namn="kategori" hjalp={`Svar utlovas inom ${timmar} timmar.`}>
            <Select
              namn="kategori"
              value={vald}
              onChange={(e) => setVald(e.target.value)}
            >
              {kategorier.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Rubrik" namn="rubrik">
            <Input namn="rubrik" required autoComplete="off" placeholder="Kort sammanfattning" />
          </Field>

          <Field label="Beskrivning" namn="text">
            <textarea
              id="text"
              name="text"
              required
              rows={6}
              className={KONTROLL}
              placeholder="Skriv så mycket du vill. Ingen annan än du och ledningen ser det här."
            />
          </Field>

          {/* Konflikt och arbetsmiljo forvaljs som konfidentiella. Forvalet ar
              en hjalp, inte ett beslut — den som skriver far andra. */}
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              name="konfidentiellt"
              value="1"
              defaultChecked={kategori?.default_confidential}
              key={vald}
              className="mt-1 size-5 rounded-xs"
            />
            <span>
              <span className="block text-body text-ink-900">Konfidentiellt</span>
              <span className="block text-small text-ink-500">
                Syns endast för säljchef och VD. Varken teamledare eller administratör kommer åt
                ärendet.
              </span>
            </span>
          </label>

          <div className="mt-2 flex items-center gap-3">
            <Button type="submit" laddar={vantar}>
              Skicka ärende
            </Button>
            <Link href="/arenden" className="text-small font-semibold text-ink-500 hover:text-ink-900">
              Avbryt
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
}
