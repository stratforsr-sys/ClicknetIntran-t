-- =============================================================================
-- 0068. Avtalsslut, tillaggstjanster och fornyelse.
--
-- Bestallarens beskrivning 2026-09-24, i tre delar:
--
--   1. En order som inte foljer paketreglerna ska bara MANADSBELOPPET och
--      BINDNINGSTIDEN, inte ett framraknat ordervarde.
--   2. Navet ska saga till nar en kunds avtal narmar sig sitt slut, sa att
--      nagon hinner ringa och forlanga.
--   3. En order ska kunna bara fler tjanster an en, var och en med eget
--      belopp och antingen huvudorderns bindningstid eller en egen.
--
-- ===========================================================================
-- DET ANDRA AR HELA SKALET TILL DET FORSTA OCH TREDJE.
--
-- Manadsbeloppet och bindningstiden ar inte tva falt till i ett formular. De
-- ar de tva tal som tillsammans sager NAR AVTALET TAR SLUT, och fram till nu
-- har navet inte kunnat svara pa den fragan alls: `sales_order` bar ett
-- signeringsdatum och en lopstid, men ingen enda vy, notis eller fraga raknade
-- ut vad de betyder tillsammans. En kund vars avtal gick ut gjorde det tyst.
-- ===========================================================================
--
-- ===========================================================================
-- SLUTDATUMET RAKNAS FRAN `starts_on`, INTE FRAN `signed_on`.
--
-- Bestallarens val samma dag. Ett avtal signeras ofta innan det borjar galla —
-- driftstarten ligger nagra veckor fram, eller forlangningen tecknas medan det
-- gamla avtalet fortfarande loper. Raknades slutet fran signeringen hade
-- paminnelsen kommit for tidigt pa precis de avtal dar den spelar storst roll.
--
-- `signed_on` ror darfor ingenting av det har. Den avgor fortfarande VILKEN
-- MANAD affaren hor till och darmed nar provisionen betalas — tva olika fragor
-- som hittills delat pa ett datum eftersom ingen stallt den andra.
-- ===========================================================================
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Den arvda raden som inte tal att bli rord
--
-- ===========================================================================
-- `sales_order_ordervarde_kravs` AR `NOT VALID`, OCH DET AR INTE ETT SLARV.
--
-- 0050 la till villkoret "en godkand order maste ha ett ordervarde" och lat det
-- sta OVALIDERAT med flit: en order fran 2026-08-25 godkandes innan kolumnen
-- fanns, och bestallarens beslut var att den INTE skulle fa ett varde i
-- efterhand. `not valid` ar precis det beslutet skrivet i databasen — villkoret
-- galler allt nytt och lamnar den gamla raden i fred.
--
-- MEN: ett ovaliderat villkor provas anda vid varje UPDATE av raden. Och den
-- har migrationen maste rora varenda order, tva ganger, for att fylla
-- `starts_on` och `monthly_amount`. Forsta korningen foll pa exakt det.
--
-- Villkoret tas darfor ner over backfyllningen och satts tillbaka i samma
-- skick — `not valid` igen, inte validerat. Ett `validate constraint` har hade
-- sett ut som en uppstadning och i sjalva verket rivit bestallarens beslut.
-- ===========================================================================
-- -----------------------------------------------------------------------------

alter table sales_order drop constraint if exists sales_order_ordervarde_kravs;

-- -----------------------------------------------------------------------------
-- 1. Startdatumet
--
-- Kolumnen fylls for de order som redan finns, och da med signeringsdatumet.
-- Det ar inte sant for alla tjugotre — nagon av dem startade sakert senare —
-- men det ar det enda svaret som gar att harleda, och alternativet (lamna det
-- tomt) hade gjort varenda gammal order osynlig for bevakningen. En order som
-- bevakas nagra veckor for tidigt ar ett litet fel; en som aldrig bevakas alls
-- ar precis det bestallaren bad om att slippa.
-- -----------------------------------------------------------------------------

alter table sales_order add column if not exists starts_on date;

update sales_order set starts_on = signed_on where starts_on is null;

alter table sales_order alter column starts_on set not null;

