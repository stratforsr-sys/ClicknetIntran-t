import { Card, CardHeader } from "@/components/ui/Card";
import { Badge, Counter } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input, Select } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";

/**
 * Levande stilguide. Anvands for att bocka av kvalitetssparren i UI-PRD §11
 * utan att behova hitta en riktig vy som rakar innehalla varje komponent.
 */
export default function Designsystem() {
  return (
    <div className="flex flex-col gap-4 pt-2">
      <div>
        <h1 className="text-display text-ink-900">Designsystem</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-500">
          Alla primitiver i systemet. Ändras en token i <code>globals.css</code> ändras allt här.
        </p>
      </div>

      <Card>
        <CardHeader titel="Färg" beskrivning="Varje färg har ett jobb. Status används aldrig som dekoration." />
        <div className="grid gap-6 sm:grid-cols-2">
          <Grupp titel="Varumärke">
            <Ruta klass="bg-brand-900" namn="brand-900" text="Sidopanel" ljus />
            <Ruta klass="bg-brand-700" namn="brand-700" text="Text på tonplatta" ljus />
            <Ruta klass="bg-brand-600" namn="brand-600" text="Primär handling 4,9:1" ljus />
            <Ruta klass="bg-brand-500" namn="brand-500" text="Endast mörk yta" />
            <Ruta klass="bg-brand-100" namn="brand-100" text="Tonplatta" />
          </Grupp>
          <Grupp titel="Status">
            <Ruta klass="bg-ok" namn="ok" text="Klar, i tid" ljus />
            <Ruta klass="bg-warn" namn="warn" text="Väntar, avvikelse" />
            <Ruta klass="bg-danger" namn="danger" text="Försenad, fel" ljus />
            <Ruta klass="bg-info" namn="info" text="Neutral information" ljus />
            <Ruta klass="bg-accent" namn="accent" text="Kräver handling" />
          </Grupp>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader titel="Knappar" beskrivning="En primärknapp per vy. Minsta träffyta 44 px." />
          <div className="flex flex-wrap items-center gap-3">
            <Button>Stämpla in</Button>
            <Button variant="sekundar">Kvittera</Button>
            <Button variant="diskret">Avbryt</Button>
            <Button variant="destruktiv">Avsluta</Button>
            <Button laddar>Sparar</Button>
            <Button disabled>Inaktiv</Button>
          </div>
        </Card>

        <Card>
          <CardHeader titel="Statusmärken" beskrivning="Fasta ord genom hela systemet." />
          <div className="flex flex-wrap items-center gap-2">
            <Badge ton="ok">Klar</Badge>
            <Badge ton="warn">Väntar</Badge>
            <Badge ton="danger">Försenad</Badge>
            <Badge ton="warn">Avvikelse</Badge>
            <Badge ton="ok">Godkänd</Badge>
            <Badge ton="danger">Avslagen</Badge>
            <Badge ton="neutral">Utkast</Badge>
            <span className="ml-2 flex items-center gap-2 text-small text-ink-500">
              Räknare <Counter antal={3} /> <Counter antal={128} />
            </span>
          </div>
        </Card>

        <Card>
          <CardHeader titel="Elevation" beskrivning="Två lager: kontaktskugga plus ambient höjd." />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              ["elev-1", "shadow-elev-1"],
              ["elev-2", "shadow-elev-2"],
              ["elev-3", "shadow-elev-3"],
              ["elev-4", "shadow-elev-4"],
            ].map(([namn, klass]) => (
              <div
                key={namn}
                className={`grid h-20 place-items-center rounded-md bg-surface text-micro uppercase text-ink-500 ${klass}`}
              >
                {namn}
              </div>
            ))}
          </div>
          <p className="mt-4 text-small text-ink-500">
            Klickbara kort lyfts 1 px vid hover — skuggan animeras aldrig ensam.
          </p>
        </Card>

        <Card>
          <CardHeader titel="Typografi" beskrivning="Plus Jakarta Sans. Siffror alltid tabulära." />
          <div className="flex flex-col gap-2">
            <p className="text-display text-ink-900">Display 32</p>
            <p className="text-h1 text-ink-900">Rubrik 24</p>
            <p className="text-h2 text-ink-900">Kortrubrik 18</p>
            <p className="text-body text-ink-700">Brödtext 15 — den ska försvinna, inte synas.</p>
            <p className="text-small text-ink-500">Metadata 13</p>
            <p className="text-micro uppercase text-ink-500">Mikroetikett 11</p>
            <p className="tnum text-h1 text-ink-900">08:59:12 · 24 500 kr</p>
          </div>
        </Card>

        <Card>
          <CardHeader titel="Fält" beskrivning="Fel kopplas till fältet med aria-describedby." />
          <div className="flex flex-col gap-4">
            <Field label="E-post" namn="demo-epost" hjalp="Blir inloggningsadress.">
              <Input namn="demo-epost" placeholder="fornamn@clicknet.se" />
            </Field>
            <Field label="Roll" namn="demo-roll">
              <Select namn="demo-roll">
                <option>Säljare</option>
                <option>Teamledare</option>
              </Select>
            </Field>
            <Field label="Rastens sluttid" namn="demo-fel" fel="Rasten saknar sluttid. Lägg till den för att fortsätta.">
              <Input namn="demo-fel" fel="fel" />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader titel="Besked och tomma tillstånd" />
          <div className="flex flex-col gap-3">
            <Notis ton="ok">Kvitterad.</Notis>
            <Notis ton="warn">Rutinen har inte granskats sedan 2025-11-02.</Notis>
            <Notis ton="danger">Sparningen misslyckades. Försök igen.</Notis>
            <div className="mt-2">
              <EmptyState
                rubrik="Inga ärenden just nu"
                text="Ställ en fråga när något dyker upp, så hamnar den här."
                handling={<Button size="sm">Ställ en fråga</Button>}
              />
            </div>
          </div>
        </Card>
      </div>

      <Card status="brand">
        <CardHeader titel="Statuskort" beskrivning="Enda tillåtna kantlinjen: 3 px färg till vänster." />
        <p className="text-body text-ink-700">Kort har annars ingen ram — avgränsning görs med skugga och ytkontrast.</p>
      </Card>
    </div>
  );
}

function Grupp({ titel, children }: { titel: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-micro uppercase text-ink-500">{titel}</p>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function Ruta({ klass, namn, text, ljus }: { klass: string; namn: string; text: string; ljus?: boolean }) {
  return (
    <div className={`flex items-center justify-between rounded-sm px-4 py-2.5 ${klass} ${ljus ? "text-ink-inv" : "text-ink-900"}`}>
      <span className="text-small font-semibold">{namn}</span>
      <span className="text-small opacity-80">{text}</span>
    </div>
  );
}
