-- =============================================================================
-- 0009_stampling.sql — M2 Tid och närvaro, stämplingens kärna (PRD §7 M2, E4)
--
-- K12 ÄR EN SPÄRR. Modulen får inte aktiveras i produktion innan
-- intresseavvägningen för raststämpling är skriven och daterad. Tabellerna
-- skapas ändå: det är billigt i förväg och mycket dyrt i efterhand. Själva
-- påslaget sker i `src/lib/tid.ts`, inte här.
--
-- AC-2.3 är det bärande kravet: ingen `time_event` får raderas eller ändras.
-- Det löses INTE med enbart återkallade rättigheter, eftersom service role går
-- förbi dem — och navets alla skrivningar sker just med service role. Därför
-- ligger spärren i en trigger, som gäller varje roll utan undantag.
--
-- AC-2.9: ingen kolumn för position finns, och ingen får läggas till. Det som
-- inte kan lagras kan heller inte läcka.
-- =============================================================================

create table if not exists time_event (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employee(id),

  kind          text not null check (kind in ('in','out','break_start','break_end')),

  -- Nar det HANDE, respektive nar navet fick veta. AC-2.2: en stampling som
  -- gjorts offline behaller sin ursprungliga tid, och skillnaden mellan de tva
  -- ar det enda som avslojar att den kom in i efterhand.
  occurred_at   timestamptz not null,
  recorded_at   timestamptz not null default now(),

  source        text not null default 'app'
                  check (source in ('app','kiosk','offline_queue','system_auto_close','correction')),

  -- AC-2.3: en rattelse ersatter en tidigare rad, den skriver inte over den.
  supersedes_id uuid references time_event(id),

  -- Rattelser gar via chef (AC-2.5). Null = ingen rattelse begard.
  correction_state text check (correction_state in ('pending','approved','rejected')),
  requested_by  uuid references employee(id),
  decided_by    uuid references employee(id),
  decided_at    timestamptz,
  note          text,

  created_at    timestamptz not null default now()
);

create index if not exists time_event_person_idx on time_event (employee_id, occurred_at desc);
create index if not exists time_event_open_idx   on time_event (employee_id, kind, occurred_at desc);
create index if not exists time_event_pending_idx on time_event (correction_state)
  where correction_state = 'pending';

-- -----------------------------------------------------------------------------
-- AC-2.3, i databasen och inte i en kodregel.
--
-- Undantaget ar smalt med flit: en rattelse maste kunna faststallas, sa
-- besluts-kolumnerna far sattas en gang pa en rad som star i 'pending'. Allt
-- annat — tid, typ, person, kalla — ar orort for evigt.
-- -----------------------------------------------------------------------------
create or replace function public.time_event_ar_orubblig()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'En stämpling kan inte raderas. Skapa en rättelse i stället (AC-2.3).';
  end if;

  if old.correction_state is distinct from 'pending' then
    raise exception 'En stämpling kan inte ändras. Skapa en rättelse i stället (AC-2.3).';
  end if;

  if new.employee_id   is distinct from old.employee_id
     or new.kind        is distinct from old.kind
     or new.occurred_at is distinct from old.occurred_at
     or new.recorded_at is distinct from old.recorded_at
     or new.source      is distinct from old.source
     or new.supersedes_id is distinct from old.supersedes_id
     or new.requested_by  is distinct from old.requested_by
     or new.created_at    is distinct from old.created_at then
    raise exception 'Endast beslutet om en rättelse får sättas i efterhand (AC-2.3).';
  end if;

  if new.correction_state not in ('approved','rejected') then
    raise exception 'En väntande rättelse kan bara godkännas eller avslås (AC-2.5).';
  end if;

  return new;
end;
$$;

drop trigger if exists time_event_orubblig on time_event;
create trigger time_event_orubblig
  before update or delete on time_event
  for each row execute function public.time_event_ar_orubblig();

-- -----------------------------------------------------------------------------
-- Behorighet. AC-2.10 och K16: chefen ska se narvaro och avvikelser, inte en
-- fullstandig logg over nar var och en gar pa toaletten. Rastlangd raknas
-- darfor aldrig fram i en vy for chefen (AC-2.8) — men raderna maste synas for
-- att rattelser ska kunna beslutas, sa gransen dras i vyerna, inte i RLS.
-- -----------------------------------------------------------------------------
alter table time_event enable row level security;

drop policy if exists time_event_read on time_event;
create policy time_event_read on time_event for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.can_read_all_employees()
    or public.leads_employee(employee_id)
  );
