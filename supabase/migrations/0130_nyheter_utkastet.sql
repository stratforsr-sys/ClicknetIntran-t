-- 0130 · Nyheter: det Nav 2.0 har och navet saknade (2026-10-20)
--
-- =============================================================================
-- VARFÖR
--
-- Repot bär inläggen (news_post, 0018): rubrik, text, målgrupp per roll och
-- team, fästa inlägg, utkast och arkiv. Nav 2.0:s Nyheter har mer, och allt
-- här är additivt: inga befintliga rader rörs.
--
--   1. news_post.ack_due: "Alla ska kvittera att de läst", med sista dag.
--      Null betyder att inlägget inte kräver någon kvittens.
--   2. news_post.scheduled_at: "I morgon 07:30" och "måndag 07:30". Inlägget
--      står som utkast tills dagtidsjobbet publicerar det (bakom
--      SKRIVLAGE.nyheter, src/lib/nav2/nyheter-jobb.ts). Publiceringens tid
--      är när jobbet körde, inte den planerade: klockan räknar ett inlägg som
--      nytt om det är nyare än när personen senast tittade, och en tid bakåt
--      hade gjort det läst för den som tittade under kvarten emellan.
--   3. news_ack: vem som kvitterat ett inlägg, och när.
--
-- LÄSKVITTOT HAR INGEN EGEN TABELL. Den som öppnat ett inlägg får en rad i
-- notification_dismissed (0038) med klockans id för inlägget (`nyhet-<id>`),
-- samma rad som när posten avfärdas i klockan. "Läst" betyder då samma sak på
-- båda ställena, som för Nytt i navet (`markeraNavnyhetLast`). Påminnelsen
-- till den som inte läst är en händelse i notification_event (kalla
-- `nyhet-paminn`) och bokförs i audit_log (`news.reminded`).
--
-- Läsning med RLS: den som kvitterat ser sin rad, och inläggets författare
-- och ledningen (säljchef, VD, administratör: de som får skriva inlägg) ser
-- alla rader för att kunna se vilka som kvitterat. Ingen skrivpolicy: rutten
-- /nav2/nyheter skriver med service role efter egna kontroller, som resten
-- av navet.
--
-- Beställaren 2026-10-15: ingen funktion i utkastet får försvinna.
-- =============================================================================

alter table public.news_post add column if not exists ack_due date;
alter table public.news_post add column if not exists scheduled_at timestamptz;

comment on column public.news_post.ack_due is
  'Nav 2.0: sista dag att kvittera. Null = ingen kvittens krävs.';
comment on column public.news_post.scheduled_at is
  'Nav 2.0: när ett schemalagt utkast ska publiceras av dagtidsjobbet. Null = inte schemalagt.';

-- Dagtidsjobbet frågar var kvart efter schemalagda utkast som är dags.
create index if not exists news_post_schemalagd_idx
  on public.news_post (scheduled_at)
  where status = 'draft' and scheduled_at is not null;

create table if not exists public.news_ack (
  post_id     uuid not null references public.news_post (id) on delete cascade,
  employee_id uuid not null references public.employee (id) on delete cascade,
  acked_at    timestamptz not null default now(),
  primary key (post_id, employee_id)
);

create index if not exists news_ack_person_idx on public.news_ack (employee_id);

alter table public.news_ack enable row level security;

drop policy if exists news_ack_read on public.news_ack;
create policy news_ack_read on public.news_ack for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or exists (
      select 1 from public.news_post p
       where p.id = news_ack.post_id
         and p.author_id = public.current_employee_id()
    )
    or public.has_any_role(array['sales_manager', 'admin', 'ceo'])
  );
