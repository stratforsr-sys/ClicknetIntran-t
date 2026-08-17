-- =============================================================================
-- 0014_sen_ankomst.sql — sen instämpling mot arbetsschemat, och lägre tolerans
--
-- Beställt 2026-08-17: en minut för sent ska synas, inte fem.
--
-- Två ändringar med samma innebörd men olika räckvidd:
--
--   1. `work_schedule.tol_late` — NY. Instämpling efter schemalagd start plus
--      toleransen ger en rad i `late_arrival`. Det här mättes inte alls förut:
--      `start_time` användes bara till att visa tiden i listan.
--
--   2. Rastschemats toleranser går från minst 5 minuter till minst 1. Det
--      AVVIKER från AC-2.26, som säger fem. Avvikelsen är beställarens och
--      medveten — den skrivs här så att nästa läsare ser att det är ett beslut
--      och inte ett slarv.
--
-- Noll tillåts inte. Telefonens klocka och serverns går isär med sekunder, och
-- knapptrycket tar tid att nå fram. Med noll larmar systemet på människor som
-- faktiskt var i tid, och ett larm som ljuger slutar man lyssna på.
--
-- K13, K17 gäller även här: den här datan når varken provision eller
-- lönekostnadsvyn, och ingen automatisk konsekvens hänger i den.
-- =============================================================================

alter table work_schedule
  add column if not exists tol_late int not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'work_schedule_tol_late_min'
  ) then
    alter table work_schedule
      add constraint work_schedule_tol_late_min check (tol_late >= 1);
  end if;
end $$;

alter table scheduled_break drop constraint if exists scheduled_break_tol_early_start_check;
alter table scheduled_break drop constraint if exists scheduled_break_tol_overrun_check;
alter table scheduled_break drop constraint if exists scheduled_break_tol_missing_check;

alter table scheduled_break
  add constraint scheduled_break_tol_early_start_check check (tol_early_start >= 1),
  add constraint scheduled_break_tol_overrun_check     check (tol_overrun >= 1),
  add constraint scheduled_break_tol_missing_check     check (tol_missing >= 1);

-- Nya scheman ska inte ärva den gamla femman som förval.
alter table scheduled_break alter column tol_early_start set default 1;
alter table scheduled_break alter column tol_overrun     set default 1;
alter table scheduled_break alter column tol_missing     set default 1;

-- -----------------------------------------------------------------------------
-- Sen ankomst
--
-- Egen tabell och inte en `kind` i `break_deviation`: den tabellen heter det
-- den gör, och en rastavvikelse och en sen ankomst har olika grund — den ena
-- vilar på K12 och är avstängd, den andra på arbetsschemat och är påslagen.
--
-- AC-2.35:s princip gäller likadant: raden bär id:t på schemat den dömdes mot,
-- så en schemaändring kan inte i efterhand göra någon sen som följde reglerna
-- som gällde då.
-- -----------------------------------------------------------------------------
create table if not exists late_arrival (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employee(id) on delete cascade,
  work_date     date not null,

  scheduled_start  time not null,
  arrived_at       timestamptz not null,
  minutes_late     int  not null check (minutes_late > 0),
  tolerance_minutes int not null,

  schedule_id   uuid references work_schedule(id),

  employee_comment text,
  resolved_at   timestamptz,
  resolved_by   uuid references employee(id),
  resolution    text,

  detected_at   timestamptz not null default now(),
  unique (employee_id, work_date)
);

create index if not exists late_arrival_person_idx on late_arrival (employee_id, work_date desc);
create index if not exists late_arrival_gallring_idx on late_arrival (work_date);

-- AC-2.11, AC-2.31: samma gallring som rastavvikelserna. Detaljen försvinner
-- efter 90 dagar, antalet per månad står kvar i 12.
create table if not exists late_arrival_month (
  employee_id uuid not null references employee(id) on delete cascade,
  month       date not null,
  antal       int  not null default 0,
  minuter     int  not null default 0,
  primary key (employee_id, month)
);

alter table late_arrival       enable row level security;
alter table late_arrival_month enable row level security;

-- Samma gräns som avvikelserna: den egna raden alltid, chefen sitt folk.
drop policy if exists late_arrival_read on late_arrival;
create policy late_arrival_read on late_arrival for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.can_read_all_employees()
    or public.leads_employee(employee_id)
  );

drop policy if exists late_arrival_month_read on late_arrival_month;
create policy late_arrival_month_read on late_arrival_month for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.can_read_all_employees()
    or public.leads_employee(employee_id)
  );
