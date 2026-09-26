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
  type Paket,
} from "@/lib/order";
import {
  STATUSTON,
  avtalsforlopp,
  harAtgarder,
  orderhandelser,
  type Kund,
  type Statuston,
} from "@/lib/ordervy";
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
                <Orderpost
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
          {/*
            SAMMA TABELL SOM I ORDERFLIKEN. Forut var det en loepande lista har
            och en annan loepande lista dar, och tva olika satt att visa samma sex
            uppgifter later som tva olika saker.

            VARDET RAKNAS PER ORDER och inte en gang for alla: en tjanst pa ett
            tvaarsavtal och en pa ett trearsavtal drar olika mycket ordervarde av
            samma manadsavgift. Darfor bar `levandeTjanster` sin egen `loptid`
            hela vagen hit, och tabellen tar fardigraknade rader i stallet for att
            rakna sjalv.
          */}
          <Tjanstetabell
            rader={levandeTjanster.map(({ t, loptid }) => ({
              t,
              varde: tjanstensVarde(t, loptid),
            }))}
          />
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

/**
 * Statusens ton som en 3 px list till vanster.
 *
 * SAMMA TON SOM LISTKORTET, OCH DET AR HELA SKALET till att `STATUSTON` bor i
 * `lib/ordervy.ts`. Ett gront kort i rutnatet ska oppna en gron orderpost — kunde
 * de sarga sig fran varandra hade fargkodningen blivit varre an ingen.
 */
const RAIL: Record<Statuston, string> = {
  neutral: "border-l-ink-300",
  warn: "border-l-warn",
  ok: "border-l-ok",
  brand: "border-l-brand-500",
  danger: "border-l-danger",
};

/**
 * En order i orderfliken: huvudet alltid synligt, resten utfallbar.
 *
 * =============================================================================
 * ORDERN MAN KOM FRAN AR UTFALLD. DE ANDRA AR IHOPFALLDA.
 *
 * Forsta versionen av den har fliken ritade varje order helt utfalld, och for en
 * kund med tre avtal blev det tre fulla uppsattningar belopp, datum,
 * tjansterader, atgardsknappar och en bilageuppladdning — alltsa exakt den vagg
 * som hela omlaggningen skulle bort fran, en niva langre in. Att den lag i en
 * modal gjorde den varre: fonstret ar lagre an sidan.
 *
 * Nu ar huvudet alltid synligt — status, datum, paket, ordervarde, provision —
 * och det racker for att valja. Ordern man klickade pa star oppen; de andra
 * oppnas med ett tryck.
 *
 * `<details>` OCH INTE `useState`. Tre saker foljer gratis: Esc och tangentbord
 * fungerar, webblasarens sidsokning (Ctrl+F) hittar text i en ihopfalld post och
 * fäller ut den, och laget overlever att React ritar om listan. Ett eget
 * tillstand hade kravt kod for var och en av dem.
 * =============================================================================
 */
