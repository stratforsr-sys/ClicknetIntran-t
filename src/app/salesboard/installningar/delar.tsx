import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { svensktDatum } from "@/lib/klocka";
import { ljudTillatet } from "@/lib/salesboard/regler";
import type { TavlansInstallningar } from "@/lib/salesboard/typer";
// Bara typer: skrivning.ts drar in node:crypto genom parning.ts.
import type { Delar, Skarm } from "@/lib/salesboard/skrivning";
import { Ljudmotor, type Ljudtillstand } from "../ljud";
import type { Kvitto } from "./skrivvag";

/**
 * Säljtavlans inställningar: byggstenarna som korten delar. Klientkod.
 *
 * Kortet och raden, kvittensen, brytaren, valet, klockslaget och beloppet, ljudet
 * (en motor för sidan), klockan och hur en tid skrivs.
 */

// -----------------------------------------------------------------------------
// Typer
// -----------------------------------------------------------------------------

export type Grans = { min: number; max: number };

/** Gränserna klienten behöver. De kommer från sidan: skrivning.ts får inte importeras här. */
export type Granser = {
  volym: Grans;
  belopp: Grans;
  /** Månadens mål i kronor. */
  mal: Grans;
  efterregistreradDagar: Grans;
  /** Ett skärmnamns längsta längd. */
  namn: number;
  kod: { alfabet: string; langd: number; giltigMs: number };
};

export type Lag = { id: string; namn: string };

/** En sparning av en del av inställningarna, med kontrollen som kvitteras och vad som ändrades. */
export type Spara = (kontroll: string, vad: string, delar: Delar) => Promise<void>;

// -----------------------------------------------------------------------------
// Tid och tal
// -----------------------------------------------------------------------------

/**
 * Klockan just nu, omräknad med jämna mellanrum. `forskjutning` är serverns
 * klocka minus datorns, så att "sedd för …" räknas på servertid, som tavlan gör.
 * Bara de delar som visar en tid använder den, så att resten av sidan står still.
 */
export function useNu(ms: number, forskjutning = 0): number {
  const [nu, setNu] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNu(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return nu + forskjutning;
}

const KLOCKA = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const DATUM = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", day: "numeric", month: "short" });
export const TAL = new Intl.NumberFormat("sv-SE");

export const kr = (n: number) => `${TAL.format(Math.ceil(n))} kr`;
export const klockslag = (ms: number) => KLOCKA.format(ms);

/** "nyss", "för 12 s sedan", "för 5 min sedan", "i dag 14:21", "i går 14:21", "12 okt 14:21". */
export function sedan(tid: number, nu: number): string {
  const ms = Math.max(0, nu - tid);
  if (ms < 5_000) return "nyss";
  if (ms < 60_000) return `för ${Math.floor(ms / 1000)} s sedan`;
  if (ms < 3_600_000) return `för ${Math.floor(ms / 60_000)} min sedan`;
  const dag = svensktDatum(new Date(tid));
  if (dag === svensktDatum(new Date(nu))) return `i dag ${klockslag(tid)}`;
  if (dag === svensktDatum(new Date(nu - 86_400_000))) return `i går ${klockslag(tid)}`;
  return `${DATUM.format(tid).replace(".", "")} ${klockslag(tid)}`;
}

/**
 * En TV räknas som ansluten när den hämtat tavlan de senaste tre minuterna.
 *
 * Tre minuter, inte specens två, med flit. Tre fördröjningar ligger på varandra
 * för en TV som mår bra:
 *   - tavlan hämtar sin bild var 60:e sekund när ringklockans kanal är uppe
 *     (spec §8, `MED_KANAL_MS` i kalla.ts), och en gång till efter varje ringning;
 *   - `last_seen_at` skrivs högst en gång i minuten (`SEDD_MS` i atkomst.ts), så
 *     en hämtning strax under minuten skriver inte, och tiden i tabellen kan vara
 *     nästan två minuter gammal när nästa skriver;
 *   - listan här läses om var 30:e sekund.
 * Med två minuter hade en frisk TV blinkat grå. Tre täcker alla tre, och en TV som
 * verkligen tystnat syns ändå som borta inom tre minuter.
 */
export const ANSLUTEN_MS = 180_000;

export const ansluten = (s: Skarm, nu: number) => s.sedd !== null && nu - Date.parse(s.sedd) < ANSLUTEN_MS;

/** Om tavlan låter just nu, med samma regel som tavlan (`ljudTillatet`). */
export function ljudlage(i: TavlansInstallningar, nu: number): { kort: string; lang: string; pa: boolean } {
  if (!i.ljud.pa) return { kort: "Ljudet av", lang: "Av på alla skärmar.", pa: false };
  if (i.ljud.volym <= 0) return { kort: "Ljudet på 0", lang: "Volymen är 0, så det hörs inget.", pa: false };
  if (ljudTillatet(new Date(nu).toISOString(), i.ljud)) return { kort: `Ljudet på, ${i.ljud.volym}`, lang: "Låter nu, på skärmarna som spelar ljud.", pa: true };
  if (i.ljud.fran === i.ljud.till) return { kort: "Tyst nu", lang: "Ljudtiden börjar och slutar samtidigt, så tavlan är alltid tyst.", pa: false };
  return { kort: "Tyst nu", lang: `Tyst nu. Tavlan låter ${i.ljud.helgTyst ? "vardagar " : ""}${i.ljud.fran}–${i.ljud.till}.`, pa: false };
}

// -----------------------------------------------------------------------------
// Ljudet
// -----------------------------------------------------------------------------

/** En motor för sidan. Den låses upp i klicket och stängs aldrig. */
export function useLyssna() {
  const motor = useRef<Ljudmotor | null>(null);
  const [spelar, setSpelar] = useState<string | null>(null);
  const [lage, setLage] = useState<Ljudtillstand | null>(null);
  const klocka = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(klocka.current), []);

  const spela = useCallback(async (id: string, volym: number, langdMs: number, spel: (m: Ljudmotor, t: number) => void) => {
    const m = (motor.current ??= new Ljudmotor());
    // Upplåsningen börjar synkront i klicket; Safari släpper bara fram ljud i själva gesten.
    await m.lasUpp();
    const tillstand = m.tillstand;
    setLage(tillstand);
    if (tillstand !== "igang") return;
    m.satt({ volym, tyst: false });
    spel(m, m.nu() + 0.05);
    setSpelar(id);
    clearTimeout(klocka.current);
    klocka.current = setTimeout(() => setSpelar((s) => (s === id ? null : s)), langdMs);
  }, []);

  return { spela, spelar, lage };
}

