"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { Losenordsruta } from "@/components/ui/Losenordsruta";
import { Ikon } from "@/components/shell/Ikon";
import { ROLES, ROLE_LABEL, EMPLOYMENT_TYPE_LABEL } from "@/lib/roles";
import { laggUppAnstalld, type FormState } from "../actions";

export function Formular({ team }: { team: { id: string; name: string }[] }) {
  const [state, action, vantar] = useActionState<FormState, FormData>(laggUppAnstalld, {});

  // Upplagget avslutas har i stallet for pa personalkortet. Losenordet far
  // inte folja med i en URL, och det ar det enda tillfallet det gar att visa.
  if (state.losenord) {
    return (
      <div className="flex flex-col gap-4 pt-2">
        <div>
          <h1 className="text-display text-ink-900">Upplagd</h1>
          <p className="mt-1 max-w-[70ch] text-body text-ink-500">{state.ok}</p>
        </div>

        <Card className="max-w-[46rem]">
          <div className="flex flex-col gap-5">
            <Losenordsruta losenord={state.losenord} />

            <div className="flex flex-wrap items-center gap-3">
              {state.anstalldId && (
                <ButtonLink href={`/personal/${state.anstalldId}`} variant="primar">
                  Till personalkortet
                </ButtonLink>
              )}
              {/* Hel omladdning, inte Link: samma rutt behaller komponentens
                  state och formularet hade kommit tillbaka ifyllt med det
                  gamla svaret. */}
              <a
                href="/personal/ny"
                className="text-small font-semibold text-ink-500 hover:text-ink-900"
              >
                Lägg upp en till
              </a>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href="/personal"
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Tillbaka till personal
      </Link>

      <div>
        <h1 className="text-display text-ink-900">Lägg upp anställd</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Kontot skapas direkt med ett tillfälligt lösenord som visas en gång när du sparar — navet
          mejlar inte än, så du lämnar över det personligen. Rutinerna som gäller rollen och teamet
          blir obligatoriska från dag ett.
        </p>
      </div>

      <Card className="max-w-[46rem]">
        <form action={action} className="flex flex-col gap-5">
          {state.fel && <Notis ton="danger">{state.fel}</Notis>}

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Förnamn" namn="fornamn">
              <Input namn="fornamn" required autoComplete="off" />
            </Field>
            <Field label="Efternamn" namn="efternamn">
              <Input namn="efternamn" required autoComplete="off" />
            </Field>
          </div>

          <Field
            label="E-post"
            namn="epost"
            hjalp="Blir inloggningsadress. Använd jobbadressen om den finns."
          >
            <Input namn="epost" type="email" required autoComplete="off" placeholder="fornamn@clicknet.se" />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Roll" namn="roll">
              <Select namn="roll" defaultValue="salesperson">
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Anställningsform" namn="anstallningsform">
              <Select namn="anstallningsform" defaultValue="permanent">
                {Object.entries(EMPLOYMENT_TYPE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Team"
              namn="team_id"
              hjalp={
                team.length
                  ? "Styr vilka rutiner som blir obligatoriska, och vem som ser uppgifterna."
                  : "Inga team upplagda än. Går att sätta i efterhand."
              }
            >
              <Select namn="team_id" defaultValue="">
                <option value="">Inget team</option>
                {team.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Startdatum" namn="startdatum">
              <Input namn="startdatum" type="date" />
            </Field>
            <Field
              label="Anställningsnummer"
              namn="anstallningsnummer"
              hjalp="Matchar lönesystemets ID. Kan fyllas i senare."
            >
              <Input namn="anstallningsnummer" autoComplete="off" />
            </Field>
          </div>

          <div className="mt-2 flex items-center gap-3">
            <Button type="submit" laddar={vantar}>
              Lägg upp anställd
            </Button>
            <Link href="/personal" className="text-small font-semibold text-ink-500 hover:text-ink-900">
              Avbryt
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
}
