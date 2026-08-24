-- =============================================================================
-- 0034_kundorder.sql — kundorder och paketmatrisen. E13, steg 1 av atta.
--
-- Hela regelverket star i docs/PROVISION_SPEC.md. Det har ar vad databasen
-- behover veta.
--
-- ORDER, INTE AVTAL
--
-- Bestallaren kallar det ORDER. Det ar inte en smaksak: `/avtal` och tabellen
-- `contract` i 0028 ar ANSTALLNINGSAVTAL och har ingenting med kundaffarer att
-- gora. Tva saker som bada heter avtal i samma nav blir fel for nagon.
--
-- VAD DEN HAR MIGRATIONEN INTE GOR
--
-- Den raknar ingen bonus. Volymtrappan, K&V och konsekvenserna kommer i steg
-- 3, 5 och 6. Det som byggs har ar grunden de star pa: en order med en
-- signeringsmanad, och en provisionssats som ar DATA.
--
-- Den skriver heller ingenting i `commission_entry`. Huvudboken fran 0031 ar
-- kvar som den ar; kopplingen dit gors nar perioden kan stangas (steg 3).
-- Tills dess ar ordern sanningen om vad som salts, och huvudboken sanningen om
-- vad som bokforts. Att lata dem mota varandra for tidigt hade gett tva
-- stallen som bada pastar sig veta manadens summa.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Paketen
--
-- Tre paket, och priset till kund star med. Skalet ar inte att navet ska
-- fakturera — det gor det inte — utan att den som lagger en order ska kunna se
-- att hen valt ratt rad. "Paket 2" sager ingenting; "Paket 2, 1 495 kr" gor det.
-- -----------------------------------------------------------------------------

create table if not exists sales_package (
  id         smallint primary key check (id in (1, 2, 3)),
  label      text not null check (length(btrim(label)) > 0),
  list_price numeric(10,2) not null check (list_price > 0),
  sort       smallint not null,
  active     boolean not null default true
);

insert into sales_package (id, label, list_price, sort)
select * from (values
  (1::smallint, 'Paket 1', 995.00,  1::smallint),
  (2::smallint, 'Paket 2', 1495.00, 2::smallint),
  (3::smallint, 'Paket 3', 1995.00, 3::smallint)
) as v(id, label, list_price, sort)
where not exists (select 1 from sales_package);

comment on table sales_package is
  'De tre saljbara paketen. Etiketten ar konfigurerbar (O12); priset visas som stod vid inmatning och anvands inte till nagon berakning.';

-- -----------------------------------------------------------------------------
-- 2. Provisionssatserna — nio belopp, och inget av dem far sta i en .ts-fil
--
-- AC-10.1 kraver att provisionsreglerna ar konfiguration och inte kod. Samma
-- linje som `cost_rate` i 0025 drog for arbetsgivaravgifterna, och skalet ar
-- detsamma: en sats i koden gar varken att andra utan deploy eller att visa
-- for den som ska tjana pengarna.
--
-- Versioneringen ar `valid_from` / `valid_to`, aldrig en uppdatering pa plats.
-- En andrad sats ar en ny rad, och den gamla far ett `valid_to`. Da gar det att
-- svara pa fragan "vilken sats gallde nar ordern skrevs", vilket ar precis den
-- fraga nagon staller nar en utbetalning ifragasatts.
--
-- Det partiella unika indexet garanterar EN oppen rad per paket och loptid.
-- Utan det gar det att lagga in tva galllande satser for samma sak, och da
-- avgor sorteringsordningen vad nagon far betalt.
-- -----------------------------------------------------------------------------

create table if not exists commission_rate (
  id          uuid primary key default gen_random_uuid(),
  package_id  smallint not null references sales_package(id),
  term_months smallint not null check (term_months in (12, 24, 36)),

  amount numeric(10,2) not null check (amount >= 0),

  valid_from date not null,
  valid_to   date,

  set_by uuid references employee(id),
  set_at timestamptz not null default now(),
  note   text,

  constraint commission_rate_period check (valid_to is null or valid_to > valid_from)
);

