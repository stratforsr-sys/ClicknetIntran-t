"use client";

/**
 * Kompositionen Mötet: ett bokat möte, i fyra storlekar (beställaren 2026-11-13:
 * det första, fem på en dag och tio på en dag ska vara olika, var och en större).
 *
 * ===========================================================================
 * ETT MÖTE FÅR ALDRIG SE UT SOM EN ORDER.
 *
 * Orderna sveper upp underifrån i mint, bär ett kronbelopp och låter som en
 * kassa. Mötena sveper in från sidan i ljung, bär aldrig ett belopp och låter som
 * anslag och klockor. Bärande form är DAGENS RAD: tio platser i två grupper om
 * fem, där bokarens block faller på plats. Fem är en fylld grupp, tio är en
 * fylld rad: milstolparna syns i formen innan de nås.
 * ===========================================================================
 *
 * - **Remsan** (`vanlig`, `lag`): ett möte till. En remsa i nederkanten, tavlan
 *   syns över den. Blocket faller, talet slår om. Fyra sekunder.
 * - **Första** (`dagensForsta`, `forsta`): bokarens första möte i dag, eller
 *   någonsin. Hela skärmen: namnet, meningen och raden med det första blocket.
 *   Det första någonsin får välkomsten.
 * - **Fem**: dagens möten faller ett i taget med en ton var, en paus, det femte
 *   slår i. Gruppen sluts till en balk: "Fem möten". Resten av raden står kvar
 *   som vägen till tio.
 * - **Tio**: som fem men hela raden, allt tätare. Det tionde stämplas in, och
 *   ljungen väller ut ur det och fyller skärmen; blocken vänds mörka när floden
 *   passerar dem. Raden sluts till en balk.
 *
 * Allt är en ren funktion av bildrutan. Lugn rörelse: scenen står still på sin
 * vilobild och tonas in och ut.
 */

import type { CSSProperties, ReactElement } from "react";
import type { Forloppsdata } from "../ko.ts";
import { klockslag } from "../vy.ts";
import { Ord } from "./delar";
import { SAKRING, SVEP, UT, STD, farg, fjader, ip, mix } from "./kurvor.ts";
import { useCurrentFrame } from "./motor";
import { LUGN_TONING, MOTE_LANDAR, MOTE_LANGD, MOTE_UT, femBlock, tioBlock } from "./tider.ts";

export type MotetProps = {
  data: Extract<Forloppsdata, { typ: "mote" }>;
  test: boolean;
  lugn: boolean;
  /** Pixlar per u (1 u = 1 px på 1920×1080). */
  u: number;
  vw: number;
  vh: number;
};

/** Mötenas färger, som i tavla.css (--ljung, --m-scen): rörelsen blandar dem i bildrutan. */
const LJUNG = "#C4A3E8";
const MSCEN = "#17121E";

/** Platserna i dagens rad. */
const PLATSER = 10;
/** Tios flod: så många bildrutor tar ljungen på sig att fylla skärmen från det tionde blocket. */
const FLOD = 28;

const ANTALORD = ["noll", "ett", "två", "tre", "fyra", "fem", "sex", "sju", "åtta", "nio", "tio"];
/** "fem möten", "ett möte", "12 möten". */
const moten = (n: number): string => `${ANTALORD[n] ?? String(n)} ${n === 1 ? "möte" : "möten"}`;
/** Förnamnet ur visningsnamnet: "Carl" ur "Carl B.". */
const fornamn = (namn: string): string => namn.split(" ")[0] ?? namn;

export function Motet(p: MotetProps): ReactElement {
  const n = p.data.niva;
  if (n === "fem" || n === "tio") return <Milstolpen {...p} />;
  if (n === "forsta" || n === "dagensForsta") return <Forsta {...p} />;
  return <Remsan {...p} />;
}

// -----------------------------------------------------------------------------
// Dagens rad
// -----------------------------------------------------------------------------

