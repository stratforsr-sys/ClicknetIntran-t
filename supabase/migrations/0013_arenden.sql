-- =============================================================================
-- 0013_arenden.sql — M4 Personalärenden (E3, PRD §7 M4)
--
-- Modulen som avlastar chefen mest per dag: frågan som idag kommer på Teams,
-- i korridoren eller i en SMS-tråd får en plats där den inte tappas bort.
--
-- AC-4.3 är det känsligaste kravet. Ett konfidentiellt ärende — konflikt,
-- arbetsmiljö, något om en kollega — får synas för säljchef och VD, ingen
-- annan. Inte för administratören, inte för teamledaren, inte för den som råkar
-- vara tilldelad något annat. Gränsen ligger i RLS och provas mot API:t, för en
-- vy som filtrerar i React är ingen gräns.
--
-- `case` är reserverat i SQL. Tabellen heter `hr_case`.
-- =============================================================================

-- AC-4.1. Kategorierna är PRD:ns egna och ska inte utökas av bekvämlighet:
-- en lista som växer till tjugo poster gör statistiken i AC-4.5 meningslös.
create table if not exists case_category (
  id          text primary key check (id in (
                'pay','equipment','schedule','work_env','conflict','development','other')),
  label       text not null,
  sort        int  not null,

  -- AC-4.2: svarstiden är konfigurerbar per kategori. En fråga om utrustning
  -- och en om arbetsmiljö har inte samma tålamod.
  sla_hours   int  not null default 48 check (sla_hours > 0),

  -- Konflikt och arbetsmiljö föreslås som konfidentiella redan i formuläret.
  -- Förvalet är en hjälp, inte ett beslut — den anställda kan ändra.
  default_confidential boolean not null default false
);

insert into case_category (id, label, sort, sla_hours, default_confidential)
select * from (values
  ('pay',         'Lön och provision', 1, 48,  false),
  ('equipment',   'Utrustning',        2, 72,  false),
  ('schedule',    'Schema',            3, 48,  false),
  ('work_env',    'Arbetsmiljö',       4, 24,  true),
  ('conflict',    'Konflikt',          5, 24,  true),
  ('development', 'Utveckling',        6, 168, false),
  ('other',       'Övrigt',            7, 72,  false)
) as v(id, label, sort, sla_hours, default_confidential)
where not exists (select 1 from case_category);

create table if not exists hr_case (
  id            uuid primary key default gen_random_uuid(),

  -- Vems ärende det handlar om. Nästan alltid samma som den som skrev det,
  -- men en chef ska kunna lägga upp ett ärende åt någon som ringde.
  employee_id   uuid not null references employee(id) on delete cascade,
  created_by    uuid references employee(id),

  category      text not null references case_category(id),
  subject       text not null check (length(btrim(subject)) > 0),

  status        text not null default 'new'
                  check (status in ('new','in_progress','waiting','resolved')),

  -- AC-4.3.
  confidential  boolean not null default false,

  -- AC-4.6: datamodellen ska stödja anonymt ärende. Funktionen är avstängd i
  -- koden tills bolaget passerar 50 anställda och visselblåsarlagen träder in.
  -- Kolumnen finns nu därför att en anonym kanal som byggs i efterhand alltid
  -- går att spåra bakåt i loggarna — och då är den inte anonym.
  anonymous     boolean not null default false,

  assigned_to   uuid references employee(id),

  -- AC-4.2: fristen fryses vid upplägget. Ändras kategorins SLA i morgon får
  -- det inte flytta gårdagens frist.
  sla_hours     int not null,
  due_at        timestamptz not null,
  escalated_at  timestamptz,

  resolved_at   timestamptz,
  resolution    text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint hr_case_avslut check (
    (status = 'resolved' and resolved_at is not null)
    or (status <> 'resolved' and resolved_at is null)
  )
);

create index if not exists hr_case_person_idx on hr_case (employee_id, created_at desc);
create index if not exists hr_case_oppna_idx  on hr_case (due_at) where resolved_at is null;
create index if not exists hr_case_statistik_idx on hr_case (category, created_at);

-- AC-4.4: den anställda ser hela dialogen. Det finns därför ingen intern
-- anteckning i den här tabellen och ska inte läggas till: ett fält som chefen
-- kan skriva i utan att den berörda ser det gör hela ärendet till något annat
-- än det utger sig för att vara.
create table if not exists case_message (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references hr_case(id) on delete cascade,
  author_id   uuid references employee(id),
  body        text not null check (length(btrim(body)) > 0),
  created_at  timestamptz not null default now()
);

create index if not exists case_message_arende_idx on case_message (case_id, created_at);

-- Ett meddelande är sagt när det är sagt. Att kunna skriva om det i efterhand
-- gör dialogen värdelös som minnesbild av vad som faktiskt hände.
create or replace function public.case_message_ar_orubblig()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Ett meddelande kan varken ändras eller tas bort. Skriv ett nytt.';
end;
$$;

drop trigger if exists case_message_orubblig on case_message;
create trigger case_message_orubblig
  before update or delete on case_message
  for each row execute function public.case_message_ar_orubblig();

create or replace function public.hr_case_ror_vid()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists hr_case_rord on hr_case;
create trigger hr_case_rord
  before update on hr_case
  for each row execute function public.hr_case_ror_vid();

-- -----------------------------------------------------------------------------
-- Behörighet
-- -----------------------------------------------------------------------------
alter table case_category enable row level security;
alter table hr_case       enable row level security;
alter table case_message  enable row level security;

drop policy if exists case_category_read on case_category;
create policy case_category_read on case_category for select to authenticated using (true);

-- AC-4.3 och AC-4.4 i en policy: din egen tråd alltid, andras bara om du är
-- säljchef eller VD — och är ärendet konfidentiellt gäller ingenting annat.
-- Administratörsrollen är med flit utelämnad: den är teknisk, inte personal-
-- ansvarig, och ett konfliktärende är inget driftärende.
drop policy if exists hr_case_read on hr_case;
create policy hr_case_read on hr_case for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or (
      not confidential
      and (
        assigned_to = public.current_employee_id()
        or public.has_any_role(array['sales_manager','ceo'])
      )
    )
    or (confidential and public.has_any_role(array['sales_manager','ceo']))
  );

drop policy if exists case_message_read on case_message;
create policy case_message_read on case_message for select
  to authenticated
  using (
    exists (
      select 1 from public.hr_case c
      where c.id = case_message.case_id
        and (
          c.employee_id = public.current_employee_id()
          or (not c.confidential and (
                c.assigned_to = public.current_employee_id()
                or public.has_any_role(array['sales_manager','ceo'])))
          or (c.confidential and public.has_any_role(array['sales_manager','ceo']))
        )
    )
  );
