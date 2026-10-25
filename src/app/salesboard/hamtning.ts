/**
 * Tavlans hämtningar som ren logik: när en hämtning görs, hur länge den får ta och
 * vilken klockförskjutning som gäller. Klockan och timers skickas in, så att reglerna
 * går att prova med en låtsasklocka (`tests/salesboard-tavla.mjs`). kalla.ts och
 * Parning.tsx kör dem med `Date.now` och `setTimeout`.
 *
 * Bara en typimport: filen får inte dra in något från servern.
 */

import type { Ogonblick } from "../../lib/salesboard/typer.ts";

/** Klockan och timers. */
export type Tid = {
  nu: () => number;
  sedan: (ms: number, f: () => void) => unknown;
  avbryt: (h: unknown) => void;
};

/** Webbläsarens egen klocka och timers. */
export const VERKLIG_TID: Tid = {
  nu: () => Date.now(),
  sedan: (ms, f) => setTimeout(f, ms),
  avbryt: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Hämtningarna slås ihop till högst en per så lång tid (spec §8). */
export const SAMMANSLAGNING_MS = 1_500;

/**
 * Serverns processcache för ögonblicksbilden (`CACHE_MS` i tavlan.ts, som inte får
 * importeras hit). Provet läser tavlan.ts och håller de två lika.
 */
export const CACHE_MS = 2_000;

/** En ringning hämtar en gång till så här långt efter sig (beslut R24). */
export const EFTERRING_MS = CACHE_MS + 300;

/** En hämtning som inte svarat på så här lång tid är ett fel (en hängande uppkoppling). */
export const TIDSGRANS_MS = 10_000;

export type Hamtare = {
  /** En hämtning så snart sammanslagningen tillåter. Flera begäranden inom fönstret blir en. */
  begar(): void;
  /**
   * Ringklockan: en hämtning nu, och en till `EFTERRING_MS` efter den senaste
   * ringningen.
   *
   * ===========================================================================
   * VARFÖR TVÅ (beslut R24).
   *
   * Servern cachar bilden i 2 s och klienten slår ihop hämtningar på 1,5 s. En order
   * som godkänns inom 2 s efter det senaste bygget, eller en sparad inställning,
   * hade annars fått vänta på den vanliga hämtningen om 60 s: den första hämtningen
   * kan få cachens gamla bild. En hämtning som skickas minst 2,3 s efter ringningen
   * kan bara få ett bygge som börjat efter ändringen.
   * ===========================================================================
   */
  ring(): void;
  stoppa(): void;
};

/**
 * Hämtaren: en hämtning åt gången, högst en per `SAMMANSLAGNING_MS`. Kommer ett
 * begärande medan en hämtning pågår görs en till direkt efteråt (inom fönstret).
 * `hamta` måste alltid avgöras; ge den en tidsgräns (`medTidsgrans`).
 */
export function nyHamtare(tid: Tid, hamta: () => Promise<void>): Hamtare {
  let pagar = false;
  let igen = false;
  let stoppad = false;
  let senastStart = -Infinity;
  let vantande: unknown = null;
  let efterring: unknown = null;

  const kor = (): void => {
    vantande = null;
    if (stoppad) return;
    if (pagar) {
      igen = true;
      return;
    }
    pagar = true;
    senastStart = tid.nu();
    let klar: Promise<void>;
    try {
      klar = Promise.resolve(hamta());
    } catch {
      klar = Promise.resolve();
    }
    void klar
      .catch(() => undefined)
      .then(() => {
        pagar = false;
        if (igen && !stoppad) {
          igen = false;
          begar();
        }
      });
  };

  const begar = (): void => {
    if (stoppad || vantande !== null) return;
    if (pagar) {
      igen = true;
      return;
    }
    const vanta = Math.max(0, senastStart + SAMMANSLAGNING_MS - tid.nu());
    vantande = tid.sedan(vanta, kor);
  };

  return {
    begar,
    ring() {
      if (stoppad) return;
      begar();
      if (efterring !== null) tid.avbryt(efterring);
      efterring = tid.sedan(EFTERRING_MS, () => {
        efterring = null;
        begar();
      });
    },
    stoppa() {
      stoppad = true;
      if (vantande !== null) tid.avbryt(vantande);
      if (efterring !== null) tid.avbryt(efterring);
      vantande = null;
      efterring = null;
    },
  };
}

/**
 * Kör `gor` med en tidsgräns: svarar den inte inom `ms` avbryts den (signalen) och
 * löftet avvisas. En hängande hämtning blir då ett fel som räknas, och hämtningarna
 * fortsätter, i stället för att tavlan står still för gott.
 */
export function medTidsgrans<T>(tid: Tid, ms: number, gor: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ac = new AbortController();
  let vakt: unknown = null;
  const gransen = new Promise<never>((_, nej) => {
    vakt = tid.sedan(ms, () => {
      ac.abort();
      nej(new Error("tidsgräns"));
    });
  });
  return Promise.race([gor(ac.signal), gransen]).finally(() => {
    if (vakt !== null) tid.avbryt(vakt);
  });
}

/** Ett svar med kroppen redan läst (se `hamtaInom`). */
export type Hamtat = {
  status: number;
  ok: boolean;
  type: ResponseType;
  redirected: boolean;
  /** Innehållstypen är JSON. */
  arJson: boolean;
  /** Kroppen som JSON, eller null när den inte var JSON eller inte gick att läsa. */
  kropp: unknown;
};

/**
 * Hämtar och läser svaret till slut, allt inom tidsgränsen. Rubrikerna kommer först och kroppen
 * efter: en server som stannar mitt i svaret hänger annars `json()` för gott, och källan
 * med den. Tidsgränsen avbryter hela hämtningen (signalen) och avvisar löftet, så att också
 * den räknas som ett fel.
 */
export function hamtaInom(tid: Tid, ms: number, anrop: (signal: AbortSignal) => Promise<Response>): Promise<Hamtat> {
  return medTidsgrans(tid, ms, async (signal) => {
    const svar = await anrop(signal);
    const kropp: unknown = await svar.json().catch(() => null);
    return {
      status: svar.status,
      ok: svar.ok,
      type: svar.type,
      redirected: svar.redirected,
      arJson: (svar.headers.get("content-type") ?? "").includes("application/json"),
      kropp,
    };
  });
}

/**
 * Klockans förskjutning mot servern, mätt vid varje svar.
 *
 * Bilden kan komma ur serverns cache och vara upp till 2 s gammal, så en enskild
 * mätning kan ligga efter men aldrig före: den största förskjutningen de senaste
 * minuterna är den som ligger närmast sanningen. Klockan på tavlan hoppar då inte
 * tillbaka en sekund varje gång en hämtning råkar få en cachad bild.
 */
export function nyForskjutning(fonster = 5 * 60_000): { lagg: (t: number, offset: number) => number } {
  const prov: { t: number; offset: number }[] = [];
  return {
    lagg(t, offset) {
      if (Number.isFinite(offset)) prov.push({ t, offset });
      while (prov.length > 1 && prov[0].t < t - fonster) prov.shift();
      return prov.length ? prov.reduce((max, p) => Math.max(max, p.offset), -Infinity) : 0;
    },
  };
}

// -----------------------------------------------------------------------------
// Bilden
// -----------------------------------------------------------------------------

const arObjekt = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;

/**
 * En ögonblicksbild, eller null när kroppen inte är en hel bild. Allt tavlan läser
 * vid ritningen finns med, så att en bild från ett annat bygge (en utrullning som
 * pågår) blir ett tillfälligt fel och inte ett undantag mitt i ritningen.
 */
export function lasBild(data: unknown): Ogonblick | null {
  if (!arObjekt(data)) return null;
  const { manad, idag, installningar, order, personer } = data;
  const giltig =
    data.v === 1 &&
    typeof data.nu === "string" &&
    !Number.isNaN(Date.parse(data.nu)) &&
    arObjekt(manad) &&
    typeof manad.nyckel === "string" &&
    typeof manad.antal === "number" &&
    arObjekt(manad.dagar) &&
    Array.isArray(manad.bidrag) &&
    arObjekt(idag) &&
    typeof idag.datum === "string" &&
    typeof idag.antal === "number" &&
    arObjekt(installningar) &&
    arObjekt(installningar.arbetsdag) &&
    arObjekt(installningar.ljud) &&
    arObjekt(installningar.firande) &&
    Array.isArray(order) &&
    order.every((o) => arObjekt(o) && typeof o.nyckel === "string" && typeof o.tid === "string" && typeof o.dag === "string") &&
    arObjekt(personer) &&
    Array.isArray(data.handelser);
  return giltig ? (data as Ogonblick) : null;
}
