"use client";

import { Card, CardHeader } from "@/components/ui/Card";
import { cn } from "@/components/ui/cn";
import { Ikon } from "./Ikon";
import { usePanelLage } from "./panellage";
import { PANELLAGEN, PANELLAGE_TEXT } from "./sidopanel";

/**
 * Utseendesektionen i installningarna.
 *
 * Innehaller i dag en enda sak, och det ar med flit. Sidopanelens lage har
 * hittills bara gatt att na fran en liten knapp langst ner i panelen sjalv —
 * pa en kort skarm var den knappen dessutom bortklippt tillsammans med resten
 * av botten. Ett val som bara gar att gora fran platsen det galler ar ett val
 * som ingen hittar.
 *
 * Valjaren i panelen ar kvar. Tva vagar till samma val ar inte ett problem sa
 * lange bada visar samma lage, och det gor de: lageshallaren ar Skal, via
 * `usePanelLage`.
 *
 * Sedan 2026-09-09 ar det tre lagen och inte en vaxel, och det ar skalet att
 * reglaget bytts mot en lista med beskrivningar. "Hovra" gar inte att gissa
 * sig till av ett ord — panelen ligger smal och faller ut nar musen ar over
 * den — och en installning man inte forstar ar en installning man later vara.
 */
export function Utseende() {
  const { lage, valjLage } = usePanelLage();

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader titel="Sidopanelen" beskrivning="Gäller på den här enheten och sparas." />
        <div
          role="radiogroup"
          aria-label="Sidopanelens läge"
          className="mt-2 flex flex-col gap-2"
        >
          {PANELLAGEN.map((id) => {
            const text = PANELLAGE_TEXT[id];
            const vald = id === lage;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={vald}
                onClick={() => valjLage(id)}
                className={cn(
                  "flex items-start gap-3 rounded-sm border p-3 text-left",
                  "transition-colors duration-fast ease-brand",
                  vald
                    ? "border-brand-600 bg-brand-tint"
                    : "border-ink-300/60 hover:border-brand-600/50 hover:bg-brand-50",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 grid size-9 shrink-0 place-items-center rounded-sm",
                    vald ? "bg-brand-600 text-ink-inv" : "bg-ink-300/30 text-ink-500",
                  )}
                >
                  <Ikon namn={text.ikon} />
                </span>
                <span className="min-w-0">
                  <span className="block text-body font-semibold text-ink-900">{text.namn}</span>
                  <span className="mt-0.5 block max-w-[60ch] text-small text-ink-500">
                    {text.hjalp}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-small text-ink-500">
          Gäller från 1024 px och uppåt — på smalare skärmar är panelen redan en utdragslåda.
        </p>
      </Card>
    </div>
  );
}
