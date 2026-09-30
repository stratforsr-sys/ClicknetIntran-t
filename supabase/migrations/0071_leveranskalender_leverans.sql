-- =============================================================================
-- 0071_leveranskalender_leverans.sql — Leveranskalendern, pass 3 av 4: leverans.
--
-- Numret är fråga till `schema_migrations` 2026-09-30: högst var 0070.
--
-- =============================================================================
-- LEVERANSEN STARTAR NÄR ORDERN GODKÄNNS — I DATABASEN, INTE I EN ACTION
--
-- SPEC säger "samma action skapar raden i delivery". Här är det samma
-- TRANSAKTION: en trigger på `sales_order` skriver kön i samma ögonblick som
-- `approved_at` sätts. Skälet är att ordern godkänns av main-koden fram till
-- merge. En rad som bara skrevs av den nya koden hade gett en kö som saknar
-- varje order som godkänts innan dess, och ingen hade sett att den var
-- ofullständig.
--
-- TRIGGERN FÅR ALDRIG FÄLLA EN ORDER. Allt i den ligger i ett eget block med
-- en undantagshanterare: går kön sönder blir det en varning i loggen, inte ett
-- godkännande som nekas mitt i en säljares månad.
--
-- Tilläggsorder (`is_addon`) ger ingen leverans — kunden finns redan.
--
-- =============================================================================
-- LEVERANSEN LÄSER INTE ORDERN
--
-- `sales_order_read` släpper fram säljaren och ordermänniskorna, inte
-- leveransen. Kön får därför det den behöver genom `leverans_kunder()`:
-- kund, paket, kontakt och överlämning, för dem som får se leveransen —
-- projektledare, leverans och säljchef — och för säljaren om hennes egna.
--
-- =============================================================================
-- RESEND OCH CRM GÅR GENOM UTKORGEN
--
-- En mejlpåminnelse är en rad i `calendar_reminder` och en rad i utkorgen
-- (`resend_schedule`). Flyttas posten flyttas påminnelsen (`resend_patch`),
-- ställs den in eller blir den klar avbokas den (`resend_cancel`). Allt i
-- samma transaktion som ändringen, och allt ångrabart inom fönstret.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tabellerna — tunna, eftersom produktionen bor i CRM:et
-- -----------------------------------------------------------------------------

create table if not exists delivery (
  order_id        uuid primary key references sales_order(id) on delete cascade,
  owner_id        uuid references employee(id),       -- null = i kön
  welcome_due_at  timestamptz not null,
  crm_system      text,
  crm_external_id text check (crm_external_id is null or length(crm_external_id) between 1 and 80),
  crm_synced_at   timestamptz,
  crm_attempts    smallint not null default 0,
  crm_error       text,
  created_at      timestamptz not null default now()
);
create index if not exists delivery_ko_idx on delivery (welcome_due_at) where owner_id is null;

create table if not exists delivery_handoff (
  order_id      uuid primary key references sales_order(id) on delete cascade,
  customer_goal text not null default '' check (length(customer_goal) <= 600),
  promised      text not null default '' check (length(promised) <= 600),
  best_time     text check (best_time is null or length(best_time) <= 120),
  risks         text not null default '' check (length(risks) <= 600),
  written_by    uuid not null references employee(id),
  written_at    timestamptz not null default now()
);

alter table calendar_undo drop constraint if exists calendar_undo_handling_check;
alter table calendar_undo add constraint calendar_undo_handling_check check (handling in (
  'skapa','svara','foresla','besluta','flytta','stall_in',
  'skapa_serie','flytta_serie','punkt','bocka','punkt_uppgift',
  'ta_kund','utfall','crm'
));

-- -----------------------------------------------------------------------------
-- 2. Vem som ser leveransen
-- -----------------------------------------------------------------------------

/** Projektledare, leverans och säljchef (SPEC avsnitt 8). */
create or replace function public.lk_leverans_krets()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_any_role(array['delivery','project_manager','sales_manager']);
$$;

/** Kretsen för en person, inte för den inloggade. För skrivfunktionerna. */
create or replace function public.lk_i_leverans(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from employee_role r join employee e on e.id = r.employee_id
    where r.employee_id = p_employee and e.status <> 'offboarded'
      and r.role in ('delivery','project_manager','sales_manager')
  );
$$;

