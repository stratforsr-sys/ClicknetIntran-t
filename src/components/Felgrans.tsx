"use client";

import { useEffect, useState } from "react";

/**
 * E0.6. Vad anvandaren ser nar en sida gar sonder, och rapporten som skickas.
 *
 * Delas av `global-error.tsx` och `(app)/error.tsx`. Den forra ritar sitt eget
 * `<html>` eftersom rotlayouten ar det som gick sonder; den senare ligger kvar
 * i skalet. Innehallet ar detsamma, och det ar poangen med att det bor har.
 *
 * ===========================================================================
 * RAPPORTEN SKICKAS EN GANG, AVEN NAR REACT RITAR OM.
 *
 * En felgrans monteras om vid varje forsok, och i strict mode kors effekten
 * tva ganger direkt. Utan vakten nedan blir ett fel tva rapporter — eller
 * tjugo, om nagon star och trycker "Forsok igen".
 *
 * Dedupliceringen i 0026 hade fangat det anda, men den raknar upp
 * `occurrences`, och da hade raknaren matt hur otaligt anvandaren tryckte i
 * stallet for hur manga som drabbats.
 * ===========================================================================
 *
 * UI-PRD §8: systemet ber inte om ursakt. Det sager vad som hande, vad som
 * gar att gora, och vad man kan hanvisa till om det inte hjalper.
 */
export function Felgrans({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [skickad, setSkickad] = useState(false);

  useEffect(() => {
    let avbruten = false;

    // Nyckeln ar felet, inte monteringen. Samma digest pa samma sida rapporteras
    // en gang per sidladdning oavsett hur manga ganger grasen ritas om.
    const nyckel = `fel:${error.digest ?? error.message}:${location.pathname}`;
    if (sessionStorage.getItem(nyckel)) {
      setSkickad(true);
      return;
    }
    sessionStorage.setItem(nyckel, "1");

    void fetch("/api/fel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Bara digest och sokvag. Meddelandet har servern redan skrivit sjalv via
      // onRequestError — se rubriken i src/instrumentation.ts.
      body: JSON.stringify({ digest: error.digest ?? null, path: location.pathname }),
      keepalive: true,
    })
      .then(() => {
        if (!avbruten) setSkickad(true);
      })
      .catch(() => {
        // En felrapport som inte gick fram far inte bli ett andra fel pa
        // felsidan. Knappen "Beskriv vad du gjorde" star kvar och ar den vag
        // som anda fungerar.
      });

    return () => {
      avbruten = true;
    };
  }, [error]);

  const beskrivHref = `/fel/nytt?digest=${encodeURIComponent(error.digest ?? "")}`;

  return (
    <div className="mx-auto flex max-w-[52ch] flex-col gap-4 px-4 py-16">
      <h1 className="text-h1 text-ink-900">Sidan gick inte att visa</h1>

      {/*
        Texten pastar inte att rapporten gatt fram forran den gjort det.
        "Felet ar redan skickat" pa en sida dar skickandet just misslyckades ar
        precis den sortens lugnande losa pastaende som gor att folk slutar tro
        pa systemets besked.
      */}
      <p className="text-body text-ink-500" aria-live="polite">
        Något i den här vyn slutade fungera.{" "}
        {skickad
          ? "Felet är skickat till den som förvaltar navet — du behöver inte höra av dig för att det ska bli känt."
          : "Felet skickas vidare till den som förvaltar navet."}
      </p>

      <p className="text-body text-ink-500">
        Det du hade fyllt i men inte sparat finns inte kvar. Resten av navet
        fungerar.
      </p>

      <div className="mt-2 flex flex-wrap gap-3">
        <button
          onClick={reset}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-brand-600 px-6 font-semibold text-ink-inv shadow-elev-brand transition-[background-color,transform] duration-fast ease-brand hover:bg-brand-700 active:scale-[0.98]"
        >
          Försök igen
        </button>
        <a
          href="/"
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-surface px-6 font-semibold text-brand-700 ring-1 ring-brand-200 transition-[background-color,transform] duration-fast ease-brand hover:bg-brand-50 active:scale-[0.98]"
        >
          Till startsidan
        </a>
        <a
          href={beskrivHref}
          className="inline-flex min-h-11 items-center justify-center rounded-full px-6 font-semibold text-ink-500 transition-[background-color,transform] duration-fast ease-brand hover:bg-surface-alt hover:text-ink-900 active:scale-[0.98]"
        >
          Beskriv vad du gjorde
        </a>
      </div>

      {/*
        Digesten star framme med flit. Den ar det enda som kopplar ihop "jag
        fick en trasig sida klockan halv tre" med raden i kon, och en anvandare
        som kan saga den siffran i ett samtal sparar tio minuters letande.
      */}
      {error.digest && (
        <p className="mt-4 text-small text-ink-500">
          Felkod <code className="rounded-sm bg-surface-alt px-2 py-1 tabular-nums">{error.digest}</code>
        </p>
      )}
    </div>
  );
}
