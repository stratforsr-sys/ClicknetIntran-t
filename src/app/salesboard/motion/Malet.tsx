"use client";

/**
 * Kompositionen Målet (spec 5.4): en cirkel växer ur målkortet över hela
 * skärmen, "Målet nått." stiger fram, månadens summa landar på ett räkneverk och
 * laget kommer som pillrar. På slutet sluter sig cirkeln tillbaka in i kortet.
 * Bildruta för bildruta som prototypens `firaMalet`, 650 ms efter ordern som
 * tog laget över målet (`MALET_VANTA`).
 */

import type { ReactElement } from "react";
import type { Forloppsdata } from "../ko.ts";
import { heltal, kronor, tkr } from "../vy.ts";
import { Ord, Rakneverk, type Rekt } from "./delar";
import { SVEP, UT, fjader, ip, skalaMix } from "./kurvor.ts";
import { useCurrentFrame } from "./motor";
import { LUGN_TONING, MALET_LANGD, MALET_STANG, MALET_VANTA, landar, siffror } from "./tider.ts";

export type MaletProps = {
  data: Extract<Forloppsdata, { typ: "malet" }>;
  test: boolean;
  lugn: boolean;
  /** Målkortet, som cirkeln växer ur, i fönstrets pixlar. */
  kort: Rekt;
  u: number;
  vw: number;
  vh: number;
};

/** Lugn rörelse: bilden som står. */
const VILA = 300;

export function Malet(p: MaletProps): ReactElement | null {
  const r = useCurrentFrame() - MALET_VANTA;
  if (r < 0) return null;
  const { u, data: d } = p;
  const f = p.lugn ? VILA : r;
  const cx = p.kort.x + p.kort.w / 2;
  const cy = p.kort.y + p.kort.h / 2;
  // Avståndet till skärmens längst bort belägna hörn, och lite till, så att cirkeln täcker allt.
  const R = Math.hypot(Math.max(cx, p.vw - cx), Math.max(cy, p.vh - cy)) * 1.02 + 4;
  const radie = p.lugn ? R : r < MALET_STANG ? ip(r, [0, 30], [0, R], SVEP) : ip(r, [MALET_STANG, MALET_LANGD], [R, 0], SVEP);
  const ton = p.lugn ? Math.min(ip(r, [0, LUGN_TONING], [0, 1]), ip(r, [MALET_LANGD - LUGN_TONING, MALET_LANGD], [1, 0])) : 1;
  const n = siffror(d.varde);
  const fv = f - 76;
  const dagar = d.dagarKvar === 0 ? "sista arbetsdagen" : `${d.dagarKvar} ${d.dagarKvar === 1 ? "arbetsdag" : "arbetsdagar"} kvar`;

  return (
    <div className="tv-malet" style={{ clipPath: `circle(${radie}px at ${cx}px ${cy}px)`, opacity: ton }} aria-live="polite">
      <div className="tv-malet-inre" style={{ opacity: p.lugn ? 1 : ip(r, [428, 442], [1, 0]) }}>
        <span className="tv-f-etikett" style={{ opacity: ip(f, [18, 32], [0, 1]) }}>
          <i />
          Månadsmålet · {d.manad}
        </span>
        <h3 style={{ scale: String(skalaMix(0.92, 1, ip(f, [22, 70], [0, 1], UT))) }}>
          <Ord text="Målet nått." y={(i) => (1 - fjader(f, 22 + i * 8, 13, 140)) * 112} />
        </h3>
        <p className="tv-malet-rad" style={{ opacity: ip(f, [62, 80], [0, 1]), translate: `0 ${ip(f, [62, 84], [24 * u, 0], UT)}px` }}>
          {d.avgorande ? (
            <>
              <b>{d.avgorande}</b> tog laget över målet på <b>{kronor(d.mal)}</b>,{" "}
            </>
          ) : (
            <>
              Månadens mål på <b>{kronor(d.mal)}</b>,{" "}
            </>
          )}
          {d.dagarKvar === 0 ? "på " : "med "}
          <b>{dagar}</b> och <b>{heltal(d.antal)} order</b> hittills.
        </p>
        <div className="tv-malet-summa" style={{ opacity: ip(f, [74, 86], [0, 1]) }}>
          <small>Ordervärde i {d.manad}</small>
          <Rakneverk
            className="tv-f-varde"
            varde={d.varde}
            y={(k, antal) => ip(fv, [k.i * 2, 26 + k.i * 3], [0, (k.i >= antal / 2 ? 20 : 10) + k.d], UT)}
            opacity={(k) => ip(fv, [k.i * 2, k.i * 2 + 8], [0, 1])}
            kr={{ opacity: ip(fv, [landar(n) - 8, landar(n) + 4], [0, 1]) }}
          />
        </div>
        <div className="tv-laget">
          {d.laget.map((s, i) => {
            const a = 120 + i * 5;
            return (
              <span key={i} style={{ opacity: ip(f, [a, a + 12], [0, 1]), translate: `0 ${ip(f, [a, a + 18], [20 * u, 0], UT)}px` }}>
                {s.namn}
                <b>{heltal(s.antal)}</b>
                <em>{kronor(s.varde)}</em>
              </span>
            );
          })}
        </div>
        {d.rekord !== null ? (
          <p className="tv-malet-nasta" style={{ opacity: ip(f, [150, 166], [0, 1]) }}>
            Nästa: rekordmånaden <b>{tkr(d.rekord)}</b>
          </p>
        ) : null}
      </div>
      {p.test ? <span className="tv-test">TEST</span> : null}
    </div>
  );
}
