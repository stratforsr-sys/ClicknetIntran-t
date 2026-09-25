import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Ikon } from "@/components/shell/Ikon";
import { cn } from "@/components/ui/cn";
import { fullName, getCurrentUser, hasRole } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";
import { supabaseServer } from "@/lib/supabase/server";
import {
  hamtaAvtalsslut,
  hamtaKundensOrder,
  hamtaOrder,
  hamtaOrderUrval,
  hamtaOrderbilagor,
  hamtaChefssatser,
  hamtaPaket,
  hamtaSatser,
  hamtaTjanster,
  hamtaTjansteantal,
  hamtaUtkopssatser,
  raknaKo,
  type Orderrad,
} from "@/lib/order-server";
import { gallandeChefssats } from "@/lib/chefsprovision";
import { gallandeUtkopssats } from "@/lib/utkop";
import { hamtaPerioder } from "@/lib/bonus-server";
import {
  AVTALSSLUT_VARSEL_DAGAR,
  LOPTIDER,
  dagarTill,
  grundprovision,
  nettoAntal,
  ordervarde,
  provisionFor,
  type Paket,
  type Sats,
} from "@/lib/order";
import {
  ORDERTAK,
  STATUSVAL_ETIKETT,
  filtretSomFraga,
  harFilter,
  slaSammanKund,
  tolkaFilter,
  type Kund,
  type Orderfilter,
} from "@/lib/ordervy";
import { kronor, manadFore, manadsnamn, manadsnyckel } from "@/lib/provision";
import { hamtaOrdersamtal } from "@/lib/samtal-order-server";
import { GuideVard } from "@/components/guide/GuideVard";
import { Filterrad } from "./Filterrad";
import { Kundkort } from "./Kundkort";
import { Nyorder } from "./Nyorder";
import { Orderkort } from "./Orderkort";
import { Svavruta } from "./Svavruta";

export const dynamic = "force-dynamic";

/**
 * E13: kundorder. Omlagd 2026-09-25.
 *
 * ORDER, INTE AVTAL. `/avtal` ar anstallningsavtal (E9.1) och har ingenting med
 * kundaffarer att gora.
 *
 * =============================================================================
 * VAD OMLAGGNINGEN ANDRADE, OCH VARFOR
 *
 * Bestallaren 2026-09-25: *"Ordervyn ser riktigt dalig ut. Det ar helt och
 * hallet huller om buller och riktigt katastrof att lasa."*
 *
 * Diagnosen var inte att nagon uppgift var fel. Sidan hade SEX likvardiga kort i
 * en spalt — manadens siffror, provisionsmatrisen, avtalsbevakningen,
 * inmatningsformularet, kon och orderlistan — och varje orderrad i listan ritade
 * nio textstycken i samma grad och samma gra ton, plus atgardsknappar, en
 * samtalslista och en bilageuppladdning. Ingenting stod ut eftersom allt stod ut
 * lika mycket, och formularet lag mitt i den vaggen.
 *
 * Fyra grepp, i den ordning de gor skillnad:
 *
 *   1. NYCKELTALEN OVERST, FYRA STYCKEN, ALLTID MANADEN. De ror sig INTE nar
 *      man filtrerar — en siffra som andrar sig av att man bytt vy ar en siffra
 *      ingen litar pa. Se `manadsunderlag` nedan, som hamtas for sig.
 *   2. FILTRET ERSATTER KORTEN. Kon ar ett lage i filterraden i stallet for ett
 *      eget kort, och matrisen ligger i en utfallbar panel langst ner. Det som
 *      blev kvar som eget kort ar avtalsbevakningen, av samma skal som den en
 *      gang fick brytа ordningen: en kund vars avtal gar ut om tre veckor ar
 *      bradare an nasta order.
 *   3. ORDERN BLIR ETT KORT I ETT RUTNAT, med fyra uppgifter i stallet for
 *      trettio. Se `Orderkort.tsx`.
 *   4. ALLT ANNAT FLYTTAR IN I KUNDKORTET. Kontaktuppgifter, utkop, tjanster,
 *      samtal, bilagor, rattelse och makulering ligger ett klick bort — i en vy
 *      man oppnat med avsikt, i stallet for i en lista man skummar.
 *
 * SIDAN RAKNAR FORTFARANDE INGEN BONUS. Volymtrappan ligger i provisionsvyn.
 * =============================================================================
 *
 * =============================================================================
 * TRE LAGEN I ADRESSEN, OCH INGET AV DEM AR EN EGEN RUTT
 *
 *   `?vem= &tid= &status= &sok=`  filtret (se `lib/ordervy.ts`)
 *   `?ny=1`                       inmatningsrutan
 *   `?kund=<orderid>`             kundkortet
 *
 * KUNDKORTET OPPNAS MED ETT ORDER-ID OCH ALDRIG MED ETT ORGANISATIONSNUMMER.
 * K27-undantaget later `org_number` bara ett PERSONNUMMER for en enskild firma,
 * och adressen hamnar i webblasarhistoriken, i Vercels loggar och i en
 * Referer-rubrik. Ett uuid sager ingenting om nagon. Se `hamtaKundensOrder`.
 * =============================================================================
 */
