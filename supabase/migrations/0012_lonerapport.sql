-- =============================================================================
-- 0012_lonerapport.sql — E4b Lönerapport (AC-2.13–2.18) samt avslut på avvikelser
--
-- AC-2.17, K5 är den bärande begränsningen: **ingen beräknad lön, inget
-- belopp, ingen semesterrätt.** Navet redovisar tid, inte pengar. Så fort en
-- krona räknas fram här blir navet ett lönesystem, med allt vad det innebär av
-- kollektivavtalstolkning och ansvar. Kolumnerna nedan är därför minuter och
-- antal — aldrig kronor.
--
-- AC-2.16: en attesterad period är oföränderlig. Det löses med triggrar och
-- inte med återkallade rättigheter, eftersom navets alla skrivningar sker med
-- service role som går förbi rättigheter. En korrigering efter attest blir en
-- justeringspost med motivering, så att både det attesterade underlaget och
-- rättelsen står kvar att läsa.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- AC-2.14 förutsätter att en avvikelse kan vara AVSLUTAD. Utan det saknas
-- skillnaden mellan "inget att göra" och "ingen har tittat".
--
-- K31, AC-2.29: att avsluta en avvikelse är att kvittera att den är omhändertagen
-- — inte att utdela en konsekvens. Ingen automatik hänger i den här kolumnen.
-- -----------------------------------------------------------------------------
alter table break_deviation add column if not exists resolved_at  timestamptz;
alter table break_deviation add column if not exists resolved_by  uuid references employee(id);
alter table break_deviation add column if not exists resolution   text;

create index if not exists break_deviation_oppna_idx
  on break_deviation (work_date) where resolved_at is null;

-- -----------------------------------------------------------------------------
-- Perioden
-- -----------------------------------------------------------------------------
create table if not exists payroll_period (
  id            uuid primary key default gen_random_uuid(),

  period_start  date not null,
  period_end    date not null,

  status        text not null default 'draft' check (status in ('draft','attested')),

  generated_at  timestamptz,
  generated_by  uuid references employee(id),

  -- AC-2.15, K5b: attesten är en människas underskrift. Den sätts en gång.
  attested_at   timestamptz,
  attested_by   uuid references employee(id),

  created_at    timestamptz not null default now(),

  unique (period_start, period_end),
  constraint payroll_period_ordning check (period_end >= period_start),
  constraint payroll_period_attest check (
    (status = 'draft'    and attested_at is null and attested_by is null)
    or (status = 'attested' and attested_at is not null and attested_by is not null)
  )
);

-- -----------------------------------------------------------------------------
-- Raden per person. Minuter och antal — aldrig belopp (AC-2.17).
-- -----------------------------------------------------------------------------
create table if not exists payroll_row (
  id            uuid primary key default gen_random_uuid(),
  period_id     uuid not null references payroll_period(id) on delete cascade,
  employee_id   uuid not null references employee(id),

  worked_minutes int not null default 0,
  break_minutes  int not null default 0,

  -- Antal dagar navet stängde åt personen (AC-2.4). En rapport där hälften av
  -- dagarna är maskinstängda är inte fel, men den ska inte se ut som en
  -- rapport där ingen är det.
  auto_closed_days int not null default 0,

  -- AC-2.13 räknar upp avvikelser, inte deras innehåll. Antalet räcker för
  -- lönekörningen; detaljerna hör hemma i avvikelsevyn med sin egen behörighet.
  deviation_count  int not null default 0,

  -- AC-2.13 kräver frånvaro per typ. M3 finns inte än, och en kolumn som
  -- alltid är noll ljuger tystare än en som saknas. Fältet är därför tomt tills
  -- E7 fyller det: `{}` betyder "inte mätt", inte "ingen frånvaro".
  absence_minutes  jsonb not null default '{}'::jsonb,

  unique (period_id, employee_id)
);

create index if not exists payroll_row_period_idx on payroll_row (period_id);

-- -----------------------------------------------------------------------------
-- AC-2.16: korrigering efter attest blir en post bredvid, inte en ändring i.
-- -----------------------------------------------------------------------------
create table if not exists payroll_adjustment (
  id            uuid primary key default gen_random_uuid(),
  period_id     uuid not null references payroll_period(id) on delete cascade,
  employee_id   uuid not null references employee(id),

  minutes       int  not null,          -- får vara negativ
  reason        text not null check (length(btrim(reason)) > 0),

  created_by    uuid not null references employee(id),
  created_at    timestamptz not null default now()
);

create index if not exists payroll_adjustment_period_idx
  on payroll_adjustment (period_id, employee_id);

