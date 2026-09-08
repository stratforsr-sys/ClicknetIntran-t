import type { ReactNode } from "react";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { kronor, manadsnamn } from "@/lib/provision";
import type { Bonusniva, Underlag } from "@/lib/provision-motor";
import type { Dagsutfall, Malutfall, Manadsfacit, Takt } from "@/lib/saljtakt";

/**
 * E13 steg 10: provisionsvyns resultattavla.
 *
 * ===========================================================================
 * VARFOR DEN HAR FILEN FINNS, OCH VARFOR DEN SER UT SOM DEN GOR
 *
 * Bestallarens invandning 2026-09-07: *"provisionsvyn kanns helt meningslos,
 * jag vet inte ens vad jag ska anvanda den till"*, foljt av *"vi ar ett
 * saljbolag, siffrorna maste vara stora ordentliga"*.
 *
 * Diagnosen var inte att talen var fel. De var ratt — motorn i
 * `provision-motor.ts` hade raknat dem korrekt sedan augusti. Felet var att
 * vyn var byggd som en HUVUDBOK: historik, perioder, ett bokforingsformular,
 * och manadens intjaning i samma grad som allt annat. Ett dokument man laser
 * en gang i manaden nar nagon undrar over en utbetalning.
 *
 * En saljare oppnar inte en huvudbok. Hen oppnar en RESULTATTAVLA, och stallar
 * tre fragor i den har ordningen:
 *
 *   1. Vad har jag tjanat den har manaden?
 *   2. Vad har jag salt i dag?
 *   3. Ligger jag bra till, och vad kravs for nasta bonus?
 *
 * Vyn svarar nu i den ordningen, och huvudboken ligger kvar langre ned for den
 * dag nagon behover den.
 *
 * ---------------------------------------------------------------------------
 * TRE REGLER SOM HALLER TAVLAN IHOP
 *
 * ETT TAL AR STORST. `text-hero` anvands en gang per vy, pa manadens
 * intjaning. Anvands den pa tva tal ar inget av dem storst langre — samma
 * regel som "en primarknapp per vy" i UI-PRD §5.4.
 *
 * INGEN SIFFRA RAKNAS HAR. Varje tal kommer fardigt ur `provision-motor.ts`
 * eller `saljtakt.ts`. Komponenten som raknar sjalv ar en andra tolkning av
 * regeln, och den dag den och motorn sager olika saker gar det inte att se
 * vilken som har ratt. Det ar samma linje som avsnitt 12 i PROVISION_SPEC.md.
 *
 * INGA HEXVARDEN. UI-PRD §11. `globals.css` ar den enda filen som far ha dem.
 * ===========================================================================
 */

// -----------------------------------------------------------------------------
// Manadspanelen — den morka ytan overst
// -----------------------------------------------------------------------------

/**
 * ===========================================================================
 * PANELEN AR MORK, OCH DET AR INTE DEKORATION.
 *
 * Resten av navet ar vita kort pa gra arbetsyta. En vy dar det viktigaste
 * talet star pa ett vitt kort bland fjorton andra vita kort har ingen
 * rangordning — ogat far leta reda pa huvudsaken, och det ar precis det
 * bestallaren beskrev nar hen sa att vyn kandes meningslos.
 *
 * Den morka ytan ar den enda i innehallsomradet, och den delar ton med
 * sidopanelen. Den lases darfor som "navet sjalvt sager det har", inte som ett
 * kort bland korten. Det ar ocksa den enda plats i systemet dar `brand-500` far
 * anvandas — tonen klarar 2,45:1 mot vit text och ar forbjuden pa ljusa ytor
 * (D-U2), men mot `brand-900` ar den en accent med god kontrast.
 *
 * `on-dark` byter fokusringen till `brand-500`. Utan den ar ringen `brand-600`
 * mot `brand-900`, alltsa nastan osynlig — och en fokusring man inte ser ar
 * samma sak som ingen.
 * ===========================================================================
 */
