"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { LOPTIDER, type Orderstatus, type Paket } from "@/lib/order";
import {
  godkannOrder,
  makuleraOrder,
  markeraBetald,
  raderaUtkast,
  redigeraOrder,
  returneraOrder,
  skickaInOrder,
  type Orderstate,
} from "./actions";
import { laggOvrigBonus } from "../provision/actions";

/**
 * Atgarderna pa en enskild order.
 *
 * Knapparna ritas efter status, men det ar TRIGGERN i 0034 som avgor vad som
 * faktiskt gar igenom. Samma uppdelning som rekryteringens stegflode: koden
 * ritar, databasen bestammer. Glider de isar faller `tests/order.mjs`.
 *
 * Ingen av knapparna oppnar en `confirm()`-ruta. Makuleringen kraver ett skal i
 * ett textfalt i stallet — det ar bade ett battre skydd mot ett slintat klick
 * och ett svar pa fragan "varfor makulerades den har" ett halvar senare.
 */
export function Atgarder({
  id,
  status,
  hanterare,
  bokforare,
  agare,
  order,
  paket,
  personer,
  periodStangd,
  idag,
}: {
  id: string;
  status: Orderstatus;
  hanterare: boolean;
  bokforare: boolean;
  agare: boolean;
  /** Nuvarande varden, for att forifylla rattelseformularet. */
  order?: Redigerbar;
  paket?: Paket[];
  personer?: { id: string; namn: string }[];
  /** Ar ordens manad faststalld? Avgor VAD rattelsen gor, inte OM den gar. */
  periodStangd?: boolean;
  idag?: string;
}) {
  const [oppen, setOppen] = useState<
    "retur" | "makulera" | "fri" | "ratta" | "bonus" | null
  >(null);

  if (status === "utkast" && agare) {
    return (
      <div className="flex flex-wrap gap-2">
        <Enkel action={skickaInOrder} id={id} etikett="Skicka in" />
        <Enkel action={raderaUtkast} id={id} etikett="Radera" variant="diskret" />
      </div>
    );
  }

  if (status === "inskickad" && hanterare) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Enkel action={godkannOrder} id={id} etikett="Godkänn" />
          {/*
            ORDERN FOLJER INTE PAKETREGLERNA — VID GODKANNANDET.

            Fram till 2026-09-09 gick den vagen bara genom `skapaOrder`, alltsa
            nar chefen sjalv la in en fardig order. En order som SALJAREN skickat
            in kunde bara godkannas rakt av, med matrisens belopp — och
            specifikationens avsnitt 4.2 sager att det ar GODKANNAREN som satter
            beloppet nar affaren faller utanfor matrisen.

            Det var alltsa en halvbyggd regel, och den syns tydligare nu nar
            ordervardet ocksa maste kunna sattas. Utfallningen nedan ar hela
            vagen: bada talen, och anteckningen som villkoret
            `sales_order_manuell_kraver_skal` i 0034 kraver.
          */}
          <Button
            type="button"
            size="sm"
            variant="diskret"
            onClick={() => setOppen(oppen === "fri" ? null : "fri")}
          >
            Godkänn utanför paketreglerna
          </Button>
          <Button
            type="button"
            size="sm"
            variant="sekundar"
            onClick={() => setOppen(oppen === "retur" ? null : "retur")}
          >
            Skicka tillbaka
          </Button>
        </div>
        {oppen === "fri" && <FriOrder id={id} />}
        {oppen === "retur" && (
          <MedSkal
            action={returneraOrder}
            id={id}
            etikett="Skicka tillbaka"
            platshallare="Vad behöver rättas?"
          />
        )}
      </div>
    );
  }

  if ((status === "signerad" || status === "betald") && (hanterare || bokforare)) {
    return (
      <div className="flex flex-col gap-2">
        {hanterare && order && paket && personer && idag && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="sekundar"
              onClick={() => setOppen(oppen === "ratta" ? null : "ratta")}
            >
              Rätta ordern
            </Button>
            <Button
              type="button"
              size="sm"
              variant="sekundar"
              onClick={() => setOppen(oppen === "bonus" ? null : "bonus")}
            >
              Lägg bonus
            </Button>
          </div>
        )}

        {oppen === "ratta" && order && paket && personer && idag && (
          <Rattelse
            id={id}
            order={order}
            paket={paket}
            personer={personer}
            periodStangd={periodStangd ?? false}
            idag={idag}
          />
        )}

        {oppen === "bonus" && <Bonus id={id} />}

        {/*
          O13: "Markera betald" ror inga pengar. Provisionen utgar fran
          signeringen, sa knappen ar ren information — och den syns bara for
          ekonomi och VD, som ar de som ser betalningen komma in.
        */}
        {status === "signerad" && bokforare && (
          <Enkel action={markeraBetald} id={id} etikett="Markera betald" variant="diskret" />
        )}
        {hanterare && (
          <>
            <Button
              type="button"
              size="sm"
              variant="diskret"
              onClick={() => setOppen(oppen === "makulera" ? null : "makulera")}
            >
              Makulera
            </Button>
            {oppen === "makulera" && (
              <MedSkal
                action={makuleraOrder}
                id={id}
                etikett="Makulera"
                variant="destruktiv"
                platshallare="Varför makuleras ordern?"
                hjalp="Avdraget bokförs i den här månaden, inte i månaden ordern tecknades."
              />
            )}
          </>
        )}
      </div>
    );
  }

  return null;
}