-- -----------------------------------------------------------------------------
-- AC-2.18: exportformatet är konfiguration, inte kod. A3 är obesvarad — vilket
-- lönesystem filen ska in i vet vi inte än — så kolumnerna sätts i tabellen och
-- kan ändras utan att någon rör en rad kod.
-- -----------------------------------------------------------------------------
create table if not exists payroll_export_column (
  id      uuid primary key default gen_random_uuid(),
  sort    int  not null unique,
  header  text not null,
  field   text not null check (field in (
            'employee_number','name','email',
            'period_start','period_end',
            'worked_hours','worked_minutes','break_minutes',
            'adjustment_minutes','net_minutes',
            'auto_closed_days','deviation_count')),
  active  boolean not null default true
);

insert into payroll_export_column (sort, header, field)
select * from (values
  (1, 'Anstallningsnummer', 'employee_number'),
  (2, 'Namn',               'name'),
  (3, 'Periodstart',        'period_start'),
  (4, 'Periodslut',         'period_end'),
  (5, 'Arbetad tid (tim)',  'worked_hours'),
  (6, 'Justering (min)',    'adjustment_minutes'),
  (7, 'Netto (min)',        'net_minutes'),
  (8, 'Avvikelser',         'deviation_count')
) as v(sort, header, field)
where not exists (select 1 from payroll_export_column);

-- -----------------------------------------------------------------------------
-- Oföränderligheten. Samma mönster som time_event_ar_orubblig i 0009: spärren
-- ligger i databasen, inte i en kodregel, och gäller därför även service role.
-- -----------------------------------------------------------------------------
create or replace function public.payroll_period_ar_last()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'attested' then
      raise exception 'En attesterad period kan inte tas bort (AC-2.16).';
    end if;
    return old;
  end if;

  if old.status = 'attested' then
    raise exception 'Perioden är attesterad och oföränderlig. Lägg en justeringspost i stället (AC-2.16).';
  end if;

  -- Attesten går bara en väg och bara en gång.
  if new.status = 'attested' and (new.attested_by is null or new.attested_at is null) then
    raise exception 'Attest kräver både attestant och tidpunkt (AC-2.15).';
  end if;

  return new;
end;
$$;

drop trigger if exists payroll_period_last on payroll_period;
create trigger payroll_period_last
  before update or delete on payroll_period
  for each row execute function public.payroll_period_ar_last();

create or replace function public.payroll_row_ar_last()
returns trigger
language plpgsql
as $$
declare
  lage text;
begin
  select status into lage from payroll_period
   where id = coalesce(new.period_id, old.period_id);

  if lage = 'attested' then
    raise exception 'Perioden är attesterad. Underlaget kan inte ändras (AC-2.16).';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists payroll_row_last on payroll_row;
create trigger payroll_row_last
  before insert or update or delete on payroll_row
  for each row execute function public.payroll_row_ar_last();

-- En justeringspost hör till en attesterad period — före attest rättar man
-- underlaget och genererar om. Posten ändras aldrig efteråt: en justering som
-- går att skriva om är ingen justering, det är en ändring med extra steg.
create or replace function public.payroll_adjustment_ar_last()
returns trigger
language plpgsql
as $$
declare
  lage text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'En justeringspost kan varken ändras eller tas bort (AC-2.16).';
  end if;

  select status into lage from payroll_period where id = new.period_id;
  if lage is distinct from 'attested' then
    raise exception 'Justeringsposter hör till en attesterad period. Rätta underlaget och generera om.';
  end if;

  return new;
end;
$$;

drop trigger if exists payroll_adjustment_last on payroll_adjustment;
create trigger payroll_adjustment_last
  before insert or update or delete on payroll_adjustment
  for each row execute function public.payroll_adjustment_ar_last();

-- -----------------------------------------------------------------------------
-- Behörighet. K13, AC-10.6: tiddata och provisionsdata får inte kunna samköras.
-- Lönerapporten är tiddata och ligger hos ledning och ekonomi — inte hos
-- teamledaren, som bara ska se avvikelser i sitt eget team (AC-2.10).
-- -----------------------------------------------------------------------------
alter table payroll_period        enable row level security;
alter table payroll_row           enable row level security;
alter table payroll_adjustment    enable row level security;
alter table payroll_export_column enable row level security;

drop policy if exists payroll_period_read on payroll_period;
create policy payroll_period_read on payroll_period for select
  to authenticated
  using (public.has_any_role(array['sales_manager','ceo','finance','admin']));

-- Den egna raden är uppgifter om en själv. Att se sin egen arbetade tid i det
-- underlag som går till lönen är inte insyn i andra — det är rimlig kontroll.
drop policy if exists payroll_row_read on payroll_row;
create policy payroll_row_read on payroll_row for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.has_any_role(array['sales_manager','ceo','finance','admin'])
  );

drop policy if exists payroll_adjustment_read on payroll_adjustment;
create policy payroll_adjustment_read on payroll_adjustment for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.has_any_role(array['sales_manager','ceo','finance','admin'])
  );

drop policy if exists payroll_export_column_read on payroll_export_column;
create policy payroll_export_column_read on payroll_export_column for select
  to authenticated
  using (public.has_any_role(array['sales_manager','ceo','finance','admin']));