function Orderpost({
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
  const ton = STATUSTON[o.status];

  // FRAGAS INNAN RUBRIKEN RITAS. `Atgarder` returnerar null for varje
  // status/roll-kombination som inte har nagot att gora — en makulerad order, ett
  // utkast man inte ager — och en rubrik "Åtgärder" over ingenting ar varre an
  // ingen rubrik. Predikatet ar komponentens EGEN grind, inte en kopia av den:
  // se `harAtgarder` i lib/ordervy.ts.
  const atgarder = harAtgarder({
    status: o.status,
    hanterare,
    bokforare,
    agare: o.salesperson_id === mig,
    upphovsperson: o.created_by === mig,
  });

  return (
    <details
      open={ankare}
      className={cn(
        "group overflow-hidden rounded-md border-l-[3px] bg-surface shadow-elev-1",
        RAIL[ton],
        // Ordern man kom fran far en ring OCH ett pillret nedan. Bara en ring ar
        // for tyst — den forsvinner mot skuggan — och bara ett piller kraver att
        // man laser. Tillsammans syns den i forbifarten.
        ankare && "ring-1 ring-brand-500",
      )}
    >
      {/*
        SUMMARY AR HUVUDET, inte en extra rad ovanfor det.
        ---------------------------------------------------------------------
        Uppgifterna star EN gang. Hade huvudet ritats bade i summary och i
        kroppen hade en utfalld post visat status och datum tva ganger, och den
        som fallde ut den hade undrat vad skillnaden var.

        `list-none` tar bort triangeln i Firefox och moderna Chrome;
        `::-webkit-details-marker` behovs for aldre WebKit, dar `list-style`
        ignoreras pa <summary> och triangeln annars ligger kvar mitt i raden.
      */}
      <summary className="flex cursor-pointer list-none items-start gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {/*
              DATUMET AR POSTENS NAMN, och det ar ett val mot paketnamnet.
              En kund har ofta samma paket pa alla sina order — "Företagspaket"
              tre ganger sager ingenting om vilken som ar vilken. Datumet ar det
              som skiljer dem, och i tabellsiffror linjerar det nedat i listan.
            */}
            <h3 className="tnum text-h2 text-ink-900">{o.signed_on}</h3>
            <Badge ton={ton}>{STATUS_ETIKETT[o.status]}</Badge>
            {o.is_addon && <Badge>Tillägg</Badge>}
            {ankare && <Badge ton="brand">Den du kom från</Badge>}
          </div>

          <p className="text-small text-ink-500">
            {paketnamn} · {o.term_months} mån
            {saljare ? ` · ${saljare}` : ""}
          </p>
        </div>

        {/*
          TVA TAL I HUVUDET, hogerstallda i tabellsiffror sa att de linjerar
          mellan posterna. Det ar de tva man jamfor nar man valjer vilken order
          man vill oppna; allt annat kraver att posten fälls ut.
        */}
        <div className="hidden shrink-0 items-baseline gap-6 sm:flex">
          <span className="text-right">
            <span className="block tnum text-body font-semibold text-ink-900">
              {o.order_value === null ? "—" : kronor(o.order_value)}
            </span>
            <span className="block text-micro uppercase text-ink-500">Ordervärde</span>
          </span>
          <span className="text-right">
            <span className="block tnum text-body font-semibold text-brand-700">
              {o.commission_amount === null ? "—" : kronor(o.commission_amount)}
            </span>
            <span className="block text-micro uppercase text-ink-500">Provision</span>
          </span>
        </div>

        <Ikon
          namn="fram"
          className="mt-1.5 size-5 shrink-0 text-ink-300 transition-transform duration-fast ease-brand group-open:rotate-90"
        />
      </summary>

      <div className="flex flex-col gap-5 border-t border-canvas p-4">
        <Affaren o={o} />
        <Avtalet o={o} idag={idag} />

        {/* TJANSTERNA AR ETT EGET BAND, inte en tabell inuti "Avtalet".
            En rubrik per band, och ett band per fraga: "hur lange galler
            avtalet" och "vad bestar affaren av" ar tva fragor. Forst lag
            tabellen under avtalsrubriken, och da hade det bandet tva. */}
        {tjanster.length > 0 && (
          <div>
            <Sektion titel="Tjänster på ordern" />
            <Tjanstetabell
              rader={tjanster.map((t) => ({ t, varde: tjanstensVarde(t, o.term_months) }))}
            />
          </div>
        )}

        {o.status === "makulerad" && o.cancelled_on && (
          <p className="rounded-sm bg-danger-tint p-3 text-small text-danger-ink">
            <strong>Makulerad {o.cancelled_on}.</strong> Avdraget belastar{" "}
            {manadsnamn(`${o.cancelled_on.slice(0, 7)}-01`)}, inte månaden ordern tecknades.
            {o.cancel_reason ? ` ${o.cancel_reason}` : ""}
          </p>
        )}

        {o.note && o.status !== "makulerad" && (
          <div>
            <Sektion titel="Anteckning" />
            <p className="text-small text-ink-700">{o.note}</p>
          </div>
        )}

        {/*
          ATGARDERNA FAR EN RUBRIK, och det ar inte pynt: utan den slutade posten
          i ett godtyckligt antal loesa knappar, och bilageuppladdningen darunder
          sag ut att hora till beloppen.

          MEN RUBRIKEN RITAS BARA NAR DET FINNS NAGOT UNDER DEN — se `atgarder`
          ovan. Att lagga till rubriken utan den kontrollen var ett fel jag hann
          gora samma dag: for en makulerad order, eller ett utkast man inte ager,
          hade posten da slutat i orden "ÅTGÄRDER" och en hairline over tom luft.
        */}
        {atgarder && (
          <div>
            <Sektion titel="Åtgärder" />
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
              // `harStangdPeriod` och inte en egen jamforelse mot `period_month`:
              // den slar upp manaden ur signeringsdatumet med `periodFor`, alltsa
              // samma funktion databasen genererar kolumnen med. Tva svar pa samma
              // fraga hinner glida isar.
              stangdPeriod={harStangdPeriod(o.signed_on, stangda)}
              manad={manadsnamn(o.period_month)}
              idag={idag}
            />
          </div>
        )}

        {/* Bilagan har ingen sadan kontroll, och behover ingen: `Bilaga` ritar
            ALLTID minst uppladdningsrutan, aven for en order utan filer. */}
        <div>
          <Sektion titel="Avtal och bilagor" />
          <Bilaga
            orderId={o.id}
            bilagor={bilagor}
            garAttRatta={o.status === "utkast" || o.status === "inskickad"}
            nuvarande={nuvarandeFor(o)}
          />
        </div>
      </div>
    </details>
  );
}

