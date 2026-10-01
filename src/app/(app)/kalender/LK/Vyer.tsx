"use client";

import { useRouter } from "next/navigation";
import {
  MK,
  ML,
  SLAG_ETIKETT,
  SLAG_KLASS,
  WDL,
  dd,
  endOf,
  hm,
  isWeekend,
  manadsrutor,
  mm,
  plus,
  weekno,
  wd,
  type Post,
} from "@/lib/leveranskalender";
import { klickbar, mittSvar, oppnaPost, stapelfarg, titel, type Lk } from "./gemensamt";

const efterStart = (a: Post, b: Post) => (a.start ?? -1) - (b.start ?? -1);

/** `renderMonth()`: tre poster per dag, resten som "+N till". Klick öppnar dagen. */
export function Manad({ lk, synliga }: { lk: Lk; synliga: Post[] }) {
  const { data, nu } = lk;
  const m = mm(data.anchor);
  return (
    <div className="mg">
      {["Måndag", "Tisdag", "Onsdag", "Torsdag", "Fredag", "Lördag", "Söndag"].map((x) => (
        <div key={x} className="mh">
          {x}
        </div>
      ))}
      {manadsrutor(data.anchor).map((d) => {
        const list = synliga.filter((p) => p.dag === d).sort(efterStart);
        return (
          <div
            key={d}
            className={`md${mm(d) !== m ? " out" : ""}${d === nu.dag ? " today" : ""}`}
            data-day={d}
            role="button"
            tabIndex={0}
            aria-label={`${WDL[wd(d)]} ${dd(d)} ${ML[mm(d)]}${list.length ? `, ${list.length} poster` : ""}`}
            onClick={() => lk.ga({ vy: "dag", dag: d })}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                lk.ga({ vy: "dag", dag: d });
              }
            }}
          >
            <span className="n">{dd(d)}</span>
            {list.slice(0, 3).map((p) => {
              const t = titel(p, lk);
              return (
                <span key={p.id} className={`chip ${t === null ? "k-uppgift" : SLAG_KLASS[p.slag]}`}>
                  {p.start !== null ? hm(p.start) + " " : ""}
                  {t ?? "Upptagen"}
                </span>
              );
            })}
            {list.length > 3 && <span className="more">+{list.length - 3} till</span>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * `renderAgenda()`: sju dagar från vald dag, grupperat per dag med
 * veckonummer. Lördag och söndag utan poster hoppas över (AC 24).
 */
export function Agenda({ lk, synliga }: { lk: Lk; synliga: Post[] }) {
  const router = useRouter();
  const { data, nu } = lk;
  const dagar = [0, 1, 2, 3, 4, 5, 6].map((i) => plus(data.anchor, i));

  return (
    <div className="agenda">
      {dagar.map((d) => {
        const list = synliga.filter((p) => p.dag === d).sort(efterStart);
        if (isWeekend(d) && !list.length) return null;
        return (
          <section key={d} className="agday" aria-label={`${WDL[wd(d)]} ${dd(d)} ${ML[mm(d)]}`}>
            <h3 className={d === nu.dag ? "today" : ""}>
              {d === nu.dag ? "Idag" : WDL[wd(d)]}{" "}
              <span className="mono">
                {dd(d)} {MK[mm(d)]} · v. {weekno(d)}
              </span>
            </h3>
            {!list.length && <p className="agempty">Inget inbokat.</p>}
            {list.map((p) => {
              const t = titel(p, lk);
              const r = mittSvar(p, data.mig);
              const andra = p.deltagare.filter((id) => id !== data.mig).map((id) => lk.personer.get(id)?.fornamn ?? "");
              const sub = [
                t !== null && t !== SLAG_ETIKETT[p.slag] ? SLAG_ETIKETT[p.slag] : "",
                andra.length && t !== null ? "med " + andra.join(", ") : "",
                p.agare !== data.mig ? lk.personer.get(p.agare)?.fornamn ?? "" : "",
                r === "vantar" ? "inte svarat" : r === "kanske" ? "kanske" : r === "nej" ? "avböjt" : "",
                p.klar ? "klar" : "",
              ]
                .filter(Boolean)
                .join(" · ");
              const kl = `agitem${p.klar ? " done" : ""}${lk.q && !lk.traffar(p) ? " dim" : ""}`;
              const innehall = (
                <>
                  <span className="tm">
                    {p.start !== null ? (
                      <>
                        {hm(p.start)}
                        <br />
                        {hm(endOf(p))}
                      </>
                    ) : (
                      "Heldag"
                    )}
                  </span>
                  <span className="agbar" style={{ background: stapelfarg(p) }} />
                  <span>
                    <b>{t ?? "Upptagen"}</b>
                    <span className="sub">{sub}</span>
                  </span>
                </>
              );
              return klickbar(p) ? (
                <button key={p.id} type="button" className={kl} data-e={p.id} onClick={() => oppnaPost(p, lk, router)}>
                  {innehall}
                </button>
              ) : (
                <div key={p.id} className={kl}>
                  {innehall}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
