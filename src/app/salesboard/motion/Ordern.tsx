"use client";

/**
 * Kompositionen Ordern: en ny order (5.1), den första någonsin och den stora
 * affären, och utgången där allt krymper in i raden i flödet. Bildruta för
 * bildruta som den godkända prototypen (v5, `mall.html`: vanligScen, storScen
 * och firaOrder).
 *
 * Före `byt` spelas scenen, därefter utgången (`KRYMP`). Allt är en ren funktion
 * av bildrutan; det enda som läses ur DOM:en är måtten, en gång efter layouten.
 *
 * Lugn rörelse: scenen står still på sin vilobild, tonas in och ut, och krymper
 * inte.
 */

import { useRef, type CSSProperties, type ReactElement, type ReactNode, type RefObject } from "react";
import type { Forloppsdata } from "../ko.ts";
import { HART, heltal, klockslag, kronor, ordtal, snitt, taggText } from "../vy.ts";
import { Ord, Postrad, Rakneverk, passa, rektUtanTransform, useMatt, type Rekt } from "./delar";
import { ANDAS, SAKRING, STD, SVEP, UT, farg, fjader, ip, mix, skalaMix } from "./kurvor.ts";
import { useCurrentFrame } from "./motor";
import { KRYMP, LUGN_TONING, RAD_IN, STOR_D, STOR_VILA, VANLIG_VILA, landar, siffror } from "./tider.ts";

export type OrderProps = {
  data: Extract<Forloppsdata, { typ: "order" }>;
  test: boolean;
  lugn: boolean;
  /** Raden i flödet som allt krymper in i, i fönstrets pixlar. */
  till: Rekt;
  /** Pixlar per u (1 u = 1 px på 1920×1080). */
  u: number;
  /** Fönstrets storlek. */
  vw: number;
  vh: number;
};

/** Fakta som pillren under namnet: det feta, resten, och om pillret är amber. */
type Faktum = { fet: string; text: string; fetSist?: boolean; hojd?: boolean };

function Fakta({ fakta, stil }: { fakta: Faktum[]; stil: (i: number) => CSSProperties }): ReactElement {
  return (
    <>
      {fakta.map((f, i) => (
        <span key={i} className={f.hojd ? "tv-hojd" : undefined} style={stil(i)}>
          {f.fetSist ? (
            <>
              {f.text} <b>{f.fet}</b>
            </>
          ) : (
            <>
              <b>{f.fet}</b>
              {f.text ? ` ${f.text}` : ""}
            </>
          )}
        </span>
      ))}
    </>
  );
}

/** "Går upp till 2:a plats", "Leder oktober" eller "3:e plats i oktober". */
function platsFaktum(plats: number | null, fore: number | null, manad: string): Faktum | null {
  if (plats === null) return null;
  if (plats === 1) return { fet: "Leder", text: manad };
  if (fore === null || plats < fore) return { fet: `${ordtal(plats)} plats`, text: "Går upp till", fetSist: true };
  return { fet: `${ordtal(plats)} plats`, text: `i ${manad}` };
}

/**
 * Pillren för en order, högst fyra. Det som bara händer ibland (största affären,
 * välkomsten, rekorden) står först. Platsen och vägen till målet får alltid plats:
 * det är dem rummet räknar på. Det som blir över ryms i det som är kvar.
 */
