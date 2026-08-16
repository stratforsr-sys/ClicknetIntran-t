-- =============================================================================
-- 0001_identitet.sql — M1 Identitet, organisation, behorighet (PRD §7 M1, E1)
--
-- Definition of Done p.2: RLS-policy skrivs i samma migration som tabellen.
-- AC-1.6: varje tabell med persondata har RLS. Anonym anslutning ger 0 rader.
-- =============================================================================

create extension if not exists pgcrypto;

-- === Organisation ==========================================================

create table if not exists company (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  org_number  text,
  created_at  timestamptz not null default now()
);

create table if not exists team (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  lead_id     uuid,
  company_id  uuid references company(id),
  created_at  timestamptz not null default now()
);

create table if not exists employee (
  id               uuid primary key default gen_random_uuid(),
  auth_user_id     uuid unique,
  email            text not null unique,
  first_name       text not null,
  last_name        text not null,
  employment_type  text not null default 'permanent'
                     check (employment_type in ('permanent','probation','consultant','intern')),
  team_id          uuid references team(id),
  manager_id       uuid references employee(id),
  company_id       uuid references company(id),
  start_date       date,
  end_date         date,
  employee_number  text,
  status           text not null default 'onboarding'
                     check (status in ('active','onboarding','offboarded')),
  last_sign_in_at  timestamptz,
  created_at       timestamptz not null default now()
);

alter table team drop constraint if exists team_lead_fk;
alter table team add constraint team_lead_fk
  foreign key (lead_id) references employee(id) on delete set null;

create index if not exists employee_team_idx    on employee(team_id);
create index if not exists employee_manager_idx on employee(manager_id);
create index if not exists employee_status_idx  on employee(status);

-- === Roller och behorigheter ===============================================
-- PRD §5.1. `payroll_cost_viewer` ligger medvetet i en EGEN tabell: den ska
-- kunna ges och dras in per person, oberoende av teknisk roll (§1.4, Q63).

create table if not exists employee_role (
  employee_id uuid not null references employee(id) on delete cascade,
  role        text not null check (role in
                ('salesperson','team_lead','sales_manager','finance',
                 'ceo','project_manager','admin','delivery')),
  granted_by  uuid references employee(id),
  granted_at  timestamptz not null default now(),
  primary key (employee_id, role)
);

create table if not exists employee_permission (
  employee_id uuid not null references employee(id) on delete cascade,
  permission  text not null check (permission in ('payroll_cost_viewer')),
  granted_by  uuid references employee(id),
  granted_at  timestamptz not null default now(),
  primary key (employee_id, permission)
);

-- === Styrning (M12) ========================================================

create table if not exists audit_log (
  id          bigserial primary key,
  actor_id    uuid references employee(id),
  action      text not null,
  object_type text,
  object_id   text,
  ts          timestamptz not null default now(),
  ip          inet,
  reason      text,
  meta        jsonb
);

create index if not exists audit_log_ts_idx     on audit_log(ts desc);
create index if not exists audit_log_object_idx on audit_log(object_type, object_id);

-- === Offboarding-checklista (AC-1.7) =======================================
-- Ingen post kan hoppas over utan motivering: darav check-villkoret.

create table if not exists offboarding_task (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references employee(id) on delete cascade,
  label          text not null,
  sort           int not null default 0,
  state          text not null default 'open' check (state in ('open','done','skipped')),
  skipped_reason text,
  handled_by     uuid references employee(id),
  handled_at     timestamptz,
  constraint offboarding_skip_needs_reason
    check (state <> 'skipped' or (skipped_reason is not null and length(trim(skipped_reason)) > 0))
);

create index if not exists offboarding_task_employee_idx on offboarding_task(employee_id);

-- =============================================================================
-- Hjalpfunktioner
--
-- security definer + tomt search_path. Utan det kan en anvandare skapa en egen
-- `employee`-tabell i sitt schema och lura funktionen.
-- =============================================================================

