-- =============================================================================
-- 0033_anstallningsflodet.sql
--
-- E10.9 / AC-7.9: nar en kandidat blir anstalld ska konto, avtal, rutiner,
-- kurser och en checklista falla ut i ETT flode, inte i fem manuella steg som
-- var och en gar att glomma.
--
-- Sparren for det har funnits sedan 0030: steget `hired` nekas om
-- `hired_employee_id` ar null. Den sager alltsa redan att en kandidat inte kan
-- anstallas forbi flodet. Det som saknades var flodet.
--
-- =============================================================================
-- VAD SOM LIGGER I DATABASEN OCH VAD SOM LIGGER I KODEN
--
-- Kontot skapas i auth och kan darfor inte skapas harifran. Floden som
-- spanner over auth och databasen har ingen gemensam transaktion, och det ar
-- vart att skriva ut vad det betyder: skrivningarna sker i en ordning dar ett
-- avbrott mitt i lamnar nagot halvfardigt men inget motsagelsefullt.
--
--   1. auth-kontot         -- ett konto utan employee-rad ar ofarligt
--   2. employee-raden      -- en anstalld utan kandidatkoppling ar giltig
--   3. candidate-uppdateringen (hired_employee_id + stage i EN skrivning)
--   4. checklistan, avtalsutkastet, loggen
--
-- Steg 3 ar det enda som inte gar att gora om, och det ar darfor det ligger
-- efter steg 2 och fore allt som ar bekvamlighet. Faller flodet mellan 2 och 3
-- star kandidaten kvar pa `offer` med en anstalld som redan finns — och det ar
-- ett lage nagon kan se och rata, till skillnad fran motsatsen.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- En anstalld ar resultatet av HOGST en rekrytering
--
-- Utan det har kan tva kandidatrader peka pa samma person. Det later som en
-- kantfall-fraga men ar det inte: ett dubbelklick pa "Anstall" ar den vanligaste
-- vagen dit, och foljden ar att trattrapporten (AC-7.10) raknar en anstallning
-- som tva.
--
-- Partiellt, sa att de manga kandidater som INTE ar anstallda inte krockar med
-- varandra pa null.
-- -----------------------------------------------------------------------------
create unique index if not exists candidate_hired_employee_uniq
  on candidate (hired_employee_id)
  where hired_employee_id is not null;

/**
 * Kopplingen skrivs en gang och skrivs inte om.
 *
 * Vem som rekryterades till en tjanst ar en historikuppgift. Gar den att peka
 * om i efterhand gar rekryteringshistoriken att skriva om, och da ar den inget
 * varde som bevis.
 *
 * ===========================================================================
 * UNDANTAGET FOR NULL AR INTE EN UPPMJUKNING
 *
 * `hired_employee_id` har `on delete set null` (0030), sa nar en anstalld
 * raderas kor Postgres en UPDATE pa kandidatraden som satter den till null. En
 * trigger som nekade ALL andring hade darmed fallt `delete from employee` —
 * exakt samma falla som `file_object` gick i 0023 och som E6.2 gallringsjobbet
 * en dag hade dott pa mitt i natten.
 *
 * Darfor: att ta bort kopplingen gar (personen finns inte langre), att peka om
 * den gar inte.
 * ===========================================================================
 */
create or replace function public.candidate_anstallning_star_fast()
returns trigger
language plpgsql
as $$
begin
  if old.hired_employee_id is not null
     and new.hired_employee_id is not null
     and new.hired_employee_id is distinct from old.hired_employee_id then
    raise exception 'Kandidatens anstallning gar inte att peka om (AC-7.9).';
  end if;
  return new;
end;
$$;

drop trigger if exists candidate_anstallning_star_fast on candidate;
create trigger candidate_anstallning_star_fast
  before update on candidate
  for each row execute function public.candidate_anstallning_star_fast();

-- -----------------------------------------------------------------------------
-- Onboarding-checklistan
--
-- Samma form som `offboarding_task` i 0001, och det ar med flit. AC-1.7:s regel
-- — ingen post kan hoppas over utan motivering — ar densamma at bada hallen,
-- och tva tabeller som beter sig likadant ska se likadana ut.
--
-- Skillnaden mot offboarding: den listan skrivs nar nagon slutar och ar da
-- fardig att beta av. Den har skrivs nar nagon borjar, och nagra av punkterna
-- ar redan gjorda av floden som skapade den. De skrivs darfor som `done` direkt,
-- med `handled_by` satt till den som anstallde — en checklista som oppnar med
-- atta punkter dar tre redan ar utforda lar anvandaren att bocka av utan att
-- lasa.
-- -----------------------------------------------------------------------------
create table if not exists onboarding_task (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references employee(id) on delete cascade,
  label          text not null,
  sort           int not null default 0,
  state          text not null default 'open' check (state in ('open','done','skipped')),
  skipped_reason text,
  handled_by     uuid references employee(id),
  handled_at     timestamptz,
  constraint onboarding_skip_needs_reason
    check (state <> 'skipped' or (skipped_reason is not null and length(trim(skipped_reason)) > 0))
);

create index if not exists onboarding_task_employee_idx on onboarding_task (employee_id);

alter table onboarding_task enable row level security;

/**
 * Samma krets som offboarding-checklistan: den som far se hela personalregistret.
 *
 * DEN NYANSTALLDA SER INTE SIN EGEN LISTA, och det ar ett val och inte ett
 * forbiseende. Punkterna ar arbetsgivarens att-gora — bestall dator, lagg upp i
 * Inkio, boka introduktionen — och skrivna for den som ska utfora dem. En lista
 * som ocksa lases av den den handlar om skrivs annorlunda, och da tappar den sin
 * funktion som chefens arbetsredskap.
 *
 * Det den nyanstallda SKA se ligger redan dar det hor hemma: rutinerna att
 * kvittera pa /rutiner och kurserna pa /utbildning.
 */
drop policy if exists onboarding_task_read on onboarding_task;
create policy onboarding_task_read on onboarding_task for select
  to authenticated
  using (public.can_read_all_employees());

-- -----------------------------------------------------------------------------
-- Kontrollen
--
-- Samma sjalvkontroll som 0032 fick. Den provar inte att koden fungerar utan
-- att schemat blev som texten ovan pastar — ett unikt index som tyst inte
-- skapades ar varre an inget, eftersom rubriken ovan da ljuger.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'candidate_hired_employee_uniq'
  ) then
    raise exception 'candidate_hired_employee_uniq skapades inte';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'candidate_anstallning_star_fast' and not tgisinternal
  ) then
    raise exception 'triggern candidate_anstallning_star_fast saknas';
  end if;

  if not exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'onboarding_task' and rowsecurity
  ) then
    raise exception 'onboarding_task saknar row level security';
  end if;
end $$;
