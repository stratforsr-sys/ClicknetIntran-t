"use client";

import Link from "next/link";
import { useActionState, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Ikon } from "@/components/shell/Ikon";
import { Notis } from "@/components/ui/Notis";
import { datumPlusDagar, fristtext, tidstext } from "@/lib/uppgifter";
import { dagKort, langd, veckostart } from "@/lib/kalender";
import {
  STEG,
  STEG_LEDTEXT,
  STEG_RUBRIK,
  STEG_TOMTEXT,
  foregaendeSteg,
  forfallet,
  nastaSteg,
  stannadeProjekt,
  stapelandel,
  totaltAttGaIgenom,
  utanDag,
  vantar,
  veckansDagsblock,
  type Dagsblock,
  type Genomgangsprojekt,
  type Genomgangsrad,
  type Stegantal,
  type Stegid,
} from "@/lib/genomgang";
import { avbryt, kommentera, planera, tilldela, type UppgiftState } from "../actions";
import { slutforGenomgang, type GenomgangState } from "./actions";

/**
 * Genomgången, steg för steg.
 *
 * ===========================================================================
 * FORMEN ÄR EN SPALT MED STEG OCH EN SPALT MED ARBETE
 *
 * Första utkastet la de fem stegen som en rad chips ovanför innehållet. Det
 * fungerade i en skiss och inte i bruk, av tre skäl som är värda att stå kvar
 * så att ingen ritar tillbaka det:
 *
 *   1. CHIPSEN SADE INTE VAR MAN VAR PÅ VÄG. Fem likadana piller i rad läses
 *      som filtrerknappar, inte som en väg med en början och ett slut — och en
 *      genomgång som inte ser ut att ta slut är en genomgång man överger.
 *
 *   2. VARJE RAD BAR SJU KONTROLLER. Tre dagknappar, ett datumfält, en
 *      flyttaknapp, "ta den själv" och "stryk" — gånger sex rader blev
 *      fyrtiotvå träffytor i samma storlek och färg. Det är inte en genomgång,
 *      det är ett kontrollrum.
 *
 *   3. INGENTING SADE ATT ETT STEG VAR KLART. Ett steg som betats av såg
 *      likadant ut som ett man inte öppnat.
 *
 * Nu: en STEGSPALT till vänster som är en väg — numrerad, avbockad när den är
 * tom, med kvittoknappen alltid synlig i foten — och en ARBETSSPALT till höger
 * där varje rad har EN tydlig handling (vilken dag?) och resten undanställt.
 *
 * ===========================================================================
 * STEGET LIGGER I KOMPONENTENS TILLSTÅND OCH INTE I ADRESSEN
 *
 * `?steg=inkorg` hade gjort varje steg länkbart. Men varje handling i ett steg
 * är en server action som revaliderar sidan, och en adress hade då behövt bäras
 * genom varje omladdning för att man inte skulle kastas tillbaka till steg ett
 * efter varje klick. Tillståndet överlever revalideringen gratis.
 * ===========================================================================
 */
