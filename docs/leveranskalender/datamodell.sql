-- =============================================================================
-- LEVERANSKALENDERN · DATAMODELL (SKISS)
-- Hämtad ur prototyp.html, avsnittet Datamodell. Det här är en skiss och inte en
-- migration: kontrollera varje referens mot schemat, dela upp i två migrationer
-- (pass 1: alla kalendertabeller från calendar_series till calendar_undo, så att
-- pass 2 inte behöver ändra en körd migration; pass 3: delivery och
-- delivery_handoff), numrera efter schema_migrations och skriv satserna
-- omkörbara (drop policy/trigger if exists före create).
--
-- Förinställning → step: valkomst → valkomstsamtal, tillgangar → tillgangar,
-- kickoff → kickoff, leverans → leveransstart, avst30 → avstamning_30,
-- avst90 → avstamning_90.
--
-- Förekomster i en serie materialiseras 56 dagar framåt (HORISONT_DAGAR i
-- upprepning.ts) som rader i calendar_event med series_id och occurrence_of.
-- En ändrad förekomst får avviker = true och skrivs inte över när serien räknas om.
-- Svar för en enskild förekomst är en rad i calendar_attendee med event_id och
-- occurrence_of; svar för hela serien har series_id.
--
-- Överlämningens sex fält: kontaktperson och telefon läses från ordern och kunden,
-- mål, löfte, bästa tid och risker står i delivery_handoff.
-- =============================================================================

-- NNNN_moten.sql — bokad tid med deltagare. Ersätter beslutet i 0057 för möten.
create table if not exists calendar_series (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('mote','enskilt')),   -- mallen som förekomsterna skapas från
  title      text not null check (length(btrim(title)) between 1 and 200),
  organizer_id uuid not null references employee(id),
  tid        time not null,
  minuter    integer not null check (minuter between 5 and 480),
  monster    text not null check (monster in ('vardagar','veckovis')),
  intervall  smallint not null default 1 check (intervall in (1,2)),  -- varannan vecka för 1:1
  veckodag   smallint check (veckodag between 1 and 7),
  starts_on  date not null,
  ends_on    date,
  created_by uuid not null references employee(id)
);

create table if not exists calendar_event (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('mote','enskilt','leverans')),  -- enskilt = 1:1
  title        text not null check (length(btrim(title)) between 1 and 200),
  organizer_id uuid not null references employee(id),
  dag          date not null,
  tid          time,                                 -- null = heldag
  minuter      integer check (minuter between 5 and 1440),
  show_as      text not null default 'upptagen' check (show_as in ('ledig','preliminar','upptagen','borta')),
  reminder_min smallint not null default 10,
  plats        text,
  online_url   text,
  agenda_md    text not null default '',
  series_id    uuid references calendar_series(id) on delete cascade,
  occurrence_of date,                                -- vilken förekomst i serien raden är
  avviker      boolean not null default false,         -- förekomst ändrad för sig, skrivs inte över när serien räknas om
  starts_at    timestamptz not null,                 -- sätts av triggern nedan, räkna aldrig själv
  cancelled_at timestamptz,
  -- leveranspost
  order_id     uuid references sales_order(id),
  step         text check (step in ('valkomstsamtal','tillgangar','kickoff','leveransstart','avstamning_30','avstamning_90')),  -- en per förinställning
  outcome      text check (outcome in ('genomford','ej_svar')),  -- sätts bara av en människa
  outcome_by   uuid references employee(id),
  attempt      smallint not null default 1,
  -- 1:1
  coaching_session_id uuid references coaching_session(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint leverans_har_kund check (kind <> 'leverans' or order_id is not null)
);

-- En tid att räkna på. Sommartid hanteras här och ingen annanstans.
create or replace function calendar_event_starts_at() returns trigger language plpgsql as $$
begin
  new.starts_at := (new.dag + coalesce(new.tid, time '00:00')) at time zone 'Europe/Stockholm';
  return new;
end $$;
drop trigger if exists calendar_event_starts_at on calendar_event;
create trigger calendar_event_starts_at before insert or update of dag, tid on calendar_event
  for each row execute function calendar_event_starts_at();

