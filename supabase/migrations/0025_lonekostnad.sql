-- =============================================================================
-- 0025_lonekostnad.sql — E15 / M13 Lonekostnadsvy (AC-13.1-13.10, K26, K27, K28)
--
-- =============================================================================
-- DEN HAR MODULEN RAKNAR KRONOR. LONERAPPORTEN GOR DET FORTFARANDE INTE.
--
-- 0012 slog fast K5 och AC-2.17: lonerapporten redovisar tid, aldrig pengar.
-- "Sa fort en krona raknas fram har blir navet ett lonesystem, med allt vad det
-- innebar av kollektivavtalstolkning och ansvar."
--
-- Det star kvar. Lonekostnadsvyn ar nagot ANNAT, och skillnaden ar inte
-- kosmetisk:
--
--   Lonerapporten ar ett UNDERLAG som lamnar navet. Den ska stamma med vad
--   nagon far ut, och darfor far den inte gissa. Den attesteras av en manniska
--   och blir oforanderlig.
--
--   Lonekostnadsvyn ar ett BESLUTSUNDERLAG som stannar i navet. Den svarar pa
--   "vad kostar den har saljaren, och hur mycket maste hon salja for att bara
--   sin egen kostnad". Den ar en uppskattning, den lamnas aldrig till nagon
--   myndighet, och den ar med flit sarskilt behorighetsstyrd (K26).
--
-- De far darfor inte flyta ihop. Kolumnerna i `payroll_row` ar fortfarande
-- minuter och antal. Kronorna bor har, i tabeller som `finance` inte ser utan
-- `payroll_cost_viewer`.
--
-- =============================================================================
-- K27: ENDAST FODELSEAR. INGA PERSONNUMMER, NAGONSTANS.
--
-- Aldersvillkoren i AC-13.5 later som om de kraver ett fodelsedatum. Det gor de
-- inte, och det ar vart att skriva ut varfor:
--
--   Bade ungdomsnedsattningen och nedsattningen for aldre utgar fran aldern
--   VID ARETS INGANG. Den som ar fodd ar B har den 1 januari ar Y fyllt exakt
--   Y - B - 1 ar, oavsett vilken manad hen fyller ar. Fodelsearet racker
--   alltsa for att avgora satsen exakt — inte ungefar.
--
-- Det som ar per kalendermanad i AC-13.5 ar TAKET, inte aldern: den lagre
-- satsen for unga galler upp till ett belopp per manad. En loneperiod som
-- stracker sig over ett manadsskifte maste darfor delas, och det gor
-- `manaderIPerioden()` i src/lib/lonekostnad.ts.
--
-- =============================================================================
-- E15.2 / §13.2: INGEN PROCENTSATS SOM LITERAL I KOD.
--
-- Samma linje som E7.15 drog for franvaroreglerna. Varje sats — arbetsgivar-
-- avgiften, den lagre satsen, manadstaket, aldersgranserna och tackningsgraden
-- — ar en rad i `cost_rate` med ett `valid_from`. `src/lib/lonekostnad.ts`
-- innehaller inget tal ur skattelagstiftningen; varje grans kommer in som
-- argument.
--
-- Foljden ar att en satsandring ar en rad och inte en deploy, och att en
-- historisk berakning gar att forklara: `cost_calculation.rates_used` bar de
-- satser som faktiskt anvandes (AC-13.8).
--
-- ANVANDAREN HAR BESKED 2026-08-21: bolaget har VARKEN tjanstepension ELLER
-- forsakringar. De ar darfor inte seedade och ska inte laggas till "for
-- sakerhets skull" — en sats pa noll som star i vyn ser ut som en kostnad
-- nagon glomt fylla i.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Fodelsearet (K27, AC-13.10)
-- -----------------------------------------------------------------------------

alter table employee add column if not exists birth_year int;

alter table employee drop constraint if exists employee_fodelsear_rimligt;
alter table employee add constraint employee_fodelsear_rimligt check (
  birth_year is null
  or (birth_year between 1930 and extract(year from current_date)::int - 15)
);