function faktaFor(d: OrderProps["data"], test: boolean, stor: boolean): Faktum[] {
  if (test) return [{ fet: "Test", text: "räknas inte" }];
  const sallan: Faktum[] = [];
  const ovrigt: Faktum[] = [];
  if (d.fakta.storsta) sallan.push({ fet: "Månadens största affär", text: "", hojd: true });
  if (d.variant === "forsta") sallan.push({ fet: `Välkommen till tavlan, ${d.person.namn.split(" ")[0]}`, text: "", hojd: true });
  for (const t of d.taggar) {
    if (t.typ === "dagensForsta") continue;
    const x = taggText(t);
    sallan.push({ fet: x.fet, text: x.text, hojd: true });
  }
  const belopp = d.order.belopp ?? 0;
  const snittet = snitt(d.lag.fran.varde, d.lag.fran.antal);
  if (stor) {
    const andel = d.lag.mal && belopp ? Math.max(1, Math.round((belopp / d.lag.mal) * 100)) : 0;
    // En tiondel av månadens mål i en affär är det största som går att säga om den.
    if (andel) (andel >= 10 ? sallan : ovrigt).push({ fet: `${andel} %`, text: "av månadens mål i en enda affär" });
    const ganger = snittet > 0 ? Math.round(belopp / snittet) : 0;
    if (ganger >= 2) ovrigt.push({ fet: `${ganger}×`, text: "en snittorder" });
  } else {
    if (d.fakta.nr !== null) ovrigt.push({ fet: ordtal(d.fakta.nr), text: `ordern i ${d.manad}` });
    if (d.taggar.some((t) => t.typ === "dagensForsta")) ovrigt.push({ fet: "Dagens första", text: "" });
    else if (d.fakta.idag !== null) ovrigt.push({ fet: ordtal(d.fakta.idag), text: "i dag" });
  }
  const plats = platsFaktum(d.fakta.plats, d.fakta.platsFore, d.manad);
  const kvar = d.lag.mal !== null ? d.lag.mal - d.lag.till.varde : 0;
  const snittEfter = snitt(d.lag.till.varde, d.lag.till.antal);
  const mal: Faktum | null = kvar > 0 && snittEfter > 0 ? { fet: `≈${HART}${heltal(Math.ceil(kvar / snittEfter))} order`, text: "kvar till målet" } : null;
  const fasta = [plats, mal].filter((x): x is Faktum => x !== null);
  return [...[...sallan, ...ovrigt].slice(0, 4 - fasta.length), ...fasta];
}

function Etikett({ text, stil }: { text: string; stil?: CSSProperties }): ReactElement {
  return (
    <span className="tv-f-etikett" style={stil}>
      <i />
      {text}
    </span>
  );
}

/** Vad som såldes: "Hemsida Pro · 24 mån bindning". */
function Vad({ d, className, stil }: { d: OrderProps["data"]; className: string; stil: CSSProperties }): ReactElement {
  return (
    <div className={className} style={stil}>
      <b>{d.order.paket}</b>
      {d.order.bindning ? ` · ${d.order.bindning} mån bindning` : ""}
    </div>
  );
}

/** Lagets rad: "Laget · oktober" och "X kr av Y kr · N order". */
function Lagtext({ d, varde, antal, medAntal }: { d: OrderProps["data"]; varde: number; antal: number; medAntal: boolean }): ReactElement {
  return (
    <div className="tv-f-lag-text">
      <span>Laget · {d.manad}</span>
      <span>
        <b>{kronor(varde)}</b>
        {d.lag.mal !== null ? ` av ${kronor(d.lag.mal)}` : ""}
        {medAntal ? (
          <>
            {" · "}
            <b>{heltal(antal)}</b> order
          </>
        ) : null}
      </span>
    </div>
  );
}

