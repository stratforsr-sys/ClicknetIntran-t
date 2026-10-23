-- =============================================================================
-- 0213_kalender_ingen_paminnelse.sql — Kalendern: "Ingen påminnelse" gäller,
-- också för gångerna jobbet föder och efter Ångra
--
-- -----------------------------------------------------------------------------
-- VAD SOM VAR FEL (granskningen 2026-10-22, E3 och E4)
-- -----------------------------------------------------------------------------
--
-- "Ingen påminnelse" stängde inte av något. Ett nytt möte eller en serie med
-- "Ingen" sparades med 10 minuter, arrangörens "Ingen" i kortet blev 10, och
-- deltagarens "Ingen" (null) betydde "mötets". Pushen kom ändå, och kvittot
-- sa "Påminnelsen är avstängd." Formuläret för ett befintligt möte öppnades
-- dessutom med användarens förval och skrev om mötets påminnelse för alla vid
-- varje sparning (E3; rättat i klienten och i /nav2/kalender).
--
-- -----------------------------------------------------------------------------
-- VAD FILEN GÖR
-- -----------------------------------------------------------------------------
--
-- Kolumnerna kom i 0212 (calendar_event, calendar_attendee och calendar_series
-- .reminder_off), eftersom lk_spara_mote skriver dem. Här:
--
-- 1. lk_fod_forekomster sätter seriens reminder_off på varje ny gång (som
--    0210 gör med Privat, plats, länk och Visa som).
-- 2. lk_angra återställer reminder_off: mötets i det allmänna läget, och
--    seriens vid flytta_serie och dela_serie. Resten ordagrant 0211.
--
-- /nav2/kalender och repots actions (skapaMote, skapaSerie, sattPaminnelse)
-- skriver reminder_off när "Ingen" väljs, och motespaminnelser hoppar över
-- den (skaPaminna, src/lib/nav2/kalender-andring.ts). lk_skapa_mote och
-- lk_skapa_serie rörs inte: gamla Navs actions på main anropar dem med samma
-- argument, och "Visa som" skrivs redan efter funktionen på samma sätt.
-- =============================================================================

create or replace function public.lk_fod_forekomster(p_series uuid, p_dagar date[], p_aktor uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_s    calendar_series;
  v_antal int;
begin
  select * into v_s from calendar_series where id = p_series;
  insert into calendar_event (kind, title, organizer_id, dag, tid, minuter, reminder_min,
                              series_id, occurrence_of, created_by, agenda_md,
                              is_private, plats, online_url, show_as, reminder_off)
  select v_s.kind, v_s.title, v_s.organizer_id, d, v_s.tid, v_s.minuter, v_s.reminder_min,
         v_s.id, d, coalesce(p_aktor, v_s.created_by), '',
         v_s.is_private, v_s.plats, v_s.online_url, coalesce(v_s.show_as, 'upptagen'), v_s.reminder_off
  from unnest(public.lk_giltiga_dagar(p_dagar, greatest(v_s.starts_on, current_date), v_s.ends_on)) d
  on conflict (series_id, occurrence_of) do nothing;
  get diagnostics v_antal = row_count;
  return v_antal;
end;
$function$;

revoke all on function public.lk_fod_forekomster(uuid, date[], uuid) from public, anon, authenticated;
grant execute on function public.lk_fod_forekomster(uuid, date[], uuid) to service_role;

create or replace function public.lk_angra(p_aktor uuid, p_undo uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
