-- =============================================================================
-- 0037_konsekvenser.sql — E13 steg 6, schemat for konsekvenssystemet
--
-- -----------------------------------------------------------------------------
-- LAS DET HAR FORST: FILEN AR ATERSKAPAD, INTE ORIGINALET
-- -----------------------------------------------------------------------------
--
-- Migrationen kordes mot produktionsdatabasen 2026-08-25 13:31 och bokfordes i
-- `schema_migrations`. SJALVA FILEN COMMITTADES ALDRIG, och inte heller koden som
-- skulle anvanda den. Passet tog slut mellan korningen och commiten.
--
-- Foljden var att repot slutade beskriva databasen. Det upptacktes 2026-08-26 av
-- `tests/registerutdrag.mjs`, som faller nar en kolumn pekar pa `employee` utan
-- att sta i vare sig KALLOR eller UNDANTAG — den hittade fem sadana kolumner i
-- tva tabeller som ingen migration i repot namnde. Utan det provet hade nasta
-- fardiga miljo fatt ett annat schema an produktionen, tyst.
--
-- Innehallet nedan ar last UR den korda databasen: kolumner, villkor, index,
-- policyer, triggrar och de tre seedade trappstegen. Det ar darfor troget i
-- struktur men inte tecken for tecken — den ursprungliga textens kommentarer ar
-- borta for alltid.
--
-- ALLT AR IDEMPOTENT. Filen gar att kora mot produktionen (dar den inte gor
-- nagot) och mot en tom databas (dar den bygger schemat). Det ar vad som gor det
-- mojligt att bokfora om den utan att gissa.
--
-- -----------------------------------------------------------------------------
-- VAD SOM AR BYGGT OCH VAD SOM INTE AR DET
-- -----------------------------------------------------------------------------
--
-- Schemat finns. KODEN FINNS INTE. Det finns ingen sida, ingen server action och
-- ingen motor som skriver i `attendance_incident` — tabellen ar tom och kommer
-- att forbli tom tills E13 steg 6 byggs. Reglerna i `consequence_rule` ar
-- seedade och lases av ingen.
--
-- Det ar ofarligt sa lange det ar KANT: en tabell utan skrivare ar bara en
-- tabell. Det farliga var att den lag utanfor repot.
--
-- -----------------------------------------------------------------------------
-- REGLERNA SOM SCHEMAT BAR (och som steg 6 maste folja)
-- -----------------------------------------------------------------------------
--
-- O15: en ogiltig franvaro kraver MINST 5 MINUTER — darav `minutes >= 5` — och
-- att personen faktiskt inte var pa plats. Den som stamplar in for sent men
-- varit har raknas aldrig. Det ar inte en detalj: det haller D-K12:s linje om
-- att K12 1.2 sen ankomst inte nar provisionen, och en gransandring dar kraver
-- att avsnitt 6 och 7 i K12 skrivs och beslutas forst.
--
-- O8: ovrig bonus faller INTE vid en konsekvens. Darav att `omfattning` bara
-- kan vara `innevarande_manad` och bara for `bonusforlust`.
--
-- Varje handelse ar ett FORSLAG tills en chef beslutat. Trappan i
-- `consequence_rule` sager vad forslag nummer N leder till.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Trappan
--
-- Konfiguration, inte kod — samma linje som `absence_policy`, `cost_rate` och
-- `commission_bonus_level` redan drog. En trappa i ett `if` ar en trappa som
-- kraver en deploy for att andras.
-- -----------------------------------------------------------------------------