comment on column employee.birth_year is
  'K27: ENDAST aret. Inget fodelsedatum och inget personnummer far laggas till '
  'har eller nagon annanstans i navet. Aret racker for aldersvillkoren i '
  'AC-13.5, som utgar fran aldern vid arets ingang — se rubriken i 0025.';

-- -----------------------------------------------------------------------------
-- 2. Satserna (E15.2, E15.8, K28)
--
-- En rad per sats och giltighetsperiod. `unit` skiljer procent fran kronor och
-- fran ar, sa att en aldersgrans inte kan hamna i en procentrakning.
--
-- `owner_id` och `review_due` ar K28 och E15.8: en sats utan namngiven agare
-- ar en sats ingen uppdaterar. Nattjobbet paminner nar `review_due` passeras.
-- -----------------------------------------------------------------------------

create table if not exists cost_rate (
  id   uuid primary key default gen_random_uuid(),
  kind text not null check (kind in (
    'employer_fee_standard',      -- full arbetsgivaravgift
    'employer_fee_reduced',       -- endast alderspensionsavgift
    'employer_fee_reduced_cap',   -- tak per kalendermanad for den lagre satsen
    'young_age_min',              -- fylld alder vid arets ingang, nedre grans
    'young_age_max',              -- fylld alder vid arets ingang, ovre grans
    'senior_age_min',             -- fylld alder vid arets ingang
    'contribution_margin',        -- tackningsgrad, for break-even (AC-13.7)
    'absence_cost_factor'         -- hur stor del av lonen som betalas anda
  )),

  -- Vad raden galler. Null = generellt. Anvands i dag bara for
  -- `absence_cost_factor`, som satts per franvarotyp.
  applies_to text,

  unit  text not null check (unit in ('percent', 'amount', 'years')),
  value numeric(10,4) not null check (value >= 0),

  valid_from date not null,
  valid_to   date,

  -- K28: vem som ansvarar for att satsen ar aktuell, och nar den ska ses over.
  owner_id   uuid references employee(id),
  review_due date,

  note       text,
  created_by uuid references employee(id),
  created_at timestamptz not null default now(),

  constraint cost_rate_ordning check (valid_to is null or valid_to >= valid_from),

  -- En sats kan inte galla tva ganger samtidigt for samma sak.
  unique (kind, applies_to, valid_from)
);

create index if not exists cost_rate_giltig_idx on cost_rate (kind, valid_from desc);
create index if not exists cost_rate_oversyn_idx on cost_rate (review_due) where review_due is not null;

comment on table cost_rate is
  'E15.2/§13.2: varje sats som lonekostnadsvyn raknar med. Ingen procentsats '
  'far sta som literal i koden. rates_used i cost_calculation bevarar vilka '
  'rader en historisk siffra byggde pa (AC-13.8).';

-- -----------------------------------------------------------------------------
-- Seed: satserna som galler 2026.
--
-- ARBETSGIVARAVGIFTEN AR DEN ENDA SIFFRAN SOM AR SAKER. 31,42 % ar den
-- allmanna arbetsgivaravgiften och har statt still i manga ar.
--
-- 10,21 % ar alderspensionsavgiften, som ar det enda som betalas for de tva
-- grupperna med nedsattning. Manadstaket for ungdomsnedsattningen ar 25 000 kr.
--
-- ALDERSGRANSEN FOR ALDRE AR DEN SIFFRA SOM BOR KONTROLLERAS. Den har flyttats
-- flera ganger och foljer pensionsaldern. Den ar seedad till 66 och beror i dag
-- ingen i bolaget — men den ska stammas av mot Skatteverket innan nagon nar
-- dit. Att den ar en RAD och inte ett tal i koden ar hela poangen: rattelsen
-- kostar ingenting.
--
-- Tackningsgraden seedas INTE. En pahittad tackningsgrad ger ett break-even i
-- kronor som ser exakt ut och ar gissat, och den siffran ar hela skalet att
-- vyn finns. Vyn sager i stallet att den saknas, tills nagon satter den.
-- -----------------------------------------------------------------------------

