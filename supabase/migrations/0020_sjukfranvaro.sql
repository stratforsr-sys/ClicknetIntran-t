-- =============================================================================
-- 0020_sjukfranvaro.sql — E7 / M3, andra halvan: sjukfranvaro, frister och
-- paminnelser (E7.6-E7.13, AC-3.16-3.27, K35, K37).
--
-- =============================================================================
-- K35 / AC-3.21: `sick_report` HAR NOLL TEXTKOLUMNER.
--
-- Inte "inga textkolumner an", inte "inga som ar tankta for orsak". Noll.
-- Kravet ar att det inte far FINNAS ett falt dar en diagnos, en orsak eller en
-- symtombeskrivning kan hamna, och den enda formulering av det kravet som gar
-- att prova ar den absoluta. Allt tabellen bar ar datum, tidpunkter, procent
-- och referenser till personer.
--
-- Provet ligger i tests/rls.mjs och fragar information_schema. Det faller den
-- dag nagon lagger till en textkolumn har, oavsett vad den skulle heta och hur
-- val motiverad den vore. Samma mekanik som tests/registerutdrag.mjs anvander
-- mot frammande nycklar: kravet bevakas av schemat, inte av minnet.
--
-- Det ar ocksa skalet till att sjukfranvaro inte ar en rad i `absence_request`.
-- Den tabellen HAR tva textfalt — chefens motivering till avslag och till
-- overstyrning — och de ar rimliga for en semesteransokan. Delade de tabell
-- med sjukfranvaron hade K35 hangt pa att ingen chef nagonsin skriver fel sak
-- i rutan. Nu finns rutan inte.
--
-- =============================================================================
-- AC-3.6 / AC-3.27: INGEN DIGITAL SJUKANMALNINGSKNAPP.
--
-- En sjukanmalan borjar med ett samtal till en manniska. Registreringen sker
-- efterat och kan goras av bade den sjuke och den som tog samtalet — darav
-- `registered_by` bredvid `employee_id`. Mottagarordningen ar konfigurerbar
-- och ligger i `absence_call_order`.
--
-- Sparren mot att detta blir en knapp sitter i 0019:
-- `absence_type_sjuk_ansoks_inte` gor det omojligt att satta `requestable` pa
-- typen 'sick'.
--
-- =============================================================================
-- AC-3.26: SJUKDATA UTANFOR PRESTATION, PROVISION OCH KOSTNAD.
--
-- Gransen dras har och ar varken sjalvklar eller gratis:
--
--   Loneunderlaget FAR bara sjukminuter. Sjukloneperioden dag 1-14 ar
--   arbetsgivarens, och ett loneunderlag utan sjukfranvaro ar fel underlag.
--   Minuterna hamnar i `payroll_row.absence_minutes` under nyckeln 'sick'.
--
--   Sjalva `sick_report` ar stangd for `finance`, `admin` och
--   `payroll_cost_viewer`. Forsta sjukdagen, antalet tillfallen och
--   rehabsignalen nar aldrig den som raknar kostnad eller provision.
--
-- E13 och E15 ar inte byggda. Att provet nedan inte kan visa att en
-- provisionsvy later bli att lasa harifran ar en begransning i vad som finns,
-- inte i provet: RLS ger noll rader for de rollerna, sa vyn kan inte lasa aven
-- om nagon skriver den.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Mottagarordningen (AC-3.27)
--
-- Vem man ringer, i vilken ordning. `manager` betyder narmaste chef och slas
-- upp per person; `role` och `person` pekar ut nagon bestamd.
--
-- Numret star pa raden och inte pa personen. Det ar ett nummer man ringer i
-- en bestamd situation, och att lagga ett telefonnummer pa varje anstalld for
-- att losa det hade samlat in mer persondata an fragan kraver (K1).
-- -----------------------------------------------------------------------------

create table if not exists absence_call_order (
  id          uuid primary key default gen_random_uuid(),
  sort        int  not null check (sort > 0),

  target_kind text not null check (target_kind in ('manager','role','person')),
  role        text check (role in
                ('salesperson','team_lead','sales_manager','finance',
                 'ceo','project_manager','admin','delivery')),
  employee_id uuid references employee(id) on delete cascade,
  phone       text,

  team_id     uuid references team(id) on delete cascade,   -- null = galler alla
  active      boolean not null default true,

  created_by  uuid references employee(id),
  created_at  timestamptz not null default now(),

  constraint absence_call_order_mal check (
    (target_kind = 'manager' and role is null and employee_id is null)
    or (target_kind = 'role'   and role is not null and employee_id is null)
    or (target_kind = 'person' and role is null and employee_id is not null)
  )
);

create unique index if not exists absence_call_order_plats_idx
  on absence_call_order ((coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid)), sort);

