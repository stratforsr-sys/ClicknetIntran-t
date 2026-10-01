"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import type { Enskilt, Handelsedetalj, Punkt } from "@/lib/leveranskalender-server";
import { WORK_S, autopick, plus } from "@/lib/leveranskalender";
import {
  beOmForberedelse,
  bockaAv,
  hamtaEnskiltInnehall,
  hamtaUpptaget,
  laggTillPunkt,
  punktTillUppgift,
  sparaSomSamtal,
} from "../moten/actions";
import { Av, type Lk } from "./gemensamt";

const kr = (n: number) => n.toLocaleString("sv-SE", { maximumFractionDigits: 0 });

/**
 * `renderOneOnOne()`: säljarens siffror, den gemensamma agendan, åtgärderna och
 * anteckningarna.
 *
 * Innehållet ses av coachningskretsen (policyn i 0069) och skrivs av de två.
 * Den som står utanför får beskedet rakt ut i stället för en tom panel.
 */
export function Enskildinnehall({ lk, e }: { lk: Lk; e: Handelsedetalj }) {
  const [inn, setInn] = useState<Enskilt | null | "laddar">("laddar");
  const [, startOvergang] = useTransition();
  const [nyAgenda, setNyAgenda] = useState("");
  const [nyAtgard, setNyAtgard] = useState("");
  const [anteckna, setAnteckna] = useState(false);
  const [grow, setGrow] = useState({ goal: "", reality: "", options: "", will: "" });
  const mig = lk.data.mig;

  useEffect(() => {
    let aktuell = true;
    hamtaEnskiltInnehall(e.id).then((d) => aktuell && setInn(d));
    return () => {
      aktuell = false;
    };
  }, [e.id, lk.data]);

  if (inn === "laddar") return <p className="muted">Hämtar …</p>;
  if (!inn || inn.punkter === null) {
    return (
      <p className="muted">
        Innehållet i en 1:1 ses bara av de två och av den som får se coachningssamtalen, samma krets som i Nav i övrigt.
      </p>
    );
  }

  const saljare = lk.personer.get(inn.saljare);
  const andra = mig === e.organisator ? saljare : lk.personer.get(e.organisator);
  const agenda = inn.punkter.filter((p) => p.kind === "agenda");
  const atgarder = inn.punkter.filter((p) => p.kind === "atgard");
  const oppna = atgarder.filter((p) => !p.klar).length;
  const s = inn.siffror;
  const iFramtiden = e.dag > lk.data.idag;

  const gor = (p: Promise<Parameters<Lk["efter"]>[0]>) =>
    startOvergang(async () => {
      lk.efter(await p, false);
    });

  async function tillUppgift(p: Punkt) {
    const agare = p.owner ?? p.author;
    const upp = await hamtaUpptaget([agare], lk.data.hem, plus(lk.data.hem, 5));
    const pk = autopick(upp, [agare], lk.data.hem, WORK_S, 30, 5, lk.data.idag, lk.nu.min);
    gor(punktTillUppgift(p.id, pk?.d ?? null, pk?.s ?? null));
  }

  const lista = (punkter: Punkt[], tom: string, uppgiftKnapp: boolean) => (
    <ul className="alist">
      {punkter.length === 0 && <li className="muted">{tom}</li>}
      {punkter.map((p) => {
        const vem = lk.personer.get(p.kind === "atgard" ? (p.owner ?? p.author) : p.author);
        return (
          <li key={p.id} className={p.klar ? "done" : ""}>
            <input
              type="checkbox"
              id={`pk-${p.id}`}
              checked={p.klar}
              disabled={!inn.farSkriva}
              aria-label={`${p.kind === "atgard" ? "Klar" : "Avklarad"}: ${p.text}`}
              onChange={(ev) => gor(bockaAv(p.id, ev.target.checked))}
            />
            <Av person={vem} />
            <span className="tx">{p.text}</span>
            {uppgiftKnapp && !p.klar && !p.uppgift && inn.farSkriva && (
              <button
                className="btn sm ghost"
                type="button"
                data-totask={p.id}
                style={{ marginLeft: "auto", whiteSpace: "nowrap" }}
                onClick={() => tillUppgift(p)}
              >
                Till uppgift
              </button>
            )}
            {p.uppgift && (
              <Link className="btn sm ghost" href={`/uppgifter/${p.uppgift}`} style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>
                Uppgiften
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      <div className="dsec">
        <h5>{saljare?.fornamn}s siffror denna månad</h5>
        <div className="stats">
          <div className="stat">
            <b>
              {s.order ?? "–"}
              {s.mal !== null ? `/${s.mal}` : ""}
            </b>
            <span>order mot mål</span>
          </div>
          <div className="stat">
            <b>{s.kv ?? "–"}</b>
            <span>K&amp;V-snitt</span>
          </div>
          <div className="stat">
            <b>{s.provision !== null ? kr(s.provision) : "–"}</b>
            <span>provision, kr</span>
          </div>
        </div>
      </div>

      <div className="dsec">
        <h5>
          Agenda{" "}
          <span className="hint" style={{ textTransform: "none", letterSpacing: 0 }}>
            båda kan lägga till · påminnelse dagen före kl 15
          </span>
        </h5>
        {lista(agenda, "Tom än. Punkter som läggs till syns för er båda.", false)}
        {inn.farSkriva && (
          <form
            className="addrow"
            id="agForm"
            style={{ marginTop: 8 }}
            onSubmit={(ev) => {
              ev.preventDefault();
              const t = nyAgenda.trim();
              if (!t) return;
              setNyAgenda("");
              gor(laggTillPunkt(inn.seriesId, "agenda", t, e.dag, null));
            }}
          >
            <input
              id="agInput"
              type="text"
              placeholder="Lägg till en punkt"
              aria-label="Ny agendapunkt"
              maxLength={300}
              value={nyAgenda}
              onChange={(ev) => setNyAgenda(ev.target.value)}
            />
            <button className="btn sm" type="submit">
              Lägg till
            </button>
          </form>
        )}
      </div>

      <div className="dsec">
        <h5>
          Åtgärder{" "}
          <span className="hint" style={{ textTransform: "none", letterSpacing: 0 }}>
            {oppna} öppna, följer med tills de är klara
          </span>
        </h5>
        {lista(atgarder, "Inga åtgärder än.", true)}
        {inn.farSkriva && (
          <form
            className="addrow"
            style={{ marginTop: 8 }}
            onSubmit={(ev) => {
              ev.preventDefault();
              const t = nyAtgard.trim();
              if (!t) return;
              setNyAtgard("");
              gor(laggTillPunkt(inn.seriesId, "atgard", t, e.dag, inn.saljare));
            }}
          >
            <input
              type="text"
              placeholder={`Ny åtgärd för ${saljare?.fornamn ?? "säljaren"}`}
              aria-label="Ny åtgärd"
              maxLength={300}
              value={nyAtgard}
              onChange={(ev) => setNyAtgard(ev.target.value)}
            />
            <button className="btn sm" type="submit">
              Lägg till
            </button>
          </form>
        )}
      </div>

      <div className="dsec">
        <h5>Anteckningar</h5>
        <div className="box">
          Sparas som coachningssamtal i Nav (mål, nuläge, alternativ, vilja) och syns för samma krets som coachningssamtalen.
        </div>
        {anteckna && !e.coachningssamtal && (
          <form
            style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}
            onSubmit={(ev) => {
              ev.preventDefault();
              startOvergang(async () => {
                if (lk.efter(await sparaSomSamtal(e.id, grow), false)) setAnteckna(false);
              });
            }}
          >
            {(
              [
                ["goal", "Mål"],
                ["reality", "Nuläge"],
                ["options", "Alternativ"],
                ["will", "Vilja"],
              ] as const
            ).map(([k, l]) => (
              <label key={k} className="field" htmlFor={`grow-${k}`}>
                {l}
                <textarea id={`grow-${k}`} value={grow[k]} onChange={(ev) => setGrow((g) => ({ ...g, [k]: ev.target.value }))} />
              </label>
            ))}
            <div className="acts">
              <button className="btn primary sm" type="submit">
                Spara som coachningssamtal
              </button>
              <button className="btn ghost sm" type="button" onClick={() => setAnteckna(false)}>
                Avbryt
              </button>
            </div>
          </form>
        )}
        <div className="acts" style={{ marginTop: 8 }}>
          {e.coachningssamtal ? (
            <Link className="btn" href={`/coachning/${inn.saljare}`}>
              Öppna samtalet
            </Link>
          ) : inn.farCoacha && !anteckna ? (
            <button className="btn" type="button" data-act="coach" disabled={iFramtiden} onClick={() => setAnteckna(true)}>
              Anteckna som coachningssamtal
            </button>
          ) : null}
          {mig === e.organisator && andra && (
            <button className="btn" type="button" data-act="prep" onClick={() => gor(beOmForberedelse(e.id))}>
              Be {andra.fornamn} förbereda nu
            </button>
          )}
        </div>
        {inn.farCoacha && iFramtiden && !e.coachningssamtal && (
          <p className="hint" style={{ marginTop: 6 }}>
            Samtalet kan sparas från och med dagen det hålls.
          </p>
        )}
        {mig === e.organisator && !inn.farCoacha && !e.coachningssamtal && (
          <p className="hint" style={{ marginTop: 6 }}>
            Bara {saljare?.fornamn}s chef kan spara samtalet som coachningssamtal.
          </p>
        )}
      </div>
    </>
  );
}
