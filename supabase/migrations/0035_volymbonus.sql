-- =============================================================================
-- 0035_volymbonus.sql — volymtrappan och periodstangningen. E13, steg 3 av nio.
--
-- Hela regelverket star i docs/PROVISION_SPEC.md avsnitt 5 och 8. Det har ar
-- vad databasen behover veta.
--
-- INGET BELOPP SEEDAS. INTE ETT ENDA.
--
-- Bestallaren har satt nivaerna 5/10/15/20/25/30 men INTE vad de ar varda
-- (avsnitt 5.1, fraga 18). Tabellen fods darfor tom, och motorn ger noll bonus
-- tills nagon fyller i den. Samma linje som tackningsgraden i 0025, och av
-- samma skal: en gissad siffra ser ratt ut och blir tyst sanning. En nolla i
-- vyn syns; ett standardvarde gor det inte.
--
-- Aven TROSKLARNA ar data. Att lagga 5/10/15/20/25/30 i ett check-villkor hade
-- gjort en sjunde niva till en migration.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Volymtrappan
--
-- Versioneringen ar `valid_from` / `valid_to`, aldrig en uppdatering pa plats —
-- samma form som `cost_rate` i 0025 och `commission_rate` i 0034.
--
-- UPPSLAGET SKER PA MANADENS FORSTA DAG, inte pa orderns signeringsdatum, och
-- skillnaden mot `commission_rate` foljer av vad de tva ar. Provisionssatsen ar
-- en egenskap hos EN ORDER. Volymbonusen ar en egenskap hos HELA MANADEN —
-- nivan bestams av manadens samlade ordervolym — och en trappa som byter form
-- mitt i manaden gar inte att tillampa per order utan att bli obegriplig.
--
-- Det gor bestallarens tre val i avsnitt 8.1 entydiga:
--
--   "Galler allt intjanat denna manad"  -> valid_from = den 1:a   -> slar igenom nu
--   "Galler fran och med nu"            -> valid_from = i dag     -> slar igenom nasta manad
--   "Galler fran och med nasta manad"   -> valid_from = nasta 1:a -> slar igenom nasta manad
--
-- Regeln star inte i specifikationen — fragan var inte stalld. Se O16.
--
-- Det partiella unika indexet garanterar EN oppen rad per troskel. Utan det gar
-- det att lagga in tva gallande belopp for niva 10, och da avgor
-- sorteringsordningen vad nagon far betalt.
-- -----------------------------------------------------------------------------

create table if not exists commission_bonus_level (
  id uuid primary key default gen_random_uuid(),

  -- Antalet order som kravs. 5, 10, 15, 20, 25, 30 enligt bestallaren, men
  -- talen ar data och inte ett check-villkor.
  threshold smallint not null check (threshold > 0),

  amount numeric(12,2) not null check (amount >= 0),

  -- Bestallaren valde FAST BELOPP (O2), men procent och kronor-per-order ska
  -- ga att valja i installningarna. Kolumnen finns darfor fran borjan — samma
  -- form som `cost_rate.unit` i 0025.
  --
  --   amount_fixed     ett fast kronbelopp nar nivan nas
  --   percent          procent pa manadens grundprovision
  --   amount_per_order kronor per order, galler SAMTLIGA order i perioden
  unit text not null default 'amount_fixed'
    check (unit in ('amount_fixed', 'percent', 'amount_per_order')),

  valid_from date not null,
  valid_to   date,

  set_by uuid references employee(id),
  set_at timestamptz not null default now(),
  note   text,

  constraint commission_bonus_level_period check (valid_to is null or valid_to > valid_from)
);

create unique index if not exists commission_bonus_level_oppen_idx
  on commission_bonus_level (threshold)
  where valid_to is null;

create index if not exists commission_bonus_level_uppslag_idx
  on commission_bonus_level (valid_from desc, threshold);

comment on table commission_bonus_level is
  'Volymtrappan per manad, versionerad med valid_from/valid_to. Slas upp pa manadens forsta dag, inte pa orderns datum. Fods TOM: bestallaren har inte satt beloppen (O2, avsnitt 5.1).';