/**
 * Affarens belopp, som en rakning.
 *
 * =============================================================================
 * ORDERVARDE − UTKOP = KVAR STAR SOM EN RAD MED RAKNETECKEN I.
 *
 * Kommentaren i den gamla vyn sa redan varfor: *"de tre talen betyder bara nagot
 * TILLSAMMANS: 11 940 kr ensamt sager fel sak om affaren, och 6 940 kr ensamt gar
 * inte att stamma av mot avtalet"*.
 *
 * Forsta versionen av kundkortet la dem anda i tre celler i ett rutnat — och
 * eftersom tomma celler foll bort kunde utkopet hamna i en annan spalt an
 * ordervardet, pa en annan rad, pa vissa order. Rakningen gick alltsa att LASA
 * men inte att FOLJA.
 *
 * Nu star de i rad med `−` och `=` mellan. Raknetecknen ar i ljusare ton: de ar
 * bindeord, inte tal. Och de star bara dar nar det FINNS ett utkop — en rad som
 * sager "23 880 − 0 = 23 880" pa varje vanlig order lar ogat att hoppa over
 * hela strecket.
 * =============================================================================
 */
function Affaren({ o }: { o: Orderrad }) {
  const utkop = typeof o.buyout_amount === "number" && o.buyout_amount > 0 ? o.buyout_amount : null;

  const vardekalla =
    o.order_value === null
      ? undefined
      : o.order_value_source === "manual"
        ? "satt för hand"
        : "pris × avtalstid";

  const provisionskalla =
    o.commission_source === "manual"
      ? "satt för hand"
      : o.commission_source === "manager"
        ? "säljchefens egen försäljning"
        : o.commission_source === "buyout"
          ? "räknad efter utköp"
          : undefined;

  return (
    <div
      role="group"
      aria-label="Affärens belopp"
      className="flex flex-wrap items-start gap-x-5 gap-y-4 rounded-sm bg-canvas p-4"
    >
      <Belopp etikett="Ordervärde" varde={o.order_value} under={vardekalla} stark />

      {utkop !== null && (
        <>
          <Tecken>−</Tecken>
          <Belopp
            etikett="Utköp"
            varde={utkop}
            under={o.order_value === null ? "dras av vid godkännandet" : undefined}
          />
          {/* NETTOT RAKNAS BARA NAR BADA TALEN FINNS. En inskickad order har
              utkop men annu inget ordervarde — det raknas fram vid
              godkannandet — och `null − 5 000` hade blivit ett pahittat tal. */}
          {o.order_value !== null && (
            <>
              <Tecken>=</Tecken>
              <Belopp etikett="Kvar" varde={o.order_value - utkop} stark />
            </>
          )}
        </>
      )}

      {/*
        AVDELAREN SKILJER TVA SLAGS PENGAR.
        Till vanster star vad affaren ar vard for BOLAGET — ordervardet, utkopet
        och nettot. Till hoger star vad den ger en PERSON, och vad kunden betalar.
        Utan strecket lag alla fem talen i en rad och laste som en enda rakning,
        och da ser provisionen ut att vara en term i ordervardet.

        DOLD UNDER 640 px. Da har raden redan brutits, och ett lodratt streck mitt
        i en ny rad pekar pa ingenting.
      */}
      <span aria-hidden className="hidden w-px self-stretch bg-ink-300/40 sm:block" />

      <Belopp
        etikett="Provision"
        varde={o.commission_amount}
        under={provisionskalla}
        ton="brand"
      />

      {o.monthly_amount !== null && (
        <Belopp etikett="Per månad" varde={o.monthly_amount} suffix="/mån" />
      )}
    </div>
  );
}

