"use client";

import { useActionState, useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { rapporteraFel, type FelState } from "../actions";

const TOM: FelState = {};

/**
 * E0.6. "Rapportera fel".
 *
 * Ett falt, en kryssruta, en knapp. Allt annat som en buggrapport brukar
 * innehalla — sidan, webblasaren, tidpunkten, vem du ar — vet navet redan och
 * fyller i sjalvt. Det enda en manniska kan bidra med ar vad hon forsokte
 * gora, och det ar darfor det ar det enda hon far fylla i.
 *
 * ===========================================================================
 * SIDAN FYLLS I FRAN FOREGAENDE VY, INTE FRAN DEN HAR.
 *
 * Formularet ligger pa /fel/nytt, sa `location.pathname` har hade sagt
 * "/fel/nytt" pa varenda rapport — alltsa exakt en sokvag, och den enda sida i
 * navet dar felet garanterat inte var.
 *
 * `document.referrer` lases darfor en gang vid montering. Kommer man fran
 * felsidan star digesten i adressen och kopplar ihop rapporten med det navet
 * redan fangat.
 * ===========================================================================
 */
export function Formular({ digest }: { digest: string }) {
  const [state, skicka, vantar] = useActionState(rapporteraFel, TOM);
  const [sida, setSida] = useState("/");
  const [egen, setEgen] = useState(false);

  useEffect(() => {
    try {
      const ref = document.referrer;
      if (!ref) return;
      const url = new URL(ref);
      if (url.origin !== location.origin) return;
      if (url.pathname.startsWith("/fel")) return;
      setSida(url.pathname);
    } catch {
      // Ingen referrer att lasa. Sokvagen blir "/" och rapporten skrivs anda —
      // texten ar det som bar den.
    }
  }, []);

  return (
    <form action={skicka} className="flex flex-col gap-4 pt-2">
      <div>
        <h1 className="text-display text-ink-900">Rapportera fel</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Beskriv vad du försökte göra och vad som hände i stället. Det räcker
          med en mening. Säljchefen och de som förvaltar navet läser det du
          skriver.
        </p>
      </div>

      {state.fel && <Notis ton="danger">{state.fel}</Notis>}

      <Card className="flex max-w-[60ch] flex-col gap-4">
        <Field
          label="Vad hände?"
          namn="text"
          fel={state.fel}
          hjalp="Till exempel: jag skulle godkänna Zens ledighet och knappen gjorde ingenting."
        >
          <textarea
            id="text"
            name="text"
            required
            rows={5}
            maxLength={4000}
            className={KONTROLL}
            aria-describedby={state.fel ? "text-fel" : "text-hjalp"}
          />
        </Field>

        <label className="flex items-start gap-3 text-body text-ink-700">
          <input
            type="checkbox"
            name="blockerande"
            value="1"
            className="mt-1 size-5 shrink-0 accent-brand-600"
          />
          <span>
            Jag kunde inte jobba vidare
            <span className="block text-small text-ink-500">
              Kryssa bara om felet stoppade dig. Rapporter med kryss läggs överst i kön.
            </span>
          </span>
        </label>

        {/* Sidan gar att andra, men behover normalt inte roras. Falten ar
            dolda tills nagon trycker — ett forifyllt tekniskt falt mitt i
            formularet far folk att tro att de gjort nagot fel. */}
        <input type="hidden" name="sida" value={sida} />
        <input type="hidden" name="digest" value={digest} />

        <p className="text-small text-ink-500">
          Skickas med:{" "}
          <code className="rounded-sm bg-surface-alt px-2 py-0.5">{sida}</code>
          {digest && (
            <>
              {" "}
              · felkod <code className="rounded-sm bg-surface-alt px-2 py-0.5">{digest}</code>
            </>
          )}{" "}
          <button
            type="button"
            onClick={() => setEgen(!egen)}
            className="underline underline-offset-2 hover:text-ink-900"
          >
            {egen ? "dölj" : "ändra"}
          </button>
        </p>

        {egen && (
          <Field label="Sidan felet gällde" namn="sida-synlig">
            <input
              id="sida-synlig"
              value={sida}
              onChange={(e) => setSida(e.target.value)}
              className={KONTROLL}
            />
          </Field>
        )}

        <div>
          <Button type="submit" laddar={vantar}>
            Skicka rapporten
          </Button>
        </div>
      </Card>
    </form>
  );
}
