"use client";

/**
 * Delarna kompositionerna och tavlan bygger av: räkneverket, det maskade namnet,
 * flödets rad och mätningarna. Varje del ritar efter tal som räknats ur en
 * bildruta (kurvor.ts); ingen del har en egen klocka.
 */

import { useEffect, useLayoutEffect, useMemo, useState, type CSSProperties, type ReactElement, type RefObject } from "react";
import type { TavleOrder, TavlePerson } from "../../../lib/salesboard/typer.ts";
import { flodeTid, heltal } from "../vy.ts";

/** En ruta i fönstrets pixlar. */
export type Rekt = { x: number; y: number; w: number; h: number };

// -----------------------------------------------------------------------------
// Mätningarna
// -----------------------------------------------------------------------------

let canvas: HTMLCanvasElement | null = null;

/** Canvas `measureText`. `typsnitt` är "800 Familj, reserv". */
export function matCanvas(text: string, px: number, typsnitt: string): number {
  if (typeof document === "undefined") return Number.NaN;
  canvas ??= document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return Number.NaN;
  const mellan = typsnitt.indexOf(" ");
  ctx.font = `${typsnitt.slice(0, mellan)} ${px}px ${typsnitt.slice(mellan + 1)}`;
  return ctx.measureText(text).width;
}

const RESERV: Record<string, string> = {
  "--f-display": "'Bricolage Grotesque', sans-serif",
  "--f-body": "Geist, sans-serif",
  "--f-mono": "'Geist Mono', monospace",
};

/**
 * Typsnittsfamiljen bakom en CSS-variabel (`--f-display` och de andra). I Next
 * pekar den på next/fonts genererade namn, i förhandsvisningen på det riktiga.
 */
export function familj(variabel: string, reserv: string = RESERV[variabel] ?? "sans-serif"): string {
  if (typeof document === "undefined") return reserv;
  const rot = document.querySelector(".tv-rot") ?? document.documentElement;
  return getComputedStyle(rot).getPropertyValue(variabel).trim() || reserv;
}

/** Sant när typsnitten har laddats, så att en mätning görs med rätt bredder. */
export function useTypsnittKlara(): boolean {
  const [klara, settKlara] = useState(false);
  useEffect(() => {
    let levande = true;
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    if (!fonts) {
      settKlara(true);
      return;
    }
    fonts.ready.then(
      () => levande && settKlara(true),
      () => levande && settKlara(true),
    );
    return () => {
      levande = false;
    };
  }, []);
  return klara;
}

/**
 * Mäter efter layouten, före målningen, och igen när typsnitten laddats eller
 * fönstret ändrat storlek. `mat` läser DOM:en och ger ett värde; första målningen
 * får `start`. Mått läses med offset-värden, som inte påverkas av transformer.
 */
