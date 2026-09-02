"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * Tidslinjen — den enda platsen dar hela bilden av en persons utveckling star
 * samlad, i den ordning den faktiskt hande.
 *
 * Utredningens avsnitt 3.2 beskrev vyn, fas 1 byggde den inte, och luckan gick
 * att kanna igen i drift: uppgifterna lag i en lista, samtalen i en annan,
 * certifikaten pa en helt annan sida. Det gick att se VAD nagon gjort men inte
 * NAR, och en coachningshistorik utan tidsaxel svarar inte pa den enda fraga
 * den finns for — hande det nagot efter forra samtalet?
 *
 * ALLT HAR AR LASBART FOR DEN DET GALLER. Det ar inte en bieffekt av RLS utan
 * hela linjen: coachningen har inga privata chefsanteckningar, av samma skal
 * som rubriken syns fore inspelningen i 0024. Det som star har foljer ocksa
 * med i registerutdraget.
 */
export type Tidslinjerad = {
  nyckel: string;
  /** YYYY-MM-DD. Klockslaget anvands till sortering pa servern, inte till text. */
  datum: string;
  rubrik: string;
  detalj: string | null;
  /** Namnet pa den som gjorde det, uppslaget pa servern. */
  av: string | null;
  href: string | null;
  ton: "ok" | "warn" | "danger" | "info" | "neutral";
};

const PUNKT: Record<Tidslinjerad["ton"], string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-ink-300",
};

/** Hur manga rader som visas innan man ber om fler. */
const FORST = 15;

export function Tidslinje({ rader }: { rader: Tidslinjerad[] }) {
  const [allt, setAllt] = useState(false);
  const synliga = allt ? rader : rader.slice(0, FORST);

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col">
        {synliga.map((r, i) => (
          <li key={r.nyckel} className="flex gap-3">
            {/* Linjen ritas av raden SJALV och slutar pa den sista. En genomgaende
                linje bakom hela listan hade hangt kvar under sista punkten och
                pekat pa ingenting. */}
            <div className="flex flex-col items-center">
              <span className={`mt-2 size-2.5 shrink-0 rounded-full ${PUNKT[r.ton]}`} />
              {i < synliga.length - 1 && <span className="w-px grow bg-canvas" />}
            </div>

            <div className="flex-1 pb-4">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="tnum text-small text-ink-500">{r.datum}</span>
                {r.href ? (
                  <Link href={r.href} className="font-semibold text-ink-900 hover:underline">
                    {r.rubrik}
                  </Link>
                ) : (
                  <span className="font-semibold text-ink-900">{r.rubrik}</span>
                )}
              </div>
              {(r.detalj || r.av) && (
                <p className="mt-0.5 text-small text-ink-500">
                  {[r.detalj, r.av && `av ${r.av}`].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>

      {rader.length > FORST && (
        <div>
          <button
            type="button"
            onClick={() => setAllt(!allt)}
            className="text-small font-semibold text-brand-700 hover:text-brand-900"
          >
            {allt ? "Visa färre" : `Visa alla ${rader.length} händelser`}
          </button>
        </div>
      )}
    </div>
  );
}
