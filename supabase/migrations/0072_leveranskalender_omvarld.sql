-- =============================================================================
-- 0072_leveranskalender_omvarld.sql — Leveranskalendern, pass 4 av 4: omvärlden.
--
-- Numret är fråga till `schema_migrations` 2026-10-01: högst var 0071.
--
-- Tre saker, och ingen av dem ändrar en körd migration:
--
--   1. KUNDEN FÅR EN .ics NÄR TIDEN ÄNDRAS. En extern deltagare (kunden på
--      kickoffen) får en rad av sorten `ics` i utkorgen när hon bjuds in, när
--      tiden flyttas och när mötet ställs in. Samma UID hela vägen, SEQUENCE
--      är `calendar_event.ics_sequence`, som 0069 och 0071 redan räknar upp.
--   2. `lk_undo()` ersätts så att de raderna följer med i Ångra.
--   3. `calendar_feed` får en tredje sort, `handelser`: ens egna möten som
--      iCal, bredvid ledighetsflödet. `lk_ical_handelser()` läser dem.
--
-- =============================================================================
-- VARFÖR TRIGGRAR OCH INTE EN RAD I VARJE lk_*-FUNKTION
--
-- Det finns sex vägar som ändrar en händelses tid eller ställer in den
-- (`lk_flytta`, `lk_besluta_forslag`, `lk_stall_in`, `lk_flytta_serie`,
-- `lk_satt_utfall`, och `lk_ny_tid` under dem) och två som skapar en med en
-- extern deltagare (`lk_skapa_leverans`, `lk_kopiera`). Att skriva om alla åtta
-- för att lägga till en rad hade betytt åtta funktioner till i den här filen
-- och åtta ställen att glömma kunden på nästa gång någon lägger till en väg.
--
-- Alla vägarna har en sak gemensam: de räknar upp `ics_sequence` (eller skapar
-- händelsen och deltagaren i samma transaktion). Triggern sitter där.
--
-- =============================================================================
-- ÅNGRA TAR ÄVEN KUNDENS RAD
--
-- Utkorgens rader ska ångras med handlingen (0069). Triggern vet inte vilken
-- ångerrad som kommer att skrivas, så den lägger radens id i en
-- transaktionslokal inställning (`lk.ics`), och `lk_undo()` — som varje
-- ångrabar handling anropar sist — tar med dem i `outbox_ids` och tömmer den.
-- En handling som inte är ångrabar lämnar inställningen orörd, och den dör med
-- transaktionen.
--
-- Ångra själv utlöser aldrig en ny rad: `lk_angra` sätter tillbaka en LÄGRE
-- `ics_sequence` (triggern kräver en högre), och deltagare den lägger tillbaka
-- hör till en händelse som skapades tidigare (triggern kräver att händelsen
-- skapades i samma transaktion).
--
-- Den som tömmer utkorgen kontrollerar dessutom att raden fortfarande gäller —
-- att sekvensen är den aktuella och att mötet inte ställts in under tiden. Två
-- spärrar, för en kund som får en inbjudan till ett möte som inte blir av är
-- det dyraste felet i hela modulen.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Kundens .ics i utkorgen
-- -----------------------------------------------------------------------------

/**
 * En rad av sorten `ics`. Intern: ingen grant.
 *
 * Nyckeln bär sekvensen och metoden, så samma version går aldrig ut två gånger
 * till samma adress.
 */
create or replace function public.lk_ics_ko(p_event uuid, p_epost text, p_metod text)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seq int;
  v_id  bigint;
