-- 0094 · Tid: det Nav 2.0 har och navet saknade (2026-10-15)
--
-- =============================================================================
-- VARFÖR
--
-- Nav 2.0:s tidsvy har saker som navet inte bär. Allt är additivt: inga
-- befintliga rader rörs, och time_event förblir orubblig (0009). Det som en
-- rättelse behöver utöver sin rad ligger därför i en egen tabell.
--
--   1. time_correction_extra: stödet för en rättelse ("sista samtalet i
--      dialern slutade 18:03"), skälet till ett avslag (krävs i Nav 2.0) och
--      när den som fick avslaget sett det ("Okej").
--   2. time_day_ack: "Ja, det stämmer" på en dag som navet stängde.
--   3. work_schedule_seen: "Jag har sett det" på ett nytt schema. Chefen ser
--      hur många som sett det och kan påminna resten.
--   4. time_week_check: "Stämmer veckan?" varje fredag, och hur många veckor i
--      rad den är kollad.
--   5. nav_preference: egna val som ska följa med mellan enheter
--      (påminnelser om stämpling, chefens morgonnotis, senaste besöket).
--   6. one_on_one_point: punkter till nästa 1:1. Tid lägger dit en sen
--      ankomst ("Ta upp på 1:1"); Coachning läser och bockar av dem.
--   7. tid_view_log: varje gång en chef öppnar en persons sena dagar. Personen
--      ser det under "Vem har tittat".
--   8. payroll_period_sent: "Markera som skickad till lön", lönerapportens
--      sista steg. Attesten (0012) är steget före.
--   9. payroll_row.over_minutes och exportfältet over_minutes: "Utanför
--      schemat (min)". Kolumnen läggs in AVSTÄNGD, eftersom databasen delas
--      med produktionen och dess CSV inte känner fältet.
--
-- Beställaren 2026-10-15: ingen funktion i utkastet får försvinna.
-- =============================================================================

create table public.time_correction_extra (
  time_event_id uuid primary key references public.time_event (id) on delete cascade,
  support text check (support is null or char_length(support) <= 300),
  reject_reason text check (reject_reason is null or char_length(reject_reason) <= 500),
  rejection_seen_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.time_correction_extra enable row level security;
create policy time_correction_extra_read on public.time_correction_extra for select to authenticated
  using (exists (select 1 from public.time_event t where t.id = time_event_id));

create table public.time_day_ack (
  employee_id uuid not null references public.employee (id) on delete cascade,
  work_date date not null,
  kind text not null check (kind in ('auto_close_ok')),
  acked_at timestamptz not null default now(),
  primary key (employee_id, work_date, kind)
);
alter table public.time_day_ack enable row level security;
create policy time_day_ack_read on public.time_day_ack for select to authenticated
  using (employee_id = public.current_employee_id() or public.can_read_all_employees() or public.leads_employee(employee_id));

create table public.work_schedule_seen (
  employee_id uuid not null references public.employee (id) on delete cascade,
  valid_from date not null,
  seen_at timestamptz not null default now(),
  primary key (employee_id, valid_from)
);
alter table public.work_schedule_seen enable row level security;
create policy work_schedule_seen_read on public.work_schedule_seen for select to authenticated
  using (employee_id = public.current_employee_id() or public.can_read_all_employees() or public.leads_employee(employee_id));

create table public.time_week_check (
  employee_id uuid not null references public.employee (id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  ok boolean not null,
  checked_at timestamptz not null default now(),
  primary key (employee_id, week_start)
);
alter table public.time_week_check enable row level security;
create policy time_week_check_read on public.time_week_check for select to authenticated
  using (employee_id = public.current_employee_id() or public.can_read_all_employees() or public.leads_employee(employee_id));

create table public.nav_preference (
  employee_id uuid not null references public.employee (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9.-]{1,60}$'),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (employee_id, key)
);
alter table public.nav_preference enable row level security;
create policy nav_preference_read on public.nav_preference for select to authenticated
  using (employee_id = public.current_employee_id());

create table public.one_on_one_point (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 500),
  source text not null default 'egen' check (source in ('egen', 'tid-sen', 'coachning', 'kv')),
  source_ref text,
  added_by uuid references public.employee (id) on delete set null,
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  session_id uuid references public.coaching_session (id) on delete set null
);
create index one_on_one_point_oppna on public.one_on_one_point (employee_id) where handled_at is null;
alter table public.one_on_one_point enable row level security;
create policy one_on_one_point_read on public.one_on_one_point for select to authenticated
  using (employee_id = public.current_employee_id() or added_by = public.current_employee_id()
         or public.can_read_all_employees() or public.leads_employee(employee_id));

create table public.tid_view_log (
  id uuid primary key default gen_random_uuid(),
  viewer_id uuid not null references public.employee (id) on delete cascade,
  employee_id uuid not null references public.employee (id) on delete cascade,
  what text not null check (what in ('sena')),
  viewed_at timestamptz not null default now()
);
create index tid_view_log_person on public.tid_view_log (employee_id, viewed_at desc);
create index tid_view_log_tittare on public.tid_view_log (viewer_id, viewed_at desc);
alter table public.tid_view_log enable row level security;
create policy tid_view_log_read on public.tid_view_log for select to authenticated
  using (employee_id = public.current_employee_id() or viewer_id = public.current_employee_id() or public.can_read_all_employees());

create table public.payroll_period_sent (
  period_id uuid primary key references public.payroll_period (id) on delete cascade,
  sent_by uuid references public.employee (id) on delete set null,
  sent_at timestamptz not null default now()
);
alter table public.payroll_period_sent enable row level security;
create policy payroll_period_sent_read on public.payroll_period_sent for select to authenticated
  using (public.has_any_role(array['sales_manager', 'ceo', 'finance', 'admin']));

alter table public.payroll_row add column if not exists over_minutes integer not null default 0;

alter table public.payroll_export_column drop constraint payroll_export_column_field_check;
alter table public.payroll_export_column add constraint payroll_export_column_field_check check (field in (
  'employee_number', 'name', 'email', 'period_start', 'period_end',
  'worked_hours', 'worked_minutes', 'break_minutes',
  'adjustment_minutes', 'net_minutes', 'auto_closed_days', 'deviation_count',
  'over_minutes'));
insert into public.payroll_export_column (sort, header, field, active)
select coalesce(max(sort), 0) + 1, 'Utanför schemat (min)', 'over_minutes', false from public.payroll_export_column
where not exists (select 1 from public.payroll_export_column where field = 'over_minutes');
