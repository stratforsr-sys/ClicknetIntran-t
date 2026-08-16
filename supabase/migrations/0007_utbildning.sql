-- =============================================================================
-- 0007_utbildning.sql — M6 Utbildning och certifiering (PRD §7 M6, E8)
--
-- Modulen som gor att 25 nya saljare kan lara sig samma sak utan att chefen
-- upprepar introduktionen trettio ganger.
--
-- Barande tanke: ett forsok far ALDRIG raderas eller skrivas over. Godkant och
-- underkant ar lika mycket bevis, och AC-6.2:s sparrtid gar inte att raka pa
-- om historiken kan stadas bort. `course_attempt` ar darfor en logg, inte ett
-- tillstand — det aktuella laget raknas fram ur den.
-- =============================================================================

create table if not exists course (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique,
  title            text not null,
  description_md   text not null default '',
  audience_roles   text[] not null default '{}',   -- tom = alla, som i M5
  status           text not null default 'draft'
                     check (status in ('draft','published','archived')),

  -- AC-6.2. Gransen ar per kurs eftersom ett sakerhetsprov och en
  -- produktintroduktion inte rimligen har samma krav.
  pass_threshold   int  not null default 80 check (pass_threshold between 1 and 100),
  retry_wait_hours int  not null default 24 check (retry_wait_hours >= 0),

  -- AC-6.3. Null = certifikatet gar aldrig ut.
  valid_months     int  check (valid_months is null or valid_months > 0),

  -- AC-6.5. Anvands av M9 nar dialern kopplas pa. Star kvar oanvand tills dess
  -- — kolumnen ar billig, en senare migration mitt i drift ar det inte.
  blocks_capability text,

  owner_id         uuid not null references employee(id),
  created_by       uuid references employee(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists course_status_idx on course (status);

-- AC-6.1: moduler i ordning. `sort` ar ordningen, och den ar unik per kurs sa
-- att tva moduler inte kan slass om samma plats.
create table if not exists course_module (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references course(id) on delete cascade,
  sort       int  not null,
  title      text not null,
  body_md    text not null default '',
  kind       text not null default 'reading' check (kind in ('reading','quiz','roleplay')),
  created_at timestamptz not null default now(),
  unique (course_id, sort)
);

create index if not exists course_module_course_idx on course_module (course_id, sort);

create table if not exists quiz_question (
  id        uuid primary key default gen_random_uuid(),
  module_id uuid not null references course_module(id) on delete cascade,
  sort      int  not null,
  prompt    text not null,
  unique (module_id, sort)
);

-- Ratt svar bor i databasen och far aldrig lamna servern. Se RLS langst ner:
-- tabellen ar helt stangd for klienten, och rattningen sker i en server action.
create table if not exists quiz_option (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references quiz_question(id) on delete cascade,
  sort        int  not null,
  label       text not null,
  is_correct  boolean not null default false,
  unique (question_id, sort)
);

-- AC-6.1: progression sparas per modul.
create table if not exists module_progress (
  employee_id  uuid not null references employee(id) on delete cascade,
  module_id    uuid not null references course_module(id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (employee_id, module_id)
);

-- AC-6.2 och AC-6.7. Rollspelsbedomningen delar tabell med quizet med flit:
-- bada ar "nagon provades och fick ett resultat", och en gemensam historik gor
-- att progressvyn inte behover tva sanningar om samma sak.
create table if not exists course_attempt (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references course(id) on delete cascade,
  module_id   uuid references course_module(id) on delete cascade,
  employee_id uuid not null references employee(id) on delete cascade,
  score       int  not null check (score between 0 and 100),
  passed      boolean not null,
  answers     jsonb,
  graded_by   uuid references employee(id),   -- satt vid rollspel (AC-6.7)
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists course_attempt_person_idx
  on course_attempt (employee_id, course_id, created_at desc);

-- AC-6.3.
create table if not exists certification (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee(id) on delete cascade,
  course_id   uuid not null references course(id) on delete cascade,
  attempt_id  uuid references course_attempt(id) on delete set null,
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz,
  unique (employee_id, course_id, issued_at)
);

create index if not exists certification_person_idx on certification (employee_id, course_id);
create index if not exists certification_expiry_idx on certification (expires_at)
  where expires_at is not null;

-- === Behorighet ============================================================
-- Samma modell som M5: lasning styrs av malgrupp, skrivning sker uteslutande
-- via server actions med service role.

alter table course          enable row level security;
alter table course_module   enable row level security;
alter table quiz_question   enable row level security;
alter table quiz_option     enable row level security;
alter table module_progress enable row level security;
alter table course_attempt  enable row level security;
alter table certification   enable row level security;

drop policy if exists course_read on course;
create policy course_read on course for select
  to authenticated
  using (
    (status = 'published' and public.matches_audience(audience_roles, '{}'::uuid[]))
    or owner_id = public.current_employee_id()
    or public.has_any_role(array['sales_manager','admin','ceo'])
  );

drop policy if exists course_module_read on course_module;
create policy course_module_read on course_module for select
  to authenticated
  using (exists (select 1 from public.course c where c.id = course_id));

-- Fragorna syns for den som ser modulen. Svarsalternativen gor det INTE:
-- ingen policy pa quiz_option betyder noll rader for varje inloggad, och
-- darmed finns inget satt att lasa ut facit ur webblasaren.
drop policy if exists quiz_question_read on quiz_question;
create policy quiz_question_read on quiz_question for select
  to authenticated
  using (exists (select 1 from public.course_module m where m.id = module_id));

revoke select on quiz_option from anon, authenticated;

-- Egen progress alltid. Chefer ser sitt folk (AC-6.6).
drop policy if exists module_progress_read on module_progress;
create policy module_progress_read on module_progress for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.can_read_all_employees()
    or public.leads_employee(employee_id)
  );

drop policy if exists course_attempt_read on course_attempt;
create policy course_attempt_read on course_attempt for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.can_read_all_employees()
    or public.leads_employee(employee_id)
  );

drop policy if exists certification_read on certification;
create policy certification_read on certification for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.can_read_all_employees()
    or public.leads_employee(employee_id)
  );
