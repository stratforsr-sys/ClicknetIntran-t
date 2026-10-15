-- 0096 · Rutiner: läsningen över tid och sökningar utan träff (2026-10-15)
--
-- `document_view` (0003) har en rad per person och dokument med första och
-- senaste visningen. Nav 2.0 visar mer än så: "Mest lästa" i teamet och i
-- bolaget med en trend, hur många gånger en rutin lästs i månaden, och vilka
-- som inte lästs på 90 dagar. Det kräver en rad per visning.
--
-- "Frågor utan rutin": det folk sökt efter utan att hitta något. Raden har
-- inget namn, med flit — utkastet lovar "Frågan sparas utan ditt namn".
-- Bara säljchef, administratör och VD läser dem.

create table public.document_view_log (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.document (id) on delete cascade,
  employee_id uuid not null references public.employee (id) on delete cascade,
  viewed_at timestamptz not null default now()
);
create index document_view_log_dok on public.document_view_log (document_id, viewed_at desc);
alter table public.document_view_log enable row level security;
create policy document_view_log_read on public.document_view_log for select to authenticated
  using (employee_id = public.current_employee_id() or public.has_any_role(array['sales_manager', 'admin', 'ceo']));

create table public.document_search_miss (
  id bigint generated always as identity primary key,
  query text not null check (char_length(query) between 2 and 200),
  searched_at timestamptz not null default now()
);
create index document_search_miss_tid on public.document_search_miss (searched_at desc);
alter table public.document_search_miss enable row level security;
create policy document_search_miss_read on public.document_search_miss for select to authenticated
  using (public.has_any_role(array['sales_manager', 'admin', 'ceo']));
