"use client";

/**
 * Säljtavlan i vila: rubriken, topplistan, månadsmålet, grafen och flödet, som i
 * den godkända prototypen (v5).
 *
 * Vyn ritar det ko.ts säger (`Visning`) och, efter ett firande, landningen: hur
 * långt in i den tavlan är (`lr`, bildrutor vid 60 per sekund). Då byter raderna
 * plats, talen rullar, grafen växer och flödet flyttar ner, och allt räknas ur
 * `lr` (vy.ts har tiderna). Utan landning står allt still.
 *
 * Måtten som kompositionerna behöver (flödets översta rader och målkortet) läser
 * Tavla.tsx genom referenserna.
 */

import { memo, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type RefObject } from "react";
import type { Ordning, TavlePerson } from "@/lib/salesboard/typer";
import { arArbetsdag } from "@/lib/saljtakt";
import { rangordna, type Siffror, type Visning } from "./ko.ts";
import { Postrad } from "./motion/delar";
import { STD, ip } from "./motion/kurvor.ts";
import { HALVVAGS } from "./motion/tider.ts";
import {
  BLINK,
  DOLD,
  FLIP,
  FLODE_FLIP,
  GRAF,
  RULL,
  RULL_ANTAL,
  RULL_VARDE,
  STRECK,
  UPP,
  datumrad,
  grafPlan,
  heltal,
  jakten,
  klockslag,
  kronor,
  matarText,
  rull,
  snitt,
  streck,
  veckodagKort,
  type Matarlage,
} from "./vy.ts";

export type Ljudlage = "pa" | "av" | "tyst" | "blockerat";

/** Det tavlan visade när ett firande landade, och vad som kom in tyst. */
export type Landning = {
  fran: Siffror;
  franMal: Matarlage;
  /** Flödets nycklar före, i ordning. */
  franFlode: string[];
};

const TOPPLISTANS_RADER = 9;
const FLODETS_RADER = 4;

/** 0 → 1 över `langd` bildrutor av landningen, med standardkurvan. */
const steg = (lr: number, langd: number): number => STD(Math.min(1, Math.max(0, lr / langd)));

// -----------------------------------------------------------------------------
// Rubriken
// -----------------------------------------------------------------------------

function Hogtalare({ av }: { av: boolean }): ReactElement {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor" />
      {av ? <path d="M11 5l4 6M15 5l-4 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /> : null}
    </svg>
  );
}

const Huvud = memo(function Huvud({
  lag,
  nuMs,
  offline,
  ljud,
  startaLjud,
  tystTill,
  oppnar,
  puls,
}: {
  lag: string | null;
  nuMs: number;
  offline: string | null;
  ljud: Ljudlage;
  startaLjud?: () => void;
  /** När ljudtiden börjar igen, "08:00" eller "måndag 08:00". */
  tystTill: string | null;
  /** När arbetsdagen börjar, bara när tavlan vilar. */
  oppnar: string | null;
  /** Byts när flödet fått en ny order, också en tyst: då slår live-punkten en ring. */
  puls: string;
}): ReactElement {
  const ljudtext =
    ljud === "blockerat" ? "Ljud blockerat" : ljud === "tyst" ? (tystTill ? `Tyst till ${tystTill}` : "Tyst nu") : ljud === "av" ? "Ljud av" : null;
  return (
    <header className="tv-huvud">
      <div className="tv-marke">
        <h1>Säljtavlan</h1>
        <span>Clicknet · {lag ?? "Alla lag"}</span>
      </div>
      <div className="tv-huvud-h">
        {ljudtext ? (
          startaLjud ? (
            <button type="button" className="tv-ljudchip" onClick={startaLjud}>
              <Hogtalare av />
              {ljudtext} · starta
            </button>
          ) : (
            <span className="tv-ljudchip">
              <Hogtalare av />
              {ljudtext}
            </span>
          )
        ) : null}
        {offline ? (
          <span className="tv-live tv-av" role="status">
            <i />
            Offline sedan {offline}
          </span>
        ) : oppnar ? (
          <span className="tv-live tv-vilar">
            <i />
            Öppnar {oppnar}
          </span>
        ) : (
          <span className="tv-live">
            <i>
              <b key={puls} />
            </i>
            Live
          </span>
        )}
        <span>{datumrad(nuMs)}</span>
        <span className="tv-klocka">{klockslag(nuMs)}</span>
      </div>
    </header>
  );
});

