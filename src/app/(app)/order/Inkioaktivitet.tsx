"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notis } from "@/components/ui/Notis";
import { cn } from "@/components/ui/cn";
import { INKIO_STANDARD_URL, aktivitetsdelar } from "@/lib/crm/inkio-mappning";
// Typimport: inkio.ts ar server-only. Se samma kommentar i Kundkort.tsx.
import type { Aktivitetsrad } from "@/lib/crm/inkio";
import { hamtaInkioAktivitet } from "./actions";

/**
 * Kundkortets flik "Aktivitet" (Inkio, varv 3).
 *
 * =============================================================================
 * ALLT SOM HÄNT MED KUNDEN I INKIO, PÅ ETT STÄLLE
 *
 * Beställaren 2026-10-07: "allt som händer med kunden i inkio ska in där, så
 * alla anteckningar och exakt allt annat … säljaren som har kunden ska kunna
 * se all aktivitet".
 *
 * Kundens egen tidslinje och tidslinjen för varje order, avtal, faktura och
 * ärende på kunden, i en lista, nyast först, grupperad per dag. Läses från
 * Inkio när fliken öppnas — inte i förväg, och inte ur en kopia: det som står
 * här är det som står i Inkio nu.
 *
 * ANTECKNINGARNA STÅR UT. Det är där det viktiga står ("Uppsagt med mig,
 * förlängs inte!!") — händelserna ("skickade in order …") är bakgrund.
 * Filtret överst gör det möjligt att se bara det ena.
 * =============================================================================
 */

type Svar = Awaited<ReturnType<typeof hamtaInkioAktivitet>>;
type Filter = "allt" | "anteckningar" | "handelser";

const DAG = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", weekday: "long", day: "numeric", month: "long", year: "numeric" });
const KLOCKA = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" });
const DAGNYCKEL = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" });

