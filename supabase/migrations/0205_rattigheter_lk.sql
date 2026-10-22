-- =============================================================================
-- 0205_rattigheter_lk.sql — lk_andra_mote, lk_narvaro och lk_i_leverans bara
-- för service role
--
-- -----------------------------------------------------------------------------
-- VARFÖR
-- -----------------------------------------------------------------------------
--
-- Granskningen 2026-10-22 (K1: A1, C1, C17). pg_default_acl i public ger anon
-- och authenticated EXECUTE på varje ny funktion. 0088 och 0091 gjorde bara
-- `revoke all … from public`, så standardrättigheten stod kvar:
--
--   lk_andra_mote   {postgres, anon, authenticated, service_role}
--                   SECURITY DEFINER, skriver förbi RLS och jämför bara
--                   argumentet p_aktor med mötets arrangör. Med den publika
--                   anon-nyckeln, mötets id och arrangörens id gick det att
--                   skriva om vilket möte som helst och skicka notiser i
--                   arrangörens namn. Öppen sedan 2026-10-15.
--   lk_narvaro      {postgres, service_role, authenticated}
--                   lämnar ut deltagare, svar och externa adresser för vilket
--                   möte som helst, utan kontroll av läsaren.
--   lk_i_leverans   {postgres, service_role, authenticated}
--                   säger om en viss person har leveransroll.
--
-- Appen anropar lk_* bara via lk() med service role
-- (src/lib/leveranskalender-server.ts:838). Ingen policy, vy eller SECURITY
-- INVOKER-funktion använder lk_narvaro eller lk_i_leverans; deras anropare är
-- DEFINER-funktioner som körs som ägaren (delar/granskning/S01/kartlaggning.md).
-- Inget går alltså sönder.
--
-- Bara rättigheter, inga funktionskroppar. Samma två rader som 0202 och 0204.
-- Vakten tests/rattigheter-db.mjs fångar nästa funktion som glömmer dem.
-- =============================================================================

revoke all on function public.lk_andra_mote(uuid, uuid, text, text, text, text, uuid[], integer, text) from public, anon, authenticated;
grant execute on function public.lk_andra_mote(uuid, uuid, text, text, text, text, uuid[], integer, text) to service_role;

revoke all on function public.lk_narvaro(uuid) from public, anon, authenticated;
grant execute on function public.lk_narvaro(uuid) to service_role;

revoke all on function public.lk_i_leverans(uuid) from public, anon, authenticated;
grant execute on function public.lk_i_leverans(uuid) to service_role;
