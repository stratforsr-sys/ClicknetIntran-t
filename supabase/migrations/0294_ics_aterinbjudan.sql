-- Utkorgen (2026-11-13): en gäst som tagits bort ur ett möte och läggs tillbaka får en ny inbjudan.
--
-- `lk_ics_ko` köar kalenderfilen med nyckeln ics:<händelse>:<sekvens>:<metod>:<adress> och `on conflict do nothing`.
-- Nyckeln stoppar dubbletter (samma inbjudan köad två gånger: `lead_bjud_in` och triggern `calendar_attendee_ics`
-- köar båda), men den stoppade också det som inte är en dubblett: en gäst som tas bort (CANCEL) och läggs tillbaka
-- på samma tid fick ingen ny inbjudan, eftersom den nya raden fick samma nyckel som den första. Kalendern visade
-- gästen som inbjuden; gästens egen kalender hade mötet struket. Provat skarpt 2026-11-13 (Möten, Ändra).
--
-- Nu avgör det senaste brevet till adressen på samma sekvens: samma metod igen är en dubblett och köas inte. Det
-- motsatta (borttagen och tillbaka, eller tillbaka och borttagen igen) köas, med den vanliga nyckeln om den är
-- ledig och annars med ett löpnummer efter.
-- Sekvensen höjs inte: en högre sekvens hade fått triggern `calendar_event_ics` att skicka en ny inbjudan till alla
-- gäster. Kalenderfilens DTSTAMP är tiden då brevet byggs, så den nya inbjudan är nyare än avbokningen.
--
-- Bara funktionen och ett index; ingen tabell ändras. Koden före ändringen anropar funktionen likadant.

create index if not exists outbox_ics_event_idx on public.outbox (event_id) where kind = 'ics';

create or replace function public.lk_ics_ko(p_event uuid, p_epost text, p_metod text)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_seq    int;
  v_id     bigint;
  v_epost  text := lower(p_epost);
  v_nyckel text;
  v_forra  text;
  v_antal  int;
begin
  if p_epost is null or p_metod not in ('REQUEST','CANCEL') then
    return null;
  end if;
  select ics_sequence into v_seq from calendar_event where id = p_event;
  if v_seq is null then
    return null;
  end if;

  v_nyckel := 'ics:' || p_event::text || ':' || v_seq || ':' || p_metod || ':' || v_epost;

  -- Det senaste brevet till adressen på den här sekvensen, och hur många som köats.
  select o.payload->>'metod', count(*) over ()
    into v_forra, v_antal
    from outbox o
   where o.event_id = p_event
     and o.kind = 'ics'
     and o.payload->>'epost' = v_epost
     and o.payload->>'sekvens' = v_seq::text
   order by o.id desc
   limit 1;
  -- Samma sorts brev som det senaste är en dubblett. Annars den vanliga nyckeln, och ett löpnummer bara när den
  -- redan är tagen (gästen har fått just det här brevet förut, före det motsatta).
  if v_forra = p_metod then
    return null;
  end if;
  if exists (select 1 from outbox where idempotency_key = v_nyckel) then
    v_nyckel := v_nyckel || ':' || (v_antal + 1);
  end if;

  insert into outbox (kind, payload, idempotency_key, event_id)
  values (
    'ics',
    jsonb_build_object('event_id', p_event, 'epost', v_epost, 'sekvens', v_seq, 'metod', p_metod),
    v_nyckel,
    p_event
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  if v_id is not null then
    perform set_config('lk.ics', coalesce(nullif(current_setting('lk.ics', true), ''), '') || v_id::text || ',', true);
  end if;
  return v_id;
end;
$function$;

-- Som förut: bara servern (och triggrarna, som körs som ägaren).
revoke all on function public.lk_ics_ko(uuid, text, text) from public, anon, authenticated;
grant execute on function public.lk_ics_ko(uuid, text, text) to service_role;
