import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { ButtonLink } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notis } from "@/components/ui/Notis";
import { getCurrentUser, fullName, hasRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { hamtaAllProvision, hamtaProvision, type Post } from "@/lib/provision-server";
import {
  kronor,
  manadFore,
  manader,
  manadsnamn,
  manadsnyckel,
  slagetFor,
  summera,
  SLAGSETIKETT,
} from "@/lib/provision";
import { hamtaOrder, hamtaOrderFor, hamtaSatser, type Orderrad } from "@/lib/order-server";
import { hamtaNivaer, hamtaPerioder } from "@/lib/bonus-server";
import { hamtaKvPerPerson } from "@/lib/kv-server";
import { hamtaMal } from "@/lib/saljmal-server";
import { hamtaGodkandaFran, hamtaMinaHandelser, hamtaRegler } from "@/lib/konsekvens-server";
import { ATGARD_ETIKETT, konsekvenslageFor, lagenPerPerson, varningslage } from "@/lib/konsekvens";
import {
  gallandeNivaer,
  raknaUnderlag,
  underlagForAlla,
  type Bonusniva,
  type KvIndata,
  type Underlag,
} from "@/lib/provision-motor";
import {
  dagsserie,
  malFor,
  manadsfacit,
  motMal,
  saltEnDag,
  samlatMal,
  takta,
  taktaFlera,
  type Malutfall,
  type Saljmal,
  type Takt,
} from "@/lib/saljtakt";
import type { Konsekvenslage } from "@/lib/konsekvens";
import type { Sats } from "@/lib/order";
import { svensktDatum } from "@/lib/klocka";
import { Inmatning } from "./Inmatning";
import { Faststall, Utbetald } from "./Period";
import {
  Bonustrappa,
  Dagskort,
  Dagsstaplar,
  Foretagsstrip,
  Lagesrad,
  Malkort,
  Manadsfacitkort,
  Manadspanel,
  Taktkort,
} from "./Resultattavla";
import { Vyval } from "./Vyval";
import { Lagtavla, type Lagrad } from "./Lagtavla";
import { GuideVard } from "@/components/guide/GuideVard";

export const dynamic = "force-dynamic";

/**
 * E13. Provisionsvyn — resultattavla sedan 2026-09-07, styrbar sedan 2026-09-08.
 *
 * ===========================================================================
 * TVA SANNINGAR OM SAMMA MANAD, OCH DET AR AVSIKTLIGT.
 *
 * En OPPEN manad raknas LIVE ur orderna av motorn. Den maste det: order elva
 * hojer bonusen pa order ett till tio, sa varje ny order andrar hela manadens
 * siffra.
 *
 * En STANGD manad ar BOKFORD i `commission_entry` och raknas aldrig om. Den
 * maste det: annars andrar en bonusniva som satts i november vad nagon fick
 * betalt i augusti.
 *
 * Sidan far alltsa aldrig addera de tva for samma manad. Se `stangd`.
 * ===========================================================================
 *
 * ---------------------------------------------------------------------------
 * PANELEN HAR TVA RATTAR: VILKEN MANAD, OCH VEMS SIFFROR.
 *
 * Bestallarens tillagg 2026-09-08: cheferna ska kunna vaxla mellan sin egen
 * provision, foretagets totala och en enskild person — och bade de och
 * saljarna ska kunna byta period.
 *
 * OMFATTNINGEN STYR HELA TAVLAN, inte bara det stora talet. Panelen, banan,
 * de tre korten, stapelraden och orderlagena foljer alla med. En vy dar
 * rubriken sager "Vlado" medan halva sidan visar ens egna siffror ar varre an
 * ingen vaxling alls.
 *
 * TVA SPARRAR PA VEM SOM FAR SE VEM:
 *
 *   1. `vy` tvingas till "jag" for den som inte ar provisionschef. Raden nedan.
 *   2. Materialet finns inte ens. `hamtaOrder` (alla) hamtas bara for chefer,
 *      och `sales_order_read` i 0034 hade gett en saljare noll rader anda.
 *
 * Koden och databasen sager alltsa samma sak, och den ena kan falla utan att
 * den andra gor det.
 * ---------------------------------------------------------------------------
 *
 * PERIODEN AR EN MANAD OCH INTE ETT FRITT SPANN. Volymbonusen ar en egenskap
 * hos hela manaden (avsnitt 5.2), sa "1–15 september" har ingen bonusniva att
 * visa — talet hade sett ut som provision utan att ga att betala ut. Hela
 * resonemanget star i `Vyval.tsx`.
 */
export default async function Provisionssida({
  searchParams,
}: {
  searchParams: Promise<{ manad?: string; vy?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user?.employee) return null;

  const bokforare = hasRole(user, "finance", "ceo");

  // Saljchefen ar MED har sedan 2026-08-24 (avsnitt 2 i PROVISION_SPEC.md) men
  // far fortfarande inte bokfora poster for hand. Tva kretsar, tva uppgifter.
  const provisionschef = hasRole(user, "finance", "ceo", "sales_manager");

  // MALEN SATTS AV DEN SOM SATTER REGLERNA, inte av den som betalar ut. Samma
  // grans som `far_andra_provisionsregler()` i 0035 drar, och av samma skal.
  const malchef = hasRole(user, "sales_manager", "ceo");

  const idag = manadsnyckel();
  const idagsDatum = svensktDatum(new Date());
  const sp = await searchParams;

  // TOLV MANADER BAKAT, ALDRIG FRAMAT. En framtida manad ar inte en intjaning
  // utan en prognos — samma grans som `giltigManad` drar i actionen. Ett val som
  // inte gar att gora ar battre an ett felmeddelande efterat.
  const manadsval = Array.from({ length: 12 }, (_, i) => manadFore(idag, i));
  const manad = manadsval.includes(sp.manad ?? "") ? sp.manad! : idag;
  const arDenna = manad === idag;

  // Hamtningsfonstret maste tacka BADE den valda manaden och de tre som
  // periodkortet visar. Vald manad ar oftast senare, men inte alltid.
  const treManader = manadFore(idag, 2);
  const franOchMed = manad < treManader ? manad : treManader;
  const ettArBak = manadFore(idag, 11);

  // Trappan och perioderna hamtas for ALLA, inte bara for chefer. Bada
  // tabellerna ar oppna i RLS med flit (0035): en progressvy som sager "3 order
  // kvar till nasta niva" utan att personen far se vad nivan ar vard ar en
  // sifferlek, och "manaden ar stangd" ar svaret pa "varfor andrar sig inte min
  // siffra langre". Samma sak med `sales_target` i 0049.
  //
  // K13 / D-K13: provision och tid far sta pa samma SIDA, men ingen FRAGA
  // joinar tabellerna. Handelserna hamtas for sig och laggs bredvid.
  //
  // ALLT I EN VAG. Ett `await` pa egen rad hade lagt en sekventiell vaga till pa
  // en sida vars vagantal ar det som vaxer nar navet vaxer. Se X3-resonemanget i
  // arbetsloggen 2026-08-22.
  const [
    mina,
    alla,
    personer,
    saljarIds,
    allaOrder,
    minaOrder,
    satser,
    nivaer,
    perioder,
    minaHandelser,
    regler,
    godkanda,
    kvPerPerson,
    mal,
  ] = await Promise.all([
    hamtaProvision(user.employee.id, ettArBak),
    provisionschef ? hamtaAllProvision(ettArBak) : Promise.resolve([] as Post[]),
    provisionschef ? hamtaPersoner() : Promise.resolve([] as { id: string; namn: string }[]),
    provisionschef ? hamtaSaljarIds() : Promise.resolve(new Set<string>()),
    provisionschef ? hamtaOrder(franOchMed) : Promise.resolve([] as Orderrad[]),
    // Chefens `hamtaOrder` bar redan hens egna order — RLS ger den kretsen allt
    // — sa den andra fragan vore en dubblett.
    provisionschef ? Promise.resolve([] as Orderrad[]) : hamtaOrderFor(user.employee.id, franOchMed),
    hamtaSatser(),
    hamtaNivaer(),
    hamtaPerioder(franOchMed),
    hamtaMinaHandelser(user.employee.id),
    hamtaRegler(),
    provisionschef
      ? hamtaGodkandaFran(franOchMed)
      : Promise.resolve([] as Awaited<ReturnType<typeof hamtaGodkandaFran>>),
    // LASER MED ANVANDARENS EGEN TOKEN, sa saljaren far bara sin egen rad och
    // chefen far allas. Samma anrop tjanar bada vyerna. Hamtas for den VALDA
    // manaden — K&V-veckorna ar manadsbundna.
    hamtaKvPerPerson(manad),
    hamtaMal(franOchMed),
  ]);

  const material = provisionschef ? allaOrder : minaOrder;
  const poster = provisionschef ? alla : mina;
  const trappan = gallandeNivaer(nivaer, manad);
  const lagen = lagenPerPerson(godkanda, manad);
  const stangd = perioder.find((p) => p.period_month === manad) ?? null;

  // ===========================================================================
  // OMFATTNINGEN. `vy` tvingas till "jag" for den som inte far se andras — det
  // ar spärr nummer ett, och den enda som star i kod. Spärr nummer tva ar att
  // materialet inte finns: `allaOrder` hamtas inte alls for en saljare.
  //
  // Ett OKANT id faller ocksa tillbaka pa "jag" i stallet for att ge 404. Den
  // som byter roll mitt i en session har annars en bokmarkt adress som slutar
  // fungera, och en sida som visar ens egna siffror ar ratt svar da.
  // ===========================================================================
  const onskad = sp.vy ?? "jag";
  const vy = !provisionschef
    ? "jag"
    : onskad === "foretag" || onskad === "jag" || personer.some((p) => p.id === onskad)
      ? onskad
      : "jag";

  const foretagsvy = vy === "foretag";
  const visadId = vy === "jag" ? user.employee.id : vy;
  const visadNamn =
    vy === "jag"
      ? "Din provision"
      : (personer.find((p) => p.id === visadId)?.namn ?? "Okänd");

  // ===========================================================================
  // TAVLAN. Ett objekt, byggt en gang, som alla ytor under laser ur — panelen,
  // korten, banan, staplarna och orderlagena.
  //
  // Skalet ar att omfattningen annars hade behovt tolkas pa sju stallen, och
  // den dag ett av dem glomdes hade rubriken sagt "Vlado" medan kortet under
  // visade ens egna siffror. Det ar den sortens fel ingen upptacker genom att
  // titta — det ser ratt ut.
  // ===========================================================================
  const lagUnderlag = foretagsvy
    ? underlagForAlla(material, manad, nivaer, kvPerPerson, lagen)
    : [];

  const underlag = foretagsvy
    ? null
    : raknaUnderlag(
        visadId,
        material,
        manad,
        nivaer,
        kvPerPerson.get(visadId) ?? null,
        lagen.get(visadId) ?? null,
      );

  const tavlansOrder = foretagsvy
    ? material
    : material.filter((o) => o.salesperson_id === visadId);

  const tavlansPoster = foretagsvy ? poster : poster.filter((p) => p.employee_id === visadId);

  const bokfortIManad = summera(tavlansPoster, manad);
  const liveSumma = foretagsvy
    ? lagUnderlag.reduce((s, u) => s + u.summa, 0)
    : (underlag?.summa ?? 0);
  const total = bokfortIManad.belopp + (stangd ? 0 : liveSumma);

  const dag = saltEnDag(tavlansOrder, idagsDatum, satser);
  const serie = dagsserie(tavlansOrder, manad);
  const takt = foretagsvy
    ? taktaFlera(lagUnderlag, trappan, manad, idagsDatum)
    : takta(underlag!, trappan, manad, idagsDatum);

  const facit = manadsfacit(serie, foretagsvy
    ? lagUnderlag.reduce((s, u) => s + u.antal.netto, 0)
    : (underlag?.antal.netto ?? 0));

  // MALET: ordermalet i forsta hand, av samma skal som trappan slar pa antal.
  const enskiltMal = foretagsvy ? null : malFor(mal, visadId, manad);
  const lagetsMal = foretagsvy ? samlatMal(lagUnderlag, mal, manad, takt) : null;
  const malOrder: Malutfall | null = foretagsvy
    ? (lagetsMal?.utfall ?? null)
    : enskiltMal?.mal_order != null
      ? motMal(enskiltMal.mal_order, underlag!.antal.netto, takt)
      : null;
  const malKronor: Malutfall | null =
    !foretagsvy && enskiltMal?.mal_kronor != null
      ? motMal(enskiltMal.mal_kronor, total, takt)
      : null;

  // VARNINGEN GALLER ALLTID MIG SJALV. En chef som tittar pa nagon annans
  // manad ska inte mota sin EGNA franvarovarning som om den vore den andres —
  // och inte heller den andres, som ar en personalfraga och inte en siffra.
  const mittLage = konsekvenslageFor(minaHandelser, idag);
  const minVarning = arDenna && vy === "jag" ? varningslage(minaHandelser, regler, idagsDatum) : null;

  const historikPoster = foretagsvy ? poster : poster.filter((p) => p.employee_id === visadId);
  const minaManader = manader(historikPoster);

  return (
    <div className="flex flex-col gap-4 pt-2">
      <GuideVard slug="las-din-provision" />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-display text-ink-900">Provision</h1>
          <p className="mt-1 text-body text-ink-500">
            Intjänat, inte utbetalt. Lönen betalas som vanligt av lönesystemet.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {malchef && (
            <ButtonLink href="/provision/mal" size="sm" variant="diskret">
              Månadsmål
            </ButtonLink>
          )}
          {provisionschef && (
            <ButtonLink href={`/provision/underlag/${manad}`} size="sm" variant="sekundar">
              Underlag
            </ButtonLink>
          )}
        </div>
      </div>

      {/* VARNINGEN LIGGER FORE PANELEN. En bonusforlust andrar vad panelens tal
          BETYDER — den som ser 12 000 kr utan att veta att volymbonusen fallit
          laser talet som en normal manad. */}
      {minVarning && (
        <Notis ton={mittLage?.bonusforlust ? "danger" : "warn"}>
          {mittLage?.bonusforlust ? (
            <>
              <strong>Volymbonusen och K&amp;V-bonusen faller för den här månaden.</strong> Din
              grundprovision är orörd — intjänade pengar för utfört arbete faller inte bort, och
              övrig bonus står kvar. Orderräknaren började om från noll den{" "}
              {mittLage.raknareFran}: order efter det bygger en ny bonustrappa i samma månad.
            </>
          ) : (
            <>
              <strong>
                {minVarning.antal === 1
                  ? "En ogiltig frånvaro är registrerad."
                  : `${minVarning.antal} ogiltiga frånvaron är registrerade.`}
              </strong>{" "}
              {minVarning.nasta?.atgard === "bonusforlust" &&
                "Ytterligare en innebär att volymbonusen och K&V-bonusen för månaden faller. "}
              {minVarning.nasta && minVarning.nasta.atgard !== "bonusforlust" && (
                <>Nästa steg är {ATGARD_ETIKETT[minVarning.nasta.atgard].toLowerCase()}. </>
              )}
              {minVarning.manaderKvar > 0
                ? `${minVarning.manaderKvar} ${minVarning.manaderKvar === 1 ? "månad" : "månader"} kvar av perioden (nollställs ${minVarning.nollstallsDen}).`
                : `Perioden nollställs ${minVarning.nollstallsDen}.`}
            </>
          )}
        </Notis>
      )}

      <Manadspanel
        etikett={`${foretagsvy ? "Företaget" : visadNamn} · ${manadsnamn(manad)}`}
        beskrivning={beskrivPanelen(foretagsvy, vy === "jag", stangd !== null, arDenna)}
        total={total}
        delar={
          stangd
            ? delarUrHuvudboken(tavlansPoster, manad)
            : delarUrMotorn(
                foretagsvy ? lagUnderlag : [underlag!],
                summera(handposter(tavlansPoster), manad).belopp,
              )
        }
        stangd={stangd !== null}
        utbetald={stangd?.status === "utbetald"}
        styrning={
          <Vyval
            manad={manad}
            manader={manadsval.map((m) => ({ varde: m, etikett: manadsnamn(m) }))}
            vy={vy}
            // TOM LISTA DOLJER VEMVALJAREN. Saljaren far bara periodvalet, och
            // det ar inte en gommnd knapp — alternativen finns inte for hen.
            vyer={
              provisionschef
                ? [
                    { varde: "jag", etikett: "Min provision" },
                    { varde: "foretag", etikett: "Företaget totalt" },
                    ...personer
                      .filter((p) => saljarIds.has(p.id) && p.id !== user.employee!.id)
                      .map((p) => ({ varde: p.id, etikett: p.namn })),
                  ]
                : []
            }
          />
        }
        // TRAPPAN RITAS INTE FOR EN STANGD MANAD: banan raknas ur dagens trappa,
        // och en trappa som andrats sedan dess hade ritat en annan vag an den
        // som faktiskt gav pengarna. FORETAGET HAR INGEN TRAPPA — se
        // `Foretagsstrip`.
        trappa={
          foretagsvy ? (
            <Foretagsstrip
              saljare={lagUnderlag.length}
              medNiva={lagUnderlag.filter((u) => u.volymbonus !== null).length}
              order={lagUnderlag.reduce((s, u) => s + u.antal.netto, 0)}
              snittPerOrder={snittPerOrder(lagUnderlag)}
            />
          ) : !stangd && trappan.length > 0 ? (
            <Bonustrappa underlag={underlag!} nivaer={trappan} />
          ) : undefined
        }
      />

      {/* TRE KORT I EN PAGAENDE MANAD, TVA I EN SOM VARIT. "I dag: 0" och en
          "takt" for augusti ar tal med fel rubrik — se `Manadsfacitkort`. */}
      <div className={`grid gap-4 ${arDenna ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
        {arDenna ? (
          <>
            <Dagskort dag={dag} datum={idagsDatum} />
            <Taktkort takt={takt} samlad={foretagsvy} />
          </>
        ) : (
          <Manadsfacitkort facit={facit} manad={manad} />
        )}
        <Malkort
          mal={malOrder ?? malKronor}
          takt={takt}
          enhet={malOrder ? "order" : "kronor"}
          farSattaMal={malchef}
        />
      </div>

      {lagetsMal && (
        <Notis ton="info">
          Lagets mål är summerat över de {lagetsMal.medMal} säljare som HAR ett mål för{" "}
          {manadsnamn(manad)} — både målet och utfallet räknas på samma krets, så siffran stiger
          inte av att någon saknar mål.
        </Notis>
      )}

      {!foretagsvy && malOrder && malKronor && (
        <Notis ton={malKronor.lage === "efter" ? "warn" : "info"}>
          Kronmålet är {kronor(malKronor.mal)} och utfallet {kronor(malKronor.nu)} —{" "}
          {Math.round(malKronor.andel * 100)} %, {LAGESORD[malKronor.lage]} takten.
        </Notis>
      )}

      {serie.length > 0 && <Dagsstaplar serie={serie} idag={idagsDatum} manad={manad} />}

      <Lagesrad
        lagen={orderlagen(tavlansOrder, manad)}
        // GENITIV UNDVIKS MED FLIT. "Vlados order" kraver en regel for namn som
        // slutar pa s, x eller z ("Lukas order", inte "Lukass"), och den regeln
        // hade legat i en vy. Namnet efter tankstrecket sager samma sak utan att
        // bojas.
        rubrik={
          foretagsvy
            ? `Företagets order i ${manadsnamn(manad)}`
            : vy === "jag"
              ? `Dina order i ${manadsnamn(manad)}`
              : `Order i ${manadsnamn(manad)} — ${visadNamn}`
        }
      />

      <Card guide="provision.varifran">
        <CardHeader
          titel="Rad för rad"
          beskrivning={
            foretagsvy
              ? "Företagets poster sammanslagna per säljare. Enskilda order står i varje persons egen vy."
              : "Varje post som bygger månadens siffra. Motorn returnerar raderna, vyn räknar aldrig om något själv."
          }
        />
        {foretagsvy ? (
          lagUnderlag.length === 0 ? (
            <EmptyState
              rubrik={`Ingen order i ${manadsnamn(manad)}`}
              text="Raderna kommer ur orderna. Den första godkända ordern dyker upp här samma sekund."
              handling={<ButtonLink href="/order">Till order</ButtonLink>}
            />
          ) : (
            <ul className="flex flex-col">
              {lagUnderlag
                .map((u) => ({
                  namn: personer.find((p) => p.id === u.employee_id)?.namn ?? "Okänd",
                  u,
                }))
                .sort((a, b) => b.u.summa - a.u.summa)
                .map(({ namn, u }) => (
                  <li
                    key={u.employee_id}
                    className="flex items-center gap-4 border-b border-canvas py-2 last:border-0"
                  >
                    <span className="flex-1 text-small text-ink-700">
                      {namn} — {u.antal.netto} order
                      {u.volymbonus && `, nivå ${u.volymbonus.niva.threshold}`}
                    </span>
                    <span className="tnum text-small font-semibold text-ink-900">
                      {kronor(u.summa)}
                    </span>
                  </li>
                ))}
            </ul>
          )
        ) : underlag!.rader.length === 0 && bokfortIManad.poster === 0 ? (
          <EmptyState
            rubrik={`Ingen post i ${manadsnamn(manad)}`}
            text="Raderna kommer ur orderna. Den första godkända ordern dyker upp här samma sekund."
            handling={<ButtonLink href="/order">Lägg en order</ButtonLink>}
          />
        ) : (
          <ul className="flex flex-col">
            {underlag!.rader.map((r, i) => (
              <li
                key={r.order_id ?? `${r.slag}-${i}`}
                className="flex items-center gap-4 border-b border-canvas py-2 last:border-0"
              >
                <span className="flex-1 text-small text-ink-700">{r.text}</span>
                <span
                  className={`tnum text-small font-semibold ${r.belopp < 0 ? "text-danger-ink" : "text-ink-900"}`}
                >
                  {kronor(r.belopp)}
                </span>
              </li>
            ))}
            {handposter(tavlansPoster)
              .filter((p) => p.period_month === manad)
              .map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-4 border-b border-canvas py-2 last:border-0"
                >
                  <span className="flex-1 text-small text-ink-700">{p.note ?? "Bokförd post"}</span>
                  <Badge>Bokförd för hand</Badge>
                  <span
                    className={`tnum text-small font-semibold ${p.amount < 0 ? "text-danger-ink" : "text-ink-900"}`}
                  >
                    {kronor(p.amount)}
                  </span>
                </li>
              ))}
          </ul>
        )}
        <p className="mt-4 max-w-[70ch] text-small text-ink-500">
          Grundprovisionen kommer ur orderna och paketmatrisen — beloppet fryses på ordern när den
          godkänns, så en sats som ändras i november ändrar inte vad någon tjänade i augusti.
          Stämmer något inte:{" "}
          <Link href="/arenden" className="underline">
            lägg ett ärende
          </Link>{" "}
          i stället för att fråga i förbifarten. Då finns frågan kvar, och svaret också.
        </p>
      </Card>

      <Card>
        <CardHeader
          titel={foretagsvy ? "Företagets historik" : `Historik — ${visadNamn}`}
          beskrivning="Tolv månader bakåt, senaste först. Bara fastställda månader står här — en öppen månad räknas live ovanför."
        />
        {minaManader.length === 0 ? (
          <EmptyState
            rubrik="Ingen månad är fastställd än"
            text="Månaden bokförs när perioden fastställs. Innan dess räknas den live här ovanför."
          />
        ) : (
          <ul className="flex flex-col">
            {minaManader.map((m) => (
              <li
                key={m.manad}
                className="flex items-center gap-4 border-b border-canvas py-3 last:border-0"
              >
                <Link
                  href={`/provision?manad=${m.manad}&vy=${vy}`}
                  className="flex-1 text-body text-ink-900 underline-offset-4 hover:underline"
                >
                  {manadsnamn(m.manad)}
                </Link>
                {m.affarer !== null && (
                  <span className="text-small text-ink-500">{m.affarer} affärer</span>
                )}
                {m.poster > 1 && <Badge>{m.poster} poster</Badge>}
                <span className="tnum text-body font-semibold text-ink-900">
                  {kronor(m.belopp)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {provisionschef && (
        <Lagtavla
          manad={manad}
          rader={lagrader({
            personer,
            saljarIds,
            order: material,
            alla: poster,
            mal,
            nivaer,
            trappan,
            kvPerPerson,
            lagen,
            manad,
            idagsDatum,
            satser,
            stangd: stangd !== null,
          })}
          farSattaMal={malchef}
        />
      )}

      {provisionschef && (
        <Card>
          <CardHeader
            titel="Provisionsperioder"
            beskrivning="En öppen månad räknas live ur orderna och ändrar sig med varje ny order. En fastställd månad är bokförd och räknas aldrig om — inte ens om trappan ändras efteråt."
          />
          <ul className="flex flex-col">
            {[0, 1, 2]
              .map((i) => {
                const m = manadFore(idag, i);
                // LIVE-SUMMAN MASTE RAKNAS SOM ATTESTEN RAKNAR. Chefen laser
                // talet, trycker "Faststall", och far en bokforing som ska bli
                // samma siffra.
                //
                // K&V-BONUSEN LADES TILL 2026-09-07. Den saknades har medan
                // `stangning.ts` alltid bokfort den, sa vyn visade ett LAGRE
                // belopp an det som bokfordes. `kvPerPerson` galler den VALDA
                // manaden, sa den skickas bara med for just den.
                const live = underlagForAlla(
                  material,
                  m,
                  nivaer,
                  m === manad ? kvPerPerson : undefined,
                  lagenPerPerson(godkanda, m),
                );
                return {
                  manad: m,
                  stangd: perioder.find((p) => p.period_month === m) ?? null,
                  antalPersoner: live.length,
                  liveSumma: live.reduce((s, u) => s + u.summa, 0),
                  bokfort: summera(poster, m).belopp,
                  garAttStanga: sistaDagen(m) <= idagsDatum,
                };
              })
              .map((p) => (
                <li
                  key={p.manad}
                  className="flex flex-wrap items-center gap-3 border-b border-canvas py-3 last:border-0"
                >
                  <Link
                    href={`/provision?manad=${p.manad}&vy=${vy}`}
                    className="w-36 text-body text-ink-900 underline-offset-4 hover:underline"
                  >
                    {manadsnamn(p.manad)}
                  </Link>

                  {p.stangd ? (
                    <Badge ton={p.stangd.status === "utbetald" ? "ok" : "brand"}>
                      {p.stangd.status === "utbetald" ? "Utbetald" : "Fastställd"}
                    </Badge>
                  ) : (
                    <Badge ton="info">Öppen</Badge>
                  )}

                  <span className="tnum flex-1 text-body font-semibold text-ink-900">
                    {kronor(p.stangd ? p.bokfort : p.liveSumma)}
                  </span>

                  {!p.stangd && (
                    <span className="text-small text-ink-500">
                      {p.antalPersoner} säljare, räknat live
                    </span>
                  )}

                  <ButtonLink href={`/provision/underlag/${p.manad}`} size="sm" variant="diskret">
                    Underlag
                  </ButtonLink>

                  {!p.stangd && p.garAttStanga && <Faststall manad={p.manad} />}
                  {p.stangd?.status === "faststalld" && bokforare && <Utbetald manad={p.manad} />}
                </li>
              ))}
          </ul>
          <p className="mt-4 max-w-[70ch] text-small text-ink-500">
            En period kan fastställas tidigast på månadens sista dag. Reglerna sätts under{" "}
            <Link href="/provision/regler" className="underline">
              Provisionsregler
            </Link>
            . <strong>Underlaget</strong> är det separata dokument som följer med lönekörningen —
            lönerapporten räknar fortfarande inga kronor (K5, AC-2.17), och de två papperen går
            i väg tillsammans.
          </p>
        </Card>
      )}

      {bokforare && (
        <Card>
          <CardHeader
            titel="Bokför provision"
            beskrivning="Ekonomi och VD. Varje post loggas med belopp och person. En rättelse bokförs som en egen negativ post — en post skrivs aldrig om."
          />
          <Inmatning
            personer={personer}
            manader={manadsval.map((m) => ({ nyckel: m, etikett: manadsnamn(m) }))}
          />
        </Card>
      )}
    </div>
  );
}

const LAGESORD = { fore: "före", i_takt: "i takt med", efter: "efter" } as const;

/** Meningen under det stora talet. Skiftar med bade omfattning och manadens lage. */
function beskrivPanelen(
  foretagsvy: boolean,
  egen: boolean,
  stangd: boolean,
  arDenna: boolean,
): string {
  if (stangd) {
    return foretagsvy
      ? "Fastställd och bokförd. Summan av allt som betalades ut för månaden."
      : "Fastställt och bokfört. Siffran ändras inte längre.";
  }
  if (foretagsvy) {
    return arDenna
      ? "Hela företagets intjäning hittills. Räknas live ur orderna och ändras med varje ny order."
      : "Hela företagets intjäning för månaden. Månaden är inte fastställd än, så siffran är preliminär.";
  }
  if (!arDenna) {
    return "Månaden är inte fastställd än, så siffran räknas fortfarande live och är preliminär.";
  }
  return egen
    ? "Intjänat hittills. Räknas live ur dina order och ändras med varje ny order."
    : "Intjänat hittills. Räknas live ur orderna och ändras med varje ny order.";
}

/** Snittprovision per order över laget. Noll order ger noll, aldrig NaN. */
function snittPerOrder(lag: Underlag[]): number {
  const order = lag.reduce((s, u) => s + u.antal.netto, 0);
  if (order <= 0) return 0;
  return lag.reduce((s, u) => s + u.grundprovision, 0) / order;
}

// -----------------------------------------------------------------------------
// Nedbrytningen i panelen
// -----------------------------------------------------------------------------

/** Handinmatade poster. Motorns egna kanns igen pa `source`. */
function handposter(poster: Post[]): Post[] {
  return poster.filter((p) => p.source !== "motor");
}

/**
 * En OPPEN manad bryts ned ur motorns underlag. Listan far vara EN persons
 * underlag eller hela lagets — summorna ar desamma, och att lata den ta en
 * lista gor att foretagsvyn inte behover en egen kopia av samma fyra rader.
 *
 * Villkoren ar `!== 0` och inte `alltid`: en rad som star dar och sager noll lar
 * ogat att ingenting hander pa den platsen. Samma skal som gor att chipsen ar
 * farre i framtidsflikarna i `Flikar.tsx`.
 */
function delarUrMotorn(lag: Underlag[], handbokfort: number): { etikett: string; varde: number }[] {
  const grund = lag.reduce((s, u) => s + u.grundprovision, 0);
  const volym = lag.reduce((s, u) => s + (u.volymbonus?.belopp ?? 0), 0);
  const kv = lag.reduce((s, u) => s + (u.kv?.belopp ?? 0), 0);

  return [
    { etikett: "Grundprovision", varde: grund, visa: true },
    { etikett: "Volymbonus", varde: volym, visa: volym !== 0 },
    // K&V-BONUSEN STAR MED SEDAN 2026-09-07 — omprovning av avsnitt 9.1.
    { etikett: "K&V-bonus", varde: kv, visa: kv !== 0 },
    { etikett: "Bokfört för hand", varde: handbokfort, visa: handbokfort !== 0 },
  ]
    .filter((d) => d.visa)
    .map(({ etikett, varde }) => ({ etikett, varde }));
}

/**
 * En STANGD manad bryts ned ur HUVUDBOKEN, aldrig ur motorn.
 *
 * Slaget lases ur `external_ref` — se `slagetFor` i `provision.ts` for varfor
 * det talet star dar och inte i en egen kolumn. Handinmatade poster har ingen
 * referens och summeras under en egen rubrik.
 */
function delarUrHuvudboken(poster: Post[], manad: string): { etikett: string; varde: number }[] {
  const manadens = poster.filter((p) => p.period_month === manad);

  const per = new Map<string, number>();
  for (const p of manadens) {
    const slag = slagetFor(p);
    const etikett = slag ? (SLAGSETIKETT[slag] ?? slag) : "Bokfört för hand";
    per.set(etikett, (per.get(etikett) ?? 0) + p.amount);
  }

  const ordning = [...Object.values(SLAGSETIKETT), "Bokfört för hand"];
  return [...per.entries()]
    .sort((a, b) => ordning.indexOf(a[0]) - ordning.indexOf(b[0]))
    .map(([etikett, varde]) => ({ etikett, varde }));
}

/**
 * Ordernas lage den valda manaden.
 *
 * MAKULERADE RAKNAS PA SIN MAKULERINGSMANAD, inte pa sin signeringsmanad. Det
 * ar samma tvahandelsemodell som `makuleradeIPeriod` i `order.ts` bygger pa:
 * ordern gav provision nar den tecknades och drar tillbaka den nar den
 * makuleras, och de tva bokfors i olika manader med flit.
 *
 * Beloppet ar darfor NEGATIVT pa den raden. Ett positivt tal med en flagga hade
 * krävt att lasaren gjorde subtraktionen sjalv.
 */
function orderlagen(order: Orderrad[], manad: string) {
  const signerade = order.filter((o) => o.period_month === manad && o.status === "signerad");
  const betalda = order.filter((o) => o.period_month === manad && o.status === "betald");
  const makulerade = order.filter((o) => o.cancel_period_month === manad);

  const summa = (rader: Orderrad[]) => rader.reduce((s, o) => s + (o.commission_amount ?? 0), 0);

  return [
    { etikett: "Godkänd", antal: signerade.length, kronor: summa(signerade), ton: "info" as const },
    { etikett: "Betald", antal: betalda.length, kronor: summa(betalda), ton: "ok" as const },
    {
      etikett: "Makulerad",
      antal: makulerade.length,
      kronor: -summa(makulerade),
      ton: "danger" as const,
    },
  ];
}

// -----------------------------------------------------------------------------
// Lagtavlan
// -----------------------------------------------------------------------------

/**
 * Raderna chefens lagtavla ritar.
 *
 * ===========================================================================
 * KRETSEN AR SALJARE PLUS ALLA SOM RORT SIG I MANADEN.
 *
 * Bara `employee_role = 'salesperson'` hade tappat den saljchef som sjalv
 * tecknar order — och en tavla som inte visar en order nagon faktiskt lagt ar
 * en tavla man slutar lita pa.
 *
 * Bara "de som har order" hade tappat det motsatta: saljaren som star pa noll,
 * vilket ar precis den rad en chef behover se mitt i en manad.
 * ===========================================================================
 */
function lagrader(arg: {
  personer: { id: string; namn: string }[];
  saljarIds: Set<string>;
  order: Orderrad[];
  alla: Post[];
  mal: Saljmal[];
  /** Hela trappans historik — motorn slar sjalv upp manadens rader. */
  nivaer: Bonusniva[];
  /** Bara de rader som galler manaden. Takten raknar pa dem. */
  trappan: Bonusniva[];
  kvPerPerson: Map<string, KvIndata>;
  lagen: Map<string, Konsekvenslage>;
  manad: string;
  idagsDatum: string;
  satser: Sats[];
  stangd: boolean;
}): Lagrad[] {
  const medRorelse = new Set(
    arg.order
      .filter((o) => o.period_month === arg.manad || o.cancel_period_month === arg.manad)
      .map((o) => o.salesperson_id),
  );

  const ids = new Set<string>([...arg.saljarIds, ...medRorelse]);

  return arg.personer
    .filter((p) => ids.has(p.id))
    .map((p) => {
      const underlag = raknaUnderlag(
        p.id,
        arg.order,
        arg.manad,
        arg.nivaer,
        arg.kvPerPerson.get(p.id) ?? null,
        arg.lagen.get(p.id) ?? null,
      );

      const bokfort = summera(
        arg.alla.filter((x) => x.employee_id === p.id),
        arg.manad,
      ).belopp;

      const takt: Takt = takta(underlag, arg.trappan, arg.manad, arg.idagsDatum);
      const mal = malFor(arg.mal, p.id, arg.manad);
      const total = bokfort + (arg.stangd ? 0 : underlag.summa);

      return {
        employee_id: p.id,
        namn: p.namn,
        dag: saltEnDag(
          arg.order.filter((o) => o.salesperson_id === p.id),
          arg.idagsDatum,
          arg.satser,
        ),
        underlag,
        takt,
        mal:
          mal?.mal_order != null
            ? motMal(mal.mal_order, underlag.antal.netto, takt)
            : mal?.mal_kronor != null
              ? motMal(mal.mal_kronor, total, takt)
              : null,
        total,
      };
    });
}

/**
 * Sista dagen i manaden, som "2026-08-31". En period kan faststallas tidigast
 * da (avsnitt 5.6) — en manad som stangs den 20:e stanger ute de order som
 * tecknas den 25:e, och de har ingen vag tillbaka in.
 *
 * Regeln star ocksa i triggern `commission_period_stangs` i 0035, och det ar
 * den som avgor. Den har raden gommer bara knappen.
 */
function sistaDagen(manad: string): string {
  const dag = new Date(`${manadFore(manad, -1)}T00:00:00Z`);
  dag.setUTCDate(dag.getUTCDate() - 1);
  return dag.toISOString().slice(0, 10);
}

/** Aktiva anstallda, for inmatningens lista och lagtavlans namn. RLS avgor vilka som syns. */
async function hamtaPersoner(): Promise<{ id: string; namn: string }[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("employee")
    .select("id, first_name, last_name")
    .in("status", ["active", "onboarding"])
    .order("first_name");

  return (data ?? []).map((e) => ({ id: e.id, namn: fullName(e) }));
}

/**
 * De som har saljarrollen.
 *
 * INGEN INBADDNING. `employee_role` har flera frammande nycklar mot `employee`,
 * sa `employee!inner(...)` ar TVETYDIGT och PostgREST svarar `PGRST201` i
 * stallet for att ge rader — med `?? []` blir felet en tom lista och funktionen
 * fortsatter som om ingen vore saljare. Sex sadana fall rattades 2026-09-07.
 * Namnen kommer fran `hamtaPersoner`, och de tva satts ihop pa id.
 */
async function hamtaSaljarIds(): Promise<Set<string>> {
  const rls = await supabaseServer();
  const { data } = await rls.from("employee_role").select("employee_id").eq("role", "salesperson");

  return new Set((data ?? []).map((r) => String(r.employee_id)));
}