export function Ordern(p: OrderProps): ReactElement {
  const r = useCurrentFrame();
  const stor = p.data.variant === "stor";
  const vila = stor ? STOR_VILA : VANLIG_VILA;
  const inne = useRef<HTMLDivElement>(null);
  const lugnTon = p.lugn ? Math.min(ip(r, [0, LUGN_TONING], [0, 1]), ip(r, [vila, vila + LUGN_TONING], [1, 0])) : 1;
  const f = p.lugn ? vila - 1 : Math.min(r, vila);
  const g = p.lugn ? 0 : Math.max(0, r - vila);
  const ute = !p.lugn && r >= vila;

  // --- Utgången: allt krymper in i raden i flödet ------------------------------
  const W = p.vw;
  const H = p.vh;
  const t = p.till;
  const k = ip(g, [0, KRYMP], [0, 1], STD);
  const firaStil: CSSProperties = ute
    ? { clipPath: `inset(${t.y * k}px ${(W - t.x - t.w) * k}px ${(H - t.y - t.h) * k}px ${t.x * k}px round ${mix(0, 12 * p.u, k)}px)` }
    : { opacity: lugnTon };
  const inneUt: CSSProperties = ute ? { opacity: ip(g, [0, 10], [1, 0]), scale: String(ip(g, [0, 14], [1, 0.94], STD)) } : {};
  const ytaUt = ute ? farg(stor ? "#F2B24C" : "#0A1F18", "#143529", k) : null;

  return (
    <div className={`tv-fira${stor ? " tv-jatte" : ""}`} style={firaStil} aria-live="polite">
      {stor ? <Stor {...p} f={f} inne={inne} ytaUt={ytaUt} inneUt={inneUt} /> : <Vanlig {...p} f={f} inne={inne} ytaUt={ytaUt} inneUt={inneUt} />}
      <div
        className="tv-f-mini"
        style={{ left: t.x, top: t.y, width: t.w, height: t.h, opacity: ute ? ip(g, [RAD_IN[0], RAD_IN[1]], [0, 1]) : 0 }}
      >
        <div className={`tv-post${p.data.order.niva === "stor" ? " tv-stor" : ""}`}>
          <Postrad order={p.data.order} person={p.data.person} idag={p.data.order.dag} />
        </div>
      </div>
      {p.test ? <span className="tv-test">TEST</span> : null}
    </div>
  );
}

type Scenprops = OrderProps & { f: number; inne: RefObject<HTMLDivElement | null>; ytaUt: string | null; inneUt: CSSProperties };

// -----------------------------------------------------------------------------
// Ny order: svep, namn, räkneverk, kassa
// -----------------------------------------------------------------------------

