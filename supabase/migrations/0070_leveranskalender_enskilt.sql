-- =============================================================================
-- 0070_leveranskalender_enskilt.sql — Leveranskalendern, pass 2 av 4: 1:1.
--
-- Numret är fråga till `schema_migrations` 2026-09-30: högst var 0069.
--
-- INGA NYA TABELLER. 0069 skapade allt pass 2 behöver (`calendar_series`,
-- `one_on_one_item`) just för att den här migrationen inte skulle behöva ändra
-- en körd fil. Här står bara funktioner, och ett utökat villkor på vilka
-- handlingar Ångra känner till.
--
-- =============================================================================
-- SERIERNAS DATUM RÄKNAS I TYPESCRIPT, INTE HÄR
--
-- En serie föder riktiga rader i `calendar_event`, 56 dagar framåt. VILKA
-- datum räknas av `forekomster()` i `lib/upprepning.ts` — samma regel som
-- uppgiftsserierna, utökad med varannan vecka — och skickas hit som `date[]`.
-- Två implementationer av samma regel hade glidit isär, och den som skiljer
-- sig är den som ingen provar. Funktionerna här tar datumen, prövar att de är
-- vardagar inom seriens gränser, och skriver dem i samma transaktion som resten.
--
-- =============================================================================
-- 1:1-INNEHÅLLET SKRIVS BARA AV DE TVÅ
--
-- Läsningen är coachningskretsen (policyn i 0069). Skrivningen är snävare:
-- organisatören och säljaren. En chef som läser sin säljares 1:1 skriver inte i
-- den — det är deras samtal.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Ångra känner till fler handlingar
-- -----------------------------------------------------------------------------

alter table calendar_undo drop constraint if exists calendar_undo_handling_check;
alter table calendar_undo add constraint calendar_undo_handling_check check (handling in (
  'skapa','svara','foresla','besluta','flytta','stall_in',
  'skapa_serie','flytta_serie','punkt','bocka','punkt_uppgift'
));

-- -----------------------------------------------------------------------------
-- 2. Hjälpare
-- -----------------------------------------------------------------------------

