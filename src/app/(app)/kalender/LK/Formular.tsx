"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { KVITTO_INGEN_TID_14, WORK_S, autopick, dayLabel, hm, isWeekend, plus } from "@/lib/leveranskalender";
import { hamtaUpptaget, skapaMote } from "../moten/actions";
import { skapaUppgift } from "@/app/(app)/uppgifter/actions";
import { Av, type Lk } from "./gemensamt";
import { Assistent, Datumfalt, Krockruta, Stang, Tidsval, upptagnaI, useUpptaget } from "./Tidsdelar";

type Typ = "mote" | "uppgift";

/**
 * `renderForm()`: Ny händelse.
 *
 * Pass 1 har två flikar, Möte och Uppgift. 1:1 kommer i pass 2 och
 * leveransens förinställningar i pass 3; flikarna ritas när de går att spara.
 *
 * UPPGIFTEN SKAPAS I UPPGIFTSMODULEN, genom dess egen `skapaUppgift`. Den får
 * en ansvarig (beställarens beslut 2026-09-30: man ska kunna lägga upp
 * uppgifter åt andra) — det fältet saknas i prototypen och är ett avsteg, se
 * DECISIONS.md D-K2. Den som får uppgiften ser den som "ny" i sin klocka,
 * precis som när den läggs upp på /uppgifter.
 */
