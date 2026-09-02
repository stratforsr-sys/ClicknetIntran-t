-- =============================================================================
-- 0043_coachning.sql — coachningsmodulen, fas 1.
--
-- Beställningen och besluten står i docs/COACHNING_UTREDNING.md.
--
-- =============================================================================
-- MODULEN ÄGER INGET INNEHÅLL. DEN ÄGER UPPFÖLJNINGEN.
--
-- Navet hade redan tre fjärdedelar av en coachningsmodul när den här skrevs:
-- kurser med quiz och certifikat (0007), rollspel med rubrik och ljudfil
-- (0024), K&V-bedömningen av riktiga samtal (0036) och kvittens på rutiner
-- (0003). Det som saknades var personperspektivet — vem behöver något, av vem,
-- och när.
--
-- Därför lagrar den här migrationen INGET kursinnehåll, INGEN egen
-- bedömningsrubrik och INGET andra "klart"-begrepp. Där sanningen redan finns
-- någon annanstans räknas läget fram därifrån.
--
-- =============================================================================
-- TRE PERSONER PÅ VARJE UPPGIFT, OCH DE ÄR OLIKA SAKER
--
-- Beställarens ord var "tilldela en teamledare, eller att säljaren själv gör
-- det, eller med den som satt upp tasken". Det beskriver inte tre sorters
-- uppgifter — det beskriver MOTPARTEN.
--
--   assignee_id  Den som ska lära sig något. Alltid satt.
--   partner_id   Den som spelar kund, lyssnar eller bedömer. Null = på egen hand.
--   created_by   Den som beställde. Ofta men inte alltid samma som motparten.
--
-- Utan den uppdelningen hade "rollspel med teamledaren" och "rollspel som
-- säljaren gör själv" behövt vara två uppgiftstyper, och rubriken hade fått
-- skrivas två gånger.
--
-- =============================================================================
-- TRE AV SJU UPPGIFTSTYPER KAN ALDRIG LJUGA
--
--   kurs               klar när `certification` finns och är giltig
--   rollspel_inspelat  klar när `course_attempt` är godkänd för modulen
--   lasning            klar när `document_ack` finns för rätt version
--
-- För dem finns ingen bock att sätta. Triggern längst ned VÄGRAR ta emot en
-- `kvitterad`-händelse på en sådan uppgift. Det är samma linje som
-- onboardingstatusen drog 2026-08-31: `employee.status` sätts av systemet och
-- går inte att kvittera för hand, eftersom en bock som säger "klar" bredvid ett
-- certifikat som säger "utgången" är värre än ingen bock alls.
--
-- De fyra övriga — rollspel_live, manus, medlyssning, uppgift — är mänskliga
-- moment utan spår i någon annan tabell. De MÅSTE kvitteras av en människa, och
-- `verify_by` avgör vilken.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Fokusområdena
--
-- FÖRSTA UTKASTET PEKADE RAKT PÅ `kv_criterion`. DET HADE VARIT ETT FEL.
--
-- K&V-poängen kräver `max_points` på varje AKTIV rad i `kv_criterion` (0036) —
-- ett samtal går inte att bedöma förrän samtliga har en maxpoäng. Coachningen
-- gäller alla anställda, inte bara säljare, så ett fokusområde "Projektledning"
-- inlagt där hade tyst brutit bonusberäkningen för hela säljkåren.
--
-- Egen tabell alltså, med en VALFRI länk till K&V-området. Där länken finns kan
-- personkortet visa K&V-trenden för just det området, och slingan går ihop:
-- svag Behovsanalys → coachning på Behovsanalys → nästa K&V mäter samma sak.
-- Där den saknas är fokusområdet bara en etikett, vilket är precis vad en
-- projektledare behöver.
--
-- Ett sjunde område är en inmatning, inte en migration. Samma val som 0036.
-- -----------------------------------------------------------------------------

