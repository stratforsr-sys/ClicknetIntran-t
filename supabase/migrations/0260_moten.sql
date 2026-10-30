-- =============================================================================
-- 0260_moten.sql — Möten: bolag, kedjor och möten, med RLS och två triggrar
--
-- -----------------------------------------------------------------------------
-- VARFÖR
-- -----------------------------------------------------------------------------
--
-- Mötestavlan (Nav 2.0, Möten, 2026-10-29) följer ett bolag från bokat möte till
-- affär eller nej. Tre lager:
--
--   mote_bolag   bolaget som bokats (telefon, domän, namn matchar mot Lynes)
--   mote_kedja   ett kort på tavlan: bolagets öppna ärende. Högst en öppen
--                kedja per bolag (unikt index), så att samma bolag aldrig får
--                två kort. Stängs med avslut = affar | nej | avbokat.
--   mote         ett enskilt möte i kedjan. Högst ett öppet (utfall null) per
--                kedja, så att två snabba "Boka möte" bara räknas en gång.
--
-- Spannet är 0260–0264 (PARALLELLT.md). Det här är A1: tabellerna, villkoren,
-- indexen, mote_ar_chef(), RLS och triggrarna. Kolumnfunktionen och vyerna
-- (0261) och uppslaget (0262) kommer separat.
--
-- -----------------------------------------------------------------------------
-- SKRIVNING OCH RLS
-- -----------------------------------------------------------------------------
--
-- Bara select-policyer. Alla skrivningar går med service role genom
-- POST /nav2/moten, där rättighetskontrollen ligger i TypeScript. Ser en
-- inloggad användare en rad? Chef (team_lead, sales_manager, ceo, admin) ser
-- allt; övriga ser kedjor där de själva är deltagare (bokat eller hållit något
-- möte i kedjan). Policyerna står i formen (select fn()) som i 0155, så att
-- funktionen räknas en gång per sats och inte per rad.
--
-- -----------------------------------------------------------------------------
-- CHECK-VILLKOR UTAN NULL
-- -----------------------------------------------------------------------------
--
-- Ett CHECK som ger NULL avvisar ingenting. Villkoren nedan är skrivna med
-- `is not distinct from` och coalesce, och provade mot rader som ska avvisas
-- (tests/moten-db.mjs).
--
-- -----------------------------------------------------------------------------
-- RÄTTIGHETER (0240)
-- -----------------------------------------------------------------------------
--
-- mote_ar_chef() anropas av RLS-policyerna och behöver `grant execute … to
-- authenticated`. Triggerfunktionerna körs av triggern utan att EXECUTE prövas
-- och får revoke från alla roller, utan grant.
-- =============================================================================

-- === Bolag ===================================================================

create table if not exists public.mote_bolag (
  id               uuid primary key default gen_random_uuid(),
  namn             text not null check (btrim(namn) <> ''),
  kontakt          text,
  telefon          text,                                  -- E.164 (+46701234567)
  epost            text,
  doman            text,                                  -- gemener, utan schema, www. eller sökväg
  kalla            text not null,
  skapad_av        uuid references public.employee(id) on delete set null,
  skapad           timestamptz not null default now(),
  senast_handelse  timestamptz not null default now()     -- sätts av trigger
);

create index if not exists mote_bolag_telefon_idx on public.mote_bolag (telefon);
create index if not exists mote_bolag_doman_idx   on public.mote_bolag (doman);
create index if not exists mote_bolag_namn_idx    on public.mote_bolag (lower(namn));

-- === Kedjor ==================================================================

create table if not exists public.mote_kedja (
  id                 uuid primary key default gen_random_uuid(),
  bolag_id           uuid not null references public.mote_bolag(id) on delete cascade,
  startad            timestamptz not null default now(),
  deltagare          uuid[] not null default '{}',        -- sätts av trigger på mote
  uppfoljning_datum  date,
  uppfoljning_text   text,
  offert_nar         timestamptz,
  offert_av          uuid references public.employee(id) on delete set null,
  inget_svar_i_rad   int not null default 0 check (inget_svar_i_rad >= 0),
  uppfoljning_andrad timestamptz,
  avslut             text,
  order_id           uuid references public.sales_order(id) on delete set null,
  nej_skal           text,
  avslut_nar         timestamptz,
  avslut_av          uuid references public.employee(id) on delete set null,
  constraint mote_kedja_avslut_varde check (avslut is null or avslut in ('affar','nej','avbokat')),
  constraint mote_kedja_avslut_par   check ((avslut is null) = (avslut_nar is null))
);

-- Ett kort per bolag: högst en öppen kedja.
create unique index if not exists mote_kedja_en_oppen
  on public.mote_kedja (bolag_id) where avslut is null;
create index if not exists mote_kedja_bolag_idx on public.mote_kedja (bolag_id);
create index if not exists mote_kedja_deltagare_idx on public.mote_kedja using gin (deltagare);

-- === Möten ===================================================================

