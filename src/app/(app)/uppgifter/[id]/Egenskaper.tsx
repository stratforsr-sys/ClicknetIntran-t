"use client";

import { useActionState, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL, Select } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { cn } from "@/components/ui/cn";
import { Ikon } from "@/components/shell/Ikon";
import {
  PRIORITETER,
  PRIORITET_ETIKETT,
  fristtext,
  tidstext,
  visaPrioritet,
  type Prioritet,
} from "@/lib/uppgifter";
import { andraUppgift, planera, tilldela, type UppgiftState } from "../actions";

type Val = { id: string; namn: string };

/**
 * Uppgiftens egenskaper — att läsa, och att ändra.
 *
 * ===========================================================================
 * DEN HÄR PANELEN FANNS INTE I FÖRSTA UTKASTET, OCH DET VAR ETT HÅL
 *
 * Uppgiftssidan visade rubrik, ansvarig, frist och prioritet i en `<dl>` — och
 * ingenting av det gick att ändra. En uppgift vars datum bara kunde sättas när
 * den skapades är inte en uppgift man kan planera om, och att planera om är det
 * man gör oftast av allt. Server actions för det fanns redan skrivna
 * (`andraUppgift`, `tilldela`, `planera`); det som saknades var en väg dit.
 *
 * ----------------------------------------------------------------------------
 * TRE FORMULÄR OCH INTE ETT, för de gör tre olika saker
 *
 * Att byta ANSVARIG är ett besked till en människa och skriver en notis. Att
 * flytta ett DATUM är en planeringsändring som ingen ska störas av. Att skriva
 * om RUBRIKEN är varken eller. Ett gemensamt "Spara" hade betytt att den som
 * rättade ett stavfel riskerade att skicka ett meddelande — eller, värre, att
 * omtilldelningen tystades för att den råkade ske i samma sparning.
 *
 * Panelen ser ändå ut som en enhet. Det är avsikten: användaren ska se ETT
 * ställe där uppgiftens egenskaper bor, och slippa veta att de går olika vägar.
 * ===========================================================================
 */
