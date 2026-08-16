"use client";

import { useEffect, useRef } from "react";
import { Ikon } from "./Ikon";

/**
 * UI-PRD §5.2. Sokfaltet ar understruket i vila enligt referens A — inte en
 * tung ifylld ruta. Hojs till elev-1 och far ring i fokus.
 * Toppraden scrollar inte bort och ar max 64 px hog.
 */
export function Topbar({ oppnaMeny }: { oppnaMeny: () => void }) {
  const sok = useRef<HTMLInputElement>(null);

  // Kortkommando / fokuserar soket (UI-PRD §5.2).
  useEffect(() => {
    function vidTangent(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const skriver = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (e.key === "/" && !skriver) {
        e.preventDefault();
        sok.current?.focus();
      }
    }
    window.addEventListener("keydown", vidTangent);
    return () => window.removeEventListener("keydown", vidTangent);
  }, []);

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 bg-canvas/85 backdrop-blur-sm">
      <button
        type="button"
        onClick={oppnaMeny}
        aria-label="Öppna menyn"
        className="grid size-11 shrink-0 place-items-center rounded-full text-ink-700 hover:bg-surface lg:hidden"
      >
        <Ikon namn="meny" />
      </button>

      <div className="group flex min-w-0 flex-1 items-center gap-3 rounded-sm border-b border-ink-300/60 px-2 py-2 transition-shadow duration-fast ease-brand focus-within:border-transparent focus-within:bg-surface focus-within:px-4 focus-within:shadow-elev-2 focus-within:ring-2 focus-within:ring-brand-600">
        <Ikon namn="sok" className="size-5 shrink-0 text-ink-500" />
        <input
          ref={sok}
          type="search"
          disabled
          placeholder="Sök — kommer med rutinbiblioteket"
          aria-label="Sök i navet"
          className="min-w-0 flex-1 bg-transparent text-body text-ink-900 placeholder:text-ink-300 focus:outline-none disabled:cursor-not-allowed"
        />
        <kbd className="hidden shrink-0 rounded-xs bg-canvas px-2 py-0.5 text-micro text-ink-500 sm:block">
          /
        </kbd>
      </div>

      <button
        type="button"
        aria-label="Notiser"
        className="grid size-11 shrink-0 place-items-center rounded-full text-ink-700 transition-colors duration-fast hover:bg-surface"
      >
        <Ikon namn="klocka" />
      </button>
    </header>
  );
}
