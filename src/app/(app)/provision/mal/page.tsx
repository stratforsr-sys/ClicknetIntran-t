import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ButtonLink } from "@/components/ui/Button";
import { getCurrentUser, fullName, hasRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { kronor, manadFore, manadsnamn, manadsnyckel } from "@/lib/provision";
import { hamtaOrder } from "@/lib/order-server";
import { hamtaMal } from "@/lib/saljmal-server";
import { grundprovision, nettoAntal } from "@/lib/order";
import { malFor } from "@/lib/saljtakt";
import { Malrad } from "./Malformular";

export const dynamic = "force-dynamic";

/**
 * E13 steg 10: manadsmalen.
 *
 * ===========================================================================
 * SALJCHEF OCH VD. Ekonomi ser malen men satter dem inte.
 *
 * Samma grans som `far_andra_provisionsregler()` drar i 0035, och bestallarens
 * skal fran 2026-08-24 galler ordagrant har: *"den som satter malen ska inte
 * ocksa vara den som knappar in utfallet."*
 *
 * Kontrollen star bade har och i actionen. Den har GOMMER sidan; actionen ar
 * det som faktiskt hindrar skrivningen, for den sker med service role och gar
 * forbi RLS.
 * ===========================================================================
 *
 * INGET MAL FODS AV SIG SJALVT. Sidan arver ingenting fran manaden fore och
 * kopierar ingenting automatiskt — se rubriken i `malFor` i `saljtakt.ts`. Vad
 * som stod forra manaden visas DAREMOT bredvid, for det ar den upplysning som
 * gor det snabbt att satta samma sak igen utan att systemet gjorde det at
 * nagon.
 */
export default async function Malsida({
  searchParams,
}: {
  searchParams: Promise<{ manad?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user?.employee) return null;
  if (!hasRole(user, "sales_manager", "ceo")) notFound();

  const idag = manadsnyckel();
  const { manad: onskad } = await searchParams;

  // FYRA MANADER ATT VALJA PA: den som pagar och tre framat. Historiska manader
  // finns inte i listan alls — de nekas ocksa av actionen, men ett val som inte
  // gar att gora ar battre an ett felmeddelande efterat. Samma linje som
  // manadsvalet i bokforingsformularet, spegelvand.
  const val = [0, -1, -2, -3].map((i) => {
    const nyckel = manadFore(idag, i);
    return { nyckel, etikett: manadsnamn(nyckel) };
  });

  const manad = val.some((v) => v.nyckel === onskad) ? onskad! : idag;

  const [personer, saljarIds, mal, order] = await Promise.all([
    hamtaPersoner(),
    hamtaSaljarIds(),
    // Fran manaden FORE DAGENS, inte fore den valda: jamforelsekortet langst ned
    // stallar alltid mot den senast avslutade manaden. Valjs en manad tre steg
    // framat ar "manaden fore" den ocksa i framtiden, och en jamforelse mot en
    // manad som inte hant ar en rad nollor som ser ut som ett resultat.
    hamtaMal(manadFore(idag, 1)),
    // Utfallet visas bredvid rutan. Ett mal satt utan att veta var personen
    // ligger ar en gissning, och en gissad ribba ar samma sorts tysta sanning
    // som en gissad bonus.
    hamtaOrder(manadFore(idag, 1)),
  ]);

  // Kretsen: de som har saljarrollen, plus var och en som redan har ett mal for
  // manaden. Den andra halvan behovs for att en person som byter roll annars
  // hade fatt ett mal som ingen langre kan andra eller ta bort.
  const medMal = new Set(mal.filter((m) => m.period_month === manad).map((m) => m.employee_id));
  const kretsen = personer.filter((p) => saljarIds.has(p.id) || medMal.has(p.id));

  const forraManaden = manadFore(idag, 1);

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <h1 className="text-display text-ink-900">Månadsmål</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Vad varje säljare ska nå den här månaden. Målet syns i säljarens egen provisionsvy som
          en båge mot takten, och det ändrar ingenting i vad som betalas ut — provisionen räknas
          ur{" "}
          <Link href="/provision/regler" className="underline">
            trappan
          </Link>{" "}
          oavsett.
        </p>
      </div>

      <Card>
        <CardHeader
          titel="Välj månad"
          beskrivning="Innevarande månad och tre framåt. En passerad månad går inte att sätta mål för — en ribba som flyttas efter utfallet är ingen ribba."
        />
        <div className="flex flex-wrap gap-2">
          {val.map((v) => (
            <ButtonLink
              key={v.nyckel}
              href={`/provision/mal?manad=${v.nyckel}`}
              size="sm"
              variant={v.nyckel === manad ? "primar" : "diskret"}
            >
              {v.etikett}
              {v.nyckel === idag ? " (nu)" : ""}
            </ButtonLink>
          ))}
        </div>
      </Card>

      <Card status="brand">
        <CardHeader
          titel={`Mål för ${manadsnamn(manad)}`}
          beskrivning="Fyll i antal order, kronor eller båda. Tomma rutor och Spara tar bort målet."
          handling={<Badge ton="brand">{medMal.size} av {kretsen.length} satta</Badge>}
        />

        {kretsen.length === 0 ? (
          <EmptyState
            rubrik="Ingen säljare att sätta mål för"
            text="Ingen aktiv anställd har säljarrollen. Roller sätts på personkortet under Personal."
            handling={<ButtonLink href="/personal">Till personal</ButtonLink>}
          />
        ) : (
          <ul className="flex flex-col">
            {kretsen.map((p) => {
              const nu = malFor(mal, p.id, manad);
              const deras = order.filter((o) => o.salesperson_id === p.id);

              return (
                <Malrad
                  key={p.id}
                  person={p}
                  manad={manad}
                  malOrder={nu?.mal_order ?? null}
                  malKronor={nu?.mal_kronor ?? null}
                  // UTFALLET GALLER DEN MANAD MALET GALLER, inte alltid dagens.
                  // Satts nasta manads mal ar utfallet noll, och det ar ratt
                  // svar — inte den har manadens tal under nasta manads ruta.
                  utfall={{
                    order: nettoAntal(deras, manad),
                    kronor: grundprovision(deras, manad),
                  }}
                />
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          titel={`Så såg ${manadsnamn(forraManaden)} ut`}
          beskrivning="Målen som gällde månaden före, med vad de landade på. Ingenting kopieras automatiskt — men det är det här man vill veta innan man sätter nästa."
        />
        {kretsen.length === 0 ? (
          <p className="text-small text-ink-500">Ingen säljare att visa.</p>
        ) : (
          <ul className="flex flex-col">
            {kretsen.map((p) => {
              const forra = malFor(mal, p.id, forraManaden);
              const deras = order.filter((o) => o.salesperson_id === p.id);
              const antal = nettoAntal(deras, forraManaden);
              const belopp = grundprovision(deras, forraManaden);

              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-canvas py-3 last:border-0"
                >
                  <span className="min-w-0 flex-1 basis-40 truncate text-body text-ink-900">
                    {p.namn}
                  </span>
                  <span className="tnum w-28 text-small text-ink-500">
                    {forra?.mal_order != null ? `Mål ${forra.mal_order} order` : "Inget mål"}
                  </span>
                  <span className="tnum w-24 text-small text-ink-900">{antal} order</span>
                  <span className="tnum w-28 text-right text-small text-ink-500">
                    {kronor(belopp)}
                  </span>
                  {forra?.mal_order != null && (
                    <Badge ton={antal >= forra.mal_order ? "ok" : "warn"}>
                      {antal >= forra.mal_order ? "Nådde målet" : "Nådde inte"}
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-4 max-w-[70ch] text-small text-ink-500">
          Kronorna här är <strong>grundprovision</strong> ur orderna, inte hela utbetalningen —
          volymbonus, K&amp;V-bonus och handbokförda poster tillkommer. Hela summan står i{" "}
          <Link href={`/provision/underlag/${forraManaden}`} className="underline">
            underlaget
          </Link>
          .
        </p>
      </Card>
    </div>
  );
}

/** Aktiva anstallda. RLS avgor vilka som syns. */
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
 * stallet for att ge rader — med `?? []` blir felet en tom lista och sidan
 * pastar att ingen ar saljare. Sex sadana fall rattades 2026-09-07. Namnen
 * kommer fran `hamtaPersoner`, och de tva satts ihop pa id.
 */
async function hamtaSaljarIds(): Promise<Set<string>> {
  const rls = await supabaseServer();
  const { data } = await rls.from("employee_role").select("employee_id").eq("role", "salesperson");

  return new Set((data ?? []).map((r) => String(r.employee_id)));
}
