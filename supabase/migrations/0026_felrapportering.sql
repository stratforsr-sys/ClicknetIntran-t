-- =============================================================================
-- 0026_felrapportering.sql — E0.6: felrapportering.
--
-- ROADMAP sager "Sentry eller motsvarande". Det har ar motsvarande, och valet
-- ar inte en genvag utan foljer av beslut som redan star i repot:
--
--   1. K23. En stackspaning bar sokvag, employee_id och ibland ett varde ur en
--      rad. Sentry ar ett personuppgiftsbitrade till, och P0.6
--      registerforteckningen som ska redovisa det ar inte skriven. Samma skal
--      som blockerar E6.2 gallringsjobbet.
--   2. CSP. `connect-src` ar 'self' plus Supabase. En tredjepartsvard kraver
--      att den oppnas.
--   3. Larmvagen. Sentry larmar med mejl, och mejl ar pausat pa anvandarens
--      begaran. En felrapportering vars enda utgang ar avstangd mater inget.
--   4. A14-lardomen. Ett obesvarat leverantorsval ska inte blockera
--      funktionen. Egen tabell gar att byta mot Sentry senare; det omvanda
--      gar inte.
--
-- Poangen med epicet ar X7-piloten: tre personer som hittar buggar utan att de
-- nar nagon ar en pilot som inte mater nagot. Darfor finns bade den
-- automatiska vagen och knappen "Rapportera fel".
--
-- =============================================================================
-- EN AUTOMATISK RAPPORT AR EN GRUPP, INTE EN HANDELSE
--
-- Ett trasigt anrop pa startsidan ar inte ett fel per besok, det ar ETT fel som
-- traffat tjugo personer. Raderna dedupliceras darfor pa (digest, path) med ett
-- unikt index och en `on conflict`-uppdatering som raknar upp `occurrences`.
--
-- Det ar inte kosmetik. Utan det skriver en kraschloop tusen rader i minuten i
-- en tabell som ingen hinner lasa, och den forsta riktiga buggen begravs av den
-- andra. Manuella rapporter dedupliceras aldrig — tva personer som beskriver
-- samma sak med egna ord ar tva uppgifter, inte en.
--
-- =============================================================================
-- MEDDELANDET MASKERAS INNAN DET SKRIVS
--
-- En feltext ar ett tekniskt spar, men den kan bara persondata utan att nagon
-- bestamt det: postgres svarar `duplicate key value violates unique constraint
-- ... (email)=(anna@exempel.se)`, och da ligger en e-postadress i tabellen.
--
-- `maskera()` i src/lib/fel.ts tar bort e-postadresser, personnummerformade
-- strangar, uuid:n och vardet efter likhetstecknet i postgres detaljrader.
-- Den ar en ren funktion och provas i tests/fel.mjs. Skyddet ligger alltsa i
-- kod och inte i databasen — men det ligger pa ETT stalle som alla tre
-- skrivvagarna gar igenom, och det gar att prova.
--
-- Att maskera ar inte samma sak som att darfor fa slappa in fler lasare. Se
-- behorigheten langst ned.
-- =============================================================================

create table if not exists error_report (
  id          uuid primary key default gen_random_uuid(),

  -- 'automatic' = navet fangade felet sjalvt. 'manual' = en manniska tryckte
  -- pa knappen. De ar avsiktligt samma tabell: for den som ska laga nagot ar
  -- "sidan kraschade" och "sidan gjorde fel sak" samma ko, och en manuell
  -- rapport ar dessutom ofta den enda spar ett fel utan krasch lamnar.
  kind        text not null check (kind in ('automatic','manual')),

  -- Next ger klienten BARA en digest i produktion, aldrig meddelandet. Samma
  -- digest satts serverside av onRequestError, sa den ar den enda kopplingen
  -- mellan "anvandaren sag en trasig sida" och "det har var felet".
  digest      text,

  -- Sokvag UTAN query-strang. En query bar filter, sokord och ibland ett
  -- personnamn; sokvagen sager var felet lag, vilket ar det man behover.
  path        text not null,

  -- Maskerat. Null for en ren klientrapport, dar navet inte har texten.
  message     text,
  stack       text,

  -- Manuell rapport: personens egna ord. Maskeras INTE — en manniska som
  -- skriver "det gick fel nar jag oppnade Annas arende" menar det hon skriver,
  -- och en maskerad mening blir obegriplig. Formularet sager vem som lasar.
  body        text,

  -- Hindrade felet personen fran att jobba vidare? Ett kryss, inte en skala.
  -- En femgradig allvarlighetsgrad far tre pilotanvandare att fundera pa
  -- graderingen i stallet for pa felet.
  blocking    boolean not null default false,

  -- Vem som drabbades eller rapporterade. Nullbar med flit: ett fel kan intraffa
  -- fore inloggning, och da ar det viktigare att raden finns an att den har
  -- en avsandare.
  reporter_id uuid references employee(id) on delete set null,

  user_agent  text,

  -- Vercels commit-sha. Utan den gar det inte att se om ett fel redan ar lagat
  -- eller om det kom tillbaka.
  release     text,

  occurrences int not null default 1 check (occurrences > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),

  status      text not null default 'new' check (status in ('new','ack','closed')),
  handled_by  uuid references employee(id) on delete set null,
  handled_at  timestamptz,
  resolution  text,

  constraint error_report_manuell_har_text check (
    kind <> 'manual' or (body is not null and length(btrim(body)) > 0)
  ),

  -- En automatisk rapport utan digest gar inte att gruppera och inte att koppla
  -- ihop klient med server. Da ar den en anonym rad som sager "nagot hande".
  constraint error_report_automatisk_har_digest check (
    kind <> 'automatic' or digest is not null
  )
);