/** Raknetecknet mellan tva belopp. Ljusare ton: det ar ett bindeord, inte ett tal. */
function Tecken({ children }: { children: string }) {
  return (
    // Ingen `aria-hidden`: en skarmlasare ska lasa "minus" och "lika med"
    // mellan talen, annars blir rakningen tre loesa belopp.
    <span className="self-start pt-1 text-h2 leading-none text-ink-300">{children}</span>
  );
}

/**
 * Ett belopp med sin etikett UNDER sig.
 *
 * =============================================================================
 * ETIKETTEN STAR UNDER TALET, INTE TILL VANSTER OM DET.
 *
 * Det ar den enskilda andringen som gor mest for hur fliken laser, och skalet ar
 * geometriskt: med etiketten till vanster och vardet till hoger far varje rad TVA
 * lodrata kanter, och fyra av dem i ett tvakolumnsrutnat. Ogat har da ingen linje
 * att folja nedat.
 *
 * Med etiketten under talet har varje uppgift EN vansterkant, alla belopp borjar
 * pa samma pixel, och `tnum` gor att siffrorna dessutom linjerar tecken for
 * tecken. Det ar sa en kvittorad ser ut, och en affar ÄR en kvittorad.
 *
 * SAKNAS TALET SKRIVS ETT STRECK OCH INTE EN NOLLA. Order fran fore 0050 har
 * inget ordervarde och far inget i efterhand; "0 kr" hade last som en
 * gratisaffar. Skillnaden mot `Uppgift`, som utesluter hela raden, ar att
 * beloppen HAR en fast plats i rakningen — ett hal i "− =" hade varit varre an
 * ett streck.
 * =============================================================================
 */
function Belopp({
  etikett,
  varde,
  under,
  suffix = "",
  ton,
  stark,
}: {
  etikett: string;
  varde: number | null;
  under?: string;
  suffix?: string;
  ton?: "brand";
  /** Affarens huvudtal: ordervardet och nettot. En grad storre. */
  stark?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p
        className={cn(
          "tnum whitespace-nowrap",
          stark ? "text-h1" : "text-h2",
          ton === "brand" ? "text-brand-700" : "text-ink-900",
        )}
      >
        {varde === null ? "—" : `${kronor(varde)}${suffix}`}
      </p>
      <p className="text-micro uppercase text-ink-500">{etikett}</p>
      {under && <p className="text-small text-ink-500">{under}</p>}
    </div>
  );
}

/**
 * Avtalet: loptiden, de tre datumen och tjansterna.
 *
 * TIDSLINJEN RITAS BARA FOR ETT AVTAL SOM GALLER. En makulerad order har ingen
 * loptid att visa, och en inskickad order har ett genererat `ends_on` for ett
 * avtal som annu inte borjat gälla — en stapel dar hade pastatt att klockan
 * tickar pa nagot som inte ar avgjort. De far sina datum i klartext i stallet.
 */
