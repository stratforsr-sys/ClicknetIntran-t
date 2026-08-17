"use client";

import { useActionState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Notis } from "@/components/ui/Notis";
import { Losenordsruta } from "@/components/ui/Losenordsruta";
import { aterstallLosenord, type LosenordState } from "../actions";

/**
 * Chefens vag in nar nagon star utanfor sitt konto. Sa lange navet inte mejlar
 * finns ingen sjalvbetjaning: "glomt losenord" kraver ett utskick.
 */
export function Inloggningskort({ anstalldId, namn }: { anstalldId: string; namn: string }) {
  const [state, action, vantar] = useActionState<LosenordState, FormData>(aterstallLosenord, {});

  return (
    <Card>
      <CardHeader
        titel="Inloggning"
        beskrivning="Navet skickar ingen e-post än. Lösenordet lämnas över personligen."
      />

      {state.fel && <Notis ton="danger">{state.fel}</Notis>}

      {state.losenord ? (
        <Losenordsruta losenord={state.losenord} namn={namn} />
      ) : (
        <form action={action} className="flex flex-col gap-3">
          <p className="max-w-[70ch] text-small text-ink-500">
            Sätter ett nytt tillfälligt lösenord. Det gamla slutar gälla direkt, och ordet visas
            en enda gång. Att det byttes hamnar i loggen — själva lösenordet gör det aldrig.
          </p>
          <input type="hidden" name="employee_id" value={anstalldId} />
          <div>
            <Button type="submit" variant="sekundar" size="sm" laddar={vantar}>
              Sätt nytt lösenord
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
