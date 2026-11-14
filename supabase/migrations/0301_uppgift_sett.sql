-- =============================================================================
-- 0301_uppgift_sett.sql — Uppgifter: nytt sedan sist
--
-- Beställaren 2026-11-14: "Ja det är väl bra … Bygg det" om steg 4 i planen för
-- kollegan i uppgiften (~/nav2-utkast/delar/uppgift-kollega/PROMPT.md).
--
-- En delad uppgift lever utan att man tittar: kollegan bockar ett steg, flyttar
-- dagen, lägger till någon. Notisen kommer bara för en del av det (kommentarer,
-- bollen, klar), och den som bara har listan ser ingenting. Raden får därför en
-- prick när någon ANNAN gjort något sedan jag senast öppnade uppgiften, och
-- rutan börjar med vad: "Carl bockade Ring kunden · 14:02".
--
-- EN TIDPUNKT PER PERSON OCH UPPGIFT, som `project_message_read` i 0055. Det
-- nya räknas fram ur `task_event` (vem, vad, när) mot den tidpunkten; ingen
-- händelse märks som läst för sig.
--
-- ADDITIV. En ny tabell. Inga befintliga rader eller villkor ändras.
-- =============================================================================

create table if not exists public.task_seen (
  task_id     uuid not null references public.task(id) on delete cascade,
  employee_id uuid not null references public.employee(id) on delete cascade,

  seen_at timestamptz not null default now(),

  primary key (task_id, employee_id)
);

comment on table public.task_seen is
  'När personen senast öppnade uppgiften. Det någon annan gjort efter det är nytt (0301).';

-- -----------------------------------------------------------------------------
-- Behörighet
--
-- Din egen markering, och ingen annans: när en kollega senast tittade är en
-- uppgift om henne, inte om uppgiften (samma skäl som 0055). Skrivning går via
-- service role i /nav2/uppgifter, som först frågar RLS om uppgiften syns.
-- -----------------------------------------------------------------------------

alter table public.task_seen enable row level security;

drop policy if exists task_seen_egen on public.task_seen;
create policy task_seen_egen on public.task_seen for select
  to authenticated
  using (employee_id = (select public.current_employee_id()));

-- -----------------------------------------------------------------------------
-- Startläget
--
-- Utan rad är allt någon annan gjort nytt, vilket är rätt för en uppgift man
-- fått och aldrig öppnat. Men på dagen tabellen föds hade det tänt en prick på
-- varje uppgift med en kollegas gamla händelser. Alla som redan är i kretsen
-- (skaparen, den som har bollen, de som är med) har därför sett sina uppgifter
-- nu. Det som händer efter körningen är nytt.
-- -----------------------------------------------------------------------------

insert into public.task_seen (task_id, employee_id, seen_at)
select t.id, k.employee_id, now()
from public.task t
cross join lateral (values (t.created_by), (t.assignee_id)) as k(employee_id)
where k.employee_id is not null
union
select m.task_id, m.employee_id, now()
from public.task_member m
on conflict (task_id, employee_id) do nothing;

-- -----------------------------------------------------------------------------
-- Kvittot. Samma avläsning som 0055.
-- -----------------------------------------------------------------------------

do $$
declare
  skrivpolicyer int;
begin
  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'task_seen' and c.relrowsecurity
  ) then
    raise exception 'task_seen saknar row level security';
  end if;

  select count(*) into skrivpolicyer
  from pg_policies
  where schemaname = 'public' and tablename = 'task_seen' and cmd <> 'SELECT';

  if skrivpolicyer > 0 then
    raise exception 'task_seen har % skrivpolicy(er) — skrivning ska gå via service role', skrivpolicyer;
  end if;
end;
$$;
