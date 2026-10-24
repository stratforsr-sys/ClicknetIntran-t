-- =============================================================================
-- 0250_saljtavlan.sql — Säljtavlan på /salesboard: skärmarna, parningen,
-- säljarnas val, testhändelserna, statistiken och ringklockan
--
-- -----------------------------------------------------------------------------
-- VARFÖR
-- -----------------------------------------------------------------------------
--
-- Beställaren 2026-10-23: en säljtavla för kontors-TV:n, där varje ny order
-- firas när den kommer in. Designen står i
-- docs/superpowers/specs/2026-10-23-salesboard-design.md (§8 och §9).
--
-- Säljtavlans spann är 0250–0254 (PARALLELLT.md).
--
-- Ändrad 2026-10-25, innan den körts: månadens mål är i ordervärde och står i
-- inställningarna (R35), så statistiken ger också de tidigare månadernas antal
-- och ordervärde till grafen. Ljudmotiven försvann med de inspelade ljuden (R38),
-- och med dem kolumnen motif.
--
-- -----------------------------------------------------------------------------
-- ALLA FYRA TABELLERNA ÄR STÄNGDA FÖR KLIENTEN
-- -----------------------------------------------------------------------------
--
-- RLS är påslaget och ingen policy finns, så bara service role når dem. Det
-- är rutterna under /salesboard som läser och skriver, efter att ha prövat
-- vem som frågar (en parad skärm eller en inloggad anställd, se atkomst.ts).
-- En skärms token sparas aldrig i klartext, bara som sha256.
--
-- -----------------------------------------------------------------------------
-- RINGKLOCKAN BÄR INGEN DATA
-- -----------------------------------------------------------------------------
--
-- Tavlan hämtar sin ögonblicksbild över HTTP. Klockan säger bara "något har
-- ändrats", på den publika broadcast-kanalen `salesboard`, så att tavlan
-- hämtar på en gång i stället för att vänta på nästa minut. Det enda som går
-- ut är ett klockslag. Den som skickar en egen signal på kanalen orsakar en
-- hämtning till, inget mer.
--
-- Triggern går per SATS, inte per rad. En chef som godkänner tolv order på en
-- gång ringer en gång per sats, och `update … where false` ringer också,
-- vilket gör klockan provbar utan att ändra någon data.
--
-- Klockan får aldrig fälla det den sitter på. realtime.send fångar sina egna
-- fel, och ett eget begin/exception runt anropet tar resten, som i
-- crm_order_till_utkorg.
--
-- På skärmtabellen ringer bara namn, ljud och bortkoppling. last_seen_at
-- skrivs varje minut av varje skärm, och ringde den skulle skärmarna väcka
-- varandra i en ring.
-- =============================================================================

create table public.salesboard_screen (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 1 and 60),
  token_hash   text unique,
  sound        boolean not null default true,
  created_by   uuid references public.employee(id) on delete set null,
  created_at   timestamptz not null default now(),
  claimed_at   timestamptz,
  last_seen_at timestamptz,
  last_ip      inet,
  user_agent   text,
  revoked_at   timestamptz,
  revoked_by   uuid references public.employee(id) on delete set null
);

comment on table public.salesboard_screen is
  'Säljtavlan: en parad skärm. token_hash är sha256 av kakan nav_tavla. Bortkopplad = revoked_at satt.';

create table public.salesboard_pairing (
  code_hash  text primary key,
  nonce_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  screen_id  uuid references public.salesboard_screen(id) on delete cascade,
  ip         inet,
  user_agent text
);

create index salesboard_pairing_expires on public.salesboard_pairing (expires_at);

comment on table public.salesboard_pairing is
  'Säljtavlan: en kod som visas på en TV i väntan på att en admin skriver in den. Gäller i tio minuter.';

create table public.salesboard_person (
  employee_id uuid primary key references public.employee(id) on delete cascade,
  display     text not null default 'namn' check (display in ('namn', 'initialer', 'dold')),
  updated_by  uuid references public.employee(id) on delete set null,
  updated_at  timestamptz not null default now()
);

comment on table public.salesboard_person is
  'Säljtavlan: hur en säljare visas (namn, initialer eller dold). Sätts av admin på säljarens begäran.';

create table public.salesboard_event (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('test')),
  payload    jsonb not null default '{}'::jsonb,
  created_by uuid references public.employee(id) on delete set null,
  created_at timestamptz not null default now()
);

create index salesboard_event_created on public.salesboard_event (created_at);

comment on table public.salesboard_event is
  'Säljtavlan: testhändelser från inställningarna. Spelas på alla skärmar med märket TEST och räknas aldrig.';

alter table public.salesboard_screen  enable row level security;
alter table public.salesboard_pairing enable row level security;
alter table public.salesboard_person  enable row level security;
alter table public.salesboard_event   enable row level security;

revoke all on table public.salesboard_screen, public.salesboard_pairing,
  public.salesboard_person, public.salesboard_event from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Statistiken. En rundtur i stället för att läsa varje godkänd order genom
