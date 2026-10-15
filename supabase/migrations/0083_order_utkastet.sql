-- 0083 · Order: det Nav 2.0 har och navet saknade (2026-10-15)
--
-- =============================================================================
-- VARFÖR
--
-- Nav 2.0:s ordervy och kundkort har fyra saker som navet inte bär:
--
--   1. "Fäst" en anteckning om kunden, så att den står överst i Översikt.
--      Anteckningen skrivs i Inkio (`add-comment`); Inkio har ingen fästning,
--      så navet håller reda på vilken som är fäst, per kund.
--   2. "Ny sedan du tittade": en prick på order som kommit in sedan personen
--      senast öppnade listan.
--   3. Kampanjsidans svarstid, när den senast kollades och de sju senaste
--      dagarna. Navet frågar i dag bara när kortet öppnas; här sparas varje
--      kontroll.
--   4. Utskrift av ett inspelat samtal, rad för rad med tidpunkt, så att man
--      kan spela därifrån. Repot transkriberar inte; tabellen och kön finns
--      här, och tjänsten väljs av beställaren (2026-10-15: "bygg utan tjänst
--      nu").
--
-- Beställaren 2026-10-15: ingen funktion i utkastet får försvinna. Det som
-- saknar backend ska få backend, och skrivningarna slås på vy för vy.
-- =============================================================================
--
-- =============================================================================
-- ADDITIV, OCH MAIN RÖRS INTE
--
-- Fem nya tabeller, inga ändringar i befintliga. Läsregeln följer det raden
-- hänger på: en kunds fästa anteckning och kampanjsida syns för den som ser en
-- order på kunden (`sales_order_read`), en utskrift för den som ser samtalet
-- (`phone_call_read`), och "senast tittat" bara för personen själv.
--
-- Inloggade har bara läsrätt. Servern skriver med service role efter egna
-- kontroller (src/app/nav2/order/route.ts och /api/jobb/kampanjsidor).
-- =============================================================================

-- 1. Den fästa anteckningen. En per kund; att fästa en ny ersätter den gamla.
-- Texten sparas som den stod när den fästes, så att Översikt kan visa den även
-- när Inkio inte svarar.
create table public.customer_note_pin (
  org_number text primary key check (org_number ~ '^\d{6}-\d{4}$'),
  inkio_comment_id text not null check (length(btrim(inkio_comment_id)) between 1 and 100),
  body text not null check (length(btrim(body)) between 1 and 2000),
  author_name text check (author_name is null or length(author_name) <= 200),
  pinned_by uuid references public.employee (id) on delete set null,
  pinned_at timestamptz not null default now()
);
alter table public.customer_note_pin enable row level security;
create policy customer_note_pin_las on public.customer_note_pin for select
  using (exists (select 1 from public.sales_order o where o.org_number = customer_note_pin.org_number));

-- 2. När personen senast öppnade orderlistan.
create table public.order_list_seen (
  employee_id uuid primary key references public.employee (id) on delete cascade,
  seen_at timestamptz not null default now()
);
alter table public.order_list_seen enable row level security;
create policy order_list_seen_las on public.order_list_seen for select
  using (employee_id = public.current_employee_id());

-- 3. Kampanjsidorna och varje kontroll av dem. Adressen hämtas ur kundens
-- Webbplats i Inkio och uppdateras när den ändras; kontrollerna gallras efter
-- 14 dagar av jobbet själv.
create table public.landing_page (
  org_number text primary key check (org_number ~ '^\d{6}-\d{4}$'),
  url text check (url is null or url ~ '^https?://'),
  refreshed_at timestamptz not null default now()
);
alter table public.landing_page enable row level security;
create policy landing_page_las on public.landing_page for select
  using (exists (select 1 from public.sales_order o where o.org_number = landing_page.org_number));

create table public.landing_page_check (
  id bigint generated always as identity primary key,
  org_number text not null references public.landing_page (org_number) on delete cascade,
  checked_at timestamptz not null default now(),
  ok boolean not null,
  ms integer check (ms is null or ms >= 0),
  status_code integer,
  error text check (error is null or length(error) <= 300)
);
create index landing_page_check_kund on public.landing_page_check (org_number, checked_at desc);
alter table public.landing_page_check enable row level security;
create policy landing_page_check_las on public.landing_page_check for select
  using (exists (select 1 from public.sales_order o where o.org_number = landing_page_check.org_number));

-- 4. Utskriften av ett samtal. Segmenten är [{s, e, vem, text}]: start och slut
-- i millisekunder, vem som talar ('saljare', 'kund' eller null) och texten.
create table public.call_transcript (
  call_id uuid primary key references public.phone_call (id) on delete cascade,
  status text not null default 'ko' check (status in ('ko', 'klar', 'fel')),
  provider text check (provider is null or length(provider) <= 60),
  language text check (language is null or length(language) <= 10),
  segments jsonb not null default '[]'::jsonb check (jsonb_typeof(segments) = 'array'),
  error text check (error is null or length(error) <= 500),
  created_at timestamptz not null default now(),
  done_at timestamptz,
  constraint call_transcript_klar_har_tid check ((status = 'klar') = (done_at is not null))
);
alter table public.call_transcript enable row level security;
create policy call_transcript_las on public.call_transcript for select
  using (exists (select 1 from public.phone_call c where c.id = call_transcript.call_id));

-- =============================================================================
-- VÄNTAR (körs inte här)
--
-- Det som skriver av sig självt ligger i `supabase/vantar/order_jobb.sql` och
-- körs när beställaren sagt ja för Order: kontrollen av kampanjsidorna var
-- tionde minut (pg_cron), och att en utskrift försvinner när inspelningen
-- gallras.
-- =============================================================================
