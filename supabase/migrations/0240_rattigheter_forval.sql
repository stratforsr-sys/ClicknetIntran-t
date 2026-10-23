-- =============================================================================
-- 0240_rattigheter_forval.sql — nya funktioner är stängda tills någon öppnar dem,
-- och anon kan inte köra någon DEFINER-funktion
--
-- -----------------------------------------------------------------------------
-- VARFÖR
-- -----------------------------------------------------------------------------
--
-- Granskningen 2026-10-22 (C1, C10) och slutgranskningen av S01 2026-10-23.
-- 0205 stängde lk_andra_mote, men roten stod kvar: varje ny funktion som
-- rollen postgres skapar i public blev körbar för anon och authenticated via
-- /rest/v1/rpc, ända tills en migration drog in rätten. Två förval ger den:
--
--   globalt          Postgres inbyggda förval: PUBLIC=X. Ett förval per schema
--                    kan bara lägga till, aldrig ta bort det globala, så det
--                    måste dras in utan "in schema" (prövat 2026-10-23).
--   schemat public   {postgres, anon, authenticated, service_role}=X
--
-- Efter 0240 får en ny funktion i public bara postgres och service_role. Ska
-- den köras med användarens klient eller i en RLS-policy krävs
-- `grant execute … to authenticated` i migrationen. En glömd grant ger
-- "permission denied" i torrkörningen, i stället för ett tyst hål.
--
-- Det globala förvalet gäller bara funktioner som postgres skapar. I storage
-- ger schemats egen rad fortfarande anon och authenticated rätten. Rollen
-- supabase_admin går inte att ändra (permission denied), och den skapar inga
-- av navets funktioner. Befintliga funktioner påverkas inte av förvalet.
--
-- C10: anon kunde köra kanda_fel, fel_statistik, matches_audience (tre
-- argument) och INVOKER-funktionen kampanjsidor_lage. Det var ofarligt
-- (anon har ingen anställd och RLS ger ingenting), men inget i navet anropar
-- dem utan inloggning. Policyerna som använder matches_audience gäller bara
-- authenticated. De två triggerfunktionerna körs av triggern utan att
-- EXECUTE prövas (prövat 2026-10-23), så ingen roll behöver rätten.
--
-- Bara rättigheter, inga funktionskroppar. Vakten tests/rattigheter-db.mjs
-- fallerar om förvalet öppnas igen.
-- =============================================================================

alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;

revoke all on function public.kanda_fel() from public, anon;
grant execute on function public.kanda_fel() to authenticated, service_role;
revoke all on function public.fel_statistik() from public, anon;
grant execute on function public.fel_statistik() to authenticated, service_role;
revoke all on function public.matches_audience(text[], uuid[], uuid[]) from public, anon;
grant execute on function public.matches_audience(text[], uuid[], uuid[]) to authenticated, service_role;
revoke all on function public.kampanjsidor_lage() from public, anon;
grant execute on function public.kampanjsidor_lage() to authenticated, service_role;

revoke all on function public.candidate_stegbyte_loggas() from public, anon, authenticated;
revoke all on function public.coaching_kvittens_vaktas() from public, anon, authenticated;
