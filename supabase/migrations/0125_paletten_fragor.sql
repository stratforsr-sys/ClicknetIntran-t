-- 0125 · Paletten: frågor som Nav inte kunde svara på (2026-10-18)
--
-- Nav 2.0:s palett ("Sök, gör eller fråga Nav") lovar: "Frågor utan svar
-- sparas utan namn, och chefen ser dem som en lista." Chefens fråga lyder
-- "Vilka frågor kunde Nav inte svara på i veckan?", och svaret är frågan och
-- hur många gånger den ställts — i veckan.
--
-- Samma skäl som `search_miss` i 0029: raden har ingen person, inte en policy
-- som döljer den utan ingen kolumn att dölja. En fråga kan innehålla ett namn
-- eller ett ärende. Skillnaden mot `search_miss` är veckan i nyckeln: en
-- räknare sedan första gången kan inte svara på "i veckan".
--
-- Sökningarna utan träff på /sok står kvar i `search_miss`. En fråga i
-- paletten är något annat än en sökning, och Adoptions topplista ska inte
-- ändra innebörd.
--
-- INGET SKRIVER HIT AV SIG SJÄLVT. Bara `/nav2/paletten` anropar
-- `registrera_fragemiss`, och bara när `SKRIVLAGE.paletten` är på. Funktionen
-- är stängd för inloggade: rutten anropar den med service role.

create table public.nav_question_miss (
  -- Normaliseringen sker i funktionen; villkoret speglar den, som i 0029.
  q           text not null check (q = lower(btrim(q)) and char_length(q) between 1 and 200),
  -- Måndagen i veckan, svensk tid.
  week        date not null,
  occurrences int  not null default 1 check (occurrences > 0),
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  primary key (q, week)
);
create index nav_question_miss_vecka on public.nav_question_miss (week, occurrences desc);

-- RLS på och ingen policy: ingen inloggad läser tabellen direkt. Läsningen är
-- funktionen nedan, för samma krets som adoption_sokmissar.
alter table public.nav_question_miss enable row level security;

create or replace function public.registrera_fragemiss(p_q text)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  insert into nav_question_miss (q, week)
  select btrim(left(lower(btrim(p_q)), 200)),
         date_trunc('week', now() at time zone 'Europe/Stockholm')::date
   where btrim(coalesce(p_q, '')) <> ''
  on conflict (q, week) do update
     set occurrences = nav_question_miss.occurrences + 1,
         last_seen   = now()
$$;

/** Veckans frågor utan svar, flest gånger först. Fel roll ger noll rader. */
create or replace function public.palett_obesvarade(p_antal int default 10)
returns table (q text, antal int, senast timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.q, m.occurrences, m.last_seen
    from nav_question_miss m
   where public.has_any_role(array['sales_manager','ceo','admin'])
     and m.week = date_trunc('week', now() at time zone 'Europe/Stockholm')::date
   order by m.occurrences desc, m.last_seen desc
   limit greatest(1, least(coalesce(p_antal, 10), 50))
$$;

revoke execute on function public.registrera_fragemiss(text) from public, anon, authenticated;
grant  execute on function public.registrera_fragemiss(text) to service_role;
revoke execute on function public.palett_obesvarade(int)     from public, anon;
grant  execute on function public.palett_obesvarade(int)     to authenticated, service_role;
