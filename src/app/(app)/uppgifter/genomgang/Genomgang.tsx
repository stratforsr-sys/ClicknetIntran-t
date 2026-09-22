"use client";

import Link from "next/link";
import { useActionState, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { KONTROLL } from "@/components/ui/Field";
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
  nastaVeckansRader,
  stannadeProjekt,
  totaltAttGaIgenom,
  utanDag,
  vantar,
  veckolast,
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
 * ETT STEG I TAGET, OCH DET ÄR SKILLNADEN MOT EN LISTA
 *
 * Allt som visas här finns redan på `/uppgifter`, utspritt på sex flikar. Det
 * som är nytt är att man tas igenom dem i en ordning, med handlingarna på
 * raden, och att det finns ett slut. En sida som visade alla fem stegen samtidigt
 * hade varit ytterligare en översikt — och översikter läser man, genomgångar
 * gör man klart.
 *
 * STEGET LIGGER I KOMPONENTENS TILLSTÅND OCH INTE I ADRESSEN. Det övervägdes:
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
  nastaVeckansDagar,
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
  const [steg, setSteg] = useState<Stegid>(STEG[0]);
  const [state, slutfor, vantarPaKvitto] = useActionState<GenomgangState, FormData>(
    slutforGenomgang,
    {},
  );

  const forra = foregaendeSteg(steg);
  const nasta = nastaSteg(steg);
  const nummer = STEG.indexOf(steg) + 1;
  const kvar = totaltAttGaIgenom(antal);

  return (
    <Card>
      <div className="flex flex-col gap-5">
        <Prickrad steg={steg} antal={antal} valj={setSteg} />

        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-h2 text-ink-900">
              {nummer}. {STEG_RUBRIK[steg]}
            </h2>
            <span className="tnum text-small text-ink-500">
              Steg {nummer} av {STEG.length}
            </span>
          </div>
          <p className="max-w-prose text-small text-ink-500">{STEG_LEDTEXT[steg]}</p>
        </div>

        <div className="min-h-32">
          {steg === "forfallet" && (
            <Radlista
              rader={forfallet(rader, mig, idag)}
              idag={idag}
              tomtext={STEG_TOMTEXT.forfallet}
            />
          )}

          {steg === "utanDag" && (
            <Radlista
              rader={utanDag(rader, mig)}
              idag={idag}
              tomtext={STEG_TOMTEXT.utanDag}
              visaTaSjalv
            />
          )}

          {steg === "vantar" && (
            <Vantarlista rader={vantar(rader, mig)} namn={namn} tomtext={STEG_TOMTEXT.vantar} />
          )}

          {steg === "projekt" && (
            <Projektlista projekt={stannadeProjekt(projekt, rader)} tomtext={STEG_TOMTEXT.projekt} />
          )}

          {steg === "nastaVecka" && (
            <Veckan
              last={veckolast(rader, mig, nastaVeckansDagar)}
              rader={nastaVeckansRader(rader, mig, nastaVeckansDagar)}
              veckonummer={nastaVeckansNummer}
              idag={idag}
              tomtext={STEG_TOMTEXT.nastaVecka}
            />
          )}
        </div>

        {state.fel && <Notis ton="danger">{state.fel}</Notis>}
        {state.ok && <Notis ton="ok">{state.ok}</Notis>}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-canvas pt-4">
          <Button
            variant="diskret"
            size="sm"
            onClick={() => forra && setSteg(forra)}
            disabled={!forra}
          >
            ← Tillbaka
          </Button>

          {nasta ? (
            <Button variant="primar" size="sm" onClick={() => setSteg(nasta)}>
              Nästa steg →
            </Button>
          ) : (
            /**
             * SLUTKNAPPEN STÅR BARA I SISTA STEGET, och den bokför veckan även
             * när något står kvar. En genomgång som vägrar avslutas förrän
             * listan är tom är en genomgång man överger i steg tre — och då
             * finns ingen bokföring alls, vilket är sämre än en ärlig sådan
             * med tre rader kvar.
             */
            <form action={slutfor}>
              <Button type="submit" size="sm" laddar={vantarPaKvitto}>
                {kvar === 0 ? "Bokför — allt avbetat" : `Bokför genomgången (${kvar} kvar)`}
              </Button>
            </form>
          )}
        </div>

        {redanGjord && !state.ok && (
          <p className="text-small text-ink-500">
            Veckans genomgång är redan bokförd. Går du igenom den igen skrivs kvittot över.
          </p>
        )}
      </div>
    </Card>
  );
}

/**
 * Prickarna. KLICKBARA, och det är inte en detalj.
 *
 * Ett flöde som bara går framåt tvingar den som kom på något i steg två att
 * klicka sig igenom tre steg till för att komma tillbaka. Prickarna bär
 * dessutom antalet per steg, så man ser innan man går dit om det är värt en
 * minut — och ett steg med noll rader går att hoppa över med vetskap i stället
 * för på chans.
 */
