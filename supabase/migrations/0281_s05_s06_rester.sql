-- =============================================================================
-- 0281_s05_s06_rester.sql — Kalenderns och provisionens sista fynd ur
-- granskningen (S05 M2, M6, M7, E7 och S06 M7)
--
-- -----------------------------------------------------------------------------
-- VAD SOM VAR FEL (granskningen 2026-10-23, beställarens ja 2026-11-02:
-- "fixa allting")
-- -----------------------------------------------------------------------------
--
-- S05 M2. "Den här och följande" från en senare gång delar serien (0211) och
-- raderade alla gångar från delningen, också undantagen: gångar som ändrats
-- för sig. Gästerna på ett undantag fick inget inställt, och den som bara var
-- med på undantaget fick inget besked alls. Ångra lade tillbaka gångarna men
-- inte deras bilagor och påminnelser, som försvann i kaskaden.
--
-- S05 M6. Ett ombud som själv deltar och flyttar mötet ombads svara på sin
-- egen flytt (svaret nollställdes som allas). Ett ombud som bara ändrade
-- deltagarna gav arrangören inget besked.
--
-- S05 M7. lk_andra_serie räknade i dag som current_date, alltså UTC. Mellan
-- 00 och 02 svensk tid kunde en delning ta bort gårdagens gång.
--
-- E7. Flyttbannerns "Hela serien" (lk_flytta_serie) bytte veckodag för hela
-- serien men raderade bara från den dragna gången. Gångarna mellan i dag och
-- den stod kvar på den gamla veckodagen, och dagtidsjobbet födde den nya
-- bredvid dem: två möten i veckan, utan inbjudan.
--
-- S06 M7. ta_bort_ovrig_bonus (0215) prövade att månaden var öppen och
-- Fastställ stängde den, utan att låsa mot varandra. En borttagning samtidigt
-- med Fastställ kunde lägga motposten i en stängd månad.
--
-- -----------------------------------------------------------------------------
-- VAD FILEN GÖR
-- -----------------------------------------------------------------------------
--
-- lk_andra_serie: i dag i svensk tid. Vid delning ställs undantagen från
-- delningen in i stället för att raderas (cancelled_at, ics_sequence + 1, som
-- lk_stall_in): calendar_event_ics köar CANCEL till gästerna, påminnelserna
-- avbokas, och den som var med på ett undantag men inte i den nya serien får
-- en notis (installd). Ångerraden bär gångarnas bilagor och påminnelser och
-- undantagens läge före.
--
-- lk_angra (dela_serie): lägger tillbaka gångarnas bilagor och påminnelser och
-- tar tillbaka inställningen av undantagen med deras påminnelser. En ångerrad
-- från före 0281 saknar nycklarna och ångras som förut.
--
-- lk_flytta_serie: Hela serien gäller från i dag, som Hela serien i
-- lk_andra_serie. Rutten räknar gångarna från i dag (flyttaSerie).
--
-- lk_spara_mote: ombudets eget svar nollställs inte när hen flyttar mötet, och
-- arrangören får ett tyst besked (andrad, data.deltagare) när ombudet bara
-- ändrar deltagarna. Svaret bär skickat.arrangoren.
--
-- commission_period_stangs och ta_bort_ovrig_bonus tar samma lås på månaden
-- (pg_advisory_xact_lock) före sin prövning.
--
-- Alla funktionerna finns redan; CREATE OR REPLACE behåller rättigheterna, och
-- de sätts ändå om nedan som i 0215 och 0276. Texterna utgår från pg_proc
-- 2026-11-02 (efter 0278), inte från de gamla migrationsfilerna.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.lk_andra_serie(p_aktor uuid, p_event uuid, p_fran_har boolean, p_tid time without time zone, p_minuter integer, p_monster text, p_intervall integer, p_veckodag integer, p_ends_on date, p_dagar date[], p_regeltext text, p_title text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_aktion  uuid := gen_random_uuid();
  v_idag    date := (now() at time zone 'Europe/Stockholm')::date;
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
  v_undantag uuid[] := '{}';
  v_kvar    uuid[];
  v_und     uuid;
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
  -- före i dag. Alla: från i dag, och början står kvar (varannan vecka räknas från den). I dag är svensk
  -- tid (0281, S05 M7): med UTC-datumet kunde en delning 00–02 ta bort gårdagens gång.
  v_fran := case when p_fran_har
                 then greatest(least(v_e.dag, coalesce((select min(d) from unnest(p_dagar) d), v_e.dag)), v_idag)
                 else v_idag end;
  v_start := case when p_fran_har
                  then coalesce((select min(d) from unnest(public.lk_giltiga_dagar(p_dagar, v_fran, v_slut)) d), v_fran)
                  else v_s.starts_on end;
  if v_slut is not null and v_slut < greatest(v_fran, v_start) then raise exception 'lk:ogiltig'; end if;
  v_dela := p_fran_har and v_fran > v_s.starts_on;

  if v_dela then
    -- Outlook: den gamla serien slutar dagen före, och resten blir en ny serie.
    --
    -- Undantagen från delningen och framåt (gångar som ändrats för sig och inte är inställda) försvinner
    -- som i Outlook, men ställs in i stället för att raderas (0281, S05 M2): gästerna får CANCEL
    -- (calendar_event_ics), deras påminnelser avbokas, och den som bara var med på undantaget får en notis.
    -- Raderna står kvar inställda, så att Ångra kan ta tillbaka dem med bilagor och påminnelser.
    select coalesce(array_agg(e.id), '{}') into v_undantag
      from calendar_event e
     where e.series_id = v_s.id and e.dag >= v_fran and e.avviker and e.cancelled_at is null;
    select coalesce(array_agg(e.id), '{}') into v_kvar
      from calendar_event e
     where e.series_id = v_s.id and e.dag >= v_fran and not (e.id = any(v_undantag));

    v_fore := jsonb_build_object(
      'serie', to_jsonb(v_s),
      'fran', v_fran,
      'events', coalesce((select jsonb_agg(to_jsonb(e)) from calendar_event e
                          where e.id = any(v_kvar)), '[]'::jsonb),
      'attendees', coalesce((select jsonb_agg(to_jsonb(a)) from calendar_attendee a
                             where a.event_id = any(v_kvar)), '[]'::jsonb),
      -- Det som följer med gångarna i kaskaden när de raderas (0281): läggs tillbaka av Ångra.
      'gangbilagor', coalesce((select jsonb_agg(to_jsonb(b)) from calendar_attachment b
                               where b.event_id = any(v_kvar)), '[]'::jsonb),
      'gangpaminnelser', coalesce((select jsonb_agg(to_jsonb(c)) from calendar_reminder c
                                   where c.event_id = any(v_kvar)), '[]'::jsonb),
      -- Undantagen som ställs in, och deras påminnelser, som de var (som lk_stall_in_serie).
      'undantag', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'cancelled_at', e.cancelled_at,
                                                                'avviker', e.avviker, 'ics_sequence', e.ics_sequence))
                            from calendar_event e where e.id = any(v_undantag)), '[]'::jsonb),
      'reminders', coalesce((select jsonb_agg(to_jsonb(c)) from calendar_reminder c
                             where c.event_id = any(v_undantag)), '[]'::jsonb)
    );
    select coalesce(jsonb_agg(i.id), '[]'::jsonb) into v_punkter
      from one_on_one_item i
     where i.series_id = v_s.id and i.done_at is null and (i.for_dag is null or i.for_dag >= v_fran);
    select coalesce(jsonb_agg(b.id), '[]'::jsonb) into v_bilagor
      from calendar_attachment b where b.series_id = v_s.id;

    update calendar_event
       set cancelled_at = now(),
           ics_sequence = ics_sequence + 1,
           updated_at = now()
     where id = any(v_undantag);
    foreach v_und in array v_undantag loop
      v_ids := v_ids || public.lk_paminnelser_avboka(v_aktion, v_und);
    end loop;

    delete from calendar_event where id = any(v_kvar);
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

  -- Den som var med på ett inställt undantag men inte är med i den nya serien har inte fått något besked
  -- ovan: en notis (installd) om det första av dem (0281, S05 M2).
  for r in
    select distinct on (n.employee_id) n.employee_id, e.id, e.dag, e.tid
      from calendar_event e
      cross join lateral public.lk_narvaro(e.id) n
     where e.id = any(v_undantag)
       and n.employee_id is not null
       and n.employee_id <> v_s.organizer_id
       and not exists (select 1 from calendar_attendee a where a.series_id = v_serie and a.employee_id = n.employee_id)
     order by n.employee_id, e.dag, e.tid
  loop
    v_id := public.lk_notis(v_aktion, 'kalender-installd', 'installd', r.employee_id, p_aktor, r.id,
      jsonb_build_object('dag', r.dag, 'tid', to_char(r.tid, 'HH24:MI')));
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
    -- Sedan 0281 (S05 M2): gångarnas bilagor och påminnelser, som raderades med gångarna, och undantagen
    -- som ställdes in i stället för att raderas, med sina påminnelser. En ångerrad från före 0281 har inga
    -- av nycklarna; dess undantag finns i events.
    insert into calendar_attachment
    select * from jsonb_populate_recordset(null::calendar_attachment, coalesce(v_u.before -> 'gangbilagor', '[]'::jsonb));
    insert into calendar_reminder
    select * from jsonb_populate_recordset(null::calendar_reminder, coalesce(v_u.before -> 'gangpaminnelser', '[]'::jsonb));
    update calendar_event e
       set cancelled_at = b.cancelled_at, avviker = b.avviker, ics_sequence = b.ics_sequence, updated_at = now()
      from jsonb_populate_recordset(null::calendar_event, coalesce(v_u.before -> 'undantag', '[]'::jsonb)) b
     where e.id = b.id;
    update calendar_reminder c
       set (send_at, status, resend_id, error) = (b.send_at, b.status, b.resend_id, b.error)
      from jsonb_populate_recordset(null::calendar_reminder, coalesce(v_u.before -> 'reminders', '[]'::jsonb)) b
     where c.id = b.id;

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

