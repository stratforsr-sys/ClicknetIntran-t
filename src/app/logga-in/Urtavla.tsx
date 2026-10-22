"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { aretsDagsljus, andringText, dagIAret, langdText, narmasteMinut, solTider } from "@/lib/dagsljus";
import { datumText, iStockholm, klockslag } from "@/lib/inloggning";

/**
 * Urtavlan: navmärket i stort, på den mörka halvan av inloggningen. På en
 * smal skärm står den under kortet och stiger upp ur skärmens nederkant, med
 * sommaren och dagen över kanten (inloggning.css).
 *
 * Märkets tre delar bär var sin sak. Ringen är dygnet, med middag överst och
 * midnatt nederst, och den gröna bågen är dagens dagsljus i Stockholm från
 * soluppgång till solnedgång: det som varit lyser, det som är kvar är dovt.
 * Ekrarna går ett varv i minuten i takt med klockan, som en sekundvisare, och
 * snurrar fort medan något väntar på servern, precis som det lilla märket i
 * bandet. Punkten i mitten är navet.
 *
 * Runt ringen står året: ett streck för varje dag, så långt som dagen är
 * ljus. Midsommar överst, midvinter nederst; det som varit av året är grönt,
 * resten väntar i spårets färg, och i dag är bärnstensgult. Den som för
 * musen över strecken ser den dagens ljus i texten nedanför.
 *
 * Över tavlan står Clicknets devis, på dess mittlinje: rakt ovanför middagen
 * och midsommaren, där dygnet och året är som ljusast, och dit en eker pekar
 * var tionde sekund. Ett streck leder från årets topp upp till den. Den är
 * tavlans kurs, och den står som en vanlig mening för skärmläsaren.
 *
 * Inget här hämtas: solen räknas i webbläsaren (src/lib/dagsljus.ts).
 *
 * Det som rör sig ligger i egna lager som vrids med `rotate`, så att
 * webbläsaren flyttar färdiga bilder och aldrig behöver rita om årets 365
 * streck. Allt står still med prefers-reduced-motion, och knappen i hörnet
 * stoppar rörelsen för den som vill ha det stilla (WCAG 2.2.2); valet sparas.
 */

/** Kalenderdagen i svensk tid. Servern skickar sin, så att första bilden stämmer med hydreringen. */
export type Dag = { ar: number; manad: number; dag: number };

// Tavlans egna enheter: 1000 × 1000 med mitten i 500,500. Rutan börjar i 0,0,
// så att transform-origin i CSS betyder samma sak i alla webbläsare.
const R_DYGN = 300;
const R_AR = 352;
/** Strecklängd per minut dagsljus: midsommarens 18 t 37 min blir 117, midvinterns 6 t 5 min 38. */
const AR_SKALA = 0.105;
/**
 * Ekrarna går från navet ut mot ringen men slutar före den, som i märket
 * (hubMark i utkastet). Tunna och långa, som på ett riktigt hjul: i stort
 * hade märkets korta, tjocka ekrar sett ut som en laddsnurra eller en sol.
 */
const NAV_R = 34;
const EKER_YTTRE = 284;

/**
 * Etiketternas rutor i tavlans enheter, för den minsta tavlan (400 px): texten
 * är 11 px i alla storlekar och tar störst plats där. "i dag" är 35 px bred,
 * en initial 7, och mellan dem ska det vara minst 4 px.
 */
const KROCK_X = ((35 + 7) / 2 + 4) * 2.5;
const KROCK_Y = (11 + 4) * 2.5;

const STILLA_NYCKEL = "nav-urtavla-stilla";
/** Ekrarnas snurr när något väntar: 60 grader på 0,55 s, som märket i bandet (in-varv). */
const SNURR_MS = 550;

/** Grader medurs från toppen för en minut på dygnet. Middag överst. */
const dygnsvinkel = (minut: number) => (minut / 1440) * 360 + 180;
/** Grader medurs från toppen för en dag i året. Midvintern, elva dagar före nyår, nederst. */
const arsvinkel = (dag: number, dagar: number) => ((dag + 11) / dagar) * 360 + 180;

function punkt(grader: number, r: number): [number, number] {
  const a = (grader * Math.PI) / 180;
  return [Math.round((500 + Math.sin(a) * r) * 10) / 10, Math.round((500 - Math.cos(a) * r) * 10) / 10];
}

/** Ett radiellt streck från radien r1 till r2. */
function linje(grader: number, r1: number, r2: number) {
  const [x1, y1] = punkt(grader, r1);
  const [x2, y2] = punkt(grader, r2);
  return { x1, y1, x2, y2 };
}

/** En punkt i tavlan som procent av rutan, för text som ska stå i HTML. */
function lage([x, y]: [number, number]): React.CSSProperties {
  return { left: `${x / 10}%`, top: `${y / 10}%` };
}

