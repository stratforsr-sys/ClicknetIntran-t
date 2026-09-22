import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { getCurrentUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { svensktDatum } from "@/lib/klocka";
import { mallsammanfattning, momentTillText, type Mallmoment } from "@/lib/mallar";
import type { Prioritet } from "@/lib/uppgifter";
import { AnvandMall, type Valbarmall } from "./AnvandMall";
import { Arkivknapp, Mallformular } from "./Mallformular";

export const dynamic = "force-dynamic";

export const metadata = { title: "Uppgiftsmallar" };

type Mallrad = {
  id: string;
  name: string;
  description_md: string;
  shared: boolean;
  created_by: string;
  archived_at: string | null;
};

type Momentrad = {
  template_id: string;
  sort: number;
  title: string;
  offset_days: number;
  due_time: string | null;
  estimate_minutes: number | null;
  priority: number;
};

/**
 * Uppgiftsmallarna.
 *
 * ===========================================================================
 * TVÅ FRÅGOR OCH INGEN FILTRERING I TYPESCRIPT
 *
 * Mallarna och momenten läses med användarens egen token, och `task_template_read`
 * i 0066 avgör vilka som kommer tillbaka: mina egna, plus dem någon delat. Det
 * står ingenstans i den här filen, och det är avsikten — regeln om att
 * delningsnivåer bor i SQL gäller här lika mycket som i kalendern.
 *
 * ARKIVERADE MALLAR FILTRERAS DÄREMOT HÄR, och det är en annan sorts fråga:
 * arkivering är inte behörighet utan ordning i listan. Ägaren ska kunna se sina
 * arkiverade och ta fram dem igen; för alla andra är de borta ur väljaren.
 * ===========================================================================
 */
export default async function Mallsidan() {
  const user = await getCurrentUser();
  if (!user?.employee) {
    return (
      <EmptyState
        rubrik="Uppgiftsmallar"
        text="Ditt konto är inte kopplat till en anställd än, så det finns inga mallar att visa."
      />
    );
  }

  const mig = user.employee.id;
  const supabase = await supabaseServer();

  const [{ data: mallrader }, { data: momentrader }, { data: personer }, { data: projektrader }] =
    await Promise.all([
      supabase
        .from("task_template")
        .select("id, name, description_md, shared, created_by, archived_at")
        .order("name"),
      supabase
        .from("task_template_item")
        .select("template_id, sort, title, offset_days, due_time, estimate_minutes, priority")
        .order("sort"),
      // Väljaren följer `employee_read` (0001/0002) — en säljare ser sig själv,
      // en teamledare sitt lag. Samma fråga som uppgiftens egen personväljare.
      supabase
        .from("employee")
        .select("id, first_name, last_name")
        .neq("status", "offboarded")
        .order("first_name"),
      supabase.from("project").select("id, name").is("archived_at", null).order("name"),
    ]);

  const mallar = (mallrader ?? []) as Mallrad[];
  const moment = (momentrader ?? []) as Momentrad[];

  const perMall = new Map<string, Mallmoment[]>();
  for (const m of moment) {
    const rad: Mallmoment = {
      sort: m.sort,
      title: m.title,
      offset_days: m.offset_days,
      // `time` kommer tillbaka som "09:00:00". Kalendern och mallarna arbetar
      // med "09:00", och en sträng som skiljer sig i formatet mellan läsning
      // och skrivning är en sträng som en dag jämförs fel.
      due_time: m.due_time ? m.due_time.slice(0, 5) : null,
      estimate_minutes: m.estimate_minutes,
      priority: (m.priority as Prioritet) ?? 3,
    };
    const lista = perMall.get(m.template_id);
    if (lista) lista.push(rad);
    else perMall.set(m.template_id, [rad]);
  }

  const levande = mallar.filter((m) => !m.archived_at);
  const arkiverade = mallar.filter((m) => m.archived_at && m.created_by === mig);

  const valbara: Valbarmall[] = levande
    .filter((m) => (perMall.get(m.id) ?? []).length > 0)
    .map((m) => ({
      id: m.id,
      name: m.name,
      description_md: m.description_md,
      moment: perMall.get(m.id) ?? [],
    }));

  return (
    <div className="flex flex-col gap-6 pt-2">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-display text-ink-900">Uppgiftsmallar</h1>
          <p className="max-w-prose text-body text-ink-500">
            En mall är en checklista med dagar. Du väljer mall och en startdag, och får riktiga uppgifter —
            inte en påminnelse om att göra dem.
          </p>
        </div>
        <Link
          href="/uppgifter"
          className="inline-flex items-center gap-2 rounded-full bg-canvas px-3 py-1.5 text-small text-ink-700 transition-colors duration-fast hover:bg-brand-100 hover:text-brand-700"
        >
          Tillbaka till uppgifterna
        </Link>
      </header>

      <Card>
        <div className="flex flex-col gap-4">
          <h2 className="text-h2 text-ink-900">Använd en mall</h2>
          <AnvandMall
            mallar={valbara}
            personer={(personer ?? []).map((p) => ({
              id: p.id as string,
              namn: `${p.first_name} ${p.last_name}`,
            }))}
            projekt={((projektrader ?? []) as { id: string; name: string }[]).map((p) => ({
              id: p.id,
              name: p.name,
            }))}
            mig={mig}
            idag={svensktDatum()}
          />
        </div>
      </Card>

      {levande.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-h2 text-ink-900">Mallarna</h2>
          <div className="flex flex-col gap-3">
            {levande.map((m) => (
              <Mallkort
                key={m.id}
                mall={m}
                moment={perMall.get(m.id) ?? []}
                minEgen={m.created_by === mig}
              />
            ))}
          </div>
        </section>
      )}

      {arkiverade.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-h2 text-ink-900">Arkiverade</h2>
          <p className="text-small text-ink-500">
            Bara du ser dina arkiverade mallar. De går inte att använda förrän de tagits fram igen — men
            uppgifterna de redan skapat vet fortfarande varifrån de kom.
          </p>
          <div className="flex flex-col gap-3">
            {arkiverade.map((m) => (
              <Mallkort key={m.id} mall={m} moment={perMall.get(m.id) ?? []} minEgen />
            ))}
          </div>
        </section>
      )}

      <Card>
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-h2 text-ink-900">Skriv en ny mall</h2>
            <p className="text-small text-ink-500">
              Ett moment per rad. Fälten skiljs med lodstreck, och bara rubriken krävs.
            </p>
          </div>
          <Mallformular />
        </div>
      </Card>

      {mallar.length === 0 && (
        <EmptyState
          rubrik="Ingen mall än"
          text="En mall är värd att skriva första gången du gör samma sak för andra gången. Uppstart av en ny kund, en reklamation, en månadsavstämning — allt som har fler än tre steg och återkommer."
        />
      )}
    </div>
  );
}

