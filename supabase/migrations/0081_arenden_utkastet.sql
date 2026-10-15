-- 0081 · Ärenden: det Nav 2.0 har och navet saknade (2026-10-15)
--
-- =============================================================================
-- VARFÖR
--
-- Nav 2.0:s ärendevy har sex saker som `hr_case` och `case_message` inte bär:
--
--   1. Läskvitto. Personen ser när ärendet lästs ("Läst"), chefen ser vad som
--      är oläst och kan markera ett ärende som oläst igen.
--   2. "Löste det här ditt ärende?" Den som frågade bekräftar, eller säger nej
--      så att ärendet öppnas igen.
--   3. Påminnelser från chefen när ärendet väntar på personen.
--   4. Kopplingar: en order, provisionen för en månad eller ett bokat samtal
--      som ärendet gäller.
--   5. Bilagor, till exempel en skärmbild.
--   6. "Det här har ärenden lett till": det ledningen ändrat efter frågor.
--
-- Beställaren 2026-10-15: ingen funktion i utkastet får försvinna. Det som
-- saknar backend ska få backend, och skrivningarna slås på vy för vy.
-- =============================================================================
--
-- =============================================================================
-- ADDITIV, OCH RLS FÖLJER ÄRENDET
--
-- Sex nya tabeller, inga ändringar i befintliga. Läsregeln är densamma för
-- fem av dem: en rad syns för den som ser ärendet. Frågan går mot `hr_case`
-- med läsarens egen roll, så `hr_case_read` avgör — ett konfidentiellt ärende
-- och allt som hänger på det syns bara för personen, säljchef och VD.
--
-- Bilagorna har en egen tabell i stället för ett nytt ändamål i `file_object`.
-- Det hade krävt att fyra villkor och läsregeln där skrevs om, och de delas av
-- sju andra ändamål. Filerna ligger i samma lagring, under `arenden/<id>/`.
--
-- "Det här har ärenden lett till" läses av alla anställda: det är en lista
-- över förbättringar, och frågan skrivs av chefen själv — inte ärendets
-- rubrik, som kan vara känslig.
-- =============================================================================

-- 1. Läskvittot. En rad per läsare och ärende. Att ta bort sin egen rad är
-- "markera som oläst".
create table public.hr_case_read (
  case_id     uuid not null references public.hr_case (id) on delete cascade,
  employee_id uuid not null references public.employee (id) on delete cascade,
  read_at     timestamptz not null default now(),
  primary key (case_id, employee_id)
);
alter table public.hr_case_read enable row level security;
create policy hr_case_read_las on public.hr_case_read for select
  using (exists (select 1 from public.hr_case c where c.id = hr_case_read.case_id));
create policy hr_case_read_skriv on public.hr_case_read for insert
  with check (employee_id = current_employee_id() and exists (select 1 from public.hr_case c where c.id = hr_case_read.case_id));
create policy hr_case_read_andra on public.hr_case_read for update
  using (employee_id = current_employee_id()) with check (employee_id = current_employee_id());
create policy hr_case_read_ta_bort on public.hr_case_read for delete
  using (employee_id = current_employee_id());

-- 2. "Löste det här ditt ärende?" Bara den ärendet gäller svarar, och bara på
-- ett löst ärende. Ett nej öppnar ärendet igen (görs av servern, som ser till
-- att statusen och fristen följer med).
create table public.hr_case_confirmation (
  case_id      uuid primary key references public.hr_case (id) on delete cascade,
  solved       boolean not null,
  note         text,
  confirmed_by uuid not null references public.employee (id),
  confirmed_at timestamptz not null default now()
);
alter table public.hr_case_confirmation enable row level security;
create policy hr_case_confirmation_las on public.hr_case_confirmation for select
  using (exists (select 1 from public.hr_case c where c.id = hr_case_confirmation.case_id));
