import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { svensktDatum } from "@/lib/klocka";
import { hamtaNivaer } from "@/lib/bonus-server";
import { hamtaChefssatser, hamtaPaket, hamtaSatser } from "@/lib/order-server";
import { gallandeChefssats } from "@/lib/chefsprovision";
import { LOPTIDER, ordervardeFor, provisionFor } from "@/lib/order";
import { kronor, manadsnamn, manadsnyckel } from "@/lib/provision";
import { gallandeNivaer, type Bonusniva } from "@/lib/provision-motor";
import { hamtaRegler } from "@/lib/konsekvens-server";
import { ATGARD_ETIKETT } from "@/lib/konsekvens";
import { KonsekvensSteg, NyNiva, TaBortNiva, TaBortSteg } from "./Trappa";
import { Chefssatsformular } from "./Chefsersattning";

export const dynamic = "force-dynamic";

/**
 * E13 steg 3: volymtrappan som installning.
 *
 * INGET AR SEEDAT. Bestallaren har satt nivaerna 5/10/15/20/25/30 men inte vad
 * de ar varda (avsnitt 5.1, fraga 18). Sidan fods darfor tom, och tills nagon
 * fyller i den ger motorn noll bonus — aldrig en gissad. Samma linje som
 * tackningsgraden i 0025: en nolla i vyn syns, ett standardvarde gor det inte.
 *
 * SALJCHEF OCH VD. Ekonomi ser provisionen men andrar inte reglerna
 * (avsnitt 2). Kontrollen star bade har och i actionen — den har gommer sidan,
 * actionen ar det som faktiskt hindrar skrivningen.
 */

/** Bestallarens trappa, som FORSLAG i inmatningen. Inte som varden. */
const TROSKELFORSLAG = [5, 10, 15, 20, 25, 30];

