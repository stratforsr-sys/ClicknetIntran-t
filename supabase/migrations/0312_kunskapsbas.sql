-- 0312: kunskapsbasen (PRD:n 2026-11-16, "Kunskapsbasen i Inställningar")
--
-- Beställaren 2026-11-16: kunskapen ska inte ligga i Rutiner. Den får en egen
-- plats, Inställningar → Kunskapsbas, där dokument laddas upp. Chatten söker
-- här först och i publicerade rutiner därefter.
--
--   kunskap_dokument  Dokumentet som det lades in: titel, område, filens namn
--                     och hela texten. Filen själv sparas inte.
--   kunskap_stycke    Dokumentet delat i stycken som ryms i det chatten läser,
--                     med svenskt sökindex. Skrivs om varje gång dokumentet
--                     ändras, så titel, område och dag står på varje stycke.
--   kunskap_miss      Sökningar chatten gjorde utan att hitta ett svar. Utan
--                     person: listan säger vad kunskapsbasen saknar, inte vem
--                     som frågade.
--
-- Alla som är inloggade läser dokumenten och styckena (chatten läser som den
-- inloggade). Bara servern skriver, efter att rutten /nav2/kunskap har prövat
-- att personen sköter företagets inställningar.
--
-- ADDITIV: ingen befintlig tabell ändras, och main läser inget av detta.
-- Omkörbar.

create table if not exists public.kunskap_dokument (
  id        uuid primary key default gen_random_uuid(),
  titel     text not null,
  omrade    text not null default '',
  filnamn   text,
  text      text not null,
  andrad    timestamptz not null default now(),
  andrad_av uuid references public.employee(id) on delete set null,
  -- Skrivna så att NULL aldrig släpper igenom: kolumnerna är NOT NULL.
  constraint kunskap_dokument_titel check (char_length(btrim(titel)) between 1 and 160),
  constraint kunskap_dokument_omrade check (char_length(omrade) <= 80),
  constraint kunskap_dokument_filnamn check (filnamn is null or char_length(filnamn) between 1 and 200),
  constraint kunskap_dokument_text check (char_length(btrim(text)) between 1 and 400000)
);
comment on table public.kunskap_dokument is
  'Kunskapsbasen (0312): det företaget har skrivit eller laddat upp om hur det arbetar. Chatten svarar ur den.';
create index if not exists kunskap_dokument_andrad_av_idx on public.kunskap_dokument (andrad_av);

create table if not exists public.kunskap_stycke (
  id       bigint generated always as identity primary key,
  dokument uuid not null references public.kunskap_dokument(id) on delete cascade,
  ordning  integer not null,
  titel    text not null,
  omrade   text not null default '',
  rubrik   text not null default '',
  text     text not null,
  andrad   timestamptz not null,
  search   tsvector generated always as (
    setweight(to_tsvector('swedish', titel || ' ' || omrade || ' ' || rubrik), 'A') || setweight(to_tsvector('swedish', text), 'B')
  ) stored,
  constraint kunskap_stycke_text check (char_length(text) between 1 and 4000),
  unique (dokument, ordning)
);
comment on table public.kunskap_stycke is
  'Kunskapsbasens dokument delade i stycken med sökindex (0312). Skrivs om när dokumentet ändras.';
create index if not exists kunskap_stycke_search_idx on public.kunskap_stycke using gin (search);

create table if not exists public.kunskap_miss (
  id     bigint generated always as identity primary key,
  sokord text not null check (char_length(sokord) between 2 and 200),
  nar    timestamptz not null default now()
);
comment on table public.kunskap_miss is
  'Sökningar i kunskapsbasen utan svar (0312). Utan person.';
create index if not exists kunskap_miss_nar_idx on public.kunskap_miss (nar desc);

alter table public.kunskap_dokument enable row level security;
alter table public.kunskap_stycke enable row level security;
alter table public.kunskap_miss enable row level security;

