-- 0100 · Coachning: det Nav 2.0 har och navet saknade (2026-10-18)
--
-- =============================================================================
-- VARFÖR
--
-- Repot bär överenskommelserna (coaching_task med händelser, 0043), samtalen
-- (coaching_session, GROW), fokusområdena och mallarna. Nav 2.0:s coachning har
-- mer, och allt här är additivt: inga befintliga rader rörs.
--
--   1. coaching_drill: dagens övning, ett om-så-löfte ("När X → gör jag Y") i
--      fem eller tio arbetsdagar. Högst två aktiva per person (kontrolleras i
--      rutten, som utkastet). Blir den en vana står den kvar med status 'vana'.
--   2. coaching_drill_answer: svaret per övningsdag (ja, delvis, inget
--      tillfälle, nej), med en valfri rad, skälet vid delvis och nej, och vilket
--      samtal det gällde.
--   3. coaching_habit_check: vanans två kontroller, efter en och tre veckor.
--   4. coaching_message: chefens korta rader ("Hur går övningen?").
--   5. coaching_person_focus: personens fokusområde. I repot hör fokus till en
--      uppgift; i Nav 2.0 har personen ett område i taget, valt på 1:1:et.
--   6. coaching_meeting_request: "Be om en 1:1".
--   7. coaching_task_note: rader i en överenskommelses tråd som inte är en
--      händelse i 0043:s mening, i dag "Flyttade datumet från … till …".
--   8. coaching_task.nav2_kind: utkastets "Rollspel live" utan rollspelsmodul
--      sparas som 'uppgift' med motpart (0043 kräver module_id för
--      rollspel_live), och kolumnen säger att Nav 2.0 ska visa den som rollspel.
--   9. coaching_session: förra målet (nåddes, delvis, inte än) och fokusområdet.
--  10. one_on_one_point.removed_at: säljaren tar bort en egen punkt, med Ångra.
--  11. learning_note: chefen läser ett mål från Utbildning som säljaren valt
--      att visa inför 1:1 (`mal:<modul>` med "coach":true, se 0097).
--
-- Läsning med RLS som coaching_session (personen, chefen, ledningen). Ingen
-- skrivpolicy: rutten /nav2/coachning skriver med service role efter egna
-- kontroller, som resten av coachningen (D-T1).
--
-- Beställaren 2026-10-15: ingen funktion i utkastet får försvinna.
-- =============================================================================

create table public.coaching_drill (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee (id) on delete cascade,
  focus_id uuid references public.coaching_focus (id) on delete set null,
  when_text text not null check (char_length(btrim(when_text)) between 1 and 120),
  then_text text not null check (char_length(btrim(then_text)) between 1 and 160),
  routine_slug text check (routine_slug is null or char_length(routine_slug) <= 120),
  days smallint not null default 5 check (days between 1 and 60),
  starts_on date not null,
  status text not null default 'aktiv' check (status in ('aktiv', 'vana', 'avslutad')),
  habit_since date,
  session_id uuid references public.coaching_session (id) on delete set null,
  created_by uuid not null references public.employee (id),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint coaching_drill_vana check (status <> 'vana' or habit_since is not null)
);
create index coaching_drill_person on public.coaching_drill (employee_id, starts_on desc);
alter table public.coaching_drill enable row level security;
create policy coaching_drill_read on public.coaching_drill for select to authenticated
  using (employee_id = public.current_employee_id() or created_by = public.current_employee_id()
         or public.can_read_all_employees() or public.leads_employee(employee_id));

create table public.coaching_drill_answer (
  drill_id uuid not null references public.coaching_drill (id) on delete cascade,
  day date not null,
  answer text not null check (answer in ('ja', 'delvis', 'inget', 'nej')),
  note text check (note is null or char_length(note) <= 200),
  reason text check (reason is null or reason in ('Glömde bort det', 'Kunden la på innan', 'Visste inte vad jag skulle säga', 'Passade inte i samtalet')),
  call_label text check (call_label is null or char_length(call_label) <= 200),
  answered_at timestamptz not null default now(),
  primary key (drill_id, day)
);
alter table public.coaching_drill_answer enable row level security;
create policy coaching_drill_answer_read on public.coaching_drill_answer for select to authenticated
  using (exists (select 1 from public.coaching_drill d where d.id = drill_id));

