import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/components/ui/cn";
import { STATUS_ETIKETT, dagarTill, raknas } from "@/lib/order";
import { STATUSTON, avtalsforlopp, type Statuston } from "@/lib/ordervy";
import { kronor } from "@/lib/provision";
import type { Orderrad } from "@/lib/order-server";

/**
 * En order som ett kort.
 *
 * =============================================================================
 * HELA OMLAGGNINGEN LIGGER I VAD DET HAR KORTET INTE VISAR.
 *
 * Bestallaren 2026-09-25: *"Det ar helt och hallet huller om buller och riktigt
 * katastrof att lasa."* Diagnosen var inte att uppgifterna var fel — den forra
 * raden visade NIO textstycken per order, alla i samma grad och samma gra ton:
 * paket, kontakt, ordervarde, utkop, avtalstid, tjanster, anteckning, plus
 * atgardsknappar, en samtalslista och en bilageuppladdning. Tjugo order blev en
 * vagg dar ingenting stod ut, eftersom allt stod ut lika mycket.
 *
 * Kortet visar darfor FYRA saker: vem kunden ar, vad affaren ar vard, i vilket
 * skick den ar, och hur lange avtalet racker. Allt det andra — kontaktuppgifter,
 * utkop, tjansternas belopp, samtalen, bilagorna, rattelsen, makuleringen —
 * ligger ett klick bort i kundkortet. Det ar inte gomt; det ar sorterat.
 *
 * Ett kort som RITAR trettio uppgifter kommunicerar noll. Ett kort som ritar
 * fyra kommunicerar fyra.
 * =============================================================================
 */

/**
 * Statusfargen som en 3 px list till vanster.
 *
 * AC-U2.4 later kortet ha EN kantlinje, och det ar den har. Poangen ar att
 * statusen da gar att lasa nedat langs rutnatets vanstra kant utan att nagot ord
 * behover lasas — och ordet star kvar i pillret anda, eftersom AC-U5.2 sager att
 * status aldrig kommuniceras med enbart farg.
 *
 * KARTAN GAR PA TON OCH INTE PA STATUS, sa att `STATUSTON` i `lib/ordervy.ts` ar
 * enda stallet som avgor vilken status som ar gron. `Kundkort.tsx` har en egen
 * sadan karta for samma ton — den ritar en tonad platta i stallet for en list —
 * och sa lange bada oversatter TON och inte STATUS kan de inte saga emot
 * varandra.
 */
const RAIL: Record<Statuston, string> = {
  neutral: "border-l-ink-300",
  warn: "border-l-warn",
  ok: "border-l-ok",
  brand: "border-l-brand-500",
  danger: "border-l-danger",
};

