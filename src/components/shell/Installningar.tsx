"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Ikon } from "./Ikon";
import { Utseende } from "./Utseende";
import { cn } from "@/components/ui/cn";

/**
 * Installningarna som en ruta OVANPA fonstret, inte som en egen sida.
 *
 * Skalet ar att installningar sallan ar arendet. Man kommer fran nagot man
 * hall pa med, staller om en sak och ska tillbaka — och en helsida river bort
 * det man hade framfor sig och kraver ett steg bakat for att komma tillbaka.
 * Samma val som macOS Systeminstallningar gor.
 *
 * ELEMENTET AR ETT <dialog>, och det ar avsiktligt. `showModal()` ger
 * fokusfalla, Esc, inert bakgrund och placering i webblasarens topplager
 * gratis. Var och en av dem ar latt att bygga fel for hand, och en fokusfalla
 * som lacker gor rutan obrukbar med tangentbord.
 *
 * /profil finns kvar och visar samma sektioner som egen sida. Djuplankar och
 * bokmarken ska inte ga sonder for att vagen dit blev en ruta, och den som
 * hellre vill ha allt under varandra har kvar den vagen.
 */

type Sektion = {
  id: string;
  titel: string;
  ikon: string;
  innehall: ReactNode;
};

export function Installningar({
  oppen,
  stang,
  namn,
  roll,
  konto,
  sakerhet,
  administration,
}: {
  oppen: boolean;
  stang: () => void;
  namn: string;
  roll: string;
  konto: ReactNode;
  sakerhet: ReactNode;
  /** `null` nar anvandaren inte staller in nagonting — da finns ingen flik. */
  administration: ReactNode | null;
}) {
  const rutan = useRef<HTMLDialogElement>(null);

  const sektioner: Sektion[] = [
    { id: "konto", titel: "Konto", ikon: "konto", innehall: konto },
    { id: "sakerhet", titel: "Säkerhet", ikon: "las", innehall: sakerhet },
    { id: "utseende", titel: "Utseende", ikon: "utseende", innehall: <Utseende /> },
  ];
  if (administration) {
    sektioner.push({
      id: "administration",
      titel: "Administration",
      ikon: "installningar",
      innehall: administration,
    });
  }

  /**
   * Valet ligger kvar mellan oppningar. Den som var inne och stallde om
   * lonesatser och behover in igen ska inte borja om pa Konto varje gang.
   */
  const [valdId, setValdId] = useState("konto");
  const vald = sektioner.find((s) => s.id === valdId) ?? sektioner[0];

  useEffect(() => {
    const d = rutan.current;
    if (!d) return;

    // `d.open` fragas alltid: showModal() pa en redan oppen ruta kastar, och
    // close() pa en stangd skickar ett andra `close`-event.
    if (oppen && !d.open) d.showModal();
    if (!oppen && d.open) d.close();
  }, [oppen]);

  useEffect(() => {
    if (!oppen) return;

    // Ett modalt <dialog> sparrar KLICK bakom sig men inte rullning i alla
    // webblasare. Utan den har raden rullar sidan under rutan nar man
    // scrollar forbi sektionens slut, vilket ser ut som ett fel i rutan.
    const forra = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = forra;
    };
  }, [oppen]);

  return (
    <dialog
      ref={rutan}
      // Esc och varje annan vag ut gar genom `close`, sa lagena kan inte
      // glida isar: rutan stangd men `oppen` fortfarande sann.
      onClose={stang}
      // Ett klick pa bakgrunden rapporteras med sjalva <dialog> som mal.
      // Rutan har darfor ingen egen inre marginal — panelen fyller den helt,
      // annars hade en klick pa marginalen stangt av misstag.
      onClick={(e) => {
        if (e.target === rutan.current) stang();
      }}
      aria-label="Inställningar"
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
          // Hojden foljer fonstret och slar i taket vid 46 rem. Pa en kort
          // skarm — samma sort som klippte av sidopanelen — blir rutan lagre
          // i stallet for att hamna delvis utanfor.
          "h-[min(46rem,calc(100dvh-2rem))] w-[min(60rem,calc(100vw-2rem))]",
          "sm:flex-row",
        )}
      >
        {/* Kategorierna. Kolumn fran 640 px, en rullbar rad under. */}
        <div className="flex shrink-0 flex-col border-b border-canvas bg-canvas/60 p-3 sm:w-60 sm:border-r sm:border-b-0 sm:p-4">
          <div className="mb-3 hidden min-w-0 items-center gap-3 px-2 sm:flex">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-100 text-small font-semibold text-brand-700">
              {initialer(namn)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-small font-semibold text-ink-900">{namn}</span>
              <span className="block truncate text-micro uppercase text-ink-500">{roll}</span>
            </span>
          </div>

          <div
            role="tablist"
            aria-orientation="vertical"
            aria-label="Inställningar"
            className="flex gap-1 overflow-x-auto sm:flex-col sm:overflow-x-visible"
          >
            {sektioner.map((s) => {
              const aktiv = s.id === vald.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  id={`installning-flik-${s.id}`}
                  aria-selected={aktiv}
                  aria-controls={`installning-panel-${s.id}`}
                  onClick={() => setValdId(s.id)}
                  className={cn(
                    "flex min-h-11 shrink-0 items-center gap-3 rounded-full px-4 text-body whitespace-nowrap",
                    "transition-colors duration-fast ease-brand",
                    aktiv
                      ? "bg-surface font-semibold text-ink-900 shadow-elev-1"
                      : "text-ink-500 hover:bg-surface/70 hover:text-ink-900",
                  )}
                >
                  <Ikon namn={s.ikon} />
                  {s.titel}
                </button>
              );
            })}
          </div>
        </div>

        {/* Innehallet. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-canvas px-4 sm:px-6">
            <h2 className="truncate text-h2 text-ink-900">{vald.titel}</h2>
            <button
              type="button"
              onClick={stang}
              aria-label="Stäng inställningar"
              className="grid size-11 shrink-0 place-items-center rounded-full text-ink-500 transition-colors duration-fast hover:bg-canvas hover:text-ink-900"
            >
              <Ikon namn="kryss" />
            </button>
          </header>

          {/*
            Bara den valda sektionen renderas. De ovriga finns i tradet som
            oanvanda noder och kostar ingenting — och ett losenordsformular
            som ligger halvifyllt i en flik man lamnat ar inget man vill ha
            kvar nasta gang rutan oppnas.
          */}
          <div
            key={vald.id}
            role="tabpanel"
            id={`installning-panel-${vald.id}`}
            aria-labelledby={`installning-flik-${vald.id}`}
            tabIndex={0}
            className="min-h-0 flex-1 overflow-y-auto bg-canvas p-4 sm:p-6"
          >
            {vald.innehall}
          </div>

          <footer className="shrink-0 border-t border-canvas px-4 py-3 text-small text-ink-500 sm:px-6">
            <Link
              href="/profil"
              onClick={stang}
              className="text-brand-700 underline underline-offset-4 hover:text-brand-600"
            >
              Öppna som egen sida
            </Link>
          </footer>
        </div>
      </div>
    </dialog>
  );
}

function initialer(namn: string): string {
  return namn
    .split(" ")
    .map((d) => d.charAt(0))
    .slice(0, 2)
    .join("");
}
