-- =============================================================================
-- 0024_rollspel.sql — E8.7 / AC-6.7: rollspelscertifiering.
--
-- Saljaren spelar in ett testsamtal, laddar upp det, och bedoms mot en rubrik.
-- Modultypen `roleplay` fanns i `course_module.kind` redan i 0007, liksom
-- `course_attempt.graded_by` och `note`. Det som fattades var filen — och den
-- gar sedan 0022.
--
-- =============================================================================
-- RUBRIKEN SYNS FORE INSPELNINGEN. DET AR HELA POANGEN MED EN RUBRIK.
--
-- `roleplay_criterion` arver modulens lasbehorighet, alltsa ser den som ska
-- gora rollspelet exakt vad hon bedoms pa innan hon spelar in. En bedomning
-- mot kriterier man far se forst i efterhand ar inte en bedomning, det ar ett
-- omdome — och det ar samma linje som AC-3.13 drog for franvaroreglerna: den
-- som ska folja en regel ska kunna lasa den fore, inte efter.
--
-- =============================================================================
-- DEN SOM INTE OPPNAT INSPELNINGEN FAR INTE BEDOMA DEN.
--
-- Sparren ligger i en trigger langst ned och inte i koden. Den fragar
-- `file_access_log` — samma logg som K36 kraver for lakarintyg — efter en
-- oppning gjord av den som satter betyget.
--
-- Det ar forsta gangen atkomstloggen anvands till nagot annat an att kunna
-- granskas i efterhand, och den anvandningen ar sund: ett betyg pa ett samtal
-- ingen lyssnat pa ar varre an inget betyg alls. Det finns ett kryphal — man
-- kan oppna filen och lata bli att lyssna — men skillnaden mellan "gick inte
-- att gora av misstag" och "gick att gora med avsikt" ar hela vad en sparr kan
-- astadkomma har.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Bucketen far plats for en inspelning
--
-- Tio megabyte rackte for ett intyg och en prislista. En kvart inspelat samtal
-- i mp3 ar omkring fjorton, sa taket hojs till fyrtio.
--
-- Samtidigt lades uppladdningen om: filen gar numera DIREKT fran webblasaren
-- till Storage via en signerad uppladdningslank, i stallet for genom en server
-- action. Skalet ar Vercel, som tar emot hogst 4,5 MB i en funktionskropp —
-- en telefonfotograferad intygssida ar ofta storre an sa, och felet hade
-- kommit fran plattformen och inte fran navet. Se src/lib/filer-server.ts.
-- -----------------------------------------------------------------------------

update storage.buckets set file_size_limit = 41943040 where id = 'filer';

-- -----------------------------------------------------------------------------
-- 1. Filen far ett tredje andamal
--
-- Villkoren fran 0022 skrivs om i stallet for att laggas till bredvid: tva
-- check-villkor som bada beskriver vilka kopplingar som ar tillatna hade varit
-- tva stallen att halla lika.
--
-- Ett rollspel hor inte till en annan rad utan till en person, sa `purpose`
-- 'roleplay' kraver `subject_employee_id` och inget mer. Inlamningen pekar pa
-- filen och inte tvartom — filen finns forst, inlamningen skapas av den.
-- -----------------------------------------------------------------------------

alter table file_object drop constraint if exists file_object_koppling;
alter table file_object drop constraint if exists file_object_typ;

alter table file_object drop constraint if exists file_object_purpose_check;
alter table file_object add constraint file_object_purpose_check
  check (purpose in ('sick_certificate','document_attachment','roleplay'));

alter table file_object add constraint file_object_koppling check (
  (purpose = 'sick_certificate'
    and sick_report_id is not null
    and document_id is null
    and subject_employee_id is not null)
  or
  (purpose = 'document_attachment'
    and document_id is not null
    and sick_report_id is null
    and subject_employee_id is null)
  or
  (purpose = 'roleplay'
    and sick_report_id is null
    and document_id is null
    and subject_employee_id is not null)
);

alter table file_object add constraint file_object_typ check (
  (purpose = 'sick_certificate'
    and mime_type in ('application/pdf','image/jpeg','image/png'))
  or
  (purpose = 'document_attachment'
    and mime_type in ('application/pdf','image/jpeg','image/png'))
  or
  -- Ljud, inte video. Ett testsamtal ar ett samtal, och en videofil hade
  -- dragit in ansikten i en bedomning som handlar om vad nagon sager.
  (purpose = 'roleplay'
    and mime_type in ('audio/mpeg','audio/mp4','audio/wav','audio/webm'))
);

-- -----------------------------------------------------------------------------
-- 2. Rubriken (AC-6.7)
--
-- Kriterierna hor till modulen och inte till kursen: en kurs kan ha bade ett
-- inledande rollspel och ett avslutande, och de bedoms inte pa samma saker.
-- -----------------------------------------------------------------------------

