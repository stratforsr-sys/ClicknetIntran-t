"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { LOPTIDER, ordervardeFor, type Paket } from "@/lib/order";
import { kronor } from "@/lib/provision";
import { skapaOrder, type Orderstate } from "./actions";

type Person = { id: string; namn: string };

/**
 * Inmatningen av en order.
 *
 * Rakt <input> och inte <Input>: sidan har flera formular och hade annars delat
 * id — samma skal som i satsformularet i E15 och i provisionens inmatning.
 *
 * PAKET OCH LOPTID AR SELECT, INTE FRITEXT. De tva avgor tillsammans vilken
 * provision ordern ger, och en felskrivning dar syns forst nar nagon undrar
 * over sin lon.
 *
 * ===========================================================================
 * ORDERVARDET RAKNAS FRAM MEDAN MAN SKRIVER, OCH DET AR HELA POANGEN.
 *
 * Bestallarens beskrivning 2026-09-09: *"ifall det ar ett paket som redan ar
 * inlagt sa ska man bara valja paketet och da ska det raknas provision och
 * ordervarde automatiskt"*. Talet under paketvalet ar den meningen, gjord
 * synlig — och den som ser 11 940 kr innan hen trycker vet direkt om hen valt
 * ratt rad.
 *
 * SIFFRAN HAR AR EN FORHANDSVISNING, INTE BESLUTET. Servern raknar om alltihop
 * i `raknaFramProvision` och sparar sitt eget svar. Det ar avsiktligt: en klient
 * gar att lura, och en sats kan hinna andras mellan att sidan laddades och
 * knappen trycktes. Rakningen ar densamma — `ordervardeFor` ar samma funktion
 * pa bada sidor — men det ar serverns tal som blir pengar.
 * ===========================================================================
 */
