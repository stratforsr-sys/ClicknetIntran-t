import type { ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { LAGE_ETIKETT, LAGE_TON, TYP_ETIKETT, dagarKvar, type Uppgiftslage, type Uppgiftstyp } from "@/lib/coachning";

/**
 * En uppgift ritad pa tva satt, ur EN komponent.
 *
 * INGEN "use client" HAR, med flit. Filen har inga hookar och ingen server-only
 * import, sa den gar att rendera bade fran lagvyns klientkomponent och fran
 * personkortets serverkomponent. Tva komponenter som ritar samma uppgift hade
 * glidit isar vid forsta andringen, och da hade samma uppgift sett olika ut pa
 * tva sidor i samma modul.
 *
 * TVA MARKEN, INTE ETT. Laget och forseningen ar tva sanningar om samma rad —
 * en uppgift kan vara bade underkand OCH forsenad — och `lageFor()` respektive
 * `forsenad()` svarar pa var sin fraga just darfor. Vyn far inte vaga ihop dem.
 */
export type Kortuppgift = {
  id: string;
  title: string;
  kind: Uppgiftstyp;
  lage: Uppgiftslage;
  forsenad: boolean;
  due_date: string | null;
  fokus: string[];
  /** Ligger den och vantar pa just DIN bock? Bara lagvyn vet det. */
  kraverDinBock?: boolean;
};

/**
 * Kompakt rad — den form uppgifterna har inuti ett personkort i lagvyn.
 *
 * Uppgiftstypen star INTE har. Ett personkort med fem uppgifter far fem rader,
 * och "Utbildning" pa var och en av dem sager ingenting om vad som behover
 * goras. Typen finns pa uppgiftssidan, dar den betyder nagot.
 */
export function Uppgiftsrad({ u }: { u: Kortuppgift }) {
  return (
    <li>
      <Link
        href={`/coachning/uppgift/${u.id}`}
        className="flex flex-col gap-1 rounded-sm px-3 py-2 hover:bg-canvas"
      >
        <span className="text-small font-semibold text-ink-900">{u.title}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          {u.kraverDinBock && <Badge ton="accent">Väntar på din bock</Badge>}
          {u.forsenad ? (
            <Badge ton="danger">Försenad</Badge>
          ) : (
            <Badge ton={LAGE_TON[u.lage]}>{LAGE_ETIKETT[u.lage]}</Badge>
          )}
          {u.due_date && <span className="tnum text-small text-ink-500">{u.due_date}</span>}
        </span>
      </Link>
    </li>
  );
}

/**
 * Eget kort — den form uppgifterna har pa personkortet, och det ar den formen
 * saljaren moter nar hon oppnar sin egen coachning.
 *
 * Har far typen och fokusomradena plats: det ar EN persons uppgifter pa en hel
 * sida, inte tio personers i ett rutnat.
 */
export function Uppgiftskort({ u, fotnot }: { u: Kortuppgift; fotnot?: ReactNode }) {
  const kvar = dagarKvar(u.due_date);
  const bradskar = kvar !== null && !u.forsenad && u.lage !== "klar" && kvar <= 7;

  return (
    <li>
      <Link
        href={`/coachning/uppgift/${u.id}`}
        className={[
          "lift flex h-full flex-col gap-2 rounded-md bg-surface p-4 shadow-elev-1",
          u.forsenad
            ? "border-l-[3px] border-l-danger"
            : u.lage === "underkand"
              ? "border-l-[3px] border-l-danger"
              : u.lage === "inlamnad"
                ? "border-l-[3px] border-l-warn"
                : "border-l-[3px] border-l-transparent",
        ].join(" ")}
      >
        <span className="font-semibold text-ink-900">{u.title}</span>

        <span className="flex flex-wrap items-center gap-1.5">
          <Badge ton={LAGE_TON[u.lage]}>{LAGE_ETIKETT[u.lage]}</Badge>
          {u.forsenad && <Badge ton="danger">Försenad</Badge>}
        </span>

        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-ink-500">
          <span>{TYP_ETIKETT[u.kind]}</span>
          {u.due_date && (
            <span className="tnum">
              {u.due_date}
              {bradskar && ` · ${kvar} dagar kvar`}
            </span>
          )}
        </span>

        {u.fokus.length > 0 && (
          <span className="flex flex-wrap gap-1.5 pt-1">
            {u.fokus.map((f) => (
              <Badge key={f} ton="info">
                {f}
              </Badge>
            ))}
          </span>
        )}

        {/* Historiken skriver ut VEM som kvitterade och NAR har. Det ar hela
            skalet till att `bygg()` hamtar `by_employee_id`: en avslutad
            uppgift utan avsandare ar en bock utan ansvarig, och da gar den
            inte att anvanda som underlag for nagonting. */}
        {fotnot && <span className="mt-auto pt-1 text-small text-ink-500">{fotnot}</span>}
      </Link>
    </li>
  );
}
