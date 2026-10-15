-- 0082 · Fel: det Nav 2.0 har och navet saknade (2026-10-15)
--
-- =============================================================================
-- VARFÖR
--
-- Nav 2.0:s felvy har sju saker som `error_report` (0026) inte bär:
--
--   1. "Peka på det som är fel": vad personen klickade på, i ord.
--   2. "Jag tar den": vem som äger felet. `handled_by` är den som senast rörde
--      raden, och det är en annan fråga.
--   3. Svar i en tråd. `resolution` är en enda text vid avslutet.
--   4. "Fungerar det nu?": den som rapporterade bekräftar, eller säger nej så
--      att felet öppnas igen.
--   5. "Samma för mig, ge mig besked" och "Jag har också det här": fler än den
--      som rapporterade får besked när felet är lagat.
--   6. "Kända fel just nu" med "Under tiden": ett öppet fel som alla får se,
--      med en rubrik och ett råd som den som hanterar kön skrivit.
--   7. "Det här har rapporterna gjort": antal lagade och mediantid, för alla.
--
-- Och en åttonde som förbereds men inte slås på här: träffar per dag och hur
-- många personer ett automatiskt fel drabbat (`error_occurrence`). Tabellen
-- finns, men `registrera_fel` skriver inte till den förrän beställaren sagt ja
-- (se "VÄNTAR" sist i filen).
--
-- Beställaren 2026-10-15: ingen funktion i utkastet får försvinna. Det som
-- saknar backend ska få backend, och skrivningarna slås på vy för vy.
-- =============================================================================
--
-- =============================================================================
-- ADDITIV, OCH MAIN RÖRS INTE
--
-- Sex nya kolumner på `error_report`, alla nullbara, och tre nya tabeller.
-- Mains kod listar sina kolumner och skriver aldrig de nya. `registrera_fel`
-- och läsregeln `error_report_read` är oförändrade.
--
-- BEHÖRIGHETEN FRÅN 0026 STÅR. Kön läses av sales_manager, ceo och admin, och
-- var och en ser sina egna rapporter. Det enda som når fler är det den som
-- hanterar kön själv skrivit för alla: rubriken och rådet för ett känt fel
-- (`kanda_fel()`), och antal (`fel_statistik()`). Ingen annans text, sida
-- eller namn går ut den vägen.
--
-- Inloggade har bara läsrätt. Servern skriver med service role efter egna
-- kontroller (src/app/nav2/fel/route.ts), som resten av navet.
-- =============================================================================

-- 1, 2, 4 och 6: kolumnerna på raden.
alter table public.error_report
  add column pointed_at text check (pointed_at is null or length(pointed_at) <= 300),
  add column assigned_to uuid references public.employee (id) on delete set null,
  add column confirmed_at timestamptz,
  add column confirmed_ok boolean,
  add column public_title text check (public_title is null or length(btrim(public_title)) between 1 and 200),
  add column workaround text check (workaround is null or length(btrim(workaround)) between 1 and 500),
  add constraint error_report_bekraftelse_hel check ((confirmed_at is null) = (confirmed_ok is null));