-- AC-3.18 chefsfallback ar inbyggd i ordningen: har personen ingen chef
-- hoppas plats 1 over och saljchefen pa plats 2 blir den man ringer.
insert into absence_call_order (sort, target_kind, role)
select * from (values
  (1, 'manager', null::text),
  (2, 'role',    'sales_manager')
) as v(sort, target_kind, role)
where not exists (select 1 from absence_call_order);

-- -----------------------------------------------------------------------------
-- 2. Sjukanmalan (E7.7, AC-3.16-3.18, AC-3.24)
--
-- `first_sick_day` SKILT FRAN `registered_at` ar hela AC-3.16. Nagon som blir
-- sjuk pa lordagen och ringer pa mandagen har varit sjuk sedan lordagen.
-- Fristerna i K37 raknas fran forsta sjukdagen, aldrig fran registreringen —
-- annars kan en sen registrering flytta dag 8 och dag 15 framfor sig.
--
-- LAS RUBRIKEN OM K35 INNAN DU LAGGER TILL EN KOLUMN HAR.
-- -----------------------------------------------------------------------------

create table if not exists sick_report (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee(id) on delete cascade,

  -- AC-3.16
  first_sick_day date        not null,
  registered_at  timestamptz not null default now(),

  -- Vem som knappade in den. Den sjuke sjalv efter samtalet, eller chefen som
  -- tog det. Bada ar riktiga fall och bada ska ga att se i efterhand.
  registered_by uuid not null references employee(id),

  -- Vem samtalet gick till (AC-3.27). Null nar det inte ar antecknat.
  reported_to uuid references employee(id),

  -- Omfattning, inte orsak. En halvtidssjukskrivning ar en uppgift om arbetstid
  -- och sager ingenting om vad som fattas nagon.
  extent_percent int not null default 100 check (extent_percent in (25,50,75,100)),

  -- AC-3.17: chefen bekraftar att anmalan ar mottagen.
  confirmed_by uuid references employee(id),
  confirmed_at timestamptz,

  -- Satt av nattjobbet nar bekraftelsen uteblivit langre an
  -- absence_policy.sick_confirm_hours.
  escalated_at timestamptz,

  -- Null = pagaende sjukfranvaro.
  last_sick_day date,

  -- AC-3.24: aterinsjuknande inom fristen hor till foregaende period.
  previous_report_id uuid references sick_report(id) on delete set null,

  -- E7.10 sa langt det gar utan Storage: kvittensen pa att ett intyg kommit in,
  -- utan filen. K36 kraver att varje OPPNING av intyget loggas, och det finns
  -- ingen oppning att logga forran det finns en fil att oppna. Se ROADMAP.
  certificate_received_on date,

  -- En anmalan som blev fel tas inte bort, den stalls in.
  cancelled_at timestamptz,
  cancelled_by uuid references employee(id),

  constraint sick_report_ordning
    check (last_sick_day is null or last_sick_day >= first_sick_day),

  constraint sick_report_bekraftelse check (
    (confirmed_by is null) = (confirmed_at is null)
  ),

  constraint sick_report_installd check (
    (cancelled_by is null) = (cancelled_at is null)
  ),

  -- Ingen kan vara sjukanmald tva ganger for samma dag. En pagaende period
  -- ('infinity') sparrar allt efter sin forsta dag tills den avslutas — vilket
  -- ar ratt: nasta anmalan innan dess ar samma sjukdom, inte en ny.
  constraint sick_report_ingen_dubbel
    exclude using gist (
      employee_id with =,
      daterange(first_sick_day, coalesce(last_sick_day, 'infinity'::date), '[]') with &&
    ) where (cancelled_at is null)
);

create index if not exists sick_report_person_idx
  on sick_report (employee_id, first_sick_day desc);
create index if not exists sick_report_obekraftade_idx
  on sick_report (registered_at) where confirmed_at is null and cancelled_at is null;
create index if not exists sick_report_pagaende_idx
  on sick_report (first_sick_day) where last_sick_day is null and cancelled_at is null;

comment on table sick_report is
  'K35/AC-3.21: tabellen har noll textkolumner och ska fortsatta ha det. '
  'Ingen orsak, diagnos eller symtombeskrivning far kunna registreras. '
  'Provas i tests/rls.mjs mot information_schema. Se 0020.';

-- En bekraftad anmalan star kvar. Fristerna i K37 ar redan utraknade ur
-- forsta sjukdagen nar bekraftelsen sker, och en dag som flyttas i efterhand
-- flyttar dem tyst med sig.
create or replace function public.sick_report_ar_last()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'En sjukanmalan tas inte bort. Stall in den i stallet.';
  end if;

  if new.registered_at is distinct from old.registered_at then
    raise exception 'Registreringstidpunkten ar en handelse och skrivs inte om (AC-3.16).';
  end if;

  if old.confirmed_at is not null then
    if new.employee_id    is distinct from old.employee_id
    or new.first_sick_day is distinct from old.first_sick_day then
      raise exception 'Anmalan ar bekraftad. Forsta sjukdagen styr fristerna i K37 och kan inte andras.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists sick_report_last on sick_report;
