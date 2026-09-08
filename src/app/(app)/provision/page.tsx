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
import { dagsserie, malFor, motMal, saltEnDag, takta, type Saljmal } from "@/lib/saljtakt";
import type { Konsekvenslage } from "@/lib/konsekvens";
import type { Sats } from "@/lib/order";
import { svensktDatum } from "@/lib/klocka";
import { Inmatning } from "./Inmatning";
import { Faststall, Utbetald } from "./Period";
import {
  Bonustrappa,
  Dagskort,
  Dagsstaplar,
  Lagesrad,
  Malkort,
  Manadspanel,
  Taktkort,
} from "./Resultattavla";
import { Lagtavla, type Lagrad } from "./Lagtavla";
import { GuideVard } from "@/components/guide/GuideVard";

export const dynamic = "force-dynamic";

/**
 * E13. Provisionsvyn — ombyggd 2026-09-07 till en resultattavla.
 *
 * ===========================================================================
 * TVA SANNINGAR OM SAMMA MANAD, OCH DET AR AVSIKTLIGT.
 *
 * En OPPEN manad raknas LIVE ur orderna av motorn. Den maste det: order elva
 * hojer bonusen pa order ett till tio, sa varje ny order andrar hela manadens
 * siffra. En bokford summa hade visat fel tal hela manaden.
 *
 * En STANGD manad ar BOKFORD i `commission_entry` och raknas aldrig om. Den
 * maste det: annars andrar en bonusniva som satts i november vad nagon fick
 * betalt i augusti.
 *
 * Sidan far alltsa aldrig addera de tva for samma manad. Se `minStangd`.
 * ===========================================================================
 *
 * ---------------------------------------------------------------------------
 * ORDNINGEN PA SIDAN AR SVARET PA EN INVANDNING.
 *
 * Bestallaren 2026-09-07: *"just nu kanns provisions vyn helt meningslos, jag
 * vet inte ens vad jag ska anvanda den till."* Talen var ratt — motorn hade
 * raknat dem korrekt sedan augusti — men vyn var ordnad som en HUVUDBOK, och
 * en huvudbok laser man en gang i manaden nar nagon undrar over en utbetalning.
 *
 * Sidan svarar nu i den ordning en saljare fragar:
 *
 *   1. Manadspanelen — vad har jag tjanat, och hur langt till nasta bonus
 *   2. I dag / Takt / Mal — hur gar det just nu
 *   3. Dagarna, orderlagena, raderna — varfor blev det sa
 *   4. Historik, perioder, bokforing — huvudboken, for den som behover den
 *
 * Vad som byggdes bort: kortet "Var siffran kommer ifran" (texten star nu i
 * panelen och i guiden) och listan "Alla, <manad>" (ersatt av lagtavlan, som
 * svarar pa samma fraga med tal som betyder nagot).
 * ---------------------------------------------------------------------------
 *
 * Handinmatningen ar kvar vid sidan av motorn. Den bar det motorn inte kan
 * rakna ut: ovrig bonus over trappans slut (avsnitt 5.3) och rattelser. Den dag
 * Inkio kopplas in (A5) kommer de posterna i samma tabell med source = 'inkio'.
 */
