"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { LOPTIDER, type Paket } from "@/lib/order";
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
 */
export function Nyorder({
  paket,
  personer,
  hanterare,
  idag,
}: {
  paket: Paket[];
  personer: Person[];
  hanterare: boolean;
  idag: string;
}) {
  const [state, action, vantar] = useActionState<Orderstate, FormData>(skapaOrder, {});
  const [manuell, setManuell] = useState(false);

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
          <select id="package_id" name="package_id" required className={KONTROLL}>
            {paket.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} — {kronor(p.list_price)}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="term_months" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Avtalstid</span>
          <select id="term_months" name="term_months" required className={KONTROLL}>
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
            <select id="salesperson_id" name="salesperson_id" className={KONTROLL}>
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
            Ordern följer inte paketreglerna — jag sätter provisionen själv
          </label>

          {manuell && (
            <label htmlFor="commission_amount" className="flex flex-col gap-1">
              <span className="text-micro text-ink-500">Provision i kronor</span>
              <input
                id="commission_amount"
                name="commission_amount"
                inputMode="decimal"
                placeholder="3 200"
                className={KONTROLL}
              />
              <span className="text-small text-ink-500">
                Kräver en anteckning nedan. En avvikande provision utan skäl är det första någon
                ifrågasätter i efterhand.
              </span>
            </label>
          )}

          <label className="flex items-center gap-2 text-small text-ink-700">
            <input type="checkbox" name="godkann" defaultChecked className="size-4" />
            Godkänn direkt
          </label>
        </>
      )}

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
            ? "Provisionen hämtas ur matrisen efter signeringsdatum och fryses på ordern."
            : "Ordern räknas först när den godkänts."}
        </p>
      </div>
    </form>
  );
}