type Handling = (prev: Orderstate, form: FormData) => Promise<Orderstate>;

function Enkel({
  action,
  id,
  etikett,
  variant = "sekundar",
}: {
  action: Handling;
  id: string;
  etikett: string;
  variant?: "primar" | "sekundar" | "diskret" | "destruktiv";
}) {
  const [state, kor, vantar] = useActionState<Orderstate, FormData>(action, {});

  return (
    <form action={kor} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant={variant} laddar={vantar}>
        {etikett}
      </Button>
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
    </form>
  );
}

/**
 * Godkannandet av en order som faller utanfor paketmatrisen.
 *
 * TRE FALT, OCH ALLA TRE KRAVS AV EN REGEL SOM STAR NAGON ANNANSTANS:
 *
 *   Ordervardet   — `sales_order_ordervarde_kravs` i 0050 nekar en godkand
 *                   order utan varde.
 *   Provisionen   — avsnitt 4.2: godkannaren satter beloppet.
 *   Anteckningen  — `sales_order_manuell_kraver_skal` i 0034. En avvikande
 *                   provision utan skal ar det forsta nagon ifragasatter i
 *                   efterhand, och da finns svaret ingenstans.
 *
 * Alla tre star som `required` HAR OCKSA. Actionen kontrollerar dem anda — den
 * ar det som faktiskt hindrar skrivningen — men ett falt som gar att lamna tomt
 * och sedan far ett felmeddelande ar samre an ett som sager det direkt.
 *
 * EN UNDANTAGSVAG: ar saljaren sjalv saljchefen raknas provisionen ur
 * ordervardet, och da behovs bara det ena talet. Formularet vet inte vem
 * saljaren ar — den kunskapen ligger i `raknaFramProvision` pa servern — sa
 * hjalptexten sager det i stallet for att dolja faltet. Ett dolt falt som ibland
 * borde synas ar varre an ett falt med en forklaring.
 */
function FriOrder({ id }: { id: string }) {
  const [state, kor, vantar] = useActionState<Orderstate, FormData>(godkannOrder, {});

  return (
    <form action={kor} className="flex flex-col gap-2 rounded-sm bg-surface-alt p-3">
      <input type="hidden" name="id" value={id} />

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Ordervärde i kronor</span>
          <input
            name="order_value"
            required
            inputMode="decimal"
            placeholder="18 000"
            className={KONTROLL}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Provision i kronor</span>
          <input
            name="commission_amount"
            inputMode="decimal"
            placeholder="3 200"
            className={KONTROLL}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-micro text-ink-500">Varför faller ordern utanför matrisen?</span>
        <input name="note" required placeholder="Skälet till det avvikande beloppet" className={KONTROLL} />
      </label>

      <p className="text-small text-ink-500">
        Säljchefens övertäck räknas på skillnaden mellan de två talen. Står ordern på säljchefen
        själv räknas provisionen ur ordervärdet, och provisionsfältet lämnas tomt.
      </p>

      <div>
        <Button type="submit" size="sm" laddar={vantar}>
          Godkänn
        </Button>
      </div>

      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}
    </form>
  );
}

function MedSkal({
  action,
  id,
  etikett,
  platshallare,
  hjalp,
  variant = "sekundar",
}: {
  action: Handling;
  id: string;
  etikett: string;
  platshallare: string;
  hjalp?: string;
  variant?: "primar" | "sekundar" | "diskret" | "destruktiv";
}) {
  const [state, kor, vantar] = useActionState<Orderstate, FormData>(action, {});

  return (
    <form action={kor} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <input name="reason" required placeholder={platshallare} className={KONTROLL} />
      {hjalp && <p className="text-small text-ink-500">{hjalp}</p>}
      <div>
        <Button type="submit" size="sm" variant={variant} laddar={vantar}>
          {etikett}
        </Button>
      </div>
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}
    </form>
  );
}