/** Den inloggade får se ordern i leveransen: kretsen, eller säljaren själv. */
create or replace function public.lk_ser_leverans(p_order uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.lk_leverans_krets()
      or exists (select 1 from sales_order o where o.id = p_order and o.salesperson_id = public.current_employee_id());
$$;

alter table delivery enable row level security;
alter table delivery_handoff enable row level security;

drop policy if exists delivery_read on delivery;
create policy delivery_read on delivery for select to authenticated using (public.lk_ser_leverans(order_id));
drop policy if exists delivery_handoff_read on delivery_handoff;
create policy delivery_handoff_read on delivery_handoff for select to authenticated using (public.lk_ser_leverans(order_id));

/**
 * Kunderna i leveransen, med det kön och panelen behöver. En rad per order
 * med en `delivery`-rad; `p_order` null = alla som läsaren får se.
 */
create or replace function public.leverans_kunder(p_order uuid)
returns table (
  order_id        uuid,
  kund            text,
  paket           text,
  pris            numeric,
  loptid          smallint,
  saljare         uuid,
  kontakt         text,
  telefon         text,
  epost           text,
  godkand         timestamptz,
  welcome_due_at  timestamptz,
  owner_id        uuid,
  crm_system      text,
  crm_external_id text,
  crm_synced_at   timestamptz,
  crm_error       text,
  mal             text,
  lovat           text,
  basta_tid       text,
  risker          text,
  makulerad       boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.id, o.company_name, p.label, coalesce(o.monthly_amount, p.list_price), o.term_months,
         o.salesperson_id, o.contact_name, coalesce(o.contact_phone_e164, o.contact_phone), o.contact_email,
         o.approved_at, d.welcome_due_at, d.owner_id, d.crm_system, d.crm_external_id, d.crm_synced_at, d.crm_error,
         h.customer_goal, h.promised, h.best_time, h.risks, o.status = 'makulerad'
  from delivery d
  join sales_order o on o.id = d.order_id
  left join sales_package p on p.id = o.package_id
  left join delivery_handoff h on h.order_id = d.order_id
  where (p_order is null or d.order_id = p_order)
    and (public.lk_leverans_krets() or o.salesperson_id = public.current_employee_id());
$$;

-- -----------------------------------------------------------------------------
-- 3. Tjugofyra vardagstimmar
--
-- Fredag 14:00 + 24 h = måndag 14:00. Räknat i svensk väggtid: helgens
-- timmar räknas inte, och en order godkänd en lördag börjar räknas måndag 00:00.
-- -----------------------------------------------------------------------------

create or replace function public.lk_vardagstimmar(p_fran timestamptz, p_timmar int)
returns timestamptz
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_t    timestamp := p_fran at time zone 'Europe/Stockholm';
  v_kvar interval := make_interval(hours => p_timmar);
  v_dygn timestamp;
begin
  loop
    while extract(isodow from v_t) > 5 loop
      v_t := date_trunc('day', v_t) + interval '1 day';
    end loop;
    v_dygn := date_trunc('day', v_t) + interval '1 day';
    if v_t + v_kvar <= v_dygn then
      return (v_t + v_kvar) at time zone 'Europe/Stockholm';
    end if;
    v_kvar := v_kvar - (v_dygn - v_t);
    v_t := v_dygn;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Ordern till kön, och ut ur den
-- -----------------------------------------------------------------------------

create or replace function public.lk_order_till_leverans()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_d delivery;
  r   record;
begin
  begin
    -- Godkänd nu, och inte förut.
    if new.approved_at is not null
       and (tg_op = 'INSERT' or old.approved_at is null)
       and not new.is_addon
       and new.status in ('signerad','betald') then
      insert into delivery (order_id, welcome_due_at)
      values (new.id, public.lk_vardagstimmar(new.approved_at, 24))
      on conflict (order_id) do nothing;

      for r in
        select distinct e.id from employee e join employee_role ro on ro.employee_id = e.id
        where ro.role in ('delivery','project_manager') and e.status <> 'offboarded'
      loop
        insert into outbox (kind, payload, idempotency_key, not_before)
        values ('notis',
                jsonb_build_object('kalla','leverans-ny','mall','leverans-ny','till',r.id,'av',new.approved_by,
                                   'order_id',new.id,'data','{}'::jsonb),
                'leverans-ny:' || new.id::text || ':' || r.id::text, now())
        on conflict (idempotency_key) do nothing;
      end loop;
    end if;

    -- Makulerad: ut ur kön. Är välkomstsamtalet bokat får den ansvariga veta.
    if tg_op = 'UPDATE' and new.status = 'makulerad' and old.status <> 'makulerad' then
      select * into v_d from delivery where order_id = new.id;
      if found then
        if v_d.owner_id is null then
          delete from delivery where order_id = new.id;
        else
          insert into outbox (kind, payload, idempotency_key, not_before)
          values ('notis',
                  jsonb_build_object('kalla','leverans-makulerad','mall','leverans-makulerad','till',v_d.owner_id,
                                     'av',new.cancelled_by,'order_id',new.id,'data','{}'::jsonb),
                  'leverans-makulerad:' || new.id::text, now())
          on conflict (idempotency_key) do nothing;
        end if;
      end if;
    end if;
  exception when others then
    raise warning 'lk_order_till_leverans(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists sales_order_till_leverans on sales_order;
create trigger sales_order_till_leverans
  after insert or update of approved_at, status on sales_order
  for each row execute function public.lk_order_till_leverans();

-- -----------------------------------------------------------------------------
-- 5. Läsningen: leveransposter för kretsen, med detaljer
-- -----------------------------------------------------------------------------

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
        -- 0071: leveransposterna syns för leveransen och säljchefen.
        or (e.kind = 'leverans' and public.lk_i_leverans(p_viewer))
      )
  );
