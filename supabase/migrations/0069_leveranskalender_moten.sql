-- =============================================================================
-- 0069_leveranskalender_moten.sql — Leveranskalendern, pass 1 av 4: möten.
--
-- Numret är fråga till `schema_migrations` 2026-09-30: högst var 0068.
--
-- =============================================================================
-- NAV BOKAR MÖTEN, OCH DET ÄR ETT NYTT BESLUT — INTE EN GLÖMSKA AV 0057
--
-- 0057 skrev: "kalendern bokar inga möten". Beställaren ersatte det beslutet
-- 2026-09-30 (DECISIONS.md, D-K1): Nav bokar möten med deltagare, svar och
-- förslag. Uppgifter ligger kvar i uppgiftsmodulen och coachningen i sin.
-- 0057 ändras inte — den är körd, och texten där är historien om varför.
--
-- =============================================================================
-- ALLA KALENDERTABELLER SKAPAS HÄR, ÄVEN DE PASS 2 ANVÄNDER
--
-- En körd migration ändras aldrig (checksumman). Serier, 1:1-punkter och
-- påminnelser skapas därför nu, så att pass 2 bara lägger till funktioner.
-- `delivery` och `delivery_handoff` hör till pass 3 och står inte här.
--
-- =============================================================================
-- MAIN FÅR ALDRIG SE DE HÄR TABELLERNA
--
-- Previewen och produktionen delar databas. Ingenting på main läser tabellerna,
-- och `kalender_poster()` rörs inte: den mappar allt som inte är frånvaro till
-- en uppgift med länk till /uppgifter/, och en mötesrad där hade blivit en
-- trasig uppgift i produktionen före merge. Möten läses i stället genom den
-- nya `kalender_handelser()` nedan, och bara av den nya koden.
--
-- =============================================================================
-- VARJE ÄNDRING ÄR EN TRANSAKTION, OCH DÄRFÖR EN FUNKTION
--
-- Navet skriver genom supabase-js, och en följd av anrop genom PostgREST är
-- inte en transaktion. Men en flytt är fyra saker som måste hända tillsammans
-- eller inte alls: ny tid, nollställda svar, utkorgens rader och läget före
-- (för Ångra). Blev bara hälften skriven fick någon en notis om en flytt som
-- inte skett, eller så skedde flytten utan att någon fick veta.
--
-- Skrivningarna ligger därför i `lk_*`-funktionerna nedan. De får anropas BARA
-- av service role. Server action kontrollerar behörigheten först; funktionen
-- kontrollerar den igen, eftersom den är den enda som vet läget inuti
-- transaktionen.
--
-- Fel kastas som `lk:<kod>`, och `lib/leveranskalender-server.ts` översätter
-- koden till prototypens text. Ingen text står här.
--
-- =============================================================================
-- UTKORGEN BÄR HÄNDELSER, INTE TEXTER
--
-- En notisrad i utkorgen säger VAD som hände (`mall`, händelsen, mottagaren,
-- tiden). Rubriken skrivs när raden töms, i TypeScript, där prototypens texter
-- står och provas. Tio sekunder senare är rubriken densamma, och texterna finns
-- på ett ställe.
--
-- `idempotency_key` är unik. Samma handling ger aldrig två notiser, och den
-- som tömmer utkorgen (action:ens `after()` eller jobbet) tar raderna med
-- `for update skip locked`, så två tömningar kan inte ta samma rad.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Serier
-- -----------------------------------------------------------------------------

create table if not exists calendar_series (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('mote','enskilt')),
  title        text not null check (length(btrim(title)) between 1 and 200),
  organizer_id uuid not null references employee(id),
  tid          time not null,
  minuter      integer not null check (minuter between 5 and 480),
  monster      text not null check (monster in ('vardagar','veckovis')),
  -- Varannan vecka för 1:1. Upprepningen i `upprepning.ts` utökas med
  -- intervall i pass 2, utan att uppgiftsserierna påverkas.
  intervall    smallint not null default 1 check (intervall in (1,2)),
  veckodag     smallint check (veckodag between 1 and 7),
  starts_on    date not null,
  ends_on      date,
  reminder_min smallint not null default 10 check (reminder_min between 0 and 1440),
  agenda_md    text not null default '',
  created_by   uuid not null references employee(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint calendar_series_veckovis_har_dag check (monster <> 'veckovis' or veckodag is not null),
  constraint calendar_series_slut_efter_start check (ends_on is null or ends_on >= starts_on)
);
create index if not exists calendar_series_organizer_idx on calendar_series (organizer_id);

-- -----------------------------------------------------------------------------
-- 2. Händelser
--
-- En förekomst i en serie är en RAD, materialiserad 56 dagar framåt i pass 2.
-- `avviker` säger att raden ändrats för sig och inte ska skrivas över när
-- serien räknas om.
-- -----------------------------------------------------------------------------

create table if not exists calendar_event (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('mote','enskilt','leverans')),
  title         text not null check (length(btrim(title)) between 1 and 200),
  organizer_id  uuid not null references employee(id),
  dag           date not null,
  tid           time,                          -- null = heldag
  minuter       integer check (minuter between 5 and 1440),
  show_as       text not null default 'upptagen' check (show_as in ('ledig','preliminar','upptagen','borta')),
  reminder_min  smallint not null default 10 check (reminder_min between 0 and 1440),
  plats         text check (plats is null or length(plats) <= 200),
  online_url    text check (online_url is null or (online_url ~ '^https://' and length(online_url) <= 500)),
  agenda_md     text not null default '' check (length(agenda_md) <= 4000),
  series_id     uuid references calendar_series(id) on delete cascade,
  occurrence_of date,
  avviker       boolean not null default false,
  -- Sätts av triggern nedan. Räkna aldrig sommartid någon annanstans.
  starts_at     timestamptz not null,
  cancelled_at  timestamptz,
  -- Leveranspost (pass 3)
  order_id      uuid references sales_order(id),
  step          text check (step in ('valkomstsamtal','tillgangar','kickoff','leveransstart','avstamning_30','avstamning_90')),
  outcome       text check (outcome in ('genomford','ej_svar')),
  outcome_by    uuid references employee(id),
  attempt       smallint not null default 1 check (attempt between 1 and 9),
  -- 1:1 (pass 2)
  coaching_session_id uuid references coaching_session(id),
  -- iCal (pass 4): ökar vid varje ändring av tid eller inställt.
  ics_sequence  integer not null default 0 check (ics_sequence >= 0),
  -- Den som skrev raden. Samma som organisatören utom när en delegat bokar.
  created_by    uuid not null references employee(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint calendar_event_leverans_har_kund check (kind <> 'leverans' or order_id is not null),
  constraint calendar_event_steg_bara_leverans check ((kind = 'leverans') = (step is not null)),
  constraint calendar_event_tid_har_langd check (tid is null or minuter is not null),
  constraint calendar_event_forekomst_par check ((series_id is null) = (occurrence_of is null)),
  constraint calendar_event_utfall_har_manniska check ((outcome is null) = (outcome_by is null)),
  constraint calendar_event_en_forekomst unique (series_id, occurrence_of)
);
create index if not exists calendar_event_organizer_dag_idx on calendar_event (organizer_id, dag);
create index if not exists calendar_event_dag_idx on calendar_event (dag);

