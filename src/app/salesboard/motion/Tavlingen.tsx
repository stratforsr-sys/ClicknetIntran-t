"use client";

/**
 * Kompositionen Tävlingen (spec 2026-10-26): mellanspelet var tionde minut och
 * förra månadens vinnare. Prisbilden fyller vänstra 44 % och glider långsamt
 * från 1,06 till 1,0; till höger står priset och loppet. Ytan sveper in som
 * Ordern och sluter sig tillbaka över tavlan på slutet.
 *
 * Bildruta för bildruta, utan CSS-övergångar. Lugn rörelse: bilden står still
 * på sin vilobild och tonas in och ut.
 */

import type { CSSProperties, ReactElement } from "react";
import type { Forloppsdata } from "../ko.ts";
import { heltal, kronor } from "../vy.ts";
import { Ord } from "./delar";
import { STD, SVEP, UT, fjader, ip } from "./kurvor.ts";
import { useCurrentFrame } from "./motor";
import { LOPP_VAXER, LUGN_TONING, TAVLING_LANGD, TAVLING_UT, VINNARE_LANGD, VINNARE_UT, loppStart } from "./tider.ts";

export type TavlingenProps = {
  data: Extract<Forloppsdata, { typ: "tavling" | "vinnare" }>;
  test: boolean;
  lugn: boolean;
  /** Prisbilden när den laddats och avkodats, annars null: då visas scenen utan bildytan. */
  bild: string | null;
  u: number;
};

/** Lugn rörelse: bilden som står. */
const VILA = 240;

/** "5 arbetsdagar kvar", "1 arbetsdag kvar", eller "avgörs i dag" den sista. */
export const dagarText = (kvar: number): string => (kvar <= 0 ? "Avgörs i dag" : `${kvar} ${kvar === 1 ? "arbetsdag" : "arbetsdagar"} kvar`);

/**
 * Priset mitt i en mening: "spa för två". Första bokstaven blir liten, utom när
 * ordet har fler versaler (AirPods, SPA) eller redan börjar med en gemen (iPad).
 */
export function prisISats(pris: string): string {
  const forsta = pris.split(" ")[0] ?? "";
  if (/\p{Lu}/u.test(forsta.slice(1))) return pris;
  return pris.charAt(0).toLocaleLowerCase("sv-SE") + pris.slice(1);
}

/** Rubriken: priset med punkt, i en storlek som får plats på två rader. */
export function rubrik(text: string, punkt = true): { text: string; px: number } {
  const med = !punkt || /[.!?]$/.test(text) ? text : `${text}.`;
  const n = [...med].length;
  return { text: med, px: n <= 14 ? 150 : n <= 22 ? 120 : n <= 34 ? 96 : 76 };
}

export function Tavlingen(p: TavlingenProps): ReactElement {
  const r = useCurrentFrame();
  const vinnare = p.data.typ === "vinnare";
  const LANGD = vinnare ? VINNARE_LANGD : TAVLING_LANGD;
  const UTG = vinnare ? VINNARE_UT : TAVLING_UT;
  const f = p.lugn ? VILA : Math.min(r, UTG);
  const g = p.lugn ? 0 : Math.max(0, r - UTG);
  const ton = p.lugn ? Math.min(ip(r, [0, LUGN_TONING], [0, 1]), ip(r, [LANGD - LUGN_TONING, LANGD], [1, 0])) : 1;

  // In: bandet och ytan sveper upp som i Ordern. Ut: ytan och bandet släpper uppåt, och tavlan syns igen.
  // Bandet följer två bildrutor efter ytan: en smal mint kant, inte en mint skärm.
  const band = p.lugn ? 0 : g > 0 ? ip(g, [6, 42], [0, 100], SVEP) : 0;
  const yta = p.lugn ? 0 : g > 0 ? ip(g, [4, 40], [0, 100], SVEP) : 0;
  const bandIn = p.lugn ? 0 : ip(f, [0, 16], [100, 0], SVEP);
  const ytaIn = p.lugn ? 0 : ip(f, [5, 23], [100, 0], SVEP);
  const inne: CSSProperties = { opacity: g > 0 ? ip(g, [0, 12], [1, 0]) : 1 };

  const stig = (a: number, d = 24): CSSProperties => ({ opacity: ip(f, [a, a + 14], [0, 1]), translate: `0 ${ip(f, [a, a + 22], [d * p.u, 0], UT)}px` });

  return (
    <div className={`tv-tav${vinnare ? " tv-tav-vinnare" : ""}`} style={{ opacity: ton }} aria-live="polite">
      <div className="tv-f-band" style={{ clipPath: `inset(${bandIn}% 0 ${band}% 0)` }} />
      <div className="tv-f-yta" style={{ clipPath: `inset(${ytaIn}% 0 ${yta}% 0)` }} />
      <div className={`tv-tav-inne${p.bild ? "" : " tv-utan-bild"}`} style={inne}>
        {p.bild ? (
          <div className="tv-tav-bild" style={{ clipPath: `inset(${p.lugn ? 0 : ip(f, [14, 40], [100, 0], SVEP)}% 0 0 0)` }}>
            <img src={p.bild} alt="" style={{ scale: String(p.lugn ? 1.02 : ip(r, [0, LANGD], [1.06, 1], STD)) }} />
          </div>
        ) : null}
        <div className="tv-tav-text">{p.data.typ === "vinnare" ? <Vinnare {...p} data={p.data} f={f} stig={stig} /> : <Mellanspel {...p} data={p.data} f={f} stig={stig} />}</div>
      </div>
      {p.test ? <span className="tv-test">TEST</span> : null}
    </div>
  );
}

