"use client";

import Link from "next/link";
import { Ikon } from "./Ikon";
import { Counter } from "@/components/ui/Badge";
import { cn } from "@/components/ui/cn";
import { arAktiv } from "./sidopanel";
import { navAnkare } from "@/guider/ankare";
import type { NavVy } from "./nav-items";

/**
 * Andra spalten: innehållet i en vy.
 *
 * ===========================================================================
 * TVÅ LED, INTE TRE.
 *
 * Vyn väljs i panelen, gruppen väljs här uppe som chips, och sidorna står
 * under. Det var frestande att göra grupperna till en egen kolumn till — en
 * spalt med "Försäljning ›" som fäller ut en tredje — men tre led betyder att
 * musen måste hålla sig innanför två smala korridorer i rad för att inte tappa
 * menyn. Chips står still, tål att man missar dem, och rymmer ett fack till
 * utan att någonting behöver ritas om.
 *
 * "Alla" är förvalt om personen inte har en egen avdelning i vyn. Det är
 * medvetet: den som öppnar en vy första gången ska se allt som finns i den,
 * inte en delmängd hen måste lista ut att hen tittar på.
 * ===========================================================================
 *
 * Komponenten ritas på TVÅ ställen — som svävande panel bredvid sidopanelen på
 * dator, och inbäddad i utdragslådan på telefon. `ankare` är därför en prop och
 * inte något komponenten bestämmer själv: `data-guide` får bara sitta på EN av
 * dem, annars finns samma ankare två gånger i trädet och en guidad tur pekar på
 * den som råkar stå först — vilket på en telefon är den som är dold.
 */
export function Vypanel({
  vy,
  vald,
  valj,
  path,
  stang,
  ankare,
  className,
}: {
  vy: NavVy;
  /** Vald grupp, eller `null` för "Alla". */
  vald: string | null;
  valj: (grupp: string | null) => void;
  path: string;
  stang: () => void;
  ankare: boolean;
  className?: string;
}) {
  // Bara en grupp i vyn? Då är chipsraden ett val mellan "allt" och "allt".
  const visaChips = vy.grupper.length > 1;
  const visade = vald ? vy.grupper.filter((g) => g.id === vald) : vy.grupper;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <p className="px-2 text-micro font-semibold uppercase tracking-wide text-brand-400">
        {vy.etikett}
      </p>

      {visaChips && (
        <div className="flex flex-wrap gap-1" role="group" aria-label={`Filtrera ${vy.etikett}`}>
          <Chip etikett="Alla" vald={vald === null} valj={() => valj(null)} />
          {vy.grupper.map((grupp) => (
            <Chip
              key={grupp.id}
              etikett={grupp.etikett}
              ikon={grupp.ikon}
              vald={vald === grupp.id}
              valj={() => valj(grupp.id)}
            />
          ))}
        </div>
      )}

      {/* Egen scroll: en adminvy med alla grupper öppna kan bli längre än
          fönstret, och en lista som klipps av utan att säga det är samma fel
          som sidopanelen hade före 2026-08. */}
      <div className="nav-scroll -mr-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain pr-1">
        {visade.map((grupp) => (
          <div key={grupp.id} className="flex flex-col gap-0.5">
            {/* Rubriken behövs bara när flera grupper står under varandra.
                Med en vald grupp säger chipsen redan vilken det är. */}
            {visade.length > 1 && (
              <p className="flex items-center gap-2 px-3 pb-1 pt-1 text-micro font-semibold uppercase tracking-wide text-brand-400">
                <Ikon namn={grupp.ikon} className="size-3.5 shrink-0" />
                {grupp.etikett}
              </p>
            )}

            {grupp.poster.map((post) => {
              const aktiv = arAktiv(path, post.href);
              return (
                <Link
                  key={post.href}
                  href={post.href}
                  onClick={stang}
                  data-guide={ankare ? navAnkare(post.href) : undefined}
                  aria-current={aktiv ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center gap-3 rounded-full px-3 text-body",
                    "transition-colors duration-fast ease-brand",
                    aktiv
                      ? "bg-brand-800 font-semibold text-ink-inv ring-1 ring-inset ring-brand-700"
                      : "text-brand-200 hover:bg-brand-800/60 hover:text-ink-inv",
                  )}
                >
                  <Ikon
                    namn={post.ikon}
                    className={cn("size-5 shrink-0", aktiv && "text-brand-400")}
                  />
                  <span className="min-w-0 flex-1 truncate">{post.label}</span>
                  {post.raknare ? <Counter antal={post.raknare} /> : null}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function Chip({
  etikett,
  ikon,
  vald,
  valj,
}: {
  etikett: string;
  ikon?: string;
  vald: boolean;
  valj: () => void;
}) {
  return (
    <button
      type="button"
      onClick={valj}
      aria-pressed={vald}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-small whitespace-nowrap",
        "transition-colors duration-fast ease-brand",
        vald
          ? "bg-brand-500 font-semibold text-brand-950"
          : "bg-brand-800/60 text-brand-200 hover:bg-brand-800 hover:text-ink-inv",
      )}
    >
      {ikon && <Ikon namn={ikon} className="size-3.5 shrink-0" />}
      {etikett}
    </button>
  );
}
