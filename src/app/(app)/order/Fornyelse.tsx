"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { avslutaAvtal, type Orderstate } from "./actions";

/**
 * De tva handlingarna som slacker bevakningen av ett avtal.
 *
 * =============================================================================
 * EN HARLEDD PAMINNELSE MASTE HA NAGOT SOM GOR SAKEN GJORD.
 *
 * Posten om ett avtal som narmar sig sitt slut raknas fram ur `ends_on` vid
 * varje lasning (se `notiser.ts` for halvorna). Det ar ratt halva — en
 * paminnelse om nagot ogjort ska inte ga att klicka bort — men det betyder att
 * den tjatar vidare aven efter att samtalet ar ringt, om ingenting bokfors.
 *
 * De tva knapparna ar det nagot, och bestallaren valde bada 2026-09-24.
 * =============================================================================
 *
 * ===========================================================================
 * "FORLANG" AR EN LANK OCH INTE EN KNAPP, och det ar hela skillnaden mellan
 * de tva.
 *
 * Fragan stalldes — vad hander nar kunden forlanger? — och svaret var "en ny
 * order pa kunden", inte "en kvittering". En forlangning ar en AFFAR: den ger
 * provision, den syns i manadens summering, och den har ett eget slutdatum som
 * ska bevakas i sin tur. En knapp som bara tystade posten hade gett en kund som
 * ser forlangd ut utan att en krona bokforts nagonstans.
 *
 * Lanken oppnar darfor det vanliga inmatningsformularet med kundens uppgifter
 * ifyllda — och NAR DEN NYA ORDERN AR LAGD skriver `skapaOrder` kopplingen och
 * slacker den gamla posten. Utfallet och affaren blir samma handelse.
 *
 * "AVSLUTA" AR EN KNAPP MED ETT TEXTFALT, och orsaken ar obligatorisk. Det var
 * ocksa ett uttryckligt val: utan den gar det att rakna hur manga kunder som
 * lamnat, men aldrig se varfor. Villkoret `sales_order_fornyelse_skal` i 0068
 * haller kravet aven for en klient som gar forbi formularet.
 * ===========================================================================
 */
export function Fornyelse({ id, bolag, min }: { id: string; bolag: string; min: boolean }) {
  const [state, kor, vantar] = useActionState<Orderstate, FormData>(avslutaAvtal, {});
  const [oppen, setOppen] = useState(false);

  // Bokfort utfall = posten ar slackt och raden forsvinner vid nasta laddning.
  // Kvittensen star kvar till dess, sa att den som tryckte ser vad som hande.
  if (state.ok) return <Notis ton="ok">{state.ok}</Notis>;

  return (
    <div className="flex flex-col gap-2">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/order?forlang=${id}`}
          className="text-small text-accent-ink underline underline-offset-2"
        >
          Förläng {min ? "" : `${bolag} `}— lägg den nya ordern
        </Link>

        <button
          type="button"
          className="text-small text-ink-500 underline underline-offset-2"
          onClick={() => setOppen((v) => !v)}
        >
          {oppen ? "Avbryt" : "Kunden förlänger inte"}
        </button>
      </div>

      {oppen && (
        <form action={kor} className="flex flex-col gap-2 rounded-sm bg-surface-alt p-3">
          <input type="hidden" name="id" value={id} />
          <label htmlFor={`orsak_${id}`} className="flex flex-col gap-1">
            <span className="text-micro text-ink-500">Varför förlänger kunden inte?</span>
            <input
              id={`orsak_${id}`}
              name="renewal_reason"
              required
              placeholder="Bytte till konkurrent, för dyrt, lade ner verksamheten …"
              className={KONTROLL}
            />
            <span className="text-small text-ink-500">
              Följer med i loggen och blir listan över varför kunder lämnar. Utan den går det att
              räkna hur många som slutat, men aldrig se något mönster.
            </span>
          </label>
          <Button type="submit" variant="destruktiv" laddar={vantar}>
            Bokför att avtalet avslutas
          </Button>
        </form>
      )}
    </div>
  );
}
