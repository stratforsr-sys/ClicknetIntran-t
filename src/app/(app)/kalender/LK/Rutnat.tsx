"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DAGSTAK,
  DAY_END,
  DAY_START,
  KVITTO_BARA_ORGANISATOREN,
  ML,
  SH,
  SLOT,
  WDK,
  WDL,
  WORK_E,
  WORK_S,
  dagarForVy,
  dd,
  endOf,
  hm,
  isWeekend,
  kvittoFlyttad,
  kvittoLangd,
  layout,
  len,
  maxKolumner,
  mm,
  wd,
  daySum,
  SLAG_KLASS,
  type Post,
} from "@/lib/leveranskalender";
import { andraLangd, flytta } from "../moten/actions";
import { planera } from "@/app/(app)/uppgifter/actions";
import { Av, farDra, klickbar, oppnaPost, postetikett, postklasser, titel, type Lk } from "./gemensamt";

const px = (m: number) => ((m - DAY_START) / SLOT) * SH;

/** Pågår en längdändring? Då får posten inte samtidigt börja dras som en flytt. */
let pagarLangd = false;

/**
 * `renderGrid()`: Dag, Arbetsvecka och Vecka.
 *
 * DRA NEDÅT I TOMT RUTNÄT markerar en tid och öppnar formuläret (AC 7). DRA I
 * NEDERKANTEN av en egen post ändrar längden i kvartar, 15 min till 8 h
 * (AC 18). DRA POSTEN till en annan ruta flyttar den — organisatören flyttar,
 * alla andra får beskedet att de kan föreslå en ny tid (AC 17).
 */
