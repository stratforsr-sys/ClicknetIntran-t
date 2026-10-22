-- =============================================================================
-- 0204_kalender_heldag.sql — Kalendern: heldagsmöten och möten över flera dagar
-- som i Outlook
--
-- -----------------------------------------------------------------------------
-- VAD SOM BEHÖVS
-- -----------------------------------------------------------------------------
--
-- Beställaren 2026-10-22 (Kalendern som Outlook, fråga 3): "nej, men kan vara
-- bra att ha med om Outlook har det". Outlook har båda. Utkastets formulär har
-- redan rutan Heldag, men lk_skapa_mote kräver ett klockslag och nekade.
--
-- calendar_event tillåter redan tid = null (då minuter får vara null), och
-- starts_at blir dagens början. Det som saknades:
--
--   calendar_event.slutdag   sista dagen för ett heldagsmöte över flera dagar
--                            (mässa, utbildning). Bara med tid = null, högst 31
--                            dagar. Null = en dag.
--   lk_skapa_heldag          som lk_skapa_mote, utan klockslag, med slutdag och
--                            Visa som. Också en lördag eller söndag.
--   lk_andra_heldag          ny dag eller dagar, till eller från heldag, för ett
--                            möte som inte är en serie: lk_ny_tid (deltagarna
--                            svarar igen, notisen flyttad, ics_sequence + 1) och
--                            slutdagen. Ångra som en flytt.
--   lk_angra                 en flytt eller ändring återställer också slutdag.
--                            Resten ordagrant 0202 (= pg_proc 2026-10-22).
--
-- En serie har fortfarande alltid ett klockslag.
-- =============================================================================

alter table public.calendar_event
  add column if not exists slutdag date;

alter table public.calendar_event
  add constraint calendar_event_slutdag_check
  check (slutdag is null or (tid is null and slutdag >= dag and slutdag <= dag + 31));

