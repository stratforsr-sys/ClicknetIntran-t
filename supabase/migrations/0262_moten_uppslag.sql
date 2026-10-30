-- =============================================================================
-- 0262_moten_uppslag.sql — Möten: uppslaget mot Lynes och mot tavlan
--
-- -----------------------------------------------------------------------------
-- VARFÖR
-- -----------------------------------------------------------------------------
--
-- När en säljare ska boka ett möte ringer hon ofta ett bolag som någon annan
-- redan pratat med, eller redan bokat, eller som redan är kund. Dialogen "Boka
-- möte" frågar därför mote_uppslag() med bolagets telefon, domän och namn och
-- får tillbaka tre saker, så att hon ser det innan hon bokar:
--
--   samtal  de senaste samtalen till numret ur Lynes (phone_call), vem som
--           ringde, när, hur länge och åt vilket håll
--   bokat   öppna kedjor på tavlan med ett kommande möte, så att samma bolag
--           aldrig bokas två gånger (unika indexet 0260 stoppar det, det här
--           varnar innan dess)
--   kund    sant om bolaget redan har en kedja som slutat i en affär
--
-- -----------------------------------------------------------------------------
-- VARFÖR SECURITY DEFINER
-- -----------------------------------------------------------------------------
--
-- Svaret ska visa andras samtal och andras bokningar, som RLS på phone_call och
-- mote_kedja döljer för en vanlig säljare. Det är hela poängen med varningen,
-- och därför körs funktionen som ägaren. Det den ger ut är snävt: tre fält per
-- samtal, tre per bokning och en bool. Aktören kommer ur current_employee_id(),
-- aldrig ur ett argument (minnet nav-security-definer-standardrattighet), och
-- utan inloggad anställd kastas ett fel.
--
-- -----------------------------------------------------------------------------
-- ARGUMENT
-- -----------------------------------------------------------------------------
--
-- Rutten POST /nav2/moten normaliserar före anropet; funktionen tar emot det
-- som kommer och gissar ingenting:
--
--   p_telefon  E.164 (+46701234567). Allt som inte matchar ^\+\d{8,15}$
--              ignoreras (samtal: [], ingen träff på telefon), inget fel.
--   p_doman    jämförs som den är mot mote_bolag.doman (rutten har gjort den
--              till gemener utan schema, www. och sökväg).
--   p_namn     minst 3 tecken efter trim, jämförs utan hänsyn till versaler.
--              Kortare namn ignoreras: "AB" ska inte träffa varje bolag.
--
-- Tomma eller null-argument ger tomma listor och kund: false.
--
-- -----------------------------------------------------------------------------
-- RÄTTIGHETER (0240)
-- -----------------------------------------------------------------------------
--
-- Klienten anropar funktionen som inloggad användare: revoke från public och
-- anon, grant execute till authenticated. Vakten tests/rattigheter-db.mjs kräver
-- en rad i TILLATNA för mote_uppslag(text,text,text).
-- =============================================================================

create or replace function public.mote_uppslag(
  p_telefon text,
  p_doman   text,
  p_namn    text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tel   text := case when p_telefon ~ '^\+\d{8,15}$' then p_telefon end;
  v_doman text := nullif(btrim(coalesce(p_doman, '')), '');
  v_namn  text := case when char_length(btrim(coalesce(p_namn, ''))) >= 3
                       then lower(btrim(p_namn)) end;
  v_samtal jsonb;
  v_bokat  jsonb;
  v_kund   boolean;
begin
  if public.current_employee_id() is null then
    raise exception 'Ingen inloggad anställd' using errcode = '42501';
  end if;

  -- Samtal: de 20 senaste till numret, senaste först.
  select coalesce(jsonb_agg(s.rad order by s.nar desc nulls last, s.id), '[]'::jsonb)
    into v_samtal
    from (
      select pc.id,
             pc.started_at as nar,
             jsonb_build_object(
               'vem',      e.first_name || ' ' || e.last_name,
               'nar',      pc.started_at,
               'sek',      pc.talk_seconds,
               'riktning', pc.direction
             ) as rad
        from public.phone_call pc
        left join public.employee e on e.id = pc.employee_id
       where v_tel is not null
         and pc.counterpart_e164 = v_tel
       order by pc.started_at desc nulls last, pc.id
       limit 20
    ) s;

  -- Bokat: öppna kedjor med ett kommande öppet möte, bolaget matchat på
  -- telefon, domän eller namn.
  select coalesce(jsonb_agg(s.rad order by s.mote_tid, s.id), '[]'::jsonb)
    into v_bokat
    from (
      select k.id,
             m.mote_tid,
             jsonb_build_object(
               'namn',          b.namn,
               'mote_tid',      m.mote_tid,
               'halls_av_namn', e.first_name || ' ' || e.last_name
             ) as rad
        from public.mote_kedja k
        join public.mote_bolag b on b.id = k.bolag_id
        join public.mote m on m.kedja_id = k.id and m.utfall is null and m.mote_tid > now()
        left join public.employee e on e.id = m.halls_av
       where k.avslut is null
         and ((v_tel   is not null and b.telefon = v_tel)
           or (v_doman is not null and b.doman = v_doman)
           or (v_namn  is not null and lower(b.namn) = v_namn))
       order by m.mote_tid, k.id
       limit 20
    ) s;

  -- Kund: en kedja som slutat i en affär, samma matchning.
  select exists (
    select 1
      from public.mote_kedja k
      join public.mote_bolag b on b.id = k.bolag_id
     where k.avslut is not distinct from 'affar'
       and ((v_tel   is not null and b.telefon = v_tel)
         or (v_doman is not null and b.doman = v_doman)
         or (v_namn  is not null and lower(b.namn) = v_namn))
  ) into v_kund;

  return jsonb_build_object('samtal', v_samtal, 'bokat', v_bokat, 'kund', v_kund);
end;
$$;

revoke all on function public.mote_uppslag(text, text, text) from public, anon;
grant execute on function public.mote_uppslag(text, text, text) to authenticated, service_role;