export default async function Ordersida({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user?.employee) return null;

  const mig = user.employee.id;
  const hanterare = hasRole(user, "sales_manager", "ceo", "finance");

  // O13. Kretsen som far saga att en order ar BETALD ar smalare an den som
  // godkanner och makulerar: den som ser betalningen komma in ar den som far
  // saga att den kommit. Statusen ror inga pengar — provisionen utgar fran
  // signeringen.
  const bokforare = hasRole(user, "finance", "ceo");

  const idag = svensktDatum();
  const manad = manadsnyckel();
  const ettArBak = manadFore(manad, 11);

  const sp = await searchParams;
  const filter = tolkaFilter(sp, mig);
  const forlang = typeof sp.forlang === "string" ? sp.forlang : undefined;
  const kundId = typeof sp.kund === "string" ? sp.kund : undefined;
  const nyOppen = sp.ny === "1" || Boolean(forlang);

  // Adressen tillbaka till listan: filtret kvar, rutorna borta. Den ligger i en
  // variabel eftersom bada rutorna stanger till den, och tva handskrivna
  // varianter av samma adress hade hunnit glida isar.
  const listan = `/order${filtretSomFraga(filter)}`;

  const [
    manadsunderlag,
    urval,
    ko,
    paket,
    satser,
    personer,
    chefssatser,
    utkopssatser,
    perioder,
    loperUt,
  ] = await Promise.all([
    // ------------------------------------------------------------------------
    // NYCKELTALEN HAR EGEN HAMTNING, OCH DET AR HELA POANGEN MED DEM.
    //
    // Banden overst sager vad MANADEN bar. Rakades de pa den filtrerade listan
    // hade "12 order · 48 200 kr" andrats till "3 order · 9 000 kr" sa fort
    // nagon valde en saljare i rullgardinen — och en siffra som betyder olika
    // saker beroende pa vad man rakar ha filtrerat pa ar varken manadens tal
    // eller urvalets, utan bara forvirrande.
    //
    // Fragan ar billig: `ror(manad)` ger bara innevarande manads rorelser.
    // ------------------------------------------------------------------------
    hamtaOrder(manad),
    hamtaOrderUrval(filter),
    raknaKo(),
    hamtaPaket(),
    hamtaSatser(),
    hanterare ? hamtaSaljare() : Promise.resolve([] as { id: string; namn: string }[]),
    // TOM LISTA FOR EN SALJARE, och det ar RLS som gor det, inte en if-sats har.
    // `manager_commission_rate_read` i 0050 slapper bara in den krets som ser
    // provision — satserna ar villkoren for nagon annans ersattning.
    hamtaChefssatser(),
    // UTKOPSSATSEN (0060) LASES DAREMOT AV ALLA. Det ar saljarens EGEN sats, och
    // den som lagger en order med utkop ska se vad affaren ger innan hen trycker.
    hamtaUtkopssatser(),
    // FASTSTALLDA MANADER. Fore godkannandet (O11): hor ordern till en manad som
    // redan ar faststalld? Efter godkannandet (0051): avgor vad en RATTELSE gor.
    // Samma fraga, tva anvandningar — och sedan 2026-09-15 gar listan hela vagen
    // ner i inmatningen, sa att manadsstampeln kan varna INNAN knappen trycks.
    hamtaPerioder(ettArBak),
    // AVTALEN SOM NARMAR SIG SITT SLUT, i en EGEN fraga. Den kan inte plockas ur
    // listan ovan: bevakningen fragar pa SLUTDATUMET, inte pa signeringsmanaden,
    // och ett trearsavtal tecknat 2024 loeper ut 2027.
    hamtaAvtalsslut(idag),
  ]);

  const stangda = perioder.map((p) => p.period_month);
  const gallandeChef = gallandeChefssats(chefssatser, idag);
  const gallandeUtkop = gallandeUtkopssats(utkopssatser, idag);

  // Typargumenten star ut med flit: utan dem harleds kartan som
  // `Map<unknown, unknown>` sa fort nagot i `Promise.all` ovan inte gar att sla
  // upp, och felet dyker da upp langt fran sin orsak.
  const namn = new Map<string, string>(personer.map((p) => [p.id, p.namn]));

  // Tjansteraknaren for de kort som faktiskt ritas, i EN fraga. Hela raderna
  // hamtas bara for kundkortet — se `hamtaTjansteantal` for varfor de tva ar
  // skilda at.
  const tjansteantal = await hamtaTjansteantal(urval.order.map((o) => o.id));

  // ---------------------------------------------------------------------------
  // KUNDKORTETS EGET MATERIAL, och det hamtas BARA nar kortet ar oppet.
  //
  // Det ar den storsta vinsten med omlaggningen som inte syns: fram till nu
  // hamtade sidan bilagor, samtal OCH tjansteraderna for varje synlig order vid
  // varje laddning, eftersom varje orderrad ritade dem. Tre fragor over tjugo
  // order, for uppgifter nastan ingen laste. Nu gar de tre fragorna pa de
  // handfull order en enda kund har, och bara nar nagon oppnat kortet.
  // ---------------------------------------------------------------------------
  const kunden = kundId ? await hamtaKundensOrder(kundId) : null;
  const kundOrderIds = kunden?.order.map((o) => o.id) ?? [];
  const [kundTjanster, kundBilagor, kundSamtal] = await Promise.all([
    hamtaTjanster(kundOrderIds),
    hamtaOrderbilagor(kundOrderIds),
    hamtaOrdersamtal(kundOrderIds),
  ]);

  // Ordern som forlangs. Hamtas ur bevakningen sjalv — det ar RLS som redan
  // avgjort att den far visas, och en egen fraga hade varit en andra vag in i
  // tabellen med ett id fran webblasaren.
  const forlangsOrder = forlang ? (loperUt.find((o) => o.id === forlang) ?? null) : null;

  // Sammanslagningen gors EN gang. Bade rubriken och kortet behover den, och tva
  // anrop hade sorterat och summerat samma rader tva ganger for samma svar.
  const kund = kunden ? slaSammanKund(kunden.order) : null;

  const varde = ordervarde(manadsunderlag, manad);
  const utgangna = loperUt.filter((o) => dagarTill(o.ends_on, idag) < 0);

  return (
    <div className="flex flex-col gap-4 pt-2">
      <GuideVard slug="registrera-order" />

      {/* ==================================================================== */}
      {/* Sidhuvudet. Rubriken till vanster, handlingen till hoger.            */}
      {/*                                                                      */}
      {/* EN PRIMARKNAPP PA HELA SIDAN (UI-PRD §5.4), och det ar den har. Allt  */}
      {/* annat pa sidan ar lasning eller val; det enda man KOMMER hit for att  */}
      {/* gora ar att lagga en order.                                          */}
      {/* ==================================================================== */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-display text-ink-900">Order</h1>
          <p className="mt-1 text-body text-ink-500">
            Kundorder och den provision de ger. Klicka på ett kort för kundens hela historik.
          </p>
        </div>

        <Link
          href={`/order${filtretSomFraga(filter, { ny: "1" })}`}
          scroll={false}
          data-guide="order.ny"
          className={cn(
            "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full px-6 text-body font-semibold",
            "bg-brand-600 text-ink-inv shadow-elev-brand",
            "transition-[background-color,transform,box-shadow] duration-fast ease-brand",
            "hover:bg-brand-700 active:scale-[0.98]",
          )}
        >
          <Ikon namn="plus" className="size-5" />
          Lägg till order
        </Link>
      </div>

      <Nyckeltal
        antal={nettoAntal(manadsunderlag, manad)}
        provision={grundprovision(manadsunderlag, manad)}
        varde={varde.netto}
        utanVarde={varde.utanVarde}
        ko={ko}
        loperUt={loperUt.length}
        utgangna={utgangna.length}
        manad={manad}
        hanterare={hanterare}
        koFraga={filtretSomFraga({ ...filter, status: "vantar" })}
      />

      <Avtalsbevakning
        order={loperUt}
        namn={namn}
        hanterare={hanterare}
        idag={idag}
        lank={(id) => `/order${filtretSomFraga(filter, { kund: id })}`}
      />

      <Filterrad
        filter={filter}
        personer={personer}
        ko={ko}
        mig={mig}
        idag={idag}
        hanterare={hanterare}
      />

      {/* ==================================================================== */}
      {/* Rutnatet.                                                            */}
      {/*                                                                      */}
      {/* TRE SPALTER PA STOR SKARM OCH INTE EN LISTA. Ett orderkort ar fyra    */}
      {/* uppgifter hogt, och fyra uppgifter i en spalt over hela bredden ger   */}
      {/* en rad text och fyrtio centimeter tomrum bredvid. Rutnatet gor        */}
      {/* dessutom avtalsstaplarna i kortens nederkant lasbara som en helhet:   */}
      {/* tolv kort i taget, och de vars stapel ar nastan full syns direkt.     */}
      {/* ==================================================================== */}
      {urval.order.length === 0 ? (
        <EmptyState
          rubrik={harFilter(filter) ? "Inget matchar filtret" : "Ingen order är inlagd"}
          text={
            harFilter(filter)
              ? `Ingen order svarar mot ${beskrivFilter(filter, namn)}. Rensa filtret för att se allt.`
              : "Lägg den första med knappen uppe till höger. Den räknas från och med den månad den signerades."
          }
          handling={
            harFilter(filter) ? (
              <Link
                href="/order"
                className="text-body text-brand-700 underline underline-offset-4 hover:text-brand-600"
              >
                Rensa filtret
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {urval.order.map((o) => (
              <Orderkort
                key={o.id}
                o={o}
                paketnamn={paket.find((p) => p.id === o.package_id)?.label ?? `Paket ${o.package_id}`}
                saljare={hanterare ? namn.get(o.salesperson_id) : undefined}
                tjanster={tjansteantal.get(o.id) ?? 0}
                href={`/order${filtretSomFraga(filter, { kund: o.id })}`}
                idag={idag}
              />
            ))}
          </div>

          <p className="text-small text-ink-500">
            {urval.order.length} {urval.order.length === 1 ? "order" : "order"} ·{" "}
            {beskrivFilter(filter, namn)}
            {/*
              TAKET SAGER IFRAN NAR DET SLAR TILL. En lista som tyst klipps vid
              tvahundra rader ser ut som en fullstandig lista, och den som
              stammer av mot ett annat tal hittar aldrig varfor de skiljer sig.
            */}
            {urval.kapad && (
              <>
                {" · "}
                <strong className="text-warn-ink">
                  bara de {ORDERTAK} senaste visas — smalna av filtret för att se resten
                </strong>
              </>
            )}
          </p>
        </>
      )}

      <Matris paket={paket} satser={satser} idag={idag} />

      {/* ==================================================================== */}
      {/* Rutorna. Bada ligger sist i tradet men SYNS overst — ett modalt       */}
      {/* <dialog> hamnar i webblasarens topplager oavsett var det star.        */}
      {/* ==================================================================== */}
      {nyOppen && (
        <Svavruta
          rubrik={forlangsOrder ? `Förläng ${forlangsOrder.company_name}` : "Lägg till order"}
          underrubrik={
            forlangsOrder
              ? "Kunduppgifterna är ifyllda. Paket, bindningstid, säljare och datum är en ny förhandling."
              : hanterare
                ? "Provisionen hämtas ur matrisen efter signeringsdatum."
                : "Ordern går till säljchefen för godkännande."
          }
          tillbakaTill={listan}
          bredd="smal"
        >
          <div className="p-4 sm:p-6">
            <Nyorder
              paket={paket}
              personer={personer}
              hanterare={hanterare}
              idag={idag}
              chef={
                gallandeChef && {
                  employee_id: gallandeChef.employee_id,
                  override_percent: gallandeChef.override_percent,
                  own_sale_percent: gallandeChef.own_sale_percent,
                }
              }
              utkopsprocent={gallandeUtkop?.percent ?? null}
              stangdaManader={stangda}
              forlanger={
                forlangsOrder && {
                  id: forlangsOrder.id,
                  company_name: forlangsOrder.company_name,
                  org_number: forlangsOrder.org_number,
                  contact_name: forlangsOrder.contact_name,
                  contact_phone: forlangsOrder.contact_phone,
                  contact_email: forlangsOrder.contact_email,
                  ends_on: forlangsOrder.ends_on,
                }
              }
            />
          </div>
        </Svavruta>
      )}

      {kunden && kund && (
        <Svavruta
          rubrik={kund.bolag}
          underrubrik={<Kundrubrik kund={kund} />}
          tillbakaTill={listan}
        >
          <Kundkort
            kund={kund}
            ankareId={kunden.ankare.id}
            paket={paket}
            personer={personer}
            namn={namn}
            hanterare={hanterare}
            bokforare={bokforare}
            mig={mig}
            stangda={stangda}
            tjanster={kundTjanster}
            bilagor={kundBilagor}
            samtal={kundSamtal}
            idag={idag}
          />
        </Svavruta>
      )}
    </div>
  );
}

/**
 * Underrubriken i kundkortets huvud.
 *
 * ORGANISATIONSNUMRET STAR HAR OCH INTE I LISTAN, och skillnaden ar avsiktlig.
 * K27-undantaget later kolumnen bara ett personnummer for en enskild firma, och
 * ett sadant hor inte hemma i ett rutnat man skummar. I ett kort nagon oppnat om
 * EN kund ar det daremot precis den uppgift man kom for.
 */
function Kundrubrik({ kund }: { kund: Kund<Orderrad> }) {
  return (
    <span className="tnum">
      {kund.orgnr || "organisationsnummer saknas"}
      {kund.kundSedan ? ` · kund sedan ${kund.kundSedan}` : ""}
    </span>
  );
}

// -----------------------------------------------------------------------------
// Nyckeltalen
// -----------------------------------------------------------------------------

/**
 * Bandet overst.
 *
 * =============================================================================
 * TALEN AR ALLTID MANADENS, OAVSETT FILTER — se hamtningen i `Promise.all`.
 *
 * Det ar den viktigaste egenskapen bandet har, och den ar latt att bygga bort:
 * det hade varit enklare att rakna pa den lista som redan hamtats. Da hade
 * "manadens provision" andrats av att nagon valde en saljare i rullgardinen, och
 * ett tal som betyder olika saker beroende pa vad man rakar ha filtrerat pa ar
 * varken manadens eller urvalets.
 *
 * Bandet star DARFOR ocksa ovanfor filterraden och inte under. Ordningen pa
 * sidan sager vad som hanger ihop med vad.
 * =============================================================================
 *
 * TVA AV FYRA RUTOR AR KLICKBARA, och bara de som leder nagonstans vettigt: kon
 * satter filtret pa `vantar`, och bevakningen rullar till kortet. De tva forsta
 * ar rena tal — det finns ingen vy som ar "manadens provision", den ar den har.
 */
function Nyckeltal({
  antal,
  provision,
  varde,
  utanVarde,
  ko,
  loperUt,
  utgangna,
  manad,
  hanterare,
  koFraga,
}: {
  antal: number;
  provision: number;
  varde: number;
  utanVarde: number;
  ko: number;
  loperUt: number;
  utgangna: number;
  manad: string;
  hanterare: boolean;
  /** Adressen till filterlaget `vantar`, redan skriven. */
  koFraga: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-guide="order.manad">
      <Ruta
        etikett={`${hanterare ? "Bolaget" : "Du"} i ${manadsnamn(manad)}`}
        tal={String(antal)}
        under={antal === 1 ? "order" : "order"}
        stark
      />
      <Ruta
        etikett="Grundprovision"
        tal={kronor(provision)}
        under="godkända minus makulerade"
      />
      <Ruta
        etikett="Ordervärde"
        tal={kronor(varde)}
        under={utanVarde > 0 ? `${utanVarde} order saknar värde` : "netto efter utköp"}
      />

      {/*
        FJARDE RUTAN BYTER INNEHALL EFTER VAD SOM ÄR, och det ar med flit:
        kon och avtalsbevakningen ar de tva sakerna pa sidan som KRAVER en
        handling, och bada ar oftast noll. Tva rutor som nastan alltid visar
        noll lar ogat att ingenting hander pa de platserna; en ruta som bara
        finns nar den har nagot att saga blir last nar den dyker upp.

        Star bada ut samtidigt vinner kon: den ar dagens arbete, bevakningen ar
        manadens. Bevakningen har dessutom ett eget kort direkt under.
      */}
      {ko > 0 ? (
        <Ruta
          etikett="Väntar på godkännande"
          tal={String(ko)}
          under="inskickade order räknas inte förrän de godkänts"
          ton="varning"
          href={`/order${koFraga}`}
        />
      ) : loperUt > 0 ? (
        <Ruta
          etikett="Avtal som löper ut"
          tal={String(loperUt)}
          under={utgangna > 0 ? `${utgangna} har redan gått ut` : `inom ${AVTALSSLUT_VARSEL_DAGAR} dagar`}
          ton={utgangna > 0 ? "fara" : "varning"}
          href="#avtalsbevakning"
        />
      ) : (
        <Ruta etikett="Att göra" tal="0" under="inget väntar och inget löper ut" />
      )}
    </div>
  );
}

function Ruta({
  etikett,
  tal,
  under,
  ton,
  stark,
  href,
}: {
  etikett: string;
  tal: string;
  under: string;
  ton?: "varning" | "fara";
  /** Manadens ordersaldo. Den enda rutan med resultatgrad — UI-PRD §4.4. */
  stark?: boolean;
  href?: string;
}) {
  const innehall = (
    <>
      <p className="truncate text-micro uppercase text-ink-500">{etikett}</p>
      <p
        className={cn(
          "tnum",
          stark ? "text-display" : "text-h1",
          ton === "fara" ? "text-danger-ink" : ton === "varning" ? "text-warn-ink" : "text-ink-900",
        )}
      >
        {tal}
      </p>
      <p className="text-small text-ink-500">{under}</p>
    </>
  );

  const klasser = cn(
    "flex flex-col gap-0.5 rounded-md bg-surface p-4 shadow-elev-1",
    ton === "fara" && "border-l-[3px] border-l-danger",
    ton === "varning" && "border-l-[3px] border-l-warn",
    !ton && stark && "border-l-[3px] border-l-brand-500",
  );

  if (!href) return <div className={klasser}>{innehall}</div>;

  return (
    <Link href={href} scroll={false} className={cn(klasser, "lift")}>
      {innehall}
    </Link>
  );
}

// -----------------------------------------------------------------------------
// Avtalsbevakningen
// -----------------------------------------------------------------------------

/**
 * Avtalen som narmar sig sitt slut.
 *
 * =============================================================================
 * KORTET AR KVAR SOM EGET KORT, OCH DET ÄR DET ENDA SOM ÄR DET.
 *
 * Omlaggningen flyttade in kon i filterraden och matrisen i en utfallbar panel.
 * Bevakningen star kvar dar den stod, ovanfor filtret, och skalet ar detsamma
 * som nar den en gang bröt sidans ordning 2026-09-24: en kund vars avtal gar ut
 * om tre veckor ar bradare an nasta order, och den som scrollar forbi ser den
 * inte. Ett filterlage hade gjort den till nagot man valjer att titta pa.
 *
 * NAR INGET LOPER UT RITAS KORTET INTE ALLS. En rad som alltid star dar och
 * alltid sager noll lar ogat att ingenting hander pa den platsen. Tystnaden ar
 * besked nog: finns det inget kort finns det inget att ringa om.
 * =============================================================================
 *
 * RADERNA AR NUMERA LANKAR IN I KUNDKORTET i stallet for att bara sina egna
 * knappar. Fornyelsen — bade "Forlang" och "Kunden forlanger inte" — star i
 * kundkortets oversikt, dar man ocksa ser vad kunden ar vard och nar man senast
 * pratade med henne. Att bokfora ett avslut utan den uppgiften framfor sig var
 * att gissa.
 */
function Avtalsbevakning({
  order,
  namn,
  hanterare,
  idag,
  lank,
}: {
  order: Orderrad[];
  namn: Map<string, string>;
  hanterare: boolean;
  idag: string;
  lank: (id: string) => string;
}) {
  if (order.length === 0) return null;

  const utgangna = order.filter((o) => dagarTill(o.ends_on, idag) < 0);

  return (
    // Ankaret sitter pa ett eget element runt kortet: `Card` tar inget id, och
    // en osynlig <div> INNE i kortet hade gett en rullning som landar en
    // kortmarginal for langt ner. `scroll-mt-4` lamnar luft over rubriken nar
    // nyckeltalsrutan rullar hit.
    <section id="avtalsbevakning" className="scroll-mt-4">
      <Card status={utgangna.length > 0 ? "danger" : "warn"}>
        <CardHeader
          titel="Avtal som löper ut"
          beskrivning={`Inom ${AVTALSSLUT_VARSEL_DAGAR} dagar. Öppna kunden och förläng — eller bokför varför hon inte förlänger.`}
        />
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {order.map((o) => {
            const kvar = dagarTill(o.ends_on, idag);

            return (
              <li key={o.id}>
                <Link
                  href={lank(o.id)}
                  scroll={false}
                  className="lift flex flex-col gap-1.5 rounded-sm bg-canvas p-3"
                >
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-body font-semibold text-ink-900">
                      {o.company_name}
                    </span>
                    <Badge ton={kvar < 0 ? "danger" : kvar <= 30 ? "warn" : "neutral"}>
                      {kvar < 0
                        ? `${Math.abs(kvar)} dagar sedan`
                        : kvar === 0
                          ? "I dag"
                          : `${kvar} dagar`}
                    </Badge>
                  </div>
                  <p className="truncate text-small text-ink-500">
                    <span className="tnum">{o.ends_on}</span>
                    {o.monthly_amount !== null ? ` · ${kronor(o.monthly_amount)}/mån` : ""}
                    {hanterare && namn.get(o.salesperson_id)
                      ? ` · ${namn.get(o.salesperson_id)}`
                      : ""}
                  </p>
                  <p className="truncate text-small text-ink-500">
                    {o.contact_name} · <span className="tnum">{o.contact_phone}</span>
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Matrisen
// -----------------------------------------------------------------------------

/**
 * Vad en order ger, som en utfallbar panel langst ner.
 *
 * FLYTTAD FRAN TOPPEN 2026-09-25. Matrisen ar en UPPSLAGSTABELL — man slar upp i
 * den nar man undrar vad ett paket ger, kanske en gang i veckan — och den lag
 * fram till nu bredvid manadens siffror, alltsa pa den nast mest framtradande
 * platsen pa sidan. Nio tal som nastan aldrig andras tog utrymme fran de tal som
 * andras varje dag.
 *
 * `<details>` OCH INTE EN EGEN RUTA: en uppslagstabell man behover mitt i ett
 * resonemang ska oppnas dar man star, utan att sidan byts ut. Den ar dessutom
 * oppen for alla inloggade — raderna bar inga personuppgifter, och en progressvy
 * som sager "3 order kvar till nasta niva" utan att personen far se vad en order
 * ar vard ar en sifferlek.
 */
function Matris({ paket, satser, idag }: { paket: Paket[]; satser: Sats[]; idag: string }) {
  if (paket.length === 0) {
    return (
      <Card>
        <CardHeader titel="Vad en order ger" />
        <EmptyState
          rubrik="Inga paket är upplagda"
          text="Utan paket och satser går det inte att räkna fram någon provision."
        />
      </Card>
    );
  }

  return (
    <details className="group rounded-md bg-surface shadow-elev-1">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 md:p-6">
        <span>
          <span className="block text-h2 text-ink-900">Vad en order ger</span>
          <span className="block text-small text-ink-500">
            Provisionsmatrisen, satsen som gäller i dag.
          </span>
        </span>
        <Ikon
          namn="fram"
          className="size-5 shrink-0 text-ink-500 transition-transform duration-fast ease-brand group-open:rotate-90"
        />
      </summary>

      <div className="overflow-x-auto px-4 pb-4 md:px-6 md:pb-6">
        <table className="w-full text-small">
          <thead>
            <tr className="text-left text-micro uppercase text-ink-500">
              <th className="pb-2 font-normal">Paket</th>
              {LOPTIDER.map((m) => (
                <th key={m} className="pb-2 text-right font-normal">
                  {m} mån
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paket.map((p) => (
              <tr key={p.id} className="border-t border-canvas">
                <td className="py-2 text-ink-900">{p.label}</td>
                {LOPTIDER.map((m) => {
                  const belopp = provisionFor(satser, p.id, m, idag);
                  return (
                    <td key={m} className="tnum py-2 text-right text-ink-900">
                      {/* Saknas satsen visas ett streck, aldrig en nolla. En
                          nolla ser ut som "ingen provision" i stallet for
                          "inte ifyllt" — samma linje som lonekostnaden. */}
                      {belopp === null ? "—" : kronor(belopp)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// -----------------------------------------------------------------------------
// Smatt
// -----------------------------------------------------------------------------

/**
 * Filtret med ord, for raden under rutnatet och for det tomma laget.
 *
 * SKRIVS UT I KLARTEXT och inte som "3 filter aktiva". Den som ser tva order dar
 * hen vantade tjugo ska kunna lasa VARFOR pa samma rad, utan att kontrollera
 * fyra kontroller mot varandra.
 */
function beskrivFilter(filter: Orderfilter, namn: Map<string, string>): string {
  const delar: string[] = [];

  if (filter.status !== "alla") delar.push(STATUSVAL_ETIKETT[filter.status].toLowerCase());
  if (filter.vem !== "alla") delar.push(namn.get(filter.vem) ?? "vald säljare");
  if (filter.tid.slag === "manad") delar.push(manadsnamn(filter.tid.manad));
  if (filter.tid.slag === "dag") delar.push(`signerade ${filter.tid.datum}`);
  if (filter.sok) delar.push(`sökning på "${filter.sok}"`);

  return delar.length === 0 ? "alla order" : delar.join(" · ");
}

/** Aktiva saljare, for chefens val av saljare. RLS avgor vilka som syns. */
async function hamtaSaljare(): Promise<{ id: string; namn: string }[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("employee")
    .select("id, first_name, last_name, employee_role!employee_role_employee_id_fkey(role)")
    .in("status", ["active", "onboarding"])
    .order("first_name");

  return (data ?? [])
    .filter((e) => {
      const roller = (e as unknown as { employee_role: { role: string }[] | null }).employee_role;
      return (roller ?? []).some((r) => r.role === "salesperson");
    })
    .map((e) => ({ id: e.id, namn: fullName(e) }));
}
