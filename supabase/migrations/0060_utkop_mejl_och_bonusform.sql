-- =============================================================================
-- 0060: utkop pa affaren, kundens mejl, och bonusen som kronor PER ORDER
--
-- Fyra saker bestallaren bad om 2026-09-15, och de hanger ihop pa ett satt som
-- ar vart att skriva ut: alla fyra handlar om att det som STAR i navet ska vara
-- det som FAKTISKT gallde for affaren.
--
--   UTKOP. "Ibland tar vi fran ordervardet och koper ut kunder med det." Da ar
--   affaren inte vard vad paketet sager, och saljarens provision ska raknas pa
--   det som blir kvar — 12 % pa nettot.
--
--   MEJL. Kunden har en mejladress. Den fanns inte i navet, sa den lag i nagons
--   inkorg i stallet.
--
--   ANTECKNINGEN SLUTAR VARA OBLIGATORISK. Se avsnitt 3.
--
--   BONUSEN AR KRONOR PER ORDER. Se avsnitt 5. Ingen schemaandring — en
--   konfigurationsrad som stod pa fel form och betalade ut 200 kr dar 1 200 kr
--   var avsett.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Kundens mejladress
--
-- NULLBAR, OCH DET AR INTE SLARV. Varje order som lades fore i dag saknar
-- adress och far ingen i efterhand — samma linje som `order_value` tog i 0050.
-- Ett `not null` hade krävt en pahittad adress pa nio riktiga affarer.
--
-- KONTROLLEN AR AVSIKTLIGT TILLATANDE: nagot fore ett @, nagot efter, ingen
-- blank. En strangare regel nekar riktiga adresser (plustecken, underdoman,
-- nya toppdomaner) och vinner ingenting — navet skickar inga brev hit, det
-- ar en uppgift om kunden.
-- -----------------------------------------------------------------------------

alter table sales_order
  add column if not exists contact_email text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sales_order_mejlform'
  ) then
    alter table sales_order add constraint sales_order_mejlform
      check (contact_email is null or contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');
  end if;
end;
$$;

comment on column sales_order.contact_email is
  'Kundens mejladress. Nullbar: order fran fore 2026-09-15 har ingen och far ingen i efterhand.';

-- -----------------------------------------------------------------------------
-- 2. Utkopet
--
-- ===========================================================================
-- UTKOPET AR EN AVDRAGSPOST PA AFFAREN, INTE ETT LAGRE ORDERVARDE.
--
-- Frestelsen ar att bara skriva in ett lagre ordervarde for hand och vara klar.
-- Det gar, och det ar fel av tva skal:
--
--   AVTALET SAGER BRUTTOT. Kunden har tecknat 995 kr i tolv manader. Skrivs
--   15 000 kr i stallet for 11 940 minus 5 000 star det ingenstans att en
--   utkopspost finns, och den dag nagon jamfor navet med avtalet stammer inget.
--
--   UTKOPEN GAR ATT RAKNA IHOP. En egen kolumn svarar pa "hur mycket av
--   septembers ordervolym gick till att kopa ut kunder". Ett handsatt
--   ordervarde svarar inte pa nagot alls.
--
-- Darfor: `order_value` fortsatter vara vad affaren ar vard BRUTTO, och
-- `buyout_amount` star bredvid. Nettot raknas fram — det lagras inte, eftersom
-- ett lagrat netto ar ett tredje tal som kan saga emot de tva andra.
-- ===========================================================================
--
-- `> 0` och inte `>= 0`: ett utkop pa noll kronor ar inget utkop, och en nolla
-- i kolumnen hade last som "vi kopte ut kunden for ingenting". Finns inget
-- utkop ar kolumnen NULL. Samma skillnad som `order_value` gor mellan
-- "ordervardet ar noll" och "ordervardet ar inte ifyllt".
-- -----------------------------------------------------------------------------

alter table sales_order
  add column if not exists buyout_amount numeric(12,2);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sales_order_utkop_positivt'
  ) then
    alter table sales_order add constraint sales_order_utkop_positivt
      check (buyout_amount is null or buyout_amount > 0);
  end if;

  -- ETT UTKOP STORRE AN AFFAREN AR ETT SKRIVFEL, och nekas har i stallet for
  -- att bli en negativ provision langre fram.
  --
  -- `order_value is null` slapps igenom med flit. Ett UTKAST och en INSKICKAD
  -- order har annu inget ordervarde — det raknas fram och fryses forst vid
  -- godkannandet (0050) — men saljaren vet redan nar hen skickar in att affaren
  -- bar ett utkop. Ett villkor som krävde bada hade tvingat hen att utelamna
  -- uppgiften, och da hade den fatt fyllas i av nagon som inte var med.
  --
  -- Nar ordern godkanns finns bada talen: `sales_order_ordervarde_kravs` i 0050
  -- nekar en godkand order utan varde, och da biter raden nedan.
  if not exists (
    select 1 from pg_constraint where conname = 'sales_order_utkop_ryms'
  ) then
    alter table sales_order add constraint sales_order_utkop_ryms
      check (
        buyout_amount is null
        or order_value is null
        or buyout_amount <= order_value
      );
  end if;