create unique index if not exists commission_rate_oppen_idx
  on commission_rate (package_id, term_months)
  where valid_to is null;

create index if not exists commission_rate_uppslag_idx
  on commission_rate (package_id, term_months, valid_from desc);

-- Bestallarens matris, lamnad 2026-08-24. Giltig fran 2026-08-01, vilket ar
-- den manad hela E13 gafller fran.
insert into commission_rate (package_id, term_months, amount, valid_from)
select * from (values
  (1::smallint, 12::smallint, 1500.00, date '2026-08-01'),
  (1::smallint, 24::smallint, 3000.00, date '2026-08-01'),
  (1::smallint, 36::smallint, 4500.00, date '2026-08-01'),
  (2::smallint, 12::smallint, 2500.00, date '2026-08-01'),
  (2::smallint, 24::smallint, 4000.00, date '2026-08-01'),
  (2::smallint, 36::smallint, 5500.00, date '2026-08-01'),
  (3::smallint, 12::smallint, 3500.00, date '2026-08-01'),
  (3::smallint, 24::smallint, 5000.00, date '2026-08-01'),
  (3::smallint, 36::smallint, 6500.00, date '2026-08-01')
) as v(package_id, term_months, amount, valid_from)
where not exists (select 1 from commission_rate);

comment on table commission_rate is
  'Provisionssatsen per paket och loptid, versionerad med valid_from/valid_to. AC-10.1: reglerna ar data, inte kod. En andring ar en ny rad.';

-- -----------------------------------------------------------------------------
-- 3. Ordern
--
-- PERIODEN KOMMER UR SIGNERINGSDATUMET, inte ur nar raden lades in och inte ur
-- nar den godkandes. Bestallarens beslut: provisionen raknas vid signering.
--
-- Kolumnen ar genererad i stallet for satt av koden. Skalet ar att en manad som
-- raknas fram pa tva stallen forr eller senare raknas fram olika — och den
-- kolumnen ar den som avgor vilken manad nagon far betalt for.
--
-- `date_trunc('month', signed_on::timestamp)` och inte `::timestamptz`:
-- varianten med tidszon ar STABLE och inte IMMUTABLE, och en genererad kolumn
-- kraver immutable. Castet till timestamp gor uttrycket zonlost, vilket ar ratt
-- har — signeringsdatumet ar ett datum, inte en tidpunkt.
-- -----------------------------------------------------------------------------