create table if not exists coaching_focus (
  id    uuid primary key default gen_random_uuid(),
  label text not null check (length(btrim(label)) > 0),
  sort  smallint not null,

  -- Null = området mäts inte i K&V. Det är det normala för icke-säljande roller.
  kv_criterion_id uuid references kv_criterion(id) on delete set null,

  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists coaching_focus_label_idx on coaching_focus (lower(btrim(label)));

-- Seedas med beställarens sex ord, länkade till sin K&V-motsvarighet där den
-- finns. Etiketterna dubbleras med flit i stället för att slås upp via länken:
-- ett K&V-område som byter namn ska inte tyst byta namn på coachningshistoriken.
insert into coaching_focus (label, sort, kv_criterion_id)
select v.label, v.sort, (select k.id from kv_criterion k where k.label = v.label)
from (values
  ('Intro',                    1::smallint),
  ('Behovsanalys',             2::smallint),
  ('ROI',                      3::smallint),
  ('Avslut',                   4::smallint),
  ('Kvalitet på samtalet',     5::smallint),
  ('Korrekt avtalshantering',  6::smallint)
) as v(label, sort)
where not exists (select 1 from coaching_focus);

comment on table coaching_focus is
  'Vad en coachningsuppgift tränar. Seedad med K&V:s sex områden men EGEN tabell — se rubriken i 0043.';

-- -----------------------------------------------------------------------------
-- 2. Uppgiften
-- -----------------------------------------------------------------------------

create table if not exists coaching_task (
  id uuid primary key default gen_random_uuid(),

  title          text not null check (length(btrim(title)) > 0),
  description_md text not null default '',

  kind text not null check (kind in (
    'kurs',              -- tilldelad kurs, klar av certifikatet
    'rollspel_inspelat', -- E8.7, klar av bedömningen
    'lasning',           -- rutin eller manus, klar av kvittensen
    'rollspel_live',     -- övat med en motpart, bedöms mot modulens rubrik
    'manus',             -- läses upp för motparten som bockar
    'medlyssning',       -- någon lyssnar på riktiga samtal
    'uppgift'            -- fritt formulerat moment
  )),

  assignee_id uuid not null references employee(id) on delete cascade,
  partner_id  uuid references employee(id) on delete set null,

  -- Aldrig null. En coachningsuppgift utan avsändare är en anonym tillsägelse,
  -- av samma skäl som `guide_nudge.nudged_by` i 0042.
  created_by  uuid not null references employee(id),

  verify_by text not null default 'sjalv'
    check (verify_by in ('sjalv','motpart','skapare','chef')),

  -- Vad som krävs för att få kvittera. Rollspel kräver alltid ljudfilen, och
  -- den regeln bor i 0024 och inte här.
  evidence text not null default 'ingen'
    check (evidence in ('ingen','kommentar','fil')),

  -- Källan. Vilken som gäller följer av `kind` — se check-villkoret nedan.
  course_id   uuid references course(id) on delete set null,
  module_id   uuid references course_module(id) on delete set null,
  document_id uuid references document(id) on delete set null,

  starts_on date,
  due_date  date,

  template_id uuid,   -- fk sätts efter att mallen skapats, se avsnitt 5
  session_id  uuid,   -- fk sätts efter att samtalet skapats, se avsnitt 6

  created_at   timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references employee(id),
  cancel_reason text,

  -- En uppgift där ansvarig och motpart är samma person är inte en uppgift med
  -- motpart, det är en ifylld ruta. Låt den vara tom i stället.
  constraint coaching_task_motpart_inte_sig_sjalv
    check (partner_id is null or partner_id <> assignee_id),

  -- `verify_by = 'motpart'` utan motpart hade gett en uppgift ingen kan
  -- kvittera. Den sortens dödläge ska databasen vägra, inte gränssnittet.
  constraint coaching_task_motpart_kravs
    check (verify_by <> 'motpart' or partner_id is not null),

  -- Källan måste finnas för de typer som räknar sitt läge ur den. Utan den här
  -- raden hade en `kurs`-uppgift utan `course_id` legat öppen för evigt: det
  -- finns inget certifikat att hitta, och ingen bock att sätta.
  constraint coaching_task_kalla check (
    (kind = 'kurs'              and course_id is not null)
    or (kind = 'rollspel_inspelat' and module_id is not null)
    or (kind = 'rollspel_live'     and module_id is not null)
    or (kind = 'lasning'           and document_id is not null)
    or (kind in ('manus','medlyssning','uppgift'))
  ),

  constraint coaching_task_frist check (starts_on is null or due_date is null or due_date >= starts_on),
  constraint coaching_task_avbrott check (
    (cancelled_at is null and cancelled_by is null)
    or (cancelled_at is not null and cancelled_by is not null)
  )
);

create index if not exists coaching_task_ansvarig_idx on coaching_task (assignee_id, due_date);
create index if not exists coaching_task_motpart_idx  on coaching_task (partner_id) where partner_id is not null;
create index if not exists coaching_task_skapare_idx  on coaching_task (created_by, created_at desc);
create index if not exists coaching_task_frist_idx    on coaching_task (due_date) where cancelled_at is null;

create table if not exists coaching_task_focus (
  task_id  uuid not null references coaching_task(id) on delete cascade,
  focus_id uuid not null references coaching_focus(id) on delete cascade,
  primary key (task_id, focus_id)
);

comment on table coaching_task is
  'En coachningsuppgift. Ansvarig, motpart och skapare är TRE olika roller — se rubriken i 0043.';

-- -----------------------------------------------------------------------------
-- 3. Historiken
--
-- Logg, inte tillstånd. Exakt samma val som `course_attempt` gjorde i 0007 och
-- av samma skäl: ett avbrutet försök är lika mycket bevis som ett klart, och en
-- kvittering som går att skriva över är ingen kvittering.
--
-- Det finns därför ingen `status`-kolumn på `coaching_task`. Läget räknas fram
-- ur den senaste händelsen — eller, för de tre självsanna typerna, ur
-- certifikatet, bedömningen eller kvittensen.
-- -----------------------------------------------------------------------------

create table if not exists coaching_task_event (
  id      uuid primary key default gen_random_uuid(),
  task_id uuid not null references coaching_task(id) on delete cascade,

  type text not null check (type in (
    'tilldelad','paborjad','inlamnad','kvitterad','underkand','avbruten'
  )),

  -- Vem som gjorde det. Tas ur sessionen i server action, aldrig ur ett
  -- argument — annars vore fältet en plats att signera någon annans namn på.
  by_employee_id uuid not null references employee(id),

  note    text,
  file_id uuid references file_object(id) on delete set null,

  at timestamptz not null default now()
);

create index if not exists coaching_task_event_idx on coaching_task_event (task_id, at desc);
create index if not exists coaching_task_event_person_idx
  on coaching_task_event (by_employee_id, at desc);

-- -----------------------------------------------------------------------------
-- 4. Filen får ett FEMTE ändamål
--
-- Bevis på en coachningsuppgift hör till en PERSON och inte till en annan rad,
-- precis som rollspelet i 0024.
--
-- ALLA FYRA BEFINTLIGA ÄNDAMÅL SKRIVS UT IGEN, INKLUSIVE `sales_order` FRÅN
-- 0039. Villkoren skrivs om i sin helhet i stället för att läggas till bredvid,
-- och det gör omskrivningen farlig: den som utelämnar en gren tar bort den.
-- `sales_order_id is null` måste stå i coaching-grenen av samma skäl som det
-- står i de tre andra — utan raden hade en coachningsfil kunnat bära en order.
--
-- Både bild, pdf och ljud tillåts. Ett bevis kan vara en skärmdump av en
-- bokning lika gärna som en inspelning; det inspelade rollspelet har sin egen,
-- strängare regel kvar under `roleplay`.
-- -----------------------------------------------------------------------------

alter table file_object drop constraint if exists file_object_koppling;
alter table file_object drop constraint if exists file_object_typ;

alter table file_object drop constraint if exists file_object_purpose_check;
alter table file_object add constraint file_object_purpose_check
  check (purpose in ('sick_certificate','document_attachment','roleplay','sales_order','coaching'));

alter table file_object add constraint file_object_koppling check (
  (purpose = 'sick_certificate'
    and sick_report_id is not null
    and document_id is null
    and sales_order_id is null
    and subject_employee_id is not null)
  or
  (purpose = 'document_attachment'
    and document_id is not null
    and sick_report_id is null
    and sales_order_id is null
    and subject_employee_id is null)
  or
  (purpose = 'roleplay'
    and sick_report_id is null
    and document_id is null
    and sales_order_id is null
    and subject_employee_id is not null)
  or
  (purpose = 'sales_order'
    and sales_order_id is not null
    and sick_report_id is null
    and document_id is null
    and subject_employee_id is null)
  or
  (purpose = 'coaching'
    and sick_report_id is null
    and document_id is null
    and sales_order_id is null
    and subject_employee_id is not null)
);

alter table file_object add constraint file_object_typ check (
  (purpose = 'sick_certificate'
    and mime_type in ('application/pdf','image/jpeg','image/png'))
  or
  (purpose = 'document_attachment'
    and mime_type in ('application/pdf','image/jpeg','image/png'))
  or
  (purpose = 'roleplay'
    and mime_type in ('audio/mpeg','audio/mp4','audio/wav','audio/webm'))
  or
  (purpose = 'sales_order' and mime_type = 'application/pdf')
  or
  (purpose = 'coaching'
    and mime_type in ('application/pdf','image/jpeg','image/png',
                      'audio/mpeg','audio/mp4','audio/wav','audio/webm'))
);

-- Läspolicyn skrivs om av samma skäl och med samma risk. De fyra befintliga
-- grenarna är oförändrade ur 0039.
--
-- Coaching-grenen har en gren till som rollspelet inte har: MOTPARTEN OCH
-- SKAPAREN. En teamledare utanför personens team kan vara motpart i ett
-- rollspel, och en motpart som ska bedöma ett bevis hon inte får öppna är ingen
-- motpart. Grenen frågar `coaching_task_event` efter en uppgift där filen
-- faktiskt används — inte efter en roll.
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
    or
    (purpose = 'sales_order' and exists (
      select 1 from public.sales_order o where o.id = file_object.sales_order_id))
    or
    (purpose = 'coaching' and (
      subject_employee_id = public.current_employee_id()
      or public.leads_employee(subject_employee_id)
      or public.has_any_role(array['sales_manager','ceo'])
      or exists (
        select 1
        from public.coaching_task_event e
        join public.coaching_task t on t.id = e.task_id
        where e.file_id = file_object.id
          and (t.partner_id = public.current_employee_id()
               or t.created_by = public.current_employee_id())
      )
    ))
  );

