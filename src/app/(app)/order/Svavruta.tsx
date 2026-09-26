"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Ikon } from "@/components/shell/Ikon";
import { cn } from "@/components/ui/cn";

/**
 * En ruta ovanpa ordersidan.
 *
 * =============================================================================
 * SAMMA MEKANIK SOM INSTALLNINGSRUTAN, MEDVETET.
 *
 * Bestallaren 2026-09-25: *"da ska det dyka upp en svavande lista precis som
 * installningar"*. Det ar inte bara en onskan om utseende — installningsrutan
 * har fyra beteenden man lart sig av den: Esc stanger, klick utanfor stanger,
 * bakgrunden gar inte att komma at, och bakatknappen tar en tillbaka dit man
 * var. En ruta som ser likadan ut men beter sig annorlunda ar samre an en som
 * ser annorlunda ut.
 *
 * `showModal()` ger de tre forsta gratis: fokusfalla, Esc, inert bakgrund och
 * placering i webblasarens topplager. Var och en av dem ar latt att bygga fel
 * for hand, och en fokusfalla som lacker gor rutan obrukbar med tangentbord.
 *
 * SKILLNADEN MOT `shell/Ruta.tsx` ar att den har inte ar en layout over en
 * parallell rutt. Ordersidan ar EN sida, och rutan oppnas av ett sokfalt i
 * adressen (`?ny=1`, `?kund=<orderid>`). Det racker har, och det halet det
 * lamnar — rutans innehall ritas om nar sidan ritas om — ar inget hal for en
 * sida som redan ar `force-dynamic`.
 * =============================================================================
 */
export function Svavruta({
  rubrik,
  underrubrik,
  /**
   * Adressen rutan stangs TILL — listan med filtret kvar, utan rutans parameter.
   *
   * =========================================================================
   * STANGNINGEN GAR TILL EN ADRESS, INTE BAKAT I HISTORIKEN.
   *
   * `shell/Ruta.tsx` anvander `router.back()`, och det ar ratt DAR: rutan ar en
   * parallell rutt, och panelbyten inuti den anvander `replace`, sa ett steg
   * bakat ar alltid sidan bakom rutan.
   *
   * Har haller det inte. Ett kundkort kan oppnas fran en LANK nagon fatt i ett
   * chattfonster, och da finns inget steg bakat pa den har sidan — `back()`
   * hade tagit personen till foregaende webbplats i stallet for till
   * orderlistan. Vi kan inte heller palitligt avgora vilket av de tva fallen
   * det ar: `history.length` raknar hela flikens historik och `document.referrer`
   * sager ingenting efter en klientnavigering.
   *
   * `replace` till listans egen adress ger samma resultat i bada fallen, och
   * skriver dessutom over rutans adress i stallet for att lagga ett steg till —
   * sa femton oppnade kundkort blir inte femton tryck pa bakatknappen.
   * =========================================================================
   */
  tillbakaTill,
  bredd = "bred",
  children,
}: {
  rubrik: string;
  underrubrik?: ReactNode;
  tillbakaTill: string;
  bredd?: "bred" | "smal";
  children: ReactNode;
}) {
  const rutan = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  // `scroll: false`: listan under rutan ska ligga kvar dar den lag. Den som
  // oppnat det trettonde kortet i en lang lista och stanger det ska sta kvar vid
  // det trettonde kortet, inte kastas upp till sidans borjan.
  const stang = () => router.replace(tillbakaTill, { scroll: false });

  useEffect(() => {
    const d = rutan.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    // Ett modalt <dialog> sparrar KLICK bakom sig men inte rullning i alla
    // webblasare. Utan den har raden rullar sidan under rutan nar man scrollar
    // forbi rutans slut, vilket ser ut som ett fel i rutan.
    const forra = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = forra;
    };
  }, []);

  return (
    <dialog
      ref={rutan}
      onClose={stang}
      // Ett klick pa bakgrunden rapporteras med sjalva <dialog> som mal. Rutan
      // har darfor ingen egen inre marginal — panelen fyller den helt, annars
      // hade ett klick pa marginalen stangt av misstag.
      onClick={(e) => {
        if (e.target === rutan.current) stang();
      }}
      aria-label={rubrik}
      className={cn(
        "m-auto max-h-none max-w-none border-0 bg-transparent p-0 text-ink-700",
        "backdrop:bg-ink-900/40 backdrop:backdrop-blur-sm",
        "motion-safe:animate-[dialog-in_200ms_var(--ease-brand)]",
        "motion-safe:backdrop:animate-[backdrop-in_200ms_var(--ease-brand)]",
      )}
    >
      <div
        className={cn(
          "flex flex-col overflow-hidden rounded-lg bg-surface shadow-elev-4",
          // Hojden foljer fonstret: pa en kort skarm blir rutan lagre i stallet
          // for att hamna delvis utanfor. Samma matt som installningsrutan.
          "h-[min(52rem,calc(100dvh-2rem))]",
          bredd === "bred"
            ? "w-[min(76rem,calc(100vw-2rem))]"
            : "w-[min(46rem,calc(100vw-2rem))]",
        )}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-canvas px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="truncate text-h1 text-ink-900">{rubrik}</h2>
            {underrubrik && <div className="mt-1 text-small text-ink-500">{underrubrik}</div>}
          </div>
          <button
            type="button"
            onClick={stang}
            aria-label={`Stäng ${rubrik}`}
            className="grid size-11 shrink-0 place-items-center rounded-full text-ink-500 transition-colors duration-fast hover:bg-canvas hover:text-ink-900"
          >
            <Ikon namn="kryss" />
          </button>
        </header>

        <div className="nav-scroll min-h-0 flex-1 overflow-y-auto bg-canvas">{children}</div>
      </div>
    </dialog>
  );
}