create table if not exists sales_order (
  id uuid primary key default gen_random_uuid(),

  -- Kunden. Fyra falt, precis de bestallaren bad om och inget mer.
  company_name  text not null check (length(btrim(company_name)) > 0),

  -- ORGANISATIONSNUMMER, OCH UNDANTAGET FRAN K27
  --
  -- Navet lagrar inga personnummer (K27), och `contract.variables` i 0028 nekar
  -- personnummerformade strangar rakt av. Har gar det inte att gora likadant:
  -- en ENSKILD FIRMA har personnummer som organisationsnummer, och ett villkor
  -- som nekar formatet hade nekat en fullt laglig kund.
  --
  -- Undantaget ar medvetet och star i DECISIONS.md. Foljden ar att kolumnen
  -- inte far ligga i den globala sokningen och inte i nagon lista som fler an
  -- de provisionsbehoriga ser. P0.6 registerforteckningen behover kunduppgifter
  -- som ny kategori.
  org_number    text not null check (org_number ~ '^\d{6}-?\d{4}$'),

  contact_name  text not null check (length(btrim(contact_name)) > 0),
  contact_phone text not null check (length(btrim(contact_phone)) > 0),

  -- Affaren.
  package_id  smallint not null references sales_package(id),
  term_months smallint not null check (term_months in (12, 24, 36)),

  salesperson_id uuid not null references employee(id),

  -- Framtida signering nekas. En order som signeras i nasta manad ar inte en
  -- intjaning utan en prognos, och de tva ska inte kunna blandas i samma
  -- tabell. Samma resonemang som `giltigManad` i src/lib/provision.ts.
  signed_on date not null check (signed_on >= date '2020-01-01'),

  period_month date generated always as
    (date_trunc('month', signed_on::timestamp)::date) stored,

  -- Ett tillaggsavtal pa befintlig kund. Raknas i volymtrappan (O6) och ger
  -- provision som vanligt; flaggan finns for att gruppen ska ga att folja upp.
  is_addon boolean not null default false,

  status text not null default 'utkast'
    check (status in ('utkast', 'inskickad', 'signerad', 'betald', 'makulerad')),

  -- PROVISIONEN FRYSES VID GODKANNANDE.
  --
  -- Beloppet kopieras hit ur `commission_rate` nar ordern godkanns, och
  -- triggern nedan nekar att det skrivs om. Samma linje som `contract.body_md`
  -- i 0028: dokumentet fryser malltexten, sa mallen gar att andra fritt
  -- efterat. Utan det hade en andrad sats i november tyst andrat vad nagon
  -- tjanade i augusti.
  commission_amount numeric(10,2) check (commission_amount >= 0),
  commission_source text check (commission_source in ('matrix', 'manual')),
  commission_rate_id uuid references commission_rate(id),

  note text,

  created_by uuid not null references employee(id),
  created_at timestamptz not null default now(),

  approved_by uuid references employee(id),
  approved_at timestamptz,

  -- MAKULERING SKER I MAKULERINGSMANADEN, INTE I SIGNERINGSMANADEN.
  --
  -- Bestallarens beslut. En order fran mars som makuleras i augusti river
  -- augusti. Darfor har makuleringen en EGEN manadskolumn — annars hade
  -- avdraget behovt hittas via signeringsmanaden, och den perioden ar stangd.
  cancelled_on  date,
  cancelled_by  uuid references employee(id),
  cancel_reason text,

  cancel_period_month date generated always as
    (case when cancelled_on is null then null
          else date_trunc('month', cancelled_on::timestamp)::date end) stored,

  -- Fran och med `signerad` MASTE provisionen vara satt. Innan dess far den
  -- inte vara det: ett belopp pa ett utkast ser ut som ett loste.
  constraint sales_order_provision_satt check (
    (status in ('signerad', 'betald', 'makulerad')
       and commission_amount is not null
       and commission_source is not null
       and approved_by is not null
       and approved_at is not null)
    or (status in ('utkast', 'inskickad')
       and commission_amount is null
       and commission_source is null
       and approved_by is null
       and approved_at is null)
  ),

  -- En sats ur matrisen pekar pa raden den kom fran; ett handsatt belopp gor
  -- det inte. Utan villkoret gar det att pasta att ett godtyckligt belopp kom
  -- ur matrisen.
  constraint sales_order_satskoppling check (
    (commission_source = 'matrix' and commission_rate_id is not null)
    or (commission_source = 'manual' and commission_rate_id is null)
    or commission_source is null
  ),

  -- ETT HANDSATT BELOPP KRAVER EN ANTECKNING.
  -- En avvikande provision utan skal ar det forsta nagon ifragasatter i
  -- efterhand, och da finns svaret ingenstans.
  constraint sales_order_manuell_kraver_skal check (
    commission_source <> 'manual' or length(btrim(coalesce(note, ''))) > 0
  ),

  constraint sales_order_makulering check (
    (status = 'makulerad') = (cancelled_on is not null)
  ),
  constraint sales_order_makulerad_av check (
    (cancelled_by is null) = (cancelled_on is null)
  ),
  -- En order kan inte makuleras innan den signerades.
  constraint sales_order_makulering_efterat check (
    cancelled_on is null or cancelled_on >= signed_on
  )
);

create index if not exists sales_order_saljare_idx
  on sales_order (salesperson_id, period_month desc);