-- Avtalet borjar inte innan det skrevs pa. Ett startdatum FORE signeringen ar
-- ett skrivfel, och skulle ge ett slutdatum som redan passerat.
alter table sales_order drop constraint if exists sales_order_start_efter_signering;
alter table sales_order add constraint sales_order_start_efter_signering
  check (starts_on >= signed_on);

comment on column sales_order.starts_on is
  'Nar avtalet borjar galla. Forval ar signeringsdatumet, men en forlangning som tecknas i forvag borjar senare. Slutdatumet raknas harifran, inte fran signed_on.';

-- -----------------------------------------------------------------------------
-- 2. Bindningstiden blir fri
--
-- ===========================================================================
-- `term_months in (12, 24, 36)` VAR ETT PAKETVILLKOR SOM STOD SOM EN SANNING
-- OM ALLA ORDER.
--
-- De tre talen ar matrisens kolumner (`commission_rate`), och for en paketorder
-- ar de fortfarande de enda giltiga — provisionen slas upp pa kombinationen
-- paket + lopstid, och en lopstid utanfor matrisen har ingen sats. Men en order
-- som uttryckligen INTE foljer paketreglerna far sitt belopp skrivet for hand,
-- och da finns inget uppslag som kan falla.
--
-- Spannet 1-60 ar inte en gissning om vad som ar rimligt utan en yttre ram:
-- noll manader ar inget avtal, och sextio ar langre an nagot av paketen. Vilka
-- lopstider som faktiskt gar att SALJA avgors av formularet och av matrisen,
-- inte av den har raden.
-- ===========================================================================
-- -----------------------------------------------------------------------------

alter table sales_order drop constraint if exists sales_order_term_months_check;
alter table sales_order drop constraint if exists sales_order_bindningstid;
alter table sales_order add constraint sales_order_bindningstid
  check (term_months between 1 and 60);

-- -----------------------------------------------------------------------------
-- 3. Manadsbeloppet
--
-- ===========================================================================
-- KOLUMNEN FINNS FOR ATT `list_price` INTE GAR ATT LITA PA I EFTERHAND.
--
-- For en paketorder star manadspriset i `sales_package.list_price` — en levande
-- kolumn som andras den dag priserna hojs. Ordervardet fryses pa ordern vid
-- godkannandet (0050), men manadsbeloppet gjorde det aldrig, och den som i
-- februari fragar vad kunden betalar per manad hade fatt februaris prislista i
-- stallet for avtalets.
--
-- Nu skrivs beloppet pa ordern for BADA sorternas order: ur paketets pris for
-- en paketorder, ur formularet for en fri. Samma linje som provisionen och
-- ordervardet foljer, och av exakt samma skal.
-- ===========================================================================
--
-- NULLBAR, som `order_value` och av samma skal: de tjugotre order som redan
-- finns kan fa ett harlett belopp men inte ett SANT — och en kolumn som ser
-- ifylld ut ar varre an en som syns vara tom. Backfyllningen nedan skriver bara
-- dar talet gar att rakna fram.
-- -----------------------------------------------------------------------------

alter table sales_order add column if not exists monthly_amount numeric(10,2)
  check (monthly_amount > 0);

update sales_order
   set monthly_amount = round(order_value / term_months, 2)
 where monthly_amount is null
   and order_value is not null
   and term_months > 0;

comment on column sales_order.monthly_amount is
  'Vad kunden betalar per manad. Fryst pa ordern som provisionen och ordervardet — list_price andras, avtalet gor det inte. Backfylld ur order_value/term_months for order fore 0068.';

-- Backfyllningen ar over. Villkoret tillbaka I SAMMA SKICK som det stod i: kvar
-- som `not valid`, sa augustiordern behaller sitt undantag. Se avsnitt 0.
alter table sales_order add constraint sales_order_ordervarde_kravs
  check (status in ('utkast', 'inskickad') or order_value is not null) not valid;