-- API:t, som tyst kapar vid tusen rader.
--
--   saljare   per säljare: id för hens första godkända order någonsin, och
--             största antalet godkända på en svensk dag FÖRE p_dag
--   p90       90:e percentilen av ordervärdet, godkända de senaste 90 dagarna
--             (tröskeln för "stor affär" när den står på auto)
--   antal90   hur många order p90 räknades på (under 20 gäller 30 000 kr)
--   bastaDag  lagets största dagsantal i p_dags månad, före p_dag
--   manader   de elva månaderna före p_dags: antal och ordervärde netto, som
--             nettoAntal räknar (godkända med period_month i månaden minus
--             makulerade med cancel_period_month i den)
--
-- p_lag begränsar till ett lag, null = alla. Godkänd = signerad eller betald
-- med approved_at, samma som harGodkants() och Golvet.
-- -----------------------------------------------------------------------------
create or replace function public.salesboard_statistik(p_dag date, p_lag uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with godkanda as (
    select o.id, o.salesperson_id, o.approved_at, o.order_value,
           (o.approved_at at time zone 'Europe/Stockholm')::date as dag
    from public.sales_order o
    where o.status in ('signerad', 'betald')
      and o.approved_at is not null
      and (p_lag is null or exists (
        select 1 from public.employee e where e.id = o.salesperson_id and e.team_id = p_lag))
  ),
  per_dag as (
    select salesperson_id, dag, count(*)::int as n
    from godkanda
    group by salesperson_id, dag
  ),
  saljare as (
    select g.salesperson_id as id,
           (array_agg(g.id order by g.approved_at, g.id))[1] as forsta,
           coalesce((select max(p.n) from per_dag p
                     where p.salesperson_id = g.salesperson_id and p.dag < p_dag), 0) as basta
    from godkanda g
    group by g.salesperson_id
  ),
  lagdag as (
    select dag, count(*)::int as n
    from godkanda
    where dag >= date_trunc('month', p_dag)::date and dag < p_dag
    group by dag
  ),
  nittio as (
    select order_value
    from godkanda
    where order_value is not null
      and approved_at >= (p_dag::timestamp at time zone 'Europe/Stockholm') - interval '90 days'
  ),
  start as (
    select (date_trunc('month', p_dag) - interval '11 months')::date as fran
  ),
  lagets as (
    select o.status, o.period_month, o.cancel_period_month, coalesce(o.order_value, 0) as varde
    from public.sales_order o, start
    where (o.period_month >= start.fran or o.cancel_period_month >= start.fran)
      and (p_lag is null or exists (
        select 1 from public.employee e where e.id = o.salesperson_id and e.team_id = p_lag))
  ),
  manader as (
    select m::date as manad,
           (select count(*) from lagets l
             where l.status in ('signerad', 'betald', 'makulerad') and l.period_month = m::date)
         - (select count(*) from lagets l
             where l.status = 'makulerad' and l.cancel_period_month = m::date) as antal,
           coalesce((select sum(l.varde) from lagets l
             where l.status in ('signerad', 'betald', 'makulerad') and l.period_month = m::date), 0)
         - coalesce((select sum(l.varde) from lagets l
             where l.status = 'makulerad' and l.cancel_period_month = m::date), 0) as varde
    from generate_series(
      date_trunc('month', p_dag) - interval '11 months',
      date_trunc('month', p_dag) - interval '1 month',
      interval '1 month') as m
  )
  select jsonb_build_object(
    'saljare', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'forsta', forsta, 'basta', basta)) from saljare), '[]'::jsonb),
    'p90', (select percentile_cont(0.9) within group (order by order_value) from nittio),
    'antal90', (select count(*) from nittio),
    'bastaDag', coalesce((select max(n) from lagdag), 0),
    'manader', coalesce((select jsonb_agg(jsonb_build_object(
        'manad', to_char(manad, 'YYYY-MM-DD'), 'antal', antal, 'varde', varde) order by manad)
      from manader), '[]'::jsonb)
  );
$$;

revoke all on function public.salesboard_statistik(date, uuid) from public, anon, authenticated;
grant execute on function public.salesboard_statistik(date, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Ringklockan.
-- -----------------------------------------------------------------------------
create or replace function public.salesboard_ringklocka()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object('t', extract(epoch from clock_timestamp())),
      'ping',
      'salesboard',
      false
    );
  exception when others then
    raise warning 'salesboard_ringklocka: %', sqlerrm;
  end;
  return null;
end;
$$;

-- Triggerfunktionen körs av triggern utan att EXECUTE prövas (0240), så ingen
-- roll behöver rätten.
revoke all on function public.salesboard_ringklocka() from public, anon, authenticated;

create trigger salesboard_order_ping
  after insert or update or delete on public.sales_order
  for each statement execute function public.salesboard_ringklocka();

create trigger salesboard_event_ping
  after insert on public.salesboard_event
  for each statement execute function public.salesboard_ringklocka();

create trigger salesboard_person_ping
  after insert or update or delete on public.salesboard_person
  for each statement execute function public.salesboard_ringklocka();

create trigger salesboard_screen_ping
  after update of name, sound, revoked_at on public.salesboard_screen
  for each statement execute function public.salesboard_ringklocka();

create trigger salesboard_setting_ping
  after insert or update on public.nav_setting
  for each row when (new.key = 'salesboard')
  execute function public.salesboard_ringklocka();