function Avtalet({ o, idag }: { o: Orderrad; idag: string }) {
  return (
    <div className="flex flex-col gap-4">
      <Sektion titel="Avtalet" />

      {raknas(o.status) && o.ends_on && o.starts_on ? (
        <Tidslinje o={o} idag={idag} />
      ) : (
        <p className="text-small text-ink-500">
          <span className="tnum">{o.starts_on}</span> – <span className="tnum">{o.ends_on}</span> ·{" "}
          {o.status === "makulerad" ? "avtalet gäller inte" : "börjar gälla när ordern godkänts"}
        </p>
      )}

      {/*
        FAKTARUTNATET, och har ar `Faktum` ratt val — inte `Uppgift`.
        Tre eller fyra korta uppgifter med etiketten UNDER vardet ger linjerade
        vansterkanter hela vagen. `Uppgift` hade gett atta lodrata kanter och
        hairlines som inte moter varandra mellan spalterna, eftersom raderna har
        olika hojd; det var precis det felet den forsta versionen av den har
        fliken hade.
      */}
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Faktum etikett="Bindningstid" varde={`${o.term_months} mån`} />
        <Faktum etikett="Räknas i" varde={manadsnamn(o.period_month)} />
        <Faktum etikett="Ordern lades upp" varde={o.created_at.slice(0, 10)} tnum />
        {o.approved_at && <Faktum etikett="Godkänd" varde={o.approved_at.slice(0, 10)} tnum />}
      </dl>
    </div>
  );
}

/**
 * Tjansterna som en tabell med hogerstallda belopp.
 *
 * =============================================================================
 * EN TABELL OCH INTE EN LOPANDE MENING.
 *
 * Forut stod varje tjanst som *"Växel · Månadsavgift 495 kr/mån · 11 880 kr i
 * ordervärde · egen bindningstid till 2029-03-01"* — en mening per rad, med
 * belopp pa olika stallen i varje. Tre tjanster gav alltsa sex tal som INTE gick
 * att jamfora, trots att det ar den enda fragan man staller om en tjanstelista:
 * vilken kostar mest, och vad drar mest ordervarde?
 *
 * En tabell med `tnum` och `text-right` svarar pa det utan att nagon raknar.
 * =============================================================================
 *
 * ORDERVARDESKOLUMNEN SUMMERAS I FOTEN. Summan star i orderns ordervarde ovan
 * ocksa, men den gar inte att se DAR — och "vad av de 23 880 kronorna ar
 * tjanster?" ar en fraga nagon staller varje gang en order ifragasatts.
 */
