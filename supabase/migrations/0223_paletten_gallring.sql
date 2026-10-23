-- 0223 · Paletten: frågorna sparas med dag, maskerade, och gallras (2026-10-23)
--
-- Granskningen S09 (F2-7), beställarens beslut B5 (2026-10-22): "Palettens
-- obesvarade frågor sparas i 90 dagar och med datum, inte klockslag."
--
-- Paletten lovar "Frågan sparas utan ditt namn". Det höll för namnet men inte
-- för identifierbarheten:
--   - `first_seen`/`last_seen` sparade sekunden. I ett bolag med tolv anställda
--     går en fråga ställd en gång kl. 10:41:32 att para ihop med den som var
--     aktiv då, och `palett_obesvarade` lämnade ut tiden till chefen.
--   - Texten maskerades inte, fast resten av navet maskerar personnummer
--     (0030 `ser_ut_som_personnummer`, 0135, `maskeraPersonnummer` i leads.ts).
--   - Ingenting raderade frågorna.
--
-- Här:
--   1. Tiderna byts mot `dag`, den senaste dagen frågan ställdes (svensk tid).
--      Tabellen var tom när filen skrevs (0 rader 2026-10-23), så inga tider
--      kastas.
--   2. `registrera_fragemiss` maskerar personnummer med samma uttryck som 0030,
--      och ett villkor vägrar en rad som ändå ser ut att bära ett.
--   3. `palett_obesvarade` lämnar inte ut någon tid alls, bara frågan och antalet.
--   4. Gallringen efter 90 dagar är steget `palett` i `src/lib/nav2/gallring.ts`,
--      avstängt tills beställaren sett antalen (B6).
--
-- Signaturerna för `registrera_fragemiss(text)` är oförändrade. `palett_obesvarade`
-- byter returtyp och måste därför tas bort och skapas igen; rättigheterna
-- sätts på nytt (sedan 0240 är en ny funktion stängd tills någon ger grant), och
-- dess md5 står i TILLATNA i tests/rattigheter-db.mjs.

alter table public.nav_question_miss
  add column dag date not null default (now() at time zone 'Europe/Stockholm')::date,
  drop column first_seen,
  drop column last_seen;

alter table public.nav_question_miss
  add constraint nav_question_miss_inget_personnummer check (not public.ser_ut_som_personnummer(q));

create index nav_question_miss_dag on public.nav_question_miss (dag);

create or replace function public.registrera_fragemiss(p_q text)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  insert into nav_question_miss (q, week, dag)
  select x.q,
         date_trunc('week', now() at time zone 'Europe/Stockholm')::date,
         (now() at time zone 'Europe/Stockholm')::date
    from (select btrim(left(lower(btrim(regexp_replace(p_q, '\d{6}[-+]?\d{4}', '[nummer dolt]', 'g'))), 200)) as q) x
   where coalesce(x.q, '') <> ''
  on conflict (q, week) do update
     set occurrences = nav_question_miss.occurrences + 1,
         dag         = excluded.dag
$$;

revoke all on function public.registrera_fragemiss(text) from public, anon, authenticated;
grant execute on function public.registrera_fragemiss(text) to service_role;

drop function public.palett_obesvarade(int);

/** Veckans frågor utan svar, flest gånger först. Ingen tid lämnas ut. Fel roll ger noll rader. */
create function public.palett_obesvarade(p_antal int default 10)
returns table (q text, antal int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.q, m.occurrences
    from nav_question_miss m
   where public.has_any_role(array['sales_manager','ceo','admin'])
     and m.week = date_trunc('week', now() at time zone 'Europe/Stockholm')::date
   order by m.occurrences desc, m.dag desc, m.q
   limit greatest(1, least(coalesce(p_antal, 10), 50))
$$;

-- Chefen läser med sin egen klient (paletten.ts, supabaseServer), och rollen
-- prövas i funktionen. Inget aktörsargument.
revoke all on function public.palett_obesvarade(int) from public, anon, authenticated;
grant execute on function public.palett_obesvarade(int) to authenticated, service_role;
