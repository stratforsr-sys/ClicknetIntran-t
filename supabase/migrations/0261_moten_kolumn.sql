-- =============================================================================
-- 0261_moten_kolumn.sql — Möten: kolumnregeln och de två vyerna
--
-- -----------------------------------------------------------------------------
-- VARFÖR
-- -----------------------------------------------------------------------------
--
-- Vilken kolumn ett kort står i på mötestavlan (Bokat, Bekräftat, Utfall saknas,
-- Följ upp, Tyst) räknas ut, aldrig lagras. Regeln står på ETT ställe,
-- mote_kolumn(), och båda vyerna anropar den:
--
--   mote_kort          en rad per öppen kedja = ett kort på tavlan
--   mote_kedja_utfall  en rad per kedja (även stängd) för statistiken (B)
--
-- stockholmsdag() och mote_ar_idag() är de andra två ställena där tid blir dag:
-- allt "i dag" och "i morgon" räknas i Europe/Stockholm, aldrig i UTC, så att ett
-- möte 00:30 svensk tid är "i dag" och inte "i går".
--
-- -----------------------------------------------------------------------------
-- REGELN (mote_kolumn, första som stämmer gäller)
-- -----------------------------------------------------------------------------
--
--   1. Öppet möte som inte slutat (start + längd > nu): bekraftat eller bokat.
--   2. Öppet möte i övrigt: utfall_saknas.
--   3. Uppföljningsdatum finns och (3 Inget svar i rad eller datumet passerat
--      med mer än 21 dagar): tyst.
--   4. Annars folj_upp. Ett golv, så att ett kort aldrig försvinner.
--
-- -----------------------------------------------------------------------------
-- "IDAG"-MARKERINGEN
-- -----------------------------------------------------------------------------
--
-- mote_kort.idag = mote_ar_idag(kolumn, mote_tid, uppfoljning_datum, now()).
-- Funktionen tar nu som argument just för att midnattsfallet ska gå att prova
-- (vyn kan inte få ett annat now() inuti en transaktion). Vyn skriver inte om
-- regeln, den anropar bara funktionen med now().
--
-- -----------------------------------------------------------------------------
-- RÄTTIGHETER (0240)
-- -----------------------------------------------------------------------------
--
-- Alla tre funktionerna är vanliga (invoker) funktioner som vyerna anropar som
-- inloggad användare: `grant execute … to authenticated`, revoke från public och
-- anon. Vyerna är security_invoker, så RLS på mote_kedja, mote och mote_bolag
-- gäller genom dem (säljaren ser bara sina kedjor, chefen allt).
-- =============================================================================

-- === Dag i Stockholm =========================================================

create or replace function public.stockholmsdag(t timestamptz)
returns date
language sql
immutable
as $$
  select (t at time zone 'Europe/Stockholm')::date
$$;

-- === Kolumnregeln ============================================================

create or replace function public.mote_kolumn(
  p_oppet_tid  timestamptz,
  p_langd      int,
  p_bekraftat  boolean,
  p_uppf       date,
  p_inget_svar int,
  p_nu         timestamptz
)
returns text
language sql
stable
as $$
  select case
    when p_oppet_tid is not null
         and p_oppet_tid + make_interval(mins => coalesce(p_langd, 30)) > p_nu
      then case when coalesce(p_bekraftat, false) then 'bekraftat' else 'bokat' end
    when p_oppet_tid is not null
      then 'utfall_saknas'
    when p_uppf is not null
         and (coalesce(p_inget_svar, 0) >= 3 or public.stockholmsdag(p_nu) - p_uppf > 21)
      then 'tyst'
    else 'folj_upp'
  end
$$;

-- === Markeringen "idag" ======================================================

create or replace function public.mote_ar_idag(
  p_kolumn   text,
  p_mote_tid timestamptz,
  p_uppf     date,
  p_nu       timestamptz
)
returns boolean
language sql
immutable
as $$
  select coalesce(
    case p_kolumn
      when 'bokat'         then public.stockholmsdag(p_mote_tid) <= public.stockholmsdag(p_nu) + 1
      when 'utfall_saknas' then true
      when 'folj_upp'      then p_uppf is not null and p_uppf <= public.stockholmsdag(p_nu)
      else false
    end,
    false)
