"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { BINDNINGSTID_MAX, BINDNINGSTID_MIN, LOPTIDER, type Paket } from "@/lib/order";
import type { Redigerbar } from "./Atgarder";
import { redigeraOgodkand, type Orderstate } from "./actions";
import { angivetForval, Provisionsval } from "./Provisionsval";

/**
 * Redigeringen av en order som ännu inte är godkänd — utkast eller inskickad
 * (beställaren 2026-10-08).
 *
 * ===========================================================================
 * INGA PENGAR I FORMULÄRET
 *
 * Ordervärde och provision fryses när ordern godkänns, inte här. Formuläret
 * ändrar det godkännandet räknar PÅ: paket, bindningstid, månadsbelopp för en
 * fri order, signeringsdatum, säljare och utköp — och sedan 0078 den angivna
 * provisionen på en fri order, som inte fryses utan är vad godkännandet ska
 * räkna med. Därför ingen ruta om fastställda
 * månader och inget skälfält — det hör till `Rattelse`, som ändrar frysta belopp.
 *
 * `full` är chefskretsen. Säljaren som rättar sitt eget utkast ser inte
 * säljarvalet eller "följer inte paketreglerna"; `redigeraOgodkand` ignorerar
 * dem ändå om de skulle skickas.
 * ===========================================================================
 */
