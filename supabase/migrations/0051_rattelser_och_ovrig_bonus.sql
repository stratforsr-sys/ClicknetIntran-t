-- =============================================================================
-- 0051_rattelser_och_ovrig_bonus.sql — E13 steg 12.
--
-- Tva saker bestallaren bad om 2026-09-09, samma dag som 0050:
--
--   EN GODKAND ORDER SKA GA ATT RATTA. I dag nekar `sales_order_stegbyte` varje
--   andring efter godkannandet, och svaret ar "makulera och lagg en ny" — vilket
--   lamnar ett minusbelopp i makuleringsmanaden for en affar som ar fullt
--   giltig. Det ar fel svar pa "jag valde fel paket".
--
--   OVRIG BONUS SKA GA ATT LAGGA, bade pa en enskild affar och fritt pa en
--   person och manad. Avsnitt 5.3 har alltid beskrivit den; det som fanns var
--   `bokforProvision`, en fri post utan slag, utan skalkrav och utan koppling
--   till nagon order.
--
-- ===========================================================================
-- VAD SOM INTE ANDRAS, OCH DET AR DET VIKTIGASTE I HELA FILEN
--
-- `commission_entry` ar och forblir APPEND-ONLY. Triggern fran 0031 star kvar
-- orord. En bokford krona skrivs aldrig om, och en rattelse ar en NY post med
-- motsatt tecken.
--
-- Det ar hela skalet till att en order gar att rätta utan att historien blir
-- osann: ordern ar ett UNDERLAG, huvudboken ar BOKFORINGEN. Andras underlaget
-- for en manad som redan ar stangd bokfors skillnaden i innevarande manad, och
-- den stangda manaden star kvar och sager exakt vad som betalades ut da.
--
-- Bestallarens val 2026-09-09 bland tre alternativ. Det tredje — att skriva om
-- huvudboken — avvisades med skalet att lonespecen for augusti da hade sagt ett
-- tal och navet ett annat, utan att nagon kunde se vilket som stamde.
-- ===========================================================================
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Huvudboken far veta VAD en post ar
--
-- ===========================================================================
-- DEN HAR KOLUMNEN AR PRECIS DEN SOM `slagetFor()` FORUTSAG.
--
-- Kommentaren i `src/lib/provision.ts` sager: *"NAR DEN HAR FUNKTIONEN SLUTAR
-- RACKA ar den dag nagon behover FRAGA pa slaget i SQL, for det gar inte att
-- indexera bakvant ur en strang. Da ar kolumnen ratt, och den fylls ur den har
-- funktionen."*
--
-- Dagen kom av ett annat skal an det forutsedda. Slaget lastes ur
-- `external_ref`, som bara MOTORNS poster har — en handinmatad post har
-- `external_ref = null` och blev darfor alltid "Bokfort for hand". Det dugde sa
-- lange handinmatning var en enda sorts sak. Nu blir den tva: en OVRIG BONUS och
-- en RATTELSE, och de ska ga att skilja at i vyn, i underlaget till
-- lonekorningen och i summeringen per slag.
--
-- Kolumnen fylls bakvant ur exakt den strang funktionen laste, sa inget varde
-- ar pahittat.
-- ===========================================================================
-- -----------------------------------------------------------------------------

alter table commission_entry add column if not exists kind text;

-- ---------------------------------------------------------------------------
-- INGEN BAKATFYLLNING, OCH DET AR ETT BESLUT — INTE EN GENVAG.
--
-- Forsta utkastet hade ett `update commission_entry set kind = split_part(...)`.
-- Det FOLL, och det foll pa ratt trigger: `commission_entry_ar_last` fran 0031
-- nekar varje update pa huvudboken. *"En provisionspost skrivs inte om."*
--
-- Vagen forbi hade funnits — `disable trigger`, eller
-- `session_replication_role = 'replica'` som testdatan stades med 2026-09-07.
-- Men fragan ar inte OM det gar utan om det BEHOVS, och det gor det inte:
-- `slagetFor()` laser redan slaget ur `external_ref` nar kolumnen ar tom. Den
-- fallbacken star kvar och tacker varenda post som fanns fore den har
-- migrationen.
--
-- Alltsa: NYA poster far `kind` skrivet av koden. GAMLA behaller null och lases
-- som forut. Inte en enda bokford rad rors av den har filen, vilket ar en
-- starkare egenskap an en ifylld kolumn.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'commission_entry_slag') then
    alter table commission_entry add constraint commission_entry_slag check (
      kind is null or kind in (
        'order', 'makulering', 'volymbonus', 'kv_bonus', 'ovrig_bonus', 'avdrag',
        'chefsprovision', 'chefsprovision_makulering', 'rattelse'
      )
    );
  end if;

  -- EN OVRIG BONUS UTAN SKAL FAR INTE FINNAS. Avsnitt 5.3: "ett fritt
  -- kronbelopp med OBLIGATORISK anteckning". Skalet ar detsamma som for en
  -- handsatt provision (`sales_order_manuell_kraver_skal` i 0034): ett belopp
  -- nagon bestamt sjalv ar det forsta som ifragasatts i efterhand, och da finns
  -- svaret ingenstans.
  --
  -- Villkoret ar `not valid`: de handinmatade poster som redan finns har inget
  -- `kind` och ror det darfor inte, men de kan heller inte fa ett i efterhand
  -- utan att uppfylla det.
  if not exists (select 1 from pg_constraint where conname = 'commission_entry_bonus_kraver_skal') then
    alter table commission_entry add constraint commission_entry_bonus_kraver_skal check (
      kind is distinct from 'ovrig_bonus' or length(btrim(coalesce(note, ''))) > 0
    ) not valid;
  end if;
