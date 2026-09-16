"use client";

import { useEffect, useRef, useState } from "react";
import {
  PLING_HANDELSE,
  PLING_INTERVALL_MS,
  plingetPa,
  type Plingpost,
} from "./pling";

/**
 * Lyssnaren. Ritar ingenting — den bor i skalet och plingar.
 *
 * =============================================================================
 * VARFÖR EN ROUTE HANDLER OCH INTE EN SERVER ACTION
 *
 * Det naturliga hade varit `const poster = await kommande()` mot en server
 * action. Det hade fungerat och långsamt förstört navet: Next kör server
 * actions i en SERIELL KÖ per session, så en pollning var femte minut ställer
 * sig i samma kö som användarens klick. Den som bockar av en uppgift i samma
 * ögonblick som rastret går får vänta på rastret först.
 *
 * En route handler ligger utanför den kön. `/api/kalender/kommande` är därför
 * en GET och inget annat — samma skäl som `/api/jobb/*` är route handlers.
 *
 * =============================================================================
 * TRE SAKER SOM GÖR SKILLNAD MELLAN ETT PLING OCH ETT GNÄLL
 *
 * 1. `sedda` minns vad som redan plingats. Fönstret är tio minuter och rastret
 *    fem, så en post hinner komma tillbaka en gång — utan minnet hade varje
 *    uppgift plingat två gånger.
 * 2. Rastret står still när fliken är dold. `document.hidden` betyder att ingen
 *    tittar, och en notis då är ett avbrott utan mottagare. Vid återkomst
 *    frågar den direkt i stället för att vänta ut resten av rastret.
 * 3. Inget pling vid sidladdning av det som redan passerat. Servern släpper bara
 *    igenom poster 0–10 minuter fram (`attPlinga()`), så en flik som öppnas
 *    klockan fyra får ingen kavalkad av förmiddagens uppgifter.
 * =============================================================================
 */
export function Pling() {
  const sedda = useRef<Set<string>>(new Set());
  const [pa, setPa] = useState(false);

  // Knappen ligger på kalendersidan och skickar en händelse när den slår om.
  // `storage` hade inte räckt: den fyrar bara i ANDRA flikar, aldrig i den som
  // skrev värdet.
  useEffect(() => {
    const las = () => setPa(plingetPa());
    las();
    window.addEventListener(PLING_HANDELSE, las);
    window.addEventListener("storage", las);
    return () => {
      window.removeEventListener(PLING_HANDELSE, las);
      window.removeEventListener("storage", las);
    };
  }, []);

  useEffect(() => {
    if (!pa) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    let levande = true;

    const fraga = async () => {
      if (document.hidden) return;
      try {
        const svar = await fetch("/api/kalender/kommande", { cache: "no-store" });
        if (!svar.ok || !levande) return;

        const { poster } = (await svar.json()) as { poster: Plingpost[] };
        for (const p of poster ?? []) {
          if (sedda.current.has(p.id)) continue;
          sedda.current.add(p.id);

          const notis = new Notification(p.rubrik ?? "Dags snart", {
            body: [p.tid, p.minuter ? `${p.minuter} min` : null].filter(Boolean).join(" · "),
            // Samma `tag` byter ut posten i stället för att lägga en till, om
            // webbläsaren ändå råkar få den två gånger.
            tag: p.id,
          });

          if (p.href) {
            notis.onclick = () => {
              window.focus();
              window.location.href = p.href!;
            };
          }
        }
      } catch {
        // Ett tappat nät ska inte kasta i ett raster som ingen väntar på.
      }
    };

    void fraga();
    const id = setInterval(fraga, PLING_INTERVALL_MS);
    // Kommer man tillbaka till fliken efter lunch ska svaret vara färskt.
    document.addEventListener("visibilitychange", fraga);

    return () => {
      levande = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", fraga);
    };
  }, [pa]);

  return null;
}