export function Redigering({
  id,
  order,
  paket,
  personer,
  full,
  idag,
}: {
  id: string;
  order: Redigerbar;
  paket: Paket[];
  personer: { id: string; namn: string }[];
  full: boolean;
  idag: string;
}) {
  const [state, kor, vantar] = useActionState<Orderstate, FormData>(redigeraOgodkand, {});

  // Ett månadsbelopp på en ej godkänd order ÄR det som gör den fri — se
  // `raknaFramProvision`. Kryssrutan speglar det, och bara chefskretsen ser den.
  const [fritt, setFritt] = useState(order.monthly_amount !== null);
  const [harUtkop, setHarUtkop] = useState(order.buyout_amount !== null && order.buyout_amount > 0);
  const [finans, setFinans] = useState(order.financed);

  return (
    <form action={kor} className="flex flex-col gap-3 rounded-sm bg-surface-alt p-3">
      <input type="hidden" name="id" value={id} />

      <Notis ton="info">
        Ordern är inte godkänd, så ingenting är bokfört. Ordervärde och provision räknas när den
        godkänns.
      </Notis>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Bolagsnamn</span>
          <input name="company_name" required defaultValue={order.company_name} className={KONTROLL} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Organisationsnummer</span>
          <input name="org_number" required defaultValue={order.org_number} className={KONTROLL} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Kontaktperson</span>
          <input name="contact_name" required defaultValue={order.contact_name} className={KONTROLL} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Telefon</span>
          <input
            name="contact_phone"
            required
            inputMode="tel"
            aria-describedby={`telefon-hjalp-${id}`}
            defaultValue={order.contact_phone}
            className={KONTROLL}
          />
          <span id={`telefon-hjalp-${id}`} className="text-micro text-ink-500">
            Säkerställ att du lägger in det numret som har en samtalsinspelning av säljsamtalet
          </span>
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-micro text-ink-500">Mejl (valfritt)</span>
          <input
            name="contact_email"
            type="email"
            defaultValue={order.contact_email ?? ""}
            placeholder="kontakt@bolaget.se"
            className={KONTROLL}
          />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-micro text-ink-500">Gatuadress</span>
          <input name="customer_street" defaultValue={order.customer_street ?? ""} className={KONTROLL} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Postnummer</span>
          <input
            name="customer_postal_code"
            defaultValue={order.customer_postal_code ?? ""}
            className={KONTROLL}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Ort</span>
          <input name="customer_city" defaultValue={order.customer_city ?? ""} className={KONTROLL} />
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
        {/* Samma två former som i `Rattelse`: matrisens tre för en paketorder,
            ett fritt tal för en order utanför paketreglerna. Actionen avgör. */}
        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Bindningstid</span>
          {fritt ? (
            <input
              name="term_months"
              type="number"
              min={BINDNINGSTID_MIN}
              max={BINDNINGSTID_MAX}
              step={1}
              defaultValue={order.term_months}
              className={KONTROLL}
            />
          ) : (
            <select
              name="term_months"
              defaultValue={(LOPTIDER as readonly number[]).includes(order.term_months) ? order.term_months : 12}
              className={KONTROLL}
            >
              {LOPTIDER.map((m) => (
                <option key={m} value={m}>
                  {m} månader
                </option>
              ))}
            </select>
          )}
        </label>

        {full && (
          <label className="flex flex-col gap-1">
            <span className="text-micro text-ink-500">Säljare</span>
            <select name="salesperson_id" defaultValue={order.salesperson_id} className={KONTROLL}>
              {personer.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.namn}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Signeringsdatum</span>
          <input
            name="signed_on"
            type="date"
            required
            max={idag}
            defaultValue={order.signed_on}
            className={KONTROLL}
          />
          <span className="text-small text-ink-500">Styr vilken månad ordern räknas i.</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Avtalet börjar gälla</span>
          <input name="starts_on" type="date" required defaultValue={order.starts_on} className={KONTROLL} />
          <span className="text-small text-ink-500">Slutdatumet räknas härifrån.</span>
        </label>
      </div>

      <label className="flex items-center gap-2 text-small text-ink-700">
        <input type="checkbox" name="is_addon" defaultChecked={order.is_addon} className="size-4" />
        Tilläggsavtal på befintlig kund
      </label>

      <input type="hidden" name="har_utkop_ritad" value="1" />
      <label className="flex items-center gap-2 text-small text-ink-700">
        <input
          type="checkbox"
          name="har_utkop"
          checked={harUtkop}
          onChange={(e) => setHarUtkop(e.target.checked)}
          className="size-4"
        />
        Affären har ett utköp
      </label>
      {harUtkop && (
        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Utköp i kronor</span>
          <input
            name="buyout_amount"
            required
            inputMode="decimal"
            defaultValue={order.buyout_amount ?? ""}
            placeholder="5 000"
            className={KONTROLL}
          />
        </label>
      )}

      {/* FINANSEN (0079), med samma dolda falt som utkopet. Bara valet —
          avgiften raknas nar ordern godkanns. */}
      <input type="hidden" name="finans_ritad" value="1" />
      <label className="flex items-center gap-2 text-small text-ink-700">
        <input
          type="checkbox"
          name="finans"
          checked={finans}
          onChange={(e) => setFinans(e.target.checked)}
          className="size-4"
        />
        Finans — kunden betalar via vår finanspartner
      </label>

      {full && (
        <label className="flex items-center gap-2 text-small text-ink-700">
          <input
            type="checkbox"
            name="fri_order"
            checked={fritt}
            onChange={(e) => setFritt(e.target.checked)}
            className="size-4"
          />
          Ordern följer inte paketreglerna — månadsbeloppet sätts för hand
        </label>
      )}
      {full && fritt && (
        <label className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Kunden betalar per månad</span>
          <input
            name="monthly_amount"
            required
            inputMode="decimal"
            defaultValue={order.monthly_amount ?? ""}
            placeholder="1 495"
            className={KONTROLL}
          />
        </label>
      )}
      {/* 0078. Provisionen som ska gälla vid godkännandet. Fram till
          2026-10-09 sa texten här att den sattes först vid godkännandet — och
          det som skrevs i ny order kastades. */}
      {full && fritt && (
        <div className="sm:max-w-sm">
          <Provisionsval
            forval={angivetForval(order) ?? undefined}
            hjalp={() =>
              "Gäller när ordern godkänns. Lämna tomt så räknas den ur säljchefens sats om ordern är hens egen, eller ur utköpssatsen."
            }
          />
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-micro text-ink-500">Anteckning på ordern (valfri)</span>
        <input name="note" defaultValue={order.note ?? ""} className={KONTROLL} />
      </label>

      <div>
        <Button type="submit" size="sm" laddar={vantar}>
          Spara ändringarna
        </Button>
      </div>

      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}
    </form>
  );
}
