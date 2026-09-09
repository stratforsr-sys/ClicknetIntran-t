-- =============================================================================
-- 0050_ordervarde_och_chefsprovision.sql — E13 steg 11.
--
-- Tre saker som inte fanns: ORDERVARDET, SALJCHEFENS OVERTACK och den sats som
-- galler nar saljchefen sjalv ar saljaren.
--
-- Regelverket beslutades av bestallaren 2026-09-09 och star utskrivet i
-- docs/PROVISION_SPEC.md avsnitt 4.5. Kort:
--
--   ORDERVARDET ar manadspriset gange avtalstiden. Ett Paket 1 pa tolv manader
--   ar vart 995 x 12 = 11 940 kr. For en order som inte foljer paketreglerna
--   skrivs vardet in for hand tillsammans med provisionen.
--
--   OVERTACKET gar till saljchefen: en procentsats pa det som blir over nar
--   saljarens provision dragits av. 11 940 - 1 500 = 10 440, och tio procent av
--   det ar 1 044 kr.
--
--   EGEN FORSALJNING. Nar saljchefen sjalv star som saljare galler varken
--   matrisen eller overtacket, utan en egen procentsats pa hela ordervardet.
--
-- VAD DEN HAR MIGRATIONEN INTE GOR
--
-- Den raknar ingenting. Ordervardet skrivs av server-actionen vid godkannandet,
-- pa samma satt som provisionen redan fryses dar, och overtacket blir en rad i
-- `order_manager_commission`. Databasen bar reglerna om vad som far sta och vad
-- som inte far andras — inte aritmetiken.
--
-- Den ror heller ingen bokford krona. `commission_entry` star orord, och augusti
-- ar stangd sedan 2026-09-08.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Ordervardet pa ordern
--
-- KOLUMNEN AR NULLBAR, OCH DET AR INTE SLARV.
--
-- `sales_order` bar en rad fran augusti (`Test AB`) som ar godkand, bokford och
-- fryst. Bestallarens beslut 2026-09-09 var att LATA DEN VARA TOM i stallet for
-- att fylla i den i efterhand. Ett `not null` hade darfor inte gatt att lagga
-- pa, och ett bakvant defaultvarde hade hittat pa ett tal at en rad ingen
-- manniska granskat.
--
-- Villkoret som kraver vardet framat star i stallet som en check LANGRE NED, och
-- den ar `not valid`: den galler varje insert och varje update fran och med nu,
-- men provar aldrig raden fran augusti. Se rubriken dar.
--
-- `order_value_source` sager VARIFRAN talet kom. Skalet ar detsamma som till att
-- `commission_source` finns: ett belopp som raknats fram ur paketet och ett som
-- nagon skrivit in ar tva olika sorters uppgift, och den dagen ett ordervarde
-- ifragasatts ar det forsta fragan.
-- -----------------------------------------------------------------------------

alter table sales_order
  add column if not exists order_value numeric(12,2),
  add column if not exists order_value_source text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sales_order_ordervarde_positivt'
  ) then
    alter table sales_order add constraint sales_order_ordervarde_positivt
      check (order_value is null or order_value >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'sales_order_ordervarde_kalla'
  ) then
    alter table sales_order add constraint sales_order_ordervarde_kalla
      check (order_value_source is null or order_value_source in ('package', 'manual'));
  end if;

  -- Vardet och dess kalla foljs at. Ett belopp utan kalla gar inte att svara pa
  -- fragan "varifran kom det", och en kalla utan belopp ar ett halvskrivet falt.
  if not exists (
    select 1 from pg_constraint where conname = 'sales_order_ordervarde_helt'
  ) then
    alter table sales_order add constraint sales_order_ordervarde_helt
      check ((order_value is null) = (order_value_source is null));
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- ORDERVARDET KRAVS FRAN OCH MED `signerad` — MEN INTE AV AUGUSTIRADEN.
--
-- `not valid` ar precis det verktyg situationen ber om, och det ar vart att
-- skriva ut varfor det inte ar en genvag:
--
--   Villkoret galler VARJE insert och VARJE update fran och med nu. En ny order
--   utan ordervarde gar alltsa inte att godkanna.
--
--   Det provar INTE de rader som redan finns. Den enda som inte uppfyller det ar
--   `Test AB`, som bestallaren beslutat ska sta tom.
--
--   Den raden gar anda inte att andra: `sales_order_stegbyte` nekar varje
--   skrivning pa en godkand order. Villkoret ar darmed inte "ovaliderat tills
--   vidare" utan ovaliderat mot en rad som ar orubblig i sig.
--
-- Ett `validate constraint` senare hade kravt att augustiraden forst fick ett
-- varde, alltsa precis det bestallaren sagt nej till. Villkoret ar meningen att
-- sta sa har.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sales_order_ordervarde_kravs'
  ) then
    alter table sales_order add constraint sales_order_ordervarde_kravs
      check (
        status in ('utkast', 'inskickad')
        or order_value is not null
      ) not valid;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. `manager` som provisionskalla
