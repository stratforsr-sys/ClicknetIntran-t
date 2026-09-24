"use client";

import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Notis } from "@/components/ui/Notis";
import { KONTROLL } from "@/components/ui/Field";
import { rattningslage } from "@/lib/prov";
import { rattaProv, returneraProv } from "../actions";
import type { KursState } from "../../actions";

const TOM: KursState = {};

export type Rattningsfraga = {
  id: string;
  sort: number;
  prompt: string;
  guidance: string | null;
  max_points: number;
  svar: string;
  poang: number | null;
  kommentar: string | null;
};

/**
 * Rattningen: poang och ord, fraga for fraga.
 *
 * ===========================================================================
 * VARFOR SKALAN AR KNAPPAR OCH INTE ETT SIFFERFALT
 *
 * Rollspelet har ett `<input type=number>` per kriterium, och det duger for
 * atta rader. Har ar det tjugo, och tjugo sifferfalt ar tjugo tillfallen att
 * skriva 3 i en ruta som tar hogst 2. Knapparna kan bara ge ett giltigt varde,
 * och de gar dessutom att satta med ett klick i stallet for tre.
 *
 * SUMMAN RAKNAS MEDAN HON RATTAR, med samma funktion som servern anvander
 * (`rattningslage()` i src/lib/prov.ts). Den som satter tjugo betyg utan att se
 * vart de bar vet inte om provet ligger pa 69 eller 71 procent forran hon
 * tryckt — och gransen gar mitt emellan.
 *
 * TVA KNAPPAR, TVA HANDLINGAR. "Satt betyg" ar slutgiltigt; "Skicka tillbaka"
 * lamnar provet obedomt hos saljaren med kommentarerna kvar. Returen kraver
 * INGA poang — det ar hela poangen med den: provet gick inte att bedoma.
 * ===========================================================================
 */
export function Rattning({
  id,
  fragor,
  grans,
  lastFast,
}: {
  id: string;
  fragor: Rattningsfraga[];
  grans: number;
  lastFast: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, rattaAction, rattar] = useActionState(rattaProv, TOM);
  const [returState, returAction, returnerar] = useActionState(returneraProv, TOM);

  const [poang, setPoang] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(fragor.map((f) => [f.id, f.poang])),
  );

  const lage = rattningslage(fragor, poang);
  const andel = lage.tak === 0 ? 0 : Math.round((lage.summa / lage.tak) * 100);

  const svar = state.fel || state.ok ? state : returState;

  return (
    <form ref={formRef} action={rattaAction} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />

      {svar.fel && <Notis ton="danger">{svar.fel}</Notis>}
      {svar.ok && <Notis ton="ok">{svar.ok}</Notis>}

      {fragor.map((f) => (
        <section key={f.id} className="rounded-md bg-surface p-4 shadow-elev-1 md:p-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-canvas text-micro font-semibold text-ink-500">
              {f.sort}
            </span>
            <p className="min-w-0 flex-1 text-body font-semibold text-ink-900">{f.prompt}</p>
          </div>

          {f.guidance && (
            /* Rattarstodet. Star FORE svaret med flit — det ar det man laser
               svaret mot, och en minneslapp under svaret laser man efterat. */
            <p className="mt-3 rounded-sm bg-info-tint px-3 py-2 text-small text-info-ink">
              <span className="font-semibold">Rättarstöd:</span> {f.guidance}
              <span className="mt-1 block text-micro">Syns bara för dig som rättar.</span>
            </p>
          )}

          <p className="mt-3 whitespace-pre-line rounded-sm bg-canvas px-3 py-2.5 text-body text-ink-900">
            {f.svar || <span className="text-ink-300">Inget svar.</span>}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div
              role="radiogroup"
              aria-label={`Poäng på fråga ${f.sort}`}
              className="flex gap-1 rounded-full bg-canvas p-1"
            >
              {Array.from({ length: f.max_points + 1 }, (_, p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={poang[f.id] === p}
                  disabled={lastFast}
                  onClick={() => setPoang((tidigare) => ({ ...tidigare, [f.id]: p }))}
                  className={`min-h-9 min-w-11 rounded-full px-3 text-small font-semibold transition-colors duration-fast disabled:opacity-45 ${
                    poang[f.id] === p
                      ? p === 0
                        ? "bg-danger-tint text-danger-ink shadow-elev-1"
                        : p === f.max_points
                          ? "bg-ok-tint text-ok-ink shadow-elev-1"
                          : "bg-warn-tint text-warn-ink shadow-elev-1"
                      : "text-ink-500 hover:text-ink-900"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <span className="text-micro text-ink-500">
              {f.max_points === 2 ? "0 fel · 1 delvis · 2 rätt" : `0–${f.max_points} poäng`}
            </span>
            {poang[f.id] != null && <input type="hidden" name={`poang_${f.id}`} value={poang[f.id]!} />}
          </div>

          <label htmlFor={`kommentar_${f.id}`} className="mt-3 block">
            <span className="text-small font-semibold text-ink-700">Kommentar till svaret</span>
            <span className="ml-2 text-micro text-ink-500">Valfri. Syns för säljaren.</span>
            <textarea
              id={`kommentar_${f.id}`}
              name={`kommentar_${f.id}`}
              rows={2}
              defaultValue={f.kommentar ?? ""}
              disabled={lastFast}
              className={`${KONTROLL} mt-1.5 resize-y text-small`}
            />
          </label>
        </section>
      ))}

      <section className="rounded-md bg-surface p-4 shadow-elev-1 md:p-5">
        <label htmlFor="note" className="block">
          <span className="text-body font-semibold text-ink-900">Återkoppling på hela provet</span>
          <span className="mt-1 block text-small text-ink-500">
            Obligatorisk. Ett betyg utan ord lär ingen sig något av — det är hela skälet att provet
            skrivs med egna ord. Samma fält bär beskedet om du skickar tillbaka provet i stället.
          </span>
          <textarea
            id="note"
            name="note"
            rows={5}
            disabled={lastFast}
            required
            className={`${KONTROLL} mt-2 resize-y text-body`}
          />
        </label>
      </section>

      {!lastFast && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-full bg-surface px-4 py-3 shadow-elev-2">
          <Button type="submit" laddar={rattar} disabled={!lage.klar || returnerar}>
            Sätt betyg
          </Button>
          <Button
            type="button"
            variant="sekundar"
            size="sm"
            laddar={returnerar}
            disabled={rattar}
            onClick={() => {
              if (formRef.current) returAction(new FormData(formRef.current));
            }}
          >
            Skicka tillbaka för komplettering
          </Button>

          <div className="flex flex-wrap items-baseline gap-x-3 text-small text-ink-500">
            <span className="tnum">
              {lage.satta} av {lage.antal} bedömda
            </span>
            {lage.klar ? (
              <>
                <span className="tnum font-semibold text-ink-900">
                  {lage.summa} av {lage.tak} p · {andel} %
                </span>
                <Badge ton={andel >= grans ? "ok" : "danger"}>
                  {andel >= grans ? "Godkänt" : "Under gränsen"}
                </Badge>
              </>
            ) : (
              <span className="tnum">{lage.summa} p hittills</span>
            )}
          </div>
        </div>
      )}
    </form>
  );
}