revoke all on public.kunskap_dokument, public.kunskap_stycke, public.kunskap_miss from public, anon, authenticated;
grant select on public.kunskap_dokument, public.kunskap_stycke to authenticated;
grant select, insert, update, delete on public.kunskap_dokument, public.kunskap_stycke, public.kunskap_miss to service_role;

drop policy if exists kunskap_dokument_read on public.kunskap_dokument;
create policy kunskap_dokument_read on public.kunskap_dokument for select to authenticated
  using ((select public.current_employee_id()) is not null);
drop policy if exists kunskap_stycke_read on public.kunskap_stycke;
create policy kunskap_stycke_read on public.kunskap_stycke for select to authenticated
  using ((select public.current_employee_id()) is not null);

-- Sökningen: de stycken som matchar, bäst träff först. Körs som den som frågar, så att RLS gäller.
create or replace function public.kunskap_sok(p_sokord text, p_max integer)
returns table (titel text, omrade text, rubrik text, text text, andrad timestamptz)
language sql stable security invoker set search_path = public, pg_temp
as $$
  select s.titel, s.omrade, s.rubrik, s.text, s.andrad
    from public.kunskap_stycke s, websearch_to_tsquery('swedish', p_sokord) q
   where s.search @@ q
   order by ts_rank(s.search, q) desc, s.andrad desc, s.id
   limit least(greatest(p_max, 1), 20);
$$;
revoke all on function public.kunskap_sok(text, integer) from public, anon;
grant execute on function public.kunskap_sok(text, integer) to authenticated, service_role;

-- Sparningen: dokumentet och dess stycken i en och samma transaktion, så att ett dokument aldrig står utan
-- stycken (och därmed inte går att hitta). Bara servern anropar den. Null i svaret: dokumentet finns inte.
create or replace function public.kunskap_spara(p_id uuid, p_titel text, p_omrade text, p_filnamn text, p_text text, p_av uuid, p_stycken jsonb)
returns uuid
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_nar timestamptz := now();
begin
  if jsonb_typeof(p_stycken) is distinct from 'array' or jsonb_array_length(p_stycken) = 0 then
    raise exception 'Dokumentet har inga stycken.';
  end if;
  if p_id is null then
    insert into public.kunskap_dokument (titel, omrade, filnamn, text, andrad, andrad_av)
    values (p_titel, p_omrade, p_filnamn, p_text, v_nar, p_av) returning id into v_id;
  else
    update public.kunskap_dokument set titel = p_titel, omrade = p_omrade, text = p_text, andrad = v_nar, andrad_av = p_av
     where id = p_id returning id into v_id;
    if v_id is null then return null; end if;
    delete from public.kunskap_stycke where dokument = v_id;
  end if;
  insert into public.kunskap_stycke (dokument, ordning, titel, omrade, rubrik, text, andrad)
  select v_id, s.ordning, p_titel, p_omrade, coalesce(s.e->>'rubrik', ''), s.e->>'text', v_nar
    from jsonb_array_elements(p_stycken) with ordinality as s(e, ordning);
  return v_id;
end $$;
revoke all on function public.kunskap_spara(uuid, text, text, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.kunskap_spara(uuid, text, text, text, text, uuid, jsonb) to service_role;

-- Kontrollen: ingen skrivpolicy finns, och miss-listan går inte att läsa utan servern.
do $$
declare
  n int;
begin
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename in ('kunskap_dokument', 'kunskap_stycke', 'kunskap_miss') and cmd <> 'SELECT';
  if n > 0 then raise exception 'Kunskapsbasen ska bara skrivas av servern, men % skrivpolicyer finns.', n; end if;
  if has_table_privilege('authenticated', 'public.kunskap_miss', 'select') then
    raise exception 'kunskap_miss ska inte gå att läsa för inloggade.';
  end if;
  if has_table_privilege('anon', 'public.kunskap_stycke', 'select') then
    raise exception 'kunskap_stycke ska inte gå att läsa utan inloggning.';
  end if;
end $$;
