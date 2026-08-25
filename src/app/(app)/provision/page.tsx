import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
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
import { hamtaOrder } from "@/lib/order-server";
import { hamtaNivaer, hamtaPerioder, type Period } from "@/lib/bonus-server";
import { underlagForAlla, type Bonusniva } from "@/lib/provision-motor";
import type { Orderrad } from "@/lib/order-server";
import { svensktDatum } from "@/lib/klocka";
import { Inmatning } from "./Inmatning";
import { Faststall, Utbetald } from "./Period";

export const dynamic = "force-dynamic";

/**
 * E13, forsta skivan. Vyn visar INTJANAD provision — inte utbetald, och inte
 * berakning.
 *
 * Skillnaden ar hela poangen: navet tar emot ett tal som nagon annan bestamt,
 * summerar det och visar det for den det galler. Den dag Inkio kopplas in (A5)
 * byts inmatningen mot import och den har sidan behover inte roras — posterna
 * kommer i samma tabell med source = 'inkio'.
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

  const [mina, alla, personer, order, nivaer, perioder] = await Promise.all([
    hamtaProvision(user.employee.id, ettArBak),
    provisionschef ? hamtaAllProvision(ettArBak) : Promise.resolve([] as Post[]),
    provisionschef ? hamtaPersoner() : Promise.resolve([] as { id: string; namn: string }[]),
    provisionschef ? hamtaOrder(manadFore(idag, 2)) : Promise.resolve([] as Orderrad[]),
    provisionschef ? hamtaNivaer() : Promise.resolve([] as Bonusniva[]),
    provisionschef ? hamtaPerioder(manadFore(idag, 2)) : Promise.resolve([] as Period[]),
  ]);

  const min = sammanfatta(mina, new Date());
  const minaManader = manader(mina);

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
            beskrivning="Summan av posterna som bokförts på dig."
          />
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-4">
            <div>
              <p className="tnum text-display text-ink-900">{kronor(min.denna.belopp)}</p>
              <p className="text-small text-ink-500">
                {min.denna.affarer === null
                  ? `${min.denna.poster} ${min.denna.poster === 1 ? "post" : "poster"}`
                  : `${min.denna.affarer} ${min.denna.affarer === 1 ? "affär" : "affärer"}`}
              </p>
            </div>
            <Nyckeltal etikett={`Förra månaden`} varde={kronor(min.forra.belopp)} />
            <Nyckeltal etikett="Hittills i år" varde={kronor(min.iAr)} />
          </div>
        </Card>

        <Card>
          <CardHeader titel="Var siffran kommer ifrån" />
          <p className="text-small text-ink-700">
            Posterna matas in för hand av ekonomi och VD så länge Inkio inte är inkopplat. En post
            skrivs aldrig om — en rättelse bokförs som en egen, negativ post, och båda står kvar i
            listan nedan.
          </p>
          <p className="mt-3 text-small text-ink-500">
            Stämmer inte siffran: lägg ett ärende i stället för att fråga i förbifarten. Då finns
            frågan kvar, och svaret också.
          </p>
        </Card>
      </div>

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
