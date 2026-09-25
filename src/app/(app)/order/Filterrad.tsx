"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Ikon } from "@/components/shell/Ikon";
import { cn } from "@/components/ui/cn";
import { manadsnamn } from "@/lib/provision";
import {
  STATUSVAL,
  STATUSVAL_ETIKETT,
  TOMT_FILTER,
  filtretSomFraga,
  harFilter,
  manadsval,
  rensaSok,
  type Orderfilter,
  type Statusval,
  type Tidsval,
} from "@/lib/ordervy";

/**
 * Filterraden.
 *
 * =============================================================================
 * FILTRET BOR I ADRESSEN, OCH DET AR DARFOR DEN HAR KOMPONENTEN FINNS.
 *
 * Bestallaren 2026-09-25: *"jag vill att alla ordrar ska kunna filtreras per
 * person, per datum, manad eller alla ordrar"*.
 *
 * "Alla ordrar" gar inte att halla i webblasaren. Sidan hamtade tolv manader
 * bakat, och ett filter over den bunten hade gjort "alla" till "alla av de tolv
 * manaderna" — ett ord som lovar mer an det haller, och den varsta sortens fel:
 * ett som ser ut som ett svar. Filtret gar darfor till DATABASEN, och da maste
 * det ligga i adressen: en serverkomponent lases om, och lasningen behover veta
 * vad som ar valt.
 *
 * Att det ligger dar ger tva saker gratis som ett tillstand i webblasaren inte
 * hade gett: filtret GAR ATT DELA — "kolla Annas september" ar en lank — och det
 * OVERLEVER en omladdning, ett byte till kundkortet och tillbaka, och
 * bakatknappen.
 * =============================================================================
 *
 * =============================================================================
 * ALLA BYTEN AR `replace`, INGET AR `push`.
 *
 * Ett filterbyte ar inte en plats man varit pa. Hade varje chip lagt ett steg i
 * historiken hade fyra klick i raden krävt fyra tryck pa bakatknappen for att
 * komma tillbaka till sidan man kom ifran — och den som provar sig fram i en
 * filterrad klickar garna tio ganger.
 *
 * Det ar ocksa vad som gor `Svavruta`s stangning ren: rutan lagger ETT steg med
 * `push` (lanken pa kortet), och det steget ar det enda som star mellan listan
 * och historiken bakom den.
 * =============================================================================
 */
