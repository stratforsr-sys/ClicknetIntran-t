-- =============================================================================
-- 0202_kalender_serier_som_outlook.sql — Kalendern: ändra en serie som i
-- Outlook, "den här och följande" eller alla, med mönster och slutdatum
--
-- -----------------------------------------------------------------------------
-- VAD SOM BEHÖVS
-- -----------------------------------------------------------------------------
--
-- Beställaren 2026-10-22 (Kalendern som Outlook, fråga 2, öppen sedan
-- 2026-09-22): "ja, exakt som Outlook". En serie kunde bara flyttas i sin
-- helhet (lk_flytta_serie: tid och veckodag från i dag). Outlook låter
-- arrangören välja "den här och följande" eller alla, och ändra mönstret
-- (varje vardag, vecka, varannan vecka, månad), veckodagen, längden och
-- slutdatumet.
--
--   lk_andra_serie   som lk_flytta_serie, men med hela regeln. "Den här och
--                    följande" (p_fran_har) ändrar från förekomstens dag och
--                    flyttar seriens början dit, så att jobbet som fyller på
--                    serien (korKalendersteget) räknar det nya mönstret därifrån
--                    och de tidigare gångerna står kvar. Alla ändrar från i dag.
--                    Förekomsterna (p_dagar) räknas av rutten med samma regel
--                    som jobbet (forekomster). Undantag (avviker) står kvar.
--                    Deltagarna svarar igen och får notisen flyttad-serie.
--                    Rubriken (p_title, null = som förut) gäller serien, och
--                    de nya gångerna får den ändrade gångens plats, länk, Visa
--                    som och Privat (lk_fod_forekomster föder dem utan).
--   lk_angra         'flytta_serie' återställer nu hela regeln (mönster,
--                    intervall, början, slut och rubrik), inte bara tid, veckodag och
--                    längd. Ändringen sparas som 'flytta_serie', så
--                    calendar_undo:s villkor rörs inte. Resten av funktionen är
--                    ordagrant den som gäller (pg_proc 2026-10-22).
-- =============================================================================

create or replace function public.lk_andra_serie(
  p_aktor uuid, p_event uuid, p_fran_har boolean, p_tid time, p_minuter integer,
  p_monster text, p_intervall integer, p_veckodag integer, p_ends_on date,
  p_dagar date[], p_regeltext text, p_title text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_aktion uuid := gen_random_uuid();
  v_e      calendar_event;
  v_s      calendar_series;
  v_fran   date;
  v_start  date;
  v_fore   jsonb;
  v_ids    bigint[] := '{}';
  v_id     bigint;
  v_igen   uuid[] := '{}';
  v_forsta uuid;
  r        record;
begin
  select * into v_e from calendar_event where id = p_event;
  if not found or v_e.series_id is null then raise exception 'lk:finns_inte'; end if;
  select * into v_s from calendar_series where id = v_e.series_id for update;
  if not public.lk_far_andra(p_aktor, v_s.organizer_id) then raise exception 'lk:behorighet'; end if;
  if p_tid is null or extract(minute from p_tid)::int % 5 <> 0 then raise exception 'lk:ogiltig'; end if;
  if p_minuter is null or p_minuter < 5 or p_minuter > 480 then raise exception 'lk:ogiltig'; end if;
  if p_monster not in ('vardagar', 'veckovis', 'manadsvis') or p_intervall not in (1, 2) then raise exception 'lk:ogiltig'; end if;
  if p_monster = 'veckovis' and (p_veckodag is null or p_veckodag < 1 or p_veckodag > 5) then raise exception 'lk:vardag'; end if;
  -- En 1:1 är varje eller varannan vecka (som när den skapas).
  if v_s.kind = 'enskilt' and p_monster <> 'veckovis' then raise exception 'lk:ogiltig'; end if;

  -- Den här och följande: från förekomstens dag, eller den nya första dagen om den ligger före (som
  -- lk_flytta_serie), aldrig före i dag; seriens början blir den första nya förekomsten. Alla: från i dag,
  -- och början står kvar (varannan vecka räknas från den).
  v_fran := case when p_fran_har
                 then greatest(least(v_e.dag, coalesce((select min(d) from unnest(p_dagar) d), v_e.dag)), current_date)
                 else current_date end;
  v_start := case when p_fran_har
                  then coalesce((select min(d) from unnest(public.lk_giltiga_dagar(p_dagar, v_fran, p_ends_on)) d), v_fran)
                  else v_s.starts_on end;
  if p_ends_on is not null and p_ends_on < greatest(v_fran, v_start) then raise exception 'lk:ogiltig'; end if;

  v_fore := jsonb_build_object(
    'serie', to_jsonb(v_s),
    'fran', v_fran,
    'series_attendees', coalesce((select jsonb_agg(to_jsonb(a)) from calendar_attendee a where a.series_id = v_s.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e)) from calendar_event e
                        where e.series_id = v_s.id and e.dag >= v_fran and not e.avviker), '[]'::jsonb),
    'attendees', coalesce((select jsonb_agg(to_jsonb(a)) from calendar_attendee a
                           join calendar_event e on e.id = a.event_id
                           where e.series_id = v_s.id and e.dag >= v_fran and not e.avviker), '[]'::jsonb)
  );

  delete from calendar_event where series_id = v_s.id and dag >= v_fran and not avviker;

  update calendar_series
     set tid = p_tid,
         minuter = p_minuter,
         monster = p_monster,
         intervall = p_intervall,
         veckodag = case when p_monster = 'veckovis' then p_veckodag::smallint else null end,
         starts_on = v_start,
         ends_on = p_ends_on,
         title = coalesce(nullif(btrim(p_title), ''), title),
         updated_at = now()
   where id = v_s.id;

  update calendar_attendee
     set response = 'vantar', responded_at = null, response_note = null
   where series_id = v_s.id;

  perform public.lk_fod_forekomster(v_s.id, p_dagar, p_aktor);
  -- De nya gångerna får det den ändrade gången hade, som en ny serie i Outlook: plats, länk, Visa som och Privat.
  update calendar_event
     set plats = v_e.plats, online_url = v_e.online_url, show_as = v_e.show_as, is_private = v_e.is_private
   where series_id = v_s.id and dag >= v_fran and not avviker;
  v_forsta := public.lk_nasta_forekomst(v_s.id);

  for r in
    select a.employee_id from calendar_attendee a where a.series_id = v_s.id and a.employee_id is not null
    union
    select v_s.organizer_id
  loop
    if r.employee_id <> v_s.organizer_id and r.employee_id <> p_aktor then v_igen := v_igen || r.employee_id; end if;
    v_id := public.lk_notis(v_aktion, 'kalender-flyttad', 'flyttad-serie', r.employee_id, p_aktor, v_forsta,
      jsonb_build_object('regel', coalesce(p_regeltext, ''), 'tid', to_char(p_tid, 'HH24:MI'),
                         'svara_igen', r.employee_id <> v_s.organizer_id));
    if v_id is not null then v_ids := v_ids || v_id; end if;
  end loop;

  return jsonb_build_object(
    'series_id', v_s.id,
    'event_id', v_forsta,
    'svara_igen', to_jsonb(v_igen),
    'undo_id', public.lk_undo(null, v_s.id, 'flytta_serie', v_fore, v_ids, p_aktor)
  );
end;
$function$;

revoke all on function public.lk_andra_serie(uuid, uuid, boolean, time, integer, text, integer, integer, date, date[], text, text) from public, anon, authenticated;
grant execute on function public.lk_andra_serie(uuid, uuid, boolean, time, integer, text, integer, integer, date, date[], text, text) to service_role;

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