export function Rutnat({ lk, synliga }: { lk: Lk; synliga: Post[] }) {
  const router = useRouter();
  const [, startOvergang] = useTransition();
  const { data, nu } = lk;
  const dagar = dagarForVy(data.vy, data.anchor);
  const H = ((DAY_END - DAY_START) / SLOT) * SH;
  const cols = `52px repeat(${dagar.length},minmax(${dagar.length > 1 ? 118 : 260}px,1fr))`;
  const idagSyns = dagar.includes(nu.dag);

  const [markering, setMarkering] = useState<{ d: string; m0: number; m1: number } | null>(null);
  const [langd, setLangd] = useState<{ id: string; m: number } | null>(null);
  const [slapp, setSlapp] = useState<string | null>(null);
  const dsel = useRef<{ d: string; m0: number; m1: number; moved: boolean } | null>(null);
  const rsz = useRef<{ post: Post; y0: number; m0: number; m: number } | null>(null);
  const tysta = useRef(false);

  const pa = (d: string) => synliga.filter((p) => p.dag === d);

  // ---------------------------------------------------------------------------
  // Pekaren
  // ---------------------------------------------------------------------------

  function nedHit(ev: React.PointerEvent, d: string, m: number) {
    if (ev.button !== 0) return;
    dsel.current = { d, m0: m, m1: m, moved: false };
    const avsluta = () => {
      window.removeEventListener("pointerup", avsluta);
      window.removeEventListener("pointercancel", avbryt);
      const s = dsel.current;
      dsel.current = null;
      setMarkering(null);
      if (!s || !s.moved) return;
      tysta.current = true;
      setTimeout(() => (tysta.current = false), 0);
      const a = Math.min(s.m0, s.m1);
      const b = Math.max(s.m0, s.m1) + SLOT;
      lk.nyHandelse(s.d, a, b - a);
    };
    const avbryt = () => {
      window.removeEventListener("pointerup", avsluta);
      window.removeEventListener("pointercancel", avbryt);
      dsel.current = null;
      setMarkering(null);
    };
    window.addEventListener("pointerup", avsluta);
    window.addEventListener("pointercancel", avbryt);
  }

  function rorelse(ev: React.PointerEvent) {
    const r = rsz.current;
    if (r) {
      const dm = ((ev.clientY - r.y0) / SH) * SLOT;
      r.m = Math.max(15, Math.min(8 * 60, Math.round((r.m0 + dm) / 15) * 15));
      setLangd({ id: r.post.id, m: r.m });
      return;
    }
    const s = dsel.current;
    if (!s) return;
    const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
    const h = el?.closest<HTMLElement>(".col .hit");
    if (!h || h.dataset.d !== s.d) return;
    const m = Number(h.dataset.m);
    if (m !== s.m1) {
      s.m1 = m;
      s.moved = true;
      setMarkering({ d: s.d, m0: s.m0, m1: m });
    }
  }

  function nedKant(ev: React.PointerEvent, post: Post) {
    if (!farDra(post, lk)) return;
    ev.preventDefault();
    ev.stopPropagation();
    const m0 = post.minuter ?? 30;
    rsz.current = { post, y0: ev.clientY, m0, m: m0 };
    pagarLangd = true;
    setLangd({ id: post.id, m: m0 });
    const klart = (avbryt: boolean) => {
      window.removeEventListener("pointerup", upp);
      window.removeEventListener("pointercancel", ner);
      const r = rsz.current;
      rsz.current = null;
      pagarLangd = false;
      setLangd(null);
      tysta.current = true;
      setTimeout(() => (tysta.current = false), 0);
      if (!r || avbryt || r.m === r.m0) return;
      sparaLangd(r.post, r.m);
    };
    const upp = () => klart(false);
    const ner = () => klart(true);
    window.addEventListener("pointerup", upp);
    window.addEventListener("pointercancel", ner);
  }

  function sparaLangd(post: Post, m: number) {
    startOvergang(async () => {
      if (post.slag === "uppgift") {
        const f = new FormData();
        f.set("id", post.ref!);
        f.set("due_date", post.dag);
        f.set("due_time", hm(post.start ?? 0));
        f.set("estimate_minutes", String(m));
        const r = await planera({}, f);
        lk.efter(r.fel ? { fel: r.fel } : { ok: true, kvitto: kvittoLangd(post.start ?? 0, (post.start ?? 0) + m, []) }, false);
        return;
      }
      lk.efter(await andraLangd(post.ref!, m), false);
    });
  }

  // ---------------------------------------------------------------------------
  // Flytt genom att dra posten
  // ---------------------------------------------------------------------------

  function slapptPa(d: string, m: number, postId: string) {
    const post = synliga.find((p) => p.id === postId);
    if (!post) return;
    if (!farDra(post, lk)) {
      lk.visaKvitto(KVITTO_BARA_ORGANISATOREN);
      return;
    }
    if (isWeekend(d)) {
      lk.visaKvitto("Välj en vardag.");
      return;
    }
    startOvergang(async () => {
      if (post.slag === "uppgift") {
        const f = new FormData();
        f.set("id", post.ref!);
        f.set("due_date", d);
        f.set("due_time", hm(m));
        if (post.minuter) f.set("estimate_minutes", String(post.minuter));
        const r = await planera({}, f);
        lk.efter(r.fel ? { fel: r.fel } : { ok: true, kvitto: kvittoFlyttad(d, m, []), dag: d }, false);
        return;
      }
      lk.efter(await flytta(post.ref!, d, m), false);
    });
  }

  // ---------------------------------------------------------------------------

  return (
    <div className="tg" style={{ gridTemplateColumns: cols }} onPointerMove={rorelse}>
      <div className="corner" />
      {dagar.map((d) => {
        const sum = daySum(synliga, d, data.mig);
        const heldag = pa(d).filter((p) => p.start === null && (p.agare === data.mig || p.slag !== "order"));
        return (
          <div key={d} className={`dh${d === nu.dag ? " is-today" : ""}`}>
            <button
              type="button"
              className="dhadd"
              aria-label={`Ny händelse ${WDL[wd(d)]} ${dd(d)} ${ML[mm(d)]}`}
              onClick={() => lk.nyHandelse(d)}
            >
              +
            </button>
            <span className="wdn">{d === nu.dag ? "Idag" : WDK[wd(d)]}</span>
            <span className="dn">{dd(d)}</span>
            <span className={`sum${sum > DAGSTAK ? " over" : ""}`}>{len(sum)} av 6 h</span>
            <span className="adc">
              {heldag.map((p) => {
                const t = titel(p, lk);
                return klickbar(p) ? (
                  <button
                    key={p.id}
                    type="button"
                    className={`chip ${t === null ? "k-uppgift" : SLAG_KLASS[p.slag]}`}
                    style={{ border: 0, font: "inherit", fontSize: "11.5px", fontWeight: 600, textAlign: "left", cursor: "pointer" }}
                    onClick={() => oppnaPost(p, lk, router)}
                  >
                    {t ?? "Upptagen"}
                  </button>
                ) : (
                  <span key={p.id} className={`chip ${SLAG_KLASS[p.slag]}`}>
                    {t ?? "Upptagen"}
                  </span>
                );
              })}
            </span>
          </div>
        );
      })}

      <div className="gut" style={{ height: H }}>
        {Array.from({ length: (DAY_END - DAY_START) / 60 - 1 }, (_, i) => DAY_START + 60 * (i + 1))
          .filter((m) => !(idagSyns && Math.abs(m - nu.min) < 15))
          .map((m) => (
            <span key={m} style={{ top: px(m) }}>
              {hm(m)}
            </span>
          ))}
        {idagSyns && nu.min >= DAY_START && nu.min < DAY_END && (
          <span className="nowtag" style={{ top: px(nu.min) }} aria-label={`Klockan är ${hm(nu.min)}`}>
            {hm(nu.min)}
          </span>
        )}
      </div>

      {dagar.map((d) => {
        const maxC = maxKolumner(dagar.length);
        const tidsatta = pa(d).filter((p) => p.start !== null);
        const utlagda = layout(tidsatta);
        const over = new Map<number, { list: Post[]; top: number }>();
        const minLedig = pa(d).some((p) => p.slag === "ledig" && p.agare === data.mig && !p.minuter);
        return (
          <div
            key={d}
            className={`col${isWeekend(d) ? " weekend" : ""}${d === nu.dag ? " today" : ""}`}
            style={{ height: H }}
          >
            <div className="off" style={{ top: 0, height: px(WORK_S) }} />
            <div className="off" style={{ top: px(WORK_E), bottom: 0 }} />
            {minLedig && <div className="ledig" />}
            {Array.from({ length: (DAY_END - DAY_START) / SLOT }, (_, i) => DAY_START + i * SLOT).map((m) => (
              <FragmentRuta
                key={m}
                d={d}
                m={m}
                slapp={slapp === `${d}|${m}`}
                onPointerDown={(ev) => nedHit(ev, d, m)}
                onClick={() => {
                  if (tysta.current) return;
                  lk.nyHandelse(d, m);
                }}
                onDragOver={(ev) => {
                  ev.preventDefault();
                  setSlapp(`${d}|${m}`);
                }}
                onDragLeave={() => setSlapp((s) => (s === `${d}|${m}` ? null : s))}
                onDrop={(ev) => {
                  ev.preventDefault();
                  setSlapp(null);
                  const v = ev.dataTransfer.getData("text/plain");
                  if (v.startsWith("e:")) slapptPa(d, m, v.slice(2));
                }}
              />
            ))}

            {utlagda.map((L) => {
              const p = L.e;
              if (L.cols > maxC && L.col >= maxC - 1) {
                const o = over.get(L.cl) ?? { list: [], top: 1e9 };
                o.list.push(p);
                o.top = Math.min(o.top, p.start ?? 0);
                over.set(L.cl, o);
                return null;
              }
              const c = Math.min(L.cols, maxC);
              const w = 100 / c;
              const m = langd?.id === p.id ? langd.m : Math.max(15, p.minuter ?? 30);
              return (
                <Postruta
                  key={p.id}
                  lk={lk}
                  post={p}
                  compact={(p.minuter ?? 30) <= 30}
                  grid
                  langdNu={langd?.id === p.id ? langd.m : null}
                  style={{
                    top: px(p.start ?? 0),
                    height: (m / SLOT) * SH - 2,
                    left: `calc(${L.col * w}% + 2px)`,
                    width: `calc(${w}% - 4px)`,
                  }}
                  onOpen={() => {
                    if (tysta.current) return;
                    oppnaPost(p, lk, router);
                  }}
                  onResizeStart={(ev) => nedKant(ev, p)}
                />
              );
            })}

            {[...over.values()].map((o, i) => {
              const w = 100 / maxC;
              return (
                <button
                  key={i}
                  type="button"
                  className="evmore"
                  style={{
                    top: px(o.top),
                    height: SH - 2,
                    left: `calc(${(maxC - 1) * w}% + 2px)`,
                    width: `calc(${w}% - 4px)`,
                  }}
                  title={o.list.map((x) => `${hm(x.start ?? 0)} ${titel(x, lk) ?? "Upptagen"}`).join(", ")}
                  onClick={() => {
                    lk.ga({ vy: "dag", dag: d });
                    lk.visaKvitto("Dagvyn visar alla samtidiga poster.");
                  }}
                >
                  +{o.list.length} fler
                </button>
              );
            })}

            {markering && markering.d === d && (
              <div
                className="selrange"
                style={{
                  top: px(Math.min(markering.m0, markering.m1)),
                  height: ((Math.max(markering.m0, markering.m1) + SLOT - Math.min(markering.m0, markering.m1)) / SLOT) * SH - 2,
                }}
              >
                {hm(Math.min(markering.m0, markering.m1))}–{hm(Math.max(markering.m0, markering.m1) + SLOT)}
              </div>
            )}

            {d === nu.dag && nu.min >= DAY_START && nu.min < DAY_END && <div className="nowline" style={{ top: px(nu.min) }} />}
          </div>
        );
      })}
    </div>
  );
}

