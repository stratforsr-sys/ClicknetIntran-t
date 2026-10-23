-- =============================================================================
-- 0212_kalender_spara_mote.sql — Kalendern: en sparning i mötesformuläret är
-- en ändring, med ett besked per person och bara när något spelar roll
--
-- -----------------------------------------------------------------------------
-- VAD SOM VAR FEL (granskningen 2026-10-22, E2)
-- -----------------------------------------------------------------------------
--
-- /nav2/kalender sparade ett befintligt möte i upp till fem steg: lk_flytta,
-- lk_andra_mote (längden), lk_andra_mote (resten), Privat och valfria, vart och
-- ett i egen transaktion med egen ångerrad. lk_andra_mote räknade ALLTID upp
-- ics_sequence och skickade "ändrat" med ny .ics till alla, och triggern
-- calendar_event_ics köade "Ny tid … Vi har flyttat mötet" till varje gäst
-- utanför Clicknet, också när ingenting ändrats. En ny tid gav två–tre besked
-- per deltagare, och Ångra ångrade bara det sista steget men sa "Inget
-- skickades".
--
-- -----------------------------------------------------------------------------
-- VAD FILEN GÖR
-- -----------------------------------------------------------------------------
--
-- 1. "Ingen påminnelse" får egna kolumner (E4; resten i 0213):
--      calendar_event.reminder_off      true = ingen påminnelse för mötet
--      calendar_attendee.reminder_off   true = ingen för deltagaren,
--                                       false = deltagarens egen (reminder_min),
--                                       null = mötets
--      calendar_series.reminder_off     seriens; lk_fod_forekomster (0213)
--    De ligger här för att lk_spara_mote skriver dem.
--
-- 2. lk_spara_mote: hela formulärets sparning av ett möte (kind = 'mote') i en
--    transaktion med en ångerrad (lk_lage före, lk_undo efter, ångertypen
--    'andra'). Den räknar själv ut vad som ändrats (samma regel som
--    src/lib/nav2/kalender-andring.ts):
--      - ingenting: inga skrivningar, andrat = []
--      - borttagen deltagare: 'installd'; ny deltagare: 'inbjudan'
--      - de som var med och är kvar får ETT besked:
--          tid (dag, klockslag, längd) → 'flyttad' och svarar igen
--          plats eller länk            → 'andrad'
--          (källan kalender-flyttad, eller -tyst när varken gamla eller nya
--          tiden ligger inom sju dagar, som lk_ny_tid)
--          bara rubrik eller agenda    → 'andrad' med kalender-flyttad-tyst
--                                        (står i klockan, inget mejl, ingen .ics)
--          bara påminnelse, Visa som, Privat, valfria → inget
--      - ics_sequence +1 en gång, och bara för tid eller plats. Då, och bara
--        då, köar triggern en ny inbjudan till gäster utanför Clicknet.
--    Behörigheten prövas med lk_far_andra (arrangören och, efter 0201, hens
--    ombud). Heldag ändras inte här (lk_andra_heldag, 0204): ett möte med
--    klockslag behåller sitt och tvärtom.
--    lk_andra_mote står kvar för gamla Navs formulär.
--
-- Bara service role får köra funktionen.
-- =============================================================================

alter table public.calendar_event add column if not exists reminder_off boolean not null default false;
alter table public.calendar_attendee add column if not exists reminder_off boolean;
alter table public.calendar_series add column if not exists reminder_off boolean not null default false;

comment on column public.calendar_event.reminder_off is
  'Ingen påminnelse för mötet (formulärets "Ingen"); reminder_min står kvar till nästa gång den slås på. 0212.';
comment on column public.calendar_attendee.reminder_off is
  'Deltagarens påminnelse: true = ingen, false = egen (reminder_min), null = mötets. 0212.';

create or replace function public.lk_spara_mote(
  p_aktor uuid, p_event uuid, p_dag date, p_tid time, p_minuter integer,
  p_title text, p_plats text, p_online_url text, p_agenda text,
  p_deltagare uuid[], p_valfria uuid[],
  p_reminder_min integer, p_reminder_off boolean, p_show_as text, p_privat boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
    update calendar_attendee a
       set response = 'vantar', responded_at = null, response_note = null,
           proposed_dag = null, proposed_tid = null, proposed_minuter = null, proposal_note = null
     where a.event_id = p_event;
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
      'svara_igen', to_jsonb(v_igen)),
    'undo_id', public.lk_undo(p_event, null, 'andra', v_fore, v_ids, p_aktor)
  );
end;
$function$;

revoke all on function public.lk_spara_mote(uuid, uuid, date, time, integer, text, text, text, text, uuid[], uuid[], integer, boolean, text, boolean) from public, anon, authenticated;
grant execute on function public.lk_spara_mote(uuid, uuid, date, time, integer, text, text, text, text, uuid[], uuid[], integer, boolean, text, boolean) to service_role;
