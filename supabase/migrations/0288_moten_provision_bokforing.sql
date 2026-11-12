-- =============================================================================
-- 0288_moten_provision_bokforing.sql — Möten: låsningen, ändringen i efterhand
-- och rättelsen i huvudboken, var och en i EN transaktion
--
-- -----------------------------------------------------------------------------
-- VARFÖR (granskningen av uppgift 6, 2026-11-12)
-- -----------------------------------------------------------------------------
--
-- I första versionen skrev TypeScript mötet, raderna och rättelseposten i tre
-- steg. Föll bokföringen efter att mötet låsts var mötet låst men rättelsen
-- för en fastställd månad aldrig bokförd, och ingen omkörning hittade den.
-- Föll den efter att en rad fått sitt nya belopp läste en omkörning det nya
-- beloppet som det gamla och fick skillnaden noll. Pengar kunde alltså
-- försvinna tyst.
--
-- Här blir varje väg en funktion, och allt i den sker i en transaktion:
--
-- 1. `mote_las_provision`: nivån (eller låstiden för ett tappat möte), raderna
--    och rättelsen för en fastställd månad. Ersätter 0287:s version med fem
--    argument, som inte bokförde något.
-- 2. `mote_andra_provision`: en ändring i efterhand (en admin bedömer om, eller
--    rättar utfallet). Mötet, raderna (`version + 1`, nytt belopp, beslutet
--    efter Ifrågasätt) och rättelsen. Skillnaden räknas ur radens belopp i
--    databasen, under radlås, aldrig ur något anroparen läst.
-- 3. `mote_bokfor_rattelse`: hjälpen båda använder. Inte körbar utifrån.
--
-- Båda är villkorade på läget de ändrar från och ger P0409 annars. Ett fel
-- någonstans (ett ogiltigt belopp, en stängd innevarande månad) rullar
-- tillbaka allt: mötet står kvar som det var och kan låsas om.
--
-- Innevarande månad och rättelsens text räknas i TypeScript (tidszonen är en
-- inställning, motesflode.ts) och kommer in som argument. Funktionerna gör
-- bara de atomära skrivningarna. Beloppen räknas också där, ur raderna.
--
-- Additiv: ingen kod på main anropar funktionerna ännu. Omkörbar.
-- =============================================================================

-- 3. Rättelsen (först, de andra anropar den).
create or replace function public.mote_bokfor_rattelse(
  p_mote uuid, p_employee uuid, p_manad date, p_version int, p_belopp numeric,
  p_innevarande date, p_note text, p_av uuid
)
returns date
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Nollskillnad bokförs inte.
  if p_belopp is null or p_belopp = 0 then
    return null;
  end if;
  -- En öppen månad räknas live ur raderna av provisionsmotorn: ingen post.
  if not exists (
    select 1 from public.commission_period
     where period_month = p_manad and status in ('faststalld', 'utbetald')
  ) then
    return null;
  end if;
  if p_innevarande is null or p_innevarande <> date_trunc('month', p_innevarande)::date then
    raise exception 'Innevarande månad saknas eller är inte den 1:a'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.commission_period
     where period_month = p_innevarande and status in ('faststalld', 'utbetald')
  ) then
    raise exception 'Både % och % är fastställda: rättelsen har ingen öppen månad att landa i', p_manad, p_innevarande
      using errcode = 'P0422';
  end if;
  -- Samma rättelse (mötet, personen, versionen) bokförs en gång, också om den
  -- körs om en senare månad: referensen börjar med månaden, så den jämförs på slutet.
  if exists (
    select 1 from public.commission_entry
     where employee_id = p_employee
       and source = 'motor'
       and external_ref like '%:rattelse:mote:' || p_mote::text || ':v' || p_version::text
  ) then
    return null;
  end if;
  insert into public.commission_entry (employee_id, period_month, amount, kind, source, external_ref, note, entered_by)
  values (
    p_employee, p_innevarande, p_belopp, 'rattelse', 'motor',
    to_char(p_innevarande, 'YYYY-MM-DD') || ':' || p_employee::text || ':rattelse:mote:' || p_mote::text || ':v' || p_version::text,
    p_note, p_av
  );
  return p_innevarande;
end;
$$;

-- Ingen utifrån, inte heller service role: rättelsen bokförs bara inifrån de två funktionerna nedan.
revoke all on function public.mote_bokfor_rattelse(uuid, uuid, date, int, numeric, date, text, uuid) from public, anon, authenticated, service_role;

-- 1. Låsningen. 0287:s version med fem argument bokförde ingenting; den tas bort så att det finns en väg.
drop function if exists public.mote_las_provision(uuid, text, jsonb, uuid, jsonb);