-- -----------------------------------------------------------------------------
-- 4. Slutdatumet
--
-- GENERERAD OCH INTE SKRIVEN. Talet ar en ren foljd av startdatumet och
-- bindningstiden, och en skriven kolumn hade kunnat sagt nagot annat an de tva
-- — vilket ar precis den sortens motsagelse ingen upptacker forran en kund
-- ringts for sent. Samma val som `period_month` i 0034.
--
-- `make_interval` klarar manadsskiften: 31 januari plus en manad ar 28 februari,
-- inte 3 mars. Provat mot databasen innan raden skrevs.
-- -----------------------------------------------------------------------------

alter table sales_order add column if not exists ends_on date
  generated always as ((starts_on + make_interval(months => term_months))::date) stored;

comment on column sales_order.ends_on is
  'Sista dagen avtalet loper. Raknad ur starts_on + term_months, aldrig skriven.';

-- -----------------------------------------------------------------------------
-- 5. Fornyelsen
--
-- ===========================================================================
-- UTAN UTFALLET TJATAR PAMINNELSEN VIDARE EFTER SAMTALET.
--
-- Notisen ar HARLEDD (se `notiser.ts` for halvorna): den raknas fram ur
-- raderna vid varje lasning, sa lange avtalet narmar sig sitt slut. Det ar ratt
-- halva — en paminnelse om nagot ogjort ska inte ga att glomma bort genom att
-- klicka bort den — men det betyder ocksa att NAGOT MASTE GORA SAKEN GJORD.
--
-- Utfallet ar det nagot. Tva varden, och bestallaren valde bada uttryckligen:
--
--   `forlangd`  kunden skrev pa igen. En NY order bar den nya affaren, med eget
--               startdatum, egen bindningstid och egen provision — och
--               `renewal_order_id` pekar dit. Villkoret nedan kraver pekaren:
--               en forlangning utan ny order ar ett pastaende utan affar.
--
--   `avslutad`  kunden ville inte. ORSAKEN KRAVS, och det ar hela poangen med
--               att skilja de tva: en lista over varfor kunder lamnar ar det
--               enda stallet ett monster kan visa sig.
-- ===========================================================================
-- -----------------------------------------------------------------------------

alter table sales_order add column if not exists renewal_outcome text
  check (renewal_outcome in ('forlangd', 'avslutad'));
alter table sales_order add column if not exists renewal_at timestamptz;
alter table sales_order add column if not exists renewal_by uuid references employee(id);
alter table sales_order add column if not exists renewal_reason text;
alter table sales_order add column if not exists renewal_order_id uuid references sales_order(id);

alter table sales_order drop constraint if exists sales_order_fornyelse;
alter table sales_order add constraint sales_order_fornyelse check (
  (renewal_outcome is null
     and renewal_at is null
     and renewal_by is null
     and renewal_reason is null
     and renewal_order_id is null)
  or (renewal_outcome is not null and renewal_at is not null and renewal_by is not null)
);

alter table sales_order drop constraint if exists sales_order_fornyelse_skal;
alter table sales_order add constraint sales_order_fornyelse_skal check (
  renewal_outcome is distinct from 'avslutad'
  or length(btrim(coalesce(renewal_reason, ''))) > 0
);

alter table sales_order drop constraint if exists sales_order_fornyelse_ny_order;
alter table sales_order add constraint sales_order_fornyelse_ny_order check (
  renewal_outcome is distinct from 'forlangd' or renewal_order_id is not null
);

-- En order forlanger inte sig sjalv. Utan raden gar det att peka tillbaka pa
-- samma id och fa en bevakning som ser avslutad ut utan att nagon affar finns.
alter table sales_order drop constraint if exists sales_order_fornyelse_inte_sig_sjalv;
alter table sales_order add constraint sales_order_fornyelse_inte_sig_sjalv check (
  renewal_order_id is null or renewal_order_id <> id
);

comment on column sales_order.renewal_outcome is
  'Vad som hande nar avtalet narmade sig sitt slut: forlangd (ny order finns) eller avslutad (orsak kravs). NULL = annu ohanterad, och det ar det varde bevakningen tittar pa.';

