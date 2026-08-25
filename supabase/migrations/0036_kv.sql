-- =============================================================================
-- 0036_kv.sql — K&V-protokollet. E13, steg 5 av nio.
--
-- Hela regelverket star i docs/PROVISION_SPEC.md avsnitt 6.
--
-- VAD SOM SEEDAS OCH VAD SOM INTE GOR DET
--
-- Seedat, for att bestallaren har SVARAT pa det:
--   * de sex omradena (fraga 28) — bestallarens egna ord
--   * tva samtal per vecka (fraga 27), troskel 160 poang (fraga 29),
--     1,25 % per godkand vecka (fraga 30), tak 5 % (fraga 32)
--
-- INTE seedat, for att bestallaren INTE har svarat pa det:
--   * maxpoangen per omrade. O4 sager att 200 ar maxpoangen TOTALT for bada
--     samtalen, alltsa 100 per samtal fordelat pa sex omraden — men hur de 100
--     fordelas ar inte sagt, och "korrekt avtalshantering" och "behovsanalys"
--     vager rimligen olika.
--
-- `max_points` ar darfor NULL tills nagon fyller i den, och utan den gar det
-- inte att bedoma ett samtal. Samma linje som tackningsgraden i 0025 och
-- volymtrappan i 0035: en gissad siffra ser ratt ut och blir tyst sanning.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Omradena
--
-- Sex stycken, bestallarens egna ord. Att de ar RADER och inte ett
-- check-villkor ar samma val som overallt annars i E13: ett sjunde omrade ska
-- vara en inmatning, inte en migration.
-- -----------------------------------------------------------------------------

create table if not exists kv_criterion (
  id    uuid primary key default gen_random_uuid(),
  label text not null check (length(btrim(label)) > 0),

  -- NULL = EJ SATT. Se rubriken ovan. Ett samtal gar inte att bedoma forran
  -- samtliga aktiva omraden har en maxpoang.
  max_points numeric(5,2) check (max_points is null or max_points > 0),

  sort   smallint not null,
  active boolean not null default true,

  set_by uuid references employee(id),
  set_at timestamptz not null default now()
);

insert into kv_criterion (label, sort)
select * from (values
  ('Intro',                    1::smallint),
  ('Behovsanalys',             2::smallint),
  ('ROI',                      3::smallint),
  ('Avslut',                   4::smallint),
  ('Kvalitet på samtalet',     5::smallint),
  ('Korrekt avtalshantering',  6::smallint)
) as v(label, sort)
where not exists (select 1 from kv_criterion);

comment on table kv_criterion is
  'De sex omradena ett K&V-samtal bedoms pa. Etiketterna ar bestallarens (fraga 28); max_points ar EJ SATT och maste fyllas i innan nagot gar att bedoma (O4).';

-- -----------------------------------------------------------------------------
-- 2. Reglerna
--
-- Versionerad med valid_from/valid_to och slagen upp pa MANADENS forsta dag,
-- precis som volymtrappan i 0035 och av samma skal: K&V-bonusen ar en egenskap
-- hos hela manaden, inte hos ett enskilt samtal.
--
-- Talen nedan ar bestallarens svar, inte antaganden:
--   calls_per_week   2      fraga 27
--   threshold_points 160    fraga 29, summan av BADA samtalen
--   percent_per_week 1.25   fraga 30
--   cap_percent      5      fraga 32, aven i en manad med fem veckor
-- -----------------------------------------------------------------------------

create table if not exists kv_policy (
  id uuid primary key default gen_random_uuid(),

  calls_per_week   smallint     not null check (calls_per_week > 0),
  threshold_points numeric(7,2) not null check (threshold_points >= 0),
  percent_per_week numeric(5,2) not null check (percent_per_week >= 0),
  cap_percent      numeric(5,2) not null check (cap_percent >= 0),

  valid_from date not null,
  valid_to   date,

  set_by uuid references employee(id),
  set_at timestamptz not null default now(),
  note   text,

  constraint kv_policy_period check (valid_to is null or valid_to > valid_from),

  -- Ett tak som ar lagre an en enda veckas procent gor att ingen vecka nagonsin
  -- ger nagot. Det ar inte en strang installning utan en trasig.
  constraint kv_policy_tak check (cap_percent >= percent_per_week)
);

create unique index if not exists kv_policy_oppen_idx
  on kv_policy ((valid_to is null)) where valid_to is null;

