"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL, Select } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { cn } from "@/components/ui/cn";
import { Ikon } from "@/components/shell/Ikon";
import {
  andraProjekt,
  arkiveraProjekt,
  bjudInProjekt,
  taBortProjektmedlem,
  type UppgiftState,
} from "../../actions";

type Val = { id: string; namn: string };
type Medlem = { employee_id: string; role: "redigerare" | "visare"; namn: string };

const FARGER = [
  { id: "brand", etikett: "Grön", klass: "bg-brand-500" },
  { id: "info", etikett: "Blå", klass: "bg-info" },
  { id: "accent", etikett: "Orange", klass: "bg-accent" },
  { id: "ok", etikett: "Mörkgrön", klass: "bg-ok" },
  { id: "warn", etikett: "Gul", klass: "bg-warn" },
  { id: "danger", etikett: "Röd", klass: "bg-danger" },
];

/**
 * Projektets inställningar.
 *
 * ===========================================================================
 * HOPFÄLLD SOM GRUNDLÄGE, OCH DET ÄR HELA POÄNGEN
 *
 * Ett projekt ändras sällan och arbetas i ofta. Låg namn, färg, deadline,
 * deltagare och arkiveringsknapp utfällda på sidan skulle inställningarna ta
 * mer plats än uppgifterna — och den som kom hit för att bocka av något fick
 * läsa förbi ett formulär först.
 *
 * Panelen öppnas därför av en knapp och lägger sig ÖVER innehållet i stället
 * för att knuffa ner det. Ingen modal: en modal fångar fokus, kräver en
 * stängningsordning och beter sig olika på telefon. Det här är ett kort som
 * råkar ligga högt.
 * ===========================================================================
 */
export function Projektpanel({
  id,
  name,
  descriptionMd,
  color,
  dueDate,
  ownerId,
  arkiverad,
  medlemmar,
  personer,
}: {
  id: string;
  name: string;
  descriptionMd: string;
  color: string;
  dueDate: string | null;
  ownerId: string;
  arkiverad: boolean;
  medlemmar: Medlem[];
  personer: Val[];
}) {
  const [oppet, setOppet] = useState(false);

  if (!oppet) {
    return (
      <Button type="button" variant="sekundar" size="sm" onClick={() => setOppet(true)}>
        <Ikon namn="installningar" className="size-4" />
        Inställningar
      </Button>
    );
  }

  return (
    <div className="relative w-full lg:w-auto">
      <div className="flex w-full flex-col gap-5 rounded-md bg-surface-alt p-4 lg:absolute lg:right-0 lg:z-10 lg:w-[26rem] lg:shadow-elev-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-h2 text-ink-900">Inställningar</h2>
          <Button type="button" variant="diskret" size="sm" onClick={() => setOppet(false)}>
            Stäng
          </Button>
        </div>

        <Grunduppgifter
          id={id}
          name={name}
          descriptionMd={descriptionMd}
          color={color}
          dueDate={dueDate}
          ownerId={ownerId}
          personer={personer}
        />

        <Deltagare id={id} medlemmar={medlemmar} personer={personer} ownerId={ownerId} />

        <Arkivering id={id} arkiverad={arkiverad} />
      </div>
    </div>
  );
}