-- Bevakningens egen ingang. Predikatet ar exakt det `hamtaNotiser` fragar om,
-- sa fragan laser indexet och inte tabellen.
create index if not exists sales_order_avtalsslut_idx
  on sales_order (ends_on)
  where status in ('signerad', 'betald') and renewal_outcome is null;

-- -----------------------------------------------------------------------------
-- 6. Tillaggstjansterna
--
-- ===========================================================================
-- EN EGEN TABELL OCH INTE TRE KOLUMNER TILL, eftersom antalet ar obestamt.
--
-- Bestallaren: *"i order maste vi kunna lagga till fler tjanster"*. Fler ar
-- inte tva — det ar sa manga som affaren rakar innehalla — och en `service_1`,
-- `service_2`, `service_3` hade tagit slut vid fjarde tjansten.
--
-- FYRA FALT PER RAD, precis de som efterfragades: namn, om det ar en engangs-
-- eller manadsavgift, beloppet, och om tjansten foljer huvudorderns bindningstid
-- eller har en egen.
-- ===========================================================================
--
-- ===========================================================================
-- `follows_order` AR ETT EGET FALT OCH INTE EN KOPIERAD BINDNINGSTID.
--
-- Frestelsen var att skriva huvudorderns lopstid och startdatum rakt in pa
-- raden nar kryssrutan star i. Rakningen hade blivit densamma — men fragan
-- "foljer den har tjansten avtalet, eller har den ett eget slut?" hade inte
-- gatt att stalla efterat, och det ar just den fragan som avgor om tjansten
-- ska bevakas for sig. Tva rader med samma tal men olika mening ar inte samma
-- rad.
-- ===========================================================================
-- -----------------------------------------------------------------------------

create table if not exists sales_order_service (
  id uuid primary key default gen_random_uuid(),

  order_id uuid not null references sales_order(id) on delete cascade,

  name text not null check (length(btrim(name)) > 0),

  -- ENGANGSAVGIFT ELLER MANADSAVGIFT. Skillnaden ar inte bara nar pengarna
  -- kommer: en engangsavgift har ingen bindningstid och kan darfor aldrig
  -- loepa ut, medan en manadsavgift ar just det som ska bevakas.
  billing text not null check (billing in ('engang', 'manad')),

  -- Beloppet betyder olika saker for de tva: for `engang` ar det hela summan,
  -- for `manad` ar det vad kunden betalar per manad. Tjanstens ordervarde
  -- raknas ur de tva tillsammans — se `tjanstensVarde()` i src/lib/order.ts,
  -- som ar enda stallet den rakningen gors.
  amount numeric(10,2) not null check (amount > 0),

  -- Sant = tjansten loper precis som huvudavtalet och har inget eget slut.
  follows_order boolean not null default true,

  term_months smallint check (term_months between 1 and 60),
  starts_on date,

  ends_on date generated always as (
    case
      when term_months is null or starts_on is null then null
      else (starts_on + make_interval(months => term_months))::date
    end
  ) stored,

  -- Fornyelsen igen, med samma tva utfall och samma skal. En tjanst med EGEN
  -- bindningstid bevakas for sig (bestallarens val), och da behover den ocksa
  -- ett eget satt att bli hanterad.
  renewal_outcome text check (renewal_outcome in ('forlangd', 'avslutad')),
  renewal_at timestamptz,
  renewal_by uuid references employee(id),
  renewal_reason text,

  sort smallint not null default 0,
  created_at timestamptz not null default now(),

  -- EN ENGANGSAVGIFT HAR INGEN BINDNINGSTID. Den ar betald och over; ett
  -- slutdatum pa den hade lagt en installationsavgift i ringlistan.
  constraint tjanst_engang_utan_bindning check (
    billing <> 'engang'
    or (follows_order = false and term_months is null and starts_on is null)
  ),

  -- Foljer den huvudordern star dess egna talt tomma. Bada ifyllda ar tva svar
  -- pa samma fraga, och da vet ingen vilket som galler.
  constraint tjanst_foljer_utan_egna_tal check (
    follows_order = false or (term_months is null and starts_on is null)
  ),

  -- Och tvartom: en manadstjanst med EGEN bindningstid maste ha bada talen,
  -- annars gar slutdatumet inte att rakna och tjansten bevakas aldrig.
  constraint tjanst_egen_bindning_komplett check (
    billing <> 'manad'
    or follows_order
    or (term_months is not null and starts_on is not null)
  ),

  constraint tjanst_fornyelse check (
    (renewal_outcome is null and renewal_at is null and renewal_by is null
       and renewal_reason is null)
    or (renewal_outcome is not null and renewal_at is not null and renewal_by is not null)
  ),

  constraint tjanst_fornyelse_skal check (
    renewal_outcome is distinct from 'avslutad'
    or length(btrim(coalesce(renewal_reason, ''))) > 0
  )
);

