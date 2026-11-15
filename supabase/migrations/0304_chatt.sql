-- 0304: Chatten med Claude (hemvyn, steg 3). Loggen, proven och spärren.
--
-- Designdokumentet: docs/superpowers/specs/2026-11-15-hemvyn-kort-chatt-design.md (Steg 3).
--
-- ALLT HÄR LÄGGER BARA TILL. Koden på main rör inget av det nya, utom på en
-- punkt: triggern `nav_chatt_sparr` på `nav_setting` (del 3) går för varje
-- sparad inställning. Den släpper igenom allt som inte börjar på `chatt.` på
-- första raden.
--
-- INGET SLÅS PÅ. Ingen inställning skapas här, och ingen rad i `nav_chatt_prov`.
-- Chatten svarar 409 tills någon sätter `chatt.pa`, och det går inte förrän
-- taket, avtalet och ett godkänt prov finns.
--
-- Omkörbar.

-- -----------------------------------------------------------------------------
-- 1. Loggen: en rad per fråga
--
-- Vem, när, miljö, modell, token, vilka verktyg som anropades med vilka
-- argument, stoppskäl, tid, beräknad kostnad och antal obelagda tal. Frågans
-- och svarets text nollas efter 90 dagar av nattjobbet; talen står kvar.
--
-- Bara personen själv läser sina rader. Servern skriver (service role), efter
-- att rutten prövat inloggningen. Taken räknas ur loggen, per miljö.
-- -----------------------------------------------------------------------------

create table if not exists public.nav_chatt_logg (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employee(id) on delete cascade,
  nar timestamptz not null default now(),
  -- 'production', 'preview' eller 'lokal': taken räknas per miljö.
  miljo text not null,
  modell text not null,
  tokens_in integer not null default 0,
  tokens_ut integer not null default 0,
  tokens_cache_las integer not null default 0,
  tokens_cache_skriv integer not null default 0,
  -- [{namn, input}] i den ordning verktygen anropades.
  verktyg jsonb not null default '[]'::jsonb,
  stop_reason text not null,
  ms integer not null default 0,
  kostnad_kr numeric not null default 0 check (kostnad_kr >= 0),
  obelagda integer not null default 0 check (obelagda >= 0),
  fraga text,
  svar text,
  -- En rad från provkörningen (scripts/chatt-prov.mjs), inte från en person som frågat.
  prov boolean not null default false
);
create index if not exists nav_chatt_logg_miljo_nar on public.nav_chatt_logg (miljo, nar);
create index if not exists nav_chatt_logg_person_nar on public.nav_chatt_logg (employee_id, nar);

alter table public.nav_chatt_logg enable row level security;
revoke all on public.nav_chatt_logg from public, anon, authenticated;
grant select on public.nav_chatt_logg to authenticated;
grant select, insert, update, delete on public.nav_chatt_logg to service_role;

drop policy if exists nav_chatt_logg_las on public.nav_chatt_logg;
create policy nav_chatt_logg_las on public.nav_chatt_logg for select to authenticated using (
  employee_id = public.current_employee_id()
);

-- -----------------------------------------------------------------------------
-- 2. Proven: vilken modell som klarat de fasta frågorna
--
-- En rad per körning av provet: modell, avtrycket av systemtexten och
-- verktygslistan, antal frågor, antal rätt och kostnaden per fråga. `godkand`
-- sätts av en människa, aldrig av provet, och kräver vem och när.
--
-- Läses och skrivs bara av servern.
-- -----------------------------------------------------------------------------

create table if not exists public.nav_chatt_prov (
  id uuid primary key default gen_random_uuid(),
  modell text not null,
  avtryck text not null,
  kord timestamptz not null default now(),
  fragor integer not null check (fragor > 0),
  ratt integer not null check (ratt >= 0),
  obelagda integer not null default 0 check (obelagda >= 0),
  kostnad_per_fraga_kr numeric check (kostnad_per_fraga_kr is null or kostnad_per_fraga_kr >= 0),
  anteckning text,
  godkand boolean not null default false,
  godkand_av uuid references public.employee(id) on delete set null,
  godkand_nar timestamptz,
  constraint nav_chatt_prov_ratt check (ratt <= fragor),
  -- Ett godkännande har en tidpunkt. Vem står i godkand_av, som töms om personen tas bort.
  constraint nav_chatt_prov_godkand check (not godkand or godkand_nar is not null)
);
alter table public.nav_chatt_prov enable row level security;
revoke all on public.nav_chatt_prov from public, anon, authenticated;
grant select, insert, update, delete on public.nav_chatt_prov to service_role;

