"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import type { Handelsedetalj } from "@/lib/leveranskalender-server";
import {
  KVITTO_INGEN_TID_14,
  KVITTO_INGEN_TID_7,
  MK,
  SVAR_ETIKETT,
  WDK,
  WORK_S,
  autopick,
  dayLabel,
  dd,
  endOf,
  hm,
  isWeekend,
  kvittoFlyttad,
  len,
  mm,
  plus,
  regeltext,
  wd,
  type Post,
  type Upptaget,
} from "@/lib/leveranskalender";
import {
  behallTid,
  flytta,
  foreslaTid,
  godkannForslag,
  hamtaHandelse,
  hamtaUpptaget,
  kopiera,
  stallIn,
  svara,
} from "../moten/actions";
import { planera } from "@/app/(app)/uppgifter/actions";
import { Av, type Lk } from "./gemensamt";
import { Formular } from "./Formular";
import { Enskildinnehall } from "./Enskilt";
import { Kokort, Leveranspanel } from "./Leverans";
import { Assistent, Datumfalt, Krockruta, Stang, Tidsval, useUpptaget, upptagnaI } from "./Tidsdelar";

export type Panellage =
  | { typ: "handelse"; id: string }
  | { typ: "ny"; dag?: string; start?: number; minuter?: number; nr?: number }
  | { typ: "forslag"; detalj: Handelsedetalj }
  | { typ: "uppgift"; post: Post }
  | { typ: "upptagen"; post: Post }
  | { typ: "ko"; orderId: string };

/** `aside.drawer`: `.dhd` och `.dbody`, med innehåll efter läget. */
export function Panel({ lk, lage, stang }: { lk: Lk; lage: Panellage; stang: () => void }) {
  switch (lage.typ) {
    case "ny":
      // Nyckeln gör att ett nytt klick i rutnätet ger ett nytt formulär, inte
      // det förra med gamla värden.
      return <Formular key={lage.nr ?? 0} lk={lk} start={lage} stang={stang} />;
    case "handelse":
      return <Motespanel key={lage.id} lk={lk} id={lage.id} stang={stang} />;
    case "forslag":
      return <Forslag key={lage.detalj.id} lk={lk} e={lage.detalj} stang={stang} />;
    case "uppgift":
      return <Uppgiftspanel lk={lk} post={lage.post} stang={stang} />;
    case "upptagen":
      return <Upptagenpanel lk={lk} post={lage.post} stang={stang} />;
    case "ko":
      return <Kokort key={lage.orderId} lk={lk} orderId={lage.orderId} stang={stang} />;
  }
}

/** `head()`. */
function Huvud({ stang, chip, chipText, rubrik, sub }: { stang: () => void; chip: string; chipText: string; rubrik: string; sub?: string }) {
  return (
    <div className="dhd" id="dhd">
      <Stang stang={stang} />
      <span className={`chip ${chip}`} style={{ alignSelf: "flex-start" }}>
        {chipText}
      </span>
      <h3>{rubrik}</h3>
      {sub && (
        <span className="muted mono" style={{ fontSize: 12 }}>
          {sub}
        </span>
      )}
    </div>
  );
}

const nar = (e: { dag: string; start: number | null; minuter: number | null }) =>
  `${dayLabel(e.dag)} · ${hm(e.start ?? 0)}–${hm(endOf(e))}`;

// -----------------------------------------------------------------------------
// Mötet
// -----------------------------------------------------------------------------