create table if not exists consequence_rule (
  id                  uuid primary key default gen_random_uuid(),

  -- Stegets plats i trappan. Unik: tva regler pa samma steg later
  -- sorteringsordningen avgora vad nagon drabbas av.
  ordning             smallint not null unique check (ordning > 0),

  -- Hur manga godkanda handelser inom perioden som utloser steget.
  antal_handelser     smallint not null check (antal_handelser > 0),
  periodlangd_manader smallint not null check (periodlangd_manader > 0),

  atgard              text not null
                        check (atgard in ('varning','skriftlig_erinran','bonusforlust','arende')),

  -- Bara bonusforlusten har en omfattning, och den ar alltid innevarande manad.
  -- O8: ovrig bonus faller inte. Villkoret nedan ar det som gor svaret till
  -- schema i stallet for till en overenskommelse.
  omfattning          text check (omfattning = 'innevarande_manad'),

  notifiera           boolean not null default true,

  set_by              uuid references employee(id),
  set_at              timestamptz not null default now(),

  constraint consequence_rule_omfattning check (
    (atgard = 'bonusforlust' and omfattning is not null)
    or (atgard <> 'bonusforlust' and omfattning is null)
  )
);

-- -----------------------------------------------------------------------------
-- 2. Handelsen
--
-- En rad per person och dag — `attendance_incident_dag_idx` ar unik. Samma dag
-- kan inte foreslas tva ganger, vilket gor att en motor som kors om inte bygger
-- en trappa av sina egna omkorningar.
-- -----------------------------------------------------------------------------

create table if not exists attendance_incident (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references employee(id) on delete cascade,
  occurred_on    date not null,

  -- O15. Under fem minuter ar ingen handelse alls.
  minutes        integer not null check (minutes >= 5),

  status         text not null default 'foreslagen'
                   check (status in ('foreslagen','godkand','avvisad','havd')),
  source         text not null default 'stampling'
                   check (source in ('stampling','manuell')),

  suggested_at   timestamptz not null default now(),
  decided_by     uuid references employee(id),
  decided_at     timestamptz,
  decision_note  text,

  -- Vilket trappsteg beslutet landade pa. Kopieras in vid godkannandet och
  -- lases aldrig om — samma frysning som provisionssatsen pa ordern. Andras
  -- trappan i morgon ska garden handelse behalla sin.
  rule_id        uuid references consequence_rule(id),
  ordningsnummer smallint check (ordningsnummer is null or ordningsnummer > 0),
  atgard         text check (atgard in ('varning','skriftlig_erinran','bonusforlust','arende')),

  hr_case_id     uuid references hr_case(id) on delete set null,

  revoked_by     uuid references employee(id),
  revoked_at     timestamptz,
  revoke_reason  text,

  period_month   date,
  created_by     uuid references employee(id),
  created_at     timestamptz not null default now(),

  -- Ett forslag har inget beslut. Ett beslut har bade vem och nar.
  constraint attendance_incident_beslut check (
    (status = 'foreslagen' and decided_by is null and decided_at is null)
    or (status <> 'foreslagen' and decided_by is not null and decided_at is not null)
  ),

  -- Bara det som GODKANTS bar en konsekvens. Ett avvisat forslag ska inte ha ett
  -- trappsteg liggande kvar som nasta rakning kan rakna med.
  constraint attendance_incident_konsekvens check (
    (status in ('godkand','havd') and ordningsnummer is not null and atgard is not null)
    or (status in ('foreslagen','avvisad') and ordningsnummer is null and atgard is null)
  ),

  constraint attendance_incident_havning check ((status = 'havd') = (revoked_at is not null)),
  constraint attendance_incident_havd_av check ((revoked_by is null) = (revoked_at is null))
);

create unique index if not exists attendance_incident_dag_idx
  on attendance_incident (employee_id, occurred_on);

-- Chefens ko: bara det som vantar pa beslut.
create index if not exists attendance_incident_ko_idx
  on attendance_incident (suggested_at) where status = 'foreslagen';

-- Trappan rakans bakat i tiden per person, och bara pa det som beslutats.
create index if not exists attendance_incident_person_idx
  on attendance_incident (employee_id, occurred_on desc) where status in ('godkand','havd');