CREATE OR REPLACE FUNCTION public.lk_flytta_serie(p_aktor uuid, p_event uuid, p_dag date, p_tid time without time zone, p_dagar date[], p_regeltext text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_aktion uuid := gen_random_uuid();
  v_idag   date := (now() at time zone 'Europe/Stockholm')::date;
  v_e      calendar_event;
  v_s      calendar_series;
  v_fran   date;
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
  if p_dag is null or p_tid is null or extract(isodow from p_dag) > 5 then raise exception 'lk:vardag'; end if;
  if extract(minute from p_tid)::int % 5 <> 0 then raise exception 'lk:ogiltig'; end if;

  -- Hela serien gäller från i dag (svensk tid), som Hela serien i lk_andra_serie (0281, granskningen E7).
  -- Förut från den dragna gången: veckodagen byttes för hela serien, men gångarna mellan i dag och den
  -- dragna stod kvar på den gamla, och jobbet födde den nya veckodagen bredvid dem.
  v_fran := v_idag;

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
         veckodag = case when monster = 'veckovis' then extract(isodow from p_dag)::smallint else veckodag end,
         updated_at = now()
   where id = v_s.id;

  update calendar_attendee
     set response = 'vantar', responded_at = null, response_note = null
   where series_id = v_s.id;

  perform public.lk_fod_forekomster(v_s.id, p_dagar, p_aktor);
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

CREATE OR REPLACE FUNCTION public.lk_spara_mote(p_aktor uuid, p_event uuid, p_dag date, p_tid time without time zone, p_minuter integer, p_title text, p_plats text, p_online_url text, p_agenda text, p_deltagare uuid[], p_valfria uuid[], p_reminder_min integer, p_reminder_off boolean, p_show_as text, p_privat boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_aktion   uuid := gen_random_uuid();
  v_e        calendar_event;
  v_fore     jsonb;
  v_ids      bigint[] := '{}';
  v_id       bigint;
  v_alla     uuid[];
  v_valfria  uuid[];
  v_nu       uuid[];
  v_valf_nu  uuid[];
  v_igen     uuid[] := '{}';
  v_person   uuid;
  v_min      integer;
  v_off      boolean;
  v_visa     text;
  v_priv     boolean;
  v_andrat   text[] := '{}';
  v_tid      boolean;
  v_plats    boolean;
  v_inneh    boolean;
  v_kalla    text;
  v_mall     text;
  v_data     jsonb;
  v_inbjudna int := 0;
  v_installd int := 0;
  v_besked   int := 0;
  v_arrangoren boolean := false;
begin
  select * into v_e from calendar_event where id = p_event for update;
  if not found then raise exception 'lk:finns_inte'; end if;
  if v_e.cancelled_at is not null then raise exception 'lk:installd'; end if;
  if v_e.kind <> 'mote' then raise exception 'lk:ogiltig'; end if;
  if not public.lk_far_andra(p_aktor, v_e.organizer_id) then raise exception 'lk:behorighet'; end if;
  if p_title is null or length(btrim(p_title)) = 0 then raise exception 'lk:rubrik'; end if;
  if length(btrim(p_title)) > 200 or length(coalesce(p_agenda, '')) > 4000 or length(btrim(coalesce(p_plats, ''))) > 200 then raise exception 'lk:ogiltig'; end if;
  if p_reminder_min is not null and (p_reminder_min < 0 or p_reminder_min > 1440) then raise exception 'lk:ogiltig'; end if;
  if p_show_as is not null and p_show_as not in ('upptagen', 'preliminar', 'ledig', 'borta', 'annan') then raise exception 'lk:ogiltig'; end if;
  if nullif(btrim(coalesce(p_online_url, '')), '') is not null and (btrim(p_online_url) !~ '^https://' or length(btrim(p_online_url)) > 500) then raise exception 'lk:ogiltig'; end if;
  -- Heldag har ingen tid här (lk_andra_heldag): ett möte med klockslag behåller ett, och tvärtom.
  if (p_tid is null) <> (v_e.tid is null) then raise exception 'lk:ogiltig'; end if;
  if p_tid is null and (p_dag is distinct from v_e.dag or p_minuter is not null) then raise exception 'lk:ogiltig'; end if;

  v_min  := coalesce(p_reminder_min, v_e.reminder_min);
  v_off  := coalesce(p_reminder_off, v_e.reminder_off);
  v_visa := coalesce(p_show_as, v_e.show_as);
  v_priv := coalesce(p_privat, v_e.is_private);

  select coalesce(array_agg(distinct d), '{}') into v_alla
  from unnest(coalesce(p_deltagare, '{}')) d
  where d is not null and d <> v_e.organizer_id;
  if cardinality(v_alla) > 50 then raise exception 'lk:ogiltig'; end if;
  select coalesce(array_agg(distinct d), '{}') into v_valfria
  from unnest(coalesce(p_valfria, '{}')) d
  where d = any(v_alla);

  -- Före: mötets deltagare, eller seriens när gången inte har egna (lk_narvaro).
  select coalesce(array_agg(distinct n.employee_id), '{}') into v_nu
  from public.lk_narvaro(p_event) n
  where n.employee_id is not null and n.employee_id <> v_e.organizer_id;
  select coalesce(array_agg(distinct n.employee_id), '{}') into v_valf_nu
  from public.lk_narvaro(p_event) n join calendar_attendee a on a.id = n.rad
  where n.employee_id is not null and coalesce(a.optional, false);

  v_tid   := p_dag is distinct from v_e.dag or p_tid is distinct from v_e.tid or p_minuter is distinct from v_e.minuter;
  v_plats := coalesce(btrim(p_plats), '') <> coalesce(btrim(v_e.plats), '')
          or coalesce(btrim(p_online_url), '') <> coalesce(btrim(v_e.online_url), '');
  v_inneh := btrim(p_title) <> btrim(v_e.title) or coalesce(p_agenda, '') <> coalesce(v_e.agenda_md, '');
  if v_tid then v_andrat := v_andrat || 'tid'::text; end if;
  if v_plats then v_andrat := v_andrat || 'plats'::text; end if;
  if v_inneh then v_andrat := v_andrat || 'innehall'::text; end if;
  if not (v_nu @> v_alla and v_alla @> v_nu) then v_andrat := v_andrat || 'deltagare'::text; end if;
  if not (v_valf_nu @> v_valfria and v_valfria @> v_valf_nu) then v_andrat := v_andrat || 'valfria'::text; end if;
  if v_off <> v_e.reminder_off or (not v_off and v_min is distinct from v_e.reminder_min) then v_andrat := v_andrat || 'paminnelse'::text; end if;
  if v_visa <> v_e.show_as then v_andrat := v_andrat || 'visa'::text; end if;
  if v_priv <> v_e.is_private then v_andrat := v_andrat || 'privat'::text; end if;

  if cardinality(v_andrat) = 0 then
    return jsonb_build_object('event_id', p_event, 'undo_id', null, 'andrat', '[]'::jsonb, 'skickat', '{}'::jsonb);
  end if;

  if v_tid then
    if extract(isodow from p_dag) > 5 then raise exception 'lk:vardag'; end if;
    if extract(minute from p_tid)::int % 5 <> 0 or p_minuter is null or p_minuter < 15 or p_minuter > 480 then raise exception 'lk:ogiltig'; end if;
  end if;

  v_fore := public.lk_lage(p_event);

  -- En gång i en serie har sina deltagare på serien. Ändringen gäller den här gången, så deltagarna
  -- kopieras till gången först (som lk_andra_mote och lk_ny_tid), med valfri och påminnelse.
  if v_e.series_id is not null then
    insert into calendar_attendee (event_id, employee_id, external_email, response, reminder_min, optional, reminder_off)
    select p_event, a.employee_id, a.external_email, a.response, a.reminder_min, a.optional, a.reminder_off
    from public.lk_narvaro(p_event) n join calendar_attendee a on a.id = n.rad
    where n.fran_serie;
  end if;

  update calendar_event
     set dag = p_dag,
         tid = p_tid,
         minuter = p_minuter,
         title = btrim(p_title),
         plats = nullif(btrim(coalesce(p_plats, '')), ''),
         online_url = nullif(btrim(coalesce(p_online_url, '')), ''),
         agenda_md = coalesce(p_agenda, ''),
         reminder_min = v_min,
         reminder_off = v_off,
         show_as = v_visa,
         is_private = v_priv,
         avviker = (series_id is not null) or avviker,
         ics_sequence = ics_sequence + case when v_tid or v_plats then 1 else 0 end,
         updated_at = now()
   where id = p_event;

  -- Borttagna: mötet är inställt för dem (dag och tid som de kände till).
  foreach v_person in array v_nu loop
    if not (v_person = any(v_alla)) then
      delete from calendar_attendee where event_id = p_event and employee_id = v_person;
      v_id := public.lk_notis(v_aktion, 'kalender-installd', 'installd', v_person, p_aktor, p_event,
        jsonb_build_object('dag', v_e.dag, 'tid', to_char(v_e.tid, 'HH24:MI')));
      if v_id is not null then v_ids := v_ids || v_id; v_installd := v_installd + 1; end if;
    end if;
  end loop;

  -- Nya: en inbjudan (med den nya tiden), och inget annat besked.
  foreach v_person in array v_alla loop
    if not (v_person = any(v_nu)) then
      if not public.lk_aktiv(v_person) then raise exception 'lk:ogiltig'; end if;
      insert into calendar_attendee (event_id, employee_id) values (p_event, v_person);
      v_id := public.lk_notis(v_aktion, 'kalender-inbjudan', 'inbjudan', v_person, p_aktor, p_event, '{}'::jsonb);
      if v_id is not null then v_ids := v_ids || v_id; v_inbjudna := v_inbjudna + 1; end if;
    end if;
  end loop;

  update calendar_attendee set optional = (employee_id = any(v_valfria))
   where event_id = p_event and employee_id is not null;

  if v_tid then
    -- Ny tid: alla svarar igen och förslagen gäller inte längre (som lk_ny_tid), och kundens påminnelser flyttas.
    -- Utom ett ombud som själv deltar (0281, S05 M6): den som flyttade mötet ombeds inte svara på sin egen flytt.
    update calendar_attendee a
       set response = 'vantar', responded_at = null, response_note = null,
           proposed_dag = null, proposed_tid = null, proposed_minuter = null, proposal_note = null
     where a.event_id = p_event
       and a.employee_id is distinct from p_aktor;
    v_ids := v_ids || public.lk_paminnelser_flytta(v_aktion, p_event);
  end if;

  -- De som var med och är kvar (och arrangören, när ett ombud sparar): ETT besked.
  if v_tid or v_plats or v_inneh then
    v_kalla := case
      when not (v_tid or v_plats) then 'kalender-flyttad-tyst'
      when least(v_e.starts_at, (p_dag + coalesce(p_tid, time '00:00')) at time zone 'Europe/Stockholm') <= now() + interval '7 days' then 'kalender-flyttad'
      else 'kalender-flyttad-tyst' end;
    v_mall := case when v_tid then 'flyttad' else 'andrad' end;
    for v_person in
      select x from unnest(v_nu) x where x = any(v_alla)
      union
      select v_e.organizer_id where v_e.organizer_id <> p_aktor
    loop
      v_data := case when v_tid
        then jsonb_build_object('dag', p_dag, 'tid', to_char(p_tid, 'HH24:MI'), 'minuter', p_minuter,
                                'svara_igen', v_person <> v_e.organizer_id, 'forekomst', v_e.series_id is not null)
        else '{}'::jsonb end;
      v_id := public.lk_notis(v_aktion, v_kalla, v_mall, v_person, p_aktor, p_event, v_data);
      if v_id is not null then
        v_ids := v_ids || v_id;
        v_besked := v_besked + 1;
        if v_tid and v_person <> v_e.organizer_id then v_igen := v_igen || v_person; end if;
      end if;
    end loop;
  elsif p_aktor <> v_e.organizer_id and ('deltagare' = any(v_andrat) or 'valfria' = any(v_andrat)) then
    -- Ett ombud som bara ändrar deltagarna (också sitt eget deltagande): de som läggs till eller tas bort har
    -- fått sitt ovan, och arrangören får ett tyst besked i klockan (0281, S05 M6). Förut fick hen ingenting.
    v_kalla := 'kalender-flyttad-tyst';
    v_id := public.lk_notis(v_aktion, v_kalla, 'andrad', v_e.organizer_id, p_aktor, p_event,
      jsonb_build_object('deltagare', true));
    if v_id is not null then v_ids := v_ids || v_id; v_arrangoren := true; end if;
  end if;

  return jsonb_build_object(
    'event_id', p_event,
    'andrat', to_jsonb(v_andrat),
    'skickat', jsonb_build_object(
      'inbjudna', v_inbjudna,
      'installd', v_installd,
      'besked', v_besked,
      'kalla', v_kalla,
      'ics', v_tid or v_plats,
      'svara_igen', to_jsonb(v_igen),
      'arrangoren', v_arrangoren),
    'undo_id', public.lk_undo(p_event, null, 'andra', v_fore, v_ids, p_aktor)
  );
end;
$function$;

revoke all on function public.lk_andra_serie(uuid, uuid, boolean, time, integer, text, integer, integer, date, date[], text, text) from public, anon, authenticated;
grant execute on function public.lk_andra_serie(uuid, uuid, boolean, time, integer, text, integer, integer, date, date[], text, text) to service_role;
revoke all on function public.lk_angra(uuid, uuid) from public, anon, authenticated;
grant execute on function public.lk_angra(uuid, uuid) to service_role;
revoke all on function public.lk_flytta_serie(uuid, uuid, date, time, date[], text) from public, anon, authenticated;
grant execute on function public.lk_flytta_serie(uuid, uuid, date, time, date[], text) to service_role;
revoke all on function public.lk_spara_mote(uuid, uuid, date, time, integer, text, text, text, text, uuid[], uuid[], integer, boolean, text, boolean) from public, anon, authenticated;
grant execute on function public.lk_spara_mote(uuid, uuid, date, time, integer, text, text, text, text, uuid[], uuid[], integer, boolean, text, boolean) to service_role;

CREATE OR REPLACE FUNCTION public.commission_period_stangs()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  sista_dagen date;
begin
  if tg_op = 'DELETE' then
    raise exception 'En stangd provisionsperiod oppnas inte igen. Bokfor en rattelse som en negativ post.';
  end if;

  if tg_op = 'INSERT' then
    -- Manadens las (0281, granskningen S06 M7), samma som ta_bort_ovrig_bonus tar fore sin provning:
    -- en borttagning som pagar nar manaden faststalls blir klar fore stangningen, och en som borjar
    -- under stangningen vantar och far pv:faststalld. Laset galler tills transaktionen ar slut.
    perform pg_advisory_xact_lock(hashtextextended('commission_period:' || new.period_month::text, 0));

    -- Manaden maste vara slut. En period som stangs den 20:e stanger ute de
    -- order som tecknas den 25:e, och de har ingen vag tillbaka in — se O11.
    sista_dagen := (new.period_month + interval '1 month' - interval '1 day')::date;

    -- Dagen raknas i SVENSK tid. Pa Vercel star servern i UTC, och den 1:a
    -- klockan 00:30 svensk tid hade dar lasts som den 31:a — vilket hade
    -- slappt igenom en attest ett dygn for tidigt. Samma resonemang som
    -- `manadsnyckel()` i src/lib/provision.ts.
    if (now() at time zone 'Europe/Stockholm')::date < sista_dagen then
      raise exception 'Perioden % kan inte faststallas fore %.', new.period_month, sista_dagen;
    end if;

    return new;
  end if;

  -- Efter stangningen finns exakt en tillaten forandring: att markera
  -- utbetalningen. Allt annat — manad, belopp, vem som stangde — star fast.
  if new.period_month is distinct from old.period_month
     or new.closed_by is distinct from old.closed_by
     or new.closed_at is distinct from old.closed_at then
    raise exception 'En faststalld period skrivs inte om.';
  end if;

  if not (old.status = 'faststalld' and new.status = 'utbetald') then
    raise exception 'Perioden kan bara ga fran faststalld till utbetald.';
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ta_bort_ovrig_bonus(p_aktor uuid, p_post uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_post public.commission_entry%rowtype;
  v_ny uuid;
begin
  select * into v_post from public.commission_entry where id = p_post for update;
  if not found or v_post.kind is distinct from 'ovrig_bonus' then
    raise exception 'pv:ogiltig';
  end if;

  if exists (
    select 1 from public.commission_entry_reversal r
    where r.original_id = p_post or r.reversal_id = p_post
  ) then
    raise exception 'pv:redan_borttagen';
  end if;

  -- Manadens las (0281, granskningen S06 M7), samma som commission_period_stangs tar nar manaden
  -- faststalls. Utan det kunde provningen nedan se en oppen manad medan Faststall stangde den, och
  -- motposten hamnade i en stangd manad.
  perform pg_advisory_xact_lock(hashtextextended('commission_period:' || v_post.period_month::text, 0));

  if exists (select 1 from public.commission_period p where p.period_month = v_post.period_month) then
    raise exception 'pv:faststalld';
  end if;

  insert into public.commission_entry (employee_id, period_month, amount, kind, source, note, sales_order_id, entered_by)
  values (
    v_post.employee_id,
    v_post.period_month,
    -v_post.amount,
    'ovrig_bonus',
    'manual',
    left('Borttagen: ' || coalesce(v_post.note, ''), 500),
    v_post.sales_order_id,
    p_aktor
  )
  returning id into v_ny;

  insert into public.commission_entry_reversal (original_id, reversal_id, created_by)
  values (p_post, v_ny, p_aktor);

  return v_ny;
end;
$function$;

revoke all on function public.ta_bort_ovrig_bonus(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ta_bort_ovrig_bonus(uuid, uuid) to service_role;
