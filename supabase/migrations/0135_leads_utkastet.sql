-- =============================================================================
-- 0135_leads_utkastet.sql — Nav 2.0: det utkastets Leads har och 0076 saknar
--
-- -----------------------------------------------------------------------------
-- VAD SOM BEHÖVS
-- -----------------------------------------------------------------------------
--
-- Utkastet (beställarens mål, 2026-10-14) gör mer med ett lead än att sätta
-- status: säljaren säger efter varje samtal hur det gick, och Nav räknar fram
-- nästa försök, bokar mötet och följer leadet till ordern. Chefen ser
-- svarstiden och kan påminna. Allt det är nytt här. Ingenting i 0076 ändras.
--
--   lead.next_call_at    nästa försök ("Ring igen tis 10:00")
--   lead.meeting_at      mötet, och var det hålls
--   lead.meeting_place
--   lead.lost_reason     skälet när leadet blev Ej aktuell (eller "Inte nu")
--   lead.order_id        ordern leadet blev, lagd i Order
--   lead_event           varje steg: tilldelad, försök med utfall, spam,
--                        öppnad igen, kund, påmind. Historiken, svarstiden och
--                        Ångra läses här.
--
-- -----------------------------------------------------------------------------
-- VEM SER VAD
-- -----------------------------------------------------------------------------
--
-- Samma som leadet: fördelarna (säljchef, VD, teamledare) ser allt, säljaren
-- stegen på de leads hen har. Skrivning går via service role i
-- /nav2/leads, som resten av navet. Ingen skrivpolicy — självkontrollen sist
-- faller om någon lägger till en.
--
-- -----------------------------------------------------------------------------
-- K27: INGA PERSONNUMMER
-- -----------------------------------------------------------------------------
--
-- Anteckningen efter ett samtal är fritext. Rutten maskerar som `uppdateraLead`
-- gör, och villkoret nedan är andra ledet.
--
-- -----------------------------------------------------------------------------
-- ÅNGRA
-- -----------------------------------------------------------------------------
--
-- `fore` håller leadets läge före steget (status, säljare, nästa försök, mötet,
-- skälet, ordern). Ångra inom tio minuter lägger tillbaka det och tar bort
-- steget. Ingen kunduppgift ligger där — bara det steget ändrade.
-- =============================================================================

alter table lead add column if not exists next_call_at  timestamptz;
alter table lead add column if not exists meeting_at    timestamptz;
alter table lead add column if not exists meeting_place text;
alter table lead add column if not exists lost_reason   text;
alter table lead add column if not exists order_id      uuid references sales_order(id) on delete set null;

alter table lead drop constraint if exists lead_motesplats;
alter table lead add constraint lead_motesplats
  check (meeting_place is null or meeting_place in ('Hos kunden', 'Video', 'Telefon', 'På kontoret'));

-- Utkastets fem skäl (LDSKAL). `coalesce`: ett CHECK släpper igenom NULL.
alter table lead drop constraint if exists lead_skal;
alter table lead add constraint lead_skal
  check (lost_reason is null or coalesce(lost_reason, '') in ('Har redan en byrå', 'För dyrt', 'Inte nu', 'Fel kontaktperson', 'Annat'));

alter table lead drop constraint if exists lead_mote_med_plats;
alter table lead add constraint lead_mote_med_plats
  check ((meeting_at is null) = (meeting_place is null));

create index if not exists lead_order_idx on lead (order_id) where order_id is not null;

create table if not exists lead_event (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references lead(id) on delete cascade,
  at         timestamptz not null default now(),
  -- Null = Nav själv (automatisk fördelning).
  actor_id   uuid references employee(id) on delete set null,
  kind       text not null,
  -- Bara för försök: utkastets utfall (LDUTFALL).
  outcome    text,
  note       text,
  -- Tilldelad och påmind: vem det gällde.
  till       uuid references employee(id) on delete set null,
  fore       jsonb not null default '{}'::jsonb
);

alter table lead_event drop constraint if exists lead_event_kind_check;
alter table lead_event add constraint lead_event_kind_check
  check (coalesce(kind, '') in ('tilldelad', 'forsok', 'spam', 'oppnad', 'kund', 'paminn'));

alter table lead_event drop constraint if exists lead_event_outcome_check;
alter table lead_event add constraint lead_event_outcome_check
  check ((kind = 'forsok') = (outcome is not null) and (outcome is null or outcome in ('svar', 'pratade', 'mote', 'kund', 'nej')));

alter table lead_event drop constraint if exists lead_event_langd;
alter table lead_event add constraint lead_event_langd
  check (coalesce(length(note), 0) <= 1000 and pg_column_size(fore) <= 4000);

alter table lead_event drop constraint if exists lead_event_inget_personnummer;
alter table lead_event add constraint lead_event_inget_personnummer
  check (not public.ser_ut_som_personnummer(coalesce(note, '')));

create index if not exists lead_event_lead_idx on lead_event (lead_id, at);
create index if not exists lead_event_kind_idx on lead_event (kind, at desc);

comment on table lead_event is
  '0135: Nav 2.0 Leads. Varje steg på ett lead (tilldelad, försök, spam, öppnad, kund, påmind). Skrivs bara av service role.';
comment on column lead_event.fore is
  '0135: leadets läge före steget, för Ångra inom tio minuter.';

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

alter table lead_event enable row level security;
revoke all on table lead_event from anon;

drop policy if exists lead_event_read on lead_event;
create policy lead_event_read on lead_event for select
  to authenticated
  using (
    public.has_any_role(array['sales_manager', 'ceo', 'team_lead'])
    or exists (select 1 from lead l where l.id = lead_event.lead_id and l.assigned_to = public.current_employee_id())
  );

-- -----------------------------------------------------------------------------
-- Självkontroll
-- -----------------------------------------------------------------------------

do $$
declare
  skrivpolicyer int;
begin
  select count(*) into skrivpolicyer
  from pg_policies
  where schemaname = 'public' and tablename in ('lead', 'lead_event') and cmd <> 'SELECT';

  if skrivpolicyer > 0 then
    raise exception 'lead/lead_event har % skrivpolicy(er) — skrivning ska ga via service role', skrivpolicyer;
  end if;
end;
$$;
