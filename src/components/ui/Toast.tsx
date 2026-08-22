"use client";

import { useEffect, useRef, useState } from "react";
import { SEKUNDER, TOAST_KAKA, type Kvitto } from "@/lib/toast";
import { angra } from "@/app/(app)/angra/actions";

/**
 * E5.7 / UI-PRD §5.7. Kvittot nere till hoger.
 *
 * Kvittot kommer fran servern via en kortlivad kaka, inte fran ett tillstand i
 * webblasaren. Skalet ar att atgarderna i navet ar server actions som gor en
 * omdirigering: ett tillstand satt fore navigeringen hade forsvunnit med den.
 * Kakan overlever exakt en sidvisning och raderas har.
 *
 * ===========================================================================
 * DEN FORSVINNER INTE MEDAN NAGON HALLER PA ATT LASA DEN.
 *
 * Nedrakningen pausas nar pekaren ar over rutan, och stangs av helt sa fort
 * nagot inuti far tangentbordsfokus. En angra-knapp som forsvinner mitt i ett
 * tangentbordssteg ar en knapp som inte finns for den som anvander tangentbord.
 *
 * `prefers-reduced-motion` tar bort inglidningen, inte kvittot.
 * ===========================================================================
 */
export function Toast({ kvitto }: { kvitto: Kvitto | null }) {
  const [synlig, setSynlig] = useState(Boolean(kvitto));
  const [pausad, setPausad] = useState(false);
  const [fokuserad, setFokuserad] = useState(false);
  const rutan = useRef<HTMLDivElement>(null);

  // Kakan ar forbrukad sa fort den ritats. Utan det star kvittot kvar pa nasta
  // sida ocksa, och sager att nagot hande som hande for tva klick sedan.
  useEffect(() => {
    if (!kvitto) return;
    document.cookie = `${TOAST_KAKA}=; path=/; max-age=0; samesite=lax`;
  }, [kvitto]);

  useEffect(() => {
    if (!kvitto || !synlig || pausad || fokuserad) return;
    const id = setTimeout(() => setSynlig(false), SEKUNDER * 1000);
    return () => clearTimeout(id);
  }, [kvitto, synlig, pausad, fokuserad]);

  if (!kvitto || !synlig) return null;

  return (
    <div
      /**
       * `status` och inte `alert`: ett kvitto pa nagot anvandaren sjalv nyss
       * gjorde ska last upp nar skarmlasaren ar klar med det den holl pa med,
       * inte avbryta mitt i. UI-PRD §8 — systemet ropar inte.
       */
      role="status"
      aria-live="polite"
      ref={rutan}
      onMouseEnter={() => setPausad(true)}
      onMouseLeave={() => setPausad(false)}
      onFocusCapture={() => setFokuserad(true)}
      className={
        // Over bottenraden pa mobil (den ar 4 rem hog), nere till hoger pa
        // storre skarmar. Aldrig over innehallet i mitten.
        "fixed right-4 bottom-24 z-50 md:bottom-6 " +
        "flex max-w-[min(28rem,calc(100vw-2rem))] items-center gap-4 " +
        "rounded-md bg-ink-900 px-4 py-3 text-ink-inv shadow-elev-2 " +
        "motion-safe:animate-[toast-in_180ms_ease-out]"
      }
    >
      <p className="min-w-0 flex-1 text-small">{kvitto.text}</p>

      {kvitto.angra && (
        <form action={angra}>
          <input type="hidden" name="handling" value={kvitto.angra.handling} />
          <input type="hidden" name="id" value={kvitto.angra.id} />
          <button
            type="submit"
            className="min-h-11 shrink-0 rounded-full px-4 font-semibold text-brand-300 underline underline-offset-2 hover:text-brand-200"
          >
            Ångra
          </button>
        </form>
      )}

      <button
        type="button"
        onClick={() => setSynlig(false)}
        aria-label="Stäng"
        className="shrink-0 rounded-full p-2 text-ink-inv/60 hover:bg-ink-inv/10 hover:text-ink-inv"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