end;
$$;

comment on column commission_entry.kind is
  'Vad posten ar. NULL for varje post som fanns fore 0051 — de laser sitt slag ur external_ref som forut, och huvudboken rors aldrig. Se slagetFor() i src/lib/provision.ts.';

-- -----------------------------------------------------------------------------
-- 2. En bonus kan hanga pa en affar
--
-- NULLBAR MED FLIT. Bestallarens svar 2026-09-09 var "bade per affar och per
-- manad": en bonus for en sarskilt svar upphandling hor till sin order, en
-- bonus for manadens basta insats hor inte till nagon.
--
-- `on delete set null` och inte `cascade`: ordern kan i teorin raderas medan den
-- annu ar ett utkast, och bonusen ar da fortfarande utbetalda pengar. Att lata
-- den folja med hade raderat en post ur en append-only huvudbok genom bakvagen.
-- I praktiken nar cascaden aldrig hit — en order med en bonus pa sig ar godkand,
-- och `sales_order_ar_last` nekar radering av allt som lamnat utkast — men en
-- referentiell atgard ska sta ratt aven i det fall den inte intraffar.
-- -----------------------------------------------------------------------------

alter table commission_entry
  add column if not exists sales_order_id uuid references sales_order(id) on delete set null;

create index if not exists commission_entry_order_idx
  on commission_entry (sales_order_id) where sales_order_id is not null;

comment on column commission_entry.sales_order_id is
  'Affaren posten hor till, nar den hor till en. Null for poster som galler manaden i stort.';

