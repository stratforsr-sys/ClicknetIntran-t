"use client";

import { useActionState } from "react";
import { cn } from "@/components/ui/cn";
import { Ikon } from "@/components/shell/Ikon";
import type { Lage } from "@/lib/uppgifter";
import { bocka, type UppgiftState } from "./actions";

/**
 * Bocken.
 *
 * ===========================================================================
 * EN CIRKEL OCH INTE EN KRYSSRUTA, och skillnaden är inte estetisk
 *
 * Träffytan är 44 px (AC-U5.5) medan ringen är 20. En riktig
 * `<input type=checkbox>` hade behövt en osynlig utvidgning ändå, och på köpet
 * gett två olika fokusringar beroende på webbläsare.
 *
 * KNAPPEN BYTER BETYDELSE NÄR DET FINNS GRANSKARE. Servern avgör vad som
 * faktiskt händer (`bocka()` i actions.ts); här ändras bara ordet i
 * `aria-label` och i verktygstipset, så att den som trycker vet att uppgiften
 * går vidare till någon annan i stället för att bli klar.
 *
 * EGEN FIL sedan 2026-09-11: listan och uppgiftssidans deluppgifter behöver
 * samma bock. Två kopior hade betytt att den dag den ena lär sig något nytt —
 * ett väntande läge, en ny etikett — ser samma handling olika ut beroende på
 * var man står.
 * ===========================================================================
 */
export function Bock({
  id,
  lage,
  granskare,
  liten = false,
}: {
  id: string;
  lage: Lage;
  granskare: number;
  /** Deluppgifternas variant. Samma träffyta, mindre ring. */
  liten?: boolean;
}) {
  const [state, action, vantar] = useActionState<UppgiftState, FormData>(bocka, {});

  const klar = lage === "klar";
  const vantarPaGranskare = lage === "granskas";
  const avbruten = lage === "avbruten";

  const etikett = klar
    ? "Klar"
    : avbruten
      ? "Avbruten"
      : vantarPaGranskare
        ? "Väntar på godkännande"
        : granskare > 0
          ? "Lämna in för godkännande"
          : "Markera som klar";

  return (
    <form action={action} className="shrink-0">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={vantar || klar || vantarPaGranskare || avbruten}
        aria-label={etikett}
        title={state.fel ?? etikett}
        className={cn(
          "flex items-center justify-center rounded-full transition-transform duration-fast",
          "focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:outline-none",
          liten ? "size-9" : "size-11 -translate-x-2",
          !klar && !vantarPaGranskare && !avbruten && "active:scale-90",
        )}
      >
        <span
          className={cn(
            "flex items-center justify-center rounded-full ring-2 transition-colors duration-fast",
            liten ? "size-4" : "size-5",
            klar
              ? "bg-ok text-ink-inv ring-ok"
              : avbruten
                ? "bg-canvas ring-ink-300"
                : vantarPaGranskare
                  ? "bg-warn-tint ring-warn"
                  : "ring-ink-300 hover:ring-brand-600 group-hover:ring-brand-600",
            state.fel && "ring-danger",
          )}
        >
          {klar && <Ikon namn="kontroll" className={liten ? "size-2.5" : "size-3"} />}
          {vantarPaGranskare && <span aria-hidden className="size-1.5 rounded-full bg-warn" />}
          {avbruten && <span aria-hidden className="h-px w-2 bg-ink-300" />}
        </span>
      </button>
    </form>
  );
}