--
-- Nar saljchefen sjalv ar saljaren kommer beloppet varken ur matrisen eller ur
-- nagons handpaskrivning, utan ur en procentsats pa ordervardet. Det ar en
-- TREDJE sorts uppgift och far darfor ett eget varde — att lata den ga som
-- `manual` hade gjort en framraknad siffra oskiljbar fran en inskriven, och det
-- ar just den skillnaden `commission_source` finns for att bara.
--
-- Foljden for `sales_order_manuell_kraver_skal`: en `manager`-order kraver INGEN
-- anteckning. Skalet star i konfigurationen, inte i ett fritextfalt.
-- -----------------------------------------------------------------------------

alter table sales_order drop constraint if exists sales_order_commission_source_check;
alter table sales_order add constraint sales_order_commission_source_check
  check (commission_source is null or commission_source in ('matrix', 'manual', 'manager'));

-- En sats ur matrisen pekar pa raden den kom fran; ett handsatt belopp och ett
-- framraknat chefsbelopp gor det inte.
alter table sales_order drop constraint if exists sales_order_satskoppling;
alter table sales_order add constraint sales_order_satskoppling check (
  (commission_source = 'matrix' and commission_rate_id is not null)
  or (commission_source in ('manual', 'manager') and commission_rate_id is null)
  or commission_source is null
);

-- -----------------------------------------------------------------------------
-- 3. Satserna for saljchefen
--
-- TVA PROCENTSATSER, OCH DE MOTS ALDRIG PA SAMMA ORDER.
--
--   `override_percent`   pa det som blir over av ANDRAS order
--   `own_sale_percent`   pa hela ordervardet av HENS EGNA order
--
-- Bestallarens beslut 2026-09-09: den som far overtacket far det for att hen
-- byggt nagon annans affar. Pa en egen order finns ingen sadan insats, och da
-- galler den egna satsen i stallet — inte bada. Villkoret som garanterar det
-- ligger pa `order_manager_commission` langre ned.
--
-- EXAKT EN OPPEN MOTTAGARE. Det partiella unika indexet star pa ett KONSTANT
-- uttryck och inte pa `employee_id`, och det ar hela poangen: ett index pa
-- personen hade tillatit tva oppna rader for tva personer, och da hade samma
-- order gett overtack tva ganger. En order har en saljchef.
--
-- Att byta mottagare ar darmed samma rorelse som att andra en sats: stang den
-- gamla raden med ett `valid_to` och lagg en ny. Historiken svarar pa vem som
-- fick overtacket nar, vilket ar den fraga som stalls nar en utbetalning
-- ifragasatts.
-- -----------------------------------------------------------------------------

create table if not exists manager_commission_rate (
  id uuid primary key default gen_random_uuid(),

  -- Mottagaren. Ingen rollkontroll i schemat: rollerna sitter i
  -- `employee_role` och kan andras, medan den har raden ar historik. Kretsen som
  -- far SKRIVA raden ar dar kontrollen hor hemma.
  employee_id uuid not null references employee(id),

  override_percent numeric(5,2) not null
    check (override_percent >= 0 and override_percent <= 100),

  own_sale_percent numeric(5,2) not null
    check (own_sale_percent >= 0 and own_sale_percent <= 100),

  valid_from date not null,
  valid_to   date,

  set_by uuid references employee(id),
  set_at timestamptz not null default now(),
  note   text,

  constraint manager_commission_rate_period check (valid_to is null or valid_to > valid_from)
);