insert into kv_policy (calls_per_week, threshold_points, percent_per_week, cap_percent, valid_from, note)
select 2, 160, 1.25, 5, date '2026-08-01', 'Bestallarens svar 2026-08-24, fraga 27, 29, 30 och 32.'
where not exists (select 1 from kv_policy);

comment on table kv_policy is
  'K&V-reglerna per manad: antal samtal, troskel, procent per godkand vecka och tak. Versionerad; slas upp pa manadens forsta dag som volymtrappan.';

-- -----------------------------------------------------------------------------
-- 3. Samtalet
--
-- SOMMEN MOT DIALERN LIGGER HAR FRAN BORJAN. Bestallaren vill hamta samtalen
-- via API fran den egna dialern men har lagt det SIST i ordningen (fraga 27,
-- steg 8). Tills dess registrerar saljchefen samtalet for hand.
--
-- `source` + `external_ref` med ett partiellt unikt index ar samma modell som
-- Inkio fick i 0031 och samma som huvudboken anvander. Den dagen dialern kopplas
-- in behover ingen vy roras och ingen kolumn laggas till.
-- -----------------------------------------------------------------------------

create table if not exists kv_call (
  id uuid primary key default gen_random_uuid(),

  employee_id uuid not null references employee(id) on delete cascade,

  call_date date not null,
  customer  text not null check (length(btrim(customer)) > 0),

  source       text not null default 'manual' check (source in ('manual', 'dialer')),
  external_ref text,

  created_by uuid not null references employee(id),
  created_at timestamptz not null default now(),

  constraint kv_call_kalla check (
    (source = 'manual' and external_ref is null)
    or (source = 'dialer' and external_ref is not null)
  )
);

create unique index if not exists kv_call_extern_idx
  on kv_call (source, external_ref) where external_ref is not null;

create index if not exists kv_call_person_idx on kv_call (employee_id, call_date desc);

comment on table kv_call is
  'Ett samtal som lett till salj, utvalt for K&V. Registreras for hand tills dialer-API:t finns (steg 8); sommen ar source + external_ref.';

-- -----------------------------------------------------------------------------
-- 4. Bedomningen
--
-- En bedomning per samtal, och den FAR andras i efterhand (fraga 35). Det ar en
-- avsiktlig skillnad mot huvudboken, som ar append-only: en bedomning ar en
-- manniskas omdome, och ett omdome som visar sig fel ska ga att rata.
--
-- Andringen loggas i `audit_log`. Ar PERIODEN stangd blir andringen daremot en
-- RATTELSEPOST i huvudboken och inte en overskrivning av det som betalats ut —
-- den delen ligger i koden, inte har.
-- -----------------------------------------------------------------------------

create table if not exists kv_assessment (
  call_id uuid primary key references kv_call(id) on delete cascade,

  assessed_by uuid not null references employee(id),
  assessed_at timestamptz not null default now(),

  -- Helhetskommentaren (fraga 37). Fritexten per omrade ligger pa poangraden.
  comment text,

  updated_by uuid references employee(id),
  updated_at timestamptz
);

create table if not exists kv_score (
  call_id      uuid not null references kv_assessment(call_id) on delete cascade,
  criterion_id uuid not null references kv_criterion(id),

  points numeric(5,2) not null check (points >= 0),
  note   text,

  primary key (call_id, criterion_id)
);

-- -----------------------------------------------------------------------------
-- POANGEN FAR INTE OVERSTIGA OMRADETS MAXPOANG, och maxpoangen maste vara satt.
--
-- Utan kontrollen gar det att satta 500 poang pa ett omrade vars tak ar 20, och
-- da nas troskeln 160 pa ett samtal i stallet for pa tva. Kontrollen ligger i
-- databasen och galler darfor aven service role.
-- -----------------------------------------------------------------------------

create or replace function public.kv_score_inom_taket()
returns trigger
language plpgsql
as $$
declare
  tak numeric(5,2);
begin
  select max_points into tak from kv_criterion where id = new.criterion_id;

  if tak is null then
    raise exception 'Omradet har ingen maxpoang satt. Fyll i K&V-installningarna forst.';
  end if;

  if new.points > tak then
    raise exception 'Poangen % overstiger omradets maxpoang %.', new.points, tak;
  end if;

  return new;
end;
$$;

