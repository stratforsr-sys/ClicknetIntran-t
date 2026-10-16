-- 0097 · Utbildning: det Nav 2.0 har och navet saknade (2026-10-15)
--
-- =============================================================================
-- VARFÖR
--
-- Repot bär kurserna, modulerna, proven, framstegen, rollspelen med bedömning
-- och certifikaten (0007, 0024). Nav 2.0:s utbildningsvy har mer:
--
--   1. course.learning_meta: kursens typ (kurs, kortkurs, drill, program),
--      färdigheterna den tränar, antal dagar för en drill, steget i
--      säljresan och rutinen den hör till.
--   2. learning_answer: varje svar i repetitionen och i lektionerna, med hur
--      säker personen var och när frågan ska komma tillbaka (spridd
--      repetition: fel i morgon, gissat rätt om 2 dagar, säkert rätt om 7).
--      Kunskapskartan och "repetition i rad" räknas ur den. Frågorna är
--      kursernas egna provfrågor (quiz_question).
--   3. learning_rule: din regelbok, regler du sparat ur lektionerna.
--   4. learning_note: reflektioner, förberedelser och anteckningar, bara dina.
--   5. module_rating: "Hur var lektionen?", en till fem stjärnor.
--   6. roleplay_self: din egen bedömning, kriterium för kriterium, som visas
--      bredvid chefens.
--   7. team_repetition: frågor chefen lagt i hela teamets repetition.
--   8. lecture med anmälan, frågor i förväg, uppföljning dag 1/3/7/30 och
--      delade insikter.
--   9. course_wish: "Önska en kurs om det".
--
-- Beställaren 2026-10-15: ingen funktion i utkastet får försvinna.
-- =============================================================================

alter table public.course add column if not exists learning_meta jsonb not null default '{}'::jsonb;

create table public.learning_answer (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee (id) on delete cascade,
  question_id uuid not null references public.quiz_question (id) on delete cascade,
  correct boolean not null,
  confidence text not null default 'ganska' check (confidence in ('saker', 'ganska', 'gissade')),
  source text not null check (source in ('repetition', 'lektion', 'team', 'fortest', 'uppfoljning')),
  answered_at timestamptz not null default now(),
  next_due date not null
);
create index learning_answer_person on public.learning_answer (employee_id, answered_at desc);
create index learning_answer_fraga on public.learning_answer (question_id);
alter table public.learning_answer enable row level security;
create policy learning_answer_read on public.learning_answer for select to authenticated
  using (employee_id = public.current_employee_id() or public.has_any_role(array['sales_manager', 'admin', 'ceo']) or public.leads_employee(employee_id));

create table public.learning_rule (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 500),
  course_id uuid references public.course (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (employee_id, text)
);
alter table public.learning_rule enable row level security;
create policy learning_rule_read on public.learning_rule for select to authenticated using (employee_id = public.current_employee_id());

create table public.learning_note (
  employee_id uuid not null references public.employee (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9:._-]{1,120}$'),
  text text not null check (char_length(text) <= 4000),
  updated_at timestamptz not null default now(),
  primary key (employee_id, key)
);
alter table public.learning_note enable row level security;
create policy learning_note_read on public.learning_note for select to authenticated using (employee_id = public.current_employee_id());

create table public.module_rating (
  employee_id uuid not null references public.employee (id) on delete cascade,
  module_id uuid not null references public.course_module (id) on delete cascade,
  stars integer not null check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (employee_id, module_id)
);
alter table public.module_rating enable row level security;
create policy module_rating_read on public.module_rating for select to authenticated
  using (employee_id = public.current_employee_id() or public.has_any_role(array['sales_manager', 'admin', 'ceo']));

create table public.roleplay_self (
  employee_id uuid not null references public.employee (id) on delete cascade,
  module_id uuid not null references public.course_module (id) on delete cascade,
  criterion_id uuid not null references public.roleplay_criterion (id) on delete cascade,
  points integer not null check (points between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (employee_id, criterion_id)
);
alter table public.roleplay_self enable row level security;
create policy roleplay_self_read on public.roleplay_self for select to authenticated
  using (employee_id = public.current_employee_id() or public.has_any_role(array['sales_manager', 'ceo']) or public.leads_employee(employee_id));

create table public.team_repetition (
  question_id uuid primary key references public.quiz_question (id) on delete cascade,
  added_by uuid references public.employee (id) on delete set null,
  added_at timestamptz not null default now(),
  until date not null
);
alter table public.team_repetition enable row level security;
create policy team_repetition_read on public.team_repetition for select to authenticated using (true);

create table public.lecture (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  starts_at timestamptz not null,
  length_min integer not null default 45 check (length_min between 5 and 480),
  presenter_id uuid references public.employee (id) on delete set null,
  location text check (location is null or char_length(location) <= 200),
  prep text check (prep is null or char_length(prep) <= 1000),
  key_points text[] not null default '{}',
  skill text check (skill is null or skill in ('oppning', 'behov', 'invand', 'avslut', 'efter', 'produkt', 'regler')),
  recording_url text,
  created_by uuid references public.employee (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.lecture enable row level security;
create policy lecture_read on public.lecture for select to authenticated using (public.current_employee_id() is not null);

create table public.lecture_signup (
  lecture_id uuid not null references public.lecture (id) on delete cascade,
  employee_id uuid not null references public.employee (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (lecture_id, employee_id)
);
alter table public.lecture_signup enable row level security;
create policy lecture_signup_read on public.lecture_signup for select to authenticated
  using (employee_id = public.current_employee_id() or public.has_any_role(array['sales_manager', 'admin', 'ceo'])
         or exists (select 1 from public.lecture l where l.id = lecture_id and l.presenter_id = public.current_employee_id()));

create table public.lecture_question (
  id uuid primary key default gen_random_uuid(),
  lecture_id uuid not null references public.lecture (id) on delete cascade,
  employee_id uuid not null references public.employee (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 1000),
  kind text not null default 'fraga' check (kind in ('fraga', 'insikt')),
  created_at timestamptz not null default now()
);
alter table public.lecture_question enable row level security;
create policy lecture_question_read on public.lecture_question for select to authenticated
  using (employee_id = public.current_employee_id() or kind = 'insikt' or public.has_any_role(array['sales_manager', 'admin', 'ceo'])
         or exists (select 1 from public.lecture l where l.id = lecture_id and l.presenter_id = public.current_employee_id()));

create table public.lecture_followup (
  lecture_id uuid not null references public.lecture (id) on delete cascade,
  employee_id uuid not null references public.employee (id) on delete cascade,
  step text not null check (step in ('dag1', 'dag3', 'dag7', 'dag30')),
  done_at timestamptz not null default now(),
  primary key (lecture_id, employee_id, step)
);
alter table public.lecture_followup enable row level security;
create policy lecture_followup_read on public.lecture_followup for select to authenticated
  using (employee_id = public.current_employee_id() or public.has_any_role(array['sales_manager', 'admin', 'ceo']));

create table public.course_wish (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employee (id) on delete set null,
  query text not null check (char_length(query) between 2 and 200),
  created_at timestamptz not null default now()
);
alter table public.course_wish enable row level security;
create policy course_wish_read on public.course_wish for select to authenticated
  using (employee_id = public.current_employee_id() or public.has_any_role(array['sales_manager', 'admin', 'ceo']));
