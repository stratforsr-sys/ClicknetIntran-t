"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, Input, KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { Ikon } from "@/components/shell/Ikon";
import { ROLES, ROLE_LABEL } from "@/lib/roles";
import { sparaKurs, taBortModul, flyttaModul, type KursState } from "../../actions";
import { ModulForm, type Modul } from "./ModulForm";

const TOM: KursState = {};

export type Kurs = {
  id: string;
  slug: string;
  title: string;
  description_md: string;
  status: string;
  audience_roles: string[];
  pass_threshold: number;
  retry_wait_hours: number;
  valid_months: number | null;
  due_days: number | null;
};

export function Redaktor({ kurs, moduler }: { kurs: Kurs; moduler: Modul[] }) {
  const router = useRouter();
  const [state, skicka, vantar] = useActionState(sparaKurs, TOM);
  const [oppen, setOppen] = useState<string | null>(null);
  const [nyModul, setNyModul] = useState(false);
  const publicerad = kurs.status === "published";

  return (
    <div className="flex flex-col gap-4">
      <form action={skicka} className="flex flex-col gap-4">
        <input type="hidden" name="kurs_id" value={kurs.id} />

        {state.ok && <Notis ton="ok">{state.ok}</Notis>}
        {state.fel && <Notis ton="danger">{state.fel}</Notis>}

        <Card>
          <CardHeader titel="Om kursen" />
          <div className="flex flex-col gap-5">
            <Field label="Titel" namn="titel">
              <Input namn="titel" defaultValue={kurs.title} required />
            </Field>

            <Field
              label="Beskrivning"
              namn="beskrivning"
              hjalp="Markdown. Visas överst på kursens sida."
            >
              <textarea
                id="beskrivning"
                name="beskrivning"
                rows={5}
                defaultValue={kurs.description_md}
                className={`${KONTROLL} resize-y font-mono text-small`}
              />
            </Field>

            <fieldset>
              <legend className="mb-2 text-small font-semibold text-ink-700">Målgrupp</legend>
              <p className="mb-3 text-small text-ink-500">
                Ingen roll vald betyder alla. Kursen blir obligatorisk för dem som matchar.
              </p>
              <div className="flex flex-wrap gap-2">
                {ROLES.map((r) => (
                  <label
                    key={r}
                    className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full bg-canvas px-3 text-small text-ink-700 transition-colors duration-fast has-checked:bg-brand-tint has-checked:text-brand-ink"
                  >
                    <input
                      type="checkbox"
                      name="roller"
                      value={r}
                      defaultChecked={kurs.audience_roles.includes(r)}
                      className="size-4 accent-brand-600"
                    />
                    {ROLE_LABEL[r]}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label="Godkäntgräns (%)"
                namn="pass_threshold"
                hjalp="Andel rätt som krävs på varje prov."
              >
                <Input
                  namn="pass_threshold"
                  type="number"
                  min={1}
                  max={100}
                  defaultValue={kurs.pass_threshold}
                  required
                />
              </Field>

              <Field
                label="Spärrtid vid omtag (timmar)"
                namn="retry_wait_hours"
                hjalp="0 = nytt försök direkt."
              >
                <Input
                  namn="retry_wait_hours"
                  type="number"
                  min={0}
                  defaultValue={kurs.retry_wait_hours}
                  required
                />
              </Field>

              <Field
                label="Certifikatet gäller (månader)"
                namn="valid_months"
                hjalp="Tomt = gäller tills vidare."
              >
                <Input
                  namn="valid_months"
                  type="number"
                  min={1}
                  defaultValue={kurs.valid_months ?? ""}
                />
              </Field>

              <Field
                label="Klar inom (dagar från anställningsstart)"
                namn="due_days"
                hjalp="Tomt = ingen frist. Styr vad som räknas som försenat."
              >
                <Input namn="due_days" type="number" min={1} defaultValue={kurs.due_days ?? ""} />
              </Field>
            </div>
          </div>
        </Card>

        <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-md bg-canvas/90 px-1 py-3 backdrop-blur-sm">
          <Button type="submit" laddar={vantar}>
            Spara
          </Button>
          {publicerad ? (
            <Button type="submit" name="publicera" value="0" variant="sekundar" laddar={vantar}>
              Avpublicera
            </Button>
          ) : (
            <Button
              type="submit"
              name="publicera"
              value="1"
              variant="sekundar"
              laddar={vantar}
              disabled={moduler.length === 0}
            >
              Publicera
            </Button>
          )}
          <Badge ton={publicerad ? "ok" : "neutral"}>{publicerad ? "Publicerad" : "Utkast"}</Badge>
          {!publicerad && moduler.length === 0 && (
            <span className="text-small text-ink-500">Lägg till minst en modul först.</span>
          )}
        </div>
      </form>

      <Card>
        <CardHeader
          titel="Moduler"
          beskrivning="Ordningen är den som deltagaren möter. Ett prov placeras oftast sist."
        />

        {moduler.length === 0 ? (
          <p className="text-small text-ink-500">Inga moduler än.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {moduler.map((m, i) => (
              <li key={m.id} className="rounded-sm bg-canvas">
                <div className="flex items-center gap-2 p-2">
                  <button
                    type="button"
                    onClick={() => setOppen(oppen === m.id ? null : m.id)}
                    aria-expanded={oppen === m.id}
                    className="flex min-h-11 flex-1 items-center gap-3 rounded-sm px-2 text-left text-body text-ink-900"
                  >
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface text-micro text-ink-500">
                      {i + 1}
                    </span>
                    <span className="flex-1">{m.title}</span>
                    {m.kind === "quiz" && <Badge ton="info">Prov</Badge>}
                  </button>

                  <form action={flyttaModul}>
                    <input type="hidden" name="kurs_id" value={kurs.id} />
                    <input type="hidden" name="modul_id" value={m.id} />
                    <input type="hidden" name="riktning" value="upp" />
                    <button
                      type="submit"
                      disabled={i === 0}
                      aria-label="Flytta upp"
                      className="grid size-11 place-items-center rounded-full text-ink-500 hover:bg-surface hover:text-ink-900 disabled:opacity-30"
                    >
                      <Ikon namn="tillbaka" className="size-4 rotate-90" />
                    </button>
                  </form>

                  <form action={flyttaModul}>
                    <input type="hidden" name="kurs_id" value={kurs.id} />
                    <input type="hidden" name="modul_id" value={m.id} />
                    <input type="hidden" name="riktning" value="ner" />
                    <button
                      type="submit"
                      disabled={i === moduler.length - 1}
                      aria-label="Flytta ner"
                      className="grid size-11 place-items-center rounded-full text-ink-500 hover:bg-surface hover:text-ink-900 disabled:opacity-30"
                    >
                      <Ikon namn="tillbaka" className="size-4 -rotate-90" />
                    </button>
                  </form>
                </div>

                {oppen === m.id && (
                  <div className="border-t border-ink-300/20 p-4">
                    <ModulForm
                      kursId={kurs.id}
                      modul={m}
                      onSparad={() => {
                        setOppen(null);
                        router.refresh();
                      }}
                    />
                    <form
                      action={taBortModul}
                      className="mt-4 border-t border-ink-300/20 pt-4"
                    >
                      <input type="hidden" name="kurs_id" value={kurs.id} />
                      <input type="hidden" name="modul_id" value={m.id} />
                      <Button type="submit" variant="diskret" size="sm">
                        Ta bort modulen
                      </Button>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 border-t border-ink-300/20 pt-4">
          {nyModul ? (
            <ModulForm
              kursId={kurs.id}
              onSparad={() => {
                setNyModul(false);
                router.refresh();
              }}
            />
          ) : (
            <Button variant="sekundar" size="sm" onClick={() => setNyModul(true)}>
              Lägg till modul
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
