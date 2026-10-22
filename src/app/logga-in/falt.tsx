"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { DOMAN, foreslaRattning } from "@/lib/inloggning";

/**
 * Fälten och beskeden som inloggningens sidor delar.
 *
 * Okontrollerade med flit. React tömmer ett formulär efter varje svar från en
 * action, och ett kontrollerat fält hade fått sitt värde bortrensat ur rutan
 * men kvar i sitt tillstånd. Sidan ger i stället fälten ett nytt `key` per
 * svar, och `defaultValue` bär det som ska stå kvar (adressen, men aldrig
 * lösenordet).
 */

function Felikon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.75v3.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11" r=".9" fill="currentColor" />
    </svg>
  );
}

function Bockikon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="m5.25 8.25 1.9 1.9 3.6-3.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Varningsikon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2.25 14.25 13H1.75L8 2.25Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 6.5v2.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11.1" r=".85" fill="currentColor" />
    </svg>
  );
}

/** Formulärets fel. `role="alert"` läses upp direkt när det dyker upp. */
export function Fel({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="in-fel" role="alert">
      <Felikon />
      <span>{children}</span>
    </p>
  );
}

/**
 * Ett lugnt besked: att något har hänt (ok), en upplysning (neutral) eller
 * något som inte beror på den som skriver (varning: navet svarar inte).
 */
export function Besked({ children, ton = "ok" }: { children: React.ReactNode; ton?: "ok" | "neutral" | "varning" }) {
  return (
    <p className="in-besked" data-ton={ton} role="status">
      {ton === "ok" ? <Bockikon /> : ton === "varning" ? <Varningsikon /> : null}
      <span>{children}</span>
    </p>
  );
}

/**
 * Det som återstår av "@clicknet.se" efter det som skrivits, eller "".
 * "zen" → "@clicknet.se", "zen@cl" → "icknet.se", "zen@gmail" → "".
 */
function domanRest(v: string): string {
  const delar = v.split("@");
  if (!delar[0] || !/^[a-zA-Z0-9._+-]+$/.test(delar[0]) || delar.length > 2) return "";
  if (delar.length === 1) return `@${DOMAN}`;
  const efter = delar[1].toLowerCase();
  return efter.length < DOMAN.length && DOMAN.startsWith(efter) ? DOMAN.slice(efter.length) : "";
}

/** Nästa tomma lösenordsfält i samma formulär, om det finns ett. */
function tomtLosenord(el: HTMLInputElement): HTMLInputElement | null {
  const falt = el.form?.querySelector<HTMLInputElement>('input[name="losenord"]');
  return falt && !falt.value ? falt : null;
}

/**
 * E-postadressen.
 *
 * Skriver man bara förnamnet visas resten av adressen i grått efter markören,
 * och den fylls i när man lämnar fältet (eller trycker →). Servern fyller i
 * samma domän, så adressen blir rätt även om sidan inte hunnit hydrera.
 *
 * Enter i adressen när lösenordet är tomt går till lösenordet i stället för
 * att skicka ett formulär som bara kan få svaret "Skriv ditt lösenord".
 *
 * Ett skrivfel i domänen ("clicknet.com", "clikcnet.se") ger ett förslag när
 * man lämnat fältet, aldrig medan man skriver: mitt i ett ord är allt fel.
 *
 * `type="email"` för tangentbordet på mobilen och för autofyllen, men
 * formulären har `noValidate`: webbläsarens egen kontroll hade stoppat "zen"
 * med en engelsk ruta innan servern fick fylla i domänen.
 */
