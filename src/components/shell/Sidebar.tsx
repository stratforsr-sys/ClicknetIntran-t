"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ikon } from "./Ikon";
import { Counter } from "@/components/ui/Badge";
import { cn } from "@/components/ui/cn";
import type { NavItem } from "./nav-items";

/**
 * UI-PRD §5.1. Mork brand-900-yta, radie lg, 16 px marginal mot fonsterkanten
 * pa alla sidor — flytande, inte kant i kant.
 * Panelen innehaller navigation och anvandare. Inget annat.
 *
 * §5.1 vill ocksa att den ska ga att falla ihop. Hopfalld visar den bara
 * ikoner, och bara fran 1024 px och uppat: under den breadden ar panelen en
 * utdragslada som redan ar borta nar den inte anvands, och en ihopfalld lada
 * vore en lada med samma yta men utan text.
 */
export function Sidebar({
  items,
  namn,
  roll,
  oppen,
  stang,
  hopfalld,
  vaxlaHopfalld,
}: {
  items: NavItem[];
  namn: string;
  roll: string;
  oppen: boolean;
  stang: () => void;
  hopfalld: boolean;
  vaxlaHopfalld: () => void;
}) {
  const path = usePathname();

  /** Doljs bara pa stora skarmar — utdragsladan visar alltid hela texten. */
  const doljText = hopfalld ? "lg:hidden" : "";

  return (
    <>
      {/* Under 1024 px dras panelen in over innehallet. */}
      {oppen && (
        <button
          type="button"
          aria-label="Stäng menyn"
          onClick={stang}
          className="fixed inset-0 z-30 bg-ink-900/40 lg:hidden"
        />
      )}

      <aside
        className={cn(
          "on-dark fixed inset-y-4 left-4 z-40 flex w-64 flex-col rounded-lg bg-brand-900 p-4",
          "transition-[transform,width] duration-base ease-brand",
          oppen ? "translate-x-0" : "-translate-x-[calc(100%+1rem)]",
          "lg:translate-x-0",
          hopfalld && "lg:w-[4.5rem] lg:px-2",
        )}
      >
        {/* AC-U1.2/1.3: logotypen ar en <a> till /, fungerar med mittenklick. */}
        <Link
          href="/"
          aria-label="Clicknet Nav — till startsidan"
          className={cn(
            "mb-8 flex items-center gap-2.5 rounded-sm p-2",
            hopfalld && "lg:justify-center lg:px-0",
          )}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-xs bg-brand-500 text-brand-950 font-display text-h2 leading-none">
            C
          </span>
          <span className={cn("font-display text-h2 whitespace-nowrap text-ink-inv", doljText)}>
            Clicknet <span className="text-brand-500">Nav</span>
          </span>
        </Link>

        <nav className="flex flex-1 flex-col gap-1" aria-label="Huvudmeny">
          {items.map((item) => {
            const aktiv = item.href === "/" ? path === "/" : path.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={stang}
                aria-current={aktiv ? "page" : undefined}
                // Hopfalld ar ikonen allt som star kvar. Utan title blir
                // menyn en rad symboler man far gissa sig till.
                title={hopfalld ? item.label : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-full px-4 text-body",
                  "transition-colors duration-fast ease-brand",
                  hopfalld && "lg:justify-center lg:px-0",
                  aktiv
                    ? "bg-brand-800 font-semibold text-ink-inv"
                    : "text-brand-200 hover:bg-brand-800/60 hover:text-ink-inv",
                )}
              >
                <Ikon namn={item.ikon} />
                <span className={cn("flex-1 whitespace-nowrap", doljText)}>{item.label}</span>
                {item.raknare ? <Counter antal={item.raknare} /> : null}
              </Link>
            );
          })}
        </nav>

        {/* Vaxeln finns bara dar panelen star kvar av sig sjalv. */}
        <button
          type="button"
          onClick={vaxlaHopfalld}
          aria-expanded={!hopfalld}
          aria-label={hopfalld ? "Fäll ut menyn" : "Fäll ihop menyn"}
          title={hopfalld ? "Fäll ut menyn" : "Fäll ihop menyn"}
          className={cn(
            "mt-4 hidden min-h-11 items-center gap-3 rounded-full px-4 text-small",
            "text-brand-200 transition-colors duration-fast hover:bg-brand-800/60 hover:text-ink-inv",
            "lg:flex",
            hopfalld && "lg:justify-center lg:px-0",
          )}
        >
          <Ikon
            namn="tillbaka"
            className={cn("size-5 shrink-0 transition-transform duration-base", hopfalld && "rotate-180")}
          />
          <span className={cn("whitespace-nowrap", doljText)}>Fäll ihop</span>
        </button>

        <div className="mt-4 border-t border-brand-800 pt-4">
          <div
            className={cn(
              "flex items-center gap-2 px-2",
              hopfalld && "lg:flex-col lg:gap-1 lg:px-0",
            )}
          >
            {/* Namnet ar vagen till den egna profilen. Det ar dar folk letar. */}
            <Link
              href="/profil"
              onClick={stang}
              aria-current={path.startsWith("/profil") ? "page" : undefined}
              title={hopfalld ? namn : undefined}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-3 rounded-full py-1 pr-2 transition-colors duration-fast hover:bg-brand-800/60",
                hopfalld && "lg:flex-none lg:pr-0",
              )}
            >
              <div className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-800 text-small font-semibold text-brand-200">
                {namn
                  .split(" ")
                  .map((d) => d.charAt(0))
                  .slice(0, 2)
                  .join("")}
              </div>
              <div className={cn("min-w-0 flex-1", doljText)}>
                <p className="truncate text-small font-semibold text-ink-inv">{namn}</p>
                <p className="truncate text-micro uppercase text-brand-200">{roll}</p>
              </div>
            </Link>
            <form action="/auth/logga-ut" method="post">
              <button
                type="submit"
                aria-label="Logga ut"
                title="Logga ut"
                // AC-U5.5: minsta traffyta 44x44 px. Ikonen ar mindre an sa,
                // men klickytan far inte vara det.
                className="grid size-11 place-items-center rounded-full text-brand-200 transition-colors duration-fast hover:bg-brand-800 hover:text-ink-inv"
              >
                <Ikon namn="ut" />
              </button>
            </form>
          </div>
        </div>
      </aside>
    </>
  );
}
