"use client";

import { useActionState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { KONTROLL } from "@/components/ui/Field";
import { Notis } from "@/components/ui/Notis";
import type { Franvarotyp, Regelverk } from "@/lib/franvaro";
import type { FranvaroState } from "../actions";
import { sparaPolicy, sparaRingordning, sparaSparrperiod, sparaTak, sparaTyp } from "./actions";

type Sparr = { id: string; label: string; starts_on: string; ends_on: string; type_ids: string[]; team_ids: string[] };
type Tak = { id: string; team_id: string | null; max_absent: number };
type Ordning = { id: string; sort: number; target_kind: string; role: string | null; employee_id: string | null; phone: string | null; team_id: string | null };

export function Regelvyer({
  policy,
  typer,
  sparrar,
  tak,
  team,
  ordning,
  personal,
  roller,
}: {
  policy: Regelverk;
  typer: Franvarotyp[];
  sparrar: Sparr[];
  tak: Tak[];
  team: { id: string; name: string }[];
  ordning: Ordning[];
  personal: { id: string; namn: string }[];
  roller: { id: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <Typregler typer={typer} />
      <Policyregler policy={policy} />
      <Sparrperioder sparrar={sparrar} typer={typer} team={team} />
      <Bemanningstak tak={tak} team={team} />
      <Ringordning ordning={ordning} personal={personal} roller={roller} />
    </div>
  );
}

// -----------------------------------------------------------------------------

function Typregler({ typer }: { typer: Franvarotyp[] }) {
  const [state, action, sparar] = useActionState<FranvaroState, FormData>(sparaTyp, {});

  return (
    <Card>
      <CardHeader
        titel="Regler per typ"
        beskrivning="Ansökningsfrist, maxlängd, karens och attestnivå. Ett fält per rad, en rad per typ."
      />
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}

      <div className="mt-3 flex flex-col gap-4">
        {typer.map((t) => (
          <form key={t.id} action={action} className="rounded-sm bg-canvas p-4">
            <input type="hidden" name="id" value={t.id} />

            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-body font-semibold text-ink-900">{t.label}</span>
              {!t.requestable && <Badge ton="info">Registreras, söks inte</Badge>}
              {!t.active && <Badge ton="neutral">Avstängd</Badge>}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tal namn="notice_days" etikett="Frist (dagar)" varde={t.notice_days} id={t.id} />
              <Tal
                namn="max_consecutive_days"
                etikett="Maxlängd (dagar)"
                varde={t.max_consecutive_days ?? ""}
                id={t.id}
                hjalp="Tomt = ingen gräns"
              />
              <Tal namn="waiting_days" etikett="Karens (dagar)" varde={t.waiting_days} id={t.id} />

              <label htmlFor={`niva_${t.id}`} className="flex flex-col gap-1">
                <span className="text-micro text-ink-500">Attestnivå</span>
                <select
                  id={`niva_${t.id}`}
                  name="approval_level"
                  defaultValue={t.approval_level}
                  className={`${KONTROLL} appearance-none py-2 text-small`}
                >
                  <option value="manager">Närmaste chef</option>
                  <option value="sales_manager">Säljchef</option>
                  <option value="ceo">VD</option>
                </select>
              </label>
            </div>

            <div className="mt-3 flex flex-wrap gap-4">
              <Kryss namn="counts_in_staffing" etikett="Räknas mot bemanningen" pa={t.counts_in_staffing} />
              <Kryss namn="allows_part_day" etikett="Tillåter del av dag" pa={t.allows_part_day} />
              <Kryss namn="active" etikett="Påslagen" pa={t.active} />
            </div>

            <div className="mt-3">
              <Button type="submit" size="sm" variant="sekundar" laddar={sparar}>
                Spara {t.label.toLowerCase()}
              </Button>
            </div>
          </form>
        ))}
      </div>

      <p className="mt-4 text-micro text-ink-500">
        Sjukfrånvaro går inte att göra ansökningsbar. Spärren ligger i databasen (AC-3.6) — en
        kryssruta som gjorde det till en knapp hade tagit bort samtalet, som är hela poängen.
      </p>
    </Card>
  );
}

function Tal({
  namn,
  etikett,
  varde,
  id,
  hjalp,
}: {
  namn: string;
  etikett: string;
  varde: number | string;
  id: string;
  hjalp?: string;
}) {
  return (
    <label htmlFor={`${namn}_${id}`} className="flex flex-col gap-1">
      <span className="text-micro text-ink-500">{etikett}</span>
      <input
        id={`${namn}_${id}`}
        name={namn}
        type="number"
        min={0}
        defaultValue={varde}
        className={`${KONTROLL} py-2 text-small`}
      />
      {hjalp && <span className="text-micro text-ink-300">{hjalp}</span>}
    </label>
  );
}

function Kryss({ namn, etikett, pa }: { namn: string; etikett: string; pa: boolean }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" name={namn} value="1" defaultChecked={pa} className="size-5 rounded-xs" />
      <span className="text-small text-ink-700">{etikett}</span>
    </label>
  );
}