/**
 * Mallen som kort med momenten utskrivna.
 *
 * MOMENTEN STÅR FRAMME OCH INTE BAKOM ETT KLICK. En mall man inte kan läsa är
 * en mall man inte vågar använda — och den som väljer mellan två checklistor
 * gör det på innehållet, inte på namnet.
 *
 * ÄNDRINGEN LIGGER I ETT `details` OCH INTE I ETT EGET TILLSTÅND. Webbläsaren
 * kan fälla ut en sektion utan att någon skriver `useState`, och den enda
 * vinsten med en klientkomponent hade varit att kunna stänga den igen med en
 * animation.
 */
function Mallkort({
  mall,
  moment,
  minEgen,
}: {
  mall: Mallrad;
  moment: Mallmoment[];
  minEgen: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md bg-surface p-4 shadow-elev-1">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-h2 text-ink-900">{mall.name}</h3>
          <p className="text-small text-ink-500">
            {mallsammanfattning(moment)}
            {mall.shared ? "" : " · bara du"}
          </p>
          {mall.description_md && <p className="mt-1 text-small text-ink-700">{mall.description_md}</p>}
        </div>
        {minEgen && <Arkivknapp id={mall.id} arkiverad={Boolean(mall.archived_at)} />}
      </div>

      {moment.length === 0 ? (
        <p className="text-small text-danger-ink">
          Mallen har inga moment och går inte att använda.
        </p>
      ) : (
        <ol className="flex flex-col gap-1">
          {moment.map((m) => (
            <li key={m.sort} className="flex flex-wrap items-baseline gap-x-3 text-small text-ink-700">
              <span className="tnum w-16 shrink-0 text-ink-500">dag {m.offset_days}</span>
              <span className="min-w-0 flex-1">{m.title}</span>
              <span className="tnum text-micro text-ink-500">
                {[m.due_time, m.estimate_minutes ? `${m.estimate_minutes} min` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </li>
          ))}
        </ol>
      )}

      {minEgen && (
        <details className="group">
          <summary className="cursor-pointer text-small text-ink-500 transition-colors duration-fast hover:text-brand-700">
            Ändra mallen
          </summary>
          <div className="mt-3 border-t border-canvas pt-3">
            <Mallformular
              mall={{
                id: mall.id,
                name: mall.name,
                description_md: mall.description_md,
                shared: mall.shared,
                moment: momentTillText(moment),
              }}
            />
          </div>
        </details>
      )}
    </div>
  );
}
