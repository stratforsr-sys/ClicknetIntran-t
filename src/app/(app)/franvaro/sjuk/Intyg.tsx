"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { storlek } from "@/lib/filer";
import { laddaUppIntyg, type FranvaroState } from "../actions";

export type Intygsfil = {
  id: string;
  uppladdat: string;
  byte: number;
  oppningar: { vem: string; nar: string; egen: boolean }[];
};

/**
 * E7.10, AC-3.22, K36: läkarintyget.
 *
 * Två saker syns här som inte syns någon annanstans i navet:
 *
 * 1. Länken går till `/filer/[id]`, aldrig till Supabase. Adressen dit filen
 *    faktiskt ligger finns inte i den här filen och når aldrig webbläsaren
 *    annat än som en omdirigering som lever i trettio sekunder.
 *
 * 2. Öppningarna står utskrivna, och de står utskrivna även för den som är
 *    sjuk. En logg som bara granskaren ser uppfyller kravet men gör ingenting
 *    för den kravet finns till för. Att se att chefen öppnat sitt intyg två
 *    gånger är hela skillnaden mellan att bli registrerad och att bli
 *    informerad.
 *
 * Ett vanligt <a> och inte <Link>: Next förladdar länkar när musen nuddar dem,
 * och varje sådan förladdning hade blivit en loggad öppning som aldrig skedde.
 */
export function Intyg({
  rapportId,
  filer,
  mottaget,
  egenAnmalan,
}: {
  rapportId: string;
  filer: Intygsfil[];
  mottaget: string | null;
  egenAnmalan: boolean;
}) {
  const [state, action, laddar] = useActionState<FranvaroState, FormData>(laddaUppIntyg, {});

  return (
    <div className="mt-3 rounded-sm bg-surface-alt p-3">
      <p className="text-small font-semibold text-ink-700">Läkarintyg</p>

      {state.fel && (
        <div className="mt-2">
          <Notis ton="danger">{state.fel}</Notis>
        </div>
      )}
      {state.ok && (
        <div className="mt-2">
          <Notis ton="ok">{state.ok}</Notis>
        </div>
      )}

      {filer.length === 0 ? (
        <p className="mt-1 text-small text-ink-500">
          {mottaget
            ? `Kvitterat som mottaget ${mottaget}. Ingen fil finns i navet — intyget kom på papper.`
            : "Inget intyg inlämnat."}
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-3">
          {filer.map((f) => (
            <li key={f.id}>
              <a
                href={`/filer/${f.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-body font-semibold text-brand-700 underline underline-offset-2 hover:text-brand-900"
              >
                Öppna intyget
              </a>
              <span className="ml-2 text-micro text-ink-500">
                Inlämnat {f.uppladdat.slice(0, 10)} · {storlek(f.byte)}
              </span>

              <p className="mt-1 text-micro text-ink-500">
                {f.oppningar.length === 0
                  ? "Ingen har öppnat filen än."
                  : `Öppnad ${f.oppningar.length} ${f.oppningar.length === 1 ? "gång" : "gånger"}.`}
              </p>

              {f.oppningar.length > 0 && (
                <ul className="mt-1 flex flex-col gap-0.5">
                  {f.oppningar.slice(0, 5).map((o, i) => (
                    <li key={i} className="text-micro text-ink-500">
                      {o.egen ? "Du" : o.vem} · {o.nar.slice(0, 16).replace("T", " ")}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="id" value={rapportId} />
        <label htmlFor={`fil_${rapportId}`} className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">
            {filer.length === 0 ? "Lämna in intyget" : "Lämna in ett till"}
          </span>
          {/* Rakt <input> och inte <Input>: flera anmalningar pa samma sida
              hade annars delat id. Samma skal som i Chefshandlingar. */}
          <input
            id={`fil_${rapportId}`}
            name="fil"
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            className={`${KONTROLL} max-w-72 py-1.5 text-small`}
          />
        </label>
        <Button type="submit" size="sm" variant="sekundar" laddar={laddar}>
          Ladda upp
        </Button>
      </form>

      <p className="mt-2 text-micro text-ink-500">
        PDF, JPG eller PNG, högst 10 MB. Filen når bara dig{egenAnmalan ? ", din chef" : ", den som anmälan gäller"} och
        ledningen. Varje öppning loggas och syns i listan ovan — även för den
        som är sjuk.
      </p>
    </div>
  );
}