export function Genomgang({
  rader,
  projekt,
  namn,
  mig,
  idag,
  antal,
  redanGjord,
  nastaVeckansDagar: veckansDagar,
  nastaVeckansNummer,
}: {
  rader: Genomgangsrad[];
  projekt: Genomgangsprojekt[];
  namn: Record<string, string>;
  mig: string;
  idag: string;
  antal: Stegantal;
  redanGjord: boolean;
  nastaVeckansDagar: string[];
  nastaVeckansNummer: number;
}) {
  const [steg, setSteg] = useState<Stegid>(forstaOgjorda(antal));
  const [state, slutfor, vantarPaKvitto] = useActionState<GenomgangState, FormData>(
    slutforGenomgang,
    {},
  );

  const forra = foregaendeSteg(steg);
  const nasta = nastaSteg(steg);
  const nummer = STEG.indexOf(steg) + 1;
  const kvar = totaltAttGaIgenom(antal);

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[17rem_1fr] lg:gap-6">
      <Stegspalt
        steg={steg}
        antal={antal}
        kvar={kvar}
        valj={setSteg}
        slutfor={slutfor}
        vantar={vantarPaKvitto}
        redanGjord={redanGjord}
      />

      <div className="flex min-w-0 flex-col gap-4">
        {state.fel && <Notis ton="danger">{state.fel}</Notis>}
        {state.ok && <Notis ton="ok">{state.ok}</Notis>}

        {/*
          `key` PÅ STEGET ÅTERSTARTAR ANIMATIONEN vid varje byte. Utan den
          spelas den en gång och sedan aldrig mer, eftersom React återanvänder
          noden — och då hoppar innehållet under en rubrik som står still.
        */}
        <section
          key={steg}
          className="motion-safe:animate-[steg-in_var(--duration-base)_var(--ease-brand)] flex min-w-0 flex-col gap-5 rounded-md bg-surface p-4 shadow-elev-1 md:p-6"
        >
          <header className="flex flex-col gap-1.5">
            <p className="text-micro font-semibold uppercase tracking-wide text-ink-500">
              Steg {nummer} av {STEG.length}
            </p>
            <h2 className="text-h2 text-ink-900">{STEG_RUBRIK[steg]}</h2>
            <p className="max-w-prose text-small text-ink-500">{STEG_LEDTEXT[steg]}</p>
          </header>

          <Stegets
            steg={steg}
            rader={rader}
            projekt={projekt}
            namn={namn}
            mig={mig}
            idag={idag}
            veckansDagar={veckansDagar}
            veckonummer={nastaVeckansNummer}
          />

          <footer className="flex items-center justify-between gap-3 border-t border-canvas pt-4">
            <button
              type="button"
              onClick={() => forra && setSteg(forra)}
              disabled={!forra}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-small text-ink-500 transition-colors duration-fast hover:bg-surface-alt hover:text-ink-900 disabled:pointer-events-none disabled:opacity-40"
            >
              <Ikon namn="tillbaka" className="size-4" />
              {forra ? STEG_RUBRIK[forra] : "Tillbaka"}
            </button>

            {nasta ? (
              <Button variant="primar" size="sm" onClick={() => setSteg(nasta)}>
                {STEG_RUBRIK[nasta]}
                <Ikon namn="fram" className="size-4" />
              </Button>
            ) : (
              <span className="text-small text-ink-500">Sista steget — bokför till vänster.</span>
            )}
          </footer>
        </section>
      </div>
    </div>
  );
}

/**
 * Genomgången öppnar på FÖRSTA STEGET SOM HAR NÅGOT, inte alltid på steg ett.
 *
 * Den som inte har något förfallet ska inte mötas av en grön tomruta och behöva
 * klicka sig vidare för att komma till arbetet. Är allt tomt öppnar den på steg
 * ett, som då är en ärlig sammanfattning: ingenting att göra.
 */
function forstaOgjorda(antal: Stegantal): Stegid {
  return STEG.find((s) => antal[s] > 0) ?? STEG[0];
}

// -----------------------------------------------------------------------------
// Stegspalten
// -----------------------------------------------------------------------------

/**
 * Vägen genom genomgången.
 *
 * SITTER FAST VID RULLNING på stora skärmar (`lg:sticky`), och det är inte
 * pynt: steg fem kan vara femton rader långt, och kvittoknappen får inte
 * hamna utanför bild när man är klar. Under `lg` blir den en vanlig rad överst
 * — ingen sticky på en telefon, där den hade ätit en tredjedel av skärmen.
 *
 * KVITTOKNAPPEN STÅR I FOTEN OCH INTE I SISTA STEGET. En genomgång som vägrar
 * avslutas förrän man klickat sig igenom alla fem är en genomgång man överger i
 * steg tre — och då finns ingen bokföring alls, vilket är sämre än en ärlig
 * sådan med tre rader kvar.
 */
