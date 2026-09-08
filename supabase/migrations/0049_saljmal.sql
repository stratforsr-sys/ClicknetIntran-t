-- =============================================================================
-- 0049_saljmal.sql — manadsmalet per saljare. E13, steg 10.
--
-- Bestallarens besked 2026-09-07: provisionsvyn ska svara pa vad man taktar,
-- och takten ska ga att stalla mot ett mal som chefen satter.
--
-- ---------------------------------------------------------------------------
-- MALET AR INTE PENGAR, OCH TABELLEN SER DARFOR INTE UT SOM `commission_entry`.
--
-- `commission_entry` ar append-only med en trigger som nekar bade update och
-- delete. Skalet star i 0031: en bokford krona ar ett pastaende om vad nagon
-- ska fa betalt, och det pastaendet far inte skrivas om i efterhand.
--
-- Ett MAL ar det motsatta. Det ar ett forsok att styra en manad som pagar, och
-- att andra det mitt i ar en normal chefshandling — laget forandras, nagon blir
-- sjuk, ett team omorganiseras. En append-only maltabell hade tvingat fram
-- "mal version 3" i vyn, och det ar inte vad nagon fragar efter.
--
-- Raden uppdateras darfor pa plats. SPARET LIGGER I `audit_log` i stallet:
-- server-actionen skriver `sales_target.set` med bade det gamla och det nya
-- talet vid varje andring, sa fragan "vem sankte mitt mal den 28:e" gar att
-- besvara utan att maltabellen behover bara historiken.
-- ---------------------------------------------------------------------------
--
-- INGET MAL SEEDAS. Tabellen fods tom, och en saljare utan mal far en vy som
-- sager att inget mal ar satt — inte en bage mot ett gissat tal. Samma linje
-- som volymtrappan i 0035 och tackningsgraden i 0025.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tabellen
-- -----------------------------------------------------------------------------

create table if not exists sales_target (
  id uuid primary key default gen_random_uuid(),

  employee_id uuid not null references employee(id) on delete cascade,

  -- Manadens forsta dag, som overallt annars i E13.
  period_month date not null,

  -- BADA MALEN AR FRIVILLIGA VAR FOR SIG, och det ar avsiktligt.
  --
  -- Ordermalet ar det som hor ihop med volymtrappan — den slar pa ANTAL, inte
  -- pa kronor — och det ar darfor det malet vyn i forsta hand ritar sin bage
  -- mot. Kronmalet finns for den chef som styr pa intakt i stallet.
  --
  -- Att kraeva bada hade tvingat fram ett paihittat tal i det man inte bryr sig
  -- om, och ett paihittat mal ar samma sort tyst sanning som en gissad bonus.
  target_orders  smallint check (target_orders > 0),
  target_amount  numeric(12,2) check (target_amount > 0),

  note text,

  set_by uuid not null references employee(id),
  set_at timestamptz not null default now(),

  -- EN RAD PER PERSON OCH MANAD. Utan den gar det att lagga tva mal for
  -- september, och da avgor sorteringsordningen vad nagon jamfors mot.
  constraint sales_target_unik unique (employee_id, period_month),

  -- Manadens forsta dag, inte nagon dag i manaden.
  constraint sales_target_manadens_forsta check (
    period_month = date_trunc('month', period_month)::date
  ),

  -- EN RAD UTAN MAL AR INGEN RAD. Den hade sett ut som ett satt mal i varje
  -- fraga som bara kontrollerar att raden finns, och det ar precis den sortens
  -- tysta nolla 0035 skrevs for att undvika.
  constraint sales_target_minst_ett check (
    target_orders is not null or target_amount is not null
  )
);

create index if not exists sales_target_manad_idx
  on sales_target (period_month, employee_id);

comment on table sales_target is
  'Manadsmal per saljare. Uppdateras pa plats; historiken ligger i audit_log (beslut 2026-09-07).';
comment on column sales_target.target_orders is
  'Antal order. Malet volymtrappan hor ihop med — trappan slar pa antal, inte pa kronor.';
comment on column sales_target.target_amount is
  'Kronor i provision. For den chef som styr pa intakt i stallet for pa volym.';

-- -----------------------------------------------------------------------------
-- 2. Behorighet
--
-- LASNINGEN AR VIDARE AN SKRIVNINGEN, och grasen gar mellan "mitt eget mal" och
-- "allas mal":
--
--   Saljaren laser SITT EGET. Ett mal man inte far se ar inte ett mal, det ar
--   en fallucka. Det ar samma argument som gjorde `commission_bonus_level`
--   oppen i 0035.
--
--   `far_hantera_provision()` (saljchef, VD, ekonomi) laser allas.
--
--   Skrivningen sker uteslutande via server actions med service role, och
--   kretsen dar ar `far_andra_provisionsregler()` — saljchef och VD. Ekonomi
--   ser malen men satter dem inte, exakt som med trappan i 0035: den som
--   betalar ut ska inte ocksa bestamma vad som ska presteras.
--
-- SALJAREN SER INTE ANDRAS MAL. Det var ett val och inte en foljd: ett mal ar
-- en overenskommelse mellan en chef och en person, och gors det oppet blir det
-- en rangordning innan nagon bestamt att det ska vara en.
-- -----------------------------------------------------------------------------

alter table sales_target enable row level security;

drop policy if exists sales_target_read on sales_target;
create policy sales_target_read on sales_target for select
  to authenticated
  using (employee_id = public.current_employee_id() or public.far_hantera_provision());

-- Ingen insert-, update- eller delete-policy. Skrivning sker via server actions
-- med service role, som pa resten av navet.

-- -----------------------------------------------------------------------------
-- 3. Sjalvkontroll — samma sort som 0032, 0034 och 0035 avslutades med
--
-- Fragan ar databasen sjalv i stallet for att lita pa att kommandona ovan gjorde
-- det de ser ut att gora. Star nagot fel rivs hela transaktionen.
-- -----------------------------------------------------------------------------

do $$
declare
  antal int;
begin
  select count(*) into antal
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  where c.relname = 'sales_target';

  if antal <> 1 then
    raise exception 'sales_target skulle ha exakt en policy, har %', antal;
  end if;

  if not exists (
    select 1 from pg_class where relname = 'sales_target' and relrowsecurity
  ) then
    raise exception 'sales_target har inte row level security paslaget';
  end if;
end $$;