end;
$$;

comment on column sales_order.buyout_amount is
  'Utkop av kunden, betalt ur ordervardet. NULL nar inget utkop finns. Nettot (order_value - buyout_amount) ar basen for saljarens provision och for saljchefens overtack.';

-- -----------------------------------------------------------------------------
-- 3. `buyout` som provisionskalla — och anteckningen slutar vara obligatorisk
--
-- ===========================================================================
-- EN FJARDE SORTS UPPGIFT, OCH DEN FAR ETT EGET VARDE.
--
--   matrix   beloppet kom ur paketmatrisen
--   manual   nagon skrev in det
--   manager  procent pa ordervardet, saljchefens egen order
--   buyout   procent pa NETTOT efter utkopet
--
-- Samma resonemang som 0050 forde for `manager`: att lata en framraknad siffra
-- ga som `manual` gor den oskiljbar fran en inskriven, och det ar just den
-- skillnaden `commission_source` finns for att bara.
-- ===========================================================================
--
-- ---------------------------------------------------------------------------
-- ANTECKNINGSKRAVET FALLER. Bestallarens besked 2026-09-15.
--
-- `sales_order_manuell_kraver_skal` kom till i 0034 med motiveringen att "en
-- avvikande provision utan skal ar det forsta nagon ifragasatter i efterhand".
-- Motiveringen ar fortfarande sann. Villkoret var anda fel verktyg, och det
-- visade sig pa ett satt ingen forutsag:
--
-- Kravet slog till NAR KNAPPEN TRYCKTES, efter att hela formularet fyllts i.
-- Serveranropet kom tillbaka med ett fel, React aterstallde formularet, och
-- SIGNERINGSDATUMET foll tillbaka pa dagens datum. En order som skulle legat i
-- augusti hamnade i september utan att nagon sag det ske. Kravet pa en
-- anteckning kostade alltsa en RIKTIG uppgift — manaden affaren hor till —
-- for att skydda en frivillig.
--
-- Anteckningen finns kvar som falt och star kvar i loggen. Den ar bara inte
-- langre en sparr. Sparbarheten bars anda av `audit_log`, som sedan 0034 bar
-- bade belopp och kalla pa varje godkannande, och av `commission_source` som
-- sager RAKT UT att beloppet ar handsatt.
-- ---------------------------------------------------------------------------

alter table sales_order drop constraint if exists sales_order_commission_source_check;
alter table sales_order add constraint sales_order_commission_source_check
  check (commission_source is null
         or commission_source in ('matrix', 'manual', 'manager', 'buyout'));

-- En sats ur matrisen pekar pa raden den kom fran; allt annat gor det inte.
alter table sales_order drop constraint if exists sales_order_satskoppling;
alter table sales_order add constraint sales_order_satskoppling check (
  (commission_source = 'matrix' and commission_rate_id is not null)
  or (commission_source in ('manual', 'manager', 'buyout') and commission_rate_id is null)
  or commission_source is null
);

alter table sales_order drop constraint if exists sales_order_manuell_kraver_skal;

-- -----------------------------------------------------------------------------
-- 4. Satsen for utkopsaffarer
--
-- EN PROCENTSATS, VERSIONERAD, I EN EGEN TABELL — inte ett tal i koden.
--
-- AC-10.1 igen: provisionsreglerna ar konfiguration. Skalet ar praktiskt och
-- har konkret: bestallaren sa 12 % den 15 september. Sags 14 % i november ska
-- november bli 14 % och september fortsatta vara 12 %, utan deploy och utan att
-- nagon behover minnas vad som gallde. Uppslaget sker pa ORDERNS
-- SIGNERINGSDATUM, precis som `commission_rate` och `manager_commission_rate` —
-- se `gallandeUtkopssats` i `src/lib/utkop.ts`.
--
-- EN OPPEN RAD, som `manager_commission_rate`. Indexet star pa ett konstant
-- uttryck: satsen galler alla saljare, sa tva oppna rader vore tva svar pa
-- samma fraga.
--
-- LASBAR FOR ALLA INLOGGADE, till skillnad fran chefssatsen. Det ar SALJARENS
-- EGEN sats — den som lagger en order med utkop ska se vad affaren ger innan
-- hen trycker. Samma linje som `commission_rate_read` i 0034 tog, och av samma
-- skal: en progressvy som doljer vad en order ar vard ar en sifferlek.
-- -----------------------------------------------------------------------------

