-- =============================================================================
-- 0302_provision_stangning_agare_och_order.sql — stängningens markering har en
-- ägare, och orderna går inte heller förbi en stängning
--
-- -----------------------------------------------------------------------------
-- VARFÖR (resterna efter hårdtestet av Möten 2026-11-14)
-- -----------------------------------------------------------------------------
--
-- 1. `provision_stangning_klar(månad)` i 0300 tog bort markeringen oavsett vems
--    den var. En stängning som dragit över fem minuter och tagits över av en ny
--    tog då bort den nyas markering när den själv blev klar, och mötesskrivningar
--    kom förbi medan den nya läste.
--    Nu: `provision_stangning_borjar` lämnar en nyckel, och `klar` med nyckeln tar
--    bara bort just den markeringen. `klar` utan nyckel (koden som körs innan
--    bygget med nyckeln är ute) beter sig som förut.
--
-- 2. Orderna hade samma lucka som mötena hade före 0300: en order som godkändes,
--    makulerades eller ändrades mellan stängningens läsning och perioden kom inte
--    med i bokföringen, och sågs sedan som en vanlig order i en stängd månad.
--    Nu tar varje sådan skrivning i `sales_order` och `order_manager_commission`
--    samma delade lås som mötesprovisionen (`mote_provision_vakt`), och nekas
--    med P0423 medan månaden stängs.
--
--    BARA DET SOM RÖR PENGARNA. Ett utkast, ett steg, en synk från Inkio eller
--    bytet signerad → betald ändrar ingenting provisionsmotorn räknar, och går
--    igenom som förut också under stängningen. Kolumnerna är de som
--    `hamtaAllaOrder` i provision/stangning.ts läser.
--
-- Additiv och omkörbar.
-- =============================================================================

alter table public.commission_period_stangs add column if not exists nyckel uuid;

-- Returtypen ändras (void → uuid), så funktionen måste tas bort först.
drop function if exists public.provision_stangning_borjar(date, uuid);

