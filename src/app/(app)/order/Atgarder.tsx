"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import type { Orderstatus } from "@/lib/order";
import {
  godkannOrder,
  makuleraOrder,
  markeraBetald,
  raderaUtkast,
  returneraOrder,
  skickaInOrder,
  type Orderstate,
} from "./actions";

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
}: {
  id: string;
  status: Orderstatus;
  hanterare: boolean;
  bokforare: boolean;
  agare: boolean;
}) {
  const [oppen, setOppen] = useState<"retur" | "makulera" | "fri" | null>(null);

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