create table if not exists buyout_commission_rate (
  id uuid primary key default gen_random_uuid(),

  percent numeric(5,2) not null check (percent >= 0 and percent <= 100),

  valid_from date not null,
  valid_to   date,

  set_by uuid references employee(id),
  set_at timestamptz not null default now(),
  note   text,

  constraint buyout_commission_rate_period check (valid_to is null or valid_to > valid_from)
);

create unique index if not exists buyout_commission_rate_oppen_idx
  on buyout_commission_rate ((true))
  where valid_to is null;

create index if not exists buyout_commission_rate_uppslag_idx
  on buyout_commission_rate (valid_from desc);

comment on table buyout_commission_rate is
  'Saljarens procentsats pa nettot av en affar med utkop, versionerad med valid_from/valid_to. Exakt en oppen rad — se det partiella unika indexet.';

-- BESTALLARENS SATS, lamnad 2026-09-15. Den ar inte gissad, och det ar
-- skillnaden mot volymtrappan i 0035 som med flit foddes tom.
--
-- `valid_from` ar den 1 september: september ar oppen och bar inga utkop i dag,
-- sa raden ror ingenting som redan hant. Augusti ligger fore och ar faststalld;
-- den nas inte harifran.
insert into buyout_commission_rate (percent, valid_from, note)
select 12.00, date '2026-09-01',
       'Bestallarens sats 2026-09-15: 12 % till saljaren pa det som ar kvar av affaren efter utkopet.'
where not exists (select 1 from buyout_commission_rate);

-- -----------------------------------------------------------------------------
-- 5. Volymbonusen stod pa fel form
--
-- ===========================================================================
-- INGEN SCHEMAANDRING. EN KONFIGURATIONSRAD SOM BETALADE FEL.
--
-- Trappan har tre former sedan 0035: `amount_fixed` (ett engangsbelopp nar
-- nivan nas), `percent` (pa manadens grundprovision) och `amount_per_order`
-- (kronor per order, retroaktivt pa samtliga). Formularet i /provision/regler
-- har `amount_fixed` som forvalt varde, och samtliga fyra nivaer lades in pa
-- det.
--
-- Utfallet: en saljare med sex godkanda order i september fick 200 kr i bonus.
-- Avsett var 200 kr PER AFFAR, alltsa 1 200 kr. Skillnaden syns inte i vyn —
-- den sager "Volymbonus niva 5, 6 order" i bada fallen — och den upptacktes
-- forst nar nagon raknade efter.
--
-- Bestallarens besked 2026-09-15: samtliga fyra nivaer ar kronor per order.
--   5 order  -> 200 kr per order
--  10 order  -> 500 kr per order
--  15 order  -> 1 000 kr per order
--  20 order  -> 1 200 kr per order
--
-- RATTELSEN GORS SOM EN VANLIG TRAPPANDRING, inte som ett `update`. Raden som
-- gallde far ett `valid_to` och en ny rad tar vid — exakt vad `sparaNiva` i
-- `provision/regler/actions.ts` gor, och av samma skal: fragan "vilken trappa
-- gallde i augusti" ska ha ett svar aven efter den har migrationen.
--
-- `valid_from` ar den 1 september, alltsa bestallarens val "galler allt
-- intjanat denna manad" (avsnitt 8.1). September ar oppen, sa manaden raknas om
-- live. AUGUSTI RORS INTE — den ar faststalld och bokford, och trappan laser
-- den inte langre.
--
-- En rad som redan borjar den 1 september TAS BORT i stallet for att stangas:
-- noll dagars giltighet ar inte historik utan ett skrivfel, och
-- `commission_bonus_level_period` nekar den anda.
-- ===========================================================================

do $$
declare
  v_datum  date := date '2026-09-01';
  v_satt   uuid;
  v_ids    uuid[];
  v_id     uuid;
  r        record;