-- 3. Tråden. En rad syns för den som ser rapporten (error_report_read avgör).
create table public.error_report_message (
  id uuid primary key default gen_random_uuid(),
  error_id uuid not null references public.error_report (id) on delete cascade,
  author_id uuid references public.employee (id) on delete set null,
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index error_report_message_fel on public.error_report_message (error_id, created_at);
alter table public.error_report_message enable row level security;
create policy error_report_message_las on public.error_report_message for select
  using (exists (select 1 from public.error_report r where r.id = error_id));

-- 5. De som har samma fel. Var och en ser sina egna rader, kön ser alla.
create table public.error_report_follower (
  error_id uuid not null references public.error_report (id) on delete cascade,
  employee_id uuid not null references public.employee (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (error_id, employee_id)
);
create index error_report_follower_person on public.error_report_follower (employee_id);
alter table public.error_report_follower enable row level security;
create policy error_report_follower_las on public.error_report_follower for select
  using (employee_id = public.current_employee_id()
         or public.has_any_role(array['sales_manager', 'ceo', 'admin']));

-- 8. Förekomsterna. Läses bara av kön. Skrivs inte förrän "VÄNTAR" körts.
create table public.error_occurrence (
  id bigint generated always as identity primary key,
  error_id uuid not null references public.error_report (id) on delete cascade,
  employee_id uuid references public.employee (id) on delete set null,
  seen_at timestamptz not null default now()
);
create index error_occurrence_fel on public.error_occurrence (error_id, seen_at desc);
alter table public.error_occurrence enable row level security;
create policy error_occurrence_las on public.error_occurrence for select
  using (public.has_any_role(array['sales_manager', 'ceo', 'admin']));

-- 6. Kända fel för alla. Bara det kön skrivit för alla, och bara öppna fel.
-- `drabbade` är den som rapporterade plus de som sagt att de har samma fel.
-- `foljer` säger om läsaren själv redan sagt det.
create function public.kanda_fel()
returns table (id uuid, kind text, status text, path text, titel text, workaround text, drabbade integer, foljer boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.id, r.kind, r.status, r.path, r.public_title, r.workaround,
         ((select count(*) from public.error_report_follower f where f.error_id = r.id)
           + case when r.reporter_id is null then 0 else 1 end)::integer,
         exists (select 1 from public.error_report_follower f
                  where f.error_id = r.id and f.employee_id = public.current_employee_id())
    from public.error_report r
   where r.status <> 'closed'
     and r.public_title is not null
     and r.workaround is not null
     and public.current_employee_id() is not null
   order by r.blocking desc, r.last_seen_at desc
   limit 20
$$;
revoke all on function public.kanda_fel() from public;
grant execute on function public.kanda_fel() to authenticated;

-- 7. Vad rapporterna gjort. Bara antal och tider, aldrig en rad.
-- `sedan` är första dagen i förra månaden, så att siffran inte nollas den 1:a.
-- `mina` är avslutade fel som läsaren rapporterat eller följt.
create function public.fel_statistik()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with g as (
    select date_trunc('month', (now() at time zone 'Europe/Stockholm')::date - interval '1 month')::date as sedan
  ), lagade as (
    select r.* from public.error_report r, g
     where r.status = 'closed' and r.handled_at >= g.sedan
  ), tider as (
    select extract(epoch from (r.handled_at - r.first_seen_at)) / 86400.0 as dagar, r.blocking
      from public.error_report r
     where r.status = 'closed' and r.handled_at >= now() - interval '30 days'
  )
  select case when public.current_employee_id() is null then null else jsonb_build_object(
    'sedan', (select sedan from g),
    'lagade', (select count(*) from lagade),
    'automatiska', (select count(*) from lagade where kind = 'automatic'),
    'mina', (select count(*) from lagade l
              where l.reporter_id = public.current_employee_id()
                 or exists (select 1 from public.error_report_follower f
                             where f.error_id = l.id and f.employee_id = public.current_employee_id())),
    'median_dagar', (select percentile_cont(0.5) within group (order by dagar) from tider),
    'median_dagar_stoppande', (select percentile_cont(0.5) within group (order by dagar) from tider where blocking),
    'lagade_30', (select count(*) from tider)
  ) end
$$;
revoke all on function public.fel_statistik() from public;
grant execute on function public.fel_statistik() to authenticated;

-- =============================================================================
-- VÄNTAR (körs inte här)
--
-- Förekomsterna fylls först när `registrera_fel` också skriver en rad i
-- `error_occurrence`. Det är en skrivning i produktionen vid varje automatiskt
-- fel, så den ligger i `supabase/vantar/fel_forekomster.sql` och körs när
-- beställaren sagt ja för Fel.
-- =============================================================================
