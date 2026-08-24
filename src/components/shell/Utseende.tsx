"use client";

import { Card, CardHeader } from "@/components/ui/Card";
import { cn } from "@/components/ui/cn";
import { usePanelLage } from "./panellage";

/**
 * Utseendesektionen i installningarna.
 *
 * Innehaller i dag en enda sak, och det ar med flit. Sidopanelens hopfallning
 * har hittills bara gatt att na fran en liten knapp langst ner i panelen
 * sjalv — pa en kort skarm var den knappen dessutom bortklippt tillsammans med
 * resten av botten. Ett val som bara gar att gora fran platsen det galler ar
 * ett val som ingen hittar.
 *
 * Knappen i panelen ar kvar. Tva vagar till samma reglage ar inte ett problem
 * sa lange bada visar samma lage, och det gor de: lageshallaren ar Skal, via
 * `usePanelLage`.
 */
export function Utseende() {
  const { hopfalld, vaxlaHopfalld } = usePanelLage();

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader titel="Sidopanelen" beskrivning="Gäller på den här enheten och sparas." />
        <Reglage
          etikett="Fäll ihop sidopanelen"
          hjalp="Panelen krymper till enbart ikoner och lämnar mer plats åt innehållet. Gäller från 1024 px och uppåt — på smalare skärmar är panelen redan en utdragslåda."
          pa={hopfalld}
          vaxla={vaxlaHopfalld}
        />
      </Card>
    </div>
  );
}

function Reglage({
  etikett,
  hjalp,
  pa,
  vaxla,
}: {
  etikett: string;
  hjalp: string;
  pa: boolean;
  vaxla: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-body font-semibold text-ink-900">{etikett}</p>
        <p className="mt-1 max-w-[60ch] text-small text-ink-500">{hjalp}</p>
      </div>

      {/* AC-U5.5: traffytan ar 44x44 px aven om sjalva reglaget ar 44x24. */}
      <button
        type="button"
        role="switch"
        aria-checked={pa}
        aria-label={etikett}
        onClick={vaxla}
        className="grid min-h-11 w-11 shrink-0 place-items-center rounded-full"
      >
        <span
          aria-hidden
          className={cn(
            "relative block h-6 w-11 rounded-full transition-colors duration-fast ease-brand",
            pa ? "bg-brand-600" : "bg-ink-300",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 size-5 rounded-full bg-surface shadow-elev-1",
              "transition-[left] duration-fast ease-brand",
              pa ? "left-[1.375rem]" : "left-0.5",
            )}
          />
        </span>
      </button>
    </div>
  );
}