create or replace function public.calendar_event_starts_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.starts_at := (new.dag + coalesce(new.tid, time '00:00')) at time zone 'Europe/Stockholm';
  return new;
end;
$$;
drop trigger if exists calendar_event_starts_at on calendar_event;
create trigger calendar_event_starts_at
  before insert or update of dag, tid on calendar_event
  for each row execute function public.calendar_event_starts_at();

-- -----------------------------------------------------------------------------
-- 3. Deltagare och svar
--
-- En rad hör till ANTINGEN en händelse eller en serie. Seriens rader är
-- grundsvaret; en rad på en förekomst går före seriens för just den gången.
-- Skissens `occurrence_of` på deltagaren står inte här: förekomsten är en egen
-- rad i `calendar_event`, så `event_id` pekar redan ut den, och en andra
-- kolumn som säger samma sak hade kunnat säga emot.
--
-- Organisatören står inte i tabellen. Hon har inget svar att ge.
-- -----------------------------------------------------------------------------

create table if not exists calendar_attendee (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid references calendar_event(id) on delete cascade,
  series_id        uuid references calendar_series(id) on delete cascade,
  employee_id      uuid references employee(id) on delete cascade,
  external_email   text check (external_email is null or (external_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(external_email) <= 254)),
  response         text not null default 'vantar' check (response in ('vantar','ja','kanske','nej')),
  response_note    text check (response_note is null or length(response_note) <= 300),
  proposed_dag     date,
  proposed_tid     time,
  proposed_minuter integer check (proposed_minuter is null or proposed_minuter between 15 and 480),
  proposal_note    text check (proposal_note is null or length(proposal_note) <= 300),
  responded_at     timestamptz,
  created_at       timestamptz not null default now(),
  constraint calendar_attendee_en_foralder check ((event_id is null) <> (series_id is null)),
  constraint calendar_attendee_en_person check ((employee_id is null) <> (external_email is null)),
  constraint calendar_attendee_forslag_helt check (
    (proposed_dag is null) = (proposed_tid is null)
    and (proposed_dag is null) = (proposed_minuter is null)
  ),
  -- Ett förslag gäller en viss gång. På serien finns ingen tid att föreslå om.
  constraint calendar_attendee_forslag_pa_forekomst check (proposed_dag is null or event_id is not null)
);
create unique index if not exists calendar_attendee_event_person
  on calendar_attendee (event_id, employee_id) where event_id is not null and employee_id is not null;
create unique index if not exists calendar_attendee_serie_person
  on calendar_attendee (series_id, employee_id) where series_id is not null and employee_id is not null;
create unique index if not exists calendar_attendee_event_extern
  on calendar_attendee (event_id, lower(external_email)) where event_id is not null and external_email is not null;
create index if not exists calendar_attendee_employee_idx on calendar_attendee (employee_id);

-- -----------------------------------------------------------------------------
-- 4. 1:1-punkter (pass 2). Lever över förekomsterna.
-- -----------------------------------------------------------------------------