export function Formular({
  lk,
  start: forval,
  stang,
}: {
  lk: Lk;
  start: { dag?: string; start?: number; minuter?: number };
  stang: () => void;
}) {
  const mig = lk.data.mig;
  const [typ, setTyp] = useState<Typ>("mote");
  const [rubrik, setRubrik] = useState("");
  const [deltagare, setDeltagare] = useState<string[]>([]);
  const [ansvarig, setAnsvarig] = useState(mig);
  const [dag, setDag] = useState(forval.dag ?? lk.data.hem);
  const [start, setStart] = useState(forval.start ?? 9 * 60);
  const [minuter, setMinuter] = useState(forval.minuter ?? 30);
  const [paminnelse, setPaminnelse] = useState(10);
  const [visaSom, setVisaSom] = useState("upptagen");
  const [plats, setPlats] = useState("Kontoret");
  const [agenda, setAgenda] = useState("");
  const [krock, setKrock] = useState<string[] | null>(null);
  const [vantar, startOvergang] = useTransition();
  const rubrikRef = useRef<HTMLInputElement>(null);

  const personer = typ === "uppgift" ? [ansvarig] : [mig, ...deltagare];
  const upp = useUpptaget(personer, dag);

  // Utan vald tid: första lediga tiden för alla (AC 6). "+" i dagrubriken
  // söker bara den dagen; knappen och tangenten N fem dagar framåt.
  const forvalt = useRef(false);
  useEffect(() => {
    if (forvalt.current || forval.start !== undefined) return;
    forvalt.current = true;
    const fran = forval.dag ?? lk.data.hem;
    hamtaUpptaget([mig], fran, plus(fran, 5)).then((u) => {
      const pk = autopick(u, [mig], fran, WORK_S, 30, forval.dag ? 0 : 5, lk.data.idag, lk.nu.min);
      if (pk) {
        setDag(pk.d);
        setStart(pk.s);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    rubrikRef.current?.focus({ preventScroll: true });
  }, [typ]);

  async function foreslaGemensam() {
    const fran = isWeekend(dag) ? lk.data.hem : dag;
    const u = await hamtaUpptaget(personer, fran, plus(fran, 14));
    const pk = autopick(u, personer, fran, WORK_S, minuter, 10, lk.data.idag, lk.nu.min);
    if (!pk) {
      lk.visaKvitto(KVITTO_INGEN_TID_14);
      return;
    }
    setDag(pk.d);
    setStart(pk.s);
    setKrock(null);
    lk.visaKvitto(`Första gemensamma lediga tid: ${dayLabel(pk.d)} ${hm(pk.s)}.`);
  }

  function spara(tvinga: boolean) {
    if (!rubrik.trim()) {
      lk.visaKvitto("Skriv en rubrik först.");
      rubrikRef.current?.focus();
      return;
    }
    if (typ === "mote") {
      const upptagna = upptagnaI(upp.data, personer, dag, start, minuter, null);
      if (!tvinga && upptagna.length) {
        setKrock(upptagna);
        return;
      }
      startOvergang(async () => {
        lk.efter(
          await skapaMote({ rubrik, dag, start, minuter, deltagare, plats, agenda, paminnelse, visaSom }),
        );
      });
      return;
    }

    startOvergang(async () => {
      const f = new FormData();
      f.set("title", rubrik.trim());
      f.set("due_date", dag);
      f.set("due_time", hm(start));
      f.set("estimate_minutes", String(minuter));
      f.set("priority", "3");
      if (ansvarig !== mig) f.set("assignee_id", ansvarig);
      const r = await skapaUppgift({}, f);
      const namn = lk.personer.get(ansvarig)?.fornamn;
      const ok = lk.efter(
        r.fel
          ? { fel: r.fel }
          : {
              ok: true,
              kvitto: ansvarig === mig ? "Uppgiften är sparad i uppgiftsmodulen." : `Uppgiften är sparad och lagd på ${namn}.`,
              dag,
            },
        false,
      );
      if (ok) stang();
    });
  }

  const andra = lk.data.personer.filter((p) => p.id !== mig);

  return (
    <>
      <div className="dhd" id="dhd">
        <Stang stang={stang} />
        <span className="eyebrow">Ny händelse</span>
        <div className="tabs" role="group" aria-label="Typ">
          {(
            [
              ["mote", "Möte"],
              ["uppgift", "Uppgift"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              data-ftype={k}
              aria-pressed={typ === k}
              onClick={() => {
                setTyp(k);
                setKrock(null);
              }}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="dbody" id="dbody">
        <form
          id="fForm"
          style={{ display: "flex", flexDirection: "column", gap: 14 }}
          noValidate
          onSubmit={(ev) => {
            ev.preventDefault();
            spara(false);
          }}
        >
          <label className="field" htmlFor="fTitle">
            {typ === "uppgift" ? "Vad ska göras" : "Rubrik"}
            <input
              ref={rubrikRef}
              id="fTitle"
              type="text"
              value={rubrik}
              maxLength={200}
              placeholder={typ === "uppgift" ? "Till exempel: Förbered månadsmöte" : "Till exempel: Genomgång av veckans överlämningar"}
              onChange={(e) => setRubrik(e.target.value)}
            />
          </label>

          {typ === "mote" ? (
            <div className="field">
              <span>Deltagare från Nav</span>
              <div className="people">
                {andra.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="chipbtn"
                    data-att={p.id}
                    aria-pressed={deltagare.includes(p.id)}
                    onClick={() => {
                      setDeltagare((d) => (d.includes(p.id) ? d.filter((x) => x !== p.id) : [...d, p.id]));
                      setKrock(null);
                    }}
                  >
                    <Av person={p} />
                    {p.fornamn}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="field">
              <span>Ansvarig</span>
              <div className="people" role="radiogroup" aria-label="Ansvarig">
                {lk.data.personer.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="chipbtn"
                    role="radio"
                    aria-checked={ansvarig === p.id}
                    aria-pressed={ansvarig === p.id}
                    onClick={() => setAnsvarig(p.id)}
                  >
                    <Av person={p} />
                    {p.id === mig ? "Jag" : p.fornamn}
                  </button>
                ))}
              </div>
            </div>
          )}

          <Datumfalt
            dag={dag}
            setDag={(d) => {
              setDag(d);
              setKrock(null);
            }}
            lk={lk}
          />
          <Tidsval
            start={start}
            minuter={minuter}
            setStart={(s) => {
              setStart(s);
              setKrock(null);
            }}
            setMinuter={(m) => {
              setMinuter(m);
              setKrock(null);
            }}
          />

          {typ === "mote" && (
            <>
              <Assistent
                lk={lk}
                personer={personer}
                dag={dag}
                start={start}
                minuter={minuter}
                skip={null}
                upp={upp.data}
                setStart={(s) => {
                  setStart(s);
                  setKrock(null);
                }}
                foresla={foreslaGemensam}
              />
              <div className="grid2">
                <label className="field" htmlFor="fRem">
                  Påminnelse
                  <select id="fRem" value={paminnelse} onChange={(e) => setPaminnelse(Number(e.target.value))}>
                    {[0, 5, 10, 15, 30, 60].map((m) => (
                      <option key={m} value={m}>
                        {m ? `${m} min före` : "Ingen"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field" htmlFor="fShow">
                  Visa som
                  <select id="fShow" value={visaSom} onChange={(e) => setVisaSom(e.target.value)}>
                    {[
                      ["upptagen", "Upptagen"],
                      ["preliminar", "Preliminär"],
                      ["ledig", "Ledig"],
                      ["borta", "Borta"],
                    ].map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid2">
                <label className="field" htmlFor="fPlats">
                  Plats
                  <select id="fPlats" value={plats} onChange={(e) => setPlats(e.target.value)}>
                    {["Kontoret", "Teams", "Telefon"].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="field" htmlFor="fAgenda">
                Agenda
                <textarea id="fAgenda" maxLength={600} placeholder="Vad ska mötet leda till?" value={agenda} onChange={(e) => setAgenda(e.target.value)} />
              </label>
            </>
          )}

          <Krockruta lk={lk} krock={krock} dag={dag} start={start} minuter={minuter} tvinga={() => spara(true)} hitta={foreslaGemensam} />
          <div className="acts">
            <button className="btn primary" type="submit" disabled={vantar}>
              {typ === "mote" && deltagare.length ? "Skicka inbjudan" : "Spara"}
            </button>
            <button className="btn ghost" type="button" id="fCancel" onClick={stang}>
              Avbryt
            </button>
          </div>
          <p className="hint">
            {typ === "mote"
              ? deltagare.length
                ? `${deltagare.map((id) => lk.personer.get(id)?.fornamn).join(", ")} får en notis i klockan och ett mejl. Svaren kommer tillbaka till din klocka.`
                : ""
              : ansvarig === mig
                ? "Skapas i uppgiftsmodulen och ritas här med klockslag. Bara du ser den."
                : `Skapas i uppgiftsmodulen och läggs på ${lk.personer.get(ansvarig)?.fornamn}, som ser den som ny i sin klocka.`}
          </p>
        </form>
      </div>
    </>
  );
}
