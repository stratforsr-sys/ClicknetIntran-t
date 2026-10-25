"use client";

/**
 * Kompositionen Serien (spec 5.3): tre eller fler order på en gång, i den
 * godkända prototypens formspråk. Samma mintfärgade svep som en vanlig order,
 * sedan raderna en i taget med en halv sekunds mellanrum (en kassa per rad när
 * dess värde syns), summan och lagets steg, och till sist krymper allt in i
 * flödets översta rader, där orderna landar.
 *
 * En serie som bara har en order kvar spelas aldrig här, utan som den ordern (R34).
 */

import type { ReactElement } from "react";
import type { Forloppsdata } from "../ko.ts";
import { DOLD, heltal, klockslag, kronor } from "../vy.ts";
import { Postrad, type Rekt } from "./delar";
import { STD, SVEP, UT, farg, ip, mix } from "./kurvor.ts";
import { useCurrentFrame } from "./motor";
import { KRYMP, LUGN_TONING, RAD_IN, SERIE_MAX, serieTider } from "./tider.ts";

export type SerieProps = {
  data: Extract<Forloppsdata, { typ: "serie" }>;
  test: boolean;
  lugn: boolean;
  /** Flödets översta rader, där orderna landar, i fönstrets pixlar. */
  till: Rekt;
  /** Hur många av flödets rader det är (högst fyra). */
  rader: number;
  u: number;
  vw: number;
  vh: number;
};

/**
 * "3 nya order på 4 minuter" när de kom tätt (inom en kvart), annars med
 * klockslagen: "3 nya order · 09:12–14:05", eller ett när de kom samma minut.
 */
function etikettFor(order: readonly { tid: string }[], test: boolean): string {
  const tider = order.map((o) => Date.parse(o.tid)).filter((t) => Number.isFinite(t));
  const fran = tider.length ? klockslag(Math.min(...tider)) : "";
  const till = tider.length ? klockslag(Math.max(...tider)) : "";
  const minuter = tider.length ? Math.round((Math.max(...tider) - Math.min(...tider)) / 60_000) : 0;
  const vad = `${order.length} ${test ? "testorder" : "nya order"}`;
  if (fran === till) return `${vad} · ${fran}`;
  if (minuter >= 1 && minuter <= 15) return `${vad} på ${minuter} ${minuter === 1 ? "minut" : "minuter"}`;
  return `${vad} · ${fran}–${till}`;
}

