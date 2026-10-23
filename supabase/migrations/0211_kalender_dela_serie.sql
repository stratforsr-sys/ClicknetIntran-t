-- =============================================================================
-- 0211_kalender_dela_serie.sql — Kalendern: "Den här och följande" delar
-- serien i två, som Outlook, så att inga möten försvinner
--
-- -----------------------------------------------------------------------------
-- VAD SOM VAR FEL (granskningen 2026-10-22, K2/E1, kritiskt)
-- -----------------------------------------------------------------------------
--
-- 0202:s "den här och följande" flyttade seriens starts_on till den första nya
-- gången. Gångerna före blev rader utan regel i samma serie. "Hela serien"
-- (alla) raderar sedan allt som inte avviker från i dag och föder om bara från
-- starts_on, så de gångerna försvann tyst. Exempel: torsdagar 09:00; "den här
-- och följande" 12 nov → 10:00; veckan efter "Hela serien" med ny rubrik →
-- 29 okt och 5 nov borta, och deltagarna fick bara "flyttade hela serien".
--
-- -----------------------------------------------------------------------------
-- VAD FILEN GÖR
-- -----------------------------------------------------------------------------
--
-- lk_andra_serie, samma signatur och samma svar {series_id, event_id,
-- svara_igen, undo_id}:
--
--   "Den här och följande" från en gång efter seriens början (p_fran_har och
--   v_fran > starts_on) delar serien som Outlook:
--     - den gamla serien slutar dagen före (ends_on = v_fran - 1); dess gångar
--       från v_fran tas bort, också undantagen (Outlook kastar dem),
--     - en ny serie skapas som kopia med den nya regeln, tiden, längden,
--       rubriken och slutet, och med den ändrade gångens plats, länk, Visa som
--       och Privat (0210: de ligger på serien och följer med varje ny gång),
--     - seriens deltagare kopieras till den nya serien och svarar igen,
--     - en 1:1:s öppna punkter och seriens bilagor (0201) flyttas till den nya
--       serien, eftersom den gamla har slutat,
--     - svaret bär den NYA seriens id, och notiserna gäller den nya serien.
--   Ångra (ångertypen dela_serie) tar bort den nya serien och återställer den
--   gamla och alla borttagna gångar med deras deltagare.
--
--   Utan delning ("Hela serien", eller "den här och följande" på seriens första
--   gång) är beteendet som i 0202, med en skillnad: plats, länk, Visa som och
--   Privat skrivs på serien (0210) i stället för på de nya gångerna efteråt.
--   Vid "Hela serien" flyttas starts_on aldrig.
--
-- lk_angra: dela_serie (ny); flytta_serie återställer också seriens
-- egenskaper (0210); det allmänna läget återställer också Privat (E17, och
-- lk_spara_mote i 0212 skriver Privat). Resten ordagrant pg_proc 2026-10-23.
--
-- calendar_undo_handling_check får dela_serie.
--
-- calendar_series.fortsatter_i pekar från den gamla delen till den nya. En
-- ändring av den gamla delen ("Hela serien" eller "den här och följande") kan
-- aldrig löpa in i den nya: slutet kläms till dagen före den nya delens början,
-- också när Slutar är tomt (granskningens efterkontroll, V1).
--
-- lk_flytta_serie (flyttbannerns "Hela serien") rörs inte: den flyttar aldrig
-- starts_on och har inte E1:s mönster, och gamla Navs actions på main räknar
-- dess förekomster från den dragna gången (E7 är ett eget fynd).
-- =============================================================================

alter table public.calendar_series
  add column if not exists fortsatter_i uuid references public.calendar_series (id) on delete set null;
comment on column public.calendar_series.fortsatter_i is
  'Den nya delen när "den här och följande" delade serien (0211). Den här delen slutar alltid före den.';