type Del<T> = Omit<TavlingenProps, "data"> & { data: T; f: number; stig: (a: number, d?: number) => CSSProperties };

function Etikett({ text, stil }: { text: string; stil: CSSProperties }): ReactElement {
  return (
    <span className="tv-f-etikett" style={stil}>
      <i />
      {text}
    </span>
  );
}

function Rubrik({ text, f, u, klass, punkt }: { text: string; f: number; u: number; klass?: string; punkt?: boolean }): ReactElement {
  const h = rubrik(text, punkt);
  return (
    <h3 className={klass} style={{ fontSize: h.px * u }}>
      <Ord text={h.text} y={(i) => (1 - fjader(f, 22 + i * 5, 18)) * 112} />
    </h3>
  );
}

function Mellanspel(p: Del<Extract<Forloppsdata, { typ: "tavling" }>>): ReactElement {
  const { f, u, data: d } = p;
  const t = d.tavling;
  const skala = Math.max(1, d.lopp.topp, t.grans ?? 0);
  const n = d.lopp.rader.length;
  // Kvalgränsen: ett streckat märke genom varje stapel, och beloppet över den första.
  const gransAndel = t.grans !== null ? Math.min(1, t.grans / skala) : null;
  return (
    <>
      <Etikett text={`Månadens tävling · ${dagarText(t.dagarKvar)}`} stil={{ opacity: ip(f, [16, 30], [0, 1]), translate: `${ip(f, [16, 36], [-30 * u, 0], UT)}px 0` }} />
      <Rubrik text={t.pris} f={f} u={u} />
      <p className="tv-tav-regel" style={p.stig(44)}>
        {t.grans !== null ? (
          <>
            Högst ordervärde vinner, från <b>{kronor(t.grans)}</b>.
          </>
        ) : (
          <>
            Högst ordervärde i <b>{d.manad}</b> vinner.
          </>
        )}
      </p>
      <div className="tv-lopp">
        {d.lopp.rader.map((x, i) => {
          const a = loppStart(i);
          const vaxt = ip(f, [a, a + LOPP_VAXER], [0, 1], UT);
          return (
            <div key={x.person} className={`tv-lopp-rad${x.leder ? " tv-leder" : ""}`}>
              <span className="tv-lopp-namn" style={{ opacity: ip(f, [a - 8, a + 4], [0, 1]) }}>
                {(d.personer[x.person]?.namn ?? "En säljare")}
              </span>
              <span className="tv-lopp-spar" style={{ opacity: ip(f, [a - 8, a + 4], [0, 1]) }}>
                <span className="tv-lopp-fyll" style={{ width: `${(x.varde / skala) * 100 * vaxt}%` }} />
                {gransAndel !== null ? (
                  <i className="tv-lopp-grans" style={{ left: `${gransAndel * 100}%`, opacity: ip(f, [loppStart(n) + 18, loppStart(n) + 32], [0, 1]) }}>
                    {i === 0 ? <span>Gränsen {kronor(t.grans!)}</span> : null}
                  </i>
                ) : null}
              </span>
              <b className="tv-lopp-kr" style={{ opacity: ip(f, [a + LOPP_VAXER - 6, a + LOPP_VAXER + 8], [0, 1]) }}>
                {kronor(x.varde)}
              </b>
              <span className="tv-lopp-text" style={{ opacity: ip(f, [a + LOPP_VAXER, a + LOPP_VAXER + 14], [0, 1]) }}>
                {x.text}
              </span>
            </div>
          );
        })}
      </div>
      {d.lopp.snitt > 0 ? (
        <p className="tv-tav-fot" style={{ opacity: ip(f, [loppStart(n) + 30, loppStart(n) + 44], [0, 1]) }}>
          En order ≈ {heltal(d.lopp.snitt)} kr, lagets snitt i {d.manad}
        </p>
      ) : null}
    </>
  );
}

function Vinnare(p: Del<Extract<Forloppsdata, { typ: "vinnare" }>>): ReactElement {
  const { f, u, data: d } = p;
  const v = d.vinnare;
  const namn = d.namn.join(" och ");
  return (
    <>
      <Etikett text={`Månadens tävling · ${v.manad}`} stil={{ opacity: ip(f, [16, 30], [0, 1]), translate: `${ip(f, [16, 36], [-30 * u, 0], UT)}px 0` }} />
      {d.namn.length ? (
        <>
          <Rubrik text={namn} f={f} u={u} klass="tv-tav-namn" punkt={false} />
          <p className="tv-tav-sats" style={p.stig(52)}>
            {d.namn.length > 1 ? "delar på " : "vann "}
            <em>{prisISats(v.pris)}</em>.
          </p>
          {v.varde !== null ? (
            <p className="tv-tav-regel" style={p.stig(70)}>
              <b>{kronor(v.varde)}</b> i {v.manad}, högst ordervärde{v.grans !== null ? ` över gränsen på ${kronor(v.grans)}` : ""}.
            </p>
          ) : null}
        </>
      ) : (
        <>
          <Rubrik text={`Ingen nådde gränsen i ${v.manad}`} f={f} u={u} />
          {v.grans !== null ? (
            <p className="tv-tav-regel" style={p.stig(52)}>
              Gränsen var <b>{kronor(v.grans)}</b>. Priset var {prisISats(v.pris)}.
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