export function Manadspanel({
  etikett,
  beskrivning,
  total,
  delar,
  stangd,
  utbetald,
  trappa,
  styrning,
}: {
  /** Vems siffror och vilken manad. "Foretaget · september 2026". */
  etikett: string;
  /** Meningen under talet. Skiftar med om manaden ar oppen och med vems den ar. */
  beskrivning: string;
  total: number;
  /**
   * Nedbrytningen av totalen.
   *
   * =========================================================================
   * DELARNA RAKNAS INTE HAR, OCH KALLAN SKIFTAR MED MANADENS LAGE.
   *
   * En OPPEN manad bryts ned ur motorns underlag — den raknas live och maste
   * det, for order elva hojer bonusen pa order ett till tio.
   *
   * En STANGD manad bryts ned ur HUVUDBOKEN. Det ar inte en detalj: kors
   * motorn om pa en stangd manad kan en trappa som andrats i november ge en
   * annan nedbrytning an den som faktiskt bokfordes i augusti, och da star
   * vyn och utbetalningen och sager olika saker om samma manad.
   *
   * Komponenten far darfor fardiga rader och vet inte vilket av de tva den
   * ritar. Det ar sidans sak att veta, och `page.tsx` gor valet pa ETT stalle.
   * =========================================================================
   */
  delar: { etikett: string; varde: number }[];
  stangd: boolean;
  utbetald: boolean;
  /** Bonustrappan, nar den ska ritas. Utelamnas for en stangd manad. */
  trappa?: ReactNode;
  /**
   * Manads- och personvaljaren.
   *
   * Den ligger I panelen och inte ovanfor: valjarna byter ut precis det som
   * star har, och en kontroll utanfor den yta den styr lases som ett sidfilter
   * som rakar paverka nagot. Se rubriken i `Vyval.tsx`.
   */
  styrning?: ReactNode;
}) {
  return (
    <section
      data-guide="provision.min"
      className="on-dark overflow-hidden rounded-md bg-brand-900 shadow-elev-3"
    >
      {styrning && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-800 px-6 py-4 md:px-8">
          {styrning}
          <Lagesflagga stangd={stangd} utbetald={utbetald} />
        </div>
      )}

      <div className="flex flex-col gap-8 p-6 md:p-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-micro uppercase text-brand-400">{etikett}</span>
            {!styrning && <Lagesflagga stangd={stangd} utbetald={utbetald} />}
          </div>

          {/* Det enda `text-hero`-talet i systemet. Se regeln i globals.css. */}
          <p className="tnum mt-4 text-hero text-ink-inv">{kronor(total)}</p>

          <p className="mt-3 max-w-[52ch] text-body text-brand-200">{beskrivning}</p>
        </div>

        <dl className="grid shrink-0 grid-cols-2 gap-x-10 gap-y-5 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
          {delar.map((d) => (
            <div key={d.etikett}>
              <dt className="text-micro uppercase text-brand-400">{d.etikett}</dt>
              <dd className="tnum mt-1 text-h1 text-ink-inv">{kronor(d.varde)}</dd>
            </div>
          ))}
        </dl>
      </div>

      {trappa && (
        <div data-guide="provision.trappa" className="border-t border-brand-800 px-6 py-6 md:px-8">
          {trappa}
        </div>
      )}
    </section>
  );
}

/**
 * AC-U5.2: laget kommuniceras aldrig med enbart farg. Flaggan bar sitt ord.
 *
 * `Badge` anvands inte har — dess toner ar byggda for ljus yta (mork text pa
 * ljus platta) och forsvinner mot `brand-900`.
 */