begin
  -- Den som satte trappan senast far sta som avsandare aven for rattelsen.
  -- Kolumnen ar nullbar, sa en tom databas ger null och inte ett fel.
  select set_by into v_satt
  from commission_bonus_level
  where set_by is not null
  order by set_at desc
  limit 1;

  -- Raderna plockas ut FORE nagon rors. En cursor som loper samtidigt som
  -- raderna den laser skrivs om ar en felkalla som inte behover finnas.
  select array_agg(id) into v_ids
  from commission_bonus_level
  where valid_to is null
    and unit <> 'amount_per_order';

  if v_ids is null then
    raise notice 'Alla oppna bonusnivaer star redan som kronor per order — ingenting att gora.';
    return;
  end if;

  foreach v_id in array v_ids loop
    select id, threshold, amount, valid_from into r
    from commission_bonus_level where id = v_id;

    if r.valid_from > v_datum then
      raise exception
        'Niva % borjar galla %, alltsa efter %. Ta bort den raden for hand forst.',
        r.threshold, r.valid_from, v_datum;
    elsif r.valid_from = v_datum then
      delete from commission_bonus_level where id = r.id;
    else
      update commission_bonus_level set valid_to = v_datum where id = r.id;
    end if;

    insert into commission_bonus_level (threshold, amount, unit, valid_from, set_by, note)
    values (r.threshold, r.amount, 'amount_per_order', v_datum, v_satt,
            'Bestallarens besked 2026-09-15: bonusen ar kronor PER ORDER, inte ett engangsbelopp nar nivan nas.');
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Utkopet foljer med i skyddet av en makulerad order
--
-- `sales_order_stegbyte` fran 0051 nekar att en MAKULERAD orders pengar rors:
-- den bar tva bokforingar i tva manader och en andring skulle behova rattas mot
-- bada. `buyout_amount` ar nu ett av de tal som avgor provisionen, sa den hor
-- till samma lista. Utan raden hade ett utkop gatt att skriva in i efterhand pa
-- en makulerad order och tyst andrat vad tva stangda manader borde ha sagt.
--
-- Funktionen skrivs om i sin helhet. En `create or replace` som bara lagger
-- till en rad ser ut som mindre an den ar; det ar hela beteendet som star har.
-- -----------------------------------------------------------------------------

create or replace function public.sales_order_stegbyte()
returns trigger
language plpgsql
set search_path = public, pg_temp
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
  -- provisionen.
  if old.status = 'makulerad'
     and (new.commission_amount is distinct from old.commission_amount
          or new.order_value    is distinct from old.order_value
          or new.buyout_amount  is distinct from old.buyout_amount
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

revoke all on function public.sales_order_stegbyte() from public, anon;

-- -----------------------------------------------------------------------------
-- 7. RLS
--
-- Satsen lases av alla inloggade; skrivning sker uteslutande via server actions
-- med service role, som pa resten av navet.
-- -----------------------------------------------------------------------------

alter table buyout_commission_rate enable row level security;

drop policy if exists buyout_commission_rate_read on buyout_commission_rate;
create policy buyout_commission_rate_read on buyout_commission_rate for select
  to authenticated using (true);

-- -----------------------------------------------------------------------------
-- 8. Sjalvkontroll — samma sort som 0034, 0035 och 0050 avslutades med
--
-- Fragan ar databasen sjalv i stallet for att lita pa att kommandona ovan gjorde
-- det de ser ut att gora. Star nagot fel rivs hela transaktionen.
-- -----------------------------------------------------------------------------

do $$
declare
  antal int;
begin
  -- Anteckningskravet ska vara borta.
  if exists (select 1 from pg_constraint where conname = 'sales_order_manuell_kraver_skal') then
    raise exception 'sales_order_manuell_kraver_skal star kvar.';
  end if;

  -- `buyout` ska vara en giltig kalla.
  if not exists (
    select 1 from pg_constraint
    where conname = 'sales_order_commission_source_check'
      and pg_get_constraintdef(oid) like '%buyout%'
  ) then
    raise exception 'commission_source tar inte emot buyout.';
  end if;

  -- Exakt en oppen utkopssats.
  select count(*) into antal from buyout_commission_rate where valid_to is null;
  if antal <> 1 then
    raise exception 'Det finns % oppna utkopssatser, ska vara exakt en.', antal;
  end if;

  -- Ingen oppen bonusniva far sta pa nagot annat an kronor per order.
  select count(*) into antal
  from commission_bonus_level
  where valid_to is null and unit <> 'amount_per_order';
  if antal <> 0 then
    raise exception '% oppna bonusnivaer star fortfarande pa fel form.', antal;
  end if;

  -- RLS pa den nya tabellen.
  if not exists (
    select 1 from pg_class where relname = 'buyout_commission_rate' and relrowsecurity
  ) then
    raise exception 'buyout_commission_rate saknar row level security.';
  end if;
end;
$$;