/** Ordern sa som rattelseformularet behover kanna den. */
export type Redigerbar = {
  company_name: string;
  org_number: string;
  contact_name: string;
  contact_phone: string;
  package_id: number;
  term_months: number;
  salesperson_id: string;
  signed_on: string;
  is_addon: boolean;
  order_value: number | null;
  commission_amount: number | null;
  commission_source: string | null;
  note: string | null;
};

/**
 * Rättelsen av en godkänd order.
 *
 * ===========================================================================
 * RUTAN ÖVERST SÄGER VAD SOM KOMMER ATT HÄNDA, OCH DET ÄR INTE SAMMA SAK VARJE
 * GÅNG.
 *
 * Ligger ordern i en ÖPPEN månad räknas allt om live och ingenting bokförs —
 * en rättelse är då lika ofarlig som att lägga ordern rätt från början.
 *
 * Ligger den i en FASTSTÄLLD månad står den månaden orörd, och skillnaden
 * bokförs i innevarande. Det är en post i huvudboken som inte går att ta
 * tillbaka, och den som trycker ska veta det innan hen trycker — inte läsa det
 * i kvittensen efteråt.
 * ===========================================================================
 *
 * FÄLTEN ÄR FÖRIFYLLDA MED ORDERNS NUVARANDE VÄRDEN. Ett tomt fält betyder
 * "orört" i actionen, men ett tomt formulär hade ändå fått den som bara vill
 * ändra provisionen att undra vad som händer med resten.
 *
 * ORDERVÄRDET ÄR OBLIGATORISKT ÄVEN NÄR DET SAKNAS I DAG. Order som godkändes
 * före 2026-09-09 har inget, och `sales_order_ordervarde_kravs` i 0050 nekar
 * varje update som lämnar det tomt. Den som rättar en gammal order måste alltså
 * fylla i det — vilket är rätt: det är den enda uppgiften som saknas.
 */
