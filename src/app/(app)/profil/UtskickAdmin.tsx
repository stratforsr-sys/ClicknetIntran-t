"use client";

import { useMemo, useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Notis } from "@/components/ui/Notis";
import { Flikrad } from "@/components/ui/Flikar";
import { KONTROLL } from "@/components/ui/Field";
import { cn } from "@/components/ui/cn";
import type { Kanal, Niva, Personlager, Regler } from "@/lib/utskick";
import type { Utskicksvy } from "@/lib/utskick-server";
import { hamtaUtskick, sparaUtskickAction } from "./actions";
import { Matare, Tri, Veck } from "./UtskickDelat";
import {
  arvs, avsnittNycklar, med, nyckelNamn, nyckelVarde, omradenI, raknaOmrade, raknaOmraden,
  sortNycklar, sorterI, type Omrade,
} from "./utskick-klient";

/**
 * Utskick: vad bolaget, en nivå eller en enskild person får, kanal för kanal.
 *
 * Varje ruta är Ärv / På / Av och sparas i samma stund. Lagren vägs som i
 * `far()`: personen före nivån före bolaget, och ett Av från superadmin går
 * inte att öppna igen av personen själv. Det personen stängt på egen hand
 * visas här men kan inte ändras — det är hens val.
 */

type Bolaget = NonNullable<Utskicksvy["bolaget"]>;
type Omfang = { typ: "alla" } | { typ: "niva"; niva: Niva } | { typ: "person"; id: string };

const KANAL_TEXT: Record<Kanal, string> = {
  klocka: "Klockan uppe i navet.",
  mejl: "Mejl till personen.",
  push: "Notiser på telefonen.",
  morgon: "Avsnitten i morgonbrevet.",
};

function reglerFor(b: Bolaget, o: Omfang): Regler {
  if (o.typ === "alla") return b.alla;
  if (o.typ === "niva") return b.nivaer[o.niva] ?? {};
  return b.personer.find((p) => p.id === o.id)?.person ?? {};
}

function sattRegler(b: Bolaget, o: Omfang, r: Regler): Bolaget {
  if (o.typ === "alla") return { ...b, alla: r };
  if (o.typ === "niva") return { ...b, nivaer: { ...b.nivaer, [o.niva]: r } };
  return { ...b, personer: b.personer.map((p) => (p.id === o.id ? { ...p, person: r, av: raknaAv(r) + raknaAv(p.egen) } : p)) };
}

function raknaAv(r: Regler): number {
  let n = 0;
  for (const k of Object.values(r)) for (const v of Object.values(k ?? {})) if (v === false) n++;
  return n;
}

/** Lagren som gäller för omfånget: det valda lagret ovanpå de bredare. Aldrig det egna. */
function lagerFor(b: Bolaget, o: Omfang): Personlager {
  if (o.typ === "alla") return { alla: b.alla };
  if (o.typ === "niva") return { alla: b.alla, niva: b.nivaer[o.niva] };
  const p = b.personer.find((x) => x.id === o.id);
  return { alla: b.alla, niva: p ? b.nivaer[p.niva] : undefined, person: p?.person };
}

/** Lagren UTAN det som redigeras: vad en ruta på Ärv ger. */
function lagerUtan(b: Bolaget, o: Omfang): Personlager {
  const l = lagerFor(b, o);
  if (o.typ === "alla") return {};
  if (o.typ === "niva") return { alla: l.alla };
  return { alla: l.alla, niva: l.niva };
}

