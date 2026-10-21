-- =============================================================================
-- 0190_satser_utkastet.sql — Nav 2.0: det utkastets Satser och löner har och
-- 0025 saknar
--
-- -----------------------------------------------------------------------------
-- VAD SOM BEHÖVS
-- -----------------------------------------------------------------------------
--
-- Satserna ändras i Nav 2.0 (Inställningar → Satser och löner) när gamla Nav
-- är borta (Gamla Nav G, svar 13–14 och inventeringens avsnitt 7). Utkastet
-- gör två saker som 0025 inte tillåter:
--
--   employer_fee_young  Skatteverkets tillfälliga nedsättning för unga
--                       (20,81 % 1 apr 2026–30 sep 2027). 0025 har bara en
--                       nedsatt sats, ålderspensionsavgiften, för unga och
--                       äldre. Saknas raden gäller den som förut.
--   no_fee_age_min      ingen arbetsgivaravgift från en ålder (födda 1937
--                       eller tidigare under 2026).
--
--   cost_rate_replaced  "Ersatta": en sats som rättas på samma dag skrivs
--                       över i cost_rate (unik på kind, applies_to,
--                       valid_from), och en sats som Skatteverkets rättelse
--                       tar bort försvinner. Den gamla raden sparas här, med
--                       när, av vem och varför, så att en gammal beräkning går
--                       att förklara (AC-13.8).
--
-- Ingenting i 0025 ändras utom listan över tillåtna kind.
--
-- -----------------------------------------------------------------------------
-- VEM SER VAD
-- -----------------------------------------------------------------------------
--
-- Som cost_rate: den med payroll_cost_viewer (`har_lonekostnadsbehorighet`).
-- Skrivning går via service role i /nav2/satser, som resten av navet. Ingen
-- skrivpolicy — självkontrollen sist faller om någon lägger till en.
-- =============================================================================

alter table cost_rate drop constraint if exists cost_rate_kind_check;
alter table cost_rate add constraint cost_rate_kind_check check (kind in (
  'employer_fee_standard', 'employer_fee_reduced', 'employer_fee_reduced_cap',
  'young_age_min', 'young_age_max', 'senior_age_min',
  'contribution_margin', 'absence_cost_factor',
  'employer_fee_young', 'no_fee_age_min'
));

create table if not exists cost_rate_replaced (
  id           uuid primary key default gen_random_uuid(),
  rate_id      uuid not null,
  kind         text not null,
  applies_to   text,
  unit         text not null,
  value        numeric not null,
  valid_from   date not null,
  valid_to     date,
  owner_id     uuid references employee(id),
  review_due   date,
  note         text,
  created_by   uuid references employee(id),
  created_at   timestamptz not null,
  replaced_at  timestamptz not null default now(),
  replaced_by  uuid references employee(id),
  reason       text check (reason is null or length(reason) <= 300)
);

create index if not exists cost_rate_replaced_nyckel on cost_rate_replaced (kind, applies_to, valid_from);

alter table cost_rate_replaced enable row level security;

drop policy if exists cost_rate_replaced_read on cost_rate_replaced;
create policy cost_rate_replaced_read on cost_rate_replaced for select
  to authenticated using (public.har_lonekostnadsbehorighet());

revoke all on cost_rate_replaced from anon;
grant select on cost_rate_replaced to authenticated;

-- -----------------------------------------------------------------------------
-- Självkontroll
-- -----------------------------------------------------------------------------

do $$
declare
  skrivpolicyer int;
begin
  select count(*) into skrivpolicyer
  from pg_policies
  where schemaname = 'public' and tablename = 'cost_rate_replaced' and cmd <> 'SELECT';

  if skrivpolicyer > 0 then
    raise exception 'cost_rate_replaced har % skrivpolicy(er) — skrivning ska ga via service role', skrivpolicyer;
  end if;
end;
$$;
