-- =============================================================================
-- 0011_rastschema.sql — rastschema och avvikelser (E4.10–E4.19)
--
-- K29 ÄR EN SPÄRR: rastschemat ska vara dokumenterat i förväg enligt ATL 15 §
-- innan avvikelsefunktionen aktiveras. Tabellerna skapas nu; genereringen
-- sitter bakom `RAST_AKTIV` i src/lib/tid.ts och startar inte av sig själv.
--
-- AC-2.35 är det hårdaste kravet här: **historiska avvikelser omvärderas
-- aldrig**. Därför bär varje avvikelse id:t på det schema den bedömdes mot,
-- och ett schema ändras aldrig — det ersätts av en ny rad med nytt
-- `valid_from`. Utan det kan en schemaändring retroaktivt skapa avvikelser
-- för någon som följde reglerna som gällde då.
-- =============================================================================

create table if not exists scheduled_break (
  id           uuid primary key default gen_random_uuid(),

  scope        text not null check (scope in ('company','team','employee')),
  employee_id  uuid references employee(id) on delete cascade,
  team_id      uuid references team(id) on delete cascade,

  weekday      int  not null check (weekday between 1 and 7),
  sort         int  not null default 1,          -- rast 1, rast 2 …

  -- AC-2.23. `window_end` ar onskad SENASTE STARTTID, inte sluttid. En rast
  -- som borjar efter den ger ingen avvikelse alls (AC-2.25) — beställarens
  -- regel, och den star kvar har for att ingen ska "rätta" den senare.
  window_start     time not null,
  window_end       time not null,
  duration_minutes int  not null check (duration_minutes > 0),

  -- AC-2.33, Q67 besvarad: saljarna far lamna arbetsplatsen. Alltsa rast,
  -- obetald, ingen skyldighet att vara nabar. Inte maltidsuppehall.
  break_kind   text not null default 'rast' check (break_kind in ('rast','maltidsuppehall')),

  -- AC-2.26: tolerans per avvikelsetyp, minst fem minuter.
  tol_early_start  int not null default 5 check (tol_early_start >= 5),
  tol_overrun      int not null default 5 check (tol_overrun >= 5),
  tol_missing      int not null default 5 check (tol_missing >= 5),

  valid_from   date not null default current_date,
  created_by   uuid references employee(id),
  created_at   timestamptz not null default now(),

  constraint scheduled_break_niva check (
    (scope = 'employee' and employee_id is not null and team_id is null)
    or (scope = 'team'   and team_id is not null and employee_id is null)
    or (scope = 'company' and employee_id is null and team_id is null)
  ),
  constraint scheduled_break_fonster check (window_end >= window_start)
);

create index if not exists scheduled_break_uppslag_idx
  on scheduled_break (weekday, valid_from desc);

-- AC-2.36: den anstallda ska ha kvitterat det nya schemat innan avvikelser
-- borjar genereras mot det. Utan kvittens bedoms ingenting — tystnad ar inte
-- ett godkannande.
create table if not exists break_schedule_ack (
  schedule_id uuid not null references scheduled_break(id) on delete cascade,
  employee_id uuid not null references employee(id) on delete cascade,
  acked_at    timestamptz not null default now(),
  primary key (schedule_id, employee_id)
);

create table if not exists break_deviation (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references employee(id) on delete cascade,
  work_date    date not null,

  -- AC-2.24.
  kind         text not null check (kind in ('early_start','overrun','missing','unscheduled')),
  minutes      int  not null default 0,

  -- Beviset for AC-2.35: vilket schema domen faktiskt vilar pa.
  schedule_id  uuid references scheduled_break(id),

  employee_comment text,          -- AC-2.28: den anstallda far svara
  detected_at  timestamptz not null default now(),

  unique (employee_id, work_date, kind, minutes)
);

create index if not exists break_deviation_person_idx
  on break_deviation (employee_id, work_date desc);
create index if not exists break_deviation_gallring_idx on break_deviation (work_date);

-- AC-2.11, AC-2.31: detaljerna gallras efter 90 dagar, aggregatet star kvar i
-- 12 manader. Aggregatet ar med flit grovt — antal per typ och manad sager
-- tillrackligt for att folja en trend, men inte nog for att rekonstruera en
-- enskild dag.
create table if not exists break_deviation_month (
  employee_id uuid not null references employee(id) on delete cascade,
  month       date not null,            -- alltid den forsta i manaden
  kind        text not null,
  antal       int  not null default 0,
  primary key (employee_id, month, kind)
);

alter table scheduled_break       enable row level security;
alter table break_schedule_ack    enable row level security;
alter table break_deviation       enable row level security;
alter table break_deviation_month enable row level security;

drop policy if exists scheduled_break_read on scheduled_break;
create policy scheduled_break_read on scheduled_break for select
  to authenticated
  using (
    scope = 'company'
    or (scope = 'team' and team_id = (
          select e.team_id from public.employee e where e.id = public.current_employee_id()))
    or employee_id = public.current_employee_id()
    or public.can_read_all_employees()
    or public.leads_employee(employee_id)
  );

drop policy if exists break_schedule_ack_read on break_schedule_ack;
create policy break_schedule_ack_read on break_schedule_ack for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.can_read_all_employees()
    or public.leads_employee(employee_id)
  );

-- AC-2.28 och AC-2.10: den anstallda ser sina egna i sin helhet, chefen ser
-- sitt folks. Ingen annan ser nagot.
drop policy if exists break_deviation_read on break_deviation;
create policy break_deviation_read on break_deviation for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.can_read_all_employees()
    or public.leads_employee(employee_id)
  );

drop policy if exists break_deviation_month_read on break_deviation_month;
create policy break_deviation_month_read on break_deviation_month for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.can_read_all_employees()
    or public.leads_employee(employee_id)
  );
