-- 0120 · Startsidan: det Nav 2.0 har och navet saknade (2026-10-16)
--
-- =============================================================================
-- VARFÖR
--
-- Nav 2.0:s startsida har ett kort som navet inte har: Golvet just nu. Det
-- visar lagets ordervärde mot månadens mål med en takt, dagens godkända order
-- och en Grattis-knapp som ger säljaren en pling. Två saker saknas i databasen:
--
--   1. team_goal: lagets mål i ordervärde per månad. Navet har bara mål per
--      säljare (`sales_target`, 0049: antal order och provisionskronor), och
--      0049 säger att säljaren inte ser andras mål. Lagets mål är ett annat
--      tal: ett gemensamt mål i kronor ordervärde, som alla i laget ser.
--      `team_id` null betyder hela bolaget.
--   2. order_grattis: vem som gratulerat till vilken order. Antalet står på
--      raden, och säljaren får en notis (`order-grattis`).
--
-- Det övriga startsidan behöver ligger redan i navet: valen i
-- `nav_preference` (0094: hem.sett, hem.dolda, hem.flaggade, hem.golvet),
-- "Stämmer inte" som en felrapport i `error_report`, och resten läses ur de
-- vyer som redan är kopplade.
--
-- Beställaren 2026-10-15: ingen funktion i utkastet får försvinna.
-- =============================================================================

create table public.team_goal (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.team (id) on delete cascade,
  period_month date not null check (period_month = date_trunc('month', period_month)::date),
  order_value numeric(12,2) not null check (order_value > 0),
  set_by uuid not null references public.employee (id),
  set_at timestamptz not null default now()
);
-- En rad per lag och månad. Null-laget (hela bolaget) räknas som ett lag.
create unique index team_goal_unik on public.team_goal (coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid), period_month);
alter table public.team_goal enable row level security;
-- Ett lagmål är gemensamt: alla inloggade läser det. Skrivning via service role.
create policy team_goal_read on public.team_goal for select to authenticated using (true);
comment on table public.team_goal is
  'Nav 2.0 (0120): lagets mål i ordervärde per månad. team_id null = hela bolaget. Inte samma sak som sales_target (per säljare).';

create table public.order_grattis (
  order_id uuid not null references public.sales_order (id) on delete cascade,
  employee_id uuid not null references public.employee (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (order_id, employee_id)
);
alter table public.order_grattis enable row level security;
create policy order_grattis_read on public.order_grattis for select to authenticated
  using (employee_id = public.current_employee_id());
comment on table public.order_grattis is
  'Nav 2.0 (0120): Grattis på Golvet. Antalet per order läses av servern; var och en ser sina egna rader.';
