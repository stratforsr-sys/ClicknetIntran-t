-- Möten-statistiken, B1: utgående samtal per säljare och vecka.
--
-- Definitionen kommer från delar/moten/DESIGN.md §4: ett samtal är ett
-- UTGÅENDE samtal (`direction = 'ut'`), utan villkor på talk_seconds.
--
-- Skälet är att Lynes inte säger om samtalet besvarades. `outcome` är alltid
-- 'okant', och `talk_seconds` är inte taltid utan fönstret startTime–endTime
-- (lika med duration_seconds på alla rader). Fördelningen ger ingen naturlig
-- gräns: 23 % av samtalen är under 5 s, 38 % under 10 s, och ringtiden
-- fastnar inte vid 20–40 s. En gräns på talk_seconds går att lägga till här
-- senare, i where-villkoret nedan, utan att något annat behöver ändras.
-- Samtal utan känd säljare (`employee_id is null`, ännu inte kopplade via
-- `phone_identity`) tas inte med.
--
-- `vecka` är måndagen, räknad på svensk tid: tidszonen byts före
-- trunkeringen, så ett samtal söndag 23:30 UTC (vinter) är måndag 00:30 i
-- Stockholm och hör till den nya veckan, och omställningarna följer med.
--
-- VARFÖR EN SECURITY DEFINER-FUNKTION OCH INTE EN VY
--
-- En vy med security_invoker läser `phone_call` genom `phone_call_read`, som
-- anropar `leads_employee(employee_id)` per rad: en chefsläsning tog cirka 2 s
-- mot cirka 12 ms utan RLS. Och policyn släpper igenom fler än den här
-- statistiken ska visa: den som är manager_id eller teamledare för säljaren
-- (leads_employee) och samtal som hör till en synlig order. Omvänt når rollen
-- admin ensam inte kollegors samtal via policyn, men ska enligt DESIGN 5.7 se
-- chefens vy.
--
-- Funktionen kontrollerar därför själv: den inloggade tas ur
-- `current_employee_id()` (aldrig ur ett argument), kastar fel om ingen
-- anställd är inloggad, och släpper bara igenom den egna raden eller rollerna
-- team_lead, sales_manager, ceo och admin. Tidsfönstret är skrivet så att
-- indexet på `started_at` kan användas. p_till är inräknad, hela svenska dygnet.
--
-- Rättigheter: bara authenticated får köra den. Den är SECURITY DEFINER och
-- står därför i TILLATNA i tests/rattigheter-db.mjs.

drop view if exists public.mote_samtal_vecka;

create or replace function public.mote_samtal_vecka(p_fran date, p_till date)
  returns table (employee_id uuid, vecka date, antal int)
  language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_jag uuid := public.current_employee_id();
  v_alla boolean;
begin
  if v_jag is null then
    raise exception 'Ingen inloggad anställd.' using errcode = '42501';
  end if;
  v_alla := public.has_any_role(array['team_lead', 'sales_manager', 'ceo', 'admin']);

  return query
  select pc.employee_id,
         date_trunc('week', pc.started_at at time zone 'Europe/Stockholm')::date as vecka,
         count(*)::int as antal
    from public.phone_call pc
   where pc.direction = 'ut'
     and pc.employee_id is not null
     and pc.started_at >= (p_fran::timestamp at time zone 'Europe/Stockholm')
     and pc.started_at <  ((p_till + 1)::timestamp at time zone 'Europe/Stockholm')
     and (v_alla or pc.employee_id = v_jag)
   group by pc.employee_id, date_trunc('week', pc.started_at at time zone 'Europe/Stockholm')::date;
end;
$$;

comment on function public.mote_samtal_vecka(date, date) is
  'Utgående samtal per säljare och vecka (måndagen, svensk tid) i [p_fran, p_till]. '
  'Säljaren får sin egen rad, team_lead/sales_manager/ceo/admin alla. DESIGN §4.';

revoke all on function public.mote_samtal_vecka(date, date) from public, anon;
grant execute on function public.mote_samtal_vecka(date, date) to authenticated;