create unique index if not exists manager_commission_rate_oppen_idx
  on manager_commission_rate ((true))
  where valid_to is null;

create index if not exists manager_commission_rate_uppslag_idx
  on manager_commission_rate (valid_from desc);

comment on table manager_commission_rate is
  'Saljchefens tva satser, versionerade med valid_from/valid_to. override_percent pa restposten av andras order, own_sale_percent pa hela ordervardet av egna. Exakt en oppen rad — se det partiella unika indexet.';

-- BESTALLARENS SATSER, lamnade 2026-09-09. De ar inte gissade, och det ar
-- skillnaden mot volymtrappan i 0035 som med flit fods tom: dar fanns inga tal,
-- har finns tva.
--
-- `valid_from` ar den 1 september. September ar oppen och bar noll order i dag,
-- sa valet "galler allt intjanat denna manad" (avsnitt 8.1) ror ingenting som
-- redan hant. Augusti ligger fore och ar stangd; den nas inte harifran.
insert into manager_commission_rate (employee_id, override_percent, own_sale_percent, valid_from, note)
select e.id, 10.00, 40.00, date '2026-09-01',
       'Bestallarens satser 2026-09-09: 10 % pa restposten av andras order, 40 % pa egna.'
from employee e
where e.id = (
  select r.employee_id from employee_role r
  where r.role = 'sales_manager'
  order by r.employee_id
  limit 1
)
and not exists (select 1 from manager_commission_rate);

-- -----------------------------------------------------------------------------
-- 4. Overtacket, en rad per order
--
-- ===========================================================================
-- VARFOR EN EGEN TABELL OCH INTE TVA KOLUMNER PA `sales_order`.
--
-- `sales_order_read` i 0034 later saljaren se HELA sin egen rad. Ligger
-- overtacket dar ser Vlado att Zen fick 1 044 kr pa hans affar — och det ar
-- NAGON ANNANS ERSATTNING. 0031 drar den gransen uttryckligen: "kretsen som ser
-- ANDRAS provision ar liten".
--
-- RLS i Postgres galler rader, inte kolumner. Den enda vagen att slappa in
-- saljaren pa sin order och samtidigt halla chefens belopp utanfor ar att lagga
-- beloppet i en rad med sin egen policy. Det ar vad den har tabellen ar.
--
-- Bivinsten: raden bar hela rakningen — ordervardet, restposten, procentsatsen
-- och vilken satsrad den kom ur. Det ar avsnitt 12:s krav pa sparbarhet, och det
-- gar inte att stoppa in i tva kolumner.
-- ===========================================================================
--
-- MANADEN STAR INTE HAR. Overtacket foljer sin order: det bokfors i orderns
-- `period_month` och dras tillbaka i dess `cancel_period_month`, precis som
-- saljarens provision. En egen manadskolumn hade varit ett andra svar pa samma
-- fraga, och de tva hade forr eller senare sagt olika.
-- -----------------------------------------------------------------------------

create table if not exists order_manager_commission (
  order_id uuid primary key references sales_order(id) on delete cascade,

  manager_id uuid not null references employee(id),

  -- Underlaget, sparat sa som det raknades. Alla fyra behovs for att kunna svara
  -- pa "varfor blev det 1 044 kr" utan att rakna om nagot.
  order_value numeric(12,2) not null check (order_value >= 0),
  base        numeric(12,2) not null check (base >= 0),
  percent     numeric(5,2)  not null check (percent >= 0 and percent <= 100),
  amount      numeric(12,2) not null check (amount >= 0),

  rate_id uuid references manager_commission_rate(id),

  created_at timestamptz not null default now()
);

create index if not exists order_manager_commission_chef_idx
  on order_manager_commission (manager_id);

comment on table order_manager_commission is
  'Saljchefens overtack pa EN order, fryst vid godkannandet. Egen tabell och inte kolumner pa sales_order, eftersom saljaren ser sin orderrad men aldrig chefens ersattning. Manaden kommer ur ordern.';
comment on column order_manager_commission.base is
  'Restposten: ordervardet minus saljarens provision, aldrig under noll. Bestallarens beslut 2026-09-09.';

