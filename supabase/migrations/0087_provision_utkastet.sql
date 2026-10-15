-- 0087 · Provision: det Nav 2.0 har och navet saknade (2026-10-15)
--
-- =============================================================================
-- VARFÖR
--
-- Nav 2.0:s provisionsvy har två saker som huvudboken inte bär:
--
--   1. "Ta bort" en övrig bonus i en öppen månad. En provisionspost skrivs
--      aldrig om (`commission_entry_ar_last`); rättelsen är en negativ post.
--      Den här tabellen säger vilken post som tar ut vilken, så att listan
--      kan visa att bonusen är borttagen i stället för två rader som tar ut
--      varandra. Summorna i huvudboken är oförändrade och riktiga.
--   2. Historiken före augusti 2026, då det inte fanns någon provisionsmotor.
--      Summan per person och månad kommer ur lönesystemet och läggs in av
--      ekonomi. Utan rad står månaden som saknad ("–"), aldrig som 0 kr.
--
-- Beställaren 2026-10-15: ingen funktion i utkastet får försvinna.
-- =============================================================================
--
-- ADDITIV, OCH MAIN RÖRS INTE. Läsregeln är huvudbokens: den egna personen,
-- och den som får hantera provision (`far_hantera_provision()`).

create table public.commission_entry_reversal (
  original_id uuid primary key references public.commission_entry (id),
  reversal_id uuid not null unique references public.commission_entry (id),
  created_by uuid references public.employee (id) on delete set null,
  created_at timestamptz not null default now(),
  check (original_id <> reversal_id)
);
alter table public.commission_entry_reversal enable row level security;
create policy commission_entry_reversal_las on public.commission_entry_reversal for select
  using (exists (select 1 from public.commission_entry e where e.id = commission_entry_reversal.original_id));

create table public.commission_history (
  employee_id uuid not null references public.employee (id) on delete cascade,
  period_month date not null check (period_month = date_trunc('month', period_month)::date),
  amount numeric(12, 2) not null,
  deals integer check (deals is null or deals >= 0),
  source text not null check (length(btrim(source)) between 1 and 200),
  entered_by uuid references public.employee (id) on delete set null,
  entered_at timestamptz not null default now(),
  primary key (employee_id, period_month)
);
alter table public.commission_history enable row level security;
create policy commission_history_las on public.commission_history for select
  using (employee_id = public.current_employee_id() or public.far_hantera_provision());