export default async function Reglersida() {
  const user = await getCurrentUser();
  if (!user?.employee) return null;
  if (!hasRole(user, "sales_manager", "ceo")) notFound();

  const [alla, regler, chefssatser, paket, satser, personer] = await Promise.all([
    hamtaNivaer(),
    hamtaRegler(),
    hamtaChefssatser(),
    hamtaPaket(),
    hamtaSatser(),
    hamtaSaljbara(),
  ]);
  const manad = manadsnyckel();
  const idag = svensktDatum();

  const gallandeChef = gallandeChefssats(chefssatser, idag);
  const chefshistorik = chefssatser
    .filter((s) => s.valid_to !== null)
    .sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1));

  // RAKNEEXEMPLET BYGGS AV RIKTIG KONFIGURATION, inte av paminnda tal.
  //
  // Paketet med lagsta priset och kortaste loptiden — den kombination som ger
  // det MINSTA overtacket. Ett exempel pa den storsta affaren hade fatt varje
  // procentsats att se generosare ut an den ar.
  //
  // Saknas paketet eller satsen visas inget exempel alls. Ett exempel med en
  // gissad nolla i hade varit samre an inget: det ser ut att vara raknat.
  const minstaPaket = [...paket].sort((a, b) => a.list_price - b.list_price)[0];
  const kortaste = LOPTIDER[0];
  const exempelprovision = minstaPaket
    ? provisionFor(satser, minstaPaket.id, kortaste, idag)
    : null;

  const exempel =
    minstaPaket && exempelprovision !== null
      ? {
          ordervarde: ordervardeFor(minstaPaket.list_price, kortaste),
          provision: exempelprovision,
          text: `${minstaPaket.label} över ${kortaste} månader`,
        }
      : null;

  const gallande = gallandeNivaer(alla, manad);
  const kommande = alla.filter((n) => n.valid_to === null && n.valid_from > manad);
  const historik = alla
    .filter((n) => n.valid_to !== null)
    .sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1));

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <h1 className="text-display text-ink-900">Provisionsregler</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Vad en månads ordervolym är värd, och vad en ogiltig frånvaro leder till. Båda är
          inställningar och inte kod — en ändring här slår igenom utan att något byggs om.
        </p>
      </div>

      <Card status={gallande.length === 0 ? "warn" : "brand"}>
        <CardHeader
          titel={`Gäller i ${manadsnamn(manad)}`}
          beskrivning="Nivån bestäms av hela månadens ordervolym, och bonusen gäller samtliga order i månaden — inte bara de över tröskeln."
        />
        {gallande.length === 0 ? (
          <EmptyState
            rubrik="Trappan är tom"
            text="Ingen volymbonus räknas ut förrän en nivå är satt. Nav gissar aldrig ett belopp — en gissad siffra ser rätt ut och blir tyst sanning."
          />
        ) : (
          <ul className="flex flex-col">
            {gallande.map((n) => (
              <li
                key={n.id}
                className="flex flex-wrap items-center gap-3 border-b border-canvas py-3 last:border-0"
              >
                <span className="w-28 text-body text-ink-900">{n.threshold} order</span>
                <span className="tnum flex-1 text-body font-semibold text-ink-900">
                  {beskrivBelopp(n)}
                </span>
                <span className="text-small text-ink-500">från {n.valid_from}</span>
                <TaBortNiva troskel={n.threshold} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {kommande.length > 0 && (
        <Card>
          <CardHeader
            titel="Träder i kraft senare"
            beskrivning="Ändringar som ännu inte gäller. Trappan slås upp på månadens första dag."
          />
          <ul className="flex flex-col">
            {kommande.map((n) => (
              <li
                key={n.id}
                className="flex flex-wrap items-center gap-3 border-b border-canvas py-3 last:border-0"
              >
                <span className="w-28 text-body text-ink-900">{n.threshold} order</span>
                <span className="tnum flex-1 text-body text-ink-900">{beskrivBelopp(n)}</span>
                <Badge>från {n.valid_from}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader
          titel="Sätt eller ändra en nivå"
          beskrivning="En ändring är en ny rad, aldrig en överskrivning. Den gamla står kvar som svar på frågan vilken trappa som gällde när."
        />
        <NyNiva troskelforslag={TROSKELFORSLAG} />
        <p className="mt-4 text-small text-ink-500">
          Trappan står still över 30 order. Utöver den kan du bokföra en övrig bonus för hand på{" "}
          <Link href="/provision" className="underline">
            provisionssidan
          </Link>
          . En stängd månad påverkas aldrig av en ändring här.
        </p>
      </Card>

      {/*
        SALJCHEFENS ERSATTNING STAR EFTER VOLYMTRAPPAN OCH FORE KONSEKVENSERNA.

        Ordningen foljer vad talen GOR: trappan och satserna har lagger till
        pengar, konsekvenstrappan tar bort dem. En installning som ger och en som
        river bredvid varandra utan en grans laser som samma sorts regel.
      */}
      <Card status={gallandeChef === null ? "warn" : undefined}>
        <CardHeader
          titel="Säljchefens ersättning"
          beskrivning="Två satser som aldrig möts på samma order: övertäcket på andras affärer, och satsen när säljchefen säljer själv."
        />

        {gallandeChef === null ? (
          <EmptyState
            rubrik="Ingen sats är satt"
            text="Utan en sats bokförs inget övertäck, och paketmatrisen gäller för alla — även för säljchefen. Nav gissar aldrig en procentsats."
          />
        ) : (
          <dl className="mb-6 grid grid-cols-1 gap-4 rounded-sm bg-surface-alt p-4 sm:grid-cols-3">
            <div>
              <dt className="text-micro uppercase text-ink-500">Mottagare</dt>
              <dd className="mt-1 text-body font-semibold text-ink-900">
                {personer.find((p) => p.id === gallandeChef.employee_id)?.namn ?? "Okänd"}
              </dd>
            </div>
            <div>
              <dt className="text-micro uppercase text-ink-500">Övertäck</dt>
              <dd className="tnum mt-1 text-h1 text-ink-900">{gallandeChef.override_percent} %</dd>
              <p className="text-micro text-ink-500">av det som blir över</p>
            </div>
            <div>
              <dt className="text-micro uppercase text-ink-500">Egen försäljning</dt>
              <dd className="tnum mt-1 text-h1 text-ink-900">{gallandeChef.own_sale_percent} %</dd>
              <p className="text-micro text-ink-500">av hela ordervärdet</p>
            </div>
            <p className="text-small text-ink-500 sm:col-span-3">
              Gäller order signerade från {gallandeChef.valid_from}. Uppslaget sker på orderns
              signeringsdatum och inte på månadens första dag — övertäcket är en egenskap hos en
              enskild order, till skillnad från volymbonusen som hör till hela månaden.
            </p>
          </dl>
        )}

        <Chefssatsformular
          personer={personer}
          nuvarande={
            gallandeChef && {
              employee_id: gallandeChef.employee_id,
              override_percent: gallandeChef.override_percent,
              own_sale_percent: gallandeChef.own_sale_percent,
            }
          }
          exempel={exempel}
        />

        {chefshistorik.length > 0 && (
          <div className="mt-6 border-t border-canvas pt-4">
            <p className="text-micro uppercase text-ink-500">Satser som inte gäller längre</p>
            <ul className="mt-2 flex flex-col">
              {chefshistorik.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center gap-3 border-b border-canvas py-2 text-small text-ink-500 last:border-0"
                >
                  <span className="w-32 truncate">
                    {personer.find((p) => p.id === s.employee_id)?.namn ?? "Okänd"}
                  </span>
                  <span className="tnum flex-1">
                    {s.override_percent} % övertäck · {s.own_sale_percent} % egen
                  </span>
                  <span>
                    {s.valid_from} – {s.valid_to}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card status={regler.length === 0 ? "warn" : undefined}>
        <CardHeader
          titel="Konsekvenstrappan"
          beskrivning="Vad en godkänd ogiltig frånvaro leder till. Trösklar, periodlängd och åtgärd är data — vad varje åtgärd gör är kod."
        />
        {regler.length === 0 ? (
          <EmptyState
            rubrik="Trappan är tom"
            text="Ingen händelse går att godkänna förrän minst ett steg finns. Beställarens trappa är 1 händelse → varning, 2 → bonusförlust, 3 → ärende, alla inom rullande 3 månader."
          />
        ) : (
          <ul className="flex flex-col">
            {regler.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-3 border-b border-canvas py-3 last:border-0"
              >
                <span className="w-20 text-body text-ink-900">Steg {r.ordning}</span>
                <span className="flex-1 text-body text-ink-900">
                  {r.antal_handelser} {r.antal_handelser === 1 ? "händelse" : "händelser"} inom{" "}
                  {r.periodlangd_manader} månader → {ATGARD_ETIKETT[r.atgard]}
                </span>
                {!r.notifiera && <Badge ton="warn">Ingen notis</Badge>}
                <TaBortSteg ordning={r.ordning} />
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 border-t border-canvas pt-6">
          <KonsekvensSteg />
        </div>

        <p className="mt-4 max-w-[70ch] text-small text-ink-500">
          Perioden är rullande och räknas bakåt från händelsens dag: har det inte hänt något på
          periodlängden börjar trappan om. Grundprovisionen rörs aldrig, och övrig bonus faller
          inte (Ö8) — det är volymbonusen och K&amp;V-bonusen som faller, och orderräknaren
          börjar om från noll. Ett steg som redan lett till ett beslut går att ändra men inte att
          ta bort: den beslutade händelsen bär sin åtgärd på sin egen rad.
        </p>
      </Card>

      {historik.length > 0 && (
        <Card>
          <CardHeader titel="Historik" beskrivning="Rader som inte gäller längre." />
          <ul className="flex flex-col">
            {historik.map((n) => (
              <li
                key={n.id}
                className="flex flex-wrap items-center gap-3 border-b border-canvas py-2 text-small text-ink-500 last:border-0"
              >
                <span className="w-28">{n.threshold} order</span>
                <span className="tnum flex-1">{beskrivBelopp(n)}</span>
                <span>
                  {n.valid_from} – {n.valid_to}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/**
 * De som gar att peka ut som mottagare av overtacket.
 *
 * KRETSEN AR SALJCHEF OCH VD, inte "alla anstallda". Overtacket ar en
 * chefsersattning, och en lista med tjugo namn hade gjort det till nagot man
 * kan ge vem som helst.
 *
 * SCHEMAT KONTROLLERAR INTE ROLLEN, och det ar avsiktligt (se 0050): rollerna i
 * `employee_role` gar att andra, medan satsraden ar historik. Slutar nagon som
 * saljchef ska den rad som gallde da fortfarande peka pa hen. Kontrollen hor
 * darfor hemma HAR, dar valet gors.
 *
 * `status = 'active'`: en avslutad anstalld ska inte ga att valja, men de
 * satsrader som redan pekar pa hen star kvar och visas i historiken.
 */
async function hamtaSaljbara(): Promise<{ id: string; namn: string }[]> {
  const rls = await supabaseServer();
  const { data } = await rls
    .from("employee")
    .select("id, first_name, last_name, status, employee_role!inner(role)")
    .eq("status", "active")
    .in("employee_role.role", ["sales_manager", "ceo"]);

  // En person med bade sales_manager och ceo kommer tillbaka tva ganger ur
  // joinen. `Map` pa id ar billigare an ett `distinct` som PostgREST anda inte
  // erbjuder over en inbaddad tabell.
  const unika = new Map<string, string>();
  for (const e of data ?? []) {
    unika.set(String(e.id), `${e.first_name} ${e.last_name}`.trim());
  }

  return [...unika].map(([id, namn]) => ({ id, namn })).sort((a, b) => a.namn.localeCompare(b.namn, "sv"));
}

/** Beloppet med sin form. Formen ar inte kosmetisk — den avgor hur mycket det blir. */
function beskrivBelopp(n: Bonusniva): string {
  switch (n.unit) {
    case "percent":
      return `${n.amount} % av månadens grundprovision`;
    case "amount_per_order":
      return `${kronor(n.amount)} per order`;
    default:
      return kronor(n.amount);
  }
}
