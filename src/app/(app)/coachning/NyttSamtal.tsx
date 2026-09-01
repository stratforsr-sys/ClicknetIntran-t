"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { skapaSamtal, type CoachState } from "./actions";

/**
 * GROW-protokollet.
 *
 * FYRA FALT, OCH DET FJARDE AR HELA POANGEN. Mal, lage och alternativ ar
 * anteckningar. Atagandet blir uppgifter med ansvarig och datum — det ar
 * skillnaden mellan ett protokoll och en anteckningsbok.
 *
 * Fragorna under varje falt star kvar i granssnittet med flit. GROW ar ingen
 * blankett utan en samtalsstruktur, och den som for sitt forsta samtal ska inte
 * behova ha last en handbok for att veta vad "Reality" betyder.
 */
export function NyttSamtal({ employeeId, idag }: { employeeId: string; idag: string }) {
  const [state, action, vantar] = useActionState<CoachState, FormData>(skapaSamtal, {});

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}

      <input type="hidden" name="employee_id" value={employeeId} />

      <label htmlFor="held_on" className="flex max-w-xs flex-col gap-1">
        <span className="text-micro text-ink-500">Datum</span>
        <input id="held_on" name="held_on" type="date" required defaultValue={idag} className={KONTROLL} />
      </label>

      <Falt namn="goal_md" rubrik="Mål" hjalp="Vad vill du uppnå? Hur ser det ut när du är där?" />
      <Falt namn="reality_md" rubrik="Läge" hjalp="Var står du nu? Vad har du provat?" />
      <Falt namn="options_md" rubrik="Alternativ" hjalp="Vilka vägar finns? Vad skulle du råda en kollega?" />
      <Falt namn="will_md" rubrik="Slutsats" hjalp="Vad blev ni överens om?" />

      <label htmlFor="atagande" className="flex flex-col gap-1">
        <span className="text-micro text-ink-500">Åtaganden — ett per rad</span>
        <textarea
          id="atagande"
          name="atagande"
          rows={3}
          placeholder={"Ring tio bolag med den nya öppningen | 7\nLyssna igenom tisdagens samtal | 3"}
          className={`${KONTROLL} font-mono text-small`}
        />
        <span className="text-small text-ink-500">
          {/* Utan datum ar ett atagande en avsikt. Sju dagar ar forvalet. */}
          Blir riktiga uppgifter som personen kvitterar själv. Antal dagar efter lodstrecket — utan det blir det sju.
        </span>
      </label>

      <div>
        <Button type="submit" laddar={vantar} disabled={vantar}>
          Spara samtalet
        </Button>
      </div>
    </form>
  );
}

function Falt({ namn, rubrik, hjalp }: { namn: string; rubrik: string; hjalp: string }) {
  return (
    <label htmlFor={namn} className="flex flex-col gap-1">
      <span className="text-micro text-ink-500">{rubrik}</span>
      <textarea id={namn} name={namn} rows={2} className={KONTROLL} />
      <span className="text-small text-ink-500">{hjalp}</span>
    </label>
  );
}