$$;

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
  v_lev    boolean := public.lk_i_leverans(v_viewer);
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
            or exists (select 1 from public.lk_narvaro(m.id) n where n.employee_id = v_viewer and n.response <> 'nej')
            or (m.kind = 'leverans' and v_lev))
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

-- -----------------------------------------------------------------------------
-- 6. Påminnelserna följer posten
-- -----------------------------------------------------------------------------

/** Läget före en ändring, nu med påminnelserna. */
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
      else coalesce((select jsonb_agg(to_jsonb(a)) from calendar_attendee a where a.series_id = e.series_id), '[]'::jsonb) end,
    'reminders', coalesce((select jsonb_agg(to_jsonb(r)) from calendar_reminder r where r.event_id = e.id), '[]'::jsonb)
  )
  from calendar_event e
  where e.id = p_event;
$$;

/**
 * Flytta påminnelserna till den nya tiden: en redan schemalagd flyttas hos
 * Resend, en som ännu inte schemalagts schemaläggs om den ligger inom 29 dagar
 * (resten tar dagtidsjobbet när de närmar sig). Returnerar utkorgens rader.
 */
create or replace function public.lk_paminnelser_flytta(p_aktion uuid, p_event uuid)
returns bigint[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids bigint[] := '{}';
  v_id  bigint;
  r     record;
begin
  update calendar_reminder c
     set send_at = e.starts_at - interval '30 minutes'
    from calendar_event e
   where c.event_id = e.id and e.id = p_event and c.status in ('vantar','schemalagd');

  for r in select * from calendar_reminder where event_id = p_event and status in ('vantar','schemalagd') loop
    if r.status = 'schemalagd' and r.resend_id is not null then
      insert into outbox (kind, payload, idempotency_key, event_id)
      values ('resend_patch', jsonb_build_object('reminder_id', r.id),
              p_aktion::text || ':patch:' || r.id::text, p_event)
      returning id into v_id;
      v_ids := v_ids || v_id;
    elsif r.send_at > now() and r.send_at <= now() + interval '29 days' then
      insert into outbox (kind, payload, idempotency_key, event_id)
      values ('resend_schedule', jsonb_build_object('reminder_id', r.id),
              'resend:' || r.id::text || ':' || r.send_at::text, p_event)
      on conflict (idempotency_key) do nothing
      returning id into v_id;
      if v_id is not null then v_ids := v_ids || v_id; end if;
    end if;
  end loop;
  return v_ids;
end;
$$;

/** Avboka påminnelserna: inställt eller klart. */
create or replace function public.lk_paminnelser_avboka(p_aktion uuid, p_event uuid)
returns bigint[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids bigint[] := '{}';
  v_id  bigint;
  r     record;
begin
  for r in select * from calendar_reminder where event_id = p_event and status in ('vantar','schemalagd') loop
    if r.status = 'schemalagd' and r.resend_id is not null and r.send_at > now() then
      insert into outbox (kind, payload, idempotency_key, event_id)
      values ('resend_cancel', jsonb_build_object('reminder_id', r.id),
              p_aktion::text || ':cancel:' || r.id::text, p_event)
      returning id into v_id;
      v_ids := v_ids || v_id;
    else
      update calendar_reminder set status = 'avbokad' where id = r.id;
    end if;
  end loop;
  return v_ids;
end;
$$;

/**
 * 0069:s nya tid, med påminnelserna (0071). Samma svarsregler som förut; den
 * enda skillnaden är sista steget, där mejlpåminnelsen följer med posten.
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
    if not (r.employee_id = any(coalesce(p_behall, '{}'))) then
      v_id := public.lk_notis(p_aktion, v_kalla, 'flyttad', r.employee_id, p_aktor, p_event,
        jsonb_build_object('dag', p_dag, 'tid', to_char(p_tid, 'HH24:MI'), 'minuter', p_minuter,
                           'svara_igen', true, 'forekomst', v_e.series_id is not null));
      if v_id is not null then v_ids := v_ids || v_id; end if;
    end if;
  end loop;

  if v_e.organizer_id <> p_aktor then
    v_id := public.lk_notis(p_aktion, v_kalla, 'flyttad', v_e.organizer_id, p_aktor, p_event,
      jsonb_build_object('dag', p_dag, 'tid', to_char(p_tid, 'HH24:MI'), 'minuter', p_minuter,
                         'svara_igen', false, 'forekomst', v_e.series_id is not null));
    if v_id is not null then v_ids := v_ids || v_id; end if;
  end if;

  v_ids := v_ids || public.lk_paminnelser_flytta(p_aktion, p_event);

  outbox_ids := v_ids;
  svara_igen := v_igen;
  return next;
end;
$$;

/** Ställ in, med avbokning av påminnelserna (0071). */
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

  v_ids := v_ids || public.lk_paminnelser_avboka(v_aktion, p_event);

  return jsonb_build_object(
    'event_id', p_event,
    'mottagare', to_jsonb(v_till),
    'paminnelse', exists (select 1 from calendar_reminder where event_id = p_event and channel = 'mejl'),
    'undo_id', public.lk_undo(p_event, null, 'stall_in', v_fore, v_ids, p_aktor)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Leveransens handlingar
-- -----------------------------------------------------------------------------

/** Rubriken på en leveranspost: "Välkomstsamtal 2 · Kvarnens Bageri". */
create or replace function public.lk_leveransrubrik(p_step text, p_attempt int, p_order uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select left(
    case p_step
      when 'valkomstsamtal' then 'Välkomstsamtal'
      when 'tillgangar' then 'Tillgångar'
      when 'kickoff' then 'Kickoff'
      when 'leveransstart' then 'Leveransstart'
      when 'avstamning_30' then '30-dagarsavstämning'
      when 'avstamning_90' then '90-dagarsgenomgång'
    end
    || case when coalesce(p_attempt, 1) > 1 then ' ' || p_attempt else '' end
    || ' · ' || coalesce((select company_name from sales_order where id = p_order), 'kund'),
    200);
$$;

/** Mejlpåminnelser 30 min före, och deras rader i utkorgen. */
create or replace function public.lk_paminnelser_skapa(p_event uuid, p_mig boolean, p_kund boolean)
returns bigint[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_e   calendar_event;
  v_ids bigint[] := '{}';
  v_id  bigint;
  r     record;
begin
  select * into v_e from calendar_event where id = p_event;
  if v_e.tid is null then return v_ids; end if;
  if coalesce(p_mig, false) then
    insert into calendar_reminder (event_id, channel, recipient, send_at)
    values (p_event, 'mejl', 'ansvarig', v_e.starts_at - interval '30 minutes')
    on conflict (event_id, channel, recipient) do nothing;
  end if;
  if coalesce(p_kund, false)
     and exists (select 1 from sales_order o where o.id = v_e.order_id and o.contact_email is not null) then
    insert into calendar_reminder (event_id, channel, recipient, send_at)
    values (p_event, 'mejl', 'kund', v_e.starts_at - interval '30 minutes')
    on conflict (event_id, channel, recipient) do nothing;
  end if;
  for r in select * from calendar_reminder where event_id = p_event and status = 'vantar'
                                            and send_at > now() and send_at <= now() + interval '29 days' loop
    insert into outbox (kind, payload, idempotency_key, event_id)
    values ('resend_schedule', jsonb_build_object('reminder_id', r.id),
            'resend:' || r.id::text || ':' || r.send_at::text, p_event)
    on conflict (idempotency_key) do nothing
    returning id into v_id;
    if v_id is not null then v_ids := v_ids || v_id; end if;
  end loop;
  return v_ids;
end;
$$;

/**
 * En leveranspost: någon av de sex förinställningarna, på en kund som redan
 * har en ansvarig. Kickoff bjuder in kunden (externt, .ics i pass 4).
 */
create or replace function public.lk_skapa_leverans(
  p_aktor uuid, p_organizer uuid, p_order uuid, p_step text, p_dag date, p_tid time, p_minuter int,
  p_deltagare uuid[], p_rem_mig boolean, p_rem_kund boolean
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
  v_epost  text;
begin
  if not public.lk_i_leverans(p_aktor) or not public.lk_far_andra(p_aktor, p_organizer) then
    raise exception 'lk:behorighet';
  end if;
  if not exists (select 1 from delivery where order_id = p_order) then raise exception 'lk:finns_inte'; end if;
  if p_step not in ('valkomstsamtal','tillgangar','kickoff','leveransstart','avstamning_30','avstamning_90') then
    raise exception 'lk:ogiltig';
  end if;
  if p_dag is null or p_tid is null or extract(isodow from p_dag) > 5 then raise exception 'lk:vardag'; end if;
  if p_minuter is null or p_minuter < 15 or p_minuter > 480 then raise exception 'lk:ogiltig'; end if;

  insert into calendar_event (kind, title, organizer_id, dag, tid, minuter, order_id, step, created_by)
  values ('leverans', public.lk_leveransrubrik(p_step, 1, p_order), p_organizer, p_dag, p_tid, p_minuter,
          p_order, p_step, p_aktor)
  returning id into v_event;

  foreach v_person in array coalesce(p_deltagare, '{}') loop
    continue when v_person is null or v_person = p_organizer or not public.lk_aktiv(v_person);
    insert into calendar_attendee (event_id, employee_id) values (v_event, v_person) on conflict do nothing;
    v_id := public.lk_notis(v_aktion, 'kalender-inbjudan', 'inbjudan', v_person, p_aktor, v_event, '{}'::jsonb);
    if v_id is not null then v_ids := v_ids || v_id; end if;
  end loop;

  if p_step = 'kickoff' then
    select contact_email into v_epost from sales_order where id = p_order;
    if v_epost is not null then
      insert into calendar_attendee (event_id, external_email) values (v_event, v_epost) on conflict do nothing;
    end if;
  end if;

  v_ids := v_ids || public.lk_paminnelser_skapa(v_event, p_rem_mig, p_rem_kund);

  return jsonb_build_object(
    'event_id', v_event,
    'undo_id', public.lk_undo(v_event, null, 'skapa', jsonb_build_object('skapad', v_event), v_ids, p_aktor)
  );
end;
$$;

/**
 * En kund ur kön. `for update skip locked`: klickar två på samma kund i samma
 * sekund får den ena den och den andra beskedet att den är tagen.
 */
create or replace function public.lk_ta_kund(
  p_aktor uuid, p_order uuid, p_owner uuid, p_dag date, p_tid time, p_minuter int
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_aktion uuid := gen_random_uuid();
  v_d      delivery;
  v_event  uuid;
  v_ids    bigint[] := '{}';
  v_id     bigint;
  v_saljare uuid;
begin
  if not public.lk_i_leverans(p_aktor) then raise exception 'lk:behorighet'; end if;
  if not public.lk_aktiv(p_owner) or not exists (
    select 1 from employee_role where employee_id = p_owner and role in ('delivery','project_manager','sales_manager')
  ) then
    raise exception 'lk:ogiltig';
  end if;
  if p_dag is null or p_tid is null or extract(isodow from p_dag) > 5 then raise exception 'lk:vardag'; end if;
  if coalesce(p_minuter, 30) < 15 or coalesce(p_minuter, 30) > 120 then raise exception 'lk:ogiltig'; end if;

  select * into v_d from delivery where order_id = p_order and owner_id is null for update skip locked;
  if not found then raise exception 'lk:tagen'; end if;

  update delivery set owner_id = p_owner where order_id = p_order;

  insert into calendar_event (kind, title, organizer_id, dag, tid, minuter, order_id, step, created_by)
  values ('leverans', public.lk_leveransrubrik('valkomstsamtal', 1, p_order), p_owner, p_dag, p_tid,
          coalesce(p_minuter, 30), p_order, 'valkomstsamtal', p_aktor)
  returning id into v_event;

  select salesperson_id into v_saljare from sales_order where id = p_order;
  v_id := public.lk_notis(v_aktion, 'leverans-bokad', 'leverans-bokad-agare', p_owner, p_aktor, v_event, '{}'::jsonb);
  if v_id is not null then v_ids := v_ids || v_id; end if;
  v_id := public.lk_notis(v_aktion, 'leverans-bokad', 'leverans-bokad-saljare', v_saljare, p_aktor, v_event,
                          jsonb_build_object('ansvarig', p_owner));
  if v_id is not null then v_ids := v_ids || v_id; end if;

  return jsonb_build_object(
    'event_id', v_event,
    'saljare', v_saljare,
    'undo_id', public.lk_undo(v_event, null, 'ta_kund', jsonb_build_object('order', p_order, 'skapad', v_event), v_ids, p_aktor)
  );
end;
$$;

/**
 * Utfallet. Sätts bara av en människa — ingen automatik (BYGGPROMPT §5).
 *
 * Nådd (`genomford`) avbokar påminnelserna och skickar, för välkomstsamtalet,
 * status "välkomnad" till CRM:et. Ångrabar.
 *
 * Ej svar bokar nästa försök på tiden klienten räknat fram (första lediga
 * 30 min minst 3 h senare, inom 5 dagar) — eller inget, efter tredje. Inte
 * ångrabart: nästa försök är en ny post som den ansvariga ser direkt.
 */
create or replace function public.lk_satt_utfall(
  p_aktor uuid, p_event uuid, p_utfall text, p_nasta_dag date, p_nasta_tid time
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
  v_ids    bigint[] := '{}';
  v_id     bigint;
  v_nasta  uuid;
begin
  if p_utfall not in ('genomford','ej_svar') then raise exception 'lk:ogiltig'; end if;
  select * into v_e from calendar_event where id = p_event for update;
  if not found or v_e.kind <> 'leverans' then raise exception 'lk:finns_inte'; end if;
  if v_e.cancelled_at is not null then raise exception 'lk:installd'; end if;
  if v_e.outcome is not null then raise exception 'lk:oforandrad'; end if;
  if not public.lk_far_andra(p_aktor, v_e.organizer_id) then raise exception 'lk:behorighet'; end if;

  v_fore := public.lk_lage(p_event);
  update calendar_event set outcome = p_utfall, outcome_by = p_aktor, updated_at = now() where id = p_event;
  v_ids := public.lk_paminnelser_avboka(v_aktion, p_event);

  if p_utfall = 'genomford' then
    if v_e.step = 'valkomstsamtal' then
      insert into outbox (kind, payload, idempotency_key, event_id)
      values ('crm', jsonb_build_object('order_id', v_e.order_id, 'status', 'valkomnad'),
              v_aktion::text || ':crm', p_event)
      returning id into v_id;
      v_ids := v_ids || v_id;
    end if;
    return jsonb_build_object(
      'event_id', p_event,
      'undo_id', public.lk_undo(p_event, null, 'utfall', v_fore, v_ids, p_aktor)
    );
  end if;

  if v_e.attempt < 3 and p_nasta_dag is not null and p_nasta_tid is not null then
    if extract(isodow from p_nasta_dag) > 5 then raise exception 'lk:vardag'; end if;
    insert into calendar_event (kind, title, organizer_id, dag, tid, minuter, order_id, step, attempt, created_by)
    values ('leverans', public.lk_leveransrubrik(v_e.step, v_e.attempt + 1, v_e.order_id), v_e.organizer_id,
            p_nasta_dag, p_nasta_tid, 30, v_e.order_id, v_e.step, v_e.attempt + 1, p_aktor)
    returning id into v_nasta;
  end if;

  return jsonb_build_object('event_id', p_event, 'nasta', v_nasta, 'forsok', v_e.attempt + 1);
end;
$$;

/** Be säljaren komplettera överlämningen. Notis och mejl. */
create or replace function public.lk_begar_komplettering(p_aktor uuid, p_order uuid, p_saknas text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_saljare uuid;
begin
  if not public.lk_i_leverans(p_aktor) then raise exception 'lk:behorighet'; end if;
  select salesperson_id into v_saljare from sales_order where id = p_order;
  if not found or not exists (select 1 from delivery where order_id = p_order) then raise exception 'lk:finns_inte'; end if;
  perform public.lk_notis(gen_random_uuid(), 'leverans-komplettera', 'leverans-komplettera', v_saljare, p_aktor, null,
                          jsonb_build_object('order_id', p_order, 'saknas', left(coalesce(p_saknas, ''), 200)));
  return jsonb_build_object('saljare', v_saljare);
end;
$$;

/** Säljarens överlämning: mål, löfte, bästa tid och risker. */
create or replace function public.lk_spara_overlamning(
  p_aktor uuid, p_order uuid, p_mal text, p_lovat text, p_basta text, p_risker text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from sales_order o where o.id = p_order
      and (o.salesperson_id = p_aktor or public.lk_i_leverans(p_aktor))
  ) then
    raise exception 'lk:behorighet';
  end if;
  insert into delivery_handoff (order_id, customer_goal, promised, best_time, risks, written_by, written_at)
  values (p_order, left(btrim(coalesce(p_mal, '')), 600), left(btrim(coalesce(p_lovat, '')), 600),
          nullif(left(btrim(coalesce(p_basta, '')), 120), ''), left(btrim(coalesce(p_risker, '')), 600), p_aktor, now())
  on conflict (order_id) do update
     set customer_goal = excluded.customer_goal, promised = excluded.promised, best_time = excluded.best_time,
         risks = excluded.risks, written_by = excluded.written_by, written_at = now();
end;
$$;

/** Den manuella CRM-adaptern: kund-ID:t klistras in. Ångrabart. */
create or replace function public.lk_koppla_crm(p_aktor uuid, p_order uuid, p_externt text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_d delivery;
begin
  if not public.lk_i_leverans(p_aktor) then raise exception 'lk:behorighet'; end if;
  if p_externt is null or length(btrim(p_externt)) = 0 or length(btrim(p_externt)) > 80 then raise exception 'lk:ogiltig'; end if;
  select * into v_d from delivery where order_id = p_order for update;
  if not found then raise exception 'lk:finns_inte'; end if;

  update delivery
     set crm_system = 'manuell', crm_external_id = btrim(p_externt), crm_synced_at = now(),
         crm_attempts = 0, crm_error = null
   where order_id = p_order;
  insert into integration_log (system, direction, body)
  values ('crm', 'ut', jsonb_build_object('adapter', 'manuell', 'handling', 'koppla', 'order_id', p_order,
                                          'externt_id', btrim(p_externt), 'av', p_aktor));

  return jsonb_build_object(
    'undo_id', public.lk_undo(null, null, 'crm', jsonb_build_object('delivery', to_jsonb(v_d)), '{}', p_aktor)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Utkorgens och jobbens hjälpare
-- -----------------------------------------------------------------------------

/** Resend svarade: spara id och läge. */
create or replace function public.lk_resend_satt(p_reminder uuid, p_resend_id text, p_status text, p_fel text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update calendar_reminder
     set resend_id = coalesce(p_resend_id, resend_id),
         status = p_status,
         error = left(p_fel, 500)
   where id = p_reminder;
$$;

/** CRM-synken: lyckad, eller ett försök till. Tre misslyckade blir ett fel. */
create or replace function public.lk_crm_klar(p_order uuid, p_fel text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update delivery
     set crm_synced_at = case when p_fel is null then now() else crm_synced_at end,
         crm_attempts = case when p_fel is null then 0 else crm_attempts + 1 end,
         crm_error = left(p_fel, 500)
   where order_id = p_order;
$$;

/** Dagtidsjobbet: påminnelser som närmar sig 29 dagar schemaläggs. */
create or replace function public.lk_resend_att_schemalagga()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_antal int;
begin
  insert into outbox (kind, payload, idempotency_key, event_id, not_before)
  select 'resend_schedule', jsonb_build_object('reminder_id', r.id),
         'resend:' || r.id::text || ':' || r.send_at::text, r.event_id, now()
  from calendar_reminder r
  join calendar_event e on e.id = r.event_id
  where r.status = 'vantar' and r.channel = 'mejl'
    and e.cancelled_at is null and e.outcome is null
    and r.send_at > now() + interval '2 minutes'
    and r.send_at <= now() + interval '29 days'
  on conflict (idempotency_key) do nothing;
  get diagnostics v_antal = row_count;
  return v_antal;
end;
$$;

/** Dagtidsjobbet: 4 h kvar av fristen — leveransen och säljchefen, notis och mejl. En gång per kund. */
create or replace function public.lk_leverans_frister()
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
         jsonb_build_object('kalla','leverans-frist','mall','leverans-frist','till',p.id,'av',null,
                            'order_id',d.order_id,'data',jsonb_build_object('due', d.welcome_due_at)),
         'leverans-frist:' || d.order_id::text || ':' || p.id::text,
         now()
  from delivery d
  join sales_order o on o.id = d.order_id and o.status <> 'makulerad'
  cross join lateral (
    select distinct e.id from employee e join employee_role ro on ro.employee_id = e.id
    where ro.role in ('delivery','project_manager','sales_manager') and e.status <> 'offboarded'
  ) p
  where d.owner_id is null
    and d.welcome_due_at <= now() + interval '4 hours'
  on conflict (idempotency_key) do nothing;
  get diagnostics v_antal = row_count;
  return v_antal;
end;
$$;

/** Resends webhook: läget för ett mejl. Returnerar vem som ska få veta om en studs. */
create or replace function public.lk_resend_handelse(p_resend_id text, p_status text, p_fel text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r calendar_reminder;
  v_e calendar_event;
begin
  select * into v_r from calendar_reminder where resend_id = p_resend_id;
  if not found then return null; end if;
  update calendar_reminder set status = p_status, error = left(p_fel, 500) where id = v_r.id;
  select * into v_e from calendar_event where id = v_r.event_id;
  return jsonb_build_object('reminder_id', v_r.id, 'event_id', v_e.id, 'ansvarig', v_e.organizer_id,
                            'mottagare', v_r.recipient, 'order_id', v_e.order_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Ångra, med leveransens grenar och påminnelserna
-- -----------------------------------------------------------------------------

create or replace function public.lk_angra(p_aktor uuid, p_undo uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_u      calendar_undo;
  v_event  uuid;
  v_objekt text;
  v_typ    text := 'calendar_event';
  v_serie  uuid;
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
    v_objekt := v_event::text;
    delete from calendar_event where id = v_event;

  elsif v_u.handling = 'ta_kund' then
    v_event := (v_u.before ->> 'skapad')::uuid;
    v_objekt := v_u.before ->> 'order';
    v_typ := 'delivery';
    delete from calendar_event where id = v_event;
    update delivery set owner_id = null where order_id = (v_u.before ->> 'order')::uuid;

  elsif v_u.handling = 'crm' then
    v_objekt := v_u.before -> 'delivery' ->> 'order_id';
    v_typ := 'delivery';
    update delivery d
       set (crm_system, crm_external_id, crm_synced_at, crm_attempts, crm_error)
         = (b.crm_system, b.crm_external_id, b.crm_synced_at, b.crm_attempts, b.crm_error)
      from jsonb_populate_record(null::delivery, v_u.before -> 'delivery') b
     where d.order_id = b.order_id;

  elsif v_u.handling = 'skapa_serie' then
    v_serie := (v_u.before ->> 'skapad_serie')::uuid;
    v_objekt := v_serie::text;
    v_typ := 'calendar_series';
    delete from calendar_series where id = v_serie;

  elsif v_u.handling = 'flytta_serie' then
    v_serie := (v_u.before -> 'serie' ->> 'id')::uuid;
    v_objekt := v_serie::text;
    v_typ := 'calendar_series';
    update calendar_series s
       set (tid, veckodag, minuter, updated_at) = (b.tid, b.veckodag, b.minuter, now())
      from jsonb_populate_record(null::calendar_series, v_u.before -> 'serie') b
     where s.id = v_serie;
    delete from calendar_event
     where series_id = v_serie and dag >= (v_u.before ->> 'fran')::date and not avviker;
    insert into calendar_event
    select * from jsonb_populate_recordset(null::calendar_event, v_u.before -> 'events');
    insert into calendar_attendee
    select * from jsonb_populate_recordset(null::calendar_attendee, v_u.before -> 'attendees');
    delete from calendar_attendee where series_id = v_serie;
    insert into calendar_attendee
    select * from jsonb_populate_recordset(null::calendar_attendee, v_u.before -> 'series_attendees');

  elsif v_u.handling = 'punkt' then
    v_objekt := v_u.before ->> 'item';
    v_typ := 'one_on_one_item';
    delete from one_on_one_item where id = (v_u.before ->> 'item')::uuid;

  elsif v_u.handling = 'bocka' then
    v_objekt := v_u.before ->> 'item';
    v_typ := 'one_on_one_item';
    update one_on_one_item set done_at = (v_u.before ->> 'done_at')::timestamptz
     where id = (v_u.before ->> 'item')::uuid;

  elsif v_u.handling = 'punkt_uppgift' then
    v_objekt := v_u.before ->> 'item';
    v_typ := 'one_on_one_item';
    update one_on_one_item set task_id = null, done_at = (v_u.before ->> 'done_at')::timestamptz
     where id = (v_u.before ->> 'item')::uuid;
    delete from task where id = (v_u.before ->> 'task')::uuid;

  else
    -- Svar, förslag, beslut, flytt, inställt och utfall: läget före.
    v_event := (v_u.before -> 'event' ->> 'id')::uuid;
    v_objekt := v_event::text;

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

    if v_u.before ? 'reminders' and jsonb_typeof(v_u.before -> 'reminders') = 'array' then
      update calendar_reminder c
         set (send_at, status, resend_id, error) = (b.send_at, b.status, b.resend_id, b.error)
        from jsonb_populate_recordset(null::calendar_reminder, v_u.before -> 'reminders') b
       where c.id = b.id;
    end if;
  end if;

  insert into audit_log (actor_id, action, object_type, object_id, reason)
  values (p_aktor, 'calendar.undone', v_typ, v_objekt, 'Ångrad direkt efter ' || v_u.handling);

  return jsonb_build_object('event_id', v_event, 'series_id', v_serie, 'handling', v_u.handling);
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. Granter
-- -----------------------------------------------------------------------------

do $$
declare
  f text;
begin
  foreach f in array array[
    'lk_leverans_krets()',
    'lk_i_leverans(uuid)',
    'lk_ser_leverans(uuid)',
    'leverans_kunder(uuid)',
    'lk_vardagstimmar(timestamptz, int)',
    'lk_order_till_leverans()',
    'lk_ser_handelse(uuid, uuid)',
    'kalender_handelser(uuid, date, date)',
    'lk_lage(uuid)',
    'lk_paminnelser_flytta(uuid, uuid)',
    'lk_paminnelser_avboka(uuid, uuid)',
    'lk_ny_tid(uuid, uuid, uuid, date, time, int, uuid[])',
    'lk_stall_in(uuid, uuid)',
    'lk_leveransrubrik(text, int, uuid)',
    'lk_paminnelser_skapa(uuid, boolean, boolean)',
    'lk_skapa_leverans(uuid, uuid, uuid, text, date, time, int, uuid[], boolean, boolean)',
    'lk_ta_kund(uuid, uuid, uuid, date, time, int)',
    'lk_satt_utfall(uuid, uuid, text, date, time)',
    'lk_begar_komplettering(uuid, uuid, text)',
    'lk_spara_overlamning(uuid, uuid, text, text, text, text)',
    'lk_koppla_crm(uuid, uuid, text)',
    'lk_resend_satt(uuid, text, text, text)',
    'lk_crm_klar(uuid, text)',
    'lk_resend_att_schemalagga()',
    'lk_leverans_frister()',
    'lk_resend_handelse(text, text, text)',
    'lk_angra(uuid, uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;

-- Läsningen och policyernas hjälpare.
grant execute on function public.leverans_kunder(uuid) to authenticated;
grant execute on function public.kalender_handelser(uuid, date, date) to authenticated;
grant execute on function public.lk_ser_handelse(uuid, uuid) to authenticated;
grant execute on function public.lk_ser_leverans(uuid) to authenticated;
grant execute on function public.lk_leverans_krets() to authenticated;
grant execute on function public.lk_i_leverans(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 11. Vakter
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
  n int;
begin
  foreach t in array array['delivery','delivery_handoff'] loop
    if not exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace
                   where s.nspname = 'public' and c.relname = t and c.relrowsecurity) then
      raise exception '% saknar row level security', t;
    end if;
    select count(*) into n from pg_policies where schemaname = 'public' and tablename = t and cmd <> 'SELECT';
    if n > 0 then raise exception '% har skrivpolicy', t; end if;
  end loop;

  foreach t in array array['lk_skapa_leverans','lk_ta_kund','lk_satt_utfall','lk_begar_komplettering',
                           'lk_spara_overlamning','lk_koppla_crm','lk_resend_satt','lk_crm_klar',
                           'lk_resend_att_schemalagga','lk_leverans_frister','lk_resend_handelse','lk_angra',
                           'lk_ny_tid','lk_stall_in','lk_paminnelser_skapa'] loop
    if exists (
      select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public' and p.proname = t
        and (has_function_privilege('authenticated', p.oid, 'execute')
             or has_function_privilege('anon', p.oid, 'execute'))
    ) then
      raise exception '% går att anropa utan service role', t;
    end if;
  end loop;

  -- Fredag 14:00 + 24 vardagstimmar = måndag 14:00.
  if public.lk_vardagstimmar(timestamptz '2026-10-02 14:00 Europe/Stockholm', 24)
     <> timestamptz '2026-10-05 14:00 Europe/Stockholm' then
    raise exception 'lk_vardagstimmar räknar fel över helgen';
  end if;
end;
$$;
