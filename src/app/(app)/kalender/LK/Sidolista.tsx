"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ML,
  NIVA_KORT,
  WDK,
  dagarForVy,
  dd,
  hm,
  mm,
  monday,
  plus,
  wd,
  type Post,
} from "@/lib/leveranskalender";
import { Av, oppnaPost, titel, type Lk } from "./gemensamt";

const GRUPP_RUBRIK = { salj: "Säljteamet", lev: "Leverans", ovr: "Övriga" } as const;

/**
 * `aside.rail`: ny händelse, sök, minikalender, kalendrar och förklaring.
 * Leveranskön kommer i pass 3.
 */
export function Sidolista({
  lk,
  q,
  setQ,
  mmManad,
  setMmManad,
  visaAvbojda,
  setVisaAvbojda,
  synliga,
}: {
  lk: Lk;
  q: string;
  setQ: (v: string) => void;
  mmManad: string;
  setMmManad: (v: string) => void;
  visaAvbojda: boolean;
  setVisaAvbojda: (v: boolean) => void;
  synliga: Post[];
}) {
  const router = useRouter();
  const { data } = lk;

  // Sökträffar: mina bokningar med klockslag i det som är hämtat (AC 23).
  const traffar = lk.q
    ? synliga
        .filter((p) => p.start !== null && p.slag !== "order" && p.agare === data.mig && lk.traffar(p))
        .sort((a, b) => (a.dag < b.dag ? -1 : a.dag > b.dag ? 1 : (a.start ?? 0) - (b.start ?? 0)))
        .slice(0, 6)
    : [];

  const [y, m] = mmManad.split("-").map(Number);
  const start = monday(`${mmManad}-01`);
  const iVyn = new Set(data.vy === "manad" ? [] : dagarForVy(data.vy, data.anchor));
  const mina = synliga.filter((p) => p.agare === data.mig && p.slag !== "order" && p.slag !== "ledig");

  const grupper = (["salj", "lev", "ovr"] as const)
    .map((g) => ({ g, personer: data.personer.filter((p) => p.grupp === g) }))
    .filter((x) => x.personer.length > 0);

  const vaxlaKalender = (id: string, pa: boolean) => {
    const visa = pa ? [...data.visa, id] : data.visa.filter((x) => x !== id);
    lk.ga({ visa });
  };

  const stegManad = (dir: 1 | -1) => {
    const d = new Date(Date.UTC(y, m - 1 + dir, 1));
    setMmManad(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  };

  return (
    <aside className="rail" aria-label="Kalenderlista">
      <button className="btn primary newbtn" id="bNew" type="button" onClick={() => lk.nyHandelse()}>
        + Ny händelse <kbd>N</kbd>
      </button>

      <div className="search" role="search">
        <label className="sr" htmlFor="q">
          Sök i kalendern
        </label>
        <input
          type="search"
          id="q"
          placeholder="Sök person, kund eller rubrik"
          autoComplete="off"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="qhits" id="qhits" aria-live="polite">
          {lk.q &&
            (traffar.length ? (
              traffar.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    if (p.dag !== data.anchor && !iVyn.has(p.dag)) lk.ga({ dag: p.dag });
                    oppnaPost(p, lk, router);
                  }}
                >
                  <span className="mono">
                    {WDK[wd(p.dag)]} {dd(p.dag)}/{mm(p.dag)} {hm(p.start ?? 0)}
                  </span>
                  <span>{titel(p, lk) ?? "Upptagen"}</span>
                </button>
              ))
            ) : (
              <span className="hint">Inget i den här perioden.</span>
            ))}
        </div>
      </div>

      <div>
        <div className="mmhead">
          <span id="mmTitle">
            {ML[m]} {y}
          </span>
          <span>
            <button className="btn icon ghost sm" id="mmPrev" type="button" aria-label="Föregående månad" onClick={() => stegManad(-1)}>
              ‹
            </button>
            <button className="btn icon ghost sm" id="mmNext" type="button" aria-label="Nästa månad" onClick={() => stegManad(1)}>
              ›
            </button>
          </span>
        </div>
        <div className="mm" id="mm">
          {["M", "T", "O", "T", "F", "L", "S"].map((x, i) => (
            <span key={i} className="wd" aria-hidden="true">
              {x}
            </span>
          ))}
          {Array.from({ length: 42 }, (_, i) => {
            const d = plus(start, i);
            const antal = mina.filter((p) => p.dag === d).length;
            const lev = mina.some((p) => p.dag === d && p.slag === "leverans");
            const kl = [
              mm(d) !== m ? "out" : "",
              d === data.idag ? "today" : "",
              iVyn.has(d) ? "inr" : "",
              antal ? "has" : "",
              lev ? "lev" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={d}
                type="button"
                className={kl}
                data-d={d}
                aria-label={`${dd(d)} ${ML[mm(d)]}${antal ? `, ${antal} ${antal === 1 ? "händelse" : "händelser"}` : ""}`}
                onClick={() => lk.ga({ dag: d, ...(data.vy === "manad" ? { vy: "dag" as const } : {}) })}
              >
                {dd(d)}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h4>
          Kalendrar{" "}
          <span className="hint" style={{ textTransform: "none", letterSpacing: 0 }}>
            du ser
          </span>
        </h4>
        <div className="cals" id="cals">
          {grupper.map(({ g, personer }) => (
            <div key={g}>
              <div className="grp">{GRUPP_RUBRIK[g]}</div>
              {personer.map((p) => {
                const jag = p.id === data.mig;
                return (
                  <label key={p.id} htmlFor={`cal-${p.id}`}>
                    <input
                      type="checkbox"
                      id={`cal-${p.id}`}
                      checked={jag || data.visa.includes(p.id)}
                      disabled={jag}
                      onChange={(e) => vaxlaKalender(p.id, e.target.checked)}
                    />
                    <Av person={p} />
                    {p.namn}
                    {jag ? " (du)" : ""}
                    <span className="lvl">{jag ? "" : NIVA_KORT[p.niva]}</span>
                  </label>
                );
              })}
            </div>
          ))}
          <label className="decl" htmlFor="showDec">
            <input type="checkbox" id="showDec" checked={visaAvbojda} onChange={(e) => setVisaAvbojda(e.target.checked)} />
            Visa möten jag avböjt
          </label>
        </div>
        <div className="acts" style={{ marginTop: 10 }}>
          <Link className="btn sm" href={`/kalender?vy=planera&dag=${data.anchor}`}>
            Planeringsvyn
          </Link>
          <Link className="btn sm ghost" href="/kalender/delning">
            Delning
          </Link>
        </div>
      </div>

      <div>
        <h4>Typer och lägen</h4>
        <div className="legend" id="legend">
          <span className="chip k-mote">Möte</span>
          <span className="chip k-enskilt">1:1</span>
          <span className="chip k-uppgift">Uppgift</span>
          <span className="chip k-lev">Leverans</span>
          <span className="sep" />
          <span className="chip k-mote pending">Inte svarat</span>
          <span className="chip k-mote maybe">Kanske</span>
          <span className="chip k-lev done">Klar</span>
          <span className="chip busyonly">Upptagen</span>
          {visaAvbojda && <span className="chip k-mote declined">Avböjt</span>}
        </div>
      </div>
    </aside>
  );
}
