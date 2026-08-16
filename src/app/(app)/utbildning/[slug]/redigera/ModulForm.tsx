"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { sparaModul, type KursState } from "../../actions";

const TOM: KursState = {};

export type Modul = {
  id: string;
  sort: number;
  title: string;
  body_md: string;
  kind: string;
  fragor: string;
};

export function ModulForm({
  kursId,
  modul,
  onSparad,
}: {
  kursId: string;
  modul?: Modul;
  onSparad?: () => void;
}) {
  const [state, skicka, vantar] = useActionState(
    async (prev: KursState, form: FormData) => {
      const svar = await sparaModul(prev, form);
      if (svar.ok) onSparad?.();
      return svar;
    },
    TOM,
  );
  const [kind, setKind] = useState(modul?.kind ?? "reading");
  const namn = (f: string) => `${f}-${modul?.id ?? "ny"}`;

  return (
    <form action={skicka} className="flex flex-col gap-4">
      <input type="hidden" name="kurs_id" value={kursId} />
      {modul && <input type="hidden" name="modul_id" value={modul.id} />}
      <input type="hidden" name="kind" value={kind} />

      {state.ok && <Notis ton="ok">{state.ok}</Notis>}
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1">
          <Field label="Rubrik" namn={namn("titel")}>
            {/* Ratt element direkt, inte <Input>: den satter name={namn} efter
                sin spread och skulle skriva over faltets namn med sitt id. Har
                behovs bada — unikt id per modul, men samma name i alla. */}
            <input
              id={namn("titel")}
              name="titel"
              defaultValue={modul?.title ?? ""}
              required
              placeholder="Så bokar du ett möte"
              className={KONTROLL}
            />
          </Field>
        </div>

        <div
          role="radiogroup"
          aria-label="Modultyp"
          className="flex gap-1 rounded-full bg-canvas p-1"
        >
          {(["reading", "quiz"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={kind === v}
              onClick={() => setKind(v)}
              className={`min-h-9 rounded-full px-4 text-small font-semibold transition-colors duration-fast ${
                kind === v ? "bg-surface text-ink-900 shadow-elev-1" : "text-ink-500 hover:text-ink-900"
              }`}
            >
              {v === "reading" ? "Läsning" : "Prov"}
            </button>
          ))}
        </div>
      </div>

      <Field
        label={kind === "quiz" ? "Text före provet" : "Innehåll"}
        namn={namn("innehall")}
        hjalp="Markdown. Rubriker, listor och tabeller fungerar."
      >
        <textarea
          id={namn("innehall")}
          name="innehall"
          rows={kind === "quiz" ? 4 : 12}
          defaultValue={modul?.body_md ?? ""}
          className={`${KONTROLL} resize-y font-mono text-small`}
        />
      </Field>

      {kind === "quiz" && (
        <Field
          label="Frågor"
          namn={namn("fragor")}
          hjalp="En fråga per stycke. Svarsalternativ på egna rader, * framför det rätta."
        >
          <textarea
            id={namn("fragor")}
            name="fragor"
            rows={12}
            defaultValue={modul?.fragor ?? ""}
            placeholder={"Vad gör du vid sjukdom?\n* Ringer chefen samma dag\n- Mejlar veckan efter\n\nNär behövs läkarintyg?\n* Från dag 8\n- Aldrig"}
            className={`${KONTROLL} resize-y font-mono text-small`}
          />
        </Field>
      )}

      <div>
        <Button type="submit" size="sm" laddar={vantar}>
          {modul ? "Spara modulen" : "Lägg till modulen"}
        </Button>
      </div>
    </form>
  );
}
