"use client";

import { useEffect, useState } from "react";
import { KOD_GILTIG_MIN, KOD_PAUS_S, klockslag, kvarText } from "@/lib/inloggning";
import { Besked, Fel, KodFalt } from "./falt";

/** Efter så lång tid utan inloggning tipsar kodsteget om skräpposten. */
const TIPS_EFTER_MS = 30_000;

/**
 * Klockan i millisekunder, en gång i sekunden fram till `till` (ms). Sedan
 * står den still, tills `till` flyttas fram igen.
 */
export function useNu(till: number): number {
  const [nu, setNu] = useState(() => Date.now());
  useEffect(() => {
    setNu(Date.now());
    if (Date.now() >= till) return;
    const t = window.setInterval(() => {
      const n = Date.now();
      setNu(n);
      if (n >= till) window.clearInterval(t);
    }, 1000);
    return () => window.clearInterval(t);
  }, [till]);
  return nu;
}

/** En kod som skickats: när, och när nästa får be om. */
export type Skickad = {
  /** När koden skickades (ms), eller null när den skickats förut och tiden inte är känd. */
  tid: number | null;
  /** När en ny kod får begäras (ms). */
  nyFran: number;
  /** Andra koden eller senare: den förra gäller inte längre. */
  igen: boolean;
};

export function nySkickad(forra: Skickad | null): Skickad {
  const nu = Date.now();
  return { tid: nu, nyFran: nu + KOD_PAUS_S * 1000, igen: forra !== null };
}

/**
 * Steget där koden från mejlet skrivs in. Samma steg vid inloggning med kod,
 * vid "Glömt lösenordet?", i steg två och i lösenordsbytet, så att koden
 * ser likadan ut och beter sig likadant överallt.
 *
 * Sidan äger handlingarna; steget ritar fältet, säger när koden skickades
 * och hur länge den gäller, räknar ned till nästa kod och tipsar om
 * skräpposten när mejlet dröjer.
 */
export function KodSteg({
  skickad,
  action,
  vantar,
  knapp,
  fel,
  nr,
  skickaIgen,
  skickarIgen,
  andra,
  children,
}: {
  skickad: Skickad;
  action: (form: FormData) => void;
  vantar: boolean;
  /** Knappens text: "Logga in", "Fortsätt". */
  knapp: string;
  fel: string | null;
  /** Nytt värde per svar: fältet töms och får fokus igen. */
  nr: number;
  skickaIgen: () => void;
  skickarIgen: boolean;
  /** "Ändra adressen", där adressen går att ändra. */
  andra?: () => void;
  /** Dolda fält som följer med koden. */
  children?: React.ReactNode;
}) {
  const tipsFran = skickad.tid !== null ? skickad.tid + TIPS_EFTER_MS : 0;
  const nu = useNu(Math.max(skickad.nyFran, tipsFran));
  const kvar = Math.max(0, (skickad.nyFran - nu) / 1000);
  const tips = skickad.tid !== null && nu >= tipsFran;
  const felId = "in-kodfel";

  return (
    <>
      {skickad.tid !== null ? (
        <p className="in-kodmeta in-mono">
          Skickad {klockslag(new Date(skickad.tid))} · gäller till{" "}
          {klockslag(new Date(skickad.tid + KOD_GILTIG_MIN * 60_000))}
        </p>
      ) : null}
      <form action={action} className="in-form" noValidate aria-busy={vantar}>
        {children}
        {skickad.igen && !fel ? <Besked>En ny kod är skickad. Den förra gäller inte längre.</Besked> : null}
        <KodFalt key={`k-${nr}`} fel={Boolean(fel)} beskrivs={fel ? felId : undefined} />
        {fel ? <Fel id={felId}>{fel}</Fel> : null}
        <button type="submit" className="in-knapp" disabled={vantar}>
          {vantar ? "Kontrollerar…" : knapp}
        </button>
      </form>
      <div className="in-rad in-efterkod">
        <button type="button" className="in-lank" onClick={skickaIgen} disabled={kvar > 0 || skickarIgen}>
          {kvar > 0 ? (
            <>
              Ny kod om <span className="in-mono">{kvarText(kvar)}</span>
            </>
          ) : skickarIgen ? (
            "Skickar…"
          ) : (
            "Skicka en ny kod"
          )}
        </button>
        {andra ? (
          <button type="button" className="in-lank" onClick={andra}>
            Ändra adressen
          </button>
        ) : null}
      </div>
      {tips ? (
        <p className="in-hjalp in-tips" role="status">
          Inget mejl? Titta i skräpposten, och kontrollera att adressen stämmer.
        </p>
      ) : null}
    </>
  );
}

/**
 * Det lyckades, och nästa sida laddas. Navet på bandet snurrar medan den
 * gör det (`aria-busy`), och dröjer det syns en vanlig länk dit.
 *
 * Kommer man tillbaka hit med webbläsarens bakåtknapp ligger sidan kvar i
 * minnet (bfcache), fortfarande på "Öppnar …". Då laddas den om, och
 * mellanvaran skickar den inloggade vidare.
 */
export function Klar({ rubrik, text, till }: { rubrik: string; text: string; till: string }) {
  const [seg, setSeg] = useState(false);

  useEffect(() => {
    window.location.assign(till);
    const t = window.setTimeout(() => setSeg(true), 6000);
    const tillbaka = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", tillbaka);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("pageshow", tillbaka);
    };
  }, [till]);

  return (
    <div className="in-klar" role="status" aria-busy="true">
      <h1 className="in-rubrik">{rubrik}</h1>
      <p className="in-ingress">{text}</p>
      {seg ? (
        <p className="in-hjalp">
          Händer inget?{" "}
          <a className="in-lank" href={till}>
            Öppna direkt
          </a>
        </p>
      ) : null}
    </div>
  );
}
