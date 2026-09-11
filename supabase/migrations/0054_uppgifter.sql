-- =============================================================================
-- 0054_uppgifter.sql — uppgifter och projekt, pass 1 av tre.
--
-- Beställningen: "jag vill kunna hantera alla mina personliga uppgifter som
-- säljchef direkt i intranätet", med inbjudna medarbetare, utpekade granskare
-- och kopplingar till det navet redan känner till.
--
-- =============================================================================
-- DEN HÄR MODULEN ÄR PERSONLIG, OCH DET ÄR EN BEHÖRIGHETSREGEL OCH INTE EN STIL
--
-- Varenda annan modul i navet har en chefskrets: säljchefen ser hela
-- personalregistret, teamledaren sitt lag, VD allt. `can_read_all_employees()`
-- står i nästan varje policy som skrivits sedan 0001.
--
-- HÄR STÅR DEN INTE, OCH DET ÄR MED FLIT. En uppgiftslista är en anteckningsbok.
-- Den innehåller "ring tillbaka till Nordic", men också "förbered samtalet med
-- Anna om hennes siffror" och "kolla vad avtalet säger innan jag lovar något".
-- Den dagen listan är läsbar för ledningen slutar folk skriva den andra sortens
-- rad — och då är verktyget en uppgiftslista bara till hälften, vilket är samma
-- sak som inte alls.
--
-- Kretsen är därför exakt fyra personer per uppgift: den som ska göra den, den
-- som lade upp den, de som bjudits in, och den uppgiften handlar om — men bara
-- om den som lade upp den sagt att den ska synas. Ingen roll ger insyn.
--
-- =============================================================================
-- EN UPPGIFT OM EN PERSON ÄR EN PERSONUPPGIFT. ÄVEN NÄR DEN ÄR DOLD.
--
-- Beställaren vill kunna ha en uppgift på en säljare utan att säljaren ser den
-- — "prata med Erik om pipelinen" ska inte dyka upp hos Erik innan samtalet
-- skett. Det är en rimlig beställning, och `task_link.visible_to_subject`
-- svarar mot den.
--
-- MEN DEN RADEN ÄR EN UPPGIFT OM EN NAMNGIVEN ANSTÄLLD, lagrad i ett system
-- hen har rätt att begära ut. Dold i gränssnittet betyder därför INTE dold i
-- registerutdraget: `registerutdrag.ts` läser `task_link` på employee_id och
-- tar med rubriken, vem som la upp den och när. Samma linje som 0029 drog om
-- adoptionsmätningen och 0052 om samtalsloggen — det som samlas in om någon
-- ska gå att läsa för den det gäller.
--
-- Grundläget är DOLD (`default false`), och det är också ett val. Det
-- omvända — att personen ser raden i samma sekund den skrivs — hade betytt att
-- en chef som antecknar "fundera på om Erik ska ha en tillsägelse" har
-- meddelat Erik en tillsägelse. En halvfärdig tanke är inte ett besked.
--
-- =============================================================================
-- LÄGET RÄKNAS FRAM UR HÄNDELSERNA. DET FINNS INGEN STATUS-KOLUMN.
--
-- Samma val som `coaching_task` gjorde i 0043 och `course_attempt` i 0007, och
-- här bär det en till börda: godkännandet. En returnerad uppgift som bara sätts
-- tillbaka till "pågår" raderar spåret av att någon faktiskt tittade och sa nej
-- — och det är precis den upplysningen som behövs den tredje gången samma sak
-- kommer tillbaka.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Projektet
--
-- MEDVETET TUNT. Beställningen var "små projekt", och ett projekt här är en
-- hatt att hänga uppgifter på: namn, ägare, färg, deadline. Ingen budget, inga
-- faser, ingen gantt. Det som gör projektet användbart är kortet som räknar
-- dess uppgifter, och det kräver ingen av de sakerna.
-- -----------------------------------------------------------------------------