export function Filterrad({
  filter,
  personer,
  /** Antalet som vantar pa godkannande. Noll ritar ingen raknare pa chipet. */
  ko,
  mig,
  idag,
  /** Sant for den som far se andras order. Styr om personvaljaren ritas alls. */
  hanterare,
}: {
  filter: Orderfilter;
  personer: { id: string; namn: string }[];
  ko: number;
  mig: string;
  idag: string;
  hanterare: boolean;
}) {
  const router = useRouter();
  const [vantar, starta] = useTransition();

  const ga = (nytt: Orderfilter) => {
    starta(() => {
      // `scroll: false`: den som filtrerar star kvar dar hen star. Ett hopp till
      // sidans borjan vid varje chip hade gjort raden obrukbar langre ner.
      router.replace(`/order${filtretSomFraga(nytt)}`, { scroll: false });
    });
  };

  // Casten behovs: med en GENERISK nyckel harleder TypeScript den beraknade
  // egenskapen som `string` och far da ett indexsignaturobjekt i stallet for
  // `Orderfilter`. Nyckeln ar anda begransad till `keyof Orderfilter` av
  // signaturen, sa castet bekraftar bara det anropet redan garanterar. Samma
  // falla och samma losning som `satt` i `Nyorder.tsx`.
  const satt = <K extends keyof Orderfilter>(nyckel: K, varde: Orderfilter[K]) =>
    ga({ ...filter, [nyckel]: varde } as Orderfilter);

  // ---------------------------------------------------------------------------
  // SOKFALTET AR EGET TILLSTAND, och det maste det vara.
  //
  // Faltet skickar en serverfraga, och en fraga per tangenttryck ar bade
  // slosaktigt och trasigt: svaren kommer i fel ordning och listan hoppar. Det
  // skrivna ligger darfor lokalt, och adressen uppdateras forst nar det stat
  // still i 350 ms.
  //
  // Varden nedan halls med `filter.sok` som utgangspunkt men FOLJER den inte:
  // foljde den hade varje serversvar skrivit tillbaka i faltet mitt i att nagon
  // skrev. Undantaget ar nar filtret nollstalls utifran, och det fangas av
  // jamforelsen i effekten.
  // ---------------------------------------------------------------------------
  const [sok, setSok] = useState(filter.sok);
  const senast = useRef(filter.sok);

  useEffect(() => {
    // Nollstallningen kommer utifran ("Rensa filtret"). Da ska faltet folja med.
    if (filter.sok !== senast.current) {
      senast.current = filter.sok;
      setSok(filter.sok);
    }
  }, [filter.sok]);

  useEffect(() => {
    const rensat = rensaSok(sok);
    if (rensat === filter.sok) return;

    const id = setTimeout(() => {
      senast.current = rensat;
      ga({ ...filter, sok: rensat });
    }, 350);

    return () => clearTimeout(id);
    // `ga` och `filter` ar stabila nog: bada harleds ur props, och en andring i
    // dem ska ocksa starta om vantan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sok, filter.sok]);

  const manader = manadsval(idag);

  return (
    <div
      aria-busy={vantar || undefined}
      className={cn(
        "flex flex-col gap-3 rounded-md bg-surface p-3 shadow-elev-1 sm:p-4",
        // Den enda ateraterkopplingen pa att en fraga ar ute. Hela raden tonas
        // en gnutta i stallet for att en snurra laggs till nagonstans: det ar
        // LISTAN som byts, och tonen sager "det du ser ar pa vag att bli
        // gammalt" utan att flytta nagonting.
        "transition-opacity duration-base ease-brand",
        vantar && "opacity-60",
      )}
    >
      {/* ------------------------------------------------------------------ */}
      {/* Rad ett: statuslagena som chips. Kon ar ett av dem.                */}
      {/* ------------------------------------------------------------------ */}
      <div
        role="group"
        aria-label="Status"
        className="nav-scroll -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5"
      >
        {STATUSVAL.map((s) => (
          <Chip
            key={s}
            valt={filter.status === s}
            onClick={() => satt("status", s as Statusval)}
            raknare={s === "vantar" ? ko : 0}
          >
            {STATUSVAL_ETIKETT[s]}
          </Chip>
        ))}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Rad tva: person, tid och sokning.                                  */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-2">
        {/*
          PERSONVALJAREN RITAS BARA FOR DEN SOM FAR SE ANDRA.
          En rullgardin med ett enda namn i ar inte ett val, den ar en upplysning
          om att det finns ett val man inte har. RLS ger saljaren bara sina egna
          order anda, sa listan hade kommit tillbaka tom.
        */}
        {hanterare && personer.length > 0 && (
          <label className="flex items-center gap-2">
            <span className="sr-only">Säljare</span>
            <select
              value={filter.vem}
              onChange={(e) => satt("vem", e.target.value)}
              className={VALJARE}
            >
              <option value="alla">Alla säljare</option>
              {/*
                "Mina order" star forst och EN gang. Den inloggade plockas
                darfor bort ur listan nedan: sales_manager har inte alltid rollen
                `salesperson` och saknas da i `personer`, sa genvagen behovs —
                men tva poster med samma varde hade last som tva olika val, och
                webblasaren hade valt den som rakade sta forst.
              */}
              <option value={mig}>Mina order</option>
              <option disabled>──────────</option>
              {personer
                .filter((p) => p.id !== mig)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.namn}
                  </option>
                ))}
            </select>
          </label>
        )}

        <Tidsvaljare tid={filter.tid} manader={manader} idag={idag} satt={(t) => satt("tid", t)} />

        <label className="relative min-w-40 flex-1">
          <span className="sr-only">Sök kund</span>
          <Ikon
            namn="sok"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-300"
          />
          <input
            type="search"
            value={sok}
            onChange={(e) => setSok(e.target.value)}
            placeholder="Sök bolagsnamn …"
            className={cn(VALJARE, "w-full pl-9")}
          />
        </label>

        {harFilter(filter) && (
          <button
            type="button"
            onClick={() => ga(TOMT_FILTER)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-small text-ink-500 transition-colors duration-fast hover:bg-canvas hover:text-ink-900"
          >
            <Ikon namn="kryss" className="size-4" />
            Rensa
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Faltens utseende.
 *
 * Star som en konstant och inte som `KONTROLL` fran `ui/Field`: den ar byggd for
 * ett FORMULAR — full bredd, hog inre marginal, elev-1 — och en filterrad med
 * fem sadana falt blir en trappa av vita lador. Har ar falten smala, laga och
 * ligger i samma yta som chipsen.
 */
const VALJARE =
  "min-h-9 rounded-full bg-canvas px-3 text-small text-ink-900 " +
  "ring-1 ring-transparent transition-shadow duration-fast ease-brand " +
  "placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-brand-600";

function Chip({
  valt,
  onClick,
  raknare,
  children,
}: {
  valt: boolean;
  onClick: () => void;
  /** Noll ritar ingen raknare. Se `Counter` — en nolla ar inget att handla pa. */
  raknare?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={valt}
      className={cn(
        "inline-flex min-h-9 shrink-0 items-center gap-2 rounded-full px-4 text-small whitespace-nowrap",
        "transition-colors duration-fast ease-brand",
        valt
          ? "bg-brand-600 font-semibold text-ink-inv shadow-elev-brand"
          : "bg-canvas text-ink-500 hover:text-ink-900",
      )}
    >
      {children}
      {raknare && raknare > 0 ? (
        <span
          className={cn(
            "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-micro tabular-nums",
            valt ? "bg-brand-800 text-brand-100" : "bg-accent text-accent-ink",
          )}
        >
          {raknare > 99 ? "99+" : raknare}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Tiden, i tre lagen.
 *
 * =============================================================================
 * LAGET VALJS FORST, VARDET SEDAN — OCH RUTAN FOR VARDET RITAS BARA I SITT LAGE.
 *
 * Forsta utkastet hade en manadsrullgardin OCH ett datumfalt bredvid varandra,
 * bada alltid synliga. Det gar inte att lasa: tva falt som kan motsaga varandra
 * later fragan "vad galler om jag fyller i bada" sta obesvarad i granssnittet.
 *
 * Nu ar de tre lagena ett val, och det valda laget far sitt falt. Att byta till
 * `Månad` valjer dessutom INNEVARANDE manad direkt i stallet for att lamna en
 * tom rullgardin — ett lage utan varde ar samma sak som inget lage, och da hade
 * knappen inte gjort nagot synligt.
 * =============================================================================
 */
function Tidsvaljare({
  tid,
  manader,
  idag,
  satt,
}: {
  tid: Tidsval;
  manader: string[];
  idag: string;
  satt: (t: Tidsval) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div role="group" aria-label="Tidsintervall" className="flex rounded-full bg-canvas p-0.5">
        <Lage valt={tid.slag === "alla"} onClick={() => satt({ slag: "alla" })}>
          Alla
        </Lage>
        <Lage
          valt={tid.slag === "manad"}
          onClick={() => satt({ slag: "manad", manad: manader[0] })}
        >
          Månad
        </Lage>
        <Lage valt={tid.slag === "dag"} onClick={() => satt({ slag: "dag", datum: idag })}>
          Datum
        </Lage>
      </div>

      {tid.slag === "manad" && (
        <label>
          <span className="sr-only">Månad</span>
          <select
            value={tid.manad}
            onChange={(e) => satt({ slag: "manad", manad: e.target.value })}
            className={VALJARE}
          >
            {manader.map((m) => (
              <option key={m} value={m}>
                {manadsnamn(m)}
              </option>
            ))}
          </select>
        </label>
      )}

      {tid.slag === "dag" && (
        <label>
          <span className="sr-only">Datum</span>
          <input
            type="date"
            value={tid.datum}
            max={idag}
            onChange={(e) =>
              // Ett tomt datumfalt ar inte ett datum. Webblasaren lamnar varden
              // tom medan man skriver i den, och en fraga pa "" hade gett noll
              // rader mitt i inmatningen.
              e.target.value ? satt({ slag: "dag", datum: e.target.value }) : undefined
            }
            className={cn(VALJARE, "tnum")}
          />
        </label>
      )}
    </div>
  );
}

function Lage({
  valt,
  onClick,
  children,
}: {
  valt: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={valt}
      className={cn(
        "min-h-8 rounded-full px-3 text-small whitespace-nowrap transition-colors duration-fast ease-brand",
        valt ? "bg-surface font-semibold text-ink-900 shadow-elev-1" : "text-ink-500 hover:text-ink-900",
      )}
    >
      {children}
    </button>
  );
}
