"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Lkdata } from "@/lib/leveranskalender-server";
import {
  DAGSTAK,
  KVITTO_ANGRAT,
  KVITTO_MS,
  LK_FEL,
  VY_ETIKETT,
  VY_TANGENT,
  daySum,
  dayLabel,
  hm,
  len,
  mm,
  periodtext,
  plus,
  steg,
  type Post,
  type Vy,
} from "@/lib/leveranskalender";
import { angra } from "@/app/(app)/angra/actions";
import { angringsLage, flytta, flyttaSerie, type Resultat } from "../moten/actions";
import { Sidolista } from "./Sidolista";
import { Rutnat } from "./Rutnat";
import { Agenda, Manad } from "./Vyer";
import { Panel, type Panellage } from "./Panel";
import { useNu, type Lk } from "./gemensamt";

/**
 * Leveranskalendern, pass 1. Portad ur `docs/leveranskalender/prototyp.html`,
 * elementet `#proto`, med samma element och klasser i samma ordning.
 *
 * =============================================================================
 * VY OCH DAG STÅR I ADRESSEN, ALLT ANNAT I KOMPONENTEN
 *
 * `?vy=`, `?dag=` och `?visa=` avgör vad servern hämtar, och de överlever en
 * omladdning (AC 1). Sökningen, den öppna panelen och kvittot är tillstånd som
 * bara gäller just nu och ligger här.
 *
 * VARJE ÄNDRING GÅR TILL SERVERN OCH KOMMER TILLBAKA SOM EN OMRITNING. Ingen
 * post flyttas i klienten innan servern sagt ja — ett rutnät som visar en flytt
 * som sedan nekas är ett rutnät man inte kan lita på.
 * =============================================================================
 */
