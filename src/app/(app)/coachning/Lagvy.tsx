"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { KONTROLL } from "@/components/ui/Field";
import { Ikon } from "@/components/shell/Ikon";
import { behoverNagot, larmar } from "@/lib/coachning";
import { NyUppgift } from "./NyUppgift";
import { TillampaMall } from "./TillampaMall";
import { Uppgiftsrad, type Kortuppgift } from "./Uppgiftskort";

/**
 * Lagvyn som RUTNAT AV PERSONKORT.
 *
 * Fram till 2026-09-02 var det har en tabell dar varje person hade en siffra i
 * kolumnen "Oppna uppgifter". Siffran gick inte att handla pa: den sa att Anna
 * hade tre saker pa sig, inte VILKA tre, sa chefen fick klicka in pa var person
 * for att komma at det vyn redan hade hamtat. Nio klick for att se lagets lage.
 *
 * Nu star uppgifterna pa kortet. `hamtaLag()` slutade kasta bort dem, och det
 * kostade noll extra databasfragor — de var redan hamtade och redan raknade.
 *
 * VYN VISAR VEM SOM BEHOVER NAGOT — INTE VEM SOM AR SAMST. Den barande regeln
 * ar oforandrad fran tabellen och galler lika mycket i kortform: inga poang,
 * ingen placering, ingen jamforelse mellan personer. Det ar samma linje som
 * 0029 drog for adoptionen, och skalet ar detsamma — en lista som rangordnar
 * kollegor anvands till nagot annat an det den byggdes for. Darfor star inte
 * K&V-poangen har heller: sex tal per kort blir en topplista vare sig nagon
 * vill det eller inte. De hor hemma pa personkortet, dar de galler EN person.
 */

export type Kortperson = {
  employee_id: string;
  namn: string;
  team: string | null;
  start_date: string | null;
  dagarSedan: number | null;
  forsenade: number;
  vantarPaMig: number;
  fokus: string[];
  uppgifter: Kortuppgift[];
};

type Filter = "alla" | "behover" | "vantar";