export default async function Provisionssida() {
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
  const ettArBak = manadFore(idag, 11);
  const treManader = manadFore(idag, 2);

  // Trappan och perioderna hamtas for ALLA, inte bara for chefer. Bada
  // tabellerna ar oppna i RLS med flit (0035): en progressvy som sager "3 order
  // kvar till nasta niva" utan att personen far se vad nivan ar vard ar en
  // sifferlek, och "manaden ar stangd" ar svaret pa "varfor andrar sig inte min
  // siffra langre". Samma sak med `sales_target` i 0049 — ett mal man inte far
  // se ar ingen styrning, det ar en fallucka.
  //
  // K13 / D-K13: provision och tid far sta pa samma SIDA, men ingen FRAGA
  // joinar tabellerna. Handelserna hamtas for sig och laggs bredvid — de moter
  // aldrig en order i en och samma fraga. Rastavvikelser och sen ankomst nar
  // fortfarande inte hit alls; det ar ett lofte i K12 avsnitt 5.
  //
  // ALLT I EN VAG. De sex hamtningar den har ombyggnaden lade till beror inte
  // pa nagot ovanfor, och ett `await` pa egen rad hade lagt sex sekventiella
  // vagor pa en sida vars vagantal ar det som vaxer nar navet vaxer. Se
  // X3-resonemanget i arbetsloggen 2026-08-22.
  const [
    mina,
    alla,
    personer,
    saljarIds,
    order,
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
    provisionschef ? hamtaOrder(treManader) : Promise.resolve([] as Orderrad[]),
    hamtaOrderFor(user.employee.id, treManader),
    hamtaSatser(),
    hamtaNivaer(),
    hamtaPerioder(treManader),
    hamtaMinaHandelser(user.employee.id),
    hamtaRegler(),
    provisionschef
      ? hamtaGodkandaFran(treManader)
      : Promise.resolve([] as Awaited<ReturnType<typeof hamtaGodkandaFran>>),
    // LASER MED ANVANDARENS EGEN TOKEN, sa saljaren far bara sin egen rad och
    // chefen far allas. Samma anrop tjanar bada vyerna.
    hamtaKvPerPerson(idag),
    hamtaMal(treManader),
  ]);

  const trappan = gallandeNivaer(nivaer, idag);

  // ===========================================================================
  // SALJARENS EGEN MANAD
  //
  // K&V-BONUSEN AR MED SEDAN 2026-09-07, och det ar en omprovning av avsnitt
  // 9.1. Specifikationen sa att den skulle ligga pa /kv och inte har; bestallaren
  // svarade "saljaren ska kunna se sin vanliga provision och sin bonus och det
  // totala", och en total utan en av bonusarna ar inte en total.
  //
  // Det ratade samtidigt en tyst avvikelse: `stangning.ts` har ALLTID bokfort
  // K&V-bonusen, medan vyn raknade utan den. Talet i vyn var alltsa lagre an det
  // som bokfordes, och skillnaden syntes forst efter attesten.
  // ===========================================================================
  const minStangd = perioder.find((p) => p.period_month === idag) ?? null;
  const mittLage = konsekvenslageFor(minaHandelser, idag);
  const mittUnderlag = raknaUnderlag(
    user.employee.id,
    minaOrder,
    idag,
    nivaer,
    kvPerPerson.get(user.employee.id) ?? null,
    mittLage,
  );

  const minaManader = manader(mina);
  const bokfortIManad = summera(mina, idag);
  const minTotal = bokfortIManad.belopp + (minStangd ? 0 : mittUnderlag.summa);

  const minVarning = varningslage(minaHandelser, regler, idagsDatum);

  const takt = takta(mittUnderlag, trappan, idag, idagsDatum);
  const dag = saltEnDag(minaOrder, idagsDatum, satser);
  const serie = dagsserie(minaOrder, idag);

  // ===========================================================================
  // MALET: ORDER I FORSTA HAND, KRONOR NAR BARA DET AR SATT.
  //
  // Ordermalet ar det som hor ihop med volymtrappan — trappan slar pa ANTAL —
  // sa den som har bada satta far bagen mot ordermalet och kronmalet i texten.
  // Tva bagar bredvid varandra hade tvingat fram en tolkning ("vilken raknas?")
  // som ingen bett om.
  // ===========================================================================
  const mittMal = malFor(mal, user.employee.id, idag);
  const malOrder =
    mittMal?.mal_order != null ? motMal(mittMal.mal_order, mittUnderlag.antal.netto, takt) : null;
  const malKronor = mittMal?.mal_kronor != null ? motMal(mittMal.mal_kronor, minTotal, takt) : null;

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
            <ButtonLink href={`/provision/underlag/${idag}`} size="sm" variant="sekundar">
              Underlag
            </ButtonLink>
          )}
        </div>
      </div>

      {/* VARNINGEN LIGGER FORE PANELEN NAR DEN FINNS.
          En bonusforlust andrar vad panelens tal BETYDER — den som ser 12 000 kr
          utan att veta att volymbonusen fallit laser talet som en normal manad.
          Beskedet maste darfor komma fore siffran, inte under den. */}
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
        manad={idag}
        total={minTotal}
        delar={
          minStangd
            ? delarUrHuvudboken(mina, idag)
            : delarUrMotorn(mittUnderlag, summera(handposter(mina), idag).belopp)
        }
        stangd={minStangd !== null}
        utbetald={minStangd?.status === "utbetald"}
        // TRAPPAN RITAS INTE FOR EN STANGD MANAD. Banan raknas ur dagens trappa,
        // och en trappa som andrats sedan dess hade ritat en annan vag an den
        // som faktiskt gav pengarna. En stangd manad svarar huvudboken pa.
        trappa={
          !minStangd && trappan.length > 0 ? (
            <Bonustrappa underlag={mittUnderlag} nivaer={trappan} />
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Dagskort dag={dag} datum={idagsDatum} />
        <Taktkort takt={takt} />
        <Malkort
          mal={malOrder ?? malKronor}
          takt={takt}
          enhet={malOrder ? "order" : "kronor"}
          farSattaMal={malchef}
        />
      </div>

      {/* Bada malen ar satta: det som inte fick bagen star i klartext. */}
      {malOrder && malKronor && (
        <Notis ton={malKronor.lage === "efter" ? "warn" : "info"}>
          Ditt kronmål är {kronor(malKronor.mal)} och du står på {kronor(malKronor.nu)} —{" "}
          {Math.round(malKronor.andel * 100)} %, {LAGESORD[malKronor.lage]} takten.
        </Notis>
      )}

      {serie.length > 0 && <Dagsstaplar serie={serie} idag={idagsDatum} manad={idag} />}

      <Lagesrad lagen={orderlagen(minaOrder, idag)} />

      <Card guide="provision.varifran">
        <CardHeader
          titel="Rad för rad"
          beskrivning="Varje post som bygger månadens siffra. Motorn returnerar raderna, vyn räknar aldrig om något själv."
        />
        {mittUnderlag.rader.length === 0 && bokfortIManad.poster === 0 ? (
          <EmptyState
            rubrik="Ingen post den här månaden än"
            text="Raderna kommer ur dina order. Den första godkända ordern dyker upp här samma sekund."
            handling={<ButtonLink href="/order">Lägg en order</ButtonLink>}
          />
        ) : (
          <ul className="flex flex-col">
            {mittUnderlag.rader.map((r, i) => (
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
            {handposter(mina)
              .filter((p) => p.period_month === idag)
              .map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-4 border-b border-canvas py-2 last:border-0"
                >
                  <span className="flex-1 text-small text-ink-700">
                    {p.note ?? "Bokförd post"}
                  </span>
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
          Grundprovisionen kommer ur dina order och paketmatrisen — beloppet fryses på ordern när
          den godkänns, så en sats som ändras i november ändrar inte vad du tjänade i augusti.
          Stämmer något inte:{" "}
          <Link href="/arenden" className="underline">
            lägg ett ärende
          </Link>{" "}
          i stället för att fråga i förbifarten. Då finns frågan kvar, och svaret också.
        </p>
      </Card>

      <Card>
        <CardHeader titel="Din historik" beskrivning="Tolv månader bakåt, senaste först." />
        {minaManader.length === 0 ? (
          <EmptyState
            rubrik="Ingen provision är bokförd på dig"
            text="Månaden bokförs när perioden fastställs. Innan dess räknas den live här ovanför."
          />
        ) : (
          <ul className="flex flex-col">
            {minaManader.map((m) => (
              <li
                key={m.manad}
                className="flex items-center gap-4 border-b border-canvas py-3 last:border-0"
              >
                <span className="flex-1 text-body text-ink-900">{manadsnamn(m.manad)}</span>
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
          rader={lagrader({
            personer,
            saljarIds,
            order,
            alla,
            mal,
            nivaer,
            trappan,
            kvPerPerson,
            lagen: lagenPerPerson(godkanda, idag),
            manad: idag,
            idagsDatum,
            satser,
            stangd: minStangd !== null,
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
                const manad = manadFore(idag, i);
                // LIVE-SUMMAN MASTE RAKNAS SOM ATTESTEN RAKNAR. Chefen laser
                // talet, trycker "Faststall", och far en bokforing som ska bli
                // samma siffra.
                //
                // K&V-BONUSEN LADES TILL 2026-09-07. Den saknades har medan
                // `stangning.ts` alltid bokfort den, sa vyn visade ett LAGRE
                // belopp an det som bokfordes — precis den avvikelse den har
                // kommentaren skrevs for att forhindra. Konsekvenserna fanns
                // med sedan tidigare; K&V-fallet var forbisett.
                //
                // `kvPerPerson` galler bara innevarande manad. For de tva
                // foregaende skickas ingen K&V-indata — de manaderna ar i
                // praktiken alltid stangda, och en stangd manad laser sin
                // summa ur huvudboken anda.
                const live = underlagForAlla(
                  order,
                  manad,
                  nivaer,
                  manad === idag ? kvPerPerson : undefined,
                  lagenPerPerson(godkanda, manad),
                );
                return {
                  manad,
                  stangd: perioder.find((p) => p.period_month === manad) ?? null,
                  antalPersoner: live.length,
                  liveSumma: live.reduce((s, u) => s + u.summa, 0),
                  bokfort: summera(alla, manad).belopp,
                  garAttStanga: sistaDagen(manad) <= idagsDatum,
                };
              })
              .map((p) => (
                <li
                  key={p.manad}
                  className="flex flex-wrap items-center gap-3 border-b border-canvas py-3 last:border-0"
                >
                  <span className="w-36 text-body text-ink-900">{manadsnamn(p.manad)}</span>

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
            manader={Array.from({ length: 12 }, (_, i) => {
              const nyckel = manadFore(idag, i);
              return { nyckel, etikett: manadsnamn(nyckel) };
            })}
          />
        </Card>
      )}
    </div>
  );
}

const LAGESORD = { fore: "före", i_takt: "i takt med", efter: "efter" } as const;

// -----------------------------------------------------------------------------
// Nedbrytningen i panelen
// -----------------------------------------------------------------------------

/** Handinmatade poster. Motorns egna kanns igen pa `source`. */
function handposter(poster: Post[]): Post[] {
  return poster.filter((p) => p.source !== "motor");
}

/**
 * En OPPEN manad bryts ned ur motorns underlag.
 *
 * Villkoren ar `!== null` och inte `> 0`: en rad som alltid star dar och alltid
 * sager noll lar ogat att ingenting hander pa den platsen. Samma skal som gor
 * att chipsen ar farre i framtidsflikarna i `Flikar.tsx`.
 */
function delarUrMotorn(u: Underlag, handbokfort: number): { etikett: string; varde: number }[] {
  return [
    { etikett: "Grundprovision", varde: u.grundprovision, visa: true },
    { etikett: "Volymbonus", varde: u.volymbonus?.belopp ?? 0, visa: u.volymbonus !== null },
    { etikett: "K&V-bonus", varde: u.kv?.belopp ?? 0, visa: u.kv !== null },
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

  // Ordningen foljer SLAGSETIKETT sa att grundprovisionen alltid star forst.
  // En Map behaller insattningsordningen, och den ar bokforingsordningen — inte
  // en ordning nagon valt.
  const ordning = [...Object.values(SLAGSETIKETT), "Bokfört för hand"];
  return [...per.entries()]
    .sort((a, b) => ordning.indexOf(a[0]) - ordning.indexOf(b[0]))
    .map(([etikett, varde]) => ({ etikett, varde }));
}

/**
 * Ordernas lage den har manaden.
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
    {
      etikett: "Godkänd",
      antal: signerade.length,
      kronor: summa(signerade),
      ton: "info" as const,
    },
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
 * vilket ar precis den rad en chef behover se mitt i en manad. Bada mangderna
 * behovs, och unionen ar svaret.
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

      const takt = takta(underlag, arg.trappan, arg.manad, arg.idagsDatum);
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
        // Ordermalet i forsta hand, av samma skal som i saljarens egen vy:
        // trappan slar pa antal, sa det ar det malet som hor ihop med bonusen.
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
 * Namnen kommer fran `hamtaPersoner` i stallet, och de tva satts ihop pa id.
 *
 * Ger fragan noll rader — RLS pa `employee_role` slapper inte in alla — bygger
 * lagtavlan anda sin lista ur dem som rort sig i manaden. Kretsen blir smalare,
 * inte tom.
 */
async function hamtaSaljarIds(): Promise<Set<string>> {
  const rls = await supabaseServer();
  const { data } = await rls.from("employee_role").select("employee_id").eq("role", "salesperson");

  return new Set((data ?? []).map((r) => String(r.employee_id)));
}
