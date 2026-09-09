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
  manadsnamn,
  manadsnyckel,
  slagetFor,
  summera,
  SLAGSETIKETT,
  SLAGSORDNING,
} from "@/lib/provision";
import {
  hamtaChefsposter,
  hamtaOrder,
  hamtaOrderFor,
  hamtaSatser,
  type Orderrad,
} from "@/lib/order-server";
import { hamtaNivaer, hamtaPerioder } from "@/lib/bonus-server";
import { hamtaKvPerManad } from "@/lib/kv-server";
import { hamtaMal } from "@/lib/saljmal-server";
import { hamtaGodkandaFran, hamtaMinaHandelser, hamtaRegler } from "@/lib/konsekvens-server";
import { ATGARD_ETIKETT, konsekvenslageFor, lagenPerPerson, varningslage } from "@/lib/konsekvens";
import {
  gallandeNivaer,
  raknaUnderlag,
  underlagForAlla,
  type Bonusniva,
  type Chefspost,
  type KvIndata,
  type Underlag,
} from "@/lib/provision-motor";
import {
  arbetsdagarIManad,
  arsfacit,
  dagsserie,
  kronmalOverPeriod,
  malFor,
  malOverPeriod,
  manaderIAr,
  manadsfacit,
  motMal,
  saltEnDag,
  takta,
  taktaOverManader,
  type Malutfall,
  type Manadsrad,
  type Saljmal,
} from "@/lib/saljtakt";
import type { Sats } from "@/lib/order";
import { svensktDatum } from "@/lib/klocka";
import { Inmatning } from "./Inmatning";
import { Faststall, Utbetald } from "./Period";
import {
  Bonustrappa,
  Dagskort,
  Lagesrad,
  Malkort,
  Manadsfacitkort,
  Manadspanel,
  Ordervardeskort,
  Staplar,
  Taktkort,
  Talstrip,
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
 * Sidan far alltsa aldrig addera de tva for samma manad. Se `manadsrader`.
 * ===========================================================================
 *
 * ---------------------------------------------------------------------------
 * PANELEN HAR TVA RATTAR: VILKEN PERIOD, OCH VEMS SIFFROR.
 *
 * OMFATTNINGEN STYR HELA TAVLAN — panelen, banan, korten, staplarna,
 * orderlagena, radlistan och lagtavlan. Den raknas fram pa ETT stalle. Tolkad
 * pa sju hade rubriken kunnat saga "Vlado" medan kortet under visade ens egna
 * siffror, och det ar den sortens fel ingen upptacker genom att titta.
 *
 * TVA SPARRAR PA VEM SOM SER VEM:
 *
 *   1. `vy` tvingas till "jag" for den som inte ar provisionschef.
 *   2. Materialet finns inte ens — `hamtaOrder` (alla) hamtas bara for chefer,
 *      och `sales_order_read` i 0034 hade gett en saljare noll rader anda.
 * ---------------------------------------------------------------------------
 *
 * ===========================================================================
 * PERIODEN AR EN LISTA AV MANADER, INTE ETT SPANN. Aret kom till 2026-09-08.
 *
 * Bade "september" och "hela 2026" behandlas som en lista: den forsta har en
 * manad i sig, den andra upp till tolv. Allt harunder loopar over listan.
 *
 * Skalet ar att en manad ar den enda enhet som HAR ett svar. Volymbonusen ar en
 * egenskap hos manaden (avsnitt 5.2), och en stangd manad ar bokford medan en
 * oppen raknas live. Ett ar innehaller bada sorterna, och summan maste darfor
 * bildas manad for manad med var manads egen regel.
 *
 * DET UTESLUTER OCKSA ETT FRITT DATUMSPANN. "1–15 september" har ingen
 * bonusniva att visa: halva manadens order nar kanske niva 5, men de pengarna
 * finns inte forran manaden ar slut och kan ga at bada hall efter den 15:e.
 * Talet hade sett ut som provision utan att ga att betala ut. Rorelsen inne i
 * manaden finns i stapelraden; den ar den fragan.
 * ===========================================================================
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
  const detArAret = Number(idag.slice(0, 4));
  const sp = await searchParams;

  // ===========================================================================
  // PERIODEN. Tolv manader bakat plus tva helar, aldrig framat — en framtida
  // manad ar inte en intjaning utan en prognos, samma grans som `giltigManad`
  // drar. Ett val som inte gar att gora ar battre an ett felmeddelande efterat.
  //
  // Aret skrivs `ar-2026` i adressen och inte `2026`, sa att en arsnyckel aldrig
  // kan forvaxlas med en manadsnyckel av nagot som bara tittar pa formen.
  // ===========================================================================
  const manadsval = Array.from({ length: 12 }, (_, i) => manadFore(idag, i));
  const arsval = [detArAret, detArAret - 1];

  const onskadPeriod = sp.manad ?? idag;
  const periodNyckel = manadsval.includes(onskadPeriod)
    ? onskadPeriod
    : arsval.some((a) => onskadPeriod === `ar-${a}`)
      ? onskadPeriod
      : idag;

  const arsvy = periodNyckel.startsWith("ar-");
  const aret = arsvy ? Number(periodNyckel.slice(3)) : null;

  const manaderna = arsvy ? manaderIAr(aret!, idag) : [periodNyckel];
  const periodtext = arsvy ? `hela ${aret}` : manadsnamn(periodNyckel);
  // Perioden innehaller dagens datum: da ar "I dag" och "Takt" meningsfulla.
  const inneharIdag = manaderna.includes(idag);

  // Hamtningsfonstret maste tacka BADE perioden och de tre manader
  // periodkortet visar. Perioden ar oftast senare, men inte alltid.
  const treManader = manadFore(idag, 2);
  const periodStart = manaderna[0] ?? idag;
  const franOchMed = periodStart < treManader ? periodStart : treManader;
  // Huvudboken laser minst tolv manader bakat for historiken, mer om perioden
  // stracker sig langre.
  const posterFran = franOchMed < manadFore(idag, 11) ? franOchMed : manadFore(idag, 11);

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
  // arbetsloggen 2026-08-22. K&V hamtas for HELA perioden i EN fraga — tolv
  // manadsanrop hade blivit tolv turer till databasen.
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
    kvPerManad,
    mal,
    chefsposter,
  ] = await Promise.all([
    hamtaProvision(user.employee.id, posterFran),
    provisionschef ? hamtaAllProvision(posterFran) : Promise.resolve([] as Post[]),
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
    // chefen far allas. Samma anrop tjanar bada vyerna.
    // FONSTRET AR PERIODEN PLUS DE TRE MANADER PERIODKORTET VISAR. Utan de tre
    // hade `kvPerManad.get(m)` gett undefined dar nere, och da raknar
    // `underlagForAlla` utan K&V — exakt den avvikelse mot `stangning.ts` som
    // rattades 2026-09-07. En fraga oavsett hur manga manader det blir.
    hamtaKvPerManad([...new Set([...manaderna, idag, manadFore(idag, 1), treManader])]),
    hamtaMal(franOchMed),
    // OVERTACKEN. Hamtas for ALLA, inte bara for chefer:
    // `order_manager_commission_read` i 0050 ger mottagaren sina EGNA rader och
    // kretsen allas, medan en saljare far noll. En if-sats har hade upprepat
    // policyn och hunnit glida isar fran den — samma regel som resten av sidan
    // foljer.
    //
    // FONSTRET AR `franOchMed`, alltsa detsamma som orderna. Posterna placeras i
    // manad ur SIN ORDER, sa ett smalare fonster hade tappat samma sorts rad som
    // `hamtaOrder` tappade fore 2026-09-08: overtacket pa en gammal order som
    // makuleras i perioden.
    hamtaChefsposter(franOchMed),
  ]);

  const material = provisionschef ? allaOrder : minaOrder;
  const poster = provisionschef ? alla : mina;

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
    vy === "jag" ? "Din provision" : (personer.find((p) => p.id === visadId)?.namn ?? "Okänd");

  const tavlansOrder = foretagsvy
    ? material
    : material.filter((o) => o.salesperson_id === visadId);
  const tavlansPoster = foretagsvy ? poster : poster.filter((p) => p.employee_id === visadId);

  // OVERTACKEN FOLJER OMFATTNINGEN SOM ALLT ANNAT. Ett overtack hor till den som
  // FICK det, inte till den som salde ordern — sa filtret star pa `manager_id`.
  // Tittar chefen pa Vlado ska Vlados vy inte innehalla chefens egna pengar, och
  // tittar hen pa sig sjalv ska overtacken pa Vlados order vara med.
  const tavlansChefsposter = foretagsvy
    ? chefsposter
    : chefsposter.filter((p) => p.manager_id === visadId);

  // ===========================================================================
  // EN RAD PER MANAD I PERIODEN. Hela tavlan byggs ur den har listan.
  //
  // VARJE MANAD FAR SIN EGEN TRAPPA, SIN EGEN K&V OCH SITT EGET KONSEKVENSLAGE.
  // Trappan versioneras (0035) och slas upp pa manadens forsta dag; kors aret
  // med septembers trappa far januari fel bonus.
  //
  // OCH VARJE MANAD FAR SIN EGEN SANNING: ar den stangd ar `summa` bokford och
  // motorns tal kastas, ar den oppen raknas den live. Ett ar som blandar de tva
  // maste gora valet per manad — inte en gang for hela perioden.
  // ===========================================================================
  const manadsrader: (Manadsrad & {
    underlag: Underlag | null;
    lag: Underlag[];
    grundprovision: number;
    volymbonus: number;
    kv: number;
    chefsprovision: number;
    ordervarde: number;
    utanVarde: number;
    handbokfort: number;
  })[] = manaderna.map((m) => {
    const kvM = kvPerManad.get(m) ?? new Map<string, KvIndata>();
    const lagenM = lagenPerPerson(godkanda, m);
    const stangdM = perioder.some((p) => p.period_month === m);

    const lag = foretagsvy
      ? underlagForAlla(material, m, nivaer, kvM, lagenM, chefsposter)
      : [];
    const u = foretagsvy
      ? null
      : raknaUnderlag(
          visadId,
          material,
          m,
          nivaer,
          kvM.get(visadId) ?? null,
          lagenM.get(visadId) ?? null,
          tavlansChefsposter,
        );

    const kallor = foretagsvy ? lag : [u!];
    const bokfort = summera(tavlansPoster, m).belopp;
    const live = kallor.reduce((s, x) => s + x.summa, 0);

    return {
      manad: m,
      antal: kallor.reduce((s, x) => s + x.antal.netto, 0),
      // DEN ENDA PLATS DAR STANGD/OPPEN AVGORS. Adderas bada blir en stangd
      // manad dubbelraknad; valjs fel blir den tom.
      summa: bokfort + (stangdM ? 0 : live),
      niva: u?.volymbonus?.niva.threshold ?? null,
      stangd: stangdM,
      underlag: u,
      lag,
      grundprovision: kallor.reduce((s, x) => s + x.grundprovision, 0),
      volymbonus: kallor.reduce((s, x) => s + (x.volymbonus?.belopp ?? 0), 0),
      kv: kallor.reduce((s, x) => s + (x.kv?.belopp ?? 0), 0),
      chefsprovision: kallor.reduce((s, x) => s + (x.chefsprovision?.belopp ?? 0), 0),
      // ORDERVARDET SUMMERAS OVER `kallor` PRECIS SOM ALLT ANNAT — men det gar
      // ALDRIG in i `summa` ovan. Det ar bolagets omsattning, inte pengar till
      // nagon, och en manad dar de tva laggs ihop visar en lonekostnad atta
      // ganger for hog. Se rubriken vid `Underlag.ordervarde`.
      ordervarde: kallor.reduce((s, x) => s + x.ordervarde.netto, 0),
      utanVarde: kallor.reduce((s, x) => s + x.ordervarde.utanVarde, 0),
      handbokfort: summera(handposter(tavlansPoster), m).belopp,
    };
  });

  const facit = arsfacit(manadsrader);
  const total = facit.summa;

  // ORDERVARDET SUMMERAS OVER PERIODENS MANADER, precis som allt annat — och
  // det gar ALDRIG in i `total`. Se rubriken vid `Underlag.ordervarde` i
  // `provision-motor.ts`: det ar bolagets omsattning, inte pengar till nagon.
  const ordervardeIPerioden = {
    netto: manadsrader.reduce((s, r) => s + r.ordervarde, 0),
    utanVarde: manadsrader.reduce((s, r) => s + r.utanVarde, 0),
  };

  // EN ENDA MANAD ger de extra ytorna: bonustrappan (som kraver ett `Underlag`)
  // och orderraderna en och en. Ett ar far manadslistan i stallet.
  const enManad = manaderna.length === 1 ? manadsrader[0] : null;
  const trappan = enManad ? gallandeNivaer(nivaer, enManad.manad) : [];

  const dag = saltEnDag(tavlansOrder, idagsDatum, satser);

  // ===========================================================================
  // TVA TAKTER, OCH VALET AR INTE KOSMETISKT.
  //
  // EN PERSONS ENSKILDA MANAD far `takta()`, som slar upp VILKEN NIVA prognosen
  // landar pa. Det ar den mest anvanda vyn, och "da blir bonusen 1 200 kr" ar
  // halva varfor kortet finns.
  //
  // ALLT ANNAT — ett ar eller ett helt lag — far `taktaOverManader()`, som
  // skriver fram beloppet utan att pasta en niva. Varken ett ar eller ett lag
  // HAR en niva; se rubriken i `saljtakt.ts`. Taktkortet far `samlad` och byter
  // da etikett, sa talet aldrig star under ett ord det inte svarar mot.
  // ===========================================================================
  const takt =
    enManad && !foretagsvy && enManad.underlag
      ? takta(enManad.underlag, trappan, enManad.manad, idagsDatum)
      : taktaOverManader(manaderna, idagsDatum, {
          antal: facit.antal,
          grundprovision: manadsrader.reduce((s, r) => s + r.grundprovision, 0),
          bonus: manadsrader.reduce((s, r) => s + r.volymbonus + r.kv, 0),
        });

  // MALET: ordermalet i forsta hand, av samma skal som trappan slar pa antal.
  //
  // UTFALLET LAMNAS PER PERSON OCH MANAD, inte fardigsummerat. Det ar det som
  // gor att `malOverPeriod` kan para ihop varje mal med sitt eget utfall och
  // rakna bada sidor pa samma krets — se rubriken dar.
  const utfallsrader = manadsrader.flatMap((r) =>
    foretagsvy
      ? r.lag.map((u) => ({ employee_id: u.employee_id, manad: r.manad, antal: u.antal.netto }))
      : [{ employee_id: visadId, manad: r.manad, antal: r.antal }],
  );

  const malsumma = malOverPeriod(
    foretagsvy ? mal : mal.filter((m) => m.employee_id === visadId),
    manaderna,
    utfallsrader,
  );
  const kronmal = foretagsvy ? 0 : kronmalOverPeriod(mal, manaderna, visadId);

  const malOrder: Malutfall | null =
    malsumma.mal > 0 ? motMal(malsumma.mal, malsumma.utfall, takt) : null;
  // Kronmalet ritar bagen bara nar det INTE finns ett ordermal. Tva bagar
  // bredvid varandra hade tvingat fram en tolkning ("vilken raknas?") som ingen
  // bett om — trappan slar pa antal, sa ordermalet ar det som hor ihop med
  // bonusen och far foretradet.
  const malKronor: Malutfall | null =
    malsumma.mal === 0 && kronmal > 0 ? motMal(kronmal, total, takt) : null;

  // VARNINGEN GALLER ALLTID MIG SJALV, och bara i en vy som ar min och nu. En
  // chef som tittar pa nagon annans manad ska inte mota sin EGNA varning som om
  // den vore den andres — och inte heller den andres, som ar en personalfraga
  // och inte en siffra.
  const mittLage = konsekvenslageFor(minaHandelser, idag);
  const minVarning =
    inneharIdag && vy === "jag" ? varningslage(minaHandelser, regler, idagsDatum) : null;

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
          {provisionschef && enManad && (
            <ButtonLink href={`/provision/underlag/${enManad.manad}`} size="sm" variant="sekundar">
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
        etikett={`${foretagsvy ? "Företaget" : visadNamn} · ${periodtext}`}
        beskrivning={beskrivPanelen(foretagsvy, vy === "jag", manadsrader, arsvy)}
        total={total}
        delar={delarFor(manadsrader, tavlansPoster)}
        stangd={manadsrader.length > 0 && manadsrader.every((r) => r.stangd)}
        utbetald={
          enManad !== null &&
          perioder.find((p) => p.period_month === enManad.manad)?.status === "utbetald"
        }
        styrning={
          <Vyval
            manad={periodNyckel}
            manader={[
              ...manadsval.map((m) => ({ varde: m, etikett: manadsnamn(m) })),
              ...arsval.map((a) => ({ varde: `ar-${a}`, etikett: `Hela ${a}` })),
            ]}
            vy={vy}
            // TOM LISTA DOLJER VEMVALJAREN. Saljaren far bara periodvalet, och
            // det ar inte en gomd knapp — alternativen finns inte for hen.
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
        // BANAN RITAS BARA FOR EN ENSKILD PERSONS OPPNA MANAD.
        //
        // En STANGD manad: banan raknas ur dagens trappa, och en trappa som
        // andrats sedan dess hade ritat en annan vag an den som gav pengarna.
        // FORETAGET och ARET: ingen niva finns att rita — se `Talstrip`.
        trappa={
          arsvy ? (
            <Talstrip
              tal={[
                { etikett: "Månader med order", varde: `${facit.manaderMedOrder} av ${facit.raknade}` },
                {
                  etikett: "Bästa månaden",
                  varde: facit.bastaManaden
                    ? `${manadsnamn(facit.bastaManaden.manad).split(" ")[0]} · ${facit.bastaManaden.antal}`
                    : "—",
                },
                {
                  etikett: foretagsvy ? "Order netto" : "Månader med bonus",
                  varde: foretagsvy ? String(facit.antal) : `${facit.manaderMedNiva} av ${facit.raknade}`,
                },
                {
                  etikett: "Snitt per månad",
                  varde: facit.snittPerManad.toFixed(1).replace(".", ","),
                },
              ]}
            />
          ) : foretagsvy ? (
            <Talstrip
              tal={[
                { etikett: "Säljare med order", varde: String(enManad!.lag.length) },
                {
                  etikett: "Nått en bonusnivå",
                  varde: `${enManad!.lag.filter((u) => u.volymbonus !== null).length} av ${enManad!.lag.length}`,
                },
                { etikett: "Order netto", varde: String(facit.antal) },
                { etikett: "Snitt per order", varde: kronor(snittPerOrder(enManad!.lag)) },
              ]}
            />
          ) : !enManad!.stangd && trappan.length > 0 ? (
            <Bonustrappa underlag={enManad!.underlag!} nivaer={trappan} />
          ) : undefined
        }
      />

      {/* KORTEN FOLJER PERIODEN. "I dag: 0" for augusti ser exakt likadant ut
          som "0 order i dag", och en "takt" for en avslutad period ar utfallet
          med en etikett som pastar nagot annat. */}
      <div className="grid gap-4 lg:grid-cols-3">
        {inneharIdag && (
          <>
            <Dagskort dag={dag} datum={idagsDatum} />
            <Taktkort takt={takt} samlad={foretagsvy || arsvy} />
          </>
        )}
        {!inneharIdag && enManad && (
          <Manadsfacitkort
            facit={manadsfacit(dagsserie(tavlansOrder, enManad.manad), enManad.antal)}
            manad={enManad.manad}
          />
        )}
        <Malkort
          mal={malOrder ?? malKronor}
          takt={takt}
          enhet={malOrder ? "order" : "kronor"}
          farSattaMal={malchef}
        />
      </div>

      {/*
        ORDERVARDET LIGGER EFTER KORTEN OCH FORE ORDERLAGENA.

        Efter korten, for att de svarar pa "hur gar det for mig" och det har
        talet inte handlar om nagons pengar. Fore orderlagena, for att de tva ar
        samma fraga stalld i olika enheter — antal och kronor — och laser man dem
        i den ordningen forklarar den forsta den andra.

        KORTET RITAS BARA NAR DET FINNS ETT VARDE ATT VISA. Alla order som lades
        in fore 2026-09-09 saknar varde, sa for en historisk manad ar summan noll
        — och ett kort som sager "0 kr" om en manad med tolv order ar samre an
        inget kort. `utanVarde` bar upplysningen nar den behovs.
      */}
      {(ordervardeIPerioden.netto > 0 || ordervardeIPerioden.utanVarde > 0) && (
        <Ordervardeskort
          netto={ordervardeIPerioden.netto}
          antal={facit.antal}
          utanVarde={ordervardeIPerioden.utanVarde}
          rubrik={`Ordervärde — ${foretagsvy ? "företaget" : visadNamn.toLowerCase()}, ${periodtext}`}
        />
      )}

      {malOrder && malsumma.antal > 1 && (
        <Notis ton="info">
          Målet är summerat över {malsumma.antal} satta mål i {periodtext}. Både målet och utfallet
          räknas på samma krets — annars hade siffran stigit av att någon saknar mål.
        </Notis>
      )}

      <Staplar
        rubrik={arsvy ? `Månad för månad — ${aret}` : "Månadens dagar"}
        beskrivning={
          arsvy
            ? `${facit.antal} order fördelade på ${facit.raknade} ${facit.raknade === 1 ? "månad" : "månader"}. Framtida månader räknas inte.`
            : `${facit.antal} order fördelade på ${arbetsdagarIManad(enManad!.manad).length} arbetsdagar. Helger och röda dagar räknas inte.`
        }
        serie={
          arsvy
            ? manadsrader.map((r) => ({
                nyckel: r.manad,
                etikett: manadsnamn(r.manad),
                kort: manadsnamn(r.manad).split(" ")[0],
                antal: r.antal,
                framtid: false,
              }))
            : dagsserie(tavlansOrder, enManad!.manad).map((d) => ({
                nyckel: d.dag,
                etikett: d.dag,
                kort: `${Number(d.dag.slice(8))}/${Number(d.dag.slice(5, 7))}`,
                antal: d.antal,
                framtid: d.dag > idagsDatum,
              }))
        }
        markerad={arsvy ? (inneharIdag ? idag : null) : (inneharIdag ? idagsDatum : null)}
        sammanfattning={sammanfattaSerie(facit, arsvy)}
      />

      <Lagesrad
        lagen={orderlagen(tavlansOrder, manaderna)}
        rubrik={
          foretagsvy
            ? `Företagets order i ${periodtext}`
            : vy === "jag"
              ? `Dina order i ${periodtext}`
              : `Order i ${periodtext} — ${visadNamn}`
        }
      />

      <Card guide="provision.varifran">
        <CardHeader
          titel={arsvy ? "Månad för månad" : "Rad för rad"}
          beskrivning={
            arsvy
              ? "Varje månad räknad för sig, med sin egen trappa och sin egen sanning — en fastställd månad är bokförd, en öppen räknas live."
              : foretagsvy
                ? "Företagets poster sammanslagna per säljare. Enskilda order står i varje persons egen vy."
                : "Varje post som bygger månadens siffra. Motorn returnerar raderna, vyn räknar aldrig om något själv."
          }
        />
        {arsvy ? (
          <ul className="flex flex-col">
            {manadsrader.map((r) => (
              <li
                key={r.manad}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-canvas py-3 last:border-0"
              >
                <Link
                  href={`/provision?manad=${r.manad}&vy=${vy}`}
                  className="w-32 text-body text-ink-900 underline-offset-4 hover:underline"
                >
                  {manadsnamn(r.manad)}
                </Link>
                <span className="tnum w-20 text-small text-ink-500">{r.antal} order</span>
                {r.niva !== null ? (
                  <Badge ton="brand">Nivå {r.niva}</Badge>
                ) : (
                  <span className="w-[5.5rem] text-micro uppercase text-ink-300">Ingen nivå</span>
                )}
                <Badge ton={r.stangd ? "ok" : "info"}>{r.stangd ? "Fastställd" : "Öppen"}</Badge>
                <span className="tnum flex-1 text-right text-body font-semibold text-ink-900">
                  {kronor(r.summa)}
                </span>
              </li>
            ))}
          </ul>
        ) : foretagsvy ? (
          enManad!.lag.length === 0 ? (
            <EmptyState
              rubrik={`Ingen order i ${periodtext}`}
              text="Raderna kommer ur orderna. Den första godkända ordern dyker upp här samma sekund."
              handling={<ButtonLink href="/order">Till order</ButtonLink>}
            />
          ) : (
            <ul className="flex flex-col">
              {enManad!.lag
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
        ) : enManad!.underlag!.rader.length === 0 && enManad!.handbokfort === 0 ? (
          <EmptyState
            rubrik={`Ingen post i ${periodtext}`}
            text="Raderna kommer ur orderna. Den första godkända ordern dyker upp här samma sekund."
            handling={<ButtonLink href="/order">Lägg en order</ButtonLink>}
          />
        ) : (
          <ul className="flex flex-col">
            {enManad!.underlag!.rader.map((r, i) => (
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
              .filter((p) => p.period_month === enManad!.manad)
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

      {provisionschef && (
        <Lagtavla
          period={periodtext}
          visaIdag={inneharIdag}
          rader={lagrader({
            personer,
            saljarIds,
            order: material,
            poster,
            mal,
            nivaer,
            kvPerManad,
            godkanda,
            perioder,
            manader: manaderna,
            idagsDatum,
            satser,
            // OFILTRERADE, inte `tavlansChefsposter`. Lagtavlan visar HELA
            // laget oavsett vems siffror panelen star pa — den som tittar pa
            // Vlado ska se samma tavla som den som tittar pa sig sjalv.
            chefsposter,
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
                // samma siffra. K&V-BONUSEN LADES TILL 2026-09-07 — den saknades
                // har medan `stangning.ts` alltid bokfort den.
                const live = underlagForAlla(
                  material,
                  m,
                  nivaer,
                  kvPerManad.get(m),
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

// -----------------------------------------------------------------------------
// Texterna
// -----------------------------------------------------------------------------

/** Meningen under det stora talet. Skiftar med omfattning och periodens lage. */
function beskrivPanelen(
  foretagsvy: boolean,
  egen: boolean,
  rader: { stangd: boolean }[],
  arsvy: boolean,
): string {
  const allaStangda = rader.length > 0 && rader.every((r) => r.stangd);
  const nagraOppna = rader.some((r) => !r.stangd);

  if (arsvy) {
    return allaStangda
      ? "Alla månader är fastställda och bokförda. Siffran ändras inte längre."
      : "Summan av årets månader. Månader som ännu inte fastställts räknas live och är preliminära.";
  }
  if (allaStangda) {
    return foretagsvy
      ? "Fastställd och bokförd. Summan av allt som betalades ut för månaden."
      : "Fastställt och bokfört. Siffran ändras inte längre.";
  }
  if (!nagraOppna) return "Ingen månad att räkna.";
  if (foretagsvy) {
    return "Hela företagets intjäning. Räknas live ur orderna och ändras med varje ny order.";
  }
  return egen
    ? "Intjänat hittills. Räknas live ur dina order och ändras med varje ny order."
    : "Intjänat hittills. Räknas live ur orderna och ändras med varje ny order.";
}

/** Bildtexten för stapelraden. En rad utan den är ett tomt element. */
function sammanfattaSerie(
  facit: ReturnType<typeof arsfacit>,
  arsvy: boolean,
): string {
  if (facit.bastaManaden === null) return "Inga order tecknade i perioden.";
  return arsvy
    ? `Order per månad. ${facit.manaderMedOrder} av ${facit.raknade} månader har minst en order. Bästa månaden är ${manadsnamn(facit.bastaManaden.manad)} med ${facit.bastaManaden.antal}.`
    : `Order per arbetsdag. Totalt ${facit.antal} order i perioden.`;
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
 * Nedbrytningen av totalen, manad for manad.
 *
 * ===========================================================================
 * KALLAN SKIFTAR PER MANAD, OCH DET AR HELA POANGEN.
 *
 * En OPPEN manad bryts ned ur motorns underlag — den raknas live och maste det,
 * for order elva hojer bonusen pa order ett till tio.
 *
 * En STANGD manad bryts ned ur HUVUDBOKEN. Kors motorn om pa en stangd manad
 * kan en trappa som andrats i november ge en annan nedbrytning an den som
 * faktiskt bokfordes i augusti, och da star vyn och utbetalningen och sager
 * olika saker om samma manad.
 *
 * Ett AR innehaller bada sorterna. Valet gors darfor per manad och delarna
 * summeras — inte en gang for hela perioden.
 * ===========================================================================
 */
function delarFor(
  rader: {
    manad: string;
    stangd: boolean;
    grundprovision: number;
    volymbonus: number;
    kv: number;
    chefsprovision: number;
    handbokfort: number;
  }[],
  poster: Post[],
): { etikett: string; varde: number }[] {
  const per = new Map<string, number>();
  const lagg = (etikett: string, belopp: number) =>
    per.set(etikett, (per.get(etikett) ?? 0) + belopp);

  for (const r of rader) {
    if (r.stangd) {
      // Slaget lases ur `external_ref` — se `slagetFor` i `provision.ts` for
      // varfor det talet star dar och inte i en egen kolumn.
      for (const p of poster.filter((x) => x.period_month === r.manad)) {
        const slag = slagetFor(p);
        lagg(slag ? (SLAGSETIKETT[slag] ?? slag) : "Bokfört för hand", p.amount);
      }
    } else {
      lagg("Grundprovision", r.grundprovision);
      lagg("Volymbonus", r.volymbonus);
      // K&V-BONUSEN STAR MED SEDAN 2026-09-07 — omprovning av avsnitt 9.1.
      lagg("K&V-bonus", r.kv);
      // OVERTACKET STAR SOM EGEN DEL sedan 2026-09-09, och det ar viktigt att det
      // inte doljs i grundprovisionen: for saljchefen ar det ofta den storsta
      // posten, och den som ser en total utan att veta att halva kom fran andras
      // affarer laser fel pa sin egen manad. Nollraden faller bort som alla andra.
      lagg("Övertäck", r.chefsprovision);
      lagg("Bokfört för hand", r.handbokfort);
    }
  }

  // NOLLRADER FALLER BORT, utom grundprovisionen. En rad som star dar och alltid
  // sager noll lar ogat att ingenting hander pa den platsen — samma skal som gor
  // att chipsen ar farre i framtidsflikarna i `Flikar.tsx`.
  return [...per.entries()]
    .filter(([etikett, varde]) => varde !== 0 || etikett === "Grundprovision")
    .sort((a, b) => SLAGSORDNING.indexOf(a[0]) - SLAGSORDNING.indexOf(b[0]))
    .map(([etikett, varde]) => ({ etikett, varde }));
}

/**
 * Ordernas lage i perioden.
 *
 * MAKULERADE RAKNAS PA SIN MAKULERINGSMANAD, inte pa sin signeringsmanad. Det
 * ar samma tvahandelsemodell som `makuleradeIPeriod` i `order.ts` bygger pa:
 * ordern gav provision nar den tecknades och drar tillbaka den nar den
 * makuleras, och de tva bokfors i olika manader med flit.
 *
 * Beloppet ar darfor NEGATIVT pa den raden. Ett positivt tal med en flagga hade
 * krävt att lasaren gjorde subtraktionen sjalv.
 */
function orderlagen(order: Orderrad[], manader: string[]) {
  const i = new Set(manader);
  const signerade = order.filter((o) => i.has(o.period_month) && o.status === "signerad");
  const betalda = order.filter((o) => i.has(o.period_month) && o.status === "betald");
  const makulerade = order.filter((o) => o.cancel_period_month && i.has(o.cancel_period_month));

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
 * Raderna chefens lagtavla ritar, summerade over periodens manader.
 *
 * ===========================================================================
 * KRETSEN AR SALJARE PLUS ALLA SOM RORT SIG I PERIODEN.
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
  poster: Post[];
  mal: Saljmal[];
  /** Hela trappans historik — motorn slar sjalv upp varje manads rader. */
  nivaer: Bonusniva[];
  kvPerManad: Map<string, Map<string, KvIndata>>;
  godkanda: Awaited<ReturnType<typeof hamtaGodkandaFran>>;
  perioder: { period_month: string }[];
  manader: string[];
  idagsDatum: string;
  satser: Sats[];
  /** Overtacken. Bar in mottagaren i listan aven nar hen inte salt nagot. */
  chefsposter: Chefspost[];
}): Lagrad[] {
  const iPerioden = new Set(arg.manader);

  const medRorelse = new Set(
    arg.order
      .filter(
        (o) =>
          iPerioden.has(o.period_month) ||
          (o.cancel_period_month !== null && iPerioden.has(o.cancel_period_month)),
      )
      .map((o) => o.salesperson_id),
  );

  // MOTTAGAREN AV OVERTACKET MASTE OCKSA MED. Samma resonemang som i
  // `underlagForAlla`: en saljchef som inte tecknat en egen affar men fatt
  // overtack pa fem av sina saljares hade annars saknats helt i tavlan — trots
  // att hen ar den enda pa listan vars pengar INTE syns nagon annanstans.
  const medOvertack = new Set(
    arg.chefsposter
      .filter(
        (p) =>
          iPerioden.has(p.period_month) ||
          (p.makulerad && p.cancel_period_month !== null && iPerioden.has(p.cancel_period_month)),
      )
      .map((p) => p.manager_id),
  );

  const ids = new Set<string>([...arg.saljarIds, ...medRorelse, ...medOvertack]);
  const stangdaManader = new Set(arg.perioder.map((p) => p.period_month));

  // Konsekvenslagena slas upp EN gang per manad och ateranvands for alla
  // personer — `lagenPerPerson` laser hela listan varje anrop, och tolv manader
  // gangar tio personer hade blivit hundratjugo genomlasningar.
  const lagenPerManad = new Map(arg.manader.map((m) => [m, lagenPerPerson(arg.godkanda, m)]));

  return arg.personer
    .filter((p) => ids.has(p.id))
    .map((p) => {
      let antal = 0;
      let total = 0;
      let grundprovision = 0;
      let bonus = 0;
      let manaderMedNiva = 0;
      let sistaNiva: number | null = null;
      let malAntal = 0;
      let malUtfall = 0;
      let ordervarde = 0;
      let utanVarde = 0;

      for (const m of arg.manader) {
        const u = raknaUnderlag(
          p.id,
          arg.order,
          m,
          arg.nivaer,
          arg.kvPerManad.get(m)?.get(p.id) ?? null,
          lagenPerManad.get(m)?.get(p.id) ?? null,
          arg.chefsposter,
        );

        const bokfort = summera(
          arg.poster.filter((x) => x.employee_id === p.id),
          m,
        ).belopp;

        antal += u.antal.netto;
        total += bokfort + (stangdaManader.has(m) ? 0 : u.summa);
        grundprovision += u.grundprovision;
        bonus += (u.volymbonus?.belopp ?? 0) + (u.kv?.belopp ?? 0);
        if (u.volymbonus) manaderMedNiva++;
        sistaNiva = u.volymbonus?.niva.threshold ?? null;
        ordervarde += u.ordervarde.netto;
        utanVarde += u.ordervarde.utanVarde;

        const detMalet = malFor(arg.mal, p.id, m);
        if (detMalet?.mal_order != null) {
          malAntal += detMalet.mal_order;
          malUtfall += u.antal.netto;
        }
      }

      const takt = taktaOverManader(arg.manader, arg.idagsDatum, {
        antal,
        grundprovision,
        bonus,
      });

      return {
        employee_id: p.id,
        namn: p.namn,
        idag: saltEnDag(
          arg.order.filter((o) => o.salesperson_id === p.id),
          arg.idagsDatum,
          arg.satser,
        ).antal,
        antal,
        // EN MANAD har en niva; ETT AR har tolv, och ingen av dem ar "arets".
        // Texten valjs har och inte i komponenten — se rubriken i `Lagtavla.tsx`.
        bonusetikett:
          arg.manader.length === 1
            ? sistaNiva === null
              ? null
              : `Nivå ${sistaNiva}`
            : manaderMedNiva === 0
              ? null
              : `${manaderMedNiva} mån med bonus`,
        takt,
        mal: malAntal > 0 ? motMal(malAntal, malUtfall, takt) : null,
        total,
        ordervarde,
        utanVarde,
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