-- -----------------------------------------------------------------------------
-- 5. Mallarna
--
-- En rampplan för en ny säljare är tolv uppgifter. Skrivs de för hand tolv
-- gånger per anställning skrivs de i praktiken noll gånger — det är samma
-- erfarenhet som `course.due_days` bygger på.
--
-- FÖRFALLODAGEN ÄR RELATIV OCH INTE ABSOLUT. `offset_days` räknas från det
-- datum mallen tillämpas, så samma mall fungerar för en person som börjar i
-- mars och en som börjar i november.
-- -----------------------------------------------------------------------------

create table if not exists coaching_template (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(btrim(name)) > 0),
  description_md text not null default '',
  active         boolean not null default true,
  created_by     uuid not null references employee(id),
  created_at     timestamptz not null default now()
);

create table if not exists coaching_template_item (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references coaching_template(id) on delete cascade,
  sort        int not null,

  kind           text not null,
  title          text not null check (length(btrim(title)) > 0),
  description_md text not null default '',
  verify_by      text not null default 'sjalv',
  evidence       text not null default 'ingen',

  course_id   uuid references course(id) on delete set null,
  module_id   uuid references course_module(id) on delete set null,
  document_id uuid references document(id) on delete set null,

  -- Dagar från tillämpningsdatum. Noll betyder samma dag.
  offset_days int not null default 0 check (offset_days >= 0),

  unique (template_id, sort)
);