function minutIStockholm(tid: Date): number {
  return iStockholm(tid).minut;
}

/** Bågen medurs från vinkel a till b på radien r. */
function bage(a: number, b: number, r: number): string {
  const [x1, y1] = punkt(a, r);
  const [x2, y2] = punkt(b, r);
  const stor = (((b - a) % 360) + 360) % 360 > 180 ? 1 : 0;
  return `M${x1} ${y1}A${r} ${r} 0 ${stor} 1 ${x2} ${y2}`;
}

/** Hela dygnet som en bana, från midnatt nederst och medurs, så att den ritas upp i dygnets ordning. */
const HELA_DYGNET = `M500 ${500 + R_DYGN}A${R_DYGN} ${R_DYGN} 0 1 1 500 ${500 - R_DYGN}A${R_DYGN} ${R_DYGN} 0 1 1 500 ${500 + R_DYGN}`;

/** Dygnets timmar som skåror i ringen: 24 stycken, så att ringen läses som ett dygn. */
const SKAROR = Array.from({ length: 24 }, (_, h) => {
  const l = linje(dygnsvinkel(h * 60), R_DYGN - 8, R_DYGN + 8);
  return `M${l.x1} ${l.y1}L${l.x2} ${l.y2}`;
}).join("");

/** Timmarna står utanför ringen, där ekrarna inte sveper förbi. */
const TIMMAR = [0, 6, 12, 18].map((h) => ({ h, stil: lage(punkt(dygnsvinkel(h * 60), 327)) }));

const EKRAR = Array.from({ length: 6 }, (_, k) => linje(k * 60, NAV_R, EKER_YTTRE));

const MANADER = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

/**
 * Hur starkt en månad som varit lyser. Den innevarande starkast och januari
 * svagast, så att året läses som ett svep fram till i dag.
 */
function styrka(manad: number, nu: number): number {
  return manad > nu ? 1 : Math.round((0.38 + (0.62 * (manad + 1)) / (nu + 1)) * 100) / 100;
}

/** Det som bara beror på dagen: årets streck, dygnets ljus och texten. */
function tavlan(d: Dag) {
  const ljus = aretsDagsljus(d.ar);
  const dagar = ljus.length;
  const idag = dagIAret(d.ar, d.manad, d.dag);

  // Ett streck per dag, samlat i en bana per månad och halva (före och efter
  // i dag): tolv vågor i uppbyggnaden och bara ett par dussin element i DOM.
  const manader = MANADER.map(() => ({ fore: "", efter: "" }));
  ljus.forEach((minuter, i) => {
    if (i === idag) return;
    const l = linje(arsvinkel(i, dagar), R_AR, R_AR + minuter * AR_SKALA);
    const m = new Date(Date.UTC(d.ar, 0, 1 + i)).getUTCMonth();
    manader[m][i < idag ? "fore" : "efter"] += `M${l.x1} ${l.y1}L${l.x2} ${l.y2}`;
  });
  const vIdag = arsvinkel(idag, dagar);
  const idagPunkt = punkt(vIdag, R_AR + ljus[idag] * AR_SKALA + 30);

  // Initialerna står en bit utanför strecken den femtonde, så att de följer
  // årets form. Den som skulle krocka med "i dag" viker: dagens etikett säger mer.
  const manadEtiketter = MANADER.map((namn, m) => {
    const i = dagIAret(d.ar, m + 1, 15);
    const p = punkt(arsvinkel(i, dagar), R_AR + ljus[i] * AR_SKALA + 26);
    const krock = Math.abs(p[0] - idagPunkt[0]) < KROCK_X && Math.abs(p[1] - idagPunkt[1]) < KROCK_Y;
    return krock ? null : { namn, stil: lage(p) };
  });

  const tider = solTider(d.ar, d.manad, d.dag);
  const sol = tider ? { upp: minutIStockholm(tider.upp), ned: minutIStockholm(tider.ned) } : null;

  return {
    ljus,
    dagar,
    idag,
    manader,
    sol,
    dagsljus: sol ? bage(dygnsvinkel(sol.upp), dygnsvinkel(sol.ned), R_DYGN) : null,
    idagStreck: linje(vIdag, R_AR, R_AR + ljus[idag] * AR_SKALA),
    idagEtikett: lage(idagPunkt),
    manadEtiketter,
  };
}

