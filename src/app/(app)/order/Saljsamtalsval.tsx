"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notis } from "@/components/ui/Notis";
import { klockslag, langd } from "@/lib/samtal-vy";
import type { Samtalskandidat } from "@/lib/samtal-order-server";
import { hamtaSamtalskandidater, kopplaSaljsamtal, type Orderstate } from "./actions";

/**
 * "Koppla säljsamtal" på ett utkast eller en inskickad order (2026-10-08).
 *
 * ===========================================================================
 * VARFÖR KNAPPEN FINNS
 *
 * En order går inte vidare utan säljarens eget samtal från Lynes på kundens
 * nummer (`provaSaljsamtal`). Oftast hittas det av sig självt — numret på
 * ordern är numret säljaren ringde. Ibland ringde kunden från en annan
 * telefon, och då vore spärren en återvändsgränd utan den här vägen.
 *
 * Listan hämtas först när knappen trycks. Den är säljarens samtal de senaste
 * 30 dygnen, och en sida med tjugo order ska inte läsa dem för varje rad.
 * ===========================================================================
 */
export function Saljsamtalsval({ id }: { id: string }) {
  const [oppen, setOppen] = useState(false);
  const [laddar, setLaddar] = useState(false);
  const [kandidater, setKandidater] = useState<Samtalskandidat[] | null>(null);
  const [hamtfel, setHamtfel] = useState<string | null>(null);
  const [state, kor, vantar] = useActionState<Orderstate, FormData>(kopplaSaljsamtal, {});

  async function oppna() {
    if (oppen) {
      setOppen(false);
      return;
    }
    setOppen(true);
    setLaddar(true);
    setHamtfel(null);
    const svar = await hamtaSamtalskandidater(id);
    setLaddar(false);
    if ("fel" in svar) setHamtfel(svar.fel);
    else setKandidater(svar.kandidater);
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button type="button" size="sm" variant="diskret" onClick={oppna} laddar={laddar}>
          Koppla säljsamtal
        </Button>
      </div>

      {oppen && !laddar && (
        <div className="flex flex-col gap-2">
          {hamtfel && <Notis ton="danger">{hamtfel}</Notis>}
          {kandidater && kandidater.length === 0 && (
            <Notis ton="info">
              Säljaren har inga samtal på minst fem minuter de senaste 30 dygnen som inte redan hör
              till en annan order.
            </Notis>
          )}
          {kandidater && kandidater.length > 0 && (
            <>
              <p className="text-micro text-ink-500">
                Säljarens samtal på minst fem minuter som inte hör till någon order. Välj det där
                kunden sa ja.
              </p>
              <ul className="flex flex-col gap-1">
                {kandidater.map((k) => (
                  <li key={k.id}>
                    <form action={kor} className="flex flex-wrap items-center gap-2 text-small">
                      <input type="hidden" name="id" value={id} />
                      <input type="hidden" name="samtal_id" value={k.id} />
                      <span className="tabular-nums">{klockslag(k.startedAt)}</span>
                      <span className="tabular-nums">{langd(k.talkSeconds)}</span>
                      <span className="text-ink-500">{k.counterpartE164 ?? "okänt nummer"}</span>
                      {!k.harLjud && <span className="text-micro text-ink-500">utan inspelning</span>}
                      <Button type="submit" size="sm" variant="sekundar" laddar={vantar}>
                        Koppla
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            </>
          )}
          {state.fel && <Notis ton="danger">{state.fel}</Notis>}
          {state.ok && <Notis ton="ok">{state.ok}</Notis>}
        </div>
      )}
    </div>
  );
}