-- Grupperingsnyckeln. Partiellt, sa att manuella rapporter star utanfor.
create unique index if not exists error_report_grupp_idx
  on error_report (digest, path)
  where kind = 'automatic';

-- Kon: oatgardade forst, nyast overst.
create index if not exists error_report_ko_idx
  on error_report (status, last_seen_at desc);

create index if not exists error_report_reporter_idx
  on error_report (reporter_id);

-- -----------------------------------------------------------------------------
-- Grupperingen som en funktion
--
-- `occurrences` ska RAKNAS UPP, inte skrivas over, och det gar inte att uttrycka
-- i en vanlig upsert genom PostgREST. Darfor en funktion med `on conflict do
-- update`.
--
-- Den skriver aldrig over `message` och `stack` med null: den forsta traffen
-- kan komma fran servern med full text och den andra fran klientens felgrans
-- med bara en digest. `coalesce` at ratt hall gor att texten inte forsvinner
-- nar samma fel traffar en andra person.
--
-- Status rors inte heller. Ett fel som nagon avslutat och som kommer tillbaka
-- ska INTE tyst aterga till 'new' — men `last_seen_at` flyttas fram, och kon
-- visar avslutade rader som setts igen. Skillnaden ar att en manniska far se
-- att det kom tillbaka i stallet for att raden ser ut att aldrig ha atgardats.
-- -----------------------------------------------------------------------------

create or replace function public.registrera_fel(
  p_digest     text,
  p_path       text,
  p_message    text default null,
  p_stack      text default null,
  p_reporter   uuid default null,
  p_user_agent text default null,
  p_release    text default null
) returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  insert into public.error_report
    (kind, digest, path, message, stack, reporter_id, user_agent, release)
  values
    ('automatic', p_digest, p_path, p_message, p_stack, p_reporter, p_user_agent, p_release)
  on conflict (digest, path) where kind = 'automatic'
  do update set
    occurrences  = error_report.occurrences + 1,
    last_seen_at = now(),
    message      = coalesce(error_report.message, excluded.message),
    stack        = coalesce(error_report.stack, excluded.stack),
    release      = coalesce(excluded.release, error_report.release)
$$;

-- 0002 punkt 2: PostgREST exponerar varje funktion i public som ett RPC-anrop.
-- Utan detta kunde vem som helst posta godtyckliga felrapporter och fylla kon
-- med skrap — samma resonemang som for log_audit, och samma atgard.
revoke execute on function
  public.registrera_fel(text, text, text, text, uuid, text, text)
  from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Behorighet
--
-- Samma krets som handelseloggen: sales_manager, ceo, admin.
--
-- ADMIN AR MED HAR, TILL SKILLNAD FRAN I 0022 file_access_log. Skillnaden ar
-- avsiktlig och varr att skriva ut. Det 0020 stangde ute admin fran ar
-- uppgiften ATT NAGON AR SJUK. En rad i file_access_log bar precis det, eftersom
-- filen den pekar pa ar ett lakarintyg. En felrapport bar en sokvag och en
-- maskerad feltext — och den som ska laga felet ar admin.
--
-- Grunden for att det haller ar alltsa `maskera()`, inte en formulering har.
-- Faller maskeringen faller ocksa skalet att slappa in admin. Darfor provas den
-- i tests/fel.mjs, och darfor star `/franvaro/sjuk` med bland proven.
--
-- Den som RAPPORTERAT far dessutom se sin egen rapport. Utan det ar knappen en
-- brevlada utan lucka: man skickar in nagot och far aldrig veta om det lastes,
-- och slutar skicka. Det ar precis det beteendet piloten inte har rad med.
-- -----------------------------------------------------------------------------

alter table error_report enable row level security;

drop policy if exists error_report_read on error_report;
create policy error_report_read on error_report for select
  to authenticated
  using (
    public.has_any_role(array['sales_manager','ceo','admin'])
    or reporter_id = public.current_employee_id()
  );

-- Skrivning sker via server actions och /api/fel med service role, som pa
-- resten av navet (0002). Ingen insert-, update- eller delete-policy finns.
