-- =============================================================================
-- 0079 — Finans på ordern
--
-- Beställaren 2026-10-09:
--
--   *"När vi lägger upp ordrar i intranätet måste vi också kunna välja finans.
--   Finans betyder att vår finanspartner tar 11% av ordervärdet per år, alltså
--   om det är 12 månader så tar dem 11%, om det är 24, 22% osv."*
--
-- Och på följdfrågorna samma dag:
--
--   BASEN ÄR HELA ORDERVÄRDET — månadsbelopp × löptid plus tjänsterna, före ett
--   eventuellt utköp. Det är talet som står som ordervärde på ordern.
--
--   AVGIFTEN DRAS FRÅN NETTOT, precis som utköpet. Allt som räknas i procent på
--   nettot blir lägre: chefens egen sats, övertäcket, utköpssatsen och en
--   handsatt procent. Paketmatrisens fasta belopp ändras INTE.
--
-- ===========================================================================
-- VALET OCH BELOPPET ÄR TVÅ KOLUMNER, och de skrivs vid olika tillfällen.
--
--   `financed`        Säljarens uppgift: affären går via finanspartnern. Skrivs
--                     redan på en inskickad order, av samma skäl som utköpet —
--                     säljaren vet det, godkännaren gör det inte.
--   `finance_amount`  Avgiften i kronor. FRYSES vid godkännandet, som
--                     provisionen och ordervärdet: en sats som ändras i mars
--                     ändrar inte vad en affär i oktober kostade.
--
-- Satsen är konfiguration och inte kod (AC-10.1): en rad i `finance_rate`,
-- versionerad med valid_from/valid_to och uppslagen på SIGNERINGSDATUMET.
-- ===========================================================================
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Satsen
-- -----------------------------------------------------------------------------

create table if not exists finance_rate (
  id uuid primary key default gen_random_uuid(),

  -- PROCENT PER ÅR, inte per avtal. Ett tvåårsavtal kostar dubbelt så mycket
  -- som ett ettårsavtal; se `finansprocent()` i `src/lib/finans.ts`.
  percent_per_year numeric(5,2) not null check (percent_per_year >= 0 and percent_per_year <= 100),

  valid_from date not null,
  valid_to   date,

  set_by uuid references employee(id),
  set_at timestamptz not null default now(),
  note   text,

  constraint finance_rate_period check (valid_to is null or valid_to > valid_from)
);

create unique index if not exists finance_rate_oppen_idx
  on finance_rate ((true))
  where valid_to is null;

create index if not exists finance_rate_uppslag_idx
  on finance_rate (valid_from desc);

comment on table finance_rate is
  'Finanspartnerns avgift i procent av ordervardet PER AR, versionerad med valid_from/valid_to. Exakt en oppen rad.';

-- BESTÄLLARENS SATS, lämnad 2026-10-09.
--
-- `valid_from` ligger vid årets början med flit. Satsen gäller bara order som
-- uttryckligen kryssats som finans, och ingen order bär det valet i dag — så
-- raden rör ingenting som redan hänt. Den gör däremot att en order som läggs in
-- i efterhand, med ett signeringsdatum i september, hittar en sats i stället
-- för att nekas.
insert into finance_rate (percent_per_year, valid_from, note)
select 11.00, date '2026-01-01',
       'Bestallarens sats 2026-10-09: finanspartnern tar 11 % av ordervardet per ar av avtalstiden.'
where not exists (select 1 from finance_rate);

-- -----------------------------------------------------------------------------
-- 2. Ordern
-- -----------------------------------------------------------------------------

alter table sales_order
  add column if not exists financed boolean not null default false,
  add column if not exists finance_amount numeric(12,2),
  add column if not exists finance_rate_id uuid references finance_rate(id);

comment on column sales_order.financed is
  'Affaren gar via finanspartnern. Satts av saljaren, aven pa en inskickad order.';
comment on column sales_order.finance_amount is
  'Finanspartnerns avgift i kronor, fryst vid godkannandet: ordervarde x procent per ar x loptid/12. Dras fran nettot fore provision och overtack.';

-- Ingen avgift och ingen sats utan valet. Ett belopp på en order som inte är
-- finansierad hade sänkt nettot utan att någon kunde se varför.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sales_order_finans_kraver_val') then
    alter table sales_order add constraint sales_order_finans_kraver_val
      check (financed or (finance_amount is null and finance_rate_id is null));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'sales_order_finans_ej_negativ') then
    alter table sales_order add constraint sales_order_finans_ej_negativ
      check (finance_amount is null or finance_amount >= 0);
  end if;

  -- EN GODKÄND FINANSORDER BÄR SIN AVGIFT. Utan villkoret hade en godkänd order
  -- kunnat stå som finans utan avdrag — alltså räknats som om den inte var det.
  -- Alla tre kolumnerna i villkoret är NOT NULL eller prövas med `is`, så det
  -- kan inte bli NULL och därmed släppa igenom allt.
  if not exists (select 1 from pg_constraint where conname = 'sales_order_finans_fryst') then
    alter table sales_order add constraint sales_order_finans_fryst
      check (
        not financed
        or status not in ('signerad', 'betald', 'makulerad')
        or finance_amount is not null
      );
  end if;

  -- UTKÖP OCH FINANS RYMS TILLSAMMANS I AFFÄREN. Samma tanke som
  -- `sales_order_utkop_ryms` i 0060, med båda avdragen.
  if not exists (select 1 from pg_constraint where conname = 'sales_order_finans_ryms') then
    alter table sales_order add constraint sales_order_finans_ryms
      check (
        finance_amount is null
        or order_value is null
        or finance_amount + coalesce(buyout_amount, 0) <= order_value
      );
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. En makulerad order rättas inte — finansen står med i listan
--
-- Funktionen nedan är `sales_order_stegbyte` SOM DEN SER UT I DATABASEN
-- 2026-10-09 (pg_get_functiondef), med två rader till i makuleringsspärren.
-- Finansen avgör nettot, och nettot avgör provisionen — samma skäl som
-- `buyout_amount` står där sedan 0060.
-- -----------------------------------------------------------------------------

