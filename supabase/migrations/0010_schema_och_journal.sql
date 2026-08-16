-- =============================================================================
-- 0010_schema_och_journal.sql — arbetsschema och arbetstidsjournal (E4.4, E4.6, E4.7)
--
-- Schemat behovs for tva saker: att kunna stanga en glomd utstampling vid
-- arbetsdagens slut (AC-2.4), och senare som ram for rastschemat.
--
-- Ett schema ANDRAS ALDRIG. En andring ar en ny rad med nytt `valid_from`.
-- Skalet ar samma som i AC-2.35: en tid som redan passerat far inte bedomas
-- mot regler som inte gallde da. Den som skriver over ett schema skriver om
-- historien utan att marka det.
-- =============================================================================

create table if not exists work_schedule (
  id           uuid primary key default gen_random_uuid(),

  -- Niva. Mest specifik vinner: person fore team fore bolag.
  scope        text not null check (scope in ('company','team','employee')),
  employee_id  uuid references employee(id) on delete cascade,
  team_id      uuid references team(id) on delete cascade,

  weekday      int  not null check (weekday between 1 and 7),   -- 1 = mandag
  start_time   time not null,
  end_time     time not null,

  valid_from   date not null default current_date,
  created_by   uuid references employee(id),
  created_at   timestamptz not null default now(),

  -- Nivan maste stamma med vilket id som ar satt, annars gar det att skapa
  -- ett "personschema" utan person.
  constraint work_schedule_niva check (
    (scope = 'employee' and employee_id is not null and team_id is null)
    or (scope = 'team'   and team_id is not null and employee_id is null)
    or (scope = 'company' and employee_id is null and team_id is null)
  ),
  constraint work_schedule_tid check (end_time > start_time)
);

create index if not exists work_schedule_uppslag_idx
  on work_schedule (weekday, valid_from desc);

-- AC-2.7: journaldata bevaras i tre ar och undantas gallringen. Tabellen ar
-- ett arkiv, inte en cache: raderna skrivs en gang nar en dag ar avslutad och
-- rors sedan inte. Att rakna om dem ur time_event vid varje forfragan hade
-- gjort journalen beroende av att gallringen aldrig nar stamplingarna.
create table if not exists work_time_journal (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references employee(id),
  work_date      date not null,

  worked_minutes int not null default 0,
  break_minutes  int not null default 0,

  -- AC-2.19-2.21: orden far inte forekomma i vardagsgranssnittet, men
  -- journalen ar just den compliance-vy dar de MASTE vara atskilda (AC-2.6).
  on_call_minutes   int not null default 0,
  overtime_minutes  int not null default 0,
  extra_time_minutes int not null default 0,

  auto_closed    boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (employee_id, work_date)
);

create index if not exists work_time_journal_period_idx
  on work_time_journal (work_date, employee_id);

alter table work_schedule     enable row level security;
alter table work_time_journal enable row level security;

-- Var och en ska kunna se sitt eget schema. Det ar en arbetsvillkorsuppgift,
-- inte en hemlighet.
drop policy if exists work_schedule_read on work_schedule;
create policy work_schedule_read on work_schedule for select
  to authenticated
  using (
    scope = 'company'
    or (scope = 'team' and team_id = (
          select e.team_id from public.employee e where e.id = public.current_employee_id()))
    or employee_id = public.current_employee_id()
    or public.can_read_all_employees()
    or public.leads_employee(employee_id)
  );

-- AC-2.6: journalen ar en compliance-vy. Egen rad alltid — den anstallda har
-- ratt till uppgifter om sig sjalv — men i ovrigt endast ledningen.
drop policy if exists work_time_journal_read on work_time_journal;
create policy work_time_journal_read on work_time_journal for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.has_any_role(array['sales_manager','admin'])
  );
