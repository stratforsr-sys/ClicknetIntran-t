-- =============================================================================
-- 0313_moten_hallare.sql — Möten: vem som håller mötet, och vilket möte en
-- bokning följer på
--
-- Beställaren 2026-11-16: "jag måste typ kunna ändra vem det är som faktiskt
-- ska hålla i mötet och den ska kunna sätta utfallet och sen sätta nästa
-- steg", och "det ska då inte räknas som ett nytt bokat möte när man bokar
-- efter första mötet". Spec: docs/superpowers/specs/2026-11-16-moten-hallare-utfall-design.md
--
-- 1. lk_byt_organisator: ett möte byter organisatör i kalendern (före mötet,
--    när Möten byter hållare). Den nya blir organisatör och tas ur deltagarna
--    (organisatören är aldrig deltagare, som i lk_skapa_mote); den gamla tas
--    bort ur händelsen. KUNDEN RÖRS INTE: externa rader, ics_sequence och
--    utkorgen lämnas orörda (beställarens val 2026-11-16). Notisen skickar
--    Möten själv (källan mote-hallare). Rätten prövas som i lk_spara_mote:
--    lk_far_andra(p_aktor, organisatören). Möten anropar som den gamla
--    hållaren, så en hållare som slutat går också att byta bort.
--
-- 2. mote_foregaende: vilket möte en ny bokning följer på, när klienten inte
--    sa det. Kortets senaste möte (bokningsordning: ett avbokat möte vars tid
--    låg efter den nya räknas också), annars samma kunds senaste avgjorda möte
--    som inte blev av (uteblev, avbokat) på ett annat kort inom p_dagar dagar
--    (inställningen moten.ny-kund-dagar, 0 = av). Ett hållet möte avgörs
--    redan av mote_kunden_traffad (0296) och ger uppföljning.
--
-- 3. mote_art_ratta (jobbet, 0296) rättar nu också ett framtida "ny" som följer
--    på ett tidigare möte (samma regel som bokningen): det blir en ombokning med
--    det mötet som föregående. Täcker en bokning gjord medan databasen inte
--    svarade, och samma kund på ett annat kort vars möte avgjordes efteråt
--    (granskningen 2026-11-16). Fönstret läses ur nav_setting
--    (moten.ny-kund-dagar, 0–365, annars 90).
--
-- Två nya funktioner och en ersatt (mote_art_ratta, samma signatur). Inga
-- tabeller eller rader ändras av migrationen själv. Omkörbar.
-- =============================================================================

create or replace function public.lk_byt_organisator(p_aktor uuid, p_event uuid, p_ny uuid, p_utfort_av uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_e calendar_event;
begin
  select * into v_e from calendar_event where id = p_event for update;
  if not found then raise exception 'lk:finns_inte'; end if;
  if v_e.cancelled_at is not null then raise exception 'lk:installd'; end if;
  if v_e.kind <> 'mote' or v_e.series_id is not null or v_e.occurrence_of is not null then raise exception 'lk:ogiltig'; end if;
  if not public.lk_far_andra(p_aktor, v_e.organizer_id) then raise exception 'lk:behorighet'; end if;
  if p_ny is null or not public.lk_aktiv(p_ny) then raise exception 'lk:ogiltig'; end if;
  if p_ny = v_e.organizer_id then
    return jsonb_build_object('ok', true, 'oforandrad', true);
  end if;

  -- Organisatören är aldrig deltagare; den gamla organisatören lämnar händelsen.
  delete from calendar_attendee where event_id = p_event and employee_id = p_ny;
  update calendar_event set organizer_id = p_ny, updated_at = now() where id = p_event;

  return jsonb_build_object('ok', true, 'fran', v_e.organizer_id, 'till', p_ny, 'av', coalesce(p_utfort_av, p_aktor));
end;
$$;

revoke all on function public.lk_byt_organisator(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.lk_byt_organisator(uuid, uuid, uuid, uuid) to service_role;

-- Den första versionen hade tre argument; den med p_utom ersätter den (ingen överlagring).
drop function if exists public.mote_foregaende(uuid, timestamptz, integer);

-- p_utom: mötet som letar efter sitt föregående (jobbet). Det själv, och möten bokade efter det, räknas inte.
create or replace function public.mote_foregaende(p_kedja uuid, p_fore timestamptz, p_dagar integer, p_utom uuid default null)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select m.id
       from public.mote m
      where m.kedja_id = p_kedja
        and (p_utom is null
             or (m.id <> p_utom and m.bokat_nar < (select u.bokat_nar from public.mote u where u.id = p_utom)))
      order by m.bokat_nar desc, m.id desc
      limit 1),
    (select m.id
       from public.mote m
       join public.mote_kedja k on k.id = m.kedja_id
      where coalesce(p_dagar, 0) > 0
        and m.kedja_id <> p_kedja
        and m.utfall in ('uteblev', 'avbokat')
        and m.mote_tid >= p_fore - make_interval(days => p_dagar)
        -- Bokningsordningen avgör, som på samma kort: ett möte bokat efter det som letar är inget föregående.
        and (p_utom is null or m.bokat_nar < (select u.bokat_nar from public.mote u where u.id = p_utom))
        and k.bolag_id in (select public.mote_kundens_bolag(k2.bolag_id) from public.mote_kedja k2 where k2.id = p_kedja)
      order by m.mote_tid desc, m.id desc
      limit 1)
  )
$$;

revoke all on function public.mote_foregaende(uuid, timestamptz, integer, uuid) from public, anon, authenticated;
grant execute on function public.mote_foregaende(uuid, timestamptz, integer, uuid) to service_role;

-- Jobbet (0296), utökat: först uppföljningar (kunden träffad), sedan ombokningar (ett tidigare möte finns).
create or replace function public.mote_art_ratta()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_antal  integer;
  v_omb    integer;
  v_dagar  integer;
begin
  with r as (
    update public.mote m
       set art = 'uppfoljning'
     where m.utfall is null
       and m.art <> 'uppfoljning'
       and m.mote_tid > now()
       and public.mote_kunden_traffad(m.kedja_id, m.mote_tid)
    returning 1
  )
  select count(*) into v_antal from r;

  select case when jsonb_typeof(s.value) = 'number' and (s.value #>> '{}')::numeric between 0 and 365
                   and (s.value #>> '{}')::numeric = trunc((s.value #>> '{}')::numeric)
              then (s.value #>> '{}')::integer end
    into v_dagar
    from public.nav_setting s where s.key = 'moten.ny-kund-dagar';
  v_dagar := coalesce(v_dagar, 90);

  with f as (
    select m.id, public.mote_foregaende(m.kedja_id, m.mote_tid, v_dagar, m.id) as fore
      from public.mote m
     where m.utfall is null
       and m.art = 'ny'
       and m.foregaende_id is null
       and m.mote_tid > now()
  ), r as (
    update public.mote m
       set art = 'ombokning', foregaende_id = f.fore
      from f
     where m.id = f.id and f.fore is not null
    returning 1
  )
  select count(*) into v_omb from r;
  return v_antal + v_omb;
end;
$$;

revoke all on function public.mote_art_ratta() from public, anon, authenticated;
grant execute on function public.mote_art_ratta() to service_role;