function Rattelse({
  id,
  order,
  paket,
  personer,
  periodStangd,
  idag,
}: {
  id: string;
  order: Redigerbar;
  paket: Paket[];
  personer: { id: string; namn: string }[];
  periodStangd: boolean;
  idag: string;
}) {
  const [state, kor, vantar] = useActionState<Orderstate, FormData>(redigeraOrder, {});

  // Ordervärdet skrivs bara in när det redan är handsatt, eller när det saknas
  // helt. En paketorder får sitt värde räknat ur paketet i actionen, precis som
  // vid godkännandet — att spegla den räkningen här hade varit en andra kopia.
  const [fritt, setFritt] = useState(
    order.order_value === null || order.commission_source !== "matrix",
  );

  return (
    <form action={kor} className="flex flex-col gap-3 rounded-sm bg-surface-alt p-3">
      <input type="hidden" name="id" value={id} />

      <Notis ton={periodStangd ? "warn" : "info"}>
        {periodStangd ? (
          <>
            <strong>Månaden ordern hör till är fastställd.</strong> Den står orörd — skillnaden i
            provision och övertäck bokförs i stället som poster i innevarande månad, och de går
            inte att ta tillbaka. Signeringsdatumet kan ändras inom månaden, men inte ut ur den.
          </>
        ) : (
          <>
            Månaden är öppen, så ingenting är bokfört ännu. Allt räknas om live när du sparat.
          </>
        )}
      </Notis>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Bolagsnamn</span>
          <input name="company_name" defaultValue={order.company_name} className={KONTROLL} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Organisationsnummer</span>
          <input name="org_number" defaultValue={order.org_number} className={KONTROLL} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Kontaktperson</span>
          <input name="contact_name" defaultValue={order.contact_name} className={KONTROLL} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Telefon</span>
          <input name="contact_phone" defaultValue={order.contact_phone} className={KONTROLL} />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Paket</span>
          <select name="package_id" defaultValue={order.package_id} className={KONTROLL}>
            {paket.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Avtalstid</span>
          <select name="term_months" defaultValue={order.term_months} className={KONTROLL}>
            {LOPTIDER.map((m) => (
              <option key={m} value={m}>
                {m} månader
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Säljare</span>
          <select name="salesperson_id" defaultValue={order.salesperson_id} className={KONTROLL}>
            {personer.map((p) => (
              <option key={p.id} value={p.id}>
                {p.namn}
              </option>
            ))}
          </select>
          <span className="text-small text-ink-500">
            Byter du säljare flyttas hela beloppet, inte skillnaden.
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Signeringsdatum</span>
          <input
            name="signed_on"
            type="date"
            max={idag}
            defaultValue={order.signed_on}
            className={KONTROLL}
          />
          <span className="text-small text-ink-500">
            {periodStangd
              ? "Går att ändra inom månaden, men inte ut ur den."
              : "Styr vilken månad ordern räknas i."}
          </span>
        </label>
      </div>

      <label className="flex items-center gap-2 text-small text-ink-700">
        <input
          type="checkbox"
          name="is_addon"
          defaultChecked={order.is_addon}
          className="size-4"
        />
        Tilläggsavtal på befintlig kund
      </label>

      <label className="flex items-center gap-2 text-small text-ink-700">
        <input
          type="checkbox"
          checked={fritt}
          onChange={(e) => setFritt(e.target.checked)}
          className="size-4"
        />
        Sätt ordervärde och provision själv
      </label>

      {fritt ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-micro text-ink-500">Ordervärde i kronor</span>
            <input
              name="order_value"
              required
              inputMode="decimal"
              defaultValue={order.order_value ?? ""}
              placeholder="11 940"
              className={KONTROLL}
            />
            {order.order_value === null && (
              <span className="text-small text-ink-500">
                Ordern lades in innan ordervärdet fanns i navet. Det måste fyllas i för att den
                ska gå att rätta.
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-micro text-ink-500">Provision i kronor</span>
            <input
              name="commission_amount"
              inputMode="decimal"
              defaultValue={order.commission_amount ?? ""}
              className={KONTROLL}
            />
            <span className="text-small text-ink-500">
              Lämna tomt om säljchefen är säljaren — då räknas den ur ordervärdet.
            </span>
          </label>
        </div>
      ) : (
        <p className="text-small text-ink-500">
          Ordervärde och provision räknas om ur paketet och avtalstiden, efter den sats som gällde
          på signeringsdagen.
        </p>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-micro text-ink-500">Anteckning på ordern (valfri)</span>
        <input name="note" defaultValue={order.note ?? ""} className={KONTROLL} />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-micro text-ink-500">Varför rättas ordern?</span>
        <input
          name="reason"
          required
          placeholder="Fel paket valt vid inmatningen"
          className={KONTROLL}
        />
        <span className="text-small text-ink-500">
          Står i loggen med före- och eftervärde, och följer med rättelseposterna.
        </span>
      </label>

      <div>
        <Button type="submit" size="sm" laddar={vantar}>
          Spara rättelsen
        </Button>
      </div>

      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}
    </form>
  );
}

/**
 * Övrig bonus på en enskild affär.
 *
 * PERSONEN OCH MÅNADEN FRÅGAS INTE EFTER. Båda kommer ur ordern i
 * `laggOvrigBonus` — en bonus på Vlados affär som bokförs på Fredrik i en annan
 * månad är inte en bonus utan ett fel, och det enda sättet att garantera att det
 * inte händer är att inte erbjuda valet.
 *
 * Vill man ge något som inte hör till en affär finns det fria formuläret på
 * /provision. Samma funktion, samma slag i huvudboken, samma skälkrav.
 */
function Bonus({ id }: { id: string }) {
  const [state, kor, vantar] = useActionState<{ fel?: string; ok?: string }, FormData>(
    laggOvrigBonus,
    {},
  );

  return (
    <form action={kor} className="flex flex-col gap-2 rounded-sm bg-surface-alt p-3">
      <input type="hidden" name="sales_order_id" value={id} />

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Bonus i kronor</span>
          <input
            name="amount"
            required
            inputMode="decimal"
            placeholder="2 000"
            className={KONTROLL}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Varför?</span>
          <input
            name="note"
            required
            placeholder="Särskilt svår upphandling"
            className={KONTROLL}
          />
        </label>
      </div>

      <p className="text-small text-ink-500">
        Går till säljaren på ordern, i den månad ordern hör till. Ett negativt belopp drar
        tillbaka. Bonusen faller inte vid en bonusförlust — den är chefens egen bedömning av något
        utöver trappan.
      </p>

      <div>
        <Button type="submit" size="sm" laddar={vantar}>
          Bokför bonusen
        </Button>
      </div>

      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}
    </form>
  );
}
