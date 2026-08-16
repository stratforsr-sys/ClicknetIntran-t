-- =============================================================================
-- 0002_harda_behorigheter.sql
--
-- Hittat av tests/rls.mjs. Ingen av bristerna lackte data — RLS holl — men
-- bada gor systemet skorare an det behover vara.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Skrivratten tas bort helt fran klientrollerna.
--
-- Fore: en PATCH mot employee gav HTTP 204 och andrade noll rader, eftersom
-- ingen UPDATE-policy fanns. Det ar sakert men missvisande, och framfor allt
-- skort: den dag nagon lagger till en for bred policy oppnas skrivvagen tyst.
-- Efter: databasen svarar 403 redan pa rattighetsnivan, innan RLS ens provas.
--
-- Navet skriver uteslutande via server actions med service role, som har egna
-- rattigheter och inte pavarkas har (DECISIONS D-T1).
-- -----------------------------------------------------------------------------

revoke insert, update, delete, truncate on all tables in schema public
  from anon, authenticated;

-- Galler aven tabeller som skapas i framtida migrationer.
alter default privileges in schema public
  revoke insert, update, delete on tables from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. log_audit far inte anropas fran klienten.
--
-- PostgREST exponerar varje funktion i public som ett RPC-anrop. log_audit ar
-- security definer och skriver till audit_log — utan detta kunde en saljare
-- posta godtyckliga handelser till loggen och gora den obrukbar som bevis.
-- -----------------------------------------------------------------------------

revoke execute on function public.log_audit(text, text, text, text, jsonb)
  from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Avslutad anstalld tappar aven lasningen av sin egen rad.
--
-- Fore: villkoret auth_user_id = auth.uid() saknade statuskontroll, sa en
-- offboardad person med en token som annu inte hunnit ga ut kunde fortsatta
-- lasa sin egen rad. Rollbaserad atkomst var redan stangd, eftersom bade
-- current_employee_id() och has_role() filtrerar bort offboarded.
--
-- AC-1.4 kraver att sessioner invalideras omedelbart. Det sker redan pa tva
-- satt (bannlysning via admin-API:t och middleware). Detta ar det tredje och
-- sista ledet: aven om bada de forsta fallerar sager databasen nej.
-- -----------------------------------------------------------------------------

drop policy if exists employee_read on employee;
create policy employee_read on employee for select
  to authenticated
  using (
    (auth_user_id = auth.uid() and status <> 'offboarded')
    or public.can_read_all_employees()
    or public.leads_employee(id)
  );
