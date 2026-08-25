import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
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
  sammanfatta,
  summera,
} from "@/lib/provision";
import { hamtaOrder, hamtaOrderFor } from "@/lib/order-server";
import { hamtaNivaer, hamtaPerioder } from "@/lib/bonus-server";
import {
  prognosNastaNiva,
  raknaUnderlag,
  underlagForAlla,
  type Prognos,
  type Underlag,
} from "@/lib/provision-motor";
import type { Orderrad } from "@/lib/order-server";
import { svensktDatum } from "@/lib/klocka";
import { Inmatning } from "./Inmatning";
import { Faststall, Utbetald } from "./Period";

export const dynamic = "force-dynamic";

/**
 * E13. Vyn visar INTJANAD provision — inte utbetald.
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

  const idag = manadsnyckel();
  const ettArBak = manadFore(idag, 11);

  // Trappan och perioderna hamtas for ALLA, inte bara for chefer. Bada
  // tabellerna ar oppna i RLS med flit (0035): en progressvy som sager "3 order
  // kvar till nasta niva" utan att personen far se vad nivan ar vard ar en
  // sifferlek, och "manaden ar stangd" ar svaret pa "varfor andrar sig inte min
  // siffra langre".
  const [mina, alla, personer, order, minaOrder, nivaer, perioder] = await Promise.all([
    hamtaProvision(user.employee.id, ettArBak),
    provisionschef ? hamtaAllProvision(ettArBak) : Promise.resolve([] as Post[]),
    provisionschef ? hamtaPersoner() : Promise.resolve([] as { id: string; namn: string }[]),
    provisionschef ? hamtaOrder(manadFore(idag, 2)) : Promise.resolve([] as Orderrad[]),
    hamtaOrderFor(user.employee.id, manadFore(idag, 2)),
    hamtaNivaer(),
    hamtaPerioder(manadFore(idag, 2)),
  ]);

  const min = sammanfatta(mina, new Date());
  const minaManader = manader(mina);

  // ===========================================================================
  // SALJARENS EGEN MANAD (steg 4)
  //
  // En OPPEN manad raknas live ur orderna, en STANGD ar bokford. Skillnaden
  // syns har: for en oppen manad laggs motorns summa till de poster som redan
  // finns i huvudboken, for en stangd gors det inte — da har attesten redan
  // bokfort motorns rader, och att addera dem igen hade dubbelraknat manaden.
  // ===========================================================================
  const minStangd = perioder.some((p) => p.period_month === idag);
  const mittUnderlag = raknaUnderlag(user.employee.id, minaOrder, idag, nivaer);
  const minPrognos = prognosNastaNiva(mittUnderlag);
  const minTotal = min.denna.belopp + (minStangd ? 0 : mittUnderlag.summa);

  // Tolv manader bakat, nyast forst. Framtida manader finns inte i listan alls
  // — de nekas ocksa av `giltigManad` i actionen, men ett val som inte gar att
  // gora ar battre an ett felmeddelande efterat.
  const manadsval = Array.from({ length: 12 }, (_, i) => {
    const nyckel = manadFore(idag, i);
    return { nyckel, etikett: manadsnamn(nyckel) };
  });

  // Tre manader: den som pagar och de tva fore. En manad UTAN rad i
  // `commission_period` ar oppen och raknas live ur orderna; en manad MED rad ar
  // bokford och raknas aldrig om. Se `stangning.ts`.
  const idagsDatum = svensktDatum(new Date());
  const perioderVisas = [0, 1, 2].map((i) => {
    const manad = manadFore(idag, i);
    const live = underlagForAlla(order, manad, nivaer);
    return {
      manad,
      stangd: perioder.find((p) => p.period_month === manad) ?? null,
      antalPersoner: live.length,
      liveSumma: live.reduce((s, u) => s + u.summa, 0),
      bokfort: summera(alla, manad).belopp,
      garAttStanga: sistaDagen(manad) <= idagsDatum,
    };
  });

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <h1 className="text-display text-ink-900">Provision</h1>
        <p className="mt-1 text-body text-ink-500">
          Intjänat, inte utbetalt. Lönen betalas som vanligt av lönesystemet.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card status="brand" className="lg:col-span-2">
          <CardHeader
            titel={`Din provision i ${manadsnamn(min.denna.manad)}`}
            beskrivning="Dina order plus det som bokförts på dig för hand."
          />
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-4">
            <div>
              <p className="tnum text-display text-ink-900">{kronor(minTotal)}</p>
              <p className="text-small text-ink-500">
                {mittUnderlag.antal.netto} {mittUnderlag.antal.netto === 1 ? "order" : "order"}
                {min.denna.poster > 0 &&
                  ` + ${min.denna.poster} ${min.denna.poster === 1 ? "bokförd post" : "bokförda poster"}`}
              </p>
            </div>
            <Nyckeltal etikett={`Förra månaden`} varde={kronor(min.forra.belopp)} />
            <Nyckeltal etikett="Hittills i år" varde={kronor(min.iAr)} />
          </div>
          <p className="mt-4 text-small text-ink-500">
            {minStangd
              ? "Månaden är fastställd. Siffran är bokförd och ändras inte längre."
              : "Månaden är öppen och räknas live ur dina order. Siffran ändras med varje ny order tills den fastställs."}
          </p>
        </Card>

        <Card>
          <CardHeader titel="Var siffran kommer ifrån" />
          <p className="text-small text-ink-700">
            Grundprovisionen kommer ur dina <strong>order</strong> och paketmatrisen. Volymbonusen
            räknas på hela månadens ordervolym. Utöver det kan ekonomi och VD bokföra poster för
            hand — en post skrivs aldrig om, en rättelse bokförs som en egen negativ post.
          </p>
          <p className="mt-3 text-small text-ink-500">
            Stämmer inte siffran: lägg ett ärende i stället för att fråga i förbifarten. Då finns
            frågan kvar, och svaret också.
          </p>
        </Card>
      </div>

      {(mittUnderlag.rader.length > 0 || mittUnderlag.nasta) && (
        <Card>
          <CardHeader
            titel="Din väg till nästa bonus"
            beskrivning="Bonusnivån bestäms av hela månadens ordervolym, och gäller samtliga order i månaden — inte bara de över tröskeln."
          />
          <Progress underlag={mittUnderlag} prognos={minPrognos} />
        </Card>
      )}

      <Card>
        <CardHeader titel="Din historik" beskrivning="Tolv månader bakåt, senaste först." />
        {minaManader.length === 0 ? (
          <EmptyState
            rubrik="Ingen provision är bokförd på dig"
            text="När ekonomi bokför den första posten dyker den upp här och på startsidan."
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
        <Card>
          <CardHeader
            titel="Provisionsperioder"
            beskrivning="En öppen månad räknas live ur orderna och ändrar sig med varje ny order. En fastställd månad är bokförd och räknas aldrig om — inte ens om trappan ändras efteråt."
          />
          <ul className="flex flex-col">
            {perioderVisas.map((p) => (
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
                    {p.antalPersoner} {p.antalPersoner === 1 ? "säljare" : "säljare"}, räknat live
                  </span>
                )}

                {!p.stangd && p.garAttStanga && <Faststall manad={p.manad} />}
                {p.stangd?.status === "faststalld" && bokforare && <Utbetald manad={p.manad} />}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-small text-ink-500">
            En period kan fastställas tidigast på månadens sista dag. Volymtrappan sätts under{" "}
            <Link href="/provision/regler" className="underline">
              Volymtrappan
            </Link>
            .
          </p>
        </Card>
      )}

      {provisionschef && (
        <Card>
          <CardHeader
            titel={`Alla, ${manadsnamn(idag)}`}
            beskrivning="Summan per person för innevarande månad."
          />
          <Alla poster={alla} manad={idag} personer={personer} />
        </Card>
      )}

      {bokforare && (
        <Card>
          <CardHeader
            titel="Bokför provision"
            beskrivning="Ekonomi och VD. Varje post loggas med belopp och person."
          />
          <Inmatning personer={personer} manader={manadsval} />
        </Card>
      )}
    </div>
  );
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

/**
 * Saljarens progressvy (avsnitt 9.1).
 *
 * TVA SAKER STAR MEDVETET INTE HAR.
 *
 * K&V-bonusen — den ligger pa K&V-sidan (steg 5), for att den bedoms av en
 * manniska och hor ihop med bedomningen, inte med ordervolymen.
 *
 * Och hela berakningskedjan. Saljaren far underlaget i en ENKLARE version an
 * chefens (fraga 54): vilka order, vilken niva, vilka avdrag — men inte varje
 * mellanled. Chefens fulla rad-for-rad-vy ar en annan vy.
 */
