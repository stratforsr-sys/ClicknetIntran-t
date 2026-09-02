-- =============================================================================
-- 0044_losenordstvang_ur_databasen.sql
--
-- `kraver_losenordsbyte()` laser flaggan ur ANVANDARRADEN i stallet for ur
-- tokenen. En rad SQL, och skalet ar hela den har rubriken.
--
-- =============================================================================
-- EN FLAGGA PA TVA STALLEN MED OLIKA FARSKHET
--
-- 0017 la sparren i databasen och lat den lasa `app_metadata` ur JWT:n. Det var
-- gratis — svaret foljde med i tokenen och kostade ingen tabellasning.
--
-- Priset visade sig i stallet vara att flaggan darmed fanns pa TVA stallen:
--
--   hos Auth      i `auth.users.raw_app_meta_data`, dar den SKRIVS
--   i tokenen     en kopia som frystes nar tokenen utfardades
--
-- Mellanvaran laser den forsta med `getUser()`. Databasen laste den andra. Och
-- en token ar signerad och lever i en timme: mellan skrivningen och nasta
-- fornyelse sa de tva olika saker om samma person. Bada hallen gick fel.
--
-- TVANGET LYFTS (den som byter sitt tillfalliga losenord):
--   mellanvaran  ser falskt  -> slapper in i navet
--   databasen    ser sant    -> noll rader ur employee
-- Personen blev inloggad utan ratt att lasa ens sin egen rad, och
-- (app)-layouten kunde bara tolka `employee: null` pa ett satt: "Vantar pa
-- aktivering". Det hande varje nyanstalld, varje gang, i upp till en timme.
-- Rattades 2026-09-02 genom att sessionen fornyas nar flaggan lyfts — se
-- src/lib/losenordsbyte-server.ts. Den rattningen star kvar och ar fortfarande
-- ratt: tokenen SKA bara farsk. Men den var ett plaster pa symtomet.
--
-- TVANGET SATTS (chefen aterstaller nagons losenord):
--   mellanvaran  ser sant    -> skickar till /byt-losenord
--   databasen    ser falskt  -> ger ut data som vanligt
-- Alltsa exakt det hal 0017 byggdes for att stanga, bara med en timmes
-- livslangd i stallet for obegransad. Den som redan har en session behaller
-- sin atkomst mot PostgREST tills tokenen forfaller — och att ga rakt pa
-- API:t forbi navets sidor var hela angreppet i 0017:s inledning.
--
-- Ingen av de tva gar att ratta genom att skriva pa den andra sidan. Sa lange
-- svaret hamtas ur en kopia som ar upp till en timme gammal finns glappet
-- kvar. Darfor tas kopian bort ur ekvationen: `auth.users` ar det stalle
-- flaggan SKRIVS, och nu ocksa det enda stalle den LASES.
--
-- =============================================================================
-- VAD DET KOSTAR — och varfor "kostar ingen tabellasning" inte var argumentet
-- det sag ut som
--
-- Fragan ar oberoende av vilken rad som provas: den namner ingen kolumn fran
-- den yttre tabellen. Planeraren gor den darfor till en InitPlan och kor den EN
-- gang per fraga, inte en gang per rad. Det ar samma sak som redan sker med
-- `has_any_role()` och `current_employee_id()`, som bada gor tyngre jobb an det
-- har och sitter i samma policyer.
--
-- Uppslaget ar dessutom en primarnyckeltraff i en tabell med sa manga rader som
-- bolaget har anstallda.
--
-- SECURITY DEFINER kravs. `authenticated` far inte lasa `auth.users`, och det
-- ska den inte heller — funktionen lamnar ut en boolean om den som fragar, och
-- ingenting annat. `search_path` ar spikad av samma skal som i alla andra
-- funktioner i navet.
-- =============================================================================

create or replace function public.kraver_losenordsbyte()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select (u.raw_app_meta_data ->> 'byt_losenord') = 'true'
       from auth.users u
      where u.id = auth.uid()),
    false)
$$;

comment on function public.kraver_losenordsbyte() is
  'Sant nar kontot annu inte bytt sitt tillfalliga losenord. Laser flaggan ur '
  'auth.users och INTE ur tokenen — se 0044 for varfor. Anvands for att stanga '
  'API:t for de kontona. Infordes i 0017.';

-- -----------------------------------------------------------------------------
-- Villkoret ar oforandrat i ovrigt, och det ar viktigt.
--
-- `= 'true'` och ingenting annat. Saknas faltet blir jamforelsen null, den inre
-- fragan ger ingen rad, och `coalesce` gor bada fallen till false. En sparr som
-- utloses av att ett falt SAKNAS hade stangt ute varenda konto som lades upp
-- fore 0017. Samma regel som `kraverByte()` i src/lib/losenordsbyte.ts.
--
-- Service role har fortfarande ingen `request.jwt.claims`, alltsa ingen
-- `auth.uid()`, alltsa ingen rad och svaret false. Servern ser som forr vem
-- personen ar aven nar API:t ar stangt for henne — /byt-losenord maste kunna
-- hamta namnet, och steg tva rollerna. Se rubriken "GRANSEN GAR VID API:t" i
-- 0017.
--
-- Ingen av de fem hjalpfunktionerna och ingen policy rors. De anropar den har
-- funktionen och far det nya svaret gratis.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- Kvittot.
--
-- Tva avlasningar, en per hall som var trasigt. Bada satter en HANDSKRIVEN
-- `request.jwt.claims` som sager MOTSATSEN till vad anvandarraden sager — och
-- kraver att funktionen foljer raden. Fore den har migrationen faller de bada.
--
-- `set_config(..., true)` ar transaktionslokal och forsvinner nar migrationen
-- committar. Migrationskoraren kor varje fil i en transaktion.
-- -----------------------------------------------------------------------------

do $$
declare
  provperson uuid;
  svar boolean;
begin
  -- Hall 1: raden sager nej, tokenen sager ja. Ska bli nej.
  select id into provperson
    from auth.users
   where coalesce(raw_app_meta_data ->> 'byt_losenord', 'false') <> 'true'
   limit 1;

  if provperson is not null then
    perform set_config('request.jwt.claims',
      json_build_object('sub', provperson,
                        'app_metadata', json_build_object('byt_losenord', true))::text,
      true);
    svar := public.kraver_losenordsbyte();
    perform set_config('request.jwt.claims', '', true);

    if svar then
      raise exception
        'kraver_losenordsbyte() laser fortfarande tokenen — ett konto utan tvang sparrades ute';
    end if;
  end if;

  -- Hall 2: raden sager ja, tokenen sager nej. Ska bli ja. Det har ar
  -- sakerhetshallet — misslyckas den star halet fran 0017 vidoppet.
  select id into provperson
    from auth.users
   where (raw_app_meta_data ->> 'byt_losenord') = 'true'
   limit 1;

  if provperson is not null then
    perform set_config('request.jwt.claims',
      json_build_object('sub', provperson,
                        'app_metadata', json_build_object('byt_losenord', false))::text,
      true);
    svar := public.kraver_losenordsbyte();
    perform set_config('request.jwt.claims', '', true);

    if not svar then
      raise exception
        'kraver_losenordsbyte() laser fortfarande tokenen — ett flaggat konto slapptes igenom';
    end if;
  end if;

  -- Service role har ingen claim alls och ska aldrig sparras ut har.
  perform set_config('request.jwt.claims', '', true);
  if public.kraver_losenordsbyte() then
    raise exception 'kraver_losenordsbyte() sant utan token — service role skulle sparras ute';
  end if;
end;
$$;
