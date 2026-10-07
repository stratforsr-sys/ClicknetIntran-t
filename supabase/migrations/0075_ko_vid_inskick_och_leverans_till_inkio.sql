-- =============================================================================
-- 0075_ko_vid_inskick_och_leverans_till_inkio.sql
--
-- Beställarens svar 2026-10-07 på Inkio-passet (0074), fyra saker:
--
--   1. LEVERANSKÖN FYLLS NÄR ORDERN LÄGGS UPP, inte när den godkänns. Den står
--      där med "Väntar på godkännande"; välkomstsamtalet går inte att boka
--      förrän ordern är godkänd, och 24-timmarsfristen startar då, som förut.
--   2. BARA ORDER LAGDA FRÅN OCH MED NU GÅR TILL INKIO. `crm_installning.aktiv_fran`.
--   3. LEVERANSENS STEG SKRIVS I INKIO — bokat, genomfört, ej svar, flyttat,
--      inställt — för alla sex stegen. Förut gick bara "välkomstsamtal
--      genomfört" ut.
--   4. MAKULERINGEN I INKIO ÄR ETT VAL. Raden till Inkio skrivs inte längre av
--      triggern utan av `makuleraOrder`, och bara när bocken "Makulera även i
--      Inkio" är kvar.
--
-- Plus kundens adress på ordern (5), så att Inkio-steget aldrig fastnar på en
-- enskild firma som Bolagsverket inte har någon adress för.
--
-- -----------------------------------------------------------------------------
-- ALLT NYTT ÄR AVSTÄNGT TILLS MERGE
-- -----------------------------------------------------------------------------
--
-- Produktionens kod räknar med att varje rad i kön har en frist (`slaInfo`
-- på `welcome_due_at`). En väntande rad utan frist hade gett NaN i kön innan
-- den nya koden är ute. Därför `leverans_installning.ko_vid_inskick`, falsk
-- tills merge — samma mönster som `crm_installning` i 0074.
--
--   update leverans_installning set ko_vid_inskick = true, andrad_at = now();
--   update crm_installning set aktiv = true, aktiv_fran = now(), andrad_at = now();
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Strömbrytarna
-- -----------------------------------------------------------------------------

alter table crm_installning add column if not exists aktiv_fran timestamptz;

create table if not exists leverans_installning (
  id             boolean primary key default true check (id),
  ko_vid_inskick boolean not null default false,
  andrad_at      timestamptz not null default now()
);
insert into leverans_installning (id) values (true) on conflict (id) do nothing;
alter table leverans_installning enable row level security;

-- -----------------------------------------------------------------------------
-- 1. Kundens adress på ordern
-- -----------------------------------------------------------------------------
--
-- Nullbar: order lagda före 0075 har ingen. Krävs av `skapaOrder` för nya.

alter table sales_order add column if not exists customer_street text;
alter table sales_order add column if not exists customer_postal_code text;
alter table sales_order add column if not exists customer_city text;

alter table sales_order drop constraint if exists sales_order_adress_falt;
alter table sales_order add constraint sales_order_adress_falt check (
  (customer_street is null or length(btrim(customer_street)) between 1 and 200)
  and (customer_postal_code is null or length(btrim(customer_postal_code)) between 1 and 12)
  and (customer_city is null or length(btrim(customer_city)) between 1 and 100)
);

-- -----------------------------------------------------------------------------
-- 2. Kön: en rad utan frist medan ordern väntar på godkännande
-- -----------------------------------------------------------------------------

alter table delivery alter column welcome_due_at drop not null;

create or replace function public.lk_order_till_leverans()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_d delivery;
  r   record;
begin
  begin
    -- Inskickad (0075): in i kön utan frist. Bokningen spärras av
    -- `lk_leverans_kraver_godkand` tills ordern är godkänd.
    if new.status = 'inskickad'
       and not new.is_addon
       and (tg_op = 'INSERT' or old.status is distinct from 'inskickad')
       and coalesce((select ko_vid_inskick from leverans_installning where id), false) then
      insert into delivery (order_id, welcome_due_at)
      values (new.id, null)
      on conflict (order_id) do nothing;
    end if;

    -- Tillbakaskickad till säljaren: ut ur kön. Ingen kan ha tagit den —
    -- bokningen är spärrad medan den väntar.
    if tg_op = 'UPDATE' and new.status = 'utkast' and old.status = 'inskickad' then
      delete from delivery where order_id = new.id and owner_id is null and welcome_due_at is null;
    end if;

    -- Godkänd nu, och inte förut. Fristen startar här — även för en rad som
    -- redan väntat i kön.
    if new.approved_at is not null
       and (tg_op = 'INSERT' or old.approved_at is null)
       and not new.is_addon
       and new.status in ('signerad','betald') then
      insert into delivery (order_id, welcome_due_at)
      values (new.id, public.lk_vardagstimmar(new.approved_at, 24))
      on conflict (order_id) do update
        set welcome_due_at = excluded.welcome_due_at
        where delivery.welcome_due_at is null;

      for r in
        select distinct e.id from employee e join employee_role ro on ro.employee_id = e.id
        where ro.role in ('delivery','project_manager') and e.status <> 'offboarded'
      loop
        insert into outbox (kind, payload, idempotency_key, not_before)
        values ('notis',
                jsonb_build_object('kalla','leverans-ny','mall','leverans-ny','till',r.id,'av',new.approved_by,
                                   'order_id',new.id,'data','{}'::jsonb),
                'leverans-ny:' || new.id::text || ':' || r.id::text, now())
        on conflict (idempotency_key) do nothing;
      end loop;
    end if;

    -- Makulerad: ut ur kön. Är välkomstsamtalet bokat får den ansvariga veta.
    if tg_op = 'UPDATE' and new.status = 'makulerad' and old.status <> 'makulerad' then
      select * into v_d from delivery where order_id = new.id;
      if found then
        if v_d.owner_id is null then
          delete from delivery where order_id = new.id;
        else
          insert into outbox (kind, payload, idempotency_key, not_before)
          values ('notis',
                  jsonb_build_object('kalla','leverans-makulerad','mall','leverans-makulerad','till',v_d.owner_id,
                                     'av',new.cancelled_by,'order_id',new.id,'data','{}'::jsonb),
                  'leverans-makulerad:' || new.id::text, now())
          on conflict (idempotency_key) do nothing;
        end if;
      end if;
    end if;
  exception when others then
    raise warning 'lk_order_till_leverans(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

