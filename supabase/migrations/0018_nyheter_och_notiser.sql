-- =============================================================================
-- 0018_nyheter_och_notiser.sql — E5.2 nyhetsinlagg och E5.7 notisklockan
--
-- Tva saker som hor ihop. Nyheter ar den sista kanalen som saknades for att na
-- alla utan att upprepa sig, och klockan i toppraden ar det som gor att nagon
-- faktiskt ser det som skickas — bade nyheten, rutinen, kursen och svaret i
-- ett arende.
--
-- KLOCKAN LAGRAR INGA NOTISER.
--
-- Det fanns en enklare vag: en `notification`-tabell dar varje handling
-- skriver en rad. Den valdes bort. Varje ny producent maste da komma ihag att
-- skriva sin rad, och den som glommer det ger en tyst lucka — en kurs som
-- laggs upp utan att nagon far veta ser precis ut som en kurs ingen brydde sig
-- om. Raderna som redan finns ar dessutom sanningen: en okvitterad rutin ar
-- okvitterad oavsett vad en notistabell pastar.
--
-- Notiserna raknas darfor fram ur `document`, `course`, `news_post` och
-- `case_message` vid lasning, precis som `lageNu()` raknar fram stampellaget
-- ur handelserna. Det enda som lagras ar en tidpunkt per person: nar hen
-- senast oppnade klockan. Se `src/lib/notiser-server.ts`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Nyhetsinlagg (AC-11.2)
--
-- Samma malgruppsmonster som rutinbiblioteket: tom lista betyder alla. Att
-- aterananda `matches_audience` och inte hitta pa ett eget filter ar inte
-- bekvamlighet — funktionen bar redan sparren for konton som maste byta
-- losenord (0017), och ett eget filter hade tappat den tyst.
-- -----------------------------------------------------------------------------

create table if not exists news_post (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  title          text not null check (length(btrim(title)) > 0),
  body_md        text not null default '',

  audience_roles text[] not null default '{}',   -- tom = alla roller
  audience_teams uuid[] not null default '{}',   -- tom = alla team

  status         text not null default 'draft'
                   check (status in ('draft','published','archived')),

  -- Ett inlagg som ska sta kvar overst tills det inte behovs langre.
  -- Medvetet en boolean och inte en prioritetssiffra: tre nivaer slutar med
  -- att allt ar niva ett.
  pinned         boolean not null default false,

  author_id      uuid not null references employee(id),
  published_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- Samma sokkolumn som dokumenten, sa att E2.13 kan soka over bada utan att
  -- behova tva olika satt att fraga.
  search tsvector generated always as (
    setweight(to_tsvector('swedish', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('swedish', coalesce(body_md, '')), 'C')
  ) stored,

  -- Ett publicerat inlagg utan tidpunkt gar inte att sortera och syns aldrig
  -- som ny i klockan. Villkoret gor det omojligt i stallet for avratt.
  constraint news_post_publicerad check (
    (status = 'published' and published_at is not null)
    or (status <> 'published')
  )
);

create index if not exists news_post_search_idx on news_post using gin (search);
create index if not exists news_post_lista_idx  on news_post (status, pinned desc, published_at desc);

alter table news_post enable row level security;

drop policy if exists news_post_read on news_post;
create policy news_post_read on news_post for select
  to authenticated
  using (
    (status = 'published' and public.matches_audience(audience_roles, audience_teams))
    or author_id = public.current_employee_id()
    or public.has_any_role(array['sales_manager','admin','ceo'])
  );

-- -----------------------------------------------------------------------------
-- 2. Kursen behover veta nar den blev publicerad.
--
-- `created_at` duger inte: ett utkast kan ligga i tre veckor innan det slas pa,
-- och da hade kursen varit "ny" i klockan sedan den dagen nagon borjade skriva
-- den. Befintliga publicerade kurser far sitt `created_at` — det ar det basta
-- som gar att veta i efterhand, och alternativet vore att de aldrig syns.
-- -----------------------------------------------------------------------------

alter table course add column if not exists published_at timestamptz;

update course
   set published_at = created_at
 where status = 'published'
   and published_at is null;

-- -----------------------------------------------------------------------------
-- 3. Nar personen senast oppnade klockan.
--
-- En rad per anstalld, ingenting mer. Det som star kvar olast ar det som ar
-- nyare an tidpunkten — alltsa har navet ingen egen uppfattning om vad du
-- "har last", bara om nar du senast tittade. Skillnaden ar att en rad som
-- laggs till i efterhand med ett aldre datum inte forsvinner tyst.
--
-- Saknas raden ar allt olast. Det ar ratt hall att fela at: en ny anstalld ska
-- se sina rutiner och kurser, inte en tom klocka.
-- -----------------------------------------------------------------------------

create table if not exists notification_seen (
  employee_id uuid primary key references employee(id) on delete cascade,
  seen_at     timestamptz not null default now()
);

alter table notification_seen enable row level security;

drop policy if exists notification_seen_read on notification_seen;
create policy notification_seen_read on notification_seen for select
  to authenticated
  using (employee_id = public.current_employee_id());
