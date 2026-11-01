-- Möten-statistiken, varv 3: ett samtal räknas först från 5 minuter.
--
-- Beställaren, 2026-11-01: bara samtal på minst 5 minuter ska räknas. Till
-- dess räknade `mote_samtal_vecka` (0263, kretsen i 0264) varje utgående
-- samtal, också de som bröts efter några sekunder eller inte blev besvarade.
-- Talet Samtal, och med det "Bokade per 100 samtal", mätte då uppringningar
-- och inte samtal.
--
-- VAD SOM ÄNDRAS
--
-- Ett enda villkor läggs till i frågan: `pc.duration_seconds >= 300`. Gränsen
-- ingår, ett samtal på exakt 300 s räknas. Ett samtal utan känd längd
-- (`duration_seconds` är null) räknas inte, eftersom null >= 300 inte är sant.
-- Resten av funktionen är tecken för tecken densamma som i 0264: kretsen
-- (`mote_statkrets()`), fönstret [p_fran, p_till] på svenska dygn, veckan på
-- svensk tid, `security definer`, `search_path`, revoke och grant.
-- `mote_statkrets()` rörs inte.
--
-- SAMMA GRÄNS PÅ TVÅ STÄLLEN
--
-- 300 står också som `SAMTAL_MIN_SEK` i `src/lib/nav2/motesstatforma.ts`.
-- Rutten (`/nav2/moten`, handlingen `samtal`) använder konstanten i listan
-- under talet, så att listan har samma rader som talet. Provet
-- `tests/motesstat-db.mjs` jämför konstanten med den här filens text. Ändras
-- gränsen ska båda ändras, och en ny migration skrivas (denna körs en gång).
--
-- SIGNATUREN ÄR OFÖRÄNDRAD
--
-- Samma tre kolumner, samma rättigheter. Bara kroppen är omskriven, så md5 i
-- `mote_samtal_vecka(date,date)`-raden i TILLATNA (rattigheter-db.mjs) byts.
--
-- Rättigheter: bara authenticated får köra funktionen.

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
     and pc.duration_seconds >= 300
     and pc.employee_id is not null
     and pc.started_at >= (p_fran::timestamp at time zone 'Europe/Stockholm')
     and pc.started_at <  ((p_till + 1)::timestamp at time zone 'Europe/Stockholm')
     and (v_krets is null or pc.employee_id = any(v_krets))
   group by pc.employee_id, date_trunc('week', pc.started_at at time zone 'Europe/Stockholm')::date;
end;
$$;

comment on function public.mote_samtal_vecka(date, date) is
  'Utgående samtal på minst 5 minuter (300 s) per säljare och vecka (måndagen, svensk tid) i [p_fran, p_till], för de '
  'personer mote_statkrets() släpper igenom: sales_manager/ceo/admin alla, team_lead sitt team, '
  'säljaren sig själv. DESIGN §4.';

revoke all on function public.mote_samtal_vecka(date, date) from public, anon;
grant execute on function public.mote_samtal_vecka(date, date) to authenticated;