export function Lagvy({
  personer,
  kollegor,
  kurser,
  moduler,
  dokument,
  fokus,
  mallar,
  idag,
}: {
  personer: Kortperson[];
  kollegor: { id: string; namn: string }[];
  kurser: { id: string; title: string }[];
  moduler: { id: string; title: string }[];
  dokument: { id: string; title: string; doc_type: string }[];
  fokus: { id: string; label: string }[];
  mallar: { id: string; name: string; moment: number }[];
  idag: string;
}) {
  const [sok, setSok] = useState("");
  const [filter, setFilter] = useState<Filter>("alla");

  /**
   * ETT OPPET FORMULAR I HELA RUTNATET, och det ar inte en smaksak.
   *
   * `NyUppgift` sätter fasta id-attribut pa sina falt — `title`, `kind`,
   * `due_date` och sex till — for att `<label htmlFor>` ska koppla ihop
   * etiketten med faltet. Lag oppet-laget i varje kort for sig kunde tva kort
   * vara oppna samtidigt, och da fanns id:t `title` tva ganger i dokumentet.
   * Da pekar bada etiketterna pa det FORSTA faltet: en skarmlasare laser fel
   * rubrik, och ett klick pa etiketten i det nedre kortet flyttar markoren till
   * det ovre. Med laget har kan bara ett kort vara oppet, och id:na ar unika.
   */
  const [oppet, setOppet] = useState<{ id: string; vad: "uppgift" | "mall" } | null>(null);

  const antalBehover = personer.filter(behoverNagot).length;
  const antalVantar = personer.filter((p) => p.vantarPaMig > 0).length;

  /**
   * FILTRET AR EN VY, INTE EN FRAGA. All data ar redan hamtad och redan
   * behorighetsprovad av RLS — det som filtreras bort har ar rader den
   * inloggade far se men just nu inte vill titta pa. Att stalla om fragan mot
   * databasen for det hade varit en ny rundtur for ett svar vi redan har.
   */
  const synliga = useMemo(() => {
    const fras = sok.trim().toLowerCase();
    return personer.filter((p) => {
      if (filter === "behover" && !behoverNagot(p)) return false;
      if (filter === "vantar" && p.vantarPaMig === 0) return false;
      if (!fras) return true;
      // Uppgiftsrubrikerna soks igenom ocksa. Den som minns "manuset" men inte
      // vem det gallde ska hitta kortet anda.
      return [p.namn, p.team ?? "", ...p.uppgifter.map((u) => u.title)]
        .join(" ")
        .toLowerCase()
        .includes(fras);
    });
  }, [personer, sok, filter]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="lagsok" className="sr-only">
          Sök person eller uppgift
        </label>
        <input
          id="lagsok"
          type="search"
          value={sok}
          onChange={(e) => setSok(e.target.value)}
          placeholder="Sök person, team eller uppgift"
          className={`${KONTROLL} max-w-xs`}
        />

        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrera laget">
          <Filterknapp vald={filter === "alla"} onClick={() => setFilter("alla")}>
            Alla ({personer.length})
          </Filterknapp>
          <Filterknapp vald={filter === "behover"} onClick={() => setFilter("behover")}>
            Behöver något ({antalBehover})
          </Filterknapp>
          <Filterknapp vald={filter === "vantar"} onClick={() => setFilter("vantar")}>
            Väntar på din bock ({antalVantar})
          </Filterknapp>
        </div>
      </div>

      {synliga.length === 0 ? (
        <Card>
          <EmptyState
            rubrik="Ingen träff"
            text={
              filter === "alla"
                ? "Sökningen matchar ingen i laget. Prova ett annat ord."
                : "Ingen av dem du coachar hamnar i det här filtret just nu."
            }
            handling={
              <button
                type="button"
                onClick={() => {
                  setSok("");
                  setFilter("alla");
                }}
                className="text-small font-semibold text-brand-700 hover:text-brand-900"
              >
                Visa hela laget
              </button>
            }
          />
        </Card>
      ) : (
        /* Hela laget ritas. Ingen sidindelning och ingen avklippning: den som
           scrollar ska komma till botten, och en "visa fler"-knapp hade dolt
           just den person som ligger sist for att hon ar lugnast — vilket ar
           precis den som ska ga att hitta nar man letar efter henne. */
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {synliga.map((p) => (
            <Personkort
              key={p.employee_id}
              person={p}
              oppet={oppet?.id === p.employee_id ? oppet.vad : null}
              onOppna={(vad) =>
                setOppet(
                  oppet?.id === p.employee_id && oppet.vad === vad
                    ? null
                    : { id: p.employee_id, vad },
                )
              }
              kollegor={kollegor}
              kurser={kurser}
              moduler={moduler}
              dokument={dokument}
              fokus={fokus}
              mallar={mallar}
              idag={idag}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Filterknapp({
  vald,
  onClick,
  children,
}: {
  vald: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={vald}
      className={[
        "min-h-9 rounded-full px-4 text-small font-semibold transition-colors duration-fast",
        vald
          ? "bg-brand-600 text-ink-inv"
          : "bg-surface text-ink-500 shadow-elev-1 hover:text-ink-900",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/**
 * FORMULARET BYGGS FORST NAR DET OPPNAS.
 *
 * `NyUppgift` bar fyra rullgardiner — kollegor, kurser, moduler, dokument — och
 * ett rutnat med fokusomraden. Renderat i vartenda kort blir det tusentals
 * `<option>` i ett dokument dar noll av dem behovs forran nagon klickar. Med
 * `oppet` byggs det for ETT kort i taget.
 */
function Personkort({
  person,
  oppet,
  onOppna,
  kollegor,
  kurser,
  moduler,
  dokument,
  fokus,
  mallar,
  idag,
}: {
  person: Kortperson;
  oppet: null | "uppgift" | "mall";
  onOppna: (vad: "uppgift" | "mall") => void;
  kollegor: { id: string; namn: string }[];
  kurser: { id: string; title: string }[];
  moduler: { id: string; title: string }[];
  dokument: { id: string; title: string; doc_type: string }[];
  fokus: { id: string; label: string }[];
  mallar: { id: string; name: string; moment: number }[];
  idag: string;
}) {
  const akut = person.forsenade > 0;
  const vantar = person.vantarPaMig > 0;

  return (
    <li>
      <Card
        status={akut ? "danger" : vantar ? "warn" : larmar(person.dagarSedan) ? "warn" : undefined}
        className="flex h-full flex-col gap-3"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              href={`/coachning/${person.employee_id}`}
              className="text-h2 text-ink-900 hover:underline"
            >
              {person.namn}
            </Link>
            {person.team && <p className="text-small text-ink-500">{person.team}</p>}
          </div>

          {/* AC-U5.2: hur lange sedan sags alltid med ord, aldrig med enbart
              farg. "Aldrig" ar sin egen sak och inte ett stort tal. */}
          <div className="shrink-0">
            {person.dagarSedan === null ? (
              <Badge ton="danger">Aldrig coachad</Badge>
            ) : larmar(person.dagarSedan) ? (
              <Badge ton="danger">{person.dagarSedan} dagar sedan</Badge>
            ) : (
              <span className="tnum text-small text-ink-500">
                {person.dagarSedan === 0 ? "Coachad i dag" : `${person.dagarSedan} dagar sedan`}
              </span>
            )}
          </div>
        </div>

        {person.uppgifter.length === 0 ? (
          <p className="rounded-sm bg-canvas px-3 py-3 text-small text-ink-500">
            Inga öppna uppgifter.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {person.uppgifter.map((u) => (
              <Uppgiftsrad key={u.id} u={u} />
            ))}
          </ul>
        )}

        {/* Fokusomradena kommer ur de OPPNA uppgifterna och bara dem. Det som
            ar kvitterat och avslutat tranas inte langre, och en etikett som
            star kvar efter att arbetet tagit slut sager fel sak. */}
        {person.fokus.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {person.fokus.map((f) => (
              <li key={f}>
                <Badge ton="info">{f}</Badge>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          <Button
            size="sm"
            variant={oppet === "uppgift" ? "diskret" : "sekundar"}
            onClick={() => onOppna("uppgift")}
            aria-expanded={oppet === "uppgift"}
          >
            <Ikon namn="plus" className="size-4" />
            Ny uppgift
          </Button>

          {mallar.length > 0 && (
            <Button
              size="sm"
              variant={oppet === "mall" ? "diskret" : "sekundar"}
              onClick={() => onOppna("mall")}
              aria-expanded={oppet === "mall"}
            >
              Använd mall
            </Button>
          )}

          <Link
            href={`/coachning/${person.employee_id}`}
            className="ml-auto inline-flex items-center gap-1 text-small font-semibold text-brand-700 hover:text-brand-900"
          >
            Öppna
            <Ikon namn="fram" className="size-4" />
          </Link>
        </div>

        {oppet === "uppgift" && (
          <div className="border-t border-canvas pt-4">
            <NyUppgift
              assigneeId={person.employee_id}
              /* Man ar aldrig sin egen motpart. Listan kommer hel fran servern
                 och tunnas har, sa samma lista racker for hela rutnatet. */
              kollegor={kollegor.filter((k) => k.id !== person.employee_id)}
              kurser={kurser}
              moduler={moduler}
              dokument={dokument}
              fokus={fokus}
            />
          </div>
        )}

        {oppet === "mall" && (
          <div className="border-t border-canvas pt-4">
            <TillampaMall
              assigneeId={person.employee_id}
              mallar={mallar}
              /* Anstallningsdagen nar den finns: en rampplan vars frister
                 raknas fran i dag ar fel for den som borjade i mars. */
              forvaltDatum={person.start_date ?? idag}
            />
          </div>
        )}
      </Card>
    </li>
  );
}