-- -----------------------------------------------------------------------------
-- 2. Perioden
--
-- ===========================================================================
-- EN OPPEN PERIOD AR FRANVARON AV EN RAD.
--
-- Avsnitt 5.6 namner tre lagen — oppen, faststalld, utbetald. Bara de tva
-- sista finns som rader har, och det ar avsiktligt: "oppen" ar inte ett
-- tillstand nagon satt, det ar att ingen har stangt manaden an. En rad med
-- status 'oppen' hade varit ett tillstand utan innebord som nagon forr eller
-- senare hade glomt att skapa — och da hade en manad utan rad blivit
-- tvetydig i stallet for oppen.
--
-- Fragan "ar augusti stangd" ar darmed "finns raden".
-- ===========================================================================
--
-- Perioden ar GEMENSAM for alla saljare, inte en rad per person. Attesten ar
-- ett beslut om manaden, och en manad som ar stangd for en person och oppen
-- for en annan gar inte att svara pa fragan "vad kostade augusti".
-- -----------------------------------------------------------------------------

create table if not exists commission_period (
  period_month date primary key
    check (period_month = date_trunc('month', period_month)::date),

  status text not null default 'faststalld'
    check (status in ('faststalld', 'utbetald')),

  closed_by uuid not null references employee(id),
  closed_at timestamptz not null default now(),

  -- Utbetalning sker manaden efter intjanandemanaden (fraga 58). Markeras nar
  -- lonekorningen ar gjord.
  paid_by uuid references employee(id),
  paid_at timestamptz,

  note text,

  constraint commission_period_utbetald check (
    (status = 'faststalld' and paid_by is null and paid_at is null)
    or (status = 'utbetald' and paid_by is not null and paid_at is not null)
  )
);

comment on table commission_period is
  'Stangda provisionsperioder. En manad UTAN rad ar oppen och raknas live ur orderna; en manad MED rad ar bokford i commission_entry och rors aldrig mer. Se PROVISION_SPEC.md avsnitt 5.5.';

-- -----------------------------------------------------------------------------
-- 3. En period stangs efter manadens slut, en gang, och oppnas aldrig
--
-- Kontrollen ligger i databasen och inte i koden, sa den galler aven service
-- role — precis som `payroll_period_ar_last` i 0012. Skalet ar starkare har:
-- hela poangen med att stanga en period ar att den inte gar att rakna om, och
-- en regel som bara finns i en server action ar en regel nasta server action
-- inte kanner till.
-- -----------------------------------------------------------------------------

create or replace function public.commission_period_stangs()
returns trigger
language plpgsql
as $$
declare
  sista_dagen date;
begin
  if tg_op = 'DELETE' then
    raise exception 'En stangd provisionsperiod oppnas inte igen. Bokfor en rattelse som en negativ post.';
  end if;

  if tg_op = 'INSERT' then
    -- Manaden maste vara slut. En period som stangs den 20:e stanger ute de
    -- order som tecknas den 25:e, och de har ingen vag tillbaka in — se O11.
    sista_dagen := (new.period_month + interval '1 month' - interval '1 day')::date;

    -- Dagen raknas i SVENSK tid. Pa Vercel star servern i UTC, och den 1:a
    -- klockan 00:30 svensk tid hade dar lasts som den 31:a — vilket hade
    -- slappt igenom en attest ett dygn for tidigt. Samma resonemang som
    -- `manadsnyckel()` i src/lib/provision.ts.
    if (now() at time zone 'Europe/Stockholm')::date < sista_dagen then
      raise exception 'Perioden % kan inte faststallas fore %.', new.period_month, sista_dagen;
    end if;

    return new;
  end if;

  -- Efter stangningen finns exakt en tillaten forandring: att markera
  -- utbetalningen. Allt annat — manad, belopp, vem som stangde — star fast.
  if new.period_month is distinct from old.period_month
     or new.closed_by is distinct from old.closed_by
     or new.closed_at is distinct from old.closed_at then
    raise exception 'En faststalld period skrivs inte om.';
  end if;

  if not (old.status = 'faststalld' and new.status = 'utbetald') then
    raise exception 'Perioden kan bara ga fran faststalld till utbetald.';
  end if;

  return new;
end;
$$;

drop trigger if exists commission_period_last on commission_period;
create trigger commission_period_last
  before insert or update or delete on commission_period
  for each row execute function public.commission_period_stangs();

-- -----------------------------------------------------------------------------
-- 4. Huvudboken far en tredje kalla: motorn
--
-- 0031 kande `manual` och `inkio`. Nar en period stangs bokfor MOTORN sina
-- poster, och de ar varken inknappade av en manniska eller importerade.
--
-- `external_ref` ar det som gor stangningen IDEMPOTENT. Referensen ar
-- deterministisk — manad, person och slag — sa det partiella unika indexet i
-- 0031 nekar en andra bokforing av samma sak. En attest som faller halvvags gar
-- darfor att kora om utan att nagon far dubbelt betalt.
--
-- Villkoret droppas via katalogen i stallet for pa namn: `source`-villkoret
-- skrevs som ett kolumnvillkor i 0031 och bar darmed ett genererat namn.
-- -----------------------------------------------------------------------------