-- Ingen leveranspost på en order som inte är godkänd. Ett enda ställe som
-- täcker alla vägar in: `lk_ta_kund`, `lk_skapa_leverans` och dra-och-släpp.
create or replace function public.lk_leverans_kraver_godkand()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.kind = 'leverans' and new.order_id is not null
     and not exists (select 1 from sales_order where id = new.order_id and approved_at is not null) then
    raise exception 'lk:ej_godkand';
  end if;
  return new;
end;
$$;

revoke all on function public.lk_leverans_kraver_godkand() from public, anon, authenticated;

drop trigger if exists calendar_event_leverans_godkand on calendar_event;
create trigger calendar_event_leverans_godkand
  before insert on calendar_event
  for each row execute function public.lk_leverans_kraver_godkand();

-- -----------------------------------------------------------------------------
-- 3. Inkio: bara nya order, och ingen makulering från triggern
-- -----------------------------------------------------------------------------

create or replace function public.crm_order_till_utkorg()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fran timestamptz;
begin
  begin
    -- Påslagen OCH med ett startdatum. Order lagda innan dess finns redan i
    -- Inkio (importerade 2026-10-01) eller ska inte dit.
    select aktiv_fran into v_fran from crm_installning where id and aktiv;
    if v_fran is null or new.created_at < v_fran then
      return null;
    end if;

    if new.approved_at is not null
       and (tg_op = 'INSERT' or old.approved_at is null)
       and new.status in ('signerad','betald') then
      insert into outbox (kind, payload, idempotency_key, not_before)
      values ('crm', jsonb_build_object('handling','skapa','order_id',new.id),
              'crm-skapa:' || new.id::text, now() + interval '10 seconds')
      on conflict (idempotency_key) do nothing;
    end if;
    -- Makuleringen skrivs av `makuleraOrder`, när bocken är kvar (0075).
  exception when others then
    raise warning 'crm_order_till_utkorg(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Leveransens steg till Inkio
-- -----------------------------------------------------------------------------
--
-- En trigger på kalenderhändelsen i stället för en rad i var och en av
-- `lk_skapa_leverans`, `lk_ta_kund`, `lk_satt_utfall`, `lk_ny_tid` och
-- `lk_stall_in` — en väg in, och ingen av dem skrivs om.
--
-- ÅNGRA: raderna har 15 sekunders fönster (ångra har 10), och `crm()` läser
-- händelsen igen när raden skickas. Ett ångrat utfall har då `outcome = null`
-- igen, en ångrad bokning finns inte, och ingenting går ut.

create or replace function public.crm_leverans_till_utkorg()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fran     timestamptz;
  v_handelse text;
begin
  begin
    if new.kind <> 'leverans' or new.order_id is null then return null; end if;

    select aktiv_fran into v_fran from crm_installning where id and aktiv;
    if v_fran is null
       or not exists (select 1 from sales_order where id = new.order_id and created_at >= v_fran) then
      return null;
    end if;

    if tg_op = 'INSERT' then
      v_handelse := 'bokad';
    elsif old.outcome is null and new.outcome is not null then
      v_handelse := new.outcome;
    elsif old.cancelled_at is null and new.cancelled_at is not null then
      v_handelse := 'installd';
    elsif new.starts_at is distinct from old.starts_at and new.cancelled_at is null then
      v_handelse := 'flyttad';
    else
      return null;
    end if;

    insert into outbox (kind, payload, idempotency_key, not_before)
    values ('crm',
            jsonb_build_object('handling','leverans','order_id',new.order_id,'event_id',new.id,
                               'handelse',v_handelse,'starts_at',new.starts_at),
            'crm-lev:' || new.id::text || ':' || v_handelse || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::text,
            now() + interval '15 seconds')
    on conflict (idempotency_key) do nothing;
  exception when others then
    raise warning 'crm_leverans_till_utkorg(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.crm_leverans_till_utkorg() from public, anon, authenticated;

drop trigger if exists calendar_event_till_crm on calendar_event;
create trigger calendar_event_till_crm
  after insert or update on calendar_event
  for each row execute function public.crm_leverans_till_utkorg();