export function Egenskaper({
  id,
  title,
  descriptionMd,
  assigneeId,
  assigneeNamn,
  dueDate,
  dueTime,
  startsOn,
  estimateMinutes,
  priority,
  projectId,
  projektNamn,
  personer,
  projekt,
  idag,
  kanAndra,
}: {
  id: string;
  title: string;
  descriptionMd: string;
  assigneeId: string | null;
  assigneeNamn: string | null;
  dueDate: string | null;
  dueTime: string | null;
  startsOn: string | null;
  estimateMinutes: number | null;
  priority: Prioritet;
  projectId: string | null;
  projektNamn: string | null;
  personer: Val[];
  projekt: Val[];
  idag: string;
  kanAndra: boolean;
}) {
  const [oppet, setOppet] = useState(false);

  if (!oppet) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Chip ikon="personal">{assigneeNamn ?? "Ingen ansvarig"}</Chip>

        <Chip
          ikon="klocka"
          ton={dueDate && dueDate < idag ? "danger" : dueDate === idag ? "brand" : "neutral"}
        >
          {dueDate ? `${fristtext(dueDate, idag)}${dueTime ? ` ${dueTime}` : ""}` : "Ingen frist"}
        </Chip>

        {estimateMinutes && <Chip ikon="tid">{tidstext(estimateMinutes)}</Chip>}

        {visaPrioritet(priority) && (
          <Chip ton={priority === 1 ? "danger" : "warn"}>{PRIORITET_ETIKETT[priority]}</Chip>
        )}

        {projektNamn && <Chip ikon="rutiner">{projektNamn}</Chip>}

        {kanAndra && (
          <button
            type="button"
            onClick={() => setOppet(true)}
            className={cn(
              "inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-small text-ink-500",
              "ring-1 ring-canvas transition-colors duration-fast",
              "hover:bg-canvas hover:text-ink-900",
              "focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:outline-none",
            )}
          >
            <Ikon namn="installningar" className="size-3.5" />
            Ändra
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 rounded-md bg-surface-alt p-4">
      <Ansvarig id={id} nuvarande={assigneeId} personer={personer} />

      <Planering id={id} dueDate={dueDate} dueTime={dueTime} estimateMinutes={estimateMinutes} idag={idag} />

      <Detaljer
        id={id}
        title={title}
        descriptionMd={descriptionMd}
        startsOn={startsOn}
        dueDate={dueDate}
        dueTime={dueTime}
        estimateMinutes={estimateMinutes}
        priority={priority}
        projectId={projectId}
        projekt={projekt}
      />

      <div className="border-t border-canvas pt-3">
        <Button type="button" variant="diskret" size="sm" onClick={() => setOppet(false)}>
          Stäng
        </Button>
      </div>
    </div>
  );
}

/**
 * Ansvarig.
 *
 * SUBMIT-KNAPP OCH INTE `onChange`. En väljare som sparar i samma stund man
 * bläddrar förbi ett namn med piltangenterna skickar en notis till fel person,
 * och den notisen går inte att ta tillbaka.
 */
function Ansvarig({ id, nuvarande, personer }: { id: string; nuvarande: string | null; personer: Val[] }) {
  const [state, kor, vantar] = useActionState<UppgiftState, FormData>(tilldela, {});

  return (
    <form action={kor} className="flex flex-col gap-2">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}
      <input type="hidden" name="id" value={id} />

      <Rubrik>Ansvarig</Rubrik>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <Select namn="assignee_id" defaultValue={nuvarande ?? ""}>
            <option value="">Ingen — lägg i inkorgen</option>
            {personer.map((p) => (
              <option key={p.id} value={p.id}>
                {p.namn}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="sekundar" size="sm" laddar={vantar} disabled={vantar}>
          Tilldela
        </Button>
      </div>
      <p className="text-small text-ink-500">Den som får uppgiften får ett besked i navet.</p>
    </form>
  );
}

/**
 * Planeringen — datum, klockslag och beräknad tid.
 *
 * EGEN RAD MED SNABBKNAPPAR, för det här är den ändring som görs oftast. En
 * uppgift utan ett NÄR blir gjord i ungefär hälften så många fall som en med,
 * och den siffran gäller lika mycket den tredje gången man flyttar fram den som
 * den första gången man sätter den.
 */
function Planering({
  id,
  dueDate,
  dueTime,
  estimateMinutes,
  idag,
}: {
  id: string;
  dueDate: string | null;
  dueTime: string | null;
  estimateMinutes: number | null;
  idag: string;
}) {
  const [state, kor, vantar] = useActionState<UppgiftState, FormData>(planera, {});

  const plus = (dagar: number) =>
    new Date(Date.parse(`${idag}T12:00:00.000Z`) + dagar * 86_400_000).toISOString().slice(0, 10);

  // Måndagen i nästa vecka, räknat på svenskt datum.
  const veckodag = ((new Date(`${idag}T12:00:00.000Z`).getUTCDay() + 6) % 7) + 1;
  const nastaMandag = plus(8 - veckodag);

  return (
    <div className="flex flex-col gap-2 border-t border-canvas pt-4">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}

      <Rubrik>När</Rubrik>

      {/*
        SNABBKNAPPARNA ÄR ETT EGET FORMULÄR, och de bär med sig klockslaget
        och minuterna som dolda fält.

        `planera()` skriver hela planeringen på en gång: ett fält som inte
        kommer med tolkas som "ta bort". Låg knapparna i samma formulär som
        datumrutan nedan hade webbläsaren dessutom skickat TVÅ `due_date` —
        knappens och rutans — och vilken som vinner beror på ordningen i
        dokumentet. Det är precis den sortens regel som håller tills någon
        flyttar en rad.
      */}
      <form action={kor} className="flex flex-wrap gap-1.5">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="due_time" value={dueTime ?? ""} />
        <input type="hidden" name="estimate_minutes" value={estimateMinutes ?? ""} />
        <Snabbknapp namn="due_date" varde={idag} disabled={vantar}>
          Idag
        </Snabbknapp>
        <Snabbknapp namn="due_date" varde={plus(1)} disabled={vantar}>
          I morgon
        </Snabbknapp>
        <Snabbknapp namn="due_date" varde={nastaMandag} disabled={vantar}>
          Nästa måndag
        </Snabbknapp>
        {dueDate && (
          <Snabbknapp namn="due_date" varde="" disabled={vantar}>
            Ta bort datum
          </Snabbknapp>
        )}
      </form>

      <form action={kor} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="id" value={id} />
        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Datum</span>
          <input type="date" name="due_date" defaultValue={dueDate ?? ""} className={cn(KONTROLL, "w-44")} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Klockslag</span>
          <input type="time" name="due_time" defaultValue={dueTime ?? ""} className={cn(KONTROLL, "w-32")} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Minuter</span>
          <input
            type="number"
            name="estimate_minutes"
            min={5}
            max={1440}
            step={5}
            defaultValue={estimateMinutes ?? ""}
            className={cn(KONTROLL, "w-28")}
          />
        </label>
        <Button type="submit" variant="sekundar" size="sm" laddar={vantar} disabled={vantar}>
          Spara tiden
        </Button>
      </form>
    </div>
  );
}

/**
 * Rubrik, beskrivning, prioritet och projekt.
 *
 * SKICKAR MED DATUM OCH TID OFÖRÄNDRADE. `andraUppgift` skriver hela raden, och
 * ett utelämnat fält hade tolkats som "ta bort" — den som rättade ett stavfel
 * hade då tappat sin frist. Fälten ligger som dolda kopior i stället för att
 * ritas två gånger i panelen.
 */
function Detaljer({
  id,
  title,
  descriptionMd,
  startsOn,
  dueDate,
  dueTime,
  estimateMinutes,
  priority,
  projectId,
  projekt,
}: {
  id: string;
  title: string;
  descriptionMd: string;
  startsOn: string | null;
  dueDate: string | null;
  dueTime: string | null;
  estimateMinutes: number | null;
  priority: Prioritet;
  projectId: string | null;
  projekt: Val[];
}) {
  const [state, kor, vantar] = useActionState<UppgiftState, FormData>(andraUppgift, {});

  return (
    <form action={kor} className="flex flex-col gap-3 border-t border-canvas pt-4">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}

      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="due_date" value={dueDate ?? ""} />
      <input type="hidden" name="due_time" value={dueTime ?? ""} />
      <input type="hidden" name="starts_on" value={startsOn ?? ""} />
      <input type="hidden" name="estimate_minutes" value={estimateMinutes ?? ""} />

      <Rubrik>Vad</Rubrik>

      <label className="flex flex-col gap-1">
        <span className="text-micro text-ink-500">Rubrik</span>
        <input name="title" defaultValue={title} required maxLength={200} className={KONTROLL} />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-micro text-ink-500">Beskrivning (markdown)</span>
        <textarea name="description_md" rows={4} defaultValue={descriptionMd} className={KONTROLL} />
      </label>

      <div className="flex flex-wrap gap-3">
        <label className="flex min-w-40 flex-1 flex-col gap-1">
          <span className="text-micro text-ink-500">Prioritet</span>
          <Select namn="priority" defaultValue={String(priority)}>
            {PRIORITETER.map((p) => (
              <option key={p} value={p}>
                {PRIORITET_ETIKETT[p]}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex min-w-40 flex-1 flex-col gap-1">
          <span className="text-micro text-ink-500">Projekt</span>
          <Select namn="project_id" defaultValue={projectId ?? ""}>
            <option value="">Inget projekt</option>
            {projekt.map((p) => (
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

// -----------------------------------------------------------------------------

function Rubrik({ children }: { children: ReactNode }) {
  return <h3 className="text-micro tracking-wide text-ink-500 uppercase">{children}</h3>;
}

function Snabbknapp({
  namn,
  varde,
  disabled,
  children,
}: {
  namn: string;
  varde: string;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      name={namn}
      value={varde}
      disabled={disabled}
      className={cn(
        "rounded-full px-3 py-1.5 text-micro text-ink-500 ring-1 ring-canvas",
        "transition-colors duration-fast hover:bg-brand-100 hover:text-brand-700",
        "focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      {children}
    </button>
  );
}

function Chip({
  children,
  ikon,
  ton = "neutral",
}: {
  children: ReactNode;
  ikon?: string;
  ton?: "neutral" | "brand" | "warn" | "danger";
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-small",
        ton === "brand"
          ? "bg-brand-tint font-semibold text-brand-ink"
          : ton === "warn"
            ? "bg-warn-tint text-warn-ink"
            : ton === "danger"
              ? "bg-danger-tint font-semibold text-danger-ink"
              : "bg-canvas text-ink-700",
      )}
    >
      {ikon && <Ikon namn={ikon} className="size-3.5 opacity-60" />}
      {children}
    </span>
  );
}
