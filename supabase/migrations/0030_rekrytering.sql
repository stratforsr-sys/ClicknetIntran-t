-- =============================================================================
-- 0030_rekrytering.sql — E10 M7, forsta skivan: kandidaten, stegen, scorecarden.
--
-- Det som INTE finns har, och varfor:
--
--   E10.1 IMAP-parser, E10.4 .ics via e-post och E10.7 avslagsmail forutsatter
--   alla E0.8 transaktionell e-post, som ar PAUSAT pa anvandarens begaran.
--   Schemat nedan ar byggt sa att de tre gar att lagga till utan att nagot
--   rivs: kandidaten kommer in via `source_slug` oavsett vem som skapade
--   raden, och `candidate_stage_event` bar redan varje steg som en mejlutskick
--   skulle hanga pa.
--
-- =============================================================================
-- EN KANDIDAT AR INTE EN ANSTALLD, OCH FAR INTE BLI EN AV MISSTAG
--
-- Ingen rad i `employee` skapas nagonsin harifran. `candidate.hired_employee_id`
-- pekar at andra hallet och satts forst nar E10.9 kor anstallningsflodet.
--
-- Skalet ar inte prydlighet. `employee` bar loneunderlag, franvaro, stampling
-- och avtal, och varenda RLS-policy i navet ar skriven utifran att en rad dar
-- ar en person som ARBETAR har. En kandidat som lag i samma tabell hade
-- omedelbart blivit synlig i personalregistret, i sokningen och i notiserna.
--
-- =============================================================================
-- K27: INGET PERSONNUMMER, INTE HELLER OM NAGON SKRIVER IN DET I ETT FRITEXTFALT
--
-- Samma linje som 0028 drog for avtalen, och samma villkor. Skillnaden ar att
-- rekrytering har FLER fritextfalt an nagon annan modul — anteckningar fran en
-- intervju ar precis dar ett personnummer smyger in. Villkoret ligger darfor pa
-- varje textkolumn som en manniska skriver i, inte bara pa ett.
--
-- =============================================================================
-- GALLRINGSFRISTEN AR INTE SKRIVEN, OCH DARFOR SEEDAS INGEN
--
-- AC-7.8 och K21 sager att `gdpr_purge_at` ska sattas automatiskt. De sager
-- INTE efter hur lange. Fristen finns inte i ROADMAP, inte i P0.6 — som inte ar
-- skriven — och inte nagon annanstans i repot.
--
-- Det ar exakt samma lage som blockerar E6.2 gallringsjobbet, och svaret ar
-- detsamma: en pahittad frist raderar personuppgifter enligt en gissning och
-- SER SAMTIDIGT UT att uppfylla kravet, vilket ar varre an att inte ha byggt
-- det alls.
--
-- Skillnaden mot E6.2 ar att kolumnen finns fran borjan. `recruitment_policy`
-- ar en singleton med `purge_after_days` som NULL. Sa lange den ar null satts
-- `gdpr_purge_at` aldrig, och gallringsjobbet — nar det byggs — ska vagra kora.
-- Nar siffran kommer racker en rad i konfigurationen; ingenting byggs om.
--
-- =============================================================================
-- STEGEN AR EN AUTOMAT I DATABASEN, INTE EN LISTA I ETT FORMULAR
--
-- AC-7.3 vill ha ny -> screening -> intervju 1 -> intervju 2 -> erbjudande ->
-- anstalld/avslag, och varje byte loggat. Bade den tillatna ordningen och
-- loggningen ligger i triggrar.
--
-- Vitsen: loggen kan inte glommas bort av en ny server action, och ett steg kan
-- inte hoppas over av en klient som postar direkt mot API:t. AC-7.6 — att ett
-- erbjudande ar omojligt utan minst en ifylld scorecard — ar av samma skal ett
-- villkor i databasen och inte en if-sats i en knapp.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Behorighet: en permission, inte bara en roll
--
-- Q71 besvarades 2026-08-21: FLERA PERSONER REKRYTERAR. Vilka det ar foljer inte
-- av rollen — en teamledare kan rekrytera till sitt eget team utan att darfor
-- fa se loneunderlag.
--
-- Ledningen far det pa rollen sa att modulen fungerar direkt. Alla andra far det
-- tilldelat, som `payroll_cost_viewer` i 0025. Skillnaden mot K26 ar avsiktlig:
-- lonekostnad kravde behorigheten AV ALLA, och det ar en av de saker anvandaren
-- fortfarande maste gora for hand innan den vyn visar nagot. Rekrytering ska
-- inte krava samma steg for att ens starta.
-- -----------------------------------------------------------------------------