function Motespanel({ lk, id, stang }: { lk: Lk; id: string; stang: () => void }) {
  const [e, setE] = useState<Handelsedetalj | null | "laddar">("laddar");
  const [upptagen, startOvergang] = useTransition();
  const mig = lk.data.mig;

  // Läses om efter varje omritning, så att ett svar eller en flytt syns direkt.
  useEffect(() => {
    let aktuell = true;
    hamtaHandelse(id).then((d) => aktuell && setE(d));
    return () => {
      aktuell = false;
    };
  }, [id, lk.data]);

  useEffect(() => {
    document.getElementById("dClose")?.focus({ preventScroll: true });
  }, []);

  if (e === "laddar") {
    return (
      <>
        <div className="dhd" id="dhd">
          <Stang stang={stang} />
        </div>
        <div className="dbody" id="dbody">
          <p className="muted">Hämtar …</p>
        </div>
      </>
    );
  }
  if (!e || e.installd) {
    return (
      <>
        <div className="dhd" id="dhd">
          <Stang stang={stang} />
          <h3>{e?.installd ? "Inställt" : "Finns inte längre"}</h3>
        </div>
        <div className="dbody" id="dbody">
          <p className="muted">{e?.installd ? "Mötet är inställt." : "Händelsen är borttagen, eller så får du inte längre se den."}</p>
        </div>
      </>
    );
  }

  if (e.slag === "leverans") return <Leveranspanel lk={lk} e={e} stang={stang} />;

  const org = lk.personer.get(e.organisator);
  const gor = (p: Promise<Parameters<Lk["efter"]>[0]>, oppna = true) =>
    startOvergang(async () => {
      lk.efter(await p, oppna);
    });

  async function nastaLediga() {
    if (!e || e === "laddar") return;
    const personer = [e.organisator, ...e.deltagare.map((d) => d.id)];
    const upp = await hamtaUpptaget(personer, e.dag, plus(e.dag, 7));
    const pk = autopick(upp, personer, e.dag, Math.max(endOf(e), WORK_S), e.minuter ?? 30, 7, lk.data.idag, lk.nu.min, e.id);
    if (!pk) {
      lk.visaKvitto(KVITTO_INGEN_TID_7);
      return;
    }
    gor(flytta(e.id, pk.d, pk.s));
  }

  const forslag = e.farAndra ? e.deltagare.filter((d) => d.forslag) : [];
  const mitt = e.deltagare.find((d) => d.id === mig);
  const r = e.mittSvar;
  const enskilt = e.slag === "enskilt";
  const saljare = enskilt ? lk.personer.get(e.deltagare[0]?.id ?? "") : undefined;
  // `whenText()`: tiden, och för en serie regeln.
  const nar2 = nar(e) + (e.serie ? ` · ↻ ${regeltext(e.serie)}` : "");
  const svarRubrik = e.serie ? (e.svarGallerSerien ? " · gäller hela serien" : " · gäller den flyttade tiden") : "";

  return (
    <>
      {enskilt ? (
        <Huvud stang={stang} chip="k-enskilt" chipText="1:1" rubrik={`1:1 ${org?.fornamn ?? ""} och ${saljare?.fornamn ?? ""}`} sub={nar2} />
      ) : (
        <Huvud stang={stang} chip="k-mote" chipText="Möte" rubrik={e.rubrik} sub={nar2} />
      )}
      <div className="dbody" id="dbody" aria-busy={upptagen}>
        {forslag.length > 0 && (
          <div className="dsec">
            <h5>Förslag på ny tid{e.serie ? " · bara den här gången" : ""}</h5>
            {forslag.map((a) => (
              <div key={a.id} className="box" style={{ gap: 6 }}>
                <span>
                  <b style={{ color: "var(--color-ink-900)" }}>{lk.personer.get(a.id)?.fornamn}</b> föreslår{" "}
                  <b style={{ color: "var(--color-ink-900)" }}>
                    {dayLabel(a.forslag!.dag)} {hm(a.forslag!.start)}–{hm(a.forslag!.start + a.forslag!.minuter)}
                  </b>
                </span>
                {a.forslag!.note && <span className="muted">“{a.forslag!.note}”</span>}
                <div className="acts">
                  <button className="btn primary sm" type="button" data-prop-ok={a.id} onClick={() => gor(godkannForslag(e.id, a.id))}>
                    Godkänn ny tid
                  </button>
                  <button className="btn sm" type="button" data-prop-no={a.id} onClick={() => gor(behallTid(e.id, a.id))}>
                    Behåll nuvarande tid
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {r && r !== "org" && (
          <div className="dsec">
            <h5>Ditt svar{svarRubrik}</h5>
            <div className="acts">
              {(["ja", "kanske", "nej"] as const).map((v) => (
                <button
                  key={v}
                  className={`btn${r === v ? " on" : ""}`}
                  type="button"
                  data-rsvp={v}
                  aria-pressed={r === v}
                  onClick={() => gor(svara(e.id, v))}
                >
                  {v === "ja" ? "✓ Ja" : v === "kanske" ? "? Kanske" : "✕ Nej"}
                </button>
              ))}
              <button className="btn ghost" type="button" data-rsvp="ny" onClick={() => lk.oppnaPanel({ typ: "forslag", detalj: e })}>
                {e.serie ? "Föreslå ny tid för den här gången" : "Föreslå ny tid"}
              </button>
            </div>
            {mitt?.forslag && (
              <p className="hint" style={{ marginTop: 6 }}>
                Du har föreslagit {dayLabel(mitt.forslag.dag)} {hm(mitt.forslag.start)}–{hm(mitt.forslag.start + mitt.forslag.minuter)}
                {e.serie ? " för den här gången" : ""}. Väntar på {org?.fornamn}.
              </p>
            )}
          </div>
        )}

        {enskilt && <Enskildinnehall lk={lk} e={e} />}

        <div className="dsec">
          <h5>Deltagare</h5>
          <div className="rsvp">
            <div className="r">
              <Av person={org} />
              {org?.namn}
              <span className="st org">{SVAR_ETIKETT.org}</span>
            </div>
            {e.deltagare.map((a) => {
              const p = lk.personer.get(a.id);
              return (
                <div key={a.id} className="r">
                  <Av person={p} />
                  {p?.namn ?? "Tidigare anställd"}
                  <span className={`st ${a.svar}`}>{SVAR_ETIKETT[a.svar]}</span>
                </div>
              );
            })}
          </div>
          {e.deltagare
            .filter((a) => a.svar === "nej" && a.note)
            .map((a) => (
              <p key={a.id} className="hint" style={{ marginTop: 6 }}>
                {lk.personer.get(a.id)?.fornamn}: “{a.note}”
              </p>
            ))}
        </div>

        {!enskilt && (e.agenda || e.plats) && (
          <div className="dsec">
            <h5>Agenda</h5>
            <div className="box">
              {e.plats && <span className="muted">Plats: {e.plats}</span>}
              {e.agenda && <span style={{ whiteSpace: "pre-wrap" }}>{e.agenda}</span>}
            </div>
          </div>
        )}

        {!enskilt && (
        <div className="dsec">
          <h5>Påminnelse</h5>
          <p style={{ fontSize: "13.5px" }}>
            {e.paminnelse
              ? `Pling ${e.paminnelse} min före till alla som tackat ja. Inbjudan gick ut som notis och mejl.`
              : "Ingen påminnelse. Inbjudan gick ut som notis och mejl."}
          </p>
        </div>
        )}

        {e.farAndra && (
          <div className="dsec">
            <h5>{e.organisator === mig ? "Du är organisatör" : `Du planerar åt ${org?.fornamn ?? "organisatören"}`}</h5>
            <div className="acts">
              <button className="btn" type="button" data-act="flytta" onClick={nastaLediga}>
                Flytta till nästa gemensamma lediga tid
              </button>
              {!e.serie && (
                <button className="btn" type="button" data-act="kopiera" onClick={() => gor(kopiera(e.id))}>
                  Kopiera till nästa vecka
                </button>
              )}
              <button
                className="btn danger"
                type="button"
                data-act="stall"
                onClick={() =>
                  startOvergang(async () => {
                    const svar = await stallIn(e.id);
                    if (lk.efter(svar, false)) stang();
                  })
                }
              >
                Ställ in{e.serie ? " den här gången" : ""}
              </button>
            </div>
            {e.serie && (
              <p className="hint" style={{ marginTop: 6 }}>
                Dra förekomsten i kalendern för att flytta bara den här gången, eller hela serien.
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// -----------------------------------------------------------------------------
// Föreslå ny tid (`renderProposal()`)
// -----------------------------------------------------------------------------

function Forslag({ lk, e, stang }: { lk: Lk; e: Handelsedetalj; stang: () => void }) {
  const [dag, setDag] = useState(e.dag);
  const [start, setStart] = useState(e.start ?? 9 * 60);
  const [minuter, setMinuter] = useState(e.minuter ?? 30);
  const [svar, setSvar] = useState<"kanske" | "nej">("kanske");
  const [note, setNote] = useState("");
  const [krock, setKrock] = useState<string[] | null>(null);
  const [vantar, startOvergang] = useTransition();
  const personer = [lk.data.mig, e.organisator, ...e.deltagare.map((d) => d.id).filter((id) => id !== lk.data.mig)];
  const unika = [...new Set(personer)];
  const upp = useUpptaget(unika, dag);
  const org = lk.personer.get(e.organisator);

  // Förvalt: första tiden efter mötet då alla är lediga, inom sju dagar.
  const forvalt = useRef(false);
  useEffect(() => {
    if (forvalt.current) return;
    forvalt.current = true;
    hamtaUpptaget(unika, e.dag, plus(e.dag, 7)).then((u) => {
      const pk = autopick(u, unika, e.dag, endOf(e), e.minuter ?? 30, 7, lk.data.idag, lk.nu.min, e.id);
      if (pk) {
        setDag(pk.d);
        setStart(pk.s);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function foreslaGemensam() {
    const fran = isWeekend(dag) ? lk.data.hem : dag;
    const u = await hamtaUpptaget(unika, fran, plus(fran, 14));
    const pk = autopick(u, unika, fran, WORK_S, minuter, 10, lk.data.idag, lk.nu.min, e.id);
    if (!pk) {
      lk.visaKvitto(KVITTO_INGEN_TID_14);
      return;
    }
    setDag(pk.d);
    setStart(pk.s);
    setKrock(null);
    lk.visaKvitto(`Första gemensamma lediga tid: ${dayLabel(pk.d)} ${hm(pk.s)}.`);
  }

  function skicka(tvinga: boolean) {
    const upptagna = upptagnaI(upp.data, unika, dag, start, minuter, e.id);
    if (!tvinga && upptagna.length) {
      setKrock(upptagna);
      return;
    }
    startOvergang(async () => {
      const r = await foreslaTid(e.id, dag, start, minuter, note, svar);
      if (lk.efter(r, false)) lk.oppnaPanel({ typ: "handelse", id: e.id });
    });
  }

  return (
    <>
      <div className="dhd" id="dhd">
        <Stang stang={stang} />
        <span className="eyebrow">Föreslå ny tid</span>
        <h3>{e.rubrik}</h3>
        <span className="muted mono" style={{ fontSize: 12 }}>
          Nu: {nar(e)} · organisatör {org?.namn}
        </span>
      </div>
      <div className="dbody" id="dbody">
        <form
          id="fForm"
          style={{ display: "flex", flexDirection: "column", gap: 14 }}
          noValidate
          onSubmit={(ev) => {
            ev.preventDefault();
            skicka(false);
          }}
        >
          <p style={{ fontSize: 14 }}>Välj den tid du vill föreslå. Nav har förvalt första tiden då alla deltagare är lediga.</p>
          <Datumfalt dag={dag} setDag={setDag} lk={lk} />
          <Tidsval start={start} minuter={minuter} setStart={setStart} setMinuter={setMinuter} />
          <Assistent
            lk={lk}
            personer={unika}
            dag={dag}
            start={start}
            minuter={minuter}
            skip={e.id}
            upp={upp.data}
            setStart={setStart}
            foresla={foreslaGemensam}
          />
          {e.serie ? (
            <p className="hint">Förslaget gäller bara {dayLabel(e.dag)}. Resten av serien ligger kvar som den är.</p>
          ) : (
            <div className="grid2">
              <label className="field" htmlFor="fSvar">
                Ditt svar tills vidare
                <select id="fSvar" value={svar} onChange={(ev) => setSvar(ev.target.value as "kanske" | "nej")}>
                  <option value="kanske">Kanske</option>
                  <option value="nej">Nej, inte den tiden</option>
                </select>
              </label>
            </div>
          )}
          <label className="field" htmlFor="fNote">
            Meddelande till {org?.fornamn} (valfritt)
            <textarea
              id="fNote"
              maxLength={300}
              placeholder="Till exempel: Jag har ett kundsamtal då, går det en timme senare?"
              value={note}
              onChange={(ev) => setNote(ev.target.value)}
            />
          </label>
          <Krockruta
            lk={lk}
            krock={krock}
            dag={dag}
            start={start}
            minuter={minuter}
            tvinga={() => skicka(true)}
            hitta={foreslaGemensam}
          />
          <div className="acts">
            <button className="btn primary" type="submit" disabled={vantar}>
              Skicka förslag: {WDK[wd(dag)]} {dd(dag)} {MK[mm(dag)]} {hm(start)}–{hm(start + minuter)}
            </button>
            <button className="btn ghost" type="button" id="fCancel" onClick={() => lk.oppnaPanel({ typ: "handelse", id: e.id })}>
              Avbryt
            </button>
          </div>
          <p className="hint">
            {org?.fornamn} får förslaget i klockan och via mejl och kan godkänna det med ett klick. Mötet ligger kvar på nuvarande tid tills dess.
          </p>
        </form>
      </div>
    </>
  );
}

// -----------------------------------------------------------------------------
// Uppgift och upptagen
// -----------------------------------------------------------------------------

function Uppgiftspanel({ lk, post, stang }: { lk: Lk; post: Post; stang: () => void }) {
  const [, startOvergang] = useTransition();
  const egen = post.agare === lk.data.mig;
  const agare = lk.personer.get(post.agare);

  async function nastaLediga() {
    const upp: Upptaget = await hamtaUpptaget([lk.data.mig], post.dag, plus(post.dag, 5));
    const pk = autopick(
      upp,
      [lk.data.mig],
      post.dag,
      Math.max(endOf(post), WORK_S),
      post.minuter ?? 30,
      5,
      lk.data.idag,
      lk.nu.min,
      post.ref,
    );
    if (!pk) {
      lk.visaKvitto("Ingen ledig tid de närmaste fem dagarna.");
      return;
    }
    startOvergang(async () => {
      const f = new FormData();
      f.set("id", post.ref!);
      f.set("due_date", pk.d);
      f.set("due_time", hm(pk.s));
      if (post.minuter) f.set("estimate_minutes", String(post.minuter));
      const r = await planera({}, f);
      if (lk.efter(r.fel ? { fel: r.fel } : { ok: true, kvitto: kvittoFlyttad(pk.d, pk.s, []), dag: pk.d }, false)) stang();
    });
  }

  return (
    <>
      <Huvud
        stang={stang}
        chip="k-uppgift"
        chipText="Uppgift"
        rubrik={post.rubrik ?? "Uppgift"}
        sub={post.start !== null ? nar(post) : dayLabel(post.dag)}
      />
      <div className="dbody" id="dbody">
        <p className="muted" style={{ fontSize: 14 }}>
          Uppgiften bor i uppgiftsmodulen och ritas här med sitt klockslag.
        </p>
        <div className="acts">
          {post.href && (
            <Link className="btn primary" href={post.href}>
              Öppna uppgiften
            </Link>
          )}
          {egen && post.start !== null && !post.klar && (
            <button className="btn" type="button" data-act="flytta" onClick={nastaLediga}>
              Flytta till nästa lediga tid
            </button>
          )}
        </div>
        {!egen && <p className="hint">{agare?.fornamn} har delat detaljer med dig.</p>}
        {post.minuter ? <p className="hint">Uppskattad tid: {len(post.minuter)}.</p> : null}
      </div>
    </>
  );
}

function Upptagenpanel({ lk, post, stang }: { lk: Lk; post: Post; stang: () => void }) {
  const agare = lk.personer.get(post.agare);
  return (
    <>
      <Huvud
        stang={stang}
        chip="k-uppgift"
        chipText="Upptagen"
        rubrik="Upptagen"
        sub={post.start !== null ? nar(post) : dayLabel(post.dag)}
      />
      <div className="dbody" id="dbody">
        <p className="muted">
          {agare?.fornamn ?? "Personen"} har inte delat mer än ledig/upptagen med dig. Det är grundläget i Nav och kan inte stängas av, bara utökas av den som
          äger kalendern.
        </p>
      </div>
    </>
  );
}
