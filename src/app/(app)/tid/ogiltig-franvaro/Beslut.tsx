"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import {
  avvisaHandelse,
  godkannHandelse,
  havHandelse,
  laggUppHandelse,
  type Handelsestate,
} from "./actions";

/**
 * Besluten om ett forslag.
 *
 * GODKANN OCH AVVISA HAR OLIKA TYNGD, och knapparna visar det. Att godkanna ar
 * att pasta att en manniska inte var pa jobbet, och det kraver ett andra klick
 * genom ett falt — samma losning som makuleringen i `order/Atgarder.tsx` fick,
 * och av samma skal: en `confirm()`-ruta skyddar samre och lamnar inget svar pa
 * fragan "varfor" ett halvar senare.
 *
 * Anteckningen ar FRIVILLIG. Bestallarens svar pa fraga 46 var att chefen ska
 * kunna besluta utan att motivera sig. Faltet finns anda, for att den som VILL
 * skriva nagot inte ska behova lagga det nagon annanstans.
 */
export function Beslut({ id, dag }: { id: string; dag: string }) {
  const [oppen, setOppen] = useState<"godkann" | "avvisa" | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="sekundar"
          onClick={() => setOppen(oppen === "godkann" ? null : "godkann")}
        >
          Var inte på plats
        </Button>
        <Button
          type="button"
          size="sm"
          variant="diskret"
          onClick={() => setOppen(oppen === "avvisa" ? null : "avvisa")}
        >
          Var här
        </Button>
      </div>

      {oppen === "godkann" && (
        <MedFalt
          action={godkannHandelse}
          id={id}
          etikett="Godkänn"
          platshallare="Anteckning (frivillig)"
          hjalp={`Du intygar att personen faktiskt inte var på plats ${dag}. Trappsteget bestäms nu och fryses på händelsen.`}
        />
      )}

      {oppen === "avvisa" && (
        <MedFalt
          action={avvisaHandelse}
          id={id}
          etikett="Avvisa"
          platshallare="Anteckning (frivillig)"
          hjalp="Personen var här, eller frånvaron hade ett giltigt skäl. Förslaget räknas inte och kommer inte tillbaka."
        />
      )}
    </div>
  );
}

/** Havning av en godkand handelse. Skalet ar frivilligt, spart ar det inte. */
export function Havning({ id }: { id: string }) {
  const [oppen, setOppen] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" size="sm" variant="diskret" onClick={() => setOppen(!oppen)}>
        Häv
      </Button>
      {oppen && (
        <MedFalt
          action={havHandelse}
          id={id}
          faltnamn="skal"
          etikett="Häv"
          platshallare="Skäl (frivilligt)"
          hjalp="Händelsen räknas inte längre i trappan. Både godkännandet och hävningen står kvar."
        />
      )}
    </div>
  );
}

type Handling = (prev: Handelsestate, form: FormData) => Promise<Handelsestate>;

function MedFalt({
  action,
  id,
  etikett,
  platshallare,
  hjalp,
  faltnamn = "anteckning",
}: {
  action: Handling;
  id: string;
  etikett: string;
  platshallare: string;
  hjalp: string;
  faltnamn?: string;
}) {
  const [state, formAction, vantar] = useActionState<Handelsestate, FormData>(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <p className="max-w-[46ch] text-micro text-ink-500">{hjalp}</p>
      <input type="text" name={faltnamn} placeholder={platshallare} className={`${KONTROLL} w-64`} />
      <div>
        <Button type="submit" size="sm" disabled={vantar}>
          {etikett}
        </Button>
      </div>
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}
      {state.varning && <Notis ton="warn">{state.varning}</Notis>}
    </form>
  );
}

/**
 * Uppläggning for hand.
 *
 * Motorn ser bara dagar MED SCHEMA och letar bara fjorton dygn bakat. En dag
 * som faller utanfor bada gar inte att fanga automatiskt, och da ska den ga att
 * lagga upp — men den gar in som ett FORSLAG, aven nar chefen sjalv lagger den.
 */
export function Upplaggning({ personer }: { personer: { id: string; namn: string }[] }) {
  const [state, formAction, vantar] = useActionState<Handelsestate, FormData>(laggUppHandelse, {});

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-micro uppercase text-ink-500">Person</span>
          <select name="employee_id" className={`${KONTROLL} w-56`} defaultValue="">
            <option value="" disabled>
              Välj person
            </option>
            {personer.map((p) => (
              <option key={p.id} value={p.id}>
                {p.namn}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-micro uppercase text-ink-500">Dag</span>
          <input type="date" name="datum" className={`${KONTROLL} w-44`} />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-micro uppercase text-ink-500">Minuter</span>
          <input type="number" name="minuter" min={5} step={1} className={`${KONTROLL} w-28`} />
        </label>

        <Button type="submit" variant="sekundar" size="sm" disabled={vantar}>
          Lägg upp som förslag
        </Button>
      </div>

      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}
    </form>
  );
}
