"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { nyKandidat, type RekryteringState } from "../actions";

const TOM: RekryteringState = {};

export function Nykandidatformular({ kallor }: { kallor: { slug: string; label: string }[] }) {
  const [state, skicka, vantar] = useActionState(nyKandidat, TOM);

  if (kallor.length === 0) {
    return (
      <div className="flex flex-col gap-4 pt-2">
        <h1 className="text-display text-ink-900">Ny kandidat</h1>
        <Card>
          <EmptyState
            rubrik="Du har inte behörighet till rekrytering"
            text="Modulen är öppen för säljchef, VD och administratör, samt för den som fått behörigheten Rekryterare tilldelad under Personal."
          />
        </Card>
      </div>
    );
  }

  return (
    <form action={skicka} className="flex flex-col gap-4 pt-2">
      <div>
        <h1 className="text-display text-ink-900">Ny kandidat</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Fyll i det du vet. Kandidaten hamnar på steget <strong>Ny</strong> och flyttas därifrån.
        </p>
      </div>

      {state.fel && <Notis ton="danger">{state.fel}</Notis>}

      <Card className="flex flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Förnamn" namn="fornamn">
            <input id="fornamn" name="fornamn" required className={KONTROLL} />
          </Field>
          <Field label="Efternamn" namn="efternamn">
            <input id="efternamn" name="efternamn" required className={KONTROLL} />
          </Field>
          <Field label="E-post" namn="epost">
            <input id="epost" name="epost" type="email" required className={KONTROLL} />
          </Field>
          <Field
            label="Telefon"
            namn="telefon"
            hjalp="Eget fält med flit — skriv inte numret i anteckningen."
          >
            <input id="telefon" name="telefon" type="tel" className={KONTROLL} />
          </Field>
        </div>

        {/*
          Kallan ar obligatorisk. Den gar inte att rekonstruera i efterhand, och
          utan den ar trattrapporten (AC-7.10) en tabell med en enda rad.
        */}
        <Field
          label="Varifrån kom ansökan?"
          namn="kalla"
          hjalp="Går inte att fylla i i efterhand — trattrapporten bygger på den."
        >
          <select id="kalla" name="kalla" required className={KONTROLL} defaultValue="">
            <option value="" disabled>
              Välj källa
            </option>
            {kallor.map((k) => (
              <option key={k.slug} value={k.slug}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Roll" namn="roll">
          <input id="roll" name="roll" defaultValue="Säljare" className={KONTROLL} />
        </Field>

        <Field
          label="Anteckning"
          namn="anteckning"
          hjalp="Inget personnummer — navet lagrar inga (K27), och raden nekas av databasen."
        >
          <textarea id="anteckning" name="anteckning" rows={3} className={KONTROLL} />
        </Field>

        <div>
          <Button type="submit" laddar={vantar}>
            Lägg upp kandidaten
          </Button>
        </div>
      </Card>
    </form>
  );
}
