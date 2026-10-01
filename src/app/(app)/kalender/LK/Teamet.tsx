"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DAGSTAK,
  KVITTO_BARA_ORGANISATOREN,
  SLOT,
  daySum,
  endOf,
  hm,
  isWeekend,
  layout,
  len,
  NIVA_KORT,
  type Post,
} from "@/lib/leveranskalender";
import { flytta } from "../moten/actions";
import { Av, farDra, oppnaPost, titel, type Lk } from "./gemensamt";
import { Postruta } from "./Rutnat";

/** Teamets dag: 08:00–18:00, en halvtimme är 46 px (`renderTeam()`). */
const S0 = 8 * 60;
const S1 = 18 * 60;
const W = 46;
const N = (S1 - S0) / SLOT;

/**
 * `renderTeam()`: Teamet, `Ctrl+Alt+5` (AC 39).
 *
 * =============================================================================
 * EN RAD PER PERSON, OCH RADEN VISAR VAD MIN NIVÅ I HENNES KALENDER SLÄPPER IN
 *
 * Grupperna är Säljteamet och Leverans, som i kalenderlistan. Kapaciteten är
 * dagsumman mot `DAGSTAK` — samma regel som dagrubriken, räknad på personens
 * egen kalender. Innehållet är inte filtrerat här: posterna kommer redan
 * projicerade ur `kalender_handelser()` och `kalender_poster()`, så den jag
 * bara ser som upptagen står med "Upptagen" och ingenting annat.
 *
 * Klick på en tom tid hos en kollega öppnar formuläret med henne som deltagare
 * (en 1:1 om jag är chef och hon säljer). Med en kund vald ur kön bokas
 * välkomstsamtalet hos den personen, om hon är i leveransen.
 * =============================================================================
 */