export function Orderkort({
  o,
  paketnamn,
  saljare,
  tjanster,
  /** Adressen kortet leder till: kundkortet, med filtret kvar. */
  href,
  idag,
}: {
  o: Orderrad;
  paketnamn: string;
  /** Saljarens namn, eller undefined for den som inte far se andras. */
  saljare?: string;
  /** Antalet tillaggstjanster. Bara en raknare — raderna star i kundkortet. */
  tjanster: number;
  href: string;
  idag: string;
}) {
  const levande = raknas(o.status);
  const kvar = levande && o.ends_on ? dagarTill(o.ends_on, idag) : null;
  const brinner = kvar !== null && kvar <= 90;

  return (
    <Link
      href={href}
      scroll={false}
      className={cn(
        "lift group flex flex-1 flex-col overflow-hidden rounded-md border-l-[3px] bg-surface shadow-elev-1",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
        RAIL[STATUSTON[o.status]],
      )}
    >
      <div className="flex min-w-0 flex-col gap-3 p-4">
        {/* Raden med kundens namn. Namnet ar kortets rubrik, inte en uppgift
            bland andra — det ar det man letar efter nar man skummar rutnatet. */}
        <div className="flex min-w-0 items-start justify-between gap-3">
          <h3 className="min-w-0 flex-1 truncate text-h2 text-ink-900 group-hover:text-brand-700">
            {o.company_name}
          </h3>
          <Badge ton={STATUSTON[o.status]}>{STATUS_ETIKETT[o.status]}</Badge>
        </div>

        {/* En enda metadatarad, och den ar avsiktligt kort. Paketet och
            avtalstiden sager vad affaren ar; saljaren sager vems den ar. Allt
            annat som stod har forut star i kundkortet. */}
        <p className="truncate text-small text-ink-500">
          {paketnamn} · {o.term_months} mån
          {saljare ? ` · ${saljare}` : ""}
          {o.is_addon ? " · tillägg" : ""}
        </p>

        {/*
          TALEN. TRE, I TRE OLIKA GRADER.
          -------------------------------------------------------------------
          Ordervardet ar affarens storlek, provisionen ar vad den gav, och
          manadsavgiften ar vad kunden betalar. Tre olika fragor, och just
          darfor tre olika grader:

            ordervarde     h1, ink-900   affarens huvudtal
            provision      h2, brand-700 pengar till en person
            per manad      h2, ink-700   en uppgift om avtalet

          GRADERNA AR INTE DEKORATION. Fram till nu stod ordervardet och
          provisionen bredvid varandra i SAMMA grad, och det storre av dem —
          femsiffrigt mot fyrsiffrigt — laste da som "vad ordern gav", vilket
          ar precis vad det inte ar. Skillnaden i grad ar det som gor att
          23 880 kr inte kan misstas for nagons ersattning.

          MANADSAVGIFTEN RITAS BARA NAR DEN FINNS, och de tva andra sager
          ingenting i stallet for "0 kr" nar de saknas: order fran fore 0050 har
          inget ordervarde och far inget i efterhand, och en nolla hade last som
          en gratisaffar.
        */}
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <div className="min-w-0">
            <p className="tnum text-h1 text-ink-900">
              {o.order_value === null ? "—" : kronor(o.order_value)}
            </p>
            <p className="text-micro uppercase text-ink-500">Ordervärde</p>
          </div>
          <div className="min-w-0">
            <p className="tnum text-h2 text-brand-700">
              {o.commission_amount === null ? "—" : kronor(o.commission_amount)}
            </p>
            <p className="text-micro uppercase text-ink-500">Provision</p>
          </div>
          {o.monthly_amount !== null && (
            <div className="min-w-0">
              <p className="tnum text-h2 text-ink-700">{kronor(o.monthly_amount)}</p>
              <p className="text-micro uppercase text-ink-500">Per månad</p>
            </div>
          )}
        </div>

        {/* Fotraden: datumet, och de fa varningar som far bryta tystnaden.
            Ett chip som alltid star dar och alltid sager samma sak lar ogat att
            ingenting hander pa den platsen — samma resonemang som
            avtalsbevakningen foljer. */}
        <div className="flex flex-wrap items-center gap-2 text-small text-ink-500">
          <span className="tnum">{o.signed_on}</span>
          {tjanster > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>
                {tjanster} {tjanster === 1 ? "tjänst" : "tjänster"}
              </span>
            </>
          )}
          {o.status === "makulerad" && o.cancelled_on && (
            <>
              <span aria-hidden>·</span>
              <span className="text-danger-ink">makulerad {o.cancelled_on}</span>
            </>
          )}
          {brinner && kvar !== null && (
            <Badge ton={kvar < 0 ? "danger" : "warn"}>
              {kvar < 0 ? `Gick ut för ${Math.abs(kvar)} dagar sedan` : `${kvar} dagar kvar`}
            </Badge>
          )}
        </div>
      </div>

      <Avtalsstapel o={o} idag={idag} levande={levande} />
    </Link>
  );
}

/**
 * Avtalstiden som en fyra pixlar hog list langst ner pa kortet.
 *
 * =============================================================================
 * DEN HAR LISTEN AR KORTETS ENDA UTSMYCKNING, OCH DEN BAR EN UPPGIFT.
 *
 * Kommentaren i den gamla vyn sa det redan: *"fragan 'hur lange har vi kvar pa
 * den har kunden?' stalls langt innan paminnelsen tands"*. Svaret stod dar som
 * tva datum — `2025-03-01 – 2027-03-01` — och tva datum kraver att man raknar.
 *
 * En fylld list kraver ingenting. Nio tiondelar fylld betyder ring nu, och
 * eftersom listen ligger pa samma stalle pa varje kort gar HELA RUTNATET att
 * lasa i en blick: de kort vars list ar nastan full ar de kunder nagon borde
 * hora av.
 *
 * FARGEN BYTER VID NITTIO DAGAR, samma grans som `AVTALSSLUT_VARSEL_DAGAR` och
 * bevakningskortet. Tre varden som sager samma sak maste komma fran samma stalle;
 * `dagarTill` ar det stallet.
 *
 * INGEN LIST PA EN MAKULERAD ELLER OGODKAND ORDER. Ett avtal som inte galler har
 * ingen loptid att visa, och en tom ranna hade last som "noll dagar kvar".
 * =============================================================================
 */
function Avtalsstapel({ o, idag, levande }: { o: Orderrad; idag: string; levande: boolean }) {
  if (!levande || !o.ends_on || !o.starts_on) return null;

  const { andel, dagarKvar } = avtalsforlopp(o.starts_on, o.ends_on, idag);

  return (
    <div
      className="h-1 w-full shrink-0 bg-canvas"
      role="img"
      aria-label={
        dagarKvar < 0
          ? `Avtalet gick ut ${o.ends_on}`
          : `Avtalet löper till ${o.ends_on}, ${dagarKvar} dagar kvar`
      }
      title={`${o.starts_on} – ${o.ends_on}`}
    >
      <div
        className={cn(
          "h-full transition-[width] duration-slow ease-brand",
          dagarKvar < 0 ? "bg-danger" : dagarKvar <= 90 ? "bg-warn" : "bg-brand-500",
        )}
        style={{ width: `${Math.round(andel * 100)}%` }}
      />
    </div>
  );
}