create table if not exists coaching_template_item_focus (
  item_id  uuid not null references coaching_template_item(id) on delete cascade,
  focus_id uuid not null references coaching_focus(id) on delete cascade,
  primary key (item_id, focus_id)
);

alter table coaching_task drop constraint if exists coaching_task_template_fk;
alter table coaching_task add constraint coaching_task_template_fk
  foreign key (template_id) references coaching_template(id) on delete set null;

-- -----------------------------------------------------------------------------
-- 6. Coachningssamtalet (GROW)
--
-- Fyra fält, och det fjärde är hela poängen. G, R och O är anteckningar; W —
-- åtagandet — blir RIKTIGA UPPGIFTER med ansvarig och datum, kopplade till
-- samtalet via `coaching_task.session_id`.
--
-- Det är skillnaden mot en anteckningsbok. Underlaget är entydigt på punkten:
-- när åtaganden inte följs upp lär sig den som coachas att coachningen är
-- frivillig.
--
-- INGA PRIVATA CHEFSANTECKNINGAR. Läspolicyn nedan släpper in personen samtalet
-- handlar om, undantagslöst. Samma linje som rubriken-före-inspelningen i 0024
-- och som AC-3.13 drog för frånvaroreglerna: den som berörs av något ska kunna
-- läsa det.
-- -----------------------------------------------------------------------------

