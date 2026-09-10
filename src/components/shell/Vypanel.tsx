"use client";

import Link from "next/link";
import { Ikon } from "./Ikon";
import { Counter } from "@/components/ui/Badge";
import { cn } from "@/components/ui/cn";
import { arAktiv } from "./sidopanel";
import { navAnkare } from "@/guider/ankare";
import type { NavMeny } from "./nav-items";

/**
 * Andra spalten: sidorna i en meny.
 *
 * ===========================================================================
 * EN NIVÅ, INGA FLIKAR.
 *
 * Menyn ÄR avgränsningen. Första försöket hade en "Chefsvy" med chips för
 * Försäljning, Ekonomi och Personal inuti, och det var ett led för mycket:
 * man valde avdelning för att sedan välja avdelning igen. Nu står
 * avdelningarna i panelen och spalten innehåller bara deras sidor.
 *
 * Ingen rubrik heller. Namnet står redan på knappen man just tryckte på, och
 * spalten är dessutom placerad så att första raden ligger i linje med den —
 * en rubrik hade skjutit ner listan och brutit just den linjen. Se Sidebar.tsx.
 * ===========================================================================
 *
 * Komponenten ritas på TVÅ ställen — som svävande spalt bredvid sidopanelen på
 * dator, och inbäddad i utdragslådan på telefon. `ankare` är därför en prop och
 * inte något komponenten bestämmer själv: `data-guide` får bara sitta på EN av
 * dem, annars finns samma ankare två gånger i trädet och en guidad tur pekar på
 * den som råkar stå först — vilket på en telefon är den som är dold.
 */
export function Vypanel({
  meny,
  path,
  stang,
  ankare,
  className,
}: {
  meny: NavMeny;
  path: string;
  stang: () => void;
  ankare: boolean;
  className?: string;
}) {
  return (
    // Egen scroll: en lång meny kan bli högre än fönstret, och en lista som
    // klipps av utan att säga det är samma fel som sidopanelen hade före
    // 2026-08.
    <div
      className={cn(
        "nav-scroll flex min-h-0 flex-col gap-0.5 overflow-y-auto overscroll-contain",
        className,
      )}
    >
      {meny.poster.map((post) => {
        const aktiv = arAktiv(path, post.href);
        return (
          <Link
            key={post.href}
            href={post.href}
            onClick={stang}
            data-guide={ankare ? navAnkare(post.href) : undefined}
            aria-current={aktiv ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center gap-3 rounded-full px-4 text-body",
              "transition-colors duration-fast ease-brand",
              aktiv
                ? "bg-brand-800 font-semibold text-ink-inv ring-1 ring-inset ring-brand-700"
                : "text-brand-200 hover:bg-brand-800/60 hover:text-ink-inv",
            )}
          >
            <Ikon namn={post.ikon} className={cn("size-5 shrink-0", aktiv && "text-brand-400")} />
            <span className="min-w-0 flex-1 truncate">{post.label}</span>
            {post.raknare ? <Counter antal={post.raknare} /> : null}
          </Link>
        );
      })}
    </div>
  );
}
