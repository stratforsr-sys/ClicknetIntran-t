-- =============================================================================
-- 0286_moten_kollegor_deltagare.sql — Möten: kollegorna på ett möte är med i
-- kedjan och ser kortet
--
-- -----------------------------------------------------------------------------
-- VARFÖR (beställaren 2026-11-04)
-- -----------------------------------------------------------------------------
--
-- "Den som bokar mötet och den som håller i det ska ha mötet i sin mötesvy,
-- och lägger man till en kollega ska den också ha mötet. Alla ska kunna göra
-- samma saker med mötet."
--
-- Läsrätten på tavlan är `mote_kedja.deltagare` (RLS i 0260, vyn `mote_kort`).
-- Triggern `mote_efter_andring` lade bara in `bokat_av` och `halls_av`.
-- Kollegorna (2cb2557) står bara som deltagare i kalenderhändelsen
-- (`calendar_attendee`), så en tillagd kollega såg mötet i Kalendern men inte
-- i Möten. 2026-11-04 gällde det Göteborgs Premium Flytt: Mick var med i
-- kalendern, men inte i kedjans deltagare, och hans tavla visade tre kort av fyra.
--
-- Rättigheterna per möte (bekräfta, flytta, ändra, sätta utfall, radera)
-- prövas i TypeScript (`farSe`, `farSattaUtfall`, `farRadera` i motenforma.ts)
-- mot samma krets: bokaren, hållaren och kollegorna.
--
-- -----------------------------------------------------------------------------
-- VAD FILEN GÖR
-- -----------------------------------------------------------------------------
--
-- 1. `mote_kedja_deltagare(kedja)`: regeln på ETT ställe. De som är med i en
--    kedja är de som bokat eller hållit något av dess möten, och kollegorna i
--    mötenas kalenderhändelser.
-- 2. `mote_efter_andring` (0260) lägger också till mötets kollegor. Byter
--    mötet kalenderhändelse (bokningen kopplar den efteråt, eller händelsen
--    försvinner) räknas kedjan om i stället.
-- 3. En ny trigger på `calendar_attendee`: en kollega som läggs till i ett
--    mötes händelse läggs till i kedjan. En som tas bort (Ändra, Ångra i
--    Kalendern) gör att kedjan räknas om, så att den som inte är med längre
--    inte ser kortet. Det gäller alla vägar som skriver deltagare (`lk_*`).
-- 4. `mote_radera` (0268) räknar om med samma regel. Förr glömde den kollegorna.
-- 5. De kedjor som redan finns fylls på. Ingen tas bort (kontrollerat
--    2026-11-04: dagens deltagare är en delmängd av regeln i alla fyra kedjor).
--
-- Att lägga till är säkert när två ändringar sker samtidigt. Att räkna om är
-- det inte helt (båda läser före den andra skrivit), så det görs bara när
-- någon ska bort. Omkörbar.
-- =============================================================================

-- 1. Regeln.
create or replace function public.mote_kedja_deltagare(p_kedja uuid)
returns uuid[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(distinct d.p order by d.p), '{}')
    from (
      select m.bokat_av as p from public.mote m where m.kedja_id = p_kedja
      union
      select m.halls_av from public.mote m where m.kedja_id = p_kedja
      union
      select a.employee_id
        from public.mote m
        join public.calendar_attendee a on a.event_id = m.event_id
       where m.kedja_id = p_kedja and a.employee_id is not null
    ) d;
$$;

revoke all on function public.mote_kedja_deltagare(uuid) from public, anon, authenticated;
grant execute on function public.mote_kedja_deltagare(uuid) to service_role;

-- Triggern på calendar_attendee slår upp mötet på händelsen vid varje ändring i Kalendern.
create index if not exists mote_event_id_idx on public.mote (event_id);

-- 2. Efter insert eller update på mote: bokaren, hållaren och kollegorna in i kedjan.
create or replace function public.mote_efter_andring()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_ny_handelse boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_ny_handelse := new.event_id is distinct from old.event_id;
  end if;

  if v_ny_handelse then
    update public.mote_kedja k
       set deltagare = d.ny
      from (select public.mote_kedja_deltagare(new.kedja_id) as ny) d
     where k.id = new.kedja_id
       and not (k.deltagare @> d.ny and d.ny @> k.deltagare);
  else
    update public.mote_kedja k
       set deltagare = (
             select coalesce(array_agg(distinct p), '{}')
             from unnest(k.deltagare || n.med) as p
           )
      from (
        select array[new.bokat_av, new.halls_av] || coalesce((
                 select array_agg(a.employee_id)
                   from public.calendar_attendee a
                  where a.event_id = new.event_id and a.employee_id is not null
               ), '{}') as med
      ) n
     where k.id = new.kedja_id
       and not (k.deltagare @> n.med);
  end if;

  update public.mote_bolag b
     set senast_handelse = now()
    from public.mote_kedja k
   where k.id = new.kedja_id and b.id = k.bolag_id;

  return null;
