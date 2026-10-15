-- 0095 · Rutiner: det Nav 2.0 har och navet saknade (2026-10-15)
--
-- =============================================================================
-- VARFÖR
--
-- Nav 2.0:s rutinvy har funktioner som navet inte bär. Innehållet (när, vem,
-- hur lång tid, sammanfattning, steg, klart när, om det går fel) skrivs i
-- `body_md` med en fast form, så att versionerna (`document_version`),
-- fritextsökningen och repots egen sida fortsätter att fungera. Det som inte
-- är innehåll ligger här:
--
--   1. document.routine_meta: område, steg i säljresan, sökord som förstår
--      vardagsord, rutiner som hänger ihop, uppgifter rutinen kan lägga ut,
--      och om den hör till "Ny för dig".
--   2. document_saved: Sparade (stjärnan).
--   3. document_note: din anteckning på en rutin, bara du ser den.
--   4. document_run: "Logga som gjort" — rutinens historik.
--   5. document_feedback: "Hjälpte rutinen dig?", skälet, och ägarens svar.
--   6. document_area_watch: bevaka ett område och få en notis när något ändras.
--   7. nav_setting: bolagets val som inte hör till en person (veckans rutin).
--
-- Beställaren 2026-10-15: ingen funktion i utkastet får försvinna.
-- =============================================================================

alter table public.document add column if not exists routine_meta jsonb not null default '{}'::jsonb;

create table public.document_saved (
  employee_id uuid not null references public.employee (id) on delete cascade,
  document_id uuid not null references public.document (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (employee_id, document_id)
);
alter table public.document_saved enable row level security;
create policy document_saved_read on public.document_saved for select to authenticated
  using (employee_id = public.current_employee_id());

create table public.document_note (
  employee_id uuid not null references public.employee (id) on delete cascade,
  document_id uuid not null references public.document (id) on delete cascade,
  text text not null check (char_length(text) <= 2000),
  updated_at timestamptz not null default now(),
  primary key (employee_id, document_id)
);
alter table public.document_note enable row level security;
create policy document_note_read on public.document_note for select to authenticated
  using (employee_id = public.current_employee_id());

create table public.document_run (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.document (id) on delete cascade,
  version integer not null,
  employee_id uuid not null references public.employee (id) on delete cascade,
  customer text check (customer is null or char_length(customer) <= 200),
  ran_at timestamptz not null default now()
);
create index document_run_dok on public.document_run (document_id, ran_at desc);
alter table public.document_run enable row level security;
create policy document_run_read on public.document_run for select to authenticated
  using (employee_id = public.current_employee_id()
         or exists (select 1 from public.document d where d.id = document_id and d.owner_id = public.current_employee_id())
         or public.has_any_role(array['sales_manager', 'admin', 'ceo']));

create table public.document_feedback (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.document (id) on delete cascade,
  version integer not null,
  employee_id uuid not null references public.employee (id) on delete cascade,
  helped boolean not null,
  reason text check (reason is null or reason in ('Otydligt', 'Inaktuellt', 'Saknar ett steg', 'Stämmer inte')),
  text text check (text is null or char_length(text) <= 1000),
  created_at timestamptz not null default now(),
  answer text check (answer is null or char_length(answer) <= 1000),
  answered_by uuid references public.employee (id) on delete set null,
  answered_at timestamptz,
  check ((answer is null) = (answered_at is null))
);
create index document_feedback_dok on public.document_feedback (document_id, created_at desc);
alter table public.document_feedback enable row level security;
create policy document_feedback_read on public.document_feedback for select to authenticated
  using (employee_id = public.current_employee_id()
         or exists (select 1 from public.document d where d.id = document_id and d.owner_id = public.current_employee_id())
         or public.has_any_role(array['sales_manager', 'admin', 'ceo']));

create table public.document_area_watch (
  employee_id uuid not null references public.employee (id) on delete cascade,
  area text not null check (area in ('salj', 'kund', 'pers', 'miljo', 'adm')),
  created_at timestamptz not null default now(),
  primary key (employee_id, area)
);
alter table public.document_area_watch enable row level security;
create policy document_area_watch_read on public.document_area_watch for select to authenticated
  using (employee_id = public.current_employee_id());

create table public.nav_setting (
  key text primary key check (key ~ '^[a-z0-9.-]{1,60}$'),
  value jsonb not null,
  updated_by uuid references public.employee (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.nav_setting enable row level security;
create policy nav_setting_read on public.nav_setting for select to authenticated using (true);
