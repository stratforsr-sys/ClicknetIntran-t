-- =============================================================================
-- 0300_provision_stangning_las.sql — månadsstängningen och mötesprovisionen
-- kan inte gå om varandra
--
-- -----------------------------------------------------------------------------
-- VARFÖR (hårdtestet av Möten 2026-11-14, fynd 3)
-- -----------------------------------------------------------------------------
--
-- `faststallPeriod` (provision/stangning.ts) läser månadens mötesposter och
-- skriver sedan `commission_period`. En bedömning som låstes mellan läsningen
-- och perioden kom inte med i bokföringen, och fick ingen rättelse heller:
-- `mote_bokfor_rattelse` såg en öppen månad när den kördes. Pengarna föll
-- mellan stolarna utan att något såg fel ut.
--
-- -----------------------------------------------------------------------------
-- HUR
-- -----------------------------------------------------------------------------
--
-- 1. `provision_stangning_borjar(månad)` körs FÖRST i stängningen. Den tar ett
--    exklusivt rådgivande lås på månaden, väntar alltså ut varje skrivning som
--    pågår, och sätter en markering. Efter den läser stängningen.
-- 2. `mote_provision_vakt(månad)` körs i varje skrivning av mötesprovision
--    (genom `mote_bokfor_rattelse`, som båda skrivvägarna anropar för varje
--    rad). Den tar samma lås delat, så skrivningar går parallellt med
--    varandra men aldrig förbi en stängning, och nekar med P0423 medan
--    markeringen finns. Allt i skrivningen rullas då tillbaka.
-- 3. `provision_stangning_klar(månad)` tar bort markeringen när perioden är
--    skriven, eller när stängningen fallerat.
--
-- En markering äldre än fem minuter räknas inte: en stängning som dog halvvägs
-- spärrar aldrig månaden för gott.
--
-- `mote_bokfor_rattelse` skrivs om med EN ny rad överst. Resten är ordagrant
-- 0288:s (kontrollerat mot pg_proc 2026-11-14).
--
-- Additiv och omkörbar.
-- =============================================================================

create table if not exists public.commission_period_stangs (
  period_month date primary key,
  borjade timestamptz not null default now(),
  av uuid
);

alter table public.commission_period_stangs enable row level security;
revoke all on table public.commission_period_stangs from public, anon, authenticated;

-- Samma lås-id i båda funktionerna: (klass, månad).
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
    raise exception 'Provisionsmånaden % stängs just nu', p_manad
      using errcode = 'P0423';
  end if;
end;
$$;

revoke all on function public.mote_provision_vakt(date) from public, anon, authenticated, service_role;

create or replace function public.provision_stangning_borjar(p_manad date, p_av uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtext('provision-manad'), hashtext(p_manad::text));
  delete from public.commission_period_stangs
   where period_month = p_manad and borjade <= now() - interval '5 minutes';
  insert into public.commission_period_stangs (period_month, av) values (p_manad, p_av)
  on conflict (period_month) do nothing;
  if not found then
    raise exception 'Månaden % stängs redan', p_manad using errcode = 'P0409';
  end if;
end;
$$;

revoke all on function public.provision_stangning_borjar(date, uuid) from public, anon, authenticated;
grant execute on function public.provision_stangning_borjar(date, uuid) to service_role;

create or replace function public.provision_stangning_klar(p_manad date)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.commission_period_stangs where period_month = p_manad;
$$;

revoke all on function public.provision_stangning_klar(date) from public, anon, authenticated;
grant execute on function public.provision_stangning_klar(date) to service_role;

-- 0288:s rättelse med vakten överst, för både mötets månad och innevarande månad.
create or replace function public.mote_bokfor_rattelse(
  p_mote uuid, p_employee uuid, p_manad date, p_version int, p_belopp numeric,
  p_innevarande date, p_note text, p_av uuid
)
returns date
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform public.mote_provision_vakt(p_manad);
  perform public.mote_provision_vakt(p_innevarande);
  -- Nollskillnad bokförs inte.
  if p_belopp is null or p_belopp = 0 then
    return null;
  end if;
  -- En öppen månad räknas live ur raderna av provisionsmotorn: ingen post.
  if not exists (
    select 1 from public.commission_period
     where period_month = p_manad and status in ('faststalld', 'utbetald')
  ) then
    return null;
  end if;
  if p_innevarande is null or p_innevarande <> date_trunc('month', p_innevarande)::date then
    raise exception 'Innevarande månad saknas eller är inte den 1:a'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.commission_period
     where period_month = p_innevarande and status in ('faststalld', 'utbetald')
  ) then
    raise exception 'Både % och % är fastställda: rättelsen har ingen öppen månad att landa i', p_manad, p_innevarande
      using errcode = 'P0422';
  end if;
  -- Samma rättelse (mötet, personen, versionen) bokförs en gång, också om den
  -- körs om en senare månad: referensen börjar med månaden, så den jämförs på slutet.
  if exists (
    select 1 from public.commission_entry
     where employee_id = p_employee
       and source = 'motor'
       and external_ref like '%:rattelse:mote:' || p_mote::text || ':v' || p_version::text
  ) then
    return null;
  end if;
  insert into public.commission_entry (employee_id, period_month, amount, kind, source, external_ref, note, entered_by)
  values (
    p_employee, p_innevarande, p_belopp, 'rattelse', 'motor',
    to_char(p_innevarande, 'YYYY-MM-DD') || ':' || p_employee::text || ':rattelse:mote:' || p_mote::text || ':v' || p_version::text,
    p_note, p_av
  );
  return p_innevarande;
end;
$$;

revoke all on function public.mote_bokfor_rattelse(uuid, uuid, date, int, numeric, date, text, uuid) from public, anon, authenticated, service_role;