alter table public.calendar_undo drop constraint if exists calendar_undo_handling_check;
alter table public.calendar_undo add constraint calendar_undo_handling_check
  check (handling in ('skapa', 'svara', 'foresla', 'besluta', 'flytta', 'stall_in', 'skapa_serie', 'flytta_serie',
                      'punkt', 'bocka', 'punkt_uppgift', 'ta_kund', 'utfall', 'crm', 'andra', 'dela_serie'));

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
  v_aktion  uuid := gen_random_uuid();
  v_e       calendar_event;
  v_s       calendar_series;
  v_fran    date;
  v_start   date;
  v_dela    boolean;
  v_serie   uuid;
  v_slut    date := p_ends_on;
  v_nasta   date;
  v_fore    jsonb;
  v_punkter jsonb := '[]'::jsonb;
  v_bilagor jsonb := '[]'::jsonb;
  v_ids     bigint[] := '{}';
  v_id      bigint;
  v_igen    uuid[] := '{}';
  v_forsta  uuid;
  r         record;
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
  -- En del som redan delats slutar före sin efterföljare, också när Slutar är tomt.
  if v_s.fortsatter_i is not null then
    select starts_on into v_nasta from calendar_series where id = v_s.fortsatter_i;
    if found then v_slut := least(coalesce(v_slut, v_nasta - 1), v_nasta - 1); end if;
  end if;

  -- Den här och följande: från förekomstens dag, eller den nya första dagen om den ligger före, aldrig
  -- före i dag. Alla: från i dag, och början står kvar (varannan vecka räknas från den).
  v_fran := case when p_fran_har
                 then greatest(least(v_e.dag, coalesce((select min(d) from unnest(p_dagar) d), v_e.dag)), current_date)
                 else current_date end;
  v_start := case when p_fran_har
                  then coalesce((select min(d) from unnest(public.lk_giltiga_dagar(p_dagar, v_fran, v_slut)) d), v_fran)
                  else v_s.starts_on end;
  if v_slut is not null and v_slut < greatest(v_fran, v_start) then raise exception 'lk:ogiltig'; end if;
  v_dela := p_fran_har and v_fran > v_s.starts_on;

  if v_dela then
    -- Outlook: den gamla serien slutar dagen före, och resten blir en ny serie.
    v_fore := jsonb_build_object(
      'serie', to_jsonb(v_s),
      'fran', v_fran,
      'events', coalesce((select jsonb_agg(to_jsonb(e)) from calendar_event e
                          where e.series_id = v_s.id and e.dag >= v_fran), '[]'::jsonb),
      'attendees', coalesce((select jsonb_agg(to_jsonb(a)) from calendar_attendee a
                             join calendar_event e on e.id = a.event_id
                             where e.series_id = v_s.id and e.dag >= v_fran), '[]'::jsonb)
    );
    select coalesce(jsonb_agg(i.id), '[]'::jsonb) into v_punkter
      from one_on_one_item i
     where i.series_id = v_s.id and i.done_at is null and (i.for_dag is null or i.for_dag >= v_fran);
    select coalesce(jsonb_agg(b.id), '[]'::jsonb) into v_bilagor
      from calendar_attachment b where b.series_id = v_s.id;

    delete from calendar_event where series_id = v_s.id and dag >= v_fran;
    update calendar_series set ends_on = v_fran - 1, updated_at = now() where id = v_s.id;

    -- Kopian av serien (alla kolumner, också de som kommer senare), med den nya regeln.
    insert into calendar_series
    select (jsonb_populate_record(v_s, jsonb_build_object(
              'id', gen_random_uuid(),
              'title', coalesce(nullif(btrim(p_title), ''), v_s.title),
              'tid', p_tid,
              'minuter', p_minuter,
              'monster', p_monster,
              'intervall', p_intervall,
              'veckodag', case when p_monster = 'veckovis' then p_veckodag end,
              'starts_on', v_start,
              'ends_on', v_slut,
              'is_private', v_e.is_private,
              'plats', v_e.plats,
              'online_url', v_e.online_url,
              'show_as', v_e.show_as,
              'created_by', p_aktor,
              'created_at', now(),
              'updated_at', now()))).*
    returning id into v_serie;

    insert into calendar_attendee
    select (jsonb_populate_record(a, jsonb_build_object(
              'id', gen_random_uuid(),
              'series_id', v_serie,
              'response', 'vantar',
              'responded_at', null,
              'response_note', null,
              'created_at', now()))).*
    from calendar_attendee a
    where a.series_id = v_s.id;

    -- Den gamla delen pekar på den nya (den nya ärver den gamlas efterföljare genom kopian).
    update calendar_series set fortsatter_i = v_serie where id = v_s.id;
    update one_on_one_item set series_id = v_serie
     where id in (select x::uuid from jsonb_array_elements_text(v_punkter) x);
    update calendar_attachment set series_id = v_serie
     where id in (select x::uuid from jsonb_array_elements_text(v_bilagor) x);

    v_fore := v_fore || jsonb_build_object('ny_serie', v_serie, 'punkter', v_punkter, 'bilagor', v_bilagor);
  else
    v_serie := v_s.id;
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
           ends_on = v_slut,
           title = coalesce(nullif(btrim(p_title), ''), title),
           -- De nya gångerna får det den ändrade gången hade, som en ny serie i Outlook (0210: på serien).
           is_private = v_e.is_private,
           plats = v_e.plats,
           online_url = v_e.online_url,
           show_as = v_e.show_as,
           updated_at = now()
     where id = v_s.id;

    update calendar_attendee
       set response = 'vantar', responded_at = null, response_note = null
     where series_id = v_s.id;
  end if;

  perform public.lk_fod_forekomster(v_serie, p_dagar, p_aktor);
  v_forsta := public.lk_nasta_forekomst(v_serie);

  for r in
    select a.employee_id from calendar_attendee a where a.series_id = v_serie and a.employee_id is not null
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
    'series_id', v_serie,
    'event_id', v_forsta,
    'svara_igen', to_jsonb(v_igen),
    'undo_id', public.lk_undo(null, v_s.id, case when v_dela then 'dela_serie' else 'flytta_serie' end, v_fore, v_ids, p_aktor)
  );
end;
$function$;

revoke all on function public.lk_andra_serie(uuid, uuid, boolean, time, integer, text, integer, integer, date, date[], text, text) from public, anon, authenticated;
grant execute on function public.lk_andra_serie(uuid, uuid, boolean, time, integer, text, integer, integer, date, date[], text, text) to service_role;

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
            is_private, plats, online_url, show_as, fortsatter_i, updated_at)
         = (b.title, b.tid, b.veckodag, b.minuter, b.monster, b.intervall, b.starts_on, b.ends_on,
            coalesce(b.is_private, s.is_private), b.plats, b.online_url, b.show_as, b.fortsatter_i, now())
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
            is_private, plats, online_url, show_as, fortsatter_i, updated_at)
         = (b.title, b.tid, b.veckodag, b.minuter, b.monster, b.intervall, b.starts_on, b.ends_on,
            coalesce(b.is_private, s.is_private), b.plats, b.online_url, b.show_as, b.fortsatter_i, now())
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
            avviker, cancelled_at, outcome, outcome_by, attempt, ics_sequence, is_private, updated_at)
         = (b.title, b.dag, b.tid, b.minuter, b.slutdag, b.show_as, b.reminder_min, b.plats, b.online_url, b.agenda_md,
            b.avviker, b.cancelled_at, b.outcome, b.outcome_by, b.attempt, b.ics_sequence, coalesce(b.is_private, e.is_private), now())
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