create table if not exists coaching_session (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee(id) on delete cascade,
  coach_id    uuid not null references employee(id),

  held_on date not null default current_date,

  goal_md    text not null default '',
  reality_md text not null default '',
  options_md text not null default '',
  will_md    text not null default '',

  created_by uuid not null references employee(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint coaching_session_inte_sig_sjalv check (coach_id <> employee_id)
);

create index if not exists coaching_session_person_idx
  on coaching_session (employee_id, held_on desc);

alter table coaching_task drop constraint if exists coaching_task_session_fk;
alter table coaching_task add constraint coaching_task_session_fk
  foreign key (session_id) references coaching_session(id) on delete set null;

-- -----------------------------------------------------------------------------
-- 7. Spärren: tre av sju typer går inte att bocka för hand
--
-- Ligger i en trigger och inte i koden, av samma skäl som spärren i 0024: en
-- regel som bara finns i en server action gäller bara den vägen. Den här gäller
-- alla vägar in i tabellen, inklusive service role.
-- -----------------------------------------------------------------------------

create or replace function public.coaching_kvittens_vaktas()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uppgiftens_typ text;
begin
  if new.type <> 'kvitterad' then
    return new;
  end if;

  select kind into uppgiftens_typ from coaching_task where id = new.task_id;

  if uppgiftens_typ in ('kurs','rollspel_inspelat','lasning') then
    raise exception
      'En uppgift av typen % kvitteras inte för hand — läget räknas ur certifikatet, bedömningen eller kvittensen.',
      uppgiftens_typ;
  end if;

  return new;
end;
$$;

drop trigger if exists coaching_kvittens_vakt on coaching_task_event;
create trigger coaching_kvittens_vakt
  before insert on coaching_task_event
  for each row execute function public.coaching_kvittens_vaktas();

-- -----------------------------------------------------------------------------
-- 8. Behörighet
--
-- Samma modell som resten av navet: läsning via RLS, skrivning uteslutande via
-- server actions med service role (D-T1).
--
-- SÄLJARE SER ALDRIG VARANDRAS. Det är beställarens beslut och det ligger i
-- linje med 0029, som är byggd för att göra per-person-uppföljning omöjlig.
-- Vyn ska visa vem som behöver något, inte vem som är sämst.
-- -----------------------------------------------------------------------------

alter table coaching_focus              enable row level security;
alter table coaching_task               enable row level security;
alter table coaching_task_focus         enable row level security;
alter table coaching_task_event         enable row level security;
alter table coaching_template           enable row level security;
alter table coaching_template_item      enable row level security;
alter table coaching_template_item_focus enable row level security;
alter table coaching_session            enable row level security;

-- Fokusområdena är ingen persondata. Alla inloggade ser dem — den som ska göra
-- en uppgift ska kunna läsa vad den tränar.
drop policy if exists coaching_focus_read on coaching_focus;
create policy coaching_focus_read on coaching_focus for select to authenticated using (true);

drop policy if exists coaching_task_read on coaching_task;
create policy coaching_task_read on coaching_task for select
  to authenticated
  using (
    assignee_id = public.current_employee_id()
    or partner_id = public.current_employee_id()
    or created_by = public.current_employee_id()
    or public.can_read_all_employees()
    or public.leads_employee(assignee_id)
  );

-- Kopplings- och historiktabellerna ärver uppgiftens krets. `exists` mot
-- `coaching_task` innebär att policyn ovan gäller en gång till här — utan den
-- omvägen hade en egen policy behövt hållas lika med den, och två ställen att
-- hålla lika är ett ställe för många.
drop policy if exists coaching_task_focus_read on coaching_task_focus;
create policy coaching_task_focus_read on coaching_task_focus for select
  to authenticated
  using (exists (select 1 from public.coaching_task t where t.id = task_id));

drop policy if exists coaching_task_event_read on coaching_task_event;
create policy coaching_task_event_read on coaching_task_event for select
  to authenticated
  using (exists (select 1 from public.coaching_task t where t.id = task_id));

-- Mallarna är planer, inte persondata, men de avslöjar vad ledningen tänker om
-- upplägget. Kretsen är den som får coacha.
drop policy if exists coaching_template_read on coaching_template;
create policy coaching_template_read on coaching_template for select
  to authenticated
  using (public.can_read_all_employees() or public.has_any_role(array['team_lead']));

drop policy if exists coaching_template_item_read on coaching_template_item;
create policy coaching_template_item_read on coaching_template_item for select
  to authenticated
  using (exists (select 1 from public.coaching_template m where m.id = template_id));

drop policy if exists coaching_template_item_focus_read on coaching_template_item_focus;
create policy coaching_template_item_focus_read on coaching_template_item_focus for select
  to authenticated
  using (exists (select 1 from public.coaching_template_item i where i.id = item_id));

-- Personen samtalet handlar om ser det. Alltid. Se rubriken i avsnitt 6.
drop policy if exists coaching_session_read on coaching_session;
create policy coaching_session_read on coaching_session for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or coach_id = public.current_employee_id()
    or public.can_read_all_employees()
    or public.leads_employee(employee_id)
  );

