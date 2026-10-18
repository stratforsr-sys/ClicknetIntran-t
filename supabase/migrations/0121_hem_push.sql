-- 0121 · Startsidan: kvällsnotisen i mobilen, och lagets mål ur Provision (2026-10-18)
--
-- =============================================================================
-- 1. LAGETS MÅL SÄTTS I PROVISION, INTE HÄR
--
-- 0120 lade `team_goal`, ett eget lagmål i ordervärde. Beställaren 2026-10-18:
-- målet sätts redan i Provision. Golvet räknar därför lagets mål som summan av
-- säljarnas mål (`sales_target`, 0049), och tabellen tas bort. Den var tom.
--
-- 2. KVÄLLSNOTISEN (E5.8)
--
-- En pushnotis per person och kväll till ledarna (säljchef, VD, teamledare):
-- nästa arbetsdag, och på söndagen veckan som kommer. Beställaren 2026-10-18:
-- pushtjänst om det behövs, ja. Det behövs: E5.8 säger push i mobilen och inget
-- nytt mejl vid sidan av morgonbrevet.
--
--   push_subscription  en rad per enhet som sagt ja (Web Push, VAPID).
--                      Pushen bär inget innehåll; enhetens service worker hämtar
--                      texten från /nav2/hem?kvall=1 med personens egen
--                      inloggning, så notisen och startsidan säger samma sak.
--   push_sent          en rad per person, sort och dag: aldrig två kvällsnotiser
--                      samma kväll, hur ofta jobbet än körs.
-- =============================================================================

drop table if exists public.team_goal;

create table public.push_subscription (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  last_error text
);
create index push_subscription_employee_idx on public.push_subscription (employee_id);
alter table public.push_subscription enable row level security;
create policy push_subscription_read on public.push_subscription for select to authenticated
  using (employee_id = public.current_employee_id());
comment on table public.push_subscription is
  'Nav 2.0 (0121): enheter som tar emot pushnotiser (Web Push). Skrivs via /nav2/hem med service role.';

create table public.push_sent (
  employee_id uuid not null references public.employee (id) on delete cascade,
  kind text not null check (kind in ('kvall', 'sondag', 'prov')),
  day date not null,
  sent_at timestamptz not null default now(),
  devices smallint not null default 0,
  primary key (employee_id, kind, day)
);
alter table public.push_sent enable row level security;
create policy push_sent_read on public.push_sent for select to authenticated
  using (employee_id = public.current_employee_id());
comment on table public.push_sent is
  'Nav 2.0 (0121): skickade pushnotiser, en per person, sort och dag.';
