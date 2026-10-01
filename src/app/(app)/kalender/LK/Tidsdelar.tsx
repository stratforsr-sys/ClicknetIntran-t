"use client";

import { useEffect, useRef, useState } from "react";
import {
  ML,
  WDL,
  datumLang,
  dayLabel,
  dd,
  hm,
  isFree,
  isWeekend,
  len,
  mm,
  monday,
  plus,
  upptagnaAv,
  wd,
  weekno,
  type Upptaget,
} from "@/lib/leveranskalender";
import { hamtaUpptaget } from "../moten/actions";
import { Av, type Lk } from "./gemensamt";

// -----------------------------------------------------------------------------
// Upptagen tid
// -----------------------------------------------------------------------------

/**
 * Upptagen tid för personerna, två veckor från dagen. Hämtas om när personerna
 * byts eller dagen lämnar fönstret. Läsningen går genom projektionerna, så
 * assistenten får aldrig veta mer än att tiden är tagen (AC 13).
 */
export function useUpptaget(personer: string[], dag: string): { data: Upptaget; laddar: boolean } {
  const nyckel = [...personer].sort().join(",");
  const [lage, setLage] = useState<{ nyckel: string; fran: string; data: Upptaget } | null>(null);
  const [laddar, setLaddar] = useState(false);

  const inom = lage && lage.nyckel === nyckel && dag >= lage.fran && dag <= plus(lage.fran, 14);

  useEffect(() => {
    if (inom || personer.length === 0) return;
    let aktuell = true;
    setLaddar(true);
    hamtaUpptaget(personer, dag, plus(dag, 14)).then((data) => {
      if (!aktuell) return;
      setLage({ nyckel, fran: dag, data });
      setLaddar(false);
    });
    return () => {
      aktuell = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nyckel, dag, inom]);

  return { data: lage?.nyckel === nyckel ? lage.data : {}, laddar };
}

/** Vilka som är upptagna — eller alla, när det är helg. */
export function upptagnaI(upp: Upptaget, personer: string[], dag: string, s: number, m: number, skip: string | null): string[] {
  if (isWeekend(dag)) return personer;
  return upptagnaAv(upp, personer, dag, s, m, skip);
}

// -----------------------------------------------------------------------------
// Datumfältet och datumväljaren (AC 9)
// -----------------------------------------------------------------------------

export function Datumfalt({ dag, setDag, lk }: { dag: string; setDag: (d: string) => void; lk: Lk }) {
  const [oppen, setOppen] = useState(false);
  const [manad, setManad] = useState(dag.slice(0, 7));
  const [fokus, setFokus] = useState(dag);
  const knapp = useRef<HTMLButtonElement>(null);
  const ruta = useRef<HTMLDivElement>(null);

  const stang = (tillbaka = true) => {
    setOppen(false);
    if (tillbaka) knapp.current?.focus();
  };

  useEffect(() => {
    if (!oppen) return;
    ruta.current?.querySelector<HTMLButtonElement>(`[data-dpd="${fokus}"].d`)?.focus();
  }, [oppen, fokus, manad]);

  useEffect(() => {
    if (!oppen) return;
    const ute = (ev: MouseEvent) => {
      const t = ev.target as Node;
      if (!ruta.current?.contains(t) && !knapp.current?.contains(t)) setOppen(false);
    };
    document.addEventListener("mousedown", ute);
    return () => document.removeEventListener("mousedown", ute);
  }, [oppen]);

  const [y, m] = manad.split("-").map(Number);
  const start = monday(`${manad}-01`);
  const rader: string[] = [];
  for (let r = 0; r < 6; r++) {
    const w0 = plus(start, r * 7);
    if (r >= 4 && mm(w0) !== m && w0 > `${manad}-01`) break;
    rader.push(w0);
  }

  const valj = (d: string) => {
    setDag(d);
    stang();
  };

  const tangent = (ev: React.KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      stang();
      return;
    }
    const b = (ev.target as HTMLElement).closest<HTMLElement>(".dp button.d");
    if (!b) return;
    const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[ev.key];
    if (step != null) {
      ev.preventDefault();
      const nd = plus(b.dataset.dpd!, step);
      setFokus(nd);
      setManad(nd.slice(0, 7));
    }
  };

  const navigera = (dir: number) => {
    const d = new Date(Date.UTC(y, m - 1 + dir, 1));
    const ny = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    setManad(ny);
    setFokus(`${ny}-01`);
  };

  return (
    <div className="field dpwrap">
      <span id="fDayLab">Datum</span>
      <button
        ref={knapp}
        type="button"
        className="dfield"
        id="fDayBtn"
        aria-haspopup="dialog"
        aria-expanded={oppen}
        aria-labelledby="fDayLab fDayBtn"
        onClick={() => {
          setManad(dag.slice(0, 7));
          setFokus(dag);
          setOppen((o) => !o);
        }}
      >
        <span aria-hidden="true">📅</span>
        <span className="dmain">{datumLang(dag)}</span>
        <span className="wk">v. {weekno(dag)}</span>
      </button>
      {oppen && (
        <div className="dp" role="dialog" aria-label="Välj datum" ref={ruta} onKeyDown={tangent}>
          <div className="dph">
            <button type="button" className="btn icon ghost sm" data-dpnav="-1" aria-label="Föregående månad" onClick={() => navigera(-1)}>
              ‹
            </button>
            <span aria-live="polite">
              {ML[m].charAt(0).toUpperCase() + ML[m].slice(1)} {y}
            </span>
            <button type="button" className="btn icon ghost sm" data-dpnav="1" aria-label="Nästa månad" onClick={() => navigera(1)}>
              ›
            </button>
          </div>
          <div className="dpg">
            <span className="h" title="Veckonummer">
              v.
            </span>
            {["M", "T", "O", "T", "F", "L", "S"].map((x, i) => (
              <span key={i} className="h" aria-hidden="true">
                {x}
              </span>
            ))}
            {rader.map((w0) => (
              <Rad key={w0} w0={w0} m={m} dag={dag} fokus={fokus} idag={lk.data.idag} valj={valj} />
            ))}
          </div>
          <div className="dpf">
            <button type="button" className="btn sm ghost" data-dpd={lk.data.hem} onClick={() => valj(lk.data.hem)}>
              Idag
            </button>
            <span>Pilar flyttar · Enter väljer · Esc stänger</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Rad({ w0, m, dag, fokus, idag, valj }: { w0: string; m: number; dag: string; fokus: string; idag: string; valj: (d: string) => void }) {
  return (
    <>
      <span className="w" aria-hidden="true">
        {weekno(w0)}
      </span>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => {
        const d = plus(w0, i);
        return (
          <button
            key={d}
            type="button"
            className={`d${mm(d) !== m ? " out" : ""}${isWeekend(d) ? " we" : ""}${d === idag ? " today" : ""}`}
            data-dpd={d}
            aria-selected={d === dag}
            tabIndex={d === fokus ? 0 : -1}
            aria-label={`${WDL[wd(d)]} ${dd(d)} ${ML[mm(d)]}, vecka ${weekno(d)}`}
            onClick={() => valj(d)}
          >
            {dd(d)}
          </button>
        );
      })}
    </>
  );
}

// -----------------------------------------------------------------------------
// Start, slut och snabbval (AC 10)
// -----------------------------------------------------------------------------

export function Tidsval({
  start,
  minuter,
  setStart,
  setMinuter,
}: {
  start: number;
  minuter: number;
  setStart: (m: number) => void;
  setMinuter: (m: number) => void;
}) {
  const starter: number[] = [];
  for (let m = 6 * 60; m <= 20 * 60 - 15; m += 15) starter.push(m);
  const slut: number[] = [];
  for (let m = start + 15; m <= Math.min(23 * 60 + 45, start + 8 * 60); m += 15) slut.push(m);

  return (
    <>
      <div className="grid2">
        <label className="field" htmlFor="fStart">
          Start
          <select id="fStart" value={start} onChange={(e) => setStart(Number(e.target.value))}>
            {!starter.includes(start) && <option value={start}>{hm(start)}</option>}
            {starter.map((m) => (
              <option key={m} value={m}>
                {hm(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="field" htmlFor="fEnd">
          Slut
          <select id="fEnd" value={start + minuter} onChange={(e) => setMinuter(Math.max(15, Number(e.target.value) - start))}>
            {!slut.includes(start + minuter) && <option value={start + minuter}>{hm(start + minuter)}</option>}
            {slut.map((m) => (
              <option key={m} value={m}>
                {hm(m)} ({len(m - start)})
              </option>
            ))}
          </select>
        </label>
      </div>
      <span className="durlab" id="durLab">
        Snabbval
      </span>
      <div className="durs" role="group" aria-labelledby="durLab">
        {[15, 30, 60].map((m) => (
          <button key={m} type="button" data-dur={m} aria-pressed={minuter === m} onClick={() => setMinuter(m)}>
            {m === 60 ? "1 timme" : `${m} min`}
          </button>
        ))}
      </div>
    </>
  );
}

// -----------------------------------------------------------------------------
// Schemaläggningsassistenten (AC 11, 13)
// -----------------------------------------------------------------------------

export function Assistent({
  lk,
  personer,
  dag,
  start,
  minuter,
  skip,
  upp,
  setStart,
  foresla,
}: {
  lk: Lk;
  personer: string[];
  dag: string;
  start: number;
  minuter: number;
  skip: string | null;
  upp: Upptaget;
  setStart: (m: number) => void;
  foresla: () => void;
}) {
  const S0 = 8 * 60;
  const S1 = 17 * 60;
  const span = S1 - S0;
  const pct = (m: number) => ((Math.max(S0, Math.min(S1, m)) - S0) / span) * 100;
  const krock = !isFree(upp, personer, dag, start, minuter, skip);

  return (
    <>
      <div className="sa">
        <div className="sah">
          <span>Schemaläggningsassistent · {dayLabel(dag)}</span>
          <button className="btn sm" type="button" id="fPick" onClick={foresla}>
            Föreslå tid
          </button>
        </div>
        <div className="axis" aria-hidden="true">
          <span />
          {[8, 9, 10, 11, 12, 13, 14, 15, 16].map((x) => (
            <span key={x}>{x}</span>
          ))}
        </div>
        {personer.map((p) => {
          const d = upp[p]?.[dag];
          return (
            <div key={p} className="sar">
              <span className="san">
                <Av person={lk.personer.get(p)} style={{ width: 16, height: 16, fontSize: 7 }} />
                {lk.personer.get(p)?.fornamn}
              </span>
              <div
                className="sat"
                data-sat="1"
                title="Klicka för att välja tid"
                onClick={(ev) => {
                  const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
                  const x = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
                  setStart(Math.min(S1 - 15, Math.round((S0 + x * 9 * 60) / 15) * 15));
                }}
              >
                {d?.ledig && <div className="blk ooo" style={{ left: 0, width: "100%" }} />}
                {(d?.block ?? [])
                  .filter((b) => b.id !== skip)
                  .map((b, i) => (
                    <div key={i} className="blk" style={{ left: `${pct(b.s)}%`, width: `${Math.max(0, pct(b.e) - pct(b.s))}%` }} />
                  ))}
                <div className={`band${krock ? " clash" : ""}`} style={{ left: `${pct(start)}%`, width: `${pct(start + minuter) - pct(start)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="hint" style={{ marginTop: 6 }} aria-live="polite">
        {isWeekend(dag) ? (
          "Det är helg. Tryck Föreslå tid för nästa vardag."
        ) : krock ? (
          <>
            <b style={{ color: "var(--color-danger-ink)" }}>Krockar</b> med någons kalender. Klicka i en rad eller tryck Föreslå tid.
          </>
        ) : (
          "Alla är lediga. Klicka i en rad för att välja en annan tid."
        )}
      </p>
    </>
  );
}

// -----------------------------------------------------------------------------
// Delat av formulären
// -----------------------------------------------------------------------------

export function Stang({ stang }: { stang: () => void }) {
  return (
    <button className="btn icon ghost x" type="button" id="dClose" aria-label="Stäng" onClick={stang}>
      ✕
    </button>
  );
}

/** `clashHTML()`. Visas före sparandet när tiden krockar (AC 12). */
export function Krockruta({
  lk,
  krock,
  dag,
  start,
  minuter,
  tvinga,
  hitta,
}: {
  lk: Lk;
  krock: string[] | null;
  dag: string;
  start: number;
  minuter: number;
  tvinga: () => void;
  hitta: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (krock?.length) ref.current?.focus();
  }, [krock]);
  if (!krock || !krock.length) return null;
  return (
    <div className="clashbox" id="fClash" tabIndex={-1} role="alert" ref={ref}>
      <b>{isWeekend(dag) ? "Det är helg" : "Krockar för " + krock.map((id) => lk.personer.get(id)?.fornamn ?? "").join(", ")}</b>
      <span>
        {dayLabel(dag)} {hm(start)}–{hm(start + minuter)} är redan upptagen. Boka ändå, eller låt Nav hitta en tid där alla är lediga.
      </span>
      <div className="acts">
        <button className="btn sm danger" type="button" id="fForce" onClick={tvinga}>
          Boka ändå
        </button>
        <button className="btn sm" type="button" id="fPick2" onClick={hitta}>
          Hitta ledig tid
        </button>
      </div>
    </div>
  );
}