-- -----------------------------------------------------------------------------
-- 3. Frysningen byts mot ett PERIODSKYDD
--
-- ===========================================================================
-- DET HAR AR PASSETS STORSTA ANDRING, OCH DEN SNAVAR IN SKYDDET DIT DET BEHOVS.
--
-- Triggern i 0034 raknade upp elva kolumner som inte fick andras efter
-- godkannandet — saljare, paket, loptid, datum, kunduppgifter, belopp. Skalet
-- var riktigt: *"att kunna byta saljare, paket eller belopp pa den i efterhand
-- hade gjort varje summering till en gissning om nar nagon tittade."*
--
-- Men det skyddet var for brett. En summering blir en gissning bara nar det
-- redan FINNS en bokford summa att motsaga — alltsa i en STANGD period. I en
-- oppen manad ar ingenting bokfort, allt raknas live ur orderna, och en rattelse
-- andrar da ett tal som anda inte betalats ut till nagon.
--
-- DET SOM ISTALLET SKYDDAS AR PERIODENS INTEGRITET, och det ar tva regler:
--
--   1. En order i en STANGD manad far inte byta manad. Skulle den flytta ut
--      skulle den stangda manaden ha bokfort en order som inte langre finns dar,
--      och den bokforingen gar inte att skriva om.
--
--   2. Ingen order far flytta IN i en stangd manad. Det ar samma sak sett fran
--      andra hallet, och det ar ocksa O11: en stangd period kan inte ta emot en
--      order, for `faststallPeriod` vagrar kora om en manad som redan ar stangd.
--
-- Pengarna i det forsta fallet — nar en order i en stangd manad rattas — hanteras
-- av `redigeraOrder` i `order/actions.ts`, som bokfor skillnaden som en
-- RATTELSEPOST i innevarande manad. Databasen kan inte gora den rakningen, och
-- ska inte forsoka; den halva som ar dess ar att manaden aldrig glider.
-- ===========================================================================
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
  -- Utan raden gar en makulering att backa genom att satta status tillbaka, och
  -- da forsvinner avdraget ur makuleringsmanaden utan spar. Ar makuleringen
  -- fel: lagg en ny order.
  if old.status = 'makulerad' and new.status is distinct from old.status then
    raise exception 'En makulerad order oppnas inte igen. Lagg en ny order i stallet.';
  end if;

  -- EN MAKULERAD ORDER RATTAS INTE HELLER.
  -- Den bar tva bokforingar i tva manader — tillagget i signeringsmanaden och
  -- avdraget i makuleringsmanaden — och en andring skulle behova rattas mot bada.
  -- Vill man ha en annan affar: lagg en ny order.
  if old.status = 'makulerad'
     and (new.commission_amount is distinct from old.commission_amount
          or new.order_value    is distinct from old.order_value
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
-- 4. Overtacket foljer sin order och maste darfor kunna rattas
--
-- ===========================================================================
-- APPEND-ONLY FLYTTAS INTE HIT, DEN LIGGER KVAR DAR DEN HOR HEMMA.
--
-- `order_manager_commission_ar_last` skrevs i 0050 med motiveringen att
-- beloppet ar "ett underlag for utbetalning". Det ar sant — men det ar samma
-- sorts underlag som `sales_order.commission_amount`, inte samma sort som
-- `commission_entry`. Skillnaden:
--
--   `sales_order` och `order_manager_commission` beskriver AFFAREN SOM DEN AR.
--   Rattas affaren ska de folja med, annars ljuger de om vad som salts.
--
--   `commission_entry` beskriver VAD SOM BOKFORTS. Den ar och forblir
--   append-only — en rattelse dar ar en ny post med motsatt tecken, aldrig en
--   overskrivning.
--
-- Med den gamla triggern hade en order i en oppen manad gatt att rätta medan
-- overtacket satt fast pa det gamla beloppet. Chefen hade da fatt 10 % pa en
-- restpost som inte langre fanns, och ingen vy hade kunnat visa varfor.
--
-- SPARET FINNS KVAR: varje rattelse loggas i `audit_log` med fore- och
-- eftervarde, och en rattelse i en stangd manad bokfors som en post i
-- huvudboken. Ingenting av det gar forlorat av att den har raden tas bort.
-- ===========================================================================
--
-- Triggern som nekar overtack pa EGEN order star kvar orord. Den ar en
-- affarsregel, inte ett skrivskydd.
-- -----------------------------------------------------------------------------

drop trigger if exists order_manager_commission_last on order_manager_commission;
drop function if exists public.order_manager_commission_ar_last();

comment on table order_manager_commission is
  'Saljchefens overtack pa EN order, raknat vid godkannandet och rattat med ordern. Egen tabell och inte kolumner pa sales_order, eftersom saljaren ser sin orderrad men aldrig chefens ersattning. Manaden kommer ur ordern.';

-- -----------------------------------------------------------------------------
-- 5. Sjalvkontroll
-- -----------------------------------------------------------------------------

do $$
declare
  n int;
begin
  -- HUVUDBOKEN MASTE FORTFARANDE VARA APPEND-ONLY. Det ar hela grunden for att
  -- en rattelse gar att gora utan att historien blir osann, och den har
  -- migrationen ror mycket i narheten av den.
  select count(*) into n
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  where c.relname = 'commission_entry'
    and t.tgname = 'commission_entry_last'
    and not t.tgisinternal;

  if n <> 1 then
    raise exception 'commission_entry ar inte langre append-only. Det far inte hanta.';
  end if;

  -- Overtacket far fortfarande inte hamna pa en egen order.
  select count(*) into n
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  where c.relname = 'order_manager_commission'
    and t.tgname = 'order_manager_commission_egen'
    and not t.tgisinternal;

  if n <> 1 then
    raise exception 'Sparren mot overtack pa egen order saknas.';
  end if;

  -- INGEN BOKFORD RAD FAR HA RORTS. Migrationen skriver bara DDL mot
  -- `commission_entry`; skulle nagon lagga tillbaka en bakatfyllning faller
  -- append-only-triggern, men kontrollen sager det med ord ocksa.
  select count(*) into n from commission_entry where kind is not null;

  if n > 0 then
    raise exception
      '% befintliga poster har fatt ett slag skrivet. Migrationen ska inte rora huvudboken — slagetFor() laser ur external_ref.', n;
  end if;
end;
$$;
