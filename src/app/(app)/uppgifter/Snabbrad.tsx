"use client";

import { useActionState, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { Ikon } from "@/components/shell/Ikon";
import { Notis } from "@/components/ui/Notis";
import { PRIORITET_ETIKETT, fristtext, tidstext, tolkaSnabbrad, visaPrioritet } from "@/lib/uppgifter";
import { skapaUppgift, type UppgiftState } from "./actions";

/**
 * Snabbinmatningen.
 *
 * ===========================================================================
 * ETT FÄLT, INTE ETT FORMULÄR
 *
 * Det som avgör om en uppgiftsmodul används är inte vad den kan göra med en
 * uppgift som redan finns — det är hur billigt det är att få in den. Ett
 * datumfält, en personväljare och en prioritetsmeny är fem klick, och fem klick
 * är dyrare än en post-it-lapp. Därför bär EN RAD allt:
 *
 *   Ring Nordic AB på tisdag 14:00 30 min !1 #Mässan @Anna
 *
 * TOLKNINGEN VISAS MEDAN MAN SKRIVER, och det är komponentens andra halva.
 * Chipsen under fältet är inte en bekräftelse utan en LÄXA: den som ser
 * "tis 15 sep" dyka upp när hen skrev "på tisdag" har lärt sig syntaxen utan
 * att läsa någon hjälptext, och den som ser att ingenting dök upp vet direkt
 * att ordet inte togs — i stället för att upptäcka det när fristen uteblir.
 *
 * SERVERN TOLKAR OM RADEN. `tolkaSnabbrad()` är ren och körs på båda ställena,
 * men det är serverns svar som sparas. Chipsen är alltså en förhandsbild, inte
 * ett löfte — se skapaUppgift() i actions.ts.
 * ===========================================================================
 */
export function Snabbrad({
  projektNamn,
  projektId,
  placeholder = "Vad ska göras?",
}: {
  projektNamn: string[];
  /**
   * Lägg uppgiften i det här projektet.
   *
   * Skickas som ett dolt fält och inte som en del av raden. `#projekt` i
   * texten vinner ändå om någon skriver det — se `skapaUppgift()` — vilket
   * är rätt ordning: det uttryckligen skrivna slår det underförstådda.
   */
  projektId?: string;
  placeholder?: string;
}) {
  const [state, action, vantar] = useActionState<UppgiftState, FormData>(skapaUppgift, {});
  const [rad, setRad] = useState("");
  const faltet = useRef<HTMLInputElement>(null);

  const idag = useMemo(() => {
    // Svensk väggtid. Servern räknar om ändå, men chipsen ska visa samma dag
    // som den som står vid tangentbordet har på sin klocka.
    const delar = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
    return delar;
  }, []);

  const tolkad = useMemo(() => (rad.trim() ? tolkaSnabbrad(rad, idag) : null), [rad, idag]);

  /**
   * N ÖPPNAR FÄLTET VAR MAN ÄN STÅR PÅ SIDAN.
   *
   * Inte i ett annat fält, och inte när något ändringskommando hålls nere —
   * annars hade Cmd+N (nytt fönster) och all vanlig skrivning fastnat här.
   */
  useEffect(() => {
    const pa = (e: KeyboardEvent) => {
      if (e.key !== "n" && e.key !== "N") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const mal = e.target as HTMLElement | null;
      const taggen = mal?.tagName;
      if (taggen === "INPUT" || taggen === "TEXTAREA" || taggen === "SELECT" || mal?.isContentEditable) return;

      e.preventDefault();
      faltet.current?.focus();
    };

    window.addEventListener("keydown", pa);
    return () => window.removeEventListener("keydown", pa);
  }, []);

  // Fältet töms när raden sparats, och behåller fokus: den som fångar en tanke
  // fångar oftast två.
  useEffect(() => {
    if (state.ok) {
      setRad("");
      faltet.current?.focus();
    }
  }, [state.ok]);

  return (
    <form action={action} className="flex flex-col gap-2">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {projektId && <input type="hidden" name="project_id" value={projektId} />}

      <div className="relative">
        <span aria-hidden className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-ink-300">
          <Ikon namn="plus" className="size-5" />
        </span>

        <input
          ref={faltet}
          id="snabbrad"
          name="rad"
          value={rad}
          onChange={(e) => setRad(e.target.value)}
          autoComplete="off"
          placeholder={placeholder}
          aria-label="Ny uppgift"
          aria-describedby="snabbrad-hjalp"
          className={cn(
            "w-full rounded-full bg-surface py-3.5 pr-28 pl-12 text-body text-ink-900",
            "shadow-elev-1 ring-1 ring-transparent placeholder:text-ink-300",
            "transition-shadow duration-fast ease-brand",
            "focus:shadow-elev-2 focus:ring-2 focus:ring-brand-600 focus:outline-none",
          )}
        />

        <button
          type="submit"
          disabled={vantar || rad.trim() === ""}
          className={cn(
            "absolute top-1/2 right-2 -translate-y-1/2 rounded-full px-5 py-2 text-small font-semibold",
            "bg-brand-600 text-ink-inv shadow-elev-brand transition-all duration-fast ease-brand",
            "hover:bg-brand-700 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40",
          )}
        >
          {vantar ? "Lägger…" : "Lägg till"}
        </button>
      </div>

      {/* Tolkningen. Står bara när raden gav något — en tom chipsrad som alltid
          syns hade varit en till sak att läsa förbi. */}
      {tolkad && (tolkad.due_date || tolkad.estimate_minutes || tolkad.projekt || tolkad.person || visaPrioritet(tolkad.priority)) && (
        <div className="flex flex-wrap items-center gap-1.5 px-4">
          {tolkad.due_date && (
            <Chip ton="brand">
              {fristtext(tolkad.due_date, idag)}
              {tolkad.due_time ? ` ${tolkad.due_time}` : ""}
            </Chip>
          )}
          {tolkad.estimate_minutes && <Chip>{tidstext(tolkad.estimate_minutes)}</Chip>}
          {visaPrioritet(tolkad.priority) && (
            <Chip ton={tolkad.priority === 1 ? "danger" : "warn"}>{PRIORITET_ETIKETT[tolkad.priority]}</Chip>
          )}
          {tolkad.projekt && (
            <Chip ton={projektNamn.some((n) => n.toLowerCase() === tolkad.projekt!.toLowerCase()) ? "brand" : "neutral"}>
              #{tolkad.projekt}
            </Chip>
          )}
          {tolkad.person && <Chip>@{tolkad.person}</Chip>}
        </div>
      )}

      <p id="snabbrad-hjalp" className="px-4 text-small text-ink-500">
        Tryck <Tangent>N</Tangent> var som helst för att hamna här. Skriv tid och plats direkt i raden —
        <span className="text-ink-700"> på tisdag 14:00</span>,
        <span className="text-ink-700"> om 3 dagar</span>,
        <span className="text-ink-700"> 30 min</span>,
        <span className="text-ink-700"> !1</span> för brådskande,
        <span className="text-ink-700"> #projekt</span>,
        <span className="text-ink-700"> @person</span>.
      </p>
    </form>
  );
}

function Chip({ children, ton = "neutral" }: { children: ReactNode; ton?: "neutral" | "brand" | "warn" | "danger" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-micro",
        ton === "brand"
          ? "bg-brand-tint text-brand-ink"
          : ton === "warn"
            ? "bg-warn-tint text-warn-ink"
            : ton === "danger"
              ? "bg-danger-tint text-danger-ink"
              : "bg-canvas text-ink-500",
      )}
    >
      {children}
    </span>
  );
}

function Tangent({ children }: { children: ReactNode }) {
  return (
    <kbd className="mx-0.5 rounded-xs bg-canvas px-1.5 py-0.5 font-mono text-micro text-ink-700">{children}</kbd>
  );
}
