-- 0305_chatt_tak
--
-- Chattens gränser (designdokumentet 2026-11-15, "Taken"): hur mycket AI:n får
-- kosta. De räknas i dollar, i det Anthropic tar betalt, ur loggens token och
-- modellens pris. Två gränser, båda per kalendermånad och per miljö:
--
--   per person     standard 10 dollar
--   för företaget  standard 50 dollar
--
-- Gränserna sätts inte i Navs inställningar. De är data i `nav_chatt_tak`, en
-- rad per installation, och saknas raden gäller standardvärdena. Det finns
-- ingen vy att ändra dem i: `node scripts/chatt-tak.mjs <person> <företag>`.
--
-- 0304 räknade ett tak i kronor (`chatt.tak-kr`) och frågor per dag. Det är
-- ersatt här: spärren kräver inte längre taket i inställningarna, och
-- `nav_chatt_forbrukning` är borta.
--
-- Additiv och omkörbar. Ingenting slås på.

-- -----------------------------------------------------------------------------
-- 1. Gränserna som data
-- -----------------------------------------------------------------------------

create table if not exists public.nav_chatt_tak (
  -- En rad per installation.
  en boolean primary key default true,
  person_usd numeric not null,
  foretag_usd numeric not null,
  satt_nar timestamptz not null default now(),
  constraint nav_chatt_tak_en check (en),
  constraint nav_chatt_tak_person check (person_usd > 0),
  constraint nav_chatt_tak_foretag check (foretag_usd >= person_usd)
);
alter table public.nav_chatt_tak enable row level security;
revoke all on public.nav_chatt_tak from public, anon, authenticated;
grant select, insert, update, delete on public.nav_chatt_tak to service_role;

-- -----------------------------------------------------------------------------
-- 2. Kostnaden i dollar på varje loggrad
-- -----------------------------------------------------------------------------

alter table public.nav_chatt_logg add column if not exists kostnad_usd numeric not null default 0;
alter table public.nav_chatt_logg drop constraint if exists nav_chatt_logg_kostnad_usd;
alter table public.nav_chatt_logg add constraint nav_chatt_logg_kostnad_usd check (kostnad_usd >= 0);

-- -----------------------------------------------------------------------------
-- 3. Spärren utan taket i inställningarna
--
-- Chatten går inte att slå på utan ett bekräftat personuppgiftsbiträdesavtal och
-- ett godkänt prov för modellen. Gränserna i dollar gäller alltid: det finns
-- inget läge utan dem.
-- -----------------------------------------------------------------------------

create or replace function public.nav_chatt_sparr()
returns trigger
language plpgsql
as $$
declare
  v_nyckel text;
  v_pa jsonb;
  v_avtal jsonb;
  v_modell text;
begin
  if tg_op = 'DELETE' then
    if old.key not like 'chatt.%' then return old; end if;
    v_nyckel := old.key;
  else
    if new.key not like 'chatt.%' then return new; end if;
    v_nyckel := new.key;
  end if;

  -- Värdena som de blir efter den här satsen.
  select value into v_pa from public.nav_setting where key = 'chatt.pa';
  select value into v_avtal from public.nav_setting where key = 'chatt.avtal';
  select value #>> '{}' into v_modell from public.nav_setting where key = 'chatt.modell';
  if tg_op = 'DELETE' then
    if v_nyckel = 'chatt.pa' then v_pa := null; end if;
    if v_nyckel = 'chatt.avtal' then v_avtal := null; end if;
    if v_nyckel = 'chatt.modell' then v_modell := null; end if;
  else
    if v_nyckel = 'chatt.pa' then v_pa := new.value; end if;
    if v_nyckel = 'chatt.avtal' then v_avtal := new.value; end if;
    if v_nyckel = 'chatt.modell' then v_modell := new.value #>> '{}'; end if;
  end if;

  if v_pa is distinct from 'true'::jsonb then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if v_avtal is distinct from 'true'::jsonb then
    raise exception 'Chatten kan inte vara på utan att personuppgiftsbiträdesavtalet är bekräftat (chatt.avtal). Stäng av chatten först.';
  end if;
  v_modell := coalesce(nullif(v_modell, ''), 'claude-sonnet-5-5');
  if not exists (select 1 from public.nav_chatt_prov p where p.modell = v_modell and p.godkand) then
    raise exception 'Modellen % har inget godkänt prov. Kör provet och godkänn det, eller stäng av chatten först.', v_modell;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Utrymmet: vad som är använt i månaden, och gränserna
