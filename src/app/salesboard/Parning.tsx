"use client";

/**
 * Parningen på TV:n (spec §9) och tavlans avbrott.
 *
 * `Parning`: TV:n visar en kod stort. En admin skriver koden i inställningarna
 * och ger skärmen ett namn. TV:n frågar var tredje sekund (`GET /salesboard/par`),
 * och när koden är inlöst laddas sidan om till tavlan. Koden gäller i tio
 * minuter; en hårlinje under den krymper med tiden som är kvar. När koden gått
 * ut svarar servern 410, och då begärs en ny (`POST`). Se regeln nedan.
 *
 * `Avbrott`: sidan kunde inte avgöra åtkomsten eller bygga bilden (databasen eller
 * nätet). Det är inte samma sak som "inte parad", så ingen kod visas och ingen
 * kaka rörs. Sidan försöker igen av sig själv.
 *
 * Får aldrig importera parning.ts: den är serverkod (node:crypto).
 */

import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { dukstil, useDukskala } from "./duk.ts";
import { TIDSGRANS_MS, VERKLIG_TID, hamtaInom } from "./hamtning.ts";
import { klockaMedSekunder } from "./vy.ts";

const FRAGA_MS = 3_000;
const AVBROTT_MS = 30_000;

/** Duken, skalad till fönstret som tavlan, med statusraden överst. */
/**
 * F gör skärmen till helskärm redan här, så att den som sätter upp en TV med ett
 * tangentbord kan göra det före parningen och inte behöver göra om det efter.
 */
function useHelskarmPaF(): void {
  useEffect(() => {
    const tangent = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== "f") return;
      try {
        const lofte = document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.();
        void Promise.resolve(lofte).catch(() => undefined);
      } catch {
        // Helskärm går inte här (en ram, eller en TV-webbläsare utan stöd).
      }
    };
    window.addEventListener("keydown", tangent);
    return () => window.removeEventListener("keydown", tangent);
  }, []);
}

function Ram({ children, hoger }: { children: ReactNode; hoger?: ReactNode }): ReactElement {
  useHelskarmPaF();
  const duk = dukstil(useDukskala());
  const [nu, settNu] = useState<number | null>(null);
  useEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    const tick = () => {
      settNu(Date.now());
      id = setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    };
    tick();
    return () => clearTimeout(id);
  }, []);
  return (
    <div className="sb-rot">
      <div className={duk.className} style={duk.style}>
        <header className="sb-status">
          <div className="sb-status-v">
            <span className="sb-namn">Säljtavlan</span>
          </div>
          <div className="sb-status-h">
            {hoger}
            <span className="sb-klocka">{nu === null ? "" : klockaMedSekunder(nu)}</span>
          </div>
        </header>
        <main className="sb-par">{children}</main>
      </div>
    </div>
  );
}

/** Koden och när den kom (webbläsarens klocka). Koden gäller i tio minuter från servern. */
type Kod = { kod: string; fran: number };

/** Så länge en kod gäller (`KOD_GILTIG_MS` i parning.ts, som inte får importeras här). */
const GILTIG_MS = 600_000;
/** Ett fel väntar längre för varje gång, upp till så här länge. */
const LANGST_MS = 30_000;
/** För många koder just nu (429): försök igen om en minut. */
const KVOT_MS = 60_000;
/** TV:n minns koden den visar, så att en omladdning visar samma kod och inte begär en ny. */
const SPARAD = "salesboard.parkod";

function lasSparad(): Kod | null {
  try {
    const k = JSON.parse(window.localStorage.getItem(SPARAD) ?? "null") as Kod | null;
    return k && typeof k.kod === "string" && typeof k.fran === "number" && Date.now() - k.fran < GILTIG_MS ? k : null;
  } catch {
    return null;
  }
}

function spara(k: Kod | null): void {
  try {
    if (k) window.localStorage.setItem(SPARAD, JSON.stringify(k));
    else window.localStorage.removeItem(SPARAD);
  } catch {
    // Utan lagring begärs en ny kod efter en omladdning, och det går också.
  }
}

/**
 * ===========================================================================
 * EN NY KOD BARA NÄR SERVERN SÄGER ATT DEN GAMLA ÄR BORTA.
 *
 * En ny kod (POST) byter TV:ns parningskaka. Laddas TV:n om i sekunderna mellan
 * att admin godkänt och nästa fråga, hade en kod vid start tappat godkännandet.
 * Därför frågar TV:n alltid först (GET): {klar: true} är tavlan, {klar: false}
 * betyder att koden på skärmen fortfarande gäller, och bara 410 (koden har gått
 * ut, eller det finns ingen kaka) ger en ny kod. Ett fel (5xx, nätet) börjar
 * aldrig om: koden står kvar och frågan går igen, glesare för varje fel. För
 * många koder just nu (429) väntar en minut.
 * ===========================================================================
 */