export function UtskickAdmin({ vy: start }: { vy: Utskicksvy }) {
  const [vy, setVy] = useState(start);
  const [omfang, setOmfang] = useState<Omfang>({ typ: "alla" });
  const [kanal, setKanal] = useState<Kanal>("klocka");
  const [sok, setSok] = useState("");
  const [fel, setFel] = useState<string | null>(null);

  const bolaget = vy.bolaget;
  const k = vy.katalog;

  const personer = useMemo(() => {
    const q = sok.trim().toLowerCase();
    return (bolaget?.personer ?? []).filter((p) => !q || p.namn.toLowerCase().includes(q));
  }, [bolaget, sok]);

  if (vy.fel) return <Notis ton="warn">{vy.fel}</Notis>;
  if (!bolaget) return <Notis ton="danger">Bara en superadmin ställer in utskicken för andra.</Notis>;

  const person = omfang.typ === "person" ? bolaget.personer.find((p) => p.id === omfang.id) : undefined;
  const regler = reglerFor(bolaget, omfang);
  const lager = lagerFor(bolaget, omfang);
  const arvLager = lagerUtan(bolaget, omfang);

  async function satt(kanalen: Kanal, nyckel: string, varde: boolean | null) {
    const fore = nyckelVarde(regler, kanalen, nyckel);
    const mal = omfang;
    const skriv = (v: boolean | null) =>
      setVy((cur) => (cur.bolaget ? { ...cur, bolaget: sattRegler(cur.bolaget, mal, med(reglerFor(cur.bolaget, mal), kanalen, nyckel, v)) } : cur));
    skriv(varde);
    setFel(null);
    try {
      const svar = await sparaUtskickAction({
        lager: mal.typ === "alla" ? "alla" : mal.typ,
        niva: mal.typ === "niva" ? mal.niva : undefined,
        employeeId: mal.typ === "person" ? mal.id : undefined,
        kanal: kanalen,
        nyckel,
        varde,
      });
      if (!svar.ok) throw new Error(svar.fel);
    } catch (e) {
      skriv(fore);
      setFel(e instanceof Error ? e.message : "Det gick inte att spara. Ingenting ändrades.");
      const ny = await hamtaUtskick().catch(() => null);
      if (ny && !ny.fel) setVy(ny);
    }
  }

  const antalPer = (c: Kanal) =>
    c === "morgon" ? k.avsnitt.filter((a) => arvs(lager, "morgon", avsnittNycklar(a.id), true)).length : raknaOmraden(lager, c, k, true).pa;

  const egenAv = person
    ? (Object.entries(person.egen) as [Kanal, Record<string, boolean>][]).flatMap(([c, nycklar]) =>
        Object.entries(nycklar).filter(([, v]) => v === false).map(([n]) => ({ kanal: c, nyckel: n })),
      )
    : [];

  const rubrik =
    omfang.typ === "alla" ? "Hela bolaget" : omfang.typ === "niva" ? k.nivaer.find((n) => n.id === omfang.niva)?.namn ?? "" : person?.namn ?? "";

  return (
    <div className="flex flex-col gap-4">
      {fel && <Notis ton="danger">{fel}</Notis>}

      <Card>
        <CardHeader titel="Vem gäller det?" beskrivning="Det smalaste valet vinner: person före nivå före hela bolaget." />
        <div className="flex flex-col gap-3">
          <Flikrad
            etikett="Omfång"
            valt={omfang.typ}
            onVal={(id) => {
              if (id === "alla") setOmfang({ typ: "alla" });
              else if (id === "niva") setOmfang({ typ: "niva", niva: "salesperson" });
              else setOmfang(bolaget.personer[0] ? { typ: "person", id: bolaget.personer[0].id } : { typ: "alla" });
            }}
            flikar={[
              { id: "alla", etikett: "Hela bolaget" },
              { id: "niva", etikett: "Nivå" },
              { id: "person", etikett: "Person", antal: bolaget.personer.filter((p) => p.av > 0).length || null },
            ]}
          />

          {omfang.typ === "niva" && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Nivå">
              {k.nivaer.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  aria-pressed={omfang.niva === n.id}
                  onClick={() => setOmfang({ typ: "niva", niva: n.id })}
                  className={cn(
                    "min-h-9 rounded-full px-4 text-small ring-1 transition-colors duration-fast",
                    omfang.niva === n.id ? "bg-brand-100 font-semibold text-brand-ink ring-brand-200" : "text-ink-500 ring-ink-300/50 hover:text-ink-900",
                  )}
                >
                  {n.namn}
                </button>
              ))}
            </div>
          )}

          {omfang.typ === "person" && (
            <div className="flex flex-col gap-2">
              <input
                type="search"
                value={sok}
                onChange={(e) => setSok(e.target.value)}
                placeholder="Sök person"
                aria-label="Sök person"
                className={KONTROLL}
              />
              <ul className="max-h-56 overflow-y-auto rounded-sm bg-canvas/60" aria-label="Personer">
                {personer.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      aria-pressed={omfang.id === p.id}
                      onClick={() => setOmfang({ typ: "person", id: p.id })}
                      className={cn(
                        "flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left text-body",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600",
                        omfang.id === p.id ? "bg-surface font-semibold text-ink-900" : "text-ink-700 hover:bg-surface/70",
                      )}
                    >
                      <span className="truncate">{p.namn}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-small text-ink-500">{k.nivaer.find((n) => n.id === p.niva)?.namn}</span>
                        {p.av > 0 && <Badge ton="warn">{p.av} av</Badge>}
                      </span>
                    </button>
                  </li>
                ))}
                {personer.length === 0 && <li className="px-3 py-3 text-small text-ink-500">Ingen träff.</li>}
              </ul>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          titel={rubrik}
          beskrivning={
            omfang.typ === "person"
              ? "Det du stänger här stänger personen inte själv upp igen."
              : "Ärv betyder att nästa lager bestämmer, till slut navets standard."
          }
        />
        <Flikrad
          etikett="Kanal"
          valt={kanal}
          onVal={(id) => setKanal(id as Kanal)}
          flikar={k.kanaler.map((c) => ({ id: c.id, etikett: c.namn, antal: antalPer(c.id) }))}
        />
        <p className="mt-2 text-small text-ink-500">{KANAL_TEXT[kanal]}</p>

        <div className="mt-3">
          {kanal === "morgon" ? (
            <Matare
              pa={antalPer("morgon")}
              av={k.avsnitt.length}
              etikett={`${antalPer("morgon")} av ${k.avsnitt.length} avsnitt på`}
            />
          ) : (
            (() => {
              const r = raknaOmraden(lager, kanal, k, true);
              return <Matare pa={r.pa} av={r.av} etikett={`${r.pa} av ${r.av} områden på`} />;
            })()
          )}
        </div>

        <ul className="mt-3 divide-y divide-canvas">
          <Rad
            namn="Hela kanalen"
            undertext="Gäller allt som inte har en egen ruta nedan."
            varde={nyckelVarde(regler, kanal, "*")}
            onVal={(v) => satt(kanal, "*", v)}
            etikett={`${rubrik}, hela kanalen`}
          />
          {kanal === "morgon"
            ? k.avsnitt.map((a) => (
                <Rad
                  key={a.id}
                  namn={a.namn}
                  varde={nyckelVarde(regler, "morgon", `avsnitt:${a.id}`)}
                  utfall={arvs(arvLager, "morgon", avsnittNycklar(a.id), true)}
                  onVal={(v) => satt("morgon", `avsnitt:${a.id}`, v)}
                  etikett={`${rubrik}, ${a.namn}`}
                />
              ))
            : omradenI(k, kanal).map((o) => (
                <OmradeRad key={o.id} o={o} kanal={kanal} regler={regler} lager={lager} arvLager={arvLager} satt={satt} rubrik={rubrik} />
              ))}
        </ul>
      </Card>

      {person && (
        <Card>
          <CardHeader
            titel={`Det ${person.namn.split(" ")[0]} stängt själv`}
            beskrivning="Personens egna val. De syns här men ändras bara av personen."
          />
          {egenAv.length === 0 ? (
            <p className="text-small text-ink-500">Inget. Personen har lämnat allt som det är.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {egenAv.map((e) => (
                <li key={`${e.kanal}-${e.nyckel}`}>
                  <Badge ton="neutral">
                    {k.kanaler.find((c) => c.id === e.kanal)?.namn}: {nyckelNamn(k, e.nyckel)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

function Rad({
  namn,
  undertext,
  varde,
  utfall,
  onVal,
  etikett,
  indrag = false,
}: {
  namn: string;
  undertext?: string;
  varde: boolean | null;
  /** Vad rutan ger just nu när den står på Ärv: bara för sorter och avsnitt. */
  utfall?: boolean;
  onVal: (v: boolean | null) => void;
  etikett: string;
  indrag?: boolean;
}) {
  return (
    <li className={cn("flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2", indrag && "pl-3")}>
      <span className="min-w-0 flex-1">
        <span className="block text-body text-ink-900">{namn}</span>
        {(undertext || (utfall !== undefined && varde === null)) && (
          <span className="block text-small text-ink-500">
            {undertext ?? `Ärver: ${utfall ? "på" : "av"}`}
          </span>
        )}
      </span>
      <Tri varde={varde} onVal={onVal} etikett={etikett} />
    </li>
  );
}

function OmradeRad({
  o,
  kanal,
  regler,
  lager,
  arvLager,
  satt,
  rubrik,
}: {
  o: Omrade;
  kanal: Kanal;
  regler: Regler;
  lager: Personlager;
  arvLager: Personlager;
  satt: (k: Kanal, nyckel: string, v: boolean | null) => void;
  rubrik: string;
}) {
  const [oppen, setOppen] = useState(false);
  const r = raknaOmrade(lager, kanal, o, true);
  const egna = sorterI(o, kanal).filter((s) => nyckelVarde(regler, kanal, `sort:${s.id}`) !== null).length;

  return (
    <li>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1">
        <button
          type="button"
          aria-expanded={oppen}
          onClick={() => setOppen(!oppen)}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
        >
          <Veck oppen={oppen} />
          <span className="min-w-0">
            <span className="block text-body text-ink-900">{o.namn}</span>
            <span className="tnum block text-small text-ink-500">
              {r.pa} av {r.av} på{egna > 0 ? ` · ${egna} egen${egna === 1 ? "" : "a"}` : ""}
            </span>
          </span>
        </button>
        <Tri
          varde={nyckelVarde(regler, kanal, `omrade:${o.id}`)}
          onVal={(v) => satt(kanal, `omrade:${o.id}`, v)}
          etikett={`${rubrik}, ${o.namn}`}
        />
      </div>
      {oppen && (
        <ul className="mb-2 ml-6 divide-y divide-canvas border-l border-canvas pl-3">
          {sorterI(o, kanal).map((s) => (
            <Rad
              key={s.id}
              namn={s.namn}
              varde={nyckelVarde(regler, kanal, `sort:${s.id}`)}
              utfall={arvs(arvLager, kanal, sortNycklar(o.id, s.id), s.standard[kanal] ?? false)}
              onVal={(v) => satt(kanal, `sort:${s.id}`, v)}
              etikett={`${rubrik}, ${s.namn}`}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