create or replace function public.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id
  from public.employee
  where auth_user_id = auth.uid()
    and status <> 'offboarded'
  limit 1
$$;

create or replace function public.has_role(wanted text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.employee_role r
    join public.employee e on e.id = r.employee_id
    where e.auth_user_id = auth.uid()
      and e.status <> 'offboarded'
      and r.role = wanted
  )
$$;

create or replace function public.has_any_role(wanted text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.employee_role r
    join public.employee e on e.id = r.employee_id
    where e.auth_user_id = auth.uid()
      and e.status <> 'offboarded'
      and r.role = any(wanted)
  )
$$;

-- Ser hela personalregistret. `admin` ingar for att kunna skota konton,
-- men far INTE lonekostnad (PRD §5.2, sista raden).
create or replace function public.can_read_all_employees()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_any_role(array['sales_manager','ceo','admin'])
$$;

create or replace function public.leads_employee(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.employee me
    join public.employee target_e on target_e.id = target
    where me.auth_user_id = auth.uid()
      and me.status <> 'offboarded'
      and (target_e.manager_id = me.id
           or target_e.team_id in (select id from public.team where lead_id = me.id))
  )
$$;

-- AC-1.5 / AC-12.1: loggning far inte ga att kringga fran klienten.
create or replace function public.log_audit(
  p_action      text,
  p_object_type text default null,
  p_object_id   text default null,
  p_reason      text default null,
  p_meta        jsonb default null
) returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  insert into public.audit_log (actor_id, action, object_type, object_id, reason, meta)
  values (public.current_employee_id(), p_action, p_object_type, p_object_id, p_reason, p_meta)
$$;

-- =============================================================================
-- RLS
-- =============================================================================

alter table company             enable row level security;
alter table team                enable row level security;
alter table employee            enable row level security;
alter table employee_role       enable row level security;
alter table employee_permission enable row level security;
alter table audit_log           enable row level security;
alter table offboarding_task    enable row level security;

-- Alla inloggade far se bolag och team. Det ar organisationsstruktur,
-- inte persondata, och behovs for att kunna rendera vilken vy som helst.
drop policy if exists company_read on company;
create policy company_read on company for select
  to authenticated using (true);

drop policy if exists team_read on team;
create policy team_read on team for select
  to authenticated using (true);

-- Personal: egen rad alltid. Chef ser sitt team. Ledning ser alla.
drop policy if exists employee_read on employee;
create policy employee_read on employee for select
  to authenticated
  using (
    auth_user_id = auth.uid()
    or public.can_read_all_employees()
    or public.leads_employee(id)
  );

-- Skrivning gar aldrig via klienten. Server actions anvander service role och
-- gor sin egen behorighetskontroll, sa att varje skrivning kan loggas.
drop policy if exists employee_role_read on employee_role;
create policy employee_role_read on employee_role for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.can_read_all_employees()
    or public.leads_employee(employee_id)
  );

drop policy if exists employee_permission_read on employee_permission;
create policy employee_permission_read on employee_permission for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.has_any_role(array['sales_manager','ceo'])
  );

-- PRD §5.2: audit log lases av sales_manager och ceo. Aldrig av salesperson.
drop policy if exists audit_log_read on audit_log;
create policy audit_log_read on audit_log for select
  to authenticated
  using (public.has_any_role(array['sales_manager','ceo','admin']));

drop policy if exists offboarding_task_read on offboarding_task;
create policy offboarding_task_read on offboarding_task for select
  to authenticated
  using (public.can_read_all_employees());

-- =============================================================================
-- Seed: bolagen enligt PRD §6.2. ABL Konsult & Invest AB — inte ABL Invest AB,
-- rattat efter sidfoten pa clicknet.se (UI-PRD §3.0).
-- =============================================================================

insert into company (name, org_number)
select 'ABL Konsult & Invest AB', null
where not exists (select 1 from company where name = 'ABL Konsult & Invest AB');

insert into company (name, org_number)
select 'Effektiv Group AB', null
where not exists (select 1 from company where name = 'Effektiv Group AB');