-- -----------------------------------------------------------------------------
-- 9. Kvittot
--
-- Samma avläsning som 0042 gör, utsträckt över alla åtta tabellerna. Den fångar
-- det som är lätt att missa i en stor migration: en tabell utan RLS, eller en
-- skrivpolicy som smugit in och öppnat en väg förbi server action.
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
  skrivpolicyer int;
begin
  foreach t in array array[
    'coaching_focus','coaching_task','coaching_task_focus','coaching_task_event',
    'coaching_template','coaching_template_item','coaching_template_item_focus',
    'coaching_session'
  ] loop
    if not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relrowsecurity
    ) then
      raise exception '% saknar row level security', t;
    end if;

    select count(*) into skrivpolicyer
    from pg_policies
    where schemaname = 'public' and tablename = t and cmd <> 'SELECT';

    if skrivpolicyer > 0 then
      raise exception '% har % skrivpolicy(er) — skrivning ska gå via service role', t, skrivpolicyer;
    end if;
  end loop;

  if (select count(*) from coaching_focus) < 6 then
    raise exception 'coaching_focus seedades inte';
  end if;
end;
$$;

-- Villkoren på `file_object` skrevs om i avsnitt 4, och en utelämnad gren tar
-- bort ett ändamål i tysthet. Den här avläsningen är hela skyddet mot det:
-- faller den har orderbilagan eller läkarintyget slutat gå att spara, och det
-- hade annars synts först den dag någon försökte.
do $$
declare
  villkor text;
  andamal text;
begin
  -- `pg_get_constraintdef` normaliserar nyckelord till VERSALER, sa
  -- avlasningen maste ske i gemener. Utan `lower()` letar sokningen efter
  -- "is not null" i en text som sager "IS NOT NULL", och kontrollen larmar om
  -- ett fel som inte finns — vilket den ocksa gjorde forsta gangen den kordes.
  select lower(pg_get_constraintdef(c.oid)) into villkor
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  where t.relname = 'file_object' and c.conname = 'file_object_purpose_check';

  foreach andamal in array array[
    'sick_certificate','document_attachment','roleplay','sales_order','coaching'
  ] loop
    if villkor is null or position(andamal in villkor) = 0 then
      raise exception 'file_object_purpose_check tappade ändamålet %', andamal;
    end if;
  end loop;

  select lower(pg_get_constraintdef(c.oid)) into villkor
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  where t.relname = 'file_object' and c.conname = 'file_object_koppling';

  if villkor is null or position('sales_order_id is not null' in villkor) = 0 then
    raise exception 'file_object_koppling tappade orderbilagans gren';
  end if;
end;
$$;
