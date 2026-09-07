"use client";

import { useState, type ReactNode } from "react";
import { cn } from "./cn";

/**
 * ============================================================================
 * FLIKRAD, CHIPRAD OCH SIFFERRAD — kortens egen navigering.
 *
 * Beställarens invändning 2026-09-07: "texten '1 ledighet börjar inom 14
 * dagar' står så litet och långt ner att det ser ut som en kommentar." Den satt
 * som en fotnot under en lista, och en uppgift som ligger under det man redan
 * läst färdigt läses inte alls.
 *
 * Svaret är inte att göra texten större. Det är att ge kortet en STYRNING:
 * tidsfönstret överst som flikar, läget under som chips, och tre tal som går
 * att läsa på avstånd. Fotnoten blir då en flik man kan gå till.
 *
 * ----------------------------------------------------------------------------
 * TRE NIVÅER, OCH DE FÅR INTE SE LIKADANA UT
 *
 * Ligger tre kontrollrader ovanför varandra måste ögat kunna se vilken som är
 * vilken utan att läsa dem. Därför tre olika former, inte tre färger:
 *
 *   SIFFERRADEN är platt och delad med linjer. Den är ett SVAR, inte en
 *   kontroll — men talen går att trycka på, för den som ser "3 SJUKA" vill se
 *   vilka tre. En siffra som inte leder någonstans är en affisch.
 *
 *   FLIKRADEN är en upphöjd bricka på en nedsänkt bana. Det är den enda
 *   kontrollen som byter ut innehållet helt, och den ser därför tyngst ut.
 *
 *   CHIPRADEN är ramar utan fyllning tills de väljs. De begränsar det flikarna
 *   redan valt, och underordningen syns i formen.
 *
 * ----------------------------------------------------------------------------
 * `brand-100` PÅ CHIPS ÄR INTE ETT VAL JAG GJORT
 *
 * `globals.css` beskriver tonen som "ljus tonplatta, aktiv nav, valda chips".
 * Platsen fanns alltså innan komponenten gjorde det. Flikarna tar i stället
 * `surface` med `elev-1` mot en `canvas`-bana — annars hade flik och chip
 * delat ton, och de två raderna hade smält ihop till en.
 *
 * INGA HEXVÄRDEN. UI-PRD §11. Varje färg här är en token.
 *
 * AC-U5.2: aldrig färg ensam. Varje flik och chip bär sin text och sitt antal,
 * och det valda läget står i `aria-selected`/`aria-pressed` — inte bara i en
 * bakgrund.
 * ============================================================================
 */

export type Flik = {
  id: string;
  etikett: string;
  /** Antal i fliken. `null` döljer räknaren — noll är en uppgift, tomt är inte. */
  antal?: number | null;
};