// -----------------------------------------------------------------------------
// Topplistan
// -----------------------------------------------------------------------------

function Streckrad({ n, ny, lr }: { n: number; ny: number; lr: number | null }): ReactElement {
  if (n <= 0) return <span className="tv-noll" />;
  const { linjer, bredd } = streck(n);
  return (
    <svg viewBox={`0 0 ${bredd} 30`} aria-label={String(n)}>
      {linjer.map((l, i) => (
        <line
          key={i}
          {...l}
          style={i === ny && lr !== null ? { strokeDasharray: 40, strokeDashoffset: 40 * (1 - ip(lr, STRECK, [0, 1], STD)) } : undefined}
        />
      ))}
    </svg>
  );
}

const krHtml = (n: number): ReactElement | string =>
  n === 0 ? (
    "–"
  ) : (
    <>
      {heltal(n)}
      <span className="tv-enh">kr</span>
    </>
  );

function Topplistan({
  v,
  landning,
  lr,
  ordning,
}: {
  v: Visning;
  landning: Landning | null;
  lr: number | null;
  ordning: Ordning;
}): ReactElement {
  const alla = rangordna(v.tal.rader, ordning);
  const rader = alla.slice(0, TOPPLISTANS_RADER);
  const fler = alla.length - rader.length;
  // Jakten står still i vila; under en landning är det ↑2 som talar.
  const jakt = lr === null ? jakten(rader, ordning, snitt(v.tal.lag.varde, v.tal.lag.antal)) : null;
  const fore = landning ? rangordna(landning.fran.rader, ordning) : null;
  const vd = v.bild.idag.veckodag;
  const manad = v.bild.manad.namn.toLowerCase();
  return (
    <section className={`tv-kort${ordning === "varde" ? " tv-mat-varde" : ""}`} aria-label="Topplistan">
      <div className="tv-kort-rubrik">
        <h2>Topplistan</h2>
        <small>
          {manad} · efter {ordning === "varde" ? "ordervärde" : "antal order"}
        </small>
      </div>
      <div className="tv-lista">
        <div className="tv-rad-huvud">
          <span />
          <span>Säljare</span>
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className={i === vd ? "tv-idag-kol" : undefined}>
              {veckodagKort(i)}
            </span>
          ))}
          <span className="tv-idag-kol">I dag</span>
          <span>Order</span>
          <span>Ordervärde</span>
        </div>
        {rader.length === 0 ? (
          <p className="tv-tom">
            Inga säljare i laget än.
            <small>Välj lag under Inställningar → Säljtavlan → Visning.</small>
          </p>
        ) : (
          <div className="tv-rader">
            {rader.map((r, i) => {
              const person: TavlePerson = v.bild.personer[r.person] ?? DOLD;
              const fi = fore ? fore.findIndex((x) => x.person === r.person) : -1;
              const f = fore && fi >= 0 ? fore[fi] : null;
              const andrad = lr !== null && (!f || f.antal !== r.antal || f.varde !== r.varde);
              // Raden kommer från sin gamla plats; en ny rad kommer underifrån.
              const fran = lr === null ? i : fi >= 0 ? fi : TOPPLISTANS_RADER;
              const dy = lr === null ? 0 : (fran - i) * (1 - steg(lr, FLIP));
              const upp = lr !== null && andrad && fran > i && lr < UPP + 18 ? fran - i : 0;
              const antal = andrad && f ? Math.round(rull(f.antal, r.antal, lr ?? 0, RULL_ANTAL)) : r.antal;
              const varde = andrad && f ? Math.round(rull(f.varde, r.varde, lr ?? 0, RULL_VARDE)) : r.varde;
              const nyttStreck = andrad && vd !== null && f && r.vecka[vd] > f.vecka[vd] ? r.vecka[vd] - 1 : -1;
              const klass = `tv-rad${i === 0 ? " tv-etta" : i < 3 ? " tv-pall" : ""}${dy !== 0 ? " tv-flyttar" : ""}`;
              return (
                <div key={r.person} className={klass} style={dy !== 0 ? { translate: `0 ${dy * 100}%` } : undefined}>
                  {andrad ? <div className="tv-rad-ljus" style={{ opacity: 0.22 * (1 - steg(lr ?? 0, BLINK)) }} /> : null}
                  <span className="tv-plats">{i + 1}</span>
                  <div className="tv-vem">
                    <span className="tv-ini">{person.initialer}</span>
                    <span className="tv-namnblock">
                      <span className="tv-rad-namn">{person.namn}</span>
                      {jakt?.person === r.person ? <span className="tv-jakt">{jakt.text}</span> : null}
                    </span>
                    {upp > 0 ? (
                      <span className="tv-upp" style={{ opacity: ip(lr ?? 0, [0, 18, UPP, UPP + 18], [0, 1, 1, 0]) }}>
                        ↑{upp}
                      </span>
                    ) : null}
                  </div>
                  {r.vecka.map((n, d) => (
                    <div key={d} className={`tv-dag${d === vd ? " tv-idag" : ""}`}>
                      <Streckrad n={n} ny={d === vd ? nyttStreck : -1} lr={lr} />
                    </div>
                  ))}
                  <span className={`tv-idag-tal${r.idag ? "" : " tv-noll-tal"}`}>{r.idag || "–"}</span>
                  <span className={`tv-manad${antal ? "" : " tv-noll-tal"}`}>{antal ? heltal(antal) : "–"}</span>
                  <span className="tv-varde">{krHtml(varde)}</span>
                </div>
              );
            })}
          </div>
        )}
        {fler > 0 ? <p className="tv-fler">+ {fler} säljare till</p> : null}
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Månadsmålet
// -----------------------------------------------------------------------------