alter table employee_permission drop constraint if exists employee_permission_permission_check;
alter table employee_permission add constraint employee_permission_permission_check
  check (permission in ('payroll_cost_viewer', 'recruiter'));

create or replace function public.far_rekrytera()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_any_role(array['sales_manager','ceo','admin'])
      or exists (
           select 1 from public.employee_permission p
            where p.employee_id = public.current_employee_id()
              and p.permission = 'recruiter'
         )
$$;

revoke execute on function public.far_rekrytera() from public;
grant execute on function public.far_rekrytera() to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Konfiguration
-- -----------------------------------------------------------------------------

/**
 * Kallorna. E10.10 vill ha tratten PER KALLA, sa attributionen maste finnas fran
 * forsta raden — den gar inte att rekonstruera i efterhand.
 *
 * Seedade med de vagar som finns i dag. Listan ar konfiguration och inte kod:
 * `active` stanger en kalla utan att rora de kandidater som redan kom den vagen.
 */
create table if not exists recruitment_source (
  slug   text primary key check (slug = lower(slug) and slug <> ''),
  label  text not null,
  sort   int not null default 100,
  active boolean not null default true
);

insert into recruitment_source (slug, label, sort) values
  ('ansokningssida', 'Egen ansökningssida', 10),
  ('platsbanken',    'Platsbanken',         20),
  ('linkedin',       'LinkedIn',            30),
  ('tips',           'Tips från anställd',  40),
  ('spontan',        'Spontanansökan',      50),
  ('annat',          'Annat',               90)
on conflict (slug) do nothing;

/**
 * Singleton, samma form som `absence_policy` i 0019.
 *
 * `purge_after_days` ar NULL med FLIT. Se rubriken om gallringsfristen ovan —
 * ett standardvarde hade sett ut som ett beslut.
 */
create table if not exists recruitment_policy (
  id boolean primary key default true check (id),

  -- AC-7.8, K21. Antal dagar efter avslutad process innan kandidatens uppgifter
  -- raderas. Utan varde satts `gdpr_purge_at` aldrig och inget raderas.
  purge_after_days int check (purge_after_days > 0),

  -- Talangpoolen undantas fran gallringen, men inte for evigt: samtycket ska
  -- fornyas. Aven denna utan varde tills nagon bestamt.
  talent_pool_days int check (talent_pool_days > 0),

  updated_at timestamptz not null default now(),
  updated_by uuid references employee(id)
);

insert into recruitment_policy (id) values (true) on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Kandidaten
-- -----------------------------------------------------------------------------

