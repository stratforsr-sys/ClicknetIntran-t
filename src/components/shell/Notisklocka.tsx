"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ikon } from "./Ikon";
import { cn } from "@/components/ui/cn";
import { narTid, TYP_ETIKETT, TYP_IKON, type Notis } from "@/lib/notiser";
import { avfardaNotisen, markeraNotiserLasta } from "./notiser-actions";

/**
 * UI-PRD §5.7. Klockan i toppraden.
 *
 * Posterna raknas fram pa servern ur raderna som redan finns — se
 * `src/lib/notiser-server.ts`. Den har filen visar dem och avgor en enda sak
 * sjalv: nar markeringarna slocknar.
 *
 * MARKERINGARNA FRYSES VID OPPNINGEN. Att oppna klockan skickar iväg
 * "senast sedd", och utan frysningen hade raderna tappat sina prickar mitt
 * framfor ogonen pa den som just oppnade — man hinner se att det fanns nagot
 * nytt, men inte vad. Prickarna star darfor kvar tills panelen stangs.
 *
 * EN KLICKAD NOTIS FORSVINNER. Att klicka ar att ta hand om posten, och da ska
 * den inte ligga kvar och tranga ut nasta. Den tas bort ur listan har och
 * bokfors i `notification_dismissed` (0038) sa att den ar borta aven efter en
 * omladdning.
 *
 * Borttagningen sker DIREKT och utan att invanta servern. Klicket navigerar
 * samtidigt, sa den som backar tillbaka gor det till en lista som redan ar
 * uppdaterad — och gick skrivningen fel ar det varsta som hant att posten kommer
 * tillbaka vid nasta sidladdning. Det ar ratt hall att fela at: en notis for
 * mycket ar en irritation, en notis for lite ar nagot som aldrig blir gjort.
 *
 * VAD SOM INTE FORSVINNER: allt det andra. Den okvitterade rutinen star kvar pa
 * `/rutiner`, den ogjorda kursen pa `/utbildning`, den obeslutade ansokan pa
 * `/franvaro` och pa startsidans "Att gora". Klockan ar pafarten, inte
 * bokforingen.
 */
export function Notisklocka({ notiser }: { notiser: Notis[] }) {
  const [oppen, setOppen] = useState(false);
  const [frysta, setFrysta] = useState<string[] | null>(null);
  const [avfardade, setAvfardade] = useState<Set<string>>(() => new Set());
  const [, startOvergang] = useTransition();
  const router = useRouter();
  const rutan = useRef<HTMLDivElement>(null);

  const synliga = notiser.filter((n) => !avfardade.has(n.id));
  const olasta = synliga.filter((n) => n.olast).length;

  function avfarda(n: Notis) {
    setAvfardade((forra) => new Set(forra).add(n.id));
    setOppen(false);
    setFrysta(null);
    startOvergang(async () => {
      await avfardaNotisen(n.id);
    });
  }

  function vaxla() {
    if (oppen) {
      setOppen(false);
      setFrysta(null);
      return;
    }

    setFrysta(synliga.filter((n) => n.olast).map((n) => n.id));
    setOppen(true);

    if (olasta > 0) {
      startOvergang(async () => {
        await markeraNotiserLasta();
        router.refresh();
      });
    }
  }

  useEffect(() => {
    if (!oppen) return;

    function vidKlick(e: MouseEvent) {
      if (rutan.current && !rutan.current.contains(e.target as Node)) {
        setOppen(false);
        setFrysta(null);
      }
    }
    function vidTangent(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOppen(false);
        setFrysta(null);
      }
    }

    document.addEventListener("mousedown", vidKlick);
    document.addEventListener("keydown", vidTangent);
    return () => {
      document.removeEventListener("mousedown", vidKlick);
      document.removeEventListener("keydown", vidTangent);
    };
  }, [oppen]);

  const arOlast = (n: Notis) => (frysta ? frysta.includes(n.id) : n.olast);

  return (
    <div ref={rutan} className="relative shrink-0">
      <button
        type="button"
        onClick={vaxla}
        data-guide="topp.notiser"
        aria-haspopup="dialog"
        aria-expanded={oppen}
        aria-label={olasta > 0 ? `Notiser, ${olasta} nya` : "Notiser"}
        className="relative grid size-11 place-items-center rounded-full text-ink-700 transition-colors duration-fast hover:bg-surface"
      >
        <Ikon namn="klocka" />
        {olasta > 0 && (
          <>
            {/* AC-U5.2: farg ensam far inte bara betydelsen. Siffran star i
                knappens aria-label, och prickens innehall lases upp. */}
            <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-micro tabular-nums text-accent-ink">
              {olasta > 9 ? "9+" : olasta}
            </span>
            <span className="sr-only">{olasta} olästa</span>
          </>
        )}
      </button>

      {oppen && (
        <div
          role="dialog"
          aria-label="Notiser"
          className={cn(
            "absolute right-0 top-full z-40 mt-2 w-[min(22rem,calc(100vw-2rem))]",
            "overflow-hidden rounded-md bg-surface shadow-elev-2",
          )}
        >
          <div className="flex items-baseline justify-between gap-3 border-b border-canvas px-4 py-3">
            <h2 className="text-small font-semibold text-ink-900">Notiser</h2>
            <span className="text-micro uppercase text-ink-500">
              {synliga.length === 0 ? "Inget nytt" : `${synliga.length} senaste`}
            </span>
          </div>

          {synliga.length === 0 ? (
            <p className="px-4 py-8 text-center text-small text-ink-500">
              Ingenting väntar på dig just nu.
            </p>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto">
              {synliga.map((n) => (
                <li key={n.id} className="border-b border-canvas last:border-0">
                  <Link
                    href={n.href}
                    onClick={() => avfarda(n)}
                    className={cn(
                      "flex min-h-14 items-start gap-3 px-4 py-3 transition-colors duration-fast",
                      arOlast(n) ? "bg-accent-tint/40 hover:bg-accent-tint/70" : "hover:bg-canvas",
                    )}
                  >
                    <Ikon namn={TYP_IKON[n.typ]} className="mt-0.5 size-4 shrink-0 text-ink-500" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="truncate text-small font-semibold text-ink-900">
                          {n.rubrik}
                        </span>
                        <span className="ml-auto shrink-0 text-micro text-ink-500">
                          {narTid(n.tidpunkt)}
                        </span>
                      </span>
                      <span className="block truncate text-small text-ink-500">
                        {TYP_ETIKETT[n.typ]} · {n.detalj}
                      </span>
                    </span>
                    {arOlast(n) && (
                      <span
                        aria-hidden
                        className="mt-1.5 size-2 shrink-0 rounded-full bg-accent"
                      />
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