/** Texten under tavlan, för i dag eller för dagen musen pekar på. */
function beskrivning(d: Dag, i: number, ljus: number[], arIdag: boolean) {
  const dag = new Date(Date.UTC(d.ar, 0, 1 + i, 12));
  const sol = solTider(dag.getUTCFullYear(), dag.getUTCMonth() + 1, dag.getUTCDate());
  const igar = i > 0 ? ljus[i - 1] : null;
  return {
    rubrik: arIdag ? "Dagsljus i Stockholm i dag" : `Dagsljus i Stockholm ${datumText(dag, dag)}`,
    langd: langdText(ljus[i]),
    andring: arIdag && igar !== null ? andringText(ljus[i], igar) : null,
    sol: sol ? `Sol upp ${klockslag(narmasteMinut(sol.upp))} · ned ${klockslag(narmasteMinut(sol.ned))}` : null,
  };
}

function lasStilla(): boolean {
  try {
    return localStorage.getItem(STILLA_NYCKEL) === "1";
  } catch {
    return false;
  }
}

export function Urtavla({ start }: { start: Dag }) {
  const [dag, setDag] = useState<Dag>(start);
  const [minut, setMinut] = useState<number | null>(null);
  const [pekar, setPekar] = useState<number | null>(null);
  const [stilla, setStilla] = useState(false);
  const rot = useRef<HTMLDivElement>(null);
  const hjul = useRef<HTMLDivElement>(null);
  const ekrar = useRef<SVGSVGElement>(null);

  const t = useMemo(() => tavlan(dag), [dag]);
  const text = beskrivning(dag, pekar ?? t.idag, t.ljus, pekar === null || pekar === t.idag);

  // Klockan: nu-strecket flyttas på minutslaget, och dagen byts vid midnatt
  // för den som har sidan öppen över natten.
  useEffect(() => {
    let tid = 0;
    const slag = () => {
      const nu = new Date();
      const s = iStockholm(nu);
      setMinut(s.minut);
      setDag((d) => (d.ar === s.ar && d.manad === s.manad && d.dag === s.dag ? d : { ar: s.ar, manad: s.manad, dag: s.dag }));
      window.clearTimeout(tid);
      tid = window.setTimeout(slag, 60_000 - (nu.getTime() % 60_000) + 50);
    };
    const tillbaka = () => {
      if (document.visibilityState === "visible") slag();
    };
    slag();
    document.addEventListener("visibilitychange", tillbaka);
    return () => {
      window.clearTimeout(tid);
      document.removeEventListener("visibilitychange", tillbaka);
    };
  }, []);

  useEffect(() => setStilla(lasStilla()), []);

  // Ekrarna i takt med klockan: varje jämnt tiotal sekunder pekar en eker
  // rakt upp, så att en eker står i topp när minuten slår om i bandet.
  useEffect(() => {
    const varv = ekrar.current?.getAnimations?.().find((a) => "animationName" in a && a.animationName === "in-ut-varv");
    if (varv) varv.currentTime = Date.now() % 60_000;
  }, []);

  // Ekrarna snurrar medan något i sidan väntar (aria-busy), som märket i
  // bandet. Snurret stannar inte mitt i: det rullar ut till nästa eker, så
  // att hjulet aldrig hoppar tillbaka.
  useEffect(() => {
    const sida = rot.current?.closest(".in-sida");
    const el = hjul.current;
    if (!sida || !el || typeof el.animate !== "function") return;
    const lugn = window.matchMedia("(prefers-reduced-motion: reduce)");
    let snurr: Animation | null = null;
    const titta = () => {
      const arbetar = sida.querySelector('[aria-busy="true"]') !== null && !lugn.matches && !lasStilla();
      if (arbetar && !snurr) {
        snurr = el.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(60deg)" }], {
          duration: SNURR_MS,
          iterations: Infinity,
        });
      } else if (!arbetar && snurr) {
        const fran = ((Number(snurr.currentTime ?? 0) % SNURR_MS) / SNURR_MS) * 60;
        snurr.cancel();
        snurr = null;
        el.animate([{ transform: `rotate(${fran}deg)` }, { transform: "rotate(60deg)" }], {
          duration: 240 + ((60 - fran) / 60) * 360,
          easing: "cubic-bezier(.2, .8, .2, 1)",
        });
      }
    };
    const vakt = new MutationObserver(titta);
    vakt.observe(sida, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-busy"] });
    titta();
    return () => {
      vakt.disconnect();
      snurr?.cancel();
    };
  }, []);

  function vaxla() {
    const nytt = !stilla;
    setStilla(nytt);
    try {
      if (nytt) localStorage.setItem(STILLA_NYCKEL, "1");
      else localStorage.removeItem(STILLA_NYCKEL);
    } catch {
      // Utan lagring gäller valet tills sidan laddas om.
    }
  }

  // Musen över årets streck: vilken dag den pekar på. Bara mus; på en
  // pekskärm finns ingen hovring, och ett tryck här ska inte göra något.
  function peka(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 1000 - 500;
    const y = ((e.clientY - r.top) / r.height) * 1000 - 500;
    const avstand = Math.hypot(x, y);
    if (avstand < R_AR - 12 || avstand > 500) {
      setPekar(null);
      return;
    }
    const grader = (Math.atan2(x, -y) * 180) / Math.PI;
    const i = Math.round(((grader - 180) / 360) * t.dagar - 11);
    setPekar(((i % t.dagar) + t.dagar) % t.dagar);
  }

  // Strecket musen pekar på lyses upp, utom dagens, som redan är markerat.
  const pek = pekar !== null && pekar !== t.idag ? pekar : null;
  const pekLinje = pek !== null ? linje(arsvinkel(pek, t.dagar), R_AR - 8, R_AR + t.ljus[pek] * AR_SKALA + 8) : null;

  // Dagsljuset som är kvar i dag, i panelens färg över bågen. Bara när
  // klockan är känd, alltså efter hydreringen, som nu-strecket.
  const kvar =
    minut !== null && t.sol && minut < t.sol.ned
      ? bage(dygnsvinkel(Math.max(minut, t.sol.upp)), dygnsvinkel(t.sol.ned), R_DYGN)
      : null;

  return (
    <div className="in-ut-ram" ref={rot} data-stilla={stilla ? "" : undefined}>
      <p className="in-ut-devis">
        <span>Vi leder dig mot din vision</span>
      </p>
      <div className="in-ut" aria-hidden="true" onPointerMove={peka} onPointerLeave={() => setPekar(null)}>
        <svg className="in-ut-tavla" viewBox="0 0 1000 1000">
          <g className="in-ut-ar">
            {t.manader.map((m, i) => (
              <g key={i} style={{ "--m": i, "--styrka": styrka(i, dag.manad - 1) } as React.CSSProperties}>
                {m.fore ? <path className="in-ut-fore" d={m.fore} /> : null}
                {m.efter ? <path className="in-ut-efter" d={m.efter} /> : null}
              </g>
            ))}
            <line className="in-ut-idag" {...t.idagStreck} />
            {pekLinje ? <line className="in-ut-pek" {...pekLinje} /> : null}
          </g>
          <g className="in-ut-dygn">
            <path className="in-ut-spar" d={HELA_DYGNET} pathLength={1} />
            {t.dagsljus ? <path className="in-ut-ljus" d={t.dagsljus} pathLength={1} /> : null}
            {kvar ? <path className="in-ut-kvar" d={kvar} /> : null}
            <path className="in-ut-skaror" d={SKAROR} />
          </g>
        </svg>

        <div className="in-ut-hjul" ref={hjul}>
          <svg className="in-ut-ekrar" viewBox="0 0 1000 1000" ref={ekrar}>
            <g>
              {EKRAR.map((e, i) => (
                <line key={i} {...e} />
              ))}
            </g>
            <circle className="in-ut-nav" cx="500" cy="500" r={NAV_R} />
            <circle className="in-ut-axel" cx="500" cy="500" r="13" />
          </svg>
        </div>

        {minut !== null ? (
          <svg
            className="in-ut-nu"
            viewBox="0 0 1000 1000"
            style={{ "--nu": `${dygnsvinkel(minut)}deg` } as React.CSSProperties}
          >
            <line x1="500" y1={500 - R_DYGN + 10} x2="500" y2={500 - R_DYGN - 16} />
            <circle cx="500" cy={500 - R_DYGN} r="7" />
          </svg>
        ) : null}

        {TIMMAR.map(({ h, stil }) => (
          <span key={h} className="in-ut-etikett in-ut-timme" style={stil}>
            {String(h).padStart(2, "0")}
          </span>
        ))}
        {t.manadEtiketter.map((e, m) =>
          e ? (
            <span key={m} className="in-ut-etikett in-ut-manad" style={e.stil}>
              {e.namn}
            </span>
          ) : null,
        )}
        <span className="in-ut-etikett in-ut-idagtext" style={t.idagEtikett}>
          i dag
        </span>
      </div>

      <div className="in-ut-fot">
        <div className="in-ut-text">
          <p className="in-ut-rubrik">{text.rubrik}</p>
          <p className="in-ut-langd">
            {text.langd}
            {text.andring ? <span> · {text.andring}</span> : null}
          </p>
          {text.sol ? <p className="in-ut-sol">{text.sol}</p> : null}
        </div>
        <button
          type="button"
          className="in-ut-paus"
          aria-pressed={stilla}
          title={stilla ? "Sätt igång urtavlan" : "Stoppa urtavlan"}
          onClick={vaxla}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            {stilla ? <path d="M5 3.5v9l7.5-4.5z" fill="currentColor" /> : <path d="M5.5 3.5v9M10.5 3.5v9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
          </svg>
          <span className="in-sr">Stoppa urtavlan</span>
        </button>
      </div>
    </div>
  );
}
