-- 0086 · "Meddela leveransen" när en kampanjsida inte svarar (Nav 2.0, 2026-10-15)
--
-- Kundkortet har knappen Meddela leveransen när kundens kampanjsida är nere,
-- och den som tryckte får besked när sidan är uppe igen. Navet hade ingen väg
-- dit: ärenden är personalärenden till säljchefen, inte till leveransen.
--
-- En öppen anmälan per kund. Leveransen får en notis när den görs, och
-- kontrollen av kampanjsidorna (0083, /api/jobb/kampanjsidor) stänger den och
-- säger till den som anmälde när sidan svarar igen.
--
-- Läsregeln följer kunden, som för kampanjsidan i 0083.

create table public.landing_page_report (
  id bigint generated always as identity primary key,
  org_number text not null check (org_number ~ '^\d{6}-\d{4}$'),
  reported_by uuid references public.employee (id) on delete set null,
  reported_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index landing_page_report_en_oppen on public.landing_page_report (org_number) where resolved_at is null;
alter table public.landing_page_report enable row level security;
create policy landing_page_report_las on public.landing_page_report for select
  using (exists (select 1 from public.sales_order o where o.org_number = landing_page_report.org_number));