function FragmentRuta({
  d,
  m,
  slapp,
  ...handlers
}: {
  d: string;
  m: number;
  slapp: boolean;
  onPointerDown: (ev: React.PointerEvent) => void;
  onClick: () => void;
  onDragOver: (ev: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (ev: React.DragEvent) => void;
}) {
  return (
    <>
      <div className={`slot${m % 60 ? " half" : ""}`} style={{ top: px(m) }} />
      <div className={`hit${slapp ? " drop" : ""}`} data-d={d} data-m={m} style={{ top: px(m), height: SH }} {...handlers} />
    </>
  );
}

/** `evHTML()`: en post. */
export function Postruta({
  lk,
  post,
  compact,
  grid,
  style,
  langdNu,
  onOpen,
  onResizeStart,
}: {
  lk: Lk;
  post: Post;
  compact: boolean;
  grid?: boolean;
  style: React.CSSProperties;
  langdNu?: number | null;
  onOpen: () => void;
  onResizeStart?: (ev: React.PointerEvent) => void;
}) {
  const t = titel(post, lk);
  const busy = t === null;
  const rubrik = busy ? "Upptagen" : t;
  const andra = busy || post.slag === "uppgift" ? [] : post.deltagare.filter((id) => id !== lk.data.mig).slice(0, 3);
  const drag = farDra(post, lk);
  const slut = langdNu ? (post.start ?? 0) + langdNu : endOf(post);
  const tid = `${hm(post.start ?? 0)}–${hm(slut)}`;
  const r = post.agare === lk.data.mig ? post.svar : null;
  const sub = post.klar ? "klar" : r === "vantar" ? "ej besvarad" : r === "kanske" ? "kanske" : r === "nej" ? "avböjt" : "";
  const etikett = postetikett(post, lk);
  const rep = post.serie ? (
    <span className="rep" aria-hidden="true">
      ↻
    </span>
  ) : null;
  const rz = grid && drag ? <span className="rz" aria-hidden="true" onPointerDown={onResizeStart} /> : null;
  const kl = postklasser(post, lk, compact) + (langdNu ? " resizing" : "");

  const gemensamt = {
    type: "button" as const,
    "data-e": post.id,
    draggable: drag,
    "aria-label": etikett,
    title: etikett,
    onClick: onOpen,
    onDragStart: (ev: React.DragEvent) => {
      if (pagarLangd) {
        ev.preventDefault();
        return;
      }
      ev.dataTransfer.setData("text/plain", `e:${post.id}`);
    },
  };

  if (compact) {
    return (
      <button className={kl} style={style} {...gemensamt}>
        <span className="badge">{hm(post.start ?? 0)}</span>
        <span className="t">
          {rubrik}
          {rep}
        </span>
        {sub && <span className="s">{sub}</span>}
        {rz}
      </button>
    );
  }

  return (
    <button
      className={kl + (andra.length ? " hasav" : "")}
      style={{ ...style, ...(andra.length ? ({ "--avn": andra.length } as React.CSSProperties) : {}) }}
      {...gemensamt}
    >
      <span className="t">
        {rubrik}
        {rep}
      </span>
      <span className="s badge">
        {tid}
        {sub ? ` · ${sub}` : ""}
      </span>
      {andra.length > 0 && (
        <span className="avs" aria-hidden="true">
          {andra.map((id) => (
            <Av key={id} person={lk.personer.get(id)} />
          ))}
        </span>
      )}
      {rz}
    </button>
  );
}
