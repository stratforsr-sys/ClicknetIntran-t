"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { STEG_ETIKETT, type Steg } from "@/lib/rekrytering";
import { sparaScorecard, type RekryteringState } from "../actions";

const TOM: RekryteringState = {};

/**
 * AC-7.6. Ett omdome om en intervju.
 *
 * Tre lagen och ingen skala. En skala 1-10 inbjuder till medelvarden, och ett
 * medelvarde av tva intervjuer sager mindre an tva tydliga omdomen som gar isar
 * — vilket ar hela skalet att kraven pa scorecard finns.
 *
 * Fyller samma person i steget igen rattas det befintliga omdomet (upsert i
 * actionen). Tva rader fran samma person om samma intervju ar inte tva
 * omdomen.
 */
export function Scorecardformular({ id, steg }: { id: string; steg: Steg }) {
  const [state, skicka, vantar] = useActionState(sparaScorecard, TOM);

  return (
    <form action={skicka} className="flex flex-col gap-4 border-t border-canvas pt-6">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="steg" value={steg} />

      <h3 className="text-small font-semibold text-ink-700">
        Din scorecard för {STEG_ETIKETT[steg].toLowerCase()}
      </h3>

      {state.fel && <Notis ton="danger">{state.fel}</Notis>}

      <Field label="Rekommendation" namn="rekommendation">
        <select id="rekommendation" name="rekommendation" className={KONTROLL} defaultValue="">
          <option value="" disabled>
            Välj
          </option>
          <option value="yes">Ja — gå vidare</option>
          <option value="maybe">Tveksam</option>
          <option value="no">Nej</option>
        </select>
      </Field>

      <Field
        label="Styrkor"
        namn="styrkor"
        hjalp="Vad talade för? Skriv inget personnummer — navet lagrar inga (K27)."
      >
        <textarea id="styrkor" name="styrkor" rows={2} className={KONTROLL} />
      </Field>

      <Field label="Tveksamheter" namn="tveksamheter">
        <textarea id="tveksamheter" name="tveksamheter" rows={2} className={KONTROLL} />
      </Field>

      <div>
        <Button type="submit" laddar={vantar}>
          Spara scorecard
        </Button>
      </div>
    </form>
  );
}
