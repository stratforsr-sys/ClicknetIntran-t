-- =============================================================================
-- 0017_losenordstvang_i_databasen.sql
--
-- Tvanget att byta losenord satt i mellanvaran och ingen annanstans. Ett
-- behorighetsprov visade vad det betydde i praktiken: ett flaggat konto som
-- loggade in rakt mot token-endpointen och fragade PostgREST fick ut sin egen
-- rad ur `employee` och ett dokument ur `document`. Mellanvaran var aldrig
-- inblandad — den ser bara trafik som gar genom navets sidor.
--
-- Ett tillfalligt losenord ar kant av tva personer fran forsta sekunden: den
-- som lade upp kontot laste upp det. Sa lange ordet gar att anvanda for att
-- hamta data ar tvanget en artighetsfras, inte en spa­rr.
--
-- Samma flytt som K12 gjorde i 0015: fran en regel i koden till en regel i
-- databasen. Definition of Done p. 4 kraver dessutom att fel behorighet ger
-- noll rader ur API:t, inte att en vy later bli att rita dem.
--
-- GRANSEN GAR VID API:t, INTE VID SERVERN.
--
-- Flaggan stanger `authenticated`-vagen, alltsa allt som gar med anvandarens
-- egen token. Servern har kvar sin service role och vet fortfarande vem
-- personen ar — det behovs, for `/byt-losenord` maste kunna hamta namnet for
-- att kunna neka ett losenord som innehaller det, och steg tva maste kunna
-- lasa rollerna for att veta om enheten ska bekraftas forst. Se
-- src/lib/auth.ts och src/lib/supabase/middleware.ts, som bada faller tillbaka
-- pa service role just for flaggade konton.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Sjalva fragan.
--
-- `app_metadata` foljer med i JWT:n, sa svaret finns i token och kostar ingen
-- tabellasning. Det ar ocksa skalet till att flaggan bor dar och inte i
-- `employee`: den maste ga att lasa innan man far lasa nagot.
--
-- Villkoret ar `= 'true'` och ingenting annat. Saknas faltet blir jamforelsen
-- null och `coalesce` gor det till false. En spa­rr som utloses av att ett falt
-- SAKNAS skulle stanga ute varenda konto som fanns fore den har migrationen —
-- alltsa alla. Samma regel som `kraverByte()` i src/lib/losenordsbyte.ts.
--
-- Ingen service role har nagon `request.jwt.claims` satt. Nattjobbet och
-- server actions ser alltsa alltid false har, aven om de nagon gang skulle
-- borja passera RLS.
-- -----------------------------------------------------------------------------

create or replace function public.kraver_losenordsbyte()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb
       -> 'app_metadata' ->> 'byt_losenord') = 'true',
    false)
$$;

comment on function public.kraver_losenordsbyte() is
  'Sant nar den anropande token bar app_metadata.byt_losenord = true. '
  'Anvands for att stanga API:t for konton som annu inte bytt sitt '
  'tillfalliga losenord. Se 0017.';

-- -----------------------------------------------------------------------------
-- 2. Hjalpfunktionerna.
--
-- Nastan varje policy i navet gar genom nagon av de har fem. Att lagga
-- villkoret har i stallet for i varje policy ar inte bara mindre att skriva:
-- en policy som skrivs i en framtida migration far spa­rren gratis, och det ar
-- den sortens sak man annars glommer.
--
-- Kroppen i ovrigt ar oforandrad fran 0001 och 0003. Bara raden med
-- `kraver_losenordsbyte()` ar ny.
-- -----------------------------------------------------------------------------

create or replace function public.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id
  from public.employee
  where auth_user_id = auth.uid()
    and status <> 'offboarded'
    and not public.kraver_losenordsbyte()
  limit 1
$$;

create or replace function public.has_role(wanted text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not public.kraver_losenordsbyte() and exists (
    select 1
    from public.employee_role r
    join public.employee e on e.id = r.employee_id
    where e.auth_user_id = auth.uid()
      and e.status <> 'offboarded'
      and r.role = wanted
  )
$$;

create or replace function public.has_any_role(wanted text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not public.kraver_losenordsbyte() and exists (
    select 1
    from public.employee_role r
    join public.employee e on e.id = r.employee_id
    where e.auth_user_id = auth.uid()
      and e.status <> 'offboarded'
      and r.role = any(wanted)
  )
$$;

create or replace function public.leads_employee(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not public.kraver_losenordsbyte() and exists (
    select 1
    from public.employee me
    join public.employee target_e on target_e.id = target
    where me.auth_user_id = auth.uid()
      and me.status <> 'offboarded'
      and (target_e.manager_id = me.id
           or target_e.team_id in (select id from public.team where lead_id = me.id))
  )
$$;

-- `matches_audience` ar den enda av de fem dar villkoret MASTE sta forst i
-- stallet for inuti ett `exists`. Funktionen svarar ja pa ett dokument som
-- riktar sig till alla, alltsa utan att titta pa vem som fragar — och det var
-- exakt den vagen provet fick ut ett dokument med ett flaggat konto.
create or replace function public.matches_audience(p_roles text[], p_teams uuid[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not public.kraver_losenordsbyte() and
    (p_roles is null or cardinality(p_roles) = 0 or exists (
      select 1
      from public.employee_role r
      join public.employee e on e.id = r.employee_id
      where e.auth_user_id = auth.uid()
        and e.status <> 'offboarded'
        and r.role = any(p_roles)))
    and
    (p_teams is null or cardinality(p_teams) = 0 or exists (
      select 1
      from public.employee e
      where e.auth_user_id = auth.uid()
        and e.status <> 'offboarded'
        and e.team_id = any(p_teams)))
$$;

-- -----------------------------------------------------------------------------
-- 3. Policyerna som inte fragar nagon hjalpfunktion.
--
-- Fyra tabeller slapper in varje inloggad utan vidare: bolaget, teamen,
-- arendekategorierna och spa­rrarnas lage. Var och en for sig ar det uppslagsdata
-- och inte persondata — men teamlistan bar ledarnas id och spa­rrtabellen visar
-- vad organisationen slagit pa och nar. Ett konto som inte far lasa nagot ska
-- inte lasa det heller.
-- -----------------------------------------------------------------------------

drop policy if exists company_read on company;
create policy company_read on company for select
  to authenticated using (not public.kraver_losenordsbyte());

drop policy if exists team_read on team;
create policy team_read on team for select
  to authenticated using (not public.kraver_losenordsbyte());

drop policy if exists case_category_read on case_category;
create policy case_category_read on case_category for select
  to authenticated using (not public.kraver_losenordsbyte());

drop policy if exists compliance_gate_read on compliance_gate;
create policy compliance_gate_read on compliance_gate for select
  to authenticated using (not public.kraver_losenordsbyte());

-- Egen rad. Villkoret star direkt i policyn och inte i `current_employee_id()`,
-- sa det maste sagas en gang till har. Ovriga tva led gar genom
-- `can_read_all_employees()` och `leads_employee()` och ar redan tackta.
drop policy if exists employee_read on employee;
create policy employee_read on employee for select
  to authenticated
  using (
    (auth_user_id = auth.uid()
      and status <> 'offboarded'
      and not public.kraver_losenordsbyte())
    or public.can_read_all_employees()
    or public.leads_employee(id)
  );
