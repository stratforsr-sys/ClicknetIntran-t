"use client";

import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { KONTROLL } from "@/components/ui/Field";
import { Uppgiftskort, type Kortuppgift } from "../Uppgiftskort";

/**
 * Historiken — allt personen HAR gjort, inte bara det som ligger framfor henne.
 *
 * INGENTING SKRIVS OVER, och det ar poangen med att den finns. `coaching_task`
 * far aldrig en rad borttagen och `coaching_task_event` ar en logg, sa listan
 * har ar den enda platsen dar ett avbrutet forsok vager lika tungt som ett
 * klart. Det ar samma val som `course_attempt` gjorde 2026 i 0007.
 *
 * FILTRET ar tre fragor och inte fler: vad hette den, hur slutade den, och
 * vilket ar. Med ett ars drift blir listan lang, och en lang lista utan
 * ingangar ar samma sak som ingen historik alls.
 */
export type Historikpost = Kortuppgift & {
  /** "Kvitterad" eller "Avbruten" — vad som faktiskt hande sist. */
  avslutatOrd: string;
  /** YYYY-MM-DD. Null nar handelsen saknas, vilket bara galler gamla rader. */
  avslutatDatum: string | null;
  /** Namnet pa den som satte bocken. Null for de sjalvsanna typerna. */
  avslutatAv: string | null;
};

type Utfall = "alla" | "klar" | "avbruten";

export function Historik({ poster }: { poster: Historikpost[] }) {
  const [sok, setSok] = useState("");
  const [utfall, setUtfall] = useState<Utfall>("alla");
  const [ar, setAr] = useState<string>("alla");

  /**
   * Aren kommer UR datan och inte ur en lista over tankbara ar. En anstalld som
   * borjade i ar ska inte mota en rullgardin med fem tomma arsval.
   */
  const artal = useMemo(
    () =>
      [...new Set(poster.map((p) => p.avslutatDatum?.slice(0, 4)).filter(Boolean) as string[])].sort(
        (a, b) => (a < b ? 1 : -1),
      ),
    [poster],
  );

  const synliga = useMemo(() => {
    const fras = sok.trim().toLowerCase();
    return poster.filter((p) => {
      if (utfall !== "alla" && p.lage !== utfall) return false;
      if (ar !== "alla" && p.avslutatDatum?.slice(0, 4) !== ar) return false;
      if (!fras) return true;
      return [p.title, ...p.fokus].join(" ").toLowerCase().includes(fras);
    });
  }, [poster, sok, utfall, ar]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="historiksok" className="sr-only">
          Sök i historiken
        </label>
        <input
          id="historiksok"
          type="search"
          value={sok}
          onChange={(e) => setSok(e.target.value)}
          placeholder="Sök uppgift eller fokusområde"
          className={`${KONTROLL} max-w-xs`}
        />

        <label htmlFor="historikutfall" className="sr-only">
          Hur den slutade
        </label>
        <select
          id="historikutfall"
          value={utfall}
          onChange={(e) => setUtfall(e.target.value as Utfall)}
          className={`${KONTROLL} max-w-[12rem]`}
        >
          <option value="alla">Alla utfall</option>
          <option value="klar">Klara</option>
          <option value="avbruten">Avbrutna</option>
        </select>

        {artal.length > 1 && (
          <>
            <label htmlFor="historikar" className="sr-only">
              År
            </label>
            <select
              id="historikar"
              value={ar}
              onChange={(e) => setAr(e.target.value)}
              className={`${KONTROLL} max-w-[9rem]`}
            >
              <option value="alla">Alla år</option>
              {artal.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </>
        )}

        <span className="text-small text-ink-500">
          {synliga.length} av {poster.length}
        </span>
      </div>

      {synliga.length === 0 ? (
        <EmptyState
          rubrik="Ingen träff"
          text="Ingen avslutad uppgift matchar det du sökt på."
          handling={
            <button
              type="button"
              onClick={() => {
                setSok("");
                setUtfall("alla");
                setAr("alla");
              }}
              className="text-small font-semibold text-brand-700 hover:text-brand-900"
            >
              Visa hela historiken
            </button>
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {synliga.map((p) => (
            <Uppgiftskort
              key={p.id}
              u={p}
              /* "Kvitterad 2026-08-14 av Anna Andersson" — eller bara "Klar"
                 for de sjalvsanna typerna, dar ingen manniska satte nagon bock
                 och laget kommer ur certifikatet, bedomningen eller kvittensen.
                 Att hitta pa en avsandare dar hade varit att pasta att nagon
                 godkant nagot hon aldrig tittat pa. */
              fotnot={[p.avslutatOrd, p.avslutatDatum, p.avslutatAv && `av ${p.avslutatAv}`]
                .filter(Boolean)
                .join(" ")}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