create index if not exists sales_order_period_idx
  on sales_order (period_month desc) where status in ('signerad', 'betald');

create index if not exists sales_order_makulering_idx
  on sales_order (cancel_period_month desc) where status = 'makulerad';

-- Kon: det som vantar pa godkannande.
create index if not exists sales_order_ko_idx
  on sales_order (created_at) where status = 'inskickad';

comment on table sales_order is
  'Kundorder. Perioden kommer ur signeringsdatumet; provisionen fryses vid godkannande. Makulering bokfors i makuleringsmanaden, inte i signeringsmanaden. Se docs/PROVISION_SPEC.md.';

-- -----------------------------------------------------------------------------
-- 4. Stegbytena ar en trigger, inte en knapp
--
-- Samma linje som `candidate_stegbyte` i 0030: koden ritar knapparna, databasen
-- avgor. Listan star darmed pa tva stallen med flit, och provet kor hela
-- matrisen for att marka nar de glider isar.
--
-- `utkast -> inskickad -> signerad` ar saljarens vag; `utkast -> signerad` ar
-- chefens, som lagger in en fardig order sjalv. `inskickad -> utkast` ar
-- returen: chefen skickar tillbaka nagot som inte hor hemma i kon.
-- -----------------------------------------------------------------------------

create or replace function public.sales_order_stegbyte()
returns trigger
language plpgsql
as $$
declare
  tillatet boolean;
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
  -- Utan raden gar en makulering att backa genom att satta status tillbaka, och
  -- da forsvinner avdraget ur makuleringsmanaden utan spar. Ar makuleringen
  -- fel: lagg en ny order.
  if old.status = 'makulerad' and new.status is distinct from old.status then
    raise exception 'En makulerad order oppnas inte igen. Lagg en ny order i stallet.';
  end if;

  -- AFFAREN FRYSER VID GODKANNANDE.
  -- Efter `signerad` ar ordern ett underlag for utbetalning. Att kunna byta
  -- saljare, paket eller belopp pa den i efterhand hade gjort varje summering
  -- till en gissning om nar nagon tittade.
  if old.status in ('signerad', 'betald', 'makulerad') then
    if new.salesperson_id    is distinct from old.salesperson_id
       or new.package_id     is distinct from old.package_id
       or new.term_months    is distinct from old.term_months
       or new.signed_on      is distinct from old.signed_on
       or new.company_name   is distinct from old.company_name
       or new.org_number     is distinct from old.org_number
       or new.is_addon       is distinct from old.is_addon
       or new.commission_amount  is distinct from old.commission_amount
       or new.commission_source  is distinct from old.commission_source
       or new.commission_rate_id is distinct from old.commission_rate_id then
      raise exception 'En godkand order skrivs inte om. Makulera den och lagg en ny.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists sales_order_steg on sales_order;
create trigger sales_order_steg
  before update on sales_order
  for each row execute function public.sales_order_stegbyte();

-- En godkand order raderas inte. Makulering ar vagen ut, och den lamnar spar.
create or replace function public.sales_order_ar_last()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'utkast' then
    raise exception 'En order som lamnat utkast raderas inte. Makulera den i stallet.';
  end if;
  return old;
end;
$$;

drop trigger if exists sales_order_radering on sales_order;
create trigger sales_order_radering
  before delete on sales_order
  for each row execute function public.sales_order_ar_last();

-- -----------------------------------------------------------------------------
-- 5. Behorighet
--
-- Kretsen som hanterar order ar saljchef, VD och ekonomi. Saljchefen ar MED
-- har, till skillnad fran i 0031 — det ar hen som godkanner det saljarna
-- skickar in.
--
-- TEAMLEDAREN STAR UTANFOR. Bestallarens uttryckliga besked 2026-08-24.
-- -----------------------------------------------------------------------------

create or replace function public.far_hantera_order()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_any_role(array['sales_manager','ceo','finance'])
$$;

