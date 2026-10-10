"use client";

import { useState, type ReactNode } from "react";
import { KONTROLL } from "@/components/ui/Field";

export type Provisionsform = "belopp" | "procent";

/**
 * 0078. Provisionen som skrevs nar en fri order lades in, som valjarens
 * startlage — eller `null` nar ingen angavs. Godkannandet och redigeringen
 * forifylls med den, sa att det som skrevs ar det som star i faltet.
 */
export function angivetForval(order: {
  proposed_commission_amount?: number | null;
  proposed_commission_percent?: number | null;
}): { form: Provisionsform; varde: string } | null {
  if (order.proposed_commission_percent != null) {
    return { form: "procent", varde: String(order.proposed_commission_percent).replace(".", ",") };
  }
  if (order.proposed_commission_amount != null) {
    return { form: "belopp", varde: String(order.proposed_commission_amount).replace(".", ",") };
  }
  return null;
}

/**
 * Provisionen pa en fri order: i kronor ELLER i procent.
 *
 * Bestallaren 2026-10-09: *"maste jag kunna valja provision ocksa antingen
 * procent sats eller fast belopp"*. Samma valjare star pa de tre stallen dar en
 * fri order far sin provision — inmatningen, godkannandet och rattelsen — sa att
 * en fast provision inte kan sattas pa ett stalle och tyst raknas om pa ett
 * annat.
 *
 * ===========================================================================
 * `provision_form` SKICKAS ALLTID MED, och det ar det som gor faltet handsatt.
 *
 * `raknaFramProvision` later ett ifyllt falt ga fore chefsregeln BARA nar
 * valjaren finns i inskickningen. Ett tomt falt betyder "rakna fram det" — ur
 * chefens sats pa en egen order, ur utkopssatsen pa en utkopsaffar.
 *
 * FALTNAMNET BYTS MED VALET, i stallet for att bada falten finns och det ena ar
 * tomt. Da kan servern aldrig fa ett belopp och en procent pa samma gang och
 * behova gissa vilket som menades.
 * ===========================================================================
 */
export function Provisionsval({
  forval = { form: "belopp", varde: "" },
  styrd,
  onAndring,
  hjalp,
}: {
  /** Startlaget nar komponenten haller sitt eget tillstand (godkannandet, rattelsen). */
  forval?: { form: Provisionsform; varde: string };
  /**
   * Laget, nar formularet runt omkring haller det. Inmatningen gor det: den
   * nollstaller hela formularet efter en lagd order och raknar provisionen i
   * forhandsvisningen medan man skriver.
   */
  styrd?: { form: Provisionsform; varde: string };
  onAndring?: (form: Provisionsform, varde: string) => void;
  /** Texten under faltet. Far valet, eftersom "lamna tomt" betyder samma sak i bada. */
  hjalp?: (form: Provisionsform) => ReactNode;
}) {
  const [egen, setEgen] = useState(forval);
  const { form, varde } = styrd ?? egen;

  const andra = (nyForm: Provisionsform, nyttVarde: string) => {
    setEgen({ form: nyForm, varde: nyttVarde });
    onAndring?.(nyForm, nyttVarde);
  };

  // VARDET TOMS VID BYTE. "3 200" ar inte en procentsats, och "40" kronor ar
  // inte vad nagon menade nar hen bytte fran procent.
  const byt = (ny: Provisionsform) => andra(ny, "");

  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-micro text-ink-500">Provision</legend>
      <input type="hidden" name="provision_form" value={form} />

      <div className="flex gap-2">
        <input
          name={form === "procent" ? "commission_percent" : "commission_amount"}
          inputMode="decimal"
          aria-label={form === "procent" ? "Provision i procent" : "Provision i kronor"}
          placeholder={form === "procent" ? "40" : "3 200"}
          className={KONTROLL}
          value={varde}
          onChange={(e) => andra(form, e.target.value)}
        />
        <div role="radiogroup" aria-label="Provisionen anges i" className="flex shrink-0 gap-1">
          {(
            [
              ["belopp", "kr"],
              ["procent", "%"],
            ] as const
          ).map(([v, etikett]) => (
            <label
              key={v}
              className={
                "flex cursor-pointer items-center rounded-sm px-3 text-small shadow-elev-1 " +
                (form === v
                  ? "bg-brand-600 font-semibold text-ink-inv"
                  : "bg-surface text-ink-700 hover:bg-surface-alt")
              }
            >
              <input
                type="radio"
                name="provision_enhet"
                value={v}
                checked={form === v}
                onChange={() => byt(v)}
                className="sr-only"
              />
              {etikett}
            </label>
          ))}
        </div>
      </div>

      {hjalp && <span className="text-small text-ink-500">{hjalp(form)}</span>}
    </fieldset>
  );
}