export function EpostFalt({
  defaultValue,
  fel,
  beskrivs,
  autoFocus,
}: {
  defaultValue: string;
  fel?: boolean;
  beskrivs?: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [varde, setVarde] = useState(defaultValue);
  const [lamnat, setLamnat] = useState(false);

  const rest = domanRest(varde);
  const forslag = lamnat ? foreslaRattning(varde) : null;

  function satt(v: string) {
    const el = ref.current;
    if (!el) return;
    el.value = v;
    setVarde(v);
  }

  function fyllI() {
    if (rest) satt(varde + rest);
  }

  const beskrivning = [beskrivs, forslag ? "epost-forslag" : undefined].filter(Boolean).join(" ") || undefined;

  return (
    <div className="in-falt">
      <label className="in-etikett" htmlFor="epost">
        E-post
      </label>
      <div className="in-ruta" data-fel={fel ? "" : undefined}>
        {rest ? (
          <span className="in-skugga" aria-hidden="true">
            <span>{varde}</span>
            <span>{rest}</span>
          </span>
        ) : null}
        <input
          ref={ref}
          id="epost"
          name="epost"
          className="in-input"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={`fornamn@${DOMAN}`}
          defaultValue={defaultValue}
          aria-invalid={fel || undefined}
          aria-describedby={beskrivning}
          autoFocus={autoFocus}
          required
          onChange={(e) => setVarde(e.currentTarget.value)}
          onFocus={() => setLamnat(false)}
          onBlur={() => {
            fyllI();
            setLamnat(true);
          }}
          onKeyDown={(e) => {
            const el = e.currentTarget;
            if (e.key === "ArrowRight" && rest && el.selectionStart === el.value.length) {
              e.preventDefault();
              fyllI();
            }
            if (e.key === "Enter") {
              const nasta = tomtLosenord(el);
              if (nasta) {
                e.preventDefault();
                nasta.focus();
              }
            }
          }}
        />
      </div>
      {forslag ? (
        <p id="epost-forslag" className="in-forslag">
          Menade du{" "}
          <button
            type="button"
            className="in-lank"
            onClick={() => {
              satt(forslag);
              const el = ref.current;
              (el ? tomtLosenord(el) : null)?.focus();
            }}
          >
            {forslag}
          </button>
          ?
        </p>
      ) : null}
    </div>
  );
}

/**
 * Ett lösenordsfält med Visa/Dölj och en varning när Caps Lock är på.
 *
 * Caps Lock går bara att läsa av på ett tangent- eller mushändelse, så
 * varningen syns först när man tryckt eller klickat i fältet. Den syns bara
 * medan fältet har fokus; på väg till knappen är den inte längre till hjälp.
 *
 * Visat blir dolt igen när formuläret skickas: ett lösenord ska inte stå kvar
 * i klartext på skärmen efter ett fel, och lösenordshanterare känner bara
 * igen fält som är lösenordsfält när de skickas.
 *
 * Tillägget ("Glömt lösenordet?") står bredvid etiketten på skärmen men efter
 * fältet i koden, så att Tab går från adressen rakt till lösenordet.
 */
export function LosenordsFalt({
  id,
  etikett,
  autoComplete,
  fel,
  beskrivs,
  hjalp,
  tillagg,
  autoFocus,
  minLength,
  defaultValue,
  synligtStart = false,
  onVarde,
}: {
  id: string;
  etikett: string;
  autoComplete: "current-password" | "new-password";
  fel?: boolean;
  beskrivs?: string;
  hjalp?: React.ReactNode;
  /** Till höger om etiketten, t.ex. "Glömt lösenordet?". */
  tillagg?: React.ReactNode;
  autoFocus?: boolean;
  minLength?: number;
  defaultValue?: string;
  synligtStart?: boolean;
  onVarde?: (v: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [synligt, setSynligt] = useState(synligtStart);
  const [caps, setCaps] = useState(false);
  const [fokus, setFokus] = useState(false);

  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const dolj = () => {
      if (ref.current) ref.current.type = "password";
      setSynligt(false);
    };
    form.addEventListener("submit", dolj, true);
    return () => form.removeEventListener("submit", dolj, true);
  }, []);

  const kolla = (e: React.KeyboardEvent | React.MouseEvent) => {
    if (typeof e.getModifierState === "function") setCaps(e.getModifierState("CapsLock"));
  };

  const hjalpId = hjalp ? `${id}-hjalp` : undefined;
  const capsId = `${id}-caps`;
  const beskrivning = [beskrivs, hjalpId, caps && fokus ? capsId : undefined].filter(Boolean).join(" ") || undefined;

  return (
    <div className={tillagg ? "in-falt in-falt-med" : "in-falt"}>
      <label className="in-etikett" htmlFor={id}>
        {etikett}
      </label>
      <div className="in-ruta" data-fel={fel ? "" : undefined}>
        <input
          ref={ref}
          id={id}
          name={id}
          className="in-input"
          type={synligt ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          defaultValue={defaultValue}
          aria-invalid={fel || undefined}
          aria-describedby={beskrivning}
          autoFocus={autoFocus}
          minLength={minLength}
          required
          onKeyDown={kolla}
          onKeyUp={kolla}
          onMouseDown={kolla}
          onFocus={() => setFokus(true)}
          onBlur={() => setFokus(false)}
          onChange={(e) => onVarde?.(e.currentTarget.value)}
        />
        <button
          type="button"
          className="in-visa"
          aria-controls={id}
          aria-pressed={synligt}
          aria-label={synligt ? "Dölj lösenordet" : "Visa lösenordet. Det syns då på skärmen."}
          onClick={() => setSynligt((s) => !s)}
        >
          {synligt ? "Dölj" : "Visa"}
        </button>
      </div>
      {tillagg ? <div className="in-tillagg">{tillagg}</div> : null}
      {caps && fokus ? (
        <p id={capsId} className="in-caps" aria-live="polite">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 2.5 3 7.75h2.75v3h4.5v-3H13L8 2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M5.75 13.25h4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          Caps Lock är på
        </p>
      ) : null}
      {hjalp ? (
        <p id={hjalpId} className="in-hjalp">
          {hjalp}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Engångskoden. Bara siffror; mellanslag och streck från ett inklistrat mejl
 * tas bort. Klistrar man in en hel kod skickas formuläret direkt, för då finns
 * inget kvar att göra.
 */
export function KodFalt({ fel, beskrivs }: { fel?: boolean; beskrivs?: string }) {
  return (
    <div className="in-falt">
      <label className="in-etikett" htmlFor="kod">
        Koden från mejlet
      </label>
      <div className="in-ruta" data-fel={fel ? "" : undefined}>
        <input
          id="kod"
          name="kod"
          className="in-input in-kod"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={10}
          placeholder="······"
          aria-invalid={fel || undefined}
          aria-describedby={beskrivs}
          autoFocus
          required
          onChange={(e) => {
            const el = e.currentTarget;
            const rent = el.value.replace(/\D/g, "").slice(0, 10);
            if (rent !== el.value) el.value = rent;
          }}
          onPaste={(e) => {
            const rent = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 10);
            if (rent.length < 6) return;
            e.preventDefault();
            const el = e.currentTarget;
            el.value = rent;
            el.form?.requestSubmit();
          }}
        />
      </div>
    </div>
  );
}

/** Kontot enheten minns, färdigt att rita: sidan räknar ut texterna på servern. */
export type KontoVy = {
  epost: string;
  namn: string | null;
  fornamn: string | null;
  initialer: string;
  farg: string;
  /** "i går 08:12", eller null första gången. */
  senast: string | null;
};

/**
 * Kontot som loggade in senast på den här enheten, i stället för adressfältet.
 * Då behövs bara lösenordet. Namnet står redan i hälsningen ovanför, så här
 * står adressen, och när kontot senast var inne härifrån: en tid man inte
 * känner igen är skäl att byta lösenord.
 */
export function KontoRad({ konto, onByt, byter }: { konto: KontoVy; onByt: () => void; byter?: boolean }) {
  return (
    <div className="in-konto" role="group" aria-label="Kontot">
      <span className="in-av" style={{ background: konto.farg }} aria-hidden="true">
        {konto.initialer}
      </span>
      <div className="in-konto-text">
        {/* En lång adress kortas med … på telefonen; hela står i title. */}
        <div className="in-konto-adress" title={konto.epost}>
          {konto.epost}
        </div>
        {konto.senast ? (
          <div className="in-konto-senast" title="Senast inloggad på den här enheten">
            Senast här {konto.senast}
          </div>
        ) : null}
      </div>
      <button type="button" className="in-lank" onClick={onByt} disabled={byter}>
        Byt konto
      </button>
    </div>
  );
}

/**
 * En skicka-knapp som vet när formuläret väntar. För formulär som skickas
 * rakt till servern (uppstarten), utan eget tillstånd i sidan.
 */
export function Knapp({ children, vantar }: { children: React.ReactNode; vantar: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="in-knapp" disabled={pending} aria-busy={pending || undefined}>
      {pending ? vantar : children}
    </button>
  );
}