export default function Parning(): ReactElement {
  const [kod, settKod] = useState<Kod | null>(null);
  const [fel, settFel] = useState<string | null>(null);
  const [nu, settNu] = useState(() => Date.now());
  const [adress, settAdress] = useState("clicknet-nav.vercel.app");

  useEffect(() => {
    settAdress(window.location.host);
    const id = setInterval(() => settNu(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let aktiv = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let visad: Kod | null = null;
    let misslyckade = 0;
    const sedan = (ms: number, steg: () => Promise<void>) => {
      timer = setTimeout(() => {
        if (aktiv) void steg();
      }, ms);
    };
    const glesare = () => Math.min(LANGST_MS, FRAGA_MS * 2 ** Math.min(misslyckade, 4));
    // Varje anrop har en tidsgräns som gäller också kroppen: en hängande fråga är ett fel och frågandet fortsätter.
    const anropa = (init?: RequestInit) =>
      hamtaInom(VERKLIG_TID, TIDSGRANS_MS, (signal) =>
        fetch("/salesboard/par", { cache: "no-store", credentials: "same-origin", ...init, signal }),
      );
    const visa = (k: Kod | null) => {
      visad = k;
      settKod(k);
    };

    async function fraga(): Promise<void> {
      try {
        const svar = await anropa();
        if (!aktiv) return;
        if (svar.status === 410) {
          spara(null);
          visa(null);
          return nyKod();
        }
        const kropp = svar.kropp as { klar?: boolean } | null;
        if (svar.ok && kropp?.klar === true) {
          aktiv = false;
          spara(null);
          window.location.reload();
          return;
        }
        if (svar.ok && kropp?.klar === false) {
          misslyckade = 0;
          settFel(null);
          if (!visad) {
            const sparad = lasSparad();
            if (!sparad) return nyKod();
            visa(sparad);
          }
          return sedan(FRAGA_MS, fraga);
        }
        throw new Error(`HTTP ${svar.status}`);
      } catch {
        if (!aktiv) return;
        misslyckade++;
        if (!visad) {
          const sparad = lasSparad();
          if (sparad) visa(sparad);
          else settFel("Navet svarar inte just nu. Tavlan försöker igen av sig själv.");
        }
        sedan(glesare(), fraga);
      }
    }

    async function nyKod(): Promise<void> {
      try {
        const svar = await anropa({ method: "POST" });
        const kropp = svar.kropp as { kod?: string; fel?: string } | null;
        if (!aktiv) return;
        if (svar.ok && kropp?.kod) {
          const k = { kod: kropp.kod, fran: Date.now() };
          spara(k);
          visa(k);
          settFel(null);
          misslyckade = 0;
          return sedan(FRAGA_MS, fraga);
        }
        if (svar.status === 429) {
          settFel("Många skärmar väntar på en kod just nu. Tavlan försöker igen om en minut.");
          return sedan(KVOT_MS, fraga);
        }
        misslyckade++;
        settFel(kropp?.fel ?? "Det gick inte att hämta en kod. Tavlan försöker igen av sig själv.");
        sedan(glesare(), fraga);
      } catch {
        if (!aktiv) return;
        misslyckade++;
        settFel("Navet svarar inte just nu. Tavlan försöker igen av sig själv.");
        sedan(glesare(), fraga);
      }
    }

    void fraga();
    return () => {
      aktiv = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const kvar = kod ? Math.max(0, GILTIG_MS - (nu - kod.fran)) : 0;
  const andel = kod ? kvar / GILTIG_MS : 0;
  const minuter = Math.ceil(kvar / 60_000);
  const [forsta, andra] = kod ? kod.kod.split("-") : ["", ""];

  // Koden står också i flikens namn: på en dator med flera flikar syns den utan att leta.
  useEffect(() => {
    if (!kod) return;
    const fore = document.title;
    document.title = `${kod.kod} · Para säljtavlan`;
    return () => {
      document.title = fore;
    };
  }, [kod]);

  return (
    <Ram>
      <div className="sb-etikett">PARA SKÄRMEN</div>
      {kod ? (
        <>
          <div className="sb-par-kod" aria-label={`Koden är ${kod.kod}`}>
            <span>{forsta}</span>
            <i aria-hidden="true" />
            <span>{andra}</span>
          </div>
          <div className="sb-par-tid" aria-hidden="true">
            <i style={{ transform: `scaleX(${andel})` }} />
          </div>
          <p className="sb-par-text">
            Öppna <b>{adress}/salesboard/installningar</b> på en dator, välj <b>Para ny skärm</b> och skriv koden.
          </p>
          <p className="sb-par-not">
            Koden gäller {minuter <= 1 ? "en minut till" : `${minuter} minuter till`}. Tavlan startar här av sig själv. F ger helskärm.
          </p>
        </>
      ) : (
        <p className="sb-par-text">{fel ?? "Hämtar en kod …"}</p>
      )}
      <a className="sb-par-in" href="/logga-in?nasta=%2Fsalesboard">
        Anställd? Logga in för att se tavlan här.
      </a>
    </Ram>
  );
}

/** Sidan nådde inte databasen eller nätet. Inget om parning: skärmen behåller sin kaka och försöker igen. */
export function Avbrott(): ReactElement {
  const [kvar, settKvar] = useState(AVBROTT_MS / 1000);
  useEffect(() => {
    const slut = Date.now() + AVBROTT_MS;
    const id = setInterval(() => {
      const s = Math.max(0, Math.ceil((slut - Date.now()) / 1000));
      settKvar(s);
      if (s === 0) window.location.reload();
    }, 500);
    return () => clearInterval(id);
  }, []);
  return (
    <Ram
      hoger={
        <span className="sb-live sb-live-av">
          <i className="sb-prick" />
          Offline
        </span>
      }
    >
      <div className="sb-etikett">TAVLAN</div>
      <p className="sb-par-rubrik">Tavlan når inte navet just nu.</p>
      <p className="sb-par-text">Den försöker igen om {kvar} s.</p>
    </Ram>
  );
}
