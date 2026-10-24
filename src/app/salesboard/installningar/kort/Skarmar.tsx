import { useId, useRef, useState } from "react";
import type { Skarm } from "@/lib/salesboard/skrivning";
import { ANSLUTEN_MS, Brytare, Felrad, Kort, Kvittens, Lampa, Lugn, ansluten, klockslag, sedan, useNu, type Granser } from "../delar";
import type { Kvitto } from "../skrivvag";

/**
 * 01 Skärmar: para en TV med koden den visar, listan med "sedd för …", ljudet per
 * skärm, byt namn och koppla bort, och hjälpen för att sätta upp en TV. Klientkod.
 *
 * Listan läses om av sidan (`GET /salesboard/skriv`). Går en omläsning fel står
 * den gamla listan kvar, med en rad om när den senast gick att läsa.
 */

export function Skarmkort({
  installerad,
  skarmar,
  forskjutning,
  uppdateringsfel,
  nyast,
  granser,
  adress,
  k,
  onPara,
  onNamn,
  onLjud,
  onBort,
}: {
  installerad: boolean;
  skarmar: Skarm[];
  /** Serverns klocka minus datorns. */
  forskjutning: number;
  /** När en omläsning av listan senast gick fel, eller null. */
  uppdateringsfel: number | null;
  nyast: string | null;
  granser: Granser;
  adress: string;
  k: Record<string, Kvitto>;
  onPara: (kod: string, namn: string) => Promise<boolean>;
  onNamn: (s: Skarm, namn: string) => void;
  onLjud: (s: Skarm, pa: boolean) => void;
  onBort: (s: Skarm) => void;
}) {
  return (
    <Kort
      nr="01"
      rubrik="Skärmar"
      text="TV:apparaterna som visar tavlan. En skärm paras en gång och håller sig sedan inloggad."
      lage={installerad && skarmar.length > 0 ? <Anslutna skarmar={skarmar} forskjutning={forskjutning} /> : null}
    >
      {!installerad ? (
        <Lugn />
      ) : (
        <>
          <Parning granser={granser} adress={adress} antal={skarmar.length} k={k.para} onPara={onPara} />
          {skarmar.length > 0 ? (
            <ul className="si-skarmar">
              {skarmar.map((s) => (
                <Skarmrad
                  key={s.id}
                  s={s}
                  forskjutning={forskjutning}
                  ny={s.id === nyast}
                  granser={granser}
                  k={k[`skarm:${s.id}`]}
                  onNamn={onNamn}
                  onLjud={onLjud}
                  onBort={onBort}
                />
              ))}
            </ul>
          ) : null}
          {uppdateringsfel !== null ? (
            <p className="si-uppdatering" role="status">
              Kunde inte uppdatera {klockslag(uppdateringsfel)}. Listan visar det som senast gick att läsa, och sidan försöker igen.
            </p>
          ) : null}
          <Felrad k={k.skarmar} />
          <TvHjalp adress={adress} />
        </>
      )}
    </Kort>
  );
}

/** "1/3 anslutna" i kortets huvud, omräknat var tionde sekund. */
function Anslutna({ skarmar, forskjutning }: { skarmar: Skarm[]; forskjutning: number }) {
  const nu = useNu(10_000, forskjutning);
  return (
    <span className="si-tal-lage">
      <b>{skarmar.filter((s) => ansluten(s, nu)).length}</b>/{skarmar.length} anslutna
    </span>
  );
}