export function Teamet({ lk }: { lk: Lk }) {
  const router = useRouter();
  const [, startOvergang] = useTransition();
  const { data, nu } = lk;
  const d = data.anchor;
  const jag = lk.personer.get(data.mig);
  const [grp, setGrp] = useState<"salj" | "lev">(jag?.grupp === "lev" ? "lev" : "salj");
  const [slapp, setSlapp] = useState<string | null>(null);

  const rader = data.team.map((id) => lk.personer.get(id)).filter((p) => p && p.grupp === grp);

  function klick(person: string, m: number) {
    const p = lk.personer.get(person);
    if (lk.valjTid) {
      lk.bokaValkomst(lk.valjTid, d, m, p?.lev ? person : undefined);
      return;
    }
    if (isWeekend(d)) {
      lk.visaKvitto("Välj en vardag.");
      return;
    }
    const annan = person !== data.mig ? person : undefined;
    lk.oppnaPanel({
      typ: "ny",
      dag: d,
      start: m,
      nr: Date.now(),
      med: annan,
      enskilt: Boolean(annan && data.arChef && p?.grupp === "salj"),
    });
  }

  function slappt(person: string, m: number, v: string) {
    const p = lk.personer.get(person);
    if (v.startsWith("q:")) {
      lk.bokaValkomst(v.slice(2), d, m, p?.lev ? person : undefined);
      return;
    }
    if (!v.startsWith("e:")) return;
    const post = data.poster.find((x) => x.id === v.slice(2));
    if (!post) return;
    if (!farDra(post, lk) || post.slag === "uppgift") {
      lk.visaKvitto(KVITTO_BARA_ORGANISATOREN);
      return;
    }
    if (isWeekend(d)) {
      lk.visaKvitto("Välj en vardag.");
      return;
    }
    if (post.serie) {
      lk.serieflytt({ eventId: post.ref!, rubrik: titel(post, lk) ?? "", dag: d, start: m });
      return;
    }
    startOvergang(async () => {
      lk.efter(await flytta(post.ref!, d, m), false);
    });
  }

  return (
    <div className="tl">
      <div className="hrow" style={{ gridTemplateColumns: `200px repeat(${N / 2},${W * 2}px)` }}>
        <div style={{ borderLeft: 0, paddingLeft: 12, display: "flex", gap: 4, alignItems: "center" }}>
          <button className={`btn sm${grp === "salj" ? " on" : ""}`} data-grp="salj" type="button" aria-pressed={grp === "salj"} onClick={() => setGrp("salj")}>
            Sälj
          </button>
          <button className={`btn sm${grp === "lev" ? " on" : ""}`} data-grp="lev" type="button" aria-pressed={grp === "lev"} onClick={() => setGrp("lev")}>
            Leverans
          </button>
        </div>
        {Array.from({ length: N / 2 }, (_, i) => (
          <div key={i}>{hm(S0 + i * 60)}</div>
        ))}
      </div>

      {rader.map((p) => {
        if (!p) return null;
        const mina = data.poster.filter((x) => x.agare === p.id && x.dag === d);
        const sum = daySum(mina, d, p.id);
        const led = mina.some((x) => x.slag === "ledig" && x.start === null);
        const upptagna = mina.filter(
          (x): x is Post & { start: number } =>
            x.start !== null && x.slag !== "ledig" && x.slag !== "order" && x.slag !== "frist" && x.svar !== "nej" && endOf(x) > S0 && x.start < S1,
        );
        const du = p.id === data.mig;
        return (
          <div key={p.id} className="prow" style={{ gridTemplateColumns: `200px ${N * W}px` }}>
            <div className="who">
              <span className="nm">
                <Av person={p} />
                {p.namn}
                {du ? " (du)" : ""}
              </span>
              <span className="rl">
                {p.roll || "Medarbetare"} · du ser {du ? "allt" : NIVA_KORT[p.niva]}
              </span>
              <span
                className={`capbar${sum > DAGSTAK ? " over" : ""}`}
                role="meter"
                aria-label={`${p.fornamn}s planerade tid`}
                aria-valuemin={0}
                aria-valuemax={DAGSTAK}
                aria-valuenow={led ? 0 : Math.min(sum, DAGSTAK)}
              >
                <i style={{ width: `${led ? 0 : Math.min(100, (sum / DAGSTAK) * 100)}%` }} />
              </span>
              <span className="captext">{led ? "Ledig hela dagen" : `${len(sum)} av 6 h`}</span>
            </div>
            <div className="lane" style={{ backgroundSize: `${W * 2}px 100%` }}>
              {led && <div className="ledig" />}
              {Array.from({ length: N }, (_, i) => {
                const m = S0 + i * SLOT;
                const nyckel = `${p.id}:${m}`;
                return (
                  <div
                    key={m}
                    className={`hit${slapp === nyckel ? " drop" : ""}`}
                    data-d={d}
                    data-m={m}
                    data-p={p.id}
                    style={{ left: i * W, width: W }}
                    onClick={() => klick(p.id, m)}
                    onDragOver={(ev) => {
                      ev.preventDefault();
                      setSlapp(nyckel);
                    }}
                    onDragLeave={() => setSlapp(null)}
                    onDrop={(ev) => {
                      ev.preventDefault();
                      setSlapp(null);
                      slappt(p.id, m, ev.dataTransfer.getData("text/plain"));
                    }}
                  />
                );
              })}
              {layout(upptagna).map((L) => {
                const e = L.e;
                const l = ((Math.max(e.start, S0) - S0) / SLOT) * W;
                const w = ((Math.min(endOf(e), S1) - Math.max(e.start, S0)) / SLOT) * W - 3;
                const rh = 68 / L.cols;
                return (
                  <Postruta
                    key={e.id}
                    lk={lk}
                    post={e}
                    compact={L.cols > 1 || w < 90}
                    style={{ left: l, width: w, top: 8 + L.col * rh, height: rh - 2 }}
                    onOpen={() => oppnaPost(e, lk, router)}
                  />
                );
              })}
              {d === nu.dag && nu.min >= S0 && nu.min < S1 && (
                <div
                  className="nowline"
                  style={{ top: 0, bottom: 0, height: "auto", width: 2, left: ((nu.min - S0) / SLOT) * W, right: "auto" }}
                />
              )}
            </div>
          </div>
        );
      })}
      {rader.length === 0 && <p className="agempty" style={{ padding: 16 }}>Ingen i {grp === "salj" ? "Säljteamet" : "Leverans"}.</p>}
    </div>
  );
}
