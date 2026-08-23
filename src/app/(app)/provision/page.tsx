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
import { Inmatning } from "./Inmatning";

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
  const idag = manadsnyckel();
  const ettArBak = manadFore(idag, 11);

  const [mina, alla, personer] = await Promise.all([
    hamtaProvision(user.employee.id, ettArBak),
    bokforare ? hamtaAllProvision(ettArBak) : Promise.resolve([] as Post[]),
    bokforare ? hamtaPersoner() : Promise.resolve([] as { id: string; namn: string }[]),
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

      {bokforare && (
        <>
          <Card>
            <CardHeader
              titel="Bokför provision"
              beskrivning="Ekonomi och VD. Varje post loggas med belopp och person."
            />
            <Inmatning personer={personer} manader={manadsval} />
          </Card>

          <Card>
            <CardHeader
              titel={`Alla, ${manadsnamn(idag)}`}
              beskrivning="Summan per person för innevarande månad."
            />
            <Alla poster={alla} manad={idag} personer={personer} />
          </Card>
        </>
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
