-- =============================================================================
-- 0268_moten_radera.sql — Möten: radera ett möte (mote_radera)
--
-- -----------------------------------------------------------------------------
-- VARFÖR
-- -----------------------------------------------------------------------------
--
-- Beställaren, 2026-11-01: den som lagt till ett möte ska kunna radera det
-- (fel bolag, dubblett, bokat av misstag). Tavlans tre lager hänger ihop, så
-- ett möte kan inte bara raderas rakt av:
--
--   * Är det kedjans enda möte blir kedjan ett tomt kort på tavlan. Kedjan ska
--     då bort, och med den bolaget om bolaget inte har någon annan kedja
--     (öppen eller stängd). Annars ligger ett bolag kvar utan något möte.
--   * Finns det andra möten kvar måste kedjans `deltagare` räknas om.
--     Triggern `mote_efter_andring` (0260) kan bara lägga till deltagare, aldrig
--     ta bort. Utan omräkningen ser den som bokade det raderade mötet kedjan
--     på tavlan (RLS: deltagare) trots att hen inte längre har något i den.
--   * Två raderingar eller en radering och ett utfall får inte korsa varandra.
--
-- Allt det ligger i en funktion, så att det sker i en och samma transaktion.
-- Rutten (`POST /nav2/moten`, handlingen `radera`) prövar rättigheten i
-- TypeScript (`farRadera`) och anropar bara den här funktionen.
--
-- -----------------------------------------------------------------------------
-- VAD FUNKTIONEN GÖR
-- -----------------------------------------------------------------------------
--
-- mote_radera(p_mote uuid, p_bara_oppet boolean) returns jsonb
--
--   1. Hämtar mötets kedja. Finns mötet inte returneras null.
--   2. Låser kedjan och sedan bolaget (`for update`, samma ordning som
--      triggrarna), så att två raderingar i samma kedja går i tur och ordning
--      och räknar på samma underlag. En bokning i kedjan, eller en ny kedja på
--      bolaget, väntar också (främmande nyckeln tar ett lås på raden den pekar
--      på), och får fel om raden hunnit försvinna.
--   3. Raderar mötet. `p_bara_oppet` är rutten som säger "bara om mötet
--      fortfarande saknar utfall": hann någon sätta ett utfall under tiden
--      raderas ingen rad och svaret är null (rutten svarar 409). En säljchef
--      som raderar ett avslutat möte skickar false.
--   4. Finns inga möten kvar i kedjan raderas kedjan, och finns inga kedjor
--      kvar på bolaget raderas bolaget.
--   5. Finns möten kvar sätts `deltagare` om till de distinkta `bokat_av` och
--      `halls_av` ur de kvarvarande mötena.
--   6. Svaret: { kedja, bolag, kedja_borta, bolag_borta }.
--
-- Bolagets `senast_handelse` (grunden för gallringen, `gallring.ts`) rörs inte
-- av en radering. Omräkningen av `deltagare` är en update på mote_kedja, och
-- den utlöser `mote_kedja_efter_andring` som sätter senast_handelse till now().
-- Funktionen sätter tillbaka det gamla värdet: att ett möte raderas är ingen
-- händelse hos kunden och får inte förlänga hur länge bolaget sparas.
--
-- -----------------------------------------------------------------------------
-- RÄTTIGHETER (0240)
-- -----------------------------------------------------------------------------
--
-- security definer, så att den kör som ägaren, och `search_path` satt. Bara
-- rutten, som kör som service role, får anropa den: revoke från public, anon
-- och authenticated, grant till service_role. 0240 har stängt förvalet, så
-- granten till service_role behövs. En inloggad användare kan alltså aldrig
-- radera ett möte genom att anropa funktionen direkt; rättigheten (bokaren eller
-- en säljchef) finns bara i rutten. Provet: tests/moten-db.mjs.
-- =============================================================================

create or replace function public.mote_radera(p_mote uuid, p_bara_oppet boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
       set deltagare = coalesce((
             select array_agg(distinct p)
               from (
                 select bokat_av as p from public.mote where kedja_id = v_kedja
                 union
                 select halls_av as p from public.mote where kedja_id = v_kedja
               ) d
           ), '{}')
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
$$;

revoke all on function public.mote_radera(uuid, boolean) from public, anon, authenticated;
grant execute on function public.mote_radera(uuid, boolean) to service_role;
