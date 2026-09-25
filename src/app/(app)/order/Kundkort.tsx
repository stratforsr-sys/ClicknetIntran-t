"use client";

import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Ikon } from "@/components/shell/Ikon";
import { cn } from "@/components/ui/cn";
import {
  FAKTURERING_ETIKETT,
  STATUS_ETIKETT,
  dagarTill,
  harStangdPeriod,
  raknas,
  tjanstensVarde,
  type Orderstatus,
  type Paket,
} from "@/lib/order";
import { avtalsforlopp, orderhandelser, type Kund } from "@/lib/ordervy";
import { kronor, manadsnamn } from "@/lib/provision";
import { langd, summering, type Samtalsrad } from "@/lib/samtal-vy";
// TYPIMPORT, och det ar vad som gor den tillaten i en klientkomponent:
// `order-server.ts` borjar med `import "server-only"`, som kastar om modulen
// hamnar i webblasarpaketet. `import type` raderas av kompilatorn och lamnar
// ingen import kvar att kora.
import type { Orderrad, Tjansterad } from "@/lib/order-server";
import { Atgarder } from "./Atgarder";
import { Bilaga, type Orderbilaga } from "./Bilaga";
import { Fornyelse } from "./Fornyelse";
import { Samtal } from "./Samtal";

/**
 * Kundkortet.
 *
 * =============================================================================
 * UNDERSOKNINGEN, OCH VAD DEN GAV
 *
 * Bestallaren 2026-09-25: *"nar man gar in pa dem ska det oppnas upp ett
 * kundkort med all information, precis som ett riktigt crm, gor en undersokning
 * pa hur ett sant kundkort ska se ut"*.
 *
 * De tva mest anvanda CRM-systemen loeser samma sida pa nastan samma satt, och
 * det ar den overlappningen som ar svaret:
 *
 *   SALESFORCE LIGHTNING bygger sidan av en *highlights panel* hogst upp — fyra
 *   till sex falt som avgor vad man gor hardnast, plus handlingsknapparna — och
 *   under den en FLIKRAD (Details, Activity, Related) i stallet for en lang
 *   spalt.
 *
 *   HUBSPOT delar sidan i tre: egenskaperna till vanster, TIDSLINJEN i mitten,
 *   och de KOPPLADE POSTERNA till hoger.
 *
 * Det gemensamma ar tre saker, och kortet harunder gor alla tre:
 *
 *   1. BESLUTSFALTEN OVERST, fa och stora. Har: antal order, ordervarde,
 *      provision och slutdatum — och slutdatumet ar det enda av dem som gor att
 *      nagon lyfter telefonen, sa det far en egen ton nar det brinner.
 *   2. RESTEN I FLIKAR, inte i en spalt. En kund med tre order, tolv samtal och
 *      tva bilagor ar fyra olika fragor, och den som har en av dem ska inte
 *      rulla forbi de andra tre.
 *   3. EN TIDSLINJE. Det ar den enda delen som svarar pa "vad har hant" utan att
 *      man laser datum och raknar sjalv.
 *
 * DET SOM MEDVETET INTE ANAMMATS ar den tomma faltmatrisen. Bada systemen ritar
 * varje falt aven nar det ar tomt, och en kolumn med atta streck i ser ut som
 * ett trasigt kort. Har sager en saknad uppgift ingenting — samma linje som
 * ordervardet i 0050 tog.
 * =============================================================================
 *
 * =============================================================================
 * KORTET AR KUNDEN, INTE ORDERN.
 *
 * Det ar den enda riktiga skillnaden mot att bara gora orderraden storre, och
 * den bestamdes uttryckligen: man gar in pa Nordbygg AB, inte pa order #4712.
 *
 * Foljden ar att talen overst ar kundens HELA historik och inte en manads, och
 * att "3 order · 71 640 kr" kan sta over ett kort man oppnade fran en order pa
 * 11 940 kr. Det ar hela poangen: den sortens uppgift finns ingen annanstans i
 * navet i dag.
 * =============================================================================
 */
