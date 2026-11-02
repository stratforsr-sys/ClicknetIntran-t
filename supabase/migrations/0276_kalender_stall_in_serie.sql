-- =============================================================================
-- 0276_kalender_stall_in_serie.sql — Kalendern: ställ in en återkommande
-- händelse som i Outlook, bara den här gången, den här och följande, eller
-- hela serien
--
-- -----------------------------------------------------------------------------
-- VAD SOM VAR FEL (beställaren 2026-11-02)
-- -----------------------------------------------------------------------------
--
-- "När jag ställer in en upprepande händelse så kan jag bara ställa in den
-- händelsen som jag väljer. Gör så att man kan välja att ställa in serien eller
-- bara den händelsen precis som Outlook."
--
-- lk_stall_in ställer in en gång. En serie gick bara att ställa in gång för
-- gång, med en notis och ett mejl per gång till varje deltagare, och jobbet
-- födde nya gångar åtta veckor fram så länge serien saknade slut.
--
-- -----------------------------------------------------------------------------
-- VAD FILEN GÖR
-- -----------------------------------------------------------------------------
--
-- lk_stall_in_serie(p_aktor, p_event, p_fran_har), samma behörighet som
-- lk_stall_in (arrangören eller hens ombud, lk_far_andra):
--
--   p_fran_har = true, "Den här och följande": gången och alla efter den i
--   seriens ordning (occurrence_of), och alla delar som 0211 delat av efter den
--   (fortsatter_i). Serien slutar dagen före gången.
--
--   p_fran_har = false, "Hela serien": allt som inte börjat än (svensk tid) i
--   hela kedjan, också delarna före. Det som redan varit står kvar, som när
--   Outlook ställer in en serie. Serien slutar i dag; dagens gång finns redan,
--   inställd eller kvar.
--
--   Gångarna ställs in som i lk_stall_in (cancelled_at, avviker, ics_sequence)
--   och deras påminnelser avbokas. Varje deltagare och arrangören får EN notis
--   (kalender-installd, mallen installd) med data.serie = 'har' | 'alla' och
--   första inställda gången, inte en per gång.
--
--   Seriens slut sätts så att jobbet inte föder fler. Slutet får inte ligga
--   före början (calendar_series_slut_efter_start), så en del som ställs in
--   helt slutar på sin första dag. Den gången föds nu om den saknas (en serie
--   som börjar längre fram än horisonten) och ställs in med de andra, annars
--   hade jobbet fött den senare.
--
--   Ångra (ångertypen stall_in_serie) i fem minuter, som de andra: gångarna,
--   påminnelserna och seriernas slut tillbaka, och de gångar som föddes bara
--   för att stängas tas bort.
--
-- Svaret: {event_id, series_id, fran, antal, mottagare, paminnelse, undo_id}.
--
-- calendar_undo_handling_check får stall_in_serie. lk_angra är den levande
-- definitionen ur pg_proc 2026-11-02 med en gren till; inget annat i den är
-- ändrat.
--
-- Bara service role kör funktionerna (rutten), som alla lk_*: revoke från
-- public, anon och authenticated, grant till service_role.
-- =============================================================================

alter table public.calendar_undo drop constraint if exists calendar_undo_handling_check;
alter table public.calendar_undo add constraint calendar_undo_handling_check
  check (handling = any (array['skapa', 'svara', 'foresla', 'besluta', 'flytta', 'stall_in', 'skapa_serie',
                               'flytta_serie', 'punkt', 'bocka', 'punkt_uppgift', 'ta_kund', 'utfall', 'crm',
                               'andra', 'dela_serie', 'stall_in_serie']));

