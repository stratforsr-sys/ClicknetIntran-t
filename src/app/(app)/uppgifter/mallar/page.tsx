import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { Ikon } from "@/components/shell/Ikon";
import { getCurrentUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { svensktDatum } from "@/lib/klocka";
import type { Mallmoment } from "@/lib/mallar";
import type { Prioritet } from "@/lib/uppgifter";
import { Mallista, type Mallkort } from "./Mallista";

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
 * Uppgiftsmallarna. Sidan hämtar, `Mallista` ritar.
 *
 * ===========================================================================
 * TVÅ FRÅGOR OCH INGEN FILTRERING AV BEHÖRIGHET I TYPESCRIPT
 *
 * Mallarna och momenten läses med användarens egen token, och
 * `task_template_read` i 0066 avgör vilka som kommer tillbaka: mina egna, plus
 * dem någon delat. Det står ingenstans i den här filen, och det är avsikten —
 * regeln om att delningsnivåer bor i SQL gäller här lika mycket som i kalendern.
 *
 * ARKIVERADE MALLAR DELAS DÄREMOT HÄR, och det är en annan sorts fråga:
 * arkivering är inte behörighet utan ordning i listan. Ägaren ska kunna se sina
 * arkiverade och ta fram dem igen; för alla andra är de borta.
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

  const till = (m: Mallrad): Mallkort => ({
    id: m.id,
    name: m.name,
    description_md: m.description_md,
    shared: m.shared,
    arkiverad: Boolean(m.archived_at),
    minEgen: m.created_by === mig,
    moment: perMall.get(m.id) ?? [],
  });

  return (
    <div className="flex flex-col gap-6 pt-2">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-display text-ink-900">Uppgiftsmallar</h1>
          <p className="max-w-prose text-body text-ink-500">
            En checklista med dagar. Välj mall och en startdag, och få{" "}
            <span className="text-ink-900">riktiga uppgifter</span> — inte en påminnelse om att göra dem.
          </p>
        </div>
        <Link
          href="/uppgifter"
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-canvas px-3 py-1.5 text-small text-ink-700 transition-colors duration-fast hover:bg-brand-100 hover:text-brand-700"
        >
          <Ikon namn="tillbaka" className="size-4" />
          Uppgifterna
        </Link>
      </header>

      <Mallista
        mallar={mallar.filter((m) => !m.archived_at).map(till)}
        arkiverade={mallar.filter((m) => m.archived_at && m.created_by === mig).map(till)}
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
  );
}
