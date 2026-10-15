-- 0089 · "Varje månad" för möten och uppgifter (Nav 2.0, 2026-10-15)
--
-- Nav 2.0:s kalender har "Varje månad" bland upprepningarna. Navets serier
-- kunde vardagar, veckovis och varannan vecka. Månadsmönstret infaller samma
-- datum som serien började, eller månadens sista dag när månaden är kortare
-- (src/lib/upprepning.ts, `traffar`). Datumen räknas i TypeScript som förut;
-- databasen behöver bara släppa igenom mönstret.
--
-- Additivt: villkoren vidgas, och `lk_skapa_serie` tar emot mönstret. Inget
-- befintligt värde ändrar betydelse.

alter table public.calendar_series drop constraint calendar_series_monster_check;
alter table public.calendar_series add constraint calendar_series_monster_check
  check (monster = any (array['vardagar', 'veckovis', 'manadsvis']));

alter table public.task_series drop constraint task_series_monster_check;
alter table public.task_series add constraint task_series_monster_check
  check (monster = any (array['dagligen', 'vardagar', 'veckovis', 'manadsvis']));

CREATE OR REPLACE FUNCTION public.lk_skapa_serie(p_aktor uuid, p_kind text, p_organizer uuid, p_title text, p_tid time without time zone, p_minuter integer, p_monster text, p_intervall integer, p_veckodag integer, p_starts_on date, p_ends_on date, p_deltagare uuid[], p_dagar date[], p_agenda text, p_reminder_min integer, p_regeltext text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_aktion uuid := gen_random_uuid();
  v_serie  uuid;
  v_forsta uuid;
  v_ids    bigint[] := '{}';
  v_id     bigint;
  v_person uuid;
  v_alla   uuid[];
  v_dagar  date[];
begin
  if not public.lk_aktiv(p_aktor) or not public.lk_aktiv(p_organizer)
     or not public.lk_far_andra(p_aktor, p_organizer) then
    raise exception 'lk:behorighet';
  end if;
  if p_kind not in ('mote','enskilt') then raise exception 'lk:ogiltig'; end if;
  if p_kind = 'mote' and (p_title is null or length(btrim(p_title)) = 0) then raise exception 'lk:rubrik'; end if;
  if p_tid is null or p_minuter is null or p_minuter < 15 or p_minuter > 480
     or extract(minute from p_tid)::int % 5 <> 0 then
    raise exception 'lk:ogiltig';
  end if;
  if p_monster not in ('vardagar','veckovis','manadsvis') or coalesce(p_intervall, 1) not in (1,2) then
    raise exception 'lk:ogiltig';
  end if;

  select coalesce(array_agg(distinct d), '{}') into v_alla
  from unnest(coalesce(p_deltagare, '{}')) d
  where d is not null and d <> p_organizer;

  -- En 1:1 är två personer, alltid.
  if p_kind = 'enskilt' and cardinality(v_alla) <> 1 then raise exception 'lk:ogiltig'; end if;
  if cardinality(v_alla) > 50 then raise exception 'lk:ogiltig'; end if;

  v_dagar := public.lk_giltiga_dagar(p_dagar, greatest(p_starts_on, current_date), p_ends_on);
  if cardinality(v_dagar) = 0 then raise exception 'lk:vardag'; end if;

  insert into calendar_series (kind, title, organizer_id, tid, minuter, monster, intervall, veckodag,
                               starts_on, ends_on, reminder_min, created_by)
  values (p_kind, case when p_kind = 'enskilt' then '1:1' else btrim(p_title) end, p_organizer, p_tid, p_minuter,
          p_monster, coalesce(p_intervall, 1)::smallint,
          case when p_monster = 'veckovis' then coalesce(p_veckodag, extract(isodow from v_dagar[1]))::smallint end,
          p_starts_on, p_ends_on, coalesce(p_reminder_min, 10), p_aktor)
  returning id into v_serie;

  foreach v_person in array v_alla loop
    if not public.lk_aktiv(v_person) then raise exception 'lk:ogiltig'; end if;
    insert into calendar_attendee (series_id, employee_id) values (v_serie, v_person);
  end loop;

  perform public.lk_fod_forekomster(v_serie, v_dagar, p_aktor);
  v_forsta := public.lk_nasta_forekomst(v_serie);

  if p_kind = 'enskilt' and length(btrim(coalesce(p_agenda, ''))) > 0 then
    insert into one_on_one_item (series_id, kind, text, author_id, for_dag)
    values (v_serie, 'agenda', left(btrim(p_agenda), 300), p_aktor, v_dagar[1]);
  end if;

  foreach v_person in array v_alla loop
    v_id := public.lk_notis(v_aktion, 'kalender-inbjudan', 'inbjudan-serie', v_person, p_aktor, v_forsta,
      jsonb_build_object('regel', coalesce(p_regeltext, ''), 'dag', v_dagar[1], 'tid', to_char(p_tid, 'HH24:MI')));
    if v_id is not null then v_ids := v_ids || v_id; end if;
  end loop;

  return jsonb_build_object(
    'series_id', v_serie,
    'event_id', v_forsta,
    'deltagare', to_jsonb(v_alla),
    'undo_id', public.lk_undo(null, v_serie, 'skapa_serie', jsonb_build_object('skapad_serie', v_serie), v_ids, p_aktor)
  );
end;
$function$;