// -----------------------------------------------------------------------------

function Policyregler({ policy }: { policy: Regelverk }) {
  const [state, action, sparar] = useActionState<FranvaroState, FormData>(sparaPolicy, {});

  return (
    <Card>
      <CardHeader
        titel="Gemensamma regler"
        beskrivning="Semesterår, huvudsemesterfönster och fristerna i sjukfallet."
      />
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}

      <form action={action} className="mt-3 flex flex-col gap-6">
        <Grupp titel="Semesteråret (3 § semesterlagen)">
          <P namn="vacation_year_start_month" etikett="Startmånad" varde={policy.vacation_year_start_month} />
          <P namn="vacation_year_start_day" etikett="Startdag" varde={policy.vacation_year_start_day} />
          <P namn="saved_days_max_years" etikett="Sparade dagar, max år" varde={policy.saved_days_max_years} />
          <P namn="balance_stale_days" etikett="Saldo föråldrat efter (dagar)" varde={policy.balance_stale_days} />
        </Grupp>

        <Grupp titel="Huvudsemestern (11–12 §§ semesterlagen)">
          <P namn="main_vacation_start_month" etikett="Fönster från månad" varde={policy.main_vacation_start_month} />
          <P namn="main_vacation_start_day" etikett="Från dag" varde={policy.main_vacation_start_day} />
          <P namn="main_vacation_end_month" etikett="Till månad" varde={policy.main_vacation_end_month} />
          <P namn="main_vacation_end_day" etikett="Till dag" varde={policy.main_vacation_end_day} />
          <P namn="main_vacation_notice_days" etikett="Beskedsfrist (dagar)" varde={policy.main_vacation_notice_days} />
        </Grupp>

        <Grupp titel="Sjukfallet (K37, AC-3.23)">
          <P namn="sick_certificate_day" etikett="Läkarintyg dag" varde={policy.sick_certificate_day} />
          <P namn="sick_fk_day" etikett="Försäkringskassan dag" varde={policy.sick_fk_day} />
          <P namn="sick_return_plan_day" etikett="Plan för återgång dag" varde={policy.sick_return_plan_day} />
          <P namn="sick_confirm_hours" etikett="Eskalera efter (timmar)" varde={policy.sick_confirm_hours} />
          <P namn="relapse_days" etikett="Återinsjuknande inom (dagar)" varde={policy.relapse_days} />
          <P namn="repeat_sick_count" etikett="Rehabsignal vid antal" varde={policy.repeat_sick_count} />
          <P namn="repeat_sick_months" etikett="…inom antal månader" varde={policy.repeat_sick_months} />
          <P
            namn="unregistered_reminder_hours"
            etikett="Påminnelse synlig för chef efter (timmar)"
            varde={policy.unregistered_reminder_hours}
          />
        </Grupp>

        <div>
          <Button type="submit" laddar={sparar}>
            Spara reglerna
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Grupp({ titel, children }: { titel: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-2 text-small font-semibold text-ink-700">{titel}</legend>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </fieldset>
  );
}

function P({ namn, etikett, varde }: { namn: string; etikett: string; varde: number }) {
  return (
    <label htmlFor={namn} className="flex flex-col gap-1">
      <span className="text-micro text-ink-500">{etikett}</span>
      <input
        id={namn}
        name={namn}
        type="number"
        min={0}
        defaultValue={varde}
        className={`${KONTROLL} py-2 text-small`}
      />
    </label>
  );
}

// -----------------------------------------------------------------------------

function Sparrperioder({
  sparrar,
  typer,
  team,
}: {
  sparrar: Sparr[];
  typer: Franvarotyp[];
  team: { id: string; name: string }[];
}) {
  const [state, action, sparar] = useActionState<FranvaroState, FormData>(sparaSparrperiod, {});

  return (
    <Card>
      <CardHeader
        titel="Spärrperioder"
        beskrivning="Veckor då ledighet varnar. Namnet beskriver perioden — aldrig en person."
      />
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}

      {sparrar.length > 0 && (
        <ul className="mb-4 flex flex-col">
          {sparrar.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 border-b border-canvas py-2 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block text-body text-ink-900">{s.label}</span>
                <span className="block text-small text-ink-500">
                  {s.starts_on}–{s.ends_on}
                  {s.type_ids.length > 0 && ` · ${s.type_ids.length} typer`}
                  {s.team_ids.length > 0 ? ` · ${s.team_ids.length} team` : " · hela bolaget"}
                </span>
              </span>
              <form action={action}>
                <input type="hidden" name="ta_bort" value={s.id} />
                <Button type="submit" size="sm" variant="diskret">
                  Ta bort
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <form action={action} className="flex flex-col gap-3 rounded-sm bg-canvas p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <label htmlFor="label" className="flex flex-col gap-1">
            <span className="text-micro text-ink-500">Namn</span>
            <input id="label" name="label" required placeholder="Kampanjvecka 45" className={`${KONTROLL} py-2 text-small`} />
          </label>
          <label htmlFor="starts_on" className="flex flex-col gap-1">
            <span className="text-micro text-ink-500">Från</span>
            <input id="starts_on" name="starts_on" type="date" required className={`${KONTROLL} py-2 text-small`} />
          </label>
          <label htmlFor="ends_on" className="flex flex-col gap-1">
            <span className="text-micro text-ink-500">Till</span>
            <input id="ends_on" name="ends_on" type="date" required className={`${KONTROLL} py-2 text-small`} />
          </label>
        </div>

        <fieldset>
          <legend className="mb-1 text-micro text-ink-500">Gäller typer (inget kryss = alla)</legend>
          <div className="flex flex-wrap gap-3">
            {typer
              .filter((t) => t.requestable)
              .map((t) => (
                <label key={t.id} className="flex items-center gap-2">
                  <input type="checkbox" name="type_ids" value={t.id} className="size-4 rounded-xs" />
                  <span className="text-small text-ink-700">{t.label}</span>
                </label>
              ))}
          </div>
        </fieldset>

        {team.length > 0 && (
          <fieldset>
            <legend className="mb-1 text-micro text-ink-500">Gäller team (inget kryss = hela bolaget)</legend>
            <div className="flex flex-wrap gap-3">
              {team.map((t) => (
                <label key={t.id} className="flex items-center gap-2">
                  <input type="checkbox" name="team_ids" value={t.id} className="size-4 rounded-xs" />
                  <span className="text-small text-ink-700">{t.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div>
          <Button type="submit" size="sm" variant="sekundar" laddar={sparar}>
            Lägg till spärrperiod
          </Button>
        </div>
      </form>
    </Card>
  );
}

// -----------------------------------------------------------------------------

function Bemanningstak({ tak, team }: { tak: Tak[]; team: { id: string; name: string }[] }) {
  const [state, action, sparar] = useActionState<FranvaroState, FormData>(sparaTak, {});
  const forTeam = (id: string | null) => tak.find((t) => t.team_id === id)?.max_absent ?? "";

  return (
    <Card>
      <CardHeader
        titel="Bemanningstak"
        beskrivning="Högsta antal samtidigt borta. Taket varnar, det spärrar aldrig."
      />
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}

      <div className="mt-3 flex flex-col gap-3">
        {[{ id: null, name: "Hela bolaget" }, ...team].map((t) => (
          <form key={t.id ?? "bolag"} action={action} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="team_id" value={t.id ?? ""} />
            <label htmlFor={`tak_${t.id ?? "bolag"}`} className="flex flex-col gap-1">
              <span className="text-micro text-ink-500">{t.name}</span>
              <input
                id={`tak_${t.id ?? "bolag"}`}
                name="max_absent"
                type="number"
                min={0}
                defaultValue={forTeam(t.id)}
                placeholder="inget tak"
                className={`${KONTROLL} max-w-40 py-2 text-small`}
              />
            </label>
            <Button type="submit" size="sm" variant="sekundar" laddar={sparar}>
              Spara
            </Button>
          </form>
        ))}
      </div>

      <p className="mt-4 text-micro text-ink-500">
        Teamets eget tak går före bolagets. Tomt fält betyder inget tak alls; en nolla betyder att
        varje ansökan varnar.
      </p>
    </Card>
  );
}

// -----------------------------------------------------------------------------

function Ringordning({
  ordning,
  personal,
  roller,
}: {
  ordning: Ordning[];
  personal: { id: string; namn: string }[];
  roller: { id: string; label: string }[];
}) {
  const [state, action, sparar] = useActionState<FranvaroState, FormData>(sparaRingordning, {});

  return (
    <Card>
      <CardHeader
        titel="Vem man ringer vid sjukdom"
        beskrivning="Ordningen som visas på sjukanmälningssidan (AC-3.27)."
      />
      {state.fel && <Notis ton="danger">{state.fel}</Notis>}
      {state.ok && <Notis ton="ok">{state.ok}</Notis>}

      <ul className="mb-4 flex flex-col">
        {ordning.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-3 border-b border-canvas py-2 last:border-0">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-tint text-micro font-semibold text-brand-ink">
              {o.sort}
            </span>
            <span className="min-w-0 flex-1 text-small text-ink-900">
              {o.target_kind === "manager"
                ? "Närmaste chef"
                : o.target_kind === "role"
                  ? (roller.find((r) => r.id === o.role)?.label ?? o.role)
                  : (personal.find((p) => p.id === o.employee_id)?.namn ?? "Okänd")}
              {o.phone && <span className="text-ink-500"> · {o.phone}</span>}
            </span>
            <form action={action}>
              <input type="hidden" name="ta_bort" value={o.id} />
              <Button type="submit" size="sm" variant="diskret">
                Ta bort
              </Button>
            </form>
          </li>
        ))}
      </ul>

      <form action={action} className="grid gap-3 rounded-sm bg-canvas p-4 sm:grid-cols-5">
        <label htmlFor="sort" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Plats</span>
          <input id="sort" name="sort" type="number" min={1} defaultValue={ordning.length + 1} className={`${KONTROLL} py-2 text-small`} />
        </label>

        <label htmlFor="target_kind" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Vem</span>
          <select id="target_kind" name="target_kind" className={`${KONTROLL} appearance-none py-2 text-small`}>
            <option value="manager">Närmaste chef</option>
            <option value="role">En roll</option>
            <option value="person">En person</option>
          </select>
        </label>

        <label htmlFor="role" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Roll</span>
          <select id="role" name="role" className={`${KONTROLL} appearance-none py-2 text-small`}>
            <option value="">—</option>
            {roller.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="employee_id" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Person</span>
          <select id="employee_id" name="employee_id" className={`${KONTROLL} appearance-none py-2 text-small`}>
            <option value="">—</option>
            {personal.map((p) => (
              <option key={p.id} value={p.id}>
                {p.namn}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="phone" className="flex flex-col gap-1">
          <span className="text-micro text-ink-500">Telefon</span>
          <input id="phone" name="phone" type="tel" placeholder="070-000 00 00" className={`${KONTROLL} py-2 text-small`} />
        </label>

        <div className="sm:col-span-5">
          <Button type="submit" size="sm" variant="sekundar" laddar={sparar}>
            Lägg till i ordningen
          </Button>
        </div>
      </form>

      <p className="mt-4 text-micro text-ink-500">
        Har någon ingen chef hoppas platsen över och nästa i ordningen blir den man ringer. Det är
        chefsfallbacken i AC-3.18, inbyggd i ordningen i stället för som ett undantag i koden.
      </p>
    </Card>
  );
}