insert into cost_rate (kind, unit, value, valid_from, note)
select * from (values
  ('employer_fee_standard',    'percent', 31.42, date '2026-01-01',
   'Allman arbetsgivaravgift.'),
  ('employer_fee_reduced',     'percent', 10.21, date '2026-01-01',
   'Endast alderspensionsavgift. Galler bade ungdomar och aldre.'),
  ('employer_fee_reduced_cap', 'amount',  25000, date '2026-01-01',
   'Tak per kalendermanad for ungdomsnedsattningen. Over taket full sats.'),
  ('young_age_min',            'years',   15,    date '2026-01-01',
   'Fylld alder vid arets ingang.'),
  ('young_age_max',            'years',   17,    date '2026-01-01',
   'Fylld alder vid arets ingang. 17 betyder "har inte fyllt 18".'),
  ('senior_age_min',           'years',   66,    date '2026-01-01',
   'KONTROLLERA MOT SKATTEVERKET. Foljer pensionsaldern och har flyttats.')
) as v(kind, unit, value, valid_from, note)
where not exists (select 1 from cost_rate);

-- -----------------------------------------------------------------------------
-- 3. Lonen (AC-13.2)
--
-- Manadslonen ar det enda beloppet navet kanner till om en anstalld, och den
-- matas in for hand — precis som franvarosaldona i E7.5. Navet raknar ingen
-- lon och forhandlar ingen; det tar emot ett tal nagon annan bestamt.
--
-- APPEND-ONLY. En loneandring ar en ny rad med ett nytt `valid_from`. Skrivs
-- den gamla over gar en historisk lonekostnad inte langre att forklara, och
-- AC-13.8 kraver att den gar det.
-- -----------------------------------------------------------------------------

create table if not exists salary_basis (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee(id) on delete cascade,

  monthly_salary numeric(12,2) not null check (monthly_salary >= 0),

  -- Garantilon och provision hor till E13 och finns inte har. Nar de kommer:
  -- lagg dem som egna kolumner eller egen tabell, inte genom att skriva om
  -- den har siffran till "ungefar vad hon far ut".
  valid_from date not null,

  entered_by uuid not null references employee(id),
  entered_at timestamptz not null default now(),
  note       text,

  unique (employee_id, valid_from)
);

create index if not exists salary_basis_person_idx
  on salary_basis (employee_id, valid_from desc);

create or replace function public.salary_basis_ar_last()
returns trigger
language plpgsql
as $$
begin
  raise exception 'En loneuppgift skrivs inte om. Lagg en ny rad med nytt valid_from.';
end;
$$;

drop trigger if exists salary_basis_last on salary_basis;
create trigger salary_basis_last
  before update or delete on salary_basis
  for each row execute function public.salary_basis_ar_last();

-- -----------------------------------------------------------------------------
-- 4. Intakten (AC-13.7)
--
-- Tackningsbidrag kraver en intakt, och intakten kommer fran affarerna — som
-- ligger i E11 Inkio och E13 provision, bada blockerade. Tills dess matas den
-- in for hand per person och period, eller inte alls.
--
-- INTE ALLS AR ETT GILTIGT LAGE. Saknas raden visar vyn inget tackningsbidrag,
-- i stallet for ett tackningsbidrag som rakats bli negativt for att intakten
-- var noll. Samma skillnad som `{}` mot `{"sick": 0}` i payroll_row.
-- -----------------------------------------------------------------------------

create table if not exists revenue_entry (
  id          uuid primary key default gen_random_uuid(),
  period_id   uuid not null references payroll_period(id) on delete cascade,
  employee_id uuid not null references employee(id) on delete cascade,

  amount numeric(14,2) not null check (amount >= 0),

  entered_by uuid not null references employee(id),
  entered_at timestamptz not null default now(),
  note       text,

  unique (period_id, employee_id)
);

