-- 0077 · Radera en order — säkert, i en transaktion (beställaren 2026-10-08)
--
-- =============================================================================
-- VARFÖR EN FUNKTION OCH INTE EN DELETE FRÅN KODEN
--
-- Beställaren: "du måste lägga in så att jag kan redigera ordrarna eller ta bort
-- ordrar". Fram till nu gick bara ett UTKAST att radera, och även det var
-- farligare än det såg ut:
--
--   `file_object.sales_order_id` har ON DELETE CASCADE, och sedan 0056 ligger
--   samtalsinspelningar kopplade till ordern. En raderad order tog alltså med sig
--   registerraden för varje inspelning på den — och eftersom `phone_call`
--   pekar på filen med ON DELETE SET NULL föll hela raderingen på villkoret
--   `phone_call_inspelning` (hamtad ⇔ fil). Ett utkast med samtal gick inte att
--   radera, och felet sa ingenting om varför.
--
-- Funktionen gör stegen i rätt ordning, i en transaktion:
--
--   1. Prövar om ordern FÅR raderas (se nedan). Annars är makulering vägen.
--   2. Lossar samtalen: inspelningarna stannar, får en ny gallringsfrist och kan
--      kopplas till en annan order av svepningen.
--   3. Tar bort väntande Inkio-rader i utkorgen för ordern.
--   4. Raderar ordern. Tjänster, övertäck, leveransrad, uppgiftslänkar och
--      CRM-koppling följer med i kaskad. Avtalsfilernas registerrader följer
--      också med — deras innehåll i lagringen tas bort av anroparen, som får
--      listan i svaret (databasen når inte R2).
--
-- =============================================================================
-- VAD SOM INTE FÅR RADERAS
--
--   • En MAKULERAD order — den är redan ur räkningen, och makuleringen är en
--     händelse i provisionen.
--   • En godkänd order i en FASTSTÄLLD månad — lönen är räknad på den.
--   • En order med bokförda provisionsposter (efterslapning, rättelser, bonus).
--   • En order som finns i INKIO — den ska makuleras, så att Inkio följer med.
--   • En order med leveranshändelser i kalendern.
--   • En order som en annan order pekar på som sin förlängning.
--
-- I alla de fallen är `makuleraOrder` rätt väg, och felmeddelandet säger det.
--
-- =============================================================================
-- TRIGGERN `sales_order_radering` (0034) NEKAR FORTFARANDE ALLT ANNAT
--
-- Den släpper ett utkast som förut, och nu också den order som den här
-- funktionen just prövat — markerad med en transaktionslokal inställning. En
-- DELETE som inte går genom funktionen nekas alltså precis som tidigare.
-- =============================================================================

create or replace function public.sales_order_ar_last()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'utkast' then
    return old;
  end if;

  -- Satt av `radera_order()` i samma transaktion, för just den här ordern.
  if current_setting('nav.radera_order', true) = old.id::text then
    return old;
  end if;

  raise exception 'En order som lamnat utkast raderas bara med Radera pa ordern (radera_order). Makulera den annars.';
end;
$$;

create or replace function public.radera_order(p_order uuid)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  o        record;
  samtal   integer;
  filer    jsonb;
begin
  select id, status, period_month, company_name
    into o
    from sales_order
   where id = p_order
     for update;

  if not found then
    raise exception 'Ordern finns inte.';
  end if;

  if o.status = 'makulerad' then
    raise exception 'En makulerad order raderas inte — den är redan ur räkningen.';
  end if;

  if o.status in ('signerad', 'betald')
     and exists (select 1 from commission_period where period_month = o.period_month) then
    raise exception 'Ordern hör till %, som är fastställd. Makulera den i stället.',
      to_char(o.period_month, 'YYYY-MM');
  end if;

  if exists (select 1 from commission_entry where sales_order_id = p_order) then
    raise exception 'Det finns bokförda provisionsposter på ordern. Makulera den i stället.';
  end if;

  if exists (select 1 from crm_order where order_id = p_order and crm_order_id is not null) then
    raise exception 'Ordern finns i Inkio. Makulera den i stället, så makuleras den där också.';
  end if;

  if exists (select 1 from calendar_event where order_id = p_order) then
    raise exception 'Ordern har leveranshändelser i kalendern. Makulera den i stället.';
  end if;

  if exists (select 1 from sales_order where renewal_order_id = p_order) then
    raise exception 'En annan order pekar på den här som sin förlängning. Makulera den i stället.';
  end if;

  -- Avtalsfilerna, för anroparen att tömma ur lagringen efteråt.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'store', store, 'bucket', bucket, 'path', path, 'filename', filename)), '[]'::jsonb)
    into filer
    from file_object
   where sales_order_id = p_order
     and purpose = 'sales_order';

  -- Samtalen stannar. Filen först, så att den inte följer med i kaskaden.
  update file_object
     set sales_order_id = null
   where sales_order_id = p_order
     and purpose = 'call_recording';

  update phone_call
     set sales_order_id = null,
         order_linked_at = null,
         order_linked_by = null,
         recording_retained_until = case
           when recording_file_id is not null then now() + interval '30 days'
           else null
         end
   where sales_order_id = p_order;
  get diagnostics samtal = row_count;

  delete from outbox
   where kind = 'crm'
     and sent_at is null
     and payload->>'order_id' = p_order::text;

  perform set_config('nav.radera_order', p_order::text, true);
  delete from sales_order where id = p_order;
  perform set_config('nav.radera_order', '', true);

  return jsonb_build_object(
    'status', o.status,
    'bolag', o.company_name,
    'samtal', samtal,
    'filer', filer
  );
end;
$$;

-- Bara servern. En inloggad användare ska inte kunna anropa den via PostgREST.
revoke all on function public.radera_order(uuid) from public;
revoke all on function public.radera_order(uuid) from anon, authenticated;
grant execute on function public.radera_order(uuid) to service_role;
