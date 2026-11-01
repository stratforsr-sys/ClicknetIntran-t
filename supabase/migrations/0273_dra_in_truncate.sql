-- =============================================================================
-- 0273_dra_in_truncate.sql — anon och authenticated får inte tömma, låsa eller
-- trigga tabellerna i public
--
-- -----------------------------------------------------------------------------
-- VARFÖR
-- -----------------------------------------------------------------------------
--
-- Produktionsprovet 2026-10-30, gul 3. Supabases förval gav anon och
-- authenticated TRUNCATE, TRIGGER, REFERENCES och (Postgres 17) MAINTAIN på
-- nästan varje tabell: 2026-10-31 var det 200–213 tabeller per rättighet och
-- roll. TRUNCATE går förbi både RLS och oföränderlighetstriggrarna (0019,
-- 0048): `set role authenticated; truncate sick_note` gick igenom i en rullad
-- transaktion. MAINTAIN ger LOCK TABLE och VACUUM.
--
-- Rättigheterna nås inte via PostgREST, men de är fel försvar att lita på. Navet
-- skriver med service role, och RLS skyddar läsningarna. Ingen väg i navet
-- behöver de fyra rättigheterna för anon eller authenticated.
--
-- Två steg, efter samma mönster som 0240:
--   befintliga tabeller   revoke … on all tables in schema public
--   nya tabeller          förvalet för rollen postgres, som äger alla 226
--
-- Rollen supabase_admin går inte att ändra (permission denied, se 0240), och
-- den skapar inga av navets tabeller. SELECT, INSERT, UPDATE och DELETE rörs
-- inte.
-- =============================================================================

revoke truncate, trigger, references, maintain on all tables in schema public from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke truncate, trigger, references, maintain on tables from anon, authenticated;