create table public.coaching_habit_check (
  drill_id uuid not null references public.coaching_drill (id) on delete cascade,
  due_on date not null,
  answer text not null check (answer in ('ja', 'ibland', 'nej')),
  answered_at timestamptz not null default now(),
  primary key (drill_id, due_on)
);
alter table public.coaching_habit_check enable row level security;
create policy coaching_habit_check_read on public.coaching_habit_check for select to authenticated
  using (exists (select 1 from public.coaching_drill d where d.id = drill_id));

create table public.coaching_message (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee (id) on delete cascade,
  from_id uuid not null references public.employee (id),
  text text not null check (char_length(btrim(text)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index coaching_message_person on public.coaching_message (employee_id, created_at desc);
alter table public.coaching_message enable row level security;
create policy coaching_message_read on public.coaching_message for select to authenticated
  using (employee_id = public.current_employee_id() or from_id = public.current_employee_id()
         or public.can_read_all_employees() or public.leads_employee(employee_id));

create table public.coaching_person_focus (
  employee_id uuid primary key references public.employee (id) on delete cascade,
  focus_id uuid not null references public.coaching_focus (id) on delete cascade,
  set_by uuid references public.employee (id) on delete set null,
  set_at timestamptz not null default now()
);
alter table public.coaching_person_focus enable row level security;
create policy coaching_person_focus_read on public.coaching_person_focus for select to authenticated
  using (employee_id = public.current_employee_id() or public.can_read_all_employees() or public.leads_employee(employee_id));

create table public.coaching_meeting_request (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee (id) on delete cascade,
  requested_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid references public.employee (id) on delete set null
);
create unique index coaching_meeting_request_oppen on public.coaching_meeting_request (employee_id) where handled_at is null;
alter table public.coaching_meeting_request enable row level security;
create policy coaching_meeting_request_read on public.coaching_meeting_request for select to authenticated
  using (employee_id = public.current_employee_id() or public.can_read_all_employees() or public.leads_employee(employee_id));

create table public.coaching_task_note (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.coaching_task (id) on delete cascade,
  by_employee_id uuid not null references public.employee (id),
  kind text not null default 'flyttad' check (kind in ('flyttad')),
  text text not null check (char_length(btrim(text)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index coaching_task_note_uppgift on public.coaching_task_note (task_id, created_at);
alter table public.coaching_task_note enable row level security;
create policy coaching_task_note_read on public.coaching_task_note for select to authenticated
  using (exists (select 1 from public.coaching_task t where t.id = task_id));

alter table public.coaching_task add column if not exists nav2_kind text;
alter table public.coaching_task drop constraint if exists coaching_task_nav2_kind;
alter table public.coaching_task add constraint coaching_task_nav2_kind
  check (nav2_kind is null or (nav2_kind = 'rollspel_live' and kind = 'uppgift' and partner_id is not null));

alter table public.coaching_session add column if not exists previous_goal_met text;
alter table public.coaching_session drop constraint if exists coaching_session_forra_malet;
alter table public.coaching_session add constraint coaching_session_forra_malet
  check (previous_goal_met is null or previous_goal_met in ('ja', 'delvis', 'nej'));
alter table public.coaching_session add column if not exists focus_id uuid references public.coaching_focus (id) on delete set null;

alter table public.one_on_one_point add column if not exists removed_at timestamptz;

-- Målet från en lektion, när säljaren bockat i "Visa målet för chefen inför
-- nästa 1:1". Texten är JSON (0097), men den kastas inte till jsonb här: en rad
-- som inte är JSON hade då fällt hela frågan för den som läser.
drop policy if exists learning_note_mal_chef on public.learning_note;
create policy learning_note_mal_chef on public.learning_note for select to authenticated
  using (key like 'mal:%' and text like '%"coach":true%'
         and (public.leads_employee(employee_id) or public.can_read_all_employees()));

-- Samma vakt som 0043: RLS på, inga skrivpolicyer.
do $$
declare
  t text;
  n int;
begin
  foreach t in array array['coaching_drill', 'coaching_drill_answer', 'coaching_habit_check', 'coaching_message',
                           'coaching_person_focus', 'coaching_meeting_request', 'coaching_task_note'] loop
    if not exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace
                   where s.nspname = 'public' and c.relname = t and c.relrowsecurity) then
      raise exception '% saknar row level security', t;
    end if;
    select count(*) into n from pg_policies where schemaname = 'public' and tablename = t and cmd <> 'SELECT';
    if n > 0 then raise exception '% har en skrivpolicy', t; end if;
  end loop;
end;
$$;