function Tjanstetabell({ rader }: { rader: { t: Tjansterad; varde: number }[] }) {
  const summa = rader.reduce((s, r) => s + r.varde, 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[28rem] text-small">
        <caption className="sr-only">Tilläggstjänster på ordern</caption>
        <thead>
          <tr className="text-left text-micro uppercase text-ink-500">
            <th className="pb-2 font-normal">Tjänst</th>
            <th className="pb-2 font-normal">Fakturering</th>
            <th className="pb-2 text-right font-normal">Avgift</th>
            <th className="pb-2 text-right font-normal">I ordervärde</th>
          </tr>
        </thead>
        <tbody>
          {rader.map(({ t, varde }) => (
            <tr key={t.id} className="border-t border-canvas align-baseline">
              <td className="py-2 text-ink-900">
                {t.name}
                {/* Ett EGET slutdatum ar hela skalet till att tjansten kan fa en
                    egen paminnelse i stallet for att folja ordern. Det star
                    darfor pa raden — men bara nar det finns. */}
                {t.ends_on && (
                  <span className="block text-micro text-ink-500">
                    egen bindningstid till <span className="tnum">{t.ends_on}</span>
                  </span>
                )}
                {t.renewal_outcome === "avslutad" && (
                  <span className="block text-micro text-danger-ink">
                    avslutad{t.renewal_reason ? `: ${t.renewal_reason}` : ""}
                  </span>
                )}
                {t.renewal_outcome === "forlangd" && (
                  <span className="block text-micro text-brand-700">förlängd</span>
                )}
              </td>
              <td className="py-2 text-ink-500">{FAKTURERING_ETIKETT[t.billing]}</td>
              <td className="tnum py-2 text-right text-ink-700">
                {kronor(t.amount)}
                {t.billing === "manad" ? "/mån" : ""}
              </td>
              <td className="tnum py-2 text-right text-ink-900">{kronor(varde)}</td>
            </tr>
          ))}
        </tbody>
        {/* Foten ritas bara nar det finns mer an en rad att summera. En summa
            under ett enda tal upprepar bara talet. */}
        {rader.length > 1 && (
          <tfoot>
            <tr className="border-t border-ink-300/40">
              <td className="py-2 text-micro uppercase text-ink-500" colSpan={3}>
                Tjänsterna sammanlagt
              </td>
              <td className="tnum py-2 text-right font-semibold text-ink-900">{kronor(summa)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
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
 * En rubrik som delar en panel i band.
 *
 * =============================================================================
 * BANDEN AR VAD SOM GOR EN LANG PANEL LASBAR.
 *
 * En utfalld orderpost bar fem olika saker: beloppen, avtalet, en eventuell
 * anteckning, atgarderna och bilagorna. Utan rubriker ar det en spalt dar allt
 * ser lika viktigt ut — och sarskilt `Atgarder` och `Bilaga` blev oforklarliga,
 * eftersom bada ritar interaktiva ytor som utan en rubrik ser ut att hora till
 * talen ovanfor.
 *
 * RUBRIKEN AR MICRO OCH VERSAL, INTE EN <h4>. Den ar en avdelare i ett kort och
 * inte en niva i sidans rubrikträd; en fjarde rubriknivå inuti en modal hade
 * gjort dokumentets disposition svarare att folja for en skarmlasare an den
 * hairline den ersatter. Ordet racker.
 * =============================================================================
 */
function Sektion({ titel }: { titel: string }) {
  return (
    <div className="mb-2 flex items-center gap-3">
      <span className="text-micro uppercase text-ink-500">{titel}</span>
      <span aria-hidden className="h-px flex-1 bg-canvas" />
    </div>
  );
}

/**
 * En kort uppgift i ett rutnat: etiketten UNDER vardet.
 *
 * =============================================================================
 * SKILLNADEN MOT `Uppgift` ÄR VILKEN FORM DEN TAL, och de finns bada med flit.
 *
 * `Uppgift` ar en RAD: etikett vanster, varde hoger, hairline under. Den ar ratt
 * i en enspaltig lista dar uppgifterna har olika langd — "Om kunden" i
 * oversikten — eftersom hogerkanten da blir en egen linje att folja.
 *
 * `Faktum` ar en CELL: etikett under varde, allt vansterstallt. Den ar ratt i ett
 * RUTNAT, och det ar just dar `Uppgift` gar sonder: tva spalter av rader ger fyra
 * lodrata textkanter, hairlines som inte moter varandra eftersom raderna har
 * olika hojd, och ett `last:border-0` som bara traffar den DOM-sista cellen —
 * alltsa en spalt som slutar med en linje och en som inte gor det.
 *
 * Det var exakt sa forsta versionen av orderfliken sag ut, och det var det som
 * gjorde den ful.
 *
 * REGELN: rad i en spalt, cell i ett rutnat. Anvand inte den ena dar den andra
 * hor hemma.
 * =============================================================================
 */
function Faktum({
  etikett,
  varde,
  tnum,
}: {
  etikett: string;
  varde: string;
  tnum?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-micro uppercase text-ink-500">{etikett}</dt>
      <dd className={cn("truncate text-body text-ink-900", tnum && "tnum")}>{varde}</dd>
    </div>
  );
}

/**
 * En uppgift i en definitionslista.
 *
 * ENSPALTIG LISTA ENDAST — se `Faktum` ovan for varfor, och for vad som gar
 * sonder i ett rutnat.
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