function Lagesflagga({ stangd, utbetald }: { stangd: boolean; utbetald: boolean }) {
  const text = utbetald ? "Utbetald" : stangd ? "Fastställd" : "Öppen — räknas live";

  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-brand-800 px-3 py-1 text-micro uppercase text-brand-200">
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${stangd ? "bg-brand-400" : "bg-ok"}`}
      />
      {text}
    </span>
  );
}

// -----------------------------------------------------------------------------
// Bonustrappan
// -----------------------------------------------------------------------------

/**
 * Trappan som en bana med hallplatser.
 *
 * ===========================================================================
 * BESTALLAREN BAD OM TRE SAKER I EN MENING: *"saljaren ska kunna se vad han har
 * for slags bonusar samt hur mycket mer till nasta bonus och vad nasta bonus ar
 * for nagot."*
 *
 * En lista med fyra rader svarar pa den forsta och lamnar de tva andra at
 * lasaren att rakna ut. En BANA svarar pa alla tre samtidigt: hallplatserna ar
 * vilka bonusar som finns, den fyllda delen ar var man ar, och avstandet till
 * nasta prick ar hur langt det ar kvar.
 *
 * NIVAERNA LIGGER PA JAMNA AVSTAND, inte pa avstand som speglar troskeln.
 * Trapporna 5/10/15/20 hade blivit lika breda anda, men 5/10/30 hade gett ett
 * jattelikt sista steg som ser omojligt ut. Banan ar en ORDNING, inte en skala
 * — och den som vill veta exakt hur langt det ar kvar far det i klartext under.
 *
 * FYLLNADEN AR DAREMOT PROPORTIONELL INOM VARJE STEG, sa raden ror sig for
 * varje order och inte bara vid varje troskel. En bana som star still i fyra
 * order och sedan hoppar sager inget om arbetet under tiden.
 * ===========================================================================
 */
export function Bonustrappa({
  underlag,
  nivaer,
  ljus = false,
}: {
  underlag: Underlag;
  nivaer: Bonusniva[];
  /** Sant nar trappan star pa ett vitt kort i stallet for i den morka panelen. */
  ljus?: boolean;
}) {
  const antal = underlag.antal.bonusgrundande;
  const nadd = underlag.volymbonus?.niva.threshold ?? null;
  const nasta = underlag.nasta?.niva.threshold ?? null;

  const bana = ljus ? "bg-canvas" : "bg-brand-800";
  const fylld = ljus ? "bg-brand-600" : "bg-brand-500";
  const dampat = ljus ? "text-ink-500" : "text-brand-200";
  const rubrik = ljus ? "text-ink-900" : "text-ink-inv";

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <p className={`text-small ${dampat}`}>
          {nadd === null ? (
            <>Volymbonusen börjar på {nivaer[0]?.threshold} order.</>
          ) : (
            <>
              Du är på <strong className={rubrik}>nivå {nadd}</strong> —{" "}
              {kronor(underlag.volymbonus?.belopp ?? 0)} på hela månadens{" "}
              {underlag.antal.netto} order.
            </>
          )}
        </p>

        {underlag.nasta && (
          <p className={`text-small ${dampat}`}>
            <strong className={rubrik}>
              {underlag.nasta.kvar} order kvar
            </strong>{" "}
            till nivå {underlag.nasta.niva.threshold} ({beskrivNiva(underlag.nasta.niva)})
          </p>
        )}
      </div>

      <div className="relative">
        {/* Banan ligger bakom prickarna, i deras lodrata mitt.
            `-translate-y-1/2` centrerar den pa prickraden; prickarna ar 12 px
            (`size-3`), sa mitten ligger 6 px ned. */}
        <div
          aria-hidden
          className={`absolute inset-x-0 top-1.5 h-0.5 -translate-y-1/2 rounded-full ${bana}`}
        />
        <div
          aria-hidden
          className={`absolute top-1.5 left-0 h-0.5 -translate-y-1/2 rounded-full ${fylld}`}
          style={{ width: `${fyllnad(nivaer, antal)}%` }}
        />

        <ol className="relative flex">
          {nivaer.map((n) => {
            const arNadd = antal >= n.threshold;
            const arNasta = n.threshold === nasta;

            return (
              <li key={n.id} className="flex flex-1 flex-col items-center gap-2">
                <span
                  aria-hidden
                  className={[
                    "size-3 rounded-full ring-4",
                    ljus ? "ring-surface" : "ring-brand-900",
                    arNadd ? fylld : arNasta ? (ljus ? "bg-brand-200" : "bg-brand-700") : bana,
                  ].join(" ")}
                />
                <span
                  className={`tnum text-small ${arNadd || arNasta ? rubrik : dampat} ${
                    arNadd || arNasta ? "font-semibold" : ""
                  }`}
                >
                  {n.threshold}
                </span>
                <span className={`tnum text-micro ${dampat}`}>{beskrivNiva(n)}</span>
                {/* AC-U5.2: nadd niva far inte bara vara en fylld prick. */}
                {arNadd && <span className="sr-only">nådd</span>}
                {arNasta && <span className={`text-micro uppercase ${fylldText(ljus)}`}>Nästa</span>}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function fylldText(ljus: boolean): string {
  return ljus ? "text-brand-700" : "text-brand-400";
}

/**
 * Hur langt banan ar fylld, i procent.
 *
 * Prickarna star i mitten av lika breda kolumner, sa niva `i` av `n` ligger pa
 * `(i + 0,5) / n`. Fyllnaden gar till den nadda prickens mitt plus den del av
 * vagen till nasta som ar avverkad.
 *
 * `findLast` anvands inte — den kraver ES2023 i `lib`, och tsconfig sager inte
 * det. En slinga sager samma sak och kan inte falla vid en biblioteksuppdatering.
 */
function fyllnad(nivaer: Bonusniva[], antal: number): number {
  if (nivaer.length === 0 || antal <= 0) return 0;

  const mitt = (i: number) => ((i + 0.5) / nivaer.length) * 100;

  let sist = -1;
  for (let i = 0; i < nivaer.length; i++) if (antal >= nivaer[i].threshold) sist = i;

  if (sist === nivaer.length - 1) return 100;

  const fran = sist < 0 ? 0 : nivaer[sist].threshold;
  const till = nivaer[sist + 1].threshold;
  const a = sist < 0 ? 0 : mitt(sist);
  const b = mitt(sist + 1);

  // `till > fran` garanteras av att listan ar sorterad och trosklarna unika per
  // manad (det partiella unika indexet i 0035). Vardet klipps anda: en dubblett
  // som slunkit igenom ska ge en bana, inte en division med noll.
  const del = till > fran ? (antal - fran) / (till - fran) : 1;
  return a + Math.max(0, Math.min(1, del)) * (b - a);
}

/** Vad en niva ar vard, med sin form. Formen avgor hur mycket det blir. */
function beskrivNiva(n: Bonusniva): string {
  switch (n.unit) {
    case "percent":
      return `${n.amount} %`;
    case "amount_per_order":
      return `${kronor(n.amount)}/order`;
    default:
      return kronor(n.amount);
  }
}

// -----------------------------------------------------------------------------
// De tre korten under panelen
// -----------------------------------------------------------------------------

/**
 * I DAG.
 *
 * ===========================================================================
 * DET STORA TALET AR ANTAL ORDER, INTE KRONOR — och det foljer av databasen.
 *
 * `sales_order_provision_satt` i 0034 FORBJUDER ett belopp pa en order som inte
 * godkants an, med motiveringen "ett belopp pa ett utkast ser ut som ett
 * lofte". Villkoret ar riktigt och star kvar.
 *
 * Foljden ar att dagens kronor bara finns for det chefen hunnit attestera, och
 * bestallarens val 2026-09-07 var att dagen ska visa ALLT som lagts in —
 * annars star siffran pa noll hela formiddagen och dagskortet blir en matare
 * pa hur snabbt chefen klickar.
 *
 * Antalet ar darfor huvudtalet, och kronorna star under i tva delar: det
 * godkanda ur ordern, och det vantande slaget ur matrisen vid lasning. De slas
 * ALDRIG ihop till ett tal. Det vantande ar en upplysning om vad som ligger i
 * kon, inte ett lofte om vad som kommer.
 * ===========================================================================
 */
export function Dagskort({ dag, datum }: { dag: Dagsutfall; datum: string }) {
  return (
    <Card guide="provision.idag">
      <p className="text-micro uppercase text-ink-500">I dag</p>
      <p className="tnum mt-2 text-display text-ink-900">{dag.antal}</p>
      <p className="text-small text-ink-500">order tecknade</p>

      {dag.antal === 0 ? (
        <p className="mt-4 text-small text-ink-500">
          Inget tecknat än i dag. Dagen räknas på signeringsdatum, så en order du lägger in nu med
          gårdagens datum hamnar på i går.
        </p>
      ) : (
        <dl className="mt-4 flex flex-col gap-2 border-t border-canvas pt-4">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-small text-ink-500">
              {dag.godkanda} godkänd{dag.godkanda === 1 ? "" : "a"}
            </dt>
            <dd className="tnum text-body font-semibold text-ink-900">{kronor(dag.kronor)}</dd>
          </div>
          {dag.vantande > 0 && (
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-small text-ink-500">{dag.vantande} väntar på godkännande</dt>
              <dd className="tnum text-body text-ink-500">≈ {kronor(dag.kronorVantande)}</dd>
            </div>
          )}
        </dl>
      )}

      {dag.vantande > 0 && (
        <p className="mt-3 text-micro text-ink-500">
          Det väntande beloppet är slaget ur paketmatrisen och bokförs först när ordern godkänns.
        </p>
      )}
      <p className="sr-only">Datum: {datum}</p>
    </Card>
  );
}

/**
 * TAKTEN.
 *
 * Prognosen bar sitt antagande i klartext, av samma skal som
 * `prognosNastaNiva` gor det (avsnitt 9.1): en prognos utan sina
 * forutsattningar ar en siffra folk brakar om, medan samma tal med ett villkor
 * gar att kontrollera.
 */
export function Taktkort({ takt, samlad = false }: { takt: Takt; samlad?: boolean }) {
  return (
    <Card guide="provision.takt">
      <p className="text-micro uppercase text-ink-500">Takt</p>

      {takt.prognos === null ? (
        <>
          <p className="tnum mt-2 text-display text-ink-300">—</p>
          <p className="text-small text-ink-500">för tidigt att säga</p>
          <p className="mt-4 border-t border-canvas pt-4 text-small text-ink-500">
            {takt.gangna === 0
              ? "Månaden har inte börjat än."
              : `${takt.gangna} av ${takt.totalt} arbetsdagar har gått. En takt räknad ur så få dagar säger mer om slumpen än om månaden.`}
          </p>
        </>
      ) : (
        <>
          <p className="tnum mt-2 text-display text-ink-900">{kronor(takt.prognos.totalt)}</p>
          <p className="text-small text-ink-500">
            vid månadens slut, ≈ {takt.prognos.antal} order
          </p>

          <dl className="mt-4 flex flex-col gap-2 border-t border-canvas pt-4">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-small text-ink-500">Grundprovision då</dt>
              <dd className="tnum text-body text-ink-900">
                {kronor(takt.prognos.grundprovision)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-small text-ink-500">
                {samlad
                  ? "Volymbonus, summerad"
                  : takt.prognos.niva
                    ? `Volymbonus nivå ${takt.prognos.niva.threshold}`
                    : "Volymbonus"}
              </dt>
              {/* SAMLAT VISAS BELOPPET ALLTID, aven noll. En lagsumma har ingen
                  "niva" att sakna — se `taktaFlera` — sa texten "ingen nivå nås"
                  hade varit ett pastaende om ett tal som inte finns. */}
              <dd className="tnum text-body text-ink-900">
                {samlad || takt.prognos.niva ? kronor(takt.prognos.bonus) : "ingen nivå nås"}
              </dd>
            </div>
          </dl>

          <p className="mt-3 text-micro text-ink-500">
            Vid samma takt som hittills — {takt.gangna} av {takt.totalt} arbetsdagar avverkade.
            K&amp;V-bonusen skrivs inte fram; den beror på veckor som ännu inte bedömts.
          </p>
        </>
      )}
    </Card>
  );
}

const LAGESTEXT: Record<Malutfall["lage"], { ord: string; ton: "ok" | "warn" | "info" }> = {
  fore: { ord: "Före takten", ton: "ok" },
  i_takt: { ord: "I takt", ton: "info" },
  efter: { ord: "Efter takten", ton: "warn" },
};

/**
 * MALET.
 *
 * ===========================================================================
 * KORTET JAMFOR MOT DAR MAN BORDE STA I DAG, INTE MOT HELA MALET.
 *
 * "12 av 20 order" den 8:e ser ut som ett underbetyg och ar det inte — det ar
 * langt fore takten. Ett kort som bara visar andelen av manadsmalet sager
 * darfor "du ligger efter" varje dag utom den sista, och en matare som alltid
 * ar rod ar en matare man slutar titta pa.
 *
 * Det forvantade laget (`mal x andel av manaden`) ar det som gor skillnad pa
 * "efter" och "tidigt i manaden". Bagen visar anda hela malet, for det ar det
 * som ska nas — men ORDET under kommer fran jamforelsen mot takten.
 * ===========================================================================
 */
export function Malkort({
  mal,
  takt,
  enhet,
  farSattaMal,
}: {
  mal: Malutfall | null;
  takt: Takt;
  /** "order" eller "kronor" — malet kan vara satt i bada. */
  enhet: "order" | "kronor";
  farSattaMal: boolean;
}) {
  if (!mal) {
    return (
      <Card guide="provision.mal">
        <p className="text-micro uppercase text-ink-500">Mål</p>
        <p className="tnum mt-2 text-display text-ink-300">—</p>
        <p className="text-small text-ink-500">inget mål satt</p>
        <p className="mt-4 border-t border-canvas pt-4 text-small text-ink-500">
          {farSattaMal ? (
            <>
              Ingen har satt ett mål för den här månaden.{" "}
              <Link href="/provision/mal" className="underline">
                Sätt månadsmål
              </Link>
              .
            </>
          ) : (
            "Din chef har inte satt något mål för den här månaden. Takten till vänster gäller ändå."
          )}
        </p>
      </Card>
    );
  }

  const lage = LAGESTEXT[mal.lage];
  const skriv = (n: number) => (enhet === "kronor" ? kronor(n) : `${Math.round(n)}`);

  return (
    <Card
      guide="provision.mal"
      status={mal.lage === "efter" ? "warn" : mal.lage === "fore" ? "ok" : undefined}
    >
      <div className="flex items-start justify-between gap-4">
        <p className="text-micro uppercase text-ink-500">Mål</p>
        <Badge ton={lage.ton}>{lage.ord}</Badge>
      </div>

      <p className="tnum mt-2 text-display text-ink-900">
        {Math.round(mal.andel * 100)}
        <span className="text-h1 text-ink-500"> %</span>
      </p>
      <p className="text-small text-ink-500">
        {skriv(mal.nu)} av {skriv(mal.mal)} {enhet === "order" ? "order" : ""}
      </p>

      {/* AC-U5.2: bagen ar aldrig ensam barare — talet och ordet star bredvid. */}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={mal.mal}
        aria-valuenow={Math.round(mal.nu)}
        aria-label={`Måluppfyllelse, ${skriv(mal.nu)} av ${skriv(mal.mal)}`}
        className="relative mt-4 h-2 overflow-hidden rounded-full bg-canvas"
      >
        <div
          className="h-full rounded-full bg-brand-600"
          style={{ width: `${Math.min(100, Math.max(0, mal.andel * 100))}%` }}
        />
        {/* Var man BORDE sta i dag. Markoren ar det som gor bagen lasbar mitt i
            manaden — utan den ar 60 % bara 60 %. */}
        {mal.forvantat > 0 && mal.forvantat < mal.mal && (
          <span
            aria-hidden
            className="absolute inset-y-0 w-0.5 bg-ink-900"
            style={{ left: `${(mal.forvantat / mal.mal) * 100}%` }}
          />
        )}
      </div>

      <p className="mt-3 text-small text-ink-500">
        Takten i dag är {skriv(mal.forvantat)}. Du ligger{" "}
        <strong className="text-ink-900">
          {mal.mot >= 0 ? "+" : "−"}
          {skriv(Math.abs(mal.mot))}
        </strong>{" "}
        mot den.
        {mal.kravPerDag !== null && takt.kvar > 0 && (
          <>
            {" "}
            {enhet === "order"
              ? `Det krävs ${avrundaUppat(mal.kravPerDag)} order per arbetsdag på de ${takt.kvar} som är kvar.`
              : `Det krävs ${kronor(mal.kravPerDag)} per arbetsdag på de ${takt.kvar} som är kvar.`}
          </>
        )}
        {mal.kravPerDag === null && mal.nu >= mal.mal && " Målet är nått."}
      </p>
    </Card>
  );
}

/**
 * Kravet per dag AVRUNDAS UPPAT, och det ar med flit.
 *
 * 1,2 order per dag avrundat nedat blir "1 order per dag", och den som gor
 * exakt det missar malet. Ett krav ska aldrig kunna uppfyllas av nagon som
 * foljde det till punkt och pricka och anda kom for kort.
 *
 * En decimal visas nar talet inte ar helt, sa att "1,2" inte blir "2" — det
 * vore avskrackande at andra hallet.
 */
function avrundaUppat(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
}

// -----------------------------------------------------------------------------
// Manadens dagar
// -----------------------------------------------------------------------------

/**
 * En stapel per arbetsdag.
 *
 * ===========================================================================
 * BARA ARBETSDAGAR FAR EN STAPEL.
 *
 * En helg med noll order sager ingenting om nagon. Ritas de anda blir var
 * fjarde stapel tom i alla manader for alla, och ogat lar sig att raden ar full
 * av tomrum — vilket ar precis det som gor att man slutar se de dagar som
 * verkligen ar tomma.
 *
 * Roda dagar ar borta av samma skal. Listan star i `saljtakt.ts` och delas med
 * takten, sa de tva kan inte saga olika saker om hur manga dagar manaden har.
 * ===========================================================================
 *
 * En dag utan order far en LAG stump i stallet for ingenting. En dag som inte
 * ritas alls gar inte att skilja fran en dag som inte finns, och det ar de
 * tomma dagarna raden ar till for att visa.
 */
export function Dagsstaplar({
  serie,
  idag,
  manad,
}: {
  serie: { dag: string; antal: number }[];
  idag: string;
  manad: string;
}) {
  const hogst = Math.max(1, ...serie.map((d) => d.antal));
  const summa = serie.reduce((s, d) => s + d.antal, 0);

  return (
    <Card>
      <CardHeader
        titel="Månadens dagar"
        beskrivning={`${summa} order fördelade på ${serie.length} arbetsdagar. Helger och röda dagar räknas inte.`}
      />

      <div className="flex h-28 items-end gap-1" role="img" aria-label={sammanfattaSerie(serie)}>
        {serie.map((d) => {
          const framtid = d.dag > idag;
          const arIdag = d.dag === idag;

          return (
            <div key={d.dag} className="flex h-full flex-1 flex-col justify-end gap-1">
              <span className="tnum text-center text-micro text-ink-500">
                {d.antal > 0 ? d.antal : ""}
              </span>
              <div
                title={`${d.dag}: ${d.antal} order`}
                className={[
                  "w-full rounded-xs",
                  d.antal === 0
                    ? framtid
                      ? "bg-canvas"
                      : "bg-ink-300/40"
                    : arIdag
                      ? "bg-brand-700"
                      : "bg-brand-500",
                  arIdag ? "ring-2 ring-brand-600 ring-offset-1" : "",
                ].join(" ")}
                style={{
                  // Noll far en stump pa fyra pixlar, inte noll. Se rubriken.
                  height: d.antal === 0 ? "4px" : `${Math.max(8, (d.antal / hogst) * 100)}%`,
                }}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex justify-between text-micro text-ink-500">
        <span>{manadsnamn(manad).split(" ")[0]} {serie[0]?.dag.slice(8)}</span>
        <span>{serie[serie.length - 1]?.dag.slice(8)}</span>
      </div>
    </Card>
  );
}

/** Bildtexten for skarmlasaren. En stapelrad utan den ar ett tomt element. */
function sammanfattaSerie(serie: { dag: string; antal: number }[]): string {
  const med = serie.filter((d) => d.antal > 0);
  if (med.length === 0) return "Inga order tecknade i månaden än.";
  const bast = med.reduce((a, b) => (b.antal > a.antal ? b : a));
  return `Order per arbetsdag. ${med.length} av ${serie.length} dagar har minst en order. Bästa dagen är ${bast.dag} med ${bast.antal}.`;
}

// -----------------------------------------------------------------------------
// Ordernas lage
// -----------------------------------------------------------------------------

/**
 * Kronor per orderlage.
 *
 * ===========================================================================
 * SVARET PA BESTALLARENS "MED ANGER, MED BETALDA OSV — DETTA FINNS DIREKT FRAN
 * INKIO", SA LANGT NAVET FAKTISKT VET NAGOT.
 *
 * Nagon Inkio-koppling finns inte. Byggs en angerfrist pa gissade regler blir
 * navet ett system som pastar sig veta nar en kund kan angra, och det ar den
 * dyraste sortens fel: det ser ut som information.
 *
 * Raden visar darfor de lagen navet SJALVT satter — godkand, betald, makulerad
 * — och ingenting annat. Den dag Inkio kopplas in (A5) far tabellen fler lagen
 * och raden fler rader, utan att nagot annat behover andras.
 * ===========================================================================
 */
export function Lagesrad({
  lagen,
  rubrik,
}: {
  lagen: { etikett: string; antal: number; kronor: number; ton: "ok" | "info" | "danger" }[];
  /** Vems order, och vilken manad. Foljer panelens val. */
  rubrik: string;
}) {
  return (
    <Card>
      <CardHeader
        titel={rubrik}
        beskrivning="Provisionen räknas från godkännandet, inte från betalningen. En makulering drar tillbaka sitt belopp i den månad den sker."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        {lagen.map((l) => (
          <div key={l.etikett} className="rounded-sm bg-surface-alt p-4">
            <div className="flex items-center justify-between gap-2">
              <Badge ton={l.ton}>{l.etikett}</Badge>
              <span className="tnum text-h2 text-ink-900">{l.antal}</span>
            </div>
            <p className="tnum mt-3 text-body font-semibold text-ink-900">{kronor(l.kronor)}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Företagets rad, och månaden i backspegeln
// -----------------------------------------------------------------------------

/**
 * Det som ersätter bonustrappan när panelen visar HELA FÖRETAGET.
 *
 * ===========================================================================
 * FÖRETAGET HAR INGEN BONUSTRAPPA, OCH DET ÄR INTE EN LUCKA.
 *
 * Volymbonusen är en egenskap hos EN PERSONS månad — nivån bestäms av hens
 * ordervolym och betalas till hen. Summeras trapporna över tio säljare finns
 * ingen tröskel kvar att rita: femtio order fördelade på tio personer ger
 * ingen bonus alls, femtio på en person ger nivå 20, och en gemensam bana hade
 * ritat samma bild för båda.
 *
 * Raden svarar i stället på de frågor företaget FAKTISKT har: hur många drar,
 * hur många har nått en nivå, och vad en order är värd i snitt.
 * ===========================================================================
 */
export function Foretagsstrip({
  saljare,
  medNiva,
  order,
  snittPerOrder,
}: {
  saljare: number;
  medNiva: number;
  order: number;
  snittPerOrder: number;
}) {
  const tal = [
    { etikett: "Säljare med order", varde: String(saljare) },
    { etikett: "Nått en bonusnivå", varde: `${medNiva} av ${saljare}` },
    { etikett: "Order netto", varde: String(order) },
    { etikett: "Snitt per order", varde: kronor(snittPerOrder) },
  ];

  return (
    <dl className="grid grid-cols-2 gap-x-10 gap-y-5 sm:grid-cols-4">
      {tal.map((t) => (
        <div key={t.etikett}>
          <dt className="text-micro uppercase text-brand-400">{t.etikett}</dt>
          <dd className="tnum mt-1 text-h1 text-ink-inv">{t.varde}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Månaden i backspegeln — det som står där I DAG och TAKT står för den månad
 * som pågår.
 *
 * ===========================================================================
 * ETT DAGSKORT FÖR EN MÅNAD SOM VARIT ÄR EN NOLLA SOM LJUGER.
 *
 * "I dag: 0 order" när man tittar på augusti ser exakt likadant ut som "0 order
 * i dag" för någon som inte sålt något — och en takt för en avslutad månad är
 * inte en prognos utan utfallet, med en etikett som påstår något annat.
 *
 * Korten byts därför ut mot frågor som HAR ett svar i efterhand. Se
 * `manadsfacit()` i `saljtakt.ts`; räkningen ligger där, inte här.
 * ===========================================================================
 */
export function Manadsfacitkort({ facit, manad }: { facit: Manadsfacit; manad: string }) {
  return (
    <Card guide="provision.idag">
      <p className="text-micro uppercase text-ink-500">{manadsnamn(manad)}</p>
      <p className="tnum mt-2 text-display text-ink-900">{facit.antal}</p>
      <p className="text-small text-ink-500">order netto</p>

      {facit.bastaDagen === null ? (
        <p className="mt-4 border-t border-canvas pt-4 text-small text-ink-500">
          Ingen order tecknades den här månaden.
        </p>
      ) : (
        <dl className="mt-4 flex flex-col gap-2 border-t border-canvas pt-4">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-small text-ink-500">Bästa dagen</dt>
            <dd className="tnum text-body font-semibold text-ink-900">
              {facit.bastaDagen.dag.slice(8)}/{Number(facit.bastaDagen.dag.slice(5, 7))} ·{" "}
              {facit.bastaDagen.antal} order
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-small text-ink-500">Dagar med order</dt>
            <dd className="tnum text-body text-ink-900">
              {facit.dagarMedOrder} av {facit.arbetsdagar}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-small text-ink-500">Snitt per arbetsdag</dt>
            <dd className="tnum text-body text-ink-900">
              {facit.snittPerArbetsdag.toFixed(1).replace(".", ",")}
            </dd>
          </div>
        </dl>
      )}

      <p className="mt-3 text-micro text-ink-500">
        Snittet räknas på månadens alla arbetsdagar, inte bara på dem det kom order — annars är
        det minst ett i alla lägen och säger ingenting.
      </p>
    </Card>
  );
}
