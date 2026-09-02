"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import {
  avbrytUppgift,
  kvittera,
  lamnaIn,
  paborjaUppgift,
  type CoachState,
} from "../../actions";

/**
 * Knapparna pa en uppgift.
 *
 * VILKA SOM SYNS AVGORS PA SERVERN, inte har. Komponenten far fyra booleaner
 * och ritar det den blir tillsagd — `farKvittera()` och `farAvbryta()` kors i
 * sidan, och samma funktioner kors en gang till i server action. Ett kvitto som
 * bara doldes med CSS ar inget kvitto.
 */
export function Handlingar({
  taskId,
  kanPaborja,
  kanLamnaIn,
  kanKvittera,
  kanAvbryta,
  kraverKommentar,
}: {
  taskId: string;
  kanPaborja: boolean;
  kanLamnaIn: boolean;
  kanKvittera: boolean;
  kanAvbryta: boolean;
  kraverKommentar: boolean;
}) {
  return (
    <div className="flex flex-col gap-5">
      {kanPaborja && <Paborja taskId={taskId} />}
      {kanLamnaIn && <LamnaIn taskId={taskId} kraverKommentar={kraverKommentar} />}
      {kanKvittera && <Kvittera taskId={taskId} kraverKommentar={kraverKommentar} />}
      {kanAvbryta && <Avbryt taskId={taskId} />}
    </div>
  );
}

function Paborja({ taskId }: { taskId: string }) {
  const [state, action, vantar] = useActionState<CoachState, FormData>(paborjaUppgift, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      <input type="hidden" name="task_id" value={taskId} />
      <div>
        <Button type="submit" variant="sekundar" size="sm" laddar={vantar} disabled={vantar}>
          Jag har börjat
        </Button>
      </div>
    </form>
  );
}

function LamnaIn({ taskId, kraverKommentar }: { taskId: string; kraverKommentar: boolean }) {
  const [state, action, vantar] = useActionState<CoachState, FormData>(lamnaIn, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}
      <input type="hidden" name="task_id" value={taskId} />
      <label htmlFor="lamna-note" className="flex flex-col gap-1">
        <span className="text-micro text-ink-500">
          Kommentar{kraverKommentar ? "" : " (valfri)"}
        </span>
        <textarea id="lamna-note" name="note" rows={2} required={kraverKommentar} className={KONTROLL} />
      </label>
      <div>
        <Button type="submit" size="sm" laddar={vantar} disabled={vantar}>
          Lämna in för kvittering
        </Button>
      </div>
    </form>
  );
}

/**
 * Godkant och underkant i SAMMA formular.
 *
 * Bada gar till `kvittera()` med olika `utfall`, eftersom det ar samma handling
 * utford av samma person med samma behorighet. Tva formular hade betytt tva
 * stallen att halla kontrollen lika pa.
 */
function Kvittera({ taskId, kraverKommentar }: { taskId: string; kraverKommentar: boolean }) {
  const [state, action, vantar] = useActionState<CoachState, FormData>(kvittera, {});
  return (
    <form action={action} className="flex flex-col gap-2 border-t border-canvas pt-4">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}
      <input type="hidden" name="task_id" value={taskId} />
      <label htmlFor="kvittera-note" className="flex flex-col gap-1">
        <span className="text-micro text-ink-500">
          Återkoppling{kraverKommentar ? "" : " (krävs vid underkänt)"}
        </span>
        <textarea id="kvittera-note" name="note" rows={2} className={KONTROLL} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="utfall" value="kvitterad" size="sm" laddar={vantar} disabled={vantar}>
          Kvittera som klar
        </Button>
        <Button
          type="submit"
          name="utfall"
          value="underkand"
          variant="sekundar"
          size="sm"
          disabled={vantar}
        >
          Underkänn
        </Button>
      </div>
    </form>
  );
}

function Avbryt({ taskId }: { taskId: string }) {
  const [state, action, vantar] = useActionState<CoachState, FormData>(avbrytUppgift, {});
  return (
    <form action={action} className="flex flex-col gap-2 border-t border-canvas pt-4">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}
      <input type="hidden" name="task_id" value={taskId} />
      <label htmlFor="avbryt-reason" className="flex flex-col gap-1">
        <span className="text-micro text-ink-500">
          {/* Ett avbrott utan skal ar en tyst strykning, och historiken ska ga
              att lasa i efterhand. */}
          Varför uppgiften avbryts
        </span>
        <input id="avbryt-reason" name="reason" required className={KONTROLL} />
      </label>
      <div>
        <Button type="submit" variant="diskret" size="sm" laddar={vantar} disabled={vantar}>
          Avbryt uppgiften
        </Button>
      </div>
    </form>
  );
}