$$;

revoke all on function public.stockholmsdag(timestamptz) from public, anon;
revoke all on function public.mote_kolumn(timestamptz, int, boolean, date, int, timestamptz) from public, anon;
revoke all on function public.mote_ar_idag(text, timestamptz, date, timestamptz) from public, anon;
grant execute on function public.stockholmsdag(timestamptz) to authenticated, service_role;
grant execute on function public.mote_kolumn(timestamptz, int, boolean, date, int, timestamptz) to authenticated, service_role;
grant execute on function public.mote_ar_idag(text, timestamptz, date, timestamptz) to authenticated, service_role;

-- === Vyn mote_kort: en rad per öppen kedja ===================================

create or replace view public.mote_kort
with (security_invoker = true) as
select
  k.id                          as kedja_id,
  k.bolag_id,
  b.namn,
  b.kontakt,
  b.telefon,
  b.epost,
  b.doman,
  m.id                          as mote_id,
  m.mote_tid,
  m.langd_min,
  m.halls_av,
  m.bokat_av,
  (m.bekraftat_nar is not null) as bekraftat,
  m.antal_flyttningar,
  m.mal,
  m.nulage,
  k.uppfoljning_datum,
  k.uppfoljning_text,
  (k.offert_nar is not null)    as offert,
  k.inget_svar_i_rad,
  k.uppfoljning_andrad,
  k.deltagare,
  c.kolumn,
  public.mote_ar_idag(c.kolumn, m.mote_tid, k.uppfoljning_datum, now()) as idag
from public.mote_kedja k
join public.mote_bolag b on b.id = k.bolag_id
left join public.mote m on m.kedja_id = k.id and m.utfall is null
cross join lateral (
  select public.mote_kolumn(m.mote_tid, m.langd_min, m.bekraftat_nar is not null,
                            k.uppfoljning_datum, k.inget_svar_i_rad, now()) as kolumn
) c
where k.avslut is null;

-- === Vyn mote_kedja_utfall: en rad per kedja, öppen och stängd ===============

create or replace view public.mote_kedja_utfall
with (security_invoker = true) as
select
  k.id                          as kedja_id,
  k.bolag_id,
  k.startad,
  k.avslut,
  k.avslut_nar,
  k.order_id,
  k.offert_nar,
  k.deltagare,
  fm.kalla,
  ny.bokat_av                   as forsta_bokat_av,
  ny.bokat_nar                  as forsta_bokat_nar,
  ny.mote_tid                   as forsta_mote_tid,
  fh.halls_av                   as forsta_hallna_halls_av,
  fh.mote_tid                   as forsta_hallna_tid,
  (k.avslut is not distinct from 'affar' and fh.resultat is not distinct from 'affar') as affar_forsta_mote,
  case when k.avslut is null then c.kolumn end as kolumn,
  coalesce(n.antal, 0)::int     as antal_moten
from public.mote_kedja k
left join lateral (
  select * from public.mote x where x.kedja_id = k.id
  order by x.bokat_nar, x.mote_tid, x.id limit 1
) fm on true
left join lateral (
  select * from public.mote x where x.kedja_id = k.id and x.art = 'ny'
  order by x.bokat_nar, x.mote_tid, x.id limit 1
) ny on true
left join lateral (
  select * from public.mote x where x.kedja_id = k.id and x.utfall = 'hallet'
  order by x.mote_tid, x.id limit 1
) fh on true
left join lateral (
  select count(*) as antal from public.mote x where x.kedja_id = k.id
) n on true
left join lateral (
  select * from public.mote x where x.kedja_id = k.id and x.utfall is null limit 1
) om on true
cross join lateral (
  select public.mote_kolumn(om.mote_tid, om.langd_min, om.bekraftat_nar is not null,
                            k.uppfoljning_datum, k.inget_svar_i_rad, now()) as kolumn
) c;

revoke all on public.mote_kort from public, anon;
revoke all on public.mote_kedja_utfall from public, anon;
grant select on public.mote_kort to authenticated, service_role;
grant select on public.mote_kedja_utfall to authenticated, service_role;