function Prickrad({
  steg,
  antal,
  valj,
}: {
  steg: Stegid;
  antal: Stegantal;
  valj: (s: Stegid) => void;
}) {
  return (
    <ol className="flex flex-wrap gap-2">
      {STEG.map((id) => {
        const har = antal[id];
        const nu = id === steg;
        return (
          <li key={id}>
            <button
              type="button"
              onClick={() => valj(id)}
              aria-current={nu ? "step" : undefined}
              className={
                nu
                  ? "flex items-center gap-2 rounded-full bg-brand-600 px-3 py-1.5 text-micro font-semibold text-ink-inv"
                  : "flex items-center gap-2 rounded-full bg-canvas px-3 py-1.5 text-micro text-ink-500 transition-colors duration-fast hover:bg-brand-100 hover:text-brand-700"
              }
            >
              {STEG_RUBRIK[id]}
              <span
                className={
                  har === 0
                    ? "tnum opacity-50"
                    : nu
                      ? "tnum"
                      : "tnum rounded-full bg-warn-tint px-1.5 text-warn-ink"
                }
              >
                {har}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// -----------------------------------------------------------------------------
// Steg 1 och 2 — raderna med handlingar
// -----------------------------------------------------------------------------

function Radlista({
  rader,
  idag,
  tomtext,
  visaTaSjalv = false,
}: {
  rader: Genomgangsrad[];
  idag: string;
  tomtext: string;
  visaTaSjalv?: boolean;
}) {
  if (rader.length === 0) return <Tomt text={tomtext} />;

  return (
    <ul className="flex flex-col divide-y divide-canvas">
      {rader.map((u) => (
        <li key={u.id} className="flex flex-col gap-2 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <Link
              href={`/uppgifter/${u.id}`}
              className="text-body text-ink-900 transition-colors duration-fast hover:text-brand-700"
            >
              {u.title}
            </Link>
            <span className="text-small text-ink-500">
              {[fristtext(u.due_date, idag), tidstext(u.estimate_minutes)].filter(Boolean).join(" · ")}
            </span>
          </div>
          <Radhandlingar rad={u} idag={idag} visaTaSjalv={visaTaSjalv} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Knapparna på raden.
 *
 * ===========================================================================
 * VARJE KNAPP SOM RÖR DATUM SKICKAR ALLA TRE PLANERINGSFÄLTEN
 *
 * `planera()` skriver HELA planeringen, och ett fält som inte kommer med tolkas
 * som "ta bort". Regeln står utskriven i uppgifter/actions.ts och har kostat en
 * bugg per yta som byggts sedan dess — snabbknapparna i listan raderade tyst en
 * tidsuppskattning 2026-09-11, och kalenderns drag gjorde samma sak tre dagar
 * senare.
 *
 * Här skickas därför `due_time` och `estimate_minutes` som dolda fält ur radens
 * NUVARANDE värden, varje gång. En genomgång som stryker klockslag och
 * uppskattningar på varje rad man flyttar hade varit precis det verktyget finns
 * för att slippa.
 * ===========================================================================
 */
function Radhandlingar({
  rad,
  idag,
  visaTaSjalv,
}: {
  rad: Genomgangsrad;
  idag: string;
  visaTaSjalv: boolean;
}) {
  const [planState, planeraAction, planerar] = useActionState<UppgiftState, FormData>(planera, {});
  const [tillState, tilldelaAction, tilldelar] = useActionState<UppgiftState, FormData>(tilldela, {});
  const [strykState, avbrytAction, stryker] = useActionState<UppgiftState, FormData>(avbryt, {});

  const imorgon = datumPlusDagar(idag, 1);
  const mandag = datumPlusDagar(veckostart(idag), 7);
  const fel = planState.fel ?? tillState.fel ?? strykState.fel;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <form action={planeraAction} className="flex flex-wrap items-center gap-1.5">
          <input type="hidden" name="id" value={rad.id} />
          <input type="hidden" name="due_time" value={rad.due_time ?? ""} />
          <input type="hidden" name="estimate_minutes" value={rad.estimate_minutes ?? ""} />

          <Snabbknapp namn="due_date" varde={idag} disabled={planerar}>
            Idag
          </Snabbknapp>
          <Snabbknapp namn="due_date" varde={imorgon} disabled={planerar}>
            I morgon
          </Snabbknapp>
          <Snabbknapp namn="due_date" varde={mandag} disabled={planerar}>
            {dagKort(mandag)}
          </Snabbknapp>
        </form>

        {/*
          DATUMVÄLJAREN LIGGER I EN EGEN FORM, och det är inte kosmetik.

          Låg den i formuläret ovan skulle varje snabbknapp posta TVÅ fält som
          heter `due_date` — knappens eget och inputens — och vilket som vinner
          avgörs av deras ordning i DOM:en, eftersom `FormData.get()` tar det
          första. Det hade fungerat precis så länge ingen flyttade på en knapp.
        */}
        <form action={planeraAction} className="flex flex-wrap items-center gap-1.5">
          <input type="hidden" name="id" value={rad.id} />
          <input type="hidden" name="due_time" value={rad.due_time ?? ""} />
          <input type="hidden" name="estimate_minutes" value={rad.estimate_minutes ?? ""} />

          <label className="flex items-center gap-1">
            <span className="sr-only">Välj ett annat datum</span>
            <input
              type="date"
              name="due_date"
              defaultValue={rad.due_date ?? ""}
              className={`${KONTROLL} w-auto px-2 py-1 text-micro`}
            />
          </label>
          <Snabbknapp disabled={planerar}>Flytta hit</Snabbknapp>
        </form>

        {visaTaSjalv && rad.assignee_id === null && (
          <form action={tilldelaAction}>
            <input type="hidden" name="id" value={rad.id} />
            {/*
              Tomt `assignee_id` betyder inkorgen i `tilldela()`. Här står MITT
              id, och det kommer ur raden — inte ur formuläret — eftersom den
              enda meningsfulla handlingen i inkorgen är att ta den själv.
            */}
            <input type="hidden" name="assignee_id" value={rad.created_by} />
            <Snabbknapp disabled={tilldelar}>Ta den själv</Snabbknapp>
          </form>
        )}

        <form action={avbrytAction}>
          <input type="hidden" name="id" value={rad.id} />
          {/*
            `avbryt()` kräver ett skäl, och det är rätt: en avbruten uppgift
            notifierar den ansvariga, och "Avbruten." utan mer är en tillsägelse
            utan innehåll. Skälet är förskrivet här eftersom handlingen i en
            genomgång ALLTID har samma skäl — raden överlevde inte veckans
            genomgång. Vill man skriva något annat gör man det på uppgiften.
          */}
          <input type="hidden" name="note" value="Struken i veckogenomgången." />
          <Snabbknapp disabled={stryker} fara>
            Stryk
          </Snabbknapp>
        </form>
      </div>

      {fel && <p className="text-micro text-danger-ink">{fel}</p>}
    </div>
  );
}

function Snabbknapp({
  namn,
  varde,
  disabled,
  fara = false,
  children,
}: {
  namn?: string;
  varde?: string;
  disabled: boolean;
  fara?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      name={namn}
      value={varde}
      disabled={disabled}
      className={
        fara
          ? "rounded-full px-2.5 py-1 text-micro text-ink-500 transition-colors duration-fast hover:bg-danger-tint hover:text-danger-ink"
          : "rounded-full px-2.5 py-1 text-micro text-ink-500 transition-colors duration-fast hover:bg-brand-100 hover:text-brand-700"
      }
    >
      {children}
    </button>
  );
}

// -----------------------------------------------------------------------------
// Steg 3 — det som ligger hos andra
// -----------------------------------------------------------------------------

function Vantarlista({
  rader,
  namn,
  tomtext,
}: {
  rader: Genomgangsrad[];
  namn: Record<string, string>;
  tomtext: string;
}) {
  if (rader.length === 0) return <Tomt text={tomtext} />;

  return (
    <ul className="flex flex-col divide-y divide-canvas">
      {rader.map((u) => (
        <Vantarad key={u.id} rad={u} namn={namn} />
      ))}
    </ul>
  );
}

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
 * TEXTEN ÄR FRI OCH INTE FÖRSKRIVEN, till skillnad från strykningens skäl.
 * "Hur går det med den här?" är något helt annat än "kunden ringde igen", och
 * en knapp som skickar samma mening varje vecka är en knapp mottagaren slutar
 * läsa.
 */
function Vantarad({ rad, namn }: { rad: Genomgangsrad; namn: Record<string, string> }) {
  const [state, action, vantarPaSvar] = useActionState<UppgiftState, FormData>(kommentera, {});

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <Link
          href={`/uppgifter/${rad.id}`}
          className="text-body text-ink-900 transition-colors duration-fast hover:text-brand-700"
        >
          {rad.title}
        </Link>
        <span
          className={
            rad.stilla >= 7
              ? "tnum rounded-full bg-warn-tint px-3 py-1 text-micro text-warn-ink"
              : "tnum text-small text-ink-500"
          }
        >
          {namn[rad.assignee_id ?? ""] ?? "Okänd"} · {rad.stilla} d
        </span>
      </div>

      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="id" value={rad.id} />
        <input
          type="text"
          name="note"
          required
          placeholder="Hur går det med den här?"
          className={`${KONTROLL} w-auto flex-1 px-3 py-1.5 text-small`}
        />
        <Button type="submit" variant="sekundar" size="sm" laddar={vantarPaSvar}>
          Påminn
        </Button>
      </form>

      {state.fel && <p className="text-micro text-danger-ink">{state.fel}</p>}
      {state.ok && <p className="text-micro text-ok-ink">Påminnelsen är skickad.</p>}
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
function Projektlista({ projekt, tomtext }: { projekt: Genomgangsprojekt[]; tomtext: string }) {
  if (projekt.length === 0) return <Tomt text={tomtext} />;

  const STRECK: Record<string, string> = {
    brand: "bg-brand-500",
    info: "bg-info",
    accent: "bg-accent",
    ok: "bg-ok",
    warn: "bg-warn",
    danger: "bg-danger",
  };

  return (
    <ul className="flex flex-col divide-y divide-canvas">
      {projekt.map((p) => (
        <li key={p.id}>
          <Link
            href={`/uppgifter/projekt/${p.id}`}
            className="group flex items-center gap-3 py-3 transition-colors duration-fast"
          >
            <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${STRECK[p.color] ?? "bg-brand-500"}`} />
            <span className="min-w-0 flex-1 truncate text-body text-ink-900 group-hover:text-brand-700">
              {p.name}
            </span>
            <span className="shrink-0 text-small text-ink-500">
              {p.due_date ? `Deadline ${p.due_date}` : "Ingen öppen uppgift"}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// -----------------------------------------------------------------------------
// Steg 5 — nästa vecka
// -----------------------------------------------------------------------------

function Veckan({
  last,
  rader,
  veckonummer,
  idag,
  tomtext,
}: {
  last: ReturnType<typeof veckolast>;
  rader: Genomgangsrad[];
  veckonummer: number;
  idag: string;
  tomtext: string;
}) {
  const summa = last.reduce((s, d) => s + d.minuter, 0);
  const overbokade = last.filter((d) => d.over);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-body font-semibold text-ink-900">Vecka {veckonummer}</h3>
        <span className="tnum text-small text-ink-500">{langd(summa)} planerat</span>
      </div>

      {/*
        STAPLARNA RITAS MOT DAGSTAKET OCH INTE MOT VECKANS HÖGSTA DAG.
        En relativ skala hade gjort den fullaste dagen fullhög varje vecka —
        också en vecka med fyrtio minuter om dagen — och då säger bilden bara
        vilken dag som är värst, aldrig om någon dag är för full.
      */}
      <ol className="grid grid-cols-7 gap-1.5">
        {last.map((d) => (
          <li key={d.dag} className="flex flex-col items-center gap-1">
            <span className={d.helg ? "text-micro text-ink-300" : "text-micro text-ink-500"}>
              {dagKort(d.dag).split(" ")[0]}
            </span>
            <div className="flex h-20 w-full items-end overflow-hidden rounded-sm bg-canvas">
              <div
                className={d.over ? "w-full rounded-sm bg-warn" : "w-full rounded-sm bg-brand-500"}
                style={{ height: `${Math.min(100, Math.round((d.minuter / d.tak) * 100))}%` }}
              />
            </div>
            <span
              className={
                d.over ? "tnum text-micro font-semibold text-warn-ink" : "tnum text-micro text-ink-500"
              }
            >
              {d.minuter === 0 ? "—" : langd(d.minuter)}
            </span>
          </li>
        ))}
      </ol>

      {overbokade.length > 0 && (
        <Notis ton="warn">
          {overbokade.map((d) => dagKort(d.dag)).join(", ")}{" "}
          {overbokade.length === 1 ? "är överbokad" : "är överbokade"} — mer än sex timmar planerat.
          Flytta något innan veckan börjar.
        </Notis>
      )}

      {rader.length === 0 ? (
        <Tomt text={tomtext} />
      ) : (
        <ul className="flex flex-col divide-y divide-canvas">
          {rader.map((u) => (
            <li key={u.id} className="flex flex-col gap-2 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <Link
                  href={`/uppgifter/${u.id}`}
                  className="text-body text-ink-900 transition-colors duration-fast hover:text-brand-700"
                >
                  {u.title}
                </Link>
                <span className="text-small text-ink-500">
                  {[u.due_date ? dagKort(u.due_date) : null, u.due_time, tidstext(u.estimate_minutes)]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              <Radhandlingar rad={u} idag={idag} visaTaSjalv={false} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Tomt({ text }: { text: string }) {
  return <p className="rounded-sm bg-canvas px-4 py-6 text-center text-small text-ink-500">{text}</p>;
}