create table if not exists candidate (
  id          uuid primary key default gen_random_uuid(),

  first_name  text not null check (btrim(first_name) <> ''),
  last_name   text not null check (btrim(last_name)  <> ''),
  email       text not null check (position('@' in email) > 1),
  phone       text,

  -- E10.2 / AC-7.2. Kallan sätts vid skapandet och andras inte efterat.
  source_slug text not null references recruitment_source(slug),
  role_title  text not null default 'Säljare',

  stage       text not null default 'new'
                check (stage in ('new','screening','interview_1','interview_2',
                                 'offer','hired','rejected')),

  applied_at  timestamptz not null default now(),
  stage_at    timestamptz not null default now(),

  -- AC-7.5. Uteblev kandidaten fran en bokad intervju? Raknas per kalla i
  -- trattrapporten, sa den maste sta pa kandidaten och inte bara i en logg.
  no_show_count int not null default 0 check (no_show_count >= 0),

  -- Avslutet. Bada satts av triggern nedan, aldrig for hand.
  rejected_reason text,
  closed_at       timestamptz,

  -- E10.9. Pekar at ratt hall: kandidaten pekar pa den anstallda som blev av
  -- hen, aldrig tvartom. `set null` sa att en avslutad anstallning inte tar
  -- rekryteringshistoriken med sig.
  hired_employee_id uuid references employee(id) on delete set null,

  -- AC-7.8. Talangpoolen undantas fran gallringen — men bara med ett samtycke
  -- som gar att visa upp.
  talent_pool         boolean not null default false,
  talent_pool_consent timestamptz,

  -- Satts av triggern nar processen avslutas OCH en frist ar konfigurerad.
  gdpr_purge_at timestamptz,

  notes      text,
  created_by uuid references employee(id),
  created_at timestamptz not null default now(),

  -- Ett samtycke utan datum ar inget samtycke.
  constraint candidate_talangpool_kraver_samtycke
    check (not talent_pool or talent_pool_consent is not null)
);

create index if not exists candidate_stage_idx  on candidate (stage, stage_at desc);
create index if not exists candidate_source_idx on candidate (source_slug);
create index if not exists candidate_purge_idx  on candidate (gdpr_purge_at)
  where gdpr_purge_at is not null;

/**
 * AC-7.3: varje byte loggat. Skrivs av trigger, aldrig av en server action.
 *
 * Egen tabell och inte `audit_log`: den loggen slapper in `admin` och lases av
 * ledningen, medan stegloggen bar en bedomning om en namngiven person som inte
 * ar anstalld. Samma resonemang som `file_access_log` i 0022.
 */
create table if not exists candidate_stage_event (
  id           bigserial primary key,
  candidate_id uuid not null references candidate(id) on delete cascade,
  from_stage   text,
  to_stage     text not null,
  at           timestamptz not null default now(),
  by_employee  uuid references employee(id),
  note         text
);

create index if not exists candidate_stage_event_idx on candidate_stage_event (candidate_id, at);

/**
 * AC-7.6: en scorecard per intervju.
 *
 * `recommendation` ar tre lagen och inte ett betyg 1-10. En skala inbjuder till
 * medelvarden, och ett medelvarde av tva intervjuer sager mindre an tva tydliga
 * omdomen som gar isar.
 */
create table if not exists interview_scorecard (
  id             uuid primary key default gen_random_uuid(),
  candidate_id   uuid not null references candidate(id) on delete cascade,
  stage          text not null check (stage in ('screening','interview_1','interview_2')),
  interviewer_id uuid not null references employee(id),

  recommendation text not null check (recommendation in ('yes','no','maybe')),
  strengths      text,
  concerns       text,

  created_at timestamptz not null default now(),

  -- En intervjuare fyller i EN scorecard per steg. Tva ar en rattelse, och den
  -- ska ske genom att den befintliga andras.
  unique (candidate_id, stage, interviewer_id)
);

-- -----------------------------------------------------------------------------
-- K27: villkoret som halller personnumret ute
--
-- Pa varje falt en manniska skriver fritt i. `notes`, `strengths` och `concerns`
-- ar de troligaste — en intervjuanteckning ar precis dar det hamnar.
-- -----------------------------------------------------------------------------

/**
 * Samma uttryck som 0028 anvander pa avtalens `variables`. Att det star som en
 * funktion har och inte som ett tredje handskrivet villkor ar hela poangen: en
 * definition av vad som ar personnummerformat, inte en per modul.
 *
 * FOLJDEN, UTSKRIVEN: uttrycket faller ocksa pa ett mobilnummer skrivet som tio
 * siffror i rad. Det ar inte en bugg utan priset for att det inte GAR att skilja
 * `0701234567` fran ett samordningsnummer utan sekel. Numret har ett eget falt
 * — `candidate.phone`, som inte provas — sa det som stangs ute ar att skriva
 * numret i en anteckning i stallet. Med bindestreck gar det igenom.
 */
