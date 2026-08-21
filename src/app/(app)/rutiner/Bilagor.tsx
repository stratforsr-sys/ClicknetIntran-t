"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { Ikon } from "@/components/shell/Ikon";
import { storlek } from "@/lib/filer";
import { laddaUppBilaga, taBortBilaga, type DokumentState } from "./actions";

export type Bilaga = {
  id: string;
  namn: string;
  byte: number;
  sokbar: boolean;
};

/**
 * E2.12: bilagor pa ett dokument.
 *
 * Lankarna gar till `/filer/[id]` och aldrig till Supabase — samma vag som
 * lakarintyget, och darmed samma signerade kortlivade URL och samma rad i
 * atkomstloggen (K36, X5). Att en prislista inte ar kanslig andrar ingenting:
 * en andra vag till en fil hade varit en vag utan logg, och da hade det funnits
 * tva svar pa fragan hur man kommer at en fil.
 *
 * Ett vanligt <a> och inte <Link>, av samma skal som pa sjuksidan: Next
 * forladdar <Link> nar musen nuddar den, och varje forladdning hade blivit en
 * loggad oppning som aldrig skedde.
 */
export function Bilagor({
  dokumentId,
  bilagor,
  farRedigera,
}: {
  dokumentId: string;
  bilagor: Bilaga[];
  farRedigera: boolean;
}) {
  const [uppState, uppAction, laddar] = useActionState<DokumentState, FormData>(laddaUppBilaga, {});
  const [bortState, bortAction] = useActionState<DokumentState, FormData>(taBortBilaga, {});
  const fel = uppState.fel ?? bortState.fel;

  if (bilagor.length === 0 && !farRedigera) return null;

  return (
    <div>
      <h2 className="text-h2 text-ink-900">Bilagor</h2>

      {fel && (
        <div className="mt-3">
          <Notis ton="danger">{fel}</Notis>
        </div>
      )}

      {bilagor.length === 0 ? (
        <p className="mt-2 text-small text-ink-500">Inga bilagor.</p>
      ) : (
        <ul className="mt-3 flex flex-col">
          {bilagor.map((b) => (
            <li
              key={b.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-canvas py-2.5 last:border-0"
            >
              <Ikon namn="rutiner" className="size-4 shrink-0 text-ink-500" />
              <a
                href={`/filer/${b.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate text-body text-brand-700 underline underline-offset-2 hover:text-brand-900"
              >
                {b.namn}
              </a>
              <span className="tnum shrink-0 text-micro text-ink-500">{storlek(b.byte)}</span>
              {b.sokbar && (
                <span className="shrink-0 text-micro text-ink-300" title="Texten i filen går att söka på">
                  sökbar
                </span>
              )}
              {farRedigera && (
                <form action={bortAction} className="shrink-0">
                  <input type="hidden" name="id" value={dokumentId} />
                  <input type="hidden" name="fil_id" value={b.id} />
                  <Button type="submit" size="sm" variant="diskret">
                    Ta bort
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {farRedigera && (
        <form action={uppAction} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={dokumentId} />
          <label htmlFor="bilaga" className="flex flex-col gap-1">
            <span className="text-micro text-ink-500">Lägg till en bilaga</span>
            <input
              id="bilaga"
              name="fil"
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              className={`${KONTROLL} max-w-72 py-1.5 text-small`}
            />
          </label>
          <Button type="submit" size="sm" variant="sekundar" laddar={laddar}>
            Ladda upp
          </Button>
          <p className="w-full text-micro text-ink-500">
            PDF, JPG eller PNG, högst 10 MB. Texten i en PDF blir sökbar i navet. En bilaga skapar
            ingen ny version och kräver därför ingen ny kvittens.
          </p>
        </form>
      )}
    </div>
  );
}