create trigger sick_report_last
  before update or delete on sick_report
  for each row execute function public.sick_report_ar_last();

-- -----------------------------------------------------------------------------
-- 3. Fristerna (E7.11, K37, AC-3.23)
--
-- Dag 8 intyg, dag 15 Forsakringskassan, dag 30 plan for atergang. Dagnumren
-- star i `absence_policy` och inte har: andras lagen ska en rad andras, inte
-- en migration skrivas.
--
-- Raderna skapas av nattjobbet ur pagaende anmalningar. Att lagra dem i
-- stallet for att rakna fram dem vid lasning — tvartemot notisklockan i 0018 —
-- ar ett medvetet undantag: en frist ska kunna KVITTERAS, och en kvittens
-- maste ha nagonstans att ta vagen. Klockan hade inget att lagra; det har har.
-- -----------------------------------------------------------------------------

create table if not exists sick_deadline (
  id        uuid primary key default gen_random_uuid(),
  report_id uuid not null references sick_report(id) on delete cascade,

  kind      text not null check (kind in ('certificate','fk_notice','return_plan')),
  due_on    date not null,

  completed_at timestamptz,
  completed_by uuid references employee(id),

  created_at timestamptz not null default now(),

  constraint sick_deadline_kvittens check (
    (completed_by is null) = (completed_at is null)
  ),

  unique (report_id, kind)
);

create index if not exists sick_deadline_oppna_idx
  on sick_deadline (due_on) where completed_at is null;

-- -----------------------------------------------------------------------------
-- 4. Oregistrerad franvaro (E7.8, AC-3.19)
--
-- En schemalagd dag utan stampling och utan registrerad franvaro. Det ar en
-- PAMINNELSE, inte en anklagelse: den vanligaste forklaringen ar att nagon
-- glomde registrera sin VAB-dag, inte att nagon uteblev.
--
-- DARFOR SER DEN ANSTALLDA DEN FORST. `visible_to_manager_from` ligger ett
-- dygn fram (absence_policy.unregistered_reminder_hours), och sparren sitter i
-- RLS-policyn langst ned — inte i en vy som later bli att rita raden. Hinner
-- personen registrera sin franvaro innan dess far chefen aldrig veta att det
-- fanns en lucka, och det ar hela poangen.
-- -----------------------------------------------------------------------------

create table if not exists absence_reminder (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee(id) on delete cascade,
  work_date   date not null,

  created_at  timestamptz not null default now(),
  visible_to_manager_from timestamptz not null,

  resolved_at timestamptz,
  resolved_by uuid references employee(id),

  unique (employee_id, work_date)
);

create index if not exists absence_reminder_oppna_idx
  on absence_reminder (work_date) where resolved_at is null;

-- -----------------------------------------------------------------------------
-- 5. Behorighet
--
-- Sjukdata: den sjuke sjalv, den som leder hen, och ledningen. Ingen annan.
--
-- `finance` och `admin` ar utelamnade med flit och det ar AC-3.26 i praktiken.
-- Ekonomi behover sjukminuterna for lonen och far dem via `payroll_row`, dar de
-- ar minuter per typ och period. Forsta sjukdagen, antalet tillfallen och
-- rehabsignalen ar nagot annat, och de stannar har.
-- -----------------------------------------------------------------------------

alter table absence_call_order enable row level security;
alter table sick_report        enable row level security;
alter table sick_deadline      enable row level security;
alter table absence_reminder   enable row level security;

-- Alla ska veta vem de ska ringa. Gar inte genom nagon hjalpfunktion och far
-- darfor losenordssparren fran 0017 utskriven.
drop policy if exists absence_call_order_read on absence_call_order;
create policy absence_call_order_read on absence_call_order for select
  to authenticated using (not public.kraver_losenordsbyte());

drop policy if exists sick_report_read on sick_report;
create policy sick_report_read on sick_report for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.leads_employee(employee_id)
    or public.has_any_role(array['sales_manager','ceo'])
  );

drop policy if exists sick_deadline_read on sick_deadline;
create policy sick_deadline_read on sick_deadline for select
  to authenticated
  using (
    exists (
      select 1 from public.sick_report r
      where r.id = sick_deadline.report_id
        and (
          r.employee_id = public.current_employee_id()
          or public.leads_employee(r.employee_id)
          or public.has_any_role(array['sales_manager','ceo'])
        )
    )
  );

-- AC-3.19: den anstallda alltid, chefen forst efter fordrojningen.
drop policy if exists absence_reminder_read on absence_reminder;
create policy absence_reminder_read on absence_reminder for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or (
      visible_to_manager_from <= now()
      and (
        public.leads_employee(employee_id)
        or public.has_any_role(array['sales_manager','ceo'])
      )
    )
  );
