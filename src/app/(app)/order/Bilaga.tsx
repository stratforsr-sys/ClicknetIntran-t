"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Notis } from "@/components/ui/Notis";
import { Filuppladdning } from "@/components/Filuppladdning";
import type { Orderforslag, Forslagsfalt } from "@/lib/orderbilaga";
import {
  forberedOrderbilaga,
  lasAvtalsforslag,
  rattaFranAvtal,
  registreraOrderbilaga,
  taBortOrderbilaga,
  type Orderstate,
} from "./actions";

/**
 * E13 steg 9: avtals-PDF:en pa en order.
 *
 * ===========================================================================
 * UTLASNINGEN FORIFYLLER. DEN SPARAR ALDRIG.
 *
 * Bestallarens krav (avsnitt 3.1): ett falt som fyllts i av en maskin och
 * godkants av en manniska ar nagot annat an ett falt ingen last.
 *
 * Flodet ar darfor tre steg med en manniska i mitten:
 *
 *   1. Filen laddas upp och kopplas till ordern.
 *   2. "Läs ur avtalet" laser texten och visar ett FORSLAG bredvid orderns
 *      nuvarande varde, med utdraget ur avtalet som gav svaret.
 *   3. Anvandaren kryssar i det som ska anvandas och trycker.
 *
 * Utan steg 3 andras ingenting. Och en godkand order gar inte att andra alls —
 * bade actionen och triggern i 0034 nekar det, for provisionen ar frusen dar.
 * ===========================================================================
 */

const FALTNAMN: Record<Forslagsfalt, string> = {
  company_name: "Bolagsnamn",
  org_number: "Organisationsnummer",
  contact_name: "Kontaktperson",
  phone: "Telefon",
  package_id: "Paket",
  term_months: "Avtalstid (månader)",
  signed_on: "Signeringsdatum",
};

/** Formularfaltet varje forslagsfalt skrivs till. `phone` heter olika. */
const FORMULARFALT: Record<Forslagsfalt, string> = {
  company_name: "company_name",
  org_number: "org_number",
  contact_name: "contact_name",
  phone: "contact_phone",
  package_id: "package_id",
  term_months: "term_months",
  signed_on: "signed_on",
};

export type Orderbilaga = {
  id: string;
  filename: string | null;
  uploaded_at: string;
};

