import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ButtonLink } from "@/components/ui/Button";
import { kronor } from "@/lib/provision";
import type { Malutfall, Takt } from "@/lib/saljtakt";

/**
 * E13 steg 10: chefens lagtavla.
 *
 * ===========================================================================
 * DEN HAR LISTAN AR SORTERAD PA UTFALL, OCH DET AR ETT MEDVETET UNDANTAG.
 *
 * `underlagForAlla` i `provision-motor.ts` sorterar pa id och bar en kommentar
 * om varfor: *"en lista som sorterar personer efter vad de tjanat blir en
 * rangordning, och det ar inte vad vyn ar till for."* Den meningen skrevs om
 * BOKFORINGSUNDERLAGET — dokumentet som foljer med lonekorningen — och dar star
 * den kvar. Ett lonedokument som rangordnar personal ar fel sorts papper.
 *
 * Den har ytan ar nagot annat. Bestallarens besked 2026-09-07: *"designen maste
 * kannas som ett professionellt saljbolag."* En chef som oppnar sin lagvy mitt i
 * en manad fragar vem som drar och vem som har fastnat, och en lista i
 * id-ordning svarar inte pa det. Rangordningen ar hela poangen med ytan.
 *
 * TVA SPARRAR FOLJER MED UNDANTAGET:
 *
 *   SALJAREN SER ALDRIG DEN HAR LISTAN. Inte som ett designval utan for att
 *   `sales_order_read` i 0034 ger henne noll rader ur kollegornas order.
 *   Kretsen ar `far_hantera_provision()` — saljchef, VD, ekonomi — och sidan
 *   ritar kortet bara for dem. Databasen och koden sager samma sak.
 *
 *   INGEN PLACERINGSSIFFRA SKRIVS UT. Ordningen ar en ordning; en etta bredvid
 *   ett namn ar ett omdome. Skillnaden ar liten att lasa om och stor att mota.
 * ===========================================================================
 *
 * ---------------------------------------------------------------------------
 * RADEN BAR FARDIGA TAL, INTE ETT `Underlag`.
 *
 * Andrat 2026-09-08 nar arsvyn kom till. Ett `Underlag` beskriver EN MANAD, och
 * ett ar ar tolv. Bar raden underlaget maste tavlan sjalv veta hur tolv
 * summeras — och da ligger samma rakning bade har och i `page.tsx`, med tva
 * chanser att gora den olika.
 *
 * Nu raknas allt pa ett stalle och tavlan ritar. `bonusetikett` ar fardig text
 * av samma skal: "Nivå 10" i en manadsvy och "3 mån med bonus" i en arsvy ar
 * tva olika meningar om samma falt, och valet mellan dem hor inte hemma i en
 * komponent som inte vet vilken period den visar.
 * ---------------------------------------------------------------------------
 */

export type Lagrad = {
  employee_id: string;
  namn: string;
  /** Order tecknade i dag. Noll nar perioden inte innehaller dagens datum. */
  idag: number;
  /** Order netto i hela perioden. */
  antal: number;
  /** "Nivå 10", "3 mån med bonus", eller null. Fardig text — se rubriken. */
  bonusetikett: string | null;
  takt: Takt;
  mal: Malutfall | null;
  /** Periodens intjaning inklusive bokforda handposter. */
  total: number;
};

