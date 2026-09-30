"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import type { Handelsedetalj, Kokund, Leveransdetalj } from "@/lib/leveranskalender-server";
import {
  FORINSTALLNINGAR,
  KVITTO_INGEN_TID_5,
  KVITTO_INGEN_TID_7,
  WORK_S,
  autopick,
  dayLabel,
  endOf,
  hm,
  overlamning,
  paminnelsetext,
  plus,
  slaInfo,
} from "@/lib/leveranskalender";
import {
  begarKomplettering,
  bokaKickoff,
  flytta,
  hamtaKokund,
  hamtaLeverans,
  hamtaUpptaget,
  kopplaCrm,
  sattUtfall,
  stallIn,
  taKund,
} from "../moten/actions";
import type { Lk } from "./gemensamt";
import { Stang } from "./Tidsdelar";

const kr = (n: number) => n.toLocaleString("sv-SE", { maximumFractionDigits: 0 });
const utanKund = (rubrik: string) => {
  const i = rubrik.lastIndexOf(" · ");
  return i >= 0 ? rubrik.slice(0, i) : rubrik;
};

/** `val()`: värdet, eller "Saknas" i rött. */
function Varde({ v }: { v: string | null | undefined }) {
  return String(v ?? "").trim() ? <>{v}</> : <span className="missing">Saknas</span>;
}

/** `custBox()`: överlämningen och kunden. */
function Kundruta({ lk, k }: { lk: Lk; k: Kokund }) {
  const saljare = k.saljare ? lk.personer.get(k.saljare) : undefined;
  return (
    <>
      <div className="dsec">
        <h5>Överlämning från {saljare?.fornamn ?? "säljaren"}</h5>
        <div className="box">
          <div>
            <div className="q">Kundens mål</div>
            <Varde v={k.mal} />
          </div>
          <div>
            <div className="q">Lovat i säljsamtalet</div>
            <Varde v={k.lovat} />
          </div>
          <div>
            <div className="q">Bästa tid att ringa</div>
            <Varde v={k.bastaTid} />
          </div>
          <div>
            <div className="q">Risker</div>
            <Varde v={k.risker} />
          </div>
        </div>
      </div>
      <div className="dsec">
        <h5>Kund</h5>
        <dl className="kv">
          <dt>Kontakt</dt>
          <dd>
            <Varde v={k.kontakt} />
          </dd>
          <dt>Telefon</dt>
          <dd className="mono">
            <Varde v={k.telefon} />
          </dd>
          <dt>Avtal</dt>
          <dd>
            {[k.paket, k.pris !== null ? `${kr(k.pris)} kr/mån` : null, k.loptid ? `${k.loptid} mån` : null].filter(Boolean).join(" · ")}
          </dd>
        </dl>
      </div>
    </>
  );
}

