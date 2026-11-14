-- 0296: ett möte med en kund som redan träffats är ett uppföljningsmöte, också på ett annat kort
-- (beställaren 2026-11-14).
--
-- Bara det första mötet med kunden bekräftas (0295). Vilket möte som är det första avgjordes av kortet:
-- `motesArt` frågade bara om kortets egen kedja hade ett hållet möte, och bolaget känns igen på telefonnumret
-- vid bokningen. ORION CAR AB bokades andra gången med ett annat nummer: Nav skapade ett nytt bolag och ett nytt
-- kort, och mötet blev ett första möte som skulle bekräftas. Mötet bokades dessutom 08:29, medan det första mötet
-- pågick; utfallet sattes 08:48. Så även på samma kort hade bokningen sett ett möte utan utfall.
--
-- Nu:
--   - Samma kund är samma bolag, eller ett bolag med samma namn (utan bolagsform och skiljetecken), samma
--     telefonnummer, samma domän (inte gmail.com och liknande) eller samma e-postadress. Namn, telefon och domän
--     tolkas som säljtavlan gör (`normNamn`, `normTelefon`, `normDoman` i src/lib/salesboard/moten.ts); e-posten
--     är beställarens tillägg.
--   - `mote_kunden_traffad(kedja, tid)`: har kunden ett hållet möte före tiden, på kortet eller på ett annat kort
--     för samma kund? Bokningen frågar den när mötets art sätts.
--   - `mote_art_ratta()`: jobbet (/api/jobb/moten, var kvart) gör ett kommande möte utan utfall till ett
--     uppföljningsmöte när kunden har träffats före det. Det fångar ett möte som bokats innan det förra fick sitt
--     utfall. Städningen (`mote_uppgift_stada`, 0295) tar sedan bort en öppen bekräftelseuppgift på det.
--
-- Arten ändras bara åt ett håll, till uppföljningsmöte. Ett uppföljningsmöte räknas inte som ett nytt bokat möte
-- i statistiken och ger ingen mötesprovision (`ursprungligBokare`); säljtavlan räknade det redan inte.
-- Bara möten utan utfall och i framtiden ändras, så ingen låst provision rörs.

create or replace function public.mote_namn_nyckel(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when char_length(k) > 2 then k end
    from (
      select string_agg(o, '' order by n) as k
        from regexp_split_to_table(lower(normalize(coalesce(p, ''), NFKC)), '[^[:alpha:][:digit:]]+') with ordinality as t(o, n)
       where o <> ''
         and o not in ('ab', 'aktiebolag', 'publ', 'hb', 'handelsbolag', 'kb', 'kommanditbolag')
    ) s
$$;

create or replace function public.mote_tel_nyckel(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when char_length(s) >= 7 then s end
    from (
      select case when d like '0046%' then '0' || substr(d, 5)
                  when d like '46%' then '0' || substr(d, 3)
                  else d end as s
        from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
    ) y
$$;

create or replace function public.mote_doman_nyckel(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when position('.' in d) > 0 and char_length(d) >= 4
               and d not in ('gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.se', 'outlook.com', 'outlook.se',
                             'live.com', 'live.se', 'msn.com', 'yahoo.com', 'yahoo.se', 'icloud.com', 'me.com',
                             'telia.com', 'bredband.net', 'spray.se', 'comhem.se', 'bahnhof.se')
              then d end
    from (
      select regexp_replace(
               split_part(split_part(split_part(split_part(
                 regexp_replace(regexp_replace(lower(btrim(coalesce(p, ''))), '^[a-z]+://', ''), '^www\.', ''),
               '/', 1), '?', 1), '#', 1), ':', 1),
             '\.$', '') as d
    ) x
$$;

create or replace function public.mote_epost_nyckel(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case when position('@' in e) > 1 and position('.' in split_part(e, '@', 2)) > 0 then e end
    from (select lower(btrim(coalesce(p, ''))) as e) x
$$;

-- Bolagen som är samma kund som p_bolag, p_bolag själv med.
create or replace function public.mote_kundens_bolag(p_bolag uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b2.id
    from public.mote_bolag b
    join public.mote_bolag b2
      on b2.id = b.id
      or public.mote_namn_nyckel(b2.namn) = public.mote_namn_nyckel(b.namn)
      or public.mote_tel_nyckel(b2.telefon) = public.mote_tel_nyckel(b.telefon)
      or public.mote_doman_nyckel(b2.doman) = public.mote_doman_nyckel(b.doman)
      or public.mote_epost_nyckel(b2.epost) = public.mote_epost_nyckel(b.epost)
   where b.id = p_bolag
$$;

-- Har kunden träffats före p_fore? Ett hållet möte på kortet (alltid före), eller på ett annat kort för samma kund.
create or replace function public.mote_kunden_traffad(p_kedja uuid, p_fore timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.mote h
      join public.mote_kedja hk on hk.id = h.kedja_id
     where h.utfall = 'hallet'
       and (h.kedja_id = p_kedja
            or (h.mote_tid < p_fore
                and hk.bolag_id in (select public.mote_kundens_bolag(k.bolag_id) from public.mote_kedja k where k.id = p_kedja)))
  )
$$;

-- Jobbets steg: kommande möten utan utfall där kunden redan träffats blir uppföljningsmöten. Antalet tillbaka.
create or replace function public.mote_art_ratta()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_antal integer;
begin
  with r as (
    update public.mote m
       set art = 'uppfoljning'
     where m.utfall is null
       and m.art <> 'uppfoljning'
       and m.mote_tid > now()
       and public.mote_kunden_traffad(m.kedja_id, m.mote_tid)
    returning 1
  )
  select count(*) into v_antal from r;
  return v_antal;
end;
$$;

revoke all on function public.mote_namn_nyckel(text) from public, anon, authenticated;
revoke all on function public.mote_tel_nyckel(text) from public, anon, authenticated;
revoke all on function public.mote_doman_nyckel(text) from public, anon, authenticated;
revoke all on function public.mote_epost_nyckel(text) from public, anon, authenticated;
revoke all on function public.mote_kundens_bolag(uuid) from public, anon, authenticated;
revoke all on function public.mote_kunden_traffad(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.mote_art_ratta() from public, anon, authenticated;
grant execute on function public.mote_namn_nyckel(text) to service_role;
grant execute on function public.mote_tel_nyckel(text) to service_role;
grant execute on function public.mote_doman_nyckel(text) to service_role;
grant execute on function public.mote_epost_nyckel(text) to service_role;
grant execute on function public.mote_kundens_bolag(uuid) to service_role;
grant execute on function public.mote_kunden_traffad(uuid, timestamptz) to service_role;
grant execute on function public.mote_art_ratta() to service_role;