export function Flikrad({
  flikar,
  valt,
  onVal,
  etikett,
}: {
  flikar: Flik[];
  valt: string;
  onVal: (id: string) => void;
  /** Vad raden styr, för skärmläsaren. "Tidsfönster", "Område". */
  etikett: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={etikett}
      className="flex flex-wrap gap-1 rounded-full bg-canvas p-1"
    >
      {flikar.map((f) => {
        const aktiv = f.id === valt;
        return (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={aktiv}
            onClick={() => onVal(f.id)}
            className={cn(
              "inline-flex min-h-9 items-center gap-2 rounded-full px-4 text-small",
              "transition-[background-color,box-shadow,color] duration-fast ease-brand",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600",
              aktiv
                ? "bg-surface font-semibold text-ink-900 shadow-elev-1"
                : "text-ink-500 hover:text-ink-900",
            )}
          >
            {f.etikett}
            {f.antal != null && (
              <span
                className={cn(
                  "tnum grid min-w-5 place-items-center rounded-full px-1.5 text-micro",
                  // brand-600 ar enda tonen som far bara vit text (D-U2).
                  aktiv ? "bg-brand-600 text-ink-inv" : "bg-surface text-ink-500",
                )}
              >
                {f.antal}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Chiprad({
  chips,
  valt,
  onVal,
  etikett,
}: {
  chips: Flik[];
  valt: string;
  onVal: (id: string) => void;
  etikett: string;
}) {
  return (
    <div role="group" aria-label={etikett} className="flex flex-wrap gap-2">
      {chips.map((c) => {
        const aktiv = c.id === valt;
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={aktiv}
            onClick={() => onVal(c.id)}
            className={cn(
              "inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-small",
              "ring-1 ring-inset transition-colors duration-fast ease-brand",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600",
              aktiv
                ? "bg-brand-100 font-semibold text-brand-ink ring-transparent"
                : "text-ink-500 ring-canvas hover:bg-canvas hover:text-ink-900",
            )}
          >
            {c.etikett}
            {c.antal != null && <span className="tnum text-ink-300">{c.antal}</span>}
          </button>
        );
      })}
    </div>
  );
}

export type Tal = {
  id: string;
  /** Talet. Sträng och inte tal, så "2 tim" och "—" också går. */
  varde: string | number;
  etikett: string;
  /** Sant när talet betyder att något behöver göras. Ger tonen. */
  kraverHandling?: boolean;
  /** Gör talet tryckbart. Utan den är brickan bara ett svar. */
  onKlick?: () => void;
};

/**
 * Talen överst i kortet.
 *
 * `text-display` (32px) och `tnum`: siffrorna ska gå att läsa i förbifarten och
 * ligga still när de växlar mellan 9 och 10 — proportionella siffror hade
 * flyttat etiketten under sig.
 *
 * TONEN BÄR BARA "KRÄVER HANDLING", inget annat. Att färga varje bricka efter
 * vad den handlar om hade gjort raden till en kulörkarta där ögat inte hittar
 * det brådskande. Noll är alltid neutralt, även när kolumnen är röd när den är
 * tre — noll att göra är inte ett larm.
 */
export function Sifferrad({ tal }: { tal: Tal[] }) {
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-sm bg-canvas sm:grid-cols-4">
      {tal.map((t) => {
        const larmar = Boolean(t.kraverHandling) && Number(t.varde) > 0;
        const innehall = (
          <>
            <dd
              className={cn(
                "tnum text-display leading-none",
                larmar ? "text-danger-ink" : "text-ink-900",
              )}
            >
              {t.varde}
            </dd>
            <dt className="mt-2 text-micro uppercase text-ink-500">{t.etikett}</dt>
          </>
        );

        return t.onKlick ? (
          <button
            key={t.id}
            type="button"
            onClick={t.onKlick}
            className={cn(
              "flex flex-col items-start bg-surface px-4 py-4 text-left",
              "transition-colors duration-fast ease-brand hover:bg-surface-alt",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600",
            )}
          >
            {innehall}
          </button>
        ) : (
          <div key={t.id} className="flex flex-col items-start bg-surface px-4 py-4">
            {innehall}
          </div>
        );
      })}
    </dl>
  );
}

/**
 * Rubrik inuti en flik. Håller grupperna isär utan att låta som en ny rubriknivå.
 *
 * Antalet står i rubriken och inte som ett `Badge`: gruppen ÄR sitt antal, och
 * ett piller bredvid hade läst som en status på rubriken.
 */
export function Grupprubrik({ text, antal }: { text: string; antal: number }) {
  return (
    <h3 className="text-micro uppercase text-ink-500">
      {text} <span className="tnum text-ink-300">{antal}</span>
    </h3>
  );
}

/** Tom flik. Skiljer "inget att visa här" från "inget att visa alls". */
export function TomFlik({ text, handling }: { text: string; handling?: ReactNode }) {
  return (
    <div className="py-8 text-center">
      <p className="text-body text-ink-500">{text}</p>
      {handling && <div className="mt-4 flex justify-center">{handling}</div>}
    </div>
  );
}

/**
 * ============================================================================
 * SEKTIONSFLIKAR — färdiga vyer som flikar, i stället för kort under varandra.
 *
 * `/franvaro/attest` hade tre kort staplade: Att besluta, Sjukfrånvaro,
 * Godkänd ledighet. Det som stod längst ner lästes minst, oavsett hur viktigt
 * det var, och sidan blev lång på en telefon.
 *
 * INNEHÅLLET RENDERAS PÅ SERVERN och skickas hit som `innehall`. Det är hela
 * poängen med att komponenten tar `ReactNode` och inte data: sektionerna får
 * behålla sina serverfrågor, sin RLS och sina egna klientkomponenter inuti.
 * Flikraden är bara en växel, och vet ingenting om vad den växlar mellan.
 *
 * ALLA SEKTIONER RENDERAS, den dolda göms med CSS i stället för att tas ur
 * trädet. Skälet är att en sektion kan bära formulärstate — chefens halvskrivna
 * motivering i attestkön — och den ska inte försvinna för att man tittade på
 * sjukfrånvaron under tiden.
 * ============================================================================
 */
export function Sektionsflikar({
  sektioner,
  tal,
  etikett = "Vy",
}: {
  sektioner: { id: string; etikett: string; antal?: number | null; innehall: ReactNode }[];
  tal?: Tal[];
  etikett?: string;
}) {
  const [valt, setValt] = useState(sektioner[0]?.id ?? "");

  return (
    <div className="flex flex-col gap-4">
      {tal && tal.length > 0 && <Sifferrad tal={tal} />}

      <Flikrad
        etikett={etikett}
        flikar={sektioner.map((s) => ({ id: s.id, etikett: s.etikett, antal: s.antal }))}
        valt={valt}
        onVal={setValt}
      />

      {sektioner.map((s) => (
        <div key={s.id} hidden={s.id !== valt} role="tabpanel" aria-label={s.etikett}>
          {s.innehall}
        </div>
      ))}
    </div>
  );
}
