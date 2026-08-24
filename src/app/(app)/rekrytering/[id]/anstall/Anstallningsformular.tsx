"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import { Losenordsruta } from "@/components/ui/Losenordsruta";
import { Ikon } from "@/components/shell/Ikon";
import { ROLES, ROLE_LABEL, EMPLOYMENT_TYPE_LABEL } from "@/lib/roles";
import { VARIABLER, hittaPlatshallare } from "@/lib/avtal";
import { anstallKandidat, type AnstallState } from "../../actions";

type Mall = { id: string; title: string; body_md: string };

type Kandidat = {
  id: string;
  fornamn: string;
  efternamn: string;
  epost: string;
  befattning: string;
};

/**
 * E10.9 / AC-7.9. Ett steg, allt pa en sida.
 *
 * Avtalsdelen ar VALFRI, och det ar inte en uppmjukning av AC-7.9 utan foljden
 * av tva saker som bada ar sanna i dag: det finns annu ingen publicerad mall,
 * och den som far rekrytera far inte nodvandigtvis skapa avtal. Utan mall
 * skapas inget utkast, och checklistan far punkten "Anställningsavtal
 * upprättat, undertecknat och arkiverat" i stallet — den atgarden forsvinner
 * alltsa inte, den flyttar bara.
 */
export function Anstallningsformular({
  kandidat,
  team,
  mallar,
  farHanteraAvtal,
}: {
  kandidat: Kandidat;
  team: { id: string; name: string }[];
  mallar: Mall[];
  farHanteraAvtal: boolean;
}) {
  const [state, action, vantar] = useActionState<AnstallState, FormData>(anstallKandidat, {});
  const [mallId, setMallId] = useState("");

  const vald = mallar.find((m) => m.id === mallId);
  const anvanda = vald ? hittaPlatshallare(vald.body_md) : [];
  const attFylla = VARIABLER.filter((v) => v.fran !== "employee" && anvanda.includes(v.nyckel));

  const namn = `${kandidat.fornamn} ${kandidat.efternamn}`;

  // Losenordet visas HAR och ingen annanstans. Att skicka det vidare till
  // personalkortet hade krävt att det lag i en URL.
  if (state.losenord) {
    return (
      <div className="flex flex-col gap-4 pt-2">
        <div>
          <h1 className="text-display text-ink-900">
            {state.halvvags ? "Delvis klart" : `${namn} är anställd`}
          </h1>
          <p className="mt-1 max-w-[70ch] text-body text-ink-500">
            Lösenordet visas en gång. Skriv ner det nu och lämna över det personligen — navet mejlar
            inte än.
          </p>
        </div>

        {state.fel && <Notis ton={state.halvvags ? "danger" : "warn"}>{state.fel}</Notis>}

        <Card className="max-w-[46rem]">
          <div className="flex flex-col gap-5">
            <Losenordsruta losenord={state.losenord} />

            <div className="flex flex-wrap items-center gap-3">
              {state.anstalldId && (
                <ButtonLink href={`/personal/${state.anstalldId}`} variant="primar">
                  Till personalkortet
                </ButtonLink>
              )}
              {state.avtalId && (
                <ButtonLink href={`/avtal/${state.avtalId}`}>Granska avtalsutkastet</ButtonLink>
              )}
              <Link
                href={`/rekrytering/${kandidat.id}`}
                className="text-small font-semibold text-ink-500 hover:text-ink-900"
              >
                Tillbaka till kandidaten
              </Link>
            </div>
          </div>
        </Card>

        {!state.halvvags && (
          <Card className="max-w-[46rem]">
            <CardHeader
              titel="Vad som återstår"
              beskrivning="Onboarding-checklistan ligger på personalkortet. Punkterna som redan är gjorda står som klara."
            />
            <p className="text-small text-ink-500">
              Utrustning, behörigheter i Inkio och dialern, e-postkonto och introduktion kvitteras
              där. Ingen punkt kan hoppas över utan motivering.
            </p>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pt-2">
      <Link
        href={`/rekrytering/${kandidat.id}`}
        className="inline-flex items-center gap-2 text-small font-semibold text-ink-500 hover:text-ink-900"
      >
        <Ikon namn="tillbaka" className="size-4" />
        Tillbaka till kandidaten
      </Link>

      <div>
        <h1 className="text-display text-ink-900">Anställ {namn}</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Ett steg. Kontot skapas med ett tillfälligt lösenord som visas en gång, rutinerna och
          kurserna som gäller rollen tilldelas, och en onboarding-checklista läggs upp på
          personalkortet.
        </p>
      </div>

      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="kandidat_id" value={kandidat.id} />

        {state.fel && <Notis ton="danger">{state.fel}</Notis>}

        <Card className="max-w-[46rem]">
          <CardHeader
            titel="Anställningen"
            beskrivning={`Namnet kommer från kandidatraden och ändras inte här. Ansökan kom från ${kandidat.epost}.`}
          />

          <div className="flex flex-col gap-5">
            <Field
              label="E-post i navet"
              namn="epost"
              hjalp="Blir inloggningsadress. Använd jobbadressen — ansökningsadressen är privat och följer inte med anställningen."
            >
              <Input
                namn="epost"
                type="email"
                required
                autoComplete="off"
                placeholder="fornamn@clicknet.se"
              />
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
          </div>
        </Card>

        <Card className="max-w-[46rem]">
          <CardHeader
            titel="Anställningsavtal"
            beskrivning="Skapas som utkast. Det syns inte för den anställda förrän du utfärdar det."
          />

          {!farHanteraAvtal ? (
            <p className="text-small text-ink-500">
              Avtal hanteras av säljchef, VD eller administratör. Anställningen går igenom utan —
              punkten hamnar i onboarding-checklistan i stället.
            </p>
          ) : mallar.length === 0 ? (
            <p className="text-small text-ink-500">
              Ingen publicerad mall finns än. Anställningen går igenom utan avtal, och punkten
              hamnar i onboarding-checklistan. Mallar skrivs under{" "}
              <Link href="/avtal/mallar" className="font-semibold text-brand-700 hover:underline">
                Avtal
              </Link>
              .
            </p>
          ) : (
            <div className="flex flex-col gap-5">
              <Field label="Mall" namn="mall_id" hjalp="Välj ingen mall om avtalet skrivs utanför navet.">
                <Select namn="mall_id" value={mallId} onChange={(e) => setMallId(e.target.value)}>
                  <option value="">Skapa inget avtal nu</option>
                  {mallar.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title}
                    </option>
                  ))}
                </Select>
              </Field>

              {/* Bara falten mallen faktiskt anvander. Ett ifyllt falt som inte
                  hamnar i texten far den som fyller i det att tro att det star
                  dar. Samma regel som /avtal/nytt. */}
              {attFylla.map((v) => (
                <Field
                  key={v.nyckel}
                  label={v.etikett}
                  namn={`var_${v.nyckel}`}
                  hjalp={v.hjalp}
                >
                  <Input
                    namn={`var_${v.nyckel}`}
                    required
                    defaultValue={v.nyckel === "befattning" ? kandidat.befattning : undefined}
                  />
                </Field>
              ))}

              {attFylla.length > 0 && (
                <p className="text-small text-ink-500">
                  Navet lagrar inga personnummer. Det utskrivna avtalet har en rad där det fylls i
                  för hand.
                </p>
              )}
            </div>
          )}
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" laddar={vantar}>
            Anställ {kandidat.fornamn}
          </Button>
          <Link
            href={`/rekrytering/${kandidat.id}`}
            className="text-small font-semibold text-ink-500 hover:text-ink-900"
          >
            Avbryt
          </Link>
        </div>
      </form>
    </div>
  );
}