export function Lagtavla({
  rader,
  period,
  visaIdag,
  farSattaMal,
}: {
  rader: Lagrad[];
  /** Perioden tavlan galler, skriven: "september 2026" eller "hela 2026". */
  period: string;
  /** Har perioden en "i dag"? Ett ar som redan varit har det inte. */
  visaIdag: boolean;
  farSattaMal: boolean;
}) {
  if (rader.length === 0) {
    return (
      <Card>
        <CardHeader titel={`Laget i laget — ${period}`} />
        <EmptyState
          rubrik={`Ingen order är tecknad i ${period}`}
          text="Tavlan fylls av ordrarna själva. Den första order någon lägger in dyker upp här samma sekund."
          handling={<ButtonLink href="/order">Till order</ButtonLink>}
        />
      </Card>
    );
  }

  // Sorteringen: periodens intjaning, hogst forst. Se rubriken.
  const sorterade = [...rader].sort((a, b) => b.total - a.total);

  const idag = rader.reduce((s, r) => s + r.idag, 0);
  const order = rader.reduce((s, r) => s + r.antal, 0);
  const summa = rader.reduce((s, r) => s + r.total, 0);
  // TAKTEN SUMMERAS OVER DE SOM FAKTISKT HAR EN. Den som saknar prognos bidrar
  // med sitt UTFALL och inte med noll — annars sjunker lagets takt av att en ny
  // saljare borjar, vilket ar tvartemot vad som hant.
  const takt = rader.reduce((s, r) => s + (r.takt.prognos?.totalt ?? r.total), 0);

  return (
    <Card guide="provision.lag">
      <CardHeader
        titel={`Laget i laget — ${period}`}
        beskrivning="Räknas live ur orderna, samma motor som varje säljares egen vy. Ordningen är periodens intjäning."
        handling={
          farSattaMal ? (
            <ButtonLink href="/provision/mal" size="sm" variant="sekundar">
              Sätt månadsmål
            </ButtonLink>
          ) : undefined
        }
      />

      <dl className="mb-6 grid grid-cols-2 gap-4 rounded-sm bg-surface-alt p-4 sm:grid-cols-4">
        {visaIdag && <Lagtal etikett="I dag" varde={String(idag)} enhet="order" />}
        <Lagtal etikett="Perioden" varde={String(order)} enhet="order netto" />
        <Lagtal etikett="Intjänat" varde={kronor(summa)} />
        <Lagtal
          etikett="Takt"
          varde={kronor(takt)}
          enhet={visaIdag ? "vid periodens slut" : "utfall"}
        />
      </dl>

      <ul className="flex flex-col">
        {sorterade.map((r) => (
          <li
            key={r.employee_id}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-canvas py-4 last:border-0"
          >
            <span className="min-w-0 flex-1 basis-40 truncate text-body font-semibold text-ink-900">
              {r.namn}
            </span>

            {visaIdag && (
              <span className="tnum w-16 text-small text-ink-500">
                {r.idag > 0 ? `+${r.idag} i dag` : "—"}
              </span>
            )}

            <span className="tnum w-20 text-small text-ink-500">{r.antal} order</span>

            {r.bonusetikett ? (
              <Badge ton="brand">{r.bonusetikett}</Badge>
            ) : (
              <span className="w-[5.5rem] text-micro uppercase text-ink-300">Ingen nivå</span>
            )}

            <Mallapp mal={r.mal} />

            <span className="tnum w-28 text-right text-body font-semibold text-ink-900">
              {kronor(r.total)}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-4 max-w-[70ch] text-small text-ink-500">
        Talen är preliminära så länge perioden innehåller en öppen månad: en order som makuleras
        drar tillbaka sitt belopp, och volymbonusen räknas om vid varje ny order. Det som betalas
        ut är det som bokförs när månaden fastställs.
      </p>
    </Card>
  );
}

function Lagtal({ etikett, varde, enhet }: { etikett: string; varde: string; enhet?: string }) {
  return (
    <div>
      <dt className="text-micro uppercase text-ink-500">{etikett}</dt>
      <dd className="tnum mt-1 text-h1 text-ink-900">{varde}</dd>
      {enhet && <p className="text-micro text-ink-500">{enhet}</p>}
    </div>
  );
}

/**
 * Malet som ett kort besked.
 *
 * PROCENTEN STAR MED ORDET. En andel ensam sager inte om 60 % ar bra — det
 * beror pa var i perioden man ar, och det ar precis vad `lage` redan vagt in.
 * Samma resonemang som i `Malkort`.
 */
function Mallapp({ mal }: { mal: Malutfall | null }) {
  if (!mal) return <span className="w-24 text-micro uppercase text-ink-300">Inget mål</span>;

  const ton = mal.lage === "efter" ? "warn" : mal.lage === "fore" ? "ok" : "info";
  const ord = mal.lage === "efter" ? "efter" : mal.lage === "fore" ? "före" : "i takt";

  return (
    <span className="w-24">
      <Badge ton={ton}>
        {Math.round(mal.andel * 100)} % · {ord}
      </Badge>
    </span>
  );
}