function Vanlig(p: Scenprops): ReactElement {
  const { f, u, data: d } = p;
  const belopp = d.order.belopp ?? 0;
  const n = siffror(belopp);
  const L = 50 + landar(n);
  const namnRef = useRef<HTMLDivElement>(null);

  // Måtten: namnet passas in och börjar stort mitt på skärmen (42 % ner).
  const matt = useMatt(
    () => {
      const inne = p.inne.current;
      const namn = namnRef.current;
      if (!inne || !namn) return null;
      const stil = getComputedStyle(inne);
      const maxB = inne.clientWidth - 2 * parseFloat(stil.paddingLeft);
      const px = parseFloat(getComputedStyle(namn).fontSize) || 176 * u;
      const fsBas = namn.dataset.bas ? Number(namn.dataset.bas) : px;
      namn.dataset.bas = String(fsBas);
      const bredd = namn.scrollWidth * (fsBas / px);
      const fs = passa(bredd, fsBas, maxB);
      const b = (bredd * fs) / fsBas;
      const rekt = rektUtanTransform(namn);
      const mitt = rekt ? rekt.y + (rekt.h * fs) / px / 2 : p.vh / 2;
      return { fs, startSkala: Math.min(1.25, maxB / Math.max(1, b)), dy: p.vh * 0.42 - mitt };
    },
    { fs: 0, startSkala: 1, dy: 0 },
    [d.person.namn, u, p.vw, p.vh],
  );

  const flytt = ip(f, [44, 72], [0, 1], STD);
  const fv = f - 50;
  const fakta = faktaFor(d, p.test, false);
  const lagP = ip(f, [L + 48, L + 92], [0, 1], STD);
  const lagV = mix(d.lag.fran.varde, d.lag.till.varde, lagP);
  const lagO = Math.round(mix(d.lag.fran.antal, d.lag.till.antal, lagP));
  const etikett = `${d.variant === "forsta" ? "Första ordern" : p.test ? "Testorder" : "Ny order"} · ${klockslag(d.order.tid)}`;

  return (
    <>
      <div className="tv-f-band" style={{ clipPath: `inset(${ip(f, [0, 16], [100, 0], SVEP)}% 0 0 0)` }} />
      <div className="tv-f-yta" style={{ clipPath: `inset(${ip(f, [5, 23], [100, 0], SVEP)}% 0 0 0)`, background: p.ytaUt ?? undefined }} />
      <div className="tv-f-inne" ref={p.inne} style={p.inneUt}>
        <Etikett
          text={etikett}
          stil={{ opacity: ip(f, [16, 30], [0, 1]), translate: `${ip(f, [16, 36], [-30 * u, 0], UT)}px 0` }}
        />
        <div
          className="tv-f-namn"
          ref={namnRef}
          style={{
            fontSize: matt.fs || undefined,
            translate: `0 ${(1 - flytt) * matt.dy}px`,
            scale: String(skalaMix(matt.startSkala, 1, flytt)),
          }}
        >
          <Ord text={d.person.namn} y={(i) => (1 - fjader(f, 16 + i * 5, 20)) * 112} />
        </div>
        <Rakneverk
          className="tv-f-varde"
          varde={belopp}
          style={{
            translate: `0 ${ip(f, [50, 78], [60 * u, 0], UT)}px`,
            scale: String(ip(f, [L, L + 5, L + 24], [1, 1.045, 1], [UT, STD])),
          }}
          y={(k, antal) => ip(fv, [k.i * 2, 26 + k.i * 3], [0, (k.i >= antal / 2 ? 20 : 10) + k.d], UT)}
          opacity={(k) => ip(fv, [k.i * 2, k.i * 2 + 8], [0, 1])}
          kr={{ opacity: ip(fv, [landar(n) - 8, landar(n) + 4], [0, 1]) }}
        />
        <Vad
          d={d}
          className="tv-f-vad"
          stil={{ opacity: ip(f, [L + 2, L + 18], [0, 1]), translate: `0 ${ip(f, [L + 2, L + 22], [24 * u, 0], UT)}px` }}
        />
        <div className="tv-f-fakta">
          <Fakta
            fakta={fakta}
            stil={(i) => {
              const a = L + 22 + i * 6;
              return { opacity: ip(f, [a, a + 12], [0, 1]), translate: `0 ${ip(f, [a, a + 18], [28 * u, 0], UT)}px` };
            }}
          />
        </div>
        <div className="tv-f-lag" style={{ opacity: ip(f, [L + 30, L + 44], [0, 1]) }}>
          <Lagtext d={d} varde={lagV} antal={lagO} medAntal />
          {d.lag.mal !== null ? (
            <div className="tv-f-lag-spar">
              <div style={{ width: `${Math.min(100, (lagV / d.lag.mal) * 100)}%` }} />
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

// -----------------------------------------------------------------------------
// Stor affär: springa, trumvirvel, smäll, amber
// -----------------------------------------------------------------------------

/**
 * Byggd för att kännas helt annorlunda än en vanlig order: scenen öppnas som en
 * springa, beloppet snurrar som en enarmad bandit medan trumvirveln stiger, och
 * allt låses på cymbalen. Sedan blir hela skärmen amber, och namnet och lagets
 * steg mot målet kommer fram.
 */
function Stor(p: Scenprops): ReactElement {
  const { f, u, data: d } = p;
  const D = STOR_D;
  const belopp = d.order.belopp ?? 0;
  const mittRef = useRef<HTMLDivElement>(null);
  const vardeRef = useRef<HTMLDivElement>(null);
  const namnRef = useRef<HTMLDivElement>(null);
  const radRef = useRef<HTMLSpanElement>(null);

  const matt = useMatt(
    () => {
      const mitt = mittRef.current;
      const v = vardeRef.current;
      const namn = namnRef.current;
      const rad = radRef.current;
      if (!mitt || !v || !namn || !rad) return null;
      const maxB = mitt.clientWidth - 2 * parseFloat(getComputedStyle(mitt).paddingLeft);
      const vPx = parseFloat(getComputedStyle(v).fontSize) || 300 * u;
      const nPx = parseFloat(getComputedStyle(namn).fontSize) || 132 * u;
      const vBas = v.dataset.bas ? Number(v.dataset.bas) : vPx;
      const nBas = namn.dataset.bas ? Number(namn.dataset.bas) : nPx;
      v.dataset.bas = String(vBas);
      namn.dataset.bas = String(nBas);
      const vFs = passa(v.scrollWidth * (vBas / vPx), vBas, maxB * 0.94);
      const nFs = passa(namn.scrollWidth * (nBas / nPx), nBas, maxB);
      const rekt = rektUtanTransform(v);
      const mittY = rekt ? rekt.y + rekt.h / 2 : p.vh / 2;
      return { vFs, nFs, dyV: p.vh / 2 - mittY, seg: rad.scrollWidth / 6, radH: p.vh / 5 };
    },
    { vFs: 0, nFs: 0, dyV: 0, seg: 1, radH: p.vh / 5 },
    [d.person.namn, belopp, u, p.vw, p.vh],
  );

  const forePct = d.lag.mal ? Math.min(100, (d.lag.fran.varde / d.lag.mal) * 100) : 0;
  const nyPct = d.lag.mal ? (belopp / d.lag.mal) * 100 : 0;
  const fakta = faktaFor(d, p.test, true);

  // Akt 1: en amberfärgad springa delar skärmen och öppnar en mörk scen.
  const oppen = ip(f, [8, 28], [0, 1], SVEP);
  const yta = p.ytaUt ?? (f < D ? "#0A1F18" : farg("#FFF4DF", "#F2B24C", ip(f, [D + 2, D + 16], [0, 1])));
  // Akt 2: raderna rusar allt fortare mot smällen (u per bild: 3 → 30), andas in strax före och slår ut efter.
  const vagFore = (x: number) => 3 * x + (9 * x ** 3) / D ** 2;
  const vag = f < D ? vagFore(f) : vagFore(D) + 1.5 * (f - D) + 570 * (1 - Math.exp(-(f - D) / 20));
  const andas = f < D ? ip(f, [D - 16, D], [0, 1], ANDAS) : 1 - fjader(f, D, 13, 160);
  const ton = f < D ? `rgba(242,178,76,${ip(f, [18, 60], [0, 0.32])})` : "rgba(10,31,24,0.13)";
  const forskj = (vag * u) % Math.max(1, matt.seg);
  // Smällen: skärmen skakar och två ringar slår ut från beloppet.
  const gd = f - D;
  const amp = gd >= 0 ? 18 * u * Math.exp(-gd / 5) : 0;
  // Akt 3: beloppet glider upp, namnet stiger fram, sedan fakta och lagets steg.
  const dy = (1 - ip(f, [D + 40, D + 72], [0, 1], STD)) * matt.dyV;
  const lyft: CSSProperties = { translate: `0 ${dy}px` };
  const morkt = f < D ? "#F2B24C" : "#0A1F18";
  const pl = ip(f, [D + 124, D + 160], [0, 1], UT);
  const kolumnFart = (i: number) => 0.38 + ((i * 7) % 4) * 0.06;
  const snurr = (x: number, i: number) => 10 + ((x * kolumnFart(i) + i * 3.3) % 10);
  const etikett = `${p.test ? "Testorder" : "Stor affär"} · ${klockslag(d.order.tid)}`;

  const rader: ReactNode[] = Array.from({ length: 5 }, (_, i) => (
    <div key={i} className="tv-j-rad" style={{ translate: `${i % 2 ? forskj - matt.seg : -forskj}px ${(2 - i) * matt.radH * 0.22 * andas}px` }}>
      <span ref={i === 0 ? radRef : undefined}>{"Stor affär · ".repeat(6)}</span>
    </div>
  ));

  return (
    <>
      <div className="tv-f-band" style={{ clipPath: "inset(100% 0 0 0)" }} />
      <div className="tv-f-yta" style={{ clipPath: p.ytaUt ? undefined : `inset(${50 * (1 - oppen)}% 0 ${50 * (1 - oppen)}% 0)`, background: yta }} />
      <div className="tv-f-inne" ref={p.inne} style={{ ...p.inneUt, "--j-ton": ton } as CSSProperties}>
        <div className="tv-j-rader">{rader}</div>
        {[0, 1].map((i) => (
          <div
            key={i}
            className="tv-j-kant"
            style={{
              top: `calc(${50 + (i ? 1 : -1) * 50 * oppen}% - ${2 * u}px)`,
              scale: `${ip(f, [0, 12], [0, 1], UT)} 1`,
              opacity: ip(f, [22, 32], [1, 0]),
            }}
          />
        ))}
        {[0, 1].map((i) => {
          const h = gd - i * 7;
          return <div key={i} className="tv-j-ring" style={{ scale: String(ip(h, [0, 42], [0.3, 5.2], UT)), opacity: ip(h, [0, 4, 42], [0, 0.6, 0]) }} />;
        })}
        <div className="tv-j-mitt" ref={mittRef} style={{ translate: `${amp * Math.sin(gd * 2.1)}px ${amp * 0.6 * Math.cos(gd * 2.9)}px` }}>
          <Etikett text={etikett} stil={{ ...lyft, color: morkt, opacity: ip(f, [14, 26], [0, 1]) }} />
          <Rakneverk
            className={`tv-f-varde tv-j-varde${f < D ? " tv-snurrar" : ""}`}
            varde={belopp}
            elRef={vardeRef}
            style={{
              ...lyft,
              fontSize: matt.vFs || undefined,
              color: morkt,
              scale: String(f < D ? ip(f, [16, D - 14, D], [0.82, 0.9, 0.84], [STD, STD]) : mix(1.16, 1, fjader(f, D, 11, 170))),
            }}
            y={(k) => {
              const mal = 20 + k.d;
              if (f < D - 8) return snurr(f, k.i);
              if (f <= D) return ip(f, [D - 8, D], [snurr(D - 8, k.i), mal], STD);
              return mal + 0.14 * Math.exp(-(f - D) / 5) * Math.sin((f - D) * 0.9);
            }}
            opacity={() => ip(f, [16, 30], [0, 1])}
            kr={{ opacity: ip(f, [D + 12, D + 16], [0, 1]), translate: `0 ${(1 - fjader(f, D + 12, 12, 220)) * -0.8}em` }}
          />
          <div className="tv-j-saker" style={{ ...lyft, opacity: ip(f, [16, 24, D, D + 8], [0, 1, 1, 0]) }}>
            <div style={{ scale: `${ip(f, [20, D], [0, 1], SAKRING)} 1` }} />
          </div>
          <div className="tv-j-namn" ref={namnRef} style={{ fontSize: matt.nFs || undefined }}>
            <Ord text={d.person.namn} y={(i) => (1 - fjader(f, D + 56 + i * 5, 18)) * 112} />
          </div>
          <Vad
            d={d}
            className="tv-j-vad"
            stil={{ opacity: ip(f, [D + 74, D + 90], [0, 1]), translate: `0 ${ip(f, [D + 74, D + 94], [24 * u, 0], UT)}px` }}
          />
          <div className="tv-f-fakta tv-j-fakta">
            <Fakta
              fakta={fakta}
              stil={(i) => {
                const a = D + 88 + i * 6;
                return { opacity: ip(f, [a, a + 12], [0, 1]), translate: `0 ${ip(f, [a, a + 18], [28 * u, 0], UT)}px` };
              }}
            />
          </div>
          <div className="tv-j-lag" style={{ opacity: ip(f, [D + 104, D + 118], [0, 1]) }}>
            <Lagtext d={d} varde={mix(d.lag.fran.varde, d.lag.till.varde, pl)} antal={d.lag.till.antal} medAntal={false} />
            {d.lag.mal !== null ? (
              <div className="tv-j-spar">
                <div className="tv-j-fore" style={{ width: `${forePct}%` }} />
                <div className="tv-j-ny" style={{ left: `${forePct}%`, width: `${Math.min(100 - forePct, nyPct * pl)}%` }} />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
