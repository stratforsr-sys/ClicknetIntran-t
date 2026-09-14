"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import {
  INSPELNING_ETIKETT,
  RIKTNING_ETIKETT,
  klockslag,
  langd,
  motpart,
  summering,
  type Samtalsrad,
} from "@/lib/samtal-vy";

/**
 * Samtalen som hör till en order.
 *
 * ===========================================================================
 * `preload="none"` ÄR INTE EN PRESTANDAINSTÄLLNING
 *
 * Varje gång webbläsaren hämtar ljudet går den via `/filer/[id]`, som skriver
 * en rad i `file_access_log` innan filen lämnas ut (K36, 0022). Utan
 * `preload="none"` hämtar webbläsaren början av varje inspelning direkt när
 * sidan ritas — och då står det i loggen att fem personers samtal öppnades av
 * någon som bara råkade öppna ordersidan.
 *
 * En logg med påhittade rader är sämre än ingen logg. Samma resonemang som
 * `<a>` i stället för `<Link>` i `/filer/[id]/route.ts`, och det står utskrivet
 * där.
 *
 * ===========================================================================
 * LISTAN ÄR HOPFÄLLD MEN RÄKNAREN SYNS
 *
 * Rubriken säger alltid hur många samtal och hur lång sammanlagd taltid affären
 * har, också när listan är ihopfälld. Det är den uppgift man vill åt i
 * förbifarten, och den ska inte kräva ett klick.
 */
export function Samtal({ samtal }: { samtal: Samtalsrad[] }) {
  const [oppen, setOppen] = useState(false);

  if (samtal.length === 0) {
    return (
      <p className="text-micro text-ink-500">
        Inga samtal hittade på kundens telefonnummer.
      </p>
    );
  }

  const { antal, sekunder } = summering(samtal);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOppen((v) => !v)}
        aria-expanded={oppen}
        className="flex items-center gap-2 text-left text-small font-semibold text-ink-900 underline"
      >
        {antal} {antal === 1 ? "samtal" : "samtal"} · {langd(sekunder)} taltid
        <span aria-hidden className="text-ink-500">
          {oppen ? "▾" : "▸"}
        </span>
      </button>

      {oppen && (
        <ul className="flex flex-col gap-3">
          {samtal.map((s) => (
            <li key={s.id} className="flex flex-col gap-1 rounded-sm bg-canvas p-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-small font-semibold text-ink-900">{motpart(s)}</span>
                <Badge>{RIKTNING_ETIKETT[s.direction]}</Badge>
                {s.orderLinkedBy && <Badge>Kopplad för hand</Badge>}
                <span className="flex-1" />
                <span className="tnum text-small text-ink-900">{langd(s.talkSeconds ?? s.durationSeconds)}</span>
              </div>

              <p className="text-micro text-ink-500">
                {klockslag(s.startedAt)}
                {s.namn ? ` · ${s.namn}` : ""}
              </p>

              <Inspelning samtal={s} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Spelaren, eller skälet till att den inte finns.
 *
 * De fyra lägena utan ljud får var sin text i stället för ett tomt fält. Ett
 * samtal vars inspelning gallrades och ett samtal som aldrig spelades in ser
 * annars likadana ut, och skillnaden är hela frågan när någon undrar var
 * beviset tog vägen.
 */
function Inspelning({ samtal }: { samtal: Samtalsrad }) {
  if (samtal.recordingState === "hamtad" && samtal.recordingFileId) {
    return (
      <audio
        controls
        preload="none"
        src={`/filer/${samtal.recordingFileId}`}
        className="mt-1 w-full max-w-md"
      >
        Din webbläsare kan inte spela upp ljud.
      </audio>
    );
  }

  return (
    <p className="text-micro text-ink-500">
      {INSPELNING_ETIKETT[samtal.recordingState]}
      {samtal.recordingState === "misslyckad" && samtal.recordingError
        ? ` — ${samtal.recordingError}`
        : ""}
    </p>
  );
}
