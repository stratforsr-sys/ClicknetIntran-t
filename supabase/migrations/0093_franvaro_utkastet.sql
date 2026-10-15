-- 0093 · Frånvaro: det Nav 2.0 har och navet saknade (2026-10-15)
--
-- =============================================================================
-- VARFÖR
--
-- Nav 2.0:s frånvarovy har tre saker som navet inte bär:
--
--   1. Önskemålsrundan inför sommaren: chefen startar den, och den skickas ut
--      ett visst datum med ett sista svarsdatum och ett datum för besked
--      (semesterlagen 11–12 §§). Utskicket görs av dagtidsjobbet, bakom
--      samma brytare som Frånvaro i Nav 2.0 (src/lib/nav2/skrivlage.ts).
--   2. Föreslå en annan period på en ansökan. Ansökan står kvar tills den som
--      sökt svarat; den som föreslår ser förslaget, den som sökt får en notis.
--   3. Kvittera rehabsignalen ("Signalen döljs. Den kommer tillbaka om det blir
--      fler tillfällen"). Kvittensen gäller antalet tillfällen när den gavs.
--
-- Att chefen registrerar annan frånvaro än sjuk åt någon efter ett samtal
-- kräver ingen ny kolumn: `absence_request.created_by` säger vem som lade in.
--
-- Beställaren 2026-10-15: ingen funktion i utkastet får försvinna.
-- =============================================================================

create table public.vacation_wish_round (
  id uuid primary key default gen_random_uuid(),
  summer_year integer not null check (summer_year between 2026 and 2100),
  team_id uuid references public.team (id) on delete cascade,
  send_on date not null,
  answer_by date not null,
  decide_by date not null,
  created_by uuid references public.employee (id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  check (send_on <= answer_by and answer_by <= decide_by)
);
create unique index vacation_wish_round_en_per_team on public.vacation_wish_round (summer_year, coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid));
alter table public.vacation_wish_round enable row level security;
create policy vacation_wish_round_las on public.vacation_wish_round for select using (public.current_employee_id() is not null);

create table public.absence_proposal (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.absence_request (id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  note text check (note is null or length(note) <= 600),
  proposed_by uuid references public.employee (id) on delete set null,
  proposed_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index absence_proposal_ansokan on public.absence_proposal (request_id, proposed_at desc);
alter table public.absence_proposal enable row level security;
create policy absence_proposal_las on public.absence_proposal for select
  using (exists (select 1 from public.absence_request r where r.id = absence_proposal.request_id));

create table public.sick_signal_ack (
  employee_id uuid primary key references public.employee (id) on delete cascade,
  occasions integer not null check (occasions >= 0),
  acked_by uuid references public.employee (id) on delete set null,
  acked_at timestamptz not null default now()
);
alter table public.sick_signal_ack enable row level security;
create policy sick_signal_ack_las on public.sick_signal_ack for select
  using (public.has_any_role(array['sales_manager', 'ceo']));
