"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ikon } from "./Ikon";
import { cn } from "@/components/ui/cn";

/** Toppradens sokfalt lyssnar pa den har. Se Topbar. */
export const SOK_HANDELSE = "nav:sok";

/**
 * UI-PRD §6: bottennavigering under 768 px. Hem, Sok, Stampla, Mer.
 *
 * Skalet ar inte att harma en telefonapp. Saljaren stamplar in i dorren, med
 * telefonen i ena handen och nagot annat i den andra, och tummen nar
 * underkanten — inte hamburgaren i motsatt horn. Stamplingen ar dessutom det
 * enda hen gor har varje dag, och AC-2.1 lovar max tva knapptryck. Ett tryck
 * gar at att oppna menyn om den enda vagen dit ar genom den.
 *
 * Stampelposten visas bara nar modulen ar pa — samma regel som sidopanelen
 * foljer. En knapp som leder till nagot som inte far anvandas larr anvandaren
 * att menyn ljuger, och da slutar hen lita pa resten av den ocksa.
 */
export function Bottennav({
  stamplingPa,
  oppnaMeny,
}: {
  stamplingPa: boolean;
  oppnaMeny: () => void;
}) {
  const path = usePathname();

  const klass = (aktiv: boolean) =>
    cn(
      // AC-U5.5: traffytan ar minst 44x44 px. Har ar den hela rutan.
      "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-sm",
      "text-micro uppercase transition-colors duration-fast",
      aktiv ? "font-semibold text-brand-700" : "text-ink-500 hover:text-ink-900",
    );

  return (
    <nav
      aria-label="Snabbnavigering"
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 flex items-stretch gap-1 px-2 md:hidden",
        "border-t border-ink-300/40 bg-surface/95 backdrop-blur-sm",
        // Hemknappen pa en iPhone ligger dar raden annars hade slutat.
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <Link href="/" aria-current={path === "/" ? "page" : undefined} className={klass(path === "/")}>
        <Ikon namn="hem" />
        Hem
      </Link>

      {/* Soket bor i toppraden och ska fortsatta gora det — tva sokfalt pa
          samma skarm ar tva stallen att undra over. Knappen flyttar bara
          fokus dit, vilket ocksa oppnar tangentbordet. */}
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event(SOK_HANDELSE))}
        className={klass(false)}
      >
        <Ikon namn="sok" />
        Sök
      </button>

      {stamplingPa && (
        <Link
          href="/tid"
          aria-current={path.startsWith("/tid") ? "page" : undefined}
          className={klass(path.startsWith("/tid"))}
        >
          <Ikon namn="tid" />
          Stämpla
        </Link>
      )}

      <button type="button" onClick={oppnaMeny} aria-label="Öppna menyn" className={klass(false)}>
        <Ikon namn="meny" />
        Mer
      </button>
    </nav>
  );
}
