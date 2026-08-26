import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { fullName, getCurrentUser, hasRole } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";
import { supabaseServer } from "@/lib/supabase/server";
import {
  hamtaKo,
  hamtaOrder,
  hamtaOrderbilagor,
  hamtaPaket,
  hamtaSatser,
  type Orderrad,
} from "@/lib/order-server";
import {
  LOPTIDER,
  STATUS_ETIKETT,
  grundprovision,
  nettoAntal,
  provisionFor,
  type Orderstatus,
  type Paket,
  type Sats,
} from "@/lib/order";
import { kronor, manadFore, manadsnamn, manadsnyckel } from "@/lib/provision";
import { Atgarder } from "./Atgarder";
import { Bilaga, type Orderbilaga } from "./Bilaga";
import { Nyorder } from "./Nyorder";

export const dynamic = "force-dynamic";

/**
 * E13 steg 1: kundorder.
 *
 * ORDER, INTE AVTAL. `/avtal` ar anstallningsavtal (E9.1) och har ingenting med
 * kundaffarer att gora.
 *
 * Sidan RAKNAR INGEN BONUS. Volymtrappan kommer i steg 3. Det som visas har ar
 * grunden den star pa: hur manga order manaden bar, och vad de ar varda enligt
 * den sats som gallde nar de signerades.
 */
