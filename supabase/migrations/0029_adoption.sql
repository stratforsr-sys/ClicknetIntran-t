-- =============================================================================
-- 0029_adoption.sql — E6.5 / AC-12.5: adoptionsstatistik.
--
-- Tre matt: DAU/WAU, sokningar utan traff, och dokument som ingen oppnat pa 90
-- dagar. Piloten (X7) ar skalet att de behovs nu — tre personer i tva veckor
-- ska visa om navet anvands, och utan siffrorna ar svaret en kansla.
--
-- =============================================================================
-- VARFOR EN EGEN TABELL OCH INTE audit_log
--
-- `audit_log` bar SKRIVNINGAR: roller, konton, offboarding. En saljare som
-- loggar in, laser tre rutiner och gar hem skriver ingenting alls dar. En DAU
-- raknad ur handelseloggen hade darfor matt hur manga som ANDRAR nagot, inte
-- hur manga som ANVANDER navet — och for en pilot ar det senare hela fragan.
-- Siffran hade dessutom sett rimlig ut, vilket ar det som gor den farlig.
--
-- `auth.users.last_sign_in_at` bar bara senaste gangen och kan inte svara pa
-- hur manga som var inne i tisdags.
--
-- =============================================================================
-- activity_day BAR EN DAG, INTE ETT SPAR
--
-- En rad per person och dygn. Inget klockslag, ingen sokvag, ingen sida.
--
-- Det ar en medveten grans och inte en forenkling. En tabell med tidpunkt och
-- sokvag hade blivit ett register over vad varje anstalld gor timme for timme.
-- Navet har redan en narvaroregistrering (M2) med rattelse, attest och
-- lonepaverkan omkring sig; ett andra, informellt spar utan den styrningen ar
-- sadant som ser ofarligt ut nar det byggs och anvands till nagot annat nar det
-- val finns. Dagen racker for DAU/WAU, och mer behovs inte.
--
-- Darfor har `activity_day` INGEN select-policy. RLS ar paslagen och ingen
-- policy slapper igenom nagon — per-person-raderna gar inte att lasa via API:t,
-- inte ens for saljchefen. Siffrorna kommer ut genom `adoption_aktivitet()`,
-- som svarar med antal och aldrig med namn.
--
-- Raden foljer daremot med i REGISTERUTDRAGET (E6.4, artikel 15). Den handlar
-- om personen, alltsa har hen ratt att fa ut den. Utdraget kors med service
-- role och paverkas inte av att policyn saknas. `activity_day` star i KALLOR i
-- src/lib/registerutdrag.ts — utan den raden faller tests/registerutdrag.mjs,
-- vilket ar precis vad den kontrollen finns till for.
--
-- =============================================================================
-- search_miss BAR INGEN PERSON
--
-- AC-12.5 fragar vad folk soker efter UTAN att hitta. Svaret behover texten,
-- inte vem som skrev den, och en sokstrang kan innehalla ett namn eller ett
-- arende. Tabellen har darfor ingen `employee_id` alls — inte en policy som
-- doljer den, utan ingen kolumn att dolja.
--
-- En rad per unik strang med en raknare, samma form som `error_report` i 0026
-- och av samma skal: en logg per sokning hade vaxt utan tak och sagt mindre.
-- Normaliseringen och kapningen sker i funktionen, aldrig i klienten.
-- =============================================================================

create table if not exists activity_day (
  employee_id uuid not null references employee(id) on delete cascade,
  day         date not null,
  primary key (employee_id, day)
);

-- Fragorna gar per dag over ett fonster, aldrig per person.
create index if not exists activity_day_dag_idx on activity_day (day);

create table if not exists search_miss (
  -- Strangen ar nyckeln. Villkoret speglar det `registrera_sokmiss` gor, sa att
  -- en rad som kommer in nagon annan vag inte kan ha en annan form.
  q           text primary key
                check (q = lower(btrim(q)) and length(q) between 1 and 100),
  occurrences int not null default 1 check (occurrences > 0),
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);

create index if not exists search_miss_antal_idx on search_miss (occurrences desc);

-- -----------------------------------------------------------------------------
-- Skrivvagarna
--
-- Bada ar security definer, eftersom ingen av tabellerna har nagon insert-policy
-- och inte ska ha nagon. Sedan 0027 ar en ny funktion stangd for klienten som
-- standard, sa granterna nedan star utskrivna.
-- -----------------------------------------------------------------------------

/**
 * Stampla att den inloggade anvant navet i dag.
 *
 * Anropas fran mellanvaran, som halls tillbaka av en kaka sa att det blir hogst
 * ett anrop per person, enhet och dygn. Primarnyckeln gor det ofarligt om kakan
 * saknas: `on conflict do nothing` skriver aldrig samma dag tva ganger.
 *
 * Utan employee-rad (ett auth-konto som inte ar anstalld) blir det ingen rad
 * alls i stallet for ett fel — mellanvaran ska inte kunna falla pa statistik.
 */
create or replace function public.registrera_aktivitet()
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  insert into activity_day (employee_id, day)
  select public.current_employee_id(), current_date
   where public.current_employee_id() is not null
  on conflict (employee_id, day) do nothing
$$;