function Stegspalt({
  steg,
  antal,
  kvar,
  valj,
  slutfor,
  vantar: vantarPaKvitto,
  redanGjord,
}: {
  steg: Stegid;
  antal: Stegantal;
  kvar: number;
  valj: (s: Stegid) => void;
  slutfor: (form: FormData) => void;
  vantar: boolean;
  redanGjord: boolean;
}) {
  return (
    <nav
      aria-label="Genomgångens steg"
      className="flex flex-col gap-4 rounded-md bg-surface p-3 shadow-elev-1 lg:sticky lg:top-4"
    >
      <ol className="flex flex-col gap-0.5">
        {STEG.map((id, i) => {
          const har = antal[id];
          const nu = id === steg;
          const klart = har === 0;

          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => valj(id)}
                aria-current={nu ? "step" : undefined}
                className={
                  "flex w-full items-center gap-3 rounded-sm px-2.5 py-2.5 text-left transition-colors duration-fast " +
                  (nu ? "bg-brand-100" : "hover:bg-surface-alt")
                }
              >
                {/*
                  SIFFRAN BLIR EN BOCK NÄR STEGET ÄR TOMT. Det är den enda
                  återkopplingen i hela vyn som säger att man kommit någonstans,
                  och den kostar ett tecken.
                */}
                <span
                  aria-hidden
                  className={
                    "tnum grid size-6 shrink-0 place-items-center rounded-full text-micro font-semibold " +
                    (klart
                      ? "bg-ok-tint text-ok-ink"
                      : nu
                        ? "bg-brand-600 text-ink-inv"
                        : "bg-canvas text-ink-500")
                  }
                >
                  {/* `kontroll` ÄR bocken i ikonuppsättningen — samma streck och
                      tjocklek som resten av navet. Ett skrivtecken (✓) hade
                      renderats i systemets fallback-typsnitt och sett ut som en
                      annan sorts märke i varje webbläsare. */}
                  {klart ? <Ikon namn="kontroll" className="size-3.5" /> : i + 1}
                </span>

                <span
                  className={
                    "min-w-0 flex-1 truncate text-small " +
                    (nu ? "font-semibold text-brand-700" : klart ? "text-ink-500" : "text-ink-900")
                  }
                >
                  {STEG_RUBRIK[id]}
                </span>

                {har > 0 && (
                  <span className="tnum shrink-0 text-small tabular-nums text-ink-500">{har}</span>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      <form action={slutfor} className="flex flex-col gap-2 border-t border-canvas pt-3">
        <Button type="submit" size="sm" laddar={vantarPaKvitto} className="w-full">
          {kvar === 0 ? "Bokför — allt avbetat" : "Bokför veckan"}
        </Button>
        <p className="text-micro leading-snug text-ink-500">
          {kvar === 0
            ? "Ingenting står kvar i något steg."
            : `${kvar} ${kvar === 1 ? "rad står" : "rader står"} kvar. Att lämna dem är ett val — kvittot skriver ner hur många.`}
          {redanGjord && " Veckan är redan bokförd; du skriver över kvittot."}
        </p>
      </form>
    </nav>
  );
}

// -----------------------------------------------------------------------------
// Innehållet per steg
// -----------------------------------------------------------------------------

function Stegets({
  steg,
  rader,
  projekt,
  namn,
  mig,
  idag,
  veckansDagar,
  veckonummer,
}: {
  steg: Stegid;
  rader: Genomgangsrad[];
  projekt: Genomgangsprojekt[];
  namn: Record<string, string>;
  mig: string;
  idag: string;
  veckansDagar: string[];
  veckonummer: number;
}) {
  if (steg === "forfallet") {
    const lista = forfallet(rader, mig, idag);
    return lista.length === 0 ? (
      <Klart text={STEG_TOMTEXT.forfallet} />
    ) : (
      <Radlista>
        {lista.map((u) => (
          <Uppgiftsrad key={u.id} rad={u} idag={idag} meta={fristtext(u.due_date, idag)} sen />
        ))}
      </Radlista>
    );
  }

  if (steg === "utanDag") {
    const lista = utanDag(rader, mig);
    return lista.length === 0 ? (
      <Klart text={STEG_TOMTEXT.utanDag} />
    ) : (
      <Radlista>
        {lista.map((u) => (
          <Uppgiftsrad
            key={u.id}
            rad={u}
            idag={idag}
            meta={u.assignee_id === null ? "I inkorgen" : tidstext(u.estimate_minutes)}
            visaTaSjalv={u.assignee_id === null}
          />
        ))}
      </Radlista>
    );
  }

  if (steg === "vantar") {
    const lista = vantar(rader, mig);
    return lista.length === 0 ? (
      <Klart text={STEG_TOMTEXT.vantar} />
    ) : (
      <Radlista>
        {lista.map((u) => (
          <Vantarad key={u.id} rad={u} namn={namn} />
        ))}
      </Radlista>
    );
  }

  if (steg === "projekt") {
    const lista = stannadeProjekt(projekt, rader);
    return lista.length === 0 ? <Klart text={STEG_TOMTEXT.projekt} /> : <Projektlista projekt={lista} />;
  }

  return (
    <Veckan
      block={veckansDagsblock(rader, mig, veckansDagar)}
      veckonummer={veckonummer}
      idag={idag}
      tomtext={STEG_TOMTEXT.nastaVecka}
    />
  );
}

/**
 * Tomtexten är ett KVITTO och inte ett tomrum.
 *
 * En grå ruta som säger "inga rader" ser ut som att något gått fel eller inte
 * laddat. En bock och en mening som säger vad frånvaron BETYDER — "ingenting
 * har förfallit" — är det enda beröm verktyget har att ge, och det är precis
 * det ett steg som går att beta av ska kunna säga.
 */
function Klart({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-sm bg-ok-tint px-4 py-5">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ok text-ink-inv">
        <Ikon namn="kontroll" className="size-4" />
      </span>
      <p className="text-small text-ok-ink">{text}</p>
    </div>
  );
}

function Radlista({ children }: { children: ReactNode }) {
  return <ul className="-mx-2 flex flex-col">{children}</ul>;
}

// -----------------------------------------------------------------------------
// Raden
// -----------------------------------------------------------------------------

/**
 * En rad med EN fråga: vilken dag?
 *
 * ===========================================================================
 * DE TRE DAGKNAPPARNA ÄR ETT REGLAGE, INTE TRE KNAPPAR
 *
 * De sitter i en gemensam pilleryta med ett datumfält som fjärde läge. Skillnaden
 * mot tre fristående knappar är att ögat läser dem som ETT val med fyra
 * alternativ i stället för som fyra saker att läsa var för sig — och det är
 * skillnaden mellan sex rader man betar av och sex rader man orkar två av.
 *
 * "Stryk" står avskilt längst till höger och är grå tills den hovras. Den
 * förtjänar inte samma vikt som dagvalet: att stryka är det ovanliga svaret.
 * ===========================================================================
 */
function Uppgiftsrad({
  rad,
  idag,
  meta,
  sen = false,
  visaTaSjalv = false,
}: {
  rad: Genomgangsrad;
  idag: string;
  meta?: string | null;
  sen?: boolean;
  visaTaSjalv?: boolean;
}) {
  const [planState, planeraAction, planerar] = useActionState<UppgiftState, FormData>(planera, {});
  const [tillState, tilldelaAction, tilldelar] = useActionState<UppgiftState, FormData>(tilldela, {});
  const [strykState, avbrytAction, stryker] = useActionState<UppgiftState, FormData>(avbryt, {});

  const fel = planState.fel ?? tillState.fel ?? strykState.fel;
  const dolda = (
    <>
      <input type="hidden" name="id" value={rad.id} />
      {/*
        `planera()` skriver HELA planeringen: ett fält som inte kommer med
        tolkas som "ta bort". Regeln står utskriven i uppgifter/actions.ts och
        har kostat en bugg per yta som byggts sedan dess. Klockslag och
        uppskattning skickas därför med ur radens NUVARANDE värden, varje gång.
      */}
      <input type="hidden" name="due_time" value={rad.due_time ?? ""} />
      <input type="hidden" name="estimate_minutes" value={rad.estimate_minutes ?? ""} />
    </>
  );

  return (
    <li className="border-b border-canvas last:border-0">
      <div className="flex flex-col gap-2.5 px-2 py-3 transition-colors duration-fast hover:bg-surface-alt md:flex-row md:items-center md:gap-4">
        <div className="min-w-0 flex-1">
          <Link
            href={`/uppgifter/${rad.id}`}
            className="block truncate text-body text-ink-900 transition-colors duration-fast hover:text-brand-700"
          >
            {rad.title}
          </Link>
          {meta && (
            <p className={sen ? "text-small text-danger-ink" : "text-small text-ink-500"}>{meta}</p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {visaTaSjalv && (
            <form action={tilldelaAction}>
              <input type="hidden" name="id" value={rad.id} />
              {/*
                Tomt `assignee_id` betyder inkorgen i `tilldela()`. Här står
                mitt id, hämtat ur raden — den som la upp en rad i sin egen
                inkorg är jag, och den enda meningsfulla handlingen med den är
                att ta den själv.
              */}
              <input type="hidden" name="assignee_id" value={rad.created_by} />
              <button
                type="submit"
                disabled={tilldelar}
                className="rounded-full bg-canvas px-3 py-1.5 text-micro text-ink-700 transition-colors duration-fast hover:bg-brand-100 hover:text-brand-700 disabled:opacity-40"
              >
                Ta den själv
              </button>
            </form>
          )}

          <Dagvaljare rad={rad} idag={idag} action={planeraAction} vantar={planerar} dolda={dolda} />

          <form action={avbrytAction}>
            <input type="hidden" name="id" value={rad.id} />
            {/*
              `avbryt()` kräver ett skäl, och det är rätt: en avbruten uppgift
              notifierar den ansvariga, och "Avbruten." utan mer är en
              tillsägelse utan innehåll. Skälet är förskrivet här eftersom
              handlingen i en genomgång alltid har samma skäl. Vill man skriva
              något annat gör man det på uppgiften.
            */}
            <input type="hidden" name="note" value="Struken i veckogenomgången." />
            <button
              type="submit"
              disabled={stryker}
              title="Stryk uppgiften"
              className="grid size-8 place-items-center rounded-full text-ink-300 transition-colors duration-fast hover:bg-danger-tint hover:text-danger-ink disabled:opacity-40"
            >
              <Ikon namn="kryss" className="size-4" />
              <span className="sr-only">Stryk {rad.title}</span>
            </button>
          </form>
        </div>
      </div>

      {fel && (
        <p role="alert" className="px-2 pb-3 text-micro text-danger-ink">
          {fel}
        </p>
      )}
    </li>
  );
}

/**
 * Reglaget. Tre dagar och ett datumfält i samma pilleryta.
 *
 * ===========================================================================
 * TVÅ FORMULÄR, OCH DET ÄR AVSIKTLIGT
 *
 * Låg datumfältet i samma form som knapparna skulle varje knapptryck posta TVÅ
 * fält som heter `due_date` — knappens eget och fältets — och vilket som vinner
 * avgörs av deras ordning i DOM:en, eftersom `FormData.get()` tar det första.
 * Det hade fungerat precis så länge ingen flyttade på en knapp.
 *
 * Wrapperns `bg-canvas` och `p-0.5` gör de två formulären till ett reglage för
 * ögat. Skarven syns inte, och beteendet är entydigt.
 * ===========================================================================
 */
function Dagvaljare({
  rad,
  idag,
  action,
  vantar: vantarPaSvar,
  dolda,
}: {
  rad: Genomgangsrad;
  idag: string;
  action: (form: FormData) => void;
  vantar: boolean;
  dolda: ReactNode;
}) {
  const imorgon = datumPlusDagar(idag, 1);
  const mandag = datumPlusDagar(veckostart(idag), 7);

  const segment =
    "rounded-full px-3 py-1.5 text-micro text-ink-700 transition-colors duration-fast " +
    "hover:bg-brand-100 hover:text-brand-700 disabled:opacity-40";

  return (
    <div className="flex items-center gap-0.5 rounded-full bg-canvas p-0.5">
      <form action={action} className="flex items-center gap-0.5">
        {dolda}
        <button type="submit" name="due_date" value={idag} disabled={vantarPaSvar} className={segment}>
          Idag
        </button>
        <button type="submit" name="due_date" value={imorgon} disabled={vantarPaSvar} className={segment}>
          I morgon
        </button>
        <button type="submit" name="due_date" value={mandag} disabled={vantarPaSvar} className={segment}>
          {dagKort(mandag)}
        </button>
      </form>

      <form action={action} className="flex items-center">
        {dolda}
        {/*
          ===================================================================
          DATUMFÄLTET ÄR SYNLIGT OCH SKICKAR SIG SJÄLVT

          Ett utkast gömde det bakom en kalenderikon med `text-transparent` och
          en bortgömd `::-webkit-calendar-picker-indicator`. Det såg prydligare
          ut och var fel: vilken yta som faktiskt öppnar väljaren i ett
          `input[type=date]` skiljer sig mellan Chrome, Firefox och Safari, så
          kontrollen hade fungerat på maskinen den ritades på och varit en
          oklickbar ikon någon annanstans. En fjärde dag man inte kan välja är
          värre än ingen fjärde dag.

          `onChange` submittar direkt. En extra bekräftelseknapp bredvid hade
          gjort det fjärde alternativet till två steg — och då tar man ett av
          de tre första i stället och flyttar uppgiften fel.
          ===================================================================
        */}
        <label className="flex items-center gap-1.5 rounded-full px-2 py-1 text-ink-500">
          {/* `Ikon` sätter själv `aria-hidden` och tar inga andra props. */}
          <Ikon namn="kalender" className="size-4 shrink-0" />
          <span className="sr-only">Annat datum för {rad.title}</span>
          <input
            type="date"
            name="due_date"
            defaultValue={rad.due_date ?? ""}
            disabled={vantarPaSvar}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="tnum w-[7.5rem] cursor-pointer rounded-full bg-transparent px-1 py-0.5 text-micro text-ink-700 outline-none transition-colors duration-fast hover:bg-brand-100 hover:text-brand-700 focus-visible:bg-surface disabled:opacity-40"
          />
        </label>
      </form>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Steg 3 — det som ligger hos andra
// -----------------------------------------------------------------------------

/**
 * PÅMINNELSEN ÄR EN KOMMENTAR OCH INTE EN EGEN NOTISKÄLLA.
 *
 * `kommentera()` skriver en rad i uppgiftens historik och pingar hela kretsen
 * med `uppgift-kommentar`. En egen "knuff"-källa hade behövt en post i
 * NOTIS_KALLOR, en rad i TACKNING och ett eget skäl att finnas — och den hade
 * gett mottagaren ett besked utan spår i uppgiften, alltså en tillsägelse utan
 * historik. Att påminnelsen står kvar i tråden är det som gör den rimlig att ta
 * emot.
 *
 * FÄLTET ÄR UNDANSTÄLLT TILLS MAN VILL SKRIVA. Sex öppna textrutor i en lista
 * är sex saker som ser ut att kräva ifyllnad, och steget handlar i första hand
 * om att SE hur länge något stått still — påminnelsen är följden, inte frågan.
 */
function Vantarad({ rad, namn }: { rad: Genomgangsrad; namn: Record<string, string> }) {
  const [state, action, vantarPaSvar] = useActionState<UppgiftState, FormData>(kommentera, {});
  const [oppen, setOppen] = useState(false);

  const lange = rad.stilla >= 7;

  return (
    <li className="border-b border-canvas last:border-0">
      <div className="flex flex-col gap-2.5 px-2 py-3 transition-colors duration-fast hover:bg-surface-alt md:flex-row md:items-center md:gap-4">
        <div className="min-w-0 flex-1">
          <Link
            href={`/uppgifter/${rad.id}`}
            className="block truncate text-body text-ink-900 transition-colors duration-fast hover:text-brand-700"
          >
            {rad.title}
          </Link>
          <p className="text-small text-ink-500">Hos {namn[rad.assignee_id ?? ""] ?? "en kollega"}</p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {/*
            DYGNEN ÄR RADENS SIFFRA och får därför siffrans vikt. Sju dygn eller
            mer bryter ut i varningston — inte som ett larm, utan för att ögat
            ska hitta de långa utan att läsa alla.
          */}
          <span
            className={
              lange
                ? "tnum rounded-full bg-warn-tint px-2.5 py-1 text-micro font-semibold text-warn-ink"
                : "tnum text-small text-ink-500"
            }
          >
            {rad.stilla} d
          </span>

          <button
            type="button"
            onClick={() => setOppen((v) => !v)}
            aria-expanded={oppen}
            className="rounded-full bg-canvas px-3 py-1.5 text-micro text-ink-700 transition-colors duration-fast hover:bg-brand-100 hover:text-brand-700"
          >
            {oppen ? "Avbryt" : "Påminn"}
          </button>
        </div>
      </div>

      {oppen && (
        <form action={action} className="flex flex-wrap items-center gap-2 px-2 pb-3">
          <input type="hidden" name="id" value={rad.id} />
          {/*
            TEXTEN ÄR FRI OCH INTE FÖRSKRIVEN, till skillnad från strykningens
            skäl. "Hur går det med den här?" är något helt annat än "kunden
            ringde igen", och en knapp som skickar samma mening varje vecka är
            en knapp mottagaren slutar läsa.
          */}
          <input
            type="text"
            name="note"
            required
            autoFocus
            placeholder="Hur går det med den här?"
            className={`${KONTROLL} min-w-0 flex-1 px-3 py-1.5 text-small`}
          />
          <Button type="submit" variant="sekundar" size="sm" laddar={vantarPaSvar}>
            Skicka
          </Button>
        </form>
      )}

      {state.fel && (
        <p role="alert" className="px-2 pb-3 text-micro text-danger-ink">
          {state.fel}
        </p>
      )}
      {state.ok && <p className="px-2 pb-3 text-micro text-ok-ink">Påminnelsen är skickad.</p>}
    </li>
  );
}

// -----------------------------------------------------------------------------
// Steg 4 — projekten
// -----------------------------------------------------------------------------

/**
 * Projekt utan öppen uppgift.
 *
 * INGA HANDLINGAR PÅ RADEN, och det är avsiktligt. Ett stannat projekt har två
 * riktiga utfall — en ny uppgift, eller arkivering — och båda är beslut som
 * kräver att man ser projektet: vad som gjordes, vilka som är med, vad
 * beskrivningen säger. En "arkivera"-knapp här hade gjort det lättare att bli
 * av med projektet än att titta på det.
 */
function Projektlista({ projekt }: { projekt: Genomgangsprojekt[] }) {
  const STRECK: Record<string, string> = {
    brand: "bg-brand-500",
    info: "bg-info",
    accent: "bg-accent",
    ok: "bg-ok",
    warn: "bg-warn",
    danger: "bg-danger",
  };

  return (
    <ul className="-mx-2 flex flex-col">
      {projekt.map((p) => (
        <li key={p.id} className="border-b border-canvas last:border-0">
          <Link
            href={`/uppgifter/projekt/${p.id}`}
            className="group flex items-center gap-3 rounded-sm px-2 py-3 transition-colors duration-fast hover:bg-surface-alt"
          >
            <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${STRECK[p.color] ?? "bg-brand-500"}`} />
            <span className="min-w-0 flex-1 truncate text-body text-ink-900 group-hover:text-brand-700">
              {p.name}
            </span>
            <span className="shrink-0 text-small text-ink-500">
              {p.due_date ? `Deadline ${p.due_date}` : "Ingen öppen uppgift"}
            </span>
            <Ikon
              namn="fram"
              className="size-4 shrink-0 text-ink-300 transition-colors duration-fast group-hover:text-brand-700"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}

// -----------------------------------------------------------------------------
// Steg 5 — nästa vecka
// -----------------------------------------------------------------------------

/**
 * Veckan som sju rader.
 *
 * ===========================================================================
 * LASTEN OCH SAKERNA SOM ORSAKAR DEN STÅR PÅ SAMMA STÄLLE
 *
 * Steget ritades först som sju lodräta staplar med uppgifterna i en platt lista
 * under. Man såg att torsdagen var överbokad och fick sedan leta i fjorton
 * rader efter vad som låg på torsdagen — alltså två steg för en fråga. Och sju
 * kolumner ryms inte i en telefon: etiketterna blev tre tecken breda och talen
 * under dem oläsliga, vilket är precis den information steget finns för.
 *
 * Nu är dagen en rad: namn, stapel, timmar — och uppgifterna indragna under
 * sin egen dag, med samma dagväljare som de andra stegen. Man kan alltså flytta
 * en uppgift bort från den fulla dagen utan att först räkna ut vilken den var.
 *
 * TOMMA DAGAR VISAS ÄNDÅ. En vecka utan tisdag är inte en vecka, och det lediga
 * utrymmet är halva svaret: dit kan något flyttas.
 * ===========================================================================
 */
function Veckan({
  block,
  veckonummer,
  idag,
  tomtext,
}: {
  block: Dagsblock[];
  veckonummer: number;
  idag: string;
  tomtext: string;
}) {
  const summa = block.reduce((s, d) => s + d.minuter, 0);
  const over = block.filter((d) => d.over);
  const tomt = block.every((d) => d.rader.length === 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-body font-semibold text-ink-900">Vecka {veckonummer}</h3>
        <span className="tnum text-small text-ink-500">
          {summa === 0 ? "Inget planerat" : `${langd(summa)} planerat`}
        </span>
      </div>

      {over.length > 0 && (
        <Notis ton="warn">
          <span className="font-semibold">{over.map((d) => dagKort(d.dag)).join(", ")}</span>{" "}
          {over.length === 1 ? "är överbokad" : "är överbokade"} — mer än sex timmar planerat. Flytta något
          innan veckan börjar.
        </Notis>
      )}

      {tomt && <Klart text={tomtext} />}

      <ol className="flex flex-col gap-1.5">
        {block.map((d) => (
          <Dagrad key={d.dag} dag={d} idag={idag} />
        ))}
      </ol>
    </div>
  );
}

function Dagrad({ dag, idag }: { dag: Dagsblock; idag: string }) {
  const andel = stapelandel(dag);

  return (
    <li
      className={
        "rounded-sm px-3 py-2.5 " +
        (dag.over ? "bg-warn-tint" : dag.helg ? "bg-canvas/60" : "bg-canvas")
      }
    >
      <div className="flex items-center gap-3">
        <span
          className={
            "w-20 shrink-0 text-small " + (dag.helg && dag.rader.length === 0 ? "text-ink-300" : "text-ink-700")
          }
        >
          {dagKort(dag.dag)}
        </span>

        {/*
          STAPELN LIGGER I RADEN och inte i en egen kolumn, så att den växer med
          bredden i stället för att krympa. Den ritas mot DAGSTAKET och inte mot
          veckans fullaste dag — en relativ skala hade gjort veckans värsta dag
          fullhög varje vecka, också en vecka med fyrtio minuter om dagen.
        */}
        <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface">
          <div
            className={"h-full rounded-full " + (dag.over ? "bg-warn" : "bg-brand-500")}
            style={{ width: `${andel}%` }}
          />
        </div>

        <span
          className={
            "tnum w-20 shrink-0 text-right text-small " +
            (dag.over ? "font-semibold text-warn-ink" : dag.minuter === 0 ? "text-ink-300" : "text-ink-700")
          }
        >
          {dag.minuter === 0 ? "—" : langd(dag.minuter)}
        </span>
      </div>

      {dag.rader.length > 0 && (
        <ul className="mt-1.5 flex flex-col border-t border-surface pt-1">
          {dag.rader.map((u) => (
            <Uppgiftsrad
              key={u.id}
              rad={u}
              idag={idag}
              meta={[u.due_time, tidstext(u.estimate_minutes)].filter(Boolean).join(" · ") || null}
            />
          ))}
        </ul>
      )}

      {dag.oskattade > 0 && (
        <p className="mt-1 text-micro text-ink-500">
          {dag.oskattade} {dag.oskattade === 1 ? "uppgift saknar" : "uppgifter saknar"} tidsuppskattning och
          räknas som noll.
        </p>
      )}
    </li>
  );
}
