"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Notis } from "@/components/ui/Notis";
// Typimport: order-server.ts ar server-only. Se samma kommentar i Kundkort.tsx.
import type { Crmkopplingsrad } from "@/lib/order-server";
import { synkaTillInkio, type Orderstate } from "./actions";

/**
 * Vad ordern blev i Inkio (0074).
 *
 * En rad: lagets ord, ordernumret som lank och kundnumret som lank. Ett fel
 * star i klartext — det sager vad som ska goras, se `inkio.ts` — och den som
 * far hantera order far en knapp som lagger ordern i utkorgen igen.
 */
const LAGE: Record<Crmkopplingsrad["state"], { ord: string; ton: "ok" | "warn" | "danger" | "neutral" }> = {
  inskickad: { ord: "Inlagd", ton: "ok" },
  utkast: { ord: "Utkast i Inkio", ton: "warn" },
  makulerad: { ord: "Makulerad", ton: "neutral" },
  fel: { ord: "Misslyckades", ton: "danger" },
};

export function Inkioruta({
  orderId,
  crm,
  hanterare,
}: {
  orderId: string;
  crm: Crmkopplingsrad;
  hanterare: boolean;
}) {
  const [state, kor, vantar] = useActionState<Orderstate, FormData>(synkaTillInkio, {});
  const lage = LAGE[crm.state];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body">
        <Badge ton={lage.ton}>{lage.ord}</Badge>
        {crm.orderLank && (
          <a href={crm.orderLank} target="_blank" rel="noreferrer" className="text-brand-ink underline-offset-2 hover:underline">
            {crm.ordernummer ?? "Ordern"} ↗
          </a>
        )}
        {crm.kundLank && (
          <a href={crm.kundLank} target="_blank" rel="noreferrer" className="text-small text-ink-500 underline-offset-2 hover:underline">
            Kund {crm.kundnummer ?? ""} ↗
          </a>
        )}
      </div>

      {crm.state === "utkast" && (
        <p className="text-small text-ink-500">
          Ordern ligger som utkast: det fanns inget avtal eller samtal att skicka med som bevis. Bifoga det och skicka in
          ordern i Inkio.
        </p>
      )}

      {crm.state === "fel" && crm.error && <Notis ton="danger">{crm.error}</Notis>}

      {crm.state === "fel" && hanterare && (
        <form action={kor} className="flex flex-col gap-2">
          <input type="hidden" name="id" value={orderId} />
          <div>
            <Button type="submit" size="sm" variant="sekundar" laddar={vantar}>
              Försök igen
            </Button>
          </div>
          {state.fel && <Notis ton="danger">{state.fel}</Notis>}
          {state.ok && <Notis ton="ok">{state.ok}</Notis>}
        </form>
      )}
    </div>
  );
}
