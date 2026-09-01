"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { MALLTYPER, TYP_ETIKETT } from "@/lib/coachning";
import { skapaMall, type MallState } from "./actions";

const EXEMPEL = `Läs manuset | lasning | 1 | forsaljningsmanus | Intro
Memorera öppningen och kör den för din teamledare | manus | 3 | | Intro
Produktintroduktionen | kurs | 7 | produktintroduktion
Medlyssning på tio egna samtal | medlyssning | 10 | | Kvalitet på samtalet
Ring 20 nya bolag med den nya öppningen | uppgift | 14 | | Intro, Behovsanalys`;

/**
 * Mallen skrivs som TEXT, inte i ett formular med "lagg till moment".
 *
 * Samma val som quizfragorna och rollspelsrubriken gjorde, och av samma skal:
 * en rampplan skrivs i ett svep, ofta genom att klistra in fran ett underlag.
 * Tolv omgangar av "lagg till, valj typ, satt dagar" gor samma arbete tio
 * ganger langsammare.
 */
export function NyMall({ fokus }: { fokus: string[] }) {
  const [state, action, vantar] = useActionState<MallState, FormData>(skapaMall, {});

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}

      <label htmlFor="name" className="flex flex-col gap-1">
        <span className="text-micro text-ink-500">Namn</span>
        <input id="name" name="name" required placeholder="Ny säljare vecka 1–4" className={KONTROLL} />
      </label>

      <label htmlFor="description_md" className="flex flex-col gap-1">
        <span className="text-micro text-ink-500">Vad mallen är till för (valfritt)</span>
        <input id="description_md" name="description_md" className={KONTROLL} />
      </label>

      <label htmlFor="moment" className="flex flex-col gap-1">
        <span className="text-micro text-ink-500">Moment — ett per rad</span>
        <textarea
          id="moment"
          name="moment"
          rows={8}
          required
          defaultValue=""
          placeholder={EXEMPEL}
          className={`${KONTROLL} font-mono text-small`}
        />
        <span className="text-small text-ink-500">
          Rubrik | typ | dagar efter start | slug | fokusområden. Bara rubriken krävs.
        </span>
      </label>

      <div className="rounded-sm bg-canvas px-4 py-3 text-small text-ink-700">
        <p className="font-semibold">Typer som går i en mall</p>
        <p className="mt-1">{MALLTYPER.map((t) => `${t} (${TYP_ETIKETT[t].toLowerCase()})`).join(" · ")}</p>
        <p className="mt-2">
          <span className="font-semibold">kurs</span> och <span className="font-semibold">lasning</span> behöver en
          slug i fjärde fältet. Rollspel går inte i en mall än — modulerna har inga slugar, och en mall som pekar på
          &quot;modul 3&quot; går sönder den dagen någon lägger in en modul emellan.
        </p>
        {fokus.length > 0 && (
          <p className="mt-2">
            <span className="font-semibold">Fokusområden:</span> {fokus.join(", ")}
          </p>
        )}
      </div>

      <div>
        <Button type="submit" laddar={vantar} disabled={vantar}>
          Spara mallen
        </Button>
      </div>
    </form>
  );
}
