"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { cn } from "@/components/ui/cn";
import { DELNINGSNIVAER, GRUNDNIVA, NIVA_ETIKETT, type Delningsniva } from "@/lib/kalender";
import { stallInDelning, type KalenderState } from "../actions";

/**
 * Panelen som sätter nivåer.
 *
 * =============================================================================
 * ETT FORMULÄR PER PERSON, INTE ETT FÖR HELA LISTAN
 *
 * Ett gemensamt "Spara" hade betytt att den som höjer en person till delegat
 * samtidigt skickar om allas nivåer — och varje omskickad nivå som råkar vara
 * oförändrad är en notis som nästan skickades. Samma resonemang som
 * `Egenskaper.tsx` i uppgiftsmodulen drog 2026-09-11 när tre formulär blev tre
 * och inte ett: att byta ansvarig är ett besked till en människa, att flytta ett
 * datum är det inte.
 *
 * Här är VARJE ändring ett besked till en människa, så varje ändring är sitt
 * eget formulär.
 *
 * Nivån skickas som ett `<select>` plus en knapp och inte som en `onChange` som
 * postar av sig själv. Det är medvetet trögare: att av misstag råka bläddra
 * förbi "Delegat" i en lista ska inte ge bort rätten att arbeta i ens namn.
 * =============================================================================
 */
export function Delningspanel({
  kollegor,
  nuvarande,
}: {
  kollegor: { id: string; namn: string }[];
  nuvarande: { employee_id: string; namn: string; niva: Delningsniva }[];
}) {
  if (kollegor.length === 0) {
    return (
      <p className="text-small text-ink-500">
        Du ser inga kollegor i registret, så det finns ingen att dela med. Personalregistret styr
        vem som går att välja här — se <code>employee_read</code> i 0001.
      </p>
    );
  }

  const niva = (id: string): Delningsniva | typeof GRUNDNIVA =>
    nuvarande.find((n) => n.employee_id === id)?.niva ?? GRUNDNIVA;

  return (
    <ul className="flex flex-col gap-2">
      {kollegor.map((k) => (
        <Rad key={k.id} id={k.id} namn={k.namn} niva={niva(k.id)} />
      ))}
    </ul>
  );
}

function Rad({ id, namn, niva }: { id: string; namn: string; niva: Delningsniva }) {
  const [state, action, vantar] = useActionState<KalenderState, FormData>(stallInDelning, {});

  const delad = niva !== GRUNDNIVA;

  return (
    <li className="flex flex-col gap-2 rounded-sm bg-canvas px-3 py-3">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="employee_id" value={id} />

        <span className="min-w-0 flex-1">
          <span className="block text-body text-ink-900">{namn}</span>
          {delad && <span className="block text-small text-brand-700">{NIVA_ETIKETT[niva]}</span>}
        </span>

        {/*
          NATIVT `select` OCH INTE `Field`/`Select` FRÅN UI-BIBLIOTEKET.
          De två sätter `id` och `name` till samma sträng, vilket är riktigt för
          ett formulär per sida och omöjligt här: fältet måste heta `level` i
          varje rad för att server action ska hitta det, medan `id` måste vara
          unikt för att etiketten ska peka rätt. `KONTROLL` är exporterad ur
          Field.tsx just för de fallen — se rubriken där.
        */}
        <span className="flex flex-col gap-1.5">
          <label htmlFor={`niva-${id}`} className="text-small font-semibold text-ink-700">
            Nivå
          </label>
          <select
            id={`niva-${id}`}
            name="level"
            defaultValue={niva}
            className={cn(KONTROLL, "min-w-56 appearance-none pr-10")}
          >
            {DELNINGSNIVAER.map((n) => (
              <option key={n} value={n}>
                {NIVA_ETIKETT[n]}
              </option>
            ))}
          </select>
        </span>

        <Button type="submit" variant="sekundar" size="sm" laddar={vantar}>
          Spara
        </Button>
      </form>

      {state.fel && (
        <p role="alert" className="text-small text-danger-ink">
          {state.fel}
        </p>
      )}
      {state.ok && <p className="text-small text-ok-ink">{state.ok}</p>}
    </li>
  );
}