end;
$$;

-- 3. En kollega in i eller ut ur ett mötes kalenderhändelse.
create or replace function public.mote_narvaro_efter_andring()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op <> 'DELETE' then
    if new.employee_id is not null and new.event_id is not null then
      update public.mote_kedja k
         set deltagare = (
               select coalesce(array_agg(distinct p), '{}')
               from unnest(k.deltagare || new.employee_id) as p
             )
        from public.mote m
       where m.event_id = new.event_id
         and k.id = m.kedja_id
         and not (new.employee_id = any (k.deltagare));
    end if;
  end if;

  if tg_op <> 'INSERT' then
    if old.employee_id is not null and old.event_id is not null then
      update public.mote_kedja k
         set deltagare = d.ny
        from public.mote m
        cross join lateral (select public.mote_kedja_deltagare(m.kedja_id) as ny) d
       where m.event_id = old.event_id
         and k.id = m.kedja_id
         and not (k.deltagare @> d.ny and d.ny @> k.deltagare);
    end if;
  end if;

  return null;
end;
$$;

revoke all on function public.mote_narvaro_efter_andring() from public, anon, authenticated;

drop trigger if exists mote_narvaro_efter_andring on public.calendar_attendee;
create trigger mote_narvaro_efter_andring
  after insert or delete or update of event_id, employee_id on public.calendar_attendee
  for each row execute function public.mote_narvaro_efter_andring();

-- 4. Raderingen räknar om med samma regel.
create or replace function public.mote_radera(p_mote uuid, p_bara_oppet boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_kedja       uuid;
  v_bolag       uuid;
  v_senast      timestamptz;
  v_raderade    int;
  v_kedja_borta boolean := false;
  v_bolag_borta boolean := false;
begin
  select kedja_id into v_kedja from public.mote where id = p_mote;
  if v_kedja is null then
    return null;
  end if;

  -- Kedjan låses före raderingen. Är den redan borta (en annan radering hann före) finns inget att göra.
  select bolag_id into v_bolag from public.mote_kedja where id = v_kedja for update;
  if v_bolag is null then
    return null;
  end if;
  -- Bolaget låses också, i samma ordning som triggrarna (kedjan, sedan bolaget). En ny kedja på bolaget
  -- väntar då på raderingen och får fel om bolaget försvann, i stället för att tas med i kaskaden; och
  -- återställningen av senast_handelse skriver inte över en samtidig bokning.
  perform 1 from public.mote_bolag where id = v_bolag for update;

  delete from public.mote where id = p_mote and (not p_bara_oppet or utfall is null);
  get diagnostics v_raderade = row_count;
  if v_raderade = 0 then
    return null;
  end if;

  if not exists (select 1 from public.mote where kedja_id = v_kedja) then
    delete from public.mote_kedja where id = v_kedja;
    v_kedja_borta := true;
    if not exists (select 1 from public.mote_kedja where bolag_id = v_bolag) then
      delete from public.mote_bolag where id = v_bolag;
      v_bolag_borta := true;
    end if;
  else
    select senast_handelse into v_senast from public.mote_bolag where id = v_bolag;
    update public.mote_kedja
       set deltagare = public.mote_kedja_deltagare(v_kedja)
     where id = v_kedja;
    update public.mote_bolag set senast_handelse = v_senast where id = v_bolag;
  end if;

  return jsonb_build_object(
    'kedja', v_kedja,
    'bolag', v_bolag,
    'kedja_borta', v_kedja_borta,
    'bolag_borta', v_bolag_borta
  );
end;
$function$;

revoke all on function public.mote_radera(uuid, boolean) from public, anon, authenticated;
grant execute on function public.mote_radera(uuid, boolean) to service_role;

-- 5. Kedjorna som redan finns: lägg till dem som saknas, ta inte bort någon.
update public.mote_kedja k
   set deltagare = (
         select coalesce(array_agg(distinct p), '{}')
         from unnest(k.deltagare || public.mote_kedja_deltagare(k.id)) as p
       )
 where not (k.deltagare @> public.mote_kedja_deltagare(k.id));