export function useMatt<T>(mat: () => T | null, start: T, beroenden: readonly unknown[]): T {
  const [varde, settVarde] = useState<T>(start);
  const klara = useTypsnittKlara();
  // Ett mått som ändrar layouten (en mindre textstorlek) mäts en gång till med den nya
  // layouten. Det stannar när två mätningar i rad ger samma svar.
  const nyckel = JSON.stringify(varde);
  useLayoutEffect(() => {
    const las = () => {
      const v = mat();
      if (v !== null && JSON.stringify(v) !== JSON.stringify(varde)) settVarde(v);
    };
    las();
    window.addEventListener("resize", las);
    return () => window.removeEventListener("resize", las);
    // `mat` är en ny funktion varje rendering; beroendena säger när den ska köras om.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [klara, nyckel, ...beroenden]);
  return varde;
}

/** Elementets ruta i fönstret, utan dess egna transformer (förälderns kedja av offsetParent). */
export function rektUtanTransform(el: HTMLElement | null): Rekt | null {
  if (!el) return null;
  let x = 0;
  let y = 0;
  let n: HTMLElement | null = el;
  while (n) {
    x += n.offsetLeft;
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

/** Storleken som får plats: `px` krymps tills texten är högst `max` bred. */
export const passa = (bredd: number, px: number, max: number): number => (bredd > max && bredd > 0 ? (px * max) / bredd : px);

// -----------------------------------------------------------------------------
// Räkneverket
// -----------------------------------------------------------------------------

/** En kolumn i räkneverket: siffran den landar på och var i texten den står. */
export type Kolumn = { d: number; i: number };

/** Kolumnerna och mellanrummen för ett belopp: "18 900" blir 1, 8, mellanrum, 9, 0, 0. */
export function kolumnerFor(varde: number): (Kolumn | "mellan")[] {
  const ut: (Kolumn | "mellan")[] = [];
  let i = 0;
  for (const tecken of heltal(varde)) {
    if (/\d/.test(tecken)) ut.push({ d: Number(tecken), i: i++ });
    else ut.push("mellan");
  }
  return ut;
}

/** Varje siffra rullar i sin egen kolumn: 0–9 tre gånger, så att den kan snurra ett varv eller två. */
const CELLER = "012345678901234567890123456789".split("");

/**
 * Ett räkneverk. `y(k, n)` ger kolumnens läge i em (hur många siffror den
 * rullat), `opacity(k, n)` dess synlighet, `n` antalet siffror. "kr" står efter
 * med sin egen stil. Siffrornas bredder mäts i Bricolage, så att talet står tätt
 * som text och inte som en tabell.
 */
export function Rakneverk({
  varde,
  y,
  opacity,
  kr,
  className,
  style,
  elRef,
}: {
  varde: number;
  y: (k: Kolumn, n: number) => number;
  opacity?: (k: Kolumn, n: number) => number;
  kr?: CSSProperties;
  className: string;
  style?: CSSProperties;
  elRef?: Ref<HTMLDivElement>;
}): ReactElement {
  const delar = useMemo(() => kolumnerFor(varde), [varde]);
  const n = delar.filter((d) => d !== "mellan").length;
  const klara = useTypsnittKlara();
  const bredder = useMemo(() => {
    const typsnitt = `800 ${familj("--f-display")}`;
    return Array.from({ length: 10 }, (_, d) => {
      const b = matCanvas(String(d), 100, typsnitt) / 100;
      return Number.isFinite(b) && b > 0 ? b : 0.6;
    });
    // Mäts om när typsnitten laddats.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [klara]);
  return (
    <div className={className} style={style} ref={elRef} aria-label={`${heltal(varde)} kr`}>
      {delar.map((d, j) =>
        d === "mellan" ? (
          <span key={j} className="tv-od-mell" />
        ) : (
          <span key={j} className="tv-od-c" style={{ width: `${bredder[d.d]}em`, opacity: opacity ? opacity(d, n) : 1 }} aria-hidden="true">
            <span className="tv-od-s" style={{ translate: `0 ${-y(d, n)}em` }}>
              {CELLER.map((c, x) => (
                <span key={x}>{c}</span>
              ))}
            </span>
          </span>
        ),
      )}
      {kr ? (
        <span className="tv-f-kr" style={kr} aria-hidden="true">
          kr
        </span>
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Namnet i en mask, ord för ord
// -----------------------------------------------------------------------------

/** Orden i `text`, var och en i sin mask. `y(i)` är ordets läge i procent av dess höjd (112 = dolt). */
export function Ord({ text, y }: { text: string; y: (i: number) => number }): ReactElement {
  const ord = text.split(" ");
  return (
    <>
      {ord.map((w, i) => (
        <span key={i}>
          <span className="tv-ord">
            <span style={{ translate: `0 ${y(i)}%` }}>{w}</span>
          </span>
          {i < ord.length - 1 ? " " : null}
        </span>
      ))}
    </>
  );
}

// -----------------------------------------------------------------------------
// Flödets rad
// -----------------------------------------------------------------------------

/** "Hemsida Pro · 24 mån", eller bara paketet utan bindningstid. */
export const vadFor = (o: TavleOrder): string => (o.bindning ? `${o.paket} · ${o.bindning} mån` : o.paket);

/** En rad i flödet: klockslaget, vem och vad, och värdet. Samma rad i vila och i panelen som krymper. */
export function Postrad({ order, person, idag }: { order: TavleOrder; person: TavlePerson; idag: string }): ReactElement {
  return (
    <>
      <time dateTime={order.tid}>{flodeTid(order.tid, idag)}</time>
      <div style={{ minWidth: 0 }}>
        <div className="tv-pn">{person.namn}</div>
        <div className="tv-pp">{vadFor(order)}</div>
      </div>
      <span className="tv-pv">
        {order.belopp === null ? "–" : heltal(order.belopp)}
        {order.belopp === null ? null : <span className="tv-enh">kr</span>}
      </span>
    </>
  );
}

/** En referens till ett element, för de mätningar som behöver den. */
export type Ref<T extends HTMLElement> = RefObject<T | null>;