create function public.provision_stangning_borjar(p_manad date, p_av uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nyckel uuid := gen_random_uuid();
begin
  perform pg_advisory_xact_lock(hashtext('provision-manad'), hashtext(p_manad::text));
  delete from public.commission_period_stangs
   where period_month = p_manad and borjade <= now() - interval '5 minutes';
  insert into public.commission_period_stangs (period_month, av, nyckel) values (p_manad, p_av, v_nyckel)
  on conflict (period_month) do nothing;
  if not found then
    raise exception 'Månaden % stängs redan', p_manad using errcode = 'P0409';
  end if;
  return v_nyckel;
end;
$$;

revoke all on function public.provision_stangning_borjar(date, uuid) from public, anon, authenticated;
grant execute on function public.provision_stangning_borjar(date, uuid) to service_role;

drop function if exists public.provision_stangning_klar(date);
drop function if exists public.provision_stangning_klar(date, uuid);

create function public.provision_stangning_klar(p_manad date, p_nyckel uuid default null)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.commission_period_stangs
   where period_month = p_manad and (p_nyckel is null or nyckel = p_nyckel);
$$;

revoke all on function public.provision_stangning_klar(date, uuid) from public, anon, authenticated;
grant execute on function public.provision_stangning_klar(date, uuid) to service_role;

-- Felet läses av den som sparade en order, inte bara av koden.
create or replace function public.mote_provision_vakt(p_manad date)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if p_manad is null then
    return;
  end if;
  perform pg_advisory_xact_lock_shared(hashtext('provision-manad'), hashtext(p_manad::text));
  if exists (
    select 1 from public.commission_period_stangs
     where period_month = p_manad and borjade > now() - interval '5 minutes'
  ) then
    raise exception 'Provisionsmånaden % fastställs just nu. Försök igen om en minut.', to_char(p_manad, 'YYYY-MM')
      using errcode = 'P0423';
  end if;
end;
$$;

revoke all on function public.mote_provision_vakt(date) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Orderna
-- -----------------------------------------------------------------------------

-- Det provisionsmotorn räknar på en order (`hamtaAllaOrder` + `harGodkants`). Två orderrader med samma
-- avtryck ger samma pengar. Tar jsonb, inte radtypen, så att provet kan köra triggern på en tillfällig tabell
-- (tests/provision-stangning-las-db.mjs) i stället för att skriva i `sales_order`.
drop function if exists public.order_provisionsavtryck(public.sales_order);
create or replace function public.order_provisionsavtryck(o jsonb)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when o->>'status' in ('signerad', 'betald', 'makulerad') then
    concat_ws('|', o->>'status' = 'makulerad', o->>'period_month', o->>'cancel_period_month', o->>'commission_amount',
              o->>'salesperson_id', o->>'package_id', o->>'term_months', o->>'signed_on', o->>'is_addon',
              o->>'order_value', o->>'buyout_amount', o->>'finance_amount')
  end;
$$;

revoke all on function public.order_provisionsavtryck(jsonb) from public, anon, authenticated;

-- AFTER och inte BEFORE: `period_month` och `cancel_period_month` är genererade kolumner, och de är inte räknade
-- i en BEFORE-trigger. Ett fel här rullar ändå tillbaka hela skrivningen.
create or replace function public.sales_order_provision_vakt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fore text := case when tg_op in ('UPDATE', 'DELETE') then public.order_provisionsavtryck(to_jsonb(old)) end;
  v_efter text := case when tg_op in ('INSERT', 'UPDATE') then public.order_provisionsavtryck(to_jsonb(new)) end;
begin
  if v_fore is distinct from v_efter then
    if tg_op in ('UPDATE', 'DELETE') then
      perform public.mote_provision_vakt(old.period_month);
      perform public.mote_provision_vakt(old.cancel_period_month);
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
      perform public.mote_provision_vakt(new.period_month);
      perform public.mote_provision_vakt(new.cancel_period_month);
    end if;
  end if;
  return null;
end;
$$;

revoke all on function public.sales_order_provision_vakt() from public, anon, authenticated;

drop trigger if exists sales_order_provision_vakt on public.sales_order;
create trigger sales_order_provision_vakt
  after insert or update or delete on public.sales_order
  for each row execute function public.sales_order_provision_vakt();

-- Säljchefens påslag hör till orderns månader (hamtaAllaChefsposter).
create or replace function public.order_manager_commission_provision_vakt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order uuid := case when tg_op = 'DELETE' then old.order_id else new.order_id end;
  v_manad date;
  v_makul date;
begin
  if tg_op = 'UPDATE'
     and old.order_id = new.order_id and old.manager_id = new.manager_id
     and old.amount is not distinct from new.amount and old.percent is not distinct from new.percent then
    return new;
  end if;
  -- Ett påslag på ett utkast räknas inte förrän ordern godkänts: det går igenom.
  select period_month, cancel_period_month into v_manad, v_makul from public.sales_order
   where id = v_order and status in ('signerad', 'betald', 'makulerad');
  perform public.mote_provision_vakt(v_manad);
  perform public.mote_provision_vakt(v_makul);
  if tg_op = 'UPDATE' and old.order_id <> new.order_id then
    select period_month, cancel_period_month into v_manad, v_makul from public.sales_order
     where id = old.order_id and status in ('signerad', 'betald', 'makulerad');
    perform public.mote_provision_vakt(v_manad);
    perform public.mote_provision_vakt(v_makul);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.order_manager_commission_provision_vakt() from public, anon, authenticated;

drop trigger if exists order_manager_commission_provision_vakt on public.order_manager_commission;
create trigger order_manager_commission_provision_vakt
  before insert or update or delete on public.order_manager_commission
  for each row execute function public.order_manager_commission_provision_vakt();