create or replace function public.mote_las_provision(
  p_mote uuid, p_niva text, p_svar jsonb, p_av uuid, p_rader jsonb, p_innevarande date, p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_antal int;
  v_rad record;
  v_manad date;
  v_bokfort jsonb := '[]'::jsonb;
begin
  if p_niva is not null then
    update public.mote
       set niva = p_niva, niva_svar = p_svar, niva_nar = now(), niva_av = p_av, provision_last_nar = now()
     where id = p_mote and niva is null and provision_last_nar is null and utfall = 'hallet';
  else
    -- Ett tappat möte (uteblev, avbokat): bara raderna och låstiden.
    update public.mote
       set provision_last_nar = now()
     where id = p_mote and provision_last_nar is null and utfall is not null and utfall <> 'hallet';
  end if;
  get diagnostics v_antal = row_count;
  if v_antal = 0 then
    raise exception 'Mötets provision är redan låst, eller mötet har inte det utfallet'
      using errcode = 'P0409';
  end if;

  -- Utan `on conflict`: finns en rad redan för ett olåst möte är något fel, och då ska inget sparas.
  insert into public.mote_provision
    (mote_id, employee_id, niva, belopp, mojligt, skal, satser, delat_med, del, manad, last_av)
  select p_mote, r.employee_id, r.niva, r.belopp, r.mojligt, r.skal, r.satser, r.delat_med, r.del, r.manad, p_av
    from jsonb_to_recordset(coalesce(p_rader, '[]'::jsonb))
      as r(employee_id uuid, niva text, belopp numeric, mojligt numeric, skal text, satser jsonb, delat_med uuid, del text, manad date);

  -- Rättelsen mot noll för en fastställd månad (version 1).
  for v_rad in select employee_id, manad, belopp, version from public.mote_provision where mote_id = p_mote loop
    v_manad := public.mote_bokfor_rattelse(p_mote, v_rad.employee_id, v_rad.manad, v_rad.version, v_rad.belopp, p_innevarande, p_note, p_av);
    if v_manad is not null then
      v_bokfort := v_bokfort || to_jsonb(v_manad::text);
    end if;
  end loop;
  return jsonb_build_object('bokfort', v_bokfort);
end;
$$;

revoke all on function public.mote_las_provision(uuid, text, jsonb, uuid, jsonb, date, text) from public, anon, authenticated;
grant execute on function public.mote_las_provision(uuid, text, jsonb, uuid, jsonb, date, text) to service_role;

-- 2. Ändringen i efterhand.
create or replace function public.mote_andra_provision(
  p_mote uuid, p_fran_utfall text, p_fran_niva_nar timestamptz,
  p_utfall text, p_niva text, p_svar jsonb, p_av uuid, p_rader jsonb,
  p_innevarande date, p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_antal int;
  v_rad record;
  v_fore numeric;
  v_manad date;
  v_bokfort jsonb := '[]'::jsonb;
begin
  -- Ett hållet möte har en nivå, ett tappat har ingen.
  if (p_utfall = 'hallet') <> (p_niva is not null) then
    raise exception 'Ett hållet möte behöver en nivå, ett tappat möte har ingen' using errcode = '22023';
  end if;

  update public.mote
     set utfall = p_utfall,
         niva = p_niva,
         niva_svar = case when p_niva is null then null else p_svar end,
         niva_nar = case when p_niva is null then null else now() end,
         niva_av = case when p_niva is null then null else p_av end,
         resultat = case when p_utfall = 'hallet' then resultat end,
         resultat_nar = case when p_utfall = 'hallet' then resultat_nar end,
         resultat_av = case when p_utfall = 'hallet' then resultat_av end,
         nej_skal = case when p_utfall = 'hallet' then nej_skal end
   where id = p_mote
     and provision_last_nar is not null
     and utfall = p_fran_utfall
     and niva_nar is not distinct from p_fran_niva_nar;
  get diagnostics v_antal = row_count;
  if v_antal = 0 then
    raise exception 'Mötet har ändrats under tiden, eller provisionen är inte låst' using errcode = 'P0409';
  end if;

  -- Varje låst rad ska vara med, med den version anroparen räknade på.
  if (select count(*) from public.mote_provision where mote_id = p_mote) <> jsonb_array_length(coalesce(p_rader, '[]'::jsonb)) then
    raise exception 'Mötets provisionsrader har ändrats under tiden' using errcode = 'P0409';
  end if;

  for v_rad in
    select * from jsonb_to_recordset(coalesce(p_rader, '[]'::jsonb))
      as r(employee_id uuid, version int, niva text, belopp numeric, mojligt numeric, skal text)
  loop
    select belopp, manad into v_fore, v_manad
      from public.mote_provision
     where mote_id = p_mote and employee_id = v_rad.employee_id and version = v_rad.version
       for update;
    if not found then
      raise exception 'Mötets provisionsrad har ändrats under tiden' using errcode = 'P0409';
    end if;
    update public.mote_provision
       set niva = v_rad.niva,
           belopp = v_rad.belopp,
           mojligt = v_rad.mojligt,
           skal = v_rad.skal,
           version = version + 1,
           beslut_nar = case when ifragasatt_nar is not null and beslut_nar is null then now() else beslut_nar end,
           beslut_av = case when ifragasatt_nar is not null and beslut_nar is null then p_av else beslut_av end
     where mote_id = p_mote and employee_id = v_rad.employee_id and version = v_rad.version;
    v_manad := public.mote_bokfor_rattelse(p_mote, v_rad.employee_id, v_manad, v_rad.version + 1, v_rad.belopp - v_fore, p_innevarande, p_note, p_av);
    if v_manad is not null then
      v_bokfort := v_bokfort || to_jsonb(v_manad::text);
    end if;
  end loop;
  return jsonb_build_object('bokfort', v_bokfort);
end;
$$;

revoke all on function public.mote_andra_provision(uuid, text, timestamptz, text, text, jsonb, uuid, jsonb, date, text) from public, anon, authenticated;
grant execute on function public.mote_andra_provision(uuid, text, timestamptz, text, text, jsonb, uuid, jsonb, date, text) to service_role;