function Progress({ underlag, prognos }: { underlag: Underlag; prognos: Prognos | null }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-4">
        <div>
          <p className="tnum text-h1 text-ink-900">{underlag.antal.netto}</p>
          <p className="text-small text-ink-500">
            order{underlag.antal.makulerade > 0 && `, varav ${underlag.antal.makulerade} makulerad`}
          </p>
        </div>
        <div>
          <p className="tnum text-h1 text-ink-900">
            {underlag.volymbonus ? `Nivå ${underlag.volymbonus.niva.threshold}` : "—"}
          </p>
          <p className="text-small text-ink-500">
            {underlag.volymbonus ? kronor(underlag.volymbonus.belopp) : "ingen nivå nådd än"}
          </p>
        </div>
        <Nyckeltal etikett="grundprovision" varde={kronor(underlag.grundprovision)} />
      </div>

      {underlag.nasta ? (
        <Notis ton="info">
          Du har {underlag.antal.netto} {underlag.antal.netto === 1 ? "order" : "order"}.{" "}
          <strong>
            {underlag.nasta.kvar} {underlag.nasta.kvar === 1 ? "order" : "order"} kvar
          </strong>{" "}
          till nivå {underlag.nasta.niva.threshold}.
          {prognos && (
            <>
              {" "}
              Då blir bonusen {kronor(prognos.bonusDa)} och totalen {kronor(prognos.totaltDa)} —{" "}
              <em>vid samma snitt som hittills, {kronor(prognos.snittPerOrder)} per order.</em>
            </>
          )}
        </Notis>
      ) : (
        underlag.volymbonus && (
          <Notis ton="ok">
            Du är på trappans högsta nivå. Utöver den kan din chef bokföra en övrig bonus för hand.
          </Notis>
        )
      )}

      {underlag.rader.length > 0 && (
        <ul className="flex flex-col">
          {underlag.rader.map((r, i) => (
            <li
              key={r.order_id ?? `${r.slag}-${i}`}
              className="flex items-center gap-4 border-b border-canvas py-2 last:border-0"
            >
              <span className="flex-1 text-small text-ink-700">{r.text}</span>
              <span className="tnum text-small font-semibold text-ink-900">{kronor(r.belopp)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Nyckeltal({ etikett, varde }: { etikett: string; varde: string }) {
  return (
    <div>
      <p className="tnum text-h1 text-ink-900">{varde}</p>
      <p className="text-small text-ink-500">{etikett}</p>
    </div>
  );
}

function Alla({
  poster,
  manad,
  personer,
}: {
  poster: Post[];
  manad: string;
  personer: { id: string; namn: string }[];
}) {
  const rader = personer
    .map((p) => ({
      namn: p.namn,
      summa: summera(
        poster.filter((x) => x.employee_id === p.id),
        manad,
      ),
    }))
    .filter((r) => r.summa.poster > 0)
    .sort((a, b) => b.summa.belopp - a.summa.belopp);

  if (rader.length === 0) {
    return (
      <EmptyState
        rubrik="Ingen post är bokförd den här månaden"
        text="Bokför den första posten i formuläret ovan."
      />
    );
  }

  const total = rader.reduce((s, r) => s + r.summa.belopp, 0);

  return (
    <>
      <ul className="flex flex-col">
        {rader.map((r) => (
          <li
            key={r.namn}
            className="flex items-center gap-4 border-b border-canvas py-3 last:border-0"
          >
            <span className="flex-1 text-body text-ink-900">{r.namn}</span>
            {r.summa.affarer !== null && (
              <span className="text-small text-ink-500">{r.summa.affarer} affärer</span>
            )}
            <span className="tnum text-body font-semibold text-ink-900">
              {kronor(r.summa.belopp)}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-baseline justify-between border-t border-canvas pt-4">
        <span className="text-small text-ink-500">Totalt</span>
        <span className="tnum text-h1 text-ink-900">{kronor(total)}</span>
      </div>
    </>
  );
}

/** Aktiva anstallda, for inmatningens lista. RLS avgor vilka som syns. */
async function hamtaPersoner(): Promise<{ id: string; namn: string }[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("employee")
    .select("id, first_name, last_name")
    .in("status", ["active", "onboarding"])
    .order("first_name");

  return (data ?? []).map((e) => ({ id: e.id, namn: fullName(e) }));
}