create index if not exists sales_order_service_order_idx
  on sales_order_service (order_id, sort, created_at);

create index if not exists sales_order_service_avtalsslut_idx
  on sales_order_service (ends_on)
  where ends_on is not null and renewal_outcome is null;

comment on table sales_order_service is
  'Tillaggstjanster pa en kundorder. Engangs- eller manadsavgift, med huvudorderns bindningstid eller en egen. Vardet raknas in i orderns order_value och darmed i provisionen (bestallarbeslut 2026-09-24).';

-- -----------------------------------------------------------------------------
-- 7. Tjansterna foljer orderns egen regel, och den ar INTE "fryst vid
--    godkannande"
--
-- ===========================================================================
-- DET HAR AVSNITTET SKREVS FORST FEL, OCH FELET AR VART ATT MINNAS.
--
-- Forsta utkastet lat triggern neka varje andring av en tjanst sa fort ordern
-- var `signerad` — med 0034:s "affaren fryser vid godkannande" som forebild.
-- Den regeln FINNS INTE LANGRE. 0051 tog bort den ur `sales_order_stegbyte`
-- och satte ett periodskydd i stallet, just for att en godkand order SKA ga att
-- ratta: rattelsen bokfor skillnaden som egna poster i en oppen manad i stallet
-- for att skriva om en stangd.
--
-- En tjansterad som last sig vid godkannandet hade darfor gjort tjansterna till
-- det enda pa ordern som inte gick att ratta — och `redigeraOrder`, som raknar
-- om HELA affaren fran grunden, hade fallit pa sin egen skrivning.
--
-- Gransen gar alltsa dar orderns egen gar: vid MAKULERINGEN. En makulerad order
-- rattas inte (0051), och da rattas inte dess tjanster heller.
-- ===========================================================================
-- -----------------------------------------------------------------------------

create or replace function public.sales_order_service_fryst()
returns trigger
language plpgsql
as $$
declare
  ordern uuid;
  lage text;
begin
  ordern := coalesce(new.order_id, old.order_id);

  select status into lage from sales_order where id = ordern;

  if lage = 'makulerad' then
    raise exception 'En makulerad order rattas inte, och inte heller dess tjanster. Lagg en ny order i stallet.';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists sales_order_service_las on sales_order_service;
create trigger sales_order_service_las
  before insert or update or delete on sales_order_service
  for each row execute function public.sales_order_service_fryst();

-- -----------------------------------------------------------------------------
-- 8. Makuleringsskyddet i 0051 far kanna till manadsbeloppet
--
-- ===========================================================================
-- FUNKTIONEN NEDAN AR 0051:S, ORD FOR ORD, MED EN RAD TILLAGD.
--
-- Den ar HAMTAD UR DATABASEN och inte kopierad ur 0034. Skillnaden ar hela
-- avsnittet: 0034:s version fryser en godkand order helt, och den versionen
-- gallde fram till 0051 som skrev om funktionen. Hade den har migrationen
-- utgatt fran migrationsfilen i stallet for fran `pg_proc` hade frysningen
-- kommit tillbaka — och `redigeraOrder`, hela rattelsevagen for en godkand
-- order, hade slutat fungera utan att ett enda bygge klagat.
--
-- En `create or replace function` ar en TOTAL ersattning. Det som inte skrivs
-- med forsvinner.
-- ===========================================================================
--
-- Tillagget ar `monthly_amount` i makuleringsskyddet. Kolumnen ar en av de tva
-- faktorerna bakom `order_value`, som redan star dar — en makulerad order vars
-- manadsbelopp gick att skriva om hade haft ett ordervarde som inte langre
-- foljde av sina egna tal.
--
-- `starts_on` star INTE med, och det ar ett val: startdatumet ror inte en krona.
-- Det avgor nar avtalet tar slut, och en makulerad affar har inget slut att
-- bevaka.
-- -----------------------------------------------------------------------------