create or replace function public.lk_skapa_heldag(
  p_aktor uuid, p_title text, p_dag date, p_slutdag date, p_deltagare uuid[],
  p_plats text, p_online_url text, p_agenda text, p_show_as text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_aktion uuid := gen_random_uuid();
  v_event  uuid;
  v_ids    bigint[] := '{}';
  v_id     bigint;
  v_person uuid;
  v_alla   uuid[];
  v_slut   date := nullif(p_slutdag, p_dag);
begin
  if not public.lk_aktiv(p_aktor) then raise exception 'lk:behorighet'; end if;
  if p_title is null or length(btrim(p_title)) = 0 then raise exception 'lk:rubrik'; end if;
  if p_dag is null then raise exception 'lk:ogiltig'; end if;
  if v_slut is not null and (v_slut < p_dag or v_slut > p_dag + 31) then raise exception 'lk:ogiltig'; end if;
  if coalesce(p_show_as, 'upptagen') not in ('ledig', 'preliminar', 'upptagen', 'borta', 'annan') then raise exception 'lk:ogiltig'; end if;

  select coalesce(array_agg(distinct d), '{}') into v_alla
  from unnest(coalesce(p_deltagare, '{}')) d
  where d is not null and d <> p_aktor;
  if cardinality(v_alla) > 50 then raise exception 'lk:ogiltig'; end if;

  insert into calendar_event (kind, title, organizer_id, dag, tid, minuter, slutdag, show_as, plats, online_url,
                              agenda_md, reminder_min, created_by)
  values ('mote', btrim(p_title), p_aktor, p_dag, null, null, v_slut, coalesce(p_show_as, 'upptagen'),
          nullif(btrim(coalesce(p_plats, '')), ''), nullif(btrim(coalesce(p_online_url, '')), ''),
          coalesce(p_agenda, ''), 0, p_aktor)
  returning id into v_event;

  foreach v_person in array v_alla loop
    if not public.lk_aktiv(v_person) then raise exception 'lk:ogiltig'; end if;
    insert into calendar_attendee (event_id, employee_id) values (v_event, v_person);
    v_id := public.lk_notis(v_aktion, 'kalender-inbjudan', 'inbjudan', v_person, p_aktor, v_event, '{}'::jsonb);
    if v_id is not null then v_ids := v_ids || v_id; end if;
  end loop;

  return jsonb_build_object(
    'event_id', v_event,
    'undo_id', public.lk_undo(v_event, null, 'skapa', jsonb_build_object('skapad', v_event), v_ids, p_aktor),
    'deltagare', to_jsonb(v_alla)
  );
end;
$function$;

create or replace function public.lk_andra_heldag(
  p_aktor uuid, p_event uuid, p_dag date, p_slutdag date, p_tid time, p_minuter integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_aktion uuid := gen_random_uuid();
  v_e      calendar_event;
  v_fore   jsonb;
  v_ny     record;
  v_slut   date := case when p_tid is null then nullif(p_slutdag, p_dag) end;
begin
  select * into v_e from calendar_event where id = p_event for update;
  if not found then raise exception 'lk:finns_inte'; end if;
  if v_e.cancelled_at is not null then raise exception 'lk:installd'; end if;
  if not public.lk_far_andra(p_aktor, v_e.organizer_id) then raise exception 'lk:behorighet'; end if;
  if v_e.series_id is not null or v_e.kind <> 'mote' then raise exception 'lk:ogiltig'; end if;
  if p_dag is null then raise exception 'lk:ogiltig'; end if;
  if p_tid is null then
    if v_slut is not null and (v_slut < p_dag or v_slut > p_dag + 31) then raise exception 'lk:ogiltig'; end if;
  else
    if extract(isodow from p_dag) > 5 then raise exception 'lk:vardag'; end if;
    if p_minuter is null or p_minuter < 15 or p_minuter > 480 or extract(minute from p_tid)::int % 5 <> 0 then
      raise exception 'lk:ogiltig';
    end if;
  end if;
  if v_e.dag = p_dag and v_e.tid is not distinct from p_tid and v_e.minuter is not distinct from (case when p_tid is null then null else p_minuter end)
     and v_e.slutdag is not distinct from v_slut then
    raise exception 'lk:oforandrad';
  end if;

  v_fore := public.lk_lage(p_event);
  update calendar_event set slutdag = null where id = p_event;
  select * into v_ny from public.lk_ny_tid(v_aktion, p_aktor, p_event, p_dag, p_tid,
                                           case when p_tid is null then null else p_minuter end, '{}');
  update calendar_event set slutdag = v_slut where id = p_event;

  return jsonb_build_object(
    'event_id', p_event,
    'svara_igen', to_jsonb(v_ny.svara_igen),
    'undo_id', public.lk_undo(p_event, null, 'flytta', v_fore, v_ny.outbox_ids, p_aktor)
  );
end;
$function$;

revoke all on function public.lk_skapa_heldag(uuid, text, date, date, uuid[], text, text, text, text) from public, anon, authenticated;
grant execute on function public.lk_skapa_heldag(uuid, text, date, date, uuid[], text, text, text, text) to service_role;
revoke all on function public.lk_andra_heldag(uuid, uuid, date, date, time, integer) from public, anon, authenticated;
grant execute on function public.lk_andra_heldag(uuid, uuid, date, date, time, integer) to service_role;

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
       set (title, tid, veckodag, minuter, monster, intervall, starts_on, ends_on, updated_at)
         = (b.title, b.tid, b.veckodag, b.minuter, b.monster, b.intervall, b.starts_on, b.ends_on, now())
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
       set (title, dag, tid, minuter, slutdag, show_as, reminder_min, plats, online_url, agenda_md,
            avviker, cancelled_at, outcome, outcome_by, attempt, ics_sequence, updated_at)
         = (b.title, b.dag, b.tid, b.minuter, b.slutdag, b.show_as, b.reminder_min, b.plats, b.online_url, b.agenda_md,
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