-- -----------------------------------------------------------------------------
-- REVOKE MASTE TA BADE `public` OCH `anon`. 0027 RACKER INTE.
--
-- 0027 la in `alter default privileges in schema public revoke execute on
-- functions from public` och skrev att nasta funktion darmed ar stangd for
-- klienten som standard. Det ar bara halva sanningen, och den halvan fallde den
-- har migrationen forsta gangen den kordes (2026-08-25).
--
-- Supabase har en EGEN default-ACL pa schemat, satt av `supabase_admin`:
--
--   public | {postgres=X/..., anon=X/..., authenticated=X/..., service_role=X/...}
--
-- Den ger `anon` en EXPLICIT grant pa varje ny funktion — inte via PUBLIC. Ett
-- revoke fran PUBLIC ror den alltsa inte, och 0027:s default-regel tar bara bort
-- PUBLIC-vagen. Bagge maste namnas.
--
-- Det ar samma sorts falla som 0027 och 0032 beskriver, men i andra riktningen:
-- dar var problemet en grant som fanns UTAN att vara utskriven, har ar det en
-- grant som skrivs ut av plattformen bakom ryggen pa migrationen.
--
-- Kontrollen langst ned i filen ar det som fangade det. Skriv en ny funktion och
-- glom `anon` har, sa faller migrationen i stallet for att slappa in nagon.
-- -----------------------------------------------------------------------------
revoke all on function public.far_hantera_order() from public, anon;
grant execute on function public.far_hantera_order() to authenticated, service_role;

-- Saljchefen far ocksa se provisionen. Bestallarens beslut 2026-08-24: den som
-- bedomer K&V maste kunna se vad bonusen blev. Ekonomi och VD hade den sedan
-- 0031; teamledaren har den fortfarande inte.
create or replace function public.far_hantera_provision()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_any_role(array['finance','ceo','sales_manager'])
$$;

-- `create or replace` BEHALLER den befintliga ACL:en, sa den har raden andrar
-- ingenting i dag — 0032 stangde funktionen redan. Den star kvar for att en
-- framtida `drop`/`create` av samma funktion annars tyst hade fatt tillbaka
-- anon-granten ur plattformens default-ACL.
revoke all on function public.far_hantera_provision() from public, anon;
grant execute on function public.far_hantera_provision() to authenticated, service_role;

alter table sales_package  enable row level security;
alter table commission_rate enable row level security;
alter table sales_order     enable row level security;

-- PAKETEN OCH SATSERNA AR OPPNA FOR ALLA INLOGGADE, OCH DET AR AVSIKTLIGT.
-- Satsen ar villkoren for saljarens egen ersattning. En progressvy som sager
-- "3 order kvar till nasta niva" utan att personen far se vad en order ar vard
-- ar en sifferlek. Raderna bar inga personuppgifter.
drop policy if exists sales_package_read on sales_package;
create policy sales_package_read on sales_package for select
  to authenticated using (true);

drop policy if exists commission_rate_read on commission_rate;
create policy commission_rate_read on commission_rate for select
  to authenticated using (true);

-- Saljaren ser sina egna order. Kretsen ovan ser alla.
drop policy if exists sales_order_read on sales_order;
create policy sales_order_read on sales_order for select
  to authenticated using (
    salesperson_id = public.current_employee_id()
    or public.far_hantera_order()
  );

-- Ingen insert-, update- eller delete-policy. Skrivning sker uteslutande via
-- server actions med service role, som pa resten av navet.

comment on function public.far_hantera_order() is
  'Saljchef, VD och ekonomi. Godkanner och makulerar order. Teamledaren star utanfor (bestallarbeslut 2026-08-24).';

-- -----------------------------------------------------------------------------
-- 6. Sjalvkontroll — samma sort som 0032 avslutades med
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
    and p.proname in ('far_hantera_order', 'far_hantera_provision')
    and has_function_privilege('anon', p.oid, 'execute');

  if kvar is not null then
    raise exception 'anon har annu execute pa: %', kvar;
  end if;
end;
$$;