export function Leveranskalender({
  data,
  vyIAdressen,
  oppna,
}: {
  data: Lkdata;
  /** Stod `?vy=` i adressen? Annars väljer klienten Agenda på smal skärm (AC 25). */
  vyIAdressen: boolean;
  /** `?handelse=` från en notis: öppna panelen direkt. */
  oppna: string | null;
}) {
  const router = useRouter();
  const [, startOvergang] = useTransition();
  const nu = useNu();

  const [q, setQ] = useState("");
  const [visaAvbojda, setVisaAvbojda] = useState(false);
  const [vald, setVald] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panellage | null>(oppna ? { typ: "handelse", id: oppna } : null);
  const [kvitto, setKvitto] = useState<{ text: string; angra?: string; nr: number } | null>(null);
  const [mmManad, setMmManad] = useState(data.anchor.slice(0, 7));
  const [smove, setSmove] = useState<{ eventId: string; rubrik: string; dag: string; start: number } | null>(null);
  const smOne = useRef<HTMLButtonElement>(null);
  const senastFokus = useRef<HTMLElement | null>(null);
  const protoRef = useRef<HTMLDivElement>(null);

  const personer = useMemo(() => new Map(data.personer.map((p) => [p.id, p])), [data.personer]);

  // ---------------------------------------------------------------------------
  // Adressen
  // ---------------------------------------------------------------------------

  const ga = useCallback(
    (andring: { vy?: Vy; dag?: string; visa?: string[] }) => {
      const vy = andring.vy ?? data.vy;
      const dag = andring.dag ?? data.anchor;
      const visa = andring.visa ?? data.visa;
      const p = new URLSearchParams({ vy, dag });
      if (visa.length) p.set("visa", visa.join(","));
      startOvergang(() => router.push(`/kalender?${p.toString()}`, { scroll: false }));
    },
    [data.vy, data.anchor, data.visa, router],
  );

  // Smal skärm utan vy i adressen: Agenda. Bestäms här, eftersom servern inte
  // vet hur bred skärmen är.
  useEffect(() => {
    if (!vyIAdressen && window.matchMedia("(max-width:700px)").matches) ga({ vy: "agenda" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setMmManad(data.anchor.slice(0, 7));
  }, [data.anchor]);

  // ---------------------------------------------------------------------------
  // Kvittot
  // ---------------------------------------------------------------------------

  const visaKvitto = useCallback((text: string, angraId?: string) => {
    setKvitto({ text, angra: angraId, nr: Date.now() });
  }, []);

  useEffect(() => {
    if (!kvitto) return;
    const t = setTimeout(() => setKvitto(null), kvitto.angra ? KVITTO_MS : 3400);
    return () => clearTimeout(t);
  }, [kvitto]);

  /** Efter varje handling: kvittot, omritning, och dagen där posten nu står. */
  const efter = useCallback(
    (r: Resultat, oppnaEfter = true) => {
      if (r.fel) {
        visaKvitto(r.fel);
        return false;
      }
      if (r.kvitto) visaKvitto(r.kvitto, r.angra);
      if (r.eventId) setVald(r.eventId);
      if (oppnaEfter && r.eventId) setPanel({ typ: "handelse", id: r.eventId });
      if (r.dag && !dagarIVyn(data.vy, data.anchor).includes(r.dag)) ga({ dag: r.dag });
      else startOvergang(() => router.refresh());
      return true;
    },
    [data.vy, data.anchor, ga, router, visaKvitto],
  );

  async function angraSenaste() {
    const id = kvitto?.angra;
    if (!id) return;
    setKvitto(null);
    const f = new FormData();
    f.set("handling", "kalender.handelse");
    f.set("id", id);
    await angra(f);
    const lage = await angringsLage(id);
    setPanel(null);
    visaKvitto(lage === "angrad" ? KVITTO_ANGRAT : LK_FEL.for_sent);
    startOvergang(() => router.refresh());
  }

  // ---------------------------------------------------------------------------
  // Panelen
  // ---------------------------------------------------------------------------

  const oppnaPanel = useCallback((lage: Panellage) => {
    if (document.activeElement instanceof HTMLElement) senastFokus.current = document.activeElement;
    setPanel(lage);
  }, []);

  const stangPanel = useCallback(() => {
    setPanel(null);
    setVald(null);
    const f = senastFokus.current;
    if (f && document.body.contains(f)) f.focus({ preventScroll: true });
  }, []);

  const nyHandelse = useCallback(
    (dag?: string, start?: number, minuter?: number) => oppnaPanel({ typ: "ny", dag, start, minuter, nr: Date.now() }),
    [oppnaPanel],
  );

  // ---------------------------------------------------------------------------
  // Tangentbordet. `event.code` och inte `event.key`: på svenskt tangentbord i
  // Windows är Ctrl+Alt samma sak som AltGr, och då ger 2–5 `@ £ $ €`.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    function vidTangent(ev: KeyboardEvent) {
      const tag = (document.activeElement as HTMLElement | null)?.tagName ?? "";
      const skriver = /INPUT|TEXTAREA|SELECT/.test(tag);
      if (ev.key === "Escape") {
        if (smove) {
          setSmove(null);
          return;
        }
        if (panel) stangPanel();
        return;
      }
      if (ev.ctrlKey && ev.altKey) {
        const vy = VY_TANGENT[ev.code];
        if (vy) {
          ev.preventDefault();
          ga({ vy });
        }
        if (ev.code === "ArrowRight") {
          ev.preventDefault();
          ga({ dag: steg(data.vy, data.anchor, 1) });
        }
        if (ev.code === "ArrowLeft") {
          ev.preventDefault();
          ga({ dag: steg(data.vy, data.anchor, -1) });
        }
        return;
      }
      if (!skriver && !ev.metaKey && !ev.ctrlKey && !ev.altKey && ev.code === "KeyN") {
        const r = protoRef.current?.getBoundingClientRect();
        if (r && r.bottom > 0 && r.top < window.innerHeight) {
          ev.preventDefault();
          nyHandelse();
        }
      }
    }
    document.addEventListener("keydown", vidTangent);
    return () => document.removeEventListener("keydown", vidTangent);
  }, [panel, smove, stangPanel, ga, data.vy, data.anchor, nyHandelse]);

  useEffect(() => {
    if (smove) smOne.current?.focus();
  }, [smove]);

  /** Seriebannern (`renderSel()`): bara den här gången, hela serien, eller avbryt. */
  function flyttaForekomst(hela: boolean) {
    const f = smove;
    setSmove(null);
    if (!f) return;
    startOvergang(async () => {
      efter(hela ? await flyttaSerie(f.eventId, f.dag, f.start) : await flytta(f.eventId, f.dag, f.start), false);
    });
  }

  // ---------------------------------------------------------------------------
  // Vad som visas
  // ---------------------------------------------------------------------------

  const visade = useMemo(() => [data.mig, ...data.visa], [data.mig, data.visa]);

  /** `visibleOn()`: posterna i de valda kalendrarna, avböjda bara på begäran. */
  const synliga = useMemo(
    () =>
      data.poster.filter((p) => {
        if (!visade.includes(p.agare)) return false;
        if (p.agare === data.mig && p.svar === "nej") return visaAvbojda;
        return true;
      }),
    [data.poster, visade, data.mig, visaAvbojda],
  );

  const qn = q.trim().toLowerCase();
  const traffar = useCallback(
    (p: Post) => {
      if (!qn) return true;
      const t = [
        p.rubrik ?? "",
        ...p.deltagare.map((id) => personer.get(id)?.namn ?? ""),
        personer.get(p.agare)?.namn ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return t.includes(qn);
    },
    [qn, personer],
  );

  const lk: Lk = {
    data,
    personer,
    nu,
    q: qn,
    traffar,
    vald,
    setVald,
    oppnaPanel,
    nyHandelse,
    efter,
    visaKvitto,
    ga,
    serieflytt: setSmove,
  };

  const period = periodtext(data.vy, data.anchor);
  const hemSum = daySum(data.hemPoster, data.hem, data.mig);
  const hemMoten = data.hemPoster.filter((p) => p.start !== null && (p.slag === "mote" || p.slag === "enskilt") && p.svar !== "nej").length;
  const hemUppgifter = data.hemPoster.filter((p) => p.slag === "uppgift" && p.start !== null && !p.klar).length;

  return (
    <div className="lk proto" id="proto" ref={protoRef}>
      <div className="bar">
        <button className="btn" id="bToday" type="button" onClick={() => ga({ dag: data.hem })}>
          Idag
        </button>
        <button className="btn icon ghost" id="bPrev" type="button" aria-label="Föregående period" onClick={() => ga({ dag: steg(data.vy, data.anchor, -1) })}>
          ‹
        </button>
        <button className="btn icon ghost" id="bNext" type="button" aria-label="Nästa period" onClick={() => ga({ dag: steg(data.vy, data.anchor, 1) })}>
          ›
        </button>
        <span className="range" id="range" aria-live="polite">
          {period.text}
          {period.liten && <small>{period.liten}</small>}
        </span>
        <span className="spacer" />
        <div className="seg" role="group" aria-label="Vy">
          {(["dag", "arbetsvecka", "vecka", "manad", "agenda"] as const).map((v, i) => (
            <button
              key={v}
              type="button"
              data-v={v}
              title={`Ctrl+Alt+${v === "agenda" ? 6 : i + 1}`}
              aria-pressed={data.vy === v}
              onClick={() => ga({ vy: v })}
            >
              {VY_ETIKETT[v]}
              <kbd>{v === "agenda" ? 6 : i + 1}</kbd>
            </button>
          ))}
        </div>
        <button className="btn primary icon mnew" id="bNew2" type="button" aria-label="Ny händelse" onClick={() => nyHandelse()}>
          +
        </button>
      </div>

      <div className="body">
        <Sidolista
          lk={lk}
          q={q}
          setQ={setQ}
          mmManad={mmManad}
          setMmManad={setMmManad}
          visaAvbojda={visaAvbojda}
          setVisaAvbojda={setVisaAvbojda}
          synliga={synliga}
        />

        <div className="main">
          <div className="strip" id="strip">
            <span>
              <b>{hemMoten}</b>möten {data.hem === data.idag ? "idag" : dayLabel(data.hem)}
            </span>
            <span>
              <b>{hemUppgifter}</b>uppgifter
            </span>
            <span className={hemSum > DAGSTAK ? "over" : ""}>
              <b>{len(hemSum)}</b>av 6 h planerat
            </span>
            {data.vantar > 0 && (
              <span className="att">
                <b>{data.vantar}</b>
                {data.vantar === 1 ? "inbjudan väntar" : "inbjudningar väntar"} på ditt svar
              </span>
            )}
          </div>
          <div className={`selbanner${smove ? " on" : ""}`} id="selbanner">
            {smove && (
              <>
                <span>
                  Flytta <b>{smove.rubrik}</b> till {dayLabel(smove.dag)} {hm(smove.start)}:
                </span>
                <span className="acts">
                  <button ref={smOne} className="btn sm primary" id="smOne" type="button" onClick={() => flyttaForekomst(false)}>
                    Bara den här gången
                  </button>
                  <button className="btn sm" id="smAll" type="button" onClick={() => flyttaForekomst(true)}>
                    Hela serien
                  </button>
                  <button className="btn sm ghost" id="smNo" type="button" onClick={() => setSmove(null)}>
                    Avbryt
                  </button>
                </span>
              </>
            )}
          </div>
          <Scen lk={lk} synliga={synliga} />
        </div>

        <aside className={`drawer${panel ? " open" : ""}`} id="drawer" aria-label="Detaljer">
          {panel && <Panel lk={lk} lage={panel} stang={stangPanel} />}
        </aside>
      </div>

      <div className={`toast${kvitto ? " on" : ""}${kvitto?.angra ? " act" : ""}`} id="toast" role="status" aria-live="polite">
        {kvitto && (
          <>
            <span>{kvitto.text}</span>
            {kvitto.angra && (
              <button type="button" id="tUndo" onClick={angraSenaste}>
                Ångra
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function dagarIVyn(vy: Vy, anchor: string): string[] {
  if (vy === "manad") {
    const ut: string[] = [];
    for (let d = `${anchor.slice(0, 7)}-01`; mm(d) === mm(anchor); d = plus(d, 1)) ut.push(d);
    return ut;
  }
  if (vy === "agenda") return [0, 1, 2, 3, 4, 5, 6].map((i) => plus(anchor, i));
  const m = plus(anchor, 1 - (((new Date(`${anchor}T12:00:00Z`).getUTCDay() + 6) % 7) + 1));
  return [0, 1, 2, 3, 4, 5, 6].map((i) => plus(m, i));
}

/** `renderStage()`: rutnät, månad eller agenda. Skrollar till 08:00 första gången. */
function Scen({ lk, synliga }: { lk: Lk; synliga: Post[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const skrollad = useRef<string | null>(null);
  const vy = lk.data.vy;

  useEffect(() => {
    const st = ref.current;
    if (!st) return;
    if (vy === "agenda") {
      st.scrollTop = 0;
      return;
    }
    if (vy !== "manad" && skrollad.current !== vy) {
      st.scrollTop = ((8 * 60 - 6 * 60) / 30) * 26 - 6;
      skrollad.current = vy;
    }
  }, [vy]);

  return (
    <div className="stage" id="stage" ref={ref}>
      {vy === "manad" ? (
        <Manad lk={lk} synliga={synliga} />
      ) : vy === "agenda" ? (
        <Agenda lk={lk} synliga={synliga} />
      ) : (
        <Rutnat lk={lk} synliga={synliga} />
      )}
    </div>
  );
}
