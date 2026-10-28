"use client";

/**
 * Kompositionen Knuffen (spec 2026-10-26), i två former:
 *
 * - **Knuffen**: "Jonas Berg är en order från spa för två." Mint, direkt efter
 *   ordern som tog säljaren inom en order från ledaren.
 * - **Gränsen**: "Anna Lindqvist är över gränsen. Med och tävlar om spa för två."
 *   Bärnsten, direkt efter ordern som tog säljaren över kvalgränsen.
 *
 * Fem och en halv sekund: svepet in som Ordern, en linje överst, namnet ord för
 * ord i sin mask, meningen och en rad med prisbilden. Ut släpper ytan uppåt.
 */

import type { CSSProperties, ReactElement } from "react";
import type { Forloppsdata } from "../ko.ts";
import { klockslag, kronor, ordtal } from "../vy.ts";
import { Ord } from "./delar";
import { SVEP, UT, fjader, ip } from "./kurvor.ts";
import { useCurrentFrame } from "./motor";
import { dagarText, prisISats } from "./Tavlingen";
import { KNUFF_LANGD, KNUFF_UT, LUGN_TONING } from "./tider.ts";

export type KnuffenProps = {
  data: Extract<Forloppsdata, { typ: "knuff" | "grans" }>;
  test: boolean;
  lugn: boolean;
  /** Prisbilden när den laddats, annars null. */
  bild: string | null;
  u: number;
  vw: number;
};

const VILA = 150;

export function Knuffen(p: KnuffenProps): ReactElement {
  const r = useCurrentFrame();
  const { u, data: d } = p;
  const grans = d.typ === "grans";
  const f = p.lugn ? VILA : Math.min(r, KNUFF_UT);
  const g = p.lugn ? 0 : Math.max(0, r - KNUFF_UT);
  const ton = p.lugn ? Math.min(ip(r, [0, LUGN_TONING], [0, 1]), ip(r, [KNUFF_LANGD - LUGN_TONING, KNUFF_LANGD], [1, 0])) : 1;
  const stig = (a: number): CSSProperties => ({ opacity: ip(f, [a, a + 14], [0, 1]), translate: `0 ${ip(f, [a, a + 22], [26 * u, 0], UT)}px` });
  const t = d.tavling;
  const pris = prisISats(t.pris);
  // Namnet så stort som får plats på en rad: 150 u, eller mindre för ett långt namn.
  const px = Math.min(150 * u, (p.vw - 300 * u) / Math.max(1, [...d.person.namn].length * 0.56));

  return (
    <div className={`tv-tav tv-knuff${grans ? " tv-knuff-grans" : ""}`} style={{ opacity: ton }} aria-live="polite">
      <div className="tv-f-band" style={{ clipPath: `inset(${p.lugn ? 0 : ip(f, [0, 16], [100, 0], SVEP)}% 0 ${g ? ip(g, [6, 40], [0, 100], SVEP) : 0}% 0)` }} />
      <div className="tv-f-yta" style={{ clipPath: `inset(${p.lugn ? 0 : ip(f, [5, 23], [100, 0], SVEP)}% 0 ${g ? ip(g, [4, 38], [0, 100], SVEP) : 0}% 0)` }} />
      <div className="tv-knuff-linje" style={{ scale: `${p.lugn ? 1 : ip(f, [18, 46], [0, 1], UT)} 1` }} />
      <div className="tv-knuff-inne" style={{ opacity: g ? ip(g, [0, 12], [1, 0]) : 1 }}>
        <span className="tv-f-etikett" style={{ opacity: ip(f, [16, 30], [0, 1]), translate: `${ip(f, [16, 36], [-30 * u, 0], UT)}px 0` }}>
          <i />
          Tävlingen · {klockslag(d.tid)}
        </span>
        <div className="tv-knuff-namn" style={{ fontSize: px }}>
          <Ord text={d.person.namn} y={(i) => (1 - fjader(f, 18 + i * 5, 20)) * 112} />
        </div>
        <p className="tv-knuff-sats" style={stig(46)}>
          {d.typ === "grans" ? (
            <>
              är över gränsen. <em>Med och tävlar</em> om {pris}.
            </>
          ) : (
            <>
              är <em>{d.avstand}</em> från {d.over ? pris : "ledningen"}.
            </>
          )}
        </p>
        <div className="tv-knuff-fot" style={stig(64)}>
          {p.bild ? <img src={p.bild} alt="" /> : null}
          <span>
            {d.typ === "grans" ? (
              <>
                <b>{kronor(d.varde)}</b> i {d.manad} · {d.plats === 1 ? "leder" : `${ordtal(d.plats)} plats`} · {dagarText(t.dagarKvar).toLowerCase()}
              </>
            ) : (
              <>
                {d.ledare ? (
                  <>
                    <b>{d.ledare}</b> leder med <b>{kronor(d.forsprang)}</b>.{" "}
                  </>
                ) : null}
                {!d.over && t.grans !== null ? `Priset kräver ${kronor(t.grans)}. ` : ""}
                {dagarText(t.dagarKvar)}.
              </>
            )}
          </span>
        </div>
      </div>
      {p.test ? <span className="tv-test">TEST</span> : null}
    </div>
  );
}