create or replace function public.lk_stall_in_serie(p_aktor uuid, p_event uuid, p_fran_har boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_aktion uuid := gen_random_uuid();
  v_idag   date := (now() at time zone 'Europe/Stockholm')::date;
  v_e      calendar_event;
  v_s      calendar_series;
  v_del    calendar_series;
  v_slut   date;
  v_efter  uuid[] := '{}';
  v_fore   uuid[] := '{}';
  v_delar  uuid[];
  v_fodda  uuid[] := '{}';
  v_ev     uuid[] := '{}';
  v_ny     uuid;
  v_forsta calendar_event;
  v_antal  int;
  v_lage   jsonb;
  v_ids    bigint[] := '{}';
  v_id     bigint;
  v_till   uuid[] := '{}';
  x        uuid;
  r        record;
begin
  select * into v_e from calendar_event where id = p_event;
  if not found or v_e.series_id is null then raise exception 'lk:finns_inte'; end if;
  select * into v_s from calendar_series where id = v_e.series_id for update;
  if not public.lk_far_andra(p_aktor, v_s.organizer_id) then raise exception 'lk:behorighet'; end if;

  -- Delarna efter (0211, fortsatter_i framåt), och vid Hela serien också delarna före.
  with recursive fram(id) as (
    select v_s.fortsatter_i where v_s.fortsatter_i is not null
    union
    select s.fortsatter_i from calendar_series s join fram f on s.id = f.id where s.fortsatter_i is not null
  ) select coalesce(array_agg(id), '{}') into v_efter from fram;
  if not p_fran_har then
    with recursive bak(id) as (
      select s.id from calendar_series s where s.fortsatter_i = v_s.id
      union
      select s.id from calendar_series s join bak b on s.fortsatter_i = b.id
    ) select coalesce(array_agg(id), '{}') into v_fore from bak;
  end if;
  v_delar := array[v_s.id] || v_efter || v_fore;
  perform 1 from calendar_series where id = any(v_delar) for update;

  -- Läget före, för Ångra: seriernas slut innan något ändras.
  v_lage := jsonb_build_object(
    'serie', v_s.id,
    'serier', coalesce((select jsonb_agg(to_jsonb(s)) from calendar_series s where s.id = any(v_delar)), '[]'::jsonb)
  );

  -- Seriens slut, så att jobbet inte föder fler gångar.
  for v_del in select * from calendar_series where id = any(v_delar) loop
    v_slut := case when v_del.id = v_s.id and p_fran_har then v_e.occurrence_of - 1
                   when p_fran_har then v_del.starts_on - 1
                   else v_idag end;
    if v_slut < v_del.starts_on then
      -- Hela delen ställs in: den slutar på sin första dag, och den gången föds nu om den saknas.
      if not exists (select 1 from calendar_event where series_id = v_del.id and occurrence_of = v_del.starts_on) then
        perform public.lk_fod_forekomster(v_del.id, array[v_del.starts_on], p_aktor);
        select id into v_ny from calendar_event where series_id = v_del.id and occurrence_of = v_del.starts_on;
        if found then v_fodda := v_fodda || v_ny; end if;
      end if;
      update calendar_series set ends_on = starts_on, updated_at = now()
       where id = v_del.id and (ends_on is null or ends_on > starts_on);
    elsif v_del.ends_on is null or v_del.ends_on > v_slut then
      update calendar_series set ends_on = v_slut, updated_at = now() where id = v_del.id;
    end if;
  end loop;

  -- Gångarna som ställs in.
  select coalesce(array_agg(e.id), '{}') into v_ev
    from calendar_event e
   where e.cancelled_at is null
     and e.series_id = any(v_delar)
     and case when p_fran_har and e.series_id = v_s.id then e.occurrence_of >= v_e.occurrence_of
              when p_fran_har then true
              else e.dag > v_idag or (e.dag = v_idag and (e.tid is null or e.starts_at > now())) end;

  select count(*) into v_antal from unnest(v_ev) y(id) where not (y.id = any(v_fodda));
  if v_antal = 0 then raise exception 'lk:installd'; end if;
  select * into v_forsta from calendar_event
   where id = any(v_ev) and not (id = any(v_fodda))
   order by dag, tid nulls first limit 1;

  v_lage := v_lage || jsonb_build_object(
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'cancelled_at', e.cancelled_at,
                                                            'avviker', e.avviker, 'ics_sequence', e.ics_sequence))
                        from calendar_event e where e.id = any(v_ev)), '[]'::jsonb),
    'reminders', coalesce((select jsonb_agg(to_jsonb(c)) from calendar_reminder c where c.event_id = any(v_ev)), '[]'::jsonb),
    'fodda', to_jsonb(v_fodda)
  );

  update calendar_event
     set cancelled_at = now(),
         avviker = true,
         ics_sequence = ics_sequence + 1,
         updated_at = now()
   where id = any(v_ev);

  -- En notis per person, inte en per gång.
  for r in
    select n.employee_id
      from unnest(v_ev) y(id)
      cross join lateral public.lk_narvaro(y.id) n
     where n.employee_id is not null and not (y.id = any(v_fodda))
    union
    select v_s.organizer_id
  loop
    v_id := public.lk_notis(v_aktion, 'kalender-installd', 'installd', r.employee_id, p_aktor, v_forsta.id,
      jsonb_build_object('dag', v_forsta.dag, 'tid', to_char(v_forsta.tid, 'HH24:MI'),
                         'serie', case when p_fran_har then 'har' else 'alla' end, 'antal', v_antal));
    if v_id is not null then
      v_ids := v_ids || v_id;
      v_till := v_till || r.employee_id;
    end if;
  end loop;

  foreach x in array v_ev loop
    v_ids := v_ids || public.lk_paminnelser_avboka(v_aktion, x);
  end loop;

  return jsonb_build_object(
    'event_id', v_forsta.id,
    'series_id', v_s.id,
    'fran', v_forsta.dag,
    'antal', v_antal,
    'mottagare', to_jsonb(v_till),
    'paminnelse', exists (select 1 from calendar_reminder where event_id = any(v_ev) and channel = 'mejl'),
    'undo_id', public.lk_undo(v_forsta.id, v_s.id, 'stall_in_serie', v_lage, v_ids, p_aktor)
  );