create or replace function public.sales_order_stegbyte()
 returns trigger
 language plpgsql
as $function$
declare
  tillatet boolean;
  gammal_stangd boolean;
  ny_stangd boolean;
begin
  if new.status is distinct from old.status then
    tillatet := (old.status, new.status) in (
      ('utkast',    'inskickad'),
      ('utkast',    'signerad'),
      ('inskickad', 'utkast'),
      ('inskickad', 'signerad'),
      ('signerad',  'betald'),
      ('signerad',  'makulerad'),
      ('betald',    'makulerad')
    );

    if not tillatet then
      raise exception 'Ordern kan inte ga fran % till %.', old.status, new.status;
    end if;
  end if;

  -- EN MAKULERAD ORDER STANNAR MAKULERAD.
  if old.status = 'makulerad' and new.status is distinct from old.status then
    raise exception 'En makulerad order oppnas inte igen. Lagg en ny order i stallet.';
  end if;

  -- EN MAKULERAD ORDER RATTAS INTE HELLER.
  -- `buyout_amount` star med sedan 0060: utkopet avgor nettot, och nettot avgor
  -- provisionen. `monthly_amount` star med sedan 0068, av samma skal: det ar
  -- ena halvan av ordervardet. `financed` och `finance_amount` sedan 0079:
  -- finansavgiften avgor nettot precis som utkopet.
  if old.status = 'makulerad'
     and (new.commission_amount is distinct from old.commission_amount
          or new.order_value    is distinct from old.order_value
          or new.buyout_amount  is distinct from old.buyout_amount
          or new.financed       is distinct from old.financed
          or new.finance_amount is distinct from old.finance_amount
          or new.monthly_amount is distinct from old.monthly_amount
          or new.salesperson_id is distinct from old.salesperson_id
          or new.signed_on      is distinct from old.signed_on) then
    raise exception 'En makulerad order rattas inte. Lagg en ny order i stallet.';
  end if;

  -- -------------------------------------------------------------------------
  -- PERIODSKYDDET. Bada riktningarna, och bada har sitt eget besked.
  -- -------------------------------------------------------------------------
  if new.signed_on is distinct from old.signed_on
     and old.status in ('signerad', 'betald') then

    select exists (
      select 1 from commission_period
      where period_month = date_trunc('month', old.signed_on::timestamp)::date
    ) into gammal_stangd;

    select exists (
      select 1 from commission_period
      where period_month = date_trunc('month', new.signed_on::timestamp)::date
    ) into ny_stangd;

    if gammal_stangd
       and date_trunc('month', new.signed_on::timestamp)
           is distinct from date_trunc('month', old.signed_on::timestamp) then
      raise exception
        'Ordern hor till %, som ar faststalld. Signeringsdatumet gar att andra inom manaden, men inte ut ur den. Makulera och lagg en ny order.',
        to_char(old.signed_on, 'YYYY-MM');
    end if;

    if ny_stangd
       and date_trunc('month', new.signed_on::timestamp)
           is distinct from date_trunc('month', old.signed_on::timestamp) then
      raise exception
        'Ordern kan inte flyttas till %, som ar faststalld. En stangd period tar inte emot nya order.',
        to_char(new.signed_on, 'YYYY-MM');
    end if;
  end if;

  return new;
end;
$function$;

-- -----------------------------------------------------------------------------
-- 4. RLS
--
-- Läsbar för alla inloggade, som utköpssatsen: säljaren ska se vad en
-- finansaffär kostar innan hen trycker. Skrivning bara med service role.
-- -----------------------------------------------------------------------------

alter table finance_rate enable row level security;

drop policy if exists finance_rate_read on finance_rate;
create policy finance_rate_read on finance_rate for select
  to authenticated using (true);

-- -----------------------------------------------------------------------------
-- 5. Självkontroll
-- -----------------------------------------------------------------------------

do $$
declare
  antal int;
begin
  select count(*) into antal from finance_rate where valid_to is null;
  if antal <> 1 then
    raise exception 'Det finns % oppna finanssatser, ska vara exakt en.', antal;
  end if;

  if not exists (
    select 1 from pg_class where relname = 'finance_rate' and relrowsecurity
  ) then
    raise exception 'finance_rate saknar row level security.';
  end if;

  -- Ingen befintlig order får ha blivit finansierad av migrationen.
  select count(*) into antal from sales_order where financed or finance_amount is not null;
  if antal <> 0 then
    raise exception '% order star som finans efter migrationen, ska vara noll.', antal;
  end if;

  if position('finance_amount' in pg_get_functiondef('public.sales_order_stegbyte'::regproc)) = 0 then
    raise exception 'sales_order_stegbyte vet inte om finansen.';
  end if;
end;
$$;
