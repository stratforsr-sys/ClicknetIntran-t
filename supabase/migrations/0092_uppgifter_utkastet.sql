-- 0092 · Uppgifter: det Nav 2.0 har och navet saknade (2026-10-15)
--
-- =============================================================================
-- VARFÖR
--
-- Nav 2.0:s uppgiftsvy har fyra saker som `task` och `task_event` inte bär:
--
--   1. Dagens tre: högst tre uppgifter i en ordning som personen själv väljer,
--      för en dag. Navs förslag räknar fram tre (försenat, brådskande, med
--      klockslag, rör en order); det som sparas är valet.
--   2. Dagens början och slut: "Planera dagen" och "Avsluta dagen", och av dem
--      "Planerad N dagar i rad".
--   3. Första steget: det allra första man gör, på uppgiften.
--   4. Påminn: den som väntar på någon påminner, och det syns i historiken.
--
-- "Dela upp med Nav" lägger deluppgifter (`task.parent_id`), och "Boka tid"
-- ger uppgiften ett klockslag (`planera`) så att den står i kalendern. Båda
-- finns redan i navet.
--
-- Beställaren 2026-10-15: ingen funktion i utkastet får försvinna.
-- =============================================================================
--
-- ADDITIV, OCH MAIN RÖRS INTE. Dagens tre och dagarna är personens egna och
-- läses bara av personen. Första steget följer uppgiften (dess läsregel).

create table public.task_focus (
  employee_id uuid not null references public.employee (id) on delete cascade,
  dag date not null,
  position smallint not null check (position between 1 and 3),
  task_id uuid not null references public.task (id) on delete cascade,
  primary key (employee_id, dag, position),
  unique (employee_id, dag, task_id)
);
alter table public.task_focus enable row level security;
create policy task_focus_las on public.task_focus for select using (employee_id = public.current_employee_id());

create table public.task_day (
  employee_id uuid not null references public.employee (id) on delete cascade,
  dag date not null,
  planned_at timestamptz,
  closed_at timestamptz,
  primary key (employee_id, dag),
  check (planned_at is not null or closed_at is not null)
);
alter table public.task_day enable row level security;
create policy task_day_las on public.task_day for select using (employee_id = public.current_employee_id());

alter table public.task add column next_step text check (next_step is null or length(btrim(next_step)) between 1 and 200);

alter table public.task_event drop constraint task_event_type_check;
alter table public.task_event add constraint task_event_type_check
  check (type = any (array['skapad', 'tilldelad', 'paborjad', 'inlamnad', 'godkand', 'returnerad', 'klar', 'ateroppnad', 'avbruten', 'kommentar', 'paminnelse']));