end;
$function$;

revoke all on function public.lk_stall_in_serie(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.lk_stall_in_serie(uuid, uuid, boolean) to service_role;

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
       set (title, tid, veckodag, minuter, monster, intervall, starts_on, ends_on,
            is_private, plats, online_url, show_as, fortsatter_i, reminder_off, updated_at)
         = (b.title, b.tid, b.veckodag, b.minuter, b.monster, b.intervall, b.starts_on, b.ends_on,
            coalesce(b.is_private, s.is_private), b.plats, b.online_url, b.show_as, b.fortsatter_i, coalesce(b.reminder_off, s.reminder_off), now())
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

  elsif v_u.handling = 'dela_serie' then
    -- "Den här och följande" som delade serien (0211): den nya serien bort, den gamla som den var,
    -- och gångerna från delningen tillbaka, också undantagen. Öppna 1:1-punkter och seriens
    -- bilagor flyttas tillbaka innan den nya serien tas bort (de följer annars med i kaskaden).
    v_serie := (v_u.before -> 'serie' ->> 'id')::uuid;
    v_objekt := v_serie::text;
    v_typ := 'calendar_series';
    update one_on_one_item set series_id = v_serie
     where id in (select x::uuid from jsonb_array_elements_text(coalesce(v_u.before -> 'punkter', '[]'::jsonb)) x);
    update calendar_attachment set series_id = v_serie
     where id in (select x::uuid from jsonb_array_elements_text(coalesce(v_u.before -> 'bilagor', '[]'::jsonb)) x);
    delete from calendar_series where id = (v_u.before ->> 'ny_serie')::uuid;
    update calendar_series s
       set (title, tid, veckodag, minuter, monster, intervall, starts_on, ends_on,
            is_private, plats, online_url, show_as, fortsatter_i, reminder_off, updated_at)
         = (b.title, b.tid, b.veckodag, b.minuter, b.monster, b.intervall, b.starts_on, b.ends_on,
            coalesce(b.is_private, s.is_private), b.plats, b.online_url, b.show_as, b.fortsatter_i, coalesce(b.reminder_off, s.reminder_off), now())
      from jsonb_populate_record(null::calendar_series, v_u.before -> 'serie') b
     where s.id = v_serie;
    insert into calendar_event
    select * from jsonb_populate_recordset(null::calendar_event, v_u.before -> 'events');
    insert into calendar_attendee
    select * from jsonb_populate_recordset(null::calendar_attendee, v_u.before -> 'attendees');

  elsif v_u.handling = 'stall_in_serie' then
    -- En inställd serie (0276): gångarna och påminnelserna som de var, seriernas slut som de var, och de
    -- gångar som föddes bara för att stänga en hel del bort igen.
    v_serie := (v_u.before ->> 'serie')::uuid;
    v_objekt := v_serie::text;
    v_typ := 'calendar_series';
    update calendar_series s
       set ends_on = b.ends_on, updated_at = now()
      from jsonb_populate_recordset(null::calendar_series, v_u.before -> 'serier') b
     where s.id = b.id;
    update calendar_event e
       set cancelled_at = b.cancelled_at, avviker = b.avviker, ics_sequence = b.ics_sequence, updated_at = now()
      from jsonb_populate_recordset(null::calendar_event, v_u.before -> 'events') b
     where e.id = b.id;
    delete from calendar_event
     where id in (select x::uuid from jsonb_array_elements_text(coalesce(v_u.before -> 'fodda', '[]'::jsonb)) x);
    update calendar_reminder c
       set (send_at, status, resend_id, error) = (b.send_at, b.status, b.resend_id, b.error)
      from jsonb_populate_recordset(null::calendar_reminder, v_u.before -> 'reminders') b
     where c.id = b.id;

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
            avviker, cancelled_at, outcome, outcome_by, attempt, ics_sequence, is_private, reminder_off, updated_at)
         = (b.title, b.dag, b.tid, b.minuter, b.slutdag, b.show_as, b.reminder_min, b.plats, b.online_url, b.agenda_md,
            b.avviker, b.cancelled_at, b.outcome, b.outcome_by, b.attempt, b.ics_sequence, coalesce(b.is_private, e.is_private), coalesce(b.reminder_off, e.reminder_off), now())
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

revoke all on function public.lk_angra(uuid, uuid) from public, anon, authenticated;
grant execute on function public.lk_angra(uuid, uuid) to service_role;