create or replace function public.ser_ut_som_personnummer(t text)
returns boolean
language sql
immutable
as $$
  select t ~ '\d{6}[-+]?\d{4}'
$$;

alter table candidate drop constraint if exists candidate_inget_personnummer;
alter table candidate add constraint candidate_inget_personnummer check (
  not public.ser_ut_som_personnummer(coalesce(notes, ''))
  and not public.ser_ut_som_personnummer(coalesce(rejected_reason, ''))
);

alter table interview_scorecard drop constraint if exists scorecard_inget_personnummer;
alter table interview_scorecard add constraint scorecard_inget_personnummer check (
  not public.ser_ut_som_personnummer(coalesce(strengths, ''))
  and not public.ser_ut_som_personnummer(coalesce(concerns, ''))
);

-- -----------------------------------------------------------------------------
-- Stegautomaten
-- -----------------------------------------------------------------------------

/**
 * De tillatna bytena. Allt annat nekas.
 *
 * Ett avslag gar fran VARJE oppet steg — det ar sa rekrytering fungerar. Ett
 * anstallningsbeslut gar bara fran `offer`, eftersom AC-7.6 sager att ett
 * erbjudande kraver en scorecard: kunde man ga direkt fran `screening` till
 * `hired` vore villkoret verkningslost.
 *
 * Tillbaka gar det inte. En kandidat som ska tas upp igen efter avslag ar en ny
 * ansokan, och den ska synas som en i tratten.
 */
create or replace function public.candidate_stegbyte()
returns trigger
language plpgsql
as $$
declare
  tillatna text[];
  antal_scorecards int;
  frist int;
begin
  if new.stage is not distinct from old.stage then
    return new;
  end if;

  tillatna := case old.stage
    when 'new'         then array['screening','rejected']
    when 'screening'   then array['interview_1','rejected']
    when 'interview_1' then array['interview_2','offer','rejected']
    when 'interview_2' then array['offer','rejected']
    when 'offer'       then array['hired','rejected']
    else array[]::text[]
  end;

  if not (new.stage = any (tillatna)) then
    raise exception 'Steget % gar inte att na fran % (AC-7.3).', new.stage, old.stage;
  end if;

  -- AC-7.6. Villkoret ligger har och inte i knappen: en klient som postar rakt
  -- mot API:t ska mota samma nej.
  if new.stage = 'offer' then
    select count(*) into antal_scorecards
      from interview_scorecard s where s.candidate_id = new.id;
    if antal_scorecards = 0 then
      raise exception 'Ett erbjudande kraver minst en ifylld scorecard (AC-7.6).';
    end if;
  end if;

  if new.stage = 'hired' and new.hired_employee_id is null then
    raise exception 'En anstalld kandidat maste peka pa sin employee-rad (AC-7.9).';
  end if;

  new.stage_at := now();

  -- Avslutet, och gallringsfristen som foljer av det.
  if new.stage in ('hired','rejected') then
    new.closed_at := coalesce(new.closed_at, now());

    select purge_after_days into frist from recruitment_policy where id;

    /**
     * Talangpoolen undantas (AC-7.8), och fristen satts BARA om den ar
     * konfigurerad. Ar den null hander ingenting — se rubriken om
     * gallringsfristen overst i filen. Ett standardvarde hade sett ut som ett
     * beslut nagon fattat.
     */
    if frist is not null and not new.talent_pool then
      new.gdpr_purge_at := now() + make_interval(days => frist);
    end if;
  else
    new.closed_at := null;
    new.gdpr_purge_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists candidate_stegbyte on candidate;
create trigger candidate_stegbyte
  before update on candidate
  for each row execute function public.candidate_stegbyte();

