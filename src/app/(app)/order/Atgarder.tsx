"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import type { Orderstatus } from "@/lib/order";
import {
  godkannOrder,
  makuleraOrder,
  raderaUtkast,
  returneraOrder,
  skickaInOrder,
  type Orderstate,
} from "./actions";

/**
 * Atgarderna pa en enskild order.
 *
 * Knapparna ritas efter status, men det ar TRIGGERN i 0034 som avgor vad som
 * faktiskt gar igenom. Samma uppdelning som rekryteringens stegflode: koden
 * ritar, databasen bestammer. Glider de isar faller `tests/order.mjs`.
 *
 * Ingen av knapparna oppnar en `confirm()`-ruta. Makuleringen kraver ett skal i
 * ett textfalt i stallet — det ar bade ett battre skydd mot ett slintat klick
 * och ett svar pa fragan "varfor makulerades den har" ett halvar senare.
 */
export function Atgarder({
  id,
  status,
  hanterare,
  agare,
}: {
  id: string;
  status: Orderstatus;
  hanterare: boolean;
  agare: boolean;
}) {
  const [oppen, setOppen] = useState<"retur" | "makulera" | null>(null);

  if (status === "utkast" && agare) {
    return (
      <div className="flex flex-wrap gap-2">
        <Enkel action={skickaInOrder} id={id} etikett="Skicka in" />
        <Enkel action={raderaUtkast} id={id} etikett="Radera" variant="diskret" />
      </div>
    );
  }

  if (status === "inskickad" && hanterare) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Enkel action={godkannOrder} id={id} etikett="Godkänn" />
          <Button
            type="button"
            size="sm"
            variant="sekundar"
            onClick={() => setOppen(oppen === "retur" ? null : "retur")}
          >
            Skicka tillbaka
          </Button>
        </div>
        {oppen === "retur" && (
          <MedSkal
            action={returneraOrder}
            id={id}
            etikett="Skicka tillbaka"
            platshallare="Vad behöver rättas?"
          />
        )}
      </div>
    );
  }

  if ((status === "signerad" || status === "betald") && hanterare) {
    return (
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          size="sm"
          variant="diskret"
          onClick={() => setOppen(oppen === "makulera" ? null : "makulera")}
        >
          Makulera
        </Button>
        {oppen === "makulera" && (
          <MedSkal
            action={makuleraOrder}
            id={id}
            etikett="Makulera"
            variant="destruktiv"
            platshallare="Varför makuleras ordern?"
            hjalp="Avdraget bokförs i den här månaden, inte i månaden ordern tecknades."
          />
        )}
      </div>
    );
  }

  return null;
}

type Handling = (prev: Orderstate, form: FormData) => Promise<Orderstate>;

function Enkel({
  action,
  id,
  etikett,
  variant = "sekundar",
}: {
  action: Handling;
  id: string;
  etikett: string;
  variant?: "primar" | "sekundar" | "diskret" | "destruktiv";
}) {
  const [state, kor, vantar] = useActionState<Orderstate, FormData>(action, {});

  return (
    <form action={kor} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant={variant} laddar={vantar}>
        {etikett}
      </Button>
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
    </form>
  );
}

function MedSkal({
  action,
  id,
  etikett,
  platshallare,
  hjalp,
  variant = "sekundar",
}: {
  action: Handling;
  id: string;
  etikett: string;
  platshallare: string;
  hjalp?: string;
  variant?: "primar" | "sekundar" | "diskret" | "destruktiv";
}) {
  const [state, kor, vantar] = useActionState<Orderstate, FormData>(action, {});

  return (
    <form action={kor} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <input name="reason" required placeholder={platshallare} className={KONTROLL} />
      {hjalp && <p className="text-small text-ink-500">{hjalp}</p>}
      <div>
        <Button type="submit" size="sm" variant={variant} laddar={vantar}>
          {etikett}
        </Button>
      </div>
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}
    </form>
  );
}