export function Inkioaktivitet({ orderId }: { orderId: string }) {
  const [svar, setSvar] = useState<Svar | null>(null);
  const [laddar, setLaddar] = useState(false);
  const [filter, setFilter] = useState<Filter>("allt");
  // Ökas av "Uppdatera" — effekten läser om när den ändras.
  const [varv, setVarv] = useState(0);

  // Samma mönster som kökortet: tillståndet sätts bara när svaret kommit, och
  // ett svar för en kund man redan lämnat kastas.
  useEffect(() => {
    let aktuell = true;
    hamtaInkioAktivitet(orderId).then((d) => {
      if (!aktuell) return;
      setSvar(d);
      setLaddar(false);
    });
    return () => {
      aktuell = false;
    };
  }, [orderId, varv]);

  const hamta = () => {
    setLaddar(true);
    setVarv((v) => v + 1);
  };

  if (!svar) return <p className="text-small text-ink-500">Hämtar från Inkio …</p>;
  if ("fel" in svar) {
    return (
      <div className="flex flex-col gap-3">
        <Notis ton="danger">{svar.fel}</Notis>
        <div>
          <Button type="button" size="sm" variant="sekundar" laddar={laddar} onClick={hamta}>
            Försök igen
          </Button>
        </div>
      </div>
    );
  }
  if ("ejKopplat" in svar) {
    return <EmptyState rubrik="Inkio är inte kopplat" text="Nycklarna till Inkio saknas i den här miljön." />;
  }
  if (svar.kund === null) {
    return (
      <EmptyState
        rubrik="Kunden finns inte i Inkio"
        text="Inget bolag i Inkio har det här organisationsnumret. Kunden läggs in där när ordern godkänns."
      />
    );
  }

  const { kund, rader, avkortad } = svar;
  const anteckningar = rader.filter((r) => r.anteckning).length;
  const synliga = rader.filter((r) => filter === "allt" || (filter === "anteckningar") === r.anteckning);

  // Per dag, i den ordning raderna redan står (nyast först).
  const dagar: { nyckel: string; rubrik: string; rader: Aktivitetsrad[] }[] = [];
  for (const r of synliga) {
    const d = new Date(r.nar);
    const nyckel = DAGNYCKEL.format(d);
    const sista = dagar[dagar.length - 1];
    if (sista?.nyckel === nyckel) sista.rader.push(r);
    else dagar.push({ nyckel, rubrik: DAG.format(d), rader: [r] });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-small text-ink-500">
          Allt som hänt med {kund.namn} i Inkio ·{" "}
          <a href={kund.lank} target="_blank" rel="noreferrer" className="text-brand-ink underline-offset-2 hover:underline">
            Öppna {kund.nummer} i Inkio ↗
          </a>
        </p>
        <Button type="button" size="sm" variant="diskret" laddar={laddar} onClick={hamta}>
          Uppdatera
        </Button>
      </div>

      <div role="group" aria-label="Visa" className="flex flex-wrap gap-1">
        {(
          [
            ["allt", `Allt ${rader.length}`],
            ["anteckningar", `Anteckningar ${anteckningar}`],
            ["handelser", `Händelser ${rader.length - anteckningar}`],
          ] as [Filter, string][]
        ).map(([id, etikett]) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
            className={cn(
              "min-h-9 rounded-full px-3 text-small transition-colors duration-fast ease-brand",
              filter === id ? "bg-surface font-semibold text-ink-900 shadow-elev-1" : "text-ink-500 hover:text-ink-900",
            )}
          >
            {etikett}
          </button>
        ))}
      </div>

      {synliga.length === 0 ? (
        <EmptyState
          rubrik={filter === "anteckningar" ? "Inga anteckningar" : "Ingenting än"}
          text={filter === "anteckningar" ? "Ingen har skrivit något om kunden i Inkio." : "Det har inte hänt något med kunden i Inkio."}
        />
      ) : (
        <ol className="flex flex-col gap-5">
          {dagar.map((d) => (
            <li key={d.nyckel}>
              <p className="mb-2 text-micro uppercase text-ink-500">{d.rubrik}</p>
              <ol className="flex flex-col gap-2">
                {d.rader.map((r) => (
                  <Rad key={r.id} r={r} />
                ))}
              </ol>
            </li>
          ))}
        </ol>
      )}

      {avkortad && (
        <p className="text-small text-ink-500">
          Kunden har fler poster än Nav läser på en gång. Resten finns i{" "}
          <a href={kund.lank} target="_blank" rel="noreferrer" className="underline">
            Inkio
          </a>
          .
        </p>
      )}
    </div>
  );
}

function Rad({ r }: { r: Aktivitetsrad }) {
  const delar = aktivitetsdelar(r.text, INKIO_STANDARD_URL);
  const kalla = r.kalla.lank ? (
    <a href={r.kalla.lank} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
      {r.kalla.etikett} ↗
    </a>
  ) : (
    r.kalla.etikett
  );

  return (
    <li
      className={cn(
        "rounded-md px-4 py-3",
        r.anteckning ? "border-l-[3px] border-warn bg-surface shadow-elev-1" : "bg-surface-alt",
      )}
    >
      <p className="flex flex-wrap items-baseline gap-x-2 text-micro text-ink-500">
        <span className={cn(r.anteckning && "font-semibold text-ink-900")}>{r.vem}</span>
        <span className="tnum">{KLOCKA.format(new Date(r.nar))}</span>
        <span>· {kalla}</span>
        {r.anteckning && <span className="uppercase">· Anteckning</span>}
      </p>
      <p className={cn("mt-1 whitespace-pre-wrap break-words", r.anteckning ? "text-body text-ink-900" : "text-small text-ink-700")}>
        {delar.map((d, i) =>
          d.lank ? (
            <a key={i} href={d.lank} target="_blank" rel="noreferrer" className="text-brand-ink underline-offset-2 hover:underline">
              {d.text}
            </a>
          ) : (
            <span key={i}>{d.text}</span>
          ),
        )}
      </p>
    </li>
  );
}
