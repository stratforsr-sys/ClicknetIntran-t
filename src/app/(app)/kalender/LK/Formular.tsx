"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  FORINSTALLNINGAR,
  KVITTO_INGEN_TID_14,
  STEG,
  UPPREPA,
  UPPREPA_ETIKETT,
  WORK_S,
  autopick,
  dayLabel,
  hm,
  isWeekend,
  paminnelsetext,
  plus,
  type Steg,
  type Upprepa,
} from "@/lib/leveranskalender";
import { hamtaUpptaget, skapaLeverans, skapaMote, skapaSerie } from "../moten/actions";
import { skapaUppgift } from "@/app/(app)/uppgifter/actions";
import { Av, type Lk } from "./gemensamt";
import { Assistent, Datumfalt, Krockruta, Stang, Tidsval, upptagnaI, useUpptaget } from "./Tidsdelar";

type Typ = "mote" | "enskilt" | "uppgift" | "lev";

/**
 * `renderForm()`: Ny händelse.
 *
 * Tre flikar: Möte, 1:1 och Uppgift. Leveransens förinställningar kommer i
 * pass 3. Ett möte som upprepas och varje 1:1 blir en serie (0070); ett möte
 * som inte upprepas blir en enda händelse.
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
  start: { dag?: string; start?: number; minuter?: number; med?: string; enskilt?: boolean };
  stang: () => void;
}) {
  const mig = lk.data.mig;
  // Leveransen öppnar formuläret på förinställningen Kickoff (`newForm()`).
  // Från Teamet: en kollegas rad ger ett möte med henne, eller en 1:1.
  const [typ, setTyp] = useState<Typ>(
    forval.enskilt ? "enskilt" : forval.med ? "mote" : lk.data.lev.arLev && lk.data.lev.kunder.length ? "lev" : "mote",
  );
  const [steg, setSteg] = useState<Steg>("kickoff");
  const [orderId, setOrderId] = useState(lk.data.lev.kunder[0]?.orderId ?? "");
  const [remMig, setRemMig] = useState(true);
  const [remKund, setRemKund] = useState(FORINSTALLNINGAR.kickoff.kund);
  const forstaSaljare = lk.data.personer.find((p) => p.grupp === "salj" && p.id !== mig) ?? lk.data.personer.find((p) => p.id !== mig);
  const [med, setMed] = useState<string>(forval.enskilt && forval.med ? forval.med : (forstaSaljare?.id ?? ""));
  const [upprepa, setUpprepa] = useState<Upprepa>(forval.enskilt ? "vecka" : "aldrig");
  const [rubrik, setRubrik] = useState("");
  const [deltagare, setDeltagare] = useState<string[]>(forval.med && !forval.enskilt ? [forval.med] : []);
  const [ansvarig, setAnsvarig] = useState(mig);
  const [dag, setDag] = useState(forval.dag ?? lk.data.hem);
  const [start, setStart] = useState(forval.start ?? 9 * 60);
  const [minuter, setMinuter] = useState(
    forval.minuter ??
      (!forval.med && lk.data.lev.arLev && lk.data.lev.kunder.length ? FORINSTALLNINGAR.kickoff.minuter : 30),
  );
  const [paminnelse, setPaminnelse] = useState(10);
  const [visaSom, setVisaSom] = useState("upptagen");
  const [plats, setPlats] = useState("Kontoret");
  const [agenda, setAgenda] = useState("");
  const [krock, setKrock] = useState<string[] | null>(null);
  const [vantar, startOvergang] = useTransition();
  const rubrikRef = useRef<HTMLInputElement>(null);

  const personer = typ === "uppgift" ? [ansvarig] : typ === "enskilt" ? [mig, med].filter(Boolean) : [mig, ...deltagare];
  const inbjudna = typ === "enskilt" ? [med].filter(Boolean) : typ === "mote" || typ === "lev" ? deltagare : [];
  const kund = lk.data.lev.kunder.find((k) => k.orderId === orderId) ?? null;

  /** `applyPreset()`: förinställningen sätter längden och om kunden påminns. */
  function forinstallning(id: Steg) {
    setTyp("lev");
    setSteg(id);
    setMinuter(FORINSTALLNINGAR[id].minuter);
    setRemKund(FORINSTALLNINGAR[id].kund);
    setKrock(null);
  }
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
    document.getElementById(typ === "enskilt" ? "fWith" : "fTitle")?.focus({ preventScroll: true });
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
    if (typ === "lev") {
      if (!orderId) {
        lk.visaKvitto("Välj en kund.");
        return;
      }
      const upptagna = upptagnaI(upp.data, personer, dag, start, minuter, null);
      if (!tvinga && upptagna.length) {
        setKrock(upptagna);
        return;
      }
      startOvergang(async () => {
        lk.efter(await skapaLeverans({ orderId, steg, dag, start, minuter, deltagare, remMig, remKund }));
      });
      return;
    }
    if (typ !== "enskilt" && !rubrik.trim()) {
      lk.visaKvitto("Skriv en rubrik först.");
      rubrikRef.current?.focus();
      return;
    }
    if (typ !== "uppgift") {
      const upptagna = upptagnaI(upp.data, personer, dag, start, minuter, null);
      if (!tvinga && upptagna.length) {
        setKrock(upptagna);
        return;
      }
      startOvergang(async () => {
        if (typ === "enskilt" || upprepa !== "aldrig") {
          lk.efter(
            await skapaSerie({ typ, rubrik, med: inbjudna, dag, start, minuter, upprepa, agenda, plats, visaSom, paminnelse }),
          );
          return;
        }
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
              ["enskilt", "1:1"],
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
                if (k === "enskilt" && upprepa === "aldrig") setUpprepa("vecka");
                if (k === "enskilt" && !med && deltagare[0]) setMed(deltagare[0]);
                setKrock(null);
              }}
            >
              {l}
            </button>
          ))}
        </div>
        {lk.data.lev.farSe && (
          <>
            <span className="grouplab">
              <i aria-hidden="true" />
              Leverans
            </span>
            <div className="presets" role="group" aria-label="Leveransförinställningar">
              {STEG.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="preset"
                  data-preset={id}
                  aria-pressed={typ === "lev" && steg === id}
                  onClick={() => forinstallning(id)}
                >
                  <span aria-hidden="true">{FORINSTALLNINGAR[id].ico}</span>
                  {FORINSTALLNINGAR[id].lab}
                </button>
              ))}
            </div>
          </>
        )}
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
          {typ === "lev" ? (
            <label className="field" htmlFor="fCust">
              Kund
              <select id="fCust" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                {lk.data.lev.kunder.length === 0 && <option value="">Inga kunder med ansvarig än</option>}
                {lk.data.lev.kunder.map((k) => (
                  <option key={k.orderId} value={k.orderId}>
                    {k.kund}
                  </option>
                ))}
              </select>
            </label>
          ) : typ === "enskilt" ? (
            <label className="field" htmlFor="fWith">
              1:1 med
              <select
                id="fWith"
                value={med}
                onChange={(e) => {
                  setMed(e.target.value);
                  setKrock(null);
                }}
              >
                {andra.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.namn}
                    {p.roll ? ` · ${p.roll}` : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : (
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
          )}

          {typ === "enskilt" ? null : typ === "mote" || typ === "lev" ? (
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

          {typ !== "uppgift" && (
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
              {typ === "lev" && (
                <div className="remind" role="group" aria-label="Mejlpåminnelse">
                  <b>Mejlpåminnelse 30 min före · Resend</b>
                  <label htmlFor="fRemMe">
                    <input type="checkbox" id="fRemMe" checked={remMig} onChange={(e) => setRemMig(e.target.checked)} />
                    Till mig, {lk.personer.get(mig)?.namn}
                  </label>
                  <label htmlFor="fRemCust">
                    <input
                      type="checkbox"
                      id="fRemCust"
                      checked={remKund && !!kund?.epost}
                      disabled={!kund?.epost}
                      onChange={(e) => setRemKund(e.target.checked)}
                    />
                    Till kunden, {kund?.kontakt ?? "kontakten"}
                    {kund && !kund.epost ? " (e-post saknas på ordern)" : ""}
                  </label>
                  <span className="hint">
                    {remMig || (remKund && kund?.epost)
                      ? `Skickas ${paminnelsetext(dag, start)}. Flyttas posten flyttas mejlet. Ställs den in avbokas det.`
                      : "Ingen mejlpåminnelse. Navs pling 10 min före gäller ändå."}
                  </span>
                </div>
              )}
              {typ !== "lev" && (
              <>
              <div className="grid2">
                <label className="field" htmlFor="fRep">
                  Upprepa
                  <select id="fRep" value={upprepa} onChange={(e) => setUpprepa(e.target.value as Upprepa)}>
                    {UPPREPA.map((k) => (
                      <option key={k} value={k}>
                        {UPPREPA_ETIKETT[k]}
                      </option>
                    ))}
                  </select>
                </label>
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
              </div>
              <div className="grid2">
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
                {typ === "enskilt" ? "Första agendapunkt" : "Agenda"}
                <textarea
                  id="fAgenda"
                  maxLength={600}
                  placeholder={typ === "enskilt" ? "Den andra ser punkten och kan lägga till egna" : "Vad ska mötet leda till?"}
                  value={agenda}
                  onChange={(e) => setAgenda(e.target.value)}
                />
              </label>
              </>
              )}
            </>
          )}

          <Krockruta lk={lk} krock={krock} dag={dag} start={start} minuter={minuter} tvinga={() => spara(true)} hitta={foreslaGemensam} />
          <div className="acts">
            <button className="btn primary" type="submit" disabled={vantar}>
              {inbjudna.length ? "Skicka inbjudan" : "Spara"}
            </button>
            <button className="btn ghost" type="button" id="fCancel" onClick={stang}>
              Avbryt
            </button>
          </div>
          <p className="hint">
            {inbjudna.length
              ? `${inbjudna.map((id) => lk.personer.get(id)?.fornamn).join(", ")} får en notis i klockan och ett mejl. Svaren kommer tillbaka till din klocka.`
              : typ === "lev"
                ? "Syns i kalendern i leveransfärgen, så att den inte blandas ihop med annat."
                : typ === "uppgift"
                ? ansvarig === mig
                  ? "Skapas i uppgiftsmodulen och ritas här med klockslag. Bara du ser den."
                  : `Skapas i uppgiftsmodulen och läggs på ${lk.personer.get(ansvarig)?.fornamn}, som ser den som ny i sin klocka.`
                : ""}
          </p>
        </form>
      </div>
    </>
  );
}
