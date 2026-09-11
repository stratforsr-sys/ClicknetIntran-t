"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Notis } from "@/components/ui/Notis";
import { Skrivfalt, Trad, type Replik } from "../../Chattrad";
import { markeraProjektchattLast, skrivProjektmeddelande, type UppgiftState } from "../../actions";

/**
 * Projektets chatt.
 *
 * Tråden ritas av `Chattrad.tsx`; det här är rummet runt den — skrivfältet,
 * läsmarkeringen och regeln om vem som får skriva.
 *
 * ===========================================================================
 * LÄSMARKERINGEN SKRIVS NÄR RUTAN VISATS, inte när man skrollat eller skrivit
 *
 * `markeraProjektchattLast()` sätter tidpunkten; `projektchattnotiser()` räknar
 * fram antalet olästa ur den. Det är därför notisen blir "3 nya i Mässan" och
 * inte tre rader i klockan — se rubriken i 0055.
 *
 * Effekten kör också när antalet repliker ändrats, alltså efter att man själv
 * skrivit något. Utan det hade ens egen replik legat kvar som oläst för en
 * själv till nästa besök.
 * ===========================================================================
 */
export function Projektchatt({
  projektId,
  meddelanden,
  seenAt,
  mig,
  kanSkriva,
}: {
  projektId: string;
  meddelanden: Replik[];
  seenAt: string | null;
  mig: string;
  kanSkriva: boolean;
}) {
  const [state, action, vantar] = useActionState<UppgiftState, FormData>(skrivProjektmeddelande, {});
  const [text, setText] = useState("");

  const faltet = useRef<HTMLTextAreaElement>(null);
  const formularet = useRef<HTMLFormElement>(null);

  /**
   * Första olästa repliken.
   *
   * Egna repliker räknas aldrig som olästa — den som just skrivit något har
   * läst det. Utan det villkoret hamnar strecket ovanför ens eget inlägg varje
   * gång man kommer tillbaka, vilket är förvirrande på precis fel sätt.
   */
  const forstaOlasta =
    meddelanden.find((m) => m.author_id !== mig && (!seenAt || m.created_at > seenAt))?.id ?? null;

  useEffect(() => {
    void markeraProjektchattLast(projektId);
  }, [projektId, meddelanden.length]);

  useEffect(() => {
    if (state.ok) {
      setText("");
      const el = faltet.current;
      if (el) {
        el.style.height = "auto";
        el.focus();
      }
    }
  }, [state.ok]);

  return (
    <div className="flex flex-col">
      <Trad
        repliker={meddelanden}
        mig={mig}
        forstaOlasta={forstaOlasta}
        tomRubrik="Ingen har skrivit något än."
        tomText="Här hör samtalet om projektet hemma — frågor, avstämningar och det som inte är en egen uppgift."
      />

      {kanSkriva ? (
        <form ref={formularet} action={action} className="mt-3 flex flex-col gap-2">
          {state.fel && <Notis ton="danger">{state.fel}</Notis>}
          <input type="hidden" name="id" value={projektId} />

          <Skrivfalt
            faltet={faltet}
            formularet={formularet}
            text={text}
            setText={setText}
            vantar={vantar}
            placeholder="Skriv till projektet…"
          />

          <p className="text-micro text-ink-300">
            Enter skickar, Skift + Enter ger en ny rad. Alla i projektet ser det du skriver.
          </p>
        </form>
      ) : (
        <p className="mt-3 text-small text-ink-500">
          Du kan läsa samtalet men inte skriva i det. Be projektets ägare bjuda in dig som redigerare.
        </p>
      )}
    </div>
  );
}
