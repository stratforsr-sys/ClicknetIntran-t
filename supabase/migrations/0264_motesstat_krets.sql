-- Möten-statistiken, varv 2: en teamledare ser bara sitt eget team.
--
-- Beställaren, 2026-10-31: "bara sitt eget team". 0263 släppte igenom
-- team_lead tillsammans med sales_manager, ceo och admin till ALLA säljares
-- samtal, och mötena och kedjorna läses genom RLS, där chefsrollerna ser allt.
-- En ren teamledare ska i stället se sig själv och dem hen leder.
--
-- VAD ETT TEAM ÄR
--
-- Samma sak som resten av navet: `public.leads_employee(target)`, alltså att
-- den inloggade är `manager_id` för personen eller ledare (`team.lead_id`)
-- för personens team. Samma definition gäller i `phone_call_read` och i
-- notiserna, så statistiken visar inte fler eller färre än policyerna.
--
-- KRETSEN
--
-- `mote_statkrets()` svarar på frågan "vems tal får den inloggade se?":
--   - sales_manager, ceo eller admin: null, alltså alla.
--   - team_lead (och ingen av ovanstående): den egna id:n plus alla `e.id`
--     där `leads_employee(e.id)`.
--   - alla andra: bara den egna id:n.
-- Den inloggade tas ur `current_employee_id()`, aldrig ur ett argument, och
-- kastar 42501 om ingen anställd är inloggad, som mote_samtal_vecka.
--
-- Appen (motesstat.ts) hämtar kretsen och begränsar möten, kedjor och personer
-- till den INNAN något räknas eller skickas till klienten, och handlingen
-- `samtal` i rutten använder samma funktion. Ett fel stänger vyn, det öppnar
-- den aldrig. mote_samtal_vecka (nedan) filtrerar med samma krets, så en
-- teamledare får inte heller samtalsraderna för andra team.
--
-- SIGNATUREN ÄR OFÖRÄNDRAD
--
-- `mote_samtal_vecka(date, date)` returnerar samma tre kolumner som i 0263,
-- och är fortfarande SECURITY DEFINER med samma rättigheter, så 0263:s rad i
-- TILLATNA (rattigheter-db.mjs) gäller för funktionen. Bara kroppen är
-- omskriven, så md5 i raden byts (se delat-b.md). `mote_statkrets()` är ny och
-- läggs till som en egen rad.
--
-- Rättigheter: bara authenticated får köra dem.

create or replace function public.mote_statkrets()
  returns uuid[]
  language plpgsql stable security definer set search_path = public
as $$
declare
  v_jag uuid := public.current_employee_id();
begin
  if v_jag is null then
    raise exception 'Ingen inloggad anställd.' using errcode = '42501';
  end if;

  if public.has_any_role(array['sales_manager', 'ceo', 'admin']) then
    return null;
  end if;

  if public.has_any_role(array['team_lead']) then
    return array(
      select v_jag
      union
      select e.id from public.employee e where public.leads_employee(e.id)
    );
  end if;

  return array[v_jag];
end;
$$;

comment on function public.mote_statkrets() is
  'Vems tal i Möten-statistiken den inloggade får se: null = alla (sales_manager/ceo/admin), '
  'en teamledare får sig själv och dem hen leder (leads_employee), alla andra bara sig själv.';

revoke all on function public.mote_statkrets() from public, anon;
grant execute on function public.mote_statkrets() to authenticated;

create or replace function public.mote_samtal_vecka(p_fran date, p_till date)
  returns table (employee_id uuid, vecka date, antal int)
  language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_krets uuid[];
begin
  -- Kastar 42501 om ingen anställd är inloggad, och ger null för chefer som ser alla.
  v_krets := public.mote_statkrets();

  return query
  select pc.employee_id,
         date_trunc('week', pc.started_at at time zone 'Europe/Stockholm')::date as vecka,
         count(*)::int as antal
    from public.phone_call pc
   where pc.direction = 'ut'
     and pc.employee_id is not null
     and pc.started_at >= (p_fran::timestamp at time zone 'Europe/Stockholm')
     and pc.started_at <  ((p_till + 1)::timestamp at time zone 'Europe/Stockholm')
     and (v_krets is null or pc.employee_id = any(v_krets))
   group by pc.employee_id, date_trunc('week', pc.started_at at time zone 'Europe/Stockholm')::date;
end;
$$;

comment on function public.mote_samtal_vecka(date, date) is
  'Utgående samtal per säljare och vecka (måndagen, svensk tid) i [p_fran, p_till], för de '
  'personer mote_statkrets() släpper igenom: sales_manager/ceo/admin alla, team_lead sitt team, '
  'säljaren sig själv. DESIGN §4.';

revoke all on function public.mote_samtal_vecka(date, date) from public, anon;
grant execute on function public.mote_samtal_vecka(date, date) to authenticated;