/** `crmBox()`: kopplingen till leverans-CRM:et, med den manuella adaptern. */
function Crmruta({ lk, k }: { lk: Lk; k: Kokund }) {
  const [id, setId] = useState("");
  const [, startOvergang] = useTransition();
  if (k.crmId) {
    return (
      <div className="crm">
        <span aria-hidden="true">↗</span>
        <span>
          <b>Finns i leverans-CRM:et · {k.crmId}</b>
          {k.crmFel ? `Senaste synken misslyckades: ${k.crmFel}` : "Produktionen och rapporterna hanteras där."}
        </span>
      </div>
    );
  }
  return (
    <div className="crm">
      <span aria-hidden="true">↗</span>
      <span style={{ flex: 1 }}>
        <b>Inte i leverans-CRM:et än</b>
        Manuell adapter tills CRM:ets API är känt: lägg in kunden där och klistra in kund-ID:t här.
        {k.crmFel && <span style={{ display: "block", marginTop: 4 }}>{k.crmFel}</span>}
        {lk.data.lev.farSe && (
          <form
            className="addrow"
            style={{ marginTop: 8 }}
            onSubmit={(ev) => {
              ev.preventDefault();
              if (!id.trim()) {
                lk.visaKvitto("Klistra in kund-ID:t först.");
                return;
              }
              startOvergang(async () => {
                lk.efter(await kopplaCrm(k.orderId, id), false);
              });
            }}
          >
            <input
              id="crmId"
              type="text"
              placeholder="Kund-ID, till exempel LC-10490"
              aria-label="Kund-ID från leverans-CRM:et"
              maxLength={40}
              value={id}
              onChange={(ev) => setId(ev.target.value)}
            />
            <button className="btn sm" type="submit">
              Spara
            </button>
          </form>
        )}
      </span>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Kökortet (`renderQueueCard()`)
// -----------------------------------------------------------------------------

export function Kokort({ lk, orderId, stang }: { lk: Lk; orderId: string; stang: () => void }) {
  const [k, setK] = useState<Kokund | null | "laddar">("laddar");
  const [vem, setVem] = useState("auto");
  const [langd, setLangd] = useState(30);
  const [skickat, setSkickat] = useState(false);
  const [, startOvergang] = useTransition();

  useEffect(() => {
    let aktuell = true;
    hamtaKokund(orderId).then((d) => aktuell && setK(d));
    return () => {
      aktuell = false;
    };
  }, [orderId, lk.data]);

  if (k === "laddar") {
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
  if (!k || k.agare) {
    return (
      <>
        <div className="dhd" id="dhd">
          <Stang stang={stang} />
          <h3>Inte i kön</h3>
        </div>
        <div className="dbody" id="dbody">
          <p className="muted">Kunden har redan fått ett välkomstsamtal bokat, eller finns inte längre i kön.</p>
        </div>
      </>
    );
  }

  const s = slaInfo(k.due, Date.now());
  const saljare = k.saljare ? lk.personer.get(k.saljare) : undefined;
  const lev = lk.data.personer.filter((p) => p.lev);
  const h = overlamning({ kontakt: k.kontakt, telefon: k.telefon, mal: k.mal, lovat: k.lovat, basta_tid: k.bastaTid, risker: k.risker });

  async function foreslaOchBoka() {
    if (k === "laddar" || !k) return;
    let pool = vem === "auto" || vem === "jamn" ? lev.map((p) => p.id) : [vem];
    if (pool.length === 0) pool = [lk.data.mig];
    if (vem === "jamn") {
      const last = (id: string) => lk.data.lev.veckolast[id] ?? 0;
      const min = Math.min(...pool.map(last));
      pool = pool.filter((id) => last(id) === min);
    }
    const upp = await hamtaUpptaget(pool, lk.data.hem, plus(lk.data.hem, 5));
    let bast: { d: string; s: number; p: string } | null = null;
    for (const p of pool) {
      const pk = autopick(upp, [p], lk.data.hem, WORK_S, langd, 5, lk.data.idag, lk.nu.min);
      if (pk && (!bast || pk.d < bast.d || (pk.d === bast.d && pk.s < bast.s))) bast = { ...pk, p };
    }
    if (!bast) {
      lk.visaKvitto(KVITTO_INGEN_TID_5);
      return;
    }
    const b = bast;
    startOvergang(async () => {
      lk.efter(await taKund(orderId, b.p, b.d, b.s, langd));
    });
  }

  return (
    <>
      <div className="dhd" id="dhd">
        <Stang stang={stang} />
        <span className="chip k-valkomst" style={{ alignSelf: "flex-start" }}>
          I kön · {s.txt}
        </span>
        <h3>{k.kund}</h3>
        <span className="muted mono" style={{ fontSize: 12 }}>
          {[k.paket, saljare ? `såld av ${saljare.namn}` : null].filter(Boolean).join(" · ")}
        </span>
      </div>
      <div className="dbody" id="dbody">
        <div className="dsec">
          <h5>Boka välkomstsamtal</h5>
          <div className="grid2">
            <label className="field" htmlFor="qp">
              Vem
              <select id="qp" value={vem} onChange={(e) => setVem(e.target.value)}>
                <option value="auto">Först lediga i leverans</option>
                <option value="jamn">Jämn fördelning i leverans</option>
                {lev.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.namn} · {lk.data.lev.veckolast[p.id] ?? 0} i veckan
                  </option>
                ))}
              </select>
            </label>
            <label className="field" htmlFor="qm">
              Längd
              <select id="qm" value={langd} onChange={(e) => setLangd(Number(e.target.value))}>
                <option value={30}>30 min</option>
                <option value={15}>15 min</option>
                <option value={45}>45 min</option>
              </select>
            </label>
          </div>
          <div className="acts" style={{ marginTop: 10 }}>
            <button className="btn primary" type="button" id="qBook" onClick={foreslaOchBoka}>
              Föreslå tid och boka
            </button>
            <button
              className="btn"
              type="button"
              id="qPick"
              onClick={() => {
                lk.setValjTid(orderId);
                stang();
                if (lk.data.vy === "manad" || lk.data.vy === "agenda") lk.ga({ vy: "arbetsvecka" });
                lk.visaKvitto("Klicka på en tid i kalendern.");
              }}
            >
              Välj tid i kalendern
            </button>
          </div>
          <p className="hint" style={{ marginTop: 6 }}>
            Bästa tid enligt säljaren: {k.bastaTid ? k.bastaTid : "saknas"}. &quot;Jämn fördelning&quot; ger kunden till den som har minst
            leveransposter den här veckan.
          </p>
        </div>
        {h.saknas.length > 0 && (
          <div className="clashbox" role="note">
            <b>
              Överlämningen är inte komplett: {h.har} av {h.av}
            </b>
            <span>Saknas: {h.saknas.join(", ")}.</span>
            <div className="acts">
              <button
                className="btn sm"
                type="button"
                data-ask={orderId}
                disabled={skickat}
                onClick={() =>
                  startOvergang(async () => {
                    if (lk.efter(await begarKomplettering(orderId, h.saknas), false)) setSkickat(true);
                  })
                }
              >
                {skickat ? `Skickat till ${saljare?.fornamn ?? "säljaren"}` : `Be ${saljare?.fornamn ?? "säljaren"} komplettera`}
              </button>
            </div>
          </div>
        )}
        <Crmruta lk={lk} k={k} />
        <Kundruta lk={lk} k={k} />
      </div>
    </>
  );
}