create table if not exists roleplay_criterion (
  id        uuid primary key default gen_random_uuid(),
  module_id uuid not null references course_module(id) on delete cascade,
  sort      int  not null,

  label     text not null,
  -- Vad som kravs for full poang. Star for den som bedoms lika mycket som for
  -- den som bedomer — se rubriken ovan.
  guidance  text,

  max_points int not null default 5 check (max_points between 1 and 10),

  created_at timestamptz not null default now(),
  unique (module_id, sort)
);

create index if not exists roleplay_criterion_modul_idx on roleplay_criterion (module_id, sort);

-- -----------------------------------------------------------------------------
-- 3. Inlamningen
--
-- En rad per uppladdat samtal. Att lamna in igen skapar en NY rad — precis som
-- `course_attempt` ar en logg och inte ett tillstand (0007). Ett underkant
-- rollspel som skrevs over hade tagit bort halva det AC-6.2 vill bevara.
-- -----------------------------------------------------------------------------

create table if not exists roleplay_submission (
  id          uuid primary key default gen_random_uuid(),
  module_id   uuid not null references course_module(id) on delete cascade,
  course_id   uuid not null references course(id) on delete cascade,
  employee_id uuid not null references employee(id) on delete cascade,

  file_id uuid not null references file_object(id),

  submitted_at timestamptz not null default now(),

  graded_by uuid references employee(id),
  graded_at timestamptz,
  attempt_id uuid references course_attempt(id) on delete set null,

  constraint roleplay_submission_bedomning check (
    (graded_by is null) = (graded_at is null)
  )
);

create index if not exists roleplay_submission_person_idx
  on roleplay_submission (employee_id, module_id, submitted_at desc);
create index if not exists roleplay_submission_obedomda_idx
  on roleplay_submission (submitted_at) where graded_at is null;

-- Poang per kriterium. Ingen textkolumn: aterkopplingen skrivs i
-- `course_attempt.note`, dar all annan bedomning redan bor.
create table if not exists roleplay_score (
  submission_id uuid not null references roleplay_submission(id) on delete cascade,
  criterion_id  uuid not null references roleplay_criterion(id) on delete cascade,
  points        int  not null check (points >= 0),
  primary key (submission_id, criterion_id)
);

-- -----------------------------------------------------------------------------
-- 4. Sparren: ingen bedomning utan att inspelningen oppnats
-- -----------------------------------------------------------------------------

create or replace function public.rollspel_kraver_lyssning()
returns trigger
language plpgsql
as $$
begin
  if new.graded_at is not null and old.graded_at is null then
    if not exists (
      select 1 from public.file_access_log l
      where l.file_id = new.file_id
        and l.actor_id = new.graded_by
        and l.action = 'open'
    ) then
      raise exception 'Inspelningen maste oppnas innan rollspelet bedoms (AC-6.7).';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists roleplay_submission_lyssning on roleplay_submission;
create trigger roleplay_submission_lyssning
  before update on roleplay_submission
  for each row execute function public.rollspel_kraver_lyssning();

-- -----------------------------------------------------------------------------
-- 5. Behorighet
--
-- Kriterierna: den som ser modulen ser rubriken.
-- Inlamningen: den som lamnade in, den som leder hen, och ledningen.
--
-- Notera att `file_object_read` nedan far en tredje gren och att den, till
-- skillnad fran de tva andra, inte kan arva nagon annan rads policy: en
-- rollspelsfil hor till en person och inte till en rad som redan har en
-- behorighet. Villkoret ar darfor utskrivet — och det ar samma krets som
-- inlamningen, med flit.
-- -----------------------------------------------------------------------------

alter table roleplay_criterion  enable row level security;
alter table roleplay_submission enable row level security;
alter table roleplay_score      enable row level security;

drop policy if exists roleplay_criterion_read on roleplay_criterion;
create policy roleplay_criterion_read on roleplay_criterion for select
  to authenticated
  using (exists (select 1 from public.course_module m where m.id = module_id));

drop policy if exists roleplay_submission_read on roleplay_submission;
create policy roleplay_submission_read on roleplay_submission for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.leads_employee(employee_id)
    or public.has_any_role(array['sales_manager','ceo'])
  );

drop policy if exists roleplay_score_read on roleplay_score;
create policy roleplay_score_read on roleplay_score for select
  to authenticated
  using (
    exists (select 1 from public.roleplay_submission s where s.id = submission_id)
  );

drop policy if exists file_object_read on file_object;
create policy file_object_read on file_object for select
  to authenticated
  using (
    (purpose = 'sick_certificate' and exists (
      select 1 from public.sick_report r where r.id = file_object.sick_report_id))
    or
    (purpose = 'document_attachment' and exists (
      select 1 from public.document d where d.id = file_object.document_id))
    or
    (purpose = 'roleplay' and (
      subject_employee_id = public.current_employee_id()
      or public.leads_employee(subject_employee_id)
      or public.has_any_role(array['sales_manager','ceo'])
    ))
  );
