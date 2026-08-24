"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Ikon } from "./Ikon";
import { cn } from "@/components/ui/cn";
import { arAdministration, type InstallningsPost } from "./installningar-delade";

/**
 * Installningarna som en ruta OVANPA fonstret, inte som en egen sida.
 *
 * Skalet ar att installningar sallan ar arendet. Man kommer fran nagot man
 * hall pa med, staller om en sak och ska tillbaka — och en helsida river bort
 * det man hade framfor sig. Samma val som macOS Systeminstallningar gor.
 *
 * ELEMENTET AR ETT <dialog>. `showModal()` ger fokusfalla, Esc, inert
 * bakgrund och placering i webblasarens topplager gratis. Var och en av dem
 * ar latt att bygga fel for hand, och en fokusfalla som lacker gor rutan
 * obrukbar med tangentbord.
 *
 * KOMPONENTEN AR EN LAYOUT och inte en sida. Den ligger i
 * `@ruta/(dialog)/layout.tsx` sa att den star kvar nar man byter panel —
 * lag den i varje panelsida hade <dialog>-elementet bytts ut vid varje klick,
 * vilket stanger och oppnar rutan pa nytt med blink och tappat fokus.
 */
export function Ruta({
  poster,
  namn,
  roll,
  children,
}: {
  poster: InstallningsPost[];
  namn: string;
  roll: string;
  children: ReactNode;
}) {
  const rutan = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const path = usePathname();

  /**
   * Stangning gar ALLTID via historiken och aldrig via `close()`.
   *
   * Rutan ar en rutt: den syns for att adressen pekar pa en panel. Stangde vi
   * bara elementet hade adressen blivit kvar, och nasta klick pa bakatknappen
   * hade oppnat rutan igen fran ingenstans.
   *
   * Att `back()` racker beror pa att panelbyten anvander `replace` och inte
   * lagger nya steg i historiken — se lankarna nedan. Ett steg bakat ar
   * darfor alltid sidan man kom ifran, aven efter fem panelbyten.
   */
  const stang = () => router.back();

  useEffect(() => {
    const d = rutan.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    // Ett modalt <dialog> sparrar KLICK bakom sig men inte rullning i alla
    // webblasare. Utan den har raden rullar sidan under rutan nar man
    // scrollar forbi panelens slut, vilket ser ut som ett fel i rutan.
    const forra = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = forra;
    };
  }, []);

  const aktiv = poster.find((p) => p.href === path);
  const egna = poster.filter((p) => !arAdministration(p));
  const admin = poster.filter(arAdministration);

  return (
    <dialog
      ref={rutan}
      onClose={stang}
      // Ett klick pa bakgrunden rapporteras med sjalva <dialog> som mal.
      // Rutan har darfor ingen egen inre marginal — panelen fyller den helt,
      // annars hade ett klick pa marginalen stangt av misstag.
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
          // Bredare an de tre egna panelerna behover, for att
          // administrationspanelerna bar formular och tabeller. Hojden foljer
          // fonstret: pa en kort skarm blir rutan lagre i stallet for att
          // hamna delvis utanfor.
          "h-[min(48rem,calc(100dvh-2rem))] w-[min(76rem,calc(100vw-2rem))]",
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

          <nav
            aria-label="Inställningar"
            className="nav-scroll flex min-h-0 flex-1 gap-1 overflow-x-auto sm:flex-col sm:overflow-x-visible sm:overflow-y-auto"
          >
            {egna.map((p) => (
              <Post key={p.href} post={p} aktiv={p.href === aktiv?.href} />
            ))}

            {admin.length > 0 && (
              <>
                <p className="mt-3 hidden px-4 pb-1 text-micro uppercase text-ink-500 sm:block">
                  Administration
                </p>
                {admin.map((p) => (
                  <Post key={p.href} post={p} aktiv={p.href === aktiv?.href} />
                ))}
              </>
            )}
          </nav>
        </div>

        {/* Panelen. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-canvas px-4 sm:px-6">
            <h2 className="truncate text-h2 text-ink-900">{aktiv?.label ?? "Inställningar"}</h2>
            <button
              type="button"
              onClick={stang}
              aria-label="Stäng inställningar"
              className="grid size-11 shrink-0 place-items-center rounded-full text-ink-500 transition-colors duration-fast hover:bg-canvas hover:text-ink-900"
            >
              <Ikon namn="kryss" />
            </button>
          </header>

          {/* `key` pa adressen: en ny panel ska borja hogst upp och inte arva
              rullningen fran den forra. */}
          <div key={path} className="min-h-0 flex-1 overflow-y-auto bg-canvas p-4 sm:p-6">
            {children}
          </div>

          <footer className="shrink-0 border-t border-canvas px-4 py-3 text-small text-ink-500 sm:px-6">
            {/*
              VANLIG <a> OCH INTE <Link>, med flit. Adressen ar densamma som
              rutan redan star pa — det ar interceptionen som gor skillnaden,
              och den galler bara klientnavigering. En <Link> hade darfor
              ritat om samma panel i samma ruta och sett trasig ut. En full
              laddning traffar `default.tsx` i sloten i stallet, och da ritas
              panelen som helsida.
            */}
            <a
              href={path}
              className="text-brand-700 underline underline-offset-4 hover:text-brand-600"
            >
              Öppna som egen sida
            </a>
          </footer>
        </div>
      </div>
    </dialog>
  );
}

function Post({ post, aktiv }: { post: InstallningsPost; aktiv: boolean }) {
  return (
    <Link
      href={post.href}
      // `replace`: panelbyten ska inte fylla historiken. Se `stang` ovan —
      // det ar det som gor att ett steg bakat alltid ar sidan bakom rutan.
      // `scroll={false}`: sidan under rutan ska ligga kvar dar den lag.
      replace
      scroll={false}
      aria-current={aktiv ? "page" : undefined}
      className={cn(
        "flex min-h-11 shrink-0 items-center gap-3 rounded-full px-4 text-body whitespace-nowrap",
        "transition-colors duration-fast ease-brand",
        aktiv
          ? "bg-surface font-semibold text-ink-900 shadow-elev-1"
          : "text-ink-500 hover:bg-surface/70 hover:text-ink-900",
      )}
    >
      <Ikon namn={post.ikon} />
      {post.label}
    </Link>
  );
}

function initialer(namn: string): string {
  return namn
    .split(" ")
    .map((d) => d.charAt(0))
    .slice(0, 2)
    .join("");
}