export function Serie(p: SerieProps): ReactElement {
  const r = useCurrentFrame();
  const { u, data: d } = p;
  const t = serieTider(d.order.length);
  const vila = t.byt;
  const f = p.lugn ? vila - 1 : Math.min(r, vila);
  const g = p.lugn ? 0 : Math.max(0, r - vila);
  const ute = !p.lugn && r >= vila;
  const lugnTon = p.lugn ? Math.min(ip(r, [0, LUGN_TONING], [0, 1]), ip(r, [vila, vila + LUGN_TONING], [1, 0])) : 1;
  const k = ip(g, [0, KRYMP], [0, 1], STD);
  const m = p.till;
  const visas = d.order.slice(0, SERIE_MAX);
  const summa = d.order.reduce((s, o) => s + (o.belopp ?? 0), 0);
  const saljare = new Set(d.order.map((o) => o.person)).size;
  const lagP = ip(f, [t.lag + 18, t.lag + 62], [0, 1], STD);
  const lagV = mix(d.lag.fran.varde, d.lag.till.varde, lagP);
  const lagO = Math.round(mix(d.lag.fran.antal, d.lag.till.antal, lagP));
  const inglid = (a: number) => ({ opacity: ip(f, [a, a + 12], [0, 1]), translate: `0 ${ip(f, [a, a + 18], [28 * u, 0], UT)}px` });
  const person = (o: (typeof d.order)[number]) => d.personer[o.person] ?? DOLD;

  return (
    <div
      className="tv-fira"
      style={
        ute
          ? { clipPath: `inset(${m.y * k}px ${(p.vw - m.x - m.w) * k}px ${(p.vh - m.y - m.h) * k}px ${m.x * k}px round ${mix(0, 12 * u, k)}px)` }
          : { opacity: lugnTon }
      }
      aria-live="polite"
    >
      <div className="tv-f-band" style={{ clipPath: `inset(${ip(f, [0, 16], [100, 0], SVEP)}% 0 0 0)` }} />
      <div
        className="tv-f-yta"
        style={{ clipPath: `inset(${ip(f, [5, 23], [100, 0], SVEP)}% 0 0 0)`, background: ute ? farg("#0A1F18", "#143529", k) : undefined }}
      />
      <div className="tv-f-inne" style={ute ? { opacity: ip(g, [0, 10], [1, 0]), scale: String(ip(g, [0, 14], [1, 0.94], STD)) } : undefined}>
        <span className="tv-f-etikett" style={{ opacity: ip(f, [16, 30], [0, 1]), translate: `${ip(f, [16, 36], [-30 * u, 0], UT)}px 0` }}>
          <i />
          {etikettFor(d.order, p.test)}
        </span>
        <div className="tv-s-rader">
          {visas.map((o, i) => {
            const a = t.rad(i);
            return (
              <div key={o.nyckel} className={`tv-s-rad${o.niva === "stor" ? " tv-stor" : ""}`} style={inglid(a)}>
                <div className="tv-s-namn">
                  {person(o).namn}
                  <small>{o.bindning ? `${o.paket} · ${o.bindning} mån` : o.paket}</small>
                </div>
                <div className="tv-s-varde" style={{ scale: String(ip(f, [a + 12, a + 17, a + 36], [1, 1.04, 1], [UT, STD])) }}>
                  {o.belopp === null ? "–" : heltal(o.belopp)}
                  <span className="tv-f-kr">kr</span>
                </div>
              </div>
            );
          })}
          {d.order.length > SERIE_MAX ? (
            <div className="tv-s-fler" style={inglid(t.rad(SERIE_MAX - 1) + 8)}>
              +{d.order.length - SERIE_MAX} till
            </div>
          ) : null}
        </div>
        <div className="tv-s-summa" style={inglid(t.summa)}>
          Tillsammans <b>{kronor(summa)}</b>
          {saljare > 1 ? (
            <>
              {" "}
              från <b>{saljare}</b> säljare
            </>
          ) : null}
        </div>
        <div className="tv-f-lag" style={{ marginTop: "auto", opacity: ip(f, [t.lag, t.lag + 14], [0, 1]) }}>
          <div className="tv-f-lag-text">
            <span>Laget · {d.manad}</span>
            <span>
              <b>{kronor(lagV)}</b>
              {d.lag.mal !== null ? ` av ${kronor(d.lag.mal)}` : ""} · <b>{heltal(lagO)}</b> order
            </span>
          </div>
          {d.lag.mal !== null ? (
            <div className="tv-f-lag-spar">
              <div style={{ width: `${Math.min(100, (lagV / d.lag.mal) * 100)}%` }} />
            </div>
          ) : null}
        </div>
      </div>
      <div className="tv-f-mini tv-flode" style={{ left: m.x, top: m.y, width: m.w, height: m.h, opacity: ute ? ip(g, [RAD_IN[0], RAD_IN[1]], [0, 1]) : 0 }}>
        {[...d.order]
          .sort((a, b) => Date.parse(b.tid) - Date.parse(a.tid))
          .slice(0, p.rader)
          .map((o) => (
          <div key={o.nyckel} className={`tv-post${o.niva === "stor" ? " tv-stor" : ""}`} style={{ height: m.h / Math.max(1, p.rader) }}>
            <Postrad order={o} person={person(o)} idag={o.dag} />
          </div>
          ))}
      </div>
      {p.test ? <span className="tv-test">TEST</span> : null}
    </div>
  );
}