-- -----------------------------------------------------------------------------
-- 3. Behorigheten
--
-- `attendance_approver` ar en permission och inte en roll, av samma skal som
-- `payroll_cost_viewer` i 0025: kretsen som far besluta om nagon annans lon
-- eller franvaro ska tilldelas person for person, inte folja med en roll.
--
-- Ledningen far den anda — utan det hade modulen statt tom pa samma satt som
-- lonekostnaden gor.
-- -----------------------------------------------------------------------------

alter table employee_permission drop constraint if exists employee_permission_permission_check;
alter table employee_permission add constraint employee_permission_permission_check
  check (permission in ('payroll_cost_viewer','recruiter','attendance_approver'));

create or replace function public.far_godkanna_franvaro()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_any_role(array['sales_manager','ceo'])
      or exists (
           select 1 from public.employee_permission p
            where p.employee_id = public.current_employee_id()
              and p.permission = 'attendance_approver'
         )
$$;

-- Samma fraga, men om EN bestamd person.
--
-- Teamledaren med behorigheten far besluta om sitt eget folk och ingen annans;
-- sa fort man ar sales_manager eller ceo galler det alla. Att kretsen ar smalare
-- an `far_godkanna_franvaro()` ar avsiktligt: den forsta svarar "far du se kon
-- alls", den har svarar "far du rora just den har raden".
create or replace function public.far_godkanna_franvaro_for(mal uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_any_role(array['sales_manager','ceo'])
      or (
        exists (
          select 1 from public.employee_permission p
           where p.employee_id = public.current_employee_id()
             and p.permission = 'attendance_approver'
        )
        and exists (
          select 1
            from public.employee m
            join public.team t on t.id = m.team_id
           where m.id = mal
             and t.lead_id = public.current_employee_id()
        )
      )
$$;

-- 0027/0032: `revoke ... from anon` gor oftast ingenting — det ar PUBLIC-granten
-- Postgres ger varje ny funktion som biter. Ratt form ar revoke fran public och
-- explicit grant tillbaka.
revoke all on function public.far_godkanna_franvaro() from public, anon;
revoke all on function public.far_godkanna_franvaro_for(uuid) from public, anon;
grant execute on function public.far_godkanna_franvaro() to authenticated, service_role;
grant execute on function public.far_godkanna_franvaro_for(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. Trappstegen kan inte backas
--
-- En beslutad handelse skrivs varken om eller bort. Ar beslutet fel HAVS det,
-- och havningen star kvar bredvid godkannandet — bada spar syns. Samma linje som
-- `commission_entry`: en rattelse ar en handelse, inte en overskrivning.
-- -----------------------------------------------------------------------------

create or replace function public.attendance_incident_ar_last()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'foreslagen' then
    raise exception 'En beslutad handelse raderas inte. Hav den i stallet.';
  end if;
  return old;
end;
$$;

create or replace function public.attendance_incident_stegbyte()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    if not (old.status, new.status) in (
      ('foreslagen', 'godkand'),
      ('foreslagen', 'avvisad'),
      ('godkand',    'havd')
    ) then
      raise exception 'En handelse kan inte ga fran % till %.', old.status, new.status;
    end if;
  end if;

  -- EN HAVD HANDELSE VACKS INTE TILL LIV. Ar havningen fel: godkann dagen pa
  -- nytt som en egen handelse, sa att bada spar star kvar.
  if old.status = 'havd' and new.status is distinct from old.status then
    raise exception 'En havd handelse oppnas inte igen.';
  end if;

  -- SJALVA HANDELSEN STAR FAST efter beslutet. Att kunna flytta datumet eller
  -- byta person pa en godkand handelse hade gjort varje trappa till en gissning
  -- om nar nagon tittade.
  if old.status <> 'foreslagen' then
    if new.employee_id    is distinct from old.employee_id
       or new.occurred_on is distinct from old.occurred_on
       or new.ordningsnummer is distinct from old.ordningsnummer
       or new.atgard        is distinct from old.atgard then
      raise exception 'En beslutad handelse skrivs inte om.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists attendance_incident_radering on attendance_incident;
create trigger attendance_incident_radering before delete on attendance_incident
  for each row execute function public.attendance_incident_ar_last();

drop trigger if exists attendance_incident_steg on attendance_incident;
create trigger attendance_incident_steg before update on attendance_incident
  for each row execute function public.attendance_incident_stegbyte();

-- -----------------------------------------------------------------------------
-- 5. RLS
--
-- DEN BEROMDA SER BARA DET SOM BESLUTATS. Ett forslag som chefen annu inte
-- tagit stallning till syns inte for den det gäller — annars blir varje
-- automatiskt genererat forslag ett besked innan nagon manniska last det.
-- Havda handelser syns daremot, for de ar en rattelse till personens fordel.
--
-- Ingen insert-, update- eller delete-policy. Skrivning sker uteslutande via
-- server actions med service role, som pa resten av navet.
-- -----------------------------------------------------------------------------

alter table consequence_rule enable row level security;
alter table attendance_incident enable row level security;

drop policy if exists consequence_rule_read on consequence_rule;
create policy consequence_rule_read on consequence_rule for select
  to authenticated
  using (true);

drop policy if exists attendance_incident_read on attendance_incident;
create policy attendance_incident_read on attendance_incident for select
  to authenticated
  using (
    (employee_id = public.current_employee_id() and status in ('godkand','havd'))
    or public.far_hantera_provision()
    or public.far_godkanna_franvaro_for(employee_id)
  );

-- -----------------------------------------------------------------------------
-- 6. Trappan som bestallaren beskrev
--
-- Tre steg inom rullande tre manader. Till skillnad fran volymtrappan och
-- K&V-maxpoangen ar den har SEEDAD — bestallaren gav den fardig, sa det finns
-- inget att gissa.
-- -----------------------------------------------------------------------------

insert into consequence_rule (ordning, antal_handelser, periodlangd_manader, atgard, omfattning, notifiera)
values
  (1, 1, 3, 'varning',      null,                true),
  (2, 2, 3, 'bonusforlust', 'innevarande_manad', true),
  (3, 3, 3, 'arende',       null,                true)
on conflict (ordning) do nothing;

-- -----------------------------------------------------------------------------
-- 7. Sjalvkontroll — samma sort som 0032, 0034, 0035 och 0036 avslutades med
-- -----------------------------------------------------------------------------

do $$
declare
  kvar text;
begin
  select string_agg(p.proname, ', ')
    into kvar
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('far_godkanna_franvaro', 'far_godkanna_franvaro_for')
    and has_function_privilege('anon', p.oid, 'execute');

  if kvar is not null then
    raise exception 'anon har annu execute pa: %', kvar;
  end if;
end;
$$;

-- Tabellen ska vara last for skrivning fran klienten. Har fangas bade en
-- glomd RLS och en skrivpolicy nagon lagger till senare.
do $$
declare
  skrivpolicyer int;
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'attendance_incident' and c.relrowsecurity
  ) then
    raise exception 'attendance_incident saknar row level security';
  end if;

  select count(*) into skrivpolicyer
  from pg_policies
  where schemaname = 'public'
    and tablename in ('attendance_incident', 'consequence_rule')
    and cmd <> 'SELECT';

  if skrivpolicyer > 0 then
    raise exception 'konsekvenstabellerna har % skrivpolicy(er) — skrivning ska ga via service role', skrivpolicyer;
  end if;
end;
$$;

-- O15 star i schemat och inte bara i specifikationen. Faller den har raden har
-- nagon sankt gransen utan att ga via K12 avsnitt 6 och 7.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'attendance_incident_minutes_check'
      and pg_get_constraintdef(oid) like '%>= 5%'
  ) then
    raise exception 'Femminutersgransen (O15) saknas pa attendance_incident.minutes';
  end if;
end;
$$;