-- -----------------------------------------------------------------------------
-- CHEFEN FAR ALDRIG OVERTACK PA SIN EGEN ORDER.
--
-- Bestallarens beslut 2026-09-09, och det star som en trigger och inte bara i
-- koden. Skalet ar att regeln ar hela skillnaden mellan de tva satserna: den som
-- salt ordern sjalv far `own_sale_percent` pa hela vardet, och skulle overtacket
-- ocksa skrivas fick hen betalt tva ganger for samma affar.
--
-- Ett check-villkor hade inte rackt — `salesperson_id` star pa den ANDRA
-- tabellen, och en check ser bara sin egen rad.
-- -----------------------------------------------------------------------------

create or replace function public.order_manager_commission_inte_egen()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  saljare uuid;
begin
  select salesperson_id into saljare from sales_order where id = new.order_id;

  if saljare = new.manager_id then
    raise exception 'Saljchefen far inget overtack pa sin egen order. Pa en egen order galler satsen for egen forsaljning i stallet.';
  end if;

  return new;
end;
$$;

drop trigger if exists order_manager_commission_egen on order_manager_commission;
create trigger order_manager_commission_egen
  before insert or update on order_manager_commission
  for each row execute function public.order_manager_commission_inte_egen();

-- -----------------------------------------------------------------------------
-- Raden skrivs en gang och andras aldrig.
--
-- Samma linje som `commission_entry` i 0031 och den frusna provisionen i 0034,
-- och av samma skal: beloppet ar ett underlag for utbetalning. Ar det fel ar
-- vagen ut att makulera ordern — da bokfors bade saljarens provision och
-- overtacket tillbaka i makuleringsmanaden — och lagga en ny.
--
-- DELETE nekas ocksa, och den granen ar inte teoretisk trots `on delete
-- cascade`: en order som har en sadan har rad ar godkand, och
-- `sales_order_ar_last` i 0034 nekar redan radering av allt som lamnat utkast.
-- Cascaden nar alltsa aldrig hit i normalt bruk. Spärren star for de tillfallen
-- nagon staller om `session_replication_role` for att stada testdata — da ska
-- den som gor det behova stanga av bada, inte snubbla forbi den ena.
-- -----------------------------------------------------------------------------

create or replace function public.order_manager_commission_ar_last()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Ett bokfort overtack skrivs inte om. Makulera ordern och lagg en ny.';
end;
$$;

drop trigger if exists order_manager_commission_last on order_manager_commission;
create trigger order_manager_commission_last
  before update or delete on order_manager_commission
  for each row execute function public.order_manager_commission_ar_last();

-- -----------------------------------------------------------------------------
-- 5. Frysningen maste tacka de nya kolumnerna
--
-- Triggern i 0034 raknar upp de falt en godkand order inte far byta. `order_value`
-- hor dit av exakt samma skal som `commission_amount`: det ar ett tal som gar in
-- i bade chefens summering och i underlaget for overtacket, och ett varde som
-- gar att andra i efterhand gor varje summering till en gissning om nar nagon
-- tittade.
--
-- Funktionen skrivs om I SIN HELHET och inte med ett tillagg. En trigger som
-- byggs pa i sjok blir en trigger dar ingen langre ser hela listan.
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
  -- saljare, paket, belopp eller ORDERVARDE pa den i efterhand hade gjort varje
  -- summering till en gissning om nar nagon tittade.
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
       or new.commission_rate_id is distinct from old.commission_rate_id
       or new.order_value        is distinct from old.order_value
       or new.order_value_source is distinct from old.order_value_source then
      raise exception 'En godkand order skrivs inte om. Makulera den och lagg en ny.';
    end if;
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Behorighet
--
-- SATSERNA: lasbara for den krets som ser provision — saljchef, VD, ekonomi.
--
-- Det ar en ANNAN linje an `commission_rate` i 0034, som ar oppen for alla
-- inloggade, och skillnaden ar avsiktlig. Den matrisen ar villkoren for
-- SALJARENS EGEN ersattning, och en progressvy som sager "3 order kvar till
-- nasta niva" utan att personen far se vad en order ar vard ar en sifferlek.
-- Satserna har ar villkoren for NAGON ANNANS ersattning, och saljarens vy blir
-- inte en enda siffra fattigare av att de ar stangda.
--
-- ANDRAS av saljchef och VD, precis som volymtrappan. Att saljchefen satter sin
-- egen procentsats ar bestallarens uttryckliga onskan 2026-09-09 — och VD star
-- med i samma krets, sa den som vill ha en andra person pa beslutet har en.
-- -----------------------------------------------------------------------------