/**
 * Bokfor en sokning som inte gav nagon traff.
 *
 * Anropas fran /sok NAR traffarna raknats till noll. Texten normaliseras har
 * och inte hos den som ringer: annars hade "Semester" och "semester " blivit
 * tva rader, och topplistan hade delat upp sig sjalv.
 *
 * En strang som ar tom efter trimning bokfors inte — det ar ingen sokning.
 *
 * Den YTTRE btrim ar inte overflodig. Kapningen till 100 tecken kan sluta mitt
 * i ett mellanslag, och da hade `q = lower(btrim(q))` i tabellvillkoret nekat
 * raden — en lang sokning hade fallit i stallet for att bokforas.
 */
create or replace function public.registrera_sokmiss(p_q text)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  insert into search_miss (q)
  select btrim(left(lower(btrim(p_q)), 100))
   where btrim(coalesce(p_q, '')) <> ''
  on conflict (q) do update
     set occurrences = search_miss.occurrences + 1,
         last_seen   = now()
$$;

revoke execute on function public.registrera_aktivitet()      from public, anon;
revoke execute on function public.registrera_sokmiss(text)    from public, anon;
grant  execute on function public.registrera_aktivitet()      to authenticated, service_role;
grant  execute on function public.registrera_sokmiss(text)    to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Lasvagarna
--
-- Samma krets som handelseloggen: sales_manager, ceo, admin. Teamledaren star
-- utanfor — adoption ar en fraga om navet, inte om hennes team, och en siffra
-- per team hade varit ett steg mot just den per-person-uppfoljning som
-- `activity_day` ar byggd for att inte mojliggora.
--
-- Rollvillkoret star som ett `where` i varje funktion. Fel roll far darmed noll
-- rader i stallet for ett fel, vilket ar samma svar som RLS ger pa resten av
-- navet — och det som X6 provar.
-- -----------------------------------------------------------------------------

/**
 * DAU och WAU per dag, senaste `p_dagar` dagarna.
 *
 * WAU ar INTE summan av sju DAU. Den ar antalet SKILDA personer i ett rullande
 * sjudagarsfonster som slutar den dagen — samma person tva dagar i rad raknas
 * en gang. Skillnaden ar hela poangen med mattet: DAU delat med WAU sager hur
 * ofta de som anvander navet kommer tillbaka.
 */
create or replace function public.adoption_aktivitet(p_dagar int default 30)
returns table (dag date, dau int, wau int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select g.d::date as dag,
         (select count(distinct a.employee_id)::int
            from activity_day a where a.day = g.d::date) as dau,
         (select count(distinct a.employee_id)::int
            from activity_day a
           where a.day <= g.d::date and a.day > g.d::date - 7) as wau
    from generate_series(
           current_date - (greatest(1, least(coalesce(p_dagar, 30), 365)) - 1),
           current_date,
           interval '1 day'
         ) as g(d)
   where public.has_any_role(array['sales_manager','ceo','admin'])
   order by 1
$$;

/** De vanligaste sokningarna som inte gav nagon traff. */
create or replace function public.adoption_sokmissar(p_antal int default 20)
returns table (q text, antal int, senast timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.q, m.occurrences, m.last_seen
    from search_miss m
   where public.has_any_role(array['sales_manager','ceo','admin'])
   order by m.occurrences desc, m.last_seen desc
   limit greatest(1, least(coalesce(p_antal, 20), 100))
$$;

/**
 * Publicerade dokument som ingen oppnat pa `p_dagar` dagar.
 *
 * "Ingen visning alls" och "ingen visning pa lange" ar samma svar har, med
 * flit: bada betyder att rutinen inte lases. `senast` skiljer dem at for den
 * som vill veta vilket det ar.
 *
 * Utkast och arkiverade star utanfor. Ett utkast ar inte publicerat och ett
 * arkiverat dokument SKA inte lasas — bada hade fyllt listan med rader som
 * inte ar nagot att gora nagot at.
 */
create or replace function public.adoption_glomda_dokument(p_dagar int default 90)
returns table (id uuid, slug text, title text, senast timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.id, d.slug, d.title, max(v.last_seen) as senast
    from document d
    left join document_view v on v.document_id = d.id
   where public.has_any_role(array['sales_manager','ceo','admin'])
     and d.status = 'published'
   group by d.id, d.slug, d.title
  having max(v.last_seen) is null
      or max(v.last_seen) < now() - make_interval(days => greatest(1, least(coalesce(p_dagar, 90), 3650)))
   order by senast asc nulls first, d.title
$$;

revoke execute on function public.adoption_aktivitet(int)        from public, anon;
revoke execute on function public.adoption_sokmissar(int)        from public, anon;
revoke execute on function public.adoption_glomda_dokument(int)  from public, anon;
grant  execute on function public.adoption_aktivitet(int)        to authenticated, service_role;
grant  execute on function public.adoption_sokmissar(int)        to authenticated, service_role;
grant  execute on function public.adoption_glomda_dokument(int)  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- RLS: paslagen, och utan select-policy pa bada tabellerna.
--
-- Det ar inte ett forbiseende. Skalen star i rubrikerna ovan: per-person-dagarna
-- ska inte ga att lasa av nagon via API:t, och sokmissarna ska bara ga att lasa
-- som topplista. Ingen policy = noll rader for varje inloggad, oavsett roll.
-- Skrivning sker enbart genom de tva funktionerna ovan.
-- -----------------------------------------------------------------------------

alter table activity_day enable row level security;
alter table search_miss  enable row level security;