/** Koden från TV:n, med eller utan streck och i valfria bokstäver. Den visas som "K7M4-QX9P" medan den skrivs. */
function Parning({
  granser,
  adress,
  antal,
  k,
  onPara,
}: {
  granser: Granser;
  adress: string;
  antal: number;
  k: Kvitto | undefined;
  onPara: (kod: string, namn: string) => Promise<boolean>;
}) {
  const { alfabet, langd, giltigMs } = granser.kod;
  const [kod, setKod] = useState("");
  const [namn, setNamn] = useState("");
  const [skickar, setSkickar] = useState(false);
  const kodId = useId();
  const namnId = useId();
  const hjalpId = useId();

  const ren = kod.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, langd);
  const halva = langd / 2;
  const visad = ren.length > halva ? `${ren.slice(0, halva)}-${ren.slice(halva)}` : ren;
  const fel = [...new Set([...ren].filter((t) => !alfabet.includes(t)))];
  const forslag = `Skärm ${antal + 1}`;
  const klar = ren.length === langd && fel.length === 0 && !skickar;

  async function skicka() {
    if (!klar) return;
    setSkickar(true);
    const gick = await onPara(ren, namn.trim() || forslag);
    setSkickar(false);
    if (gick) {
      setKod("");
      setNamn("");
    }
  }

  return (
    <form
      className="si-para"
      onSubmit={(e) => {
        e.preventDefault();
        void skicka();
      }}
    >
      <div className="si-para-falt">
        <label htmlFor={kodId} className="si-etikett">
          Kod från TV:n
        </label>
        <div className="si-kodfalt" data-fel={fel.length > 0 || undefined}>
          <input
            id={kodId}
            className="si-falt si-kod"
            value={visad}
            onChange={(e) => setKod(e.target.value)}
            placeholder="K7M4-QX9P"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={langd + 4}
            aria-describedby={hjalpId}
            aria-invalid={fel.length > 0 || undefined}
          />
          <span className="si-kod-rakning" aria-hidden="true">
            {ren.length}/{langd}
          </span>
        </div>
      </div>
      <div className="si-para-falt si-para-namn">
        <label htmlFor={namnId} className="si-etikett">
          Namn
        </label>
        <input
          id={namnId}
          className="si-falt"
          value={namn}
          onChange={(e) => setNamn(e.target.value)}
          placeholder={forslag}
          maxLength={granser.namn}
          autoComplete="off"
        />
      </div>
      <button type="submit" className="si-knapp si-knapp-p" disabled={!klar} aria-busy={skickar || undefined}>
        {skickar ? "Parar…" : "Para"}
      </button>
      <p id={hjalpId} className={`si-para-hjalp${fel.length ? " si-para-fel" : ""}`}>
        {fel.length > 0
          ? `Koden har aldrig ${fel.join(", ")}. Den använder inte I, O, 0 och 1, som är lätta att läsa fel.`
          : `Koden står på TV:n när den öppnar ${adress}. Den gäller i ${Math.round(giltigMs / 60_000)} minuter.`}
      </p>
      {k?.typ === "fel" ? <p className="si-felrad si-para-svar">{k.text}</p> : null}
      {k?.typ === "sparat" ? (
        <p className="si-para-svar si-para-ok" aria-hidden="true">
          <Kvittens k={k} /> TV:n hämtar sin nyckel inom några sekunder.
        </p>
      ) : null}
    </form>
  );
}