drop trigger if exists kv_score_tak on kv_score;
create trigger kv_score_tak
  before insert or update on kv_score
  for each row execute function public.kv_score_inom_taket();

-- -----------------------------------------------------------------------------
-- 5. Behorighet
--
-- BEDOMER: saljchef och VD. Det ar saljchefen som lyssnar pa samtalen; VD star
-- med av samma skal som overallt annars i navet, sa att modulen inte last sig
-- nar en person ar borta.
--
-- SER ALLAS: samma krets som provisionen — saljchef, ekonomi, VD.
-- TEAMLEDAREN STAR UTANFOR, samma linje som provisionen (avsnitt 6.4).
--
-- SER SIN EGEN: saljaren, INKLUSIVE fritexten (fraga 38). Det ar hela poangen
-- med ett utvecklingsprotokoll — en bedomning den bedomde inte far lasa ar inte
-- utveckling utan en hemlig akt.
-- -----------------------------------------------------------------------------

create or replace function public.far_bedoma_kv()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_any_role(array['sales_manager','ceo'])
$$;

-- REVOKE MASTE TA BADE `public` OCH `anon`. Supabase har en egen default-ACL pa
-- schemat som ger `anon` en EXPLICIT grant pa varje ny funktion. 0034 foll pa
-- exakt det forsta gangen den kordes. Sjalvkontrollen langst ned fangar det.
revoke all on function public.far_bedoma_kv() from public, anon;
grant execute on function public.far_bedoma_kv() to authenticated, service_role;

comment on function public.far_bedoma_kv() is
  'Saljchef och VD. Bedomer K&V-samtal. Ekonomi ser bedomningarna men satter dem inte.';

alter table kv_criterion  enable row level security;
alter table kv_policy     enable row level security;
alter table kv_call       enable row level security;
alter table kv_assessment enable row level security;
alter table kv_score      enable row level security;

-- Omradena och reglerna ar oppna for alla inloggade, av samma skal som
-- volymtrappan i 0035: den som bedoms ska veta vad hen bedoms pa och vad som
-- kravs. Raderna bar inga personuppgifter.
drop policy if exists kv_criterion_read on kv_criterion;
create policy kv_criterion_read on kv_criterion for select to authenticated using (true);

drop policy if exists kv_policy_read on kv_policy;
create policy kv_policy_read on kv_policy for select to authenticated using (true);

drop policy if exists kv_call_read on kv_call;
create policy kv_call_read on kv_call for select to authenticated using (
  employee_id = public.current_employee_id()
  or public.far_hantera_provision()
);

-- Bedomningen och poangen foljer SAMTALET. Ett eget villkor har hade kunnat
-- glida isar fran kv_call:s, och da hade nagon sett en bedomning av ett samtal
-- hen inte far se.
drop policy if exists kv_assessment_read on kv_assessment;
create policy kv_assessment_read on kv_assessment for select to authenticated using (
  exists (
    select 1 from kv_call c
    where c.id = kv_assessment.call_id
      and (c.employee_id = public.current_employee_id() or public.far_hantera_provision())
  )
);

drop policy if exists kv_score_read on kv_score;
create policy kv_score_read on kv_score for select to authenticated using (
  exists (
    select 1 from kv_call c
    where c.id = kv_score.call_id
      and (c.employee_id = public.current_employee_id() or public.far_hantera_provision())
  )
);

-- Ingen insert-, update- eller delete-policy. Skrivning sker uteslutande via
-- server actions med service role, som pa resten av navet.

-- -----------------------------------------------------------------------------
-- 6. Sjalvkontroll — samma sort som 0032, 0034 och 0035 avslutades med
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
    and p.proname = 'far_bedoma_kv'
    and has_function_privilege('anon', p.oid, 'execute');

  if kvar is not null then
    raise exception 'anon har annu execute pa: %', kvar;
  end if;
end;
$$;

-- Kontrollera att de sex omradena verkligen fods UTAN maxpoang. Skulle nagon
-- lagga till ett seedat varde har faller migrationen i stallet for att tyst
-- gora en gissning till en regel.
do $$
declare
  satta int;
begin
  select count(*) into satta from kv_criterion where max_points is not null;
  if satta > 0 then
    raise exception 'Omraden med seedad maxpoang: %. O4 ger inte fordelningen — den ska fyllas i.', satta;
  end if;
end;
$$;