create table if not exists public.mote (
  id               uuid primary key default gen_random_uuid(),
  kedja_id         uuid not null references public.mote_kedja(id) on delete cascade,
  event_id         uuid references public.calendar_event(id) on delete set null,
  bokat_av         uuid not null references public.employee(id),
  halls_av         uuid not null references public.employee(id),
  bokat_nar        timestamptz not null default now(),
  mote_tid         timestamptz not null,
  langd_min        int not null default 30 check (langd_min > 0),
  kalla            text not null,
  art              text not null default 'ny',
  foregaende_id    uuid references public.mote(id) on delete set null,
  mal              text,
  nulage           text,
  bekraftat_nar    timestamptz,
  bekraftat_av     uuid references public.employee(id) on delete set null,
  antal_flyttningar int not null default 0 check (antal_flyttningar >= 0),
  utfall           text,
  utfall_nar       timestamptz,
  utfall_av        uuid references public.employee(id) on delete set null,
  resultat         text,
  resultat_nar     timestamptz,
  resultat_av      uuid references public.employee(id) on delete set null,
  nej_skal         text,
  constraint mote_art_varde      check (art in ('ny','ombokning','uppfoljning')),
  constraint mote_nulage_varde   check (nulage is null or nulage in ('ingen','sjalv','byra')),
  constraint mote_utfall_varde   check (utfall is null or utfall in ('hallet','uteblev','avbokat')),
  constraint mote_resultat_varde check (resultat is null or resultat in ('affar','nej','offert','uppfoljning')),
  -- Ett resultat finns bara efter ett hållet möte. `is not distinct from` ger
  -- aldrig NULL, så en rad med utfall null och resultat satt avvisas.
  constraint mote_resultat_kraver_hallet check (resultat is null or utfall is not distinct from 'hallet'),
  constraint mote_utfall_par check ((utfall is null) = (utfall_nar is null))
);

create index if not exists mote_halls_av_idx on public.mote (halls_av);
create index if not exists mote_bokat_av_idx on public.mote (bokat_av);
create index if not exists mote_mote_tid_idx on public.mote (mote_tid);
create index if not exists mote_kedja_id_idx on public.mote (kedja_id);

-- Högst ett öppet möte per kedja.
create unique index if not exists mote_ett_oppet
  on public.mote (kedja_id) where utfall is null;

-- === Chef ====================================================================

create or replace function public.mote_ar_chef()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_any_role(array['team_lead','sales_manager','ceo','admin'])
$$;

revoke all on function public.mote_ar_chef() from public, anon;
grant execute on function public.mote_ar_chef() to authenticated, service_role;

-- === RLS: bara select ========================================================

alter table public.mote_bolag enable row level security;
alter table public.mote_kedja enable row level security;
alter table public.mote       enable row level security;

drop policy if exists mote_kedja_read on public.mote_kedja;
create policy mote_kedja_read on public.mote_kedja for select to authenticated
  using ((select public.mote_ar_chef()) or (select public.current_employee_id()) = any (deltagare));

drop policy if exists mote_read on public.mote;
create policy mote_read on public.mote for select to authenticated
  using (exists (
    select 1 from public.mote_kedja k
    where k.id = mote.kedja_id
      and ((select public.mote_ar_chef()) or (select public.current_employee_id()) = any (k.deltagare))
  ));

drop policy if exists mote_bolag_read on public.mote_bolag;
create policy mote_bolag_read on public.mote_bolag for select to authenticated
  using (exists (
    select 1 from public.mote_kedja k
    where k.bolag_id = mote_bolag.id
      and ((select public.mote_ar_chef()) or (select public.current_employee_id()) = any (k.deltagare))
  ));

-- === Triggrar ================================================================

-- Efter insert eller update på mote: bokat_av och halls_av in i kedjans
-- deltagare (en gång var), och bolagets senast_handelse flyttas fram.
create or replace function public.mote_efter_andring()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.mote_kedja k
     set deltagare = (
           select coalesce(array_agg(distinct p), '{}')
           from unnest(k.deltagare || array[new.bokat_av, new.halls_av]) as p
         )
   where k.id = new.kedja_id
     and not (k.deltagare @> array[new.bokat_av, new.halls_av]);

  update public.mote_bolag b
     set senast_handelse = now()
    from public.mote_kedja k
   where k.id = new.kedja_id and b.id = k.bolag_id;

  return null;
end;
$$;

-- Efter update på mote_kedja: bara bolagets senast_handelse. Rör inte deltagare.
create or replace function public.mote_kedja_efter_andring()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.mote_bolag set senast_handelse = now() where id = new.bolag_id;
  return null;
end;
$$;

revoke all on function public.mote_efter_andring() from public, anon, authenticated;
revoke all on function public.mote_kedja_efter_andring() from public, anon, authenticated;

drop trigger if exists mote_efter_andring on public.mote;
create trigger mote_efter_andring
  after insert or update on public.mote
  for each row execute function public.mote_efter_andring();

drop trigger if exists mote_kedja_efter_andring on public.mote_kedja;
create trigger mote_kedja_efter_andring
  after update on public.mote_kedja
  for each row execute function public.mote_kedja_efter_andring();