export function Bilaga({
  orderId,
  bilagor,
  garAttRatta,
  nuvarande,
}: {
  orderId: string;
  bilagor: Orderbilaga[];
  /** Bara en order som annu inte godkants gar att ratta. */
  garAttRatta: boolean;
  /** Orderns nuvarande varden, for jamforelsen. */
  nuvarande: Partial<Record<Forslagsfalt, string>>;
}) {
  const [forslag, setForslag] = useState<Orderforslag | null>(null);
  const [lasfel, setLasfel] = useState<string | null>(null);
  const [laser, startaLasning] = useTransition();
  const [bortState, bortAction] = useActionState<Orderstate, FormData>(taBortOrderbilaga, {});

  function las(fileId: string) {
    setLasfel(null);
    startaLasning(async () => {
      const svar = await lasAvtalsforslag(orderId, fileId);
      if ("fel" in svar) {
        setLasfel(svar.fel);
        setForslag(null);
        return;
      }
      setForslag(svar.forslag);
      if (Object.keys(svar.forslag).length === 0) {
        setLasfel(
          "Ingenting gick att läsa ur avtalet. Är det en inskannad PDF utan textlager fyller" +
            " du i fälten för hand — bilagan ligger kvar ändå.",
        );
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {bilagor.length > 0 && (
        <ul className="flex flex-col gap-2">
          {bilagor.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-3">
              {/*
                Vanlig <a> och aldrig <Link>: Next forladdar lankar nar musen
                nuddar dem, och varje forladdning hade blivit en LOGGAD OPPNING
                som aldrig skedde. Regeln star i 0022.
              */}
              <a
                href={`/filer/${b.id}`}
                className="text-small font-semibold text-ink-900 underline"
              >
                {b.filename ?? "Avtal"}
              </a>
              <span className="text-micro text-ink-500">{b.uploaded_at.slice(0, 10)}</span>

              <Button
                type="button"
                size="sm"
                variant="sekundar"
                disabled={laser}
                onClick={() => las(b.id)}
              >
                {laser ? "Läser…" : "Läs ur avtalet"}
              </Button>

              <form action={bortAction}>
                <input type="hidden" name="id" value={orderId} />
                <input type="hidden" name="fil_id" value={b.id} />
                <Button type="submit" size="sm" variant="diskret">
                  Ta bort
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {bortState.fel && <Notis ton="danger">{bortState.fel}</Notis>}
      {lasfel && <Notis ton="warn">{lasfel}</Notis>}

      {forslag && Object.keys(forslag).length > 0 && (
        <Forslagsformular
          orderId={orderId}
          forslag={forslag}
          nuvarande={nuvarande}
          garAttRatta={garAttRatta}
        />
      )}

      <Filuppladdning
        andamal="sales_order"
        etikett="Bifoga avtalet"
        hjalp="PDF. Texten i avtalet går att läsa ut och förifylla orderns fält med — ingenting sparas förrän du godkänner varje fält."
        knapp="Ladda upp"
        forbered={(namn, mime, byte) => forberedOrderbilaga(orderId, namn, mime, byte)}
        registrera={(fileId, namn) => registreraOrderbilaga(orderId, fileId, namn)}
      />
    </div>
  );
}

function Forslagsformular({
  orderId,
  forslag,
  nuvarande,
  garAttRatta,
}: {
  orderId: string;
  forslag: Orderforslag;
  nuvarande: Partial<Record<Forslagsfalt, string>>;
  garAttRatta: boolean;
}) {
  const [state, action, vantar] = useActionState<Orderstate, FormData>(rattaFranAvtal, {});

  const falt = Object.entries(forslag) as [Forslagsfalt, { varde: string; kalla: string }][];

  return (
    <form action={action} className="flex flex-col gap-3 rounded-sm bg-canvas p-4">
      <input type="hidden" name="id" value={orderId} />

      <p className="text-small font-semibold text-ink-900">
        {falt.length} {falt.length === 1 ? "fält" : "fält"} lästes ur avtalet
      </p>

      <ul className="flex flex-col gap-3">
        {falt.map(([namn, f]) => {
          const nu = nuvarande[namn];
          const skiljerSig = nu !== undefined && nu !== f.varde;

          return (
            <li key={namn} className="flex flex-col gap-1">
              <label className="flex flex-wrap items-baseline gap-2">
                <input
                  type="checkbox"
                  name={FORMULARFALT[namn]}
                  value={f.varde}
                  // FORVALT BARA DAR DET SKILJER SIG. Ett falt som redan
                  // stammer behover inte skrivas om, och en lista dar allt ar
                  // ikryssat lar folk att trycka utan att lasa.
                  defaultChecked={skiljerSig}
                  disabled={!garAttRatta}
                />
                <span className="text-small font-semibold text-ink-900">{FALTNAMN[namn]}</span>
                <span className="text-small text-ink-900">{f.varde}</span>
                {skiljerSig && (
                  <span className="text-small text-warn-ink">
                    (ordern säger {nu || "ingenting"})
                  </span>
                )}
              </label>
              <p className="max-w-[70ch] pl-6 text-micro text-ink-500">Ur avtalet: {f.kalla}</p>
            </li>
          );
        })}
      </ul>

      {garAttRatta ? (
        <div>
          <Button type="submit" size="sm" variant="sekundar" disabled={vantar}>
            Använd de ikryssade
          </Button>
        </div>
      ) : (
        <Notis ton="info">
          Ordern är godkänd, så fälten går inte att ändra — provisionen är frusen på den.
          Stämmer avtalet inte: makulera ordern och lägg en ny.
        </Notis>
      )}

      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}
    </form>
  );
}