create or replace function public.sales_order_stegbyte()
returns trigger
language plpgsql
as $$
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
  -- ena halvan av ordervardet.
  if old.status = 'makulerad'
     and (new.commission_amount is distinct from old.commission_amount
          or new.order_value    is distinct from old.order_value
          or new.buyout_amount  is distinct from old.buyout_amount
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
$$;

-- -----------------------------------------------------------------------------
-- 9. Behorighet
--
-- Tjansteraden ar en del av ordern och syns for precis den som far se ordern:
-- saljaren sina egna, kretsen alla. Policyn fragar `sales_order` i stallet for
-- att upprepa villkoret — upprepat hade de tva kunnat glida isar, och da hade
-- en tjanst kunnat synas pa en order som inte gor det.
-- -----------------------------------------------------------------------------

alter table sales_order_service enable row level security;

drop policy if exists sales_order_service_read on sales_order_service;
create policy sales_order_service_read on sales_order_service for select
  to authenticated using (
    exists (
      select 1 from sales_order o
       where o.id = sales_order_service.order_id
         and (o.salesperson_id = public.current_employee_id() or public.far_hantera_order())
    )
  );

-- Ingen insert-, update- eller delete-policy. Skrivning sker via server actions
-- med service role, som pa resten av navet.

-- -----------------------------------------------------------------------------
-- 10. Sjalvkontroll
--
-- Fragan ar databasen sjalv i stallet for att lita pa att kommandona ovan gjorde
-- det de ser ut att gora. Star nagot fel rivs hela transaktionen.
-- -----------------------------------------------------------------------------

do $$
declare
  antal int;
begin
  -- Slutdatumet ska finnas pa varenda order, annars bevakas nagon aldrig.
  select count(*) into antal from sales_order where ends_on is null;
  if antal > 0 then
    raise exception '% order saknar slutdatum.', antal;
  end if;

  -- Och det ska vara raknat ur startdatumet, inte ur signeringen.
  select count(*) into antal
    from sales_order
   where ends_on <> (starts_on + make_interval(months => term_months))::date;
  if antal > 0 then
    raise exception '% order har ett slutdatum som inte foljer startdatumet.', antal;
  end if;

  -- Den fria bindningstiden ska faktiskt vara fri. En `select` bevisar
  -- ingenting — den gar lika bra med det gamla villkoret kvar. Fragan galler
  -- alltsa VILLKORET, och att det gamla ar borta.
  if exists (
    select 1 from pg_constraint
     where conrelid = 'sales_order'::regclass
       and conname = 'sales_order_term_months_check'
  ) then
    raise exception 'Den gamla lopstidsspaerren (12/24/36) star kvar.';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'sales_order'::regclass
       and conname = 'sales_order_bindningstid'
       and pg_get_constraintdef(oid) like '%term_months%'
  ) then
    raise exception 'Den nya bindningstidsramen saknas.';
  end if;

  -- Och undantaget fran 0050 ska sta kvar OVALIDERAT. Blev det validerat under
  -- vagen har augustiordern tappat sitt undantag, och det ar ett bestallarbeslut
  -- som rivits av misstag.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'sales_order'::regclass
       and conname = 'sales_order_ordervarde_kravs'
       and not convalidated
  ) then
    raise exception 'sales_order_ordervarde_kravs saknas eller har validerats. Se avsnitt 0.';
  end if;

  -- Och tjansterna ska vara stangda for den som inte far se ordern.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'sales_order_service'
       and policyname = 'sales_order_service_read'
  ) then
    raise exception 'sales_order_service saknar lasningspolicy.';
  end if;
end;
$$;