create table if not exists one_on_one_item (
  id         uuid primary key default gen_random_uuid(),
  series_id  uuid not null references calendar_series(id) on delete cascade,
  kind       text not null check (kind in ('agenda','atgard')),
  text       text not null check (length(btrim(text)) between 1 and 300),
  author_id  uuid not null references employee(id),
  owner_id   uuid references employee(id),
  for_dag    date,
  done_at    timestamptz,
  task_id    uuid references task(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists one_on_one_item_series_idx on one_on_one_item (series_id);

-- -----------------------------------------------------------------------------
-- 5. Påminnelser som skickas av någon annan än webbläsaren (pass 2 och 3).
--
-- Plinget räknas i webbläsaren ur `reminder_min` och står inte här. Inte heller
-- uppgifternas påminnelse i klockan: den räknas fram ur uppgiftens frist när
-- jobbet körs (`lk_uppgiftspaminnelser()` nedan), eftersom en sparad tid hade
-- behövt flyttas av varje vy som kan flytta en uppgift.
-- -----------------------------------------------------------------------------

create table if not exists calendar_reminder (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references calendar_event(id) on delete cascade,
  channel    text not null check (channel in ('pling','mejl','forberedelse')),
  recipient  text not null check (recipient in ('ansvarig','kund','deltagare')),
  send_at    timestamptz not null,
  resend_id  text,
  status     text not null default 'vantar' check (status in ('vantar','schemalagd','skickad','avbokad','fel')),
  error      text,
  created_at timestamptz not null default now(),
  unique (event_id, channel, recipient)
);

-- -----------------------------------------------------------------------------
-- 6. Rådata från Resend och CRM. Skrivs hel, ändras aldrig, som call_ingest.
-- -----------------------------------------------------------------------------

create table if not exists integration_log (
  id          bigserial primary key,
  system      text not null check (system in ('resend','crm')),
  direction   text not null check (direction in ('ut','in')),
  body        jsonb not null,
  received_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 7. Utkorgen
-- -----------------------------------------------------------------------------

create table if not exists outbox (
  id              bigserial primary key,
  kind            text not null check (kind in ('notis','ics','resend_schedule','resend_patch','resend_cancel','crm')),
  payload         jsonb not null,
  idempotency_key text not null unique,
  -- Ångerfönstret. Ingenting lämnar navet före den här tiden.
  not_before      timestamptz not null default now() + interval '10 seconds',
  -- Satt av den tömning som tagit raden. En rad som tagits men aldrig blivit
  -- klar (funktionen dog) får tas igen efter två minuter.
  claimed_at      timestamptz,
  attempts        smallint not null default 0,
  sent_at         timestamptz,
  -- Satt efter tredje misslyckade försöket. Raden försöks inte igen.
  error           text,
  event_id        uuid references calendar_event(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists outbox_att_skicka_idx on outbox (not_before) where sent_at is null and error is null;

-- -----------------------------------------------------------------------------
-- 8. Ångra
-- -----------------------------------------------------------------------------

create table if not exists calendar_undo (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid references calendar_event(id) on delete cascade,
  series_id   uuid references calendar_series(id) on delete cascade,
  handling    text not null check (handling in ('skapa','svara','foresla','besluta','flytta','stall_in')),
  before      jsonb not null,
  outbox_ids  bigint[] not null default '{}',
  created_by  uuid not null references employee(id),
  created_at  timestamptz not null default now(),
  used_at     timestamptz
);

-- =============================================================================
-- 9. Läsning
-- =============================================================================

/**
 * Vilka som är med på en händelse, med förekomstens egna rader före seriens.
 * Intern: ingen grant.
 */
create or replace function public.lk_narvaro(p_event uuid)
returns table (rad uuid, employee_id uuid, external_email text, response text, fran_serie boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.id, a.employee_id, a.external_email, a.response, false
  from calendar_attendee a
  where a.event_id = p_event
  union all
  select s.id, s.employee_id, s.external_email, s.response, true
  from calendar_event e
  join calendar_attendee s on s.series_id = e.series_id
  where e.id = p_event
    and e.series_id is not null
    and not exists (
      select 1 from calendar_attendee o
      where o.event_id = p_event
        and (
          (s.employee_id is not null and o.employee_id = s.employee_id)
          or (s.external_email is not null and lower(o.external_email) = lower(s.external_email))
        )
    );
$$;

/**
 * Får p_viewer läsa händelsen i sin helhet?
 *
 * Organisatören och deltagarna, oavsett svar. Andra när de har minst "alla
 * detaljer" i kalendern hos någon som faktiskt har händelsen i sin kalender —
 * organisatören eller en deltagare som inte tackat nej. Det är samma sak som
 * att posten syns med detaljer i den personens kalender; en policy som släppte
 * fram mindre hade gett en post som går att se men inte öppna.
 */
create or replace function public.lk_ser_handelse(p_event uuid, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_viewer is not null and exists (
    select 1 from calendar_event e
    where e.id = p_event
      and (
        e.organizer_id = p_viewer
        or exists (select 1 from public.lk_narvaro(e.id) n where n.employee_id = p_viewer)
        or public.kalender_niva(e.organizer_id, p_viewer) in ('detaljer','redigera','delegat')
        or exists (
          select 1 from public.lk_narvaro(e.id) n
          where n.employee_id is not null
            and n.response <> 'nej'
            and public.kalender_niva(n.employee_id, p_viewer) in ('detaljer','redigera','delegat')
        )
      )
  );
$$;

create or replace function public.lk_ser_serie(p_series uuid, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_viewer is not null and exists (
    select 1 from calendar_series s
    where s.id = p_series
      and (
        s.organizer_id = p_viewer
        or exists (select 1 from calendar_attendee a where a.series_id = s.id and a.employee_id = p_viewer)
        or public.kalender_niva(s.organizer_id, p_viewer) in ('detaljer','redigera','delegat')
        or exists (
          select 1 from calendar_attendee a
          where a.series_id = s.id and a.employee_id is not null and a.response <> 'nej'
            and public.kalender_niva(a.employee_id, p_viewer) in ('detaljer','redigera','delegat')
        )
      )
  );
$$;

/**
 * En persons möten mellan två datum, projicerade till läsarens nivå I DEN
 * PERSONENS KALENDER. Varje kalender visas för sig, som i Outlook
 * (beställarens val 2026-09-30): nivån hos p_owner avgör, inte den bästa
 * nivån hos någon deltagare.
 *
 * Läsaren som själv är med ser allt. Andra:
 *   upptagen → bara tiden (ref, rubrik, slag och organisatör är null)
 *   rubriker → rubrik och slag, men ingen ref att öppna
 *   detaljer och uppåt → allt
 *
 * Ägarens nej visas bara för ägaren själv ("Visa möten jag avböjt"). För alla
 * andra är tiden ledig.
 */
create or replace function public.kalender_handelser(p_owner uuid, p_fran date, p_till date)
returns table (
  ref          uuid,
  slag         text,
  dag          date,
  tid          time,
  minuter      int,
  rubrik       text,
  organizer_id uuid,
  svar         text,
  series_id    uuid,
  show_as      text,
  step         text,
  outcome      text,
  attempt      smallint,
  reminder_min smallint,
  niva         text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_viewer uuid := public.current_employee_id();
  v_niva   text := public.kalender_niva(p_owner, v_viewer);
begin
  if v_niva is null or p_fran is null or p_till is null or p_till < p_fran or p_till - p_fran > 62 then
    return;
  end if;

  return query
  with mina as (
    select e.*,
           case when e.organizer_id = p_owner then 'org'
                else (select n.response from public.lk_narvaro(e.id) n where n.employee_id = p_owner limit 1)
           end as agarsvar
    from calendar_event e
    where e.dag between p_fran and p_till
      and e.cancelled_at is null
  ),
  hans as (
    select m.*,
           (m.organizer_id = v_viewer
            or exists (select 1 from public.lk_narvaro(m.id) n where n.employee_id = v_viewer and n.response <> 'nej'))
             as lasaren_med
    from mina m
    where m.agarsvar is not null
      and (m.agarsvar <> 'nej' or p_owner = v_viewer)
  )
  select
    case when h.lasaren_med or v_niva in ('detaljer','redigera','delegat') then h.id end,
    case when h.lasaren_med or v_niva <> 'upptagen' then h.kind end,
    h.dag,
    h.tid,
    h.minuter,
    case when h.lasaren_med or v_niva <> 'upptagen' then h.title end,
    case when h.lasaren_med or v_niva <> 'upptagen' then h.organizer_id end,
    h.agarsvar,
    case when h.lasaren_med or v_niva in ('detaljer','redigera','delegat') then h.series_id end,
    h.show_as,
    case when h.lasaren_med or v_niva <> 'upptagen' then h.step end,
    case when h.lasaren_med or v_niva in ('detaljer','redigera','delegat') then h.outcome end,
    h.attempt,
    h.reminder_min,
    case when h.lasaren_med then 'deltagare' else v_niva end
  from hans h
  order by h.dag, h.tid nulls first;
end;
$$;

-- =============================================================================
-- 10. Skrivning. Bara service role.
-- =============================================================================

/** Får p_aktor ändra tiden på organisatörens händelser? Hon själv, eller
 *  den som har "kan planera om" eller "delegat" i hennes kalender — samma sak
 *  som `farPlaneraOm()` i kalender.ts. */
create or replace function public.lk_far_andra(p_aktor uuid, p_organizer uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_aktor is not null and p_organizer is not null
     and (p_aktor = p_organizer
          or public.kalender_niva(p_organizer, p_aktor) in ('redigera','delegat'));
$$;

create or replace function public.lk_aktiv(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from employee e where e.id = p_employee and e.status <> 'offboarded');
$$;

/** Läget före en ändring: händelsen, dess egna deltagarrader och seriens. */
create or replace function public.lk_lage(p_event uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'event', to_jsonb(e),
    'attendees', coalesce((select jsonb_agg(to_jsonb(a)) from calendar_attendee a where a.event_id = e.id), '[]'::jsonb),
    'series_attendees', case when e.series_id is null then null
      else coalesce((select jsonb_agg(to_jsonb(a)) from calendar_attendee a where a.series_id = e.series_id), '[]'::jsonb) end
  )
  from calendar_event e
  where e.id = p_event;
$$;

/** En notis i utkorgen. Mottagaren och aktören sållas i `notifiera()`. */
create or replace function public.lk_notis(
  p_aktion uuid, p_kalla text, p_mall text, p_till uuid, p_av uuid, p_event uuid, p_data jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
begin
  if p_till is null or p_till = p_av then
    return null;
  end if;
  insert into outbox (kind, payload, idempotency_key, event_id)
  values (
    'notis',
    jsonb_build_object('kalla', p_kalla, 'mall', p_mall, 'till', p_till, 'av', p_av,
                       'event_id', p_event, 'data', coalesce(p_data, '{}'::jsonb)),
    p_aktion::text || ':' || p_mall || ':' || p_till::text,
    p_event
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

/**
 * Ny tid, och därmed nytt svar. Intern — anropas av lk_flytta och
 * lk_besluta_forslag, som skriver läget för Ångra själva.
 *
 * Alla deltagare utom de i p_behall får "Inte svarat" och sina förslag
 * bortstrukna; de i p_behall får "Ja" (den som föreslog tiden). För en
 * förekomst i en serie skrivs svaren på förekomsten och seriens rader lämnas
 * orörda — bara den här gången.
 *
 * Mejl bara när den närmaste av gamla och nya tiden ligger inom sju dagar,
 * därför två källor.
 */
create or replace function public.lk_ny_tid(
  p_aktion uuid, p_aktor uuid, p_event uuid, p_dag date, p_tid time, p_minuter int, p_behall uuid[]
)
returns table (outbox_ids bigint[], svara_igen uuid[])
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_e      calendar_event;
  v_ny     timestamptz;
  v_kalla  text;
  v_ids    bigint[] := '{}';
  v_igen   uuid[] := '{}';
  v_id     bigint;
  r        record;
begin
  select * into v_e from calendar_event where id = p_event for update;

  v_ny := (p_dag + p_tid) at time zone 'Europe/Stockholm';
  v_kalla := case when least(v_e.starts_at, v_ny) <= now() + interval '7 days'
                  then 'kalender-flyttad' else 'kalender-flyttad-tyst' end;

  -- Förekomstens egna rader för seriens deltagare, innan tiden ändras, så att
  -- nollställningen nedan bara träffar den här gången.
  if v_e.series_id is not null then
    insert into calendar_attendee (event_id, employee_id, external_email, response)
    select p_event, n.employee_id, n.external_email, n.response
    from public.lk_narvaro(p_event) n
    where n.fran_serie;
  end if;

  update calendar_event
     set dag = p_dag, tid = p_tid, minuter = p_minuter,
         avviker = (series_id is not null) or avviker,
         ics_sequence = ics_sequence + 1,
         updated_at = now()
   where id = p_event;

  update calendar_attendee a
     set response = case when a.employee_id = any(coalesce(p_behall, '{}')) then 'ja' else 'vantar' end,
         responded_at = case when a.employee_id = any(coalesce(p_behall, '{}')) then now() else null end,
         response_note = null,
         proposed_dag = null, proposed_tid = null, proposed_minuter = null, proposal_note = null
   where a.event_id = p_event;

  for r in
    select a.employee_id from calendar_attendee a
    where a.event_id = p_event and a.employee_id is not null
  loop
    if not (r.employee_id = any(coalesce(p_behall, '{}'))) and r.employee_id <> p_aktor then
      v_igen := v_igen || r.employee_id;
    end if;
    -- Förslagsställaren får beskedet om beslutet i stället, från anroparen.
    if not (r.employee_id = any(coalesce(p_behall, '{}'))) then
      v_id := public.lk_notis(p_aktion, v_kalla, 'flyttad', r.employee_id, p_aktor, p_event,
        jsonb_build_object('dag', p_dag, 'tid', to_char(p_tid, 'HH24:MI'), 'minuter', p_minuter,
                           'svara_igen', true, 'forekomst', v_e.series_id is not null));
      if v_id is not null then v_ids := v_ids || v_id; end if;
    end if;
  end loop;

  -- Organisatören har inget svar att nollställa, men är det en delegat som
  -- flyttat ska hon få veta att hennes möte flyttats.
  if v_e.organizer_id <> p_aktor then
    v_id := public.lk_notis(p_aktion, v_kalla, 'flyttad', v_e.organizer_id, p_aktor, p_event,
      jsonb_build_object('dag', p_dag, 'tid', to_char(p_tid, 'HH24:MI'), 'minuter', p_minuter,
                         'svara_igen', false, 'forekomst', v_e.series_id is not null));
    if v_id is not null then v_ids := v_ids || v_id; end if;
  end if;

  outbox_ids := v_ids;
  svara_igen := v_igen;
  return next;
end;
$$;

create or replace function public.lk_undo(
  p_event uuid, p_series uuid, p_handling text, p_before jsonb, p_outbox bigint[], p_aktor uuid
)
returns uuid
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into calendar_undo (event_id, series_id, handling, before, outbox_ids, created_by)
  values (p_event, p_series, p_handling, p_before, coalesce(p_outbox, '{}'), p_aktor)
  returning id;
$$;

/**
 * Nytt möte med deltagare.
 */
create or replace function public.lk_skapa_mote(
  p_aktor uuid,
  p_organizer uuid,
  p_title text,
  p_dag date,
  p_tid time,
  p_minuter int,
  p_deltagare uuid[],
  p_plats text,
  p_online_url text,
  p_agenda text,
  p_reminder_min int
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_aktion uuid := gen_random_uuid();
  v_event  uuid;
  v_ids    bigint[] := '{}';
  v_id     bigint;
  v_person uuid;
  v_alla   uuid[];
begin
  if not public.lk_aktiv(p_aktor) or not public.lk_aktiv(p_organizer)
     or not public.lk_far_andra(p_aktor, p_organizer) then
    raise exception 'lk:behorighet';
  end if;
  if p_title is null or length(btrim(p_title)) = 0 then
    raise exception 'lk:rubrik';
  end if;
  if p_dag is null or p_tid is null or extract(isodow from p_dag) > 5 then
    raise exception 'lk:vardag';
  end if;
  if p_minuter is null or p_minuter < 15 or p_minuter > 480
     or extract(minute from p_tid)::int % 5 <> 0 then
    raise exception 'lk:ogiltig';
  end if;

  select coalesce(array_agg(distinct d), '{}') into v_alla
  from unnest(coalesce(p_deltagare, '{}')) d
  where d is not null and d <> p_organizer;

  if cardinality(v_alla) > 50 then
    raise exception 'lk:ogiltig';
  end if;

  insert into calendar_event (kind, title, organizer_id, dag, tid, minuter, plats, online_url,
                              agenda_md, reminder_min, created_by)
  values ('mote', btrim(p_title), p_organizer, p_dag, p_tid, p_minuter,
          nullif(btrim(coalesce(p_plats, '')), ''), nullif(btrim(coalesce(p_online_url, '')), ''),
          coalesce(p_agenda, ''), coalesce(p_reminder_min, 10), p_aktor)
  returning id into v_event;

  foreach v_person in array v_alla loop
    if not public.lk_aktiv(v_person) then
      raise exception 'lk:ogiltig';
    end if;
    insert into calendar_attendee (event_id, employee_id) values (v_event, v_person);
    v_id := public.lk_notis(v_aktion, 'kalender-inbjudan', 'inbjudan', v_person, p_aktor, v_event, '{}'::jsonb);
    if v_id is not null then v_ids := v_ids || v_id; end if;
  end loop;

  if p_organizer <> p_aktor then
    v_id := public.lk_notis(v_aktion, 'kalender-inbjudan', 'bokat-at-dig', p_organizer, p_aktor, v_event, '{}'::jsonb);
    if v_id is not null then v_ids := v_ids || v_id; end if;
  end if;

  return jsonb_build_object(
    'event_id', v_event,
    'undo_id', public.lk_undo(v_event, null, 'skapa', jsonb_build_object('skapad', v_event), v_ids, p_aktor),
    'deltagare', to_jsonb(v_alla)
  );
end;
$$;

/**
 * Ja, Kanske eller Nej. För en förekomst i en serie gäller svaret bara den
 * gången, om inte p_hela_serien.
 */
create or replace function public.lk_svara(
  p_aktor uuid, p_event uuid, p_svar text, p_note text, p_hela_serien boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_aktion uuid := gen_random_uuid();
  v_e      calendar_event;
  v_fore   jsonb;
  v_id     bigint;
  v_rad    record;
begin
  if p_svar not in ('ja','kanske','nej') then
    raise exception 'lk:ogiltig';
  end if;
  select * into v_e from calendar_event where id = p_event for update;
  if not found then raise exception 'lk:finns_inte'; end if;
  if v_e.cancelled_at is not null then raise exception 'lk:installd'; end if;

  select * into v_rad from public.lk_narvaro(p_event) n where n.employee_id = p_aktor;
  if not found then raise exception 'lk:behorighet'; end if;

  v_fore := public.lk_lage(p_event);

  if v_e.series_id is not null and coalesce(p_hela_serien, false) then
    update calendar_attendee
       set response = p_svar, response_note = nullif(btrim(coalesce(p_note, '')), ''), responded_at = now()
     where series_id = v_e.series_id and employee_id = p_aktor;
    -- Hela serien: förekomsternas egna svar för mig gäller inte längre.
    update calendar_attendee a
       set response = p_svar, response_note = nullif(btrim(coalesce(p_note, '')), ''), responded_at = now()
      from calendar_event e
     where a.event_id = e.id and e.series_id = v_e.series_id and e.dag >= v_e.dag
       and a.employee_id = p_aktor;
  elsif v_rad.fran_serie then
    insert into calendar_attendee (event_id, employee_id, response, response_note, responded_at)
    values (p_event, p_aktor, p_svar, nullif(btrim(coalesce(p_note, '')), ''), now());
  else
    update calendar_attendee
       set response = p_svar, response_note = nullif(btrim(coalesce(p_note, '')), ''), responded_at = now()
     where id = v_rad.rad;
  end if;

  v_id := public.lk_notis(v_aktion, 'kalender-svar', 'svar', v_e.organizer_id, p_aktor, p_event,
    jsonb_build_object('svar', p_svar, 'note', nullif(btrim(coalesce(p_note, '')), ''),
                       'hela_serien', v_e.series_id is not null and coalesce(p_hela_serien, false),
                       'forekomst', v_e.series_id is not null and not coalesce(p_hela_serien, false)));

  return jsonb_build_object(
    'event_id', p_event,
    'organizer_id', v_e.organizer_id,
    'undo_id', public.lk_undo(p_event, null, 'svara', v_fore,
                              case when v_id is null then '{}'::bigint[] else array[v_id] end, p_aktor)
  );
end;
$$;

/** Deltagarens förslag på ny tid. Gäller alltid en viss gång. */
create or replace function public.lk_foresla(
  p_aktor uuid, p_event uuid, p_dag date, p_tid time, p_minuter int, p_note text, p_svar text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_aktion uuid := gen_random_uuid();
  v_e      calendar_event;
  v_fore   jsonb;
  v_id     bigint;
  v_rad    record;
  v_svar   text := coalesce(p_svar, 'kanske');
begin
  if v_svar not in ('ja','kanske','nej') then raise exception 'lk:ogiltig'; end if;
  if p_dag is null or p_tid is null or extract(isodow from p_dag) > 5 then raise exception 'lk:vardag'; end if;
  if p_minuter is null or p_minuter < 15 or p_minuter > 480 then raise exception 'lk:ogiltig'; end if;
  if p_note is not null and length(p_note) > 300 then raise exception 'lk:ogiltig'; end if;

  select * into v_e from calendar_event where id = p_event for update;
  if not found then raise exception 'lk:finns_inte'; end if;
  if v_e.cancelled_at is not null then raise exception 'lk:installd'; end if;

  select * into v_rad from public.lk_narvaro(p_event) n where n.employee_id = p_aktor;
  if not found then raise exception 'lk:behorighet'; end if;

  v_fore := public.lk_lage(p_event);

  if v_rad.fran_serie then
    insert into calendar_attendee (event_id, employee_id, response, responded_at,
                                   proposed_dag, proposed_tid, proposed_minuter, proposal_note)
    values (p_event, p_aktor, v_rad.response, null, p_dag, p_tid, p_minuter, nullif(btrim(coalesce(p_note, '')), ''));
  else
    update calendar_attendee
       set response = case when v_e.series_id is null then v_svar else response end,
           responded_at = case when v_e.series_id is null then now() else responded_at end,
           proposed_dag = p_dag, proposed_tid = p_tid, proposed_minuter = p_minuter,
           proposal_note = nullif(btrim(coalesce(p_note, '')), '')
     where id = v_rad.rad;
  end if;

  v_id := public.lk_notis(v_aktion, 'kalender-forslag', 'forslag', v_e.organizer_id, p_aktor, p_event,
    jsonb_build_object('dag', p_dag, 'tid', to_char(p_tid, 'HH24:MI'), 'minuter', p_minuter,
                       'note', nullif(btrim(coalesce(p_note, '')), ''),
                       'forekomst', v_e.series_id is not null));

  return jsonb_build_object(
    'event_id', p_event,
    'organizer_id', v_e.organizer_id,
    'undo_id', public.lk_undo(p_event, null, 'foresla', v_fore,
                              case when v_id is null then '{}'::bigint[] else array[v_id] end, p_aktor)
  );
end;
$$;

/** Organisatörens beslut om ett förslag. Godkänt flyttar, och förslagsställaren räknas som Ja. */
create or replace function public.lk_besluta_forslag(
  p_aktor uuid, p_event uuid, p_forslagsstallare uuid, p_godkann boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_aktion uuid := gen_random_uuid();
  v_e      calendar_event;
  v_a      calendar_attendee;
  v_fore   jsonb;
  v_ids    bigint[] := '{}';
  v_id     bigint;
  v_igen   uuid[] := '{}';
begin
  select * into v_e from calendar_event where id = p_event for update;
  if not found then raise exception 'lk:finns_inte'; end if;
  if v_e.cancelled_at is not null then raise exception 'lk:installd'; end if;
  if not public.lk_far_andra(p_aktor, v_e.organizer_id) then raise exception 'lk:behorighet'; end if;

  select * into v_a from calendar_attendee
   where event_id = p_event and employee_id = p_forslagsstallare and proposed_dag is not null
   for update;
  if not found then raise exception 'lk:finns_inte'; end if;

  v_fore := public.lk_lage(p_event);

  if coalesce(p_godkann, false) then
    if extract(isodow from v_a.proposed_dag) > 5 then raise exception 'lk:vardag'; end if;
    select t.outbox_ids, t.svara_igen into v_ids, v_igen
      from public.lk_ny_tid(v_aktion, p_aktor, p_event, v_a.proposed_dag, v_a.proposed_tid,
                            v_a.proposed_minuter, array[p_forslagsstallare]) t;
  else
    update calendar_attendee
       set proposed_dag = null, proposed_tid = null, proposed_minuter = null, proposal_note = null
     where id = v_a.id;
  end if;

  v_id := public.lk_notis(v_aktion, 'kalender-forslag-beslut',
                          case when coalesce(p_godkann, false) then 'forslag-godkant' else 'forslag-behallen' end,
                          p_forslagsstallare, p_aktor, p_event,
                          jsonb_build_object('dag', v_a.proposed_dag, 'tid', to_char(v_a.proposed_tid, 'HH24:MI'),
                                             'minuter', v_a.proposed_minuter));
  if v_id is not null then v_ids := v_ids || v_id; end if;

  return jsonb_build_object(
    'event_id', p_event,
    'svara_igen', to_jsonb(v_igen),
    'undo_id', public.lk_undo(p_event, null, 'besluta', v_fore, v_ids, p_aktor)
  );
end;
$$;

/** Flytta eller ändra längd. Samma sak för svaren: ny tid, nytt svar. */
create or replace function public.lk_flytta(
  p_aktor uuid, p_event uuid, p_dag date, p_tid time, p_minuter int
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_aktion uuid := gen_random_uuid();
  v_e      calendar_event;
  v_fore   jsonb;
  v_ny     record;
  v_min    int;
begin
  select * into v_e from calendar_event where id = p_event for update;
  if not found then raise exception 'lk:finns_inte'; end if;
  if v_e.cancelled_at is not null then raise exception 'lk:installd'; end if;
  if not public.lk_far_andra(p_aktor, v_e.organizer_id) then raise exception 'lk:behorighet'; end if;
  if p_dag is null or p_tid is null or extract(isodow from p_dag) > 5 then raise exception 'lk:vardag'; end if;

  v_min := coalesce(p_minuter, v_e.minuter, 30);
  if v_min < 15 or v_min > 480 or extract(minute from p_tid)::int % 5 <> 0 then
    raise exception 'lk:ogiltig';
  end if;
  if v_e.dag = p_dag and v_e.tid = p_tid and v_e.minuter = v_min then
    raise exception 'lk:oforandrad';
  end if;

  v_fore := public.lk_lage(p_event);
  select * into v_ny from public.lk_ny_tid(v_aktion, p_aktor, p_event, p_dag, p_tid, v_min, '{}');

  return jsonb_build_object(
    'event_id', p_event,
    'svara_igen', to_jsonb(v_ny.svara_igen),
    'undo_id', public.lk_undo(p_event, null, 'flytta', v_fore, v_ny.outbox_ids, p_aktor)
  );
end;
$$;

/** Ställ in. Raden står kvar med `cancelled_at`; deltagarna får notis och mejl. */
create or replace function public.lk_stall_in(p_aktor uuid, p_event uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_aktion uuid := gen_random_uuid();
  v_e      calendar_event;
  v_fore   jsonb;
  v_ids    bigint[] := '{}';
  v_id     bigint;
  v_till   uuid[] := '{}';
  r        record;
begin
  select * into v_e from calendar_event where id = p_event for update;
  if not found then raise exception 'lk:finns_inte'; end if;
  if v_e.cancelled_at is not null then raise exception 'lk:installd'; end if;
  if not public.lk_far_andra(p_aktor, v_e.organizer_id) then raise exception 'lk:behorighet'; end if;

  v_fore := public.lk_lage(p_event);

  update calendar_event
     set cancelled_at = now(),
         avviker = (series_id is not null) or avviker,
         ics_sequence = ics_sequence + 1,
         updated_at = now()
   where id = p_event;

  for r in
    select n.employee_id from public.lk_narvaro(p_event) n
    where n.employee_id is not null
    union
    select v_e.organizer_id
  loop
    v_id := public.lk_notis(v_aktion, 'kalender-installd', 'installd', r.employee_id, p_aktor, p_event,
      jsonb_build_object('dag', v_e.dag, 'tid', to_char(v_e.tid, 'HH24:MI')));
    if v_id is not null then
      v_ids := v_ids || v_id;
      v_till := v_till || r.employee_id;
    end if;
  end loop;

  return jsonb_build_object(
    'event_id', p_event,
    'mottagare', to_jsonb(v_till),
    'undo_id', public.lk_undo(p_event, null, 'stall_in', v_fore, v_ids, p_aktor)
  );
end;
$$;

/** Kopia en vecka senare, med nollställda svar och ny inbjudan. Inte för en förekomst i en serie. */
create or replace function public.lk_kopiera(p_aktor uuid, p_event uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_aktion uuid := gen_random_uuid();
  v_e      calendar_event;
  v_ny     uuid;
  v_ids    bigint[] := '{}';
  v_id     bigint;
  r        record;
begin
  select * into v_e from calendar_event where id = p_event;
  if not found then raise exception 'lk:finns_inte'; end if;
  if v_e.series_id is not null or v_e.kind <> 'mote' then raise exception 'lk:ogiltig'; end if;
  if not public.lk_far_andra(p_aktor, v_e.organizer_id) then raise exception 'lk:behorighet'; end if;

  insert into calendar_event (kind, title, organizer_id, dag, tid, minuter, show_as, reminder_min,
                              plats, online_url, agenda_md, created_by)
  values (v_e.kind, v_e.title, v_e.organizer_id, v_e.dag + 7, v_e.tid, v_e.minuter, v_e.show_as,
          v_e.reminder_min, v_e.plats, v_e.online_url, v_e.agenda_md, p_aktor)
  returning id into v_ny;

  for r in
    select a.employee_id, a.external_email from calendar_attendee a
    where a.event_id = p_event
      and (a.employee_id is null or public.lk_aktiv(a.employee_id))
  loop
    insert into calendar_attendee (event_id, employee_id, external_email)
    values (v_ny, r.employee_id, r.external_email);
    if r.employee_id is not null then
      v_id := public.lk_notis(v_aktion, 'kalender-inbjudan', 'inbjudan', r.employee_id, p_aktor, v_ny, '{}'::jsonb);
      if v_id is not null then v_ids := v_ids || v_id; end if;
    end if;
  end loop;

  return jsonb_build_object(
    'event_id', v_ny,
    'undo_id', public.lk_undo(v_ny, null, 'skapa', jsonb_build_object('skapad', v_ny), v_ids, p_aktor)
  );
end;
$$;

/**
 * Ångra. Bara den som gjorde ändringen, bara en gång, bara inom fem minuter —
 * och BARA OM INGENTING HUNNIT GÅ UT. Har en rad i utkorgen redan tagits av en
 * tömning vägrar funktionen: att återställa läget tyst efter att någon fått
 * ett besked om det hade gjort beskedet till en lögn.
 *
 * Ångringen loggas som en egen rad i audit_log, som angra()s andra grenar.
 */
create or replace function public.lk_angra(p_aktor uuid, p_undo uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_u      calendar_undo;
  v_event  uuid;
begin
  select * into v_u from calendar_undo where id = p_undo for update;
  if not found or v_u.created_by <> p_aktor then raise exception 'lk:finns_inte'; end if;
  if v_u.used_at is not null or v_u.created_at < now() - interval '5 minutes' then
    raise exception 'lk:for_sent';
  end if;

  perform 1 from outbox where id = any(v_u.outbox_ids) for update;
  if exists (select 1 from outbox
             where id = any(v_u.outbox_ids) and (sent_at is not null or claimed_at is not null)) then
    raise exception 'lk:for_sent';
  end if;

  delete from outbox where id = any(v_u.outbox_ids);
  update calendar_undo set used_at = now() where id = p_undo;

  if v_u.handling = 'skapa' then
    v_event := (v_u.before ->> 'skapad')::uuid;
    delete from calendar_event where id = v_event;
  else
    v_event := (v_u.before -> 'event' ->> 'id')::uuid;

    update calendar_event e
       set (dag, tid, minuter, show_as, reminder_min, plats, online_url, agenda_md,
            avviker, cancelled_at, outcome, outcome_by, attempt, ics_sequence, updated_at)
         = (b.dag, b.tid, b.minuter, b.show_as, b.reminder_min, b.plats, b.online_url, b.agenda_md,
            b.avviker, b.cancelled_at, b.outcome, b.outcome_by, b.attempt, b.ics_sequence, now())
      from jsonb_populate_record(null::calendar_event, v_u.before -> 'event') b
     where e.id = v_event;

    delete from calendar_attendee where event_id = v_event;
    insert into calendar_attendee
    select * from jsonb_populate_recordset(null::calendar_attendee, v_u.before -> 'attendees');

    if v_u.before ? 'series_attendees' and jsonb_typeof(v_u.before -> 'series_attendees') = 'array' then
      delete from calendar_attendee
       where series_id = (v_u.before -> 'event' ->> 'series_id')::uuid;
      insert into calendar_attendee
      select * from jsonb_populate_recordset(null::calendar_attendee, v_u.before -> 'series_attendees');
    end if;
  end if;

  insert into audit_log (actor_id, action, object_type, object_id, reason)
  values (p_aktor, 'calendar.undone', 'calendar_event', v_event::text,
          'Ångrad direkt efter ' || v_u.handling);

  return jsonb_build_object('event_id', v_event, 'handling', v_u.handling);
end;
$$;

-- -----------------------------------------------------------------------------
-- 11. Utkorgens tömning
-- -----------------------------------------------------------------------------

/** Tar upp till p_antal rader som är dags att skicka. `skip locked`: en
 *  rad som en annan tömning eller en pågående ångring håller hoppas över. */
create or replace function public.lk_utkorg_ta(p_antal int)
returns setof outbox
language sql
security definer
set search_path = public, pg_temp
as $$
  update outbox o
     set claimed_at = now(), attempts = o.attempts + 1
   where o.id in (
     select id from outbox
     where sent_at is null and error is null
       and not_before <= now()
       and (claimed_at is null or claimed_at < now() - interval '2 minutes')
     order by id
     limit greatest(1, least(coalesce(p_antal, 50), 200))
     for update skip locked
   )
  returning o.*;
$$;

/** Utfallet av ett försök. Tre misslyckade ger `error` och inga fler försök. */
create or replace function public.lk_utkorg_klar(p_id bigint, p_fel text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_forsok smallint;
begin
  if p_fel is null then
    update outbox set sent_at = now() where id = p_id;
    return 'skickad';
  end if;
  update outbox
     set claimed_at = null,
         not_before = now() + (attempts * interval '1 minute'),
         error = case when attempts >= 3 then left(p_fel, 500) else null end
   where id = p_id
  returning attempts into v_forsok;
  return case when v_forsok >= 3 then 'fel' else 'igen' end;
end;
$$;

/**
 * Uppgifternas påminnelse i klockan, tio minuter före (beställarens val
 * 2026-09-30). Räknas fram ur uppgiften varje gång jobbet körs. Nyckeln bär
 * fristen, så en uppgift som flyttas får en ny påminnelse och samma frist
 * aldrig två.
 *
 * Stängda uppgifter hoppas över: den senaste av klar, godkänd, avbruten och
 * återöppnad avgör.
 */
create or replace function public.lk_uppgiftspaminnelser()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_antal int;
begin
  insert into outbox (kind, payload, idempotency_key, not_before)
  select 'notis',
         jsonb_build_object('kalla', 'uppgift-paminnelse', 'mall', 'uppgift-paminnelse',
                            'till', t.assignee_id, 'av', null, 'task_id', t.id,
                            'data', jsonb_build_object('dag', t.due_date, 'tid', to_char(t.due_time, 'HH24:MI'))),
         'uppgift-paminnelse:' || t.id::text || ':' || t.due_date::text || 'T' || to_char(t.due_time, 'HH24:MI'),
         now()
  from task t
  join employee e on e.id = t.assignee_id and e.status <> 'offboarded'
  where t.due_time is not null
    and t.parent_id is null
    and t.due_date between current_date - 1 and current_date + 1
    and ((t.due_date + t.due_time) at time zone 'Europe/Stockholm') - interval '10 minutes' <= now()
    and ((t.due_date + t.due_time) at time zone 'Europe/Stockholm') > now() - interval '5 minutes'
    and coalesce((
      select ev.type from task_event ev
      where ev.task_id = t.id and ev.type in ('klar','godkand','avbruten','ateroppnad')
      order by ev.at desc limit 1
    ), 'ateroppnad') = 'ateroppnad'
  on conflict (idempotency_key) do nothing;
  get diagnostics v_antal = row_count;
  return v_antal;
end;
$$;

-- -----------------------------------------------------------------------------
-- 12. Granter
--
-- Supabase ger nya funktioner till anon och authenticated som standard, så
-- varje funktion stängs uttryckligen. Läsfunktionerna öppnas för authenticated;
-- skrivfunktionerna bara för service role.
-- -----------------------------------------------------------------------------

do $$
declare
  f text;
begin
  foreach f in array array[
    'lk_narvaro(uuid)',
    'lk_ser_handelse(uuid, uuid)',
    'lk_ser_serie(uuid, uuid)',
    'kalender_handelser(uuid, date, date)',
    'lk_far_andra(uuid, uuid)',
    'lk_aktiv(uuid)',
    'lk_lage(uuid)',
    'lk_notis(uuid, text, text, uuid, uuid, uuid, jsonb)',
    'lk_ny_tid(uuid, uuid, uuid, date, time, int, uuid[])',
    'lk_undo(uuid, uuid, text, jsonb, bigint[], uuid)',
    'lk_skapa_mote(uuid, uuid, text, date, time, int, uuid[], text, text, text, int)',
    'lk_svara(uuid, uuid, text, text, boolean)',
    'lk_foresla(uuid, uuid, date, time, int, text, text)',
    'lk_besluta_forslag(uuid, uuid, uuid, boolean)',
    'lk_flytta(uuid, uuid, date, time, int)',
    'lk_stall_in(uuid, uuid)',
    'lk_kopiera(uuid, uuid)',
    'lk_angra(uuid, uuid)',
    'lk_utkorg_ta(int)',
    'lk_utkorg_klar(bigint, text)',
    'lk_uppgiftspaminnelser()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;

-- Läsningen. `lk_ser_*` behövs av policyerna, som körs som authenticated.
grant execute on function public.kalender_handelser(uuid, date, date) to authenticated;
grant execute on function public.lk_ser_handelse(uuid, uuid) to authenticated;
grant execute on function public.lk_ser_serie(uuid, uuid) to authenticated;
grant execute on function public.lk_narvaro(uuid) to authenticated;

-- En 1:1:s innehåll: exakt samma krets som coaching_session_read i 0043.
-- Säljaren (deltagaren), den som håller samtalet (organisatören), säljarens
-- chef och de som får läsa alla anställda. Andra ser bara tiden.
--
-- SECURITY DEFINER, och det är inte en bekvämlighet: en policy som läste
-- calendar_series direkt hade gått genom seriens egen RLS, och chefen — som
-- inte är med på mötet — hade stoppats där innan kretsen ens prövats.
create or replace function public.lk_ser_enskilt_innehall(p_series uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from calendar_series s
    where s.id = p_series
      and s.kind = 'enskilt'
      and (
        s.organizer_id = public.current_employee_id()
        or public.can_read_all_employees()
        or exists (
          select 1 from calendar_attendee a
          where a.series_id = s.id and a.employee_id is not null
            and (a.employee_id = public.current_employee_id() or public.leads_employee(a.employee_id))
        )
      )
  );
$$;
revoke all on function public.lk_ser_enskilt_innehall(uuid) from public, anon;
grant execute on function public.lk_ser_enskilt_innehall(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 13. RLS. Läsning för de inblandade; ingen skrivpolicy någonstans (D-T1).
-- -----------------------------------------------------------------------------

alter table calendar_series   enable row level security;
alter table calendar_event    enable row level security;
alter table calendar_attendee enable row level security;
alter table one_on_one_item   enable row level security;
alter table calendar_reminder enable row level security;
alter table integration_log   enable row level security;
alter table outbox            enable row level security;
alter table calendar_undo     enable row level security;

drop policy if exists calendar_event_read on calendar_event;
create policy calendar_event_read on calendar_event for select to authenticated
  using (public.lk_ser_handelse(id, public.current_employee_id()));

drop policy if exists calendar_series_read on calendar_series;
create policy calendar_series_read on calendar_series for select to authenticated
  using (public.lk_ser_serie(id, public.current_employee_id()));

drop policy if exists calendar_attendee_read on calendar_attendee;
create policy calendar_attendee_read on calendar_attendee for select to authenticated
  using (
    (event_id is not null and public.lk_ser_handelse(event_id, public.current_employee_id()))
    or (series_id is not null and public.lk_ser_serie(series_id, public.current_employee_id()))
  );

-- En 1:1:s innehåll: exakt samma krets som coaching_session_read i 0043.
-- Säljaren (deltagaren), den som håller samtalet (organisatören), säljarens
-- chef och de som får läsa alla anställda. Andra ser bara tiden.
drop policy if exists one_on_one_item_read on one_on_one_item;
create policy one_on_one_item_read on one_on_one_item for select to authenticated
  using (public.lk_ser_enskilt_innehall(series_id));

-- Utkorgen, loggen, påminnelserna och ångerraderna läses bara av servern.
revoke all on table outbox, integration_log, calendar_reminder, calendar_undo from anon, authenticated;
revoke all on sequence outbox_id_seq, integration_log_id_seq from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 14. Reservtömningen. Skapas AVSTÄNGD.
--
-- `job_target` pekar på produktionen, och där finns ingen /api/jobb/utkorg
-- förrän grenen mergats — previewen går inte att nå från databasen alls
-- (Vercels skydd ger 302). Jobbet slås på samma dag som mergen:
--   select cron.alter_job(jobid, active := true) from cron.job where jobname = 'nav-utkorg';
-- OBS: körs migrationen om efter det stängs jobbet igen.
-- -----------------------------------------------------------------------------

select cron.unschedule('nav-utkorg')
where exists (select 1 from cron.job where jobname = 'nav-utkorg');

select cron.schedule(
  'nav-utkorg',
  '* * * * *',
  $cron$select public.kalla_jobb('/api/jobb/utkorg')$cron$
);

select cron.alter_job(jobid, active := false) from cron.job where jobname = 'nav-utkorg';

-- -----------------------------------------------------------------------------
-- 15. Vakter
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
  n int;
begin
  foreach t in array array['calendar_series','calendar_event','calendar_attendee','one_on_one_item',
                           'calendar_reminder','integration_log','outbox','calendar_undo'] loop
    if not exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace
                   where s.nspname = 'public' and c.relname = t and c.relrowsecurity) then
      raise exception '% saknar row level security', t;
    end if;
    select count(*) into n from pg_policies
     where schemaname = 'public' and tablename = t and cmd <> 'SELECT';
    if n > 0 then
      raise exception '% har % skrivpolicy(er) — skrivning ska gå via service role', t, n;
    end if;
  end loop;

  foreach t in array array['lk_skapa_mote','lk_svara','lk_foresla','lk_besluta_forslag','lk_flytta',
                           'lk_stall_in','lk_kopiera','lk_angra','lk_utkorg_ta','lk_utkorg_klar',
                           'lk_uppgiftspaminnelser','lk_notis','lk_ny_tid','lk_undo'] loop
    if exists (
      select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public' and p.proname = t
        and (has_function_privilege('authenticated', p.oid, 'execute')
             or has_function_privilege('anon', p.oid, 'execute'))
    ) then
      raise exception '% går att anropa utan service role', t;
    end if;
  end loop;

  if exists (select 1 from cron.job where jobname = 'nav-utkorg' and active) then
    raise exception 'nav-utkorg är påslaget — det ska vara av tills grenen mergats';
  end if;
end;
$$;