export default async function Ordersida() {
  const user = await getCurrentUser();
  if (!user?.employee) return null;

  const hanterare = hasRole(user, "sales_manager", "ceo", "finance");

  // O13. Kretsen som far saga att en order ar BETALD ar smalare an den som
  // godkanner och makulerar: den som ser betalningen komma in ar den som far
  // saga att den kommit. Samma uppdelning som `markeraUtbetald` gor for
  // perioden. Statusen ror inga pengar — provisionen utgar fran signeringen.
  const bokforare = hasRole(user, "finance", "ceo");
  const idag = svensktDatum();
  const manad = manadsnyckel();
  const ettArBak = manadFore(manad, 11);

  const [order, ko, paket, satser, personer] = await Promise.all([
    hamtaOrder(ettArBak),
    hanterare ? hamtaKo() : Promise.resolve([] as Orderrad[]),
    hamtaPaket(),
    hamtaSatser(),
    hanterare ? hamtaSaljare() : Promise.resolve([] as { id: string; namn: string }[]),
  ]);

  const namn = new Map(personer.map((p) => [p.id, p.namn]));
  const mina = order.filter((o) => o.salesperson_id === user.employee!.id);
  const underlag = hanterare ? order : mina;

  // E13 steg 9. Bilagorna hamtas for de order som faktiskt visas, i EN fraga.
  // En fraga per orderrad hade blivit tjugo turer pa en sida som redan ligger
  // i den blockerande vagen.
  const bilagor = await hamtaOrderbilagor([...new Set([...underlag, ...ko].map((o) => o.id))]);

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <h1 className="text-display text-ink-900">Order</h1>
        <p className="mt-1 text-body text-ink-500">
          Kundorder och den provision de ger. Bonusen räknas inte här ännu.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card status="brand" className="lg:col-span-2">
          <CardHeader
            titel={`${hanterare ? "Bolaget" : "Du"} i ${manadsnamn(manad)}`}
            beskrivning="Godkända order minus det som makulerats den här månaden."
          />
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-4">
            <div>
              <p className="tnum text-display text-ink-900">{nettoAntal(underlag, manad)}</p>
              <p className="text-small text-ink-500">order</p>
            </div>
            <div>
              <p className="tnum text-h1 text-ink-900">{kronor(grundprovision(underlag, manad))}</p>
              <p className="text-small text-ink-500">grundprovision</p>
            </div>
          </div>
          <p className="mt-4 text-small text-ink-500">
            En makulerad order dras av i den månad den makulerades, inte i månaden den tecknades.
            Månader som redan är stängda skrivs aldrig om.
          </p>
        </Card>

        <Matris paket={paket} satser={satser} idag={idag} />
      </div>

      <Card>
        <CardHeader
          titel="Lägg en order"
          beskrivning={
            hanterare
              ? "Provisionen hämtas ur matrisen efter signeringsdatum."
              : "Ordern går till säljchefen för godkännande."
          }
        />
        <Nyorder paket={paket} personer={personer} hanterare={hanterare} idag={idag} />
      </Card>

      {hanterare && (
        <Card status={ko.length > 0 ? "warn" : undefined}>
          <CardHeader
            titel="Väntar på godkännande"
            beskrivning="Inskickade order räknas inte förrän de godkänts."
          />
          {ko.length === 0 ? (
            <EmptyState
              rubrik="Kön är tom"
              text="Allt som skickats in är avgjort. Nya order dyker upp här direkt."
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {ko.map((o) => (
                <Rad
                  key={o.id}
                  o={o}
                  namn={namn.get(o.salesperson_id)}
                  hanterare
                  bokforare={bokforare}
                  agare={o.salesperson_id === user.employee!.id}
                  paket={paket}
                  bilagor={bilagor.get(o.id) ?? []}
                />
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card>
        <CardHeader
          titel={hanterare ? "Alla order" : "Dina order"}
          beskrivning="Tolv månader bakåt, senast signerad först."
        />
        {underlag.length === 0 ? (
          <EmptyState
            rubrik="Ingen order är inlagd"
            text="Lägg den första i formuläret ovan. Den räknas från och med den månad den signerades."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {underlag.map((o) => (
              <Rad
                key={o.id}
                o={o}
                namn={namn.get(o.salesperson_id)}
                hanterare={hanterare}
                bokforare={bokforare}
                agare={o.salesperson_id === user.employee!.id}
                paket={paket}
                bilagor={bilagor.get(o.id) ?? []}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

const TON: Record<Orderstatus, "neutral" | "warn" | "ok" | "brand" | "danger"> = {
  utkast: "neutral",
  inskickad: "warn",
  signerad: "ok",
  betald: "brand",
  makulerad: "danger",
};

function Rad({
  o,
  namn,
  hanterare,
  bokforare,
  agare,
  paket,
  bilagor,
}: {
  o: Orderrad;
  namn?: string;
  hanterare: boolean;
  bokforare: boolean;
  agare: boolean;
  paket: Paket[];
  bilagor: Orderbilaga[];
}) {
  const paketnamn = paket.find((p) => p.id === o.package_id)?.label ?? `Paket ${o.package_id}`;

  return (
    <li className="flex flex-col gap-2 border-b border-canvas pb-3 last:border-0 last:pb-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-body font-semibold text-ink-900">{o.company_name}</span>
        <Badge ton={TON[o.status]}>{STATUS_ETIKETT[o.status]}</Badge>
        {o.is_addon && <Badge>Tillägg</Badge>}
        <span className="flex-1" />
        {o.commission_amount !== null && (
          <span className="tnum text-body font-semibold text-ink-900">
            {kronor(o.commission_amount)}
          </span>
        )}
      </div>

      <p className="text-small text-ink-500">
        {paketnamn} · {o.term_months} mån · signerad {o.signed_on}
        {namn && hanterare ? ` · ${namn}` : ""}
        {o.commission_source === "manual" ? " · provision satt för hand" : ""}
      </p>

      {o.status === "makulerad" && o.cancelled_on && (
        <p className="text-small text-danger-ink">
          Makulerad {o.cancelled_on}. Avdraget belastar {o.cancelled_on.slice(0, 7)}.
          {o.cancel_reason ? ` ${o.cancel_reason}` : ""}
        </p>
      )}

      {o.status !== "makulerad" && o.note && (
        <p className="text-small text-ink-500">{o.note}</p>
      )}

      <Atgarder
        id={o.id}
        status={o.status}
        hanterare={hanterare}
        bokforare={bokforare}
        agare={agare}
      />

      {/*
        E13 steg 9. Bilagan visas for den som far se ordern; RLS i 0039 later
        filen arva orderns behorighet, sa listan ar redan filtrerad.

        `garAttRatta` ar falskt fran och med `signerad`. Provisionen ar frusen
        pa ordern da, och triggern i 0034 nekar anda en andring — men en
        knapp som gar att trycka och sedan misslyckas ar samre an ingen knapp.
      */}
      <Bilaga
        orderId={o.id}
        bilagor={bilagor}
        garAttRatta={o.status === "utkast" || o.status === "inskickad"}
        nuvarande={{
          company_name: o.company_name,
          org_number: o.org_number,
          contact_name: o.contact_name,
          phone: o.contact_phone,
          package_id: String(o.package_id),
          term_months: String(o.term_months),
          signed_on: o.signed_on,
        }}
      />
    </li>
  );
}

/**
 * Matrisen, oppen for alla inloggade.
 *
 * En progressvy som sager "3 order kvar till nasta niva" utan att personen far
 * se vad en order ar vard ar en sifferlek. Raderna bar inga personuppgifter, sa
 * det finns ingenting att skydda.
 */
function Matris({ paket, satser, idag }: { paket: Paket[]; satser: Sats[]; idag: string }) {
  return (
    <Card>
      <CardHeader titel="Vad en order ger" beskrivning="Satsen som gäller i dag." />
      {paket.length === 0 ? (
        <EmptyState
          rubrik="Inga paket är upplagda"
          text="Utan paket och satser går det inte att räkna fram någon provision."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-small">
            <thead>
              <tr className="text-left text-micro text-ink-500">
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
      )}
    </Card>
  );
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
