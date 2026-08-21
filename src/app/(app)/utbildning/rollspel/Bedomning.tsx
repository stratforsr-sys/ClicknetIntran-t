"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { bedomRollspel, type KursState } from "../actions";

/**
 * E8.7 / AC-6.7: chefens bedömning.
 *
 * Länken till inspelningen står FÖRE poängfälten, och det är avsiktligt:
 * databasen vägrar spara en bedömning från någon som aldrig öppnat filen
 * (triggern i 0024), så ett formulär där lyssnandet inte kommer först hade
 * bara gett ett fel efter allt arbete.
 *
 * Kryphålet — att öppna filen och låta bli att lyssna — går inte att täppa
 * till. Skillnaden mellan "kan inte göras av misstag" och "kan göras med
 * avsikt" är hela vad spärren kan åstadkomma, och den skillnaden är värd
 * något.
 */
export function Bedomning({
  id,
  fileId,
  kriterier,
}: {
  id: string;
  fileId: string;
  kriterier: { id: string; label: string; guidance: string | null; max_points: number }[];
}) {
  const [state, action, vantar] = useActionState<KursState, FormData>(bedomRollspel, {});

  return (
    <form action={action} className="mt-3 flex flex-col gap-4">
      <input type="hidden" name="id" value={id} />

      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}

      <div>
        {/* Vanligt <a>: Next förladdar <Link> när musen nuddar den, och varje
            förladdning hade blivit en loggad öppning som aldrig skedde. */}
        <a
          href={`/filer/${fileId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-body font-semibold text-brand-700 underline underline-offset-2 hover:text-brand-900"
        >
          Lyssna på inspelningen
        </a>
        <p className="mt-1 text-micro text-ink-500">
          Öppningen loggas och syns för säljaren. Bedömningen går inte att spara innan du öppnat
          filen.
        </p>
      </div>

      <ul className="flex flex-col">
        {kriterier.map((k) => (
          <li key={k.id} className="flex flex-wrap items-center gap-3 border-b border-canvas py-2.5 last:border-0">
            <span className="min-w-0 flex-1">
              <span className="block text-body text-ink-900">{k.label}</span>
              {k.guidance && <span className="block text-small text-ink-500">{k.guidance}</span>}
            </span>
            <label htmlFor={`poang_${k.id}`} className="flex shrink-0 items-center gap-2">
              <span className="text-micro text-ink-500">av {k.max_points}</span>
              <input
                id={`poang_${k.id}`}
                name={`poang_${k.id}`}
                type="number"
                min={0}
                max={k.max_points}
                required
                className={`${KONTROLL} tnum w-20 py-1.5 text-small`}
              />
            </label>
          </li>
        ))}
      </ul>

      <label htmlFor={`note_${id}`} className="flex flex-col gap-1">
        <span className="text-small font-semibold text-ink-700">Återkoppling</span>
        <span className="text-micro text-ink-500">
          Obligatorisk. Ett betyg utan ord lär ingen sig något av — det är hela skälet att
          rollspelet finns.
        </span>
        <textarea
          id={`note_${id}`}
          name="note"
          rows={4}
          required
          className={`${KONTROLL} resize-y text-small`}
        />
      </label>

      <div>
        <Button type="submit" size="sm" laddar={vantar}>
          Spara bedömningen
        </Button>
      </div>
    </form>
  );
}