/** Är personen organisatören eller en deltagare i serien? */
create or replace function public.lk_i_serien(p_series uuid, p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_employee is not null and exists (
    select 1 from calendar_series s
    where s.id = p_series
      and (s.organizer_id = p_employee
           or exists (select 1 from calendar_attendee a where a.series_id = s.id and a.employee_id = p_employee))
  );
$$;

/** Nästa förekomst som inte är inställd, för länkarna i en notis om serien. */
create or replace function public.lk_nasta_forekomst(p_series uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from calendar_event
  where series_id = p_series and cancelled_at is null and dag >= current_date
  order by dag, tid
  limit 1;
$$;

/** Datumen som får bli förekomster: vardagar, inom gränserna, från idag. */
create or replace function public.lk_giltiga_dagar(p_dagar date[], p_fran date, p_till date)
returns date[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(distinct d order by d), '{}')
  from unnest(coalesce(p_dagar, '{}')) d
  where d is not null
    and extract(isodow from d) <= 5
    and d >= p_fran
    and (p_till is null or d <= p_till);
$$;

/** Förekomster för datumen. Befintliga rader (samma `occurrence_of`) lämnas orörda. */
create or replace function public.lk_fod_forekomster(p_series uuid, p_dagar date[], p_aktor uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_s    calendar_series;
  v_antal int;
begin
  select * into v_s from calendar_series where id = p_series;
  insert into calendar_event (kind, title, organizer_id, dag, tid, minuter, reminder_min,
                              series_id, occurrence_of, created_by, agenda_md)
  select v_s.kind, v_s.title, v_s.organizer_id, d, v_s.tid, v_s.minuter, v_s.reminder_min,
         v_s.id, d, coalesce(p_aktor, v_s.created_by), ''
  from unnest(public.lk_giltiga_dagar(p_dagar, greatest(v_s.starts_on, current_date), v_s.ends_on)) d
  on conflict (series_id, occurrence_of) do nothing;
  get diagnostics v_antal = row_count;
  return v_antal;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Svar: hela serien rör inte förekomsternas egna svar
--
-- 0069 skrev även över förekomsternas egna rader när någon svarade för hela
-- serien. En förekomst har en egen rad bara när den flyttats för sig — och då
-- gäller svaret den flyttade tiden, som prototypen visar ("gäller den flyttade
-- tiden"). Ett svar på serien ska inte tyst svara på den också.
-- -----------------------------------------------------------------------------

create or replace function public.lk_svara(
  p_aktor uuid, p_event uuid, p_svar text, p_note text, p_hela_serien boolean
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
  v_id     bigint;
  v_rad    record;
  v_serien boolean;
begin
  if p_svar not in ('ja','kanske','nej') then
    raise exception 'lk:ogiltig';
  end if;
  select * into v_e from calendar_event where id = p_event for update;
  if not found then raise exception 'lk:finns_inte'; end if;
  if v_e.cancelled_at is not null then raise exception 'lk:installd'; end if;

  select * into v_rad from public.lk_narvaro(p_event) n where n.employee_id = p_aktor;
  if not found then raise exception 'lk:behorighet'; end if;

  v_fore := public.lk_lage(p_event);
  -- Hela serien bara när förekomsten inte har en egen rad för mig.
  v_serien := v_e.series_id is not null and coalesce(p_hela_serien, false) and v_rad.fran_serie;

  if v_serien then
    update calendar_attendee
       set response = p_svar, response_note = nullif(btrim(coalesce(p_note, '')), ''), responded_at = now()
     where series_id = v_e.series_id and employee_id = p_aktor;
  elsif v_rad.fran_serie then
    insert into calendar_attendee (event_id, employee_id, response, response_note, responded_at)
    values (p_event, p_aktor, p_svar, nullif(btrim(coalesce(p_note, '')), ''), now());
  else
    update calendar_attendee
       set response = p_svar, response_note = nullif(btrim(coalesce(p_note, '')), ''), responded_at = now()
     where id = v_rad.rad;
  end if;

  v_id := public.lk_notis(v_aktion, 'kalender-svar', 'svar', v_e.organizer_id, p_aktor, p_event,
    jsonb_build_object('svar', p_svar, 'note', nullif(btrim(coalesce(p_note, '')), ''),
                       'hela_serien', v_serien,
                       'forekomst', v_e.series_id is not null and not v_serien));

  return jsonb_build_object(
    'event_id', p_event,
    'organizer_id', v_e.organizer_id,
    'hela_serien', v_serien,
    'undo_id', public.lk_undo(p_event, null, 'svara', v_fore,
                              case when v_id is null then '{}'::bigint[] else array[v_id] end, p_aktor)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Skapa en serie: 1:1 eller återkommande möte
-- -----------------------------------------------------------------------------

create or replace function public.lk_skapa_serie(
  p_aktor uuid,
  p_kind text,
  p_organizer uuid,
  p_title text,
  p_tid time,
  p_minuter int,
  p_monster text,
  p_intervall int,
  p_veckodag int,
  p_starts_on date,
  p_ends_on date,
  p_deltagare uuid[],
  p_dagar date[],
  p_agenda text,
  p_reminder_min int,
  p_regeltext text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
  if p_monster not in ('vardagar','veckovis') or coalesce(p_intervall, 1) not in (1,2) then
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
$$;

/** Nattens eller dagtidsjobbets påfyllning: horisonten 56 dagar framåt. Ingen notis. */
create or replace function public.lk_fyll_serie(p_series uuid, p_dagar date[])
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return public.lk_fod_forekomster(p_series, p_dagar, null);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Flytta hela serien
--
-- Ny veckodag och ny tid. Förekomster från och med den flyttade (dock aldrig
-- bakåt i tiden) som INTE ändrats för sig tas bort och föds om på de nya
-- datumen. En förekomst som flyttats för sig (`avviker`) står kvar — den har
-- redan fått en egen tid och egna svar. Alla svar på serien nollställs.
-- -----------------------------------------------------------------------------

create or replace function public.lk_flytta_serie(
  p_aktor uuid, p_event uuid, p_dag date, p_tid time, p_dagar date[], p_regeltext text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_aktion uuid := gen_random_uuid();
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

  v_fran := greatest(least(v_e.dag, p_dag), current_date);

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
$$;

-- -----------------------------------------------------------------------------
-- 6. 1:1-agendan och åtgärderna
-- -----------------------------------------------------------------------------

/**
 * En punkt på agendan eller en åtgärd. Den andra får en notis — men EN per
 * dag, inte en per punkt: nyckeln bär datumet, och en andra punkt samma dag
 * krockar med den första och skriver ingen ny rad.
 */
create or replace function public.lk_ny_punkt(
  p_aktor uuid, p_series uuid, p_kind text, p_text text, p_for_dag date, p_owner uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_s     calendar_series;
  v_item  uuid;
  v_andra uuid;
  v_id    bigint;
begin
  select * into v_s from calendar_series where id = p_series;
  if not found or v_s.kind <> 'enskilt' then raise exception 'lk:finns_inte'; end if;
  if not public.lk_i_serien(p_series, p_aktor) then raise exception 'lk:behorighet'; end if;
  if p_kind not in ('agenda','atgard') then raise exception 'lk:ogiltig'; end if;
  if p_text is null or length(btrim(p_text)) = 0 or length(btrim(p_text)) > 300 then raise exception 'lk:ogiltig'; end if;
  if p_owner is not null and not public.lk_i_serien(p_series, p_owner) then raise exception 'lk:ogiltig'; end if;

  insert into one_on_one_item (series_id, kind, text, author_id, owner_id, for_dag)
  values (p_series, p_kind, btrim(p_text), p_aktor,
          case when p_kind = 'atgard' then coalesce(p_owner, p_aktor) end, p_for_dag)
  returning id into v_item;

  v_andra := case when p_aktor = v_s.organizer_id
                  then (select a.employee_id from calendar_attendee a where a.series_id = p_series and a.employee_id is not null limit 1)
                  else v_s.organizer_id end;

  if v_andra is not null and v_andra <> p_aktor then
    insert into outbox (kind, payload, idempotency_key, event_id)
    values ('notis',
            jsonb_build_object('kalla', 'kalender-punkt', 'mall', 'punkt', 'till', v_andra, 'av', p_aktor,
                               'event_id', public.lk_nasta_forekomst(p_series),
                               'data', jsonb_build_object('text', btrim(p_text))),
            'punkt:' || p_series::text || ':' || v_andra::text || ':' || current_date::text,
            public.lk_nasta_forekomst(p_series))
    on conflict (idempotency_key) do nothing
    returning id into v_id;
  end if;

  return jsonb_build_object(
    'item_id', v_item,
    'undo_id', public.lk_undo(null, p_series, 'punkt', jsonb_build_object('item', v_item),
                              case when v_id is null then '{}'::bigint[] else array[v_id] end, p_aktor)
  );
end;
$$;

/** Bocka av eller av-bocka. Ingen notis: den andra ser det i panelen. */
create or replace function public.lk_bocka(p_aktor uuid, p_item uuid, p_klar boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_i one_on_one_item;
begin
  select * into v_i from one_on_one_item where id = p_item for update;
  if not found then raise exception 'lk:finns_inte'; end if;
  if not public.lk_i_serien(v_i.series_id, p_aktor) then raise exception 'lk:behorighet'; end if;

  update one_on_one_item
     set done_at = case when coalesce(p_klar, false) then coalesce(done_at, now()) end
   where id = p_item;

  return jsonb_build_object(
    'item_id', p_item,
    'undo_id', public.lk_undo(null, v_i.series_id, 'bocka',
                              jsonb_build_object('item', p_item, 'done_at', v_i.done_at), '{}', p_aktor)
  );
end;
$$;

/**
 * En åtgärd blir en uppgift, i uppgiftsmodulen, på den som äger åtgärden.
 *
 * Skrivs här och inte genom `uppgifter::skapaUppgift` för att uppgiften,
 * åtgärdens bock och läget för Ångra ska bli en transaktion. Raden är en helt
 * vanlig uppgift med en `skapad`-händelse; den ansvariga får den som "ny" i
 * klockan av samma härledning som alla andra uppgifter.
 */
create or replace function public.lk_punkt_till_uppgift(p_aktor uuid, p_item uuid, p_dag date, p_tid time)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_i    one_on_one_item;
  v_task uuid;
  v_agare uuid;
begin
  select * into v_i from one_on_one_item where id = p_item for update;
  if not found then raise exception 'lk:finns_inte'; end if;
  if not public.lk_i_serien(v_i.series_id, p_aktor) then raise exception 'lk:behorighet'; end if;
  if v_i.task_id is not null or v_i.done_at is not null then raise exception 'lk:ogiltig'; end if;

  v_agare := coalesce(v_i.owner_id, v_i.author_id);
  if not public.lk_aktiv(v_agare) then raise exception 'lk:ogiltig'; end if;

  insert into task (title, assignee_id, created_by, due_date, due_time, estimate_minutes, priority)
  values (left(v_i.text, 200), v_agare, p_aktor, p_dag, case when p_dag is not null then p_tid end, 30, 3)
  returning id into v_task;
  insert into task_event (task_id, type, by_employee_id) values (v_task, 'skapad', p_aktor);

  update one_on_one_item set task_id = v_task, done_at = now() where id = p_item;

  return jsonb_build_object(
    'task_id', v_task,
    'agare', v_agare,
    'undo_id', public.lk_undo(null, v_i.series_id, 'punkt_uppgift',
                              jsonb_build_object('item', p_item, 'task', v_task, 'done_at', v_i.done_at), '{}', p_aktor)
  );
end;
$$;

/** "Be X förbereda nu": en notis till den andra. Inte ångrabar. */
create or replace function public.lk_be_om_forberedelse(p_aktor uuid, p_event uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_e     calendar_event;
  v_andra uuid;
begin
  select * into v_e from calendar_event where id = p_event;
  if not found or v_e.kind <> 'enskilt' or v_e.series_id is null then raise exception 'lk:finns_inte'; end if;
  if not public.lk_i_serien(v_e.series_id, p_aktor) then raise exception 'lk:behorighet'; end if;

  v_andra := case when p_aktor = v_e.organizer_id
                  then (select n.employee_id from public.lk_narvaro(p_event) n where n.employee_id is not null limit 1)
                  else v_e.organizer_id end;

  perform public.lk_notis(gen_random_uuid(), 'kalender-forberedelse', 'forbered-be', v_andra, p_aktor, p_event, '{}'::jsonb);
  return jsonb_build_object('till', v_andra);
end;
$$;

/**
 * Förberedelsen vardagen före kl 15 (dagtidsjobbet, var kvart vardagar).
 * En 1:1 på måndag förbereds alltså fredag kl 15. Nyckeln per förekomst och
 * person gör att jobbet kan köras hur många gånger som helst.
 */
create or replace function public.lk_forberedelser()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nu    timestamp := now() at time zone 'Europe/Stockholm';
  v_idag  date := (now() at time zone 'Europe/Stockholm')::date;
  v_nasta date;
  v_antal int;
begin
  if extract(isodow from v_idag) > 5 or v_nu::time < time '15:00' then
    return 0;
  end if;
  v_nasta := v_idag + case when extract(isodow from v_idag) = 5 then 3 else 1 end;

  insert into outbox (kind, payload, idempotency_key, not_before, event_id)
  select 'notis',
         jsonb_build_object('kalla', 'kalender-forberedelse', 'mall', 'forberedelse', 'till', p.person,
                            'av', null, 'event_id', e.id, 'data', '{}'::jsonb),
         'forbered:' || e.id::text || ':' || p.person::text,
         now(),
         e.id
  from calendar_event e
  cross join lateral (
    select e.organizer_id as person
    union
    select n.employee_id from public.lk_narvaro(e.id) n
    where n.employee_id is not null and n.response <> 'nej'
  ) p
  where e.kind = 'enskilt'
    and e.dag = v_nasta
    and e.cancelled_at is null
  on conflict (idempotency_key) do nothing;
  get diagnostics v_antal = row_count;
  return v_antal;
end;
$$;

/**
 * Anteckningarna sparade som coachningssamtal (0043) kopplas till
 * förekomsten. Samtalet skrivs av coachningsmodulen; här bara kopplingen, och
 * bara om samtalet gäller just de två.
 */
create or replace function public.lk_koppla_samtal(p_aktor uuid, p_event uuid, p_session uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_e calendar_event;
begin
  select * into v_e from calendar_event where id = p_event for update;
  if not found or v_e.kind <> 'enskilt' then raise exception 'lk:finns_inte'; end if;
  if v_e.organizer_id <> p_aktor then raise exception 'lk:behorighet'; end if;
  if not exists (
    select 1 from coaching_session s
    where s.id = p_session and s.coach_id = p_aktor
      and exists (select 1 from public.lk_narvaro(p_event) n where n.employee_id = s.employee_id)
  ) then
    raise exception 'lk:ogiltig';
  end if;
  update calendar_event set coaching_session_id = p_session, updated_at = now() where id = p_event;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Ångra, med seriernas och punkternas grenar
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
  end if;

  insert into audit_log (actor_id, action, object_type, object_id, reason)
  values (p_aktor, 'calendar.undone', v_typ, v_objekt, 'Ångrad direkt efter ' || v_u.handling);

  return jsonb_build_object('event_id', v_event, 'series_id', v_serie, 'handling', v_u.handling);
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Granter: bara service role
-- -----------------------------------------------------------------------------

do $$
declare
  f text;
begin
  foreach f in array array[
    'lk_i_serien(uuid, uuid)',
    'lk_nasta_forekomst(uuid)',
    'lk_giltiga_dagar(date[], date, date)',
    'lk_fod_forekomster(uuid, date[], uuid)',
    'lk_svara(uuid, uuid, text, text, boolean)',
    'lk_skapa_serie(uuid, text, uuid, text, time, int, text, int, int, date, date, uuid[], date[], text, int, text)',
    'lk_fyll_serie(uuid, date[])',
    'lk_flytta_serie(uuid, uuid, date, time, date[], text)',
    'lk_ny_punkt(uuid, uuid, text, text, date, uuid)',
    'lk_bocka(uuid, uuid, boolean)',
    'lk_punkt_till_uppgift(uuid, uuid, date, time)',
    'lk_be_om_forberedelse(uuid, uuid)',
    'lk_forberedelser()',
    'lk_koppla_samtal(uuid, uuid, uuid)',
    'lk_angra(uuid, uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Vakter
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['lk_skapa_serie','lk_fyll_serie','lk_flytta_serie','lk_ny_punkt','lk_bocka',
                           'lk_punkt_till_uppgift','lk_be_om_forberedelse','lk_forberedelser',
                           'lk_koppla_samtal','lk_angra','lk_svara','lk_fod_forekomster'] loop
    if exists (
      select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public' and p.proname = t
        and (has_function_privilege('authenticated', p.oid, 'execute')
             or has_function_privilege('anon', p.oid, 'execute'))
    ) then
      raise exception '% går att anropa utan service role', t;
    end if;
  end loop;
end;
$$;
