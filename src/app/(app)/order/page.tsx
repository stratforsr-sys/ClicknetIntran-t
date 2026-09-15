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
  hamtaChefssatser,
  hamtaPaket,
  hamtaSatser,
  hamtaUtkopssatser,
  type Orderrad,
} from "@/lib/order-server";
import { gallandeChefssats } from "@/lib/chefsprovision";
import { gallandeUtkopssats } from "@/lib/utkop";
import { hamtaPerioder } from "@/lib/bonus-server";
import {
  LOPTIDER,
  STATUS_ETIKETT,
  grundprovision,
  harStangdPeriod,
  nettoAntal,
  periodFor,
  provisionFor,
  type Orderstatus,
  type Paket,
  type Sats,
} from "@/lib/order";
import { kronor, manadFore, manadsnamn, manadsnyckel } from "@/lib/provision";
import { Atgarder } from "./Atgarder";
import { Bilaga, type Orderbilaga } from "./Bilaga";
import { Samtal } from "./Samtal";
import { hamtaOrdersamtal } from "@/lib/samtal-order-server";
import type { Samtalsrad } from "@/lib/samtal-vy";
import { Nyorder } from "./Nyorder";
import { GuideVard } from "@/components/guide/GuideVard";

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

  const [order, ko, paket, satser, personer, chefssatser, utkopssatser, perioder] =
    await Promise.all([
      hamtaOrder(ettArBak),
      hanterare ? hamtaKo() : Promise.resolve([] as Orderrad[]),
      hamtaPaket(),
      hamtaSatser(),
      hanterare ? hamtaSaljare() : Promise.resolve([] as { id: string; namn: string }[]),
      // TOM LISTA FOR EN SALJARE, och det ar RLS som gor det, inte en if-sats
      // har. `manager_commission_rate_read` i 0050 slapper bara in den krets som
      // ser provision — satserna ar villkoren for nagon annans ersattning.
      // Foljden i formularet ar att restposten och overtacket inte ritas alls for
      // saljaren, medan ordervardet gor det: det ar hens egen affar.
      hamtaChefssatser(),
      // UTKOPSSATSEN (0060) LASES DAREMOT AV ALLA. Det ar saljarens EGEN sats,
      // och den som lagger en order med utkop ska se vad affaren ger innan hen
      // trycker — precis som paketmatrisen star oppen. Se
      // `buyout_commission_rate_read`.
      hamtaUtkopssatser(),
      // FASTSTALLDA MANADER, och de bar TRE fragor pa en gang.
      //
      // FORE godkannandet (O11 / avsnitt 5.6): hor ordern till en manad som redan
      // ar faststalld? Da bokfors provisionen i den OPPNA perioden i stallet, och
      // chefen ska se det innan hon trycker — ett besked efterat om att pengarna
      // hamnade i en annan manad ar ett arende i vardande.
      //
      // EFTER godkannandet (0051): samma fraga avgor vad en RATTELSE gor. En oppen
      // manad raknas om live; en faststalld far rattelseposter i innevarande manad
      // som inte gar att ta tillbaka. Det ar samma manad och samma svar, sa det ar
      // ocksa samma prop hela vagen ner — se `stangdPeriod` i `Atgarder`.
      //
      // OCH SEDAN 2026-09-15: listan gar hela vagen ner i INMATNINGEN, sa att
      // manadsstampeln under datumfaltet kan varna INNAN knappen trycks. Det var
      // den varningen som saknades den dag en augustiorder tyst blev en
      // septemberorder — se rubriken i `Nyorder.tsx`.
      hamtaPerioder(ettArBak),
    ]);

  const stangda = perioder.map((p) => p.period_month);

  // SATSEN SLAS UPP PA DAGENS DATUM I FORMULARET, inte pa orderns.
  //
  // Formularet ar en forhandsvisning av en order som lags NU, och signeringsdatumet
  // gar att andra i falter efterat. Servern slar upp satsen pa det datum som
  // faktiskt skickas in (`raknaFramProvision`), och det ar den rakningen som blir
  // pengar. Skillnaden syns bara om nagon backdaterar over ett satsbyte, och da
  // ar serverns tal det ratta.
  const gallandeChef = gallandeChefssats(chefssatser, idag);

  // Samma resonemang for utkopssatsen: formularet visar den som galler I DAG,
  // servern slar upp den pa orderns faktiska signeringsdatum.
  const gallandeUtkop = gallandeUtkopssats(utkopssatser, idag);

  const namn = new Map(personer.map((p) => [p.id, p.namn]));
  const mina = order.filter((o) => o.salesperson_id === user.employee!.id);
  const underlag = hanterare ? order : mina;

  // E13 steg 9. Bilagorna hamtas for de order som faktiskt visas, i EN fraga.
  // En fraga per orderrad hade blivit tjugo turer pa en sida som redan ligger
  // i den blockerande vagen.
  const synligaOrder = [...new Set([...underlag, ...ko].map((o) => o.id))];
  const bilagor = await hamtaOrderbilagor(synligaOrder);

  // 0056. Samtalen for de order som visas, i EN fraga — samma form som
  // bilagorna, och av samma skal. RLS avgor vad som syns; sidan filtrerar inte
  // sjalv, for ett andra svar pa samma fraga hinner glida isar fran det forsta.
  const samtal = await hamtaOrdersamtal(synligaOrder);

  return (
    <div className="flex flex-col gap-4 pt-2">
      <GuideVard slug="registrera-order" />
      <div>
        <h1 className="text-display text-ink-900">Order</h1>
        <p className="mt-1 text-body text-ink-500">
          Kundorder och den provision de ger. Bonusen räknas inte här ännu.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card status="brand" className="lg:col-span-2" guide="order.manad">
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

      <Card guide="order.ny">
        <CardHeader
          titel="Lägg en order"
          beskrivning={
            hanterare
              ? "Provisionen hämtas ur matrisen efter signeringsdatum."
              : "Ordern går till säljchefen för godkännande."
          }
        />
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
        />
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
                  upphovsperson={o.created_by === user.employee!.id}
                  paket={paket}
                  bilagor={bilagor.get(o.id) ?? []}
                  samtal={samtal.get(o.id) ?? []}
                  personer={personer}
                  stangdPeriod={harStangdPeriod(o.signed_on, stangda)}
                  idag={idag}
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
                upphovsperson={o.created_by === user.employee!.id}
                paket={paket}
                bilagor={bilagor.get(o.id) ?? []}
                samtal={samtal.get(o.id) ?? []}
                personer={personer}
                stangdPeriod={harStangdPeriod(o.signed_on, stangda)}
                idag={idag}
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
  upphovsperson,
  paket,
  bilagor,
  samtal,
  personer,
  stangdPeriod,
  idag,
}: {
  o: Orderrad;
  namn?: string;
  hanterare: boolean;
  bokforare: boolean;
  agare: boolean;
  /** La den inloggade upp ordern? Ger ratt att ratta kunduppgifterna, inte beloppen. */
  upphovsperson: boolean;
  paket: Paket[];
  bilagor: Orderbilaga[];
  /** 0056. Samtalen pa kundens nummer. Tom lista ar ett giltigt svar. */
  samtal: Samtalsrad[];
  /** Sa att rattelsen kan byta saljare. Tom for den som inte far se andra. */
  personer: { id: string; namn: string }[];
  /**
   * Hor ordern till en manad som redan ar faststalld?
   *
   * FORE godkannandet (O11): provisionen bokfors i den oppna perioden i stallet.
   * EFTER godkannandet (0051): en rattelse ger rattelseposter i innevarande
   * manad i stallet for att rakna om. Samma fraga, tva anvandningar.
   */
  stangdPeriod: boolean;
  idag: string;
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
        {o.commission_source === "manager" ? " · säljchefens egen försäljning" : ""}
        {o.commission_source === "buyout" ? " · provision räknad efter utköp" : ""}
      </p>

      {/*
        KONTAKTRADEN. Mejlen kom till 2026-09-15 och star bredvid telefonnumret,
        inte pa en egen rad: bada ar satt att na samma person, och tva rader hade
        last som tva olika uppgifter.

        ORGANISATIONSNUMRET STAR INTE HAR. K27-undantaget i 0034 later kolumnen
        bara ett personnummer for en enskild firma, och da hor den inte hemma i
        en lista. Den som behover numret ser det i rattelseformularet.

        Order fran fore kolumnen fanns sager ingenting i stallet for att visa en
        tom plats — samma linje som ordervardet tog i 0050.
      */}
      <p className="text-small text-ink-500">
        {o.contact_name} · {o.contact_phone}
        {o.contact_email ? " · " : ""}
        {o.contact_email && (
          <a href={`mailto:${o.contact_email}`} className="underline underline-offset-2">
            {o.contact_email}
          </a>
        )}
      </p>

      {/*
        ORDERVARDET STAR PA EGEN RAD, MED SITT ORD.

        Talet ar femsiffrigt och provisionen fyrsiffrig, sa lades de bredvid
        varandra i raden ovan hade det storre av dem last som "vad ordern gav" —
        och det ar precis vad det INTE ar. Ordet "ordervärde" gor skillnaden, och
        den mindre graden sager att det inte ar radens huvudtal.

        Order fran fore 0050 saknar varde. De sager ingenting alls i stallet for
        "0 kr", som hade last som en gratisaffar.
      */}
      {o.order_value !== null && (
        <p className="text-small text-ink-500">
          Ordervärde {kronor(o.order_value)}
          {o.order_value_source === "manual" ? " · satt för hand" : " · pris × avtalstid"}
          {/*
            UTKOPET STAR I SAMMA RAD SOM ORDERVARDET, med minustecken och med
            nettot utskrivet. Skalet ar att de tre talen bara betyder nagot
            TILLSAMMANS: 11 940 kr ensamt sager fel sak om affaren, och 6 940 kr
            ensamt gar inte att stamma av mot avtalet. Se 0060.
          */}
          {typeof o.buyout_amount === "number" && o.buyout_amount > 0 && (
            <> · utköp − {kronor(o.buyout_amount)} · kvar {kronor(o.order_value - o.buyout_amount)}</>
          )}
        </p>
      )}

      {/* En INSKICKAD order har utkop men annu inget ordervarde — det raknas
          fram vid godkannandet. Uppgiften far inte forsvinna dar emellan: det ar
          den som gor att godkannaren raknar ratt. */}
      {o.order_value === null && typeof o.buyout_amount === "number" && o.buyout_amount > 0 && (
        <p className="text-small text-ink-500">
          Utköp {kronor(o.buyout_amount)} · dras av när ordern godkänns
        </p>
      )}

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
        upphovsperson={upphovsperson}
        order={{
          company_name: o.company_name,
          org_number: o.org_number,
          contact_name: o.contact_name,
          contact_phone: o.contact_phone,
          contact_email: o.contact_email,
          package_id: o.package_id,
          term_months: o.term_months,
          salesperson_id: o.salesperson_id,
          signed_on: o.signed_on,
          is_addon: o.is_addon,
          order_value: o.order_value,
          buyout_amount: o.buyout_amount ?? null,
          commission_amount: o.commission_amount,
          commission_source: o.commission_source,
          note: o.note,
        }}
        paket={paket}
        personer={personer}
        stangdPeriod={stangdPeriod}
        manad={manadsnamn(periodFor(o.signed_on))}
        idag={idag}
      />

      {/*
        E13 steg 9. Bilagan visas for den som far se ordern; RLS i 0039 later
        filen arva orderns behorighet, sa listan ar redan filtrerad.

        `garAttRatta` ar falskt fran och med `signerad`. Provisionen ar frusen
        pa ordern da, och triggern i 0034 nekar anda en andring — men en
        knapp som gar att trycka och sedan misslyckas ar samre an ingen knapp.
      */}
      {/*
        0056. Samtalen pa kundens telefonnummer, aven de som ligger langt
        bakatt. Kopplingen ar navets gissning pa nummer och tid — utom nar
        `order_linked_by` ar satt, och da sager raden "Kopplad for hand".
      */}
      <Samtal samtal={samtal} />

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
