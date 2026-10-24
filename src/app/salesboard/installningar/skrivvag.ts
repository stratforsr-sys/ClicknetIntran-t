import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TavlansInstallningar } from "@/lib/salesboard/typer";
// Bara typer: skrivning.ts drar in node:crypto genom parning.ts, och `import type`
// försvinner i bygget.
import type { Saljare, Skarm, Troskel } from "@/lib/salesboard/skrivning";

/**
 * Säljtavlans inställningar: skrivvägen och kvittenserna. Klientkod.
 *
 * Som Nav 2.0:s ndSkriv: en kö, en tidsgräns och svaret i klartext. Skrivningarna
 * går en i taget, i den ordning de gjordes, så att två snabba ändringar aldrig
 * når servern i fel ordning. Det som visas är det servern senast bekräftat med
 * ändringarna som väntar ovanpå (`useForslag`), så ett nej tar bara bort sin egen
 * ändring. Varje ändring kvitteras med "Sparat" i 1,5 s (`useKvitton`).
 */

/** Rutten svarar så här, på en skrivning och på läsningen av skärmarna. */
export type Svar = {
  ok?: string;
  fel?: string;
  del?: string;
  pagar?: boolean;
  installningar?: TavlansInstallningar;
  skarmar?: Skarm[];
  personer?: Saljare[];
  /** Laget byttes, men dess säljare gick inte att läsa om. Kortet ska inte visa det gamla lagets. */
  personerInaktuella?: boolean;
  troskel?: Troskel | null;
  /** Den nya skärmen, efter `para`. */
  ny?: string;
  /** Serverns klocka, efter läsningen av skärmarna. */
  nu?: string;
};

export type Utfall = { ok: true; svar: Svar } | { ok: false; fel: string; utloggad?: boolean; hangde?: boolean; pagar?: boolean };

const TIDSGRANS_MS = 20_000;
/** En nyckel som hängde gäller så länge för samma skrivning. */
const NYCKEL_MS = 60_000;

const RUTT = "/salesboard/skriv";

export const TEXT = {
  utloggad: "Du är utloggad. Logga in i en ny flik och ändra en gång till.",
  tid: "Nav svarade inte på 20 sekunder. Det kan ha sparats: ladda om och titta innan du försöker igen.",
  natet: "Nav gick inte att nå. Det kan ha sparats: ladda om och titta innan du försöker igen.",
  serverfel: (status: number) => `Nav kunde inte spara (fel ${status}). Försök igen om en stund.`,
  fel: "Det gick inte att spara.",
};

const nyNyckel = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/** Ett svar i klartext. Inloggningen och lösenordsbytet svarar med en sida, aldrig med JSON. */
async function tolka(r: Response): Promise<Utfall> {
  if (!/json/i.test(r.headers.get("content-type") ?? "")) {
    return r.status >= 500 ? { ok: false, fel: TEXT.serverfel(r.status) } : { ok: false, fel: TEXT.utloggad, utloggad: true };
  }
  const data = (await r.json().catch(() => null)) as Svar | null;
  if (!data) return { ok: false, fel: TEXT.fel };
  if (r.status === 401) return { ok: false, fel: data.fel ?? TEXT.utloggad, utloggad: true };
  if (!r.ok || data.fel) return { ok: false, fel: data.fel ?? TEXT.serverfel(r.status), pagar: r.status === 409 && data.pagar === true };
  return { ok: true, svar: data };
}

async function anropa(init: RequestInit): Promise<Utfall> {
  const ac = new AbortController();
  const vakt = setTimeout(() => ac.abort(), TIDSGRANS_MS);
  try {
    return await tolka(await fetch(RUTT, { ...init, credentials: "same-origin", signal: ac.signal }));
  } catch (e) {
    return { ok: false, fel: e instanceof Error && e.name === "AbortError" ? TEXT.tid : TEXT.natet, hangde: true };
  } finally {
    clearTimeout(vakt);
  }
}

/** En skrivning. Nyckeln skickas bara för det som skapar något (se `useSkrivning`). */
function skicka(kropp: object, nyckel: string | null): Promise<Utfall> {
  const huvud: Record<string, string> = { "Content-Type": "application/json" };
  if (nyckel) huvud["X-Nav-Nyckel"] = nyckel;
  return anropa({ method: "POST", headers: huvud, body: JSON.stringify(kropp) });
}

/** Skärmarna, för "sedd för …". Bara skärmkortet bryr sig om svaret. */
export function hamtaSkarmar(): Promise<Utfall> {
  return anropa({ method: "GET", cache: "no-store" });
}