--
-- Månaden är svensk, som resten av Nav, och nollställs den 1:a. Räknas i
-- databasen och inte i rutten: REST-lagret kapar ett svar vid tusen rader, och
-- en summa över en kapad läsning hade släppt igenom gränsen.
-- -----------------------------------------------------------------------------

drop function if exists public.nav_chatt_forbrukning(text, uuid);

create or replace function public.nav_chatt_utrymme(p_miljo text, p_employee uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  with m as (
    select (date_trunc('month', now() at time zone 'Europe/Stockholm') at time zone 'Europe/Stockholm') as fran
  )
  select jsonb_build_object(
    'person_usd', coalesce((
      select sum(l.kostnad_usd) from public.nav_chatt_logg l, m
      where l.miljo = p_miljo and l.employee_id = p_employee and l.nar >= m.fran
    ), 0)::float8,
    'foretag_usd', coalesce((
      select sum(l.kostnad_usd) from public.nav_chatt_logg l, m
      where l.miljo = p_miljo and l.nar >= m.fran
    ), 0)::float8,
    'tak_person_usd', coalesce((select person_usd from public.nav_chatt_tak), 10)::float8,
    'tak_foretag_usd', coalesce((select foretag_usd from public.nav_chatt_tak), 50)::float8
  );
$$;
revoke all on function public.nav_chatt_utrymme(text, uuid) from public, anon, authenticated;
grant execute on function public.nav_chatt_utrymme(text, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 5. Reservationen: prövningen och loggraden i ett steg
--
-- Före varje fråga: det personen och företaget använt i månaden plus frågans
-- högsta kostnad får inte gå över gränsen. Ryms den skrivs loggraden direkt, med
-- den högsta kostnaden, och rutten rättar raden till den verkliga när svaret är
-- klart. Då räknas en fråga mot gränsen redan medan den pågår, och en fråga
-- som aldrig hinner skriva sitt svar (fliken stängd, funktionen avbruten)
-- kostar sin högsta kostnad i stället för ingenting.
--
-- Låset gör att två frågor i samma miljö prövas en i taget: femtio frågor
-- samtidigt kan inte alla läsa samma förbrukning och gå igenom.
-- -----------------------------------------------------------------------------

create or replace function public.nav_chatt_reservera(p_miljo text, p_employee uuid, p_modell text, p_max_usd numeric, p_fraga text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v jsonb;
  v_id uuid;
begin
  if p_max_usd is null or p_max_usd <= 0 then
    raise exception 'En fråga kan inte reserveras utan en högsta kostnad.';
  end if;
  perform pg_advisory_xact_lock(hashtext('nav_chatt_tak:' || p_miljo));
  v := public.nav_chatt_utrymme(p_miljo, p_employee);
  if (v ->> 'person_usd')::numeric + p_max_usd > (v ->> 'tak_person_usd')::numeric then
    return v || jsonb_build_object('ok', false, 'skal', 'person');
  end if;
  if (v ->> 'foretag_usd')::numeric + p_max_usd > (v ->> 'tak_foretag_usd')::numeric then
    return v || jsonb_build_object('ok', false, 'skal', 'foretag');
  end if;
  insert into public.nav_chatt_logg (employee_id, miljo, modell, stop_reason, kostnad_usd, fraga)
    values (p_employee, p_miljo, p_modell, 'pagar', p_max_usd, p_fraga)
    returning id into v_id;
  return v || jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
revoke all on function public.nav_chatt_reservera(text, uuid, text, numeric, text) from public, anon, authenticated;
grant execute on function public.nav_chatt_reservera(text, uuid, text, numeric, text) to service_role;

-- -----------------------------------------------------------------------------
-- 6. Allas förbrukning i månaden, för den som sätter gränserna
-- -----------------------------------------------------------------------------

create or replace function public.nav_chatt_forbrukning_alla(p_miljo text)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('employee_id', x.employee_id, 'namn', x.namn, 'usd', x.usd, 'fragor', x.fragor) order by x.usd desc, x.namn), '[]'::jsonb)
  from (
    select l.employee_id, trim(e.first_name || ' ' || e.last_name) as namn, sum(l.kostnad_usd)::float8 as usd, (count(*) filter (where not l.prov))::int as fragor
    from public.nav_chatt_logg l
    join public.employee e on e.id = l.employee_id
    where l.miljo = p_miljo
      and l.nar >= (date_trunc('month', now() at time zone 'Europe/Stockholm') at time zone 'Europe/Stockholm')
    group by l.employee_id, e.first_name, e.last_name
  ) x;
$$;
revoke all on function public.nav_chatt_forbrukning_alla(text) from public, anon, authenticated;
grant execute on function public.nav_chatt_forbrukning_alla(text) to service_role;
