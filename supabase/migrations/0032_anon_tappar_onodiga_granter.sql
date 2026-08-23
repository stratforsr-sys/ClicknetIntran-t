-- =============================================================================
-- 0032_anon_tappar_onodiga_granter.sql
--
-- Punkt 4 ur sakerhetsgenomgangen 2026-08-23: `anon` har execute pa femton av
-- navets egna funktioner. Ingen av dem lacker nagot till den som inte ar
-- inloggad, men granten behovs inte, och en rattighet som inte behovs ar en
-- rattighet ingen tanker pa nasta gang funktionen andras.
--
-- =============================================================================
-- VARFOR GRANTEN FANNS
--
-- 0002 och framat gav las- och behorighetsfunktionerna
--
--     grant execute on function ... to anon, authenticated;
--
-- Skalet till `authenticated` ar riktigt och star kvar: funktionerna anropas
-- INIFRAN RLS-policyer, och en policy utvarderas som den fragande rollen. Utan
-- granten ger varje tabell noll rader at alla — det ar utskrivet langst ned i
-- 0027 och galler fortfarande.
--
-- `anon` foljde med pa samma rad av vana. Den behovs inte:
--
--   1. Ingen policy i navet galler rollen anon. Enda traffen i pg_policies ar
--      `filer_ar_stangd` pa storage.objects, som ar RESTRIKTIV, nekar hela
--      bucketen `filer` och inte anropar nagon av funktionerna nedan.
--   2. Ingen utloggad vag ror databasen med anon-nyckeln. `/uppstart` ar den
--      enda utloggade sidan som laser nagot alls, och den anvander service
--      role.
--
-- =============================================================================
-- VAD SOM INTE ANDRAS
--
-- `authenticated` behaller allt. Det ar granten som far RLS att fungera.
--
-- TRIGGERFUNKTIONERNA ROR JAG INTE. Tjugotva av dem har samma PUBLIC-arvda
-- grant, men en funktion som returnerar `trigger` gar inte att anropa via
-- PostgREST — den exponeras aldrig som RPC. Att revoka dem hade varit att ta
-- risken att en trigger slutar brinna for att vinna ingenting.
--
-- Extensionsfunktionerna (btree_gist, ~190 stycken) ags av extensionen och
-- hor inte hit.
-- =============================================================================

-- =============================================================================
-- OCH SA TRAMPADE JAG I 0027:s EGEN FALLA
--
-- Forsta versionen av den har migrationen skrev bara
--
--     revoke execute on function ... from anon;
--
-- Sjalvkontrollen langst ned fallde den: TRETTON av de femton hade kvar sin
-- execute. Skalet ar exakt det 0027 skrev upp och som jag anda gick pa —
-- tretton av dem har ingen EXPLICIT anon-grant. De har PUBLIC-granten som
-- Postgres ger varje ny funktion, och `authenticated` och `anon` ar bada delar
-- av PUBLIC. Ett revoke fran anon tar bort en grant som inte finns.
--
-- Tva bet: `far_hantera_avtal` (0028) och `far_rekrytera` (0030) skrevs med
-- `to anon, authenticated, service_role` och hade darfor en riktig grant att
-- ta bort.
--
-- Ratt form ar alltsa att ta PUBLIC-granten och ge tillbaka explicit till de
-- roller som faktiskt behover den. Det ar samma ordning som 0027 anvande for
-- log_audit och registrera_fel.
--
--   authenticated  behovs — funktionerna anropas inifran RLS-policyer och
--                  utvarderas som den fragande rollen.
--   service_role   behovs for minst `sparr_saknas`, som anropas rakt av
--                  src/lib/sparrar.ts med admin-klienten. De ovriga far den
--                  ocksa: service role kringgar anda RLS, sa granten flyttar
--                  ingen grans, och en halv lista ar svarare att lita pa.
--
-- Att revoken kors FORE granten i samma transaktion spelar roll: tvartom hade
-- revoken tagit bort den nya granten igen.
-- =============================================================================

revoke execute on function public.can_edit_documents()             from public, anon;
revoke execute on function public.can_read_all_employees()         from public, anon;
revoke execute on function public.current_employee_id()            from public, anon;
revoke execute on function public.far_hantera_avtal()              from public, anon;
revoke execute on function public.far_hantera_provision()          from public, anon;
revoke execute on function public.far_rekrytera()                  from public, anon;
revoke execute on function public.har_lonekostnadsbehorighet()     from public, anon;
revoke execute on function public.has_any_role(text[])             from public, anon;
revoke execute on function public.has_role(text)                   from public, anon;
revoke execute on function public.kraver_losenordsbyte()           from public, anon;
revoke execute on function public.leads_employee(uuid)             from public, anon;
revoke execute on function public.matches_audience(text[], uuid[]) from public, anon;
revoke execute on function public.ser_ut_som_personnummer(text)    from public, anon;
revoke execute on function public.sparr_saknas(text)               from public, anon;
revoke execute on function public.standard_review_due(text)        from public, anon;

grant execute on function public.can_edit_documents()             to authenticated, service_role;
grant execute on function public.can_read_all_employees()         to authenticated, service_role;
grant execute on function public.current_employee_id()            to authenticated, service_role;
grant execute on function public.far_hantera_avtal()              to authenticated, service_role;
grant execute on function public.far_hantera_provision()          to authenticated, service_role;
grant execute on function public.far_rekrytera()                  to authenticated, service_role;
grant execute on function public.har_lonekostnadsbehorighet()     to authenticated, service_role;
grant execute on function public.has_any_role(text[])             to authenticated, service_role;
grant execute on function public.has_role(text)                   to authenticated, service_role;
grant execute on function public.kraver_losenordsbyte()           to authenticated, service_role;
grant execute on function public.leads_employee(uuid)             to authenticated, service_role;
grant execute on function public.matches_audience(text[], uuid[]) to authenticated, service_role;
grant execute on function public.ser_ut_som_personnummer(text)    to authenticated, service_role;
grant execute on function public.sparr_saknas(text)               to authenticated, service_role;
grant execute on function public.standard_review_due(text)        to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Kontrollen
--
-- Migrationen litar inte pa sina egna revoke-rader. Den fragar databasen om
-- resultatet och river hela transaktionen om nagot star kvar. Det var precis
-- den har kontrollen som hittade felet ovan — och som gor att nasta funktion
-- som glider in med en PUBLIC-grant syns direkt i stallet for om tre manader.
-- -----------------------------------------------------------------------------
do $$
declare
  kvar text;
begin
  select string_agg(p.proname, ', ' order by p.proname)
    into kvar
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
  join pg_type t on t.oid = p.prorettype
  where n.nspname = 'public'
    and d.objid is null
    and t.typname <> 'trigger'
    and has_function_privilege('anon', p.oid, 'execute');

  if kvar is not null then
    raise exception 'anon har fortfarande execute pa: %', kvar;
  end if;
end $$;