create policy hr_case_confirmation_skriv on public.hr_case_confirmation for insert
  with check (
    confirmed_by = current_employee_id()
    and exists (select 1 from public.hr_case c
                where c.id = hr_case_confirmation.case_id
                  and c.employee_id = current_employee_id()
                  and c.resolved_at is not null)
  );

-- 3. Påminnelser. Säljchef och VD påminner om ett ärende de ser.
create table public.hr_case_reminder (
  id      uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.hr_case (id) on delete cascade,
  sent_by uuid not null references public.employee (id),
  sent_at timestamptz not null default now()
);
alter table public.hr_case_reminder enable row level security;
create policy hr_case_reminder_las on public.hr_case_reminder for select
  using (exists (select 1 from public.hr_case c where c.id = hr_case_reminder.case_id));
create policy hr_case_reminder_skriv on public.hr_case_reminder for insert
  with check (
    sent_by = current_employee_id()
    and has_any_role(array['sales_manager', 'ceo'])
    and exists (select 1 from public.hr_case c where c.id = hr_case_reminder.case_id)
  );
create index hr_case_reminder_case on public.hr_case_reminder (case_id, sent_at desc);

-- 4. Kopplingar. `ref` är orderns id, månaden ("2026-10") eller händelsens id.
create table public.hr_case_link (
  id         uuid primary key default gen_random_uuid(),
  case_id    uuid not null references public.hr_case (id) on delete cascade,
  kind       text not null check (kind in ('order', 'provision', 'calendar_event')),
  ref        text not null,
  label      text not null,
  created_by uuid not null references public.employee (id),
  created_at timestamptz not null default now(),
  unique (case_id, kind, ref)
);
alter table public.hr_case_link enable row level security;
create policy hr_case_link_las on public.hr_case_link for select
  using (exists (select 1 from public.hr_case c where c.id = hr_case_link.case_id));
create policy hr_case_link_skriv on public.hr_case_link for insert
  with check (created_by = current_employee_id() and exists (select 1 from public.hr_case c where c.id = hr_case_link.case_id));

-- 5. Bilagor.
create table public.hr_case_attachment (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references public.hr_case (id) on delete cascade,
  store       text not null check (store in ('supabase', 'r2')),
  bucket      text not null,
  path        text not null unique,
  filename    text not null,
  mime_type   text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes  integer not null check (size_bytes > 0),
  uploaded_by uuid not null references public.employee (id),
  uploaded_at timestamptz not null default now()
);
alter table public.hr_case_attachment enable row level security;
create policy hr_case_attachment_las on public.hr_case_attachment for select
  using (exists (select 1 from public.hr_case c where c.id = hr_case_attachment.case_id));
create policy hr_case_attachment_skriv on public.hr_case_attachment for insert
  with check (uploaded_by = current_employee_id() and exists (select 1 from public.hr_case c where c.id = hr_case_attachment.case_id));
create index hr_case_attachment_case on public.hr_case_attachment (case_id);

-- 6. Det här har ärenden lett till.
create table public.case_outcome (
  id         uuid primary key default gen_random_uuid(),
  case_id    uuid references public.hr_case (id) on delete set null,
  fraga      text not null check (length(trim(fraga)) > 0),
  utfall     text not null check (length(trim(utfall)) > 0),
  created_by uuid not null references public.employee (id),
  created_at timestamptz not null default now()
);
alter table public.case_outcome enable row level security;
create policy case_outcome_las on public.case_outcome for select
  using (current_employee_id() is not null);
create policy case_outcome_skriv on public.case_outcome for insert
  with check (created_by = current_employee_id() and has_any_role(array['sales_manager', 'ceo']));
create policy case_outcome_andra on public.case_outcome for update
  using (has_any_role(array['sales_manager', 'ceo'])) with check (has_any_role(array['sales_manager', 'ceo']));
create policy case_outcome_ta_bort on public.case_outcome for delete
  using (has_any_role(array['sales_manager', 'ceo']));
