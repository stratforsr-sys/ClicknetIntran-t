-- =============================================================================
-- 0027_rpc_stangs_for_klienten.sql
--
-- Hittad av det nya provet i tests/rls.mjs 2026-08-22: `registrera_fel` gick
-- att anropa som vanlig inloggad anvandare, trots revoken langst ned i 0026.
-- Samma prov visar att 0002 punkt 2 aldrig gjorde det den sager.
--
-- =============================================================================
-- REVOKE FRAN anon OCH authenticated TAR INTE BORT GRANTEN TILL PUBLIC
--
-- Postgres ger EXECUTE pa en ny funktion till PUBLIC som standard. Att sedan
-- skriva
--
--     revoke execute on function ... from anon, authenticated;
--
-- tar bort de EXPLICITA granterna till de tva rollerna — som aldrig fanns.
-- PUBLIC-granten star kvar, och `authenticated` ar en del av PUBLIC. Kommandot
-- gar igenom utan varning och andrar ingenting.
--
-- I ACL:en syns skillnaden som posten `=X/postgres`, alltsa "PUBLIC har
-- EXECUTE". Den fanns kvar pa bade log_audit och registrera_fel.
--
-- =============================================================================
-- FOLJDEN FOR log_audit
--
-- `log_audit` ar security definer och skriver till `audit_log`. Den har alltsa
-- sedan 0002 gatt att anropa fran vilken inloggad session som helst, via
-- PostgREST:s RPC-vag. En saljare kunde posta godtyckliga handelser till
-- handelseloggen.
--
-- Ingen data lackte — funktionen skriver, den laser inte, och `audit_log_read`
-- har hela tiden slappt in bara sales_manager, ceo och admin. Det som stod pa
-- spel ar loggens VARDE SOM BEVIS: en logg som vem som helst kan skriva i kan
-- inte anvandas till det AC-12.1 och K10 finns for.
--
-- Ingenting i navet anropar log_audit. Server actions skriver till audit_log
-- direkt med service role. Revoken nedan tar alltsa inte bort nagon vag som
-- anvands.
-- =============================================================================

revoke execute on function
  public.log_audit(text, text, text, text, jsonb)
  from public, anon, authenticated;

revoke execute on function
  public.registrera_fel(text, text, text, text, uuid, text, text)
  from public, anon, authenticated;

-- Service role behover bada: `registrera_fel` anropas av src/lib/fel-server.ts.
-- Ett revoke fran PUBLIC tar aven bort den vagen om den inte skrivs ut, och det
-- vore att stanga sjalva felrapporteringen i stallet for kryphalet.
grant execute on function
  public.log_audit(text, text, text, text, jsonb)
  to service_role;

grant execute on function
  public.registrera_fel(text, text, text, text, uuid, text, text)
  to service_role;

-- -----------------------------------------------------------------------------
-- Och for framtiden
--
-- Standardrattigheten galler varje NY funktion, sa nasta migration som skapar
-- en security definer-funktion har samma hal om ingen kommer ihag revoken.
-- `alter default privileges` flyttar regeln fran nagons minne till databasen.
--
-- Det galler bara funktioner som skapas HAREFTER av samma roll. Befintliga
-- funktioner rors inte, vilket ar skalet att de tva ovan star utskrivna.
--
-- Lasfunktionerna — current_employee_id, has_any_role, can_read_all_employees,
-- leads_employee, har_lonekostnadsbehorighet — behaller sina EXPLICITA granter
-- till anon och authenticated. De anropas inifran RLS-policyer och maste vara
-- korbara for den som fragar; utan dem ger varje tabell noll rader at alla.
-- -----------------------------------------------------------------------------

alter default privileges in schema public
  revoke execute on functions from public;