function Skarmrad({
  s,
  forskjutning,
  ny,
  granser,
  k,
  onNamn,
  onLjud,
  onBort,
}: {
  s: Skarm;
  forskjutning: number;
  ny: boolean;
  granser: Granser;
  k: Kvitto | undefined;
  onNamn: (s: Skarm, namn: string) => void;
  onLjud: (s: Skarm, pa: boolean) => void;
  onBort: (s: Skarm) => void;
}) {
  // Raden räknar sin egen tid: "sedd för 12 s sedan" går varje sekund, resten av sidan står still.
  const nu = useNu(1000, forskjutning);
  const [andrar, setAndrar] = useState<string | null>(null);
  const [fragar, setFragar] = useState(false);
  const avbryt = useRef(false);

  // Skärmens läge: väntar på TV:n, ansluten (inom ANSLUTEN_MS) eller inte sedd på ett tag.
  const giltig = granser.kod.giltigMs + 60_000;
  let lage: "live" | "borta" | "vantar" | "dod";
  let text: string;
  if (!s.parad) {
    const gammal = nu - Date.parse(s.skapad) > giltig;
    lage = gammal ? "dod" : "vantar";
    text = gammal ? "TV:n anslöt aldrig. Koppla bort och para igen." : "Väntar på TV:n";
  } else if (!s.sedd) {
    lage = "borta";
    text = "Parad, inte sedd än";
  } else {
    const t = Date.parse(s.sedd);
    lage = nu - t < ANSLUTEN_MS ? "live" : "borta";
    text = `Sedd ${sedan(t, nu)}`;
  }

  function sparaNamn() {
    const namn = (andrar ?? "").replace(/\s+/g, " ").trim();
    setAndrar(null);
    if (avbryt.current) {
      avbryt.current = false;
      return;
    }
    if (namn && namn !== s.namn) onNamn(s, namn);
  }

  return (
    <li className="si-skarm" data-ny={ny || undefined} data-lage={lage}>
      <Lampa lage={lage} />
      <div className="si-skarm-text">
        <div className="si-rad-titel">
          {andrar !== null ? (
            <input
              className="si-falt si-namnfalt"
              value={andrar}
              onChange={(e) => setAndrar(e.target.value)}
              onBlur={sparaNamn}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  avbryt.current = true;
                  e.currentTarget.blur();
                }
              }}
              maxLength={granser.namn}
              aria-label={`Nytt namn för ${s.namn}`}
              autoFocus
            />
          ) : (
            <b>{s.namn}</b>
          )}
          <Kvittens k={k} />
        </div>
        <p className="si-skarm-meta">
          <span className={lage === "dod" ? "si-varn" : undefined}>{text}</span>
          {s.webblasare ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="si-mono">{s.webblasare}</span>
            </>
          ) : null}
        </p>
        {s.tv ? <p className="si-skarm-tv">TV:ns egen webbläsare släpper sällan fram ljud. En mini-PC med Chromium är säkrare.</p> : null}
        <Felrad k={k} />
      </div>
      <div className="si-skarm-kontroller">
        <label className="si-skarm-ljud">
          <span>Ljud</span>
          <Brytare pa={s.ljud} etikett={`Spela ljud på ${s.namn}`} onChange={(pa) => onLjud(s, pa)} />
        </label>
        {fragar ? (
          <span className="si-fraga" role="group" aria-label={`Koppla bort ${s.namn}?`}>
            <button type="button" className="si-knapp si-knapp-fara" onClick={() => onBort(s)}>
              Koppla bort
            </button>
            <button type="button" className="si-knapp si-knapp-tyst" onClick={() => setFragar(false)}>
              Avbryt
            </button>
          </span>
        ) : (
          <span className="si-fraga">
            <button type="button" className="si-knapp si-knapp-tyst" onClick={() => setAndrar(s.namn)} disabled={andrar !== null}>
              Byt namn
            </button>
            <button type="button" className="si-knapp si-knapp-tyst" onClick={() => setFragar(true)}>
              Koppla bort
            </button>
          </span>
        )}
      </div>
      {fragar ? <p className="si-skarm-fraga">TV:n visar parningen igen vid nästa hämtning, inom en minut.</p> : null}
    </li>
  );
}

function TvHjalp({ adress }: { adress: string }) {
  const [kopierat, setKopierat] = useState(false);
  const kommando = `chromium --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --disable-features=Translate --check-for-update-interval=31536000 --autoplay-policy=no-user-gesture-required https://${adress}`;
  return (
    <details className="si-hjalp">
      <summary>
        <span>Sätta upp en TV</span>
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 6 7.5l3-3" />
        </svg>
      </summary>
      <ol>
        <li>
          <b>Datorn.</b> En mini-PC eller en Raspberry Pi 5 med Chromium, kopplad till TV:n med HDMI. Stäng av skärmsläckaren och
          strömsparläget.
        </li>
        <li>
          <b>Kioskläget.</b> Starta Chromium med flaggorna nedan. Den sista låter tavlan spela ljud utan att någon klickar.
        </li>
        <li>
          <b>Koden.</b> TV:n visar en kod på åtta tecken. Skriv in den här ovan och ge skärmen ett namn.
        </li>
        <li>
          <b>Undvik TV:ns egen webbläsare</b> om det ska låta. Den släpper sällan fram ljud utan ett klick på skärmen.
        </li>
      </ol>
      <div className="si-kommando">
        <code>{kommando}</code>
        <button
          type="button"
          className="si-knapp si-knapp-tyst"
          onClick={() => {
            void navigator.clipboard?.writeText(kommando).then(
              () => {
                setKopierat(true);
                setTimeout(() => setKopierat(false), 1500);
              },
              () => undefined,
            );
          }}
        >
          {kopierat ? "Kopierat" : "Kopiera"}
        </button>
      </div>
    </details>
  );
}
