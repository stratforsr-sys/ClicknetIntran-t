-- 0088 · Kalendern: det Nav 2.0 har och navet saknade (2026-10-15)
--
-- =============================================================================
-- VARFÖR
--
-- Nav 2.0:s kalender låter organisatören ändra ett möte efteråt — rubrik,
-- plats, videolänk, agenda, deltagare, påminnelse och hur tiden visas — och
-- var och en välja sin egen påminnelse i förhandsvisningen. Navet kunde skapa,
-- flytta, ändra längd och ställa in, men inte ändra något annat, och
-- påminnelsen fanns bara per möte.
--
--   1. `calendar_attendee.reminder_min`: deltagarens egen påminnelse. Null
--      betyder mötets (`calendar_event.reminder_min`).
--   2. `lk_andra_mote`: ändringen i samma mönster som `lk_flytta` — lås,
--      behörighet (`lk_far_andra`), läget före i `calendar_undo`, och notiser
--      genom utkorgen. Nya deltagare får en inbjudan, borttagna att mötet är
--      inställt för dem, och de som är kvar mallen "andrad" (med .ics).
--   3. Ångra: handlingen `andra` tillåts, och `lk_angra` återställer också
--      rubriken. För alla andra handlingar är rubriken oförändrad, så det
--      ändrar inget för dem.
--
-- Beställaren 2026-10-15: ingen funktion i utkastet får försvinna.
-- =============================================================================

alter table public.calendar_attendee
  add column reminder_min integer check (reminder_min is null or reminder_min between 0 and 1440);

alter table public.calendar_undo drop constraint calendar_undo_handling_check;
alter table public.calendar_undo add constraint calendar_undo_handling_check
  check (handling = any (array['skapa', 'svara', 'foresla', 'besluta', 'flytta', 'stall_in', 'skapa_serie', 'flytta_serie',
                               'punkt', 'bocka', 'punkt_uppgift', 'ta_kund', 'utfall', 'crm', 'andra']));

CREATE OR REPLACE FUNCTION public.lk_angra(p_aktor uuid, p_undo uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
       set (title, dag, tid, minuter, show_as, reminder_min, plats, online_url, agenda_md,
            avviker, cancelled_at, outcome, outcome_by, attempt, ics_sequence, updated_at)
         = (b.title, b.dag, b.tid, b.minuter, b.show_as, b.reminder_min, b.plats, b.online_url, b.agenda_md,
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
$function$;

create function public.lk_andra_mote(
  p_aktor uuid,
  p_event uuid,
  p_title text,
  p_plats text,
  p_online_url text,
  p_agenda text,
  p_deltagare uuid[],
  p_reminder_min integer,
  p_show_as text
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
  v_kalla  text;
  v_alla   uuid[];
  v_nu     uuid[];
  v_person uuid;
begin
  select * into v_e from calendar_event where id = p_event for update;
  if not found then raise exception 'lk:finns_inte'; end if;
  if v_e.cancelled_at is not null then raise exception 'lk:installd'; end if;
  if v_e.kind <> 'mote' then raise exception 'lk:ogiltig'; end if;
  if not public.lk_far_andra(p_aktor, v_e.organizer_id) then raise exception 'lk:behorighet'; end if;
  if p_title is null or length(btrim(p_title)) = 0 then raise exception 'lk:rubrik'; end if;
  if p_reminder_min is not null and (p_reminder_min < 0 or p_reminder_min > 1440) then raise exception 'lk:ogiltig'; end if;
  if p_show_as is not null and p_show_as not in ('upptagen', 'preliminar', 'ledig', 'borta') then raise exception 'lk:ogiltig'; end if;

  select coalesce(array_agg(distinct d), '{}') into v_alla
  from unnest(coalesce(p_deltagare, '{}')) d
  where d is not null and d <> v_e.organizer_id;
  if cardinality(v_alla) > 50 then raise exception 'lk:ogiltig'; end if;

  v_fore := public.lk_lage(p_event);

  -- En serieförekomst har sina deltagare på serien. Ändringen gäller den här
  -- gången, så deltagarna kopieras till förekomsten först, som i lk_ny_tid.
  if v_e.series_id is not null then
    insert into calendar_attendee (event_id, employee_id, external_email, response)
    select p_event, n.employee_id, n.external_email, n.response
    from public.lk_narvaro(p_event) n
    where n.fran_serie;
  end if;

  select coalesce(array_agg(employee_id), '{}') into v_nu
  from calendar_attendee where event_id = p_event and employee_id is not null;

  update calendar_event
     set title = btrim(p_title),
         plats = nullif(btrim(coalesce(p_plats, '')), ''),
         online_url = nullif(btrim(coalesce(p_online_url, '')), ''),
         agenda_md = coalesce(p_agenda, ''),
         reminder_min = coalesce(p_reminder_min, reminder_min),
         show_as = coalesce(p_show_as, show_as),
         avviker = (series_id is not null) or avviker,
         ics_sequence = ics_sequence + 1,
         updated_at = now()
   where id = p_event;

  v_kalla := case when v_e.starts_at <= now() + interval '7 days' then 'kalender-flyttad' else 'kalender-flyttad-tyst' end;

  -- Borttagna: mötet är inställt för dem.
  foreach v_person in array v_nu loop
    if not (v_person = any(v_alla)) then
      delete from calendar_attendee where event_id = p_event and employee_id = v_person;
      v_id := public.lk_notis(v_aktion, 'kalender-installd', 'installd', v_person, p_aktor, p_event,
        jsonb_build_object('dag', v_e.dag, 'tid', to_char(v_e.tid, 'HH24:MI')));
      if v_id is not null then v_ids := v_ids || v_id; end if;
    end if;
  end loop;

  -- Nya: en inbjudan. Kvar: att mötet är ändrat.
  foreach v_person in array v_alla loop
    if not (v_person = any(v_nu)) then
      if not public.lk_aktiv(v_person) then raise exception 'lk:ogiltig'; end if;
      insert into calendar_attendee (event_id, employee_id) values (p_event, v_person);
      v_id := public.lk_notis(v_aktion, 'kalender-inbjudan', 'inbjudan', v_person, p_aktor, p_event, '{}'::jsonb);
    else
      v_id := public.lk_notis(v_aktion, v_kalla, 'andrad', v_person, p_aktor, p_event, '{}'::jsonb);
    end if;
    if v_id is not null then v_ids := v_ids || v_id; end if;
  end loop;

  if v_e.organizer_id <> p_aktor then
    v_id := public.lk_notis(v_aktion, v_kalla, 'andrad', v_e.organizer_id, p_aktor, p_event, '{}'::jsonb);
    if v_id is not null then v_ids := v_ids || v_id; end if;
  end if;

  return jsonb_build_object(
    'event_id', p_event,
    'deltagare', to_jsonb(v_alla),
    'undo_id', public.lk_undo(p_event, null, 'andra', v_fore, v_ids, p_aktor)
  );
end;
$$;
revoke all on function public.lk_andra_mote(uuid, uuid, text, text, text, text, uuid[], integer, text) from public;