alter table manager_commission_rate     enable row level security;
alter table order_manager_commission    enable row level security;

drop policy if exists manager_commission_rate_read on manager_commission_rate;
create policy manager_commission_rate_read on manager_commission_rate for select
  to authenticated using (public.far_hantera_provision());

-- OVERTACKET SES AV DEN SOM FICK DET, OCH AV DEM SOM SER ANDRAS PROVISION.
--
-- Forsta grenen ar densamma som `commission_entry_read` i 0031 bar: att dolja
-- nagons egen intjaning for hen sjalv vore inte sekretess utan
-- hemlighetsmakeri. Andra grenen ar kretsen — och SALJAREN AR INTE I NAGON AV
-- DEM. Order raden galler ser hen; vad chefen tjanade pa den gor hen inte.
drop policy if exists order_manager_commission_read on order_manager_commission;
create policy order_manager_commission_read on order_manager_commission for select
  to authenticated using (
    manager_id = public.current_employee_id()
    or public.far_hantera_provision()
  );

-- Ingen insert-, update- eller delete-policy. Skrivning sker uteslutande via
-- server actions med service role, som pa resten av navet.

-- -----------------------------------------------------------------------------
-- REVOKE MASTE TA BADE `public` OCH `anon`, och det galler aven triggerfunktioner.
--
-- Triggern anropar dem med sin egen ratt, sa ingen klient BEHOVER execute — men
-- plattformens default-ACL pa schemat ger `anon` en explicit grant pa varje ny
-- funktion, inte via PUBLIC. 0027:s default-regel tar bara bort PUBLIC-vagen.
-- Det var precis den fallan 0034 foll i forsta gangen den kordes.
--
-- Raderna star FORE sjalvkontrollen nedan. Star de efter provar kontrollen ett
-- lage som annu inte intraffat och gar igenom av fel skal.
-- -----------------------------------------------------------------------------
revoke all on function public.order_manager_commission_inte_egen() from public, anon;
revoke all on function public.order_manager_commission_ar_last() from public, anon;

-- -----------------------------------------------------------------------------
-- 7. Sjalvkontroll — samma sort som 0032, 0034 och 0035 avslutades med
--
-- Fragan ar databasen sjalv i stallet for att lita pa att kommandona ovan gjorde
-- det de ser ut att gora. Star nagot kvar rivs hela transaktionen.
-- -----------------------------------------------------------------------------

do $$
declare
  kvar text;
  antal int;
begin
  -- `anon` ska inte na de nya funktionerna. Plattformens default-ACL pa schemat
  -- ger `anon` en EXPLICIT grant pa varje ny funktion — det var den fallan 0034
  -- foll i forsta gangen den kordes.
  select string_agg(p.proname, ', ')
    into kvar
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('order_manager_commission_inte_egen', 'order_manager_commission_ar_last')
    and has_function_privilege('anon', p.oid, 'execute');

  if kvar is not null then
    raise exception 'anon har annu execute pa: %', kvar;
  end if;

  -- Bada tabellerna maste ha RLS pa. En tabell med en policy men utan RLS ar
  -- oppen, och policyn ser da ut som ett skydd som inte finns.
  select count(*) into antal
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('manager_commission_rate', 'order_manager_commission')
    and not c.relrowsecurity;

  if antal > 0 then
    raise exception '% av de nya tabellerna saknar row level security.', antal;
  end if;

  -- Hogst en oppen sats. Indexet garanterar det, men kontrollen sager det med
  -- ord — och fangar den dag nagon tar bort indexet.
  select count(*) into antal from manager_commission_rate where valid_to is null;
  if antal > 1 then
    raise exception 'Fler an en oppen chefssats: %. En order har en saljchef.', antal;
  end if;
end;
$$;