/**
 * Raden: tio platser i två grupper om fem. Block `i` är tomt tills det landar på
 * `landar(i)` (null: fyllt från början, Infinity: tomt hela tiden). Ett block faller
 * de sista bildrutorna före sin landning och slår i med en ring.
 *
 * `slut` (0–1) sluter de fyllda grupperna till en balk: mellanrummen inom en grupp
 * krymper, och med `sammanAlla` också mellan grupperna.
 */
function Raden({
  f,
  landar,
  storlek,
  mellan,
  grupp,
  slut = 0,
  sammanAlla = false,
  balk,
  ton = 1,
  milstolpar,
  tung,
}: {
  f: number;
  landar: (i: number) => number | null;
  /** Blockets sida i px. */
  storlek: number;
  /** Mellanrummet i en grupp, och mellan grupperna, i px. */
  mellan: number;
  grupp: number;
  slut?: number;
  sammanAlla?: boolean;
  /** Texten i balken när raden slutits. */
  balk?: string;
  /**
   * Färgen från ljung (1) mot mörkt (0), för tio när skärmen blir ljung. Per block:
   * floden från det tionde vänder blocken ett i taget när den passerar dem.
   */
  ton?: number | ((i: number) => number);
  /** Milstolparna 5 och 10 under sina platser, och hur synliga de är (0–1). */
  milstolpar?: number;
  /**
   * Milstolpens block (det femte eller tionde): det stämplas mot skärmen i stället för
   * att falla, och trycks ihop i nedslaget, som något tyngre än de andra.
   */
  tung?: number;
}): ReactElement {
  const fyllda: boolean[] = [];
  const block: ReactElement[] = [];
  let x = 0;
  const lagen: number[] = [];
  for (let i = 0; i < PLATSER; i++) {
    if (i > 0) x += i === 5 ? mix(grupp, 0, sammanAlla ? slut : 0) : mix(mellan, 0, slut);
    lagen.push(x);
    x += storlek;
  }
  const bredd = x;
  const tonFor = (i: number): number => (typeof ton === "function" ? ton(i) : ton);
  for (let i = 0; i < PLATSER; i++) {
    const l = landar(i);
    const fylld = l === null || f >= l;
    fyllda.push(fylld);
    const fallande = l !== null && Number.isFinite(l);
    const ar = i === tung && fallande;
    // Fallet: de sista 14 bildrutorna före landningen, med en fjäder i nedslaget. Milstolpens block
    // faller inte uppifrån utan stämplas mot skärmen: stort och svagt, allt fortare in på sin plats,
    // och trycks ihop i nedslaget. Det korsar aldrig etiketten ovanför.
    const fall = !fallande || ar ? 0 : f < l ? ip(f, [l - 14, l], [-1.4, 0], UT) : (1 - fjader(f, l, 12, 220)) * 0.12;
    const syns = l === null ? 1 : fallande ? ip(f, ar ? [l - 14, l - 6] : [l - 14, l - 8], [0, 1]) : 0;
    const stampel = ar ? (f < l ? ip(f, [l - 14, l], [1.5, 1], SAKRING) : 1 - 0.09 * (1 - fjader(f, l, 9, 260))) : 1;
    const ring = fallande && f >= l ? f - l : -1;
    block.push(
      <div key={i} className="tv-mo-plats" style={{ left: lagen[i], width: storlek, height: storlek }}>
        <div
          className="tv-mo-block"
          style={{
            background: farg(LJUNG, MSCEN, 1 - tonFor(i)),
            opacity: syns,
            translate: `0 ${fall * storlek}px`,
            scale: stampel !== 1 ? String(stampel) : undefined,
            borderRadius: Math.max(3, storlek * 0.16),
          }}
        />
        {ring >= 0 && ring < 26 ? (
          <div
            className="tv-mo-ring"
            style={{
              scale: String(ip(ring, [0, 24], [1, ar ? 1.6 : 1.32], UT)),
              opacity: ip(ring, [0, 2, 24], [0, 0.65, 0]),
              borderRadius: storlek * 0.2,
              boxShadow: tonFor(i) < 0.5 ? `0 0 0 ${Math.max(2, storlek * 0.025)}px ${MSCEN}` : undefined,
            }}
          />
        ) : null}
      </div>,
    );
  }
  const sista = tonFor(PLATSER - 1);
  const fyll = farg(LJUNG, MSCEN, 1 - sista);
  // Balken: när raden slutits står texten i de fyllda blocken.
  const fyllt = fyllda.lastIndexOf(true) + 1;
  const balkBredd = fyllt > 0 ? lagen[fyllt - 1] + storlek : 0;
  return (
    <div className="tv-mo-raden" style={{ width: bredd, height: storlek, "--mo-tom": fyll } as CSSProperties}>
      {block}
      {milstolpar
        ? [4, 9].map((i) => (
            <span
              key={i}
              className={`tv-mo-milstolpe${fyllda[i] ? " tv-mo-nadd" : ""}`}
              style={{ left: lagen[i], width: storlek, top: storlek + storlek * 0.22, fontSize: storlek * 0.24, opacity: milstolpar }}
            >
              {i + 1}
            </span>
          ))
        : null}
      {balk && slut > 0 ? (
        <div
          className="tv-mo-balk"
          style={{
            width: balkBredd,
            height: storlek,
            fontSize: storlek * 0.46,
            borderRadius: Math.max(3, storlek * 0.16),
            background: sista < 0.5 ? MSCEN : fyll,
            color: sista < 0.5 ? LJUNG : MSCEN,
            opacity: ip(slut, [0.4, 0.9], [0, 1]),
          }}
        >
          <span style={{ opacity: ip(slut, [0.7, 1], [0, 1]), translate: `0 ${ip(slut, [0.7, 1], [0.3, 0], UT)}em` }}>{balk}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Lagets rad: "Laget · i dag 7 möten · november 41". */
function Lagrad({ d, stil }: { d: MotetProps["data"]; stil?: CSSProperties }): ReactElement {
  return (
    <div className="tv-mo-lag" style={stil}>
      <span>Laget</span>
      <span>
        i dag <b>{d.lag.idag}</b> {d.lag.idag === 1 ? "möte" : "möten"}
      </span>
      <span>
        {d.manad} <b>{d.lag.manad}</b>
      </span>
    </div>
  );
}

/** In från vänster, ut åt höger: bandet först och ytan efter, som orderns svep fast på tvären. */
function Svep({ f, r, langd, lugn, flod }: { f: number; r: number; langd: number; lugn: boolean; flod?: string }): ReactElement {
  const ut = lugn ? 0 : Math.max(0, r - (langd - MOTE_UT));
  return (
    <>
      <div className="tv-mo-band" style={{ clipPath: `inset(0 ${lugn ? 0 : ip(f, [0, 18], [100, 0], SVEP)}% 0 ${ip(ut, [8, 30], [0, 100], SVEP)}%)` }} />
      <div
        className="tv-mo-yta"
        style={{ clipPath: `inset(0 ${lugn ? 0 : ip(f, [5, 25], [100, 0], SVEP)}% 0 ${ip(ut, [0, 24], [0, 100], SVEP)}%)`, background: flod }}
      />
    </>
  );
}

/** Scenens bildruta: `f` står still på vilobilden i lugnt läge, och `ton` tonar in och ut. */
function klocka(r: number, langd: number, vila: number, lugn: boolean): { f: number; ton: number; inneUt: number } {
  if (lugn) return { f: vila, ton: Math.min(ip(r, [0, LUGN_TONING], [0, 1]), ip(r, [langd - LUGN_TONING, langd], [1, 0])), inneUt: 1 };
  return { f: r, ton: 1, inneUt: ip(r, [langd - MOTE_UT, langd - MOTE_UT + 10], [1, 0]) };
}

const stig = (f: number, a: number, u: number): CSSProperties => ({
  opacity: ip(f, [a, a + 14], [0, 1]),
  translate: `0 ${ip(f, [a, a + 22], [26 * u, 0], UT)}px`,
});

// -----------------------------------------------------------------------------
// Remsan: ett möte till
// -----------------------------------------------------------------------------

function Remsan(p: MotetProps): ReactElement {
  const r = useCurrentFrame();
  const { u, data: d } = p;
  const L = MOTE_LANGD[d.niva];
  const land = MOTE_LANDAR[d.niva];
  const { f, ton } = klocka(r, L, land + 40, p.lugn);
  const lag = d.niva === "lag";
  const ut = p.lugn ? 0 : Math.max(0, r - (L - 24));
  // Remsan öppnas från vänster och stängs åt vänster: den kom in från sidan och går ut dit.
  const klipp = `inset(0 ${p.lugn ? 0 : Math.max(ip(f, [0, 20], [100, 0], SVEP), ip(ut, [0, 22], [0, 100], SVEP))}% 0 0 round ${18 * u}px)`;
  const fore = Math.max(0, d.antal - d.nya);
  const visat = f >= land ? d.antal : fore;
  const tal = lag ? (f >= land ? d.lag.idag : Math.max(0, d.lag.idag - d.nya)) : visat;
  const S = 36 * u;
  // Namnet får den plats som blir kvar bredvid raden och talet, och krymper hellre än klipps:
  // remsan, kanterna, två mellanrum, raden (döljs under 900 px) och talet.
  const remsa = Math.min(1078 * u, p.vw - 32);
  const rad = lag || p.vw < 900 ? 0 : 10 * S + 8 * 7 * u + 22 * u;
  const plats = remsa - 94 * u - (lag ? 36 : 72) * u - rad - 120 * u;
  const namnPx = Math.min(66 * u, plats / Math.max(1, [...(lag ? "Laget" : d.person.namn)].length * 0.52));
  const etikett = p.test ? "Testmöte" : lag ? "Nytt möte" : "Möte bokat";

  return (
    <div className="tv-mo-remsa-rot" style={{ opacity: ton }} aria-live="polite">
      <div className="tv-mo-remsa" style={{ clipPath: klipp }}>
        <div className="tv-mo-remsa-kant" style={{ scale: `1 ${p.lugn ? 1 : ip(f, [4, 22], [0, 1], UT)}` }} />
        <div className="tv-mo-remsa-inne" style={{ opacity: ut ? ip(ut, [0, 10], [1, 0]) : 1 }}>
          <div className="tv-mo-remsa-vem">
            <span className="tv-mo-etikett" style={{ opacity: ip(f, [10, 22], [0, 1]) }}>
              <i />
              {etikett} · {klockslag(d.tid)}
            </span>
            <div className="tv-mo-remsa-namn" style={{ fontSize: namnPx }}>
              <Ord text={lag ? "Laget" : d.person.namn} y={(i) => (1 - fjader(f, 12 + i * 4, 20)) * 112} />
            </div>
          </div>
          {lag ? null : (
            <Raden
              f={f}
              storlek={S}
              mellan={7 * u}
              grupp={22 * u}
              landar={(i) => (i < fore ? (f >= 18 + i * 2 ? null : Infinity) : i < d.antal ? land + (i - fore) * 6 : Infinity)}
            />
          )}
          <div className="tv-mo-remsa-tal" style={{ opacity: ip(f, [16, 28], [0, 1]) }}>
            <b style={{ scale: String(f >= land ? mix(1.18, 1, fjader(f, land, 12, 200)) : 1) }}>{tal}</b>
            <small>{lag ? "möten i dag i laget" : "i dag"}</small>
          </div>
        </div>
      </div>
      {p.test ? <span className="tv-test">TEST</span> : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Första: dagens första, eller det första någonsin
// -----------------------------------------------------------------------------

function Forsta(p: MotetProps): ReactElement {
  const r = useCurrentFrame();
  const { u, data: d } = p;
  const L = MOTE_LANGD[d.niva];
  const land = MOTE_LANDAR[d.niva];
  const nagonsin = d.niva === "forsta";
  const { f, ton, inneUt } = klocka(r, L, land + 120, p.lugn);
  const etikett = `${p.test ? "Testmöte" : nagonsin ? "Första mötet" : "Dagens första möte"} · ${klockslag(d.tid)}`;
  // Namnet så stort som får plats på en rad: 176 u, eller mindre för ett långt namn.
  const px = Math.min(176 * u, (p.vw - 300 * u) / Math.max(1, [...d.person.namn].length * 0.56));
  const fore = Math.max(0, d.antal - d.nya);

  return (
    <div className="tv-mo-scen" style={{ opacity: ton }} aria-live="polite">
      <Svep f={f} r={r} langd={L} lugn={p.lugn} />
      <div className="tv-mo-inne" style={{ opacity: inneUt }}>
        <span className="tv-mo-etikett" style={{ opacity: ip(f, [16, 30], [0, 1]), translate: `${ip(f, [16, 36], [-30 * u, 0], UT)}px 0` }}>
          <i />
          {etikett}
        </span>
        <div className="tv-mo-namn" style={{ fontSize: px }}>
          <Ord text={d.person.namn} y={(i) => (1 - fjader(f, 18 + i * 5, 20)) * 112} />
        </div>
        <p className="tv-mo-sats" style={stig(f, 40, u)}>
          {nagonsin ? (
            <>
              har bokat sitt <em>första möte</em>.
            </>
          ) : (
            <>
              har bokat <em>dagens första</em> möte.
            </>
          )}
        </p>
        <div className="tv-mo-radplats" style={{ opacity: ip(f, [land - 26, land - 14], [0, 1]) }}>
          <Raden
            f={f}
            storlek={108 * u}
            mellan={18 * u}
            grupp={60 * u}
            landar={(i) => (i < fore ? null : i < d.antal ? land + (i - fore) * 8 : Infinity)}
            milstolpar={ip(f, [land + 16, land + 34], [0, 1])}
          />
          <span className="tv-mo-radtext" style={stig(f, land + 10, u)}>
            {d.antal > 1 ? `${d.antal} i dag` : "1 av 10 i dag"}
          </span>
        </div>
        <div className="tv-mo-fot" style={{ opacity: ip(f, [land + 30, land + 46], [0, 1]) }}>
          {nagonsin && !p.test ? (
            <span className="tv-mo-valkommen" style={stig(f, land + 24, u)}>
              Välkommen till tavlan, {fornamn(d.person.namn)}
            </span>
          ) : p.test ? (
            <span className="tv-mo-valkommen">Test · räknas inte</span>
          ) : null}
          <Lagrad d={d} />
        </div>
      </div>
      {p.test ? <span className="tv-test">TEST</span> : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Fem och tio
// -----------------------------------------------------------------------------

function Milstolpen(p: MotetProps): ReactElement {
  const r = useCurrentFrame();
  const { u, data: d } = p;
  const tio = d.niva === "tio";
  const mal = tio ? 10 : 5;
  const L = MOTE_LANGD[d.niva];
  const land = MOTE_LANDAR[d.niva];
  const { f, ton, inneUt } = klocka(r, L, L - MOTE_UT - 40, p.lugn);
  const antal = Math.max(mal, d.antal);
  const blockTid = tio ? tioBlock : femBlock;
  // Block efter milstolpen (sex, sju … när flera möten kom på en gång) landar strax efter smällen.
  const landar = (i: number): number => (i < mal ? blockTid(i) : i < Math.min(antal, PLATSER) ? land + 10 + (i - mal) * 8 : Infinity);

  // Andningen före smällen: raden drar ihop sig en aning, och slår ut när det sista blocket landar.
  const andas = f < land ? ip(f, [land - 22, land - 2], [1, 0.965], STD) : mix(1.05, 1, fjader(f, land, 12, 180));
  const gd = f - land;
  const amp = gd >= 0 ? (tio ? 16 : 9) * u * Math.exp(-gd / 6) : 0;
  // Raden sluts till en balk efter smällen, och lyfts upp när namnet kommer.
  const slut = ip(f, [land + 26, land + 56], [0, 1], STD);
  const lyft = ip(f, [land + 64, land + 104], [0, 1], STD);
  const S = (tio ? 128 : 132) * u;
  // Raden börjar mitt på skärmen och lyfts till sin plats när namnet kommer: då står allt i mitten.
  const radDy = mix(150 * u, 0, lyft);
  // Tio: ljungen väller ut ur det tionde blocket och fyller skärmen. Floden är en cirkel med
  // mitten i blocket; varje block den passerar vänds till mörkt, och etiketten likaså. När
  // cirkeln täcker allt tar ytan över färgen och cirkeln släpps.
  const mellan = (tio ? 14 : 16) * u;
  const grupp = (tio ? 44 : 56) * u;
  const mittX = (i: number): number => i * S + (i - (i >= 5 ? 1 : 0)) * mellan + (i >= 5 ? grupp : 0) + S / 2;
  const R = Math.hypot(p.vw, p.vh);
  const vag = tio && !p.lugn ? ip(f, [land, land + FLOD], [0, 1], STD) : 0;
  const radie = vag * R;
  const flodKlar = tio && (p.lugn || f >= land + FLOD);
  const tackt = (avstand: number): boolean => flodKlar || (tio && f >= land && radie >= avstand);
  const bredd = 10 * S + 8 * mellan + grupp;
  const morkText = tackt(Math.hypot(mittX(9) - bredd / 2, S / 2 + 60 * u));
  const px = Math.min((tio ? 150 : 140) * u, (p.vw - 300 * u) / Math.max(1, [...d.person.namn].length * 0.56));
  const etikett = `${p.test ? "Test · " : ""}${tio ? "Tio möten" : "Fem möten"} · ${klockslag(d.tid)}`;
  const efter = land + 70;

  return (
    <div className={`tv-mo-scen tv-mo-mil${morkText ? " tv-mo-ljus" : ""}`} style={{ opacity: ton }} aria-live="polite">
      <Svep f={f} r={r} langd={L} lugn={p.lugn} flod={flodKlar ? LJUNG : undefined} />
      <div className="tv-mo-mitt" style={{ opacity: inneUt, translate: `${amp * Math.sin(gd * 2.3)}px ${amp * 0.6 * Math.cos(gd * 3.1)}px` }}>
        <span className="tv-mo-etikett" style={{ opacity: ip(f, [16, 30], [0, 1]), translate: `0 ${radDy}px` }}>
          <i />
          {etikett}
        </span>
        <div className="tv-mo-milrad" style={{ translate: `0 ${radDy}px`, scale: String(andas), opacity: ip(f, [20, 30], [0, 1]) }}>
          {tio && !flodKlar && f >= land ? (
            <div className="tv-mo-flod" style={{ left: mittX(9) - R, top: S / 2 - R, width: 2 * R, height: 2 * R, scale: String(vag) }} />
          ) : null}
          {/* Fem: en stötvåg ut från raden. Tio har floden i stället. */}
          {tio
            ? null
            : [0, 1].map((i) => {
                const h = gd - i * 7;
                return h >= 0 && h < 22 ? (
                  <div key={i} className="tv-mo-stor-ring" style={{ inset: -ip(h, [0, 20], [10, 56], UT) * u, opacity: ip(h, [0, 2, 20], [0, 0.32, 0]) }} />
                ) : null;
              })}
          <Raden
            f={f}
            storlek={S}
            mellan={mellan}
            grupp={grupp}
            landar={landar}
            slut={slut}
            sammanAlla={tio}
            balk={tio ? "Tio möten" : "Fem möten"}
            ton={(i) => (tackt(Math.abs(mittX(9) - mittX(i)) + S / 2) ? 0 : 1)}
            tung={mal - 1}
          />
        </div>
        <div className="tv-mo-namn tv-mo-namn-mitt" style={{ fontSize: px }}>
          <Ord text={d.person.namn} y={(i) => (1 - fjader(f, efter + i * 5, 18)) * 112} />
        </div>
        <p className="tv-mo-sats tv-mo-sats-mitt" style={stig(f, efter + 20, u)}>
          har bokat <em>{moten(antal)}</em> i dag.
        </p>
        <div className="tv-mo-fot tv-mo-fot-mitt" style={{ opacity: ip(f, [efter + 44, efter + 60], [0, 1]) }}>
          {!tio && antal < 10 ? <span className="tv-mo-valkommen">{10 - antal} kvar till tio</span> : null}
          {p.test ? <span className="tv-mo-valkommen">Test · räknas inte</span> : null}
          <Lagrad d={d} />
        </div>
      </div>
      {p.test ? <span className="tv-test">TEST</span> : null}
    </div>
  );
}