function Grunduppgifter({
  id,
  name,
  descriptionMd,
  color,
  dueDate,
  ownerId,
  personer,
}: {
  id: string;
  name: string;
  descriptionMd: string;
  color: string;
  dueDate: string | null;
  ownerId: string;
  personer: Val[];
}) {
  const [state, kor, vantar] = useActionState<UppgiftState, FormData>(andraProjekt, {});
  const [farg, setFarg] = useState(color);

  return (
    <form action={kor} className="flex flex-col gap-3">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="color" value={farg} />

      <label className="flex flex-col gap-1">
        <span className="text-micro text-ink-500">Namn</span>
        <input name="name" defaultValue={name} required maxLength={120} className={KONTROLL} />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-micro text-ink-500">Beskrivning (markdown)</span>
        <textarea name="description_md" rows={3} defaultValue={descriptionMd} className={KONTROLL} />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-micro text-ink-500">Färg</legend>
        <div className="flex flex-wrap gap-2">
          {FARGER.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={farg === f.id}
              aria-label={f.etikett}
              onClick={() => setFarg(f.id)}
              className={cn(
                "size-8 rounded-full transition-transform duration-fast",
                f.klass,
                farg === f.id ? "ring-2 ring-ink-900 ring-offset-2" : "hover:scale-110",
              )}
            />
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <label className="flex min-w-36 flex-1 flex-col gap-1">
          <span className="text-micro text-ink-500">Deadline</span>
          <input type="date" name="due_date" defaultValue={dueDate ?? ""} className={KONTROLL} />
        </label>

        <label className="flex min-w-36 flex-1 flex-col gap-1">
          <span className="text-micro text-ink-500">Ägare</span>
          <Select namn="owner_id" defaultValue={ownerId}>
            {personer.map((p) => (
              <option key={p.id} value={p.id}>
                {p.namn}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <div>
        <Button type="submit" size="sm" laddar={vantar} disabled={vantar}>
          Spara
        </Button>
      </div>
    </form>
  );
}

/**
 * Deltagarna.
 *
 * TVÅ ROLLER OCH INGEN GRANSKARE — det är uppgifterna som godkänns, inte
 * hatten. Texten under säger uttryckligen att en projektdeltagare inte får se
 * projektets uppgifter automatiskt, för det är den enda gissningen någon kommer
 * att göra fel: "jag bjöd in Anna till projektet, varför ser hon inget?"
 */
function Deltagare({
  id,
  medlemmar,
  personer,
  ownerId,
}: {
  id: string;
  medlemmar: Medlem[];
  personer: Val[];
  ownerId: string;
}) {
  const [state, kor, vantar] = useActionState<UppgiftState, FormData>(bjudInProjekt, {});
  const [bortState, taBort] = useActionState<UppgiftState, FormData>(taBortProjektmedlem, {});

  return (
    <div className="flex flex-col gap-3 border-t border-canvas pt-4">
      <h3 className="text-micro tracking-wide text-ink-500 uppercase">Deltagare</h3>

      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {bortState.fel && <Notis ton="danger">{bortState.fel}</Notis>}

      {medlemmar.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {medlemmar.map((m) => (
            <li key={m.employee_id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-small text-ink-900">{m.namn}</span>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-full bg-canvas px-2 py-0.5 text-micro text-ink-500">
                  {m.role === "redigerare" ? "Redigerare" : "Kan se"}
                </span>
                <form action={taBort}>
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="employee_id" value={m.employee_id} />
                  <button
                    type="submit"
                    aria-label={`Ta bort ${m.namn}`}
                    className="rounded-full p-1.5 text-ink-300 transition-colors duration-fast hover:bg-danger-tint hover:text-danger-ink"
                  >
                    <Ikon namn="kryss" className="size-3.5" />
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form action={kor} className="flex flex-col gap-2">
        <input type="hidden" name="id" value={id} />
        <div className="flex flex-wrap gap-2">
          <div className="min-w-40 flex-1">
            <Select namn="employee_id" required defaultValue="">
              <option value="" disabled>
                Välj person
              </option>
              {personer
                .filter((p) => p.id !== ownerId && !medlemmar.some((m) => m.employee_id === p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.namn}
                  </option>
                ))}
            </Select>
          </div>
          <div className="w-36">
            <Select namn="role" defaultValue="redigerare">
              <option value="redigerare">Redigerare</option>
              <option value="visare">Kan se</option>
            </Select>
          </div>
        </div>
        <div>
          <Button type="submit" variant="sekundar" size="sm" laddar={vantar} disabled={vantar}>
            Bjud in
          </Button>
        </div>
      </form>

      <p className="text-small text-ink-500">
        En deltagare ser projektet och kan lägga upp uppgifter i det. Vilka <em>befintliga</em> uppgifter hen ser
        avgörs fortfarande av varje uppgift för sig — att bli inbjuden till ett projekt öppnar inte någon annans
        anteckningar.
      </p>
    </div>
  );
}

function Arkivering({ id, arkiverad }: { id: string; arkiverad: boolean }) {
  const [state, kor, vantar] = useActionState<UppgiftState, FormData>(arkiveraProjekt, {});

  return (
    <form action={kor} className="flex flex-col gap-2 border-t border-canvas pt-4">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      <input type="hidden" name="id" value={id} />
      {arkiverad && <input type="hidden" name="aterstall" value="ja" />}
      <div>
        <Button type="submit" variant={arkiverad ? "sekundar" : "diskret"} size="sm" laddar={vantar} disabled={vantar}>
          {arkiverad ? "Plocka fram ur arkivet" : "Arkivera projektet"}
        </Button>
      </div>
      <p className="text-small text-ink-500">
        {arkiverad
          ? "Projektet syns i listan igen."
          : "Projektet försvinner ur listan. Uppgifterna ligger kvar och går att arbeta med."}
      </p>
    </form>
  );
}
