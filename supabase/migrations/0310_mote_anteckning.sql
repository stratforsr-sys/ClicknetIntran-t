-- =============================================================================
-- 0310_mote_anteckning.sql — Möten: anteckningar som blir en tråd per kort
--
-- Beställaren 2026-11-16: den som bokar ett möte bokar oftast åt någon annan.
-- Bokaren ska kunna lämna en anteckning, och anteckningen ska bli en tråd där
-- alla som är med på mötet läser, svarar och får notis. "Detta får aldrig gå
-- till kund." PRD: docs/superpowers/specs/2026-11-16-mote-anteckningar-design.md
--
-- EN TRÅD PER KORT (mote_kedja), inte per möte: ombokningar och
-- uppföljningsmöten ligger i samma tråd. `mote_id` säger vilket möte som var
-- aktuellt när inlägget skrevs, så att tråden kan sätta ut mötesdagen.
--
-- ALDRIG TILL KUNDEN. Tråden ligger i en egen tabell som inget i utkorgen,
-- kalenderns ICS eller kundbreven läser. tests/mote-anteckning-aldrig-kund.mjs
-- fäller den fil som börjar läsa den utanför den tillåtna listan.
--
-- ID:T SÄTTS AV WEBBLÄSAREN. Samma id = samma inlägg: ett nytt försök efter ett
-- nätfel, eller ett dubbeltryck, blir aldrig två inlägg (`on conflict (id) do
-- nothing` i rutten).
--
-- SKRIVNING: bara service role, genom POST /nav2/moten/anteckningar, där
-- rätten prövas (`farAndraKedja`). Här finns bara select-policyer.
--
-- STARTLÄGE: de gamla interna målen (`mote.mal`, "Mål, bara för er") blir
-- bokarens första inlägg med bokningens tid, och varje deltagare får en
-- sett-rad satt till nu, så att inget står som nytt när funktionen kommer.
--
-- ADDITIV. Två nya tabeller. Inga befintliga rader eller villkor ändras;
-- `mote.mal` står kvar orörd. Omkörbar.
-- =============================================================================

create table if not exists public.mote_anteckning (
  id        uuid primary key,
  kedja_id  uuid not null references public.mote_kedja(id) on delete cascade,
  mote_id   uuid references public.mote(id) on delete set null,
  av        uuid not null references public.employee(id),
  text      text,
  skapad    timestamptz not null default clock_timestamp(),
  andrad    timestamptz,
  borttagen timestamptz,
  -- Ett inlägg har text (1–4000 tecken efter trim), eller är borttaget och har ingen.
  -- Skrivet så att NULL aldrig släpper igenom: `text is not null and …` är false, inte null.
  constraint mote_anteckning_text check (
    (borttagen is null and text is not null and char_length(btrim(text)) between 1 and 4000)
    or (borttagen is not null and text is null)
  )
);

comment on table public.mote_anteckning is
  'Interna anteckningar per mötes-kort (0310). Går aldrig till kunden.';

create index if not exists mote_anteckning_kedja_idx on public.mote_anteckning (kedja_id, skapad);
create index if not exists mote_anteckning_av_idx on public.mote_anteckning (av);

create table if not exists public.mote_anteckning_sett (
  kedja_id    uuid not null references public.mote_kedja(id) on delete cascade,
  employee_id uuid not null references public.employee(id) on delete cascade,
  sett_till   timestamptz not null default now(),
  tyst        boolean not null default false,
  primary key (kedja_id, employee_id)
);

comment on table public.mote_anteckning_sett is
  'Hur långt personen läst kortets anteckningar, och om tråden är tystad för hen (0310).';

create index if not exists mote_anteckning_sett_employee_idx on public.mote_anteckning_sett (employee_id);

-- === RLS: bara select ========================================================

alter table public.mote_anteckning enable row level security;
alter table public.mote_anteckning_sett enable row level security;

revoke all on public.mote_anteckning from anon;
revoke all on public.mote_anteckning_sett from anon;

-- Samma krets som kortet (mote_kedja_read i 0260): chefen, eller deltagare i kedjan.
drop policy if exists mote_anteckning_read on public.mote_anteckning;
create policy mote_anteckning_read on public.mote_anteckning for select to authenticated
  using (exists (
    select 1 from public.mote_kedja k
    where k.id = mote_anteckning.kedja_id
      and ((select public.mote_ar_chef()) or (select public.current_employee_id()) = any (k.deltagare))
  ));

drop policy if exists mote_anteckning_sett_egen on public.mote_anteckning_sett;
create policy mote_anteckning_sett_egen on public.mote_anteckning_sett for select to authenticated
  using (employee_id = (select public.current_employee_id()));

-- === Startläge ===============================================================

-- De gamla målen blir bokarens första inlägg. Id:t är deterministiskt ur mötets id (md5 → uuid), så att en
-- omkörning inte lägger in dem igen.
insert into public.mote_anteckning (id, kedja_id, mote_id, av, text, skapad)
select md5('mote_anteckning:mal:' || m.id::text)::uuid, m.kedja_id, m.id, m.bokat_av, left(btrim(m.mal), 4000), m.bokat_nar
  from public.mote m
 where nullif(btrim(m.mal), '') is not null
on conflict (id) do nothing;

-- Allt som finns nu räknas som sett av alla som är med på kortet.
insert into public.mote_anteckning_sett (kedja_id, employee_id, sett_till)
select k.id, d.p, now()
  from public.mote_kedja k
 cross join lateral unnest(k.deltagare) as d(p)
  join public.employee e on e.id = d.p
on conflict (kedja_id, employee_id) do nothing;

-- === Kontroller ==============================================================

do $$
declare
  skrivpolicyer int;
begin
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = 'mote_anteckning' and c.relrowsecurity) then
    raise exception 'mote_anteckning saknar row level security';
  end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = 'mote_anteckning_sett' and c.relrowsecurity) then
    raise exception 'mote_anteckning_sett saknar row level security';
  end if;
  select count(*) into skrivpolicyer from pg_policies
   where schemaname = 'public' and tablename in ('mote_anteckning', 'mote_anteckning_sett') and cmd <> 'SELECT';
  if skrivpolicyer > 0 then
    raise exception 'mote_anteckning har % skrivpolicy(er) — skrivning ska gå via service role', skrivpolicyer;
  end if;
end;
$$;
