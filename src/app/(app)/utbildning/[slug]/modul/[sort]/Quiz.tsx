"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Notis } from "@/components/ui/Notis";
import { lamnaQuiz, type KursState } from "../../../actions";

const TOM: KursState = {};

type Fraga = { id: string; prompt: string; alternativ: { id: string; label: string }[] };

/**
 * Alternativen kommer hit utan facit — `quiz_option` ar stangd for klienten och
 * lases av server actionen. Det finns alltsa inget ratt svar att hitta i
 * sidkallan, hur mycket man an letar.
 */
export function Quiz({
  kursId,
  modulId,
  fragor,
  nastaHref,
}: {
  kursId: string;
  modulId: string;
  fragor: Fraga[];
  nastaHref: string;
}) {
  const router = useRouter();
  const [state, skicka, vantar] = useActionState(lamnaQuiz, TOM);

  if (state.ok) {
    return (
      <div className="flex flex-col gap-4">
        <Notis ton="ok">{state.ok}</Notis>
        <div>
          <Button onClick={() => router.push(nastaHref)}>Fortsätt</Button>
        </div>
      </div>
    );
  }

  return (
    <form action={skicka} className="flex flex-col gap-6">
      <input type="hidden" name="kurs_id" value={kursId} />
      <input type="hidden" name="modul_id" value={modulId} />

      {state.fel && <Notis ton="danger">{state.fel}</Notis>}

      {fragor.map((f, i) => (
        <fieldset key={f.id} className="flex flex-col gap-2">
          <legend className="mb-2 text-body font-semibold text-ink-900">
            {i + 1}. {f.prompt}
          </legend>
          {f.alternativ.map((a) => (
            <label
              key={a.id}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-3 text-body text-ink-700 transition-colors duration-fast hover:bg-surface-alt has-checked:bg-brand-tint has-checked:text-brand-ink"
            >
              <input
                type="radio"
                name={`fraga_${f.id}`}
                value={a.id}
                required
                className="size-4 accent-brand-600"
              />
              <span>{a.label}</span>
            </label>
          ))}
        </fieldset>
      ))}

      <div>
        <Button type="submit" laddar={vantar}>
          Lämna in
        </Button>
      </div>
    </form>
  );
}
