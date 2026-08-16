-- =============================================================================
-- 0003_rutiner.sql — M5 Rutiner och dokument (PRD §7 M5, E2)
--
-- Barande tanke: ett dokument utan agare och granskningsdatum ska vara
-- OMOJLIGT att skapa, inte bara avratt i formularet. Darav not null pa bada
-- (AC-5.1). Ett formular kan kringgas; ett kolumnvillkor kan det inte.
-- =============================================================================

create table if not exists document (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  slug           text not null unique,
  category_path  text not null default '',      -- 'HR/Anstallning', styr mappträdet
  body_md        text not null default '',
  owner_id       uuid not null references employee(id),   -- AC-5.1
  review_due     date not null,                           -- AC-5.1
  version        int  not null default 1,
  status         text not null default 'draft'
                   check (status in ('draft','published','archived')),
  audience_roles text[] not null default '{}',  -- tom = alla roller
  audience_teams uuid[] not null default '{}',  -- tom = alla team
  requires_ack   boolean not null default false,
  doc_type       text not null default 'routine'
                   check (doc_type in ('routine','policy','work_env_policy',
                                       'risk_assessment','task_allocation',
                                       'script','price_list','case')),
  published_at   timestamptz,
  created_by     uuid references employee(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- AC-5.7: fritextsok. Genererad kolumn sa att den aldrig kan hamna ur fas
  -- med innehallet. Svensk ordstamsanalys: "rutiner" traffar "rutin".
  search tsvector generated always as (
    setweight(to_tsvector('swedish', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('swedish', coalesce(category_path, '')), 'B') ||
    setweight(to_tsvector('swedish', coalesce(body_md, '')), 'C')
  ) stored
);

create index if not exists document_search_idx   on document using gin (search);
create index if not exists document_status_idx   on document (status);
create index if not exists document_owner_idx    on document (owner_id);
create index if not exists document_review_idx   on document (review_due);
create index if not exists document_category_idx on document (category_path);

-- AC-5.4: varje sparning skapar en ny version. Tidigare versioner ar lasbara.
create table if not exists document_version (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references document(id) on delete cascade,
  version     int  not null,
  title       text not null,
  body_md     text not null,
  changed_by  uuid references employee(id),
  changed_at  timestamptz not null default now(),
  change_note text,
  unique (document_id, version)
);

-- AC-5.5: kvittensen ar kopplad till VERSIONEN, inte till dokumentet.
-- Ny version = ny kvittens kravs. Det ar hela poangen med AC-5.3 i praktiken:
-- "jag har last den" ska betyda "jag har last DEN HAR lydelsen".
create table if not exists document_ack (
  document_id uuid not null references document(id) on delete cascade,
  version     int  not null,
  employee_id uuid not null references employee(id) on delete cascade,
  acked_at    timestamptz not null default now(),
  primary key (document_id, employee_id, version)
);

create index if not exists document_ack_doc_idx on document_ack (document_id, version);

-- AC-12.5: dokument utan visningar pa 90 dagar. En rad per person och dokument,
-- uppdaterad vid lasning — inte en logg over varje oppning, vilket vore bade
-- oproportionerligt och meningslost stort.
create table if not exists document_view (
  document_id uuid not null references document(id) on delete cascade,
  employee_id uuid not null references employee(id) on delete cascade,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  views       int not null default 1,
  primary key (document_id, employee_id)
);

-- =============================================================================
-- Malgruppsstyrning
-- =============================================================================

-- AC-5.8. Tom lista betyder "alla" — inte "ingen". Det ar den vanligaste
-- buggen i den har sortens regel, sa villkoret star explicit.
create or replace function public.matches_audience(p_roles text[], p_teams uuid[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    (p_roles is null or cardinality(p_roles) = 0 or exists (
      select 1
      from public.employee_role r
      join public.employee e on e.id = r.employee_id
      where e.auth_user_id = auth.uid()
        and e.status <> 'offboarded'
        and r.role = any(p_roles)))
    and
    (p_teams is null or cardinality(p_teams) = 0 or exists (
      select 1
      from public.employee e
      where e.auth_user_id = auth.uid()
        and e.status <> 'offboarded'
        and e.team_id = any(p_teams)))
$$;

-- Far redigera dokument. PRD §5.2: sales_manager och admin har RW, ovriga R.
-- Agaren far redigera sitt eget aven utan de rollerna — annars kan ansvaret
-- i AC-5.1 inte utovas.
create or replace function public.can_edit_documents()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_any_role(array['sales_manager','admin'])
$$;

-- =============================================================================
-- RLS
-- =============================================================================

alter table document         enable row level security;
alter table document_version enable row level security;
alter table document_ack     enable row level security;
alter table document_view    enable row level security;

-- Publicerat + ratt malgrupp. Agaren ser sitt eget aven som utkast.
-- Ledningen ser allt, annars gar inte granskningsansvaret att utova.
drop policy if exists document_read on document;
create policy document_read on document for select
  to authenticated
  using (
    (status = 'published' and public.matches_audience(audience_roles, audience_teams))
    or owner_id = public.current_employee_id()
    or public.has_any_role(array['sales_manager','admin','ceo'])
  );

drop policy if exists document_version_read on document_version;
create policy document_version_read on document_version for select
  to authenticated
  using (exists (select 1 from public.document d where d.id = document_id));

-- Egen kvittens alltid. Kvittensrapporten (AC-5.6) kraver att den som ager
-- dokumentet — eller ledningen — ser vilka som INTE kvitterat.
drop policy if exists document_ack_read on document_ack;
create policy document_ack_read on document_ack for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.has_any_role(array['sales_manager','admin','ceo'])
    or exists (select 1 from public.document d
               where d.id = document_id and d.owner_id = public.current_employee_id())
  );

drop policy if exists document_view_read on document_view;
create policy document_view_read on document_view for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.has_any_role(array['sales_manager','admin','ceo'])
  );

-- Skrivratten togs bort fran klientrollerna i 0002 och galler aven har via
-- alter default privileges. Skrivning sker uteslutande i server actions.

-- =============================================================================
-- Standardvarden for de dokumenttyper arbetsmiljolagen kraver
--
-- AC-5.9: work_env_policy, risk_assessment och task_allocation ska ha arlig
-- granskning som standard. Det ar inte en UI-detalj — det ar den enda
-- mekanism som gor att K24 och K32 inte glomsbort nasta ar.
-- =============================================================================

create or replace function public.standard_review_due(p_doc_type text)
returns date
language sql
immutable
as $$
  select case
    when p_doc_type in ('work_env_policy','risk_assessment','task_allocation')
      then (current_date + interval '1 year')::date
    when p_doc_type = 'price_list'
      then (current_date + interval '6 months')::date
    else (current_date + interval '1 year')::date
  end
$$;