do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'commission_entry'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%source%'
      and pg_get_constraintdef(oid) not like '%external_ref%'
  loop
    execute format('alter table commission_entry drop constraint %I', c.conname);
  end loop;
end;
$$;

alter table commission_entry drop constraint if exists commission_entry_kallista;
alter table commission_entry add constraint commission_entry_kallista
  check (source in ('manual', 'inkio', 'motor'));

alter table commission_entry drop constraint if exists commission_entry_kalla;
alter table commission_entry add constraint commission_entry_kalla check (
  (source = 'manual' and external_ref is null)
  or (source in ('inkio', 'motor') and external_ref is not null)
);

-- -----------------------------------------------------------------------------
-- 5. Behorighet
--
-- TVA OLIKA KRETSAR, och skillnaden ar bestallarens (avsnitt 2):
--
--   far_hantera_provision()      saljchef, VD, ekonomi — SER andras provision
--   far_andra_provisionsregler() saljchef, VD          — ANDRAR reglerna
--
-- Ekonomi ser men andrar inte. Den som betalar ut ska inte ocksa vara den som
-- bestammer vad som ska betalas ut.
-- -----------------------------------------------------------------------------

create or replace function public.far_andra_provisionsregler()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_any_role(array['sales_manager','ceo'])
$$;

-- REVOKE MASTE TA BADE `public` OCH `anon`. Supabase har en egen default-ACL pa
-- schemat som ger `anon` en EXPLICIT grant pa varje ny funktion — inte via
-- PUBLIC — sa ett revoke fran PUBLIC ensamt ror den inte. 0034 fol pa exakt det
-- forsta gangen den kordes. Sjalvkontrollen langst ned fangar det.
revoke all on function public.far_andra_provisionsregler() from public, anon;
grant execute on function public.far_andra_provisionsregler() to authenticated, service_role;

comment on function public.far_andra_provisionsregler() is
  'Saljchef och VD. Andrar volymtrappan och provisionssatserna. Ekonomi ser men andrar inte (bestallarbeslut 2026-08-24).';

alter table commission_bonus_level enable row level security;
alter table commission_period      enable row level security;

-- TRAPPAN AR OPPEN FOR ALLA INLOGGADE, av samma skal som `commission_rate` i
-- 0034: en progressvy som sager "3 order kvar till nasta niva" utan att
-- personen far se vad nivan ar vard ar en sifferlek. Raderna bar inga
-- personuppgifter.
drop policy if exists commission_bonus_level_read on commission_bonus_level;
create policy commission_bonus_level_read on commission_bonus_level for select
  to authenticated using (true);

-- Att manaden ar stangd ar ingen hemlighet — det ar svaret pa "varfor andrar
-- sig inte min siffra langre".
drop policy if exists commission_period_read on commission_period;
create policy commission_period_read on commission_period for select
  to authenticated using (true);

-- Ingen insert-, update- eller delete-policy. Skrivning sker uteslutande via
-- server actions med service role, som pa resten av navet.

-- -----------------------------------------------------------------------------
-- 6. Sjalvkontroll — samma sort som 0032 och 0034 avslutades med
--
-- Fragan ar databasen sjalv i stallet for att lita pa att kommandona ovan gjorde
-- det de ser ut att gora. Star nagot kvar rivs hela transaktionen.
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
    and p.proname in ('far_andra_provisionsregler')
    and has_function_privilege('anon', p.oid, 'execute');

  if kvar is not null then
    raise exception 'anon har annu execute pa: %', kvar;
  end if;
end;
$$;

-- Kontrollera att motorn faktiskt slapps in i huvudboken. Gar det har fel star
-- ett gammalt check-villkor kvar under ett namn slingan ovan inte hittade, och
-- da hade periodstangningen fallit forst i produktionen.
do $$
begin
  begin
    insert into commission_entry (employee_id, period_month, amount, source, external_ref, entered_by)
    select e.id, date '1999-01-01', 1, 'motor', 'sjalvkontroll-0035', e.id
    from employee e limit 1;
  exception when check_violation then
    raise exception 'commission_entry slapper inte in source = motor. Ett gammalt check-villkor star kvar.';
  end;

  -- Raden far inte bli kvar. `delete` nekas av triggern i 0031, sa kontrollen
  -- ligger i en savepoint som rullas tillbaka.
  raise exception using errcode = 'ZZ000', message = 'sjalvkontroll-0035-rullas-tillbaka';
exception when others then
  if sqlerrm <> 'sjalvkontroll-0035-rullas-tillbaka' then
    raise;
  end if;
end;
$$;
