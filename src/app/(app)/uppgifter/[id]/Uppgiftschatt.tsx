"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Notis } from "@/components/ui/Notis";
import { Skrivfalt, Trad, type Replik } from "../Chattrad";
import { kommentera, type UppgiftState } from "../actions";

/**
 * Samtalet i en uppgift.
 *
 * ===========================================================================
 * SAMMA TRÅD SOM PROJEKTET, MEN UTAN LÄSMARKERING
 *
 * Replikerna är rader i `task_event` med typen `kommentar` — de har bott där
 * sedan 0054 och gör det fortfarande. Det som ändrades 2026-09-11 är att de
 * inte längre ritas MITT I historiken, mellan "Påbörjad" och "Godkänd".
 *
 * Det var fel av ett skäl som är lätt att missa: historiken är ett protokoll
 * och läses uppifrån, medan ett samtal läses nedifrån och besvaras. Att blanda
 * dem gjorde båda sämre — man letade efter det senast sagda mellan
 * systemhändelser, och beslutsgången bröts av småprat.
 *
 * Nu är det två ytor. Historiken svarar på "vad har hänt med den här
 * uppgiften", samtalet på "vad säger vi om den".
 *
 * INGEN LÄSMARKERING HÄR. Uppgiftens repliker notifieras per replik
 * (`uppgift-kommentar` i 0047) eftersom en uppgift har en liten och utpekad
 * krets — det är ett meddelande till namngivna personer, inte ett rum. Ett
 * projekt kan ha tio deltagare och femtio repliker, och där hade det blivit
 * outhärdligt; se rubriken i 0055.
 * ===========================================================================
 */
export function Uppgiftschatt({
  id,
  repliker,
  mig,
}: {
  id: string;
  repliker: Replik[];
  mig: string;
}) {
  const [state, action, vantar] = useActionState<UppgiftState, FormData>(kommentera, {});
  const [text, setText] = useState("");

  const faltet = useRef<HTMLTextAreaElement>(null);
  const formularet = useRef<HTMLFormElement>(null);

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
        repliker={repliker}
        mig={mig}
        tomRubrik="Inga repliker än."
        tomText="Skriv till de andra i uppgiften — den som är ansvarig, den som la upp den och de inbjudna får ett besked."
        hog={false}
      />

      <form ref={formularet} action={action} className="mt-3 flex flex-col gap-2">
        {state.fel && <Notis ton="danger">{state.fel}</Notis>}
        <input type="hidden" name="id" value={id} />

        {/*
          Fältet heter `body` i `Skrivfalt` men `kommentera()` läser `note`.
          Det dolda fältet speglar värdet i stället för att döpa om något:
          `note` är kolumnnamnet i `task_event` och ska heta så hela vägen, och
          `body` är chattens namn och ska heta så i den delade komponenten.
        */}
        <input type="hidden" name="note" value={text} />

        <Skrivfalt
          faltet={faltet}
          formularet={formularet}
          text={text}
          setText={setText}
          vantar={vantar}
          placeholder="Skriv till de andra i uppgiften…"
        />

        <p className="text-micro text-ink-300">
          Enter skickar, Skift + Enter ger en ny rad. Alla i uppgiften får en notis.
        </p>
      </form>
    </div>
  );
}
