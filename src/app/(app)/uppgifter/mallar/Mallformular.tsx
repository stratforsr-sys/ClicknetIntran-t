"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { PRIORITET_ETIKETT, tidstext } from "@/lib/uppgifter";
import { momentTillText, tolkaMoment, type Mallmoment } from "@/lib/mallar";
import { andraUppgiftsmall, arkiveraUppgiftsmall, skapaUppgiftsmall, type MallState } from "./actions";

const EXEMPEL = `Välkomstsamtal | 0 | 30 | 09:00 | 2
Lägg upp kunden i systemet | 0 | 20
Skicka avtalet | 1 | 15
Stäm av att avtalet kom fram | 3
Uppföljning efter första veckan | 7 | 30
Månadsavstämning | 30 | 45`;

export type Mallvarden = {
  id: string;
  name: string;
  description_md: string;
  shared: boolean;
  moment: Mallmoment[];
};

/**
 * Formuläret som både skapar och ändrar en mall.
 *
 * ETT FORMULÄR OCH INTE TVÅ. Fälten är exakt desamma, och skillnaden är vilken
 * server action posten går till plus ett dolt `template_id`. Två komponenter
 * hade betytt två ställen att lägga till ett fält på — och den dagen någon
 * lägger till ett i det ena kan man skapa något man inte kan ändra.
 */
export function Mallformular({ mall, onKlar }: { mall?: Mallvarden; onKlar?: () => void }) {
  const [state, action, vantar] = useActionState<MallState, FormData>(
    mall ? andraUppgiftsmall : skapaUppgiftsmall,
    {},
  );
  const [text, setText] = useState(mall ? momentTillText(mall.moment) : "");

  const tolkad = tolkaMoment(text);

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && (
        <Notis ton="ok">
          {state.ok}
          {onKlar && (
            <button
              type="button"
              onClick={onKlar}
              className="ml-2 font-semibold underline underline-offset-2"
            >
              Stäng
            </button>
          )}
        </Notis>
      )}

      {mall && <input type="hidden" name="template_id" value={mall.id} />}

      <div className="grid gap-3 sm:grid-cols-2">
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
            placeholder="De första trettio dagarna med en ny kund."
            className={KONTROLL}
          />
        </label>
      </div>

      {/*
        ===================================================================
        TEXTRUTAN OCH TOLKNINGEN STÅR BREDVID VARANDRA

        Mallen skrivs som text — samma val som coachningsmallarna,
        quizfrågorna och rollspelsrubrikerna gjorde, och av samma skäl: en
        checklista skrivs i ett svep, ofta genom att klistra in ur ett mejl.
        Sex omgångar av "lägg till rad, välj prioritet, sätt dagar" gör samma
        arbete tio gånger långsammare.

        Priset är att formatet är osynligt: fem fält skilda med lodstreck
        säger ingenting förrän man provat. Därför tolkas raderna MEDAN man
        skriver, precis som snabbraden på /uppgifter gör — och av samma skäl
        som står där: etiketterna är en LÄXA och inte en bekräftelse. Den som
        ser "dag 3 · 15 min" dyka upp när hon skrev `| 3 | 15` har lärt sig
        syntaxen utan att läsa någon hjälptext.

        SERVERN TOLKAR OM RADERNA. Det här är en förhandsbild; det är serverns
        svar som sparas.
        ===================================================================
      */}
      <div className="grid gap-3 lg:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-micro text-ink-500">Moment — ett per rad</span>
          <textarea
            name="moment"
            rows={9}
            required
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={EXEMPEL}
            spellCheck={false}
            className={`${KONTROLL} resize-y font-mono text-small`}
          />
          <span className="text-micro text-ink-500">
            <span className="text-ink-700">Rubrik</span> | dagar efter start | minuter | klockslag |
            prioritet 1–4. Bara rubriken krävs.
          </span>
        </label>

        <Tolkningen text={text} tolkad={tolkad} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {/*
          FÖRVALET ÄR IKRYSSAT, OCH TEXTEN SÄGER VAD DET BETYDER. En mall är en
          arbetsbeskrivning och inte en anteckning — men ett förval som delar
          utan att synas är ett förval man inte får ha.
        */}
        <label className="flex max-w-prose items-start gap-2.5">
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

        <Button type="submit" laddar={vantar} disabled={vantar || tolkad.fel !== null || tolkad.moment.length === 0}>
          {mall ? "Spara ändringen" : "Spara mallen"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Vad navet tror att raderna betyder.
 *
 * TRE LÄGEN, och det tomma är inte tyst: en ruta som säger "skriv något" är
 * mindre skrämmande än en tom yta bredvid en tom yta. Felet visas på den rad
 * det gäller och stoppar sparandet — att låta det gå igenom och avvisas av
 * servern hade varit ett svar en halv sekund senare, utan att peka på raden.
 */
function Tolkningen({
  text,
  tolkad,
}: {
  text: string;
  tolkad: { moment: Mallmoment[]; fel: string | null };
}) {
  if (text.trim() === "") {
    return (
      <div className="flex min-h-40 items-center justify-center rounded-sm bg-canvas px-4 py-6">
        <p className="max-w-[28ch] text-center text-small text-ink-500">
          Raderna tolkas här medan du skriver, så att du ser vad de blir innan du sparar.
        </p>
      </div>
    );
  }

  if (tolkad.fel) {
    return (
      <div className="flex min-h-40 flex-col justify-center gap-2 rounded-sm bg-danger-tint px-4 py-5">
        <p className="text-small font-semibold text-danger-ink">{tolkad.fel}</p>
        <p className="text-micro text-danger-ink/80">
          Mallen sparas inte förrän raden går att läsa. Ett fel på en rad fäller hela mallen — en halv
          checklista ser riktig ut i listan och märks först ett halvår senare.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-40 flex-col gap-1 rounded-sm bg-canvas px-4 py-3">
      <p className="text-micro font-semibold uppercase tracking-wide text-ink-500">
        {tolkad.moment.length} {tolkad.moment.length === 1 ? "moment" : "moment"}
      </p>
      <ol className="flex flex-col">
        {tolkad.moment.map((m, i) => (
          <li
            key={m.sort}
            className={
              "flex flex-wrap items-baseline gap-x-2.5 py-1 " + (i > 0 ? "border-t border-surface" : "")
            }
          >
            <span className="tnum w-14 shrink-0 text-micro text-ink-500">dag {m.offset_days}</span>
            <span className="min-w-0 flex-1 truncate text-small text-ink-900">{m.title}</span>
            <span className="tnum shrink-0 text-micro text-ink-500">
              {[m.due_time, tidstext(m.estimate_minutes), m.priority === 3 ? null : PRIORITET_ETIKETT[m.priority]]
                .filter(Boolean)
                .join(" · ") || "—"}
            </span>
          </li>
        ))}
      </ol>
    </div>
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
    <form action={action} className="flex shrink-0 items-center gap-2">
      <input type="hidden" name="template_id" value={id} />
      <Button type="submit" variant="diskret" size="sm" laddar={vantar}>
        {arkiverad ? "Ta fram igen" : "Arkivera"}
      </Button>
      {state.fel && <span className="text-micro text-danger-ink">{state.fel}</span>}
    </form>
  );
}