/**
 * Skickar skrivningar en i taget, i den ordning de gjordes.
 *
 * `engang` är för det som skapar något (para, testa): ett dubbeltryck medan
 * samma skrivning är på väg skickas inte (svaret blir null), och den bär en
 * nyckel (`X-Nav-Nyckel`) som återanvänds efter ett försök som hängde, så att
 * servern (`medNyckel`) inte gör det två gånger.
 *
 * En inställning skickas utan nyckel. "På, av, på" är tre ändringar, och ett
 * omspelat svar på den första hade ljugit om den sista. En ny nyckel varje gång
 * hade inte spelats om heller, bara kostat tre turer mot databasen.
 */
export function useSkrivning() {
  const ko = useRef<Promise<unknown>>(Promise.resolve());
  const pagaende = useRef(new Set<string>());
  const hangda = useRef(new Map<string, { nyckel: string; t: number }>());

  return useCallback((kropp: object, { engang = false }: { engang?: boolean } = {}): Promise<Utfall | null> => {
    const las = JSON.stringify(kropp);
    if (engang && pagaende.current.has(las)) return Promise.resolve(null);
    if (engang) pagaende.current.add(las);

    const kor = async (): Promise<Utfall> => {
      if (!engang) return skicka(kropp, null);
      const forra = hangda.current.get(las);
      const nyckel = forra && Date.now() - forra.t < NYCKEL_MS ? forra.nyckel : nyNyckel();
      const u = await skicka(kropp, nyckel);
      if (!u.ok && (u.hangde || u.pagar)) hangda.current.set(las, { nyckel, t: Date.now() });
      else hangda.current.delete(las);
      return u;
    };
    const p = ko.current.then(kor, kor).finally(() => {
      if (engang) pagaende.current.delete(las);
    });
    ko.current = p.catch(() => undefined);
    return p;
  }, []);
}

let lopnummer = 0;

/** Det som visas: det servern bekräftat, med ändringarna som väntar ovanpå. */
export function useForslag<T, O>(start: T, lagg: (t: T, op: O) => T) {
  const [bas, setBas] = useState(start);
  const [vantande, setVantande] = useState<{ n: number; op: O }[]>([]);
  const visad = useMemo(() => vantande.reduce((t, v) => lagg(t, v.op), bas), [bas, vantande, lagg]);

  /** Lägger en ändring ovanpå. `ok(ny)` tar serverns svar (eller ändringen) som bekräftat, `nej()` släpper den. */
  const foresla = useCallback(
    (op: O) => {
      const n = ++lopnummer;
      setVantande((v) => [...v, { n, op }]);
      const slapp = () => setVantande((v) => v.filter((x) => x.n !== n));
      return {
        ok: (ny?: T) => {
          setBas((b) => ny ?? lagg(b, op));
          slapp();
        },
        nej: slapp,
      };
    },
    [lagg],
  );
  return { visad, setBas, foresla, vantar: vantande.length > 0 };
}

export type Kvitto = { typ: "sparat" | "fel"; text: string };

/** "Sparat" i 1,5 s per kontroll, och ett fel som står kvar tills kontrollen ändras igen. */
export function useKvitton() {
  const [alla, setAlla] = useState<Record<string, Kvitto>>({});
  const [meddelande, setMeddelande] = useState({ text: "", n: 0 });
  const klockor = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const k = klockor.current;
    return () => k.forEach(clearTimeout);
  }, []);

  const satt = useCallback((id: string, kvitto: Kvitto | null, ms?: number) => {
    const forra = klockor.current.get(id);
    if (forra) clearTimeout(forra);
    klockor.current.delete(id);
    setAlla((a) => {
      if (!kvitto && !(id in a)) return a;
      const b = { ...a };
      if (kvitto) b[id] = kvitto;
      else delete b[id];
      return b;
    });
    if (kvitto && ms) {
      klockor.current.set(
        id,
        setTimeout(() => {
          klockor.current.delete(id);
          setAlla((a) => {
            const b = { ...a };
            delete b[id];
            return b;
          });
        }, ms),
      );
    }
  }, []);

  return useMemo(
    () => ({
      alla,
      meddelande,
      borjar: (id: string) => satt(id, null),
      klart: (id: string, vad: string, text = "Sparat") => {
        satt(id, { typ: "sparat", text }, 1500);
        setMeddelande((m) => ({ text: `${vad}: ${text.toLowerCase()}.`, n: m.n + 1 }));
      },
      fel: (id: string, text: string) => {
        satt(id, { typ: "fel", text });
        setMeddelande((m) => ({ text, n: m.n + 1 }));
      },
    }),
    [alla, meddelande, satt],
  );
}