export function Kundkort({
  kund,
  /** Ordern man klickade pa. Star forst i orderfliken och markeras. */
  ankareId,
  paket,
  personer,
  namn,
  hanterare,
  bokforare,
  mig,
  /** Faststallda manader, for `Atgarder`. Se `harStangdPeriod`. */
  stangda,
  tjanster,
  bilagor,
  samtal,
  idag,
}: {
  kund: Kund<Orderrad>;
  ankareId: string;
  paket: Paket[];
  personer: { id: string; namn: string }[];
  namn: Map<string, string>;
  hanterare: boolean;
  bokforare: boolean;
  mig: string;
  stangda: string[];
  tjanster: Map<string, Tjansterad[]>;
  bilagor: Map<string, Orderbilaga[]>;
  samtal: Map<string, Samtalsrad[]>;
  idag: string;
}) {
  const [flik, setFlik] = useState<Flik>("oversikt");

  // Samtalen och bilagorna ar KUNDENS, inte en orders. En kund med tre avtal har
  // ett telefonnummer, och den som letar efter samtalet dar kunden sa ja ska inte
  // behova veta vilken av de tre ordrarna det hamnade pa.
  const allaSamtal = kund.order.flatMap((o) => samtal.get(o.id) ?? []);
  // Bara ANTALET behovs har — raderna ritas per order langre ner, eftersom
  // uppladdningen hor till en order och inte till kunden.
  const bilageantal = kund.order.reduce((s, o) => s + (bilagor.get(o.id)?.length ?? 0), 0);

  const flikar: { id: Flik; ikon: string; etikett: string; raknare?: number }[] = [
    { id: "oversikt", ikon: "konto", etikett: "Översikt" },
    { id: "order", ikon: "sedel", etikett: "Order", raknare: kund.antal },
    { id: "samtal", ikon: "chatt", etikett: "Samtal", raknare: allaSamtal.length },
    { id: "bilagor", ikon: "rutiner", etikett: "Bilagor", raknare: bilageantal },
    { id: "historik", ikon: "logg", etikett: "Historik" },
  ];

  return (
    <div className="flex min-h-full flex-col">
      <Highlights kund={kund} idag={idag} />

      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        {/*
          FLIKARNA STAR I EN VANSTERSPALT PA DATOR OCH SOM EN RULLBAR RAD PA
          TELEFON — exakt samma form som installningsrutans kategorier. Det ar ett
          medvetet lan: den som lart sig att kategorierna star till vanster i en
          svavande ruta ska inte behova lara sig det igen.
        */}
        <nav
          aria-label="Kundkortet"
          className="nav-scroll flex shrink-0 gap-1 overflow-x-auto border-b border-canvas bg-surface-alt p-3 sm:w-52 sm:flex-col sm:overflow-x-visible sm:border-r sm:border-b-0 sm:p-4"
        >
          {flikar.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFlik(f.id)}
              aria-current={flik === f.id ? "page" : undefined}
              className={cn(
                "flex min-h-11 shrink-0 items-center gap-2.5 rounded-full px-4 text-body whitespace-nowrap",
                "transition-colors duration-fast ease-brand",
                flik === f.id
                  ? "bg-surface font-semibold text-ink-900 shadow-elev-1"
                  : "text-ink-500 hover:bg-surface/70 hover:text-ink-900",
              )}
            >
              <Ikon namn={f.ikon} className="size-4 shrink-0" />
              {f.etikett}
              {f.raknare !== undefined && f.raknare > 0 && (
                <span className="tnum text-micro text-ink-500">{f.raknare}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 p-4 sm:p-6">
          {flik === "oversikt" && (
            <Oversikt
              kund={kund}
              paket={paket}
              namn={namn}
              hanterare={hanterare}
              mig={mig}
              tjanster={tjanster}
              samtal={allaSamtal}
              idag={idag}
            />
          )}

          {flik === "order" && (
            <div className="flex flex-col gap-4">
              {kund.order.map((o) => (
                <Orderdetalj
                  key={o.id}
                  o={o}
                  ankare={o.id === ankareId}
                  paketnamn={paket.find((p) => p.id === o.package_id)?.label ?? `Paket ${o.package_id}`}
                  saljare={hanterare ? namn.get(o.salesperson_id) : undefined}
                  tjanster={tjanster.get(o.id) ?? []}
                  bilagor={bilagor.get(o.id) ?? []}
                  paket={paket}
                  personer={personer}
                  hanterare={hanterare}
                  bokforare={bokforare}
                  mig={mig}
                  stangda={stangda}
                  idag={idag}
                />
              ))}
            </div>
          )}

          {flik === "samtal" && (
            <Fack
              titel="Samtal på kundens nummer"
              under={
                allaSamtal.length > 0
                  ? `${allaSamtal.length} samtal · ${langd(summering(allaSamtal).sekunder)} taltid`
                  : undefined
              }
            >
              {/* `Samtal` bar redan hela listan, spelaren och de fyra skalen
                  till att en inspelning saknas — inget av det ritas om har.
                  `forvaltOppet` lades till i komponenten samma dag som den har
                  fliken: att klicka pa fliken ÄR valet att se samtalen, och en
                  hopfalld lista bakom ett andra klick hade varit ett klick for
                  mycket pa en fraga som redan ar besvarad. */}
              <Samtal samtal={allaSamtal} forvaltOppet />
            </Fack>
          )}

          {flik === "bilagor" && (
            <div className="flex flex-col gap-4">
              {bilageantal === 0 && (
                <EmptyState
                  rubrik="Inga bilagor"
                  text="Avtalet laddas upp på ordern — i formuläret när den läggs, eller under Order här intill."
                />
              )}
              {kund.order
                .filter((o) => (bilagor.get(o.id) ?? []).length > 0)
                .map((o) => (
                  <Fack key={o.id} titel={`Ordern signerad ${o.signed_on}`}>
                    <Bilaga
                      orderId={o.id}
                      bilagor={bilagor.get(o.id) ?? []}
                      garAttRatta={o.status === "utkast" || o.status === "inskickad"}
                      nuvarande={nuvarandeFor(o)}
                    />
                  </Fack>
                ))}
            </div>
          )}

          {flik === "historik" && <Historik kund={kund} namn={namn} hanterare={hanterare} />}
        </div>
      </div>
    </div>
  );
}

type Flik = "oversikt" | "order" | "samtal" | "bilagor" | "historik";

// -----------------------------------------------------------------------------
// Highlights-panelen
// -----------------------------------------------------------------------------

/**
 * De fyra talen som avgor vad man gor.
 *
 * FYRA, OCH INTE ATTA. Salesforce sager fyra till sex, och skalet ar att en rad
 * med atta tal inte har nagot storst — da ar man tillbaka i den gra vaggen
 * kortet skulle bort fran. Manadsintakten och antalet tjanster star darfor i
 * oversiktsfliken och inte har: de ar uppgifter, inte beslut.
 *
 * SLUTDATUMET AR DET ENDA SOM BYTER FARG. De tre andra ar historik och andrar
 * sig inte av att man laser dem. Slutdatumet ar en frist, och en frist som gar ut
 * om tre veckor ska inte se ut som en frist som gar ut om tre ar.
 */
function Highlights({ kund, idag }: { kund: Kund<Orderrad>; idag: string }) {
  const kvar = kund.slutdatum ? dagarTill(kund.slutdatum, idag) : null;

  return (
    <div className="flex flex-wrap items-end gap-x-10 gap-y-5 border-b border-canvas bg-surface px-4 pt-4 pb-5 sm:px-6">
      <Tal
        etikett="Order"
        varde={String(kund.antal)}
        under={
          kund.makulerade > 0
            ? `varav ${kund.makulerade} makulerad${kund.makulerade === 1 ? "" : "e"}`
            : kund.levande === kund.antal
              ? "alla i kraft"
              : undefined
        }
      />
      <Tal
        etikett="Ordervärde"
        varde={kronor(kund.ordervarde)}
        under={
          kund.utanVarde > 0
            ? `${kund.utanVarde} order saknar värde`
            : kund.manadsintakt > 0
              ? `${kronor(kund.manadsintakt)}/mån`
              : undefined
        }
      />
      <Tal etikett="Provision" varde={kronor(kund.provision)} under="sammanlagt utbetalt" />
      <Tal
        etikett="Avtalet löper till"
        varde={kund.slutdatum ?? "—"}
        under={
          kvar === null
            ? "inget avtal i kraft"
            : kvar < 0
              ? `gick ut för ${Math.abs(kvar)} dagar sedan`
              : `${kvar} dagar kvar`
        }
        ton={kvar === null ? "tyst" : kvar < 0 ? "fara" : kvar <= 90 ? "varning" : undefined}
      />
    </div>
  );
}

function Tal({
  etikett,
  varde,
  under,
  ton,
}: {
  etikett: string;
  varde: string;
  under?: string;
  ton?: "varning" | "fara" | "tyst";
}) {
  return (
    <div className="min-w-0">
      <p className="text-micro uppercase text-ink-500">{etikett}</p>
      <p
        className={cn(
          "tnum text-h1",
          ton === "fara" ? "text-danger-ink" : ton === "varning" ? "text-warn-ink" : "text-ink-900",
        )}
      >
        {varde}
      </p>
      {/* Underraden ritas bara nar den sager nagot. En rad som star tom haller
          hojden pa kortet utan att bara en uppgift. */}
      {under && (
        <p
          className={cn(
            "text-small",
            ton === "fara" ? "text-danger-ink" : ton === "varning" ? "text-warn-ink" : "text-ink-500",
          )}
        >
          {under}
        </p>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Fliken Oversikt
// -----------------------------------------------------------------------------

function Oversikt({
  kund,
  paket,
  namn,
  hanterare,
  mig,
  tjanster,
  samtal,
  idag,
}: {
  kund: Kund<Orderrad>;
  paket: Paket[];
  namn: Map<string, string>;
  hanterare: boolean;
  mig: string;
  tjanster: Map<string, Tjansterad[]>;
  samtal: Samtalsrad[];
  idag: string;
}) {
  // Det avtal som racker langst. Tidslinjen visar ETT avtal, och da ska det vara
  // det som avgor nar kunden slutar vara kund.
  const bar = kund.order
    .filter((o) => raknas(o.status) && o.ends_on)
    .reduce<Orderrad | null>((b, o) => (b === null || o.ends_on > b.ends_on ? o : b), null);

  const levandeTjanster = kund.order
    .filter((o) => raknas(o.status))
    .flatMap((o) => (tjanster.get(o.id) ?? []).map((t) => ({ t, loptid: o.term_months })));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* -------------------------------------------------------------------- */}
      {/* Om kunden — HubSpots vanstra spalt. Egenskaperna, ingenting annat.    */}
      {/* -------------------------------------------------------------------- */}
      <Fack titel="Om kunden">
        <dl className="flex flex-col">
          <Uppgift etikett="Organisationsnummer" varde={kund.orgnr || null} tnum />
          <Uppgift etikett="Kontaktperson" varde={kund.kontakt.namn || null} />
          <Uppgift
            etikett="Telefon"
            varde={
              kund.kontakt.telefon ? (
                <a href={`tel:${kund.kontakt.telefon.replace(/\s/g, "")}`} className="tnum underline underline-offset-2">
                  {kund.kontakt.telefon}
                </a>
              ) : null
            }
          />
          <Uppgift
            etikett="Mejl"
            varde={
              kund.kontakt.mejl ? (
                <a href={`mailto:${kund.kontakt.mejl}`} className="underline underline-offset-2">
                  {kund.kontakt.mejl}
                </a>
              ) : null
            }
          />
          <Uppgift etikett="Kund sedan" varde={kund.kundSedan || null} tnum />
          {hanterare && (
            <Uppgift
              etikett="Säljare"
              varde={
                // Fler an en saljare kan ha lagt order pa samma kund. Alla namnges;
                // ett enda namn hade varit fel sa fort en kollega tagit over.
                [...new Set(kund.order.map((o) => namn.get(o.salesperson_id)).filter(Boolean))].join(
                  ", ",
                ) || null
              }
            />
          )}
          <Uppgift
            etikett="Samtal"
            varde={
              samtal.length > 0
                ? `${samtal.length} · ${langd(summering(samtal).sekunder)} taltid`
                : null
            }
          />
        </dl>
      </Fack>

      {/* -------------------------------------------------------------------- */}
      {/* Avtalet — tidslinjen, och handlingen om det brinner.                 */}
      {/* -------------------------------------------------------------------- */}
      <Fack titel="Avtalet">
        {bar === null ? (
          <p className="text-small text-ink-500">
            Inget avtal är i kraft. {kund.makulerade > 0 ? "Allt är makulerat." : "Kunden har inga godkända order."}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <Tidslinje o={bar} idag={idag} />

            <dl className="flex flex-col">
              <Uppgift
                etikett="Paket"
                varde={paket.find((p) => p.id === bar.package_id)?.label ?? `Paket ${bar.package_id}`}
              />
              <Uppgift etikett="Bindningstid" varde={`${bar.term_months} månader`} />
              <Uppgift
                etikett="Månadsavgift"
                varde={bar.monthly_amount === null ? null : kronor(bar.monthly_amount)}
                tnum
              />
            </dl>

            {/* Fornyelsen ritas BARA nar avtalet narmar sig sitt slut. Tva
                knappar som alltid star dar gor "forlang" till en rutin i stallet
                for en handling, och det ar vid nittio dagar handlingen blir
                aktuell — samma grans som bevakningskortet och orderkortets list. */}
            {dagarTill(bar.ends_on, idag) <= 90 && bar.renewal_outcome === null && (
              <div className="rounded-sm bg-warn-tint p-3">
                <Fornyelse id={bar.id} bolag={kund.bolag} min={bar.salesperson_id === mig} />
              </div>
            )}

            {bar.renewal_outcome === "forlangd" && (
              <Badge ton="brand">Förlängd — den nya ordern bär avtalet</Badge>
            )}
            {bar.renewal_outcome === "avslutad" && (
              <div className="flex flex-col gap-1">
                <Badge ton="danger">Kunden förlänger inte</Badge>
                {bar.renewal_reason && (
                  <p className="text-small text-ink-500">{bar.renewal_reason}</p>
                )}
              </div>
            )}
          </div>
        )}
      </Fack>

      {/* -------------------------------------------------------------------- */}
      {/* Tjansterna — HubSpots hogerspalt: de kopplade posterna.              */}
      {/* Ritas inte alls nar kunden inte har nagra. Ett tomt fack sager bara   */}
      {/* att facket finns.                                                    */}
      {/* -------------------------------------------------------------------- */}
      {levandeTjanster.length > 0 && (
        <Fack titel="Tjänster i kraft" className="lg:col-span-2">
          <ul className="flex flex-col divide-y divide-canvas">
            {levandeTjanster.map(({ t, loptid }) => (
              <li key={t.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
                <span className="text-body text-ink-900">{t.name}</span>
                <span className="text-small text-ink-500">
                  {FAKTURERING_ETIKETT[t.billing]} {kronor(t.amount)}
                  {t.billing === "manad" ? "/mån" : ""}
                </span>
                <span className="flex-1" />
                {t.ends_on && (
                  <span className="tnum text-small text-ink-500">egen bindning till {t.ends_on}</span>
                )}
                <span className="tnum text-small text-ink-900">
                  {kronor(tjanstensVarde(t, loptid))}
                </span>
                {t.renewal_outcome === "avslutad" && <Badge ton="danger">Avslutad</Badge>}
                {t.renewal_outcome === "forlangd" && <Badge ton="brand">Förlängd</Badge>}
              </li>
            ))}
          </ul>
        </Fack>
      )}
    </div>
  );
}

/**
 * Avtalets loptid som en stapel.
 *
 * =============================================================================
 * SAMMA STAPEL SOM PA ORDERKORTET, MEN MED SINA DATUM UTSKRIVNA.
 *
 * I rutnatet ar den en pixelrad som gar att skumma over tjugo kort. Har ar den
 * sakens mitt, och da ska bada andarna sta namngivna — en stapel utan skala ar
 * en bild, inte en uppgift.
 *
 * MARKOREN FOR I DAG STAR I STAPELN och inte under den. Avstandet mellan
 * markoren och hogerkanten ÄR den tid som ar kvar, och det ar den langden man
 * laser. En markor under stapeln hade tvingat ogat att ga tva ganger.
 * =============================================================================
 */
function Tidslinje({ o, idag }: { o: Orderrad; idag: string }) {
  const { andel, dagarKvar, dagarTotalt } = avtalsforlopp(o.starts_on, o.ends_on, idag);
  const ton = dagarKvar < 0 ? "bg-danger" : dagarKvar <= 90 ? "bg-warn" : "bg-brand-500";

  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-canvas">
        <div
          className={cn("h-full rounded-full", ton)}
          style={{ width: `${Math.round(andel * 100)}%` }}
        />
      </div>
      <div className="flex items-baseline justify-between gap-3 text-small">
        <span className="tnum text-ink-500">{o.starts_on}</span>
        <span
          className={cn(
            "text-small",
            dagarKvar < 0 ? "text-danger-ink" : dagarKvar <= 90 ? "text-warn-ink" : "text-ink-500",
          )}
        >
          {dagarKvar < 0
            ? `gick ut för ${Math.abs(dagarKvar)} dagar sedan`
            : `${dagarKvar} av ${dagarTotalt} dagar kvar`}
        </span>
        <span className="tnum font-semibold text-ink-900">{o.ends_on}</span>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Fliken Order
// -----------------------------------------------------------------------------

const TON: Record<Orderstatus, "neutral" | "warn" | "ok" | "brand" | "danger"> = {
  utkast: "neutral",
  inskickad: "warn",
  signerad: "ok",
  betald: "brand",
  makulerad: "danger",
};

/**
 * En order i sin helhet.
 *
 * ALLT SOM PLOCKADES BORT FRAN LISTKORTET STAR HAR, och det ar hela affaren:
 * utkopet, provisionskallan, anteckningen, makuleringsskalet, tjansteraderna,
 * bilagan och atgarderna. Skillnaden mot forut ar inte vilka uppgifter som finns
 * utan VAR de star — i en vy man oppnat med avsikt, i stallet for i en lista man
 * skummar.
 */
function Orderdetalj({
  o,
  ankare,
  paketnamn,
  saljare,
  tjanster,
  bilagor,
  paket,
  personer,
  hanterare,
  bokforare,
  mig,
  stangda,
  idag,
}: {
  o: Orderrad;
  ankare: boolean;
  paketnamn: string;
  saljare?: string;
  tjanster: Tjansterad[];
  bilagor: Orderbilaga[];
  paket: Paket[];
  personer: { id: string; namn: string }[];
  hanterare: boolean;
  bokforare: boolean;
  mig: string;
  stangda: string[];
  idag: string;
}) {
  // `harStangdPeriod` och inte en egen jamforelse: den slar upp manaden ur
  // signeringsdatumet med `periodFor`, och det ar samma funktion databasen
  // genererar `period_month` med. Tva svar pa samma fraga hinner glida isar.
  const stangdPeriod = harStangdPeriod(o.signed_on, stangda);

  return (
    <section
      className={cn(
        "flex flex-col gap-4 rounded-md bg-surface p-4 shadow-elev-1",
        // Ordern man kom fran far en ram. Har kunden tre order ar det annars inte
        // sagt vilken av dem man just klickade pa, och den fragan stalls direkt.
        ankare && "ring-1 ring-brand-200",
      )}
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <h3 className="text-h2 text-ink-900">
          {paketnamn} · {o.term_months} mån
        </h3>
        <Badge ton={TON[o.status]}>{STATUS_ETIKETT[o.status]}</Badge>
        {o.is_addon && <Badge>Tillägg</Badge>}
        {ankare && <Badge ton="brand">Den du kom från</Badge>}
        <span className="flex-1" />
        <span className="tnum text-small text-ink-500">signerad {o.signed_on}</span>
      </header>

      <dl className="grid gap-x-6 sm:grid-cols-2">
        <Uppgift
          etikett="Ordervärde"
          varde={o.order_value === null ? null : kronor(o.order_value)}
          under={
            o.order_value === null
              ? undefined
              : o.order_value_source === "manual"
                ? "satt för hand"
                : "pris × avtalstid"
          }
          tnum
        />
        <Uppgift
          etikett="Provision"
          varde={o.commission_amount === null ? null : kronor(o.commission_amount)}
          under={
            o.commission_source === "manual"
              ? "satt för hand"
              : o.commission_source === "manager"
                ? "säljchefens egen försäljning"
                : o.commission_source === "buyout"
                  ? "räknad efter utköp"
                  : undefined
          }
          tnum
        />
        <Uppgift
          etikett="Månadsavgift"
          varde={o.monthly_amount === null ? null : `${kronor(o.monthly_amount)}/mån`}
          tnum
        />
        {/*
          UTKOPET MED NETTOT UTSKRIVET. De tre talen betyder bara nagot
          TILLSAMMANS: 11 940 kr ensamt sager fel sak om affaren, och 6 940 kr
          ensamt gar inte att stamma av mot avtalet. Se 0060.
        */}
        <Uppgift
          etikett="Utköp"
          varde={
            typeof o.buyout_amount === "number" && o.buyout_amount > 0
              ? `− ${kronor(o.buyout_amount)}`
              : null
          }
          under={
            typeof o.buyout_amount === "number" && o.buyout_amount > 0 && o.order_value !== null
              ? `kvar ${kronor(o.order_value - o.buyout_amount)}`
              : typeof o.buyout_amount === "number" && o.buyout_amount > 0
                ? "dras av när ordern godkänns"
                : undefined
          }
          tnum
        />
        <Uppgift etikett="Avtalet börjar" varde={o.starts_on} tnum />
        <Uppgift etikett="Avtalet slutar" varde={o.ends_on} tnum />
        <Uppgift etikett="Räknas i" varde={manadsnamn(o.period_month)} />
        {saljare && <Uppgift etikett="Säljare" varde={saljare} />}
      </dl>

      {tjanster.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-sm bg-canvas p-3">
          {tjanster.map((t) => (
            <li key={t.id} className="text-small text-ink-700">
              {t.name} · {FAKTURERING_ETIKETT[t.billing]} {kronor(t.amount)}
              {t.billing === "manad" ? "/mån" : ""} · {kronor(tjanstensVarde(t, o.term_months))} i
              ordervärde
              {t.ends_on ? ` · egen bindningstid till ${t.ends_on}` : ""}
            </li>
          ))}
        </ul>
      )}

      {o.status === "makulerad" && o.cancelled_on && (
        <p className="rounded-sm bg-danger-tint p-3 text-small text-danger-ink">
          Makulerad {o.cancelled_on}. Avdraget belastar {o.cancelled_on.slice(0, 7)}.
          {o.cancel_reason ? ` ${o.cancel_reason}` : ""}
        </p>
      )}

      {o.note && o.status !== "makulerad" && (
        <p className="rounded-sm bg-canvas p-3 text-small text-ink-700">{o.note}</p>
      )}

      <Atgarder
        id={o.id}
        status={o.status}
        hanterare={hanterare}
        bokforare={bokforare}
        agare={o.salesperson_id === mig}
        upphovsperson={o.created_by === mig}
        order={{
          company_name: o.company_name,
          org_number: o.org_number,
          contact_name: o.contact_name,
          contact_phone: o.contact_phone,
          contact_email: o.contact_email,
          package_id: o.package_id,
          term_months: o.term_months,
          salesperson_id: o.salesperson_id,
          signed_on: o.signed_on,
          starts_on: o.starts_on,
          is_addon: o.is_addon,
          order_value: o.order_value,
          order_value_source: o.order_value_source,
          monthly_amount: o.monthly_amount,
          buyout_amount: o.buyout_amount ?? null,
          commission_amount: o.commission_amount,
          commission_source: o.commission_source,
          note: o.note,
        }}
        paket={paket}
        personer={personer}
        stangdPeriod={stangdPeriod}
        manad={manadsnamn(o.period_month)}
        idag={idag}
      />

      <Bilaga
        orderId={o.id}
        bilagor={bilagor}
        garAttRatta={o.status === "utkast" || o.status === "inskickad"}
        nuvarande={nuvarandeFor(o)}
      />
    </section>
  );
}

/** Uppgifterna `Bilaga` behover for att namnge filen. Samma pa bada stallen. */
function nuvarandeFor(o: Orderrad) {
  return {
    company_name: o.company_name,
    org_number: o.org_number,
    contact_name: o.contact_name,
    phone: o.contact_phone,
    package_id: String(o.package_id),
    term_months: String(o.term_months),
    signed_on: o.signed_on,
  };
}

// -----------------------------------------------------------------------------
// Fliken Historik
// -----------------------------------------------------------------------------

/**
 * Kundens hela historik som en tidslinje, aldst forst.
 *
 * ALDST FORST, tvartemot listan pa ordersidan. En lista man SKUMMAR ska ha det
 * nyaste overst; en berattelse man LASER borjar i borjan. Det ar samma val som
 * handelseloggen gor pa ett arende.
 *
 * INGEN POST SAKNAR EN KOLUMN BAKOM SIG. Se `orderhandelser` — ogonblicket da en
 * order skickades in har ingen tidsstampel, och det gapet lamnas i stallet for
 * att fyllas med en gissning.
 */
function Historik({
  kund,
  namn,
  hanterare,
}: {
  kund: Kund<Orderrad>;
  namn: Map<string, string>;
  hanterare: boolean;
}) {
  const poster = kund.order
    .flatMap((o) =>
      orderhandelser(o).map((h) => ({
        ...h,
        order: o,
      })),
    )
    .sort((a, b) => a.datum.localeCompare(b.datum));

  if (poster.length === 0) {
    return <EmptyState rubrik="Ingen historik" text="Kunden har inga order att berätta om." />;
  }

  return (
    <ol className="flex flex-col">
      {poster.map((p, i) => (
        <li key={`${p.order.id}-${p.rubrik}-${i}`} className="flex gap-4">
          {/* Sparet: en prick och en linje ner till nasta post. Linjen ritas av
              LI:t och inte av en egen ram, sa att den sista posten inte far en
              linje som pekar ut i ingenting. */}
          <div className="flex w-2 shrink-0 flex-col items-center pt-2">
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                p.ton === "ok"
                  ? "bg-ok"
                  : p.ton === "danger"
                    ? "bg-danger"
                    : p.ton === "brand"
                      ? "bg-brand-500"
                      : "bg-ink-300",
              )}
            />
            {i < poster.length - 1 && <span className="w-px flex-1 bg-canvas" />}
          </div>

          <div className="min-w-0 flex-1 pb-5">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="tnum text-small text-ink-500">{p.datum}</span>
              <span className="text-body font-semibold text-ink-900">{p.rubrik}</span>
            </div>
            <p className="text-small text-ink-500">
              {p.order.term_months} mån
              {p.order.commission_amount !== null
                ? ` · ${kronor(p.order.commission_amount)} provision`
                : ""}
              {hanterare && namn.get(p.order.salesperson_id)
                ? ` · ${namn.get(p.order.salesperson_id)}`
                : ""}
            </p>
            {p.text && <p className="mt-1 text-small text-ink-700">{p.text}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

// -----------------------------------------------------------------------------
// Delar
// -----------------------------------------------------------------------------

function Fack({
  titel,
  under,
  className,
  children,
}: {
  titel: string;
  under?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("rounded-md bg-surface p-4 shadow-elev-1", className)}>
      <div className="mb-3">
        <h3 className="text-h2 text-ink-900">{titel}</h3>
        {under && <p className="text-small text-ink-500">{under}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * En uppgift i en definitionslista.
 *
 * SAKNAS VARDET RITAS RADEN INTE ALLS. Det ar skillnaden mot bade Salesforce och
 * HubSpot, som ritar varje falt i layouten aven tomt — och en spalt med atta
 * streck i ser ut som ett trasigt kort i stallet for en kund vi inte hunnit fylla
 * i allt om. Samma linje som ordervardet i 0050 tog: tystnad framfor en nolla.
 */
function Uppgift({
  etikett,
  varde,
  under,
  tnum,
}: {
  etikett: string;
  varde: ReactNode | null;
  under?: string;
  tnum?: boolean;
}) {
  if (varde === null || varde === undefined || varde === "") return null;

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-canvas py-2 last:border-0">
      <dt className="text-small text-ink-500">{etikett}</dt>
      <dd className="min-w-0 text-right">
        <span className={cn("text-body text-ink-900", tnum && "tnum")}>{varde}</span>
        {under && <span className="block text-small text-ink-500">{under}</span>}
      </dd>
    </div>
  );
}