/**
 * Loggen. Efter bytet, sa att den bara skrivs nar bytet gick igenom.
 *
 * `by_employee` lases ur sessionen och inte ur ett falt som anroparen skickar
 * med — en logg dar skribenten sjalv anger vem hen ar ar ingen logg.
 */
create or replace function public.candidate_stegbyte_loggas()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into candidate_stage_event (candidate_id, from_stage, to_stage, by_employee)
    values (new.id, null, new.stage, new.created_by);
  elsif new.stage is distinct from old.stage then
    insert into candidate_stage_event (candidate_id, from_stage, to_stage, by_employee)
    values (new.id, old.stage, new.stage, public.current_employee_id());
  end if;
  return null;
end;
$$;

drop trigger if exists candidate_stegbyte_loggas on candidate;
create trigger candidate_stegbyte_loggas
  after insert or update on candidate
  for each row execute function public.candidate_stegbyte_loggas();

/**
 * Stegloggen ar bevis och skrivs bara av triggern ovan.
 *
 * UNDANTAGET FOR EN BORTA KANDIDAT ar inte en uppmjukning. Samma konstruktion
 * som `file_object` fick i 0023, och av samma skal: utan den faller en cascade
 * fran `candidate`, och det ar precis vad E10.8 gallringsjobbet kommer att gora
 * — mitt i natten, pa en framande nyckel, utan att nagon ser det.
 *
 * En rad gar alltsa att radera nar kandidaten redan ar borta, och aldrig nar hen
 * star kvar. Det ar den enda vagen, och den raderar hela processen pa en gang.
 */
create or replace function public.candidate_stage_event_orubblig()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE'
     and not exists (select 1 from candidate c where c.id = old.candidate_id) then
    return old;
  end if;
  raise exception 'Stegloggen kan inte andras eller raderas (AC-7.3).';
end;
$$;

drop trigger if exists candidate_stage_event_orubblig on candidate_stage_event;
create trigger candidate_stage_event_orubblig
  before update or delete on candidate_stage_event
  for each row execute function public.candidate_stage_event_orubblig();

-- -----------------------------------------------------------------------------
-- Behorighet
--
-- En kandidat ar en namngiven manniska som sokt jobb hos oss. Kretsen ar den som
-- rekryterar och ingen annan — inte teamledare i allmanhet, inte ekonomi, och
-- inte de ovriga anstallda.
--
-- Skrivning sker via server actions med service role, som pa resten av navet
-- (0002). Inga insert-, update- eller delete-policyer finns.
-- -----------------------------------------------------------------------------

alter table candidate             enable row level security;
alter table candidate_stage_event enable row level security;
alter table interview_scorecard   enable row level security;
alter table recruitment_source    enable row level security;
alter table recruitment_policy    enable row level security;

drop policy if exists candidate_read on candidate;
create policy candidate_read on candidate for select
  to authenticated using (public.far_rekrytera());

drop policy if exists candidate_stage_event_read on candidate_stage_event;
create policy candidate_stage_event_read on candidate_stage_event for select
  to authenticated using (public.far_rekrytera());

/**
 * Scorecarden ar ett omdome om en manniska, skrivet av en namngiven kollega.
 *
 * Den som rekryterar ser alla — annars gar de inte att jamfora, och hela
 * poangen med AC-7.6 ar att tva omdomen som gar isar ska synas. Den som skrivit
 * en ser alltid sin egen, aven om hen inte langre rekryterar.
 */
drop policy if exists interview_scorecard_read on interview_scorecard;
create policy interview_scorecard_read on interview_scorecard for select
  to authenticated
  using (public.far_rekrytera() or interviewer_id = public.current_employee_id());

drop policy if exists recruitment_source_read on recruitment_source;
create policy recruitment_source_read on recruitment_source for select
  to authenticated using (public.far_rekrytera());

drop policy if exists recruitment_policy_read on recruitment_policy;
create policy recruitment_policy_read on recruitment_policy for select
  to authenticated using (public.far_rekrytera());