/** Målkortets läge ur det som syns. */
export const malLage = (v: Visning): Matarlage => ({
  varde: v.tal.lag.varde,
  mal: v.bild.manad.mal,
  forvantat: v.bild.manad.forvantat,
  prognos: v.bild.manad.prognos,
  natt: v.bild.manad.natt,
  // De gångna räknar med i dag när det är en arbetsdag; i dag är ändå kvar att sälja på.
  dagarKvar: Math.max(0, v.bild.manad.dagar.totalt - v.bild.manad.dagar.gangna) + (arArbetsdag(v.bild.idag.datum) ? 1 : 0),
  snitt: snitt(v.tal.lag.varde, v.tal.lag.antal),
});

function Malkortet({
  v,
  landning,
  lr,
  kortRef,
}: {
  v: Visning;
  landning: Landning | null;
  lr: number | null;
  kortRef: RefObject<HTMLElement | null>;
}): ReactElement {
  const m = v.bild.manad;
  const till = malLage(v);
  const fran = landning && lr !== null ? landning.franMal : till;
  const l = lr ?? RULL;
  const text = matarText(fran, till, l);
  const varde = rull(fran.varde, till.varde, l, RULL);
  const pct = (x: number) => (m.mal ? Math.min(100, Math.max(0, (x / m.mal) * 100)) : 0);
  const fyll = ip(l, [0, 48], [pct(fran.varde), pct(till.varde)], STD);
  const kvar = Math.max(0, m.dagar.totalt - m.dagar.gangna);
  const dagar = kvar === 0 ? (v.bild.idag.veckodag === null ? "inga arbetsdagar kvar" : "sista arbetsdagen") : `${kvar} ${kvar === 1 ? "arbetsdag" : "arbetsdagar"} kvar`;
  const franAntal = landning && lr !== null ? landning.fran.lag.antal : v.tal.lag.antal;
  const antal = rull(franAntal, v.tal.lag.antal, l, RULL);
  const franSnitt = landning && lr !== null ? snitt(landning.fran.lag.varde, landning.fran.lag.antal) : snitt(v.tal.lag.varde, v.tal.lag.antal);
  const snittNu = rull(franSnitt, snitt(v.tal.lag.varde, v.tal.lag.antal), l, RULL);
  const h = v.halvvags;
  const halvSyns = h !== null && h < HALVVAGS ? ip(h, [0, 12, HALVVAGS - 18, HALVVAGS], [0, 1, 1, 0]) : 0;
  const halvMark = m.mal !== null && !text.natt && till.varde >= m.mal / 2;
  return (
    <section className="tv-kort" ref={kortRef} aria-label="Månadsmål">
      <div className="tv-kort-rubrik">
        <h2>Månadsmål</h2>
        <small>
          {m.namn.toLowerCase()} · {dagar}
        </small>
      </div>
      <div className={`tv-matare${text.natt ? " tv-natt" : ""}`}>
        <div className="tv-m-topp">
          <span>Ordervärde</span>
          <span className={text.bra ? "tv-bra" : undefined}>{text.status ?? ""}</span>
        </div>
        <div className="tv-m-tal">
          <b>{heltal(varde)}</b>
          <span className="tv-m-av">{m.mal !== null ? `kr av ${kronor(m.mal)}` : `kr i ${m.namn.toLowerCase()}`}</span>
        </div>
        {m.mal !== null ? (
          <div className="tv-stapel">
            <div className="tv-fyll" style={{ width: `${fyll}%` }} />
            {halvMark ? <div className="tv-halv-mark" /> : null}
            {!text.natt && m.forvantat !== null ? <div className="tv-takt" style={{ left: `${pct(m.forvantat)}%` }} /> : null}
            {halvSyns > 0 ? (
              <span className="tv-halv" style={{ opacity: halvSyns }}>
                Halvvägs
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="tv-m-fakta" style={m.mal === null ? { marginTop: 16 } : undefined}>
          {text.fakta.map((d, i) => (
            <span key={i}>
              {d.fetSist ? (
                <>
                  {d.text} <b>{d.fet}</b>
                </>
              ) : (
                <>
                  <b>{d.fet}</b>
                  {d.text ? ` ${d.text}` : ""}
                </>
              )}
            </span>
          ))}
        </div>
      </div>
      <div className="tv-m-stats">
        <div>
          <small>Order</small>
          <b>{heltal(antal)}</b>
        </div>
        <div>
          <small>Snitt per order</small>
          <b>{krHtml(Math.round(snittNu / 100) * 100)}</b>
        </div>
        <div>
          <small>Största affären</small>
          <b>{krHtml(v.tal.lag.storsta ?? 0)}</b>
        </div>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Grafen
// -----------------------------------------------------------------------------

function Grafen({ v, landning, lr, u }: { v: Visning; landning: Landning | null; lr: number | null; u: number }): ReactElement {
  const yta = useRef<HTMLDivElement>(null);
  const [storlek, settStorlek] = useState<{ W: number; H: number } | null>(null);
  useLayoutEffect(() => {
    const el = yta.current;
    if (!el) return;
    const las = () => settStorlek({ W: el.clientWidth / u, H: el.clientHeight / u });
    las();
    const obs = typeof ResizeObserver !== "undefined" ? new ResizeObserver(las) : null;
    obs?.observe(el);
    return () => obs?.disconnect();
  }, [u]);
  const m = v.bild.manad;
  const p = landning && lr !== null ? steg(lr, GRAF) : 1;
  const franV = landning && lr !== null ? landning.fran.lag.varde : v.tal.lag.varde;
  const franA = landning && lr !== null ? landning.fran.lag.antal : v.tal.lag.antal;
  const plan =
    storlek && storlek.W > 0 && storlek.H > 0
      ? grafPlan({
          W: storlek.W,
          H: storlek.H,
          historik: v.bild.historik,
          nu: {
            namn: m.namn.slice(0, 3).toLowerCase(),
            varde: franV + (v.tal.lag.varde - franV) * p,
            antal: Math.round(franA + (v.tal.lag.antal - franA) * p),
            mal: m.mal,
            prognos: m.prognos,
          },
        })
      : null;
  return (
    <section className="tv-kort tv-graf" aria-label="Ordervärde per månad">
      <div className="tv-kort-rubrik">
        <h2>Ordervärde per månad</h2>
        <small>tkr</small>
      </div>
      <div className="tv-graf-yta" ref={yta}>
        {plan && storlek ? (
          <svg viewBox={`0 0 ${storlek.W} ${storlek.H}`} role="img" aria-label="Ordervärde per månad de senaste tolv månaderna">
            {plan.linjer.map((l, i) => (
              <line key={i} className="rutnat" x1={plan.x0} x2={storlek.W} y1={l.y} y2={l.y} />
            ))}
            {plan.staplar.map((s, i) => (
              <g key={i}>
                {s.prognosY !== null ? (
                  <rect className="prognos" x={s.x + 1} y={s.prognosY} width={s.b - 2} height={s.y0 - s.prognosY} rx={4} />
                ) : null}
                {s.h > 0 ? (
                  <path className={s.klass} d={`M${s.x},${s.y0} V${s.y0 - s.h + 4} q0,-4 4,-4 h${s.b - 8} q4,0 4,4 V${s.y0} Z`}>
                    <title>{s.titel}</title>
                  </path>
                ) : null}
                {s.malY !== null ? <line className="malstreck" x1={s.x - 4} x2={s.x + s.b + 4} y1={s.malY} y2={s.malY} /> : null}
                {s.rekord ? (
                  <text className="rek" x={s.x + s.b / 2} y={s.etikettY - 21} textAnchor="middle" fontSize={12}>
                    REKORD
                  </text>
                ) : null}
                <text className={`v${s.nu ? " nu" : ""}`} x={s.x + s.b / 2} y={s.etikettY} textAnchor="middle" fontSize={17}>
                  {s.etikett}
                </text>
                <text className={`man${s.nu ? " nu" : ""}`} x={s.x + s.b / 2} y={s.y0 + 26} textAnchor="middle" fontSize={15}>
                  {s.namn}
                </text>
              </g>
            ))}
          </svg>
        ) : null}
      </div>
      <div className="tv-teckn">
        {plan?.staplar.some((s) => s.klass === "natt-r") ? (
          <span>
            <i style={{ background: "var(--mint)" }} />
            nådde målet
          </span>
        ) : null}
        {plan?.staplar.some((s) => s.klass === "under-r") ? (
          <span>
            <i style={{ background: "var(--under)" }} />
            under målet
          </span>
        ) : null}
        {plan?.staplar.some((s) => s.malY !== null) ? (
          <span>
            <i style={{ background: "var(--amber)", height: 3, verticalAlign: 4 }} />
            månadens mål
          </span>
        ) : null}
        {plan?.staplar.some((s) => s.prognosY !== null) ? (
          <span>
            <i style={{ border: "2px dashed var(--mint)", background: "none" }} />
            prognos
          </span>
        ) : null}
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Flödet
// -----------------------------------------------------------------------------

function Flodet({
  v,
  landning,
  lr,
  flodeRef,
  tysta,
}: {
  v: Visning;
  landning: Landning | null;
  lr: number | null;
  flodeRef: RefObject<HTMLDivElement | null>;
  tysta: ReadonlySet<string>;
}): ReactElement {
  const rader = v.bild.order.filter((o) => !v.utesluten.has(o.nyckel)).slice(0, FLODETS_RADER);
  const { idagAntal, idagSumma } = v.tal.lag;
  return (
    <section className="tv-kort" aria-label="Senaste order">
      <div className="tv-kort-rubrik">
        <h2>Senaste order</h2>
        <small>{idagAntal === 0 ? "ingen order än i dag" : `i dag ${heltal(idagAntal)} order · ${kronor(idagSumma)}`}</small>
      </div>
      <div className="tv-flode" ref={flodeRef}>
        {rader.length === 0 ? <p className="tv-tom">Ingen order de senaste två veckorna.</p> : null}
        {rader.map((o, i) => {
          const fi = landning ? landning.franFlode.indexOf(o.nyckel) : -1;
          const dy = lr !== null && fi >= 0 && fi !== i ? (fi - i) * (1 - steg(lr, FLODE_FLIP)) : 0;
          const stil: CSSProperties = { ...(dy !== 0 ? { translate: `0 ${dy * 100}%` } : {}), ...(v.dolda.has(o.nyckel) ? { opacity: 0 } : {}) };
          // Ett streck där i dag slutar: det ovanför är dagens, det under är tidigare.
          const grans = i > 0 && rader[i - 1].dag === v.bild.idag.datum && o.dag !== v.bild.idag.datum;
          return (
            <div
              key={o.nyckel}
              className={`tv-post${o.niva === "stor" ? " tv-stor" : ""}${tysta.has(o.nyckel) ? " tv-tyst-ny" : ""}${grans ? " tv-forr" : ""}`}
              style={stil}
            >
              <Postrad order={o} person={v.bild.personer[o.person] ?? DOLD} idag={v.bild.idag.datum} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Vyn
// -----------------------------------------------------------------------------

export function Vila({
  v,
  landning,
  lr,
  ordning,
  nuMs,
  u,
  offline,
  ljud,
  startaLjud,
  tystTill,
  oppnar,
  dampad,
  rorelse,
  flodeRef,
  kortRef,
  tysta,
}: {
  v: Visning;
  landning: Landning | null;
  /** Bildrutor in i landningen, eller null i vila. */
  lr: number | null;
  ordning: Ordning;
  nuMs: number;
  u: number;
  offline: string | null;
  ljud: Ljudlage;
  startaLjud?: () => void;
  tystTill: string | null;
  oppnar: string | null;
  dampad: boolean;
  /** Tavlans motrörelse under svepet, i u. */
  rorelse: { dy: number; skala: number };
  flodeRef: RefObject<HTMLDivElement | null>;
  kortRef: RefObject<HTMLElement | null>;
  tysta: ReadonlySet<string>;
}): ReactElement {
  const stil: CSSProperties | undefined =
    rorelse.dy !== 0 || rorelse.skala !== 1 ? { translate: `0 ${rorelse.dy * u}px`, scale: String(rorelse.skala) } : undefined;
  return (
    <main className={`tv-scen${dampad ? " tv-dampad" : ""}${offline ? " tv-gammal" : ""}`} style={stil}>
      <Huvud
        lag={v.bild.lag}
        nuMs={Math.floor(nuMs / 1000) * 1000}
        offline={offline}
        ljud={ljud}
        startaLjud={startaLjud}
        tystTill={tystTill}
        oppnar={dampad ? oppnar : null}
        puls={v.bild.order[0]?.nyckel ?? ""}
      />
      <div className="tv-kropp">
        <Topplistan v={v} landning={landning} lr={lr} ordning={ordning} />
        <div className="tv-hoger">
          <Malkortet v={v} landning={landning} lr={lr} kortRef={kortRef} />
          <Grafen v={v} landning={landning} lr={lr} u={u} />
          <Flodet v={v} landning={landning} lr={lr} flodeRef={flodeRef} tysta={tysta} />
        </div>
      </div>
    </main>
  );
}
