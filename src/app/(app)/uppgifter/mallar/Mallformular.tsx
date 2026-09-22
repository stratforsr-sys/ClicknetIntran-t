"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { andraUppgiftsmall, arkiveraUppgiftsmall, skapaUppgiftsmall, type MallState } from "./actions";

const EXEMPEL = `Välkomstsamtal | 0 | 30 | 09:00 | 2
Lägg upp kunden i systemet | 0 | 20
Skicka avtalet | 1 | 15
Stäm av att avtalet kom fram | 3 | 10
Uppföljning efter första veckan | 7 | 30
Månadsavstämning | 30 | 45`;

const HJALP = "Rubrik | dagar efter start | minuter | klockslag | prioritet 1–4. Bara rubriken krävs.";

export type Mallvarden = {
  id: string;
  name: string;
  description_md: string;
  shared: boolean;
  moment: string;
};

/**
 * Formuläret som både skapar och ändrar en mall.
 *
 * ETT FORMULÄR OCH INTE TVÅ. Fälten är exakt desamma, och skillnaden är vilken
 * server action posten går till plus ett dolt `template_id`. Två komponenter
 * hade betytt två ställen att lägga till ett fält på — och den dagen någon
 * lägger till ett i det ena kan man skapa något man inte kan ändra.
 */
export function Mallformular({ mall }: { mall?: Mallvarden }) {
  const [state, action, vantar] = useActionState<MallState, FormData>(
    mall ? andraUppgiftsmall : skapaUppgiftsmall,
    {},
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}

      {mall && <input type="hidden" name="template_id" value={mall.id} />}

      <label className="flex flex-col gap-1">
        <span className="text-micro text-ink-500">Namn</span>
        <input
          name="name"
          required
          maxLength={80}
          defaultValue={mall?.name ?? ""}
          placeholder="Uppstart ny kund"
          className={KONTROLL}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-micro text-ink-500">Vad mallen är till för (valfritt)</span>
        <input
          name="description_md"
          defaultValue={mall?.description_md ?? ""}
          placeholder="Allt som ska hända de första trettio dagarna med en ny kund."
          className={KONTROLL}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-micro text-ink-500">Moment — ett per rad</span>
        <textarea
          name="moment"
          rows={8}
          required
          defaultValue={mall?.moment ?? ""}
          placeholder={EXEMPEL}
          className={`${KONTROLL} font-mono text-small`}
        />
        <span className="text-small text-ink-500">{HJALP}</span>
      </label>

      {/*
        FÖRVALET ÄR IKRYSSAT, OCH TEXTEN SÄGER VAD DET BETYDER.
        En mall är en arbetsbeskrivning och inte en anteckning — se rubriken i
        0066 — men ett förval som delar utan att synas är ett förval man inte
        får ha. Rutan står därför framme med hela meningen utskriven.
      */}
      <label className="flex items-start gap-2.5">
        <input
          type="checkbox"
          name="shared"
          defaultChecked={mall ? mall.shared : true}
          className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand-600)]"
        />
        <span className="text-small text-ink-700">
          Alla i navet kan använda mallen
          <span className="block text-micro text-ink-500">
            Kryssa ur om checklistan bara är din. Uppgifterna den skapar har sin egen krets oavsett.
          </span>
        </span>
      </label>

      <div>
        <Button type="submit" laddar={vantar} disabled={vantar}>
          {mall ? "Spara ändringen" : "Spara mallen"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Arkiveringen ligger i EN EGEN FORM, och det är inte en stilfråga: HTML tillåter
 * inte ett formulär inuti ett annat, och knappen hör ihop med samma mall som
 * formuläret ovan.
 */
export function Arkivknapp({ id, arkiverad }: { id: string; arkiverad: boolean }) {
  const [state, action, vantar] = useActionState<MallState, FormData>(arkiveraUppgiftsmall, {});

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="template_id" value={id} />
      <Button type="submit" variant="diskret" size="sm" laddar={vantar}>
        {arkiverad ? "Ta fram igen" : "Arkivera"}
      </Button>
      {state.fel && <span className="text-micro text-danger-ink">{state.fel}</span>}
    </form>
  );
}