create table if not exists calendar_attendee (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid references calendar_event(id) on delete cascade,
  series_id      uuid references calendar_series(id) on delete cascade,
  employee_id    uuid references employee(id) on delete cascade,
  external_email text,                               -- kunden på kickoff
  response       text not null default 'vantar' check (response in ('vantar','ja','kanske','nej')),
  response_note  text,
  occurrence_of  date,                               -- svar eller förslag för bara en förekomst
  proposed_dag   date,
  proposed_tid   time,
  proposed_minuter integer,
  proposal_note  text check (length(proposal_note) <= 300),
  responded_at   timestamptz,
  constraint en_foralder check ((event_id is null) <> (series_id is null)),
  constraint en_person   check ((employee_id is null) <> (external_email is null))
);

create table if not exists one_on_one_item (    -- agenda och åtgärder, lever över förekomsterna
  id        uuid primary key default gen_random_uuid(),
  series_id uuid not null references calendar_series(id) on delete cascade,
  kind      text not null check (kind in ('agenda','atgard')),
  text      text not null check (length(btrim(text)) between 1 and 300),
  author_id uuid not null references employee(id),
  owner_id  uuid references employee(id),            -- vem som ska göra åtgärden
  for_dag   date,                                    -- vilken förekomst punkten togs upp
  done_at   timestamptz,
  task_id   uuid references task(id)                 -- åtgärd som blivit uppgift
);

create table if not exists calendar_reminder (          -- alla påminnelser: pling, mejl via Resend, 1:1-förberedelse
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references calendar_event(id) on delete cascade,
  channel      text not null check (channel in ('pling','mejl','forberedelse')),  -- en tabell, ett jobb, alla påminnelser
  recipient    text not null check (recipient in ('ansvarig','kund','deltagare')),
  send_at      timestamptz not null,                 -- start minus 30 min
  resend_id    text,                                 -- null tills mejlet schemalagts
  status       text not null default 'vantar' check (status in ('vantar','schemalagd','skickad','avbokad','fel')),
  error        text,
  unique (event_id, channel, recipient)
);

create table if not exists integration_log (              -- rådata från Resend och CRM, som call_ingest i 0052
  id          bigserial primary key,
  system      text not null check (system in ('resend','crm')),
  direction   text not null check (direction in ('ut','in')),
  body        jsonb not null,                      -- skrivs hel, ändras aldrig
  received_at timestamptz not null default now()
);

create table if not exists outbox (                     -- skrivs i samma transaktion som ändringen
  id           bigserial primary key,
  kind         text not null check (kind in ('notis','ics','resend_schedule','resend_patch','resend_cancel','crm')),  -- notis töms genom notifiera()
  payload      jsonb not null,
  idempotency_key text not null unique,              -- samma händelse skickas aldrig två gånger
  not_before   timestamptz not null default now() + interval '10 seconds',  -- fönstret för Ångra
  attempts     smallint not null default 0,
  sent_at      timestamptz,
  error        text
);

create table if not exists calendar_undo (              -- det Ångra behöver: läget före ändringen
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid references calendar_event(id) on delete cascade,
  series_id   uuid references calendar_series(id) on delete cascade,
  handling    text not null,                         -- flytta, svara, andraLangd, stallIn …
  before      jsonb not null,                        -- dag, tid, minuter, svar, cancelled_at
  outbox_ids  bigint[] not null default '{}',        -- raderas vid Ångra om de inte skickats
  created_by  uuid not null references employee(id),
  created_at  timestamptz not null default now()
);

-- NNNN_leverans.sql — tunn, eftersom produktionen bor i CRM:et
create table if not exists delivery (
  order_id        uuid primary key references sales_order(id) on delete cascade,
  owner_id        uuid references employee(id),      -- null = i kön
  welcome_due_at  timestamptz not null,
  crm_system      text,
  crm_external_id text,
  crm_synced_at   timestamptz,
  crm_attempts    smallint not null default 0,
  crm_error       text
);

create table if not exists delivery_handoff (
  order_id      uuid primary key references sales_order(id) on delete cascade,
  customer_goal text not null,
  promised      text not null default '',
  best_time     text,
  risks         text not null default '',
  written_by    uuid not null references employee(id),
  written_at    timestamptz not null default now()
);

-- RLS: kalender_poster() får en tredje källa. Deltagare ser allt. Andra ser det
-- calendar_share ger: upptagen (grundläge), rubriker eller detaljer. Innehållet i en 1:1
-- ses bara av de två, samma krets som coaching_session i 0043.