export type Lyssna = ReturnType<typeof useLyssna>;

// -----------------------------------------------------------------------------
// Kortet och raden
// -----------------------------------------------------------------------------

export function Kort({ nr, rubrik, text, lage, children }: { nr: string; rubrik: string; text?: ReactNode; lage?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section className="si-kort" aria-labelledby={id}>
      <header className="si-kh">
        <span className="si-nr" aria-hidden="true">
          {nr}
        </span>
        <div className="si-kh-text">
          <h2 id={id}>{rubrik}</h2>
          {text ? <p>{text}</p> : null}
        </div>
        {lage ? <div className="si-kh-lage">{lage}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function Kvittens({ k }: { k: Kvitto | undefined }) {
  if (!k || k.typ !== "sparat") return null;
  return (
    <span className="si-kvitto" aria-hidden="true">
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2.5 6.4 5 8.8l4.6-5.3" />
      </svg>
      {k.text}
    </span>
  );
}

/** Felet under en kontroll. Det läses också upp, i sidans statusrad. */
export function Felrad({ k }: { k: Kvitto | undefined }) {
  return k?.typ === "fel" ? <p className="si-felrad">{k.text}</p> : null;
}

export function Rad({
  titel,
  hjalp,
  k,
  bred = false,
  fot,
  children,
}: {
  titel: ReactNode;
  hjalp?: ReactNode;
  k?: Kvitto;
  /** Kontrollen är bred (ett val, ett reglage) och lägger sig under texten på en smal skärm. */
  bred?: boolean;
  /** En rad under både texten och kontrollen. */
  fot?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`si-rad${bred ? " si-rad-bred" : ""}`}>
      <div className="si-rad-text">
        <div className="si-rad-titel">
          <span>{titel}</span>
          <Kvittens k={k} />
        </div>
        {hjalp ? <div className="si-hjalptext">{hjalp}</div> : null}
        <Felrad k={k} />
      </div>
      <div className="si-rad-kontroll">{children}</div>
      {fot ? <div className="si-rad-fot">{fot}</div> : null}
    </div>
  );
}

/** Ett lugnt besked i ett kort, i stället för innehållet. */
export function Lugn({ children = "Säljtavlans tabeller är inte installerade än." }: { children?: ReactNode }) {
  return (
    <p className="si-lugn">
      <i aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

export function Lampa({ lage }: { lage: "live" | "borta" | "vantar" | "dod" }) {
  return <i className="si-lampa" data-lage={lage} aria-hidden="true" />;
}

// -----------------------------------------------------------------------------
// Kontrollerna
// -----------------------------------------------------------------------------

export function Brytare({ pa, onChange, etikett, avstangd = false }: { pa: boolean; onChange: (pa: boolean) => void; etikett: string; avstangd?: boolean }) {
  return (
    <button type="button" role="switch" className="si-brytare" aria-checked={pa} aria-label={etikett} disabled={avstangd} onClick={() => onChange(!pa)}>
      <i />
    </button>
  );
}

export type Alternativ<T extends string> = { v: T; etikett: string; under?: string };

/** Ett val bland några få, som radioknappar. Piltangenterna flyttar och sparar, som vanliga radioknappar. */
export function Segment<T extends string>({
  varde,
  alternativ,
  onChange,
  etikett,
  avstangd = false,
  lista = false,
}: {
  varde: T;
  alternativ: Alternativ<T>[];
  onChange: (v: T) => void;
  etikett: string;
  avstangd?: boolean;
  /** Alternativen med en rad under var och en, staplade på en smal skärm. */
  lista?: boolean;
}) {
  const namn = useId();
  return (
    <div className={`si-seg${lista ? " si-seg-lista" : ""}`} role="radiogroup" aria-label={etikett}>
      {alternativ.map((a) => (
        <label key={a.v} data-vald={a.v === varde || undefined}>
          <input type="radio" name={namn} value={a.v} checked={a.v === varde} disabled={avstangd} onChange={() => onChange(a.v)} />
          <span>
            {a.etikett}
            {a.under ? <small>{a.under}</small> : null}
          </span>
        </label>
      ))}
    </div>
  );
}

/** Ett klockslag som sparas när fältet lämnas (eller med Enter). Esc ångrar. */
export function Klockslag({ varde, onSpara, etikett }: { varde: string; onSpara: (v: string) => void; etikett: string }) {
  const [utkast, setUtkast] = useState<string | null>(null);
  const avbryt = useRef(false);
  return (
    <input
      type="time"
      className="si-falt si-tid"
      aria-label={etikett}
      value={utkast ?? varde}
      onChange={(e) => setUtkast(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          avbryt.current = true;
          e.currentTarget.blur();
        }
      }}
      onBlur={() => {
        const v = utkast;
        setUtkast(null);
        if (avbryt.current) {
          avbryt.current = false;
          return;
        }
        if (v && /^\d\d:\d\d$/.test(v) && v !== varde) onSpara(v);
      }}
    />
  );
}

/** Ett tal som sparas när det stannat en stund, för reglage och stegknappar. */
export function useUtkast(varde: number, onSpara: (v: number) => void, ms: number) {
  const [utkast, setUtkast] = useState<number | null>(null);
  const spara = useRef(onSpara);
  spara.current = onSpara;
  useEffect(() => {
    if (utkast === null) return;
    const t = setTimeout(() => {
      if (utkast !== varde) spara.current(utkast);
      setUtkast(null);
    }, ms);
    return () => clearTimeout(t);
  }, [utkast, varde, ms]);
  return [utkast ?? varde, setUtkast] as const;
}

/** Ett belopp i kronor, som sparas när fältet lämnas. Gränserna prövas här först, och av rutten. */
/**
 * Ett belopp i kronor som sparas när fältet lämnas (eller med Enter). Escape ångrar.
 * Med `onTom` får fältet lämnas tomt: då visas `tomText` som platshållare, till
 * exempel målet som ärvs från månaden före.
 */
export function Belopp({
  varde,
  grans,
  onSpara,
  etikett = "Belopp för stor affär, i kronor",
  onTom,
  tomText,
}: {
  varde: number | null;
  grans: Grans;
  onSpara: (v: number) => void;
  etikett?: string;
  onTom?: () => void;
  tomText?: string;
}) {
  const [utkast, setUtkast] = useState<string | null>(null);
  const [fel, setFel] = useState<string | null>(null);
  const avbryt = useRef(false);
  return (
    <span className="si-belopp">
      <span className="si-beloppfalt" data-fel={fel ? true : undefined}>
        <input
          className="si-falt si-mono"
          inputMode="numeric"
          aria-label={etikett}
          aria-invalid={fel ? true : undefined}
          placeholder={tomText}
          value={utkast ?? (varde === null ? "" : TAL.format(varde))}
          onFocus={() => setUtkast(varde === null ? "" : String(varde))}
          onChange={(e) => setUtkast(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              avbryt.current = true;
              e.currentTarget.blur();
            }
          }}
          onBlur={() => {
            const text = (utkast ?? "").replace(/\s/g, "");
            setUtkast(null);
            if (avbryt.current) {
              avbryt.current = false;
              setFel(null);
              return;
            }
            if (text === "" && onTom) {
              setFel(null);
              if (varde !== null) onTom();
              return;
            }
            const n = /^\d+$/.test(text) ? Number(text) : Number.NaN;
            if (!Number.isInteger(n) || n < grans.min || n > grans.max) {
              setFel(`Ett belopp från ${TAL.format(grans.min)} till ${TAL.format(grans.max)} kr.`);
              return;
            }
            setFel(null);
            if (n !== varde) onSpara(n);
          }}
        />
        <span aria-hidden="true">kr</span>
      </span>
      {fel ? <span className="si-felrad">{fel}</span> : null}
    </span>
  );
}

// -----------------------------------------------------------------------------
// Ikonerna
// -----------------------------------------------------------------------------

export function Pil() {
  return (
    <svg className="si-pil" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M4.2 2.5h5.3v5.3M9.3 2.7 2.6 9.4" />
    </svg>
  );
}

export function Spela() {
  return (
    <svg className="si-spela" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3.5 2.3v7.4L9.6 6z" />
    </svg>
  );
}