begin
  if p_epost is null or p_metod not in ('REQUEST','CANCEL') then
    return null;
  end if;
  select ics_sequence into v_seq from calendar_event where id = p_event;
  if v_seq is null then
    return null;
  end if;

  insert into outbox (kind, payload, idempotency_key, event_id)
  values (
    'ics',
    jsonb_build_object('event_id', p_event, 'epost', lower(p_epost), 'sekvens', v_seq, 'metod', p_metod),
    'ics:' || p_event::text || ':' || v_seq || ':' || p_metod || ':' || lower(p_epost),
    p_event
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  if v_id is not null then
    perform set_config('lk.ics', coalesce(nullif(current_setting('lk.ics', true), ''), '') || v_id::text || ',', true);
  end if;
  return v_id;
end;
$$;

/** Ny tid eller inställt: varje extern deltagare får en ny version. */
create or replace function public.calendar_event_ics()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  if new.ics_sequence <= old.ics_sequence then
    return null;
  end if;
  for r in
    select n.external_email from public.lk_narvaro(new.id) n where n.external_email is not null
  loop
    perform public.lk_ics_ko(new.id, r.external_email,
                             case when new.cancelled_at is not null then 'CANCEL' else 'REQUEST' end);
  end loop;
  return null;
end;
$$;
drop trigger if exists calendar_event_ics on calendar_event;
create trigger calendar_event_ics
  after update of ics_sequence on calendar_event
  for each row execute function public.calendar_event_ics();

/**
 * En extern deltagare på en händelse som skapas NU: första inbjudan.
 *
 * `created_at = now()` är samma transaktion. Deltagare som läggs tillbaka av
 * Ångra, eller förs över från en serie av `lk_ny_tid`, hör till en händelse som
 * skapades tidigare och ger ingen rad — där är det ändringen av tiden som
 * skickar den nya versionen.
 */
create or replace function public.calendar_attendee_ics()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.external_email is not null and new.event_id is not null
     and exists (select 1 from calendar_event e
                 where e.id = new.event_id and e.created_at = now() and e.cancelled_at is null) then
    perform public.lk_ics_ko(new.event_id, new.external_email, 'REQUEST');
  end if;
  return null;
end;
$$;
drop trigger if exists calendar_attendee_ics on calendar_attendee;
create trigger calendar_attendee_ics
  after insert on calendar_attendee
  for each row execute function public.calendar_attendee_ics();

-- -----------------------------------------------------------------------------
-- 2. Ångra tar kundens rad (ersätter 0069)
-- -----------------------------------------------------------------------------

create or replace function public.lk_undo(
  p_event uuid, p_series uuid, p_handling text, p_before jsonb, p_outbox bigint[], p_aktor uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ics bigint[];
  v_id  uuid;
begin
  select coalesce(array_agg(x::bigint), '{}') into v_ics
  from unnest(string_to_array(coalesce(current_setting('lk.ics', true), ''), ',')) x
  where x <> '';
  perform set_config('lk.ics', '', true);

  insert into calendar_undo (event_id, series_id, handling, before, outbox_ids, created_by)
  values (p_event, p_series, p_handling, p_before, coalesce(p_outbox, '{}') || v_ics, p_aktor)
  returning id into v_id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. iCal-flödet för händelserna
-- -----------------------------------------------------------------------------

alter table calendar_feed drop constraint if exists calendar_feed_scope_check;
alter table calendar_feed add constraint calendar_feed_scope_check
  check (scope in ('mine','team','handelser'));

/**
 * En persons händelser för iCal-flödet: de hon organiserar och de hon är med på
 * utan att ha tackat nej. Inställda står inte med — de försvinner ur den
 * prenumererande kalendern vid nästa hämtning.
 *
 * Bara det som får lämna navet: rubrik, tid, plats och länk. Inte agendan, inte
 * anteckningarna och inte vilka andra som är med. Flödet är en URL utan
 * inloggning (0021), och det som synkas dit ligger sedan hos Google eller
 * Microsoft.
 *
 * Bara service role: rutten läser med hemlig adress, inte med en inloggning.
 */
create or replace function public.lk_ical_handelser(p_employee uuid, p_fran date, p_till date)
returns table (
  id           uuid,
  kind         text,
  title        text,
  dag          date,
  tid          time,
  minuter      int,
  starts_at    timestamptz,
  plats        text,
  online_url   text,
  ics_sequence int,
  updated_at   timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id, e.kind, e.title, e.dag, e.tid, e.minuter, e.starts_at, e.plats, e.online_url,
         e.ics_sequence, e.updated_at
  from calendar_event e
  where e.dag between p_fran and p_till
    and e.cancelled_at is null
    and (
      e.organizer_id = p_employee
      or exists (select 1 from public.lk_narvaro(e.id) n
                 where n.employee_id = p_employee and n.response <> 'nej')
    )
  order by e.starts_at
  limit 2000;
$$;

-- -----------------------------------------------------------------------------
-- 4. Behörighet
-- -----------------------------------------------------------------------------

do $$
declare
  f text;
begin
  foreach f in array array[
    'lk_ics_ko(uuid, text, text)',
    'calendar_event_ics()',
    'calendar_attendee_ics()',
    'lk_undo(uuid, uuid, text, jsonb, bigint[], uuid)',
    'lk_ical_handelser(uuid, date, date)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Vakter
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['lk_ics_ko','lk_undo','lk_ical_handelser'] loop
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
