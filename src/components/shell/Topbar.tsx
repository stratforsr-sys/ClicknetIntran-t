"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Ikon } from "./Ikon";
import { SOK_HANDELSE } from "./Bottennav";
import { Notisklocka } from "./Notisklocka";
import type { Notis } from "@/lib/notiser";

/**
 * UI-PRD §5.2. Sokfaltet ar understruket i vila enligt referens A — inte en
 * tung ifylld ruta. Hojs till elev-1 och far ring i fokus.
 * Toppraden scrollar inte bort och ar max 64 px hog.
 *
 * Soket gar till /sok sedan E2.13: en samlad traffsida over rutiner och deras
 * bilagor, nyheter, kurser, personal och egna arenden. Varje fraga dar stalls
 * med anvandarens egen token, sa RLS avgor vad som syns.
 */
export function Topbar({ oppnaMeny, notiser }: { oppnaMeny: () => void; notiser: Notis[] }) {
  const sok = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const sp = useSearchParams();

  // Kortkommando / fokuserar soket (UI-PRD §5.2). Bottenradens sokknapp
  // gor samma sak via en handelse i stallet for en prop — falten ska vara
  // ett enda, och da behover ingen skicka en referens genom skalet.
  useEffect(() => {
    const fokusera = () => sok.current?.focus();

    function vidTangent(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const skriver = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (e.key === "/" && !skriver) {
        e.preventDefault();
        fokusera();
      }
    }

    window.addEventListener("keydown", vidTangent);
    window.addEventListener(SOK_HANDELSE, fokusera);
    return () => {
      window.removeEventListener("keydown", vidTangent);
      window.removeEventListener(SOK_HANDELSE, fokusera);
    };
  }, []);

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 bg-canvas/85 backdrop-blur-sm">
      {/* Under 768 px ligger "Mer" i bottenraden i stallet. Tva knappar som
          oppnar samma panel, en i varje horn, ar en fraga for lasaren utan
          svar. Hamburgaren behovs bara i spannet 768–1024 px. */}
      <button
        type="button"
        onClick={oppnaMeny}
        aria-label="Öppna menyn"
        className="hidden size-11 shrink-0 place-items-center rounded-full text-ink-700 hover:bg-surface md:grid lg:hidden"
      >
        <Ikon namn="meny" />
      </button>

      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const q = new FormData(e.currentTarget).get("q");
          const text = String(q ?? "").trim();
          router.push(text ? `/sok?q=${encodeURIComponent(text)}` : "/sok");
        }}
        className="group flex min-w-0 flex-1 items-center gap-3 rounded-sm border-b border-ink-300/60 px-2 py-2 transition-shadow duration-fast ease-brand focus-within:border-transparent focus-within:bg-surface focus-within:px-4 focus-within:shadow-elev-2 focus-within:ring-2 focus-within:ring-brand-600">
        <Ikon namn="sok" className="size-5 shrink-0 text-ink-500" />
        <input
          ref={sok}
          type="search"
          name="q"
          defaultValue={sp.get("q") ?? ""}
          placeholder="Sök i navet"
          aria-label="Sök i navet"
          className="min-w-0 flex-1 bg-transparent text-body text-ink-900 placeholder:text-ink-300 focus:outline-none"
        />
        <kbd className="hidden shrink-0 rounded-xs bg-canvas px-2 py-0.5 text-micro text-ink-500 sm:block">
          /
        </kbd>
      </form>

      <Notisklocka notiser={notiser} />
    </header>
  );
}