// -----------------------------------------------------------------------------
// Leveranspanelen (`renderCustomerEvent()`)
// -----------------------------------------------------------------------------

export function Leveranspanel({ lk, e, stang }: { lk: Lk; e: Handelsedetalj; stang: () => void }) {
  const [l, setL] = useState<Leveransdetalj | null | "laddar">("laddar");
  const [, startOvergang] = useTransition();

  useEffect(() => {
    let aktuell = true;
    hamtaLeverans(e.id).then((d) => aktuell && setL(d));
    return () => {
      aktuell = false;
    };
  }, [e.id, lk.data]);

  const org = lk.personer.get(e.organisator);
  const steg = l && l !== "laddar" ? l.steg : null;
  const f = steg ? FORINSTALLNINGAR[steg] : null;
  const forsok = l && l !== "laddar" ? l.forsok : 1;

  const huvud = (
    <div className="dhd" id="dhd">
      <Stang stang={stang} />
      <span className="chip k-lev" style={{ alignSelf: "flex-start" }}>
        {f?.lab ?? "Leverans"}
        {forsok > 1 ? ` · försök ${forsok}` : ""}
      </span>
      <h3>{l && l !== "laddar" && l.kund ? l.kund.kund : utanKund(e.rubrik)}</h3>
      <span className="muted mono" style={{ fontSize: 12 }}>
        {dayLabel(e.dag)} · {hm(e.start ?? 0)}–{hm(endOf(e))} · {org?.namn}
      </span>
    </div>
  );

  if (l === "laddar" || !l) {
    return (
      <>
        {huvud}
        <div className="dbody" id="dbody">
          <p className="muted">{l === "laddar" ? "Hämtar …" : "Leveransen gick inte att läsa."}</p>
        </div>
      </>
    );
  }

  const mine = e.farAndra;
  const gor = (p: Promise<Parameters<Lk["efter"]>[0]>, oppna = false) =>
    startOvergang(async () => {
      lk.efter(await p, oppna);
    });

  async function ejSvar() {
    if (l === "laddar" || !l) return;
    const start = e.start ?? WORK_S;
    let nasta: { dag: string; start: number } | null = null;
    if (l.forsok < 3) {
      const upp = await hamtaUpptaget([e.organisator], e.dag, plus(e.dag, 6));
      const pk =
        autopick(upp, [e.organisator], e.dag, start + 180, 30, 5, lk.data.idag, lk.nu.min, e.id) ??
        autopick(upp, [e.organisator], plus(e.dag, 1), start < 12 * 60 ? 13 * 60 : WORK_S, 30, 5, lk.data.idag, lk.nu.min, e.id);
      nasta = pk ? { dag: pk.d, start: pk.s } : null;
    }
    gor(sattUtfall(e.id, "ej_svar", nasta));
  }

  async function kickoff() {
    if (l === "laddar" || !l?.kund) return;
    const upp = await hamtaUpptaget([e.organisator], plus(e.dag, 1), plus(e.dag, 8));
    const pk = autopick(upp, [e.organisator], plus(e.dag, 1), 9 * 60, 60, 7, lk.data.idag, lk.nu.min);
    if (!pk) {
      lk.visaKvitto(KVITTO_INGEN_TID_7);
      return;
    }
    gor(bokaKickoff(l.kund.orderId, pk.d, pk.s), true);
  }

  async function nastaLediga() {
    const upp = await hamtaUpptaget([e.organisator], e.dag, plus(e.dag, 7));
    const pk = autopick(upp, [e.organisator], e.dag, Math.max(endOf(e), WORK_S), e.minuter ?? 30, 7, lk.data.idag, lk.nu.min, e.id);
    if (!pk) {
      lk.visaKvitto(KVITTO_INGEN_TID_7);
      return;
    }
    gor(flytta(e.id, pk.d, pk.s));
  }

  const stall = () =>
    startOvergang(async () => {
      if (lk.efter(await stallIn(e.id), false)) stang();
    });

  const aktivaPaminnelser = l.paminnelser.filter((p) => p.status === "vantar" || p.status === "schemalagd");
  const pamRuta =
    aktivaPaminnelser.length > 0 && !l.utfall ? (
      <div className="remind">
        <b>Mejlpåminnelse schemalagd · Resend</b>
        <span>
          {aktivaPaminnelser
            .map((p) => (p.mottagare === "kund" ? (l.kund?.kontakt ?? "kunden") : (org?.namn ?? "ansvarig")))
            .join(" och ")}{" "}
          får ett mejl {paminnelsetext(e.dag, e.start ?? 0)}.
        </span>
        {aktivaPaminnelser.some((p) => p.resendId) && (
          <span className="hint mono">{aktivaPaminnelser.map((p) => p.resendId).filter(Boolean).join(" · ")}</span>
        )}
      </div>
    ) : null;
  const felPaminnelser = l.paminnelser.filter((p) => p.status === "fel");

  const harKickoff = l.plan.some((x) => x.steg === "kickoff");
  const nu = lk.data.idag;

  return (
    <>
      {huvud}
      <div className="dbody" id="dbody">
        {mine && steg === "valkomstsamtal" && !l.utfall && (
          <>
            <div className="dsec">
              <h5>Utfall</h5>
              <div className="acts">
                <button className="btn primary" type="button" data-act="nadd" onClick={() => gor(sattUtfall(e.id, "genomford", null))}>
                  Nådd, markera genomfört
                </button>
                <button className="btn" type="button" data-act="ejsvar" onClick={ejSvar}>
                  Ej svar
                </button>
                <button className="btn ghost" type="button" data-act="flytta" onClick={nastaLediga}>
                  Flytta
                </button>
                <button className="btn danger" type="button" data-act="stall" onClick={stall}>
                  Ställ in
                </button>
              </div>
              <p className="hint" style={{ marginTop: 6 }}>
                Ej svar bokar nästa försök på en annan tid på dagen. Efter tre försök föreslås sms och mejl.
              </p>
            </div>
            {pamRuta}
          </>
        )}
        {mine && steg === "valkomstsamtal" && l.utfall === "genomford" && (
          <div className="dsec">
            <h5>Utfall</h5>
            <p>✓ Markerat genomfört av {org?.namn}.</p>
            {!harKickoff && (
              <div className="acts" style={{ marginTop: 8 }}>
                <button className="btn primary" type="button" data-act="kickoff" onClick={kickoff}>
                  Boka kickoff inom 5 arbetsdagar
                </button>
              </div>
            )}
          </div>
        )}
        {mine && l.utfall === "ej_svar" && (
          <div className="dsec">
            <h5>Utfall</h5>
            <p>Ej svar på försök {l.forsok}.</p>
          </div>
        )}
        {mine && steg !== "valkomstsamtal" && l.utfall === "genomford" && (
          <div className="dsec">
            <h5>Utfall</h5>
            <p>✓ Genomfört.</p>
          </div>
        )}
        {mine && steg !== "valkomstsamtal" && !l.utfall && (
          <>
            <div className="acts">
              <button className="btn primary" type="button" data-act="klar" onClick={() => gor(sattUtfall(e.id, "genomford", null))}>
                Markera genomfört
              </button>
              <button className="btn" type="button" data-act="flytta" onClick={nastaLediga}>
                Flytta till nästa lediga tid
              </button>
              <button className="btn danger" type="button" data-act="stall" onClick={stall}>
                Ställ in
              </button>
            </div>
            {pamRuta}
          </>
        )}
        {felPaminnelser.length > 0 && (
          <p className="hint">
            Påminnelsen {felPaminnelser.map((p) => (p.mottagare === "kund" ? "till kunden" : "till dig")).join(" och ")} gick inte att skicka:{" "}
            {felPaminnelser.map((p) => p.fel).join("; ")}
          </p>
        )}

        {(e.deltagare.length > 0 || l.kundInbjuden) && (
          <div className="dsec">
            <h5>Deltagare</h5>
            <div className="rsvp">
              {e.deltagare.map((a) => (
                <div key={a.id} className="r">
                  {lk.personer.get(a.id)?.namn}
                  <span className={`st ${a.svar}`}>{a.svar === "vantar" ? "Inte svarat" : a.svar[0].toUpperCase() + a.svar.slice(1)}</span>
                </div>
              ))}
              {l.kundInbjuden && l.kund && (
                <div className="r">
                  <span className="av" style={{ background: "var(--color-ink-300)" }}>
                    K
                  </span>
                  {l.kund.kontakt ?? "Kunden"} (kund)
                  <span className="st vantar">Via .ics</span>
                </div>
              )}
            </div>
          </div>
        )}

        {l.kund && <Crmruta lk={lk} k={l.kund} />}
        {l.kund && <Kundruta lk={lk} k={l.kund} />}
        {l.kund && lk.data.mig === l.kund.saljare && (
          <Link className="btn sm" href={`/kalender/overlamning/${l.kund.orderId}`}>
            Komplettera överlämningen
          </Link>
        )}

        <div className="dsec">
          <h5>Bokat i Nav</h5>
          <ul className="plan">
            {l.plan.map((x) => (
              <li key={x.id}>
                <span className={`pt ${x.utfall === "genomford" ? "done" : x.utfall === "ej_svar" ? "miss" : x.dag >= nu ? "now" : ""}`} />
                <span>
                  {utanKund(x.rubrik)}
                  {x.utfall === "ej_svar" ? " · ej svar" : ""}
                </span>
                <span className="when">
                  {dayLabel(x.dag)} {x.start !== null ? hm(x.start) : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