-- -----------------------------------------------------------------------------
-- 5. Berakningen (AC-13.8)
--
-- En rad per person och period. `rates_used` bar de satser berakningen byggde
-- pa, sa att en siffra fran i februari gar att forklara i november nar
-- satserna andrats. Utan den ar en historisk lonekostnad ett tal utan hardkomst.
--
-- OFORANDERLIG. Ska den raknas om skrivs en ny rad — samma resonemang som
-- lonerapportens justeringsposter i 0012.
--
-- FRANVARON KOMMER FRAN `payroll_row.absence_minutes` OCH INGEN ANNANSTANS
-- (AC-3.26, E7.14). `sick_report` ger noll rader for `payroll_cost_viewer`, sa
-- en vy som forsokte joina dit hade fatt tyst fel data i stallet for ett fel.
-- Att berakningen hanger pa en LONEPERIOD och inte pa ett datumintervall ar
-- vad som gor den kopplingen strukturell: minuterna finns bara dar.
-- -----------------------------------------------------------------------------

create table if not exists cost_calculation (
  id          uuid primary key default gen_random_uuid(),
  period_id   uuid not null references payroll_period(id) on delete cascade,
  employee_id uuid not null references employee(id) on delete cascade,

  monthly_salary   numeric(12,2) not null,
  absence_deduction numeric(12,2) not null default 0,
  gross_salary     numeric(12,2) not null,
  employer_fee     numeric(12,2) not null,
  total_cost       numeric(12,2) not null,

  -- Null nar tackningsgraden inte ar satt respektive nar ingen intakt matats
  -- in. Noll och null betyder olika saker och far inte blandas ihop.
  break_even_revenue numeric(14,2),
  revenue            numeric(14,2),
  contribution       numeric(14,2),

  rates_used jsonb not null,

  calculated_by uuid not null references employee(id),
  calculated_at timestamptz not null default now(),

  unique (period_id, employee_id)
);

create index if not exists cost_calculation_period_idx on cost_calculation (period_id);

create or replace function public.cost_calculation_ar_last()
returns trigger
language plpgsql
as $$
begin
  raise exception 'En berakning skrivs inte om. Ta bort och rakna om perioden i stallet.';
end;
$$;

drop trigger if exists cost_calculation_last on cost_calculation;
create trigger cost_calculation_last
  before update on cost_calculation
  for each row execute function public.cost_calculation_ar_last();

-- -----------------------------------------------------------------------------
-- 6. Behorighet (E15.1, AC-13.1, K26)
--
-- `payroll_cost_viewer` och ingenting annat. Rollen `finance` racker INTE, och
-- det ar hela poangen med att behorigheten ligger i en egen tabell sedan 0001:
-- den som ser vad folk kostar ar en mindre krets an den som skoter loner.
--
-- Funktionen gar genom `current_employee_id()` och far darmed losenordssparren
-- fran 0017 pa kopet.
-- -----------------------------------------------------------------------------

create or replace function public.har_lonekostnadsbehorighet()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.employee_permission p
    join public.employee e on e.id = p.employee_id
    where e.id = public.current_employee_id()
      and p.permission = 'payroll_cost_viewer'
  )
$$;

alter table cost_rate        enable row level security;
alter table salary_basis     enable row level security;
alter table revenue_entry    enable row level security;
alter table cost_calculation enable row level security;

drop policy if exists cost_rate_read on cost_rate;
create policy cost_rate_read on cost_rate for select
  to authenticated using (public.har_lonekostnadsbehorighet());

drop policy if exists salary_basis_read on salary_basis;
create policy salary_basis_read on salary_basis for select
  to authenticated using (public.har_lonekostnadsbehorighet());

drop policy if exists revenue_entry_read on revenue_entry;
create policy revenue_entry_read on revenue_entry for select
  to authenticated using (public.har_lonekostnadsbehorighet());

drop policy if exists cost_calculation_read on cost_calculation;
create policy cost_calculation_read on cost_calculation for select
  to authenticated using (public.har_lonekostnadsbehorighet());

-- Ingen ser sin EGEN lonekostnad heller. Det later hart och ar avsiktligt:
-- raden bar arbetsgivaravgift och break-even, alltsa bolagets kalkyl pa en
-- person — inte personens egen loneuppgift. Den senare vet hen redan, och far
-- den ur sitt anstallningsavtal och sin lonespecifikation, inte harifran.
--
-- Undantaget vore ett registerutdrag, och det gar via service role (K25).

-- Skrivning sker uteslutande via server actions med service role. Ingen
-- insert-, update- eller delete-policy finns, som pa resten av navet.