-- -----------------------------------------------------------------------------
-- 3. Spärren: chatten går inte att slå på utan tak, avtal och godkänt prov
--
-- Gränsen sätts här och inte bara i koden, så att en rad skriven för hand i
-- `nav_setting` inte kan slå på chatten utan ett prov. Rutten prövar samma sak
-- vid varje fråga, och dessutom att provet gäller den systemtext och de
-- verktyg som körs nu (avtrycket), vilket databasen inte kan veta.
--
-- Medan chatten är på går taket och avtalet inte att ta bort, och modellen
-- inte att byta till en utan godkänt prov. Stäng av först.
--
-- Standardmodellen står också i koden (`CHATT_STANDARD` i chattforma.ts): det
-- är den som gäller när `chatt.modell` saknas.
-- -----------------------------------------------------------------------------

create or replace function public.nav_chatt_sparr()
returns trigger
language plpgsql
as $$
declare
  v_nyckel text;
  v_pa jsonb;
  v_tak jsonb;
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
  select value into v_tak from public.nav_setting where key = 'chatt.tak-kr';
  select value into v_avtal from public.nav_setting where key = 'chatt.avtal';
  select value #>> '{}' into v_modell from public.nav_setting where key = 'chatt.modell';
  if tg_op = 'DELETE' then
    if v_nyckel = 'chatt.pa' then v_pa := null; end if;
    if v_nyckel = 'chatt.tak-kr' then v_tak := null; end if;
    if v_nyckel = 'chatt.avtal' then v_avtal := null; end if;
    if v_nyckel = 'chatt.modell' then v_modell := null; end if;
  else
    if v_nyckel = 'chatt.pa' then v_pa := new.value; end if;
    if v_nyckel = 'chatt.tak-kr' then v_tak := new.value; end if;
    if v_nyckel = 'chatt.avtal' then v_avtal := new.value; end if;
    if v_nyckel = 'chatt.modell' then v_modell := new.value #>> '{}'; end if;
  end if;

  if v_pa is distinct from 'true'::jsonb then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if v_tak is null or jsonb_typeof(v_tak) <> 'number' or (v_tak #>> '{}')::numeric <= 0 then
    raise exception 'Chatten kan inte vara på utan ett tak i kronor (chatt.tak-kr). Stäng av chatten först.';
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
drop trigger if exists nav_chatt_sparr on public.nav_setting;
create trigger nav_chatt_sparr before insert or update or delete on public.nav_setting
  for each row execute function public.nav_chatt_sparr();

-- -----------------------------------------------------------------------------
-- 4. Förbrukningen: det taken räknas på
--
-- Månadens kronor i miljön, för alla (taket gäller företaget), och dagens
-- frågor för personen. Månaden och dagen är svenska, som resten av Nav. En
-- provkörning kostar mot taket men är ingen fråga från en person.
--
-- Räknas i databasen och inte i rutten: REST-lagret kapar ett svar vid tusen
-- rader, och en summa över en kapad läsning hade släppt igenom taket.
-- -----------------------------------------------------------------------------

create or replace function public.nav_chatt_forbrukning(p_miljo text, p_employee uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'manad_kr', coalesce((
      select sum(kostnad_kr) from public.nav_chatt_logg
      where miljo = p_miljo
        and nar >= (date_trunc('month', now() at time zone 'Europe/Stockholm') at time zone 'Europe/Stockholm')
    ), 0)::float8,
    'idag_fragor', (
      select count(*) from public.nav_chatt_logg
      where miljo = p_miljo and employee_id = p_employee and not prov
        and nar >= (date_trunc('day', now() at time zone 'Europe/Stockholm') at time zone 'Europe/Stockholm')
    )
  );
$$;
revoke all on function public.nav_chatt_forbrukning(text, uuid) from public, anon, authenticated;
grant execute on function public.nav_chatt_forbrukning(text, uuid) to service_role;