export function Nyorder({
  paket,
  personer,
  hanterare,
  idag,
  /** Mottagaren av overtacket, nar en sats ar satt. Se `manager_commission_rate` i 0050. */
  chef,
}: {
  paket: Paket[];
  personer: Person[];
  hanterare: boolean;
  idag: string;
  chef: { employee_id: string; override_percent: number; own_sale_percent: number } | null;
}) {
  const [state, action, vantar] = useActionState<Orderstate, FormData>(skapaOrder, {});
  const [manuell, setManuell] = useState(false);

  // Formularets nuvarande val. Behovs bara for forhandsvisningen; det ar
  // `name`-attributen som skickas in.
  const [paketId, setPaketId] = useState(paket[0]?.id ?? 1);
  const [loptid, setLoptid] = useState<number>(LOPTIDER[0]);
  const [friVarde, setFriVarde] = useState("");
  const [friProvision, setFriProvision] = useState("");
  const [saljare, setSaljare] = useState(personer[0]?.id ?? "");

  const valtPaket = paket.find((p) => p.id === paketId);

  // Ett fritt tal tolkas tillatande: mellanslag som tusentalsavgransare och
  // komma som decimaltecken ar hur folk faktiskt skriver kronor. Serverns
  // `tolkaBelopp` gor samma sak.
  const tolka = (text: string): number | null => {
    const rensat = text.replace(/[\s ]/g, "").replace(",", ".");
    if (!rensat) return null;
    const n = Number(rensat);
    return Number.isFinite(n) ? n : null;
  };

  const ordervarde = manuell
    ? tolka(friVarde)
    : valtPaket
      ? ordervardeFor(valtPaket.list_price, loptid)
      : null;

  // CHEFSREGELN GALLER DEN VALDA SALJAREN, inte den inloggade. En saljchef som
  // lagger in en order at Vlado ska se Vlados villkor, inte sina egna.
  const forChefen = chef !== null && saljare === chef.employee_id;

  const provision = forChefen
    ? ordervarde === null
      ? null
      : Math.round((ordervarde * chef!.own_sale_percent) / 100)
    : manuell
      ? tolka(friProvision)
      : null; // Matrisens belopp finns inte i klienten — servern slar upp det.

  const restpost =
    ordervarde !== null && provision !== null && !forChefen
      ? Math.max(0, ordervarde - provision)
      : null;

  const overtack =
    chef !== null && restpost !== null
      ? Math.round((restpost * chef.override_percent) / 100)
      : null;

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}

      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor="company_name" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Bolagsnamn</span>
          <input id="company_name" name="company_name" required className={KONTROLL} />
        </label>

        <label htmlFor="org_number" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Organisationsnummer</span>
          <input
            id="org_number"
            name="org_number"
            required
            inputMode="numeric"
            placeholder="556677-8899"
            className={KONTROLL}
          />
        </label>

        <label htmlFor="contact_name" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Kontaktperson</span>
          <input id="contact_name" name="contact_name" required className={KONTROLL} />
        </label>

        <label htmlFor="contact_phone" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Telefon</span>
          <input
            id="contact_phone"
            name="contact_phone"
            required
            inputMode="tel"
            placeholder="070-123 45 67"
            className={KONTROLL}
          />
        </label>

        <label htmlFor="package_id" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Paket</span>
          <select
            id="package_id"
            name="package_id"
            required
            className={KONTROLL}
            value={paketId}
            onChange={(e) => setPaketId(Number(e.target.value))}
          >
            {paket.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} — {kronor(p.list_price)}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="term_months" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Avtalstid</span>
          <select
            id="term_months"
            name="term_months"
            required
            className={KONTROLL}
            value={loptid}
            onChange={(e) => setLoptid(Number(e.target.value))}
          >
            {LOPTIDER.map((m) => (
              <option key={m} value={m}>
                {m} månader
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="signed_on" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Signeringsdatum</span>
          {/* max=idag: en framtida signering nekas ocksa av actionen, men ett
              val som inte gar att gora ar battre an ett felmeddelande efterat. */}
          <input
            id="signed_on"
            name="signed_on"
            type="date"
            required
            max={idag}
            defaultValue={idag}
            className={KONTROLL}
          />
        </label>

        {hanterare && personer.length > 0 && (
          <label htmlFor="salesperson_id" className="flex flex-col gap-1">
            <span className="text-micro text-ink-500">Säljare</span>
            <select
              id="salesperson_id"
              name="salesperson_id"
              className={KONTROLL}
              value={saljare}
              onChange={(e) => setSaljare(e.target.value)}
            >
              {personer.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.namn}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <label className="flex items-center gap-2 text-small text-ink-700">
        <input type="checkbox" name="is_addon" className="size-4" />
        Tilläggsavtal på befintlig kund
      </label>

      {hanterare && (
        <>
          <label className="flex items-center gap-2 text-small text-ink-700">
            <input
              type="checkbox"
              checked={manuell}
              onChange={(e) => setManuell(e.target.checked)}
              className="size-4"
            />
            Ordern följer inte paketreglerna — jag sätter ordervärde och provision själv
          </label>

          {manuell && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label htmlFor="order_value" className="flex flex-col gap-1">
                <span className="text-micro text-ink-500">Ordervärde i kronor</span>
                <input
                  id="order_value"
                  name="order_value"
                  inputMode="decimal"
                  placeholder="18 000"
                  className={KONTROLL}
                  value={friVarde}
                  onChange={(e) => setFriVarde(e.target.value)}
                />
                <span className="text-small text-ink-500">
                  Vad affären är värd för bolaget över hela avtalstiden.
                </span>
              </label>

              {/* CHEFENS EGNA ORDER BEHOVER INGEN PROVISION SKRIVEN. Den raknas
                  ur ordervardet, och ett falt som ignoreras ar varre an inget
                  falt: den som fyller i det tror att talet betyder nagot. */}
              {!forChefen && (
                <label htmlFor="commission_amount" className="flex flex-col gap-1">
                  <span className="text-micro text-ink-500">Provision i kronor</span>
                  <input
                    id="commission_amount"
                    name="commission_amount"
                    inputMode="decimal"
                    placeholder="3 200"
                    className={KONTROLL}
                    value={friProvision}
                    onChange={(e) => setFriProvision(e.target.value)}
                  />
                  <span className="text-small text-ink-500">
                    Kräver en anteckning nedan. En avvikande provision utan skäl är det första
                    någon ifrågasätter i efterhand.
                  </span>
                </label>
              )}
            </div>
          )}

          <label className="flex items-center gap-2 text-small text-ink-700">
            <input type="checkbox" name="godkann" defaultChecked className="size-4" />
            Godkänn direkt
          </label>
        </>
      )}

      <Affaren
        ordervarde={ordervarde}
        provision={provision}
        restpost={restpost}
        overtack={overtack}
        chef={chef}
        forChefen={forChefen}
        manuell={manuell}
        hanterare={hanterare}
      />

      <label htmlFor="note" className="flex flex-col gap-1">
        <span className="text-micro text-ink-500">Anteckning (valfritt)</span>
        <input id="note" name="note" placeholder="Något att veta om affären" className={KONTROLL} />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" laddar={vantar}>
          {hanterare ? "Lägg ordern" : "Skicka in ordern"}
        </Button>
        <p className="text-small text-ink-500">
          {hanterare
            ? "Ordervärdet och provisionen fryses på ordern när den godkänns."
            : "Ordern räknas först när den godkänts."}
        </p>
      </div>
    </form>
  );
}

/**
 * Affaren, uppdelad sa som den faktiskt raknas.
 *
 * ===========================================================================
 * TVA TAL SOM ALDRIG FAR LASAS IHOP.
 *
 * ORDERVARDET ar bolagets omsattning pa affaren. PROVISIONEN ar pengar till en
 * person. De star bredvid varandra har for att bada hor till samma order, men
 * de summeras aldrig — och rutan sager det med ord, eftersom 11 940 och 1 500
 * bredvid varandra annars inbjuder till att laggas ihop.
 * ===========================================================================
 *
 * RUTAN SYNS BARA NAR DET FINNS NAGOT ATT VISA. En rad som alltid star dar och
 * alltid sager noll lar ogat att ingenting hander pa den platsen — samma
 * resonemang som K&V-raden i provisionsvyn foljer.
 *
 * MATRISENS BELOPP STAR INTE HAR. Provisionen for en vanlig paketorder slas upp
 * pa servern ur `commission_rate`, versionerad pa signeringsdatumet, och att
 * spegla de nio beloppen i klienten hade varit en andra kopia av matrisen — den
 * sortens kopia som glider isar tyst. Rutan sager i stallet varifran talet
 * kommer.
 */
function Affaren({
  ordervarde,
  provision,
  restpost,
  overtack,
  chef,
  forChefen,
  manuell,
  hanterare,
}: {
  ordervarde: number | null;
  provision: number | null;
  restpost: number | null;
  overtack: number | null;
  chef: { override_percent: number; own_sale_percent: number } | null;
  forChefen: boolean;
  manuell: boolean;
  hanterare: boolean;
}) {
  if (ordervarde === null) return null;

  return (
    <dl className="grid gap-x-6 gap-y-3 rounded-sm bg-surface-alt p-4 sm:grid-cols-2">
      <Tal
        etikett="Ordervärde"
        varde={kronor(ordervarde)}
        under={
          manuell
            ? "Inskrivet för hand"
            : "Månadspriset gånger avtalstiden"
        }
      />

      {provision !== null ? (
        <Tal
          etikett="Provision till säljaren"
          varde={kronor(provision)}
          under={
            forChefen
              ? `${chef!.own_sale_percent} % av ordervärdet — säljchefens egen försäljning`
              : "Inskriven för hand"
          }
        />
      ) : (
        <Tal
          etikett="Provision till säljaren"
          varde="Räknas vid godkännandet"
          under="Ur paketmatrisen, efter signeringsdatum"
        />
      )}

      {/* Restposten visas bara nar den betyder nagot — alltsa nar bada talen ar
          kanda. For en vanlig paketorder gor godkannandet den rakningen. */}
      {restpost !== null && chef !== null && (
        <>
          <Tal
            etikett="Kvar efter provisionen"
            varde={kronor(restpost)}
            under={
              restpost === 0 && ordervarde < (provision ?? 0)
                ? "Provisionen överstiger ordervärdet — övertäcket blir noll"
                : "Ordervärdet minus säljarens provision"
            }
          />
          <Tal
            etikett="Övertäck till säljchefen"
            varde={kronor(overtack ?? 0)}
            under={`${chef.override_percent} % av det som blir över`}
          />
        </>
      )}

      {forChefen && (
        <p className="text-small text-ink-500 sm:col-span-2">
          Ordern står på säljchefen själv. Då gäller satsen för egen försäljning i stället för
          paketmatrisen, och inget övertäck bokförs — det finns ingen annans affär att ersätta.
        </p>
      )}

      {!manuell && !forChefen && hanterare && (
        <p className="text-small text-ink-500 sm:col-span-2">
          Ordervärdet är inte pengar till någon — det är vad affären är värd för bolaget. Provision
          och övertäck räknas ur det när ordern godkänns.
        </p>
      )}
    </dl>
  );
}

function Tal({ etikett, varde, under }: { etikett: string; varde: string; under: string }) {
  return (
    <div>
      <dt className="text-micro uppercase text-ink-500">{etikett}</dt>
      <dd className="tnum mt-1 text-h2 text-ink-900">{varde}</dd>
      <p className="mt-0.5 text-micro text-ink-500">{under}</p>
    </div>
  );
}