create table if not exists project (
  id uuid primary key default gen_random_uuid(),

  name           text not null check (length(btrim(name)) > 0 and length(name) <= 120),
  description_md text not null default '',

  -- Ägaren är den som svarar för att projektet rör sig. Skaparen är den som
  -- tryckte på knappen. Ofta samma person, inte alltid — samma uppdelning som
  -- `coaching_task` gör mellan assignee och created_by.
  owner_id   uuid not null references employee(id) on delete cascade,
  created_by uuid not null references employee(id),

  -- Färgen är projektkortets enda dekoration, och den är en uppräkning och inte
  -- en hexkod: globals.css är den enda filen i systemet som får bära hexvärden
  -- (UI-PRD §4), och ett fritt färgfält i databasen hade flyttat den regeln hit.
  color text not null default 'brand'
    check (color in ('brand','info','accent','ok','warn','danger')),

  due_date date,

  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists project_agare_idx on project (owner_id) where archived_at is null;

comment on table project is
  'En hatt att hänga uppgifter på. Medvetet tunn — se rubriken i 0054.';

create table if not exists project_member (
  project_id  uuid not null references project(id) on delete cascade,
  employee_id uuid not null references employee(id) on delete cascade,

  -- Projektet har ingen granskare. Det är uppgifterna som godkänns, inte hatten.
  role text not null check (role in ('redigerare','visare')),

  added_by uuid not null references employee(id),
  added_at timestamptz not null default now(),

  primary key (project_id, employee_id)
);

-- -----------------------------------------------------------------------------
-- 2. Uppgiften
-- -----------------------------------------------------------------------------

create table if not exists task (
  id uuid primary key default gen_random_uuid(),

  title          text not null check (length(btrim(title)) > 0 and length(title) <= 200),
  description_md text not null default '',

  project_id uuid references project(id) on delete set null,

  -- Deluppgift. `on delete cascade`: en checklista utan sin rubrik är skräp.
  -- Djupet är låst till två nivåer av triggern i avsnitt 5.
  parent_id uuid references task(id) on delete cascade,

  /**
   * Null = ingen har tagit på sig den än. Det är inkorgen, och den är avsiktlig:
   * kravet att peka ut en ansvarig innan man får skriva ner en tanke är precis
   * den friktion som gör att tanken hamnar på en lapp i stället.
   */
  assignee_id uuid references employee(id) on delete set null,

  -- Aldrig null. En uppgift utan avsändare går inte att fråga om.
  created_by uuid not null references employee(id),

  starts_on date,
  due_date  date,

  /**
   * Klockslaget är SKILT från datumet, och båda är valfria.
   *
   * "Ring Nordic på tisdag" har ett datum men inget klockslag; "ring Nordic
   * tisdag 14:00" har båda. En enda timestamptz hade tvingat fram ett påhittat
   * klockslag för det första fallet — och då står uppgiften kl 00:00 i
   * kalendern i pass 2, vilket är fel på ett sätt som ser ut som en bugg.
   *
   * Tiden är svensk väggtid, som `work_schedule.start_time` i 0010. Se
   * src/lib/klocka.ts för varför det inte är samma sak som serverns tid.
   */
  due_time time,

  /** Minuter. Bär hela tidsuppskattningen som pass 2 planerar dagen med. */
  estimate_minutes integer
    check (estimate_minutes is null or (estimate_minutes > 0 and estimate_minutes <= 1440)),

  -- 1 är högst, 4 lägst, 3 är normalläget. Samma skala som Todoist använder,
  -- och den valdes för att snabbinmatningens `!1` ska betyda vad folk tror.
  priority smallint not null default 3 check (priority between 1 and 4),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- En deluppgift hör till sin förälders projekt, inte till ett eget. Utan den
  -- här raden kan en checklistepunkt ligga i ett annat projekt än rubriken den
  -- sitter under, och då ljuger båda projektkorten om sina siffror.
  constraint task_deluppgift_utan_projekt check (parent_id is null or project_id is null),

  constraint task_frist check (starts_on is null or due_date is null or due_date >= starts_on),

  -- Ett klockslag utan datum är ingen tidpunkt. Det är en åsikt.
  constraint task_tid_kraver_datum check (due_time is null or due_date is not null)
);

create index if not exists task_ansvarig_idx on task (assignee_id, due_date);
create index if not exists task_skapare_idx  on task (created_by, created_at desc);
create index if not exists task_projekt_idx  on task (project_id) where project_id is not null;
create index if not exists task_foralder_idx on task (parent_id) where parent_id is not null;
create index if not exists task_frist_idx    on task (due_date) where due_date is not null;

comment on table task is
  'En uppgift. Kretsen är fyra personer och ingen roll — se rubriken i 0054.';

-- -----------------------------------------------------------------------------
-- 3. De inbjudna
--
-- Beställarens tre ord: redigerare, visare, granskare. De ligger i EN tabell och
-- inte i tre, och nyckeln är (task_id, employee_id) — alltså EN roll per person
-- och uppgift.
--
-- Skälet är att rollerna inte är additiva utan motsägelsefulla. "Anna är både
-- visare och granskare" väcker frågan om hon får godkänna, och vilket svar
-- gränssnittet än ger är det en gissning. En rad, ett svar.
-- -----------------------------------------------------------------------------

create table if not exists task_member (
  task_id     uuid not null references task(id) on delete cascade,
  employee_id uuid not null references employee(id) on delete cascade,

  role text not null check (role in ('redigerare','visare','granskare')),

  added_by uuid not null references employee(id),
  added_at timestamptz not null default now(),

  primary key (task_id, employee_id)
);

create index if not exists task_member_person_idx on task_member (employee_id, role);

comment on column task_member.role is
  'redigerare ändrar, visare läser, granskare måste godkänna. FÖRST TILL KVARN: en godkännande granskare stänger uppgiften även om fler står med.';

-- -----------------------------------------------------------------------------
-- 4. Kopplingen
--
-- EN RAD PER KOPPLING, MED RIKTIGA FRÄMMANDE NYCKLAR — inte ett textfält med
-- ett id i och en typkolumn bredvid.
--
-- Den polymorfa varianten är kortare att skriva och går sönder tyst: en
-- makulerad order lämnar en uppgift som pekar ut i tomma intet, och ingen
-- databas kan säga till. Här städar `on delete cascade` bort kopplingen med
-- raden den pekade på, och uppgiften står kvar utan den.
--
-- KUNDEN ÄR ORDERN. Navet har inget kundregister — `sales_order` bär
-- bolagsnamn, orgnr och kontaktperson som egna kolumner, och affärsdossiern
-- (E11/M8) är blockerad. Beställarens beslut 2026-09-11: koppla till ordern som
-- finns, hellre än att hitta på ett register som M8 sedan måste göra om. En
-- uppgift om ett prospekt är tills vidare en uppgift utan koppling.
-- -----------------------------------------------------------------------------

create table if not exists task_link (
  id      uuid primary key default gen_random_uuid(),
  task_id uuid not null references task(id) on delete cascade,

  order_id         uuid references sales_order(id)  on delete cascade,
  case_id          uuid references hr_case(id)      on delete cascade,
  employee_id      uuid references employee(id)     on delete cascade,
  coaching_task_id uuid references coaching_task(id) on delete cascade,
  course_id        uuid references course(id)       on delete cascade,
  document_id      uuid references document(id)     on delete cascade,
  candidate_id     uuid references candidate(id)    on delete cascade,
  contract_id      uuid references contract(id)     on delete cascade,
  kv_call_id       uuid references kv_call(id)      on delete cascade,

  /**
   * Ser den uppgiften handlar om att den finns?
   *
   * GÄLLER BARA PERSONKOPPLINGEN, och grundläget är nej. Se rubriken överst om
   * varför — och om varför "nej" ändå inte betyder hemlig.
   */
  visible_to_subject boolean not null default false,

  created_by uuid not null references employee(id),
  created_at timestamptz not null default now(),

  constraint task_link_exakt_en check (
    (order_id is not null)::int
      + (case_id is not null)::int
      + (employee_id is not null)::int
      + (coaching_task_id is not null)::int
      + (course_id is not null)::int
      + (document_id is not null)::int
      + (candidate_id is not null)::int
      + (contract_id is not null)::int
      + (kv_call_id is not null)::int
    = 1
  ),

  -- Flaggan betyder ingenting på en order eller en kurs, och en flagga som
  -- ibland betyder något är en flagga någon förr eller senare läser fel.
  constraint task_link_synlighet_bara_person check (
    visible_to_subject = false or employee_id is not null
  )
);

-- Samma sak kopplad två gånger är en dubblett i gränssnittet, inte två
-- kopplingar. Alla nio kolumnerna är uuid, så `coalesce` ger ett jämförbart
-- värde utan att nio index behövs.
create unique index if not exists task_link_unik_idx on task_link (
  task_id,
  coalesce(order_id, case_id, employee_id, coaching_task_id, course_id,
           document_id, candidate_id, contract_id, kv_call_id)
);

create index if not exists task_link_person_idx on task_link (employee_id) where employee_id is not null;
create index if not exists task_link_order_idx  on task_link (order_id)    where order_id is not null;

comment on table task_link is
  'Vad uppgiften handlar om. Exakt en koppling per rad, med äkta nycklar — se rubriken i 0054.';

-- -----------------------------------------------------------------------------
-- 5. Historiken
--
-- Logg, inte tillstånd. `godkand` och `klar` är två olika sätt att bli klar och
-- hålls isär med flit: det första betyder att en människa tittade, det andra
-- att ingen behövde. Ett gemensamt `klar` hade gjort godkännandet osynligt i
-- efterhand, och då hade hela granskarrollen varit en knapp utan spår.
-- -----------------------------------------------------------------------------

create table if not exists task_event (
  id      uuid primary key default gen_random_uuid(),
  task_id uuid not null references task(id) on delete cascade,

  type text not null check (type in (
    'skapad',      -- raden kom till
    'tilldelad',   -- fick en ansvarig, eller bytte
    'paborjad',    -- någon satte igång
    'inlamnad',    -- klarmäld, väntar på granskare
    'godkand',     -- granskaren sa ja. Klar.
    'returnerad',  -- granskaren sa nej, med skäl. Öppen igen.
    'klar',        -- klar utan granskare
    'ateroppnad',  -- klar blev ogjord igen
    'avbruten',    -- ska inte göras
    'kommentar'    -- ändrar inget läge
  )),

  -- Tas ur sessionen i server action, aldrig ur ett argument — annars vore
  -- fältet en plats att signera någon annans namn på. Samma rad som 0043.
  by_employee_id uuid not null references employee(id),

  note text check (note is null or length(note) <= 2000),

  at timestamptz not null default now()
);

create index if not exists task_event_idx        on task_event (task_id, at desc);
create index if not exists task_event_person_idx on task_event (by_employee_id, at desc);

-- En returnering utan skäl är en tillsägelse utan innehåll. Databasen vägrar
-- den, så att gränssnittet inte kan glömma bort att fråga.
alter table task_event drop constraint if exists task_event_retur_kraver_skal;
alter table task_event add constraint task_event_retur_kraver_skal
  check (type <> 'returnerad' or (note is not null and length(btrim(note)) > 0));

-- -----------------------------------------------------------------------------
-- 6. Två nivåer, inte fler
--
-- En checklista under en rubrik är begriplig. En checklista under en checklista
-- under en rubrik är ett träd, och ett träd kräver en trädvy, ett
-- utfällningsläge och ett svar på vad "klar" betyder tre nivåer ned.
-- Beställningen var deluppgifter, inte en projektportfölj.
-- -----------------------------------------------------------------------------

create or replace function public.task_djup_vaktas()
returns trigger
language plpgsql
as $$
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'En uppgift kan inte vara sin egen deluppgift';
    end if;

    if exists (select 1 from public.task f where f.id = new.parent_id and f.parent_id is not null) then
      raise exception 'Deluppgifter går bara en nivå djupt';
    end if;
  end if;

  -- En uppgift som HAR deluppgifter kan inte själv bli en deluppgift. Utan den
  -- här grenen går det att bygga tre nivåer bakvägen: skapa A > B, och flytta
  -- sedan in A under C.
  if new.parent_id is not null
     and exists (select 1 from public.task b where b.parent_id = new.id) then
    raise exception 'Uppgiften har egna deluppgifter och kan inte flyttas in under en annan';
  end if;

  return new;
end;
$$;

drop trigger if exists task_djup_vakt on task;
create trigger task_djup_vakt
  before insert or update of parent_id on task
  for each row execute function public.task_djup_vaktas();

-- -----------------------------------------------------------------------------
-- 7. Behörighet
--
-- Läsning via RLS, skrivning uteslutande via server actions med service role
-- (D-T1) — som resten av navet.
--
-- `uppgift_synlig()` är SECURITY DEFINER, och det är inte en genväg. Policyn på
-- `task` behöver fråga om FÖRÄLDERNS krets för att kunna släppa fram en
-- deluppgift, alltså om en annan rad i samma tabell. En vanlig underfråga där
-- hade utlöst policyn en gång till på sig själv; Postgres stoppar det som
-- rekursion och hela frågan faller. Funktionen kringgår RLS inuti sig och
-- svarar på exakt en fråga, så kretsen står på ETT ställe i stället för fyra.
-- -----------------------------------------------------------------------------

create or replace function public.uppgift_synlig(p_task uuid, p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_employee is not null and exists (
    select 1
    from task t
    where t.id = p_task
      and (
        t.assignee_id = p_employee
        or t.created_by = p_employee
        or exists (
          select 1 from task_member m
          where m.task_id = t.id and m.employee_id = p_employee
        )
        or exists (
          select 1 from task_link l
          where l.task_id = t.id
            and l.employee_id = p_employee
            and l.visible_to_subject
        )
      )
  );
$$;

revoke all on function public.uppgift_synlig(uuid, uuid) from public, anon;
grant execute on function public.uppgift_synlig(uuid, uuid) to authenticated;

create or replace function public.projekt_synligt(p_project uuid, p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_employee is not null and exists (
    select 1
    from project p
    where p.id = p_project
      and (
        p.owner_id = p_employee
        or p.created_by = p_employee
        or exists (
          select 1 from project_member m
          where m.project_id = p.id and m.employee_id = p_employee
        )
      )
  );
$$;

revoke all on function public.projekt_synligt(uuid, uuid) from public, anon;
grant execute on function public.projekt_synligt(uuid, uuid) to authenticated;

alter table project        enable row level security;
alter table project_member enable row level security;
alter table task           enable row level security;
alter table task_member    enable row level security;
alter table task_link      enable row level security;
alter table task_event     enable row level security;

drop policy if exists project_read on project;
create policy project_read on project for select
  to authenticated
  using (public.projekt_synligt(id, public.current_employee_id()));

drop policy if exists project_member_read on project_member;
create policy project_member_read on project_member for select
  to authenticated
  using (public.projekt_synligt(project_id, public.current_employee_id()));

drop policy if exists task_read on task;
create policy task_read on task for select
  to authenticated
  using (
    public.uppgift_synlig(id, public.current_employee_id())
    or (parent_id is not null and public.uppgift_synlig(parent_id, public.current_employee_id()))
  );

drop policy if exists task_member_read on task_member;
create policy task_member_read on task_member for select
  to authenticated
  using (public.uppgift_synlig(task_id, public.current_employee_id()));

-- Personkopplingen är dold för den den handlar om så länge flaggan är av, och
-- `uppgift_synlig()` bär redan den regeln. Den som inte ser uppgiften ser
-- alltså inte heller att hen är kopplad till den.
drop policy if exists task_link_read on task_link;
create policy task_link_read on task_link for select
  to authenticated
  using (public.uppgift_synlig(task_id, public.current_employee_id()));

drop policy if exists task_event_read on task_event;
create policy task_event_read on task_event for select
  to authenticated
  using (public.uppgift_synlig(task_id, public.current_employee_id()));

-- -----------------------------------------------------------------------------
-- 8. Kvittot
--
-- Samma avläsning som 0043 gör. Den fångar det som är lätt att missa i en stor
-- migration: en tabell utan RLS, eller en skrivpolicy som smugit in och öppnat
-- en väg förbi server action.
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
  skrivpolicyer int;
begin
  foreach t in array array[
    'project','project_member','task','task_member','task_link','task_event'
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
end;
$$;

-- Djupvakten är hela skyddet mot en trädvy ingen beställt, och en trigger som
-- inte sitter fast ser precis ut som en trigger som aldrig behövde slå till.
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'task_djup_vakt' and not tgisinternal
  ) then
    raise exception 'task_djup_vakt sitter inte på task';
  end if;
end;
$$;
