"use client";

import { useEffect, useState } from "react";
import { svenskKlocka } from "@/lib/klocka";
import { timmarOchMinuter, type Lage } from "@/lib/tid";

/**
 * UI-PRD §7 SA ATT STARTSIDAN INTE HAR NAGON HERO. DET HAR AR ETT AVSTEG.
 *
 * Regeln var att forsta skarmen ska ge handling, inte valkomnande, och den var
 * ratt: en illustration och ett "Valkommen tillbaka!" hade tagit den plats som
 * knapparna behover. Bestallaren bad 2026-08-23 om ett statusband med
 * personlighet, och avsteget ar noterat i DECISIONS.md.
 *
 * Skillnaden mot en hero ar att bandet BAR INFORMATION. Det sager var du star,
 * sedan nar, och hur lange — tre saker som annars kravde en sidladdning till
 * /tid. Ett band som bara halsade hade fallit pa samma invandning som forut.
 *
 * ===========================================================================
 * VARFOR TIDEN TICKAR I WEBBLASAREN OCH INTE PA SERVERN
 *
 * Servern renderar en siffra som ar sann i det ogonblick sidan byggs. Den som
 * lamnar fliken oppen over lunchen hade annars sett "3 h 12 min" i timmar.
 *
 * FORSTA renderingen anvander serverns siffra oforandrad — bade har och pa
 * servern. Utan det blir det en hydreringskrock: servern skriver 192 minuter,
 * webblasaren 193, och React kastar om hela tradet. Tickandet startar forst i
 * effekten, alltsa efter att hydreringen ar klar.
 * ===========================================================================
 */
export function Statusband({
  fornamn,
  undertext,
  lage,
  minuterVidRendering,
  serverTid,
  sedan,
}: {
  fornamn: string;
  undertext: string;
  lage: Lage | null;
  minuterVidRendering: number;
  /** Serverns klocka nar sidan renderades, som ISO. */
  serverTid: string;
  /** Nar det nuvarande laget borjade, som ISO. Null nar personen ar ute. */
  sedan: string | null;
}) {
  const [minuter, setMinuter] = useState(minuterVidRendering);

  useEffect(() => {
    if (lage !== "inne") return;

    const bas = Date.parse(serverTid);
    const rakna = () =>
      setMinuter(minuterVidRendering + Math.floor((Date.now() - bas) / 60000));

    rakna();
    const id = setInterval(rakna, 15_000);
    return () => clearInterval(id);
  }, [lage, minuterVidRendering, serverTid]);

  return (
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
      <div>
        <h1 className="text-display text-ink-900">Hej {fornamn}</h1>
        <p className="mt-1 text-body text-ink-500">{undertext}</p>
      </div>

      {lage && (
        <div className="flex items-center gap-4">
          <Prick lage={lage} />
          <div className="text-right">
            <p className="text-small font-semibold text-ink-900">
              {lage === "ute"
                ? "Inte instämplad"
                : lage === "rast"
                  ? `På rast sedan ${sedan ? svenskKlocka(sedan) : "–"}`
                  : `Instämplad sedan ${sedan ? svenskKlocka(sedan) : "–"}`}
            </p>
            {lage !== "ute" && (
              <p className="tnum text-h1 text-ink-900">{timmarOchMinuter(minuter)}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * AC-U5.2: status kommuniceras aldrig med enbart farg. Pricken har darfor
 * alltid texten bredvid sig, och pulsen ar bara till for den som redan last
 * den. `motion-safe:` gor att den som bett om mindre rorelse far en stilla
 * prick i stallet for ingen prick.
 */
function Prick({ lage }: { lage: Lage }) {
  const ton =
    lage === "inne" ? "bg-ok" : lage === "rast" ? "bg-brand-400" : "bg-ink-300";

  return (
    <span aria-hidden className="relative flex size-3">
      {lage === "inne" && (
        <span
          className={`absolute inline-flex size-full motion-safe:animate-ping rounded-full ${ton} opacity-60`}
        />
      )}
      <span className={`relative inline-flex size-3 rounded-full ${ton}`} />
    </span>
  );
}
