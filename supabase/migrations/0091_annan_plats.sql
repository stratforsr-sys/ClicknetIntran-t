-- 0091 · "Arbetar på annan plats" (Nav 2.0, 2026-10-15)
--
-- Nav 2.0:s "Visa som" har fem val: upptagen, preliminär, ledig, borta och
-- arbetar på annan plats. Navet hade de fyra första. Villkoret vidgas, och
-- `lk_andra_mote` (0088) tar emot det femte. Inget befintligt värde ändras.

alter table public.calendar_event drop constraint calendar_event_show_as_check;
alter table public.calendar_event add constraint calendar_event_show_as_check
  check (show_as = any (array['ledig', 'preliminar', 'upptagen', 'borta', 'annan']));

create or replace function public.lk_andra_mote(
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
  if p_show_as is not null and p_show_as not in ('upptagen', 'preliminar', 'ledig', 'borta', 'annan') then raise exception 'lk:ogiltig'; end if;

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
